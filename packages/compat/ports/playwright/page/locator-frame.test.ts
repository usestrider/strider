/**
 * Playwright's `tests/page/locator-frame.spec.ts`: locators inside iframes, entered from the page's locators, with
 * the waiting, strictness, and hidden-frame behaviour that goes with them.
 *
 * What the port changes:
 * - A frame is entered by its iframe element: `page.frameLocator("iframe")` is `page.frame(page.locator("iframe"))`,
 *   and `page.locator("body").frameLocator("iframe")` is `body.frame(body.locator("iframe"))`, built from the same
 *   locator as the original's. Nested frames are `frame.frame(frame.locator("iframe"))`. `locator.contentFrame()` is
 *   `page.frame(iframe)`, since Strider has no `contentFrame` on a locator.
 * - `locator.waitFor()` is `Expect.toBeVisible`, its default state; `waitFor({ state })` is the matching `Expect`:
 *   `hidden` is `toBeHidden`, `detached` is `toBeDetached`, `attached` is `toBeAttached`. `not.toBeVisible()` is
 *   `Expect.toBeHidden`, which passes on a missing element as `not.toBeVisible` does.
 * - `isHidden()` is `!isVisible`, which is what Playwright's `isHidden` means.
 * - Playwright's `goto` waits for `load` by default and Strider's waits for `commit`, so every `goto` here names
 *   `waitUntil: "load"`.
 * - Strider's locators take CSS only, so `button:has-text("…")` is `locator("button").filter({ hasText })`.
 * - The original's `page.evaluate` and `locator.evaluate` calls run in the page's main world, where the test's own
 *   globals are. Strider's `page.evaluate` and `locator.evaluate` run in the isolated world, which can't see them and
 *   which stock WebKit lacks, so these calls are `page.evaluateInMainWorld`, which runs among the page's own
 *   scripts. A same-origin frame's window is reached from there through
 *   `document.querySelector("iframe").contentWindow` (LO-112, which reads the original's `window.__clicked`). LO-108's
 *   frame is cross-origin, so no script of the page's reaches it: its markup keeps the original's
 *   `onclick="window.__clicked=true"` unchanged and adds a separate script that, once that handler has run, copies
 *   `window.__clicked` to a `data-clicked` attribute on `body`, which the test reads as an attribute.
- `page.frames()` and `frames.waitFor` aren't needed: the frame tree is observed through `Expect`.
 * - Waits the original starts with `setTimeout` (LO-093, LO-094, LO-099 to LO-101, LO-112) are the same delays in
 *   the test's own fibers, forked with `Effect.forkChild` and joined where the original awaits them. LO-098 runs its
 *   timers in the page, where the original's `page.evaluate` calls ran.
 * - Playwright's `innerText` waits for its element to attach, and Strider's reads never wait, so LO-098 waits with
 *   `Expect.toBeAttached` before its read. LO-109 reads after `goto` has waited for `load`, so it needs no wait.
 * - Playwright's `.catch(e => e)` is `Effect.result`, and its message checks are Strider's typed errors:
 *   `Deadline.Timeout` for an action or expectation that runs out of time, `ExpectationFailed` for an expectation
 *   that can't hold, with its `history` naming the observation. Strider's messages don't repeat a timeout's budget,
 *   so LO-107 checks the typed budget, and LO-092 and LO-104 check the observation that names the iframe.
 * - The original's `it.fixme(isAndroid)` on LO-094 doesn't apply: Strider isn't Android. LO-108's `it.fixme` on
 *   Firefox is ported and runs on Firefox too, as upstream's other browsers run every test.
 * - LO-107, LO-111, and LO-112 carry Playwright issue annotations, which the port doesn't keep.
 * - LO-108's frame URL is the original's, `https://${server.CROSS_PROCESS_PREFIX}/btn.html`, which begins with a
 *   second scheme; the port keeps it so the test is the one upstream runs.
 * - LO-113 loads `frames/frame.html` from the fixture server; the stylesheet and script it references aren't vendored,
 *   so they 404, which doesn't change what the test reads.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, type Locator, type Page, Route } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { upstream } from "../../harness/upstream.ts"

/** The error of a call that Playwright's test expects to fail (its `.catch(e => e)`); a call that succeeds fails. */
const failureOf = Effect.fnUntraced(function*<A, E, R>(effect: Effect.Effect<A, E, R>) {
  const result = yield* Effect.result(effect)
  assert(Result.isFailure(result), "the call succeeded, where Playwright's call fails")
  return result.failure
})

/** Playwright's `locator.isHidden()`: not visible, a missing element included. */
const isHidden = (locator: Locator.ReadonlyLocator) => Effect.map(locator.isVisible, (visible) => !visible)

/** The original's `button.evaluate(() => window.__clicked)`: the srcdoc iframe is same-origin, so its window is the page's `contentWindow`. */
const clicked = (page: Page.Page) =>
  page.evaluateInMainWorld(() =>
    (document.querySelector("iframe")!.contentWindow as unknown as { __clicked?: boolean }).__clicked
  )

const routeIframe = Effect.fnUntraced(function*(page: Page.Page) {
  yield* page.route(
    "**/empty.html",
    () => Route.fulfill(HttpServerResponse.html(`<iframe src="iframe.html" name="frame1"></iframe>`))
  )
  yield* page.route("**/iframe.html", () =>
    Route.fulfill(
      HttpServerResponse.html(`
        <html>
          <div>
            <button data-testid="buttonId">Hello iframe</button>
            <iframe src="iframe-2.html"></iframe>
          </div>
          <span>1</span>
          <span>2</span>
          <label for=target>Name</label><input id=target type=text placeholder=Placeholder title=Title alt=Alternative>
        </html>`)
    ))
  yield* page.route(
    "**/iframe-2.html",
    () => Route.fulfill(HttpServerResponse.html(`<html><button>Hello nested iframe</button></html>`))
  )
})

const routeAmbiguous = Effect.fnUntraced(function*(page: Page.Page) {
  yield* page.route("**/empty.html", () =>
    Route.fulfill(
      HttpServerResponse.html(`<iframe src="iframe-1.html"></iframe>
             <iframe src="iframe-2.html"></iframe>
             <iframe src="iframe-3.html"></iframe>`)
    ))
  yield* page.route("**/iframe-*", ({ request }) => {
    const path = new URL(request.url).pathname.slice(1)
    return Route.fulfill(HttpServerResponse.html(`<html><button>Hello from ${path}</button></html>`))
  })
})

upstream(import.meta.filename, {}, (test) => {
  test("LO-089", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const button = page.frame(page.locator("iframe")).locator("button")
      yield* Expect.toBeVisible(button)
      assert.strictEqual(yield* button.readText, "Hello iframe")
      yield* Expect.toHaveText(button, "Hello iframe")
      yield* button.click()
    }))

  test("LO-090", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const outer = page.frame(page.locator("iframe"))
      const button = outer.frame(outer.locator("iframe")).locator("button")
      yield* Expect.toBeVisible(button)
      assert.strictEqual(yield* button.readText, "Hello nested iframe")
      yield* Expect.toHaveText(button, "Hello nested iframe")
      yield* button.click()
    }))

  test("LO-091", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* Expect.toHaveText(frame.locator("button"), "Hello iframe")
      yield* Expect.toHaveCount(frame.locator("span"), 2)
    }))

  test("LO-092", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const body = page.locator("body")
      const error = yield* failureOf(
        body.frame(body.locator("iframe")).locator("span").click().pipe(Deadline.within("1 second"))
      )
      assert(Deadline.isTimeout(error), String(error))
      assert.strictEqual(error.operation, "Locator.click")
      // Playwright's message names the iframe it waited for. Strider's last observation of the wait is its typed
      // reason, `NoMatch`, which names no element, so the port asserts that reason.
      assert.strictEqual((Option.getOrUndefined(error.last)?.value as { _tag?: string } | undefined)?._tag, "NoMatch")
    }))

  test("LO-093", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      // The original's `setTimeout(..., 300)` navigates the page while the click waits for its frame
      yield* Effect.forkChild(
        Effect.sleep("300 millis").pipe(
          Effect.andThen(page.goto(server.EMPTY_PAGE, { waitUntil: "load" })),
          Effect.ignore
        )
      )
      yield* page.frame(page.locator("iframe")).locator("button").click()
    }))

  test("LO-094", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The original's `setTimeout(() => page.$eval('iframe', e => e.remove()), 300)`
      yield* Effect.forkChild(
        Effect.sleep("300 millis").pipe(
          Effect.andThen(
            page.evaluateInMainWorld(() => {
              document.querySelector("iframe")!.remove()
            })
          ),
          Effect.ignore
        )
      )
      yield* Expect.toBeHidden(page.frame(page.locator("iframe")).locator("button"))
    }))

  test("LO-095", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* Expect.toBeHidden(page.frame(page.locator("iframe")).locator("span"))
    }))

  test("LO-096", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // `not.toBeVisible()`: a missing element is not visible, as `toBeHidden` says
      yield* Expect.toBeHidden(page.frame(page.locator("iframe")).locator("span"))
    }))

  test("LO-097", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* Expect.toHaveCount(page.frame(page.locator("iframe")).locator("span"), 0)
    }))

  test("LO-098", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/iframe.html", () =>
        Route.fulfill(HttpServerResponse.html(`<html><button>Hello iframe</button></html>`)))
      // An empty page
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The original's two `setTimeout`s, which call `page.evaluate`: a blank iframe is added, then its src is set.
      // The timers run in the page, where the original's evaluations ran.
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          const iframe = document.createElement("iframe")
          document.body.appendChild(iframe)
          setTimeout(() => {
            document.querySelector("iframe")!.src = "iframe.html"
          }, 500)
        }, 500)
      })
      const button = page.frame(page.locator("iframe")).locator("button")
      // Playwright's `innerText` waits for the element to attach; Strider's reads never wait, so the wait is explicit
      const [, text] = yield* Effect.all(
        [
          button.click(),
          Expect.toBeAttached(button).pipe(Effect.andThen(button.readText)),
          Expect.toHaveText(button, "Hello iframe")
        ],
        { concurrency: "unbounded" }
      )
      assert.strictEqual(text, "Hello iframe")
    }))

  test("LO-099", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const button = page.frame(page.locator("iframe")).locator("button").filter({ hasText: "Hello nested iframe" })
      const waiting = yield* Effect.forkChild(Expect.toBeVisible(button))
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")!.remove()
      })
      yield* page.evaluateInMainWorld(() => {
        const iframe = document.createElement("iframe")
        iframe.src = "iframe-2.html"
        document.body.appendChild(iframe)
      })
      yield* Fiber.join(waiting)
    }))

  test("LO-100", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const button = page.frame(page.locator("iframe")).locator("button").filter({ hasText: "Hello nested iframe" })
      const clicking = yield* Effect.forkChild(button.click())
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")!.remove()
      })
      yield* page.evaluateInMainWorld(() => {
        const iframe = document.createElement("iframe")
        iframe.src = "iframe-2.html"
        document.body.appendChild(iframe)
      })
      yield* Fiber.join(clicking)
    }))

  test("LO-101", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const button = page.frame(page.locator("iframe")).locator("button").filter({ hasText: "Hello nested iframe" })
      const clicking = yield* Effect.forkChild(button.click())
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")!.src = "iframe-2.html"
      })
      yield* Fiber.join(clicking)
    }))

  test("LO-102", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      const body = page.locator("div")
      const button = page.frame(body).locator("button")
      const failure = yield* failureOf(Expect.toBeVisible(button))
      assert(Expect.isExpectationFailed(failure), String(failure))
      // Playwright's message quotes the element and says `<iframe>` was expected. Strider's expectation fails at
      // once, with that observation in its history, which names the element as Strider describes it: the element
      // isn't an iframe, and it never will be.
      assert.include(JSON.stringify(failure.history), "div on the way isn't an iframe")
    }))

  test("LO-103", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const body = page.locator("body")
      const button = body.frame(body.locator("iframe")).locator("button")
      yield* Expect.toBeVisible(button)
      assert.strictEqual(yield* button.readText, "Hello iframe")
      yield* Expect.toHaveText(button, "Hello iframe")
      yield* button.click()
    }))

  test("LO-104", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeAmbiguous(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const body = page.locator("body")
      const button = body.frame(body.locator("iframe")).locator("button")
      // Playwright's `waitFor` throws the strict violation at once. An expectation keeps waiting on a strict match,
      // since waiting may narrow it, so the port runs it under a deadline and checks the violation it observed.
      const failure = yield* failureOf(Expect.toBeVisible(button).pipe(Deadline.within("1 second")))
      assert(Expect.isExpectationFailed(failure), String(failure))
      assert.include(JSON.stringify(failure.history), "an iframe on the way matches 3 elements")
    }))

  test("LO-105", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeAmbiguous(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const body = page.locator("body")
      const iframes = body.locator("iframe")
      yield* Expect.toHaveText(body.frame(iframes.first).locator("button"), "Hello from iframe-1.html")
      yield* Expect.toHaveText(body.frame(iframes.nth(1)).locator("button"), "Hello from iframe-2.html")
      yield* Expect.toHaveText(body.frame(iframes.last).locator("button"), "Hello from iframe-3.html")
    }))

  test("LO-106", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* Expect.toHaveText(frame.getByRole("button"), "Hello iframe")
      yield* Expect.toHaveText(frame.getByText("Hello"), "Hello iframe")
      yield* Expect.toHaveText(frame.getByTestId("buttonId"), "Hello iframe")
      yield* Expect.toHaveValue(frame.getByLabel("Name"), "")
      yield* Expect.toHaveValue(frame.getByPlaceholder("Placeholder"), "")
      yield* Expect.toHaveValue(frame.getByAltText("Alternative"), "")
      yield* Expect.toHaveValue(frame.getByTitle("Title"), "")
    }))

  test("LO-107", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("about:blank", { waitUntil: "load" })
      const button = page.frame(page.locator("iframe1")).locator("button")
      assert.isTrue(yield* isHidden(button))
      yield* Expect.toBeHidden(button).pipe(Deadline.within("1 second"))
      yield* Expect.toBeDetached(button).pipe(Deadline.within("1 second"))
      const error = yield* failureOf(Expect.toBeAttached(button).pipe(Deadline.within("1 second")))
      assert(Expect.isExpectationFailed(error), String(error))
      // Playwright's message says `Timeout 1000ms exceeded`. Strider's expectation records how long it ran, which
      // is the budget it was given, and its message names no budget.
      assert.isAtLeast(Duration.toMillis(error.elapsed), 900)
    }))

  test("LO-108", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/empty.html", () =>
        Route.fulfill(
          HttpServerResponse.html(
            `<iframe src="https://${server.CROSS_PROCESS_PREFIX}/btn.html" allow="cross-origin-isolated; fullscreen" sandbox="allow-same-origin allow-scripts allow-popups" ></iframe>`
          ).pipe(HttpServerResponse.setHeaders({
            "cross-origin-embedder-policy": "require-corp",
            "cross-origin-opener-policy": "same-origin",
            "cross-origin-resource-policy": "cross-origin"
          }))
        ))
      // The button's handler is the original's. The frame is cross-origin, so the page can't read its `window`: the
      // added script runs after the button's own handler, as the click reaches the window, and records what that
      // handler set, in the DOM
      yield* page.route("**/btn.html", () =>
        Route.fulfill(
          HttpServerResponse.html(
            `<button onclick="window.__clicked=true">Click target</button>
<script>addEventListener("click", () => document.body.setAttribute("data-clicked", String(window.__clicked)))</script>`
          ).pipe(HttpServerResponse.setHeaders({
            "cross-origin-embedder-policy": "require-corp",
            "cross-origin-opener-policy": "same-origin",
            "cross-origin-resource-policy": "cross-origin"
          }))
        ))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* frame.getByRole("button").click()
      assert.deepStrictEqual(yield* frame.locator("body").readAttribute("data-clicked"), Option.some("true"))
    }))

  test("LO-109", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      assert.strictEqual(yield* frame.locator("button").readText, "Hello iframe")
      yield* Expect.toHaveText(frame.locator("button"), "Hello iframe")
      yield* frame.locator("button").click()
    }))

  test("LO-110", ({ page, server }) =>
    Effect.gen(function*() {
      yield* routeIframe(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const owner = page.frame(page.locator("iframe")).owner
      yield* Expect.toBeVisible(owner)
      assert.deepStrictEqual(yield* owner.readAttribute("name"), Option.some("frame1"))
    }))

  test("LO-111", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <iframe name="hidden" style="visibility: hidden" srcdoc="<button>Hidden</button>"></iframe>
    <div style="visibility: hidden">
      <iframe name="hidden-parent" srcdoc="<button>Hidden parent</button>"></iframe>
      <iframe name="visible-override" style="visibility: visible" srcdoc="<button>Visible override</button>"></iframe>
    </div>
    <iframe name="outer" style="visibility: hidden" srcdoc="<iframe name='inner' srcdoc='<button>Nested</button>'></iframe>"></iframe>
  `)
      const outer = page.frame(page.locator("[name=outer]"))
      const hidden: ReadonlyArray<Locator.ReadonlyLocator> = [
        page.frame(page.locator("[name=hidden]")).locator("button"),
        page.frame(page.locator("[name=hidden-parent]")).locator("button"),
        outer.frame(outer.locator("[name=inner]")).locator("button")
      ]
      for (const button of hidden) {
        yield* Expect.toBeAttached(button)
        assert.isFalse(yield* button.isVisible)
        assert.isTrue(yield* isHidden(button))
        yield* Expect.toBeHidden(button)
        yield* Expect.toBeHidden(button)
        yield* Expect.toBeHidden(button)
      }

      const button = page.frame(page.locator("[name=visible-override]")).locator("button")
      assert.isTrue(yield* button.isVisible)
      yield* Expect.toBeVisible(button)
      yield* Expect.toBeVisible(button)
    }))

  test("LO-112", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<iframe name="frame" style="visibility: hidden" srcdoc="<button onclick='window.__clicked = true'>Button</button>"></iframe>`
      )
      const button = page.frame(page.locator("[name=frame]")).locator("button")
      yield* Expect.toBeHidden(button)

      const error = yield* failureOf(button.click().pipe(Deadline.within("1 second")))
      assert(Deadline.isTimeout(error), String(error))
      assert.isUndefined(yield* clicked(page))

      const clicking = yield* Effect.forkChild(button.click())
      const visible = yield* Effect.forkChild(Expect.toBeVisible(button))
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")!.style.visibility = "visible"
      })
      yield* Fiber.join(clicking)
      yield* Fiber.join(visible)
      assert.isTrue(yield* clicked(page))

      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")!.style.visibility = "hidden"
      })
      yield* Expect.toBeHidden(button)
      assert.isFalse(yield* button.isVisible)
    }))

  test("LO-113", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(
        `<iframe style="visibility: hidden" src="${server.CROSS_PROCESS_PREFIX}/frames/frame.html"></iframe>`
      )
      const div = page.frame(page.locator("iframe")).locator("div")
      yield* Expect.toHaveText(div, `Hi, I'm frame`)
      assert.isFalse(yield* div.isVisible)
      yield* Expect.toBeHidden(div)

      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")!.style.visibility = "visible"
      })
      yield* Expect.toBeVisible(div)
      assert.isTrue(yield* div.isVisible)
    }))
})
