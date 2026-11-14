/**
 * Playwright's `tests/library/browsercontext-dsf.spec.ts`: a context's device scale factor picks the image a page loads.
 *
 * What the port changes:
 * - The original's `contextFactory({ deviceScaleFactor })` is a context made with `Browser.newPage` and a viewport
 *   that carries the factor, which is where Strider takes it (`emulation.viewport.deviceScaleFactor`).
 * - `page.waitForRequest("**\/image*")` subscribes before `goto`, as the original does: `NetworkRequest.next` with the
 *   same glob, awaited after the navigation. The vendored page's images aren't in the fixture set, so their responses
 *   are `404`s; the request is what the test is about.
 * - `goto` waits for `load`, as Playwright's default does, where Strider's default is to resolve at commit.
 */
import { assert } from "@effect/vitest"
import { Browser, NetworkRequest } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("DV-009", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage({
        emulation: { viewport: { width: 1280, height: 720, deviceScaleFactor: 1 } }
      })
      const requested = yield* NetworkRequest.next(page, { url: "**/image*" })
      yield* page.goto(server.PREFIX + "/highdpi.html", { waitUntil: "load" })
      const request = yield* requested
      assert.include(String(request.url), "image1x")
    })))

  test("DV-010", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage({
        emulation: { viewport: { width: 1280, height: 720, deviceScaleFactor: 2 } }
      })
      const requested = yield* NetworkRequest.next(page, { url: "**/image*" })
      yield* page.goto(server.PREFIX + "/highdpi.html", { waitUntil: "load" })
      const request = yield* requested
      assert.include(String(request.url), "image2x")
    })))
})
