import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Route } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Layer from "effect/Layer"

const shell = "/nix/store/njyg4nr7cy7g3b1g1a5yw422wn53s8l8-playwright-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell"

describe("probe shell", () => {
  layer(Chromium.layer({ executablePath: shell }).pipe(Layer.provide(NodeServices.layer)), { excludeTestServices: true, timeout: 60_000 })((it) => {
    it.effect("attach urls", () => Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { viewport: { width: 1280, height: 900 } } })
      yield* context.route("https://target.test/**", () =>
        Route.fulfill(HttpServerResponse.text("<title>routed</title>", { contentType: "text/html" })))
      console.log("PROBE newPage")
      yield* context.newPage
      console.log("PROBE createTarget routed")
      ;(globalThis as any).__probeUrl = "https://target.test/"
      const started = Date.now()
      const routed = yield* context.newPage
      ;(globalThis as any).__probeUrl = undefined
      console.log(`PROBE routed ready in ${Date.now() - started}ms`)
      yield* Effect.sleep("500 millis")
      console.log("PROBE routed", JSON.stringify(yield* routed.evaluateInMainWorld(() => [location.href, document.title])))
      assert.ok(true)
    })), 60_000)
  })
})
