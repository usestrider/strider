/**
 * Puppeteer's `test/src/queryselector.test.ts`: `page.$`, `page.$$`, `page.$eval`, and `page.$$eval`, and the same on
 * element handles, which find elements by a selector string.
 *
 * What the port changes:
 * - Strider has no selector strings: a match is a locator. `page.$(s)` is `page.locator(s)` (its `count` of zero is
 *   Puppeteer's `null`), and `page.$$(s)` is `.all`, whose elements are read with `readText`, as the original reads each
 *   handle's `textContent` in the page.
 * - `page.$eval(s, f)` is `locator.first.evaluate(f, ...args)`, which reads one match and fails `NoMatch` at once when
 *   there is none. `page.$$eval(s, f)` is `locator.evaluateAll(f, ...args)` over every match, never a read of each one.
 *   Both run the function in the isolated world, which is fine for these DOM reads.
 * - An element handle is the locator it was found by: `elementHandle.$(s)` is that locator's `.locator(s)`. A handle
 *   passed as an argument is a `page.evaluateHandle` handle, as the original's `page.$` result is, and arrives in the
 *   function as its element.
 * - Puppeteer's `using` disposes a handle at the end of its block. Strider's `evaluateHandle` handles are released with
 *   the test's scope, so the port has no disposal calls.
 * - `page.evaluate(e => e.textContent, element)` over the handles is `readText` of each match.
 * - "should handle many elements" runs the page's loop in the main world with `page.evaluateInMainWorld`, as the
 *   original's `page.evaluate` string runs there.
 * - `page.goto(server.PREFIX + "/playground.html")` names `waitUntil: "load"`: Strider's `goto` returns at commit, and the
 *   original's waits for load. The page is `playground.html`, vendored from Puppeteer's assets.
 * - The original's `html` template tag is dropped: the page content is the original's, verbatim.
 * - The `$$` XPath tests (`xpath/...`) and the `allArray/...` custom-handler tests aren't ported: Strider has neither XPath
 *   nor custom selector engines, and the ledger says why each is. "should query existing elements without isolation" is
 *   in the ledger too: Puppeteer's `isolate: false` picks which realm the returned handles live in (the page's own
 *   instead of its isolated one), and Strider's handles and locators have no main-world counterpart.
 */
import { assert } from "@effect/vitest"
import { Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { failureOf } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

/** The reason of a locator's failure, as its typed `_tag`. */
const reasonOf = (error: unknown) => Locator.isLocatorError(error) ? error.reason._tag : undefined

upstream(import.meta.filename, {}, (test) => {
  test("querySelector Page.$eval should work", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section id=\"testAttribute\">43543</section>")
      const idAttribute = yield* page.locator("section").first.evaluate((e) => e.id)
      assert.strictEqual(idAttribute, "testAttribute")
    }))

  test("querySelector Page.$eval should accept arguments", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>hello</section>")
      const text = yield* page.locator("section").first.evaluate(
        (e, suffix: string) => e.textContent + suffix,
        " world!"
      )
      assert.strictEqual(text, "hello world!")
    }))

  test("querySelector Page.$eval should accept ElementHandles as arguments", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>hello</section><div> world</div>")
      const divHandle = yield* page.evaluateHandle(() => document.querySelector("div"))
      // A handle argument arrives as its element, which the signature types as the handle, hence the cast
      const text = yield* page.locator("section").first.evaluate(
        (e, div) => e.textContent + (div as unknown as Element | null)?.textContent,
        divHandle
      )
      assert.strictEqual(text, "hello world")
    }))

  test("querySelector Page.$eval should throw error if no element is found", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer rejects with 'failed to find element matching selector "section"'. A locator's evaluation reads once
      // and fails with `NoMatch`, whose message names the selector.
      const error = yield* failureOf(page.locator("section").first.evaluate((e) => e.id))
      assert.strictEqual(reasonOf(error), "NoMatch")
      assert.include(Locator.isLocatorError(error) ? error.message : String(error), "section")
    }))

  test("querySelector Page.$$eval should work", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div>\n<div>beautiful</div>\n<div>world!</div>")
      const divsCount = yield* page.locator("div").evaluateAll((divs) => divs.length)
      assert.strictEqual(divsCount, 3)
    }))

  test("querySelector Page.$$eval should accept extra arguments", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>hello</div>\n<div>beautiful</div>\n<div>world!</div>")
      const divsCountPlus5 = yield* page.locator("div").evaluateAll(
        (divs, two: number, three: number) => divs.length + two + three,
        2,
        3
      )
      assert.strictEqual(divsCountPlus5, 8)
    }))

  test("querySelector Page.$$eval should accept ElementHandles as arguments", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>2</section>\n<section>2</section>\n<section>1</section>\n<div>3</div>")
      const divHandle = yield* page.evaluateHandle(() => document.querySelector("div"))
      const sum = yield* page.locator("section").evaluateAll(
        (sections, div) =>
          sections.reduce((acc, section) => acc + Number(section.textContent), 0) +
          Number((div as unknown as Element | null)?.textContent),
        divHandle
      )
      assert.strictEqual(sum, 8)
    }))

  test("querySelector Page.$$eval should handle many elements", ({ page }) =>
    Effect.gen(function*() {
      yield* page.evaluateInMainWorld(() => {
        for (let i = 0; i <= 1000; i++) {
          const section = document.createElement("section")
          section.textContent = String(i)
          document.body.appendChild(section)
        }
      })
      const sum = yield* page.locator("section").evaluateAll((sections) =>
        sections.reduce((acc, section) => acc + Number(section.textContent), 0)
      )
      assert.strictEqual(sum, 500500)
    }))

  test("querySelector Page.$ should query existing element", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<section>test</section>")
      // `page.$` returns the element; a locator is always a value, so the match is what the port checks
      assert.strictEqual(yield* page.locator("section").count, 1)
    }))

  test("querySelector Page.$ should return null for non-existing element", ({ page }) =>
    Effect.gen(function*() {
      // `page.$` returns null when nothing matches, which is a count of zero
      assert.strictEqual(yield* page.locator("non-existing-element").count, 0)
    }))

  test("querySelector Page.$$ should query existing elements", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div>A</div>\n<br />\n<div>B</div>")
      const elements = yield* page.locator("div").all
      assert.strictEqual(elements.length, 2)
      assert.deepStrictEqual(yield* Effect.forEach(elements, (element) => element.readText), ["A", "B"])
    }))

  test("querySelector Page.$$ should return empty array if nothing is found", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(yield* page.locator("div").all, [])
    }))

  test("querySelector ElementHandle.$ should query existing element", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/playground.html", { waitUntil: "load" })
      yield* page.setContent(
        "<html>\n  <body>\n    <div class=\"second\"><div class=\"inner\">A</div></div>\n  </body>\n</html>"
      )
      // `html`, then `.second` within it, then `.inner` within that: each handle's `$` is its locator's `locator`
      const content = yield* page.locator("html").locator(".second").locator(".inner").first.readText
      assert.strictEqual(content, "A")
    }))

  test("querySelector ElementHandle.$ should return null for non-existing element", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<html>\n  <body>\n    <div class=\"second\"><div class=\"inner\">B</div></div>\n  </body>\n</html>"
      )
      assert.strictEqual(yield* page.locator("html").locator(".third").count, 0)
    }))

  test("querySelector ElementHandle.$eval should work", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<html>\n  <body>\n    <div class=\"tweet\">\n      <div class=\"like\">100</div>\n      <div class=\"retweets\">10</div>\n    </div>\n  </body>\n</html>"
      )
      const content = yield* page.locator(".tweet").locator(".like").first.evaluate(
        (node) => (node as HTMLElement).innerText
      )
      assert.strictEqual(content, "100")
    }))

  test("querySelector ElementHandle.$eval should retrieve content from subtree", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<div class=\"a\">not-a-child-div</div><div id=\"myId\"><div class=\"a\">a-child-div</div></div>"
      )
      // `.a` inside `#myId` only: the first `.a` on the page is outside it
      const content = yield* page.locator("#myId").locator(".a").first.evaluate(
        (node) => (node as HTMLElement).innerText
      )
      assert.strictEqual(content, "a-child-div")
    }))

  test("querySelector ElementHandle.$eval should throw in case of missing selector", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div class=\"a\">not-a-child-div</div><div id=\"myId\"></div>")
      // Puppeteer's message is "Error: failed to find element matching selector \".a\"": a read fails once with `NoMatch`
      const error = yield* failureOf(
        page.locator("#myId").locator(".a").first.evaluate((node) => (node as HTMLElement).innerText)
      )
      assert.strictEqual(reasonOf(error), "NoMatch")
      assert.include(Locator.isLocatorError(error) ? error.message : String(error), ".a")
    }))

  test("querySelector ElementHandle.$$eval should work", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<html>\n  <body>\n    <div class=\"tweet\">\n      <div class=\"like\">100</div>\n      <div class=\"like\">10</div>\n    </div>\n  </body>\n</html>"
      )
      const content = yield* page.locator(".tweet").locator(".like").evaluateAll((nodes) =>
        (nodes as Array<HTMLElement>).map((n) => n.innerText)
      )
      assert.deepStrictEqual(content, ["100", "10"])
    }))

  test("querySelector ElementHandle.$$eval should retrieve content from subtree", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<div class=\"a\">not-a-child-div</div><div id=\"myId\"><div class=\"a\">a1-child-div</div><div class=\"a\">a2-child-div</div></div>"
      )
      const content = yield* page.locator("#myId").locator(".a").evaluateAll((nodes) =>
        (nodes as Array<HTMLElement>).map((n) => n.innerText)
      )
      assert.deepStrictEqual(content, ["a1-child-div", "a2-child-div"])
    }))

  test("querySelector ElementHandle.$$eval should not throw in case of missing selector", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div class=\"a\">not-a-child-div</div><div id=\"myId\"></div>")
      // An `evaluateAll` with no matches resolves with an empty array, without waiting
      const nodesLength = yield* page.locator("#myId").locator(".a").evaluateAll((nodes) => nodes.length)
      assert.strictEqual(nodesLength, 0)
    }))

  test("querySelector ElementHandle.$$ should query existing elements", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<html>\n  <body>\n    <div>A</div>\n    <br />\n    <div>B</div>\n  </body>\n</html>"
      )
      const elements = yield* page.locator("html").locator("div").all
      assert.strictEqual(elements.length, 2)
      assert.deepStrictEqual(yield* Effect.forEach(elements, (element) => element.readText), ["A", "B"])
    }))

  test("querySelector ElementHandle.$$ should return empty array for non-existing elements", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<html>\n  <body>\n    <span>A</span><br /><span>B</span>\n  </body>\n</html>")
      assert.deepStrictEqual(yield* page.locator("html").locator("div").all, [])
    }))
})
