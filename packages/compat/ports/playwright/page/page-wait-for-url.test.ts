/**
 * Playwright's `tests/page/page-wait-for-url.spec.ts`: `page.waitForURL`, which waits until the page's URL matches,
 * through navigations, history changes and frames.
 *
 * What the port changes:
 * - `page.waitForURL(url)` is `Expect.toHaveURL(page, url)`, which retries until the URL matches. It takes a
 *   full URL or a regular expression, not a glob (the globs of `Url.Pattern` serve event filters, not this matcher),
 *   so each glob is the one full URL it matches on the test server (`'**\/grid.html'` is `server.PREFIX + "/grid.html"`);
 *   WA-119's regular expression is the original's own. Playwright's wait also waits for `load` by default; Strider's URL expectation
 *   doesn't (method-page-waitforurl), so the port asserts only the URL, which is what the tests check.
 * - WA-112 asks for `waitUntil` on the URL wait. Strider has no such option (option-page-waitforurl-waituntil), so it
 *   isn't ported (see the ledger).
 * - WA-111's `{ timeout: 2500 }` is `Deadline.within("2500 millis")`. The expectation fails as `ExpectationFailed`, and
 *   the port asserts it ran for about the 2500 ms the original names in its message (its `elapsed`, which the deadline
 *   bounds from below only: the failure is reported after the budget runs out), and saw the page stay on `empty.html`.
 * - WA-113's `page.goto(...).catch(() => {})` is a forked navigation whose failure is ignored, as the original ignores
 *   it. Its script never loads, so the original's navigation never resolves; Strider's `goto` resolves at commit, the
 *   point `waitUntil: "commit"` waits for.
 * - WA-119's `expect(resolved).toBe(false)` after each `history.pushState` is a wait started before the first call,
 *   checked with `done` after each one, as the original's `resolved` flag is.
 * - WA-120's `frame.evaluate(…)` runs in the frame's main world through `document.querySelector("iframe")`, and
 *   `frame.waitForURL` waits on the frame's URL in the page's frame tree (`page.frames`), since Strider's URL
 *   expectations take a page only.
 * - `page.evaluate(…)` is `page.evaluateInMainWorld`, and `page.url()` is `page.url`.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("WA-110", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld((url) => {
        window.location.href = url
      }, server.PREFIX + "/grid.html")
      yield* Expect.toHaveURL(page, server.PREFIX + "/grid.html")
    }))

  test("WA-111", ({ page, server }) =>
    Effect.gen(function*() {
      const wait = yield* startWaiting(
        Effect.result(Expect.toHaveURL(page, server.PREFIX + "/frame.html").pipe(Deadline.within("2500 millis")))
      )
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const result = yield* Fiber.join(wait.fiber)
      assert(Result.isFailure(result), "the wait for frame.html succeeded, where it should time out")
      // An expectation that runs out of its deadline fails as `ExpectationFailed`, which says how long it ran
      assert(Expect.isExpectationFailed(result.failure), `expected ExpectationFailed, got ${String(result.failure)}`)
      // The deadline ends the wait, so it ran for the budget it was given (measured from inside the wait, a moment
      // after the budget began, and reported a moment after it ran out), and the last URL it saw is the one it never left
      assert.isAbove(Duration.toMillis(result.failure.elapsed), 2400)
      assert.strictEqual(Option.getOrUndefined(result.failure.last)?.value, server.EMPTY_PAGE)
    }))

  test("WA-113", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/script.js", () => {})
      server.setRoute("/empty.html", (_request, response) => {
        response.setHeader("content-type", "text/html")
        response.end("<title>Hello</title><script src=\"script.js\"></script>")
      })
      // Not awaited, as the original doesn't await it: its script holds the load, and its failure is ignored
      yield* startWaiting(Effect.ignore(page.goto(server.EMPTY_PAGE)))
      yield* Expect.toHaveURL(page, server.EMPTY_PAGE)
      assert.strictEqual(yield* page.title, "Hello")
    }))

  test("WA-114", ({ page }) =>
    Effect.gen(function*() {
      yield* Expect.toHaveURL(page, "about:blank")
    }))

  test("WA-115", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a href='#foobar'>foobar</a>`)
      yield* page.locator("a").click()
      // `'**\/*#foobar'`
      yield* Expect.toHaveURL(page, server.EMPTY_PAGE + "#foobar")
    }))

  test("WA-116", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <a onclick='javascript:pushState()'>SPA</a>
    <script>
      function pushState() { history.pushState({}, '', 'wow.html') }
    </script>
  `)
      yield* page.locator("a").click()
      yield* Expect.toHaveURL(page, server.PREFIX + "/wow.html")
      assert.strictEqual(yield* page.url, server.PREFIX + "/wow.html")
    }))

  test("WA-117", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <a onclick='javascript:replaceState()'>SPA</a>
    <script>
      function replaceState() { history.replaceState({}, '', '/replaced.html') }
    </script>
  `)
      yield* page.locator("a").click()
      yield* Expect.toHaveURL(page, server.PREFIX + "/replaced.html")
      assert.strictEqual(yield* page.url, server.PREFIX + "/replaced.html")
    }))

  test("WA-118", ({ page, server }) =>
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

      yield* page.locator("a#back").click()
      yield* Expect.toHaveURL(page, server.PREFIX + "/first.html")
      assert.strictEqual(yield* page.url, server.PREFIX + "/first.html")

      yield* page.locator("a#forward").click()
      yield* Expect.toHaveURL(page, server.PREFIX + "/second.html")
      assert.strictEqual(yield* page.url, server.PREFIX + "/second.html")
    }))

  test("WA-119", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const wait = yield* startWaiting(Expect.toHaveURL(page, /third\.html/))
      assert.isFalse(yield* wait.done)
      yield* page.evaluateInMainWorld(() => {
        history.pushState({}, "", "/first.html")
      })
      assert.isFalse(yield* wait.done)
      yield* page.evaluateInMainWorld(() => {
        history.pushState({}, "", "/second.html")
      })
      assert.isFalse(yield* wait.done)
      yield* page.evaluateInMainWorld(() => {
        history.pushState({}, "", "/third.html")
      })
      yield* Fiber.join(wait.fiber)
      assert.isTrue(yield* wait.done)
    }))

  test("WA-120", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      // `frame.evaluate(url => window.location.href = url)` in the frame's own window
      yield* page.evaluateInMainWorld((url) => {
        const frame = document.querySelector("iframe") as HTMLIFrameElement
        ;(frame.contentWindow as Window).location.href = url
      }, server.PREFIX + "/grid.html")
      // `frame.waitForURL('**\/grid.html')`: the first child frame's URL in the page's frame tree
      yield* page.frames.waitFor((tree) => {
        const [frame] = tree.children
        return frame !== undefined && frame.url === server.PREFIX + "/grid.html"
      })
    }))
})
