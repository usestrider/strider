/** The native capture/navigation overlap, followed by an explicit replacement capture. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import * as BrowserImpl from "../../../src/internal/browser.ts"
import * as CdpAdapter from "../../../src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { site } from "../adapter/harness.ts"
import { chromium } from "../browsers.ts"

const timeout = 60_000

describe("Chromium capture invalidation", () => {
  layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    it.effect(
      "invalidates forced overlap and immediately captures replacement pixels at the viewport dimensions",
      () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const url = (color: string) =>
            `${origin}/fixture?html=${
              encodeURIComponent(
                `<style>html,body{margin:0;background:${color}}main{width:829px;height:5631px;background:${color}}</style><main></main>`
              )
            }`
          const replacement = url("rgb(0,0,255)")
          let force = false
          const wire: Array<object> = []
          const backend = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
            const { transport } = yield* ChromiumLauncher.launch({ executablePath: chromium.executable })
            return yield* CdpAdapter.connect({
              ...transport,
              send: Effect.fnUntraced(function*(message: string) {
                const command = JSON.parse(message)
                wire.push({ direction: "send", ...command })
                yield* transport.send(message)
                if (force && command.method === "Page.captureScreenshot") {
                  force = false
                  const navigation = {
                    id: -13,
                    sessionId: command.sessionId,
                    method: "Page.navigate",
                    params: { url: replacement }
                  }
                  wire.push({ direction: "send", ...navigation })
                  yield* transport.send(JSON.stringify(navigation))
                }
              }),
              messages: transport.messages.pipe(Stream.tap((message) =>
                Effect.sync(() => {
                  const reply = JSON.parse(message)
                  // Keep native reply receipt metadata without printing image payloads.
                  wire.push({
                    direction: "receive",
                    ...reply,
                    ...(reply.result?.data ? { result: { dataLength: reply.result.data.length } } : {})
                  })
                })
              ))
            }, { sink, ownership: "launched" })
          }))
          yield* Effect.gen(function*() {
            const page = yield* Browser.newPage({ emulation: { viewport: { width: 1100, height: 1000 } } })
            yield* page.goto(url("rgb(255,0,0)"), { waitUntil: "load" })
            force = true
            const error = yield* page.screenshot({ area: { element: page.locator("main") } }).pipe(
              Effect.flip
            )
            assert(Page.isPageError(error))
            assert.strictEqual(error.reason._tag, "CaptureInvalidated")
            if (error.reason._tag === "CaptureInvalidated") {
              assert.notStrictEqual(error.reason.document, error.reason.replacement)
            }
            // No load wait, delay, repair, or retry between the invalidation and this caller-initiated capture.
            const png = yield* page.screenshot()
            const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
            assert.deepStrictEqual([view.getUint32(16), view.getUint32(20)], [1100, 1000])
            const encoded = Buffer.from(png).toString("base64")
            const pixel = yield* page.evaluateInMainWorld(async (encoded) => {
              const image = new Image()
              image.src = `data:image/png;base64,${encoded}`
              await image.decode()
              const canvas = document.createElement("canvas")
              canvas.width = 1
              canvas.height = 1
              const context = canvas.getContext("2d")!
              context.drawImage(image, 0, 0)
              return Array.from(context.getImageData(0, 0, 1, 1).data)
            }, encoded)
            assert.deepStrictEqual(pixel, [0, 0, 255, 255])
          }).pipe(
            Effect.provide(backend),
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (Exit.isFailure(exit)) console.log("capture overlap wire", JSON.stringify(wire))
              })
            )
          )
        }),
      timeout
    )
  })
})
