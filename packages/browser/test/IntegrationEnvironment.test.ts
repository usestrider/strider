import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { vi } from "vitest"
import * as CdpWire from "../src/internal/cdpWire.ts"
import { assertVersion, integrationEnvironment } from "./integration/platform.ts"
import { record } from "./integration/record.ts"

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
    assert.throws(() =>
      integrationEnvironment("darwin", {
        STRIDER_ENVIRONMENT: "macos-integration",
        STRIDER_RECORD: "/tmp/traffic"
      }), /recording/)
  })
  it("refuses to open a Linux fixture through the recording wrapper on macOS", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-recording-"))
    const target = path.join(directory, "traffic")
    try {
      vi.stubEnv("STRIDER_ENVIRONMENT", "macos-integration")
      vi.stubEnv("STRIDER_RECORD", target)
      assert.throws(
        () =>
          record(
            { send: () => Effect.void, messages: Stream.empty, closed: Effect.never },
            CdpWire.wire,
            "linux-fixture"
          ),
        /recording/
      )
      assert.isFalse(fs.existsSync(target))
    } finally {
      vi.unstubAllEnvs()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
  it("imports Chromium settings without requiring WebKit or Xvfb on macOS", () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      STRIDER_ENVIRONMENT: "macos-integration",
      STRIDER_CHROMIUM: "/chrome",
      STRIDER_FIREFOX: "/firefox",
      STRIDER_OPENSSL: "/openssl"
    }
    delete env["STRIDER_WEBKITGTK"]
    delete env["STRIDER_XVFB"]
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      `
      const { chromium, firefox } = await import(${
        JSON.stringify(new URL("./integration/browsers.ts", import.meta.url).href)
      })
      if (chromium.version !== "155.0.8059.79" || firefox.version !== "158.0") process.exit(1)
    `
    ], { env, encoding: "utf8" })
    assert.strictEqual(result.status, 0, result.stderr)
  })
  it("requires exact browser versions on both platforms", () => {
    assert.doesNotThrow(() => assertVersion("Firefox", "158.0", "158.0"))
    assert.throws(() => assertVersion("Firefox", "158.0.1", "158.0"), /browsers.json.*Nix.*pnpm test:integration/)
    assert.throws(
      () => assertVersion("Firefox", "158.0.1", "158.0", "macos"),
      /browsers.macos.json.*pnpm test:integration:macos/
    )
    assert.throws(() => assertVersion("Chromium", "155.0.8059.80", "155.0.8059.79"), /pinned/)
  })
})
