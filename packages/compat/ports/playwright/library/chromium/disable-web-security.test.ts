/**
 * Playwright's `tests/library/chromium/disable-web-security.spec.ts`: a popup and an init script with
 * `--disable-web-security`. Chromium only, as the original's directory is.
 *
 * What the port changes:
 * - `it.use({ launchOptions })` is the file's `launch` option: Chromium launches with `--disable-web-security`.
 * - `page.context().waitForEvent("page")` is `Popup.next(page)` on the page that opens it, subscribed before the click
 *   that opens the popup. The click is a real one, so the popup needs no user gesture (see popup.test.ts).
 * - `page.context().addInitScript(source)` is `page.context.addInitScript({ source })`, a main-world script.
 * - Strider reports a popup before it loads, so the port waits for the popup to reach its URL before it reads it.
 * - `page1.evaluate("window.injected")` is `evaluateInMainWorld`, where the init script's global is.
 */
import { assert } from "@effect/vitest"
import { Expect, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { type Fixtures, upstream } from "../../../harness/upstream.ts"

/** The page that opens a popup at `target.html`, and the popup's empty document. */
const setupRoutes = (server: Fixtures["server"]) => {
  server.setRoute("/main.html", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(`<a href="${server.PREFIX}/target.html" target="_blank">Click me</a>`)
  })
  server.setRoute("/target.html", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end("<html></html>")
  })
}

upstream(import.meta.filename, {
  browsers: ["chromium"],
  launch: { chromium: { args: ["--disable-web-security"] } }
}, (test) => {
  test("CR-045", ({ page, server }) =>
    Effect.gen(function*() {
      setupRoutes(server)
      yield* page.goto(server.PREFIX + "/main.html", { waitUntil: "load" })
      const popups = yield* Popup.next(page)
      yield* page.getByRole("link", { name: "Click me" }).click()
      const page1 = yield* popups
      yield* Expect.toHaveURL(page1, /target/)
    }))

  test("CR-046", ({ page, server }) =>
    Effect.gen(function*() {
      setupRoutes(server)
      yield* page.context.addInitScript({ source: "window.injected = 123" })
      yield* page.goto(server.PREFIX + "/main.html", { waitUntil: "load" })
      const popups = yield* Popup.next(page)
      yield* page.getByRole("link", { name: "Click me" }).click()
      const page1 = yield* popups
      yield* page1.url.waitFor((url) => url === server.PREFIX + "/target.html")
      const value = yield* page1.evaluateInMainWorld(() => (window as unknown as { injected: number }).injected)
      assert.strictEqual(value, 123)
    }))
})
