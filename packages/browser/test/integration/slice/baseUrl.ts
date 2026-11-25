/**
 * A context's `baseURL`, through every backend's public API: one context per backend, created with a base, whose
 * cases share it. The rule: what its pages are given relative, a URL to navigate to or a pattern to match, resolves
 * against the base. A case samples each kind of input: `goto`, a route, a WebSocket route, and an event filter.
 */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, NetworkRequest, Route, type UserContext } from "@usestrider/browser"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Layer from "effect/Layer"
import { site } from "../adapter/harness.ts"

const timeout = 60_000

class Based extends Context.Service<Based, {
  readonly origin: string
  readonly context: UserContext.UserContext
}>()("slice/baseUrl/Based") {}

export const baseUrl = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} base URL`, () => {
    const based = Layer.effect(Based)(Effect.gen(function*() {
      const { origin } = yield* site
      const context = yield* Browser.newContext({ baseURL: `${origin}/app/index.html` })
      return { origin, context }
    })).pipe(Layer.provideMerge(backend))

    layer(based, { excludeTestServices: true, timeout })((it) => {
      it.effect("navigates to a relative URL against the base", () =>
        Effect.gen(function*() {
          const { context, origin } = yield* Based
          const page = yield* context.newPage
          yield* page.goto("/top")
          assert.strictEqual(yield* page.url, `${origin}/top`)
          yield* page.goto("nested")
          assert.strictEqual(yield* page.evaluateInMainWorld(() => document.title), "/app/nested")
        }).pipe(Effect.scoped), timeout)

      it.effect("routes requests by a relative pattern", () =>
        Effect.gen(function*() {
          const { context } = yield* Based
          const page = yield* context.newPage
          yield* page.route("/api/**", () =>
            Route.fulfill(HttpServerResponse.text("<title>routed</title>", { contentType: "text/html" })))
          yield* page.goto("/api/items")
          assert.strictEqual(yield* page.evaluateInMainWorld(() => document.title), "routed")
        }).pipe(Effect.scoped), timeout)

      it.effect("routes a WebSocket by a relative pattern, with the base's scheme made ws:", () =>
        Effect.gen(function*() {
          const { context } = yield* Based
          const page = yield* context.newPage
          yield* page.goto("/socket-page")
          yield* context.routeWebSocket(
            "/socket",
            (connection) =>
              connection.open({ fromPage: (_, endpoint) => endpoint.send({ _tag: "Text", data: "routed" }) }),
            { implementation: "script", timing: "bestEffort" }
          )
          const reply = yield* page.evaluateInMainWorld(() =>
            new Promise<string>((resolve) => {
              const socket = new WebSocket(`${location.origin.replace("http:", "ws:")}/socket`)
              socket.onopen = () => socket.send("ping")
              socket.onmessage = (event) => {
                resolve(String(event.data))
                socket.close()
              }
              socket.onerror = () => resolve("socket error")
              setTimeout(() => resolve("no reply"), 5_000)
            })
          )
          assert.strictEqual(reply, "routed")
        }).pipe(Effect.scoped), timeout)

      it.effect("filters events by a relative URL pattern", () =>
        Effect.gen(function*() {
          const { context, origin } = yield* Based
          const page = yield* context.newPage
          const request = yield* NetworkRequest.next(page, { url: "/app/:file" })
          yield* page.goto("asset")
          assert.strictEqual((yield* request).url, `${origin}/app/asset`)
        }).pipe(Effect.scoped), timeout)
    })
  })
