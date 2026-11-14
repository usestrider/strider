/**
 * Playwright's `tests/page/page-navigation.spec.ts`: clicks and form submits that open a `_blank` target, and a
 * cross-origin redirect after a click.
 *
 * What the port changes:
 * - `page.click('"Click me"')` is `page.getByText("Click me", { exact: true }).click()`, Playwright's quoted text
 *   selector, and a submit button's `"Click me"` is `getByRole("button", { name: "Click me" })`.
 * - A click that opens a `_blank` popup is a user gesture, so no `Page.withUserGesture` is needed. NA-069's second click
 *   is on the opener after the first popup took the foreground: Chromium stops painting the hidden opener, so Strider's
 *   click waits for a condition that never holds and times out. The port doesn't `page.activate` first, as Playwright,
 *   which emulates focus, needn't; the test stays failing for that behavior of Strider's.
 * - NA-069 and NA-070's `waitForEvent('popup')` and `waitForNavigation()` are `Popup.next(page)` and
 *   `PageNavigation.next(page, { waitUntil: "load" })`, subscribed before the click that causes them, as the original
 *   subscribes. `waitForNavigation`'s default wait for `load` is passed explicitly.
 * - `page.goto(url)` waits for `load` in Playwright; Strider's default is `commit`, so each `goto` passes
 *   `waitUntil: "load"`.
 * - NA-070's `expect(page).toHaveURL` and `toHaveTitle` are `Expect.toHaveURL` and `Expect.toHaveTitle`.
 */
import { Expect, PageNavigation, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("NA-067", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_request, response) => {
        response.end(`<a href="${server.EMPTY_PAGE}" target="_blank">Click me</a>`)
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.getByText("Click me", { exact: true }).click()
    }))

  test("NA-068", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_request, response) => {
        response.end(`<a href="${server.CROSS_PROCESS_PREFIX}/empty.html" target="_blank">Click me</a>`)
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.getByText("Click me", { exact: true }).click()
    }))

  test("NA-069", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/done.html?", (_request, response) => {
        response.end(`Done`)
      })
      server.setRoute("/done.html", (_request, response) => {
        response.end(`Done`)
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })

      yield* page.setContent(`<form target="_blank" action="done.html" >
    <input type="submit" value="Click me">
  </form>`)
      const first = yield* Popup.next(page)
      yield* page.getByRole("button", { name: "Click me" }).click()
      yield* first

      yield* page.setContent(`<form target="_blank" action="done.html" method="post">
    <input type="submit" value="Click me">
  </form>`)
      const second = yield* Popup.next(page)
      yield* page.getByRole("button", { name: "Click me" }).click()
      yield* second
    }))

  test("NA-070", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/target.html", (_request, response) => response.end("<title>final page</title>"))
      server.setRedirect("/redirect", server.CROSS_PROCESS_PREFIX + "/target.html")
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      yield* page.setContent(`
    <form action="${server.PREFIX}/redirect" method="POST">
      <button type="submit">Submit</button>
    </form>
  `)
      // Waits for the navigation the submit starts, as Playwright's `waitForNavigation` does, to `load`
      const navigation = yield* PageNavigation.next(page, { waitUntil: "load" })
      // triggers POST -> 302 -> cross-origin
      yield* page.locator("button").click()
      yield* navigation
      yield* Expect.toHaveURL(page, server.CROSS_PROCESS_PREFIX + "/target.html")
      yield* Expect.toHaveTitle(page, "final page")
    }))
})
