import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Route } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import { createServer } from "node:http"
import * as Handles from "../../../src/internal/handles.ts"
import * as Operation from "../../../src/internal/operation.ts"
import { assertPinned, chromium } from "../browsers.ts"

const serve = Effect.acquireRelease(
  Effect.promise(async () => {
    const requests: Array<
      { url: string | undefined; purpose: string | undefined; header: string | undefined; extra: string | undefined }
    > = []
    const server = createServer((request, response) => {
      requests.push({
        url: request.url,
        purpose: typeof request.headers["sec-purpose"] === "string" ? request.headers["sec-purpose"] : undefined,
        header: typeof request.headers["x-speculative"] === "string" ? request.headers["x-speculative"] : undefined,
        extra: typeof request.headers["x-extra"] === "string" ? request.headers["x-extra"] : undefined
      })
      response.setHeader("Content-Type", "text/html")
      response.end("<title>idle</title>")
    })
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve))
    return {
      server,
      requests,
      origin: `http://localhost:${(server.address() as { port: number }).port}`
    }
  }),
  ({ server }) =>
    Effect.promise(() =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
    )
)

describe("Chromium speculative prefetch rules", () => {
  for (
    const args of [[], ["--disable-features=Other"], ["--disable-features"], [
      "--disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,AutofillServerCommunication,PrefetchPrerenderIntegration,Prerender2FallbackPrefetchSpecRules"
    ]]
  ) {
    const backend = Chromium.layer({ executablePath: chromium.executable, args }).pipe(
      Layer.provide(NodeServices.layer)
    )
    layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
      it.effect(
        `routes speculative prefetch with ${args.join(" ") || "default features"}`,
        () =>
          Effect.scoped(Effect.gen(function*() {
            assertPinned("Chromium", (yield* Browser.Browser).info.version, chromium.version)
            const { origin, requests } = yield* serve
            const page = yield* Browser.newPage()
            yield* page.goto(`${origin}/idle`)
            // ExtraHeaders is an L1 declaration; the public launch and routes use the same supported adapter.
            yield* Handles.page(page).runtime.model.adapter.declare(
              { _tag: "UserContext", context: page.context.id },
              { _tag: "Override", override: { _tag: "ExtraHeaders", headers: { "x-extra": "configured" } } }
            ).pipe(Operation.named("Test.speculativeHeaders"))
            const intercepted = yield* Deferred.make<void>()
            const tabIntercepted = yield* Deferred.make<void>()
            yield* page.route(`${origin}/speculative`, () =>
              Deferred.succeed(tabIntercepted, undefined).pipe(Effect.andThen(Route.fallthrough)))
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
              rules.textContent = JSON.stringify({ prefetch: [{ source: "list", urls: ["/speculative"] }] })
              document.head.append(rules)
            })
            for (let attempt = 0; attempt < 200; attempt++) {
              const speculative = requests.find((request) =>
                request.url === "/speculative"
              )
              if (speculative !== undefined) {
                assert.include(speculative.purpose, "prefetch")
                assert.strictEqual(yield* page.url, `${origin}/idle`, "no activating navigation has been issued")
                assert.deepStrictEqual({
                  contextRoute: yield* Deferred.isDone(intercepted),
                  pageRoute: yield* Deferred.isDone(tabIntercepted),
                  request: speculative
                }, {
                  contextRoute: true,
                  pageRoute: true,
                  request: {
                    url: "/speculative",
                    purpose: speculative.purpose,
                    header: "declared",
                    extra: "configured"
                  }
                })
                return
              }
              yield* Effect.sleep("50 millis")
            }
            assert.strictEqual(yield* page.url, `${origin}/idle`, "no activating navigation has been issued")
            assert.fail(
              `the speculative request did not reach the server within 10 seconds; requests=${
                JSON.stringify(requests)
              }; contextRoute=${yield* Deferred.isDone(intercepted)}; pageRoute=${yield* Deferred.isDone(
                tabIntercepted
              )}`
            )
          })),
        60_000
      )
    })
  }
})
