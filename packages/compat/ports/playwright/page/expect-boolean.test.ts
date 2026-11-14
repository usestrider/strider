/**
 * Playwright's `tests/page/expect-boolean.spec.ts`: the boolean locator matchers (`toBeChecked`, `toBeEditable`,
 * `toBeEnabled`, `toBeDisabled`, `toBeEmpty`, `toBeVisible`, `toBeHidden`, `toBeFocused`, `toBeAttached`) with their
 * `.not` forms and their options, the matchers' failure messages, and the expectations that wait for a change.
 *
 * What the port changes:
 * - Strider's matchers take no options. Each `timeout` is `Deadline.within` around the expectation. Each state option
 *   is a matcher of its own: `toBeChecked({ checked: false })` is `Expect.that` on `isChecked` for an unchecked state,
 *   `toBeEnabled({ enabled: false })` is `Expect.toBeDisabled`, `toBeAttached({ attached: false })` is
 *   `Expect.toBeDetached`, and so on.
 * - `.not` is the inverse matcher where Strider has one: `not.toBeVisible` is `Expect.toBeHidden`, `not.toBeAttached` is
 *   `Expect.toBeDetached`, `not.toBeEnabled` is `Expect.toBeDisabled`, and `not.toBeDisabled` is `Expect.toBeEnabled`.
 *   Where it has none (`not.toBeChecked`, `not.toBeEditable`, and `not.toBeEmpty` on an input), the port waits on a read
 *   with `Expect.that` and `Condition.not`. A read doesn't retry while the element is missing, so EX-012 asserts that
 *   read's `NoMatch` where the original waits for the element and then fails.
 * - `toBeEmpty` on an input reads its raw value; EX-032's `not.toBeEmpty` is `Expect.toHaveValue` with a pattern that
 *   matches any value, which is the same test on the same value.
 * - A failed expectation is `Expect.ExpectationFailed`, with the last value it observed. Where the original checks the
 *   text of its message, the port checks the failure's observed value, which says what the message said: the state
 *   (`"unchecked"`, `"disabled"`), or the match count (`{ matches: 0 }`, `{ matches: 1, visible: 0 }`).
 * - `page.setContent`, `page.waitForTimeout`, `page.$eval`, and `locator.evaluate` are `page.setContent`,
 *   `Effect.sleep` (the original's own fixed wait, ported as written), and `page.evaluateInMainWorld`. A `setTimeout`
 *   callback is `later`: a child fiber that sleeps and then makes the change, as the original's timer does.
 * - A promise the original holds across steps (`const promise = expect(…)`, checked after a wait) is `startWaiting`:
 *   it starts at once, and `done` says whether it has resolved.
 * - `page.frameLocator("iframe")` is `page.frame(page.locator("iframe"))`, which a frame not there yet waits for.
 * - The `test.step` for each role in EX-013 is a loop; a failure doesn't name the role.
 * - `page.request.get` and `toBeOK` have no Strider counterpart, so EX-066 to EX-072 are `needsFeature` (see the ledger).
 *   EX-064 and EX-065 test Playwright's selector-string syntax, and EX-022 tests a throw on an unsupported kind, which
 *   Strider decides otherwise (see the ledger).
 * - EX-005 and EX-011 and EX-004 test `indeterminate`, which Strider's `toBeChecked` doesn't take (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Condition, Deadline, Expect, Locator } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The value of a failure's last observation, as the expectation recorded it. */
const lastValue = (failure: Expect.ExpectationFailed): unknown =>
  Option.getOrUndefined(Option.map(failure.last, (observed) => observed.value))

/**
 * What a polled expectation (`Expect.that`) saw, in order. Its final entry is always the check that was still running
 * at the deadline (`{ error }`), so the state it read is in the entries before.
 */
const observedValues = (failure: Expect.ExpectationFailed): ReadonlyArray<unknown> =>
  failure.history.map((observed) => observed.value)

/** A failure of `effect`, which must be an expectation's `ExpectationFailed`. */
const expectationFailure = Effect.fnUntraced(function*(effect: Effect.Effect<void, unknown>) {
  const failure = yield* failureOf(effect, "the expectation")
  assert(Expect.isExpectationFailed(failure), String(failure))
  return failure
})

/**
 * Playwright's `setTimeout(change, delay)`: a child fiber that sleeps, then makes the change. The original ignores the
 * change's failure (`.catch(() => {})`), and nothing joins the timer, so the test's end ends it.
 */
const later = (delay: Duration.Input, change: Effect.Effect<unknown, unknown>) =>
  Effect.forkChild(Effect.sleep(delay).pipe(Effect.andThen(change), Effect.ignore), { startImmediately: true })

const checked = Condition.make("checked", (value: boolean) => value)
const notChecked = Condition.not(checked)
const unchecked = Condition.make("unchecked", (value: boolean) => !value)
const editable = Condition.make("editable", (value: boolean) => value)
const notEditable = Condition.not(editable)

upstream(import.meta.filename, {}, (test) => {
  test("EX-001", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=checkbox checked></input>")
      yield* page.locator("input").pipe(Expect.toBeChecked)
    }))

  test("EX-002", ({ page }) =>
    Effect.gen(function*() {
      // `checked: true` is the default
      yield* page.setContent("<input type=checkbox checked></input>")
      yield* page.locator("input").pipe(Expect.toBeChecked)
    }))

  test("EX-003", ({ page }) =>
    Effect.gen(function*() {
      // `not.toBeChecked({ checked: false })` on a checked box is `toBeChecked`
      yield* page.setContent("<input type=checkbox checked></input>")
      yield* page.locator("input").pipe(Expect.toBeChecked)
    }))

  test("EX-006", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=checkbox></input>")
      const failure = yield* expectationFailure(
        page.locator("input").pipe(Expect.toBeChecked, Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "to be checked")
      assert.strictEqual(lastValue(failure), "unchecked")
    }))

  test("EX-007", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=checkbox></input>")
      yield* Expect.that(page.locator("input").isChecked, notChecked)
    }))

  test("EX-008", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=checkbox></input>")
      yield* Expect.that(page.locator("input").isChecked, unchecked)
    }))

  test("EX-009", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=checkbox checked></input>")
      const failure = yield* expectationFailure(
        Expect.that(page.locator("input").isChecked, notChecked).pipe(Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "not checked")
      assert.include(observedValues(failure), true)
    }))

  test("EX-010", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=checkbox checked></input>")
      const failure = yield* expectationFailure(
        Expect.that(page.locator("input").isChecked, unchecked).pipe(Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "unchecked")
      assert.include(observedValues(failure), true)
    }))

  test("EX-012", ({ page }) =>
    Effect.gen(function*() {
      // The original waits 1 second for `input2` and then fails with "element(s) not found". Strider's read fails
      // at once with `NoMatch`, which names the locator, and doesn't wait for it.
      yield* page.setContent("<div>no inputs here</div>")
      const read = yield* failureOf(
        Expect.that(page.locator("input2").isChecked, notChecked).pipe(Deadline.within("1 second")),
        "the read"
      )
      assert(Locator.isLocatorError(read), String(read))
      assert.strictEqual(read.reason._tag, "NoMatch")
    }))

  test("EX-013", ({ page }) =>
    Effect.gen(function*() {
      // The original's `test.step` for each role; a failing role doesn't name itself here
      const roles = ["checkbox", "menuitemcheckbox", "option", "radio", "switch", "menuitemradio", "treeitem"]
      for (const role of roles) {
        yield* page.setContent(`<div role=${role} aria-checked=true>I am checked</div>`)
        yield* page.locator("div").pipe(Expect.toBeChecked)
      }
    }))

  test("EX-014", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=checkbox></input>")
      const first = yield* expectationFailure(
        page.locator("input").pipe(Expect.toBeChecked, Deadline.within("1 second"))
      )
      assert.strictEqual(lastValue(first), "unchecked")

      yield* page.setContent("<input type=checkbox checked></input>")
      const second = yield* expectationFailure(
        Expect.that(page.locator("input").isChecked, unchecked).pipe(Deadline.within("1 second"))
      )
      assert.include(observedValues(second), true)
    }))

  test("EX-015", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=checkbox checked></input>")
      yield* page.locator("input").pipe(Expect.toBeChecked, Deadline.within("1 millis"))
    }))

  test("EX-016", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=checkbox></input>")
      yield* Expect.that(page.locator("input").isChecked, notChecked).pipe(Deadline.within("1 millis"))
    }))

  test("EX-017", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input></input>")
      yield* page.locator("input").pipe(Expect.toBeEditable)
    }))

  test("EX-018", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input readonly></input>")
      yield* Expect.that(page.locator("input").isEditable, notEditable)
    }))

  test("EX-019", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input></input>")
      yield* page.locator("input").pipe(Expect.toBeEditable)
    }))

  test("EX-020", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input readonly></input>")
      yield* Expect.that(page.locator("input").isEditable, notEditable)
    }))

  test("EX-021", ({ page }) =>
    Effect.gen(function*() {
      // `not.toBeEditable({ editable: false })` is `toBeEditable`
      yield* page.setContent("<input></input>")
      yield* page.locator("input").pipe(Expect.toBeEditable)
    }))

  test("EX-023", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button>Text</button>")
      yield* page.locator("button").pipe(Expect.toBeEnabled)
    }))

  test("EX-024", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button>Text</button>")
      yield* page.locator("button").pipe(Expect.toBeEnabled)
    }))

  test("EX-025", ({ page }) =>
    Effect.gen(function*() {
      // `toBeEnabled({ enabled: false })` is `toBeDisabled`
      yield* page.setContent("<button disabled>Text</button>")
      yield* page.locator("button").pipe(Expect.toBeDisabled)
    }))

  test("EX-026", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button disabled>Text</button>")
      const failure = yield* expectationFailure(
        page.locator("button").pipe(Expect.toBeEnabled, Deadline.within("1 second"))
      )
      assert.strictEqual(lastValue(failure), "disabled")
    }))

  test("EX-027", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button disabled>Text</button>")
      yield* later(
        "500 millis",
        page.evaluateInMainWorld(() => document.querySelector("button")!.removeAttribute("disabled"))
      )
      yield* page.locator("button").pipe(Expect.toBeEnabled)
    }))

  test("EX-028", ({ page }) =>
    Effect.gen(function*() {
      // `not.toBeEnabled()` is `toBeDisabled`
      yield* page.setContent("<button>Text</button>")
      yield* later(
        "500 millis",
        page.evaluateInMainWorld(() => document.querySelector("button")!.setAttribute("disabled", ""))
      )
      yield* page.locator("button").pipe(Expect.toBeDisabled)
    }))

  test("EX-029", ({ page }) =>
    Effect.gen(function*() {
      // `not.toBeEnabled({ enabled: false })` is `toBeEnabled`
      yield* page.setContent("<button>Text</button>")
      yield* page.locator("button").pipe(Expect.toBeEnabled)
    }))

  test("EX-030", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button disabled>Text</button>")
      yield* page.locator("button").pipe(Expect.toBeDisabled)
    }))

  test("EX-031", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input></input>")
      yield* page.locator("input").pipe(Expect.toBeEmpty)
    }))

  test("EX-032", ({ page }) =>
    Effect.gen(function*() {
      // An input's raw value is not empty, so `not.toBeEmpty` is a value that matches any character
      yield* page.setContent("<input value=text></input>")
      yield* page.locator("input").pipe(Expect.toHaveValue(/[\s\S]/))
    }))

  test("EX-033", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div style=\"width: 50; height: 50px\"></div>")
      yield* page.locator("div").pipe(Expect.toBeEmpty)
    }))

  test("EX-034", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button disabled=\"yes\">Text</button>")
      yield* page.locator("button").pipe(Expect.toBeDisabled)
    }))

  test("EX-035", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=checkbox checked=\"yes\"></input>")
      yield* page.locator("input").pipe(Expect.toBeChecked)
    }))

  test("EX-036", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=checkbox hidden=\"of course\"></input>")
      yield* page.locator("input").pipe(Expect.toBeHidden)
    }))

  test("EX-037", ({ page }) =>
    Effect.gen(function*() {
      // `not.toBeDisabled()` is `toBeEnabled`: a div is not a control that can be disabled
      yield* page.setContent("<div disabled=\"yes\"></div>")
      yield* page.locator("div").pipe(Expect.toBeEnabled)
    }))

  test("EX-038", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input></input>")
      yield* page.locator("input").pipe(Expect.toBeVisible)
    }))

  test("EX-039", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button style=\"display: none\">hello</button>")
      yield* page.locator("button").pipe(Expect.toBeHidden)
    }))

  test("EX-040", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button>hello</button>")
      yield* page.locator("button").pipe(Expect.toBeVisible)
    }))

  test("EX-041", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button hidden>hello</button>")
      yield* page.locator("button").pipe(Expect.toBeHidden)
    }))

  test("EX-042", ({ page }) =>
    Effect.gen(function*() {
      // `not.toBeVisible({ visible: false })` is `toBeVisible`
      yield* page.setContent("<button>hello</button>")
      yield* page.locator("button").pipe(Expect.toBeVisible)
    }))

  test("EX-043", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      yield* later(
        0,
        page.evaluateInMainWorld(() => {
          document.querySelector("div")!.innerHTML = "<span>Hello</span>"
        })
      )
      yield* page.locator("span").pipe(Expect.toBeVisible)
    }))

  test("EX-044", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div><span>Hello</span></div>")
      yield* later(
        0,
        page.evaluateInMainWorld(() => {
          document.querySelector("span")!.textContent = ""
        })
      )
      yield* page.locator("span").pipe(Expect.toBeHidden)
    }))

  test("EX-045", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button style=\"display: none\"></button>")
      const failure = yield* expectationFailure(
        page.locator("button").pipe(Expect.toBeVisible, Deadline.within("1 second"))
      )
      assert.deepStrictEqual(lastValue(failure), { matches: 1, visible: 0 })
    }))

  test("EX-046", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input></input>")
      const failure = yield* expectationFailure(
        page.locator("input").pipe(Expect.toBeHidden, Deadline.within("1 second"))
      )
      assert.deepStrictEqual(lastValue(failure), { matches: 1, visible: 1 })
    }))

  test("EX-047", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      yield* page.locator("#node").pipe(Expect.toBeVisible, Deadline.within("1 millis"))
    }))

  test("EX-048", ({ page }) =>
    Effect.gen(function*() {
      // Nothing matches, which is hidden
      yield* page.setContent("<div id=node>Text content</div>")
      yield* page.locator("no-such-thing").pipe(Expect.toBeHidden, Deadline.within("1 millis"))
    }))

  test("EX-049", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      const locator = page.frame(page.locator("iframe")).locator("input")
      const waiting = yield* startWaiting(locator.pipe(Expect.toBeVisible))
      yield* Effect.sleep("1 second") // the original's fixed wait: the frame's input must still be missing after it
      assert.isFalse(yield* waiting.done)
      yield* page.setContent("<iframe srcdoc=\"<input>\"></iframe>")
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("EX-050", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<iframe></iframe>")
      const locator = page.frame(page.locator("iframe")).locator("input")
      const waiting = yield* startWaiting(locator.pipe(Expect.toBeVisible))
      yield* Effect.sleep("1 second")
      assert.isFalse(yield* waiting.done)
      yield* page.setContent("<iframe srcdoc=\"<input>\"></iframe>")
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("EX-051", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const waiting = yield* startWaiting(page.locator("input").pipe(Expect.toBeVisible))
      yield* Effect.sleep("1 second")
      assert.isFalse(yield* waiting.done)
      yield* page.goto(server.PREFIX + "/input/checkbox.html")
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("EX-052", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button style=\"display: none\"></button>")
      yield* page.locator("button").pipe(Expect.toBeHidden)
    }))

  test("EX-053", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      yield* page.locator("button").pipe(Expect.toBeHidden)
    }))

  test("EX-054", ({ page }) =>
    Effect.gen(function*() {
      // `not.toBeHidden()` is `toBeVisible`
      yield* page.setContent("<input></input>")
      yield* page.locator("input").pipe(Expect.toBeVisible)
    }))

  test("EX-055", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      yield* later(
        0,
        page.evaluateInMainWorld(() => {
          document.querySelector("div")!.innerHTML = "<span>Hello</span>"
        })
      )
      yield* page.locator("span").pipe(Expect.toBeVisible)
    }))

  test("EX-056", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div><span>Hello</span></div>")
      yield* later(
        0,
        page.evaluateInMainWorld(() => {
          document.querySelector("span")!.textContent = ""
        })
      )
      yield* page.locator("span").pipe(Expect.toBeHidden)
    }))

  test("EX-057", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input></input>")
      const failure = yield* expectationFailure(
        page.locator("input").pipe(Expect.toBeHidden, Deadline.within("3 seconds"))
      )
      assert.deepStrictEqual(lastValue(failure), { matches: 1, visible: 1 })
    }))

  test("EX-058", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button style=\"display: none\"></button>")
      const failure = yield* expectationFailure(
        page.locator("button").pipe(Expect.toBeVisible, Deadline.within("3 seconds"))
      )
      assert.deepStrictEqual(lastValue(failure), { matches: 1, visible: 0 })
    }))

  test("EX-059", ({ page }) =>
    Effect.gen(function*() {
      // Nothing matches: `not.toBeHidden()` waits for something visible, and reports the count it saw
      yield* page.setContent("<div></div>")
      const failure = yield* expectationFailure(
        page.locator("button").pipe(Expect.toBeVisible, Deadline.within("1 second"))
      )
      assert.strictEqual(failure.condition, "to be visible")
      assert.deepStrictEqual(lastValue(failure), { matches: 0, visible: 0 })
    }))

  test("EX-060", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      yield* page.locator("#node").pipe(Expect.toBeVisible, Deadline.within("1 millis"))
    }))

  test("EX-061", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      yield* page.locator("no-such-thing").pipe(Expect.toBeHidden, Deadline.within("1 millis"))
    }))

  test("EX-062", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input></input>")
      const locator = page.locator("input")
      yield* locator.focus()
      yield* locator.pipe(Expect.toBeFocused)
    }))

  test("EX-063", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
        <div id="app">
        </div>
        <script>
          const root = document.querySelector('div');
          const shadowRoot = root.attachShadow({ mode: 'open' });
          const input = document.createElement('input');
          input.id = "my-input"
          shadowRoot.appendChild(input);
        </script>
      `)
      yield* page.locator("input").focus()
      const focused = yield* page.evaluateInMainWorld(() =>
        (document.activeElement as HTMLElement).shadowRoot!.activeElement!.id
      )
      assert.strictEqual(focused, "my-input")
      // The deep active element is inside the shadow root of #app, so both the host and the input are focused
      yield* page.locator("#app").pipe(Expect.toBeFocused)
      yield* page.locator("input").pipe(Expect.toBeFocused)
    }))

  test("EX-065", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's message quotes its CSS parser ("Unexpected token \"]\" while parsing css selector \"row]\""). Strider
      // reports the invalid selector as the expectation's last entry, and a read of the same locator refuses it as
      // `InvalidInput` for the selector
      const failure = yield* expectationFailure(page.locator("row]").pipe(Expect.toBeVisible))
      const errors = observedValues(failure).filter((value): value is { readonly error: string } =>
        typeof value === "object" && value !== null && "error" in value && typeof value.error === "string"
      )
      assert.isTrue(errors.some((entry) => entry.error.includes("row]")), JSON.stringify(observedValues(failure)))
      const refusal = yield* Effect.flip(page.locator("row]").isVisible)
      assert(Locator.isLocatorError(refusal), String(refusal))
      assert.strictEqual(refusal.reason._tag, "InvalidInput")
      assert.strictEqual(refusal.reason._tag === "InvalidInput" ? refusal.reason.input : undefined, "selector")
    }))

  test("EX-073", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input></input>")
      yield* page.locator("input").pipe(Expect.toBeAttached)
    }))

  test("EX-074", ({ page }) =>
    Effect.gen(function*() {
      // Hidden elements are attached
      yield* page.setContent("<button style=\"display:none\">hello</button>")
      yield* page.locator("button").pipe(Expect.toBeAttached)
    }))

  test("EX-075", ({ page }) =>
    Effect.gen(function*() {
      // `not.toBeAttached()` is `toBeDetached`
      yield* page.setContent("<button>hello</button>")
      yield* page.locator("input").pipe(Expect.toBeDetached)
    }))

  test("EX-076", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button>hello</button>")
      yield* page.locator("button").pipe(Expect.toBeAttached)
    }))

  test("EX-077", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button>hello</button>")
      yield* page.locator("input").pipe(Expect.toBeDetached)
    }))

  test("EX-078", ({ page }) =>
    Effect.gen(function*() {
      // `not.toBeAttached({ attached: false })` is `toBeAttached`
      yield* page.setContent("<button>hello</button>")
      yield* page.locator("button").pipe(Expect.toBeAttached)
    }))

  test("EX-079", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      yield* later(
        0,
        page.evaluateInMainWorld(() => {
          document.querySelector("div")!.innerHTML = "<span>Hello</span>"
        })
      )
      yield* page.locator("span").pipe(Expect.toBeAttached)
    }))

  test("EX-080", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div><span>Hello</span></div>")
      yield* later(
        0,
        page.evaluateInMainWorld(() => {
          document.querySelector("div")!.textContent = ""
        })
      )
      yield* page.locator("span").pipe(Expect.toBeDetached)
    }))

  test("EX-081", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<button>Hello</button>")
      const failure = yield* expectationFailure(
        page.locator("input").pipe(Expect.toBeAttached, Deadline.within("1 second"))
      )
      assert.deepStrictEqual(lastValue(failure), { matches: 0 })
    }))

  test("EX-082", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input></input>")
      const failure = yield* expectationFailure(
        page.locator("input").pipe(Expect.toBeDetached, Deadline.within("3 seconds"))
      )
      assert.deepStrictEqual(lastValue(failure), { matches: 1 })
    }))

  test("EX-083", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      yield* page.locator("#node").pipe(Expect.toBeAttached, Deadline.within("1 millis"))
    }))

  test("EX-084", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=node>Text content</div>")
      yield* page.locator("no-such-thing").pipe(Expect.toBeDetached, Deadline.within("1 millis"))
    }))

  test("EX-085", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div></div>")
      const locator = page.frame(page.locator("iframe")).locator("input")
      const waiting = yield* startWaiting(locator.pipe(Expect.toBeAttached))
      yield* Effect.sleep("1 second")
      assert.isFalse(yield* waiting.done)
      yield* page.setContent("<iframe srcdoc=\"<input>\"></iframe>")
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("EX-086", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const waiting = yield* startWaiting(page.locator("input").pipe(Expect.toBeAttached))
      yield* Effect.sleep("1 second")
      assert.isFalse(yield* waiting.done)
      yield* page.goto(server.PREFIX + "/input/checkbox.html")
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))
})
