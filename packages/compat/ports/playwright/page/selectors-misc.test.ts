/**
 * Playwright's `tests/page/selectors-misc.spec.ts`: the selector strings Playwright's engines take beyond CSS, and what
 * they match: open shadow DOM, `:visible`, `visible=`, `:nth-match`, `nth=`, strict chaining, `internal:has`,
 * `internal:has-not`, `internal:and`, `internal:or`, `internal:chain`, a large DOM, `display: contents`, and
 * `data-testid` and `id`. SE-141 (layout selectors) and SE-142 to SE-145 (XPath) have no Strider form and are
 * `needsFeature` (see the ledger).
 *
 * What the port changes:
 * - A selector string is a chain of locators. `a >> b` is `page.locator(a).locator(b)`, and `>> nth=n`, `>> visible=…`,
 *   `>> internal:has=…`, `>> internal:and=…`, `>> internal:or=…`, and `>> internal:chain=…` are the locator queries of
 *   the same meaning: `nth(n)`, `filter({ visible })`, `filter({ has })`, `and`, `or`, and a chained locator.
 * - Playwright's `$` and `$eval` take the first match, where Strider's reads are strict: they take `.first` where the
 *   original takes the first, and `count` or `all` where it takes all (`$$`).
 * - `:visible` is `filter({ visible: true })`. `:nth-match(s, n)` is `locator(s).nth(n - 1)`, and `:is(…)` over two of
 *   them is `or`. A `,` in the selector list before the index is a CSS selector list, which keeps document order.
 * - `waitForSelector` waits for a visible element by default, so it's `Expect.toBeVisible`; `state: "attached"` is
 *   `Expect.toBeAttached`, and `state: "hidden"` is `Expect.toBeHidden`. Its `timeout` is a `Deadline` around the
 *   expectation, and its timeout error is the `ExpectationFailed` the expectation ends with. Each `expect` is
 *   `Deadline.within("5 seconds")`, Playwright's default for `expect`.
 * - `data-testid=find-me` is `getByTestId`, and `id=target1` is the CSS `#target1`. `div >> data-testid=…` is
 *   `locator("div").getByTestId(…)`.
 * - `"DISPLAY CONTENTS"`, the quoted legacy text selector, is `getByText(…, { exact: true })`: the whole text, where
 *   Playwright compares the element's own text-node runs. The rest of SE-147's cases hold.
 * - `page.$eval(…, e => e.textContent = …)` and the other steps that change the page through an element are
 *   `page.evaluateInMainWorld`: the page's change is the same on every backend.
 * - `const promise = page.waitForSelector(…)`, awaited after a step, is `startWaiting`, which starts the wait at once.
 * - `page.evaluate` in the main world is `evaluateInMainWorld`, and the page's `clickCount` global is read there too.
 * - Playwright's `:light` suffix (`id:light=…`, `data-testid:light=…`) matches light DOM only. Strider's selectors cross
 *   open shadow roots, and there's no light-only form, so those assertions are left out, and the rest of SE-133 is
 *   ported.
 * - Playwright's selector-string syntax errors (malformed `internal:has`, `:nth-match` and `:near` argument errors, the
 *   `internal:has` position errors, `div >> internal:has=33`) have no Strider form: a typed `getByX` takes no
 *   selector string to reject. Those assertions are left out, and each test's other steps are ported.
 * - SE-148's `internal:has="xpath=./span"` assertion has no Strider form (XPath is CSS-only here) and is left out; its CSS
 *   twin, `internal:has="span"`, is ported.
 * - SE-147's steps are independent, so each runs to the end and the test fails with every step that failed.
 * - The large-DOM test's timings are left out: the port checks the counts, which are the test's assertions.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { expectationFailure, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's default for `expect`, which waits 5 seconds; a Strider expectation otherwise runs to the test's deadline. */
const expectDeadline = Deadline.within("5 seconds")

/** The `id` of the one match, or `undefined` when it has none: Playwright's `e.id`. */
const idOf = (locator: Locator.ReadonlyLocator) => Effect.map(locator.readAttribute("id"), Option.getOrUndefined)

/** The text of each match, in document order: Playwright's `evaluateAll(els => els.map(e => e.textContent))`. */
const textsOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const matches = yield* locator.all
  return yield* Effect.forEach(matches, (each) => each.readText)
})

/** Playwright's `a >> b >> …`: each step is a locator inside the one before it. */
const chain = (start: Locator.ReadonlyLocator, ...steps: ReadonlyArray<string>): Locator.ReadonlyLocator =>
  steps.reduce<Locator.ReadonlyLocator>((locator, css) => locator.locator(css), start)

/**
 * Each step of a test runs to the end, and the test fails once with every step that failed: for a test whose steps are
 * independent, so one failure doesn't hide the others.
 */
const steps = () => {
  const failures: Array<string> = []
  return {
    step: Effect.fnUntraced(function*(what: string, check: Effect.Effect<void, unknown>) {
      const result = yield* Effect.result(check)
      if (Result.isFailure(result)) failures.push(`${what}: ${String(result.failure)}`)
    }),
    done: () => {
      if (failures.length > 0) assert.fail(`${failures.length} steps failed:\n${failures.join("\n")}`)
    }
  }
}

const twoDivs = `
    <section>
      <div id=target1></div>
      <div id=target2></div>
    </section>
  `

upstream(import.meta.filename, {}, (test) => {
  test("SE-133", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/deep-shadow.html")
      assert.strictEqual(yield* page.locator("#target").readText, "Hello from root2")
      assert.strictEqual(yield* page.getByTestId("foo").first.readText, "Hello from root1")
      assert.strictEqual(yield* page.getByTestId("foo").count, 3)
    }))

  test("SE-134", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/shadow-dom-link.html")
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { clickCount: number }).clickCount),
        0
      )
      yield* page.locator("#inner-link").click()
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { clickCount: number }).clickCount),
        1
      )
    }))

  test("SE-135", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(twoDivs)
      const visible = page.locator("div").filter({ visible: true })
      assert.strictEqual(yield* visible.count, 0)

      // `waitForSelector` with its default state (visible) and a 1000 ms timeout: the wait ends in its timeout
      yield* expectationFailure(Expect.toBeVisible(visible).pipe(Deadline.within("1 second")))

      const promise = yield* startWaiting(Expect.toBeAttached(visible))
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("#target2")!.textContent = "Now visible"
      })
      yield* Fiber.join(promise.fiber)
      assert.strictEqual(yield* idOf(visible), "target2")
      assert.strictEqual(yield* idOf(visible), "target2")
    }))

  test("SE-136", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(twoDivs)
      // `div >> visible=true` is the same filter on the divs, chained from the section's `div` locator
      const visible = page.locator("div").filter({ visible: true })
      assert.strictEqual(yield* visible.count, 0)

      yield* expectationFailure(Expect.toBeVisible(visible).pipe(Deadline.within("1 second")))

      const promise = yield* startWaiting(Expect.toBeAttached(visible))
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("#target2")!.textContent = "Now visible"
      })
      yield* Fiber.join(promise.fiber)
      assert.strictEqual(yield* idOf(visible), "target2")
      assert.strictEqual(yield* idOf(visible), "target2")
    }))

  test("SE-137", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(twoDivs)
      const hidden = page.locator("div").filter({ visible: false })
      yield* Expect.toHaveCount(hidden, 2).pipe(expectDeadline)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("#target2")!.textContent = "Now visible"
      })
      yield* Expect.toHaveCount(hidden, 1).pipe(expectDeadline)
    }))

  test("SE-138", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(twoDivs)
      const divs = page.locator("div")
      assert.strictEqual(yield* divs.nth(2).count, 0)
      assert.strictEqual(yield* idOf(divs.nth(0)), "target1")
      assert.strictEqual(yield* idOf(divs.nth(1)), "target2")
      assert.strictEqual(yield* idOf(page.locator("section > div").nth(1)), "target2")
      // `:nth-match(section, div, 2)`: the selector list is `section, div`, and its second match is the first div
      assert.strictEqual(yield* idOf(page.locator("section, div").nth(1)), "target1")
      // `:nth-match(div, section, 3)`: `div, section` in document order, its third match
      assert.strictEqual(yield* idOf(page.locator("div, section").nth(2)), "target2")
      assert.strictEqual(yield* divs.nth(0).or(divs.nth(1)).count, 2)

      const promise = yield* startWaiting(Expect.toBeAttached(divs.nth(2)))
      yield* page.evaluateInMainWorld(() => {
        const div = document.createElement("div")
        div.setAttribute("id", "target3")
        document.querySelector("section")!.appendChild(div)
      })
      yield* Fiber.join(promise.fiber)
      assert.strictEqual(yield* idOf(divs.nth(2)), "target3")
    }))

  test("SE-139", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(twoDivs)
      const divs = page.locator("div")
      assert.strictEqual(yield* divs.nth(2).count, 0)
      assert.strictEqual(yield* idOf(divs.nth(0)), "target1")
      assert.strictEqual(yield* idOf(divs.nth(1)), "target2")
      assert.strictEqual(yield* idOf(page.locator("section > div").nth(1)), "target2")
      // `section, div >> nth=1`: the first and second matches of `section, div` in document order
      assert.strictEqual(yield* idOf(page.locator("section, div").nth(1)), "target1")
      assert.strictEqual(yield* idOf(page.locator("div, section").nth(2)), "target2")

      const promise = yield* startWaiting(Expect.toBeAttached(divs.nth(2)))
      yield* page.evaluateInMainWorld(() => {
        const div = document.createElement("div")
        div.setAttribute("id", "target3")
        document.querySelector("section")!.appendChild(div)
      })
      yield* Fiber.join(promise.fiber)
      assert.strictEqual(yield* idOf(divs.nth(2)), "target3")

      yield* page.setContent(`
    <div>
      <div>
        <div>
          <span>hi</span>
          <span>hello</span>
        </div>
      </div>
    </div>
  `)
      assert.strictEqual(yield* chain(page.locator("div"), "div", "span").nth(1).readText, "hello")
    }))

  test("SE-140", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>
      <div>
        <div>
          <span>hi</span>
        </div>
      </div>
    </div>
  `)
      assert.strictEqual(yield* chain(page.locator("div"), "div", "span").readText, "hi")
    }))

  // SE-141 (layout selectors `:right-of`, `:left-of`, `:above`, `:below`, `:near`) is needsFeature: see the ledger.

  // SE-142 to SE-145 (`xpath=`, `//…` selectors, and the XPath error message) are needsFeature: see the ledger.

  test("SE-146", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <span data-testid="find-me" id=target1>1</span>
    <div>
      <span data-testid="find-me" id=target2>2</span>
    </div>
  `)
      // `page.$eval` takes the first match of the page's `data-testid=find-me`, and the handle's `$eval` is the div's
      assert.strictEqual(yield* idOf(page.getByTestId("find-me").first), "target1")
      const div = page.locator("div")
      assert.strictEqual(yield* idOf(div.getByTestId("find-me")), "target2")
      assert.strictEqual(yield* idOf(div.getByTestId("find-me").first), "target2")
    }))

  test("SE-147", ({ page }) =>
    Effect.gen(function*() {
      const all = steps()
      // `display: contents` elements are visible when they draw something, and the waits here are `waitForSelector`'s
      // default, so each is `Expect.toBeVisible`, or `toBeHidden` for the last. Each step is bounded by `expectDeadline`, so that
      // a failing step ends in 5 seconds and the steps after it run
      yield* page.setContent(`
    <div>
      <p style="display:contents">DISPLAY CONTENTS</p>
    </div>`)
      yield* all.step(
        "step 1",
        Expect.toBeVisible(page.getByText("DISPLAY CONTENTS", { exact: true })).pipe(expectDeadline)
      )

      yield* page.setContent(`
    <div>
      <article style="display:contents"><div>DISPLAY CONTENTS</div></article>
    </div>`)
      yield* all.step("step 2", Expect.toBeVisible(page.locator("article")).pipe(expectDeadline))

      yield* page.setContent(`
    <div>
      <article style="display:contents"><div style="display:contents">DISPLAY CONTENTS</div></article>
    </div>`)
      yield* all.step("step 3", Expect.toBeVisible(page.locator("article")).pipe(expectDeadline))

      yield* page.setContent(`
    <div>
      <article style="display:contents"><div></div>DISPLAY CONTENTS<span></span></article>
    </div>`)
      yield* all.step("step 4", Expect.toBeVisible(page.locator("article")).pipe(expectDeadline))

      yield* page.setContent(`
    <div>
      <article style="display:contents"><div></div></article>
    </div>`)
      yield* all.step("step 5", Expect.toBeHidden(page.locator("article")).pipe(expectDeadline))
      all.done()
    }))

  test("SE-148", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/deep-shadow.html")
      assert.strictEqual(
        yield* page.locator("div").filter({ has: Locator.relative.locator("#target") }).count,
        2
      )
      assert.strictEqual(
        yield* page.locator("div").filter({ has: Locator.relative.locator("[data-testid=foo]") }).count,
        3
      )
      assert.strictEqual(
        yield* page.locator("div").filter({ has: Locator.relative.locator("[attr*=value]") }).count,
        2
      )

      yield* page.setContent(`<section><span></span><div></div></section><section><br></section>`)
      const withSpanOrDiv = page.locator("section").filter({ has: Locator.relative.locator("span, div") })
      assert.strictEqual(yield* withSpanOrDiv.count, 1)
      assert.strictEqual(yield* withSpanOrDiv.count, 1)
      assert.strictEqual(
        yield* page.locator("section").filter({ has: Locator.relative.locator("br") }).count,
        1
      )
      assert.strictEqual(
        yield* page.locator("section").filter({ has: Locator.relative.locator("span, br") }).count,
        2
      )
      assert.strictEqual(
        yield* page.locator("section").filter({ has: Locator.relative.locator("span, br, div") }).count,
        2
      )

      yield* page.setContent(`<div><span>hello</span></div><div><span>world</span></div>`)
      const withWorld = page.locator("div").filter({ has: Locator.relative.getByText("world") })
      assert.strictEqual(yield* withWorld.count, 1)
      assert.strictEqual(yield* withWorld.readHtml, `<div><span>world</span></div>`)
      const withHello = page.locator("div").filter({ has: Locator.relative.getByText("hello", { exact: true }) })
      assert.strictEqual(yield* withHello.count, 1)
      assert.strictEqual(yield* withHello.readHtml, `<div><span>hello</span></div>`)
      // `internal:has="xpath=./span"` (2 matches) is left out: Strider's locator takes CSS only, so the XPath form has no
      // port (the XPath tests are needsFeature). `internal:has="span"` is the same condition in CSS, as the original also asserts.
      assert.strictEqual(
        yield* page.locator("div").filter({ has: Locator.relative.locator("span") }).count,
        2
      )
      const withSpanWor = page.locator("div").filter({
        has: Locator.relative.locator("span").getByText("wor")
      })
      assert.strictEqual(yield* withSpanWor.count, 1)
      assert.strictEqual(yield* withSpanWor.readHtml, `<div><span>world</span></div>`)
      assert.strictEqual(yield* withSpanWor.locator("span").readHtml, `<span>world</span>`)
    }))

  test("SE-149", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<section><span></span><div></div></section><section><br></section>`)
      const hasNot = (css: string) => page.locator("section").filter({ hasNot: Locator.relative.locator(css) })
      assert.strictEqual(yield* hasNot("span").count, 1)
      assert.strictEqual(yield* hasNot("span, div, br").count, 0)
      assert.strictEqual(yield* hasNot("br").count, 1)
      assert.strictEqual(yield* hasNot("span, div").count, 1)
      assert.strictEqual(yield* hasNot("article").count, 2)
    }))

  test("SE-150", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div class=foo>hello</div><div class=bar>world</div>
    <span class=foo>hello2</span><span class=bar>world2</span>
  `)
      assert.deepStrictEqual(yield* textsOf(page.locator("div").and(page.locator("span"))), [])
      assert.deepStrictEqual(yield* textsOf(page.locator("div").and(page.locator(".foo"))), ["hello"])
      assert.deepStrictEqual(yield* textsOf(page.locator("div").and(page.locator(".bar"))), ["world"])
      assert.deepStrictEqual(yield* textsOf(page.locator("span").and(page.locator("span"))), ["hello2", "world2"])
      assert.deepStrictEqual(yield* textsOf(page.locator(".foo").and(page.locator("div"))), ["hello"])
      assert.deepStrictEqual(yield* textsOf(page.locator(".bar").and(page.locator("span"))), ["world2"])
    }))

  test("SE-151", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>hello</div>
    <span>world</span>
  `)
      assert.deepStrictEqual(yield* textsOf(page.locator("div").or(page.locator("span"))), ["hello", "world"])
      assert.deepStrictEqual(yield* textsOf(page.locator("span").or(page.locator("div"))), ["hello", "world"])
      assert.strictEqual(yield* page.locator("article").or(page.locator("something")).count, 0)
      assert.strictEqual(yield* page.locator("article").or(page.locator("div")).readText, "hello")
      assert.strictEqual(yield* page.locator("article").or(page.locator("span")).readText, "world")
      assert.strictEqual(yield* page.locator("div").or(page.locator("article")).readText, "hello")
      assert.strictEqual(yield* page.locator("span").or(page.locator("article")).readText, "world")
    }))

  test("SE-152", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>one <span>two</span> <button>three</button> </div>
    <span>four</span>
    <button>five</button>
  `)
      assert.deepStrictEqual(yield* textsOf(page.locator("div").locator("button")), ["three"])
      assert.deepStrictEqual(
        yield* textsOf(page.locator("div").locator("span").or(page.locator("div").locator("button"))),
        ["two", "three"]
      )
    }))

  test("SE-153", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        let last: HTMLElement = document.body
        for (let i = 0; i < 100; i++) {
          const e = document.createElement("div")
          last.appendChild(e)
          last = e
        }
        const target = document.createElement("span")
        target.textContent = "Found me!"
        last.appendChild(target)
      })

      // Naive implementation generates C(100, 9) ~= 1.9*10^12 entries. Each is one locator chain, which finds the span.
      const eightDivs = ["div", "div", "div", "div", "div", "div", "div", "div"]
      const counts = [
        yield* chain(page.locator("div"), ...eightDivs.slice(1), "span").count,
        yield* page.locator("div div div div div div div div span").count,
        yield* chain(page.locator("div div"), "div div", "div div", "div div", "span").count
      ]
      assert.deepStrictEqual(counts, [1, 1, 1])
    }))
})
