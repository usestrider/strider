/**
 * Playwright's `tests/page/locator-evaluate.spec.ts`: a locator's element, or every element it matches, read by a page
 * function, and a locator that matches nothing.
 *
 * What the port changes:
 * - `locator.evaluate` and `locator.evaluateAll` are Strider's, which run the function in the page's isolated world, so the
 *   five tests exercise the same operations. Stock WebKit has no isolated worlds, so they fail there with `Unsupported`.
 * - The functions' parameters are `Element` where the original casts to `HTMLElement` for `innerText`; the port casts the
 *   same way.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("LO-084", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<html><body><div class=\"tweet\"><div class=\"like\">100</div><div class=\"retweets\">10</div></div></body></html>"
      )
      assert.strictEqual(yield* page.locator(".tweet .like").evaluate((node) => (node as HTMLElement).innerText), "100")
    }))

  test("LO-085", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<div class=\"a\">not-a-child-div</div><div id=\"myId\"><div class=\"a\">a-child-div</div></div>"
      )
      assert.strictEqual(
        yield* page.locator("#myId .a").evaluate((node) => (node as HTMLElement).innerText),
        "a-child-div"
      )
    }))

  test("LO-086", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<html><body><div class=\"tweet\"><div class=\"like\">100</div><div class=\"like\">10</div></div></body></html>"
      )
      assert.deepStrictEqual(
        yield* page.locator(".tweet .like").evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).innerText)),
        ["100", "10"]
      )
    }))

  test("LO-087", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<div class=\"a\">not-a-child-div</div><div id=\"myId\"><div class=\"a\">a1-child-div</div><div class=\"a\">a2-child-div</div></div>"
      )
      assert.deepStrictEqual(
        yield* page.locator("#myId .a").evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).innerText)),
        ["a1-child-div", "a2-child-div"]
      )
    }))

  test("LO-088", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div class=\"a\">not-a-child-div</div><div id=\"myId\"></div>")
      assert.strictEqual(yield* page.locator("#myId .a").evaluateAll((nodes) => nodes.length), 0)
    }))
})
