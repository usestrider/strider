/**
 * Playwright's `tests/page/elementhandle-content-frame.spec.ts`: the frame an iframe element holds (`contentFrame`),
 * and what `contentFrame` gives for an element that isn't an iframe.
 *
 * What the port changes:
 * - `elementHandle.contentFrame()` is `page.frame(page.locator("#frame1"))`: the frame an iframe's element enters, which
 *   re-resolves the element on each use. Playwright's `toBe(page.frames()[1])` identity has no counterpart, so the port
 *   checks that the frame is the tree's child at the iframe's place and that its document is reachable.
 * - Strider has no `null`: entering an element that isn't an iframe is `WrongElement` on use, which EH-022 and EH-023
 *   assert in place of `contentFrame()` returning `null`.
 * - EH-021 evaluates in the frame's own realm to find an element in the top document, which needs
 *   `frame.evaluateHandle` (see the ledger).
 * - `attachFrame` is the harness's, which runs in the main world as Playwright's does.
 */
import { assert } from "@effect/vitest"
import { Expect, Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { attachFrame } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The error of a read that Playwright's test expects to fail; one that succeeds fails. */
const failureOf = Effect.fnUntraced(function*(effect: Effect.Effect<unknown, unknown>) {
  const result = yield* Effect.result(effect)
  assert(Result.isFailure(result), "the call succeeded, where Playwright's call fails")
  return result.failure
})

upstream(import.meta.filename, {}, (test) => {
  test("EH-019", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      // the frame the element's contentFrame gives is the page's one child frame, at the iframe's place
      const frame = page.frame(page.locator("#frame1"))
      const children = (yield* page.frames).children
      assert.strictEqual(children.length, 1)
      assert.strictEqual(children[0]!.url, server.EMPTY_PAGE)
      yield* Expect.toBeAttached(frame.locator("body"))
    }))

  test("EH-020", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/empty.html")
      const frame = page.frame(page.locator("#frame1"))
      const children = (yield* page.frames).children
      assert.strictEqual(children.length, 1)
      assert.strictEqual(children[0]!.url, server.CROSS_PROCESS_PREFIX + "/empty.html")
      yield* Expect.toBeAttached(frame.locator("body"))
    }))

  // EH-021 is `needsFeature`: it evaluates inside the frame to find the top document's element (see the ledger).

  test("EH-022", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const frame = page.frame(page.locator("#frame1"))
      // `body` isn't an iframe, so there is no frame to give: Playwright's contentFrame() is null, and entering it fails
      const error = yield* failureOf(frame.frame(frame.locator("body")).locator("html").count)
      assert(Locator.isLocatorError(error), String(error))
      assert(error.reason._tag === "WrongElement", error.reason._tag)
      assert.strictEqual(error.reason.expected, "an iframe")
    }))

  test("EH-023", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const frame = page.frame(page.locator("#frame1"))
      // `document.documentElement` isn't an iframe either: entering it fails, where contentFrame() gives null
      const error = yield* failureOf(frame.frame(frame.locator("html")).locator("body").count)
      assert(Locator.isLocatorError(error), String(error))
      assert(error.reason._tag === "WrongElement", error.reason._tag)
      assert.strictEqual(error.reason.expected, "an iframe")
    }))
})
