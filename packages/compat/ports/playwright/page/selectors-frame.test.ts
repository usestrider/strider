/**
 * Playwright's `tests/page/selectors-frame.spec.ts`: entering iframes with `>>` selectors, and the waits, reads, and
 * actions on what's inside them. SE-112 to SE-114, SE-129, SE-131, and SE-132 test only the selector string's syntax
 * errors and are `notApplicable`; SE-124 to SE-128 and SE-130 test the search across every frame that
 * `frameLocator()` with no selector does, which Strider lacks, and are `needsFeature` (see the ledger).
 *
 * What the port changes:
 * - `iframe >> internal:control=enter-frame >> button` is `page.frame(page.locator("iframe")).locator("button")`, and a
 *   nested frame enters a frame locator: `outer.frame(outer.locator("iframe"))`. A frame locator re-resolves its iframe
 *   on each attempt, as the original's selector does.
 * - Strider has no ElementHandle. The original's `body` handle is `page.locator("body")`, and a handle's queries are the
 *   same locator's queries, scoped to it. Each handle read (`$`, `$eval`, `textContent`, `innerHTML`) is the strict read
 *   it stands for, and `$` and `$$` that Playwright answers with null and `[]` without waiting are `count`, which
 *   answers 0 without waiting. A handle stays on the element it was given where a locator finds its element again;
 *   nothing here replaces the body, so the two read the same element.
 * - `innerText()` and `textContent()` are `readText`, the engine's text (whitespace collapsed, which `getByText`
 *   matches), not `innerText`; the buttons read here have plain text, where the two agree.
 * - `waitFor()` and `waitForSelector()` wait for the element to be visible, which is Playwright's default state, so they
 *   are `Expect.toBeVisible`. `innerText()` waits for the element to attach, and Strider's reads don't wait, so SE-116
 *   waits with `Expect.toBeAttached` before its read.
 * - Playwright's `page.route` fulfils the three documents, which `server.setRoute` answers at the same paths.
 * - `page.evaluate` runs in the main world, so it's `page.evaluateInMainWorld`. So are the steps that change the page
 *   through an element (`locator("iframe").evaluate(e => e.remove())`, and setting its `src`): they stand for the page's
 *   change, and the main world makes it on every browser. The `$eval` and `$$eval` tests keep `locator.evaluate` and
 *   `evaluateAll`, which are what they test.
 * - A promise held across steps (`const promise = button.click()`, then an await) is a child fiber started at once,
 *   joined where the original awaits it. A `void` expression is also a fiber, joined before that await, so its failure
 *   is the test's failure, as an unhandled rejection is in Playwright.
 * - Strider's `locator.evaluate` and `evaluateAll` have no main-world form, and stock WebKit has no isolated worlds, so
 *   the `$eval` and `$$eval` tests that reach an element (SE-106, SE-108 to SE-111) fail on WebKit (`isolatedWorlds is
 *   unsupported`). SE-105 passes there, since `NoMatch` answers before a world is needed. The port doesn't work around
 *   it: they test evaluating on a locator.
 * - The `setTimeout` callbacks of SE-116 are a child fiber that sleeps 500 ms, then runs, then sleeps and runs again.
 *   The `page.waitForTimeout(100)` of SE-122 is kept as a sleep: it's the original's step, which lets the click start
 *   before the navigation.
 * - `button:has-text("…")` is `locator("button").filter({ hasText: "…" })`, which matches a case-insensitive substring.
 * - `*css=div >> button` after entering a frame captures the div that has a button, so SE-115 filters the div with
 *   `has`, and reads it. `innerHTML()` is `readHtml` (outerHTML), which holds the div's innerHTML whole and so holds
 *   `<button>` when it does.
 * - SE-123's `waitFor` on a frame whose iframe is a div fails as an `ExpectationFailed` on its first check, where
 *   Playwright's error text names the element. Its last observation is Strider's text for that failure, which names the
 *   `div` and says it isn't an iframe; the port asserts it exactly. A read of the same locator fails with the typed
 *   reason, `WrongElement`, which the port asserts too.
 * - Playwright's `$eval` on a missing element fails "Failed to find element matching selector". Strider's `NoMatch` says
 *   "Nothing matched", so the port asserts the reason and that message.
 */
import { assert } from "@effect/vitest"
import { Expect, Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import type { ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

/** Answers `path` with an HTML document, as Playwright's `route.fulfill({ body, contentType: "text/html" })` does. */
const serveHtml = (server: ServerShape, path: string, html: string) =>
  server.setRoute(path, (_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html)
  })

/**
 * The three documents of Playwright's `routeIframe`: an empty page with an iframe, that iframe with a button, a nested
 * iframe, and two spans, and the nested iframe with its button.
 */
const routeIframe = (server: ServerShape) => {
  serveHtml(server, "/empty.html", `<iframe src="iframe.html"></iframe>`)
  serveHtml(
    server,
    "/iframe.html",
    `
        <html>
          <div>
            <button>Hello iframe</button>
            <iframe src="iframe-2.html"></iframe>
          </div>
          <span>1</span>
          <span>2</span>
        </html>`
  )
  serveHtml(server, "/iframe-2.html", `<html><button tag="iframe2">Hello nested iframe</button></html>`)
}

/** The error of a read or action that Playwright's test expects to fail (its `.catch(e => e)`); one that succeeds fails. */
const failureOf = Effect.fnUntraced(function*(effect: Effect.Effect<unknown, unknown>) {
  const result = yield* Effect.result(effect)
  assert(Result.isFailure(result), "the call succeeded, where Playwright's call fails")
  return result.failure
})

/**
 * An evaluation that found nothing. Playwright's `$eval` fails "page.$eval: Failed to find element matching selector",
 * or "elementHandle.$eval: …" from a handle; Strider's error names its operation and the locator it ran on, and its
 * typed reason is `NoMatch`, whose message says "Nothing matched".
 */
const noMatch = (error: unknown, locator: string) => {
  assert(Locator.isLocatorError(error), String(error))
  assert.strictEqual(error.operation, "Locator.evaluate")
  assert.strictEqual(error.locator, locator)
  assert.strictEqual(error.reason._tag, "NoMatch")
  assert.include(error.message, "Nothing matched")
}

upstream(import.meta.filename, {}, (test) => {
  test("SE-098", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const button = page.frame(page.locator("iframe")).locator("button")
      yield* button.pipe(Expect.toBeVisible)
      assert.strictEqual(yield* button.readText, "Hello iframe")
      yield* Expect.toHaveText(button, "Hello iframe")
      yield* button.click()
    }))

  test("SE-099", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const body = page.locator("body")
      const button = body.frame(body.locator("iframe")).locator("button")
      yield* button.pipe(Expect.toBeVisible)
      assert.strictEqual(yield* button.readText, "Hello iframe")
      assert.strictEqual(yield* button.readText, "Hello iframe")
      yield* button.click()
    }))

  test("SE-100", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const outer = page.frame(page.locator("iframe"))
      const button = outer.frame(outer.locator("iframe")).locator("button")
      yield* button.pipe(Expect.toBeVisible)
      assert.strictEqual(yield* button.readText, "Hello nested iframe")
      yield* Expect.toHaveText(button, "Hello nested iframe")
      yield* button.click()
    }))

  test("SE-101", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const body = page.locator("body")
      const outer = body.frame(body.locator("iframe"))
      const button = outer.frame(outer.locator("iframe")).locator("button")
      yield* button.pipe(Expect.toBeVisible)
      assert.strictEqual(yield* button.readText, "Hello nested iframe")
      assert.strictEqual(yield* button.readText, "Hello nested iframe")
      yield* button.click()
    }))

  test("SE-102", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const frame = page.frame(page.locator("iframe"))
      assert.strictEqual(yield* frame.locator("button").readText, "Hello iframe")
      assert.strictEqual(yield* frame.locator("span").count, 2)
    }))

  test("SE-103", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // No iframe: the reads answer zero at once, where Playwright's `$` answers null without waiting
      assert.strictEqual(yield* page.frame(page.locator("iframe")).locator("canvas").count, 0)
      const body = page.locator("body")
      assert.strictEqual(yield* body.frame(body.locator("iframe")).locator("canvas").count, 0)
    }))

  test("SE-104", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(yield* page.frame(page.locator("iframe")).locator("canvas").count, 0)
      const body = page.locator("body")
      assert.strictEqual(yield* body.frame(body.locator("iframe")).locator("canvas").count, 0)
    }))

  test("SE-105", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      noMatch(
        yield* failureOf(page.frame(page.locator("iframe")).locator("canvas").evaluate(() => 1)),
        `page.frame(page.locator("iframe")).locator("canvas")`
      )
      const body = page.locator("body")
      noMatch(
        yield* failureOf(body.frame(body.locator("iframe")).locator("canvas").evaluate(() => 1)),
        `page.frame(page.locator("body").locator("iframe")).locator("canvas")`
      )
    }))

  test("SE-106", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(
        yield* page.frame(page.locator("iframe")).locator("canvas").evaluateAll((elements) => elements.length),
        0
      )
      const body = page.locator("body")
      assert.strictEqual(
        yield* body.frame(body.locator("iframe")).locator("canvas").evaluateAll((elements) => elements.length),
        0
      )
    }))

  test("SE-107", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const body = page.locator("body")
      const frame = body.frame(body.locator("iframe"))
      assert.strictEqual(yield* frame.locator("button").readText, "Hello iframe")
      assert.strictEqual(yield* frame.locator("span").count, 2)
    }))

  test("SE-108", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const value = yield* page.frame(page.locator("iframe")).locator("button").evaluate((button) => button.nodeName)
      assert.strictEqual(value, "BUTTON")
    }))

  test("SE-109", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const body = page.locator("body")
      const value = yield* body.frame(body.locator("iframe")).locator("button").evaluate((button) => button.nodeName)
      assert.strictEqual(value, "BUTTON")
    }))

  test("SE-110", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const value = yield* page.frame(page.locator("iframe")).locator("span").evaluateAll((spans) =>
        spans.map((span) => span.textContent)
      )
      assert.deepEqual(value, ["1", "2"])
    }))

  test("SE-111", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const body = page.locator("body")
      const value = yield* body.frame(body.locator("iframe")).locator("span").evaluateAll((spans) =>
        spans.map((span) => span.textContent)
      )
      assert.deepEqual(value, ["1", "2"])
    }))

  test("SE-115", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      // The original captures the div that has a button (`*css=div >> button`), and reads the div's innerHTML. The read is
      // `readHtml`, the div's outerHTML, which holds its innerHTML whole, so it holds `<button>` exactly when that does
      const div = page.frame(page.locator("iframe")).locator("div").filter({ has: Locator.relative.locator("button") })
      assert.include(yield* div.readHtml, "<button>")
    }))

  test("SE-116", ({ page, server }) =>
    Effect.gen(function*() {
      serveHtml(server, "/iframe.html", `<html><button>Hello iframe</button></html>`)
      yield* page.goto(server.EMPTY_PAGE)
      // The original's two setTimeout callbacks: a blank iframe appended after 500 ms, and its src set 500 ms later
      const lazy = yield* Effect.forkChild(
        Effect.gen(function*() {
          yield* Effect.sleep("500 millis")
          yield* page.evaluateInMainWorld(() => {
            document.body.appendChild(document.createElement("iframe"))
          })
          yield* Effect.sleep("500 millis")
          yield* page.evaluateInMainWorld(() => {
            const iframe = document.querySelector("iframe") as HTMLIFrameElement
            iframe.src = "iframe.html"
          })
        }),
        { startImmediately: true }
      )
      const button = page.frame(page.locator("iframe")).locator("button")
      // innerText waits for the element to attach, where Strider's read doesn't wait
      const [, text] = yield* Effect.all([
        button.click(),
        button.pipe(Expect.toBeAttached, Effect.andThen(button.readText)),
        Expect.toHaveText(button, "Hello iframe")
      ], { concurrency: "unbounded" })
      assert.strictEqual(text, "Hello iframe")
      yield* Fiber.join(lazy)
    }))

  test("SE-117", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const button = page.frame(page.locator("iframe")).locator("button").filter({ hasText: "Hello nested iframe" })
      const promise = yield* Effect.forkChild(button.pipe(Expect.toBeVisible), { startImmediately: true })
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")!.remove()
      })
      yield* page.evaluateInMainWorld(() => {
        const iframe = document.createElement("iframe")
        iframe.src = "iframe-2.html"
        document.body.appendChild(iframe)
      })
      yield* Fiber.join(promise)
    }))

  test("SE-118", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const body = page.locator("body")
      const button = body.frame(body.locator("iframe")).locator("button").filter({ hasText: "Hello nested iframe" })
      const promise = yield* Effect.forkChild(button.pipe(Expect.toBeVisible), { startImmediately: true })
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")!.remove()
      })
      yield* page.evaluateInMainWorld(() => {
        const iframe = document.createElement("iframe")
        iframe.src = "iframe-2.html"
        document.body.appendChild(iframe)
      })
      yield* Fiber.join(promise)
    }))

  test("SE-119", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const body = page.locator("body")
      const button = body.frame(body.locator("iframe")).locator("button").filter({ hasText: "Hello nested iframe" })
      const promise = yield* Effect.forkChild(button.pipe(Expect.toBeVisible), { startImmediately: true })
      const navigating = yield* Effect.forkChild(
        page.evaluateInMainWorld(() => {
          ;(document.querySelector("iframe") as HTMLIFrameElement).src = "iframe-2.html"
        }),
        { startImmediately: true }
      )
      // The navigation's own failure surfaces first, as Playwright's unawaited call's would
      yield* Fiber.join(navigating)
      yield* Fiber.join(promise)
    }))

  test("SE-120", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const button = page.frame(page.locator("iframe")).locator("button").filter({ hasText: "Hello nested iframe" })
      const promise = yield* Effect.forkChild(button.click(), { startImmediately: true })
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")!.remove()
      })
      yield* page.evaluateInMainWorld(() => {
        const iframe = document.createElement("iframe")
        iframe.src = "iframe-2.html"
        document.body.appendChild(iframe)
      })
      yield* Fiber.join(promise)
    }))

  test("SE-121", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.EMPTY_PAGE)
      const button = page.frame(page.locator("iframe")).locator("button").filter({ hasText: "Hello nested iframe" })
      const promise = yield* Effect.forkChild(button.click(), { startImmediately: true })
      const navigating = yield* Effect.forkChild(
        page.evaluateInMainWorld(() => {
          ;(document.querySelector("iframe") as HTMLIFrameElement).src = "iframe-2.html"
        }),
        { startImmediately: true }
      )
      // The navigation's own failure surfaces first, as Playwright's unawaited call's would
      yield* Fiber.join(navigating)
      yield* Fiber.join(promise)
    }))

  test("SE-122", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.goto(server.PREFIX + "/iframe.html")
      const promise = yield* Effect.forkChild(
        page.locator("button").filter({ hasText: "Hello nested iframe" }).click(),
        { startImmediately: true }
      )
      yield* Effect.sleep("100 millis")
      yield* page.goto(server.PREFIX + "/iframe-2.html")
      yield* Fiber.join(promise)
    }))

  test("SE-123", ({ page, server }) =>
    Effect.gen(function*() {
      routeIframe(server)
      yield* page.setContent("<div></div>")
      const button = page.frame(page.locator("div")).locator("button")
      const failure = yield* failureOf(button.pipe(Expect.toBeVisible))
      assert(Expect.isExpectationFailed(failure), String(failure))
      // A div is never an iframe, so the wait ends on its first check instead of running to the deadline
      assert.strictEqual(failure.checks.count, 1)
      const last = Option.getOrUndefined(Option.map(failure.last, (observed) => observed.value as { error?: string }))
      assert.strictEqual(last?.error, "div on the way isn't an iframe")
      // The same locator read fails with the typed reason
      const read = yield* failureOf(button.readText)
      assert(Locator.isLocatorError(read), String(read))
      assert(read.reason._tag === "WrongElement", read.reason._tag)
      assert.strictEqual(read.reason.expected, "an iframe")
      assert.strictEqual(read.reason.element, "div")
    }))
})
