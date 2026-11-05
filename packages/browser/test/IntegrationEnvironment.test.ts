import { assert, describe, it } from "@effect/vitest"
import { assertVersion, integrationEnvironment } from "./integration/platform.ts"

describe("integration environment", () => {
  it("accepts only the platform's explicit entry point", () => {
    assert.strictEqual(integrationEnvironment("linux", { STRIDER_ENVIRONMENT: "nix-integration" }), "linux")
    assert.strictEqual(integrationEnvironment("darwin", { STRIDER_ENVIRONMENT: "macos-integration" }), "macos")
    for (const platform of ["linux", "darwin", "win32"]) {
      assert.throws(() => integrationEnvironment(platform, {}))
    }
    assert.throws(() => integrationEnvironment("linux", { STRIDER_ENVIRONMENT: "macos-integration" }))
    assert.throws(() => integrationEnvironment("darwin", { STRIDER_ENVIRONMENT: "nix-integration" }))
  })
  it("rejects macOS recording before a fixture can be opened", () => {
    assert.throws(() => integrationEnvironment("darwin", {
      STRIDER_ENVIRONMENT: "macos-integration",
      STRIDER_RECORD: "/tmp/traffic"
    }), /recording/)
  })
  it("requires exact browser versions on both platforms", () => {
    assert.doesNotThrow(() => assertVersion("Firefox", "158.0", "158.0"))
    assert.throws(() => assertVersion("Firefox", "158.0.1", "158.0"), /pinned/)
    assert.throws(() => assertVersion("Chromium", "155.0.8059.80", "155.0.8059.79"), /pinned/)
  })
})
