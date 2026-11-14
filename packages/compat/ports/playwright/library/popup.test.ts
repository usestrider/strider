/**
 * Playwright's `tests/library/popup.spec.ts`: what a popup inherits from its opener's browser context (user agent,
 * headers, network state, credentials, touch, viewport, routes, init scripts) and what a popup's own page can do.
 *
 * What the port changes:
 * - `context.waitForEvent("page")` for a popup is `Popup.next(page)` on the page that opened it, subscribed before the
 *   action that opens the popup. The popup is read from the wait once the action has run.
 * - A context's settings are Strider's `Browser.newContext` options, and its routes, init scripts, and network state are
 *   `UserContext.route`, `UserContext.addInitScript`, and `UserContext.emulate`, which hold for the scope they're in.
 *   Each test that makes its own context runs in `Effect.scoped`, so the context closes before the test's assertions,
 *   as the original's `context.close()` does.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. A script that opens a popup runs
 *   as a user gesture under Strider's popup blocking (`Page.withUserGesture`); a popup from a real click needs none.
 * - A popup that navigates is waited on until it has committed its address (`committed`), as Playwright's popup event
 *   implies, before the port reads its document or checks what its navigation went through.
 * - Playwright's `popup.waitForLoadState("domcontentloaded")` and `"load"` are the readiness of the popup's document,
 *   waited on its status, as page-wait-for-load-state.test.ts does.
 * - `popup.setViewportSize` is `popup.emulate({ viewport })`, which holds for the popup's scope and confirms the popup's size.
 * - PO-014's `server.setAuth` isn't in the fixture server, so the port answers `/title.html` itself: a 401 without the
 *   original's credentials, and the vendored `title.html` with them.
 * - PO-021's `window.builtins.setInterval` is the page's own `setInterval`, as in page-dialog.test.ts.
 * - PO-027 counts the page's own animation frames with `requestAnimationFrame`, where the original counts Playwright's copy.
 * - PO-024's `popup.evaluate("injected")` is a read of the page's main world, `popup.evaluateInMainWorld`.
 * - PO-028 and PO-029 are `it.fixme` for some browsers in the original. They run on every browser the file covers, as
 *   the original's Firefox and WebKit do; PO-029's fixme on Chromium is the original's own, and its result is reported.
 * - PO-025 and PO-026 aren't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Browser, Page, Popup, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as fs from "node:fs"
import { assetPath } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `waitForLoadState("domcontentloaded")`: the document has parsed, its readiness `interactive` or `complete`. */
const parsed = (status: Page.Status) => status._tag === "Open" && status.document.readiness !== "loading"

/** Playwright's `waitForLoadState()`: the document has finished loading, its readiness `complete`. */
const loaded = (status: Page.Status) => status._tag === "Open" && status.document.readiness === "complete"

/**
 * Playwright reports a popup only once its first navigation has committed (Chromium's `reportAsNew` waits for it), so
 * what a test reads from a popup after `waitForEvent("popup")` is the loaded document. Strider reports a popup as soon
 * as it appears, so the port waits for the committed address the original's event implies.
 */
const committed = (popup: Page.Page, url: string) => popup.url.waitFor((current) => current === url)

/** Playwright's `waitForRafs(page, count)`: `count` animation frames of the page, in its main world. */
const waitForRafs = (page: Page.Page, count: number) =>
  page.evaluateInMainWorld((count) =>
    new Promise<void>((resolve) => {
      let remaining = count
      const onRaf = () => {
        remaining--
        if (remaining === 0) resolve()
        else requestAnimationFrame(onRaf)
      }
      requestAnimationFrame(onRaf)
    }), count)

upstream(import.meta.filename, {}, (test) => {
  test("PO-014", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { userAgent: "hey" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent("<a target=_blank rel=noopener href=\"/popup/popup.html\">link</a>")
      const requested = yield* server.waitForRequest("/popup/popup.html")
      // `context.waitForEvent("page")`: the popup this page opens
      const opened = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/popup/popup.html")
      yield* popup.status.waitFor(parsed)
      const userAgent = yield* popup.evaluateInMainWorld(() => (window as any).initialUserAgent)
      const request = yield* requested
      assert.strictEqual(userAgent, "hey")
      assert.strictEqual(request.headers["user-agent"], "hey")
    })))

  test("PO-015", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent("<a target=_blank rel=noopener href=\"empty.html\">link</a>")
      let intercepted = false
      yield* context.route("**/empty.html", () =>
        Effect.andThen(
          Effect.sync(() => {
            intercepted = true
          }),
          Route.continue
        ))
      const opened = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* opened
      yield* committed(popup, server.EMPTY_PAGE)
      assert.isTrue(intercepted)
    })))

  test("PO-016", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { extraHTTPHeaders: { foo: "bar" } } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const requested = yield* server.waitForRequest("/dummy.html")
      yield* page.evaluateInMainWorld((url) => {
        ;(window as any)._popup = window.open(url)
      }, server.PREFIX + "/dummy.html").pipe(Page.withUserGesture)
      const request = yield* requested
      assert.strictEqual(request.headers["foo"], "bar")
    })))

  test("PO-017", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      yield* context.emulate({ network: "offline" })
      const online = yield* page.evaluateInMainWorld((url) => {
        const win = window.open(url)
        return win?.navigator.onLine
      }, server.PREFIX + "/dummy.html").pipe(Page.withUserGesture)
      assert.strictEqual(online, false)
    })))

  test("PO-018", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      // Playwright's `server.setAuth`: the page asks for Basic credentials, and the vendored title is served once they match
      const expected = "Basic " + Buffer.from("user:pass").toString("base64")
      server.setRoute("/title.html", (req, res) => {
        if (req.headers.authorization !== expected) {
          res.writeHead(401, { "WWW-Authenticate": "Basic realm=\"Secure Area\"" }).end()
          return
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
          .end(fs.readFileSync(assetPath("playwright", "title.html")))
      })
      const context = yield* Browser.newContext({
        httpCredentials: { username: "user", password: Redacted.make("pass") }
      })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        ;(window as any)._popup = window.open(url)
      }, server.PREFIX + "/title.html").pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/title.html")
      yield* popup.status.waitFor(parsed)
      assert.strictEqual(yield* popup.title, "Woof-Woof")
    })))

  test("PO-019", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 400, height: 500 }, touch: true }
      })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const hasTouch = yield* page.evaluateInMainWorld(() => {
        const win = window.open("")
        return win !== null && "ontouchstart" in win
      }).pipe(Page.withUserGesture)
      assert.strictEqual(hasTouch, true)
    })))

  test("PO-020", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { viewport: { width: 400, height: 500 } } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const size = yield* page.evaluateInMainWorld(() => {
        const win = window.open("about:blank")
        return { width: win?.innerWidth, height: win?.innerHeight }
      }).pipe(Page.withUserGesture)
      assert.deepStrictEqual(size, { width: 400, height: 500 })
    })))

  test("PO-021", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { viewport: { width: 700, height: 700 } } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      const size = yield* page.evaluateInMainWorld(async () => {
        const win = window.open(
          window.location.href,
          "Title",
          "toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=600,height=300,top=0,left=0"
        )
        await new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (win?.innerWidth === 600 && win?.innerHeight === 300) {
              clearInterval(interval)
              resolve()
            }
          }, 10)
        })
        return { width: win?.innerWidth, height: win?.innerHeight }
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.EMPTY_PAGE)
      yield* popup.emulate({ viewport: { width: 500, height: 400 } })
      yield* popup.status.waitFor(loaded)
      const resized = yield* popup.evaluateInMainWorld(() => ({ width: window.innerWidth, height: window.innerHeight }))
      assert.deepStrictEqual(size, { width: 600, height: 300 })
      assert.deepStrictEqual(resized, { width: 500, height: 400 })
    })))

  test("PO-022", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      let intercepted = false
      yield* context.route("**/empty.html", () =>
        Effect.andThen(
          Effect.sync(() => {
            intercepted = true
          }),
          Route.continue
        ))
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        ;(window as any).__popup = window.open(url)
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.EMPTY_PAGE)
      assert.isTrue(intercepted)
    })))

  test("PO-023", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      yield* context.addInitScript(() => {
        ;(window as any).injected = 123
      })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const injected = yield* page.evaluateInMainWorld(() => {
        const win = window.open("about:blank")
        return (win as any)?.injected
      }).pipe(Page.withUserGesture)
      assert.strictEqual(injected, 123)
    })))

  test("PO-024", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      yield* context.addInitScript(() => {
        ;(window as any).injected = 123
      })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.CROSS_PROCESS_PREFIX + "/title.html").pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.CROSS_PROCESS_PREFIX + "/title.html")
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => (window as any).injected), 123)
      yield* popup.reload()
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => (window as any).injected), 123)
    })))

  test("PO-027", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        window.open("about:blank")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* Effect.all([waitForRafs(page, 30), waitForRafs(popup, 30)], { concurrency: "unbounded" })
    }))

  test("PO-028", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(async (browserName) => {
        const w = window.open("about:blank")
        if (w === null) throw new Error("window.open returned no window")
        if (browserName === "firefox") await new Promise<void>((resolve) => (w.onload = () => resolve()))
        w.document.body.innerHTML = `<button onclick="window.close()">close</button>`
      }, browserName).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* popup.getByRole("button").click()
    }))

  test("PO-029", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continue)
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        window.open("")?.document.write(`<img src="${url}">`)
      }, server.PREFIX + "/pptr.png").pipe(Page.withUserGesture)
      const popup = yield* opened
      // Playwright's `waitForFunction`: the page is polled until the image has loaded, here on a timer, since a popup
      // in the background may not paint frames
      yield* popup.evaluateInMainWorld(() =>
        new Promise<void>((resolve) => {
          const check = () => {
            if ((document.querySelector("img")?.naturalWidth ?? 0) > 0) resolve()
            else setTimeout(check, 10)
          }
          check()
        })
      )
    }))
})
