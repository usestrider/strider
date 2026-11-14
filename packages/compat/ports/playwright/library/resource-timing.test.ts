/**
 * Playwright's `tests/library/resource-timing.spec.ts`: the timing a request reports (its connection, request, and
 * response phases), for a document, a subresource, an HTTPS document, a redirect, and a response from the memory cache.
 *
 * What the port changes:
 * - `request.timing()` is `NetworkRequest.timing`, which needs a context created with `requestTiming: true`. Each test
 *   makes its own context and page, so every test runs with `page: false`.
 * - Playwright's phases are numbers, with `-1` for a phase that doesn't apply. Strider's are `Option`s, `None` where a
 *   phase is unavailable. `known` asserts a phase is there where the original compares it, and a phase with no value
 *   on the right-hand side imposes nothing, as Playwright's `-1` does.
 * - `verifyTimingValue` calls Playwright's `expect` with no matcher, so the original checks nothing. The port checks
 *   what the helper says: each phase is absent or not negative (a phase can start at the request's own baseline, so a
 *   zero is legitimate), and not before the phase it follows.
 * - `page.waitForEvent('requestfinished')` and `page.on('requestfinished')` are `NetworkRequest.next` and the page's
 *   request history. The history leaves out the browser's own `/favicon.ico` request, as the page-request ports do.
 * - `page.goto` and `page.reload` wait for `load`, as the original's default does, so each request has finished.
 * - `response.finished()` is a response's body read to its end. NE-134 waits for each hop's response with
 *   `NetworkRequest.response`, which gives the response once its headers have arrived.
 * - NE-135 fails on Chromium: for a response served from the memory cache Chromium reports no timing, and Strider leaves
 *   every phase, `startTime` included, unavailable (`NetworkRequest.Timing`: "cache responses ... can leave phases
 *   unavailable"). Playwright reports -1 for the phases and backfills `responseStart` and `requestStart` with
 *   `responseEnd` itself, which is what the test compares. The port keeps the original's comparison.
 * - NE-133 (HTTPS with `ignoreHTTPSErrors`) is `acceptInsecureCerts` with the fixture server's TLS site, which Firefox and
 *   stock WebKit accept per context. Chromium refuses it, so the test is in the ledger for Chromium.
 */
import { assert } from "@effect/vitest"
import { Browser, NetworkRequest, NetworkResponse } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { upstream } from "../../harness/upstream.ts"

/** A phase Playwright compares, which Strider reports as known or unavailable. */
const known = (phase: Option.Option<number>, name: string): number => {
  assert.isTrue(Option.isSome(phase), `${name} is unavailable`)
  return Option.getOrThrow(phase)
}

/** Playwright's `expect(phase).toBeGreaterThanOrEqual(floor)`: an unavailable floor, Playwright's `-1`, imposes nothing. */
const atLeast = (phase: Option.Option<number>, name: string, floor: Option.Option<number>) => {
  const value = known(phase, name)
  if (Option.isSome(floor)) assert.isAtLeast(value, floor.value, `${name} is before its floor`)
}

/** Playwright's `expect(phase).toBeGreaterThan(floor)`, with the same unavailable floor. */
const above = (phase: Option.Option<number>, name: string, floor: Option.Option<number>) => {
  const value = known(phase, name)
  if (Option.isSome(floor)) assert.isAbove(value, floor.value, `${name} is not after its floor`)
}

/** Playwright's `expect(phase).toBeLessThan(limit)`. */
const below = (phase: Option.Option<number>, name: string, limit: number) => {
  assert.isBelow(known(phase, name), limit)
}

/** `verifyTimingValue(value, previous)`: a phase is absent or not negative, and not before the phase it follows. */
const verifyTimingValue = (value: Option.Option<number>, previous: Option.Option<number>) => {
  if (Option.isNone(value)) return
  const phase = Option.getOrThrow(value)
  assert.isAtLeast(phase, 0)
  if (Option.isSome(previous)) assert.isAtLeast(phase, previous.value)
}

/** `verifyConnectionTimingConsistency(timing)`, phase by phase, in the original's order. */
const verifyConnectionTimingConsistency = (timing: NetworkRequest.Timing) => {
  verifyTimingValue(timing.domainLookupStart, Option.none())
  verifyTimingValue(timing.domainLookupEnd, timing.domainLookupStart)
  verifyTimingValue(timing.connectStart, timing.domainLookupEnd)
  verifyTimingValue(timing.secureConnectionStart, timing.connectStart)
  verifyTimingValue(timing.connectEnd, timing.secureConnectionStart)
}

/** The page's requests, without the browser's own `/favicon.ico` request, which Playwright never reports. */
const requestsOf = Effect.fnUntraced(function*(page: Parameters<typeof NetworkRequest.history>[0]) {
  const history = yield* NetworkRequest.history(page)
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((request) => new URL(request.url).pathname !== "/favicon.ico")
})

upstream(import.meta.filename, {}, (test) => {
  test("NE-131", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ requestTiming: true })
      const page = yield* context.newPage
      const sent = yield* NetworkRequest.next(page, { url: "**/empty.html" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* sent
      const timing = yield* NetworkRequest.timing(page, request)
      verifyConnectionTimingConsistency(timing)
      atLeast(timing.requestStart, "requestStart", timing.connectEnd)
      atLeast(timing.responseStart, "responseStart", timing.requestStart)
      atLeast(timing.responseEnd, "responseEnd", timing.responseStart)
      below(timing.responseEnd, "responseEnd", 10000)
    })))

  test("NE-132", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ requestTiming: true })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const requests = yield* requestsOf(page)
      assert.strictEqual(requests.length, 2)
      const timing = yield* NetworkRequest.timing(page, requests[1]!)
      verifyConnectionTimingConsistency(timing)
      atLeast(timing.requestStart, "requestStart", Option.some(0))
      above(timing.responseStart, "responseStart", timing.requestStart)
      atLeast(timing.responseEnd, "responseEnd", timing.responseStart)
      below(timing.responseEnd, "responseEnd", 10000)
    })))

  test(
    "NE-133",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ requestTiming: true, acceptInsecureCerts: true })
        const page = yield* context.newPage
        const sent = yield* NetworkRequest.next(page, { url: "**/empty.html" })
        yield* page.goto(server.https.EMPTY_PAGE, { waitUntil: "load" })
        const request = yield* sent
        const timing = yield* NetworkRequest.timing(page, request)
        verifyConnectionTimingConsistency(timing)
        atLeast(timing.requestStart, "requestStart", timing.connectEnd)
        above(timing.responseStart, "responseStart", timing.requestStart)
        atLeast(timing.responseEnd, "responseEnd", timing.responseStart)
        below(timing.responseEnd, "responseEnd", 10000)
      }))
  )

  test("NE-134", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ requestTiming: true })
      const page = yield* context.newPage
      server.setRedirect("/foo.html", "/empty.html")
      yield* page.goto(server.PREFIX + "/foo.html", { waitUntil: "load" })
      const requests = yield* requestsOf(page)
      assert.strictEqual(requests.length, 2)
      const [first, second] = requests
      assert.strictEqual(String(first!.url), server.PREFIX + "/foo.html")
      assert.strictEqual(String(second!.url), server.PREFIX + "/empty.html")
      // `Promise.all(responses.map(r => r.finished()))`: each hop's response has arrived
      yield* Effect.all([
        NetworkRequest.response(page, first!).pipe(Effect.flatMap((wait) => wait)),
        NetworkRequest.response(page, second!).pipe(Effect.flatMap((wait) => wait))
      ])

      const timing1 = yield* NetworkRequest.timing(page, first!)
      verifyConnectionTimingConsistency(timing1)
      atLeast(timing1.requestStart, "requestStart", timing1.connectEnd)
      above(timing1.responseStart, "responseStart", timing1.requestStart)
      atLeast(timing1.responseEnd, "responseEnd", timing1.responseStart)
      below(timing1.responseEnd, "responseEnd", 10000)

      const timing2 = yield* NetworkRequest.timing(page, second!)
      verifyConnectionTimingConsistency(timing2)
      atLeast(timing2.requestStart, "requestStart", Option.some(0))
      above(timing2.responseStart, "responseStart", timing2.requestStart)
      atLeast(timing2.responseEnd, "responseEnd", timing2.responseStart)
      below(timing2.responseEnd, "responseEnd", 10000)
    })))

  test("NE-135", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/one-style.css", (_req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/css",
          "Cache-Control": "public, max-age=10031518"
        })
        res.end(`body { background: red }`)
      })
      const context = yield* Browser.newContext({ requestTiming: true })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      // `Promise.all([page.waitForResponse('**/one-style.css'), page.reload()])`, with the response read to its end
      const sent = yield* NetworkRequest.next(page, { url: "**/one-style.css" })
      const arrived = yield* NetworkResponse.next(page, { url: "**/one-style.css", body: (message) => message.text })
      yield* page.reload({ waitUntil: "load" })
      const request = yield* sent
      yield* arrived
      const timing = yield* NetworkRequest.timing(page, request)
      verifyConnectionTimingConsistency(timing)
      assert.strictEqual(known(timing.responseStart, "responseStart"), known(timing.responseEnd, "responseEnd"))
      below(timing.responseEnd, "responseEnd", 1000)
    })))
})
