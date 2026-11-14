/**
 * Playwright's `tests/library/browsercontext-user-agent.spec.ts`: the user agent a context sends, for its pages, its
 * subframes, a download, and the Client Hints Chromium adds to it; and a context's options copied when it's created.
 *
 * What the port changes:
 * - A context's `userAgent` is `emulation.userAgent` in `Browser.newContext`, as Strider's options name it.
 * - Each test makes its own contexts, so the tests open no page of the harness's (`page: false`), and each context and
 *   page closes with its block, as the original's `context.close()` does.
 * - `page.evaluate` is `page.evaluateInMainWorld`, and `server.waitForRequest` is listened to before the navigation or
 *   the click that sends the request, with each wait bounded by `awaiting`.
 * - `playwright.devices['iPhone 6']` and `['Pixel 7']` are written out from the Playwright installed on this host's device
 *   table, since Strider has no device table: the user agent, viewport, device scale factor, and touch. UA-003 reads only
 *   the user agent, which is the table's own; UA-006 reads the Client Hints the Pixel's emulation produces.
 * - UA-003's `/mobile.html` is the vendored asset.
 * - UA-004's options are one object the test mutates after it creates the context: Strider reads a context's options as the
 *   call starts, so the mutation can't reach the context, as the original's copy doesn't.
 * - UA-005 clicks the download link without waiting, and the click's failure is ignored, as the original's `.catch`
 *   does. The click runs while the test waits for the request, as the original's does.
 * - UA-006 is Chromium's test, as the original's `it.skip` for every other browser says, so it runs on Chromium only.
 *   Its `expect.soft` checks are plain assertions here: the first failure ends the test.
 * - UA-007 is not ported: it needs `route.fetch` (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Browser, type Page, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { attachFrame, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `devices['iPhone 6']` user agent, from the installed Playwright's device table. */
const iPhone6UserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.0 Mobile/15A372 Safari/604.1"

/** Playwright's `devices['Pixel 7']`: user agent, viewport, device scale factor, a mobile page, and touch. */
const pixel7: UserContext.Options = {
  emulation: {
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.20 Mobile Safari/537.36",
    viewport: { width: 412, height: 839, deviceScaleFactor: 2.625, mobile: true },
    touch: true
  }
}

/** A wait on the fixture server, bounded, so a failure says what it waited for. */
const awaiting = <A, E, R>(what: string, wait: Effect.Effect<A, E, R>) =>
  wait.pipe(Effect.timeoutOrElse({
    duration: "20 seconds",
    orElse: () => Effect.die(new Error(`${what} never arrived`))
  }))

/** The page's `navigator.userAgentData`, as JSON, read in its main world. */
const userAgentData = (page: Page.Page) =>
  page.evaluateInMainWorld(() =>
    (navigator as Navigator & { userAgentData: { toJSON(): { mobile: boolean; platform: string } } }).userAgentData
      .toJSON()
  )

const load = { waitUntil: "load" } as const

upstream(import.meta.filename, {}, (test) => {
  test("UA-001", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        assert.include(yield* page.evaluateInMainWorld(() => navigator.userAgent), "Mozilla")
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ emulation: { userAgent: "foobar" } })
        const page = yield* context.newPage
        const request = yield* server.waitForRequest("/empty.html")
        yield* page.goto(server.EMPTY_PAGE, load)
        const received = yield* awaiting("the request for /empty.html", request)
        assert.strictEqual(received.headers["user-agent"], "foobar")
      }))
    }))

  test("UA-002", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        assert.include(yield* page.evaluateInMainWorld(() => navigator.userAgent), "Mozilla")
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ emulation: { userAgent: "foobar" } })
        const page = yield* context.newPage
        const request = yield* server.waitForRequest("/empty.html")
        yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
        const received = yield* awaiting("the frame's request for /empty.html", request)
        assert.strictEqual(received.headers["user-agent"], "foobar")
      }))
    }))

  test("UA-003", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        yield* page.goto(server.PREFIX + "/mobile.html", load)
        assert.notInclude(yield* page.evaluateInMainWorld(() => navigator.userAgent), "iPhone")
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ emulation: { userAgent: iPhone6UserAgent } })
        const page = yield* context.newPage
        yield* page.goto(server.PREFIX + "/mobile.html", load)
        assert.include(yield* page.evaluateInMainWorld(() => navigator.userAgent), "iPhone")
      }))
    }))

  test("UA-004", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const options = { emulation: { userAgent: "foobar" } }
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext(options)
        options.emulation.userAgent = "wrong"
        const page = yield* context.newPage
        const request = yield* server.waitForRequest("/empty.html")
        yield* page.goto(server.EMPTY_PAGE, load)
        const received = yield* awaiting("the request for /empty.html", request)
        assert.strictEqual(received.headers["user-agent"], "foobar")
      }))
    }))

  test("UA-005", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      server.setRoute("/download", (_request, response) => {
        response.setHeader("Content-Type", "application/octet-stream")
        response.setHeader("Content-Disposition", "attachment")
        response.end("Hello world")
      })
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ emulation: { userAgent: "MyCustomUA" } })
        const page = yield* context.newPage
        yield* page.goto(server.EMPTY_PAGE, load)
        yield* page.setContent(`<a id="download" download="name" href="/download">Download</a>`)
        const request = yield* server.waitForRequest("/download")
        // The original's `page.click('#download').catch(e => {})`: the click's failure doesn't fail the test.
        yield* startWaiting(page.locator("#download").click().pipe(Effect.ignore))
        const received = yield* awaiting("the request for /download", request)
        assert.strictEqual(received.headers["user-agent"], "MyCustomUA")
      }))
    }))

  test("UA-006", {
    page: false,
    browsers: ["chromium"]
  }, ({ server }) =>
    Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        const request = yield* server.waitForRequest("/empty.html")
        yield* page.goto(server.EMPTY_PAGE, load)
        const received = yield* awaiting("the request for /empty.html", request)
        assert.isDefined(received.headers["sec-ch-ua"], "the request carries a sec-ch-ua header")
        assert.include(received.headers["sec-ch-ua"], `"Chromium"`)
        assert.strictEqual(received.headers["sec-ch-ua-mobile"], "?0")
        assert.isOk(received.headers["sec-ch-ua-platform"])
        assert.strictEqual((yield* userAgentData(page)).mobile, false)
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext(pixel7)
        const page = yield* context.newPage
        const request = yield* server.waitForRequest("/empty.html")
        yield* page.goto(server.EMPTY_PAGE, load)
        const received = yield* awaiting("the request for /empty.html", request)
        // Strider's `emulation.userAgent` sets no Client Hints, so these headers are absent: say so, not "undefined".
        assert.isDefined(
          received.headers["sec-ch-ua"],
          "the emulated Pixel 7 request carries a sec-ch-ua header; Strider's userAgent emulation sets no Client Hints"
        )
        assert.include(received.headers["sec-ch-ua"], `"Chromium"`)
        assert.isDefined(received.headers["sec-ch-ua-mobile"], "the request carries a sec-ch-ua-mobile header")
        assert.strictEqual(received.headers["sec-ch-ua-mobile"], "?1")
        assert.strictEqual(received.headers["sec-ch-ua-platform"], `"Android"`)
        const data = yield* userAgentData(page)
        assert.strictEqual(data.mobile, true)
        assert.strictEqual(data.platform, "Android")
      }))
    }))
})
