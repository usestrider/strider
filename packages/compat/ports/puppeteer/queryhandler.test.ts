/**
 * Puppeteer's `test/src/queryhandler.test.ts`: which elements the built-in query handlers find. `text/` and `::-p-text`
 * match text, `pierce/` matches CSS through shadow roots, and the P selectors combine them with `>>>`, `>>>>`, and
 * `::-p-aria`.
 *
 * What the port changes:
 * - `page.$(selector)` is `.first` where Puppeteer takes the first match, and a read of the one match otherwise; `page.$$`
 *   is `.all`, or `count` where the test only counts. A handle's `evaluate(e => e.id)` is `readAttribute("id")`, and its
 *   `textContent` is `readText`, whose text is the whitespace-collapsed text `getByText` matches.
 * - `text/a` is `byText(page, "a")`: a `getByText` with a case-sensitive regular expression, which is Puppeteer's
 *   case-sensitive substring (Strider's `getByText` with a string ignores case, and `exact` means whole-text equality).
 *   Like Puppeteer's, it finds the smallest element that says the text, and it doesn't search `head`, where the test
 *   page's own title says "page".
 * - `pierce/.foo` is `locator(".foo")`: Strider's CSS searches open shadow roots, as Puppeteer's `pierce/` does. Strider's
 *   plain CSS also searches them, where Puppeteer's doesn't, so the selector-list tests, which count the plain `div`,
 *   see the div in the shadow root of `#c` as well (CONCEPTS.md: `locator(css)` runs `querySelectorAll` in the document and each open shadow root), so those two tests fail on Strider's documented rule, with no ledger entry.
 * - `element.$("text/a")` and `element.$("pierce/div")` are a locator chained on the element's locator. The chained
 *   query searches the element's own subtree, as Puppeteer's does.
 * - `div ::-p-text(world)` is a `getByText` chained on `div`, and `button::-p-text(world)` is `locator("button")` with
 *   `filter({ hasText })`, which matches an element whose text contains the string, as Puppeteer's text query does.
 *   `div ::-p-aria(world)` and the ARIA selectors with a role are `getByRole("button", { name, exact: true })`, since
 *   Puppeteer matches an accessible name exactly, and the page names one element, a button. `div ::-p-text(world):hover`
 *   is the text match intersected with `:hover`, the element the pointer is over.
 * - `:scope` is Strider's name for the element a query runs on, which Puppeteer's `&` is. The `& > table` selector of
 *   "should work with CSS selectors" is Puppeteer's own notation, so it's written `:scope > table` and checked only as
 *   parsing, as the original does.
 * - `$$eval` and `$$` over many elements with a tag name are `evaluateAll`, which runs in Strider's isolated world.
 * - "should work with CSS selectors" and "should match querySelector* ordering" use `or`, the union of two locators, for
 *   Puppeteer's selector lists. The ordering test runs every permutation of the lists, as the original does.
 * - The `html` helper is Puppeteer's, with the same document: its title is part of what the text queries must skip.
 * - Not ported: the XPath tests (needsFeature: Strider's locators take CSS only), the custom query handler tests
 *   (needsFeature: custom selector engines), and the isolated-worlds test (notApplicable: it tests Puppeteer's own
 *   handler registration). "should handle escapes" keeps what it checks of text with parentheses and quotes, and
 *   drops the `::-p-text` argument grammar, which has no counterpart. The ledger says why each is.
 */
import { assert } from "@effect/vitest"
import type { Locator, Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { html } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

/** A text query that matches as Puppeteer's does: a case-sensitive substring, which `getByText` with a string doesn't. */
const byText = (
  scope: { readonly getByText: (text: RegExp) => Locator.Locator },
  text: string
) => scope.getByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))

/** Puppeteer's `element.evaluate(e => e.id)` for the one match of `locator`, or `undefined` when nothing matches. */
const idOf = (locator: Locator.ReadonlyLocator) => locator.readAttribute("id").pipe(Effect.map(Option.getOrUndefined))

/** Puppeteer's `$$(selector)` ids: the `id` of each match, in document order. */
const idsOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const matches = yield* locator.all
  return yield* Effect.forEach(matches, idOf)
})

/** Puppeteer's `Promise.all(divs.map(div => div.evaluate(e => e.textContent)))`: each match's text, in order. */
const textsOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const matches = yield* locator.all
  return yield* Effect.forEach(matches, (match) => match.readText)
})

/** Puppeteer's `$$eval(selector, els => els.map(e => e.tagName.toLowerCase()))`. */
const tagNamesOf = (locator: Locator.ReadonlyLocator) =>
  locator.evaluateAll((elements) => elements.map((element) => element.tagName.toLowerCase()))

/** The shadow-root fixture of the "Pierce selectors" suite, verbatim: two `.foo` divs in a shadow root of `html > div`. */
const setUpPierce = (page: Page.Page) =>
  page.setContent(`<script>
         const div = document.createElement('div');
         const shadowRoot = div.attachShadow({mode: 'open'});
         const div1 = document.createElement('div');
         div1.textContent = 'Hello';
         div1.className = 'foo';
         const div2 = document.createElement('div');
         div2.textContent = 'World';
         div2.className = 'foo';
         shadowRoot.appendChild(div1);
         shadowRoot.appendChild(div2);
         document.documentElement.appendChild(div);
         </script>`)

upstream(import.meta.filename, {}, (test) => {
  test("Query handler tests Pierce selectors should find first element in shadow", ({ page }) =>
    Effect.gen(function*() {
      yield* setUpPierce(page)
      assert.strictEqual(yield* page.locator(".foo").first.readText, "Hello")
    }))

  test("Query handler tests Pierce selectors should find all elements in shadow", ({ page }) =>
    Effect.gen(function*() {
      yield* setUpPierce(page)
      assert.strictEqual((yield* textsOf(page.locator(".foo"))).join(" "), "Hello World")
    }))

  test("Query handler tests Pierce selectors should find first child element", ({ page }) =>
    Effect.gen(function*() {
      yield* setUpPierce(page)
      const parent = page.locator("html > div").first
      assert.strictEqual(yield* parent.locator("div").first.readText, "Hello")
    }))

  test("Query handler tests Pierce selectors should find all child elements", ({ page }) =>
    Effect.gen(function*() {
      yield* setUpPierce(page)
      const parent = page.locator("html > div").first
      assert.strictEqual((yield* textsOf(parent.locator("div"))).join(" "), "Hello World")
    }))

  test("Query handler tests Text selectors in Page should query existing element", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<section>test</section>`))
      assert.strictEqual(yield* byText(page, "test").count, 1)
    }))

  test("Query handler tests Text selectors in Page should return empty array for non-existing element", ({ page }) =>
    Effect.gen(function*() {
      assert.strictEqual(yield* byText(page, "test").count, 0)
    }))

  test("Query handler tests Text selectors in Page should return first element", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div id="1">a</div> <div>a</div>`))
      assert.strictEqual(yield* idOf(byText(page, "a").first), "1")
    }))

  test("Query handler tests Text selectors in Page should return multiple elements", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div>a</div> <div>a</div>`))
      assert.strictEqual(yield* byText(page, "a").count, 2)
    }))

  test("Query handler tests Text selectors in Page should pierce shadow DOM", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        const div = document.createElement("div")
        const shadow = div.attachShadow({ mode: "open" })
        const diva = document.createElement("div")
        shadow.append(diva)
        const divb = document.createElement("div")
        shadow.append(divb)
        diva.innerHTML = "a"
        divb.innerHTML = "b"
        document.body.append(div)
      })
      assert.strictEqual(yield* byText(page, "a").readText, "a")
    }))

  test("Query handler tests Text selectors in Page should query deeply nested text", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        html(`<div>
            <div>a</div>
            <div>b</div>
          </div>`)
      )
      assert.strictEqual(yield* byText(page, "a").readText, "a")
    }))

  test("Query handler tests Text selectors in Page should query inputs", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<input value="a" />`))
      assert.strictEqual(yield* byText(page, "a").readValue, "a")
    }))

  test("Query handler tests Text selectors in Page should not query radio", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<radio value="a"></radio>`))
      assert.strictEqual(yield* byText(page, "a").count, 0)
    }))

  test("Query handler tests Text selectors in Page should query text spanning multiple elements", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div><span>a</span> <span>b</span></div>`))
      assert.strictEqual(yield* byText(page, "a b").readText, "a b")
    }))

  // `div.evaluate(...)` and `input.evaluate(...)` are the locators' own isolated-world evaluations; `input.type` is
  // `pressSequentially`. The page's text queries read the page as it is, with no cache to clear.
  test("Query handler tests Text selectors in Page should clear caches", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div id="target1">text</div>
            <input
              id="target2"
              value="text"
            />
            <div id="target3">text</div>`))
      const div = page.locator("#target1")
      const input = page.locator("#target2")
      const setText = (value: string) =>
        div.evaluate((element, text) => {
          element.textContent = text
        }, value)
      const clearInput = input.evaluate((element) => {
        ;(element as HTMLInputElement).value = ""
      })

      yield* setText("text")
      assert.strictEqual(yield* idOf(byText(page, "text").first), "target1")
      yield* setText("foo")
      assert.strictEqual(yield* idOf(byText(page, "text").first), "target2")
      yield* clearInput
      yield* input.pressSequentially("foo")
      assert.strictEqual(yield* idOf(byText(page, "text").first), "target3")

      yield* setText("text")
      yield* clearInput
      yield* input.pressSequentially("text")
      assert.strictEqual(yield* byText(page, "text").count, 3)
      yield* setText("foo")
      assert.strictEqual(yield* byText(page, "text").count, 2)
      yield* clearInput
      yield* input.pressSequentially("foo")
      assert.strictEqual(yield* byText(page, "text").count, 1)
    }))

  test("Query handler tests Text selectors in ElementHandles should query existing element", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div class="a"><span>a</span></div>`))
      assert.strictEqual(yield* byText(page.locator("div").first, "a").count, 1)
    }))

  test("Query handler tests Text selectors in ElementHandles should return null for non-existing element", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div class="a"></div>`))
      assert.strictEqual(yield* byText(page.locator("div").first, "a").count, 0)
    }))

  test("Query handler tests P selectors should work with CSS selectors", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      assert.strictEqual(yield* idOf(page.locator("div > button")), "b")

      const root = page.locator("div").first
      assert.strictEqual(yield* idOf(root.locator(":scope > button")), "b")

      // Puppeteer's parser accepts these selectors; the test checks only that they parse, so each is counted. Its
      // `& > table` is Puppeteer's notation for `:scope > table`.
      for (
        const selector of [
          ".user_row[data-user-id=\"\\38 \"]:not(.deactivated_user)",
          `input[value='Search']:not([class='hidden'])`,
          `[data-test-id^="test-"]:not([data-test-id^="test-foo"])`,
          `:scope > table`
        ]
      ) {
        yield* page.locator(selector).count
      }
    }))

  test("Query handler tests P selectors should work with puppeteer pseudo classes", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      assert.strictEqual(yield* idOf(page.locator("button").filter({ hasText: "world" })), "b")
    }))

  test("Query handler tests P selectors should work with deep combinators", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      // Strider has one descendant step, which searches open shadow roots, so `>>>` and `>>>>` are the same query.
      // `div >>>> div`: a div inside a div, through shadow roots. The light `#c`, then `#d` in `#c`'s shadow root.
      assert.strictEqual(yield* idOf(page.locator("div").locator("div").first), "c")
      // `div >>> div`: the same set, whose second element is `#d`.
      assert.strictEqual(yield* idOf(page.locator("div").locator("div").nth(1)), "d")
      // `#c >>>> div` and `#c >>> div`: the divs inside `#c`'s shadow root, whose first is `#d`.
      assert.strictEqual(yield* idOf(page.locator("#c").locator("div").first), "d")
    }))

  test("Query handler tests P selectors should work with text selectors", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      assert.strictEqual(yield* idOf(byText(page.locator("div"), "world")), "b")
    }))

  test("Query handler tests P selectors should query light DOM and slotted text of shadow hosts", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`
        <main><h1>Cart</h1><my-button>Checkout</my-button></main>
        <div id="wrap"
          ><my-list><li>One</li><li>Two</li></my-list></div
        >
      `))

      yield* page.evaluateInMainWorld(() => {
        for (const h of document.querySelectorAll("my-button")) {
          h.attachShadow({ mode: "open" }).innerHTML = "<button><slot></slot></button>"
        }
        for (const h of document.querySelectorAll("my-list")) {
          h.attachShadow({ mode: "open" }).innerHTML = "<ul><slot></slot></ul>"
        }
      })

      assert.deepStrictEqual(yield* tagNamesOf(byText(page, "Checkout")), ["my-button"])
      assert.deepStrictEqual(yield* tagNamesOf(byText(page, "Two")), ["li"])
      assert.deepStrictEqual(yield* tagNamesOf(byText(page.locator("#wrap"), "One")), ["li"])
    }))

  // Puppeteer's name-only query matches any role. The page names one element, a button, so the port asks for buttons.
  test("Query handler tests P selectors should work ARIA selectors", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      assert.strictEqual(
        yield* idOf(page.locator("div").getByRole("button", { name: "world", exact: true })),
        "b"
      )
    }))

  test("Query handler tests P selectors should work ARIA selectors with role", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      assert.strictEqual(yield* idOf(page.getByRole("button", { name: "world", exact: true })), "b")
    }))

  test("Query handler tests P selectors should work ARIA selectors with name and role", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      assert.strictEqual(yield* idOf(page.getByRole("button", { name: "world", exact: true })), "b")
    }))

  test("Query handler tests P selectors should work with :hover", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      yield* byText(page.locator("div"), "world").hover()

      // `div ::-p-text(world):hover`: the text match that is the hovered element, which is the button.
      const hovered = byText(page.locator("div"), "world").and(page.locator(":hover"))
      assert.strictEqual(yield* hovered.count, 1)
      assert.strictEqual(yield* hovered.readText, "world")
      assert.strictEqual(yield* page.locator("button:hover").readText, "world")
    }))

  // Puppeteer's `div` doesn't search shadow roots, so its list has three elements. Strider's CSS searches open shadow
  // roots, so `div` also finds `#d`, and the union has four. It fails on that documented rule.
  test("Query handler tests P selectors should work with selector lists", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.locator("div").or(byText(page, "world")).count, 3)
    }))

  test("Query handler tests P selectors should match querySelector* ordering", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      const parts: Record<string, Locator.ReadonlyLocator> = {
        div: page.locator("div"),
        button: byText(page, "world"),
        span: page.locator("span")
      }
      const permute = <T>(inputs: ReadonlyArray<T>): Array<Array<T>> => {
        const results: Array<Array<T>> = []
        for (let i = 0; i < inputs.length; ++i) {
          const permutation = permute(inputs.slice(0, i).concat(inputs.slice(i + 1)))
          const value = inputs[i] as T
          if (permutation.length === 0) {
            results.push([value])
            continue
          }
          for (const part of permutation) {
            results.push([value].concat(part))
          }
        }
        return results
      }
      for (const list of permute(["div", "button", "span"])) {
        // `div, ::-p-text(world), span` in this order: the union of the locators, in the order of the list
        const union = list
          .map((selector) => parts[selector] as Locator.ReadonlyLocator)
          .reduce((left, right) => left.or(right))
        assert.strictEqual((yield* idsOf(union)).join(), "a,b,f,c")
      }
    }))

  test("Query handler tests P selectors should not have duplicate elements from selector lists", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      assert.strictEqual(yield* byText(page, "world").or(page.locator("button")).count, 1)
    }))

  // Puppeteer's test is about its `::-p-text` grammar: a backslash escapes a parenthesis, a quoted argument takes its
  // quotes as delimiters, and a stray quote in an unquoted or half-quoted argument is not matched. Strider takes the
  // string as given, so the port asks for the same texts by their value: the sentence with its parentheses and quotes
  // is found, and the sentence with a quote the page doesn't have is not.
  test("Query handler tests P selectors should handle escapes", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/p-selectors.html", { waitUntil: "load" })
      assert.strictEqual(yield* byText(page, `My name is Jun (pronounced like "June")`).count, 1)
      assert.strictEqual(yield* byText(page, `My name is Jun (pronounced like "June")"`).count, 0)
      assert.strictEqual(yield* byText(page, `"My name is Jun (pronounced like "June")`).count, 0)
    }))
})
