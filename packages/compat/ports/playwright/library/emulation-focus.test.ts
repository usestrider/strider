/**
 * Playwright's `tests/library/emulation-focus.spec.ts`: a page that reports focus when the browser window isn't focused,
 * and what focus, keyboard, and mouse input target when several pages are open.
 *
 * What the port changes:
 * - Playwright emulates focus for every page it creates. Strider's focus emulation is `focus: "emulated"`, given to a
 *   context or a page, so each test makes its page or context with it. Strider's focus emulation is Chromium's: Firefox
 *   and WebKit refuse it with `Unsupported` (`emulation.focus`), so the file runs on Chromium, and the ledger records
 *   the other two browsers.
 * - `page.context().newPage()` is `page.context.newPage`, scoped to the test's block so the page closes with it, as the
 *   original's `page2.close()` does.
 * - `page.evaluate(…)` runs in the page's main world, where `document.hasFocus()` and the page's globals are, so it's
 *   `page.evaluateInMainWorld`. A frame's globals are read through its iframe's `contentWindow`, the frame being
 *   same-origin, since Strider's frame locators run in the isolated world.
 * - `page.focus(sel)` is `page.locator(sel).focus()`, `page.keyboard.type` is `page.keyboard.pressSequentially`, and
 *   `page.mouse.click(x, y)` is `page.mouse.click({ x, y })`.
 * - EM-015's `page.waitForEvent("popup")` is `Popup.next`, subscribed before the `window.open` it waits for. The
 *   `window.open` runs as a user gesture (`Page.withUserGesture`), since Strider keeps popup blocking on.
 * - `page.goto(url)` returns at commit in Strider, so each navigation waits for `load`, which is Playwright's default.
 * - EM-019 compares screenshots with Playwright's golden PNGs (`toMatchSnapshot`), which aren't ported (see the ledger).
 * - EM-021 to EM-024 make their pages with `focus: "emulated"` too, as Playwright's `contextFactory` does. Where the
 *   original reads a page's or iframe's own global (`window.gotBlur`), the port reads it in the main world, through the
 *   iframe's `contentWindow` for a frame, the srcdoc frames being same-origin. EM-024 launches a second Chromium for its
 *   third page, as the original's second `browserType.launch()` does; its first browser is the file's.
 */
import { assert } from "@effect/vitest"
import { Browser, Page, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { backend } from "../../harness/browsers.ts"
import { attachFrame } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

const viewport = { width: 1280, height: 720 }

/** A page in a context whose focus is emulated, as Playwright makes each page. */
const emulatedPage = Browser.newPage({ focus: "emulated", emulation: { viewport } })

/** Counts the clicks on the document, as the original's `clickCounter` does. */
function clickCounter() {
  document.onclick = () => {
    const count = Reflect.get(window, "clickCount")
    Reflect.set(window, "clickCount", typeof count === "number" ? count + 1 : 1)
  }
}

/** Records the focus and blur events of the first input in an iframe, in the iframe's own `_events`. */
function frameLogger(id: string) {
  const win = (document.getElementById(id) as HTMLIFrameElement).contentWindow as Window & {
    _events?: Array<string>
  }
  win._events = []
  const element = win.document.querySelector("input")!
  element.onfocus = (event) => win._events!.push(event.type)
  element.onblur = (event) => win._events!.push(event.type)
}

const frameEvents = (page: Page.Page, id: string) =>
  page.evaluateInMainWorld((frameId: string) => {
    const win = (document.getElementById(frameId) as HTMLIFrameElement).contentWindow
    return Reflect.get(win!, "_events")
  }, id)

const frameHasFocus = (page: Page.Page, id: string) =>
  page.evaluateInMainWorld((frameId: string) => {
    return (document.getElementById(frameId) as HTMLIFrameElement).contentWindow!.document.hasFocus()
  }, id)

upstream(import.meta.filename, { browsers: ["chromium"] }, (test) => {
  test("EM-013", { page: false }, () =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      assert.isTrue(yield* page.evaluateInMainWorld(() => document.hasFocus()))
    }))

  test("EM-014", { page: false }, () =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      yield* Effect.scoped(Effect.gen(function*() {
        const page2 = yield* page.context.newPage
        assert.isTrue(yield* page.evaluateInMainWorld(() => document.hasFocus()))
        assert.isTrue(yield* page2.evaluateInMainWorld(() => document.hasFocus()))
      }))
    }))

  test("EM-015", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const popups = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url: string) => {
        window.open(url)
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const popup = yield* popups
      assert.isTrue(yield* popup.evaluateInMainWorld(() => document.hasFocus()))
      assert.isTrue(yield* page.evaluateInMainWorld(() => document.hasFocus()))
    }))

  test("EM-016", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      yield* Effect.scoped(Effect.gen(function*() {
        const page2 = yield* page.context.newPage
        yield* Effect.all([
          page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" }),
          page2.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
        ], { concurrency: "unbounded" })
        yield* Effect.all([page.locator("input").focus(), page2.locator("input").focus()], {
          concurrency: "unbounded"
        })
        const text = "first"
        const text2 = "second"
        yield* Effect.all([
          page.keyboard.pressSequentially(text),
          page2.keyboard.pressSequentially(text2)
        ], { concurrency: "unbounded" })
        const results = yield* Effect.all([
          page.evaluateInMainWorld(() => Reflect.get(window, "result")),
          page2.evaluateInMainWorld(() => Reflect.get(window, "result"))
        ], { concurrency: "unbounded" })
        assert.deepStrictEqual(results, [text, text2])
      }))
    }))

  test("EM-017", { page: false }, () =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      yield* Effect.scoped(Effect.gen(function*() {
        const page2 = yield* page.context.newPage
        yield* Effect.all([
          page.evaluateInMainWorld(clickCounter),
          page2.evaluateInMainWorld(clickCounter),
          page.locator("body").focus(),
          page2.locator("body").focus()
        ], { concurrency: "unbounded" })
        yield* Effect.all([
          page.mouse.click({ x: 1, y: 1 }),
          page2.mouse.click({ x: 1, y: 1 })
        ], { concurrency: "unbounded" })
        const counters = yield* Effect.all([
          page.evaluateInMainWorld(() => Reflect.get(window, "clickCount")),
          page2.evaluateInMainWorld(() => Reflect.get(window, "clickCount"))
        ], { concurrency: "unbounded" })
        assert.deepStrictEqual(counters, [1, 1])
      }))
    }))

  test("EM-018", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      yield* Effect.scoped(Effect.gen(function*() {
        const page2 = yield* page.context.newPage
        yield* Effect.all([
          page.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" }),
          page2.goto(server.PREFIX + "/input/textarea.html", { waitUntil: "load" })
        ], { concurrency: "unbounded" })
        yield* Effect.all([
          page.locator("input").focus(),
          page2.locator("textarea").focus()
        ], { concurrency: "unbounded" })
        const active = yield* Effect.all([
          page.evaluateInMainWorld(() => document.activeElement?.tagName),
          page2.evaluateInMainWorld(() => document.activeElement?.tagName)
        ], { concurrency: "unbounded" })
        assert.deepStrictEqual(active, ["INPUT", "TEXTAREA"])
      }))
    }))

  test("EM-020", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const [frame1, frame2] = yield* Effect.all([
        attachFrame(page, "frame1", server.PREFIX + "/input/textarea.html"),
        attachFrame(page, "frame2", server.PREFIX + "/input/textarea.html")
      ], { concurrency: "unbounded" })
      yield* Effect.all([
        page.evaluateInMainWorld(frameLogger, "frame1"),
        page.evaluateInMainWorld(frameLogger, "frame2")
      ], { concurrency: "unbounded" })
      assert.deepStrictEqual(
        yield* Effect.all([frameHasFocus(page, "frame1"), frameHasFocus(page, "frame2")], {
          concurrency: "unbounded"
        }),
        [false, false]
      )
      {
        yield* frame1.locator("input").focus()
        assert.deepStrictEqual(
          yield* Effect.all([frameEvents(page, "frame1"), frameEvents(page, "frame2")], {
            concurrency: "unbounded"
          }),
          [["focus"], []]
        )
        assert.deepStrictEqual(
          yield* Effect.all([frameHasFocus(page, "frame1"), frameHasFocus(page, "frame2")], {
            concurrency: "unbounded"
          }),
          [true, false]
        )
      }
      {
        yield* frame2.locator("input").focus()
        assert.deepStrictEqual(
          yield* Effect.all([frameEvents(page, "frame1"), frameEvents(page, "frame2")], {
            concurrency: "unbounded"
          }),
          [["focus", "blur"], ["focus"]]
        )
        assert.deepStrictEqual(
          yield* Effect.all([frameHasFocus(page, "frame1"), frameHasFocus(page, "frame2")], {
            concurrency: "unbounded"
          }),
          [false, true]
        )
      }
    }))

  // https://github.com/microsoft/playwright/issues/3476
  test("EM-021", { page: false }, () =>
    Effect.gen(function*() {
      const page1 = yield* emulatedPage
      const page2 = yield* emulatedPage
      const button = `<button id="foo" onfocus="window.gotFocus=true">foo</button>`
      yield* page1.setContent(button)
      yield* page2.setContent(button)
      yield* page1.locator("#foo").focus()
      yield* page2.locator("#foo").focus()
      assert.isTrue(yield* page1.evaluateInMainWorld(() => !!Reflect.get(window, "gotFocus")))
      assert.isTrue(yield* page2.evaluateInMainWorld(() => !!Reflect.get(window, "gotFocus")))
    }))

  // https://github.com/microsoft/playwright/issues/30399
  test("EM-022", { page: false }, () =>
    Effect.gen(function*() {
      const page1 = yield* emulatedPage
      const page2 = yield* emulatedPage
      const button = `<button id="foo" onblur="window.gotBlur=true">foo</button>`
      yield* page1.setContent(button)
      yield* page2.setContent(button)
      yield* page1.locator("#foo").click()
      yield* page2.locator("#foo").click()
      assert.isFalse(yield* page1.evaluateInMainWorld(() => !!Reflect.get(window, "gotBlur")))
      assert.isFalse(yield* page2.evaluateInMainWorld(() => !!Reflect.get(window, "gotBlur")))
    }))

  // https://github.com/microsoft/playwright/issues/42933
  test("EM-023", { page: false }, () =>
    Effect.gen(function*() {
      const page1 = yield* emulatedPage
      const page2 = yield* emulatedPage
      const srcdoc =
        `<button id=foo>foo</button><script>window.addEventListener('blur', () => window.gotBlur = true)</script>`
      yield* page1.setContent(`<iframe srcdoc="${srcdoc}"></iframe><iframe srcdoc="${srcdoc}"></iframe>`)
      yield* page1.frame(page1.locator("iframe").nth(0)).locator("#foo").click()
      yield* page2.setContent(`<p>other page</p>`)
      yield* page2.mouse.click({ x: 10, y: 10 })
      assert.isFalse(
        yield* page1.evaluateInMainWorld(() =>
          !!Reflect.get(document.querySelectorAll("iframe")[0]!.contentWindow!, "gotBlur")
        )
      )
      assert.isTrue(
        yield* page1.evaluateInMainWorld(() => document.querySelectorAll("iframe")[0]!.contentDocument!.hasFocus())
      )
      assert.isFalse(
        yield* page1.evaluateInMainWorld(() => document.querySelectorAll("iframe")[1]!.contentDocument!.hasFocus())
      )
    }))

  // https://github.com/microsoft/playwright/issues/27969
  test("EM-024", { page: false }, () =>
    Effect.gen(function*() {
      const page1 = yield* emulatedPage
      const page2 = yield* page1.context.newPage
      yield* Effect.gen(function*() {
        // The second browser's page, made while it is the one provided
        const page3 = yield* emulatedPage
        const pages = [page1, page2, page3]
        for (const page of pages) {
          yield* page.setContent(`
      <style>
        button { display: none; }
        div:hover button { display: inline };
      </style>
      <div><span>hover me</span><button onclick="window.clicked=1+(window.clicked || 0)">click me</button></div>
    `)
        }
        for (const page of pages) yield* page.locator("span").hover()
        for (const page of pages) yield* page.locator("button").click()
        for (const page of pages) {
          assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "clicked")), 1)
        }
        for (const page of pages) yield* page.locator("button").click()
        for (const page of pages) {
          assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "clicked")), 2)
        }
      }).pipe(Effect.provide(backend("chromium", undefined)))
    }))
})
