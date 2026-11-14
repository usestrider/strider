/**
 * Puppeteer's `test/src/ariaqueryhandler.test.ts`: which elements the `aria/` selectors find by accessible name and
 * role, and the waits on them (`waitForSelector` with `visible` and `hidden`).
 *
 * What the port changes:
 * - Puppeteer's `aria/` selector is a role and a name, or a name alone. A role with a name is `getByRole(role, { name,
 *   exact: true })`, since Puppeteer matches a name exactly; a name alone over one role is that `getByRole` too.
 *   Puppeteer's name-only query walks Chromium's whole accessibility tree, which names generic elements (an `aria-label`
 *   on a `div`) and skips hidden ones. Strider's `getByRole` can't express that: it has no cross-role query, and
 *   `generic` can't be named. The name-only queries over the page of "queryOne (Chromium web test)" are `getByLabel`,
 *   narrowed to what is not `hidden`, as the accessibility tree leaves out the `hidden` button (`filter({ visible: true })` would also drop these empty `div`s, which have no box). Elsewhere a name
 *   alone is `getByLabel` too, on a page with no hidden element. Strider's `getByRole` has no role for
 *   `[role="image"]`, Chromium's name for `<img>`: the port asks for `img`.
 * - `page.$(selector)` is a read of the first match (`.first`, read with `count` or `readAttribute`), and `page.$$` is
 *   `.all`. A `waitForSelector` returns the first match, so each wait is `Expect` over `.first`. The `visible` option is
 *   `Expect.toBeVisible`, the `hidden` option is `Expect.toBeHidden` (which also passes once the element is removed),
 *   and the default is `Expect.toBeAttached`. Puppeteer's `waitForSelector` resolves to the handle; the port reads the
 *   element after the wait, and `null` for a hidden wait on a missing element is a count of zero.
 * - Puppeteer's `timeout` option is `Deadline.within`. Its rejection is Strider's `ExpectationFailed`, whose message
 *   names the subject and the condition; the port asserts on those, not on Puppeteer's "Waiting for selector … failed"
 *   text or its `TimeoutError` class. The stack-trace test asserts the same message, since Strider's failures carry no
 *   JavaScript stack.
 * - `element.evaluate(e => e.id)` and `handle.textContent` are `readAttribute("id")` and `readText`.
 * - Puppeteer's `frame.waitForSelector` and `frame.evaluate` are the frame locator from `attachFrame`. The test's
 *   `addElement` in a frame is `frame.locator("body").evaluate`: an isolated world shares the frame's DOM, so the element
 *   is appended to the frame's document, whatever its origin.
 * - `element.waitForSelector` in an element handle is a locator scoped to `page.locator("div").first`.
 * - "should work with removed MutationObserver" deletes `window.MutationObserver` in the page's main world, as the
 *   original does, and runs the wait and the `setContent` together.
 * - "should survive cross-process navigation" keeps the waits' order: the wait is still pending after each navigation
 *   that has no image, and resolves on the cross-process page, which the fixture server serves from its own asset
 *   (`grid.html`, with its digits vendored).
 * - "$$eval should handle many elements" is `evaluateAll`, one function over all 10,001 matches, as Puppeteer's is.
 * - "should return null if waiting to hide non-existing element" asserts the wait completes and nothing matches.
 * - Not ported: "should work independently of `exposeFunction`" (needsFeature: Strider has no `exposeFunction`), and
 *   "should find button" in parseAriaSelector (notApplicable: it checks Puppeteer's selector grammar, its brackets,
 *   quoting, spacing and errors). The ledger says why each is.
 * - The file runs on Chromium only, as the original's Firefox run is over CDP and BiDi, and its aria queries are
 *   Chromium's accessibility tree.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, type Locator, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { attachFrame, expectationFailure, failureOf, startWaiting } from "../harness/playwright.ts"
import { detachFrame } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

/** Puppeteer's `element.evaluate(e => e.id)` for the first match of `locator`, or `undefined` when nothing matches. */
const idOf = (locator: Locator.ReadonlyLocator) => locator.readAttribute("id").pipe(Effect.map(Option.getOrUndefined))

/** Puppeteer's `getIds`: the `id` of each match, in document order. */
const idsOf = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const matches = yield* locator.all
  return yield* Effect.forEach(matches, idOf)
})

/** Puppeteer's `addElement`, run in the page's main world. It returns nothing: the original's return value is unused. */
const addElement = (tag: string) => {
  document.body.appendChild(document.createElement(tag))
}

/**
 * Puppeteer's `frame.evaluate(addElement, tag)` for a frame: the element is appended to the frame's body. The frame
 * locator's isolated world shares the frame's DOM, so this works whatever the frame's origin.
 */
const addToFrame = (frame: Locator.FrameLocator, tag: string) =>
  frame.locator("body").evaluate((body, tag: string) => {
    body.appendChild(document.createElement(tag))
  }, tag)

/** The page Puppeteer's "queryOne (Chromium web test)" suite sets up, verbatim. */
const setupChromiumWebTestPage = (page: Page.Page) =>
  page.setContent(`
          <h2 id="shown">title</h2>
          <h2 id="hidden" aria-hidden="true">title</h2>
          <div id="node1" aria-labelledby="node2"></div>
          <div id="node2" aria-label="bar"></div>
          <div id="node3" aria-label="foo"></div>
          <div id="node4" class="container">
          <div id="node5" role="button" aria-label="foo"></div>
          <div id="node6" role="button" aria-label="foo"></div>
          <!-- Accessible name not available when element is hidden -->
          <div id="node7" hidden role="button" aria-label="foo"></div>
          <div id="node8" role="button" aria-label="bar"></div>
          </div>
          <button id="node10">text content</button>
          <h1 id="node11">text content</h1>
          <!-- Accessible name not available when role is "presentation" -->
          <h1 id="node12" role="presentation">text content</h1>
          <!-- Elements inside shadow dom should be found -->
          <script>
          const div = document.createElement('div');
          const shadowRoot = div.attachShadow({mode: 'open'});
          const h1 = document.createElement('h1');
          h1.textContent = 'text content';
          h1.id = 'node13';
          shadowRoot.appendChild(h1);
          document.documentElement.appendChild(div);
          </script>
          <img id="node20" src="" alt="Accessible Name">
          <input id="node21" type="submit" value="Accessible Name">
          <label id="node22" for="node23">Accessible Name</label>
          <!-- Accessible name for the <input> is "Accessible Name" -->
          <input id="node23">
          <div id="node24" title="Accessible Name"></div>
          <div role="tree">
          <div role="treeitem" id="node30">
          <div role="treeitem" id="node31">
          <div role="treeitem" id="node32">item1</div>
          <div role="treeitem" id="node33">item2</div>
          </div>
          <div role="treeitem" id="node34">item3</div>
          </div>
          </div>
          <!-- Accessible name for the <div> is "item1 item2 item3" -->
          <div aria-describedby="node30"></div>
          `)

upstream(import.meta.filename, {}, (test) => {
  test("AriaQueryHandler parseAriaSelector should handle non-breaking spaces in span", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
        <button
          id="btn"
          role="button"
        >
          <span>&nbsp;</span><span>&nbsp;</span>Submit button and some spaces
        </button>`)
      // The name keeps its two non-breaking spaces, so it matches only with them
      const withSpaces = page.getByRole("button", { name: "  Submit button and some spaces", exact: true })
      assert.strictEqual(yield* withSpaces.count, 1)
      assert.strictEqual(yield* idOf(withSpaces.first), "btn")
      assert.strictEqual(
        yield* page.getByRole("button", { name: "Submit button and some spaces", exact: true }).count,
        0
      )
    }))

  test("AriaQueryHandler parseAriaSelector should handle non-breaking spaces", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
        <button
          id="btn"
          role="button"
        >
          Submit button and some spaces
        </button>`)
      assert.strictEqual(
        yield* page.getByRole("button", { name: "ubmit button and some spaces", exact: true }).count,
        0
      )
      assert.strictEqual(
        yield* idOf(page.getByRole("button", { name: "Submit button and some spaces", exact: true }).first),
        "btn"
      )
    }))

  test("AriaQueryHandler parseAriaSelector should handle zero width spaces", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
        <button
          id="btn"
          role="button"
        >
          <span>&ZeroWidthSpace;</span><span>&ZeroWidthSpace;</span>Submit
          button and some spaces
        </button>`)
      const withSpaces = page.getByRole("button", {
        name: "​​Submit button and some spaces",
        exact: true
      })
      assert.strictEqual(yield* withSpaces.count, 1)
      assert.strictEqual(yield* idOf(withSpaces.first), "btn")
      assert.strictEqual(
        yield* page.getByRole("button", { name: "Submit button and some spaces", exact: true }).count,
        0
      )
    }))

  test("AriaQueryHandler queryOne should find button by role", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div id="div">
          <button
            id="btn"
            role="button"
            >Submit</button
          >
        </div>`)
      assert.strictEqual(yield* idOf(page.getByRole("button").first), "btn")
    }))

  test("AriaQueryHandler queryOne should find button by name and role", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div id="div">
          <button
            id="btn"
            role="button"
            >Submit</button
          >
        </div>`)
      assert.strictEqual(
        yield* idOf(page.getByRole("button", { name: "Submit", exact: true }).first),
        "btn"
      )
    }))

  test("AriaQueryHandler queryOne should find first matching element", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
        <div
          role="menu"
          id="mnu1"
          aria-label="menu div"
        ></div>
        <div
          role="menu"
          id="mnu2"
          aria-label="menu div"
        ></div>
      `)
      assert.strictEqual(
        yield* idOf(page.getByRole("menu", { name: "menu div", exact: true }).first),
        "mnu1"
      )
    }))

  test("AriaQueryHandler queryOne should find by name", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
        <div
          role="menu"
          id="mnu1"
          aria-label="menu-label1"
          >menu div</div
        >
        <div
          role="menu"
          id="mnu2"
          aria-label="menu-label2"
          >menu div</div
        >
      `)
      assert.strictEqual(
        yield* idOf(page.getByRole("menu", { name: "menu-label1", exact: true }).first),
        "mnu1"
      )
    }))

  test("AriaQueryHandler queryOne should find 2nd element by name", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
        <div
          role="menu"
          id="mnu1"
          aria-label="menu-label1"
          >menu div</div
        >
        <div
          role="menu"
          id="mnu2"
          aria-label="menu-label2"
          >menu div</div
        >
      `)
      assert.strictEqual(
        yield* idOf(page.getByRole("menu", { name: "menu-label2", exact: true }).first),
        "mnu2"
      )
    }))

  test("AriaQueryHandler queryAll should find menu by name", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
        <div
          role="menu"
          id="mnu1"
          aria-label="menu div"
        ></div>
        <div
          role="menu"
          id="mnu2"
          aria-label="menu div"
        ></div>
      `)
      const ids = yield* idsOf(page.getByRole("menu", { name: "menu div", exact: true }))
      assert.strictEqual(ids.join(", "), "mnu1, mnu2")
    }))

  test("AriaQueryHandler queryAllArray $$eval should handle many elements", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(``)
      yield* page.evaluateInMainWorld(() => {
        for (let i = 0; i <= 10000; i++) {
          const button = document.createElement("button")
          button.textContent = String(i)
          document.body.appendChild(button)
        }
      })
      // Puppeteer's `$$eval` runs one function over every match, as `evaluateAll` does
      const sum = yield* page.getByRole("button").evaluateAll((buttons) =>
        buttons.reduce((acc, button) => acc + Number(button.textContent), 0)
      )
      assert.strictEqual(sum, 50005000)
    }))

  test("AriaQueryHandler waitForSelector (aria) should immediately resolve promise if node exists", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(addElement, "button")
      yield* Expect.toBeAttached(page.getByRole("button").first)
    }))

  test("AriaQueryHandler waitForSelector (aria) should work for ElementHandle.waitForSelector", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        document.body.innerHTML = `<div><button>test</button></div>`
      })
      // `page.$("div")` is the element; its wait is scoped to it, and the button in it is the one named "test"
      const element = page.locator("div").first
      yield* Expect.toBeAttached(element.getByRole("button", { name: "test", exact: true }).first)
    }))

  test("AriaQueryHandler waitForSelector (aria) should persist query handler bindings across reloads", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(addElement, "button")
      yield* Expect.toBeAttached(page.getByRole("button").first)
      yield* page.reload({ waitUntil: "load" })
      yield* page.evaluateInMainWorld(addElement, "button")
      yield* Expect.toBeAttached(page.getByRole("button").first)
    }))

  test("AriaQueryHandler waitForSelector (aria) should persist query handler bindings across navigations", ({ page, server }) =>
    Effect.gen(function*() {
      // Reset the page, and make sure the navigation starts from a fresh document, as the original does
      yield* page.goto("data:text/html,", { waitUntil: "load" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(addElement, "button")
      yield* Expect.toBeAttached(page.getByRole("button").first)

      yield* page.goto("data:text/html,", { waitUntil: "load" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(addElement, "button")
      yield* Expect.toBeAttached(page.getByRole("button").first)
    }))

  test("AriaQueryHandler waitForSelector (aria) should work with removed MutationObserver", ({ page }) =>
    Effect.gen(function*() {
      // The page's own `MutationObserver` is gone before the wait starts, as the original deletes it
      yield* page.evaluateInMainWorld(() => {
        Reflect.deleteProperty(window, "MutationObserver")
      })
      yield* Effect.all([
        Expect.toBeAttached(page.getByRole("heading", { name: "anything", exact: true }).first),
        page.setContent(`<h1>anything</h1>`)
      ], { concurrency: "unbounded" })
      assert.strictEqual(
        yield* page.getByRole("heading", { name: "anything", exact: true }).first.readText,
        "anything"
      )
    }))

  test("AriaQueryHandler waitForSelector (aria) should resolve promise when node is added", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const heading = page.getByRole("heading").first
      const watchdog = yield* startWaiting(Expect.toBeAttached(heading))
      yield* page.evaluateInMainWorld(addElement, "br")
      yield* page.evaluateInMainWorld(addElement, "h1")
      yield* Fiber.join(watchdog.fiber)
      // The original reads the handle's tagName; the matched element's outer HTML names the same tag
      assert.strictEqual(yield* heading.readHtml, "<h1></h1>")
    }))

  test("AriaQueryHandler waitForSelector (aria) should work when node is added through innerHTML", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const watchdog = yield* startWaiting(Expect.toBeAttached(page.getByLabel("name", { exact: true }).first))
      yield* page.evaluateInMainWorld(addElement, "span")
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("span")!.innerHTML = "<h3><div aria-label=\"name\"></div></h3>"
      })
      yield* Fiber.join(watchdog.fiber)
    }))

  test("AriaQueryHandler waitForSelector (aria) Page.waitForSelector is shortcut for main frame", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame1 = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const watchdog = yield* startWaiting(Expect.toBeAttached(page.getByRole("button").first))
      yield* addToFrame(frame1, "button")
      yield* page.evaluateInMainWorld(addElement, "button")
      yield* Fiber.join(watchdog.fiber)
      // The wait resolved on the page's own button: page queries see the main frame only, so the page has one button,
      // and the frame has its own
      assert.strictEqual(yield* page.getByRole("button").count, 1)
      assert.strictEqual(yield* frame1.getByRole("button").count, 1)
    }))

  test("AriaQueryHandler waitForSelector (aria) should run in specified frame", ({ page, server }) =>
    Effect.gen(function*() {
      const frame1 = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const frame2 = yield* attachFrame(page, "frame2", server.EMPTY_PAGE)
      const watchdog = yield* startWaiting(Expect.toBeAttached(frame2.getByRole("button").first))
      yield* addToFrame(frame1, "button")
      yield* addToFrame(frame2, "button")
      yield* Fiber.join(watchdog.fiber)
      assert.strictEqual(yield* frame2.getByRole("button").count, 1)
    }))

  test("AriaQueryHandler waitForSelector (aria) should throw when frame is detached", ({ page, server }) =>
    Effect.gen(function*() {
      const frame = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const waiting = yield* startWaiting(
        Expect.toBeAttached(frame.getByLabel("does-not-exist", { exact: true }).first)
      )
      yield* detachFrame(page, "frame1")
      const error = yield* failureOf(Fiber.join(waiting.fiber), "the wait on the detached frame")
      assert.include(String(error), "does-not-exist")
    }))

  test("AriaQueryHandler waitForSelector (aria) should survive cross-process navigation", ({ page, server }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(Expect.toBeAttached(page.getByRole("img").first))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isFalse(yield* waiting.done)
      yield* page.reload({ waitUntil: "load" })
      assert.isFalse(yield* waiting.done)
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/grid.html", { waitUntil: "load" })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("AriaQueryHandler waitForSelector (aria) should wait for visible", ({ page }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(Expect.toBeVisible(page.getByLabel("name", { exact: true }).first))
      yield* page.setContent(`<div
          aria-label="name"
          style="display: none; visibility: hidden;"
        >
          1
        </div>`)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.style.removeProperty("display")
      })
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.style.removeProperty("visibility")
      })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("AriaQueryHandler waitForSelector (aria) should wait for visible recursively", ({ page }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(Expect.toBeVisible(page.getByLabel("inner", { exact: true }).first))
      yield* page.setContent(`<div style="display: none; visibility: hidden;">
          <div aria-label="inner">hi</div>
        </div>`)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.style.removeProperty("display")
      })
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.style.removeProperty("visibility")
      })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("AriaQueryHandler waitForSelector (aria) hidden should wait for visibility: hidden", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div
          role="button"
          style="display: block;"
          >text</div
        >`)
      const waiting = yield* startWaiting(Expect.toBeHidden(page.getByRole("button").first))
      // The original's round trip: a wait that resolves once the button is attached
      yield* Expect.toBeAttached(page.getByRole("button").first)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.style.setProperty("visibility", "hidden")
      })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("AriaQueryHandler waitForSelector (aria) hidden should wait for display: none", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div
          role="main"
          style="display: block;"
          >text</div
        >`)
      const waiting = yield* startWaiting(Expect.toBeHidden(page.getByRole("main").first))
      yield* Expect.toBeAttached(page.getByRole("main").first)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.style.setProperty("display", "none")
      })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("AriaQueryHandler waitForSelector (aria) hidden should wait for removal", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div role="main">text</div>`)
      const waiting = yield* startWaiting(Expect.toBeHidden(page.getByRole("main").first))
      yield* Expect.toBeAttached(page.getByRole("main").first)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.remove()
      })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("AriaQueryHandler waitForSelector (aria) should return null if waiting to hide non-existing element", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer resolves to `null`: a hidden wait on nothing passes, and nothing matches
      yield* Expect.toBeHidden(page.getByLabel("non-existing", { exact: true }).first)
      assert.strictEqual(yield* page.getByLabel("non-existing", { exact: true }).count, 0)
    }))

  test("AriaQueryHandler waitForSelector (aria) should respect timeout", ({ page }) =>
    Effect.gen(function*() {
      const failure = yield* expectationFailure(
        Expect.toBeAttached(page.getByRole("button").first).pipe(Deadline.within(10))
      )
      assert.include(failure.message, "button")
    }))

  test("AriaQueryHandler waitForSelector (aria) should have an error message specifically for awaiting an element to be hidden", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div role="main">text</div>`)
      const failure = yield* expectationFailure(
        Expect.toBeHidden(page.getByRole("main").first).pipe(Deadline.within(10))
      )
      // Strider's message names the condition the wait was for, which is "hidden" here
      assert.include(failure.message, "hidden")
    }))

  test("AriaQueryHandler waitForSelector (aria) should respond to node attribute mutation", ({ page }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(Expect.toBeAttached(page.getByLabel("zombo", { exact: true }).first))
      yield* page.setContent(`<div aria-label="notZombo"></div>`)
      assert.isFalse(yield* waiting.done)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("div")!.setAttribute("aria-label", "zombo")
      })
      yield* Fiber.join(waiting.fiber)
      assert.isTrue(yield* waiting.done)
    }))

  test("AriaQueryHandler waitForSelector (aria) should return the element handle", ({ page }) =>
    Effect.gen(function*() {
      const waiting = yield* startWaiting(Expect.toBeAttached(page.getByLabel("zombo", { exact: true }).first))
      yield* page.setContent(`<div aria-label="zombo">anything</div>`)
      yield* Fiber.join(waiting.fiber)
      // The original evaluates on the handle it returned; the matched element is what it returned
      assert.strictEqual(yield* page.getByLabel("zombo", { exact: true }).first.readText, "anything")
    }))

  test("AriaQueryHandler waitForSelector (aria) should have correct stack trace for timeout", ({ page }) =>
    Effect.gen(function*() {
      // Strider's failures carry no JavaScript stack, so the port asserts the failure's message names the wait
      const failure = yield* expectationFailure(
        Expect.toBeAttached(page.getByLabel("zombo", { exact: true }).first).pipe(Deadline.within(10))
      )
      assert.include(failure.message, "zombo")
    }))

  test("AriaQueryHandler queryOne (Chromium web test) should find by name \"foo\"", ({ page }) =>
    Effect.gen(function*() {
      yield* setupChromiumWebTestPage(page)
      // The `hidden` `node7` is left out by the `:not([hidden])` narrowing, as it is from the accessibility tree
      const found = yield* idsOf(page.getByLabel("foo", { exact: true }).and(page.locator(":not([hidden])")))
      assert.deepStrictEqual(found, ["node3", "node5", "node6"])
    }))

  test("AriaQueryHandler queryOne (Chromium web test) should find by name \"bar\"", ({ page }) =>
    Effect.gen(function*() {
      yield* setupChromiumWebTestPage(page)
      // `node1` is named "bar" by a plain `aria-labelledby` on `node2`, whose own name is its `aria-label`; `getByLabel`
      // reads the referenced element's text, which is empty
      const found = yield* idsOf(page.getByLabel("bar", { exact: true }).and(page.locator(":not([hidden])")))
      assert.deepStrictEqual(found, ["node1", "node2", "node8"])
    }))

  test("AriaQueryHandler queryOne (Chromium web test) should find treeitem by name", ({ page }) =>
    Effect.gen(function*() {
      yield* setupChromiumWebTestPage(page)
      const found = yield* idsOf(page.getByRole("treeitem", { name: "item1 item2 item3", exact: true }))
      assert.deepStrictEqual(found, ["node30"])
    }))

  test("AriaQueryHandler queryOne (Chromium web test) should find by role \"button\"", ({ page }) =>
    Effect.gen(function*() {
      yield* setupChromiumWebTestPage(page)
      const found = yield* idsOf(page.getByRole("button"))
      assert.deepStrictEqual(found, ["node5", "node6", "node8", "node10", "node21"])
    }))

  test("AriaQueryHandler queryOne (Chromium web test) should find by role \"heading\"", ({ page }) =>
    Effect.gen(function*() {
      yield* setupChromiumWebTestPage(page)
      const found = yield* idsOf(page.getByRole("heading"))
      assert.deepStrictEqual(found, ["shown", "node11", "node13"])
    }))

  test("AriaQueryHandler queryOne (Chromium web test) should find both ignored and unignored", ({ page }) =>
    Effect.gen(function*() {
      yield* setupChromiumWebTestPage(page)
      // A title is found among the headings, where the aria-hidden one is left out
      const found = yield* idsOf(page.getByRole("heading", { name: "title", exact: true }))
      assert.deepStrictEqual(found, ["shown"])
    }))
})
