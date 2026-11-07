/** Credential boundary validation and secret-safe representation. */
import { assert, describe, it } from "@effect/vitest"
import * as WebAuthn from "@usestrider/browser/WebAuthn"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"

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
        { ...credential, signCount: -1 },
        { ...credential, signCount: 0x1_0000_0000 },
        { ...credential, signCount: 0.5 },
        { ...credential, privateKey: new Uint8Array([42]) }
      ]
    ) assert.isFalse(isCredential(invalid))
    assert.isTrue(isCredential({ ...credential, isResidentCredential: false, userHandle: undefined }))
  })

  it("keeps private keys redacted under ordinary inspection", () => {
    const decoded = Schema.decodeUnknownSync(WebAuthn.Credential)(credential)
    assert.notInclude(JSON.stringify(decoded), "42")
    assert.deepEqual(Redacted.value(decoded.privateKey), new Uint8Array([42, 43, 44]))
  })
})
