/** A prerender must activate through the public Chromium layer, without an external target client. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Deadline } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { createServer } from "node:http"
import { assertPinned, chromium } from "../browsers.ts"

const serve = Effect.acquireRelease(
  Effect.promise(async () => {
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html")
      response.end(
        request.url === "/start"
          ? `<script>
            const rules = document.createElement('script'); rules.type = 'speculationrules';
            rules.textContent = JSON.stringify({prerender:[{source:'list',urls:['/prerendered']}]});
            document.head.append(rules);
            setTimeout(() => { location.href = '/prerendered' }, 1500);
          </script>`
          : "<title>prerendered</title>"
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve))
    return { server, origin: `http://localhost:${(server.address() as { port: number }).port}` }
  }),
  ({ server }) =>
    Effect.promise(() =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
    )
)

const backend = Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer))

describe("Chromium public prerender activation", () => {
  layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
    it.effect("activates in the original public tab", () =>
      Effect.scoped(Effect.gen(function*() {
        assertPinned("Chromium", (yield* Browser.Browser).info.version, chromium.version)
        const { origin } = yield* serve
        const page = yield* Browser.newPage()
        yield* page.goto(`${origin}/start`)
        yield* page.status.waitFor((status) =>
          status._tag === "Open" && status.url === `${origin}/prerendered` && status.document.readiness === "complete"
        ).pipe(Deadline.within("10 seconds"))
        const activationStart = yield* page.evaluateInMainWorld(() =>
          (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming & { activationStart: number })
            .activationStart
        )
        assert.isAbove(activationStart, 0, "the public path must activate its prerender")
      })))
  })
})
