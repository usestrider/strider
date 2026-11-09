/** Native timing rules, through every backend's public API. */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, NetworkRequest, NetworkResponse } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as http from "node:http"
import { supports } from "./capabilities.ts"

const timingFields = [
  "startTime",
  "domainLookupStart",
  "domainLookupEnd",
  "connectStart",
  "connectEnd",
  "secureConnectionStart",
  "requestStart",
  "responseStart",
  "responseEnd"
] as const

const site = Effect.gen(function*() {
  const hits = new Map<string, number>()
  let release: (() => void) | undefined
  const server = http.createServer((request, response) => {
    hits.set(request.url ?? "/", (hits.get(request.url ?? "/") ?? 0) + 1)
    if (request.url === "/cached-redirect") {
      response.writeHead(301, { location: "/cache", "cache-control": "max-age=3600" })
      response.end()
    } else if (request.url === "/fail") {
      request.socket.destroy()
    } else if (request.url === "/redirect") {
      response.writeHead(302, { location: "/stream" })
      response.end()
    } else if (request.url === "/stream" || request.url === "/broken") {
      response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" })
      response.write("first\n")
      release = request.url === "/broken" ? () => response.destroy() : () => response.end("last\n")
    } else if (request.url === "/cache-script") {
      response.writeHead(200, { "content-type": "text/javascript", "cache-control": "public, max-age=3600" })
      response.end("globalThis.cacheLoads = (globalThis.cacheLoads || 0) + 1")
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
    hits: (path: string) => hits.get(path) ?? 0,
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
        "checks timing observations for server-counted cache reuse without waiting for omitted events",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const context = yield* Browser.newContext({ requestTiming: true })
            const page = yield* context.newPage
            yield* page.goto(served.origin)
            const firstResponse = yield* NetworkResponse.next(page, { url: `${served.origin}/cache-script` })
            let first: NetworkRequest.Timing | undefined
            let firstHop: NetworkRequest.HopId | undefined
            for (let i = 0; i < 2; i++) {
              const loads = yield* page.evaluateInMainWorld(async () => {
                await new Promise<void>((resolve, reject) => {
                  const script = document.createElement("script")
                  script.src = "/cache-script"
                  script.onload = () => resolve()
                  script.onerror = () => reject(new Error("script failed"))
                  document.head.append(script)
                })
                return (globalThis as typeof globalThis & { cacheLoads: number }).cacheLoads
              })
              if (i === 0) yield* firstResponse
              assert.strictEqual(loads, i + 1)
              assert.strictEqual(served.hits("/cache-script"), 1, "both loads use one server response")
              // Memory-cache reuse can omit the second request entirely. Read the retained observations,
              // rather than subscribing to an event which the browser may never send.
              const requests = yield* NetworkRequest.history(page, { url: `${served.origin}/cache-script` })
              const responses = yield* NetworkResponse.history(page, { url: `${served.origin}/cache-script` })
              assert.strictEqual(requests.dropped, 0)
              assert.isAtLeast(requests.entries.length, 1)
              assert.isAtMost(requests.entries.length, i + 1)
              for (const request of requests.entries) {
                const timing = yield* NetworkRequest.timing(page, request)
                const response = responses.entries.find((response) => response.hop === request.hop)
                assert.deepStrictEqual(timing.secureConnectionStart, Option.none())
                for (const field of timingFields) {
                  const value = timing[field]
                  if (Option.isSome(value)) {
                    assert.isTrue(Number.isFinite(value.value), field)
                    assert.isAtLeast(value.value, 0, field)
                    if (field !== "startTime") assert.isTrue(Option.isSome(timing.startTime), field)
                  }
                }
                if (Option.isSome(timing.connectStart) && Option.isSome(timing.connectEnd)) {
                  assert.isAtLeast(timing.connectEnd.value, timing.connectStart.value)
                }
                if (Option.isSome(timing.responseStart) && Option.isSome(timing.responseEnd)) {
                  assert.isAtLeast(timing.responseEnd.value, timing.responseStart.value)
                }
                if (response?.servedBy === "cache") {
                  assert.isTrue(
                    timingFields.every((field) => Option.isNone(timing[field])),
                    "ordinary Chromium cache phases are unavailable"
                  )
                }
                if (i === 0) {
                  assert.isTrue(Option.isSome(timing.startTime), "the first network load has a native origin")
                  first = timing
                  firstHop = request.hop
                } else if (request.hop !== firstHop && Option.isSome(timing.startTime)) {
                  assert.isAbove(
                    timing.startTime.value,
                    Option.getOrThrow(first!.startTime),
                    "cache access has its own origin"
                  )
                }
              }
            }
          }).pipe(Effect.scoped),
        60_000
      )

      if (name === "Chromium") {
        it.effect(
          "observes a server-counted cached permanent redirect",
          () =>
            Effect.gen(function*() {
              const served = yield* site
              const context = yield* Browser.newContext({ requestTiming: true })
              const page = yield* context.newPage
              yield* page.goto(served.origin)
              let previous: NetworkRequest.Timing | undefined
              for (let i = 0; i < 2; i++) {
                const sent = yield* NetworkRequest.next(page, { url: `${served.origin}/cached-redirect` })
                const full = yield* NetworkResponse.next(page, {
                  url: `${served.origin}/cache`,
                  body: (body) => body.text
                })
                assert.strictEqual(
                  yield* page.evaluateInMainWorld(async () => (await fetch("/cached-redirect")).text()),
                  "cached"
                )
                yield* full
                const timing = yield* NetworkRequest.timing(page, yield* sent)
                assert.strictEqual(served.hits("/cached-redirect"), 1)
                assert.strictEqual(served.hits("/cache"), 1)
                const start = Option.getOrThrow(timing.startTime)
                const sending = Option.getOrThrow(timing.requestStart)
                const headers = Option.getOrThrow(timing.responseStart)
                const end = Option.getOrThrow(timing.responseEnd)
                assert.isAtLeast(sending, 0)
                assert.isAtLeast(headers, sending)
                assert.isAtLeast(end, headers)
                if (previous !== undefined) {
                  assert.deepStrictEqual(timing.domainLookupStart, Option.none())
                  assert.deepStrictEqual(timing.connectStart, Option.none())
                  assert.isAbove(
                    start,
                    Option.getOrThrow(previous.startTime) + Option.getOrThrow(previous.responseEnd),
                    "the cached redirect uses a fresh origin after the first redirect completed"
                  )
                }
                previous = timing
              }
            }).pipe(Effect.scoped),
          60_000
        )
      }
    })
  })
