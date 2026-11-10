/**
 * Where Chromium opens a page: a window of its own by default, and a tab where the context emulates focus, which
 * keeps a page behind another rendering, so it stays usable without `activate`.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as BrowserImpl from "../../../src/internal/browser.ts"
import * as CdpAdapter from "../../../src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { site } from "../adapter/harness.ts"
import { chromium } from "../browsers.ts"

/** Chromium over a transport that notes the parameters of every `Target.createTarget` sent. */
const recording = (created: Array<Record<string, unknown>>) =>
  BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
    const { transport } = yield* ChromiumLauncher.launch({ executablePath: chromium.executable })
    return yield* CdpAdapter.connect({
      ...transport,
      send: (message: string) => {
        const command = JSON.parse(message)
        if (command.method === "Target.createTarget") created.push(command.params)
        return transport.send(message)
      },
      messages: transport.messages.pipe(Stream.map((message) => message))
    }, { sink, ownership: "launched" })
  }))

describe("Chromium page placement", () => {
  layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    it.effect("opens a page in a window of its own by default", () =>
      Effect.gen(function*() {
        const created: Array<Record<string, unknown>> = []
        yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* Browser.newContext()
          yield* context.newPage
        })).pipe(Effect.provide(recording(created)))
        assert.deepStrictEqual(created.map((params) => params.newWindow), [true])
      }), { timeout: 60_000 })

    it.effect(
      "opens pages as tabs where the context emulates focus, and one behind another still renders and acts",
      () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const created: Array<Record<string, unknown>> = []
          yield* Effect.scoped(Effect.gen(function*() {
            const context = yield* Browser.newContext({ focus: "emulated" })
            const behind = yield* context.newPage
            yield* behind.goto(
              `${origin}/fixture?html=${
                encodeURIComponent(
                  "<button onclick=\"document.querySelector('#count').textContent='1'\">Increment</button><p id=count>0</p>"
                )
              }`
            )
            // Opened after it, so it is in front
            yield* context.newPage
            yield* context.newPage
            // Frames are drawn for it, and it takes input, with no activate
            const frame = yield* behind.evaluateInMainWorld(() =>
              new Promise<boolean>((resolve) => requestAnimationFrame(() => resolve(true)))
            )
            assert.isTrue(frame)
            yield* behind.getByRole("button", { name: "Increment" }).click()
            assert.strictEqual(yield* behind.locator("#count").readText, "1")
          })).pipe(Effect.provide(recording(created)))
          assert.deepStrictEqual(created.map((params) => params.newWindow), [undefined, undefined, undefined])
        }),
      { timeout: 60_000 }
    )
  })
})
