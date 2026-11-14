/**
 * Playwright's `tests/library/browsercontext-network-event.spec.ts`: the request and response events a context reports for
 * every page in it. Its `requestfailed` and `requestfinished` events, which Strider has no counterpart of (matrix rows
 * event-browsercontext-requestfailed and event-browsercontext-requestfinished), are in the ledger.
 *
 * What the port changes:
 * - `context.on("request")` and `context.on("response")` are read from the context's request and response histories after
 *   the page has loaded, as page-network-request.test.ts reads a page's. Playwright's listener sees each event as it
 *   happens; the history holds the same events, and each read comes after the navigation it checks.
 * - The `context` is the harness page's context, and `waitForEvent("page")` for a popup is `Popup.next` on the page that
 *   opens it, as page-network-request.test.ts's NE-027 does.
 * - `page1.waitForLoadState()` is the popup's status reaching `complete` after its URL is the one the link opens.
 * - Playwright's `response.url()` and the favicon filter are as in page-event-network.test.ts.
 * - NE-127's `response.finished()` isn't a Strider call. The port reads the response's body, which Strider resolves once the
 *   body has loaded, and `finished()`'s rejection when the context closes is the body's wait failing with `TargetGone`. The
 *   context is closed with the scope that made it, which is what `page.context().close()` does.
 * - NE-127 starts its fetch in the page's main world, as the original's `page.evaluate` does. The fetch resolves on the
 *   headers, before the body, as the original's does.
 */
import { assert } from "@effect/vitest"
import {
  Browser,
  NetworkRequest,
  NetworkResponse,
  type Page,
  Popup,
  Target,
  type UserContext
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The page's status once its document has loaded: Playwright's `waitForLoadState()`. */
const loaded = (status: Page.Status) => status._tag === "Open" && status.document.readiness === "complete"

/** The URL of an event's request, or response, when the browser's own `/favicon.ico` isn't it. */
const isNotFavicon = (url: string) => new URL(url).pathname !== "/favicon.ico"

/** The requests a context has sent since it was created, except the browser's own `/favicon.ico`. */
const requestsOf = Effect.fnUntraced(function*(context: UserContext.UserContext) {
  const history = yield* NetworkRequest.history(context)
  // A missing entry proves nothing unless nothing was dropped
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((request) => isNotFavicon(request.url))
})

/** The responses a context has received since it was created, except the browser's own `/favicon.ico`. */
const responsesOf = Effect.fnUntraced(function*(context: UserContext.UserContext) {
  const history = yield* NetworkResponse.history(context)
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((response) => isNotFavicon(response.url))
})

upstream(import.meta.filename, {}, (test) => {
  test("NE-121", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a target=_blank rel=noopener href="/one-style.html">yo</a>`)
      const popupWait = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* popupWait
      yield* popup.url.waitFor((url) => url === server.PREFIX + "/one-style.html")
      yield* popup.status.waitFor(loaded)
      const urls = (yield* requestsOf(page.context)).map((request) => request.url)
      assert.deepStrictEqual(urls, [
        server.EMPTY_PAGE,
        `${server.PREFIX}/one-style.html`,
        `${server.PREFIX}/one-style.css`
      ])
    }))

  test("NE-122", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a target=_blank rel=noopener href="/one-style.html">yo</a>`)
      const popupWait = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* popupWait
      yield* popup.url.waitFor((url) => url === server.PREFIX + "/one-style.html")
      yield* popup.status.waitFor(loaded)
      const urls = (yield* responsesOf(page.context)).map((response) => response.url)
      assert.deepStrictEqual(urls, [
        server.EMPTY_PAGE,
        `${server.PREFIX}/one-style.html`,
        `${server.PREFIX}/one-style.css`
      ])
    }))

  test("NE-127", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      // The context is made and closed here, as the original's `page.context().close()` closes the one it runs in
      const scope = yield* Scope.make()
      const context = yield* Browser.newContext().pipe(Scope.provide(scope))
      const page: Page.Page = yield* context.newPage.pipe(Scope.provide(scope))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      server.setRoute("/get", (_req, res) => {
        // In Firefox, |fetch| will be hanging until it receives |Content-Type| header
        // from server.
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        res.write("hello ")
      })
      // The response and its body are subscribed before the request; the body never ends, so it's still waiting
      const finished = yield* NetworkResponse.next(page, {
        url: server.PREFIX + "/get",
        body: (message) => message.text
      })
      const finishing = yield* startWaiting(finished)
      // send request and wait for server response
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./get", { method: "GET" })
      })
      yield* Scope.close(scope, Exit.void)
      const error = yield* failureOf(Fiber.join(finishing.fiber), "the body's wait")
      assert(Target.isTargetGone(error), String(error))
    }))
})
