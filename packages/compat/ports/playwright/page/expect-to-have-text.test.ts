/**
 * Playwright's `tests/page/expect-to-have-text.spec.ts`: `toHaveText` and `toContainText` with strings, regular
 * expressions, and lists, their `.not` forms, whitespace collapsing, and their failure messages.
 *
 * What the port changes:
 * - Strider's matchers take no `timeout`: each `{ timeout }` is `Deadline.within` around the expectation.
 * - Strider's text matchers take no `ignoreCase` or `useInnerText`, and `toContainText` takes no list, so the tests
 *   that use them are `needsFeature` in the ledger and aren't ported.
 * - `.not` has no matcher. For one element's text, the port waits on `readText` with `Expect.that` and `Condition.not`,
 *   as expect-boolean does. For a list, `not.toHaveText([])` holds when there is a match, so it reads the count, and
 *   `not.toHaveText(["Test"])` holds unless the matches' texts are `["Test"]`, so it reads every match's text.
 * - A failed expectation is `Expect.ExpectationFailed`. The port asserts its `condition` (the matcher's own words, such
 *   as `to have the text "Text"`) and `observedValues`, where Playwright's message quotes "Received". Where the message
 *   names a count (`locator resolved to 2 elements`), the observed list has two entries.
 * - EX-290's `not.toHaveText` over a missing element waits and then fails, since a not-found element isn't a text that
 *   differs. A `readText` would fail at once with `NoMatch`, so the port reads the count first and the text only when
 *   there is one match, and the failure's observed value is `{ matches: 0 }`, as `toHaveText`'s own is.
 * - `page.setContent`, `page.waitForTimeout`, `locator.evaluate`, and a `page.evaluate` in a timer are
 *   `page.setContent`, `Effect.sleep` (the original's own wait, ported as written), and `page.evaluateInMainWorld`. A
 *   `setTimeout` callback is `later`, as in expect-boolean.
 * - A promise the original raises as a `.catch(e => e)` is `expectationFailure`: the test fails if the expectation passes.
 * - EX-287's skip for `PW_CLOCK=frozen` doesn't apply: that clock mode isn't set in these runs.
 * - Strider's text is collapsed before a regular expression is tested, so a pattern with several spaces in it doesn't
 *   match what Playwright matches with its own unnormalized text. EX-276 is ported as written and fails there.
 */
import { assert } from "@effect/vitest"
import { Condition, Deadline, Expect, Locator } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { expectationFailure, observedValues } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * Playwright's `setTimeout(change, delay)`: a child fiber that sleeps, then makes the change. The original ignores the
 * change's failure (`.catch(() => {})`), and nothing joins the timer, so the test's end ends it.
 */
const later = (delay: Duration.Input, change: Effect.Effect<unknown, unknown>) =>
  Effect.forkChild(Effect.sleep(delay).pipe(Effect.andThen(change), Effect.ignore), { startImmediately: true })

/** One element's text is `expected`, after whitespace is collapsed, as `Expect.toHaveText` compares it. */
const textIs = (expected: string) =>
  Condition.make(`to have the text ${JSON.stringify(expected)}`, (text: string) => text === expected)

/** An empty list matches exactly when nothing matches, so `not.toHaveText([])` is a match count above zero. */
const atLeastOneMatch = Condition.make("to have at least one match", (count: number) => count > 0)

/** The texts of every match, in order: what a list form of `toHaveText` compares. */
const textsOf = (locator: Locator.ReadonlyLocator) =>
  locator.all.pipe(Effect.flatMap((matches) => Effect.forEach(matches, (match) => match.readText)))

/** The matches' texts are `expected`, entry for entry, as `toHaveText`'s list form compares them. */
const textsAre = (expected: ReadonlyArray<string>) =>
  Condition.make(
    `to have the texts ${JSON.stringify(expected)}`,
    (texts: ReadonlyArray<string>) =>
      texts.length === expected.length && texts.every((text, index) => text === expected[index])
  )

/**
 * What `toHaveText` needs for one element: the text of the one match, or the match count when there isn't exactly one.
 * Unlike `readText`, it doesn't fail on a missing element, so an expectation over it waits for the element.
 */
const textOfOne = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const matches = yield* locator.count
  return matches === 1 ? yield* locator.readText : { matches }
})

upstream(import.meta.filename, {}, (test) => {
  test("EX-275", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const locator = page.locator("#node")
      const failure = yield* expectationFailure(
        locator.pipe(Expect.toHaveText(/Text 2/), Deadline.within("1 second"))
      )
      assert.include(failure.message, "/Text 2/")
      assert.deepStrictEqual(observedValues(failure), ["Text content"])
    }))

  test("EX-276", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text   content</div>")
      const locator = page.locator("#node")
      yield* locator.pipe(Expect.toContainText(/ex/))
      // Playwright tests a regular expression against the text without collapsing whitespace. Strider's text is
      // collapsed before the test, so this pattern's three spaces don't match "Text content".
      yield* locator.pipe(Expect.toContainText(/ext   cont/))
    }))

  test("EX-277", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const failure = yield* expectationFailure(
        page.locator("#node").pipe(Expect.toContainText(/ex2/), Deadline.within("1 second"))
      )
      assert.include(failure.message, "/ex2/")
      assert.deepStrictEqual(observedValues(failure), ["Text content"])
    }))

  test("EX-278", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text   content</div>")
      yield* page.locator("#node").pipe(Expect.toContainText("content"))
    }))

  test("EX-279", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const failure = yield* expectationFailure(
        page.locator("#node").pipe(Expect.toContainText("foo"), Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "to contain the text \"foo\"")
      assert.deepStrictEqual(observedValues(failure), ["Text content"])
    }))

  test("EX-282", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const failure = yield* expectationFailure(
        page.locator("#node").pipe(Expect.toHaveText("Text"), Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "to have the text \"Text\"")
      assert.deepStrictEqual(observedValues(failure), ["Text content"])
    }))

  test("EX-283", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      // The original's `page.waitForTimeout(1000)` before its change, ported as written
      yield* later(
        "1 second",
        page.evaluateInMainWorld(() => {
          document.querySelector("#node")!.textContent = "Text 2 content"
        })
      )
      yield* page.locator("#node").pipe(Expect.toHaveText(/Text 2/))
    }))

  test("EX-286", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const failure = yield* expectationFailure(
        page.locator("#node").pipe(Expect.toHaveText("Text"), Deadline.within("1 millis"))
      )
      assert.strictEqual(failure.condition, "to have the text \"Text\"")
      assert.deepStrictEqual(observedValues(failure), ["Text content"])
    }))

  test("EX-287", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
        <div>Initial</div>
        <script>
          const field = document.querySelector('div');
          setTimeout(() => {
            field.id = 'field';
            field.textContent = 'Final value';
          }, 1000);
        </script>
      `)
      const failure = yield* expectationFailure(
        page.locator("#field").pipe(Expect.toHaveText("Something"), Deadline.within("3 seconds"))
      )
      // The failure is the text mismatch, not a missing element: the last thing seen is the text
      assert.strictEqual(failure.condition, "to have the text \"Something\"")
      assert.strictEqual(observedValues(failure).at(-1), "Final value")
    }))

  test("EX-288", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const locator = page.locator("#node")
      yield* Expect.that(locator.readText, Condition.not(textIs("Text2")))
      // Case-sensitive by default
      yield* Expect.that(locator.readText, Condition.not(textIs("TEXT")))
    }))

  test("EX-289", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      const failure = yield* expectationFailure(
        Expect.that(page.locator("#node").readText, Condition.not(textIs("Text content"))).pipe(
          Deadline.within("1 second")
        )
      )
      assert.strictEqual(failure.condition, "not to have the text \"Text content\"")
      // A polled read ends its history with the check still running at the deadline, so the state read is an entry before it
      assert.include(observedValues(failure), "Text content")
    }))

  test("EX-290", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div>")
      const differs = Condition.make(
        "not to have the text \"hello\"",
        (seen: string | { readonly matches: number }) => typeof seen === "string" && seen !== "hello"
      )
      const failure = yield* expectationFailure(
        Expect.that(textOfOne(page.locator("span")), differs).pipe(Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "not to have the text \"hello\"")
      // The element is missing, not a text that differs
      assert.deepStrictEqual(observedValues(failure).at(0), { matches: 0 })
    }))

  test("EX-292", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=div></div>")
      yield* later(
        "500 millis",
        page.evaluateInMainWorld(() => {
          document.querySelector("div")!.innerHTML = "<p>Text 1</p><p>Text 2</p>"
        })
      )
      yield* page.locator("p").pipe(Expect.toHaveText(["Text 1", "Text 2"]))
    }))

  test("EX-293", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      yield* page.locator("p").pipe(Expect.toHaveText([]))
    }))

  test("EX-294", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div><p>Test</p></div>")
      // `not.toHaveText([])` holds when the locator has a match
      yield* Expect.that(page.locator("p").count, atLeastOneMatch)
    }))

  test("EX-295", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      // `not.toHaveText(["Test"])` holds with no match: no texts are not `["Test"]`
      yield* Expect.that(textsOf(page.locator("p")), Condition.not(textsAre(["Test"])))
    }))

  test("EX-296", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      const failure = yield* expectationFailure(
        Expect.that(page.locator("p").count, atLeastOneMatch).pipe(Deadline.within("1 second"))
      )
      assert.include(failure.message, "to have at least one match")
      // The state read is an entry before the check still running at the deadline
      assert.include(observedValues(failure), 0)
    }))

  test("EX-297", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=div><p>Text</p></div>")
      yield* later(
        "500 millis",
        page.evaluateInMainWorld(() => {
          document.querySelector("div")!.innerHTML = ""
        })
      )
      yield* Expect.that(page.locator("p").count, atLeastOneMatch)
    }))

  test("EX-298", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>Text 1</div><div>Text 3</div>")
      const failure = yield* expectationFailure(
        page.locator("div").pipe(Expect.toHaveText(["Text 1", /Text \d/, "Extra"]), Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "to have the text [\"Text 1\", /Text \\d/, \"Extra\"]")
      // Two elements where three were expected: the observed list holds the two texts
      assert.deepStrictEqual(observedValues(failure), [["Text 1", "Text 3"]])
    }))
})
