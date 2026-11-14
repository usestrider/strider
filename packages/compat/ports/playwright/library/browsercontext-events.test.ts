/**
 * Playwright's `tests/library/browsercontext-events.spec.ts`: the events a context reports for every page in it, the
 * console messages, uncaught errors, dialogs, pages, and downloads that a test watches from the context.
 *
 * What the port changes:
 * - `context.waitForEvent(name)` is the context's subscription to that event, `X.next(context)`, started before the action
 *   that fires it and read after the action. Where the original reads a message the action caused, the port waits for it
 *   with `next`, never `history` straight after the action, since a message can still be on its way when the action returns.
 * - `page.waitForEvent('popup')` is `Popup.next(page)`, and `context.waitForEvent('page')` is the context's `pages`, as
 *   browsercontext-page-event.test.ts does.
 * - `page.evaluate` runs in the main world, so it's `page.evaluateInMainWorld`. A script that opens a popup runs as a user
 *   gesture under Strider's popup blocking (`Page.withUserGesture`).
 * - A message's `page()` is its `origin`, which names its page by id; a popup's messages name the popup.
 * - BC-035's `window.builtins.setTimeout` is Playwright's copy of `setTimeout` for its own use. The page's `setTimeout`
 *   does the same wait here.
 * - BC-043's `webError.error().stack` is an `Option`, read with `Option.getOrThrow`.
 * - The dialog events, the context's close events, its frame and page events, and its downloads' pages aren't ported,
 *   and are in the ledger: see each test's entry.
 */
import { assert } from "@effect/vitest"
import { ConsoleMessage, Page, Popup, Target, UncaughtException, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Whether a list of pages holds this page, by identity. */
const holds = (pages: ReadonlyArray<Page.Page>, page: Page.Page) => pages.some((each) => each.id === page.id)

/**
 * `context.waitForEvent('page')`: the page that appears in the context besides the ones `known` when the wait starts.
 * A popup is in the context's `pages` as soon as it appears, before it has loaded.
 */
const nextPage = Effect.fnUntraced(function*(context: UserContext.UserContext, known: ReadonlyArray<Page.Page>) {
  const isNew = (page: Page.Page) => !holds(known, page)
  const pages = yield* context.pages.waitFor((pages) => pages.some(isNew))
  return pages.find(isNew)!
})

/** The page that a console message, an uncaught error, or any other event names as its origin. */
const originPage = (origin: Target.EventOrigin) => {
  assert(origin._tag === "Page", `the event came from ${origin._tag}, not a page`)
  return origin.page
}

upstream(import.meta.filename, {}, (test) => {
  test("BC-032", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page.context)
      yield* page.evaluateInMainWorld(() => console.log("hello"))
      const message = yield* logged
      assert.strictEqual(message.text, "hello")
      assert.strictEqual(originPage(message.origin), page.id)
    }))

  test("BC-034", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page.context)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        const win = window.open("")
        ;(win as any).console.log("hello")
      }).pipe(Page.withUserGesture)
      const message = yield* logged
      const popup = yield* opened
      assert.strictEqual(message.text, "hello")
      assert.strictEqual(originPage(message.origin), popup.id)
    }))

  test("BC-035", ({ page }) =>
    Effect.gen(function*() {
      // The console message is a log, as the original's filter says.
      const logged = yield* ConsoleMessage.next(page.context, { level: "log" })
      const opened = yield* startWaiting(nextPage(page.context, [page]))
      yield* page.evaluateInMainWorld(async () => {
        const win = window.open("javascript:console.log(\"hello\")")!
        // The original waits on window.builtins.setTimeout, Playwright's own copy of setTimeout
        await new Promise((f) => setTimeout(f, 0))
        win.close()
      }).pipe(Page.withUserGesture)
      const message = yield* logged
      const popup = yield* Fiber.join(opened.fiber)
      assert.strictEqual(message.text, "hello")
      assert.strictEqual(originPage(message.origin), popup.id)
    }))

  test("BC-036", ({ page }) =>
    Effect.gen(function*() {
      const logged = yield* ConsoleMessage.next(page.context)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        const win = window.open()!
        ;(win as any).console.log("hello")
        win.close()
      }).pipe(Page.withUserGesture)
      const message = yield* logged
      const popup = yield* opened
      assert.strictEqual(message.text, "hello")
      assert.strictEqual(originPage(message.origin), popup.id)
    }))

  test("BC-043", ({ page }) =>
    Effect.gen(function*() {
      const error = yield* UncaughtException.next(page.context)
      yield* page.setContent("<script>throw new Error(\"boom\")</script>")
      const webError = yield* error
      assert.strictEqual(originPage(webError.origin), page.id)
      assert.include(Option.getOrThrow(webError.stack), "boom")
    }))
})
