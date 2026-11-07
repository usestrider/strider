/** A prerender must activate through the public Chromium layer, without an external target client. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Deadline, Route } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import { createServer } from "node:http"
import { assertPinned, chromium } from "../browsers.ts"

const serve = Effect.acquireRelease(
  Effect.promise(async () => {
    const requests: Array<{ url: string | undefined; purpose: string | undefined; header: string | undefined }> = []
    const server = createServer((request, response) => {
      requests.push({
        url: request.url,
        purpose: typeof request.headers["sec-purpose"] === "string" ? request.headers["sec-purpose"] : undefined,
        header: typeof request.headers["x-speculative"] === "string" ? request.headers["x-speculative"] : undefined
      })
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
    return { server, requests, origin: `http://localhost:${(server.address() as { port: number }).port}` }
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
    it.effect("routes the speculative document and sends its configured headers before navigation", () =>
      Effect.scoped(Effect.gen(function*() {
        const { origin, requests } = yield* serve
        const page = yield* Browser.newPage()
        yield* page.goto(`${origin}/idle`)
        const intercepted = yield* Deferred.make<void>()
        yield* page.context.route(
          `${origin}/speculative`,
          () =>
            Deferred.succeed(intercepted, undefined).pipe(
              Effect.andThen(Route.continueWith(HttpClientRequest.setHeader("x-speculative", "declared")))
            )
        )
        yield* page.evaluateInMainWorld(() => {
          const rules = document.createElement("script")
          rules.type = "speculationrules"
          rules.textContent = JSON.stringify({ prerender: [{ source: "list", urls: ["/speculative"] }] })
          document.head.append(rules)
        })
        yield* Deferred.await(intercepted).pipe(Deadline.within("10 seconds"))
        for (let attempt = 0; attempt < 200; attempt++) {
          const speculative = requests.find((request) => request.url === "/speculative")
          if (speculative !== undefined) {
            assert.include(speculative.purpose, "prerender")
            assert.strictEqual(speculative.header, "declared")
            assert.strictEqual(yield* page.url, `${origin}/idle`, "no activating navigation has been issued")
            return
          }
          yield* Effect.sleep("50 millis")
        }
        assert.fail("the speculative request did not reach the server within 10 seconds")
      })))

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
