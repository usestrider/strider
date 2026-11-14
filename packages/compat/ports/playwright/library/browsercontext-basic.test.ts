/**
 * Playwright's `tests/library/browsercontext-basic.spec.ts`: creating and closing browser contexts, and the isolation
 * between them (storage, cookies, pages), with a context's viewport, device scale, JavaScript, network, and media.
 *
 * What the port changes:
 * - A context is `Browser.newContext`, owned by a scope; closing it is ending that scope (`Scope.close`), as
 *   `context.close()` does. A context that's closed in the middle of a test is opened in a scope of its own.
 * - `page.evaluate` runs in the page's main world, which is `page.evaluateInMainWorld`. A listener the original adds
 *   with `locator.evaluate` is added in the main world with `document.querySelector`, so the page's `window.clicks`
 *   counts the same clicks.
 * - `context.pages()` is the context's `pages` watchable, read for its current value; a page is identified by its `id`.
 * - A page's own context is `page.context`, compared by its `id`.
 * - `context.setOffline(offline)`: Strider's offline emulation is `context.emulate({ network: "offline" })`, which holds
 *   for the scope it's in. `offlineSwitch` opens a scope for it and closes that scope to go back online. The same
 *   emulation given at creation (`emulation: { network: "offline" }`) holds for the context's life, so it can't be turned
 *   off. BC-023 therefore runs both: a context created offline refuses a navigation, and
 *   a context taken offline and back refuses one and then loads.
 * - `page.goto`, `setContent`, and `reload` resolve at commit by default and wait for `load` in the original, so the port
 *   asks for `load` where the original's default is it.
 * - `window.open` from plain script runs as a user gesture under Strider's popup blocking (`Page.withUserGesture`), and
 *   the popup is read with `Popup.next`, subscribed before the call. Strider reports a popup before it loads, so the
 *   port waits for the URL its window was opened with, as the original's popup event implies.
 * - `browser.newPage({ colorScheme })` is `Browser.newPage({ emulation: { media } })`, which makes its own context, as
 *   Playwright's does.
 * - BC-012 asserts the typed reason Strider's waiting read ends with: `TargetGone` for `UserContextRemoved`. Its message
 *   names the removed context instead of Playwright's "closed" wording.
 * - BC-014: the original's close event passes the context back. Strider's `closed` is the context's own lifetime
 *   signal, and it gives the reason the context ended, so the port asserts that reason. The wait is on this context, so
 *   the identity the original checks holds without being asserted.
 * - BC-015's `context.on('page')` is a watcher on `context.pages` started before the click, because Strider has no page
 *   listener. `popup.mainFrame()` is the closed page's `frames`, which still returns its frame tree.
 * - BC-018's `page.evaluate('something')` is a function that reads the undeclared global, which the page's own script
 *   defines only with JavaScript on; the failure is `EvaluationThrown`, whose message names the same thing.
 * - BC-008's device scale factor comes with a viewport, which Strider's `Viewport` requires: 1280×720, Playwright's default
 *   when a device scale factor is given.
 * - BC-022's two-second wait is the original's own, ported as written.
 * - BC-026 runs its Chromium-only branch on Chromium, and BC-026's version gate is met by the pinned Chromium.
 * - BC-029 reads the attached frame through its own locator in the isolated world, since the frame is cross-process and
 *   the main world of the parent can't reach it. `matchMedia` is the same in either world.
 * - BC-023's Firefox branch subscribes to the next navigation before the failing `goto`, as the original waits for
 *   `framenavigated` beside it.
 * - BC-002 and BC-005 assert `browser.contexts().length` in the original; Strider has no list of a browser's contexts
 *   (`method-browser-contexts`), so those assertions aren't ported. Every other step of BC-005, the isolation of storage,
 *   cookies, and pages, is.
 * - BC-001, BC-009, BC-010, BC-013, and BC-030 aren't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import {
  Browser,
  Condition,
  Expect,
  Page,
  PageNavigation,
  Popup,
  Reason,
  Route,
  Target,
  type UserContext
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { attachFrame, failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Whether a list of pages holds this page, by identity. */
const holds = (pages: ReadonlyArray<Page.Page>, page: Page.Page) => pages.some((each) => each.id === page.id)

/** Playwright's `popup.url()` after `waitForEvent('popup')`: the URL the popup's window was opened with. */
const committed = (popup: Page.Page, url: string) => popup.url.waitFor((current) => current === url)

/** Playwright's `verifyViewport(page, width, height)`: the configured size, then the window's inner size. */
const verifyViewport = Effect.fnUntraced(function*(page: Page.Page, width: number, height: number) {
  const size = Option.getOrUndefined(yield* page.viewportSize)
  assert(size !== undefined, "the page has no configured viewport")
  assert.strictEqual(size.width, width)
  assert.strictEqual(size.height, height)
  assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerWidth), width)
  assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerHeight), height)
})

/**
 * Playwright's `context.setOffline(offline)`: the emulation is held by a scope, so turning it on opens one and turning it
 * off closes it.
 */
const offlineSwitch = (context: UserContext.UserContext) => {
  let held: Scope.Closeable | undefined
  return Effect.fnUntraced(function*(offline: boolean) {
    if (offline && held === undefined) {
      const scope = yield* Scope.make()
      yield* context.emulate({ network: "offline" }).pipe(Scope.provide(scope))
      held = scope
    } else if (!offline && held !== undefined) {
      const scope = held
      held = undefined
      yield* Scope.close(scope, Exit.void)
    }
  })
}

/** The status of a navigation's response, when it has one. */
const responseStatus = (navigation: PageNavigation.PageNavigation) =>
  navigation._tag === "Committed"
    ? Option.getOrUndefined(Option.map(navigation.response, (response) => response.status))
    : undefined

/** The message of a page evaluation that threw, as Strider reports it. */
const thrownMessage = (failure: unknown): string => {
  assert(Page.isPageError(failure), `not a page error: ${String(failure)}`)
  assert(failure.reason instanceof Reason.EvaluationThrown, `not an evaluation error: ${failure.reason._tag}`)
  return failure.reason.exception.message
}

/** The page's own `something` global: undeclared in this module, so the function reads it in the page, where it's missing. */
declare const something: string

upstream(import.meta.filename, {}, (test) => {
  test("BC-002", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const createPage = Effect.fnUntraced(function*() {
        const page = yield* Browser.newPage()
        yield* page.setContent(`<button>Click me</button>`, { waitUntil: "load" })
        // `locator.evaluate` in the original: a click listener counting in the page's own world
        yield* page.evaluateInMainWorld(() => {
          const counted = window as unknown as { clicks: number }
          counted.clicks = 0
          document.querySelector("button")!.addEventListener("click", () => ++counted.clicks, false)
        })
        return page
      })
      const clickInPage = Effect.fnUntraced(function*(page: Page.Page, count: number) {
        for (let i = 0; i < count; ++i) yield* page.locator("button").click()
      })
      const getClicks = (page: Page.Page) =>
        page.evaluateInMainWorld(() => (window as unknown as { clicks: number }).clicks)

      const page1 = yield* createPage()
      const page2 = yield* createPage()

      const CLICK_COUNT = 20
      yield* Effect.all([clickInPage(page1, CLICK_COUNT), clickInPage(page2, CLICK_COUNT)], {
        concurrency: "unbounded"
      })
      assert.strictEqual(yield* getClicks(page1), CLICK_COUNT)
      assert.strictEqual(yield* getClicks(page2), CLICK_COUNT)
    })))

  test("BC-003", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const html = `
    <style>
      [role="tooltip"] { display: none; }
      [role="tooltip"].visible { display: block; }
    </style>
    <button>Hover me</button>
    <div role="tooltip">Tooltip content</div>
    <script>
      const button = document.querySelector('button');
      const tooltip = document.querySelector('[role="tooltip"]');
      button.addEventListener('pointerenter', () => tooltip.classList.add('visible'));
      button.addEventListener('pointerleave', () => tooltip.classList.remove('visible'));
    </script>
  `
      // Five contexts, each closed when the scope ends, as the original's `page.context().close()` does
      const pages = yield* Effect.forEach([1, 2, 3, 4, 5], () =>
        Effect.gen(function*() {
          const context = yield* Browser.newContext()
          const page = yield* context.newPage
          yield* page.setContent(html, { waitUntil: "load" })
          return page
        }), { concurrency: "unbounded" })

      // `expect.soft`: every page's check runs, and the failures are reported together
      const failures = yield* Effect.forEach(pages, (page, index) =>
        Effect.gen(function*() {
          yield* page.getByRole("button", { name: "Hover me" }).hover()
          yield* Expect.toBeVisible(page.getByRole("tooltip"))
        }).pipe(
          Effect.result,
          Effect.map((result) =>
            Result.isFailure(result)
              ? `Tooltip for page ${index + 1} should be visible: ${String(result.failure)}`
              : undefined
          )
        ), { concurrency: "unbounded" })
      assert.deepStrictEqual(failures.filter((failure) => failure !== undefined), [])
    })))

  test("BC-004", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const popups = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const popup = yield* popups
      yield* committed(popup, server.EMPTY_PAGE)
      assert.strictEqual(popup.context.id, context.id)
    })))

  test("BC-005", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      // Create two incognito contexts.
      const context1 = yield* Browser.newContext()
      const context2 = yield* Browser.newContext()
      assert.strictEqual((yield* context1.pages).length, 0)
      assert.strictEqual((yield* context2.pages).length, 0)

      // Create a page in first incognito context.
      const page1 = yield* context1.newPage
      yield* page1.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page1.evaluateInMainWorld(() => {
        localStorage.setItem("name", "page1")
        document.cookie = "name=page1"
      })

      assert.strictEqual((yield* context1.pages).length, 1)
      assert.strictEqual((yield* context2.pages).length, 0)

      // Create a page in second incognito context.
      const page2 = yield* context2.newPage
      yield* page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page2.evaluateInMainWorld(() => {
        localStorage.setItem("name", "page2")
        document.cookie = "name=page2"
      })

      const pages1 = yield* context1.pages
      const pages2 = yield* context2.pages
      assert.strictEqual(pages1.length, 1)
      assert.strictEqual(pages2.length, 1)
      assert.strictEqual(pages1[0]?.id, page1.id)
      assert.strictEqual(pages2[0]?.id, page2.id)

      // Make sure pages don't share localstorage or cookies.
      assert.strictEqual(yield* page1.evaluateInMainWorld(() => localStorage.getItem("name")), "page1")
      assert.strictEqual(yield* page1.evaluateInMainWorld(() => document.cookie), "name=page1")
      assert.strictEqual(yield* page2.evaluateInMainWorld(() => localStorage.getItem("name")), "page2")
      assert.strictEqual(yield* page2.evaluateInMainWorld(() => document.cookie), "name=page2")

      // The original closes both contexts here and asserts `browser.contexts().length` is 0: Strider has no list of a
      // browser's contexts (`method-browser-contexts`), so that last assertion isn't ported.
    })))

  test("BC-006", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { viewport: { width: 456, height: 789 } } })
      const page = yield* context.newPage
      yield* verifyViewport(page, 456, 789)
    })))

  test("BC-007", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const viewport = { width: 456, height: 789 }
      const context = yield* Browser.newContext({ emulation: { viewport } })
      // The original changes its own object after the context is made; the context keeps the size it was given
      viewport.width = 567
      const page = yield* context.newPage
      yield* verifyViewport(page, 456, 789)
    })))

  test("BC-008", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      // Strider's viewport takes a size with its scale; 1280×720 is Playwright's default when only a scale is given
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 1280, height: 720, deviceScaleFactor: 3 } }
      })
      const page = yield* context.newPage
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.devicePixelRatio), 3)
    })))

  test("BC-011", { page: false }, () =>
    // `context.close()` on an empty context: the context's scope ends, and nothing is left to close
    Effect.scoped(Browser.newContext()).pipe(Effect.asVoid))

  test("BC-012", { page: false }, () =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const context = yield* Browser.newContext().pipe(Scope.provide(scope))
      // `context.waitForEvent('page')`, a page that never comes, waited on until the context closes
      const waiting = yield* startWaiting(context.pages.waitFor((pages) => pages.length > 0))
      yield* Scope.close(scope, Exit.void)
      const failure = yield* failureOf(Fiber.join(waiting.fiber), "the wait")
      assert(Target.isTargetGone(failure), `not a target gone: ${String(failure)}`)
      assert.strictEqual(failure.reason._tag, "UserContextRemoved")
      assert.include(failure.message, "removed")
    }))

  test("BC-014", { page: false }, () =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const context = yield* Browser.newContext().pipe(Scope.provide(scope))
      const closed = yield* startWaiting(context.closed)
      yield* Scope.close(scope, Exit.void)
      const reason = yield* Fiber.join(closed.fiber)
      assert.strictEqual(reason._tag, "UserContextRemoved")
    }))

  test("BC-015", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const context = yield* Browser.newContext().pipe(Scope.provide(scope))
      const page = yield* context.newPage.pipe(Scope.provide(scope))
      server.setRoute("/empty.html", (_request, response) => {
        response.end(`<a href="${server.EMPTY_PAGE}" target="_blank">Click me</a>`)
      })
      // The original's `context.on('page', p => popup = p)`: a watcher started before the click that keeps the last page
      // the context reports besides the first
      const seen = yield* Ref.make<Page.Page | undefined>(undefined)
      yield* Effect.forkChild(
        Stream.runForEach(
          context.pages.changes,
          (pages) => {
            const popup = pages.find((each) => each.id !== page.id)
            return popup === undefined ? Effect.void : Ref.set(seen, popup)
          }
        ),
        { startImmediately: true }
      )
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.getByText("Click me", { exact: true }).click()
      yield* Scope.close(scope, Exit.void)
      const popup = yield* Ref.get(seen)
      // The original checks these only when the popup was seen, as the `if (popup)` does ("This races on Firefox")
      if (popup !== undefined) {
        assert.strictEqual((yield* popup.status)._tag, "Closed")
        // `popup.mainFrame()`: a closed page still has its main frame object, which Strider's `frames` returns
        assert.isDefined(yield* popup.frames)
      }
    }))

  test("BC-016", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const second = yield* context.newPage
      const allPages = yield* context.pages
      assert.strictEqual(allPages.length, 2)
      assert.isTrue(holds(allPages, page))
      assert.isTrue(holds(allPages, second))
    })))

  test("BC-017", { page: false }, () =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const context = yield* Browser.newContext().pipe(Scope.provide(scope))
      yield* context.newPage.pipe(Scope.provide(scope))
      assert.strictEqual((yield* context.pages).length, 1)

      yield* Scope.close(scope, Exit.void)
      assert.strictEqual((yield* context.pages).length, 0)
    }))

  test("BC-018", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ emulation: { javaScript: "disabled" } })
        const page = yield* context.newPage
        yield* page.goto(`data:text/html, <script>var something = "forbidden"</script>`, { waitUntil: "load" })
        const failure = yield* failureOf(page.evaluateInMainWorld(() => something), "the evaluation")
        const message = thrownMessage(failure)
        if (browserName === "webkit") assert.include(message, "Can't find variable: something")
        else assert.include(message, "something is not defined")
      }))

      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        yield* page.goto(`data:text/html, <script>var something = "forbidden"</script>`, { waitUntil: "load" })
        assert.strictEqual(yield* page.evaluateInMainWorld(() => something), "forbidden")
      }))
    }))

  test("BC-019", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { javaScript: "disabled" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
    })))

  test("BC-020", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { javaScript: "disabled" } })
      const page = yield* context.newPage
      assert.strictEqual(yield* page.evaluateInMainWorld(() => 1), 1)
      assert.strictEqual(yield* page.evaluateInMainWorld(async () => 2), 2)
    })))

  test("BC-021", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { javaScript: "disabled" } })
      const page = yield* context.newPage
      yield* page.setContent("<h1>Hello</h1>", { waitUntil: "load" })
      yield* Expect.toHaveText(page.locator("h1"), "Hello")
    })))

  test("BC-022", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { javaScript: "disabled" } })
      const page = yield* context.newPage
      yield* page.setContent(
        `
    <details><summary>Continue</summary>Details</details>
    <div id="cover" style="position: fixed; inset: 0;"></div>
  `,
        { waitUntil: "load" }
      )
      const clicking = yield* startWaiting(page.locator("summary").click())
      // Give it enough time to go through a few retries while the button is covered.
      yield* Effect.sleep("2 seconds")
      assert.isFalse(yield* clicking.done)
      yield* page.evaluateInMainWorld(() => document.getElementById("cover")!.remove())
      yield* Fiber.join(clicking.fiber)
      yield* Expect.toHaveAttribute(page.locator("details"), "open", "")
    })))

  test("BC-023", { page: false }, ({ browserName, server }) =>
    Effect.scoped(Effect.gen(function*() {
      // Strider's emulation given at creation holds for the context's life, so there is no turning it off. The original's
      // `offline: true` then `setOffline(false)` is two parts here: the creation option refuses a navigation, and a
      // context taken offline by `offlineSwitch` refuses one and then loads once it's back online.
      const navigateOffline = Effect.fnUntraced(function*(page: Page.Page) {
        if (browserName === "firefox") {
          // Firefox navigates to an error page, and this navigation might conflict with the next navigation we do in test.
          // So the navigation is subscribed before the `goto`, and both are waited for.
          const navigated = yield* PageNavigation.next(page)
          const [outcome] = yield* Effect.all([Effect.result(page.goto(server.EMPTY_PAGE)), navigated], {
            concurrency: "unbounded"
          })
          return outcome
        }
        return yield* Effect.result(page.goto(server.EMPTY_PAGE))
      })

      const created = yield* Browser.newContext({ emulation: { network: "offline" } })
      const createdPage = yield* created.newPage
      assert.isTrue(Result.isFailure(yield* navigateOffline(createdPage)), "navigating in an offline context succeeded")

      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const setOffline = offlineSwitch(context)
      yield* setOffline(true)
      assert.isTrue(Result.isFailure(yield* navigateOffline(page)), "navigating offline succeeded")
      yield* setOffline(false)
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(responseStatus(navigation), 200)
    })))

  test("BC-024", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })

      const url = server.PREFIX + "/fetch"
      server.setRoute("/fetch", (_request, response) => {
        response.setHeader("Content-Type", "application/json")
        response.end(JSON.stringify("hello"))
      })

      const okResponse = yield* page.evaluateInMainWorld(
        (url) => fetch(url, { cache: "no-store", keepalive: true }).then((response) => response.json()),
        url
      )
      assert.strictEqual(okResponse, "hello")

      yield* offlineSwitch(context)(true)
      const offlineResponse = yield* page.evaluateInMainWorld(async (url) => {
        try {
          const response = await fetch(url, { cache: "no-store", keepalive: true })
          return await response.json()
        } catch {
          return "error"
        }
      }, url)
      assert.strictEqual(offlineResponse, "error")
    })))

  test("BC-025", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      assert.isTrue(yield* page.evaluateInMainWorld(() => window.navigator.onLine))
      const setOffline = offlineSwitch(context)
      yield* setOffline(true)
      assert.isFalse(yield* page.evaluateInMainWorld(() => window.navigator.onLine))
      yield* setOffline(false)
      assert.isTrue(yield* page.evaluateInMainWorld(() => window.navigator.onLine))
    })))

  test("BC-026", { page: false }, ({ browserName, server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isTrue(yield* page.evaluateInMainWorld(() => window.navigator.onLine))
      const setOffline = offlineSwitch(context)
      yield* setOffline(true)
      assert.isFalse(yield* page.evaluateInMainWorld(() => window.navigator.onLine))

      yield* page.goto("about:blank", { waitUntil: "load" })
      assert.isFalse(yield* page.evaluateInMainWorld(() => window.navigator.onLine))
      yield* page.goto("data:text/html,<title>offline</title>", { waitUntil: "load" })
      assert.isFalse(yield* page.evaluateInMainWorld(() => window.navigator.onLine))

      if (browserName === "chromium") {
        // Try a cross-process navigation in Chromium, which allows routing while offline.
        yield* page.route("**/*", () => Route.fulfill(HttpServerResponse.html("<html></html>")))
        yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
        assert.isFalse(yield* page.evaluateInMainWorld(() => window.navigator.onLine))
      }

      yield* setOffline(false)
      assert.isTrue(yield* page.evaluateInMainWorld(() => window.navigator.onLine))
    })))

  test("BC-027", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      // `page.evaluateHandle` in the original: the array the listeners push into, read back on each poll
      yield* page.evaluateInMainWorld(() => {
        const events: Array<string> = []
        ;(window as unknown as { events: Array<string> }).events = events
        window.addEventListener("offline", () => events.push("offline"))
        window.addEventListener("online", () => events.push("online"))
      })
      const events = () => page.evaluateInMainWorld(() => (window as unknown as { events: Array<string> }).events)
      const setOffline = offlineSwitch(context)
      yield* setOffline(true)
      yield* Expect.that(
        events(),
        Condition.make("only the offline event", (value) => JSON.stringify(value) === JSON.stringify(["offline"]))
      )
      yield* setOffline(false)
      yield* Expect.that(
        events(),
        Condition.make("the offline and online events", (value) =>
          JSON.stringify(value) === JSON.stringify(["offline", "online"]))
      )
    })))

  test("BC-028", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ emulation: { media: { colorScheme: "dark" } } })
        const page = yield* context.newPage
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        const popups = yield* Popup.next(page)
        yield* page.evaluateInMainWorld((url) => {
          window.open(url)
        }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
        const popup = yield* popups
        yield* committed(popup, server.EMPTY_PAGE)
        assert.isFalse(yield* popup.evaluateInMainWorld(() => matchMedia("(prefers-color-scheme: light)").matches))
        assert.isTrue(yield* popup.evaluateInMainWorld(() => matchMedia("(prefers-color-scheme: dark)").matches))
      }))

      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage({ emulation: { media: { colorScheme: "light" } } })
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        const popups = yield* Popup.next(page)
        yield* page.evaluateInMainWorld((url) => {
          window.open(url)
        }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
        const popup = yield* popups
        yield* committed(popup, server.EMPTY_PAGE)
        assert.isTrue(yield* popup.evaluateInMainWorld(() => matchMedia("(prefers-color-scheme: light)").matches))
        assert.isFalse(yield* popup.evaluateInMainWorld(() => matchMedia("(prefers-color-scheme: dark)").matches))
      }))
    }))

  test("BC-029", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage({ emulation: { media: { colorScheme: "dark" } } })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/empty.html")
      // `frame.evaluate` in the original, read in the frame's isolated world, which shares the document's media
      assert.isTrue(yield* frame.locator(":root").evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches))
    })))

  test("BC-031", { page: false }, () =>
    Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        const context1 = yield* Browser.newContext()
        const context2 = yield* Browser.newContext()
        yield* Effect.all([
          context1.newPage,
          context1.newPage,
          context2.newPage,
          context2.newPage
        ], { concurrency: "unbounded" })
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const context3 = yield* Browser.newContext()
        yield* Effect.all([context3.newPage, context3.newPage], { concurrency: "unbounded" })
      }))
    }))
})
