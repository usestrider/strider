/**
 * Playwright's `tests/page/selectors-get-by.spec.ts`: what the `getBy*` queries match (text, labels, placeholders, alt
 * text, titles, test ids and roles), with exact and substring matching, regular expressions, whitespace normalization,
 * and the labels an input gets from `for`, nesting, `aria-labelledby`, and `aria-label`. SE-072, SE-073, SE-075, and
 * SE-093 to SE-096 use what Strider lacks (a custom test-id attribute, a RegExp test id, a role's description), and
 * are `needsFeature` (see the ledger).
 *
 * What the port changes:
 * - Strider's `Page` is the main frame and has no `mainFrame()`, so `page.mainFrame().getByX(…)` is `page.getByX(…)`:
 *   the same query on the same frame.
 * - Playwright's `expect` waits 5 seconds by default, where Strider's expectations run to the test's deadline. Each
 *   `expect` here is `Deadline.within("5 seconds")`, and each `expect(...).toHaveCount(n, { timeout })` is the timeout
 *   it names. `expect.soft` runs each check to the end and fails the test with every mismatch (`softly`, as in
 *   role-utils).
 * - `e.nodeName` and `e.outerHTML` are read from the element's outer HTML (`readHtml`), whose opening tag is its
 *   `nodeName`. `e.id` is `readAttribute("id")`, and `e.textContent` is `readText`, the engine's text, which is the
 *   same for these elements' plain text. `evaluate` and `evaluateAll` aren't needed for any of these reads.
 * - `page.$eval("input", …)` changes the page, so it runs in the main world: `page.evaluateInMainWorld`.
 * - `elementHandles()` returning `[]` is `count` returning 0, which doesn't wait.
 * - `getByText(…).first` is `Locator.first`.
 * - Strider's `getByLabel` matches an element when any of its labels matches (`for`, a wrapping label, `aria-labelledby`,
 *   `aria-label`), where Playwright prefers `aria-labelledby` over the native label. The original asks only for the
 *   `aria-labelledby` text in SE-083 and SE-086 (`Name` and `Other`), never for the label it should outrank (`Wrong`,
 *   `Name`), so the checks are the original's and Strider finds the same element. The difference is untested upstream
 *   and here.
 * - `getByAltText` matches `img`, `area`, and `input type="image"` only, as its documentation says. Playwright matches any
 *   element with an `alt` attribute, so SE-088 and the `getByAltText` checks in SE-090 expect elements that are plain
 *   inputs. Those fail on Strider, and are left to fail.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, type Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { isDeepStrictEqual } from "node:util"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's default for `expect`, which waits 5 seconds; a Strider expectation otherwise runs to the test's deadline. */
const expectDeadline = Deadline.within("5 seconds")

/** The uppercase tag of an element from its outer HTML, which is its `nodeName`. */
const tagOf = (html: string) => /^<([a-z0-9]+)/i.exec(html)?.[1]?.toUpperCase()

/**
 * Playwright's `expect.soft`: each check runs to the end, and a mismatch fails the test once they have all run, with
 * every mismatch listed.
 */
const softly = () => {
  const mismatches: Array<string> = []
  return {
    equal: (what: string, actual: unknown, expected: unknown) => {
      if (!isDeepStrictEqual(actual, expected)) {
        mismatches.push(`${what}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
      }
    },
    check: Effect.fnUntraced(function*(what: string, check: Effect.Effect<void, unknown>) {
      const result = yield* Effect.result(check)
      if (Result.isFailure(result)) mismatches.push(`${what}: ${String(result.failure)}`)
    }),
    done: () => {
      if (mismatches.length > 0) {
        assert.fail(`${mismatches.length} mismatches:\n${mismatches.join("\n")}`)
      }
    }
  }
}

/** Each match's outer HTML, in order: Playwright's `evaluateAll(els => els.map(e => e.outerHTML))`, read per match. */
const outerHtmlsOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  return yield* Effect.forEach(yield* locator.all, (match) => match.readHtml)
})

upstream(import.meta.filename, {}, (test) => {
  test("SE-071", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div><div data-testid="Hello">Hello world</div></div>`)
      yield* Expect.toHaveText(page.getByTestId("Hello"), "Hello world").pipe(expectDeadline)
      // `page.mainFrame()`: the page's queries are the main frame's (see the header)
      yield* Expect.toHaveText(page.getByTestId("Hello"), "Hello world").pipe(expectDeadline)
      yield* Expect.toHaveText(page.locator("div").getByTestId("Hello"), "Hello world").pipe(expectDeadline)
    }))

  test("SE-074", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div><div data-testid='He"llo'>Hello world</div></div>`)
      yield* Expect.toHaveText(page.getByTestId("He\"llo"), "Hello world").pipe(expectDeadline)
    }))

  test("SE-076", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>yo</div><div>ya</div><div>\nye  </div>`)
      assert.include(yield* page.getByText("ye").readHtml, ">\nye  </div>")
      assert.include(yield* page.getByText(/ye/).readHtml, ">\nye  </div>")
      assert.include(yield* page.getByText(/e/).readHtml, ">\nye  </div>")

      yield* page.setContent(`<div> ye </div><div>ye</div>`)
      assert.include(yield* page.getByText("ye", { exact: true }).first.readHtml, "> ye </div>")

      yield* page.setContent(`<div>Hello world</div><div>Hello</div>`)
      assert.include(yield* page.getByText("Hello", { exact: true }).readHtml, ">Hello</div>")
    }))

  test("SE-077", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div><label for=target>Name</label><input id=target type=text></div>`)
      assert.strictEqual(tagOf(yield* page.getByText("Name").readHtml), "LABEL")
      assert.strictEqual(tagOf(yield* page.getByLabel("Name").readHtml), "INPUT")
      // `page.mainFrame()`: the page's queries are the main frame's (see the header)
      assert.strictEqual(tagOf(yield* page.getByLabel("Name").readHtml), "INPUT")
      assert.strictEqual(tagOf(yield* page.locator("div").getByLabel("Name").readHtml), "INPUT")
    }))

  test("SE-078", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<label for=target>Last <span>Name</span></label><input id=target type=text>`)

      yield* Expect.toHaveAttribute(page.getByLabel("last name"), "id", "target").pipe(expectDeadline)
      yield* Expect.toHaveAttribute(page.getByLabel("st na"), "id", "target").pipe(expectDeadline)
      yield* Expect.toHaveAttribute(page.getByLabel("Name"), "id", "target").pipe(expectDeadline)
      yield* Expect.toHaveAttribute(page.getByLabel("Last Name", { exact: true }), "id", "target").pipe(expectDeadline)
      yield* Expect.toHaveAttribute(page.getByLabel(/Last\s+name/i), "id", "target").pipe(expectDeadline)

      assert.strictEqual(yield* page.getByLabel("Last", { exact: true }).count, 0)
      assert.strictEqual(yield* page.getByLabel("last name", { exact: true }).count, 0)
      assert.strictEqual(yield* page.getByLabel("Name", { exact: true }).count, 0)
      assert.strictEqual(yield* page.getByLabel("what?").count, 0)
      assert.strictEqual(yield* page.getByLabel(/last name/).count, 0)
    }))

  test("SE-079", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<label for=target>Name</label><input id=target type=text><label for=target>First or Last</label>`
      )
      assert.strictEqual(Option.getOrUndefined(yield* page.getByLabel("Name").readAttribute("id")), "target")
      assert.strictEqual(
        Option.getOrUndefined(yield* page.getByLabel("First or Last").readAttribute("id")),
        "target"
      )
    }))

  test("SE-080", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<label>Name<button id=target>Click me</button><input type=text></label>`)
      assert.strictEqual(Option.getOrUndefined(yield* page.getByLabel("Name").readAttribute("id")), "target")
    }))

  test("SE-081", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <label for=target>Name<input type=text id=nontarget></label>
    <input type=text id=target>
  `)
      assert.strictEqual(Option.getOrUndefined(yield* page.getByLabel("Name").readAttribute("id")), "target")
    }))

  test("SE-082", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<label id=name-label>Name</label><button aria-labelledby=name-label>Click me</button>`)
      assert.strictEqual(yield* page.getByLabel("Name").readText, "Click me")
    }))

  test("SE-083", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <label id=name-label>Name</label>
    <label>Wrong<button aria-labelledby=name-label>Click me</button></label>
  `)
      assert.strictEqual(yield* page.getByLabel("Name").readText, "Click me")
    }))

  test("SE-084", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id=target aria-label="Name">`)
      assert.strictEqual(Option.getOrUndefined(yield* page.getByLabel("Name").readAttribute("id")), "target")
    }))

  test("SE-085", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<label for=target>Last Name</label><input id=target type=text aria-label>`)
      assert.strictEqual(Option.getOrUndefined(yield* page.getByLabel("Last Name").readAttribute("id")), "target")
    }))

  test("SE-086", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<label id=other-label>Other</label><input id=target aria-label="Name" aria-labelledby=other-label>`
      )
      assert.strictEqual(Option.getOrUndefined(yield* page.getByLabel("Other").readAttribute("id")), "target")
    }))

  test("SE-087", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>
    <input placeholder='Hello'>
    <input placeholder='Hello World'>
  </div>`)
      yield* Expect.toHaveCount(page.getByPlaceholder("hello"), 2).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByPlaceholder("Hello", { exact: true }), 1).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByPlaceholder(/wor/i), 1).pipe(expectDeadline)

      // Coverage
      yield* Expect.toHaveCount(page.getByPlaceholder("hello"), 2).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.locator("div").getByPlaceholder("hello"), 2).pipe(expectDeadline)
    }))

  // Fails on Strider: its getByAltText matches images and areas only, where Playwright matches any element with an alt
  // attribute, and these are inputs (see the header).
  test("SE-088", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>
    <input alt='Hello'>
    <input alt='Hello World'>
  </div>`)
      yield* Expect.toHaveCount(page.getByAltText("hello"), 2).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByAltText("Hello", { exact: true }), 1).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByAltText(/wor/i), 1).pipe(expectDeadline)

      // Coverage
      yield* Expect.toHaveCount(page.getByAltText("hello"), 2).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.locator("div").getByAltText("hello"), 2).pipe(expectDeadline)
    }))

  test("SE-089", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>
    <input title='Hello'>
    <input title='Hello World'>
  </div>`)
      yield* Expect.toHaveCount(page.getByTitle("hello"), 2).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByTitle("Hello", { exact: true }), 1).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByTitle(/wor/i), 1).pipe(expectDeadline)

      // Coverage
      yield* Expect.toHaveCount(page.getByTitle("hello"), 2).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.locator("div").getByTitle("hello"), 2).pipe(expectDeadline)
    }))

  // The alt checks fail on Strider (see SE-088). They are soft, so the rest of the test still runs and reports.
  test("SE-090", ({ page }) =>
    Effect.gen(function*() {
      const soft = softly()

      yield* page.setContent(`<label id=label for=control>Hello my
wo"rld</label><input id=control />`)
      yield* page.evaluateInMainWorld((value) => {
        const input = document.querySelector("input")!
        input.setAttribute("placeholder", value)
        input.setAttribute("title", value)
        input.setAttribute("alt", value)
      }, "hello my\nwo\"rld")
      yield* soft.check(
        "getByText",
        Expect.toHaveAttribute(page.getByText("hello my\nwo\"rld"), "id", "label").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByText, whitespace",
        Expect.toHaveAttribute(page.getByText("hello       my     wo\"rld"), "id", "label").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByLabel",
        Expect.toHaveAttribute(page.getByLabel("hello my\nwo\"rld"), "id", "control").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByPlaceholder",
        Expect.toHaveAttribute(page.getByPlaceholder("hello my\nwo\"rld"), "id", "control").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByAltText",
        Expect.toHaveAttribute(page.getByAltText("hello my\nwo\"rld"), "id", "control").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByTitle",
        Expect.toHaveAttribute(page.getByTitle("hello my\nwo\"rld"), "id", "control").pipe(expectDeadline)
      )

      yield* page.setContent(`<label id=label for=control>Hello my
world</label><input id=control />`)
      yield* page.evaluateInMainWorld((value) => {
        const input = document.querySelector("input")!
        input.setAttribute("placeholder", value)
        input.setAttribute("title", value)
        input.setAttribute("alt", value)
      }, "hello my\nworld")
      yield* soft.check(
        "getByText, second",
        Expect.toHaveAttribute(page.getByText("hello my\nworld"), "id", "label").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByText, second whitespace",
        Expect.toHaveAttribute(page.getByText("hello        my    world"), "id", "label").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByLabel, second",
        Expect.toHaveAttribute(page.getByLabel("hello my\nworld"), "id", "control").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByPlaceholder, second",
        Expect.toHaveAttribute(page.getByPlaceholder("hello my\nworld"), "id", "control").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByAltText, second",
        Expect.toHaveAttribute(page.getByAltText("hello my\nworld"), "id", "control").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByTitle, second",
        Expect.toHaveAttribute(page.getByTitle("hello my\nworld"), "id", "control").pipe(expectDeadline)
      )

      yield* page.setContent(`<div id=target title="my title">Text here</div>`)
      yield* soft.check(
        "getByTitle exact",
        Expect.toHaveCount(page.getByTitle("my title", { exact: true }), 1).pipe(Deadline.within("500 millis"))
      )
      yield* soft.check(
        "getByTitle exact, \\i escape",
        // The original's string keeps `\i`, which JavaScript reads as `i`: the escape is the point of the check
        // oxlint-disable-next-line no-useless-escape
        Expect.toHaveCount(page.getByTitle("my t\itle", { exact: true }), 1).pipe(Deadline.within("500 millis"))
      )
      yield* soft.check(
        "getByTitle exact, escaped backslash",
        Expect.toHaveCount(page.getByTitle("my t\\itle", { exact: true }), 0).pipe(Deadline.within("500 millis"))
      )
      yield* soft.check(
        "getByTitle exact, escaped backslash and i",
        Expect.toHaveCount(page.getByTitle("my t\\\itle", { exact: true }), 0).pipe(Deadline.within("500 millis"))
      )
      yield* soft.check(
        "getByTitle exact, double backslash",
        Expect.toHaveCount(page.getByTitle("my t\\\\itle", { exact: true }), 0).pipe(Deadline.within("500 millis"))
      )

      yield* page.setContent(`<label for=target>foo &gt;&gt; bar</label><input id=target>`)
      yield* page.evaluateInMainWorld((value) => {
        const input = document.querySelector("input")!
        input.setAttribute("placeholder", value)
        input.setAttribute("title", value)
        input.setAttribute("alt", value)
      }, "foo >> bar")
      soft.equal("getByText textContent", yield* page.getByText("foo >> bar").readText, "foo >> bar")
      yield* soft.check(
        "locator label text",
        Expect.toHaveText(page.locator("label"), "foo >> bar").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByText text",
        Expect.toHaveText(page.getByText("foo >> bar"), "foo >> bar").pipe(expectDeadline)
      )
      soft.equal("getByText regex textContent", yield* page.getByText(/foo >> bar/).readText, "foo >> bar")
      yield* soft.check(
        "getByLabel",
        Expect.toHaveAttribute(page.getByLabel("foo >> bar"), "id", "target").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByLabel regex",
        Expect.toHaveAttribute(page.getByLabel(/foo >> bar/), "id", "target").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByPlaceholder",
        Expect.toHaveAttribute(page.getByPlaceholder("foo >> bar"), "id", "target").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByAltText",
        Expect.toHaveAttribute(page.getByAltText("foo >> bar"), "id", "target").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByTitle",
        Expect.toHaveAttribute(page.getByTitle("foo >> bar"), "id", "target").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByPlaceholder regex",
        Expect.toHaveAttribute(page.getByPlaceholder(/foo >> bar/), "id", "target").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByAltText regex",
        Expect.toHaveAttribute(page.getByAltText(/foo >> bar/), "id", "target").pipe(expectDeadline)
      )
      yield* soft.check(
        "getByTitle regex",
        Expect.toHaveAttribute(page.getByTitle(/foo >> bar/), "id", "target").pipe(expectDeadline)
      )

      soft.done()
    }))

  test("SE-091", ({ page }) =>
    Effect.gen(function*() {
      const soft = softly()
      yield* page.setContent(`
    <a href="https://playwright.dev">issues 123</a>
    <a href="https://playwright.dev">he llo 56</a>
    <button>Click me</button>
  `)
      soft.equal(
        "button",
        yield* outerHtmlsOf(page.getByRole("button")),
        [`<button>Click me</button>`]
      )
      soft.equal(
        "link",
        yield* outerHtmlsOf(page.getByRole("link")),
        [
          `<a href="https://playwright.dev">issues 123</a>`,
          `<a href="https://playwright.dev">he llo 56</a>`
        ]
      )

      soft.equal(
        "link issues 123",
        yield* outerHtmlsOf(page.getByRole("link", { name: "issues 123" })),
        [`<a href="https://playwright.dev">issues 123</a>`]
      )
      soft.equal(
        "link sues",
        yield* outerHtmlsOf(page.getByRole("link", { name: "sues" })),
        [`<a href="https://playwright.dev">issues 123</a>`]
      )
      soft.equal(
        "link whitespace",
        yield* outerHtmlsOf(page.getByRole("link", { name: "  he    \n  llo " })),
        [`<a href="https://playwright.dev">he llo 56</a>`]
      )
      soft.equal(
        "button issues",
        yield* outerHtmlsOf(page.getByRole("button", { name: "issues" })),
        []
      )

      soft.equal(
        "link sues exact",
        yield* outerHtmlsOf(page.getByRole("link", { name: "sues", exact: true })),
        []
      )
      soft.equal(
        "link whitespace exact",
        yield* outerHtmlsOf(page.getByRole("link", { name: "   he \n llo 56 ", exact: true })),
        [`<a href="https://playwright.dev">he llo 56</a>`]
      )

      soft.equal(
        "button exact",
        yield* outerHtmlsOf(page.getByRole("button", { name: "Click me", exact: true })),
        [`<button>Click me</button>`]
      )
      soft.equal(
        "button escaped m",
        // The original's string keeps `\m`, which JavaScript reads as `m`: the escape is the point of the check
        // oxlint-disable-next-line no-useless-escape
        yield* outerHtmlsOf(page.getByRole("button", { name: "Click \me", exact: true })),
        [`<button>Click me</button>`]
      )
      soft.equal(
        "button escaped backslash",
        yield* outerHtmlsOf(page.getByRole("button", { name: "Click \\me", exact: true })),
        []
      )
      soft.equal(
        "button escaped backslash and m",
        yield* outerHtmlsOf(page.getByRole("button", { name: "Click \\\me", exact: true })),
        []
      )
      soft.equal(
        "button double backslash",
        yield* outerHtmlsOf(page.getByRole("button", { name: "Click \\\\me", exact: true })),
        []
      )

      soft.done()
    }))

  test("SE-092", ({ page }) =>
    Effect.gen(function*() {
      // Regression test for https://github.com/microsoft/playwright/issues/41457. The `v` flag is written with the
      // RegExp constructor, since this package's TypeScript target predates literal `v` regexes; the regexes are the same.
      yield* page.setContent(`<button>Click me</button><button>Submit</button>`)
      yield* Expect.toHaveCount(page.getByRole("button", { name: new RegExp("Click me", "v") }), 1).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByRole("button", { name: new RegExp("click me", "iv") }), 1).pipe(
        expectDeadline
      )
      yield* Expect.toHaveCount(page.getByRole("button", { name: new RegExp("Missing", "v") }), 0).pipe(
        Deadline.within("1 second")
      )
    }))

  test("SE-097", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>foo</div><div>foo</div><div>foo</div>
    <label>foo<input></label><label>foo<input></label><label>foo<input></label>
    <button>foo</button><button>foo</button><button>foo</button>
    <input placeholder=foo><input placeholder=foo><input placeholder=foo>
  `)
      yield* Expect.toHaveCount(page.getByText(/foo/), 9).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByText(/foo/g), 9).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByText(/foo/y), 9).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByLabel(/foo/), 3).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByLabel(/foo/g), 3).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByLabel(/foo/y), 3).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByRole("button", { name: /foo/ }), 3).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByRole("button", { name: /foo/g }), 3).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByRole("button", { name: /foo/y }), 3).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByPlaceholder(/foo/), 3).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByPlaceholder(/foo/g), 3).pipe(expectDeadline)
      yield* Expect.toHaveCount(page.getByPlaceholder(/foo/y), 3).pipe(expectDeadline)
    }))
})
