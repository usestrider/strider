/** Chromium's definitive sent headers, including a response held by a route handler. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Deadline, NetworkRequest, Route } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
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
        const observed = yield* Deferred.make<Option.Option<Deadline.Timeout>>()
        const request = yield* NetworkRequest.next(page, { url: `${origin}/json` })
        yield* page.route(`${origin}/json`, ({ request }) =>
          Effect.gen(function*() {
            const timeout = yield* NetworkRequest.headersSent(page, request).pipe(
              Deadline.within("100 millis"),
              Effect.match({ onFailure: Option.some, onSuccess: () => Option.none() })
            )
            yield* Deferred.succeed(observed, timeout)
            return yield* Route.continue
          }), { phase: "response" })
        const response = yield* page.evaluateInMainWorld(async () => (await fetch("/json")).status)
        assert.strictEqual(response, 200)
        const timeout = Option.getOrThrow(yield* Deferred.await(observed))
        assert(Deadline.isTimeout(timeout))
        assert.strictEqual(timeout.phase, "waitingForEvent")
        // Once the handler has allowed the response through, attribution can settle with the network headers.
        const sent = yield* NetworkRequest.headersSent(page, yield* request).pipe(Deadline.within("1 second"))
        assert.strictEqual(sent.host, new URL(origin).host)
      })))

    it.effect("settles an outstanding headersSent when its page closes", () =>
      Effect.scoped(Effect.gen(function*() {
        const { origin } = yield* site
        const page = yield* Browser.newPage()
        yield* page.goto(`${origin}/hello`)
        const paused = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const next = yield* NetworkRequest.next(page, { url: `${origin}/json` })
        yield* page.route(`${origin}/json`, () =>
          Effect.gen(function*() {
            yield* Deferred.succeed(paused, undefined)
            yield* Deferred.await(release)
            return yield* Route.continue
          }), { phase: "response" })
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        yield* page.evaluateInMainWorld(() => {
          void fetch("/json").catch(() => {})
          return true
        })
        yield* Deferred.await(paused)
        const request = yield* next
        const waiting = yield* NetworkRequest.headersSent(page, request).pipe(
          Deadline.within("10 seconds"),
          Effect.forkScoped
        )
        yield* Effect.yieldNow
        assert.isUndefined(waiting.pollUnsafe())
        yield* page.close()
        const sent = yield* Fiber.join(waiting).pipe(Deadline.within("1 second"))
        assert.deepStrictEqual(sent, request.headers)
      })))
  })
})
