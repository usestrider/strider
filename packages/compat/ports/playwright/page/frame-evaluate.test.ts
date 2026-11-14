/**
 * Playwright's `tests/page/frame-evaluate.spec.ts`: which execution context a frame's code runs in, and what the
 * page's and a frame's evaluations see.
 *
 * What the port changes:
 * - Playwright's `frame.evaluate` runs in a frame's main world. Strider has no main-world evaluation in a frame, only
 *   `page.evaluateInMainWorld`, which runs in the page's main world, and the isolated worlds, which can't see page
 *   globals and which stock WebKit lacks. Every frame here is same-origin with the page, so the port reaches a
 *   frame's main world from the page's, through `document.querySelector("iframe").contentWindow`, and reads the
 *   same globals the original does (FR-001, FR-002, FR-010, FR-011, FR-012). FR-006, FR-007, and FR-008 need a
 *   handle that crosses into another frame, which Strider lacks, so they are `needsFeature` in the ledger, and
 *   FR-003 and FR-004 are `notApplicable`.
 * - `page.mainFrame()` is the page, since Strider has no `Frame` object: FR-005 reads the page's own location in the
 *   page's main world.
 * - `page.frames()[i]` is the frame tree's child, `(yield* page.frames).children[i]`, and the frame itself is entered
 *   by its iframe element, as Strider enters frames.
 * - Playwright's `goto` waits for `load` by default and Strider's waits for `commit`, so every `goto` here names
 *   `waitUntil: "load"`.
 * - `expect(element).toBeTruthy()` on an element handle is `Expect.toBeAttached` on the element's locator, since
 *   Strider has no element handle to test for truthiness.
 * - Playwright's `mainFrame.evaluateHandle` (FR-013) is `page.evaluateHandle`, which runs in the isolated world.
 *   The test checks only that a handle came back.
 * - Playwright's `.catch(e => e)` is `Effect.result`, and the error checks are Strider's typed errors.
 * - FR-009: Playwright's `frame1.evaluate` after the frame is detached fails with "Frame was detached". Strider's
 *   frame locator has no detached frame to evaluate in: it re-resolves its iframe on each use, and a locator's
 *   evaluation resolves its match now without waiting. So the evaluation fails at once with Strider's `NoMatch`,
 *   which the port asserts.
 */
import { assert } from "@effect/vitest"
import { Expect, Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { attachFrame, frameCount } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The error of a call that Playwright's test expects to fail (its `.catch(e => e)`); a call that succeeds fails. */
const failureOf = Effect.fnUntraced(function*<A, E, R>(effect: Effect.Effect<A, E, R>) {
  const result = yield* Effect.result(effect)
  assert(Result.isFailure(result), "the call succeeded, where Playwright's call fails")
  return result.failure
})

upstream(import.meta.filename, {}, (test) => {
  test("FR-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      assert.strictEqual(yield* frameCount(page), 2)
      // `page.frames()[0]` is the page's window, and `page.frames()[1]` is the iframe's, same-origin, in the main world
      yield* page.evaluateInMainWorld(() => {
        const frameWindow = document.querySelector("iframe")!.contentWindow as unknown as { FOO: string }
        ;(window as unknown as { FOO: string }).FOO = "foo"
        frameWindow.FOO = "bar"
      })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as unknown as { FOO: string }).FOO), "foo")
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() =>
          (document.querySelector("iframe")!.contentWindow as unknown as { FOO: string }).FOO
        ),
        "bar"
      )
    }))

  test("FR-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.body.textContent!.trim()), "")
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() =>
          document.querySelector("iframe")!.contentDocument!.body.textContent!.trim()
        ),
        "Hi, I'm frame"
      )
    }))

  test("FR-005", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Playwright's `mainFrame` is the page: the page's evaluation reads whichever document is current
      assert.include(yield* page.evaluateInMainWorld(() => window.location.href), server.EMPTY_PAGE)
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      assert.include(yield* page.evaluateInMainWorld(() => window.location.href), server.CROSS_PROCESS_PREFIX)
    }))

  test("FR-009", ({ page, server }) =>
    Effect.gen(function*() {
      const frame1 = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      yield* page.evaluateInMainWorld(() => {
        document.getElementById("frame1")!.remove()
      })
      const error = yield* failureOf(frame1.locator(":root").evaluate(() => 7 * 8))
      assert(Locator.isLocatorError(error), String(error))
      assert.strictEqual(error.operation, "Locator.evaluate")
      assert(error.reason instanceof Locator.NoMatch, String(error.reason))
    }))

  test("FR-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      assert.strictEqual(yield* frameCount(page), 2)
      // `frame1` is the page's window and `frame2` the iframe's, in the main world; they are different windows
      assert.isTrue(
        yield* page.evaluateInMainWorld(() => window !== document.querySelector("iframe")!.contentWindow)
      )
      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { a: number }).a = 1
        ;(document.querySelector("iframe")!.contentWindow as unknown as { a: number }).a = 2
      })
      const [a1, a2] = yield* Effect.all([
        page.evaluateInMainWorld(() => (window as unknown as { a: number }).a),
        page.evaluateInMainWorld(() => (document.querySelector("iframe")!.contentWindow as unknown as { a: number }).a)
      ], { concurrency: "unbounded" })
      assert.strictEqual(a1, 1)
      assert.strictEqual(a2, 2)
    }))

  test("FR-011", ({ page, browserName }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `
    <meta http-equiv="Content-Security-Policy" content="script-src 'none';">
    <iframe src='javascript:""'></iframe>
  `,
        { waitUntil: "domContentLoaded" }
      )
      yield* page.evaluateInMainWorld(() => {
        const iframe = document.querySelector("iframe")!
        const div = iframe.contentDocument!.createElement("div")
        iframe.contentDocument!.body.appendChild(div)
      })
      const child = (yield* page.frames).children[0]
      assert.isDefined(child)
      assert.strictEqual(String(child.url), browserName === "webkit" ? "about:blank" : "")
      const frame = page.frame(page.locator("iframe"))
      // The original's main-world `frames()[1].evaluate`, read through the iframe's window from the page's main world
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("iframe")!.contentWindow!.location.href),
        "about:blank"
      )
      // The original's `frames()[1].$('div')`: the element is there
      yield* Expect.toBeAttached(frame.locator("div"))
    }))

  test("FR-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const iframe = document.createElement("iframe")
        iframe.src = "javascript:\"\""
        document.body.appendChild(iframe)
        iframe.contentDocument!.open()
        iframe.contentDocument!.write("<div>hello</div>")
        iframe.contentDocument!.close()
      })
      const frame = page.frame(page.locator("iframe"))
      // The original's main-world `window.top.location.href`, read through the iframe's window
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("iframe")!.contentWindow!.top!.location.href),
        server.EMPTY_PAGE
      )
      yield* Expect.toBeAttached(frame.locator("div"))
    }))

  test("FR-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Playwright's `mainFrame.evaluateHandle`: the page's `evaluateHandle`, which runs in the isolated world
      const windowHandle = yield* page.evaluateHandle(() => window)
      assert.isOk(windowHandle)
    }))
})
