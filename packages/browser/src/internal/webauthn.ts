/** Public authenticator operations: validation, access lifetime, deadlines and error mapping. */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Capability from "../Capability.ts"
import type * as Deadline from "../Deadline.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import * as WebAuthn from "../WebAuthn.ts"
import * as Access from "./access.ts"
import type * as Adapter from "./adapter.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"
const held = new WeakMap<Model.PageEntry, number>()
export const isHeld = (page: Model.PageEntry): boolean => (held.get(page) ?? 0) > 0

const invalid = (input: string, expected: string) =>
  new WebAuthn.WebAuthnError({
    reason: new Reason.InvalidInput({ input, expected, hint: "Credential values are not included in diagnostics" }),
    diagnostics: Operation.diagnosticsNow()
  })

export const acquire = Effect.fnUntraced(
  function*(runtime: Runtime.Runtime, page: Model.PageEntry, grant: Option.Option<Access.Grant>) {
    if (Option.isSome(grant) && grant.value.level !== "control") {
      return yield* Effect.fail(
        new Capability.CapabilityError({
          capability: "VirtualAuthenticator",
          reason: new Reason.NotPermitted({
            required: "control",
            hint: "Acquire page.control before installing a virtual authenticator"
          }),
          diagnostics: Operation.diagnosticsNow()
        })
      )
    }
    yield* Access.check(grant)
    const adapter = runtime.model.adapter
    const map = (error: Adapter.AdapterError | Deadline.Timeout) => {
      const failure = Operation.fromAdapter(error, Operation.idNow(), runtime.backend)
      return failure._tag === "Reason"
        ? new WebAuthn.WebAuthnError({ reason: failure.reason, diagnostics: Operation.diagnosticsNow() })
        : failure.error
    }
    let released = false
    const ref = yield* Effect.acquireRelease(
      Effect.suspend<
        Adapter.Authenticator,
        Adapter.AdapterError | Deadline.Timeout | Capability.CapabilityError,
        never
      >(() => {
        if (page.contextEntry.storageReplacing === true) {
          return Effect.fail(
            new Capability.CapabilityError({
              capability: "VirtualAuthenticator",
              reason: new Reason.NotPermitted({ required: "control", hint: "Storage replacement is in progress" }),
              diagnostics: Operation.diagnosticsNow()
            })
          )
        }
        held.set(page, (held.get(page) ?? 0) + 1)
        return adapter.createAuthenticator(page.id).pipe(
          Effect.onError(() => Effect.sync(() => held.set(page, (held.get(page) ?? 1) - 1)))
        )
      }),
      (ref) => release(ref)
    ).pipe(
      Effect.mapError((error) => {
        if (error._tag === "CapabilityError") return error
        const failure = Operation.fromAdapter(error, Operation.idNow(), runtime.backend)
        return failure._tag === "Reason"
          ? new Capability.CapabilityError({
            capability: "VirtualAuthenticator",
            reason: failure.reason,
            diagnostics: Operation.diagnosticsNow()
          })
          : failure.error
      })
    )
    function release(ref: Adapter.Authenticator) {
      return Effect.suspend(() => {
        if (released) return Effect.void
        released = true
        return adapter.releaseAuthenticator(ref).pipe(
          Operation.detached,
          Effect.ensuring(Effect.sync(() => held.set(page, (held.get(page) ?? 1) - 1))),
          Effect.ignore
        )
      })
    }
    if (Option.isSome(grant)) yield* grant.value.onRelease(release(ref))
    const check = Effect.andThen(
      Access.check(grant),
      Effect.suspend(() =>
        released
          ? Effect.fail(
            new Target.TargetGone({
              target: { _tag: "Page", id: page.id },
              reason: new Target.AccessReleased({}),
              diagnostics: Operation.diagnosticsNow()
            })
          )
          : Effect.void
      )
    )
    const run = <A>(
      name: string,
      call: Effect.Effect<A, Adapter.AdapterError | Deadline.Timeout | WebAuthn.WebAuthnError>
    ) =>
      Effect.andThen(check, call.pipe(Effect.mapError((error) => error._tag === "WebAuthnError" ? error : map(error))))
        .pipe(
          Effect.raceFirst(Runtime.pageEnded(page)),
          Operation.named(`WebAuthn.${name}`, { attributes: { "browser.page.id": page.id } })
        )
    const update = (name: string, update: Adapter.AuthenticatorUpdate) =>
      run(name, adapter.updateAuthenticator(ref, update))
    const handle: WebAuthn.VirtualAuthenticator = {
      credentials: run("credentials", adapter.authenticatorCredentials(ref)),
      addCredential: (input) =>
        run(
          "addCredential",
          Effect.gen(function*() {
            if (!Schema.is(WebAuthn.Credential)(input)) {
              return yield* Effect.fail(invalid("credential", "a valid WebAuthn.Credential"))
            }
            const credential: WebAuthn.Credential = {
              ...input,
              credentialId: Uint8Array.from(input.credentialId),
              privateKey: Redacted.make(Uint8Array.from(Redacted.value(input.privateKey))),
              ...(input.userHandle === undefined ? {} : { userHandle: Uint8Array.from(input.userHandle) })
            }
            // Chromium validates PKCS#8 and its supported key algorithms. Reusing that validator also
            // permits a credential the native authenticator exported to be imported without an ES256-only gate.
            yield* adapter.updateAuthenticator(ref, { _tag: "Add", credential }).pipe(
              Effect.catch(
                (error): Effect.Effect<void, Adapter.AdapterError | Deadline.Timeout | WebAuthn.WebAuthnError> => {
                  if (error._tag === "AdapterError" && error.reason._tag === "Protocol") {
                    const reason = error.reason.error.reason
                    if (
                      reason._tag === "Rejected" && reason.method === "WebAuthn.addCredential" &&
                      reason.description === "An error occurred trying to create the credential"
                    ) {
                      return Effect.fail(
                        invalid("credential", "a browser-supported PKCS#8 private key and a new credential ID")
                      )
                    }
                  }
                  return Effect.fail(error)
                }
              )
            )
          })
        ),
      removeCredential: (credentialId) =>
        run(
          "removeCredential",
          Effect.suspend<void, Adapter.AdapterError | Deadline.Timeout | WebAuthn.WebAuthnError, never>(() =>
            credentialId instanceof Uint8Array && credentialId.length > 0 && credentialId.length <= 1023
              ? adapter.updateAuthenticator(ref, { _tag: "Remove", credentialId: Uint8Array.from(credentialId) })
              : Effect.fail(invalid("credentialId", "1 to 1023 credential ID bytes"))
          )
        ),
      clearCredentials: update("clearCredentials", { _tag: "Clear" }),
      setUserVerified: (verified) => update("setUserVerified", { _tag: "Verified", verified }),
      setAutomaticPresenceSimulation: (enabled) =>
        update("setAutomaticPresenceSimulation", { _tag: "Presence", enabled })
    }
    return handle
  }
)
