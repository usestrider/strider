/**
 * Playwright's `tests/library/browsercontext-set-extra-http-headers.spec.ts`: extra request headers, set on a context
 * and on a page, and the refusal of a header value that isn't a string.
 *
 * What the port changes:
 * - `browser.newContext({ extraHTTPHeaders })` is `Browser.newContext({ emulation: { extraHTTPHeaders } })`, and
 *   `page.setExtraHTTPHeaders` is `page.emulate({ extraHTTPHeaders })`. A page's headers merge over its context's, with
 *   the page's values winning, which is what NE-119 checks.
 * - `server.waitForRequest` subscribes before `goto`, as the original's does. The request's header names are read in
 *   lowercase, as the server receives them.
 * - NE-120's `newContext` with a `null` header value fails with Strider's typed `InvalidInput`, which names the
 *   `extraHTTPHeaders` field. Strider's message doesn't name the offending header or the value's type, as Playwright's
 *   does, so the port checks the reason and its input, as NE-117 does.
 */
import { assert } from "@effect/vitest"
import { Browser, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("NE-119", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const request = yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({
          emulation: { extraHTTPHeaders: { fOo: "bAr", baR: "foO" } }
        })
        const page = yield* context.newPage
        yield* page.emulate({ extraHTTPHeaders: { Foo: "Bar" } })
        const waiting = yield* server.waitForRequest("/empty.html")
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        return yield* waiting
      }))
      assert.strictEqual(request.headers["foo"], "Bar")
      assert.strictEqual(request.headers["bar"], "foO")
    }))

  test("NE-120", { page: false }, () =>
    Effect.gen(function*() {
      const failure = yield* failureOf(
        Browser.newContext({ emulation: { extraHTTPHeaders: { foo: null as unknown as string } } }),
        "the context"
      )
      assert(UserContext.isUserContextError(failure), String(failure))
      assert(failure.reason._tag === "InvalidInput", String(failure.reason))
      assert.strictEqual(failure.reason.input, "extraHTTPHeaders")
    }))
})
