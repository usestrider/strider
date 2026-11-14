/**
 * Playwright's `tests/page/page-basic.spec.ts`: a page's load events, URL, title, frames, user agent, and key presses.
 *
 * What the port changes:
 * - Playwright's `page.goto` and `page.setContent` wait for `load` by default; Strider's `goto` resolves at commit.
 *   Each goto and setContent here asks for the state the original waits for.
 * - `waitForEvent('load')`, `'domcontentloaded'`, and the `load`/`domcontentloaded` listeners are a navigation's wait:
 *   `PageNavigation.next(page, { waitUntil })`, subscribed before the goto. Strider's events don't hand over the page,
 *   so PA-005 and PA-006 check that the navigation's main frame is the page's id.
 * - `page.url()` is `yield* page.url`, and `page.title()` is `yield* page.title`: Strider's reads of the current state.
 * - `page.frame({ url })` looks a frame up by its URL. Strider enters a frame by its element, so the port reads the
 *   frame tree for the frame with that URL, the way `page.frames()` does.
 * - PA-011 opens its popup from script, which the browser's popup blocking refuses unless it runs as a user gesture:
 *   `Page.withUserGesture`. Playwright launches Chromium with popup blocking off.
 * - `page.evaluate` runs in the main world, which is `page.evaluateInMainWorld`.
 * - PA-011's `closed` listener is `newPage.closed`, a signal that waits as long as the page lives and then gives why it
 *   closed, so it's read after the close instead of subscribed to before it.
 * - PA-016's `console` listener is `ConsoleMessage.next`, the first message after the press, which the original reads
 *   as `messages[0]`.
 * - PA-002 checks the async stack Playwright Test attaches to an error, and PA-019 iterates Playwright's own page
 *   object. Neither is ported (see the ledger).
 * - PA-003's popup `opener()` is not ported: Strider has no `opener` (see the ledger).
 * - PA-012's lookup by frame name is not ported: Strider's frame tree reports no frame's name (see the ledger).
 */
import { assert } from "@effect/vitest"
import { ConsoleMessage, Expect, Page, PageNavigation, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("PA-001", ({ page }) =>
    Effect.gen(function*() {
      // The wait is subscribed before the goto, as Playwright's `Promise.all` starts both
      const loaded = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.goto("about:blank", { waitUntil: "load" })
      yield* loaded
    }))

  test("PA-004", ({ page }) =>
    Effect.gen(function*() {
      const parsed = yield* PageNavigation.next(page, { waitUntil: "domContentLoaded" })
      yield* page.goto("about:blank", { waitUntil: "load" })
      yield* parsed
    }))

  test("PA-005", ({ page }) =>
    Effect.gen(function*() {
      // Playwright passes the page to the listener; a navigation says which frame it happened in, and the page's main
      // frame has the page's id
      const parsed = yield* PageNavigation.next(page, { waitUntil: "domContentLoaded" })
      yield* page.goto("about:blank", { waitUntil: "load" })
      const navigation = yield* parsed
      assert.strictEqual(navigation.frame, page.id)
    }))

  test("PA-006", ({ page }) =>
    Effect.gen(function*() {
      const loaded = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.goto("about:blank", { waitUntil: "load" })
      const navigation = yield* loaded
      assert.strictEqual(navigation.frame, page.id)
    }))

  test("PA-007", ({ page, server }) =>
    Effect.gen(function*() {
      assert.strictEqual(yield* page.url, "about:blank")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)
    }))

  test("PA-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE + "#hash", { waitUntil: "load" })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE + "#hash")
      yield* page.evaluateInMainWorld(() => {
        window.location.hash = "dynamic"
      })
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE + "#dynamic")
    }))

  test("PA-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/title.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.title, "Woof-Woof")
    }))

  test("PA-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent("<title>hello</title>")
      const [titleOrError] = yield* Effect.all([
        Effect.result(page.title),
        page.goto(server.PREFIX + "/title.html", { waitUntil: "load" })
      ], { concurrency: "unbounded" })
      // Playwright's `title()` may reject during navigation, and the original accepts only a string, so a failure fails
      assert(
        Result.isSuccess(titleOrError),
        "the title read failed during navigation, where Playwright's gives a string"
      )
      assert.match(titleOrError.success, /^(hello|Loading http.*title.html||Woof-Woof)$/)
      yield* Expect.toHaveTitle(page, "Woof-Woof")
    }))

  test("PA-011", ({ page }) =>
    Effect.gen(function*() {
      const popups = yield* Popup.next(page)
      // Strider keeps the browser's popup blocking (Playwright launches Chromium with it off), so a script opens a
      // popup only as a user gesture
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { newPage?: Window | null }).newPage = window.open("about:blank")
      }).pipe(Page.withUserGesture)
      const newPage = yield* popups
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { newPage?: Window | null }).newPage?.close()
      })
      // `closed` gives the reason once the page has closed, however long ago that was, so it's read after the close
      const reason = yield* newPage.closed
      assert(
        reason._tag === "PageClosed" && reason.by === "script",
        `the popup closed for another reason: ${reason._tag}`
      )
    }))

  test("PA-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<iframe src="${server.EMPTY_PAGE}"></iframe>`)
      const tree = yield* page.frames
      // `page.frame({ url: /bogus/ })` is null
      assert.isUndefined(tree.children.find((child) => /bogus/.test(child.url)))
      // `page.frame({ url: /empty/ }).url()` is the iframe's URL
      const frame = tree.children.find((child) => /empty/.test(child.url))
      assert.strictEqual(frame?.url, server.EMPTY_PAGE)
    }))

  test("PA-014", ({ page, browserName }) =>
    Effect.gen(function*() {
      const userAgent = yield* page.evaluateInMainWorld(() => navigator.userAgent)
      const [
        part1,
        /* part2 */,
        part3,
        part4,
        part5
      ] = userAgent.split(/[()]/).map((part) => part.trim())
      // First part is always "Mozilla/5.0"
      assert.strictEqual(part1, "Mozilla/5.0")
      // Second part in parenthesis is platform - ignore it.

      // Third part for Firefox is the last one and encodes engine and browser versions.
      if (browserName === "firefox") {
        const [engine, browser] = (part3 ?? "").split(" ")
        assert.isTrue(engine?.startsWith("Gecko"))
        assert.isTrue(browser?.startsWith("Firefox"))
        assert.strictEqual(part4, undefined)
        assert.strictEqual(part5, undefined)
        return
      }
      // For both options.CHROMIUM and options.WEBKIT, third part is the AppleWebKit version.
      assert.isTrue(part3?.startsWith("AppleWebKit/"))
      assert.strictEqual(part4, "KHTML, like Gecko")
      // 5th part encodes real browser name and engine version.
      const tokens = (part5 ?? "").split(" ")
      const engine = tokens[0] ?? ""
      const browser = tokens.find((t) => t.startsWith("Safari/"))
      assert.isTrue(browser?.startsWith("Safari/"))
      if (browserName === "chromium") assert.isTrue(engine.includes("Chrome/"))
      else assert.isTrue(engine.startsWith("Version/"))
    }))

  test("PA-015", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
      yield* page.locator("textarea").press("a")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.querySelector("textarea")?.value), "a")
    }))

  test("PA-016", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input onkeypress="console.log('press')"></input>`)
      // The original listens for console messages before the press and reads the first one after it
      const message = yield* ConsoleMessage.next(page)
      yield* page.locator("input").press("Enter")
      assert.strictEqual((yield* message).text, "press")
    }))

  test("PA-017", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<iframe name=inner src="${server.PREFIX}/input/textarea.html"></iframe>`)
      // `page.frame('inner')` by name: the frame is entered by its element
      const frame = page.frame(page.locator("iframe[name=inner]"))
      yield* frame.locator("textarea").press("a")
      // The original reads the value with `frame.evaluate`, which is the isolated world; an Expect matcher reads the
      // element's value without one
      yield* Expect.toHaveValue(frame.locator("textarea"), "a")
    }))

  test("PA-018", ({ page }) =>
    Effect.gen(function*() {
      assert.isTrue(yield* page.evaluateInMainWorld(() => navigator.webdriver))
    }))
})
