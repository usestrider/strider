/** Native ceremonies and explicit transfer of passkeys, without replacing navigator.credentials. */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Capability, type Page, Popup } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import { createHash, createPublicKey, verify } from "node:crypto"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"

const timeout = 60_000
const challenge = [83, 116, 114, 105, 100, 101, 114, 45, 112, 97, 115, 115, 107, 101, 121]

const register = (page: Page.Page) =>
  page.evaluateInMainWorld(async (challenge) => {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: new Uint8Array(challenge),
        rp: { id: "localhost", name: "Strider RP" },
        user: { id: new Uint8Array([1, 2]), name: "test", displayName: "Test" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        timeout: 3000
      },
      signal: AbortSignal.timeout(5000)
    }) as PublicKeyCredential
    const response = credential.response as AuthenticatorAttestationResponse
    return {
      id: Array.from(new Uint8Array(credential.rawId)),
      client: Array.from(new Uint8Array(response.clientDataJSON)),
      auth: Array.from(new Uint8Array(response.getAuthenticatorData())),
      publicKey: Array.from(new Uint8Array(response.getPublicKey()!))
    }
  }, challenge)

const signIn = (page: Page.Page) =>
  page.evaluateInMainWorld(async (challenge) => {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: new Uint8Array(challenge),
        rpId: "localhost",
        userVerification: "required",
        timeout: 3000
      },
      signal: AbortSignal.timeout(5000)
    }) as PublicKeyCredential
    const response = credential.response as AuthenticatorAssertionResponse
    return {
      id: Array.from(new Uint8Array(credential.rawId)),
      client: Array.from(new Uint8Array(response.clientDataJSON)),
      auth: Array.from(new Uint8Array(response.authenticatorData)),
      signature: Array.from(new Uint8Array(response.signature)),
      user: Array.from(new Uint8Array(response.userHandle!))
    }
  }, challenge)

const checkClient = (client: ReadonlyArray<number>, auth: ReadonlyArray<number>, origin: string, type: string) => {
  const data = JSON.parse(Buffer.from(client).toString())
  assert.strictEqual(data.type, type)
  assert.strictEqual(data.challenge, Buffer.from(challenge).toString("base64url"))
  assert.strictEqual(data.origin, origin)
  assert.deepEqual(Buffer.from(auth.slice(0, 32)), createHash("sha256").update("localhost").digest())
  assert.strictEqual(auth[32]! & 5, 5, "user presence and verification")
}

export const webauthn = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} virtual authenticator`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect(
        "registers and verifies a native passkey sign-in across navigation, or refuses the backend",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const served = yield* site
            const page = yield* Browser.newPage()
            if (!(yield* supports("capability.virtualAuthenticator"))) {
              const error = yield* page.capability(Capability.VirtualAuthenticator).pipe(Effect.flip)
              assert.strictEqual(error._tag, "CapabilityError")
              assert.strictEqual(error.reason._tag, "Unsupported")
              return
            }
            yield* page.goto(`${served.crossSite}/child`)
            yield* page.activate
            const authenticator = yield* page.capability(Capability.VirtualAuthenticator)
            const registration = yield* register(page)
            checkClient(registration.client, registration.auth, served.crossSite, "webauthn.create")
            const credentials = yield* authenticator.credentials
            assert.lengthOf(credentials, 1)
            assert.deepEqual(Array.from(credentials[0]!.credentialId), registration.id)
            assert.notInclude(
              JSON.stringify(credentials),
              Buffer.from(Redacted.value(credentials[0]!.privateKey)).toString("base64")
            )
            yield* page.goto(`${served.origin}/child`)
            assert.lengthOf(yield* authenticator.credentials, 1)
            yield* page.goto(`${served.crossSite}/child`)
            const assertion = yield* signIn(page)
            checkClient(assertion.client, assertion.auth, served.crossSite, "webauthn.get")
            assert.deepEqual(assertion.id, registration.id)
            assert.deepEqual(assertion.user, [1, 2])
            const signed = Buffer.concat([
              Buffer.from(assertion.auth),
              createHash("sha256").update(Buffer.from(assertion.client)).digest()
            ])
            const key = createPublicKey({ key: Buffer.from(registration.publicKey), type: "spki", format: "der" })
            assert.isTrue(verify("sha256", signed, key, Buffer.from(assertion.signature)))
            signed[0] = signed[0]! ^ 1
            assert.isFalse(verify("sha256", signed, key, Buffer.from(assertion.signature)))
            assert.isAbove((yield* authenticator.credentials)[0]!.signCount, credentials[0]!.signCount)
          })),
        timeout
      )

      it.effect(
        "exports to a second page and popup with independent stores and counters",
        () =>
          Effect.scoped(Effect.gen(function*() {
            if (!(yield* supports("capability.virtualAuthenticator"))) return
            const served = yield* site
            const page = yield* Browser.newPage()
            const second = yield* Browser.newPage()
            yield* page.goto(`${served.crossSite}/child`)
            yield* page.activate
            const source = yield* page.capability(Capability.VirtualAuthenticator)
            yield* register(page)
            const [credential] = yield* source.credentials
            yield* second.goto(`${served.crossSite}/child`)
            const copy = yield* second.capability(Capability.VirtualAuthenticator)
            assert.lengthOf(yield* copy.credentials, 0)
            yield* copy.addCredential(credential!)
            yield* second.activate
            yield* signIn(second)
            yield* signIn(second)
            assert.strictEqual((yield* source.credentials)[0]!.signCount, credential!.signCount)
            assert.strictEqual((yield* copy.credentials)[0]!.signCount, credential!.signCount + 2)
            const opened = yield* Popup.next(page)
            yield* page.evaluateInMainWorld(() => {
              window.open("/child")
            })
            const popup = yield* opened
            const popupCopy = yield* popup.capability(Capability.VirtualAuthenticator)
            assert.lengthOf(yield* popupCopy.credentials, 0)
            yield* popupCopy.addCredential(credential!)
            yield* popup.activate
            yield* signIn(popup)
            assert.strictEqual((yield* popupCopy.credentials)[0]!.signCount, credential!.signCount + 1)
            assert.strictEqual((yield* source.credentials)[0]!.signCount, credential!.signCount)
          })),
        timeout
      )

      it.effect(
        "validates and manages credentials and verification/presence controls",
        () =>
          Effect.scoped(Effect.gen(function*() {
            if (!(yield* supports("capability.virtualAuthenticator"))) return
            const served = yield* site
            const page = yield* Browser.newPage()
            yield* page.goto(`${served.crossSite}/child`)
            yield* page.activate
            const handle = yield* page.capability(Capability.VirtualAuthenticator)
            yield* register(page)
            const [credential] = yield* handle.credentials
            for (
              const bad of [
                { ...credential!, credentialId: new Uint8Array() },
                { ...credential!, privateKey: Redacted.make(new Uint8Array([1, 2, 3])) },
                { ...credential!, signCount: -1 },
                { ...credential!, userHandle: undefined },
                { ...credential!, rpId: "" }
              ]
            ) {
              const error = yield* handle.addCredential(bad).pipe(Effect.flip)
              assert.strictEqual(error._tag, "WebAuthnError")
              assert.strictEqual(error.reason._tag, "InvalidInput")
              assert.notInclude(String(error), "1,2,3")
            }
            yield* handle.removeCredential(credential!.credentialId)
            assert.lengthOf(yield* handle.credentials, 0)
            yield* handle.addCredential(credential!)
            assert.lengthOf(yield* handle.credentials, 1)
            yield* handle.setUserVerified(false)
            yield* handle.setUserVerified(true)
            yield* handle.setAutomaticPresenceSimulation(false)
            yield* handle.setAutomaticPresenceSimulation(true)
            yield* signIn(page)
            yield* handle.clearCredentials
            assert.lengthOf(yield* handle.credentials, 0)
          })),
        timeout
      )

      it.effect(
        "rejects overlapping acquisition and releases on scope end and interruption",
        () =>
          Effect.scoped(Effect.gen(function*() {
            if (!(yield* supports("capability.virtualAuthenticator"))) return
            const page = yield* Browser.newPage()
            const scope = yield* Scope.make()
            const handle = yield* page.capability(Capability.VirtualAuthenticator).pipe(Scope.provide(scope))
            const overlap = yield* Effect.scoped(page.capability(Capability.VirtualAuthenticator)).pipe(Effect.flip)
            assert.strictEqual(overlap._tag, "CapabilityError")
            assert.include(overlap.message, "already")
            yield* Scope.close(scope, Exit.void)
            const stale = yield* handle.credentials.pipe(Effect.flip)
            assert.strictEqual(stale._tag, "TargetGone")
            assert.strictEqual(stale.reason._tag, "AccessReleased")
            const acquired = yield* Deferred.make<void>()
            const fiber = yield* Effect.scoped(Effect.gen(function*() {
              yield* page.capability(Capability.VirtualAuthenticator)
              yield* Deferred.succeed(acquired, undefined)
              yield* Effect.never
            })).pipe(Effect.forkChild)
            yield* Deferred.await(acquired)
            yield* Fiber.interrupt(fiber)
            const fresh = yield* page.capability(Capability.VirtualAuthenticator)
            assert.lengthOf(yield* fresh.credentials, 0)
            yield* page.close()
          })),
        timeout
      )
    })
  })
