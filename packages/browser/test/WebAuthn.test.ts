/** Credential boundary validation and secret-safe representation. */
import { assert, describe, it } from "@effect/vitest"
import * as WebAuthn from "@usestrider/browser/WebAuthn"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import { generateKeyPairSync } from "node:crypto"
import * as Adapter from "../src/internal/adapter.ts"
import type * as Model from "../src/internal/model.ts"
import type * as Runtime from "../src/internal/runtime.ts"
import * as Impl from "../src/internal/webauthn.ts"
import type * as Target from "../src/Target.ts"

const credential = {
  credentialId: new Uint8Array([1]),
  isResidentCredential: true,
  rpId: "localhost",
  privateKey: Redacted.make(new Uint8Array([42, 43, 44])),
  userHandle: new Uint8Array([2]),
  signCount: 0
}

describe("WebAuthn credential", () => {
  it("requires resident user handles, bounded binary IDs, and unsigned counters", () => {
    const isCredential = Schema.is(WebAuthn.Credential)
    assert.isTrue(isCredential(credential))
    for (
      const invalid of [
        { ...credential, credentialId: new Uint8Array() },
        { ...credential, credentialId: new Uint8Array(1024) },
        { ...credential, userHandle: undefined },
        { ...credential, userHandle: new Uint8Array(65) },
        { ...credential, rpId: "" },
        { ...credential, rpId: "https://localhost" },
        { ...credential, rpId: "localhost:443" },
        { ...credential, signCount: -1 },
        { ...credential, signCount: 0x1_0000_0000 },
        { ...credential, signCount: 0.5 },
        { ...credential, privateKey: new Uint8Array([42]) }
      ]
    ) assert.isFalse(isCredential(invalid))
    assert.isTrue(isCredential({ ...credential, isResidentCredential: false, userHandle: undefined }))
  })

  it.effect("allows native-supported RSA and Ed25519 credential keys to reach the adapter", () =>
    Effect.scoped(Effect.gen(function*() {
      const closed = yield* Deferred.make<Target.CloseReason>()
      const page = { id: "page-1", closed } as unknown as Model.PageEntry
      const sent: Array<Adapter.AuthenticatorUpdate> = []
      const runtime = {
        backend: "Chromium",
        model: {
          adapter: {
            createAuthenticator: () => Effect.succeed({ page: page.id, id: "A1" }),
            releaseAuthenticator: () => Effect.void,
            authenticatorCredentials: () => Effect.succeed([]),
            updateAuthenticator: (_: unknown, update: Adapter.AuthenticatorUpdate) =>
              Effect.sync(() => {
                sent.push(update)
              })
          }
        }
      } as unknown as Runtime.Runtime
      const handle = yield* Impl.acquire(runtime, page, Option.none())
      const keys = [
        generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey,
        generateKeyPairSync("ed25519").privateKey
      ]
      for (const key of keys) {
        const bytes = key.export({ type: "pkcs8", format: "der" })
        yield* handle.addCredential({ ...credential, privateKey: Redacted.make(bytes) })
        bytes.fill(0)
      }
      assert.lengthOf(sent, 2)
      for (const update of sent) {
        assert.strictEqual(update._tag, "Add")
        if (update._tag === "Add") assert.strictEqual(Redacted.value(update.credential.privateKey)[0], 0x30)
      }
    })))

  it.effect("releases the storage replacement hold even when native authenticator release fails", () =>
    Effect.gen(function*() {
      const closed = yield* Deferred.make<Target.CloseReason>()
      const page = { id: "release-failure", closed } as unknown as Model.PageEntry
      let releases = 0
      const runtime = {
        backend: "Chromium",
        model: {
          adapter: {
            createAuthenticator: () => Effect.succeed({ page: page.id, id: "A1" }),
            authenticatorCredentials: () => Effect.succeed([]),
            updateAuthenticator: () => Effect.void,
            releaseAuthenticator: () =>
              Effect.suspend(() => {
                releases++
                return Effect.fail(
                  new Adapter.AdapterError({
                    reason: {
                      _tag: "Unsupported",
                      capability: "releaseAuthenticator",
                      hint: "release rejected"
                    }
                  })
                )
              })
          }
        }
      } as unknown as Runtime.Runtime
      const scope = yield* Scope.make()
      yield* Impl.acquire(runtime, page, Option.none()).pipe(Scope.provide(scope))
      assert.isTrue(Impl.isHeld(page))
      yield* Scope.close(scope, Exit.void)
      assert.equal(releases, 1)
      assert.isFalse(Impl.isHeld(page))
    }))

  it("keeps private keys redacted under ordinary inspection", () => {
    const decoded = Schema.decodeUnknownSync(WebAuthn.Credential)(credential)
    assert.notInclude(JSON.stringify(decoded), "42")
    assert.deepEqual(Redacted.value(decoded.privateKey), new Uint8Array([42, 43, 44]))
  })
})
