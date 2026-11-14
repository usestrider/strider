/**
 * Playwright's `tests/page/page-wait-for-load-state.spec.ts`: waiting for a page's document to reach `load` or
 * `domcontentloaded`, for popups, new pages, and frames, and for documents that are already loaded.
 *
 * What the port changes:
 * - Strider has no `waitForLoadState`. A page's readiness is its state: `page.status`, whose document's `readiness` is
 *   `loading`, then `interactive` once parsed (Playwright's `domcontentloaded`), then `complete` once loaded (Playwright's
 *   `load`). `loaded` waits for `complete`, and `parsed` for `interactive` or `complete`. Both read the current state
 *   first, as `waitForLoadState` does, so a document already there satisfies the wait at once.
 *   `PageNavigation.next` is the wait for a navigation that hasn't happened yet; no port here needs it.
 * - `waitForEvent("popup")` is `Popup.next`, subscribed before the call that opens the popup, as the original's
 *   `Promise.all` has it. The popup is a `Page`, with its `status` and `url`.
 * - Playwright launches Chromium with popup blocking off, so its tests open popups with `window.open` from plain script.
 *   Strider keeps the browser's popup blocking, so a script that opens a popup runs as a user gesture
 *   (`Page.withUserGesture`). The `window.open` steps use it.
 * - `page.evaluate` runs in the page's main world: `page.evaluateInMainWorld`. The `window._popup` and `window.popup`
 *   assignments are kept, as the original makes them.
 * - WA-082 to WA-090 pass `window.open` a target of `null`. Strider's typed call takes a string, and a browser turns
 *   `null` into the string `"null"`, which is what the port passes.
 * - WA-089's `waitForEvent("page")` is the page `page.context.newPage` returns: that is the page the event reports.
 * - WA-078's stack check is Playwright's: its error's stack names this file. Strider's `Timeout` names the operation and
 *   the phase it timed out in, and carries its budget, so those are what the port checks.
 * - WA-090's `page.evaluate("window")` round trips are `page.evaluateInMainWorld` calls that return nothing, since a
 *   `Window` doesn't cross by value.
 * - WA-080 passes a state Strider's waits don't take (`waitForLoadState("bad")`), so it's not ported (see the ledger).
 * - WA-091 needs `frame.waitForLoadState` and `frame.goto`, and WA-092 to WA-094 wait for `networkidle`, which Strider has no
 *   state for; both are in the ledger.
 */
import { assert } from "@effect/vitest"
import { Deadline, Page, Popup } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type { ServerResponse } from "node:http"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `waitForLoadState()`, which is `load`: the document has finished loading, its readiness `complete`. */
const loaded = (status: Page.Status) => status._tag === "Open" && status.document.readiness === "complete"

/** Playwright's `waitForLoadState("domcontentloaded")`: the document has parsed, its readiness `interactive` or `complete`. */
const parsed = (status: Page.Status) => status._tag === "Open" && status.document.readiness !== "loading"

upstream(import.meta.filename, {}, (test) => {
  test("WA-077", ({ page, server }) =>
    Effect.gen(function*() {
      const css: { response?: ServerResponse } = {}
      server.setRoute("/one-style.css", (_req, res) => {
        css.response = res
      })
      // The request for the stalled stylesheet and the navigation run together, as the original's `Promise.all` has them
      const requested = yield* server.waitForRequest("/one-style.css")
      yield* Effect.all([
        requested,
        page.goto(server.PREFIX + "/one-style.html", { waitUntil: "domContentLoaded" })
      ], { concurrency: "unbounded" })
      const waiting = yield* startWaiting(page.status.waitFor(loaded))
      assert.isDefined(css.response)
      css.response.statusCode = 404
      css.response.end("Not found")
      yield* Fiber.join(waiting.fiber)
    }))

  test("WA-078", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/one-style.css", () => {})
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "domContentLoaded" })
      const error = yield* failureOf(page.status.waitFor(loaded).pipe(Deadline.within("1 millis")), "the wait")
      assert(Deadline.isTimeout(error), String(error))
      // Strider's budget counts from when the wait starts, so it's the one millisecond less the moments before the
      // wait began, as `locator-any-frame` checks its actions' budgets
      assert.isAtMost(Duration.toMillis(error.budget), 1)
      assert.isAbove(Duration.toMillis(error.budget), 0)
      assert.strictEqual(error.phase, "waitingForCondition")
      assert.include(error.message, "timed out")
    }))

  test("WA-079", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      yield* page.status.waitFor(loaded)
    }))

  test("WA-081", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/one-style.css", () => {})
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "domContentLoaded" })
      yield* page.status.waitFor(parsed)
    }))

  test("WA-082", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const popups = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "_popup", window.open(document.location.href))
      }).pipe(Page.withUserGesture)
      const popup = yield* popups
      yield* popup.status.waitFor(loaded)
      // The url is about:blank in FF; the original's own check is commented out there, and not ported
      assert.strictEqual(yield* popup.url, server.EMPTY_PAGE)
    }))

  test("WA-083", ({ page }) =>
    Effect.gen(function*() {
      const popups = yield* Popup.next(page)
      const readyState = yield* page.evaluateInMainWorld(() => {
        const popup = window.open("")
        return popup?.document.readyState
      }).pipe(Page.withUserGesture)
      const popup = yield* popups
      yield* popup.status.waitFor(loaded)
      // The original expects `uninitialized` only on Firefox before 148 without BiDi; the pinned browsers all report
      // `complete` here, and so does the popup once it has loaded
      assert.strictEqual(readyState, "complete")
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => document.readyState), "complete")
    }))

  test("WA-084", ({ page }) =>
    Effect.gen(function*() {
      const popups = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => window.open("about:blank") && 1).pipe(Page.withUserGesture)
      const popup = yield* popups
      yield* popup.status.waitFor(loaded)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => document.readyState), "complete")
    }))

  test("WA-085", ({ page }) =>
    Effect.gen(function*() {
      const popups = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => window.open("about:blank", "null", "noopener") && 1).pipe(
        Page.withUserGesture
      )
      const popup = yield* popups
      yield* popup.status.waitFor(loaded)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => document.readyState), "complete")
    }))

  test("WA-086", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const popups = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => window.open(url) && 1, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const popup = yield* popups
      yield* popup.status.waitFor(loaded)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => document.readyState), "complete")
    }))

  test("WA-087", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const popups = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => window.open(url, "null", "noopener") && 1, server.EMPTY_PAGE).pipe(
        Page.withUserGesture
      )
      const popup = yield* popups
      yield* popup.status.waitFor(loaded)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => document.readyState), "complete")
    }))

  test("WA-088", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent("<a target=_blank rel=\"opener\" href=\"/one-style.html\">yo</a>")
      const popups = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* popups
      yield* popup.status.waitFor(loaded)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => document.readyState), "complete")
    }))

  test("WA-089", ({ page }) =>
    Effect.gen(function*() {
      // Playwright waits for the context's `page` event, which reports the page `newPage` creates; Strider's
      // `newPage` gives that page, so the port reads it from the call
      const newPage = yield* page.context.newPage
      yield* newPage.status.waitFor(loaded)
      assert.strictEqual(yield* newPage.evaluateInMainWorld(() => document.readyState), "complete")
    }))

  test("WA-090", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Stall the 'load' by delaying css.
      const css: { response?: ServerResponse } = {}
      server.setRoute("/one-style.css", (_req, res) => {
        css.response = res
      })
      const popups = yield* Popup.next(page)
      const requested = yield* server.waitForRequest("/one-style.css")
      yield* page.evaluateInMainWorld((url) => {
        Reflect.set(window, "popup", window.open(url))
      }, server.PREFIX + "/one-style.html").pipe(Page.withUserGesture)
      const popup = yield* popups
      yield* requested
      const loading = yield* startWaiting(popup.status.waitFor(loaded))
      // Round trips!
      for (let i = 0; i < 5; i++) yield* page.evaluateInMainWorld(() => undefined)
      assert.isFalse(yield* loading.done)
      assert.isDefined(css.response)
      css.response.end("")
      yield* Fiber.join(loading.fiber)
      assert.isTrue(yield* loading.done)
      assert.strictEqual(yield* popup.url, server.PREFIX + "/one-style.html")
    }))
})
