/**
 * Playwright's `tests/page/page-history.spec.ts`: going back and forward through the history, the History API's
 * entries, reloading, and the renderer-initiated navigations a form submit starts.
 *
 * What the port changes:
 * - `goBack`, `goForward`, `goto`, and `reload` wait for `load` in Playwright and resolve at commit in Strider, so each
 *   call the original relies on the default for passes `waitUntil: "load"`.
 * - `goBack` and `goForward` return `Option<PageNavigation>`, not a response. `None` is Playwright's `null` (no history
 *   entry), and a `Committed` navigation carries the response as an `Option`, which is `None` for a `data:` URL.
 *   `response.ok()` is `status >= 200 && status <= 299`, and `response.url()` is the navigation's `url`.
 * - NA-071's `goBack` and `goForward` resolve with the entry's response in Playwright, which launches Chromium without the
 *   back/forward cache. Strider leaves the cache on and reports a restored document as `Restored`, so the port accepts a
 *   `Committed` navigation with an ok response or a `Restored` one, each for the entry's URL.
 * - A history entry that a `pushState` made in the same document is a `SameDocument` navigation, which has no
 *   response. Playwright resolves those with `null`; the port asserts the tag Strider reports.
 * - `page.evaluate` runs in the page's main world, so each page script and page global is `evaluateInMainWorld`.
 *   `page.content()` is `readHtml`, and `page.click("a")` is `page.locator("a").click()`.
 * - NA-073 waits for the console message an exact text names, with a predicate on `ConsoleMessage.next`, since a text
 *   filter matches a substring.
 * - NA-077, NA-083, and NA-084 start a form submit and run the navigation in the handler of the page's first request, as
 *   the original does. Playwright's `.catch(e => {})` on the navigation is `Effect.ignore`, since the original doesn't
 *   check its outcome.
 * - NA-078 holds the reload's response, and waits for the route to hold it, not `server.waitForRequest`, which fires
 *   before the route runs. Its two `pushState` calls aren't awaited, as the original's aren't: they run beside the reload.
 * - NA-085 has a `PW_CLOCK=frozen` skip, which doesn't apply: Strider has no frozen-clock mode, so the test runs.
 * - NA-086's `window.open` is a popup from plain script, which Strider blocks unless it's a user gesture, so the
 *   script runs under `Page.withUserGesture`.
 * - NA-074's `window.didShow` is a page global, read in the main world.
 */
import { assert } from "@effect/vitest"
import {
  Condition,
  ConsoleMessage,
  Expect,
  NetworkRequest,
  NetworkResponse,
  Page,
  PageNavigation,
  Popup
} from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import type { ServerResponse } from "node:http"
import { pathToFileURL } from "node:url"
import { assetPath, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

type Committed = Extract<PageNavigation.PageNavigation, { readonly _tag: "Committed" }>

/** The navigation a `goto` or `reload` committed. */
const committedOf = (navigation: PageNavigation.PageNavigation): Committed => {
  assert(navigation._tag === "Committed", `the navigation is ${navigation._tag}, not Committed`)
  return navigation
}

/**
 * What a traversal that Playwright answers with a response landed on. Playwright launches Chromium with the
 * back/forward cache off, so its `goBack` always loads the entry again and gives that load's response. Strider doesn't
 * turn the cache off, and reports a document the browser restored from it as `Restored`, which has no response, with
 * the entry's URL. The port accepts either, and holds each to what it carries: a `Committed` navigation to the entry's
 * response, an ok one, and a `Restored` one to the entry's URL.
 */
const landedOn = (navigation: PageNavigation.PageNavigation, url: string) => {
  assert(
    navigation._tag === "Committed" || navigation._tag === "Restored",
    `the navigation is ${navigation._tag}, not Committed or Restored`
  )
  assert.include(navigation.url, url)
  if (navigation._tag === "Committed") {
    const response = responseOf(navigation)
    assert.isTrue(ok(response))
    assert.include(response.url, url)
  }
}

/** The navigation a `back` or `forward` made: `None` is the original's `null`, no history entry. */
const traversed = (option: Option.Option<PageNavigation.PageNavigation>): PageNavigation.PageNavigation => {
  assert(Option.isSome(option), "the traversal found no history entry")
  return option.value
}

/** The response of a committed navigation: a document's, which `about:blank` and `data:` URLs don't have. */
const responseOf = (navigation: Committed): NetworkResponse.NetworkResponse => {
  assert(Option.isSome(navigation.response), "the navigation carried no response")
  return navigation.response.value
}

/** Playwright's `response.ok()`. */
const ok = (response: NetworkResponse.NetworkResponse) => response.status >= 200 && response.status <= 299

/** The console message with exactly this text, subscribed to now: the original's `waitForEvent("console", ...)`. */
const consoleText = (page: Page.ObservedPage, text: string) =>
  ConsoleMessage.next(page, undefined, (message) => Effect.succeed(message.text === text))

/** The messages a page logged, in order, as the original's `expect.poll` waits for. */
const messagesAre = (expected: ReadonlyArray<string>) =>
  Condition.make<ReadonlyArray<string>>(
    `the messages ${JSON.stringify(expected)}`,
    (messages) => JSON.stringify(messages) === JSON.stringify(expected)
  )

/**
 * The original's renderer-initiated navigation: a form submit whose request the page makes, and whose handler runs
 * `during` while the request is still pending. The submit is canceled by the navigation, which the original leaves
 * unchecked.
 */
const submitDuring = Effect.fnUntraced(function*(
  page: Page.Page,
  postUrl: string,
  during: Effect.Effect<unknown, unknown, never>
) {
  // The form's POST is the page's first request after the submit
  const requested = yield* NetworkRequest.next(page, { url: postUrl })
  const submitted = yield* startWaiting(page.locator("input[type=submit]").click())
  yield* requested
  yield* Effect.ignore(during)
  yield* Effect.ignore(Fiber.join(submitted.fiber))
})

const formPage = `<form method='POST' action='/post'>Form is here<input type='submit'></form>`

upstream(import.meta.filename, {}, (test) => {
  test("NA-071", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright's `goBack` gives `null` with no history entry, which is `None`
      assert.isTrue(Option.isNone(yield* page.back()))

      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })

      landedOn(traversed(yield* page.back({ waitUntil: "load" })), server.EMPTY_PAGE)
      landedOn(traversed(yield* page.forward({ waitUntil: "load" })), "/grid.html")

      // Nothing ahead of the last entry
      assert.isTrue(Option.isNone(yield* page.forward({ waitUntil: "load" })))
    }))

  test("NA-072", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        history.pushState({}, "", "/first.html")
        history.pushState({}, "", "/second.html")
      })
      assert.strictEqual(yield* page.url, server.PREFIX + "/second.html")

      // Entries within one document are `SameDocument` navigations, which have no response
      let navigation = traversed(yield* page.back({ waitUntil: "load" }))
      assert.strictEqual(navigation._tag, "SameDocument")
      assert.strictEqual(yield* page.url, server.PREFIX + "/first.html")

      navigation = traversed(yield* page.back({ waitUntil: "load" }))
      assert.strictEqual(navigation._tag, "SameDocument")
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE)

      navigation = traversed(yield* page.forward({ waitUntil: "load" }))
      assert.strictEqual(navigation._tag, "SameDocument")
      assert.strictEqual(yield* page.url, server.PREFIX + "/first.html")
    }))

  test("NA-073", ({ page, server }) =>
    Effect.gen(function*() {
      const url1 = pathToFileURL(assetPath("playwright", "consolelog.html")).href
      const url2 = server.PREFIX + "/consolelog.html"
      const loaded1 = yield* consoleText(page, "here:" + url1)
      yield* Effect.all([loaded1, page.goto(url1, { waitUntil: "load" })], { concurrency: "unbounded" })

      yield* page.setContent(`<a href='${url2}'>url2</a>`)
      assert.strictEqual((yield* page.url).toLowerCase(), url1.toLowerCase())

      const loaded2 = yield* consoleText(page, "here:" + url2)
      yield* Effect.all([loaded2, page.locator("a").click()], { concurrency: "unbounded" })
      assert.strictEqual(yield* page.url, url2)

      const backTo1 = yield* consoleText(page, "here:" + url1)
      yield* Effect.all([backTo1, page.back({ waitUntil: "load" })], { concurrency: "unbounded" })
      assert.strictEqual((yield* page.url).toLowerCase(), url1.toLowerCase())
      // Should be able to evaluate in the new context, and not reach for the old cross-process one.
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.scrollX), 0)
      // Should be able to screenshot.
      yield* page.screenshot()

      const forwardTo2 = yield* consoleText(page, "here:" + url2)
      yield* Effect.all([forwardTo2, page.forward({ waitUntil: "load" })], { concurrency: "unbounded" })
      assert.strictEqual(yield* page.url, url2)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.scrollX), 0)
      yield* page.screenshot()
    }))

  test("NA-074", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/cached/bfcached.html", { waitUntil: "load" })
      yield* page.setContent(`<a href=${JSON.stringify(server.PREFIX + "/cached/bfcached.html?foo")}>click me</a>`)
      yield* page.locator("a").click()

      let navigation = traversed(yield* page.back({ waitUntil: "load" }))
      // Strider's navigation has the URL whether the document was restored from the back/forward cache or loaded again
      assert.strictEqual(navigation.url, server.PREFIX + "/cached/bfcached.html")
      // BFCache should be disabled.
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { didShow: Promise<unknown> }).didShow),
        { persisted: false }
      )

      navigation = traversed(yield* page.forward({ waitUntil: "load" }))
      assert.strictEqual(navigation.url, server.PREFIX + "/cached/bfcached.html?foo")
    }))

  test("NA-075", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const globals = window as unknown as Record<string, unknown>
        globals["_foo"] = 10
      })
      yield* page.reload({ waitUntil: "load" })
      assert.isUndefined(
        yield* page.evaluateInMainWorld(() => (window as unknown as Record<string, unknown>)["_foo"])
      )
    }))

  test("NA-076", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("data:text/html,hello", { waitUntil: "load" })
      assert.include(yield* page.readHtml, "hello")
      // A `data:` URL's reload commits with no response, where Playwright's reload gives `null`
      const navigation = committedOf(yield* page.reload({ waitUntil: "load" }))
      assert.isTrue(Option.isNone(navigation.response))
      assert.include(yield* page.readHtml, "hello")
    }))

  test("NA-077", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      yield* page.setContent(formPage)
      server.setRoute("/post", (_req, _res) => {})

      yield* submitDuring(page, server.PREFIX + "/post", page.reload({ waitUntil: "load" }))

      // Form submit should be canceled, and reload should eventually arrive to the original one-style.html.
      yield* Expect.toBeVisible(page.getByText("hello"))
    }))

  test("NA-078", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // 1. Make sure execution contexts are ready for fast evaluate.
      yield* page.evaluateInMainWorld(() => 1)

      // 2. Stall the reload request.
      let response: ServerResponse | undefined
      // The route signals once it holds the response: the server's `waitForRequest` fires before the route runs
      const held = yield* Deferred.make<void>()
      server.setRoute("/empty.html", (_req, res) => {
        response = res
        Deferred.doneUnsafe(held, Effect.void)
      })
      const requested = Deferred.await(held)
      // The reload's body, subscribed before the reload as the original reads it from the reload's response
      const body = yield* NetworkResponse.next(page, {
        url: server.EMPTY_PAGE,
        body: (message) => message.text
      })

      // 3. Trigger push state that could resolve the reload. The original doesn't await it: it runs beside the reload.
      yield* startWaiting(Effect.ignore(page.evaluateInMainWorld(() => {
        window.history.pushState({}, "")
      })))

      // 4. Trigger the reload, it should not resolve.
      const reloaded = yield* startWaiting(page.reload({ waitUntil: "load" }))

      // 5. Trigger push state again, for the good measure :) Not awaited either: the reload is still held.
      yield* startWaiting(Effect.ignore(page.evaluateInMainWorld(() => {
        window.history.pushState({}, "")
      })))

      // 5. Serve the request, it should resolve the reload.
      yield* requested
      assert.isDefined(response)
      response.end("hello")

      // 6. Check the reload response: a committed document, not the same-document navigation a push state made.
      const navigation = committedOf(yield* Fiber.join(reloaded.fiber))
      assert.strictEqual(responseOf(navigation).status, 200)
      assert.strictEqual((yield* body).body, "hello")
    }))

  test("NA-079", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRedirect("/empty.html", server.PREFIX + "/title.html")
      yield* page.reload({ waitUntil: "load" })
      yield* Expect.toHaveURL(page, server.PREFIX + "/title.html")
    }))

  test("NA-080", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRedirect("/empty.html", server.CROSS_PROCESS_PREFIX + "/title.html")
      yield* page.reload({ waitUntil: "load" })
      yield* Expect.toHaveURL(page, server.CROSS_PROCESS_PREFIX + "/title.html")
    }))

  test("NA-081", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE + "#hash", { waitUntil: "load" })
      yield* page.reload({ waitUntil: "load" })
      yield* Expect.toHaveURL(page, server.EMPTY_PAGE + "#hash")
    }))

  test("NA-082", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE + "#", { waitUntil: "load" })
      yield* page.reload({ waitUntil: "load" })
      yield* Expect.toHaveURL(page, server.EMPTY_PAGE + "#")
    }))

  test("NA-083", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(formPage)
      server.setRoute("/post", (_req, _res) => {})

      yield* submitDuring(page, server.PREFIX + "/post", page.back({ waitUntil: "load" }))

      // Form submit should be canceled, and goBack should eventually arrive to the original one-style.html.
      yield* Expect.toBeVisible(page.getByText("hello"))
    }))

  test("NA-084", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      yield* page.back({ waitUntil: "load" })

      yield* page.setContent(formPage)
      server.setRoute("/post", (_req, _res) => {})

      yield* submitDuring(page, server.PREFIX + "/post", page.forward({ waitUntil: "load" }))

      // Form submit should be canceled, and goForward should eventually arrive to the original one-style.html.
      yield* Expect.toBeVisible(page.getByText("hello"))
    }))

  test("NA-085", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/iframe.html", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        // iframe access parent frame to log a value from it.
        res.end(`
      <!doctype html>
      <script type="text/javascript">
        console.log(window.parent.foo);
      </script>
    `)
      })
      server.setRoute("/main.html", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        res.end(`
      <!doctype html>
      <iframe id=myframe src="about:blank"></iframe>
      <script type="text/javascript">
        setTimeout(() => window.foo = 'foo', 0);
        setTimeout(() => myframe.contentDocument.location.href = '${server.PREFIX}/iframe.html', 0);
      </script>
    `)
      })
      const messages: Array<string> = []
      const logged = yield* ConsoleMessage.stream(page)
      yield* logged.pipe(
        Stream.runForEach((message) =>
          Effect.sync(() => {
            messages.push(message.text)
          })
        ),
        Effect.forkChild
      )
      yield* page.goto(server.PREFIX + "/main.html", { waitUntil: "load" })
      yield* Expect.that(Effect.sync(() => [...messages]), messagesAre(["foo"]))
      yield* page.reload({ waitUntil: "load" })
      yield* Expect.that(Effect.sync(() => [...messages]), messagesAre(["foo", "foo"]))
    }))

  test("NA-086", ({ page, server }) =>
    Effect.gen(function*() {
      let mainRequest = 0
      let popupRequest = 0
      server.setRoute("/main.html", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        res.end(`<!doctype html><h1>main: ${++mainRequest}</h1>`)
      })
      server.setRoute("/popup.html", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        res.end(`<!doctype html><h1>popup: ${++popupRequest}</h1>`)
      })
      yield* page.goto(server.PREFIX + "/main.html", { waitUntil: "load" })
      // The popup is opened from script, which Strider blocks unless it's a user gesture
      const popups = yield* Popup.next(page)
      const [popup] = yield* Effect.all([
        popups,
        page.evaluateInMainWorld(() => {
          window.open("/popup.html")
        }).pipe(Page.withUserGesture)
      ], { concurrency: "unbounded" })
      yield* Expect.toHaveText(page.locator("h1"), "main: 1")
      yield* Expect.toHaveText(popup.locator("h1"), "popup: 1")

      yield* page.reload({ waitUntil: "load" })
      yield* Expect.toHaveText(page.locator("h1"), "main: 2")
      yield* Expect.toHaveText(popup.locator("h1"), "popup: 1")

      yield* popup.reload({ waitUntil: "load" })
      yield* Expect.toHaveText(page.locator("h1"), "main: 2")
      yield* Expect.toHaveText(popup.locator("h1"), "popup: 2")
    }))
})
