/**
 * Playwright's `tests/library/browsercontext-page-event.spec.ts`: the pages a context reports as they open, the URL
 * each has when reported and when it closes, and the lifecycle a test watches.
 *
 * What the port changes:
 * - `context.waitForEvent('page')` is the context's `pages`: the wait, started before the action, ends when a page that
 *   wasn't open before it appears (`nextPage`), for a popup a page's script opens as for a page the test opens itself.
 *   The original's event is the context's, not the opener's, so the port doesn't use `Popup.next`, which stock WebKit
 *   refuses (`Unsupported`, as it can't say which page opened another). A popup is reported when it appears, before its
 *   first load, so a test that reads its URL from the event waits for the URL its window was opened with, as the
 *   original's event does.
 * - `popup.waitForLoadState('domcontentloaded')` is the popup's document readiness, waited on its status, as
 *   popup.test.ts does. `page.goto` and `setContent` wait for `load` by default; Strider's `goto` resolves at commit, so
 *   the port asks for `load` where the original's default is it.
 * - `page.evaluate` runs in the main world, which is `page.evaluateInMainWorld`. A script that opens a popup runs as a
 *   user gesture under Strider's popup blocking (`Page.withUserGesture`).
 * - `otherPage.once('close', …)` is the page's `closed` signal, subscribed before `close()`. It gives the reason the
 *   page closed, so BC-066 asserts the reason is a close by command.
 * - BC-070's events are read at the moments the original's handlers run: the URL when the page is reported, and the
 *   URL just before its close.
 * - BC-069, BC-071, and BC-072 aren't ported (see the ledger): they check the popup's opener, which Strider has no
 *   accessor for.
 */
import { assert } from "@effect/vitest"
import { Browser, Page, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `waitForLoadState("domcontentloaded")`: the document has parsed, its readiness `interactive` or `complete`. */
const parsed = (status: Page.Status) => status._tag === "Open" && status.document.readiness !== "loading"

/** The part of Node's response the redirect uses. */
type ServerResponse = Pick<import("node:http").ServerResponse, "writeHead" | "end">

/** Whether a list of pages holds this page, by identity. */
const holds = (pages: ReadonlyArray<Page.Page>, page: Page.Page) => pages.some((each) => each.id === page.id)

/**
 * `context.waitForEvent('page')`: the page that appears in the context besides the ones `known` when the wait starts.
 * A popup is in the context's `pages` as soon as it appears, so the wait ends before the popup has loaded.
 */
const nextPage = Effect.fnUntraced(function*(context: UserContext.UserContext, known: ReadonlyArray<Page.Page>) {
  const isNew = (page: Page.Page) => !holds(known, page)
  const pages = yield* context.pages.waitFor((pages) => pages.some(isNew))
  return pages.find(isNew)!
})

upstream(import.meta.filename, {}, (test) => {
  test("BC-062", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const opener = yield* context.newPage
      const opened = yield* startWaiting(nextPage(context, [opener]))
      yield* opener.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const otherPage = yield* Fiber.join(opened.fiber)
      // The original's page event waits for the popup's first URL; the popup is reported before it, so the port waits
      // for the same URL.
      yield* otherPage.url.waitFor((url) => url === server.EMPTY_PAGE)
      assert.strictEqual(yield* otherPage.url, server.EMPTY_PAGE)
    })))

  test("BC-063", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const opener = yield* context.newPage
      const opened = yield* startWaiting(nextPage(context, [opener]))
      yield* opener.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const otherPage = yield* Fiber.join(opened.fiber)
      yield* otherPage.status.waitFor(parsed)
      assert.strictEqual(yield* otherPage.url, server.EMPTY_PAGE)
    })))

  test("BC-064", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const opener = yield* context.newPage
      const opened = yield* startWaiting(nextPage(context, [opener]))
      yield* opener.evaluateInMainWorld((url) => {
        window.open(url)
      }, "about:blank").pipe(Page.withUserGesture)
      const otherPage = yield* Fiber.join(opened.fiber)
      yield* otherPage.status.waitFor(parsed)
      assert.strictEqual(yield* otherPage.url, "about:blank")
    })))

  test("BC-065", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const opener = yield* context.newPage
      const opened = yield* startWaiting(nextPage(context, [opener]))
      yield* opener.evaluateInMainWorld(() => {
        window.open()
      }).pipe(Page.withUserGesture)
      const otherPage = yield* Fiber.join(opened.fiber)
      yield* otherPage.status.waitFor(parsed)
      assert.strictEqual(yield* otherPage.url, "about:blank")
    })))

  test("BC-066", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const opened = yield* startWaiting(nextPage(context, [page]))
      yield* page.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.CROSS_PROCESS_PREFIX + "/empty.html").pipe(Page.withUserGesture)
      const otherPage = yield* Fiber.join(opened.fiber)
      // The url is about:blank in FF when 'page' event is fired.
      yield* otherPage.url.waitFor((url) => url.includes(server.CROSS_PROCESS_PREFIX))
      assert.include(yield* otherPage.url, server.CROSS_PROCESS_PREFIX)
      assert.strictEqual(yield* otherPage.evaluateInMainWorld(() => ["Hello", "world"].join(" ")), "Hello world")
      // `await otherPage.$('body')`: the document has a body
      assert.isAbove(yield* otherPage.locator("body").count, 0)

      assert.isTrue(holds(yield* context.pages, page))
      assert.isTrue(holds(yield* context.pages, otherPage))

      // `otherPage.once('close', …)` is subscribed before the close; the reason it closed is what the event carries.
      const closed = yield* startWaiting(otherPage.closed)
      yield* otherPage.close()
      const reason = yield* Fiber.join(closed.fiber)
      assert(reason._tag === "PageClosed" && reason.by === "command", `closed for another reason: ${reason._tag}`)

      const remaining = yield* context.pages
      assert.isTrue(holds(remaining, page))
      assert.isFalse(holds(remaining, otherPage))
    })))

  test("BC-067", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      // `context.waitForEvent('page')` for a page the test doesn't await: `void context.newPage()`
      const created = yield* startWaiting(nextPage(context, []))
      yield* Effect.forkScoped(context.newPage)
      const newPage = yield* Fiber.join(created.fiber)
      assert.strictEqual(yield* newPage.url, "about:blank")

      const opened = yield* startWaiting(nextPage(context, [newPage]))
      yield* newPage.evaluateInMainWorld(() => {
        window.open("about:blank")
      }).pipe(Page.withUserGesture)
      const popup = yield* Fiber.join(opened.fiber)
      assert.strictEqual(yield* popup.url, "about:blank")
    })))

  test("BC-068", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      // The original holds the stylesheet's response, to answer it with a redirect once the popup has asked for it.
      const held: { response?: ServerResponse } = {}
      server.setRoute("/one-style.css", (_request, response) => {
        held.response = response
      })
      // `context.waitForEvent('page')` with the open and the request awaited together
      const opened = yield* startWaiting(nextPage(context, [page]))
      const requested = yield* server.waitForRequest("/one-style.css")
      yield* page.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.PREFIX + "/one-style.html").pipe(Page.withUserGesture)
      const newPage = yield* Fiber.join(opened.fiber)
      yield* requested
      // Issue a redirect.
      assert.isDefined(held.response)
      held.response!.writeHead(302, { location: "/injectedstyle.css" })
      held.response!.end()
      yield* newPage.status.waitFor(parsed)
      assert.strictEqual(yield* newPage.url, server.PREFIX + "/one-style.html")
    })))

  test("BC-070", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const events: Array<string> = []
      // `context.on('page')`: the page as the context reports it, with about:blank as its URL
      const page = yield* context.newPage
      events.push("CREATED: " + (yield* page.url))
      // `page.on('close')`: the page's URL when it closes, read before the close
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const url = yield* page.url
      const destroyed = yield* startWaiting(page.closed)
      yield* page.close()
      yield* Fiber.join(destroyed.fiber)
      events.push("DESTROYED: " + url)
      assert.deepStrictEqual(events, [
        "CREATED: about:blank",
        `DESTROYED: ${server.EMPTY_PAGE}`
      ])
    })))
})
