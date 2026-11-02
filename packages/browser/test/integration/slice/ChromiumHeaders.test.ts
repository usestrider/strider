/** Chromium's definitive sent headers, including a response held by a route handler. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Deadline, NetworkRequest, Route } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import { site } from "../adapter/harness.ts"
import { assertPinned, chromium } from "../browsers.ts"

const backend = Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer))

describe("Chromium sent-header waiting", () => {
  layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
    it.effect("reaches the deadline when a response handler awaits headers before continuing that response", () =>
      Effect.scoped(Effect.gen(function*() {
        const info = (yield* Browser.Browser).info
        assertPinned("Chromium", info.version, chromium.version)
        const { origin } = yield* site
        const page = yield* Browser.newPage()
        yield* page.goto(`${origin}/hello`)
        const observed = yield* Deferred.make<Deadline.Timeout>()
        const request = yield* NetworkRequest.next(page, { url: `${origin}/json` })
        yield* page.route(`${origin}/json`, ({ request }) =>
          Effect.gen(function*() {
            const timeout = yield* NetworkRequest.headersSent(page, request).pipe(
              Deadline.within("100 millis"),
              Effect.flip
            )
            assert(Deadline.isTimeout(timeout))
            assert.strictEqual(timeout.phase, "waitingForEvent")
            yield* Deferred.succeed(observed, timeout)
            return Route.continue
          }), { phase: "response" })
        const response = yield* page.evaluateInMainWorld(async () => (await fetch("/json")).status)
        assert.strictEqual(response, 200)
        yield* Deferred.await(observed)
        // Once the handler has allowed the response through, attribution can settle with the network headers.
        const sent = yield* NetworkRequest.headersSent(page, yield* request).pipe(Deadline.within("1 second"))
        assert.strictEqual(sent.host, new URL(origin).host)
      })))

    it.effect("settles an outstanding headersSent when its page closes", () =>
      Effect.scoped(Effect.gen(function*() {
        const { origin } = yield* site
        const page = yield* Browser.newPage()
        yield* page.goto(`${origin}/hello`)
        const paused = yield* Deferred.make<NetworkRequest.NetworkRequest>()
        const release = yield* Deferred.make<void>()
        yield* page.route(`${origin}/json`, ({ request }) =>
          Effect.gen(function*() {
            yield* Deferred.succeed(paused, request)
            yield* Deferred.await(release)
            return Route.continue
          }), { phase: "response" })
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        yield* page.evaluateInMainWorld(() => {
          void fetch("/json").catch(() => {})
          return true
        })
        const request = yield* Deferred.await(paused)
        const waiting = yield* NetworkRequest.headersSent(page, request).pipe(
          Deadline.within("10 seconds"),
          Effect.forkScoped
        )
        yield* page.close()
        const sent = yield* Fiber.join(waiting).pipe(Deadline.within("1 second"))
        assert.deepStrictEqual(sent, request.headers)
      })))
  })
})
