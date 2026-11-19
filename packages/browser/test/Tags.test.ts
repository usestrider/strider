/**
 * How a script tag reads the browser's console entry for an inline refusal, on the entries the pinned builds
 * write: a roll that rewords them fails here.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Tags from "../src/internal/tags.ts"

// Chromium 155.0.8059.79, for `script-src 'self'`
const chromiumSelf =
  "Executing inline script violates the following Content Security Policy directive 'script-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-czUo/QHvKrQ2Mft9HCIYNl6ijWN9aB3h0broPoGbvNA='), or a nonce ('nonce-...') is required to enable inline execution."
// Chromium 155.0.8059.79, a policy that allows one hash refusing a script with another
const chromiumHashed =
  "Executing inline script violates the following Content Security Policy directive 'script-src 'sha256-hVlErOoRBgcjFbazhFKtoMKqd+Ccc2+nUrSnEkj18s8=''. Either the 'unsafe-inline' keyword, a hash ('sha256-+iv6FwCvXSJoWbXZoV/Y/qgPttK7/HHKlBIm5ZUYbmo='), or a nonce ('nonce-...') is required to enable inline execution."
// WebKitGTK 2.54.1, for `script-src 'self'`
const webKit =
  "Refused to execute a script because its hash, its nonce, or 'unsafe-inline' does not appear in the script-src directive of the Content Security Policy."

describe("script tag refusal entries", () => {
  it("reads the hash Chromium suggests for the refused script", () => {
    assert.strictEqual(Tags.chromiumRefusal(chromiumSelf), "czUo/QHvKrQ2Mft9HCIYNl6ijWN9aB3h0broPoGbvNA=")
  })

  it("reads the refused script's hash, not one the quoted policy allows", () => {
    assert.strictEqual(Tags.chromiumRefusal(chromiumHashed), "+iv6FwCvXSJoWbXZoV/Y/qgPttK7/HHKlBIm5ZUYbmo=")
  })

  it("takes nothing from a report-only entry or another message", () => {
    assert.isUndefined(Tags.chromiumRefusal(`[Report Only] ${chromiumSelf}`))
    assert.isUndefined(Tags.chromiumRefusal("Refused to load the image because it violates the policy"))
    assert.isFalse(Tags.webKitRefusal(`[Report Only] ${webKit}`))
  })

  it("recognizes WebKit's refusal of an inline script", () => {
    assert.isTrue(Tags.webKitRefusal(webKit))
  })
})
