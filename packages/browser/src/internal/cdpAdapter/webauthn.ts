/** Native WebAuthn ownership: one virtual environment on each page's frame tree. */
import * as Effect from "effect/Effect"
import * as Base64 from "effect/encoding/Base64"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Cdp from "../../cdp/WebAuthn.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Reason from "../../Reason.ts"
import type * as Target from "../../Target.ts"
import * as WebAuthn from "../../WebAuthn.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
import { type PageEntry, pageOf, type State } from "./state.ts"

interface Owner {
  readonly session: ProtocolClient.Session
  released: boolean
}
const owners = new WeakMap<PageEntry, Owner>()
const handles = new WeakMap<Adapter.Authenticator, Owner>()
const busy = () =>
  new Adapter.AdapterError({
    reason: new Reason.BackendFailure({
      kind: "Rejected",
      method: "WebAuthn.addVirtualAuthenticator",
      hint: "A virtual authenticator is already acquired on this page"
    })
  })

export const create = Effect.fnUntraced(function*(state: State, page: Target.NavigableId) {
  const entry = yield* pageOf(state, page)
  if (owners.has(entry)) return yield* Effect.fail(busy())
  const ref = { page, id: "" }
  const owner: Owner = { session: entry.target.session, released: false }
  owners.set(entry, owner)
  handles.set(ref, owner)
  // BoundedAdapter runs creations apart from their caller and releases a late success. On a failed
  // command, disable is ordered after enable/add on this session, including replies that arrive late.
  return yield* Effect.gen(function*() {
    yield* Kit.protocol(Cdp.enable({ enableUI: false }).pipe(Protocol.on(owner.session)))
    const result = yield* Kit.protocol(
      Cdp.addVirtualAuthenticator({
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true
        }
      }).pipe(Protocol.on(owner.session))
    )
    ref.id = result.authenticatorId
    return ref
  }).pipe(Effect.onError(() => release(state, ref).pipe(Operation.detached, Effect.ignore)))
})

export const release = Effect.fnUntraced(function*(state: State, ref: Adapter.Authenticator) {
  const owner = handles.get(ref)
  if (owner === undefined || owner.released) return
  owner.released = true
  // Keep the reservation until both commands finish, so a new acquisition cannot be disabled by this one.
  if (ref.id !== "") {
    yield* Kit.protocol(
      Cdp.removeVirtualAuthenticator({ authenticatorId: ref.id as Cdp.AuthenticatorId }).pipe(
        Protocol.on(owner.session)
      )
    ).pipe(
      Effect.provideService(ProtocolClient.CommandDeadline, Option.none()),
      Effect.ignore
    )
  }
  const disabled = yield* Kit.protocol(Cdp.disable().pipe(Protocol.on(owner.session))).pipe(
    Effect.provideService(ProtocolClient.CommandDeadline, Option.none()),
    Effect.exit
  )
  const entry = state.pages.get(ref.page)
  // An unconfirmed disable must not authorize a new owner over a possibly live old environment.
  if (Exit.isSuccess(disabled) || entry === undefined || entry.ended) {
    if (entry !== undefined && owners.get(entry) === owner) owners.delete(entry)
    handles.delete(ref)
  }
  if (Exit.isFailure(disabled) && entry !== undefined && !entry.ended) return yield* Effect.failCause(disabled.cause)
})

const session = Effect.fnUntraced(function*(state: State, ref: Adapter.Authenticator) {
  yield* pageOf(state, ref.page)
  const owner = handles.get(ref)
  if (owner === undefined || owner.released) return yield* Effect.fail(Kit.ended({ _tag: "Page", id: ref.page }))
  return owner.session
})

export const credentials = Effect.fnUntraced(function*(state: State, ref: Adapter.Authenticator) {
  const on = yield* session(state, ref)
  const result = yield* Kit.protocol(
    Cdp.getCredentials({ authenticatorId: ref.id as Cdp.AuthenticatorId }).pipe(Protocol.on(on))
  )
  return yield* Effect.forEach(result.credentials, (credential) =>
    Effect.gen(function*() {
      const credentialId = yield* Kit.decodeBase64(credential.credentialId, "WebAuthn.getCredentials")
      const privateKey = yield* Kit.decodeBase64(Redacted.value(credential.privateKey), "WebAuthn.getCredentials")
      const userHandle = credential.userHandle === undefined
        ? undefined
        : yield* Kit.decodeBase64(credential.userHandle, "WebAuthn.getCredentials")
      const decoded = {
        credentialId,
        privateKey: Redacted.make(privateKey),
        userHandle,
        rpId: credential.rpId,
        isResidentCredential: credential.isResidentCredential,
        signCount: credential.signCount,
        backupEligibility: credential.backupEligibility,
        backupState: credential.backupState,
        userName: credential.userName,
        userDisplayName: credential.userDisplayName
      }
      if (!Schema.is(WebAuthn.Credential)(decoded)) {
        return yield* Effect.fail(Kit.undecodable("WebAuthn.getCredentials", "Invalid credential metadata"))
      }
      return decoded
    }))
})

export const update = Effect.fnUntraced(
  function*(state: State, ref: Adapter.Authenticator, update: Adapter.AuthenticatorUpdate) {
    const on = yield* session(state, ref)
    const authenticatorId = ref.id as Cdp.AuthenticatorId
    switch (update._tag) {
      case "Add": {
        const credential = update.credential
        yield* Kit.protocol(
          Cdp.addCredential({
            authenticatorId,
            credential: {
              ...credential,
              credentialId: Base64.encode(credential.credentialId),
              privateKey: Redacted.make(Base64.encode(Redacted.value(credential.privateKey))),
              userHandle: credential.userHandle === undefined ? undefined : Base64.encode(credential.userHandle)
            }
          }).pipe(Protocol.on(on))
        )
        return
      }
      case "Remove":
        yield* Kit.protocol(
          Cdp.removeCredential({ authenticatorId, credentialId: Base64.encode(update.credentialId) }).pipe(
            Protocol.on(on)
          )
        )
        return
      case "Clear":
        yield* Kit.protocol(Cdp.clearCredentials({ authenticatorId }).pipe(Protocol.on(on)))
        return
      case "Verified":
        yield* Kit.protocol(
          Cdp.setUserVerified({ authenticatorId, isUserVerified: update.verified }).pipe(Protocol.on(on))
        )
        return
      case "Presence":
        yield* Kit.protocol(
          Cdp.setAutomaticPresenceSimulation({ authenticatorId, enabled: update.enabled }).pipe(Protocol.on(on))
        )
        return
    }
  }
)
