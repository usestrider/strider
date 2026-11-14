/**
 * Playwright's `tests/page/page-set-extra-http-headers.spec.ts`: extra request headers set on a page or its context, as
 * the server receives them, through redirects, and the error for a header value that isn't a string.
 *
 * What the port changes:
 * - `page.setExtraHTTPHeaders(headers)` is `page.emulate({ extraHTTPHeaders })`, and `page.context().setExtraHTTPHeaders`
 *   is `page.context.emulate({ extraHTTPHeaders })`: a registration held by the test's scope, as the original's headers
 *   last until the page or context closes.
 * - `Promise.all([server.waitForRequest(path), page.goto(url)])` listens first, then navigates, then reads the request, as
 *   `server.waitForRequest` and `page.goto` do here.
 * - NE-117's failure is Strider's `DeclarationError` with an `InvalidInput` reason, which names the `extraHTTPHeaders`
 *   field. Strider's message doesn't name the header or the value's type, as Playwright's does, so the port checks the
 *   reason and its input. The header values are cast: the original's `@ts-expect-error` is the same refusal, at compile
 *   time, which Strider's types make too.
 * - NE-118 reads the request the browser reports (`NetworkRequest.next`) for `request.headers()['referer']`, as the
 *   original does, and the fixture server's `rawHeaders` for the one thing Node's parsed headers hide: that the browser
 *   sent a single `Referer` field, not a repeat. A request with both `referer` and `Referer` is the failure the original's
 *   `it.fail` marks on Chromium before 154; the run's Chromium is newer, so the port expects the pass.
 */
import { assert } from "@effect/vitest"
import { Declaration, NetworkRequest } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("NE-114", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ extraHTTPHeaders: { foo: "bar" } })
      const request = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const received = yield* request
      assert.strictEqual(received.headers["foo"], "bar")
      assert.strictEqual(received.headers["baz"], undefined)
    }))

  test("NE-115", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRedirect("/foo.html", "/empty.html")
      yield* page.emulate({ extraHTTPHeaders: { foo: "bar" } })
      const request = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.PREFIX + "/foo.html", { waitUntil: "load" })
      assert.strictEqual((yield* request).headers["foo"], "bar")
    }))

  test("NE-116", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.emulate({ extraHTTPHeaders: { foo: "bar" } })
      const request = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual((yield* request).headers["foo"], "bar")
    }))

  test("NE-117", ({ page }) =>
    Effect.gen(function*() {
      // A header value that isn't a string is refused by the page, and by its context, as InvalidInput
      const pageError = yield* failureOf(
        page.emulate({ extraHTTPHeaders: { foo: 1 as unknown as string } }),
        "the page's emulation"
      )
      assert(Declaration.isDeclarationError(pageError), String(pageError))
      assert(pageError.reason._tag === "InvalidInput", String(pageError.reason))
      assert.strictEqual(pageError.reason.input, "extraHTTPHeaders")

      const contextError = yield* failureOf(
        page.context.emulate({ extraHTTPHeaders: { foo: true as unknown as string } }),
        "the context's emulation"
      )
      assert(Declaration.isDeclarationError(contextError), String(contextError))
      assert(contextError.reason._tag === "InvalidInput", String(contextError.reason))
      assert.strictEqual(contextError.reason.input, "extraHTTPHeaders")
    }))

  test("NE-118", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ extraHTTPHeaders: { referer: server.EMPTY_PAGE } })
      const sent = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE })
      const received = yield* server.waitForRequest("/empty.html")
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert(navigation._tag === "Committed", navigation._tag)
      assert(navigation.response._tag === "Some", "no response")
      assert(navigation.response.value.status >= 200 && navigation.response.value.status < 300, "response is not ok")
      assert.strictEqual((yield* sent).headers["referer"], server.EMPTY_PAGE)
      const fields = (yield* received).rawHeaders.filter((name, index) =>
        index % 2 === 0 && name.toLowerCase() === "referer"
      )
      assert.deepStrictEqual(fields.length, 1, `referer sent as ${fields.join(", ")}`)
    }))
})
