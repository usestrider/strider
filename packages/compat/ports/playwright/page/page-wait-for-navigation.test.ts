/**
 * Playwright's `tests/page/page-wait-for-navigation.spec.ts`: waiting for a page's or a frame's navigation, with a load
 * state, a URL, a timeout, and the navigations that don't load a document (fragments, History API entries).
 *
 * What the port changes:
 * - `page.waitForNavigation` is `PageNavigation.next`, which subscribes when it's called and returns the wait. Each
 *   wait is subscribed before the action that starts the navigation, and run as the original awaits it; a `Promise.all`
 *   becomes `Effect.all` with `concurrency: "unbounded"`, and a promise the original holds across steps is `startWaiting`.
 * - Playwright's `waitForNavigation` waits for `load` by default, and Strider's `next` resolves at commit. Each wait
 *   passes `waitUntil: "load"` unless the original names its own load state. Its `"domcontentloaded"` is Strider's
 *   `"domContentLoaded"`.
 * - A wait resolves with a `PageNavigation`, not a response. A `Committed` navigation carries the response as an
 *   `Option`, and `response.ok()` is `status >= 200 && status <= 299`. A navigation that doesn't load a document
 *   (a fragment, a `pushState`, `replaceState`, or a DOM `history.back()`/`forward()`) is `SameDocument`, which Playwright
 *   resolves with `null`: the port asserts that tag, which Strider reports as more specific.
 * - `url` takes a glob or a `URLPattern` string, not a RegExp or a predicate. WA-105 and WA-106 match their RegExps,
 *   and WA-105's predicate on the search string, with a `where` on the navigation's URL, which is the same test.
 * - Frame waits are `PageNavigation.next` with `frames: "all"` and a `where` on the frame's id, which is the frame's
 *   `navigation.frame`. A frame is reached through `page.frames`, not a `Frame` object.
 * - WA-096's `timeout: 5000` is `Deadline.within` around the subscription, whose wait then ends with `Deadline.Timeout`.
 *   Playwright's message, which names the timeout and the URL, isn't checked: Strider's `Timeout` is the typed result.
 * - WA-097 waits for its route to hold the stylesheet's response, not `server.waitForRequest`, which fires before the
 *   route runs.
 * - WA-100 checks the navigation's failure reason, `NavigationFailed` with the browser's `netError`, against the
 *   certificate error Playwright's `expectedSSLError` names for the same browser and platform.
 * - WA-104's `frameattached` is the page's frame tree gaining a child (`page.frames.waitFor`), and its `framenavigated`
 *   is the child's navigation. Playwright's `it.fixme` on WebKit is the upstream's own skip, which doesn't apply: the port
 *   runs it on every browser.
 * - WA-104 stops the frame's loading from the main world through `contentWindow`, a same-origin frame, as the original
 *   does with `frame.evaluate`.
 * - WA-109's frame detach fails the wait with the typed reason Strider gives. Strider has no "frame was detached"
 *   message, so the port asserts that the wait fails with a `PageError` or a `TargetGone`.
 * - `page.evaluate` runs in the page's main world, so each script is `evaluateInMainWorld`, and `page.title()` is
 *   `page.title`.
 */
import { assert } from "@effect/vitest"
import { Deadline, NetworkResponse, Page, PageNavigation, Target } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import type { ServerResponse } from "node:http"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import type { Fixtures } from "../../harness/upstream.ts"
import { upstream } from "../../harness/upstream.ts"

type Committed = Extract<PageNavigation.PageNavigation, { readonly _tag: "Committed" }>

/** The navigation a `goto` or a wait committed. */
const committedOf = (navigation: PageNavigation.PageNavigation): Committed => {
  assert(navigation._tag === "Committed", `the navigation is ${navigation._tag}, not Committed`)
  return navigation
}

/** The response of a committed navigation: a document's, which `about:blank` and `data:` URLs don't have. */
const responseOf = (navigation: Committed): NetworkResponse.NetworkResponse => {
  assert(Option.isSome(navigation.response), "the navigation carried no response")
  return navigation.response.value
}

/** Playwright's `response.ok()`. */
const ok = (response: NetworkResponse.NetworkResponse) => response.status >= 200 && response.status <= 299

/** The reason of a `PageError`, which every failed navigation is. */
const pageReasonOf = (error: unknown) => {
  assert(Page.isPageError(error), `expected a PageError, got ${String(error)}`)
  return error.reason
}

/**
 * Playwright's `expectedSSLError` for the browsers Strider drives: the error a self-signed certificate gives, on the
 * platforms the integration environment runs (Linux, and macOS for Chromium and Firefox).
 */
const sslErrorOf = (browserName: Fixtures["browserName"]): RegExp => {
  if (browserName === "chromium") return /net::(ERR_CERT_AUTHORITY_INVALID|ERR_CERT_INVALID)/
  if (browserName === "webkit") {
    return process.platform === "darwin"
      ? /The certificate for this server is invalid/
      : /Unacceptable TLS certificate|Operation was cancelled/
  }
  // Firefox over WebDriver BiDi
  return /MOZILLA_PKIX_ERROR_SELF_SIGNED_CERT/
}

/**
 * The navigations whose URL a predicate accepts: the original's RegExp or predicate `url`, which Strider's `url` filter
 * doesn't take, as a `where` on the navigation.
 */
const urlMatching = (matches: (url: URL) => boolean) => (navigation: PageNavigation.PageNavigation) =>
  Effect.succeed(matches(new URL(navigation.url)))

/** The navigations of a frame, by its id: the original's `frame.waitForNavigation`, as `frames: "all"` and a predicate. */
const frameOf = (id: Target.NavigableId) => (navigation: PageNavigation.PageNavigation) =>
  Effect.succeed(navigation.frame === id)

upstream(import.meta.filename, {}, (test) => {
  test("WA-095", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      const [navigation] = yield* Effect.all([
        navigated,
        page.evaluateInMainWorld((url: string) => {
          window.location.href = url
        }, server.PREFIX + "/grid.html")
      ], { concurrency: "unbounded" })
      const response = responseOf(committedOf(navigation))
      assert.isTrue(ok(response))
      assert.include(response.url, "grid.html")
    }))

  test("WA-096", ({ page, server }) =>
    Effect.gen(function*() {
      // The timeout is the wait's deadline, set where the wait starts
      const promise = yield* Deadline.within(PageNavigation.next(page, { url: "**/frame.html" }), "5 seconds")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const error = yield* failureOf(promise, "the wait")
      assert.isTrue(Deadline.isTimeout(error))
    }))

  test("WA-097", ({ page, server }) =>
    Effect.gen(function*() {
      let response: ServerResponse | undefined
      // The route signals once it holds the response: the server's `waitForRequest` fires before the route runs
      const held = yield* Deferred.make<void>()
      server.setRoute("/one-style.css", (_req, res) => {
        response = res
        Deferred.doneUnsafe(held, Effect.void)
      })
      const requested = Deferred.await(held)
      const domContentLoadedWait = yield* PageNavigation.next(page, { waitUntil: "domContentLoaded" })
      const domContentLoaded = yield* startWaiting(domContentLoadedWait)
      const loadWait = yield* PageNavigation.next(page, { waitUntil: "load" })
      const bothFired = yield* startWaiting(
        Effect.all([loadWait, domContentLoadedWait], { concurrency: "unbounded" })
      )
      const navigation = yield* startWaiting(page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" }))

      yield* requested
      yield* Fiber.join(domContentLoaded.fiber)
      // The page's load waits for the stylesheet the server is still holding
      assert.isFalse(yield* bothFired.done)
      assert.isDefined(response)
      response.end()
      yield* Fiber.join(bothFired.fiber)
      yield* Fiber.join(navigation.fiber)
    }))

  test("WA-098", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/script.js", (_req, _res) => {})
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("content-type", "text/html")
        res.end("<title>Hello</title><script src=\"script.js\"></script>")
      })
      const committed = yield* PageNavigation.next(page, { waitUntil: "commit" })
      // The original doesn't await this goto, which stays pending while the page's script does
      yield* startWaiting(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }).pipe(Effect.ignore))
      yield* committed
      assert.strictEqual(yield* page.title, "Hello")
    }))

  test("WA-099", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a href='#foobar'>foobar</a>`)
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      const [navigation] = yield* Effect.all([navigated, page.locator("a").click()], { concurrency: "unbounded" })
      // A fragment doesn't load a document, so the navigation is `SameDocument`, where Playwright gives `null`
      assert.strictEqual(navigation._tag, "SameDocument")
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE + "#foobar")
    }))

  test("WA-100", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a href='${server.https.EMPTY_PAGE}'>foobar</a>`)
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      const [error] = yield* Effect.all([
        Effect.result(navigated),
        page.locator("a").click()
      ], { concurrency: "unbounded" })
      assert(Result.isFailure(error), "the navigation to a self-signed server succeeded")
      const reason = pageReasonOf(error.failure)
      assert(reason._tag === "NavigationFailed", `expected NavigationFailed, got ${reason._tag}`)
      assert.match(reason.netError, sslErrorOf(browserName))
    }))

  test("WA-101", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <a onclick='javascript:pushState()'>SPA</a>
    <script>
      function pushState() { history.pushState({}, '', 'wow.html') }
    </script>
  `)
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      const [navigation] = yield* Effect.all([navigated, page.locator("a").click()], { concurrency: "unbounded" })
      assert.strictEqual(navigation._tag, "SameDocument")
      assert.strictEqual(yield* page.url, server.PREFIX + "/wow.html")
    }))

  test("WA-102", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <a onclick='javascript:replaceState()'>SPA</a>
    <script>
      function replaceState() { history.replaceState({}, '', '/replaced.html') }
    </script>
  `)
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      const [navigation] = yield* Effect.all([navigated, page.locator("a").click()], { concurrency: "unbounded" })
      assert.strictEqual(navigation._tag, "SameDocument")
      assert.strictEqual(yield* page.url, server.PREFIX + "/replaced.html")
    }))

  test("WA-103", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <a id=back onclick='javascript:goBack()'>back</a>
    <a id=forward onclick='javascript:goForward()'>forward</a>
    <script>
      function goBack() { history.back(); }
      function goForward() { history.forward(); }
      history.pushState({}, '', '/first.html');
      history.pushState({}, '', '/second.html');
    </script>
  `)
      assert.strictEqual(yield* page.url, server.PREFIX + "/second.html")

      const back = yield* PageNavigation.next(page, { waitUntil: "load" })
      const [backNavigation] = yield* Effect.all([back, page.locator("a#back").click()], {
        concurrency: "unbounded"
      })
      assert.strictEqual(backNavigation._tag, "SameDocument")
      assert.strictEqual(yield* page.url, server.PREFIX + "/first.html")

      const forward = yield* PageNavigation.next(page, { waitUntil: "load" })
      const [forwardNavigation] = yield* Effect.all([forward, page.locator("a#forward").click()], {
        concurrency: "unbounded"
      })
      assert.strictEqual(forwardNavigation._tag, "SameDocument")
      assert.strictEqual(yield* page.url, server.PREFIX + "/second.html")
    }))

  test("WA-104", ({ page, server }) =>
    Effect.gen(function*() {
      // The upstream test is `it.fixme` on WebKit, which is the upstream's own skip: the port runs on every browser
      server.setRoute("/frames/style.css", (_req, _res) => {})
      const mainFrame = (yield* page.frames).id
      // Playwright's `framenavigated` for the child frame: its first navigation, which its document's load makes
      const childNavigated = yield* startWaiting(
        yield* PageNavigation.next(page, { frames: "all" }, (navigation) =>
          Effect.succeed(navigation.frame !== mainFrame))
      )
      // The original doesn't await this goto, which is pending until the frame's stylesheet is answered
      const loaded = yield* startWaiting(
        page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      )
      // Playwright's `frameattached`: the page's frame tree gains a child
      const attached = yield* page.frames.waitFor((tree) =>
        tree.children.length > 0
      )
      const frame = attached.children[0]
      assert.isDefined(frame)
      const navigation = yield* Fiber.join(childNavigated.fiber)
      assert.strictEqual(navigation.frame, frame.id)
      // frame.evaluate(() => window.stop()): the frame is same-origin, so the main world reaches its window
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")?.contentWindow?.stop()
      })
      // The original checks at once, as the stop returns
      assert.isTrue(yield* loaded.done)
    }))

  test("WA-105", ({ page, server }) =>
    Effect.gen(function*() {
      const response1 = yield* startWaiting(
        yield* PageNavigation.next(page, { waitUntil: "load" }, urlMatching((url) => /one-style\.html/.test(url.href)))
      )
      const response2 = yield* startWaiting(
        yield* PageNavigation.next(page, { waitUntil: "load" }, urlMatching((url) => /\/frame.html/.test(url.href)))
      )
      const response3 = yield* startWaiting(
        yield* PageNavigation.next(
          page,
          { waitUntil: "load" },
          urlMatching((url) => url.searchParams.get("foo") === "bar")
        )
      )
      assert.isFalse(yield* response1.done)
      assert.isFalse(yield* response2.done)
      assert.isFalse(yield* response3.done)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isFalse(yield* response1.done)
      assert.isFalse(yield* response2.done)
      assert.isFalse(yield* response3.done)
      yield* page.goto(server.PREFIX + "/frame.html", { waitUntil: "load" })
      assert.isFalse(yield* response1.done)
      yield* Fiber.join(response2.fiber)
      assert.isTrue(yield* response2.done)
      assert.isFalse(yield* response3.done)
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      yield* Fiber.join(response1.fiber)
      assert.isTrue(yield* response1.done)
      assert.isTrue(yield* response2.done)
      assert.isFalse(yield* response3.done)
      yield* page.goto(server.PREFIX + "/frame.html?foo=bar", { waitUntil: "load" })
      yield* Fiber.join(response3.fiber)
      assert.isTrue(yield* response1.done)
      assert.isTrue(yield* response2.done)
      assert.isTrue(yield* response3.done)
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      assert.strictEqual((yield* Fiber.join(response1.fiber)).url, server.PREFIX + "/one-style.html")
      assert.strictEqual((yield* Fiber.join(response2.fiber)).url, server.PREFIX + "/frame.html")
      assert.strictEqual((yield* Fiber.join(response3.fiber)).url, server.PREFIX + "/frame.html?foo=bar")
    }))

  test("WA-106", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const waited = yield* startWaiting(
        yield* PageNavigation.next(page, { waitUntil: "load" }, urlMatching((url) => /third\.html/.test(url.href)))
      )
      assert.isFalse(yield* waited.done)
      yield* page.evaluateInMainWorld(() => {
        history.pushState({}, "", "/first.html")
      })
      assert.isFalse(yield* waited.done)
      yield* page.evaluateInMainWorld(() => {
        history.pushState({}, "", "/second.html")
      })
      assert.isFalse(yield* waited.done)
      yield* page.evaluateInMainWorld(() => {
        history.pushState({}, "", "/third.html")
      })
      yield* Fiber.join(waited.fiber)
      assert.isTrue(yield* waited.done)
    }))

  test("WA-107", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const navigated = yield* PageNavigation.next(page, { waitUntil: "domContentLoaded" })
      const url = server.CROSS_PROCESS_PREFIX + "/empty.html"
      const gotoFiber = yield* startWaiting(page.goto(url, { waitUntil: "load" }))
      const navigation = yield* navigated
      assert.strictEqual(navigation.url, url)
      assert.strictEqual(yield* page.url, url)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.location.href), url)
      yield* Fiber.join(gotoFiber.fiber)
    }))

  test("WA-108", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      const frame = (yield* page.frames).children[0]
      assert.isDefined(frame)
      const navigated = yield* startWaiting(
        yield* PageNavigation.next(page, { frames: "all", waitUntil: "load" }, frameOf(frame.id))
      )
      yield* page.evaluateInMainWorld((url: string) => {
        const child = document.querySelector("iframe")?.contentWindow
        if (child) child.location.href = url
      }, server.PREFIX + "/grid.html")
      const navigation = committedOf(yield* Fiber.join(navigated.fiber))
      assert.isTrue(ok(responseOf(navigation)))
      assert.include(navigation.url, "grid.html")
      // The navigation happened in the frame, not the page
      assert.strictEqual(navigation.frame, frame.id)
      assert.include(yield* page.url, "/frames/one-frame.html")
    }))

  test("WA-109", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      const frame = (yield* page.frames).children[0]
      assert.isDefined(frame)
      server.setRoute("/empty.html", () => {})
      server.setRoute("/one-style.css", () => {})
      const navigated = yield* PageNavigation.next(page, { frames: "all", waitUntil: "load" }, frameOf(frame.id))
      const requested = yield* server.waitForRequest("/one-style.css")
      const [result] = yield* Effect.all([
        Effect.result(navigated),
        page.evaluateInMainWorld((url: string) => {
          const child = document.querySelector("iframe")?.contentWindow
          if (child) child.location.href = url
        }, "/one-style.html"),
        Effect.flatMap(requested, () =>
          // Make sure policy checks pass and navigation actually begins before removing the frame to avoid other errors
          page.evaluateInMainWorld(() => {
            const iframe = document.querySelector("iframe")
            // Playwright's `window.builtins.setTimeout` is its own copy of this; the page runs no script of its own here
            window.setTimeout(() => iframe?.remove(), 0)
          }))
      ], { concurrency: "unbounded" })
      assert(Result.isFailure(result), "the frame's navigation succeeded after the frame was removed")
      // Strider has no "frame was detached" message: the wait fails with a typed reason
      const failure = result.failure
      assert.isTrue(Page.isPageError(failure) || Target.isTargetGone(failure))
    }))
})
