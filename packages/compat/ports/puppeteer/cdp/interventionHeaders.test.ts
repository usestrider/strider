/**
 * Puppeteer's `test/src/cdp/interventionHeaders.test.ts`: a script the page writes with `document.write` still reaches
 * the server when every request is intercepted, through a redirect, and carries the intervention header when the
 * browser sends one.
 *
 * What the port changes:
 * - `page.setRequestInterception(true)` with `request.continue()` on every request is `page.route("**\/*", …)` returning
 *   `Route.continue`, which resolves each request as it arrives.
 * - The server request is recorded in an array the route handler fills, where the original keeps one variable.
 * - The header check keeps the original's condition: Chrome 157 and later send no `Intervention` header, so the check
 *   runs only when the header is there.
 */
import { assert } from "@effect/vitest"
import { Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type { IncomingMessage } from "node:http"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("Page.setRequestInterception should work with intervention headers", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/intervention", (_req, res) => {
        return res.end(`
        <script>
          document.write('<script src="${server.CROSS_PROCESS_PREFIX}/intervention.js">' + '</scr' + 'ipt>');
        </script>
      `)
      })
      server.setRedirect("/intervention.js", "/redirect.js")
      const serverRequests: Array<IncomingMessage> = []
      server.setRoute("/redirect.js", (req, res) => {
        serverRequests.push(req)
        res.end("console.log(1);")
      })
      yield* page.route("**/*", () => Route.continue)
      yield* page.goto(server.PREFIX + "/intervention", { waitUntil: "load" })
      // The intercepted document.write() script must still reach the server
      assert.strictEqual(serverRequests.length, 1)
      const intervention = serverRequests[0]!.headers["intervention"]
      // Chrome 157+ no longer attaches the `Intervention` request header. Older versions still do; check for the
      // feature URL substring rather than https://www.chromestatus.com.
      if (intervention !== undefined) {
        assert.include(String(intervention), "feature/5718547946799104")
      }
    }))
})
