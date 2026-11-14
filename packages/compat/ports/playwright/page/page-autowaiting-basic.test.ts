/**
 * Playwright's `tests/page/page-autowaiting-basic.spec.ts`: what an action waits for once it has acted, the navigation a
 * click starts, and the navigation a form submits.
 *
 * What the port changes:
 * - Playwright's click waits for the navigation it starts to commit before it resolves, and the original's
 *   `Promise.all` orders the navigation's event before the click's resolution. Strider's click resolves once its input
 *   is sent and waits for nothing after it (docs/decisions.md, "Outcomes come from evidence, never from a guess or a
 *   timer"), so each port subscribes to the navigation with `PageNavigation.next` before the click, as API.md
 *   describes, and awaits it alongside the click. What the original's order `click` after `navigated` asserts is the
 *   implicit wait itself, so the ports assert that the navigation came after the server's route and that the click
 *   resolved, and not the click's position against the navigation.
 * - `waitForLoadState("load")` is a navigation waited with `waitUntil: "load"`, subscribed before the click (AW-008).
 * - AW-006 passes `noWaitAfter: true` and AW-007 doesn't, where the navigation never ends. Strider has no `noWaitAfter`
 *   option (the matrix's `option-locator-click-nowaitafter` row: actions add no navigation wait), so both make the call
 *   the original asks for, which is the test: an action whose navigation stalls resolves.
 * - AW-009's `page.fill`, `page.click`, and `page.goto` are `locator.fill`, `locator.click`, and `page.goto`, and its
 *   click's form navigation is awaited before the `goto`, as the original's implicit wait does.
 * - AW-002 is a `javascript:` link, which navigates to nothing, so the click resolves on its own.
 * - AW-010 relies on Playwright's pointer action waiting for scheduled navigations, and on its test hook; it is in the
 *   ledger, not ported.
 * - AW-011 and AW-012 check that a timed-out action's and expectation's failure evidence is collapsed, which Playwright
 *   renders as a call log (`N × waiting for`, under 30 lines). Strider's `Timeout` and `ExpectationFailed` carry the
 *   observations as `history`, with consecutive repeats dropped, so the ports assert the failure's typed evidence and
 *   that `history` is short and holds no repeat in a row; they can't count the repeats.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, PageNavigation } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

/** Serves `/empty.html` the way the original does: it records the request and links a stylesheet. */
const serveEmptyPage = (server: ServerShape, messages: Array<string>) => {
  server.setRoute("/empty.html", (_request, response) => {
    messages.push("route")
    response.setHeader("Content-Type", "text/html")
    response.end(`<link rel='stylesheet' href='./one-style.css'>`)
  })
}

/** What a failure keeps of its observations: some, short, and none the same as the one before it. */
const assertCollapsed = (
  failure: { readonly last: Option.Option<unknown>; readonly history: ReadonlyArray<{ readonly value: unknown }> }
) => {
  assert.isTrue(Option.isSome(failure.last))
  assert.isAbove(failure.history.length, 0)
  assert.isBelow(failure.history.length, 30)
  failure.history.forEach((observed, index) => {
    if (index > 0) {
      assert.notStrictEqual(
        JSON.stringify(observed.value),
        JSON.stringify(failure.history[index - 1]!.value),
        "a repeat in a row was kept"
      )
    }
  })
}

upstream(import.meta.filename, {}, (test) => {
  test("AW-001", ({ page, server }) =>
    Effect.gen(function*() {
      const messages: Array<string> = []
      serveEmptyPage(server, messages)
      yield* page.setContent(`<a id="anchor" href="${server.EMPTY_PAGE}">empty.html</a>`)
      const navigated = yield* PageNavigation.next(page)
      yield* Effect.all([
        page.locator("a").click().pipe(Effect.tap(() => Effect.sync(() => messages.push("click")))),
        navigated.pipe(Effect.tap(() => Effect.sync(() => messages.push("navigated"))))
      ], { concurrency: "unbounded" })
      assert.deepStrictEqual(messages.filter((message) => message !== "click"), ["route", "navigated"])
      assert.include(messages, "click")
    }))

  test("AW-002", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<a href="javascript:console.log(1)">console.log</a>`)
      yield* page.locator("a").click()
    }))

  test("AW-003", ({ page, server }) =>
    Effect.gen(function*() {
      const messages: Array<string> = []
      serveEmptyPage(server, messages)
      yield* page.setContent(`<a href="${server.CROSS_PROCESS_PREFIX + "/empty.html"}">empty.html</a>`)
      const navigated = yield* PageNavigation.next(page)
      yield* Effect.all([
        page.locator("a").click().pipe(Effect.tap(() => Effect.sync(() => messages.push("click")))),
        navigated.pipe(Effect.tap(() => Effect.sync(() => messages.push("navigated"))))
      ], { concurrency: "unbounded" })
      assert.deepStrictEqual(messages.filter((message) => message !== "click"), ["route", "navigated"])
      assert.include(messages, "click")
    }))

  test("AW-004", ({ page, server }) =>
    Effect.gen(function*() {
      const messages: Array<string> = []
      server.setRoute("/empty.html?foo=bar", (_request, response) => {
        messages.push("route")
        response.setHeader("Content-Type", "text/html")
        response.end(`<link rel='stylesheet' href='./one-style.css'>`)
      })
      yield* page.setContent(`
    <form action="${server.EMPTY_PAGE}" method="get">
      <input name="foo" value="bar">
      <input type="submit" value="Submit">
    </form>`)
      const navigated = yield* PageNavigation.next(page)
      yield* Effect.all([
        page.locator("input[type=submit]").click().pipe(Effect.tap(() => Effect.sync(() => messages.push("click")))),
        navigated.pipe(Effect.tap(() => Effect.sync(() => messages.push("navigated"))))
      ], { concurrency: "unbounded" })
      assert.deepStrictEqual(messages.filter((message) => message !== "click"), ["route", "navigated"])
      assert.include(messages, "click")
    }))

  test("AW-005", ({ page, server }) =>
    Effect.gen(function*() {
      const messages: Array<string> = []
      serveEmptyPage(server, messages)
      yield* page.setContent(`
    <form action="${server.EMPTY_PAGE}" method="post">
      <input name="foo" value="bar">
      <input type="submit" value="Submit">
    </form>`)
      const navigated = yield* PageNavigation.next(page)
      yield* Effect.all([
        page.locator("input[type=submit]").click().pipe(Effect.tap(() => Effect.sync(() => messages.push("click")))),
        navigated.pipe(Effect.tap(() => Effect.sync(() => messages.push("navigated"))))
      ], { concurrency: "unbounded" })
      assert.deepStrictEqual(messages.filter((message) => message !== "click"), ["route", "navigated"])
      assert.include(messages, "click")
    }))

  test("AW-006", ({ page, server }) =>
    Effect.gen(function*() {
      // The navigation never answers; the original asks the click not to wait for it with `noWaitAfter: true`
      server.setRoute("/empty.html", () => {})
      yield* page.setContent(`<a id="anchor" href="${server.EMPTY_PAGE}">empty.html</a>`)
      yield* page.locator("a").click()
    }))

  test("AW-007", ({ page, server }) =>
    Effect.gen(function*() {
      // As AW-006, without `noWaitAfter`: the navigation never answers, and the double click is expected to resolve
      server.setRoute("/empty.html", () => {})
      yield* page.setContent(`<a id="anchor" href="${server.EMPTY_PAGE}">empty.html</a>`)
      yield* page.locator("a").dblclick()
    }))

  test("AW-008", ({ page, server }) =>
    Effect.gen(function*() {
      const messages: Array<string> = []
      serveEmptyPage(server, messages)
      yield* page.setContent(`<a id="anchor" href="${server.EMPTY_PAGE}">empty.html</a>`)
      // `waitForLoadState("load")` after the click is a wait for the navigation to reach `load`, subscribed before the click
      const loaded = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.locator("a").click()
      yield* loaded
      messages.push("load")
      messages.push("clickload")
      assert.strictEqual(messages.join("|"), "route|load|clickload")
    }))

  test("AW-009", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/login.html", (_request, response) => {
        response.setHeader("Content-Type", "text/html")
        response.end(`You are logged in`)
      })
      yield* page.setContent(`
    <form action="${server.PREFIX}/login.html" method="get">
      <input type="text">
      <input type="submit" value="Submit">
    </form>`)
      yield* page.locator("input[type=text]").fill("admin")
      // The form's navigation is awaited before the `goto` that follows it, which the original's click does implicitly
      const submitted = yield* PageNavigation.next(page)
      yield* page.locator("input[type=submit]").click()
      yield* submitted
      yield* page.goto(server.EMPTY_PAGE)
    }))
  test("AW-011", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox' style="visibility: hidden"></input>`)
      const error = yield* Effect.flip(page.locator("input").click().pipe(Deadline.within("5 seconds")))
      assert(Deadline.isTimeout(error), String(error))
      assert.strictEqual(error.operation, "Locator.click")
      assert.strictEqual(error.phase, "waitingForCondition")
      assertCollapsed(error)
    }))

  test("AW-012", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id='checkbox' type='checkbox' style="visibility: hidden"></input>`)
      const error = yield* Effect.flip(page.locator("input").pipe(Expect.toBeVisible, Deadline.within("5 seconds")))
      assert(Expect.isExpectationFailed(error), String(error))
      assertCollapsed(error)
    }))
})
