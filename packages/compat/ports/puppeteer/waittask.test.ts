/**
 * Puppeteer's `test/src/waittask.test.ts`: `Frame.waitForFunction` and `Frame.waitForSelector`, with the visibility,
 * shadow-root, and frame waits of the latter. Its xpath tests and the protocol timeout test are in the ledger.
 *
 * What the `waitForSelector` tests change:
 * - `waitForSelector(selector, { visible: true })` is `Expect.toBeVisible` on the locator, and `{ hidden: true }` is
 *   `Expect.toBeHidden`, which also passes for no match, as Puppeteer's does. The default state, `attached`, is
 *   `Expect.toBeAttached`.
 * - `using element = await page.evaluateHandle(…)` followed by `element.evaluate(…)` is a main-world write on the same
 *   element (`document.getElementsByTagName("div")[0]`), which each of these tests holds as a handle: the element is the
 *   only div, so the write reaches it as the handle would. `styleFirstDiv` makes the style writes; a removal is a
 *   `remove()` in the page's main world.
 * - The "hidden" waits start after `setContent`, where the original starts them before it. With no element yet, Puppeteer's
 *   hidden wait is satisfied (`checkVisibility(null, false)` is true) as Strider's `toBeHidden` is, so the original's
 *   wait only stays pending because its first poll runs after `setContent`; the port makes that order explicit.
 * - `Promise.race([promise, createTimeout(40)])` is `stillPending`: the original's fixed 40 ms wait, after which the wait
 *   must still be pending. It's ported as written, with the same check.
 * - A wait that returns a handle (`using handle = await page.waitForSelector(…)`) is a wait that returns nothing. The
 *   tests that read the element a wait returned are in the ledger; the one that finds nothing checks the count is zero.
 * - `Frame.waitForSelector` on an `attachFrame` frame is `frame.locator(…)`. The frame's element is found by the
 *   harness, as `attachFrame` returns it. A wait on a detached frame has no frame to enter: Strider's wait runs to its
 *   deadline, which the test gives one second, where Puppeteer's rejects at once.
 * - `TimeoutError` is `ExpectationFailed`, asserted by its condition and subject, as the waitForFunction tests above do.
 *
 * What the port changes:
 * - `page.waitForFunction(predicate)` is `Expect.that` over a read of the page's main world (`evaluateInMainWorld`),
 *   with a `Condition` for the truthy value, as page-wait-for-function's port does. The polling is Expect's, a check
 *   each `Expect.CheckInterval` (100 ms unless `Expect.withCheckInterval` sets it). Puppeteer's `polling` option is
 *   Expect's interval where its value is a number, and has no counterpart where it is `raf` or `mutation`: the tests
 *   whose point is that mode are in the ledger, not ported.
 * - `timeout` is `Deadline.within`. A timed-out wait is Strider's `ExpectationFailed`, not Puppeteer's `TimeoutError`, so
 *   the port asserts that failure, its condition, and its elapsed time, rather than Puppeteer's "Waiting failed" text.
 * - `page.setDefaultTimeout(ms)` is the harness's `defaultTimeout`. `timeout: 0` is a wait with no deadline, which
 *   `defaultTimeout(Duration.infinity)` gives, outside the harness's deadline.
 * - Puppeteer's `waitForFunction` resolves with the predicate's value as a `JSHandle`. Expect returns nothing, so the
 *   port reads the value the wait held for (`holding`), as page-wait-for-function's WA-014 does.
 * - `page.evaluateOnNewDocument` is `page.addInitScript`.
 * - `page.evaluate` runs in the main world, so it's `page.evaluateInMainWorld`. A returned window or element handle is
 *   `page.evaluateHandle`, which runs in the isolated world stock WebKit lacks: those two tests are in the ledger for
 *   WebKit.
 * - `server.setCSP` is `server.setExtraHeaders` with the same header. The read runs as a Chrome DevTools command, which the
 *   policy doesn't govern.
 * - `createTimeout(40)` is the original's fixed wait, ported as `Effect.sleep` and followed by the same check that the
 *   wait is still pending.
 * - `Frame.waitForSelector` with no state is Puppeteer's `attached` (its `visible` and `hidden` default to false), so each
 *   such wait is `Expect.toBeAttached`. `page.waitForSelector(selector)` returns a handle, which Strider's waits don't,
 *   so the port reads the element through the locator after the wait.
 * - `div >>> h1` is a locator chained on `div`, which searches the open shadow roots of the `div`, as Puppeteer's `>>>`
 *   pierces them.
 * - `signal` (AbortController) is Strider's interruption: a wait is cancelled by interrupting its fiber, which the matrix
 *   rows for the signal options say is what Strider has. The test checks the wait ends interrupted, and that it never
 *   completed.
 * - "can start multiple tasks without node warnings" and the polling tests are not ported; the ledger says why each is.
 * - `addElement`, `addShadowHost`, and `addElementToShadowRoot` are the original's helpers, run in the page's main world.
 */
import { assert } from "@effect/vitest"
import { Condition, Deadline, Expect } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Result from "effect/Result"
import { attachFrame, defaultTimeout, expectationFailure, startWaiting } from "../harness/playwright.ts"
import { detachFrame, html } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

/** Puppeteer's predicate returning a truthy value; the wait ends on the first observation that holds. */
const holds = Condition.make("to be true", (value: unknown) => value === true)

/**
 * A condition that also keeps the value it accepted. The original's wait resolves with that value, and Expect returns
 * nothing, so the test reads it from `held`.
 */
const holding = (description: string, predicate: (value: unknown) => boolean) => {
  const held: { value?: unknown } = {}
  const condition = Condition.make(description, (value: unknown) => {
    if (!predicate(value)) return false
    held.value = value
    return true
  })
  return { condition, held }
}

/** Puppeteer's `addElement`, run in the page's main world. */
const addElement = (tag: string) => {
  document.body.appendChild(document.createElement(tag))
}

/** `addElement` for an iframe's document, through the body of the frame the locator enters. */
const addElementToBody = (body: Element, tag: string) => {
  body.appendChild(body.ownerDocument.createElement(tag))
}

/** Puppeteer's `addShadowHost`: appends an element with an open shadow root. */
const addShadowHost = (tag: string) => {
  document.body.appendChild(document.createElement(tag)).attachShadow({ mode: "open" })
}

/** Puppeteer's `addElementToShadowRoot`: appends `<tag>inside</tag>` to the shadow root of the first match of `selector`. */
const addElementToShadowRoot = (selector: string, tag: string) => {
  const element = document.createElement(tag)
  element.textContent = "inside"
  document.querySelector(selector)!.shadowRoot!.appendChild(element)
}

/** A wait the original holds across steps: `done` says whether it has finished (see `startWaiting`). */
type Waiting = { readonly done: Effect.Effect<boolean> }

/**
 * Puppeteer's `Promise.race([promise, createTimeout(40)])` resolving falsy: a fixed 40 ms wait, after which the wait must
 * still be pending.
 */
const stillPending = Effect.fnUntraced(function*(waiting: Waiting) {
  yield* Effect.sleep("40 millis")
  assert.isFalse(yield* waiting.done)
})

/**
 * Puppeteer's `element.evaluate(e => e.style.setProperty(…))` or `removeProperty(…)` on the first div, which the original
 * holds as a handle from `getElementsByTagName('div')[0]`. The page's main world does the write; `null` removes the
 * property.
 */
const styleFirstDiv = (property: string, value: string | null) => {
  const element = document.getElementsByTagName("div")[0]!
  if (value === null) element.style.removeProperty(property)
  else element.style.setProperty(property, value)
}

/** Whether a wait ended by interruption alone, as Puppeteer's `rejects` on an aborted signal observes it. */
const cancelled = (fiber: Fiber.Fiber<unknown, unknown>) =>
  Effect.map(Effect.exit(Fiber.join(fiber)), (exit) => Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause))

upstream(import.meta.filename, {}, (test) => {
  test("waittask specs Frame.waitForFunction should work when resolved right before execution context disposal", ({ page }) =>
    Effect.gen(function*() {
      yield* page.addInitScript(() => {
        Reflect.set(window, "__RELOADED", true)
      })
      yield* Expect.that(
        page.evaluateInMainWorld(() => {
          if (!Reflect.get(window, "__RELOADED")) {
            window.location.reload()
            return false
          }
          return true
        }),
        holds
      )
    }))

  test("waittask specs Frame.waitForFunction should poll on interval", ({ page }) =>
    Effect.gen(function*() {
      const startTime = Date.now()
      // The original's `polling: 100`: Expect's check interval, which is also its default, so the port can't tell the
      // option from the default
      const polling = 100
      const watchdog = yield* startWaiting(
        Expect.that(
          page.evaluateInMainWorld(() => Reflect.get(window, "__FOO") === "hit"),
          holds
        ).pipe(Expect.withCheckInterval(polling))
      )
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          Reflect.set(window, "__FOO", "hit")
        }, 50)
      })
      yield* Fiber.join(watchdog.fiber)
      assert.isAtLeast(Date.now() - startTime, polling / 2)
    }))

  test("waittask specs Frame.waitForFunction should work with strict CSP policy", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's `server.setCSP`: the header the fixture server sends for this page
      server.setExtraHeaders("/empty.html", { "content-security-policy": "script-src " + server.PREFIX })
      yield* page.goto(server.EMPTY_PAGE)
      // The original's `polling: 'raf'` is Expect's check here, as page-wait-for-function's WA-011 ports it: the test is
      // about the policy, which the read's DevTools command isn't governed by
      const waiting = yield* startWaiting(
        Expect.that(page.evaluateInMainWorld(() => Reflect.get(window, "__FOO") === "hit"), holds)
      )
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "__FOO", "hit")
      })
      // The original's `.catch(error_ => error = error_)` and `expect(error).toBeUndefined()`
      const result = yield* Effect.result(Fiber.join(waiting.fiber))
      assert.isTrue(Result.isSuccess(result))
    }))

  test("waittask specs Frame.waitForFunction should return the success value as a JSHandle", ({ page }) =>
    Effect.gen(function*() {
      // The original reads the value through the handle's `jsonValue()`. The port reads the value the wait held for.
      const { condition, held } = holding("truthy", (value) => Boolean(value))
      yield* Expect.that(page.evaluateInMainWorld(() => 5), condition)
      assert.strictEqual(held.value, 5)
    }))

  test("waittask specs Frame.waitForFunction should return the window as a success value", ({ page }) =>
    Effect.gen(function*() {
      // The window doesn't cross by value, so the wait's subject is a handle to it, which the original's wait resolves
      // with. `evaluateHandle` runs in the isolated world, which stock WebKit lacks (see the ledger).
      const { condition, held } = holding("truthy", (value) => Boolean(value))
      yield* Expect.that(page.evaluateHandle(() => window), condition)
      assert.isTrue(Boolean(held.value))
    }))

  test("waittask specs Frame.waitForFunction should accept ElementHandle arguments", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html("<div></div>"))
      // The original's element handle: a handle stays bound to this element, where a locator would look again.
      // `evaluateHandle` runs in the isolated world, which stock WebKit lacks (see the ledger).
      const div = yield* page.evaluateHandle(() => document.querySelector("div")!)
      const waiting = yield* startWaiting(
        Expect.that(
          div.evaluate((element) => element.localName === "div" && !element.parentElement),
          holds
        )
      )
      assert.isFalse(yield* waiting.done)
      yield* div.evaluate((element) => {
        element.remove()
      })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("waittask specs Frame.waitForFunction should respect timeout", ({ page }) =>
    Effect.gen(function*() {
      // The original's `timeout: 10`. Strider's failure is an ExpectationFailed, which records how long the wait ran.
      const failure = yield* expectationFailure(
        Expect.that(page.evaluateInMainWorld(() => false), holds).pipe(Deadline.within("10 millis"))
      )
      assert.strictEqual(failure.condition, "to be true")
      assert.isAtLeast(Duration.toMillis(failure.elapsed), 10 - 1)
      assert.isAtMost(Duration.toMillis(failure.elapsed), 10 + 500)
    }))

  test("waittask specs Frame.waitForFunction should respect default timeout", ({ page }) =>
    Effect.gen(function*() {
      // The original's `page.setDefaultTimeout(1)`, for the wait that has no timeout of its own
      const failure = yield* expectationFailure(
        defaultTimeout("1 millis")(Expect.that(page.evaluateInMainWorld(() => false), holds))
      )
      assert.strictEqual(failure.condition, "to be true")
    }))

  test("waittask specs Frame.waitForFunction should disable timeout when its set to 0", ({ page }) =>
    Effect.gen(function*() {
      // The original's `timeout: 0`: no deadline, so the wait runs outside the harness's, with an endless default budget.
      // Polling every 10 ms, as the original's `polling: 10` does.
      const watchdog = yield* startWaiting(
        defaultTimeout(Duration.infinity)(
          Expect.that(
            page.evaluateInMainWorld(() => {
              Reflect.set(window, "__counter", (Reflect.get(window, "__counter") ?? 0) + 1)
              return Boolean(Reflect.get(window, "__injected"))
            }),
            holds
          ).pipe(Expect.withCheckInterval(10))
        )
      )
      yield* Expect.that(page.evaluateInMainWorld(() => Reflect.get(window, "__counter") > 10), holds)
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "__injected", true)
      })
      yield* Fiber.join(watchdog.fiber)
    }))

  test("waittask specs Frame.waitForFunction should survive cross-process navigation", ({ page, server }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(
        Expect.that(page.evaluateInMainWorld(() => Reflect.get(window, "__FOO") === 1), holds)
      )
      yield* page.goto(server.EMPTY_PAGE)
      assert.isFalse(yield* waiting.done)
      yield* page.reload()
      assert.isFalse(yield* waiting.done)
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/grid.html")
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "__FOO", 1)
      })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("waittask specs Frame.waitForFunction should survive navigations", ({ page, server }) =>
    Effect.gen(function*() {
      const watchdog = yield* startWaiting(
        Expect.that(page.evaluateInMainWorld(() => Boolean(Reflect.get(window, "__done"))), holds)
      )
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.goto(server.PREFIX + "/consolelog.html")
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "__done", true)
      })
      yield* Fiber.join(watchdog.fiber)
    }))

  test("waittask specs Frame.waitForFunction should be cancellable", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // The original's AbortController. Strider's waits take no signal: the wait is cancelled by interrupting its fiber,
      // which ends it as an interruption (the matrix row for the signal option). The predicate would hold once the page
      // set `__done`, and never does here, so the wait can only end by being cancelled.
      const waiting = yield* startWaiting(
        Expect.that(page.evaluateInMainWorld(() => Boolean(Reflect.get(window, "__done"))), holds)
      )
      yield* Fiber.interrupt(waiting.fiber)
      assert.isTrue(yield* cancelled(waiting.fiber))
      assert.isFalse(yield* waiting.done)
    }))

  test("waittask specs Frame.waitForSelector should immediately resolve promise if node exists", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // Puppeteer's `frame.waitForSelector('*')` defaults to attached, not visible
      yield* Expect.toBeAttached(page.locator("*").first)
      yield* page.evaluateInMainWorld(addElement, "div")
      yield* Expect.toBeAttached(page.locator("div"))
    }))

  test("waittask specs Frame.waitForSelector should be cancellable", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // The original's `signal`: a wait cancelled by interruption, as the Frame.waitForFunction test above
      const waiting = yield* startWaiting(Expect.toBeAttached(page.locator("wrong")))
      yield* Fiber.interrupt(waiting.fiber)
      assert.isTrue(yield* cancelled(waiting.fiber))
      assert.isFalse(yield* waiting.done)
    }))

  test("waittask specs Frame.waitForSelector should work with removed MutationObserver", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        Reflect.deleteProperty(window, "MutationObserver")
      })
      const zombo = page.locator(".zombo")
      // The original's `Promise.all` of the wait and the `setContent`, started in that order
      const waiting = yield* startWaiting(Expect.toBeAttached(zombo))
      yield* page.setContent(html(`<div class="zombo">anything</div>`))
      yield* Fiber.join(waiting.fiber)
      assert.strictEqual(yield* zombo.readText, "anything")
    }))

  test("waittask specs Frame.waitForSelector should resolve promise when node is added", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const waiting = yield* startWaiting(Expect.toBeAttached(page.locator("div")))
      yield* page.evaluateInMainWorld(addElement, "br")
      yield* page.evaluateInMainWorld(addElement, "div")
      yield* Fiber.join(waiting.fiber)
      // The original reads the handle's tagName: the wait resolved on the div
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.querySelector("div")!.tagName), "DIV")
    }))

  test("waittask specs Frame.waitForSelector should work when node is added through innerHTML", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const watchdog = yield* startWaiting(Expect.toBeAttached(page.locator("h3 div")))
      yield* page.evaluateInMainWorld(addElement, "span")
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("span")!.innerHTML = "<h3><div></div></h3>"
      })
      yield* Fiber.join(watchdog.fiber)
    }))

  test("waittask specs Frame.waitForSelector should work when node is added in a shadow root", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // The original's `div >>> h1`: an h1 in the shadow root of a div, which the chained locator pierces
      const h1 = page.locator("div").locator("h1")
      const watcher = yield* startWaiting(Expect.toBeAttached(h1))
      yield* page.evaluateInMainWorld(addShadowHost, "div")
      // The original's `createTimeout(40)`: a fixed wait, after which the watcher must still be pending
      yield* Effect.sleep("40 millis")
      assert.isFalse(yield* watcher.done)
      yield* page.evaluateInMainWorld(addElementToShadowRoot, "div", "h1")
      yield* Fiber.join(watcher.fiber)
      assert.strictEqual(yield* h1.readText, "inside")
    }))

  test("waittask specs Frame.waitForSelector should work when node is added in a shadow root that predates the wait", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.evaluateInMainWorld(addShadowHost, "div")
      const h1 = page.locator("div").locator("h1")
      const watcher = yield* startWaiting(Expect.toBeAttached(h1))
      yield* Effect.sleep("40 millis")
      assert.isFalse(yield* watcher.done)
      yield* page.evaluateInMainWorld(addElementToShadowRoot, "div", "h1")
      yield* Fiber.join(watcher.fiber)
      assert.strictEqual(yield* h1.readText, "inside")
    }))

  test("waittask specs Frame.waitForSelector should work when node is added in a nested shadow root", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const h1 = page.locator("div").locator("h1")
      const watcher = yield* startWaiting(Expect.toBeAttached(h1))
      yield* page.evaluateInMainWorld(() => {
        const host = document.body.appendChild(document.createElement("div"))
        const inner = document.createElement("section")
        inner.attachShadow({ mode: "open" })
        host.attachShadow({ mode: "open" }).appendChild(inner)
      })
      yield* Effect.sleep("40 millis")
      assert.isFalse(yield* watcher.done)
      yield* page.evaluateInMainWorld(() => {
        const h1 = document.createElement("h1")
        h1.textContent = "inside"
        document
          .querySelector("div")!
          .shadowRoot!.querySelector("section")!
          .shadowRoot!.appendChild(h1)
      })
      yield* Fiber.join(watcher.fiber)
      assert.strictEqual(yield* h1.readText, "inside")
    }))

  test("waittask specs Frame.waitForSelector should work when a shadow root is attached to an existing node", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // The original's comment: attaching a shadow root to a node already in the DOM makes no mutation, so the wait has
      // to see the change some other way (here, the next check, which Expect runs on its interval as well)
      const h1 = page.locator("div").locator("h1")
      const watcher = yield* startWaiting(Expect.toBeAttached(h1))
      yield* page.evaluateInMainWorld(addElement, "div")
      yield* Effect.sleep("40 millis")
      assert.isFalse(yield* watcher.done)
      yield* page.evaluateInMainWorld(() => {
        const host = document.querySelector("div")!
        const shadow = host.attachShadow({ mode: "open" })
        const h1 = document.createElement("h1")
        h1.textContent = "inside"
        shadow.appendChild(h1)
      })
      yield* Fiber.join(watcher.fiber)
      assert.strictEqual(yield* h1.readText, "inside")
    }))

  test("waittask specs Frame.waitForSelector should work for selector with a pseudo class", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const watchdog = yield* startWaiting(Expect.toBeAttached(page.locator("input:focus")))
      yield* Effect.sleep("40 millis")
      assert.isFalse(yield* watchdog.done)
      yield* page.setContent(html("<input></input>"))
      yield* page.locator("input").click()
      yield* Fiber.join(watchdog.fiber)
    }))

  test("waittask specs Frame.waitForSelector Page.waitForSelector is shortcut for main frame", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const otherFrame = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const watchdog = yield* startWaiting(Expect.toBeAttached(page.locator("div")))
      yield* otherFrame.locator("body").evaluate(addElementToBody, "div")
      // The original reads the returned handle's frame, which must be the main frame: a div in the other frame doesn't
      // end the page's wait, and one in the main frame does
      yield* stillPending(watchdog)
      yield* page.evaluateInMainWorld(addElement, "div")
      yield* Fiber.join(watchdog.fiber)
    }))

  test("waittask specs Frame.waitForSelector should run in specified frame", ({ page, server }) =>
    Effect.gen(function*() {
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const frame2 = yield* attachFrame(page, "frame2", server.EMPTY_PAGE)
      const frame1 = page.frame(page.locator("#frame1"))
      const waiting = yield* startWaiting(Expect.toBeAttached(frame2.locator("div")))
      yield* frame1.locator("body").evaluate(addElementToBody, "div")
      // The original reads the returned handle's frame, which must be frame2: a div in frame1 doesn't end the wait
      yield* stillPending(waiting)
      yield* frame2.locator("body").evaluate(addElementToBody, "div")
      yield* Fiber.join(waiting.fiber)
    }))

  test("waittask specs Frame.waitForSelector should throw when frame is detached", ({ page, server }) =>
    Effect.gen(function*() {
      const frame = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      // The original's wait rejects once its frame detaches. Strider's wait finds no frame to enter and runs to its
      // deadline, so the port gives it one second, where the original's default is thirty.
      const waiting = yield* startWaiting(Expect.toBeAttached(frame.locator(".box")).pipe(Deadline.within("1 second")))
      yield* detachFrame(page, "frame1")
      // The original's `Waiting for selector \`.box\` failed`
      const failure = yield* expectationFailure(Fiber.join(waiting.fiber))
      assert.strictEqual(failure.condition, "to be attached")
      assert.isTrue(failure.subject.includes(".box"))
    }))

  test("waittask specs Frame.waitForSelector should survive cross-process navigation", ({ page, server }) =>
    Effect.gen(function*() {
      // grid.html adds two hundred `.box` divs, and Puppeteer's wait resolves on the first; `toBeAttached` retries while
      // several match, so the port waits on the first
      const waiting = yield* startWaiting(Expect.toBeAttached(page.locator(".box").first))
      yield* page.goto(server.EMPTY_PAGE)
      assert.isFalse(yield* waiting.done)
      yield* page.reload()
      assert.isFalse(yield* waiting.done)
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/grid.html")
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("waittask specs Frame.waitForSelector should wait for element to be visible (display)", ({ page }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(Expect.toBeVisible(page.locator("div")))
      yield* page.setContent(html(`<div style="display: none">text</div>`))
      yield* stillPending(waiting)
      yield* page.evaluateInMainWorld(styleFirstDiv, "display", null)
      yield* Fiber.join(waiting.fiber)
    }))

  test("waittask specs Frame.waitForSelector should wait for element to be visible (without DOM mutations)", ({ page }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(Expect.toBeVisible(page.locator("div")))
      yield* page.setContent(
        html(`<style>
            div {
              display: none;
            }
          </style>
          <div>text</div>`)
      )
      assert.isTrue(yield* page.evaluateInMainWorld(() => document.getElementsByTagName("div").length > 0))
      yield* stillPending(waiting)
      yield* page.evaluateInMainWorld(() => {
        const extraSheet = new CSSStyleSheet()
        extraSheet.replaceSync("div { display: block; }")
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, extraSheet]
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("waittask specs Frame.waitForSelector should wait for element to be visible (visibility)", ({ page }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(Expect.toBeVisible(page.locator("div")))
      yield* page.setContent(html(`<div style="visibility: hidden">text</div>`))
      yield* stillPending(waiting)
      // `collapse` is hidden too, as the original's second wait checks
      yield* page.evaluateInMainWorld(styleFirstDiv, "visibility", "collapse")
      yield* stillPending(waiting)
      yield* page.evaluateInMainWorld(styleFirstDiv, "visibility", null)
      yield* Fiber.join(waiting.fiber)
    }))

  test("waittask specs Frame.waitForSelector should wait for element to be visible (bounding box)", ({ page }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(Expect.toBeVisible(page.locator("div")))
      yield* page.setContent(html(`<div style="width: 0">text</div>`))
      yield* stillPending(waiting)
      yield* page.evaluateInMainWorld(styleFirstDiv, "height", "0")
      yield* page.evaluateInMainWorld(styleFirstDiv, "width", null)
      yield* stillPending(waiting)
      yield* page.evaluateInMainWorld(styleFirstDiv, "height", null)
      yield* Fiber.join(waiting.fiber)
    }))

  test("waittask specs Frame.waitForSelector should wait for element to be visible recursively", ({ page }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(Expect.toBeVisible(page.locator("div#inner")))
      yield* page.setContent(html(`<div style="display: none; visibility: hidden;"><div id="inner">hi</div></div>`))
      yield* stillPending(waiting)
      // The outer div is the first div; `#inner` is hidden until both of its ancestors' hiding is gone
      yield* page.evaluateInMainWorld(styleFirstDiv, "display", null)
      yield* stillPending(waiting)
      yield* page.evaluateInMainWorld(styleFirstDiv, "visibility", null)
      yield* Fiber.join(waiting.fiber)
    }))

  test("waittask specs Frame.waitForSelector should wait for element to be hidden (visibility)", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div style="display: block;">text</div>`))
      const waiting = yield* startWaiting(Expect.toBeHidden(page.locator("div")))
      yield* stillPending(waiting)
      yield* page.evaluateInMainWorld(styleFirstDiv, "visibility", "hidden")
      yield* Fiber.join(waiting.fiber)
    }))

  test("waittask specs Frame.waitForSelector should wait for element to be hidden (display)", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div style="display: block;">text</div>`))
      const waiting = yield* startWaiting(Expect.toBeHidden(page.locator("div")))
      yield* stillPending(waiting)
      yield* page.evaluateInMainWorld(styleFirstDiv, "display", "none")
      yield* Fiber.join(waiting.fiber)
    }))

  test("waittask specs Frame.waitForSelector should wait for element to be hidden (bounding box)", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div>text</div>`))
      const waiting = yield* startWaiting(Expect.toBeHidden(page.locator("div")))
      yield* stillPending(waiting)
      yield* page.evaluateInMainWorld(styleFirstDiv, "height", "0")
      yield* Fiber.join(waiting.fiber)
    }))

  test("waittask specs Frame.waitForSelector should wait for element to be hidden (removal)", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div>text</div>`))
      const waiting = yield* startWaiting(Expect.toBeHidden(page.locator("div")))
      yield* stillPending(waiting)
      yield* page.evaluateInMainWorld(() => {
        document.getElementsByTagName("div")[0]!.remove()
      })
      yield* Fiber.join(waiting.fiber)
    }))

  test("waittask specs Frame.waitForSelector should return null if waiting to hide non-existing element", ({ page }) =>
    Effect.gen(function*() {
      // The original's handle is `null`: the wait passes with nothing matching, so the port checks that nothing does
      yield* Expect.toBeHidden(page.locator("non-existing"))
      assert.strictEqual(yield* page.locator("non-existing").count, 0)
    }))

  test("waittask specs Frame.waitForSelector should respect timeout", ({ page }) =>
    Effect.gen(function*() {
      // The original's `timeout: 10`, which rejects with a TimeoutError
      const failure = yield* expectationFailure(
        Expect.toBeAttached(page.locator("div")).pipe(Deadline.within("10 millis"))
      )
      assert.strictEqual(failure.condition, "to be attached")
      assert.isTrue(failure.subject.includes("div"))
    }))

  test("waittask specs Frame.waitForSelector should have an error message specifically for awaiting an element to be hidden", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div>text</div>`))
      const failure = yield* expectationFailure(
        Expect.toBeHidden(page.locator("div")).pipe(Deadline.within("10 millis"))
      )
      assert.strictEqual(failure.condition, "to be hidden")
      assert.isTrue(failure.subject.includes("div"))
    }))

  test("waittask specs Frame.waitForSelector should respond to node attribute mutation", ({ page }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(Expect.toBeAttached(page.locator(".zombo")))
      yield* page.setContent(html(`<div class="notZombo"></div>`))
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.className = "zombo"
      })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))
})
