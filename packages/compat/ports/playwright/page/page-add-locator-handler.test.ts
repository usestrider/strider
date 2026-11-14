/**
 * Playwright's `tests/page/page-add-locator-handler.spec.ts`: a handler the page registers for an overlay, which an
 * action or a waiting assertion runs before it proceeds when the overlay shows. LH-001 to LH-007 and LH-009 to LH-014
 * are ported; LH-008 is `notApplicable` (a screenshot golden; see the ledger).
 *
 * What the port changes:
 * - `page.addLocatorHandler(locator, handler, options)` is the same call. Its registration lives in the test's scope and
 *   is the value the call returns, where Playwright's handler stays until `removeLocatorHandler`. LH-014's
 *   `page.removeLocatorHandler(locator)` is that registration's `remove`: Strider removes by registration, not by a
 *   locator equal to the one registered (see the ledger).
 * - A handler is an Effect, given the locator it was registered for. Playwright's `expect(locatorArgument).toBe(
 *   originalLocator)` inside the handler is recorded (`received`) and asserted in the test body, after each case, so it
 *   also fails when the handler never ran.
 * - `page.evaluate` runs in the main world, which is `page.evaluateInMainWorld`: the page's `setupAnnoyingInterstitial`
 *   and `window.clicked` are its own globals.
 * - The page's own script calls `window.builtins.setTimeout`, Playwright's copy of the timer that every page it
 *   controls gets. Strider injects nothing, so the port adds an init script that defines `window.builtins.setTimeout`
 *   as the page's own `setTimeout`, which is what Playwright's copy is, before the page loads. The page itself is
 *   unchanged.
 * - `{ timeout: ms }` on an action is `Deadline.within(ms)` around it; the timed-out action fails with Strider's
 *   `Deadline.Timeout`, where Playwright's message says `Timeout 3000ms exceeded`. Its `{ force: true }` is
 *   `{ checks: forceChecks }`.
 * - `expect(...).not.toBeVisible()` is `Expect.toBeHidden`, and `locator.waitFor()` (LH-007) is `Expect.toBeVisible`, its
 *   default state.
 * - `page.$eval('#target', e => getComputedStyle(e).backgroundColor)` is a `page.evaluateInMainWorld` over
 *   `document.querySelector("#target")`, and `page.$('iframe')` is the count of the page's `iframe` locator.
 * - Playwright's error messages carry a call log: "intercepts pointer events", "locator handler has finished, waiting
 *   for … to be hidden". The port asserts Strider's typed `Timeout`, and what it last observed (`Covered`) or says
 *   (`hint`) where the original checks that text.
 * - `test.skip(!headless, …)` on LH-003 doesn't apply: Strider's browsers run headless.
 * - LH-005's handler, which Playwright keeps running after the action that entered it timed out, is a handler that waits
 *   on a latch the test releases; the port bounds its wait for the handler's result.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, type Locator, type Page } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { failureOf, forceChecks } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The reason a timed-out action last observed, as Strider records it. */
type Reason = { readonly _tag: string; readonly by?: string }

const reasonOf = (timeout: Deadline.Timeout): Reason | undefined =>
  Option.getOrUndefined(Option.map(timeout.last, (observed) => observed.value as Reason))

/** The fixture page, with the `window.builtins` Playwright gives every page its own script runs in. */
const openInterstitialPage = Effect.fnUntraced(function*(page: Page.Page, prefix: string) {
  // Playwright's `window.builtins.setTimeout` is a copy of the page's own `setTimeout`; Strider has none, and the
  // page's script calls it when its interstitial closes after a delay
  yield* page.addInitScript(() => {
    ;(window as any).builtins = { setTimeout: window.setTimeout.bind(window) }
  })
  yield* page.goto(prefix + "/input/handle-locator.html", { waitUntil: "load" })
})

/** The page's `setupAnnoyingInterstitial(...args)` in the main world, after resetting `window.clicked`. */
const setupInterstitial = (page: Page.Page, ...args: [string, number] | [string, number, string]) =>
  page.evaluateInMainWorld((args) => {
    ;(window as any).clicked = 0
    ;(window as any).setupAnnoyingInterstitial(...args)
  }, args)

/** `window.clicked`, which the page's target counts its clicks in. */
const clicked = (page: Page.Page) => page.evaluateInMainWorld(() => (window as any).clicked as number | undefined)

/** A click, a hover, or an assertion the original runs with a timeout, as Strider's `Timeout` of that action. */
const timedOut = (error: unknown, operation: string) => {
  assert(Deadline.isTimeout(error), String(error))
  assert.strictEqual(error.operation, operation)
  return error
}

upstream(import.meta.filename, {}, (test) => {
  test("LH-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      let beforeCount = 0
      let afterCount = 0
      const received: Array<Locator.Locator> = []
      const originalLocator = page.getByText("This interstitial covers the button")
      yield* page.addLocatorHandler(originalLocator, (locatorArgument) =>
        Effect.gen(function*() {
          received.push(locatorArgument)
          ++beforeCount
          yield* page.locator("#close").click()
          ++afterCount
        }))

      const cases: Array<[string, number] | [string, number, string]> = [
        ["mouseover", 1],
        ["mouseover", 1, "capture"],
        ["mouseover", 2],
        ["mouseover", 2, "capture"],
        ["pointerover", 1],
        ["pointerover", 1, "capture"],
        ["none", 1],
        ["remove", 1],
        ["hide", 1]
      ]
      for (const args of cases) {
        yield* page.locator("#aside").hover()
        beforeCount = 0
        afterCount = 0
        received.length = 0
        yield* setupInterstitial(page, ...args)
        assert.strictEqual(beforeCount, 0)
        assert.strictEqual(afterCount, 0)
        yield* page.locator("#target").click()
        assert.strictEqual(beforeCount, args[1], `${args.join(" ")}: handler runs before`)
        assert.strictEqual(afterCount, args[1], `${args.join(" ")}: handler runs after`)
        // `expect(locatorArgument).toBe(originalLocator)`: the handler is given the locator it was registered for
        assert.strictEqual(received.length, args[1])
        for (const argument of received) assert.strictEqual(argument, originalLocator)
        assert.strictEqual(yield* clicked(page), 1, `${args.join(" ")}: the target is clicked once`)
        yield* Expect.toBeHidden(page.locator("#interstitial"))
      }
    }))

  test("LH-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      yield* page.addLocatorHandler(page.locator("body"), () =>
        Effect.gen(function*() {
          if (yield* page.getByText("This interstitial covers the button").isVisible) {
            yield* page.locator("#close").click()
          }
        }), { noWaitAfter: true })

      const cases: Array<[string, number]> = [["mouseover", 2], ["none", 1], ["remove", 1], ["hide", 1]]
      for (const args of cases) {
        yield* page.locator("#aside").hover()
        yield* setupInterstitial(page, ...args)
        yield* page.locator("#target").click()
        assert.strictEqual(yield* clicked(page), 1, `${args.join(" ")}: the target is clicked once`)
        yield* Expect.toBeHidden(page.locator("#interstitial"))
      }
    }))

  test("LH-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      yield* page.addLocatorHandler(page.getByText("This interstitial covers the button"), () =>
        page.locator("#close").click())

      yield* page.locator("#aside").hover()
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).setupAnnoyingInterstitial("pointerover", 1, "capture")
      })
      yield* page.locator("#target").hover()
      yield* Expect.toBeHidden(page.locator("#interstitial"))
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() =>
          window.getComputedStyle(document.querySelector("#target")!).backgroundColor
        ),
        "rgb(255, 255, 0)"
      )
    }))

  test("LH-004", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      yield* page.addLocatorHandler(page.getByText("This interstitial covers the button"), () =>
        page.locator("#close").click())

      yield* page.locator("#aside").hover()
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).setupAnnoyingInterstitial("none", 1)
      })
      yield* page.locator("#target").click({ checks: forceChecks }).pipe(Deadline.within("2 seconds"))
      assert.isTrue(yield* page.locator("#interstitial").isVisible)
      assert.strictEqual(yield* clicked(page), undefined)
    }))

  test("LH-005", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      let called = 0
      const releaseHandler = yield* Deferred.make<void>()
      const handlerFinished = yield* Deferred.make<Result.Result<void, unknown>>()
      yield* page.addLocatorHandler(page.getByText("This interstitial covers the button"), () =>
        Effect.gen(function*() {
          ++called
          // Deliberately timeout.
          yield* Deferred.await(releaseHandler)
          yield* Deferred.succeed(
            handlerFinished,
            yield* Effect.result(page.locator("#close").click().pipe(Deadline.within("3 seconds")))
          )
        }))

      yield* page.locator("#aside").hover()
      yield* setupInterstitial(page, "mouseover", 1)
      const error = yield* failureOf(
        page.locator("#target").click().pipe(Deadline.within("3 seconds")),
        "the first click"
      )
      timedOut(error, "Locator.click")

      const error2 = yield* failureOf(
        page.locator("#target").click().pipe(Deadline.within("3 seconds")),
        "the second click"
      )
      timedOut(error2, "Locator.click")

      // Should not enter the same handler while it is still running.
      assert.strictEqual(called, 1)

      yield* Deferred.succeed(releaseHandler, undefined)
      // The handler's own click finishes, with no error; bounded so a handler that never finishes says so
      const finished = yield* Deferred.await(handlerFinished).pipe(
        Effect.timeoutOption("5 seconds")
      )
      assert(Option.isSome(finished), "the handler never finished after it was released")
      assert(
        Result.isSuccess(finished.value),
        `the handler's click failed: ${String(Result.getFailure(finished.value))}`
      )
    }))

  test("LH-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      let called = 0
      yield* page.addLocatorHandler(page.getByText("This interstitial covers the button"), () =>
        Effect.gen(function*() {
          ++called
          yield* page.locator("#close").click()
        }))

      yield* setupInterstitial(page, "remove", 1)
      yield* Expect.toBeVisible(page.locator("#target"))
      yield* Expect.toBeHidden(page.locator("#interstitial"))
      assert.strictEqual(called, 1)
    }))

  test("LH-007", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      let called = 0
      yield* page.addLocatorHandler(page.getByText("This interstitial covers the button"), () =>
        Effect.gen(function*() {
          ++called
          yield* page.locator("#close").click()
        }))

      yield* setupInterstitial(page, "remove", 1)
      // `locator.waitFor()` waits for the default state, visible
      yield* Expect.toBeVisible(page.locator("#target"))
      yield* Expect.toBeHidden(page.locator("#interstitial"))
      assert.strictEqual(called, 1)
    }))

  test("LH-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })

      yield* page.evaluateInMainWorld(() => {
        const iframe = document.createElement("iframe")
        iframe.src = "data:text/html,<body>hello from iframe</body>"
        document.body.append(iframe)

        const target = document.createElement("button")
        target.textContent = "Click me"
        target.id = "target"
        target.addEventListener("click", () => (window as any)._clicked = true)
        document.body.appendChild(target)

        const closeButton = document.createElement("button")
        closeButton.textContent = "close"
        closeButton.id = "close"
        closeButton.addEventListener("click", () => iframe.remove())
        document.body.appendChild(closeButton)
      })

      yield* page.addLocatorHandler(page.frame(page.locator("iframe")).locator("body"), () =>
        page.locator("#close").click())

      yield* page.locator("#target").click()
      // `page.$('iframe')` is null
      assert.strictEqual(yield* page.locator("iframe").count, 0)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() =>
          (window as any)._clicked
        ),
        true
      )
    }))

  test("LH-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      let called = 0
      yield* page.addLocatorHandler(page.locator("body"), () =>
        Effect.sync(() => {
          ++called
        }), { noWaitAfter: true, times: 2 })

      yield* page.locator("#aside").hover()
      yield* setupInterstitial(page, "mouseover", 4)
      const error = yield* failureOf(
        page.locator("#target").click().pipe(Deadline.within("3 seconds")),
        "the click"
      )
      assert.strictEqual(called, 2)
      assert.strictEqual(yield* clicked(page), 0)
      yield* Expect.toBeVisible(page.locator("#interstitial"))
      const timeout = timedOut(error, "Locator.click")
      // "<div>This interstitial covers the button</div> from <div class="visible" id="interstitial">…</div> subtree
      // intercepts pointer events": the element that covers the target
      assert.strictEqual(reasonOf(timeout)?._tag, "Covered")
      assert.include(reasonOf(timeout)?.by ?? "", "div")
    }))

  test("LH-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      let called = 0
      yield* page.addLocatorHandler(page.getByRole("button", { name: "close" }), (button) =>
        Effect.gen(function*() {
          called++
          yield* button.click()
        }))

      yield* page.locator("#aside").hover()
      yield* setupInterstitial(page, "timeout", 1)
      yield* page.locator("#target").click()
      assert.strictEqual(yield* clicked(page), 1)
      yield* Expect.toBeHidden(page.locator("#interstitial"))
      assert.strictEqual(called, 1)
    }))

  test("LH-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      let called = 0
      yield* page.addLocatorHandler(page.getByRole("button", { name: "close" }), () =>
        Effect.sync(() => {
          called++
        }))

      yield* page.locator("#aside").hover()
      yield* setupInterstitial(page, "hide", 1)
      const error = yield* failureOf(
        page.locator("#target").click().pipe(Deadline.within("3 seconds")),
        "the click"
      )
      assert.strictEqual(yield* clicked(page), 0)
      assert.isTrue(yield* page.locator("#interstitial").isVisible)
      assert.strictEqual(called, 1)
      // Playwright: "locator handler has finished, waiting for getByRole('button', { name: 'close' }) to be hidden"
      const timeout = timedOut(error, "Locator.click")
      assert.include(Option.getOrElse(timeout.hint, () => ""), "locator handler")
    }))

  test("LH-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      let called = 0
      yield* page.addLocatorHandler(page.getByRole("button", { name: "close" }), (button) =>
        Effect.gen(function*() {
          called++
          if (called === 1) {
            yield* button.click()
          } else {
            // `page.locator('#interstitial').waitFor({ state: 'hidden' })`
            yield* Expect.toBeHidden(page.locator("#interstitial"))
          }
        }), { noWaitAfter: true })

      yield* page.locator("#aside").hover()
      yield* setupInterstitial(page, "timeout", 1)
      yield* page.locator("#target").click()
      assert.strictEqual(yield* clicked(page), 1)
      yield* Expect.toBeHidden(page.locator("#interstitial"))
      assert.strictEqual(called, 2)
    }))

  test("LH-014", ({ page, server }) =>
    Effect.gen(function*() {
      yield* openInterstitialPage(page, server.PREFIX)

      let called = 0
      const registration = yield* page.addLocatorHandler(page.getByRole("button", { name: "close" }), (locator) =>
        Effect.gen(function*() {
          ++called
          yield* locator.click()
        }))

      yield* setupInterstitial(page, "hide", 1)
      yield* page.locator("#target").click()
      assert.strictEqual(called, 1)
      assert.strictEqual(yield* clicked(page), 1)
      yield* Expect.toBeHidden(page.locator("#interstitial"))

      yield* setupInterstitial(page, "hide", 1)
      // `page.removeLocatorHandler(page.getByRole('button', { name: 'close' }))`: Strider removes by registration
      yield* registration.remove

      const error = yield* failureOf(
        page.locator("#target").click().pipe(Deadline.within("3 seconds")),
        "the click"
      )
      assert.strictEqual(called, 1)
      assert.strictEqual(yield* clicked(page), 0)
      yield* Expect.toBeVisible(page.locator("#interstitial"))
      timedOut(error, "Locator.click")
    }))
})
