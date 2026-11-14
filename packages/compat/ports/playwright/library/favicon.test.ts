/**
 * Playwright's `tests/library/favicon.spec.ts`: an SVG favicon that the page's `prefers-color-scheme` styles.
 * Headless Chromium doesn't request favicons, so the original skips it there; the port runs on Firefox and stock WebKit,
 * and the Chromium case is `notApplicable` in the ledger.
 *
 * What the port changes:
 * - `server.setRoute(favicon, …)` serves the vendored SVG with its `image/svg+xml` type, as the original's `serveFile`.
 * - `Promise.all([server.waitForRequest(favicon), page.goto(…)])` is a request wait started before `goto` and joined
 *   after it, so the request the page makes is the one awaited.
 * - The original's `waitForTimeout(500)` is kept as written: the request doesn't mean the browser has processed the
 *   favicon, and no event says it has.
 * - `page.waitForSelector("text=favicons")` is `Expect.toBeVisible` on the text, its default state.
 * - Strider records favicon requests as the page's requests, which is an open question (the ledger's entry for this test
 *   names it); the port asserts only what the original asserts.
 */
import { Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as fs from "node:fs"
import { assetPath } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, { browsers: ["firefox", "webkit"] }, (test) => {
  test("FA-001", ({ page, server }) =>
    Effect.gen(function*() {
      // Browsers cache favicons, so the query busts the cache, as the original's does
      const favicon = `/favicon.svg?d=${Date.now()}`
      const svg = fs.readFileSync(assetPath("playwright", "media-query-prefers-color-scheme.svg"))
      server.setRoute(favicon, (_request, response) => {
        response.setHeader("Content-Type", "image/svg+xml")
        response.end(svg)
      })
      server.setRoute("/page.html", (_request, response) => {
        response.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <link rel="icon" type="image/svg+xml" href="${favicon}">
          <title>SVG Favicon Test</title>
        </head>
        <body>
          favicons
        </body>
      </html>
`)
      })

      const requested = yield* server.waitForRequest(favicon)
      yield* page.goto(server.PREFIX + "/page.html", { waitUntil: "load" })
      yield* requested

      // Add artificial delay since, just because we saw the request for the favicon, it does not mean the browser has
      // processed it. There's no event for "favicon is fully displayed", so the original waits 500 ms, and so does this.
      yield* Effect.sleep("500 millis")
      // Text still being around ensures we haven't actually lost the browser to a crash.
      yield* Expect.toBeVisible(page.getByText("favicons"))
    }))
})
