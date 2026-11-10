/** Bounded live-page acknowledgement probe; successful samples do not prove absence of a race. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, layer } from "@effect/vitest"
import * as BrowserCdp from "@usestrider/browser/cdp/Browser"
import * as Fetch from "@usestrider/browser/cdp/Fetch"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Runtime from "@usestrider/browser/cdp/Runtime"
import * as Target from "@usestrider/browser/cdp/Target"
import { CdpConnection, Protocol } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { assertPinned, chromium } from "../browsers.ts"
import { site } from "./harness.ts"

layer(NodeServices.layer, { excludeTestServices: true })((it) => {
  for (const control of ["unmatched", "disable", "probe"] as const) {
    it.effect(`acknowledges live-page Fetch patterns after ${control}, 40 samples`, () =>
      Effect.gen(function*() {
        const { origin } = yield* site
        const { transport } = yield* ChromiumLauncher.launch({ executablePath: chromium.executable })
        // Optional full wire evidence, outside the worktree. The fixed sample count bounds this trace.
        const destination = process.env.STRIDER_FETCH_PROBE_TRACE
        const record = (direction: string, message: string) =>
          Effect.sync(() => {
            if (destination) {
              fs.appendFileSync(
                destination,
                JSON.stringify({ control, direction, message: JSON.parse(message) }) + "\n"
              )
            }
          })
        const cdp = yield* CdpConnection.make({
          ...transport,
          send: (message) => record("send", message).pipe(Effect.andThen(transport.send(message))),
          messages: transport.messages.pipe(Stream.tap((message) => record("receive", message)))
        })
        const version = yield* BrowserCdp.getVersion().pipe(Protocol.on(cdp.browser))
        assertPinned("Chromium", version.product.split("/")[1]!, chromium.version)
        const { targetId } = yield* Target.createTarget({ url: "about:blank" }).pipe(Protocol.on(cdp.browser))
        const { sessionId } = yield* Target.attachToTarget({ targetId, flatten: true }).pipe(Protocol.on(cdp.browser))
        const session = yield* cdp.session(sessionId)
        const on = Protocol.on(session)
        yield* Page.enable().pipe(on)
        const loaded = yield* session.subscribe(Page.loadEventFired)
        const loading = yield* loaded.pipe(Stream.runHead, Effect.forkChild)
        yield* Page.navigate({ url: `${origin}/hello` }).pipe(on)
        yield* Fiber.join(loading)
        const paused: Array<string> = []
        const events = yield* session.subscribe(Fetch.requestPaused)
        yield* events.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function*() {
              paused.push(event.request.url)
              yield* Fetch.fulfillRequest({
                requestId: event.requestId,
                responseCode: 200,
                responseHeaders: [{ name: "Content-Type", value: "text/plain" }],
                body: "cm91dGVk"
              }).pipe(on)
            })
          ),
          Effect.forkChild
        )
        // Run on an already executing document, not a target still waiting for debugger resume.
        yield* Runtime.evaluate({ expression: "document.readyState", returnByValue: true }).pipe(on)
        const activationMs: Array<number> = []
        for (let n = 0; n < 40; n++) {
          if (control === "unmatched") {
            yield* Fetch.enable({ patterns: [{ urlPattern: "strider-intercepts-nothing:" }] }).pipe(on)
          } else {
            yield* Fetch.disable().pipe(on)
          }
          const url = `${origin}/json?ack=${n}`
          const started = performance.now()
          yield* Fetch.enable({ patterns: [{ urlPattern: `${origin}/json*`, requestStage: "Request" }] }).pipe(on)
          if (control === "probe") {
            // A synthetic request on this document's factory, fulfilled before reaching the server.
            // Still visible to Network observers: production isolation would require explicit filtering.
            const probe = yield* Runtime.evaluate({
              expression: `fetch(${
                JSON.stringify(`${origin}/json?activation-probe=${n}`)
              }, { cache: 'no-store' }).then(r => r.text())`,
              awaitPromise: true,
              returnByValue: true
            }).pipe(on)
            assert.isUndefined(probe.exceptionDetails)
            assert.strictEqual(probe.result.value, "routed")
            assert.strictEqual(paused[paused.length - 1], `${origin}/json?activation-probe=${n}`)
            activationMs.push(performance.now() - started)
          }
          // No sleep or extra protocol barrier between enable's reply and the request.
          const result = yield* Runtime.evaluate({
            expression: `fetch(${JSON.stringify(url)}, { cache: 'no-store' }).then(r => r.text())`,
            awaitPromise: true,
            returnByValue: true
          }).pipe(on)
          assert.isUndefined(result.exceptionDetails)
          assert.strictEqual(result.result.value, "routed", `${control} sample ${n}`)
          assert.strictEqual(paused[paused.length - 1], url)
        }
        assert.lengthOf(paused, control === "probe" ? 80 : 40)
        if (control === "probe") {
          process.stdout.write(`activation-probe-ms ${JSON.stringify(activationMs)}\n`)
        }
      }), 60_000)
  }
})
