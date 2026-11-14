/**
 * Puppeteer's `test/src/target.test.ts`: the pages a context and a browser hold, the workers a page and a context start
 * (dedicated, shared, and service), a page's URL as it changes, the popups a page opens, and the waits for a target.
 *
 * What the port changes:
 * - Puppeteer's CDP target model is `Target`, with `target.type()`, `target.page()`, `target.opener()`, and the
 *   `targetcreated`, `targetchanged`, and `targetdestroyed` events. Strider has no target object: a page is a page, and its
 *   url, status and `closed` effect are what the original's target reads and events give. Where the original asks for a
 *   target by its kind (a browser target, a `Target.asPage()` identity), the port has no counterpart and the ledger says so.
 * - `context.waitForTarget(predicate)` for a page at a URL is a wait on the context's pages (`context.pages`) and on that
 *   page's url. A popup is found the same way (`newPage` below): the page that appeared in the context, which every
 *   browser reports, where `Popup.next` isn't on WebKit.
 * - `page.evaluate(() => window.open(url))` runs as a user gesture (`Page.withUserGesture`), since Strider keeps the
 *   browser's popup blocking. The script returns nothing: a `Window` can't cross back as a value.
 * - Workers: `context.waitForTarget` for a `service_worker` or `shared_worker` is `BrowserWorker.next(context, { kind })`,
 *   subscribed before the navigation or the `SharedWorker` that starts it. A worker's `evaluate` runs in the worker as
 *   the original's does. Shared and service workers are reported on Chromium only (`workers.shared`, `workers.service`),
 *   so those tests are ledgered on Firefox and WebKit.
 * - Puppeteer's `worker.close()` and the service worker's exception event aren't in Strider (the ledger says so). A
 *   service worker that the test unregisters ends, and its `closed` effect is what "destroyed" is.
 * - Puppeteer's `waitForTarget` timeouts (3000 ms) are not ported: the harness's per-test budget bounds each wait. The
 *   `Browser.waitForTarget` tests wait for a page in the context at a URL (`popupAt`): its timeout is `Deadline.within`, and
 *   its abort signal is the wait's interruption.
 * - "should have an opener" isn't ported: `target.opener()` is `Page.opener`, which Strider lacks (the ledger says so). With
 *   Puppeteer's launch argument `--disable-popup-blocking` the page-load `window.open` would open, but the page's opener
 *   can't be read, and `Popup.next` only reports a popup to the page that opened it.
 * - `page.evaluate` runs in the main world, so `page.evaluateInMainWorld`. A page's body is `locator("body").count`.
 * - "should report when a target url changes" reads `page.url`, a watchable of the page's current URL: the
 *   subscription is made before the navigation, so the change is the one the original's `targetchanged` reports.
 */
import { assert } from "@effect/vitest"
import { Browser, BrowserWorker, Deadline, Page } from "@usestrider/browser"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import type { ServerResponse } from "node:http"
import { failureOf, startWaiting } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

/** Playwright-style `waitForEvent("page")` for a popup: the first page other than `page` to appear in its context. */
const newPage = (page: Page.Page) =>
  page.context.pages.waitFor((pages) => pages.some((each) => each.id !== page.id)).pipe(
    Effect.map((pages) => pages.find((each) => each.id !== page.id)!)
  )

/** The popup at `url`: the new page in the context, once its URL is `url`, as the original's `waitForTarget` finds it. */
const popupAt = (page: Page.Page, url: string) =>
  newPage(page).pipe(Effect.flatMap((other) => other.url.waitFor((current) => current === url).pipe(Effect.as(other))))

/** Puppeteer's `page.evaluate(url => window.open(url), url)`: a popup from a user gesture, since popup blocking is on. */
const openPopup = (page: Page.Page, url: string) =>
  page.evaluateInMainWorld((url) => {
    void window.open(url)
  }, url).pipe(Page.withUserGesture)

/** Playwright's `waitForLoadState()`: the document has finished loading, its readiness `complete`. */
const loaded = (status: Page.Status) => status._tag === "Open" && status.document.readiness === "complete"

/** A wait of the port's own, bounded so a worker that never reports fails naming what it waited for. */
const waitedFor = (what: string, duration: Duration.Input) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration,
      orElse: () => Effect.die(new Error(`timed out after ${String(duration)} waiting for ${what}`))
    })
  )

upstream(import.meta.filename, {}, (test) => {
  test("Target Browser.pages should return all of the pages", ({ page }) =>
    Effect.gen(function*() {
      // The context's pages are the testing page, and only it
      const pages = yield* page.context.pages
      assert.strictEqual(pages.length, 1)
      assert.include(pages.map((each) => each.id), page.id)
    }))

  test("Target should be able to use the default page in the browser", ({ page }) =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      // The pages are the testing page and the browser's first tab, which is observed and needs control for a scope
      const original = (yield* browser.pages).find((each) => each.id !== page.id)
      assert.isDefined(original)
      const control = yield* original!.control
      assert.strictEqual(
        yield* control.evaluateInMainWorld(() => ["Hello", "world"].join(" ")),
        "Hello world"
      )
      assert.strictEqual(yield* control.locator("body").count, 1)
    }))

  test("Target should be able to use async waitForTarget", ({ page, server }) =>
    Effect.gen(function*() {
      // The original waits for a target whose page is at the cross-process empty page, while the script opens it
      const opened = yield* startWaiting(popupAt(page, server.CROSS_PROCESS_PREFIX + "/empty.html"))
      yield* openPopup(page, server.CROSS_PROCESS_PREFIX + "/empty.html")
      const otherPage = yield* Fiber.join(opened.fiber)
      assert.strictEqual(String(yield* otherPage.url), server.CROSS_PROCESS_PREFIX + "/empty.html")
      assert.notStrictEqual(otherPage.id, page.id)
    }))

  test("Target should report when a new page is created and closed", ({ page, server }) =>
    Effect.gen(function*() {
      const opened = yield* startWaiting(popupAt(page, server.CROSS_PROCESS_PREFIX + "/empty.html"))
      yield* openPopup(page, server.CROSS_PROCESS_PREFIX + "/empty.html")
      const otherPage = yield* Fiber.join(opened.fiber)
      assert.include(String(yield* otherPage.url), server.CROSS_PROCESS_PREFIX)
      assert.strictEqual(
        yield* otherPage.evaluateInMainWorld(() => ["Hello", "world"].join(" ")),
        "Hello world"
      )
      assert.strictEqual(yield* otherPage.locator("body").count, 1)

      const before = (yield* page.context.pages).map((each) => each.id)
      assert.include(before, page.id)
      assert.include(before, otherPage.id)

      // Puppeteer's `targetdestroyed` is the popup's `closed` effect, which resolves once it has closed
      const closed = yield* startWaiting(otherPage.closed)
      yield* otherPage.close()
      yield* Fiber.join(closed.fiber)
      const after = (yield* page.context.pages).map((each) => each.id)
      assert.include(after, page.id)
      assert.notInclude(after, otherPage.id)
    }))

  test("Target should report when a service worker is created and destroyed", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const created = yield* BrowserWorker.next(page.context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html")
      const worker = yield* created.pipe(waitedFor("the service worker to be reported", "5 seconds"))
      assert.strictEqual(worker.kind, "service")
      assert.strictEqual(String(worker.url), server.PREFIX + "/serviceworkers/empty/sw.js")

      // Puppeteer unregisters the worker from the page, and the worker's `closed` is its `targetdestroyed`. Puppeteer only
      // discovers the service worker; Strider attaches to it, which keeps Chromium from destroying it once it's unregistered,
      // so `closed` doesn't come (the worker still evaluates 20 s later). The wait is bounded so the test names it.
      const destroyed = yield* startWaiting(worker.closed)
      yield* page.evaluateInMainWorld(() =>
        (globalThis as unknown as {
          registrationPromise: Promise<{ unregister(): Promise<boolean> }>
        }).registrationPromise.then((registration) => registration.unregister())
      )
      yield* Fiber.join(destroyed.fiber).pipe(
        waitedFor("the service worker's `closed` after unregister()", "5 seconds")
      )
    }))

  test("Target should create a worker from a service worker", ({ page, server }) =>
    Effect.gen(function*() {
      const created = yield* BrowserWorker.next(page.context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html")
      const worker = yield* created
      assert.strictEqual(
        yield* worker.evaluate(() => self.toString()),
        "[object ServiceWorkerGlobalScope]"
      )
    }))

  test("Target should create a worker from a shared worker", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const created = yield* BrowserWorker.next(page.context, { kind: "shared" })
      yield* page.evaluateInMainWorld(() => {
        void new SharedWorker("data:text/javascript,console.log(\"hi\")")
      })
      const worker = yield* created
      assert.strictEqual(worker.kind, "shared")
      assert.strictEqual(
        yield* worker.evaluate(() => self.toString()),
        "[object SharedWorkerGlobalScope]"
      )
    }))

  test("Target should report when a target url changes", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const changed = yield* startWaiting(page.url.waitFor((url) => url === server.CROSS_PROCESS_PREFIX + "/"))
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/")
      assert.strictEqual(String(yield* Fiber.join(changed.fiber)), server.CROSS_PROCESS_PREFIX + "/")

      const back = yield* startWaiting(page.url.waitFor((url) => url === server.EMPTY_PAGE))
      yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(String(yield* Fiber.join(back.fiber)), server.EMPTY_PAGE)
    }))

  test("Target should not crash while redirecting if original request was missed", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      let serverResponse!: ServerResponse
      server.setRoute("/one-style.css", (_req, res) => {
        serverResponse = res
      })
      // Open a new page, and wait for its stylesheet request, which the route holds
      const requested = yield* server.waitForRequest("/one-style.css")
      yield* openPopup(page, server.PREFIX + "/one-style.html")
      const newPageOpened = yield* newPage(page)
      yield* requested
      // Subscribe to the page's load before the redirect, as the original does
      const loadEvent = yield* startWaiting(newPageOpened.status.waitFor(loaded))
      serverResponse.writeHead(302, { location: "/injectedstyle.css" })
      serverResponse.end()
      yield* Fiber.join(loadEvent.fiber)
      yield* newPageOpened.close()
    })))

  test("Target Browser.waitForTarget should wait for a target", ({ page, server }) =>
    Effect.gen(function*() {
      // The original waits across the browser's targets for one at the empty page, while the test opens a page in the context
      const target = yield* startWaiting(popupAt(page, server.EMPTY_PAGE))
      const created = yield* page.context.newPage
      assert.isFalse(yield* target.done)
      yield* created.goto(server.EMPTY_PAGE)
      const found = yield* Fiber.join(target.fiber)
      assert.strictEqual(found.id, created.id)
    }))

  test("Target Browser.waitForTarget should timeout waiting for a non-existent target", ({ page, server }) =>
    Effect.gen(function*() {
      // No page ever appears at the URL, so the wait times out (the original's 1 ms `timeout` is `Deadline.within`)
      const error = yield* failureOf(
        popupAt(page, server.PREFIX + "/does-not-exist.html").pipe(Deadline.within("1 millis")),
        "the wait for a target"
      )
      assert(Deadline.isTimeout(error), String(error))
    }))

  test("Target Browser.waitForTarget should be able to abort", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's `AbortSignal` is Effect's interruption: an interrupted wait ends, rather than rejecting with a message
      const task = yield* startWaiting(newPage(page))
      yield* Fiber.interrupt(task.fiber)
      const exit = yield* Fiber.await(task.fiber)
      assert(Exit.isFailure(exit) && Exit.hasInterrupts(exit), `the wait was interrupted, got ${String(exit)}`)
    }))
})
