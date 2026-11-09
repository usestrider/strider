/** Overlay handling through public actions and waiting assertions on every backend. */
import { assert, describe, layer } from "@effect/vitest"
import {
  Browser,
  type Deadline,
  type Declaration,
  Expect,
  type Locator,
  type Page,
  type Target
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { site } from "../adapter/harness.ts"

interface HandlerPage extends Page.Page {
  addLocatorHandler<E, R>(
    locator: Locator.Locator,
    handler: (locator: Locator.Locator) => Effect.Effect<void, E, R>,
    options?: { readonly times?: number; readonly noWaitAfter?: boolean }
  ): Effect.Effect<Declaration.Registration, Page.PageError | Target.TargetGone | Deadline.Timeout, Scope.Scope | R>
}

export const locatorHandlers = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} locator handlers`, () => {
    layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
      it.effect("handles overlays for an already-created action and suppresses callback recursion", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = (yield* Browser.newPage()) as HandlerPage
          yield* page.goto(
            `${served.origin}/fixture?html=${
              encodeURIComponent("<div id=\"overlay\"><input id=\"dismiss\"></div><input id=\"target\">")
            }`
          )
          const action = page.locator("#target").focus()
          let calls = 0
          yield* page.addLocatorHandler(page.locator("#overlay"), () =>
            Effect.gen(function*() {
              calls++
              yield* page.locator("#dismiss").focus()
              yield* Expect.toBeVisible(page.locator("#overlay"))
              yield* page.evaluateInMainWorld(() => {
                document.querySelector<HTMLElement>("#overlay")!.hidden = true
              })
            }))
          yield* action
          assert.strictEqual(calls, 1)
          assert.strictEqual(yield* page.evaluateInMainWorld(() => document.activeElement?.id), "target")
        }).pipe(Effect.scoped))

      it.effect("handles an overlay arriving during assertion retries and preserves callback error identity", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = (yield* Browser.newPage()) as HandlerPage
          yield* page.goto(
            `${served.origin}/fixture?html=${
              encodeURIComponent(
                "<div id=\"overlay\" hidden>Overlay</div><div id=\"result\">waiting</div><script>setTimeout(() => document.querySelector(\"#overlay\").hidden=false,100)</script>"
              )
            }`
          )
          const sentinel = Object.assign(new Error("dismiss failed"), { code: 42, details: { original: true } })
          yield* page.addLocatorHandler(page.locator("#overlay"), () => Effect.fail(sentinel))
          const failure = yield* Expect.toHaveText(page.locator("#result"), "done").pipe(Effect.flip)
          assert.strictEqual(failure._tag, "ExpectationFailed")
          assert.strictEqual(
            (failure as unknown as { handlerFailure: { error: unknown } }).handlerFailure.error,
            sentinel
          )
        }).pipe(Effect.scoped))

      it.effect("supports an always-visible trigger once without disappearance waiting", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = (yield* Browser.newPage()) as HandlerPage
          yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent("<input id=\"target\">")}`)
          let calls = 0
          yield* page.addLocatorHandler(page.locator("body"), () =>
            Effect.sync(() => {
              calls++
            }), {
            times: 1,
            noWaitAfter: true
          })
          yield* page.locator("#target").focus()
          yield* Expect.toBeVisible(page.locator("#target"))
          assert.strictEqual(calls, 1)
        }).pipe(Effect.scoped))
    })
  })
