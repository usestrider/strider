import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Runtime from "@usestrider/browser/cdp/Runtime"
import * as Target from "@usestrider/browser/cdp/Target"
import { CdpConnection, Protocol } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { createServer } from "node:http"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { chromium } from "../browsers.ts"

const page = (origin: string) => `<title>self</title><script>
  window.token = crypto.randomUUID();
  const s = document.createElement('script'); s.type = 'speculationrules';
  s.textContent = JSON.stringify({prerender:[{source:'list',urls:['${origin}/prerendered']}]});
  document.head.append(s);
  setTimeout(() => { location.href = '${origin}/prerendered' }, 2000);
</script>`

describe("review", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })((it) => {
    it.effect("no client attached, then back", () =>
      Effect.gen(function*() {
        const server = createServer((request, response) => {
          response.setHeader("Content-Type", "text/html")
          const port = (server.address() as { port: number }).port
          if (request.url === "/start") response.end(page(`http://localhost:${port}`))
          else response.end(`<script>window.token = crypto.randomUUID(); addEventListener('pageshow', e => window.restored = e.persisted)</script>`)
        })
        yield* Effect.promise(() => new Promise<void>((r) => server.listen(0, "0.0.0.0", r)))
        yield* Effect.addFinalizer(() => Effect.sync(() => { server.closeAllConnections(); server.close() }))
        const port = (server.address() as { port: number }).port
        const origin = `http://localhost:${port}`
        const { transport } = yield* ChromiumLauncher.launchWithPort({ executablePath: chromium.executable, args: ["--site-per-process"] })
        const driver = yield* CdpConnection.make(transport)
        const targets = Target.getTargets({ filter: [{ exclude: false }] }).pipe(Protocol.on(driver.browser), Effect.map((r) => r.targetInfos))
        const { targetId } = yield* Target.createTarget({ url: `${origin}/start` }).pipe(Protocol.on(driver.browser))
        let tabId: string | undefined
        for (let i = 0; i < 40 && !tabId; i++) {
          tabId = (yield* targets).find((t) => t.type === "tab" && t.url === `${origin}/start`)?.targetId
          if (!tabId) yield* Effect.sleep("50 millis")
        }
        let after: ReadonlyArray<Target.TargetInfo> = []
        for (let i = 0; i < 200; i++) {
          after = yield* targets
          if (after.some((t) => t.type === "page" && t.url === `${origin}/prerendered`)) break
          yield* Effect.sleep("50 millis")
        }
        const current = after.find((t) => t.type === "page" && t.url === `${origin}/prerendered`)!
        const attach = (id: string) => Effect.gen(function*() {
          const { sessionId } = yield* Target.attachToTarget({ targetId: id as Target.TargetID, flatten: true }).pipe(Protocol.on(driver.browser))
          return yield* driver.session(sessionId)
        })
        const ev = (s: Protocol.ProtocolSession, expression: string) => Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true }).pipe(Protocol.on(s), Effect.map((r) => r.result.value))
        let session = yield* attach(current.targetId)
        const activationStart = yield* ev(session, "performance.getEntriesByType('navigation')[0].activationStart")
        console.log("REVIEW unattached", JSON.stringify({ original: targetId, current: current.targetId, activationStart, originalListed: after.some((t) => t.targetId === targetId), tabKept: after.some((t) => t.targetId === tabId) }))
        yield* Target.detachFromTarget({ sessionId: session.sessionId }).pipe(Protocol.on(driver.browser), Effect.ignore)
        // Back from the activated page: which page target shows the tab now?
        session = yield* attach(current.targetId)
        yield* ev(session, "history.back()").pipe(Effect.ignore)
        let back: ReadonlyArray<Target.TargetInfo> = []
        for (let i = 0; i < 100; i++) {
          back = yield* targets
          if (back.some((t) => t.type === "page" && t.url === `${origin}/start`)) break
          yield* Effect.sleep("50 millis")
        }
        const backPage = back.find((t) => t.type === "page" && t.url === `${origin}/start`)
        console.log("REVIEW back", JSON.stringify({ original: targetId, activated: current.targetId, backPage: backPage?.targetId, tabKept: back.some((t) => t.targetId === tabId), pages: back.filter((t) => t.type === "page").map((t) => [t.targetId, t.url]) }))
        assert.isDefined(tabId)
      }), 60_000)
  })
})
