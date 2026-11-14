/**
 * Puppeteer's `test/src/cdp/prerender.test.ts`: navigating to a page Chromium prerendered from speculation rules, by a
 * click, by a locator, through a frame, and with network requests and a viewport.
 *
 * What the port changes:
 * - Puppeteer's `page.waitForNavigation()` and `mainFrame.waitForNavigation()` are `PageNavigation.next`, subscribed
 *   before the click that starts the navigation and awaited with it, as the original's `Promise.all` awaits both. The
 *   frame variants are the page's own navigations: a frame's main document is the page's.
 * - A prerendered page's activation is Strider's `Activated` navigation, which the tests assert on, since it is more
 *   specific than Puppeteer's waits, which resolve on any navigation.
 * - The original's `locator('a').setTimeout(5000).on('action', …)` is the click under `Deadline.within` of five seconds,
 *   with the navigation's wait subscribed before the click, as the `action` listener starts it.
 * - `page.waitForSelector` and `mainFrame.waitForSelector` are locators: the actions wait for their elements.
 * - Puppeteer's `page.evaluate` and `mainFrame.evaluate` run in the page's main world, which is
 *   `page.evaluateInMainWorld`: the prerendered page's own `div` is read there.
 * - `page.mainFrame()` identity is the page's frame tree root id, which Puppeteer's Frame objects keep across a
 *   navigation; the port compares that id before and after.
 * - "can screencast" is not ported: Puppeteer's `page.screencast` takes `scale`, `crop`, and `speed`, which shape the
 *   file it writes, and Strider's `Capability.Video` takes none of them. The ledger names the nearest matrix row.
 * - "with network requests" subscribes with `NetworkRequest.stream` before the first navigation and reads the URLs it
 *   has seen after the last step, as the original's `page.on('request')` listener does.
 * - "can configure viewport for prerendered pages" sets Puppeteer's `page.setViewport` as `page.emulate`'s viewport.
 * - The page loads from the fixture server, and the speculation rules name `target.html` relative to it.
 * - Puppeteer runs this suite on Chromium, which these tests need: the file runs on Chromium only, since Firefox and
 *   stock WebKit have no speculation-rule prerendering to test.
 */
import { assert } from "@effect/vitest"
import { Deadline, NetworkRequest, Page, PageNavigation } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { upstream } from "../../harness/upstream.ts"

const load = { waitUntil: "load" } as const

/** Puppeteer's `page.evaluate` of the prerendered page's `div`, in the main world. */
const divText = (page: Page.Page) =>
  page.evaluateInMainWorld(() => {
    return document.querySelector("div")?.innerText
  })

upstream(import.meta.filename, { browsers: ["chromium"] }, (test) => {
  test("Prerender can navigate to a prerendered page via input", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/prerender/index.html", load)
      yield* page.locator("button").click()

      // Puppeteer's `Promise.all([page.waitForNavigation(), link.click()])`: the wait is subscribed before the click
      const navigated = yield* PageNavigation.next(page)
      const [navigation] = yield* Effect.all([navigated, page.locator("a").click()], { concurrency: "unbounded" })
      assert.strictEqual(yield* divText(page), "true")
      assert.strictEqual(navigation._tag, "Activated")
    }))

  test("Prerender can navigate to a prerendered page via Locator", ({ page, server }) =>
    Effect.gen(function*() {
      // Three times, as the original loops, so each activation starts from a fresh prerender
      for (let i = 0; i < 3; i++) {
        yield* page.goto(server.PREFIX + "/prerender/declarative.html", load)

        // The original's `.on('action')` starts the navigation wait when the click's action begins; subscribing before
        // the click does the same. The click is bounded by the original's five-second locator timeout.
        const navigated = yield* PageNavigation.next(page)
        yield* Deadline.within(page.locator("a").click(), "5 seconds")
        const navigation = yield* navigated
        assert.strictEqual(yield* divText(page), "true")
        assert.strictEqual(navigation._tag, "Activated")
      }
    }))

  test("Prerender can navigate to a prerendered page via Puppeteer", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/prerender/index.html", load)
      yield* page.locator("button").click()

      // A goto is an ordinary navigation, not the prerendered page's activation
      yield* page.goto(server.PREFIX + "/prerender/target.html", load)
      assert.strictEqual(yield* divText(page), "false")
    }))

  test("Prerender via frame can navigate to a prerendered page via input", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/prerender/index.html", load)
      yield* page.locator("button").click()

      // `page.mainFrame()` is the frame tree's root; its id stays the same across the navigation
      const mainFrame = (yield* page.frames).id
      const navigated = yield* PageNavigation.next(page)
      const [navigation] = yield* Effect.all([navigated, page.locator("a").click()], { concurrency: "unbounded" })
      assert.strictEqual(navigation.frame, mainFrame)
      assert.strictEqual((yield* page.frames).id, mainFrame)
      assert.strictEqual(yield* divText(page), "true")
      assert.strictEqual((yield* page.frames).id, mainFrame)
      assert.strictEqual(navigation._tag, "Activated")
    }))

  test("Prerender via frame can navigate to a prerendered page via Puppeteer", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/prerender/index.html", load)
      yield* page.locator("button").click()

      const mainFrame = (yield* page.frames).id
      yield* page.goto(server.PREFIX + "/prerender/target.html", load)
      assert.strictEqual(yield* divText(page), "false")
      assert.strictEqual((yield* page.frames).id, mainFrame)
    }))

  test("Prerender with network requests can receive requests from the prerendered page", ({ page, server }) =>
    Effect.gen(function*() {
      // Puppeteer's `page.on('request')` before the first navigation: the stream is subscribed first
      const urls = yield* Ref.make<ReadonlyArray<string>>([])
      const requests = yield* NetworkRequest.stream(page)
      yield* requests.pipe(
        Stream.runForEach((request) => Ref.update(urls, (seen) => [...seen, String(request.url)])),
        Effect.forkScoped
      )

      yield* page.goto(server.PREFIX + "/prerender/index.html", load)
      yield* page.locator("button").click()
      const mainFrame = (yield* page.frames).id
      const navigated = yield* PageNavigation.next(page)
      const [navigation] = yield* Effect.all([navigated, page.locator("a").click()], { concurrency: "unbounded" })
      assert.strictEqual((yield* page.frames).id, mainFrame)
      assert.strictEqual(yield* divText(page), "true")
      assert.strictEqual((yield* page.frames).id, mainFrame)

      const seen = yield* Ref.get(urls)
      assert.isTrue(seen.some((url) => url.endsWith("prerender/target.html")))
      assert.isTrue(seen.some((url) => url.includes("prerender/index.html")))
      assert.isTrue(seen.some((url) => url.includes("prerender/target.html?fromPrerendered")))
      assert.strictEqual(navigation._tag, "Activated")
    }))

  test("Prerender with emulation can configure viewport for prerendered pages", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 300, height: 400 } })
      yield* page.goto(server.PREFIX + "/prerender/index.html", load)
      yield* page.locator("button").click()
      const navigated = yield* PageNavigation.next(page)
      const [navigation] = yield* Effect.all([navigated, page.locator("a").click()], { concurrency: "unbounded" })

      const result = yield* page.evaluateInMainWorld(() => {
        return {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
          dpr: window.devicePixelRatio
        }
      })
      assert.deepStrictEqual(
        { width: result.width, height: result.height },
        { width: 300 * result.dpr, height: 400 * result.dpr }
      )
      assert.strictEqual(navigation._tag, "Activated")
    }))
})
