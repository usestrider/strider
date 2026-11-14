/**
 * Playwright's `tests/library/browsercontext-pages.spec.ts`: a context's pages as they open and close, what a page's
 * context is, and the input, emulation, and layout a page gets from its context.
 *
 * What the port changes:
 * - `context.pages()` is the context's `pages` watchable, read for its current value; a page is identified by its `id`.
 * - A page's own context is `page.context`, compared by its `id`.
 * - `page.evaluate` runs in the main world, which is `page.evaluateInMainWorld`. A frame's `frame.evaluate` reads
 *   the frame's own window through its iframe's `contentWindow` in the parent's main world, as the original's
 *   `attachFrame` helper does.
 * - `page.goto` and `setContent` wait for `load` by default; Strider's `goto` resolves at commit, so the port asks for
 *   `load` where the original's default is it.
 * - `page.click(selector, { position })` is the locator's `click` with `position`. `page.mouse.down()`, `move`, and
 *   `up()` are a held left button, released when its scope ends.
 * - `context.waitForNavigation()` for a click's navigation is `PageNavigation.next(page)`, subscribed before the click.
 * - BC-054, BC-055, BC-056, BC-057, and BC-058 emulate what Firefox or stock WebKit don't support (JavaScript, touch,
 *   a mobile viewport, a device scale factor); they run on every browser and the ledger marks the ones that refuse.
 * - BC-055 passes the context what the original takes from `devices['iPhone 6']`: its viewport, 375×667, and touch. The
 *   original doesn't pass the device's scale factor, mobile flag, or user agent. The device list isn't in the pinned
 *   checkout, so the 375×667 comes from Playwright's published list.
 * - BC-060 is `it.fixme` on Chromium in the original. It runs on every browser here, as the original does on the
 *   others, and Chromium's result is reported.
 * - BC-061's one-second wait is the original's own, for WebKit's selection IPC, ported as written.
 * - BC-059 listens to Node's process warnings, as the original does: Strider's listeners run in the same process.
 * - BC-058's `button.evaluate(...)` changes the element's styles in the main world, through `document.querySelector`.
 */
import { assert } from "@effect/vitest"
import { Browser, Page, PageNavigation, Target } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { attachFrame, failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Whether a list of pages holds this page, by identity. */
const holds = (pages: ReadonlyArray<Page.Page>, page: Page.Page) => pages.some((each) => each.id === page.id)

/** Playwright's `expectCloseTo`: `actual` within 2 pixels of `expected`, as browsers round the CSS conversion differently. */
const expectCloseTo = (expected: number, actual: number) => {
  assert.isAtMost(Math.abs(expected - actual), 2, `expected ${expected}, received ${actual}`)
}

upstream(import.meta.filename, {}, (test) => {
  test("BC-051", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      assert.isTrue(holds(yield* context.pages, page))
      yield* page.close()
      assert.isFalse(holds(yield* context.pages, page))
    })))

  test("BC-052", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      assert.strictEqual(page.context.id, context.id)
    })))

  test("BC-053", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page1 = yield* context.newPage
      const page2 = yield* context.newPage
      for (const page of [page1, page2]) {
        yield* page.setContent(`<button id="foo" onfocus="window.gotFocus=true"></button>`)
        yield* page.locator("#foo").focus()
        assert.isTrue(yield* page.evaluateInMainWorld(() => !!(window as any).gotFocus))
      }
    })))

  test("BC-054", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { javaScript: "disabled" } })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/wrappedlink.html", { waitUntil: "load" })
      // `Promise.all([page.click('a'), page.waitForNavigation()])`: the navigation is subscribed before the click
      const navigated = yield* PageNavigation.next(page)
      yield* page.locator("a").click()
      yield* navigated
      assert.strictEqual(yield* page.url, server.PREFIX + "/wrappedlink.html#clicked")
    })))

  test("BC-055", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      // `const { viewport, hasTouch } = playwright.devices['iPhone 6']`: only its viewport and touch go to the context
      const context = yield* Browser.newContext({
        emulation: {
          viewport: { width: 375, height: 667 },
          touch: true
        }
      })
      const page = yield* context.newPage
      // `page.mouse.down()`, `move`, `up()`: the left button is held for the move, then released
      const held = yield* page.mouse.hold("left")
      yield* page.mouse.move({ x: 100, y: 10 })
      yield* held.release
    })))

  test("BC-056", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 400, height: 400, deviceScaleFactor: 5 } }
      })
      const page = yield* context.newPage
      // The frame's window is read from the main world, which a cross-origin frame's window refuses. So the page first
      // loads the fixture origin, and the frame it attaches is same-origin with the page that reads it. Playwright
      // reads the frame in its own world, which Strider's frame reads don't reach.
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.devicePixelRatio), 5)
      yield* page.setContent(`<div style="width:100px;height:100px">spacer</div>`)
      const frame = yield* attachFrame(page, "button-test", server.PREFIX + "/input/button.html")
      yield* frame.locator("button").click()
      // `frame.evaluate(() => window.result)`, read from the iframe's own window in the main world
      const result = yield* page.evaluateInMainWorld(() =>
        ((document.getElementById("button-test") as HTMLIFrameElement).contentWindow as any).result
      )
      assert.strictEqual(result, "Clicked")
    })))

  test("BC-057", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 400, height: 400, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button")!
        button.style.borderWidth = "8px"
        document.body.style.margin = "0"
      })
      yield* page.locator("button").click({ position: { x: 20, y: 10 } })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).result), "Clicked")
      // Expect 20;10 + 8px of border in each direction. Allow some delta as different
      // browsers round up or down differently during css -> dip -> css conversion.
      expectCloseTo(28, yield* page.evaluateInMainWorld(() => (window as any).pageX))
      expectCloseTo(18, yield* page.evaluateInMainWorld(() => (window as any).pageY))
    })))

  test("BC-058", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 400, height: 400, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button")!
        document.body.style.margin = "0"
        button.style.borderWidth = "0"
        button.style.width = "200px"
        button.style.height = "20px"
        button.style.marginLeft = "17px"
        button.style.marginTop = "23px"
      })
      const box = yield* page.locator("button").boundingBox
      const { x, y, width, height } = Option.getOrThrow(box)
      assert.strictEqual(Math.round(x * 100), 17 * 100)
      assert.strictEqual(Math.round(y * 100), 23 * 100)
      assert.strictEqual(Math.round(width * 100), 200 * 100)
      assert.strictEqual(Math.round(height * 100), 20 * 100)
    })))

  test("BC-059", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      let warning: Error | null = null
      const warningHandler = (w: Error) => {
        warning = w
      }
      process.on("warning", warningHandler)
      yield* Effect.ensuring(
        Effect.gen(function*() {
          const pages = yield* Effect.all(Array.from({ length: 20 }, () => context.newPage), {
            concurrency: "unbounded"
          })
          yield* Effect.all(pages.map((page) => page.goto(server.EMPTY_PAGE, { waitUntil: "load" })), {
            concurrency: "unbounded"
          })
          yield* Effect.all(pages.map((page) => page.close()), { concurrency: "unbounded" })
        }),
        Effect.sync(() => process.off("warning", warningHandler))
      )
      assert.strictEqual(warning, null)
    })))

  test("BC-060", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      // The evaluate never settles on its own, so it only fails once the reload commits. Closing right after that
      // races the commit. Repeat a few times, since whether the close or the commit wins is timing-dependent.
      for (let i = 0; i < 10; i++) {
        const page = yield* context.newPage
        const failure = yield* failureOf(
          page.evaluateInMainWorld(() => {
            location.reload()
            return new Promise(() => {})
          }),
          "the evaluate"
        )
        // `rejects.toThrow(/navigation/)`: the evaluate fails because the page navigated. The reload ends the realm the
        // evaluate ran in, and an evaluation whose realm ended fails with `TargetGone` and `RealmDestroyed`.
        assert(Target.isTargetGone(failure), `the evaluate failed for another reason: ${String(failure)}`)
        assert.strictEqual(failure.reason._tag, "RealmDestroyed")
        yield* page.close()
      }
    })))

  test("BC-061", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page1 = yield* context.newPage
      const page2 = yield* context.newPage
      for (const page of [page1, page2]) {
        yield* page.setContent(`<div id="container">lorem ipsum dolor sit amet</div>`)
        yield* page.evaluateInMainWorld(() => {
          const element = document.getElementById("container") as HTMLDivElement
          const textNode = element.firstChild as Text

          const range = document.createRange()
          range.setStart(textNode, 6)
          range.setEnd(textNode, 11)

          const selection = document.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
        })
      }
      // In WebKit, selection is updated via IPC, give it enough time to take effect. The original waits a second
      // itself, so the port waits as long.
      yield* Effect.sleep("1 second")
      for (const page of [page1, page2]) {
        const range = yield* page.evaluateInMainWorld(() => {
          const selection = document.getSelection()
          const range = selection?.getRangeAt(0)
          return {
            rangeCount: selection?.rangeCount,
            startOffset: range?.startOffset,
            endOffset: range?.endOffset
          }
        })
        assert.deepStrictEqual(range, { rangeCount: 1, startOffset: 6, endOffset: 11 })
      }
    })))
})
