import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Route } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Layer from "effect/Layer"
import { chromium } from "../browsers.ts"

describe("probe attach url", () => {
  layer(Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer)), {
    excludeTestServices: true,
    timeout: 60_000
  })((it) => {
    it.effect("attach urls", () =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ emulation: { viewport: { width: 1280, height: 900 } } })
        yield* context.route("https://target.test/**", () =>
          Route.fulfill(HttpServerResponse.text("<title>routed</title>", { contentType: "text/html" })))
        console.log("PROBE newPage")
        const plain = yield* context.newPage
        console.log("PROBE createTarget routed")
        ;(globalThis as any).__probeUrl = "https://target.test/"
        const started = Date.now()
        const routed = yield* context.newPage
        ;(globalThis as any).__probeUrl = undefined
        console.log(`PROBE routed ready in ${Date.now() - started}ms`)
        console.log(
          "PROBE sizes",
          JSON.stringify(
            yield* plain.evaluateInMainWorld(() =>
              location.href
            )
          ),
          JSON.stringify(
            yield* routed.evaluateInMainWorld(() => [location.href, document.title, innerWidth, innerHeight])
          )
        )
        assert.ok(true)
      })), 60_000)
  })
})
