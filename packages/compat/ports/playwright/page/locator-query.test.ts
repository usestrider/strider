/**
 * Playwright's `tests/page/locator-query.spec.ts`: a locator's composition and filtering, its `first`, `last`, `nth`,
 * `filter`, `and`, `or`, and chained `locator`. LO-157, LO-158, LO-160 to LO-176, LO-178, and LO-181 are ported. LO-177
 * needs `within`, which Strider has no form for, so it is `needsFeature`. LO-159, LO-179, and LO-182 test Playwright's
 * capture marker and its custom selector engines, and LO-180 tests a cross-frame `has` that Strider's types reject;
 * these are `notApplicable`.
 *
 * What the port changes:
 * - Playwright's `div >> p` is a descendant chain, which is `div p` in CSS. `page.locator(a).locator(b)` is the same
 *   chain, and both are used where the original uses either.
 * - Playwright's `locator(options)` (a `hasText` or `has` passed to `locator`) is `filter` in Strider. `locator()`
 *   takes a CSS string only, so `div.locator(page.locator(...))` is rewritten as the descendant chain with `and` and
 *   `or` of two chains. Both sides select the same elements: `div.locator(X)` is the descendants of `div` that match
 *   `X`, and `or` and `and` of `div`-chains give exactly that set.
 * - Playwright's `count()` and `isVisible()` are Strider's `count` and `isVisible`; LO-172's `evaluate(e => e.outerHTML)`
 *   is `readHtml`, which is the element's outer HTML.
 * - LO-172 to LO-174 use Playwright's selector strings and a regular expression test id, which Strider has no form
 *   for. `has` takes a relative locator, which takes no filter, so `has: locator('span', { hasText })` is
 *   `Locator.relative.getByText`: the span is the only element holding that text in the page. `text=` is `getByText`, and
 *   `xpath=./span` is `:scope > span`. LO-174's `getByTestId(/bar|foo/)` is the CSS list of the two test ids.
 * - Playwright's errors are checked by Strider's typed reason. A strict violation is a `StrictViolation` reason with its
 *   candidates; the message is `N matches`, not Playwright's wording. A composite across two frames throws at once,
 *   as a defect whose message says `another frame`, so LO-178's two errors are `assert.throws`.
 * - `expect.soft` in LO-167 is an ordinary expectation here: the first failure ends the test, where Playwright
 *   collects every failure and reports them together.
 * - LO-169 to LO-171's `issue` annotations are reporting metadata, not steps, and are left out.
 * - LO-181's `page.mainFrame()` has no Strider counterpart: the page is its own main frame, so the line checks
 *   `page.locator` directly.
 */
import { assert } from "@effect/vitest"
import { Expect, Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("LO-157", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
  <section>
    <div><p>A</p></div>
    <div><p>A</p><p>A</p></div>
    <div><p>A</p><p>A</p><p>A</p></div>
  </section>`)
      assert.strictEqual(yield* page.locator("div p").count, 6)
      assert.strictEqual(yield* page.locator("div").locator("p").count, 6)
      assert.strictEqual(yield* page.locator("div").first.locator("p").count, 1)
      assert.strictEqual(yield* page.locator("div").last.locator("p").count, 3)
    }))

  test("LO-158", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
  <section>
    <div><p>A</p></div>
    <div><p>A</p><p>A</p></div>
    <div><p>A</p><p>A</p><p>A</p></div>
  </section>`)
      assert.strictEqual(yield* page.locator("div p").nth(0).count, 1)
      assert.strictEqual(yield* page.locator("div").nth(1).locator("p").count, 2)
      assert.strictEqual(yield* page.locator("div").nth(2).locator("p").count, 3)
    }))

  test("LO-160", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>A</div><div>B</div>`)
      const failure = yield* Effect.flip(page.locator("div").isVisible)
      assert(Locator.isLocatorError(failure), String(failure))
      assert(failure.reason._tag === "StrictViolation", failure.reason._tag)
      assert.strictEqual(failure.reason.candidates.length, 2)
    }))

  test("LO-161", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<select><option>One</option><option>Two</option></select>`)
      // The original's no-op `evaluate` is strict about its match, as Strider's `evaluate` is.
      const failure = yield* Effect.flip(page.locator("option").evaluate(() => {}))
      assert(Locator.isLocatorError(failure), String(failure))
      assert(failure.reason._tag === "StrictViolation", failure.reason._tag)
      assert.strictEqual(failure.reason.candidates.length, 2)
    }))

  test("LO-162", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>Foobar</div><div>Bar</div>`)
      yield* Expect.toHaveText(page.locator("div").filter({ hasText: "Foo" }), "Foobar")
    }))

  test("LO-163", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>foo <span>hello world</span> bar</div>`)
      yield* Expect.toHaveText(page.locator("div").filter({ hasText: "hello world" }), "foo hello world bar")
    }))

  test("LO-164", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>Foobar</div><div>Bar</div>`)
      yield* Expect.toHaveText(page.locator("div").filter({ hasText: /Foo.*/ }), "Foobar")
    }))

  test("LO-165", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>Hello "world"</div><div>Hello world</div>`)
      yield* Expect.toHaveText(page.locator("div").filter({ hasText: `Hello "world"` }), `Hello "world"`)
    }))

  test("LO-166", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>Hello "world"</div><div>Hello world</div>`)
      yield* Expect.toHaveText(page.locator("div").filter({ hasText: /Hello "world"/ }), `Hello "world"`)
    }))

  test("LO-167", ({ page }) =>
    Effect.gen(function*() {
      // oxlint-disable no-useless-escape -- the original's regular expressions, with their escapes as written
      yield* page.setContent(`<button>let's let's<span>hello</span></button>`)
      yield* Expect.toHaveText(page.locator("button").filter({ hasText: /let's/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.getByRole("button", { name: /let's/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.locator("button").filter({ hasText: /let\'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.getByRole("button", { name: /let\'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.locator("button").filter({ hasText: /'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.getByRole("button", { name: /'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.locator("button").filter({ hasText: /\'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.getByRole("button", { name: /\'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.locator("button").filter({ hasText: /let['abc]s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.getByRole("button", { name: /let['abc]s/i }).locator("span"), "hello")
      yield* Expect.toBeHidden(page.locator("button").filter({ hasText: /let\\'s/i }))
      yield* Expect.toBeHidden(page.getByRole("button", { name: /let\\'s/i }))
      yield* Expect.toHaveText(page.locator("button").filter({ hasText: /let's let\'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.getByRole("button", { name: /let's let\'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.locator("button").filter({ hasText: /let\'s let's/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.getByRole("button", { name: /let\'s let's/i }).locator("span"), "hello")

      yield* page.setContent(`<button>let\\'s let\\'s<span>hello</span></button>`)
      yield* Expect.toBeHidden(page.locator("button").filter({ hasText: /let\'s/i }))
      yield* Expect.toBeHidden(page.getByRole("button", { name: /let\'s/i }))
      yield* Expect.toHaveText(page.locator("button").filter({ hasText: /let\\'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.getByRole("button", { name: /let\\'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.locator("button").filter({ hasText: /let\\\'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(page.getByRole("button", { name: /let\\\'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(
        page.locator("button").filter({ hasText: /let\\'s let\\\'s/i }).locator("span"),
        "hello"
      )
      yield* Expect.toHaveText(page.getByRole("button", { name: /let\\'s let\\\'s/i }).locator("span"), "hello")
      yield* Expect.toHaveText(
        page.locator("button").filter({ hasText: /let\\\'s let\\'s/i }).locator("span"),
        "hello"
      )
      yield* Expect.toHaveText(page.getByRole("button", { name: /let\\\'s let\\'s/i }).locator("span"), "hello")
      // oxlint-enable no-useless-escape

      yield* page.setContent(`<button>let's hello</button>`)
      yield* Expect.toHaveText(page.locator("button").filter({ hasText: /let's/iu }), `let's hello`)
      yield* Expect.toHaveText(page.getByRole("button", { name: /let's/iu }), `let's hello`)
    }))

  test("LO-168", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>Hello "world"</div><div>Hello world</div>`)
      yield* Expect.toHaveText(page.locator("div").filter({ hasText: /hElLo "world"/i }), `Hello "world"`)
    }))

  test("LO-169", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div class="test"><h5>Title Text</h5></div>`)
      yield* Expect.toHaveText(page.locator("div").filter({ hasText: /^title text$/i }), "Title Text")
    }))

  test("LO-170", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div class="test"><h5>Title</h5> <h2><i>Text</i></h2></div>`)
      yield* Expect.toHaveClass(page.locator("div").filter({ hasText: /^title text$/i }), "test")
    }))

  test("LO-171", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div class="test"><h5>First/"and"</h5><h2><i>Second\\</i></h2></div>`)
      yield* Expect.toHaveClass(page.locator("div").filter({ hasText: /^first\/".*"second\\$/si }), "test")
    }))

  test("LO-172", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div><span>hello</span></div><div><span>world</span></div>`)
      const div = page.locator("div")
      // `text=world` is `getByText("world")` and `text="hello"` is the exact one
      const world = div.filter({ has: Locator.relative.getByText("world") })
      yield* Expect.toHaveCount(world, 1)
      assert.strictEqual(yield* world.readHtml, `<div><span>world</span></div>`)
      const hello = div.filter({ has: Locator.relative.getByText("hello", { exact: true }) })
      yield* Expect.toHaveCount(hello, 1)
      assert.strictEqual(yield* hello.readHtml, `<div><span>hello</span></div>`)
      // `xpath=./span` is a child `span`, which `:scope` expresses
      yield* Expect.toHaveCount(div.filter({ has: Locator.relative.locator(":scope > span") }), 2)
      yield* Expect.toHaveCount(div.filter({ has: Locator.relative.locator("span") }), 2)
      // A relative locator takes no filter, so `span` with `hasText: 'wor'` is the text query: the only element
      // holding that text in this page is the span
      const wor = div.filter({ has: Locator.relative.getByText("wor") })
      yield* Expect.toHaveCount(wor, 1)
      assert.strictEqual(yield* wor.readHtml, `<div><span>world</span></div>`)
      yield* Expect.toHaveCount(div.filter({ has: Locator.relative.locator("span"), hasText: "wor" }), 1)
    }))

  test("LO-173", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<section><div><span>hello</span></div><div><span>world</span></div></section>`
      )
      yield* Expect.toHaveCount(page.locator("div").filter({ hasText: "hello" }), 1)
      yield* Expect.toHaveCount(page.locator("div").filter({ hasText: "hello" }).filter({ hasText: "hello" }), 1)
      yield* Expect.toHaveCount(page.locator("div").filter({ hasText: "hello" }).filter({ hasText: "world" }), 0)
      yield* Expect.toHaveCount(page.locator("section").filter({ hasText: "hello" }).filter({ hasText: "world" }), 1)
      yield* Expect.toHaveCount(page.locator("div").filter({ hasText: "hello" }).locator("span"), 1)
      // A relative locator takes no filter, so the original's `span` with `hasText: 'world'` is the text query: the
      // only element holding that text in this page is the span
      yield* Expect.toHaveCount(page.locator("div").filter({ has: Locator.relative.getByText("world") }), 1)
      yield* Expect.toHaveCount(page.locator("div").filter({ has: Locator.relative.locator("span") }), 2)
      yield* Expect.toHaveCount(
        page.locator("div").filter({ has: Locator.relative.locator("span"), hasText: "world" }),
        1
      )
      yield* Expect.toHaveCount(page.locator("div").filter({ hasNot: Locator.relative.getByText("world") }), 1)
      yield* Expect.toHaveCount(page.locator("div").filter({ hasNot: Locator.relative.locator("section") }), 2)
      yield* Expect.toHaveCount(page.locator("div").filter({ hasNot: Locator.relative.locator("span") }), 0)
      yield* Expect.toHaveCount(page.locator("div").filter({ hasNotText: "hello" }), 1)
      yield* Expect.toHaveCount(page.locator("div").filter({ hasNotText: "foo" }), 2)
    }))

  test("LO-174", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div data-testid=foo>hello</div><div data-testid=bar>world</div>
    <span data-testid=foo>hello2</span><span data-testid=bar>world2</span>
  `)
      yield* Expect.toHaveCount(page.locator("div").and(page.locator("div")), 2)
      yield* Expect.toHaveText(page.locator("div").and(page.getByTestId("foo")), ["hello"])
      yield* Expect.toHaveText(page.locator("div").and(page.getByTestId("bar")), ["world"])
      yield* Expect.toHaveText(page.getByTestId("foo").and(page.locator("div")), ["hello"])
      yield* Expect.toHaveText(page.getByTestId("bar").and(page.locator("span")), ["world2"])
      // `getByTestId` takes a string, not the original's `/bar|foo/`, so the same two test ids are one CSS list
      yield* Expect.toHaveCount(
        page.locator("span").and(page.locator("[data-testid=bar], [data-testid=foo]")),
        2
      )
    }))

  test("LO-175", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div>hello</div><span>world</span>`)
      yield* Expect.toHaveCount(page.locator("div").or(page.locator("span")), 2)
      yield* Expect.toHaveText(page.locator("div").or(page.locator("span")), ["hello", "world"])
      yield* Expect.toHaveText(
        page.locator("span").or(page.locator("article")).or(page.locator("div")),
        ["hello", "world"]
      )
      yield* Expect.toHaveCount(page.locator("article").or(page.locator("something")), 0)
      yield* Expect.toHaveText(page.locator("article").or(page.locator("div")), "hello")
      yield* Expect.toHaveText(page.locator("article").or(page.locator("span")), "world")
      yield* Expect.toHaveText(page.locator("div").or(page.locator("article")), "hello")
      yield* Expect.toHaveText(page.locator("span").or(page.locator("article")), "world")
    }))

  test("LO-176", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>one <span>two</span> <button>three</button> </div>
    <span>four</span>
    <button>five</button>
  `)
      // `div.locator(X)` is the descendants of `div` that match `X`, so with a Locator argument the port writes the
      // same set as chains of CSS: `div` with `button`, `or` `div` with `span`, and `and` with the role query.
      yield* Expect.toHaveText(page.locator("div").locator("button"), ["three"])
      yield* Expect.toHaveText(
        page.locator("div").locator("button").or(page.locator("div").locator("span")),
        ["two", "three"]
      )
      yield* Expect.toHaveText(page.locator("button").or(page.locator("span")), ["two", "three", "four", "five"])

      yield* Expect.toHaveText(
        page.locator("div").locator("button").and(page.locator("div").getByRole("button")),
        ["three"]
      )
      yield* Expect.toHaveText(page.locator("button").and(page.getByRole("button")), ["three", "five"])
    }))

  test("LO-178", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<iframe srcdoc="<span id=target>world</span>"></iframe><span>hello</span>`)
      yield* Expect.toHaveText(
        page.frame(page.locator("iframe")).locator("span").or(page.frame(page.locator("iframe")).locator("article")),
        "world"
      )
      yield* Expect.toHaveText(
        page.frame(page.locator("iframe")).locator("article").or(page.frame(page.locator("iframe")).locator("span")),
        "world"
      )
      yield* Expect.toHaveText(
        page.frame(page.locator("iframe")).locator("span").and(page.frame(page.locator("iframe")).locator("#target")),
        "world"
      )
      // A composite across two frames throws at once, as a defect, where Playwright's error comes from the
      // expectation: `#iframe` names another frame than `iframe` does, so the two frame chains differ.
      assert.throws(
        () =>
          page.frame(page.locator("iframe")).locator("div").or(
            page.frame(page.locator("#iframe")).locator("span")
          ),
        /another frame/
      )
      assert.throws(
        () =>
          page.frame(page.locator("iframe")).locator("div").and(
            page.frame(page.locator("#iframe")).locator("span")
          ),
        /another frame/
      )
    }))

  test("LO-181", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div><button>Submit</button></div>`)
      yield* Expect.toHaveCount(page.locator("button"), 1)
      yield* Expect.toHaveCount(page.locator("div").locator("button"), 1)
      yield* Expect.toHaveCount(page.locator("div").getByRole("button"), 1)
      // The page is its own main frame, so there is no `mainFrame()` to call; the page's locator is the same query.
      yield* Expect.toHaveCount(page.locator("button"), 1)
    }))
})
