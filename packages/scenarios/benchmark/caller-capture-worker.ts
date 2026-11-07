import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, Deadline } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as assert from "node:assert/strict"
import * as os from "node:os"
import * as BrowserImpl from "../../browser/src/internal/browser.ts"
import * as CdpAdapter from "../../browser/src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../browser/src/internal/chromiumLauncher.ts"
import browsers from "../../browser/test/integration/browsers.json" with { type: "json" }
import { start } from "../src/site.ts"

const executablePath = process.env["STRIDER_CHROMIUM"]
assert.equal(process.env["STRIDER_ENVIRONMENT"], "nix-integration")
assert.ok(executablePath)
const layer = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
  const { transport } = yield* ChromiumLauncher.launch({ executablePath })
  return yield* CdpAdapter.connect(transport, { sink, ownership: "launched" })
})).pipe(Layer.provideMerge(NodeServices.layer))
const site = await start()
interface Request {
  action: "url" | "title" | "count" | "click" | "stop"
  calls: number
}
// IPC requests are strictly sequential. Install the listener before announcing readiness.
let receive: ((request: Request) => void) | undefined
process.on("message", (request: Request) => receive!(request))
try {
  await Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      assert.equal(process.env["STRIDER_CAPTURE_LOADED"], process.argv[3])
      const browser = yield* Browser.Browser
      assert.equal(browser.info.version, browsers.chromium.version)
      const page = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
      yield* page.goto(`${site.origin}/benchmark`, { waitUntil: "load" })
      const button = page.getByRole("button", { name: "Increment" })
      const count = page.locator("#count")
      let clicks = 0
      let ready = false
      while (true) {
        const waiting = new Promise<Request>((resolve) => {
          receive = resolve
        })
        if (!ready) {
          process.send!({
            node: process.version,
            v8: process.versions.v8,
            chromium: browser.info.version,
            cpu: os.cpus()[0]?.model,
            platform: `${os.platform()} ${os.release()} ${os.arch()}`,
            loadedMode: process.env["STRIDER_CAPTURE_LOADED"],
            stackTraceLimit: Error.stackTraceLimit
          })
        }
        ready = true
        // Only the first request has no preceding action; subsequent readiness comes from the result below.
        const request = yield* Effect.promise(() => waiting)
        if (request.action === "stop") break
        const timings: Array<number> = []
        for (let i = 0; i < request.calls; i++) {
          const started = performance.now()
          // Construct a fresh operation inside the timer, including getter construction.
          if (request.action === "url") {
            assert.equal(yield* page.url, `${site.origin}/benchmark`)
          } else if (request.action === "title") {
            assert.equal(yield* page.title, "Benchmark")
          } else if (request.action === "count") {
            assert.equal(yield* count.count, 1)
          } else {
            yield* button.click()
          }
          timings.push(performance.now() - started)
        }
        if (request.action === "click") {
          clicks += request.calls
          assert.equal(yield* count.readText, String(clicks))
        }
        process.send!({ timings })
      }
    })).pipe(Deadline.within("20 minutes"), Effect.provide(layer))
  )
} finally {
  await site.close()
  process.disconnect!()
}
