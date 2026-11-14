/**
 * Playwright's `tests/page/selectors-css.spec.ts`: CSS selectors on light and open shadow DOM, their combinators,
 * pseudo-classes, attribute matching, and descendant chains. SE-001, SE-003, SE-008 to SE-016, SE-026, and SE-027 are
 * ported, with SE-004, SE-017, SE-020 to SE-022, and SE-024. SE-002, SE-005 to SE-007, SE-018, SE-019, SE-023, and
 * SE-025 need Playwright's selector syntax (`css:light=`, `*` captures, `..`, relative `>>`), and are `needsFeature`
 * (see the ledger). No test here checks Playwright's selector parse errors, so none is `notApplicable`.
 *
 * What the port changes:
 * - `css=` is the engine name Playwright's selectors carry. `page.locator(css)` is CSS already, so the prefix is dropped.
 * - `a >> b` with plain CSS on both sides is a descendant chain: `page.locator(a).locator(b)` (`chain`), since a
 *   locator's queries are relative to it. A `>>` whose right side is relative (`>> ~ div`, `>> :scope`, `>> >span`) or
 *   captures (`*css=`), or that crosses an open shadow root, has no Strider form, and is `needsFeature`.
 * - Strider's CSS runs per root: a selector matches inside one tree, the document or one open shadow root, as
 *   `querySelectorAll` does there. Playwright's matches across shadow boundaries, so a combinator, `:has`, `:is`, or
 *   `:not` that reaches across one, such as `div span` for a span in a shadow root under a light `div`, matches there
 *   and not here. SE-004, SE-017, and SE-020 to SE-022 are ported with Playwright's counts, and fail on those.
 * - SE-020's last assertion, `>> xpath=.`, is Playwright's selector syntax and is left out; the rest is ported.
 * - SE-024's `:scope.selected` in a chained locator selects the scope element in Playwright. Strider's chain runs
 *   `querySelectorAll` on each scope, which never returns the scope itself, so the test fails on its count.
 * - Playwright's `$` and `$eval` take the first match. Strider's reads are strict, so they take `.first`. `$$` and
 *   `$$eval` take all matches, which are `count` or `all`.
 * - `e.textContent` is `readText`, the engine's text with whitespace collapsed. `e.outerHTML` is `readHtml`. `e.id`
 *   and `e.className` are `readAttribute`. `e.nodeName` and `e.tagName` are read from the match's markup (`tagOf`), so
 *   these reads need no isolated world, which stock WebKit lacks.
 * - `e === window.div` compares elements across worlds, which Strider can't do. The div is identified by its `attr`
 *   value instead, which only it has. SE-010's `e.parentNode === div` checks become one match whose markup is the
 *   div's only child `<span></span>`: the span is the div's only span, so a match for `[attr*=hello] span`,
 *   `[attr*=hello] >> span`, or `[attr3="] span"] >> span` is its child.
 * - SE-014 counts from `body` with Strider's `locator`, which matches as `querySelectorAll` does: its ancestors can be
 *   outside the scope. Playwright's `body.$$eval('* > *')` matches from the element scope, as jQuery does, so the
 *   `body` assertions of `* > *` and `* *` expect fewer matches than Strider's. They fail here as written, and are
 *   not ledgered: Strider's scoped CSS is a different rule, and the port keeps Playwright's expectation.
 * - SE-012's `$` is a truthy element. Strider counts, and the port asserts the single match as 1.
 * - SE-015 loads `deep-shadow.html`, which the fixture server serves from the vendored assets.
 * - SE-016's `it.skip` for Chromium before 111 doesn't apply to Chromium 155, so the port runs on every browser.
 */
import { assert } from "@effect/vitest"
import { Locator, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { upstream } from "../../harness/upstream.ts"

/** The tag name of the one match, read from its markup: `<section id="Hello">` is `SECTION`. */
const tagOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const html = yield* locator.readHtml
  const start = /^<([A-Za-z][^\s/>]*)/.exec(html)
  assert(start !== null, `no start tag in ${html}`)
  return (start[1] ?? "").toUpperCase()
})

/** The tag names of every match, in order, joined with commas as Playwright's `join(',')` does. */
const tagsOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const matches = yield* locator.all
  const tags = yield* Effect.forEach(matches, tagOf)
  return tags.join(",")
})

/** The engine text of every match, in order. */
const textsOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const matches = yield* locator.all
  return yield* Effect.forEach(matches, (each) => each.readText)
})

/** The value of an attribute on the one match, or `undefined` when it's absent. */
const attributeOf = (locator: Locator.ReadonlyLocator, name: string) =>
  Effect.map(locator.readAttribute(name), Option.getOrUndefined)

/** Playwright's `first >> second >> …`: each step is a locator inside the one before it. */
const chain = (page: Page.ReadonlyPage, first: string, ...rest: ReadonlyArray<string>): Locator.ReadonlyLocator =>
  rest.reduce<Locator.ReadonlyLocator>((locator, css) => locator.locator(css), page.locator(first))

upstream(import.meta.filename, {}, (test) => {
  test("SE-001", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        let id = 0
        const next = (tag: string) => {
          const e = document.createElement(tag)
          const eid = ++id
          e.textContent = "id" + eid
          e.id = "" + eid
          return e
        }
        const generate = (depth: number): HTMLElement => {
          const div = next("div")
          const span1 = next("span")
          const span2 = next("span")
          div.appendChild(span1)
          div.appendChild(span2)
          if (depth > 0) {
            div.appendChild(generate(depth - 1))
            div.appendChild(generate(depth - 1))
          }
          return div
        }
        document.body.appendChild(generate(12))
      })
      const selectors = [
        "div div div span",
        "div > div div > span",
        "div + div div div span + span",
        "div ~ div div > span ~ span",
        "div > div > div + div > div + div > span ~ span",
        "div div div div div div div div div div span",
        "div > div > div > div > div > div > div > div > div > div > span",
        "div ~ div div ~ div div ~ div div ~ div div ~ div span",
        "span"
      ]
      // Playwright compares the engine's matches with the page's own querySelectorAll, once each.
      for (const selector of selectors) {
        const counted = yield* page.locator(selector).count
        const native = yield* page.evaluateInMainWorld(
          (css: string) => document.querySelectorAll(css).length,
          selector
        )
        assert.strictEqual(counted, native, selector)
      }
    }))

  test("SE-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div foo="bar" bar="baz"><span></span></div>`)
      const selectors = [
        `div[foo="bar"] > span`,
        `div[foo="bar"]> span`,
        `div[foo="bar"] >span`,
        `div[foo="bar"]>span`,
        `div[foo="bar"]   >    span`,
        `div[foo="bar"]>    span`,
        `div[foo="bar"]     >span`,
        `div[foo="bar"][bar="baz"] > span`,
        `div[foo="bar"][bar="baz"]> span`,
        `div[foo="bar"][bar="baz"] >span`,
        `div[foo="bar"][bar="baz"]>span`,
        `div[foo="bar"][bar="baz"]   >    span`,
        `div[foo="bar"][bar="baz"]>    span`,
        `div[foo="bar"][bar="baz"]     >span`
      ]
      for (const selector of selectors) {
        assert.strictEqual(yield* page.locator(selector).readHtml, `<span></span>`, selector)
      }
    }))

  test("SE-008", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<section><span><div><x></x><y></y></div></span></section>`)
      assert.strictEqual(yield* tagsOf(chain(page, "span,div", "x,y")), "X,Y")
      assert.strictEqual(yield* tagsOf(chain(page, "span,div", "x")), "X")
      assert.strictEqual(yield* tagsOf(chain(page, "div", "x,y")), "X,Y")
      assert.strictEqual(yield* tagsOf(chain(page, "div", "x")), "X")

      assert.strictEqual(yield* tagsOf(chain(page, "section", "div", "x")), "X")
      assert.strictEqual(yield* tagsOf(chain(page, "section", "span", "div", "y")), "Y")
      assert.strictEqual(yield* tagsOf(chain(page, "section", "div", "x,y")), "X,Y")
      assert.strictEqual(yield* tagsOf(chain(page, "section", "div,span", "x,y")), "X,Y")
      assert.strictEqual(yield* tagsOf(chain(page, "section", "span", "x,y")), "X,Y")
    }))

  test("SE-009", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<span></span><div attr="hello,world!"></div>`)
      assert.strictEqual(yield* page.locator(`div[attr="hello,world!"]`).readHtml, `<div attr="hello,world!"></div>`)
      assert.strictEqual(yield* page.locator(`[attr="hello,world!"]`).readHtml, `<div attr="hello,world!"></div>`)
      assert.strictEqual(yield* page.locator(`div[attr='hello,world!']`).readHtml, `<div attr="hello,world!"></div>`)
      assert.strictEqual(yield* page.locator(`[attr='hello,world!']`).readHtml, `<div attr="hello,world!"></div>`)
      // Both the span and the div match; `$eval` took the first in document order, which is the span.
      assert.strictEqual(yield* page.locator(`div[attr="hello,world!"],span`).first.readHtml, `<span></span>`)
    }))

  test("SE-010", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div attr="hello world" attr2="hello-''>>foo=bar[]" attr3="] span"><span></span></div>`)
      // Each selector matches the div, which only it has this attr value for.
      const selectors = [
        `[attr="hello world"]`,
        `[attr = "hello world"]`,
        `[attr ~= world]`,
        `[attr ^=hello ]`,
        `[attr $= world ]`,
        `[attr *= "llo wor" ]`,
        `[attr2 |= hello]`,
        `[attr = "Hello World" i ]`,
        `[attr *= "llo WOR"i]`,
        `[attr $= woRLD i]`,
        `[attr2 = "hello-''>>foo=bar[]"]`,
        `[attr2 $="foo=bar[]"]`
      ]
      for (const selector of selectors) {
        assert.strictEqual(yield* attributeOf(page.locator(selector), "attr"), "hello world", selector)
      }
      // The span's parent is the div, whose only span this is: the one match is that span.
      for (
        const locator of [
          page.locator(`[attr*=hello] span`),
          chain(page, `[attr*=hello]`, "span"),
          chain(page, `[attr3="] span"]`, "span")
        ]
      ) {
        assert.strictEqual(yield* locator.count, 1)
        assert.strictEqual(yield* locator.readHtml, `<span></span>`)
      }
    }))

  test("SE-011", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section><div>test</div></section>")
      // The chain's first section isn't a match for the second, so nothing is found.
      assert.strictEqual(yield* chain(page, "section", "section").count, 0)
    }))

  test("SE-012", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"123\"></section>")
      // Playwright's `$` is truthy for one element. Strider counts, and the one match is asserted as 1.
      assert.strictEqual(yield* page.locator("#\\31\\32\\33").count, 1)
    }))

  test("SE-013", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"Hello\"></section>")
      assert.strictEqual(yield* tagOf(page.locator("#Hello")), "SECTION")
      assert.strictEqual(yield* tagOf(page.locator("#hello")), "SECTION")
      assert.strictEqual(yield* tagOf(page.locator("#HELLO")), "SECTION")
      assert.strictEqual(yield* tagOf(page.locator("#helLO")), "SECTION")
    }))

  test("SE-014", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div id=div1></div><div id=div2><span><span></span></span></div>")
      // Includes html, head and body.
      assert.strictEqual(yield* page.locator("*").count, 7)
      assert.strictEqual(yield* page.locator("*#div1").count, 1)
      assert.strictEqual(yield* page.locator("*:not(#div1)").count, 6)
      assert.strictEqual(yield* page.locator("*:not(div)").count, 5)
      assert.strictEqual(yield* page.locator("*:not(span)").count, 5)
      assert.strictEqual(yield* page.locator("*:not(*)").count, 0)
      assert.strictEqual(yield* page.locator("*:is(*)").count, 7)
      assert.strictEqual(yield* page.locator("* *").count, 6)
      assert.strictEqual(yield* page.locator("* *:not(span)").count, 4)
      assert.strictEqual(yield* page.locator("div > *").count, 1)
      assert.strictEqual(yield* page.locator("div *").count, 2)
      assert.strictEqual(yield* page.locator("* > *").count, 6)

      const body = page.locator("body")
      // Does not include html, head or body.
      assert.strictEqual(yield* body.locator("*").count, 4)
      assert.strictEqual(yield* body.locator("*#div1").count, 1)
      assert.strictEqual(yield* body.locator("*:not(#div1)").count, 3)
      assert.strictEqual(yield* body.locator("*:not(div)").count, 2)
      assert.strictEqual(yield* body.locator("*:not(span)").count, 2)
      assert.strictEqual(yield* body.locator("*:not(*)").count, 0)
      assert.strictEqual(yield* body.locator("*:is(*)").count, 4)
      assert.strictEqual(yield* body.locator("div > *").count, 1)
      assert.strictEqual(yield* body.locator("div *").count, 2)
      // Playwright's selectors match from the element scope, as jQuery does: 2 here. Strider's locator matches as
      // `querySelectorAll` does, so ancestors above body count, and the port keeps Playwright's expectation.
      assert.strictEqual(yield* body.locator("* > *").count, 2)
      // Adding scope makes querySelectorAll work like jquery.
      assert.strictEqual(yield* body.locator(":scope * > *").count, 2)
      // Playwright's own matching of `* *` from body, also from the element scope.
      assert.strictEqual(yield* body.locator("* *").count, 2)
      assert.strictEqual(yield* body.locator("* *:not(span)").count, 0)
    }))

  test("SE-015", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/deep-shadow.html")
      // Each span is the first child of its root or the second, so `:nth-child` answers the same within a root.
      assert.strictEqual(yield* page.locator("span:nth-child(odd)").count, 3)
      assert.strictEqual(yield* page.locator("span:nth-child(even)").count, 1)
      assert.strictEqual(yield* page.locator("span:nth-child(n+1)").count, 4)
      assert.strictEqual(yield* page.locator("span:nth-child(n+2)").count, 1)
      assert.strictEqual(yield* page.locator("span:nth-child(2n)").count, 1)
      assert.strictEqual(yield* page.locator("span:nth-child(2n+1)").count, 3)
      assert.strictEqual(yield* page.locator("span:nth-child(-n)").count, 0)
      assert.strictEqual(yield* page.locator("span:nth-child(-n+1)").count, 3)
      assert.strictEqual(yield* page.locator("span:nth-child(-n+2)").count, 4)
      assert.strictEqual(yield* page.locator("span:nth-child(23n+2)").count, 1)
    }))

  test("SE-016", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>
      <span>span1</span>
      <span class=foo>span2<dd></dd></span>
      <span class=foo>span3<dd class=marker></dd></span>
      <span class=foo>span4<dd class=marker></dd></span>
      <span class=foo>span5<dd></dd></span>
      <span>span6</span>
    </div>
  `)
      assert.deepStrictEqual(yield* textsOf(page.locator("span:nth-child(1)")), ["span1"])
      assert.deepStrictEqual(yield* textsOf(page.locator("span:nth-child(1 of .foo)")), ["span2"])
      assert.deepStrictEqual(yield* textsOf(page.locator("span:nth-child(1 of .foo:has(dd.marker))")), ["span3"])
      assert.deepStrictEqual(yield* textsOf(page.locator("span:nth-last-child(1 of .foo:has(dd.marker))")), ["span4"])
      assert.deepStrictEqual(yield* textsOf(page.locator("span:nth-last-child(1 of .foo)")), ["span5"])
      assert.deepStrictEqual(yield* textsOf(page.locator("span:nth-last-child(  1  )")), ["span6"])

      assert.deepStrictEqual(yield* textsOf(page.locator("span:nth-child(1 of .foo:nth-child(3))")), ["span3"])
      assert.deepStrictEqual(yield* textsOf(page.locator("span:nth-child(1 of .foo:nth-child(6))")), [])
    }))

  test("SE-004", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/deep-shadow.html")
      assert.strictEqual(yield* page.locator(`span,section #root1`).count, 5)
      assert.strictEqual(yield* page.locator(`section #root1, div span`).count, 5)
      assert.strictEqual(yield* attributeOf(page.locator(`doesnotexist , section #root1`).first, "id"), "root1")
      assert.strictEqual(yield* page.locator(`doesnotexist ,section #root1`).count, 1)
      assert.strictEqual(yield* page.locator(`span,div span`).count, 4)
      assert.strictEqual(yield* page.locator(`span,div span,div div span`).count, 4)
      assert.strictEqual(yield* page.locator(`#target,[attr="value\\ space"]`).count, 2)
      assert.strictEqual(yield* page.locator(`#target,[data-testid="foo"],[attr="value\\ space"]`).count, 4)
      assert.strictEqual(yield* page.locator(`#target,[data-testid="foo"],[attr="value\\ space"],span`).count, 4)
    }))

  test("SE-017", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/deep-shadow.html")
      assert.strictEqual(yield* page.locator(`div:not(#root1)`).count, 2)
      assert.strictEqual(yield* page.locator(`body :not(span)`).count, 4)
      assert.strictEqual(yield* page.locator(`div > :not(span):not(div)`).count, 0)
    }))

  test("SE-020", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/deep-shadow.html")
      assert.strictEqual(yield* page.locator(`span:nth-child(23n +2)`).count, 1)
      assert.strictEqual(yield* page.locator(`span:nth-child(23n+ 2)`).count, 1)
      assert.strictEqual(yield* page.locator(`span:nth-child( 23n + 2 )`).count, 1)
      assert.strictEqual(yield* page.locator(`span:not(#root1 #target)`).count, 3)
      assert.strictEqual(yield* page.locator(`span:not(:not(#root1 #target))`).count, 1)
      assert.strictEqual(yield* page.locator(`span:not(span:not(#root1 #target))`).count, 1)
      assert.strictEqual(yield* page.locator(`div > :not(span)`).count, 2)
      assert.strictEqual(yield* page.locator(`body :not(span, div)`).count, 1)
      assert.strictEqual(yield* page.locator(`span, section:not(span, div)`).count, 5)
    }))

  test("SE-021", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/deep-shadow.html")
      assert.strictEqual(yield* page.locator(`div:is(#root1)`).count, 1)
      assert.strictEqual(yield* page.locator(`div:is(#root1, #target)`).count, 1)
      assert.strictEqual(yield* page.locator(`div:is(span, #target)`).count, 0)
      assert.strictEqual(yield* page.locator(`div:is(span, #root1 > *)`).count, 2)
      assert.strictEqual(yield* page.locator(`div:is(section div)`).count, 3)
      assert.strictEqual(yield* page.locator(`:is(div, span)`).count, 7)
      assert.strictEqual(yield* page.locator(`section:is(section) div:is(section div)`).count, 3)
      assert.strictEqual(yield* page.locator(`:is(div, span) > *`).count, 6)
      assert.strictEqual(yield* page.locator(`#root1:has(:is(#root1))`).count, 0)
      assert.strictEqual(yield* page.locator(`#root1:has(:is(:scope, #root1))`).count, 1)
    }))

  test("SE-022", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/deep-shadow.html")
      assert.strictEqual(yield* page.locator(`div:has(#target)`).count, 2)
      assert.strictEqual(yield* page.locator(`div:has([data-testid=foo])`).count, 3)
      assert.strictEqual(yield* page.locator(`div:has([attr*=value])`).count, 2)

      yield* page.setContent(`<section><span></span><div></div></section><section><br></section>`)
      assert.strictEqual(yield* page.locator(`section:has(span, div)`).count, 1)
      assert.strictEqual(yield* page.locator(`section:has(span, div)`).count, 1)
      assert.strictEqual(yield* page.locator(`section:has(br)`).count, 1)
      assert.strictEqual(yield* page.locator(`section:has(span, br)`).count, 2)
      assert.strictEqual(yield* page.locator(`section:has(span, br, div)`).count, 2)
    }))

  test("SE-024", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div class="apple"></div>
                         <div class="apple selected"></div>`)
      // Playwright bug 17824: `:scope` in a chained locator is the scope element itself, so the selected apple counts.
      const apples = page.locator(".apple")
      const selectedApples = apples.locator(":scope.selected")
      assert.strictEqual(yield* selectedApples.count, 1)
    }))

  test("SE-026", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <span class="find-me" id=target1>1</span>
    <div>
      <span class="find-me" id=target2>2</span>
    </div>
  `)
      // `$eval` takes the first match, which `.first` selects.
      assert.strictEqual(yield* attributeOf(page.locator(".find-me").first, "id"), "target1")

      // A handle's queries are relative to the div: its `.find-me` is the one inside it.
      const div = page.locator("div").first
      assert.strictEqual(yield* attributeOf(div.locator(".find-me").first, "id"), "target2")
      assert.strictEqual(yield* attributeOf(chain(page, "div", ".find-me").first, "id"), "target2")
    }))

  test("SE-027", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <my-button>
      <template shadowrootmode="open">
        <button><slot></slot></button>
      </template>
      <div class="content">Foo</div>
    </my-button>
  `)
      assert.strictEqual(yield* attributeOf(page.locator("my-button > div"), "class"), "content")
      assert.strictEqual(yield* page.locator("my-button > .content").readText, "Foo")
    }))
})
