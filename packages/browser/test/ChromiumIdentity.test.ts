import { assert, describe, it } from "@effect/vitest"
import { fromWebSocket } from "../src/internal/chromiumIdentity.ts"

describe("Chromium browser claim identity", () => {
  it("uses the browser GUID independently of the endpoint host", () => {
    assert.strictEqual(fromWebSocket("ws://localhost:9222/devtools/browser/browser-guid"), "browser-guid")
    assert.strictEqual(fromWebSocket("wss://proxy.example/devtools/browser/browser-guid"), "browser-guid")
  })
  it("refuses paths that do not identify a browser", () => {
    for (
      const path of ["/", "/session", "/devtools/page/page-id", "/devtools/browser/", "/devtools/browser/id/extra"]
    ) {
      assert.isUndefined(fromWebSocket(`ws://localhost:9222${path}`))
    }
  })
})
