/**
 * Playwright's `tests/page/expect-misc.spec.ts`: the locator and page matchers that aren't boolean state (`toHaveCount`,
 * `toHaveClass`, `toHaveTitle`, `toHaveURL`, `toHaveAttribute`, `toHaveCSS`, `toBeInViewport`), with their options, the
 * matchers' failure messages, and the expectations that wait for a change.
 *
 * What the port changes:
 * - Strider's matchers take no `timeout`: each one is `Deadline.within` around the expectation. Playwright's default
 *   expect timeout (10 seconds, from its config) is written where a failing expectation has no timeout of its own.
 * - `.not` is the inverse matcher where Strider has one (`not.toBeInViewport` is `{ inViewport: false }`). Where it has
 *   none, the port waits on a read with `Expect.that` and a negated `Condition`: `not.toHaveCount` on `count`,
 *   `not.toHaveAttribute` on `readAttribute`. Each read is the value the matcher compares, so the failure's observed
 *   value is the same value Playwright's message quotes.
 * - A URL predicate (`toHaveURL(url => …)`) is `Expect.that` over `page.url` with a `Condition`, the same check on the
 *   same value. `URLPattern` is tested with the pattern's own `test`, which the original's matcher calls.
 * - `toHaveId` checks the `id` attribute: `Element.id` reflects that attribute, so `Expect.toHaveAttribute("id", …)`
 *   checks the same property.
 * - `scrollIntoViewIfNeeded` is `scrollIntoView`, which Strider's matrix maps it to.
 * - A failed expectation is `Expect.ExpectationFailed`. Where the original checks the text of its message, the port
 *   checks the failure's condition and what it observed. A matcher's `last` is its last observed value (a count, a class
 *   string, an attribute value or `null`, a title or URL, the text, or `{ matches }`). For `Expect.that` over a read
 *   (`count`, `readAttribute`), `last` is always the check still running at the deadline, so the port reads the values
 *   from the failure's `history`. The "Timeout" line of a message is the port's own `Deadline.within`, so it isn't
 *   checked separately.
 * - An expectation Playwright's message quotes as a call log has no Strider counterpart. Its "not twice" point is
 *   that each observed value appears once in the failure's history, which Strider de-duplicates, so the port checks
 *   that history.
 * - `page.evaluate` in a timer is `page.evaluateInMainWorld`, which every backend has. A `setTimeout` callback is
 *   `later`, as in expect-boolean.
 * - A promise the original holds across steps (`const promise = expect(…)`, checked after a wait) is `startWaiting`.
 * - Matchers the matrix lists as missing are `needsFeature` in the ledger, with their rows: `toHaveJSProperty`,
 *   `toContainClass`, `toHaveAttribute`'s and `toHaveURL`'s `ignoreCase`, and `page.close`'s `reason` (EX-243). A test
 *   that needs one is not ported.
 * - EX-216 passes an object to `toHaveURL`, which Strider's types reject at compile time; it is `notApplicable` (see the
 *   ledger).
 * - EX-235 checks the one-frame JavaScript stack of Playwright's error, which Strider's typed failure doesn't have; the
 *   port checks the behavior, that the body fails the inverse `toBeInViewport` with the ratio it saw.
 * - EX-241 checks that an invalid CSS selector fails the expectation at once, with the parser's error as its final entry,
 *   and that the locator used directly fails with `InvalidInput` for `selector`.
 * - EX-242: the page closing during a failing expectation fails it with `TargetGone` (`PageClosed`), which carries no
 *   "Expected"/"Received" of the last check, so the port asserts the typed end.
 */
import { assert } from "@effect/vitest"
import { Condition, Deadline, Expect, Locator, Target } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { expectationFailure, failureOf, observedValues, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The value of a failure's last observation, as the expectation recorded it. */
const lastValue = (failure: Expect.ExpectationFailed): unknown =>
  Option.getOrUndefined(Option.map(failure.last, (observed) => observed.value))

/**
 * Playwright's `setTimeout(change, delay)`: a child fiber that sleeps, then makes the change. The original ignores the
 * change's failure (`.catch(() => {})`), and nothing joins the timer, so the test's end ends it.
 */
const later = (delay: Duration.Input, change: Effect.Effect<unknown, unknown>) =>
  Effect.forkChild(Effect.sleep(delay).pipe(Effect.andThen(change), Effect.ignore), { startImmediately: true })

/** A value that is not a `Playwright` expectation's inverse of `toHaveCount(1)`: any count but one. */
const notOne = Condition.not(Condition.make("1", (count: number) => count === 1))
const notTwo = Condition.not(Condition.make("2", (count: number) => count === 2))

/** An attribute read as `Option`: `not.toHaveAttribute(name, "")`, which passes when the attribute is missing too. */
const notEmptyAttribute = Condition.make(
  "not \"\"",
  (value: Option.Option<string>) => Option.getOrUndefined(value) !== ""
)

// `not.toHaveAttribute(name, <any text>)` passes when the attribute is missing, since the pattern needs a value.
const notAnyAttribute = Condition.make("not /.*/", (value: Option.Option<string>) => {
  const text = Option.getOrUndefined(value)
  return text === undefined || !/.*/.test(text)
})

/** `not.toHaveAttribute(name)`: the attribute is absent. */
const absentAttribute = Condition.make(
  "the attribute is absent",
  (value: Option.Option<string>) => Option.isNone(value)
)

/** The attributes a polled read returned, from a failure's history (the final entry is the check running at the deadline). */
const attributesObserved = (failure: Expect.ExpectationFailed) =>
  observedValues(failure).flatMap((value) => Option.isOption(value) && Option.isSome(value) ? [value.value] : [])

/** Node's `URLPattern`, which the original's `new URLPattern(…)` constructs. Node 24 has it, so the original's skip doesn't apply. */
type URLPatternConstructor = new(init: Record<string, string>) => { readonly test: (url: string) => boolean }
const URLPatternOf = (globalThis as unknown as { readonly URLPattern: URLPatternConstructor }).URLPattern

upstream(import.meta.filename, {}, (test) => {
  test("EX-181", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<select><option>One</option></select>")
      const waiting = yield* startWaiting(page.locator("option").pipe(Expect.toHaveCount(2)))
      yield* Effect.sleep("1 second") // the original's fixed wait: the count must still be wrong after it
      assert.isFalse(yield* waiting.done)
      yield* page.setContent("<select><option>One</option><option>Two</option></select>")
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("EX-182", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      const locator = page.locator("span")
      yield* locator.pipe(Expect.toHaveCount(0))
      yield* Expect.that(locator.count, notOne)
    }))

  test("EX-183", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div><span>hello</span></div>")
      const locator = page.locator("span")
      // The original's `page.evaluate` runs in the page's main world, which `evaluateInMainWorld` runs in too
      yield* later(
        200,
        page.evaluateInMainWorld(() => {
          document.querySelector("div")!.textContent = ""
        })
      )
      yield* locator.pipe(Expect.toHaveCount(0))
      yield* Expect.that(locator.count, notOne)
    }))

  test("EX-184", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<ul></ul>")
      yield* later(500, page.setContent("<ul><li>one</li><li>two</li></ul>"))
      yield* page.locator("li").pipe(Expect.toHaveCount(2))
    }))

  test("EX-185", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<ul><li>one</li><li>two</li></ul>")
      yield* later(500, page.setContent("<ul></ul>"))
      yield* Expect.that(page.locator("li").count, notTwo)
    }))

  test("EX-186", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div><span></span></div>")
      const failure = yield* expectationFailure(
        page.locator("span").pipe(Expect.toHaveCount(0), Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "to match 0 elements")
      assert.strictEqual(lastValue(failure), 1)
    }))

  test("EX-187", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div><span></span></div>")
      const failure = yield* expectationFailure(
        Expect.that(page.locator("span").count, notOne).pipe(Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "not 1")
      // A polled read's `last` is the check still running at the deadline, so the count it read is in the history
      assert.include(observedValues(failure), 1)
    }))

  test("EX-202", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div class=\"foo bar baz\"></div>")
      yield* page.locator("div").pipe(Expect.toHaveClass("foo bar baz"))
    }))

  test("EX-203", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<svg class="c1 c2" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"></svg>`
      )
      yield* page.locator("svg").pipe(Expect.toHaveClass(/c1/))
    }))

  test("EX-204", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div class=\"bar baz\"></div>")
      const failure = yield* expectationFailure(
        page.locator("div").pipe(Expect.toHaveClass("foo bar baz"), Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "to have the class \"foo bar baz\"")
      assert.strictEqual(lastValue(failure), "bar baz")
    }))

  test("EX-205", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div class=\"foo\"></div><div class=\"bar\"></div><div class=\"baz\"></div>")
      yield* page.locator("div").pipe(Expect.toHaveClass(["foo", "bar", /[a-z]az/]))
    }))

  test("EX-206", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div class=\"foo\"></div><div class=\"bar\"></div><div class=\"bar\"></div>")
      const failure = yield* expectationFailure(
        page.locator("div").pipe(Expect.toHaveClass(["foo", "bar", /[a-z]az/]), Deadline.within("1 second"))
      )
      // Every element's class string, in order: the third is the one that doesn't match its entry
      assert.deepStrictEqual(lastValue(failure), ["foo", "bar", "bar"])
    }))

  test("EX-212", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<title>  Hello     world</title>")
      yield* Expect.toHaveTitle(page, "Hello  world")
    }))

  test("EX-213", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<title>Bye</title>")
      const failure = yield* expectationFailure(
        Expect.toHaveTitle(page, "Hello").pipe(Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "to have the title \"Hello\"")
      assert.strictEqual(lastValue(failure), "Bye")
    }))

  test("EX-214", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("data:text/html,<div>A</div>")
      yield* Expect.toHaveURL(page, "data:text/html,<div>A</div>")
    }))

  test("EX-215", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("data:text/html,<div>A</div>")
      const failure = yield* expectationFailure(
        Expect.toHaveURL(page, "wrong").pipe(Deadline.within("1 second"))
      )
      assert.strictEqual(lastValue(failure), "data:text/html,<div>A</div>")
    }))

  test("EX-217", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("data:text/html,<div>A</div>")
      // `toHaveURL(predicate)` is a check of `page.url` against a predicate, which `Expect.that` runs; its default is 10 s
      const failure = yield* expectationFailure(
        Expect.that(page.url, Condition.make("predicate to succeed", (_url: string) => false)).pipe(
          Deadline.within("10 seconds")
        )
      )
      assert.strictEqual(lastValue(failure), "data:text/html,<div>A</div>")
    }))

  test("EX-218", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("data:text/html,<div>A</div>")
      const predicate = (_url: string) => true
      const failure = yield* expectationFailure(
        Expect.that(page.url, Condition.make("predicate to fail", (url: string) => !predicate(url))).pipe(
          Deadline.within("10 seconds")
        )
      )
      assert.strictEqual(lastValue(failure), "data:text/html,<div>A</div>")
    }))

  test("EX-219", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("data:text/html,<div>A</div>")
      yield* Expect.that(
        page.url,
        Condition.make("predicate to succeed", (url: string) => url === "data:text/html,<div>A</div>")
      ).pipe(Deadline.within("1 second"))
    }))

  test("EX-220", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("data:text/html,<div>A</div>")
      yield* later(500, page.goto("data:text/html,<div>B</div>"))
      yield* Expect.that(
        page.url,
        Condition.make("predicate to succeed", (url: string) => url === "data:text/html,<div>B</div>")
      ).pipe(Deadline.within("1 second"))
    }))

  test("EX-222", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("data:text/html,<div>A</div>")
      // `toHaveURL(URLPattern)` tests the page's URL against the pattern, which is what these conditions do
      const dataUrls = new URLPatternOf({ protocol: "data" })
      const httpUrls = new URLPatternOf({ protocol: "http" })
      yield* Expect.that(page.url, Condition.make("a URLPattern to match", (url: string) => dataUrls.test(url)))
      yield* Expect.that(page.url, Condition.make("a URLPattern not to match", (url: string) => !httpUrls.test(url)))
    }))

  test("EX-223", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      yield* page.locator("#node").pipe(Expect.toHaveAttribute("id", "node"))
    }))

  test("EX-224", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div checked id=node>Text content</div>")
      const locator = page.locator("#node")
      // A missing attribute is observed as `null`, which no value matches
      const missingEmpty = yield* expectationFailure(
        locator.pipe(Expect.toHaveAttribute("disabled", ""), Deadline.within("1 second"))
      )
      assert.strictEqual(missingEmpty.condition, "to have the attribute disabled \"\"")
      assert.isNull(lastValue(missingEmpty))
      const missingPattern = yield* expectationFailure(
        locator.pipe(Expect.toHaveAttribute("disabled", /.*/), Deadline.within("1 second"))
      )
      assert.strictEqual(missingPattern.condition, "to have the attribute disabled /.*/")
      assert.isNull(lastValue(missingPattern))
      yield* Expect.that(locator.readAttribute("disabled"), notEmptyAttribute)
      yield* Expect.that(locator.readAttribute("disabled"), notAnyAttribute)
    }))

  test("EX-225", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div checked id=node>Text content</div>")
      const locator = page.locator("#node")
      yield* locator.pipe(Expect.toHaveAttribute("checked", ""))
      yield* locator.pipe(Expect.toHaveAttribute("checked", /.*/))
      const empty = yield* expectationFailure(
        Expect.that(locator.readAttribute("checked"), notEmptyAttribute).pipe(Deadline.within("1 second"))
      )
      assert.isTrue(attributesObserved(empty).includes(""))
      const any = yield* expectationFailure(
        Expect.that(locator.readAttribute("checked"), notAnyAttribute).pipe(Deadline.within("1 second"))
      )
      assert.isTrue(attributesObserved(any).includes(""))
    }))

  test("EX-226", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div checked id=node>Text content</div>")
      const locator = page.locator("#node")
      yield* locator.pipe(Expect.toHaveAttribute("id"))
      yield* locator.pipe(Expect.toHaveAttribute("checked"))
      yield* Expect.that(locator.readAttribute("open"), absentAttribute)
    }))

  test("EX-227", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div checked id=node>Text content</div>")
      const locator = page.locator("#node")
      yield* locator.pipe(Expect.toHaveAttribute("id"), Deadline.within("5 seconds"))
      yield* locator.pipe(Expect.toHaveAttribute("checked"), Deadline.within("5 seconds"))
      yield* Expect.that(locator.readAttribute("open"), absentAttribute).pipe(Deadline.within("5 seconds"))
    }))

  test("EX-229", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node style=\"color: rgb(255, 0, 0)\">Text content</div>")
      yield* page.locator("#node").pipe(Expect.toHaveCSS("color", "rgb(255, 0, 0)"))
    }))

  test("EX-230", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <style>
        #node::before {
          color: rgb(255, 0, 0);
          content: "Text content";
        }
      </style>
      <div id=node></div>
    `)
      yield* page.locator("#node").pipe(Expect.toHaveCSS("color", "rgb(255, 0, 0)", { pseudo: "before" }))
    }))

  test("EX-231", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node style=\"--custom-color-property:#FF00FF;\">Text content</div>")
      yield* page.locator("#node").pipe(Expect.toHaveCSS("--custom-color-property", "#FF00FF"))
    }))

  test("EX-232", ({ page }) =>
    Effect.gen(function*() {
      // `toHaveId` checks the element's `id`, which reflects the `id` attribute
      yield* page.setContent("<div id=node>Text content</div>")
      yield* page.locator("#node").pipe(Expect.toHaveAttribute("id", "node"))
    }))

  test("EX-233", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <div id=big style="height: 10000px;"></div>
      <div id=small>foo</div>
    `)
      yield* page.locator("#big").pipe(Expect.toBeInViewport())
      yield* page.locator("#small").pipe(Expect.toBeInViewport({ inViewport: false }))
      yield* page.locator("#small").scrollIntoView()
      yield* page.locator("#small").pipe(Expect.toBeInViewport())
      yield* page.locator("#small").pipe(Expect.toBeInViewport({ ratio: 1 }))
    }))

  test("EX-234", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
      <style>body, div, html { padding: 0; margin: 0; }</style>
      <div id=big style="height: 400vh;"></div>
    `)
      const div = page.locator("div")
      yield* div.pipe(Expect.toBeInViewport())
      yield* div.pipe(Expect.toBeInViewport({ ratio: 0.1 }))
      yield* div.pipe(Expect.toBeInViewport({ ratio: 0.2 }))

      yield* div.pipe(Expect.toBeInViewport({ ratio: 0.24 }))
      // In this test, element's ratio is 0.25.
      yield* div.pipe(Expect.toBeInViewport({ ratio: 0.25 }))
      yield* div.pipe(Expect.toBeInViewport({ ratio: 0.26, inViewport: false }))

      yield* div.pipe(Expect.toBeInViewport({ ratio: 0.3, inViewport: false }))
      yield* div.pipe(Expect.toBeInViewport({ ratio: 0.7, inViewport: false }))
      yield* div.pipe(Expect.toBeInViewport({ ratio: 0.8, inViewport: false }))
    }))

  test("EX-235", ({ page }) =>
    Effect.gen(function*() {
      // The original's point is that the error's stack has one frame, in the test file: a JavaScript stack, which
      // Strider's typed failure doesn't have. The behavior is that the body, which is in the viewport, fails the
      // inverse expectation, and the failure says what it saw.
      const failure = yield* expectationFailure(
        page.locator("body").pipe(Expect.toBeInViewport({ inViewport: false }), Deadline.within("3 seconds"))
      )
      // The ratio it saw is in the history: the original's message is `unexpected value "viewport ratio 1"`
      const ratios = observedValues(failure).flatMap((value) =>
        typeof value === "object" && value !== null && "ratio" in value ? [value.ratio] : []
      )
      assert.isTrue(ratios.length > 0 && ratios.every((ratio) => ratio === 1), String(ratios))
    }))

  test("EX-236", ({ page }) =>
    Effect.gen(function*() {
      // The markup is as the original has it: the second div's style attribute is never closed
      yield* page.setContent(`
      <h1>hello</h1>
      <div style="position: relative; height: 10000px; top: -5000px;></div>
    `)
      yield* page.locator("h1").pipe(Expect.toBeInViewport())
    }))

  test("EX-237", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<select><option>One</option></select>")
      const failure = yield* expectationFailure(
        page.locator("option").pipe(Expect.toHaveCount(2), Deadline.within("2 seconds"))
      )
      // The count is observed once: the history holds it once, where the original's log names the wait once
      assert.strictEqual(lastValue(failure), 1)
      assert.deepStrictEqual(failure.history.map((observed) => observed.value), [1])
    }))

  test("EX-238", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div>")
      const failure = yield* expectationFailure(
        page.locator("div").pipe(Expect.toHaveText("world"), Deadline.within("2 seconds"))
      )
      assert.strictEqual(lastValue(failure), "hello")
      assert.deepStrictEqual(failure.history.map((observed) => observed.value), ["hello"])
    }))

  test("EX-239", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div>")
      const failure = yield* expectationFailure(
        page.locator("span").pipe(Expect.toHaveText("world"), Deadline.within("2 seconds"))
      )
      // Nothing matched, so nothing was resolved: the only observation is the match count
      assert.deepStrictEqual(lastValue(failure), { matches: 0 })
      assert.deepStrictEqual(failure.history.map((observed) => observed.value), [{ matches: 0 }])
    }))

  test("EX-240", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>a</div><div>b</div>")
      // Playwright fails at once on a strict-mode violation; Strider retries a multiple match to the expect timeout (10 s)
      const failure = yield* expectationFailure(
        page.locator("div").pipe(Expect.toHaveText("foo"), Deadline.within("10 seconds"))
      )
      assert.strictEqual(failure.condition, "to have the text \"foo\"")
      assert.deepStrictEqual(lastValue(failure), { matches: 2 })
    }))

  test("EX-241", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>a</div><div>b</div>")
      // An invalid CSS selector fails at once, not at the deadline: the expectation's final entry is the parser's error
      const failure = yield* expectationFailure(
        page.locator("##").pipe(Expect.toBeVisible, Deadline.within("10 seconds"))
      )
      const last = lastValue(failure) as { readonly error: string } | undefined
      assert.isTrue(last !== undefined && last.error.startsWith("invalid selector \"##\""), String(last?.error))
      // Used directly, the same locator fails with the typed refusal
      const refusal = yield* Effect.flip(page.locator("##").isVisible)
      assert(Locator.isLocatorError(refusal), String(refusal))
      assert.strictEqual(refusal.reason._tag, "InvalidInput")
      assert.strictEqual(refusal.reason._tag === "InvalidInput" ? refusal.reason.input : undefined, "selector")
    }))

  test("EX-242", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div>")
      const waiting = yield* Effect.forkChild(
        failureOf(
          page.locator("div").pipe(Expect.toHaveText("world"), Deadline.within("10 seconds")),
          "the expectation"
        ),
        { startImmediately: true }
      )
      yield* Effect.sleep("1 second") // the original's fixed wait: the expectation is polling when the page closes
      yield* page.close()
      const failure = yield* Fiber.join(waiting)
      // Playwright's error keeps the last "Expected"/"Received" of the expectation; Strider's is the typed end of the page
      assert(Target.isTargetGone(failure), String(failure))
      assert.strictEqual(failure.reason._tag, "PageClosed")
    }))
})
