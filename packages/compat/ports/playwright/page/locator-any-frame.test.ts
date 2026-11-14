/**
 * Playwright's `tests/page/locator-any-frame.spec.ts`: a frame locator's chain, its queries, and its actions, inside the
 * frames of a page.
 *
 * What the port changes:
 * - Playwright's `page.frameLocator()` with no selector searches every frame of the page for its chain, and fails when
 *   the chain matches in more than one. Strider enters a frame only by its iframe element, `page.frame(iframe)`, and
 *   has no search across frames. The ported tests name their iframe, the one frame the search finds in their page, and
 *   assert the same results there, which is frame-scoped locator behaviour, not the search: none of these would fail if
 *   the search were broken. Tests whose assertions are about the search itself (which frames it visits, its errors
 *   across several frames, its stalled-frame behaviour, `internal:control=any-frame`) aren't ported; the ledger says
 *   which, and why.
 * - Where a test's chain starts in a frame and reaches another frame's element, the port enters the frames in turn
 *   (`frame.frame(iframe)`), and `Locator.frame(iframe)` enters a frame found under a locator, as Playwright's
 *   `locator.contentFrame()` does (`method-locator-contentframe`).
 * - Strider has no `frame.evaluate` in a frame's main world (`method-frame-evaluate`). Where the original reads
 *   `window.__clicked` in a frame, or runs page code there, the port's `page.evaluateInMainWorld` script reaches the
 *   frame through its iframe's `contentWindow`, which is same-origin here. Nothing is added to the pages.
 * - `*css=div >> span` captures the div that has a span, which Strider has no syntax for (the ledger's
 *   `method-framelocator-locator-value-xpath-and-playwright-selector-dsl`): LO-025 filters the div with `has`, as the
 *   selectors-frame port's capture test does.
 * - LO-043 and LO-044 build their `or` operand on `page` (LO-043) or on a second `frameLocator("#f")` from the main frame
 *   (LO-044), and expect the search to resolve it from the frame it found. That resolution is the search, and naming the
 *   frame makes both operands the same chain, so they aren't ported (the ledger says why).
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. The original's `window.builtins`
 *   is Playwright's injected copy of `setTimeout`; these pages run no script of their own, so the port calls
 *   `window.setTimeout`, as page-dialog's port does.
 * - `page.route` with a body is `server.setRoute`, which answers a path with a handler until the test ends.
 * - `page.goto` waits for `load` by default and Strider's waits for `commit`, so each goto asks for `load`.
 * - `expect.poll(() => page.frames().length)` is `page.frames.waitFor` on the frame tree. `frame.waitForSelector(s,
 *   { state: "attached" })` is `Expect.toBeAttached` on the first match, as Playwright's non-strict wait is:
 *   `Expect.toBeAttached` on several matches waits for exactly one.
 * - A timed-out action's error is a `Deadline.Timeout`: its budget and the reason it last observed are asserted on the
 *   typed error, as the click-timeout ports do. Playwright's message names the reason in its own words, which Strider's
 *   `Timeout.message` doesn't carry.
 * - A strict violation is a `LocatorError` whose reason is `StrictViolation`, which names the matches and their count.
 *   Strider's `Expect` waits for exactly one match and then fails at its deadline with the match count it observed, where
 *   Playwright throws at once; LO-015 asserts that count.
 * - LO-045 calls `first`, `last`, and `nth` on Playwright's frame locator. Strider's frame locator has no such methods:
 *   the iframe is selected on its element locator before the frame is entered (see the ledger).
 * - LO-051's `issue` annotation is Playwright's own metadata, and the port keeps no annotations.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, Locator, type Page } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import type { ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `routePage`: serves `body` at `/${path}` as HTML, until the test ends. */
const routePage = (server: ServerShape, path: string, body: string) =>
  server.setRoute(`/${path}`, (_request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(body)
  })

/** A button whose click sets `window.__clicked`, as the original's does. */
const clickable = `<button onclick="window.__clicked = true">Click me</button>`

/**
 * The original's `frame.evaluate(() => window.__clicked)`, which reads the frame's main-world global: the page's main
 * world reaches the frame through each iframe's `contentWindow` in turn, named by `selectors` (same-origin here).
 */
const clicked = (page: Page.Page, ...selectors: ReadonlyArray<string>) =>
  page.evaluateInMainWorld((selectors) => {
    let window_: Window = window
    for (const selector of selectors) {
      window_ = (window_.document.querySelector(selector) as HTMLIFrameElement).contentWindow!
    }
    return (window_ as unknown as { __clicked?: boolean }).__clicked
  }, selectors)

/** Every frame in a tree, the page's own included: what Playwright's `page.frames().length` counts. */
const frameTotal = (tree: Page.FrameTree): number =>
  1 + tree.children.reduce((sum, child) => sum + frameTotal(child), 0)

/**
 * Playwright's `waitForAllFrames` for a page with one iframe, which `frame` enters: the page has two frames, and
 * `selector` is attached in the iframe.
 */
const waitForFrame = Effect.fnUntraced(function*(
  page: Page.ReadonlyPage,
  frame: Locator.ReadonlyFrameLocator,
  selector: string
) {
  yield* page.frames.waitFor((tree) => frameTotal(tree) === 2)
  yield* Expect.toBeAttached(frame.locator(selector).first)
})

/** The error of an action that Playwright's test expects to fail (its `.catch(e => e)`); one that succeeds fails. */
const failure = Effect.fnUntraced(function*(effect: Effect.Effect<unknown, unknown>) {
  const result = yield* Effect.result(effect)
  assert(Result.isFailure(result), "the action succeeded, where Playwright's test expects it to fail")
  return result.failure
})

/** The reason a timed-out action last observed, as Strider records it. */
type Reason = { readonly _tag: string }

const reasonOf = (timeout: Deadline.Timeout): Reason | undefined =>
  Option.getOrUndefined(Option.map(timeout.last, (observed) => observed.value as Reason))

/** Playwright's `Timeout <budget>ms exceeded`, as a `Timeout` with that budget. */
const timedOut = (error: unknown, budget: number): Deadline.Timeout => {
  assert(Deadline.isTimeout(error), String(error))
  // Strider's budget counts from when the action starts: the timeout less the moments before then
  assert.isAtMost(Duration.toMillis(error.budget), budget)
  assert.isAbove(Duration.toMillis(error.budget), budget - 500)
  return error
}

upstream(import.meta.filename, {}, (test) => {
  test("LO-001", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", clickable)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* frame.getByRole("button", { name: "Click me" }).click()
      assert.strictEqual(yield* clicked(page, "iframe"), true)
    }))

  test("LO-004", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<button>one</button><button>two</button>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* waitForFrame(page, frame, "button")
      const error = yield* failure(frame.locator("button").click().pipe(Deadline.within("3 seconds")))
      assert(Locator.isLocatorError(error), String(error))
      assert.strictEqual(error.operation, "Locator.click")
      assert(error.reason._tag === "StrictViolation", String(error.reason))
      assert.strictEqual(error.reason.candidates.length, 2)
      assert.include(error.reason.hint, "an action needs exactly one")
      assert.include(error.locator, "button")
    }))

  test("LO-005", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<div>Nothing here</div>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      const error = yield* failure(frame.locator("button").click().pipe(Deadline.within("1 second")))
      const timeout = timedOut(error, 1000)
      assert.strictEqual(timeout.operation, "Locator.click")
      assert.strictEqual(reasonOf(timeout)?._tag, "NoMatch")
    }))

  test("LO-006", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<div>1</div><div>2</div><div>3</div>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* waitForFrame(page, frame, "div")
      assert.strictEqual(yield* frame.locator("div").count, 3)
      assert.strictEqual(yield* frame.locator("button").count, 0)
    }))

  test("LO-008", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<span>one</span><span>two</span>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* Expect.toHaveCount(frame.locator("span"), 2)
      yield* Expect.toHaveCount(frame.locator("button"), 0)
    }))

  test("LO-009", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<div>No frames yet</div>`)
      routePage(server, "a.html", `<span>one</span><span>two</span>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        window.setTimeout(() => {
          const iframe = document.createElement("iframe")
          iframe.src = "a.html"
          document.body.appendChild(iframe)
        }, 500)
      })
      // The frame is named before it exists: a frame locator is lazy, so the expectation waits for it
      const frame = page.frame(page.locator("iframe"))
      yield* Expect.toHaveCount(frame.locator("span"), 2)
    }))

  test("LO-011", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<div>Hello iframe</div>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* Expect.toHaveText(frame.locator("div"), "Hello iframe")
    }))

  test("LO-012", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<span>one</span><span>two</span>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* Expect.toHaveText(frame.locator("span"), ["one", "two"])
    }))

  test("LO-015", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<div>one</div><div>two</div>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* waitForFrame(page, frame, "div")
      // Expect waits for exactly one match and fails at its deadline with the count it saw, rather than at once
      const error = yield* failure(
        Expect.toHaveText(frame.locator("div"), "one").pipe(Deadline.within("3 seconds"))
      )
      assert(Expect.isExpectationFailed(error), String(error))
      assert.deepStrictEqual(Option.getOrUndefined(error.last)?.value, { matches: 2 })
    }))

  test("LO-016", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<div data-foo="bar">Hello</div>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      assert.strictEqual(yield* frame.locator("div").evaluate((element) => element.getAttribute("data-foo")), "bar")
    }))

  test("LO-018", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<div>Nothing here</div>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      const error = yield* failure(
        frame.locator("button").evaluate((element) => element.textContent).pipe(Deadline.within("1 second"))
      )
      const timeout = timedOut(error, 1000)
      assert.strictEqual(reasonOf(timeout)?._tag, "NoMatch")
    }))

  test("LO-019", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<span>one</span><span>two</span>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* waitForFrame(page, frame, "span")
      assert.deepStrictEqual(
        yield* frame.locator("span").evaluateAll((elements) => elements.map((element) => element.textContent)),
        ["one", "two"]
      )
      assert.strictEqual(yield* frame.locator("button").evaluateAll((elements) => elements.length), 0)
    }))

  test("LO-021", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<div>foo</div><div>bar</div>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* Expect.toHaveText(frame.locator("div").filter({ hasText: "bar" }), "bar")
    }))

  test("LO-022", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<span>one</span><span>two</span><span>three</span>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* waitForFrame(page, frame, "span")
      yield* Expect.toHaveText(frame.locator("span").first, "one")
      yield* Expect.toHaveText(frame.locator("span").last, "three")
      yield* Expect.toHaveText(frame.locator("span").nth(1), "two")
    }))

  test("LO-023", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<div><span>one</span></div><div><span>two</span></div>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      yield* Expect.toHaveText(frame.locator("div").nth(1).locator("span"), "two")
    }))

  test("LO-024", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<div><span>foo</span></div><div><i>bar</i></div>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      // The filter's relative locator is in the frame, where the original's `page.locator("span")` is
      yield* Expect.toHaveText(
        frame.locator("div").filter({ has: Locator.relative.locator("span") }),
        "foo"
      )
    }))

  test("LO-025", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<div id="target"><span>hello</span></div>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      // `*css=div >> span` captures the div that has the span
      yield* Expect.toHaveAttribute(
        frame.locator("div").filter({ has: Locator.relative.locator("span") }),
        "id",
        "target"
      )
    }))

  test("LO-032", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe><button>main</button>`)
      routePage(server, "a.html", `<iframe id="target" src="b.html"></iframe><button>decoy</button>`)
      routePage(server, "b.html", `<button>inside</button>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const outer = page.frame(page.locator("iframe"))
      yield* Expect.toHaveText(outer.frame(outer.locator("#target")).locator("button"), "inside")
    }))

  test("LO-033", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<iframe id="target" src="b.html"></iframe><button>Click me</button>`)
      routePage(server, "b.html", clickable)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const outer = page.frame(page.locator("iframe"))
      const inner = outer.frame(outer.locator("#target"))
      yield* inner.getByRole("button", { name: "Click me" }).click()
      assert.strictEqual(yield* clicked(page, "iframe", "#target"), true)
    }))

  test("LO-034", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe id="target" src="a.html"></iframe><button>main</button>`)
      routePage(server, "a.html", `<iframe src="b.html"></iframe>`)
      routePage(server, "b.html", `<button>deep</button>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.frames.waitFor((tree) => frameTotal(tree) === 3)
      // The entered frame itself has no button, and its nested frame's isn't looked at
      yield* Expect.toHaveCount(page.frame(page.locator("#target")).locator("button"), 0)
    }))

  test("LO-035", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<iframe id="x" src="b.html"></iframe>`)
      routePage(server, "b.html", `<iframe id="y" src="c.html"></iframe><button>decoy</button>`)
      routePage(server, "c.html", `<button>bottom</button>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const outer = page.frame(page.locator("iframe"))
      const x = outer.frame(outer.locator("#x"))
      const y = x.frame(x.locator("#y"))
      yield* Expect.toHaveText(y.locator("button"), "bottom")
    }))

  test("LO-036", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<section><iframe src="b.html"></iframe></section><iframe src="c.html"></iframe>`)
      routePage(server, "b.html", `<button>in-section</button>`)
      routePage(server, "c.html", `<button>outside</button>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const outer = page.frame(page.locator("iframe"))
      const section = outer.locator("section")
      yield* Expect.toHaveText(section.frame(section.locator("iframe")).locator("button"), "in-section")
    }))

  test("LO-037", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<iframe id="target" src="b.html"></iframe>`)
      routePage(server, "b.html", `<button>inside</button>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const outer = page.frame(page.locator("iframe"))
      const inner = outer.frame(outer.locator("#target"))
      assert.deepStrictEqual(yield* inner.owner.readAttribute("id"), Option.some("target"))
    }))

  test("LO-038", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<div>Nothing yet</div>`)
      routePage(server, "b.html", `<button>late</button>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.frames.waitFor((tree) => frameTotal(tree) === 2)
      // The original runs this in the frame's main world; the main world reaches the same-origin frame's window
      yield* page.evaluateInMainWorld(() => {
        const frame = document.querySelector("iframe")!.contentWindow!
        frame.setTimeout(() => {
          const iframe = frame.document.createElement("iframe")
          iframe.id = "late"
          iframe.src = "b.html"
          frame.document.body.appendChild(iframe)
        }, 3000)
      })
      const outer = page.frame(page.locator("iframe"))
      yield* Expect.toHaveText(outer.frame(outer.locator("#late")).locator("button"), "late")
    }))

  test("LO-040", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html"></iframe>`)
      routePage(server, "a.html", `<iframe id="target" src="b.html"></iframe><button>decoy</button>`)
      routePage(server, "b.html", `<button>inside</button>`)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const outer = page.frame(page.locator("iframe"))
      // Strider's frame entered by its element is Playwright's contentFrame()
      yield* Expect.toHaveText(outer.frame(outer.locator("#target")).locator("button"), "inside")
    }))

  test("LO-051", ({ page, server }) =>
    Effect.gen(function*() {
      routePage(server, "empty.html", `<iframe src="a.html" style="visibility: hidden"></iframe>`)
      routePage(server, "a.html", clickable)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = page.frame(page.locator("iframe"))
      const button = frame.locator("button")
      yield* Expect.toBeAttached(button)
      assert.strictEqual(yield* button.isVisible, false)
      yield* Expect.toBeHidden(button)

      // The original's message is "element is inside a hidden frame, retrying"; Strider's reason is `NotVisible`
      const error = yield* failure(button.click().pipe(Deadline.within("1 second")))
      const timeout = timedOut(error, 1000)
      assert.strictEqual(reasonOf(timeout)?._tag, "NotVisible")
      assert.isUndefined(yield* clicked(page, "iframe"))

      yield* page.evaluateInMainWorld(() => {
        document.querySelector("iframe")!.style.visibility = "visible"
      })
      yield* Expect.toBeVisible(button)
      yield* button.click()
      assert.strictEqual(yield* clicked(page, "iframe"), true)
    }))
})
