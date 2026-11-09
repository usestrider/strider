/** Native timing rules, through every backend's public API. */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, NetworkRequest, NetworkResponse } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as http from "node:http"
import { supports } from "./capabilities.ts"

const site = Effect.gen(function*() {
  let release: (() => void) | undefined
  const server = http.createServer((request, response) => {
    if (request.url === "/fail") {
      request.socket.destroy()
    } else if (request.url === "/redirect") {
      response.writeHead(302, { location: "/stream" })
      response.end()
    } else if (request.url === "/stream" || request.url === "/broken") {
      response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" })
      response.write("first\n")
      release = request.url === "/broken" ? () => response.destroy() : () => response.end("last\n")
    } else if (request.url === "/cache") {
      response.writeHead(200, { "content-type": "text/plain", "cache-control": "max-age=3600" })
      response.end("cached")
    } else response.end("<title>timing</title>")
  })
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      server.closeAllConnections()
      server.close()
    })
  )
  yield* Effect.promise(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)))
  const address = server.address()
  assert(address !== null && typeof address !== "string")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    release: () => {
      assert(release !== undefined)
      release()
    }
  }
})

export const requestTiming = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} request timings`, () => {
    layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
      it.effect(
        "keeps redirect hops separate and publishes body end only after streamed completion",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const context = yield* Browser.newContext({ requestTiming: true })
            const page = yield* context.newPage
            yield* page.goto(served.origin)
            const redirected = yield* NetworkRequest.next(page, { url: `${served.origin}/redirect` })
            const sent = yield* NetworkRequest.next(page, { url: `${served.origin}/stream` })
            const headers = yield* NetworkResponse.next(page, { url: `${served.origin}/stream` })
            const full = yield* NetworkResponse.next(page, {
              url: `${served.origin}/stream`,
              body: (body) => body.text
            })
            const fetched = yield* page.evaluateInMainWorld(async () => (await fetch("/redirect")).text()).pipe(
              Effect.forkScoped
            )
            const first = yield* redirected
            const last = yield* sent
            yield* headers
            const before = yield* NetworkRequest.timing(page, last)
            assert.isTrue(Option.isSome(before.startTime))
            assert.isTrue(Option.isSome(before.responseStart))
            assert.deepStrictEqual(before.responseEnd, Option.none())
            served.release()
            assert.strictEqual((yield* full).body, "first\nlast\n")
            assert.strictEqual(yield* Fiber.join(fetched), "first\nlast\n")
            const after = yield* NetworkRequest.timing(context, last)
            const earlier = yield* NetworkRequest.timing(page, first)
            assert.isTrue(Option.isSome(after.responseEnd))
            assert.isAtLeast(Option.getOrThrow(after.responseEnd), Option.getOrThrow(after.responseStart))
            if (yield* supports("network.timing.redirect")) {
              assert.isTrue(Option.isSome(earlier.responseEnd))
              assert.isAtMost(Option.getOrThrow(earlier.startTime), Option.getOrThrow(after.startTime))
            } else {
              assert.deepStrictEqual(earlier.startTime, Option.none())
              assert.deepStrictEqual(earlier.responseEnd, Option.none())
            }
            assert.notStrictEqual(first.hop, last.hop)
            assert.deepStrictEqual(before.responseEnd, Option.none())
            assert.deepStrictEqual(after.secureConnectionStart, Option.none())
          }).pipe(Effect.scoped),
        60_000
      )

      it.effect(
        "preserves header phases after a broken body and refuses disabled contexts",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const context = yield* Browser.newContext({ requestTiming: true })
            const page = yield* context.newPage
            yield* page.goto(served.origin)
            const sent = yield* NetworkRequest.next(page, { url: `${served.origin}/broken` })
            const headers = yield* NetworkResponse.next(page, { url: `${served.origin}/broken` })
            const fetched = yield* page.evaluateInMainWorld(async () => {
              try {
                await (await fetch("/broken")).text()
                return "success"
              } catch {
                return "failed"
              }
            }).pipe(Effect.forkScoped)
            const request = yield* sent
            yield* headers
            const before = yield* NetworkRequest.timing(page, request)
            assert.isTrue(Option.isSome(before.responseStart))
            served.release()
            assert.strictEqual(yield* Fiber.join(fetched), "failed")
            const after = yield* NetworkRequest.timing(page, request)
            assert.deepStrictEqual(after.responseStart, before.responseStart)
            assert.deepStrictEqual(after.responseEnd, Option.none())
            const failed = yield* NetworkRequest.next(page, { url: `${served.origin}/fail` })
            assert.strictEqual(
              yield* page.evaluateInMainWorld(async () => {
                try {
                  await fetch("/fail")
                  return "success"
                } catch {
                  return "failed"
                }
              }),
              "failed"
            )
            const absent = yield* NetworkRequest.timing(page, yield* failed)
            assert.deepStrictEqual(absent.responseStart, Option.none())
            assert.deepStrictEqual(absent.responseEnd, Option.none())
            const off = yield* Browser.newContext()
            const other = yield* off.newPage
            const observed = yield* NetworkRequest.next(other, { url: served.origin + "/" })
            yield* other.goto(served.origin)
            const refused = yield* NetworkRequest.timing(other, yield* observed).pipe(Effect.flip)
            assert.strictEqual(refused.reason.why, "timingNotEnabled")
          }).pipe(Effect.scoped),
        60_000
      )

      it.effect(
        "leaves unavailable connection phases absent on reused and cached requests",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const context = yield* Browser.newContext({ requestTiming: true })
            const page = yield* context.newPage
            yield* page.goto(served.origin)
            for (let i = 0; i < 2; i++) {
              const sent = yield* NetworkRequest.next(page, { url: `${served.origin}/cache` })
              const full = yield* NetworkResponse.next(page, {
                url: `${served.origin}/cache`,
                body: (body) => body.text
              })
              yield* page.evaluateInMainWorld(async () => (await fetch("/cache")).text())
              const response = yield* full
              const timing = yield* NetworkRequest.timing(page, yield* sent)
              assert.deepStrictEqual(timing.secureConnectionStart, Option.none())
              if (response.servedBy === "cache" || response.servedBy === "route") {
                assert.deepStrictEqual(timing.domainLookupStart, Option.none())
                assert.deepStrictEqual(timing.connectStart, Option.none())
              }
              // Firefox reports zero-duration reused-connection boundaries; WebKit's zeros are ambiguous.
              if (Option.isSome(timing.connectStart) && Option.isSome(timing.connectEnd)) {
                assert.isAtLeast(timing.connectEnd.value, timing.connectStart.value)
              }
            }
          }).pipe(Effect.scoped),
        60_000
      )
    })
  })
