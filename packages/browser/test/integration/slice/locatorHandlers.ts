/** Overlay handling through public actions and waiting assertions on every backend. */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Expect, FileInput } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import { site } from "../adapter/harness.ts"

export const locatorHandlers = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} locator handlers`, () => {
    layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
      it.effect("handles overlays for an already-created action and suppresses callback recursion", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* Browser.newPage()
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
          const page = yield* Browser.newPage()
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

      it.effect("retries an action after an overlay appears and lets a handler navigate", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* Browser.newPage()
          const destination = `${served.origin}/fixture?html=${
            encodeURIComponent("<input id=\"target\"><div id=\"result\">done</div>")
          }`
          yield* page.goto(
            `${served.origin}/fixture?html=${
              encodeURIComponent(
                "<div id=\"overlay\" hidden>Overlay</div><input id=\"target\" disabled><script>setTimeout(() => document.querySelector(\"#overlay\").hidden=false,100)</script>"
              )
            }`
          )
          let calls = 0
          yield* page.addLocatorHandler(page.locator("#overlay"), () =>
            Effect.gen(function*() {
              calls++
              yield* page.goto(destination)
            }))
          yield* page.locator("#target").focus()
          yield* Expect.toHaveText(page.locator("#result"), "done")
          assert.strictEqual(calls, 1)
        }).pipe(Effect.scoped))

      it.effect("resumes a waiting assertion with fresh DOM after dismissing its trigger", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(
            `${served.origin}/fixture?html=${
              encodeURIComponent(
                "<div id=\"overlay\" hidden>Overlay</div><div id=\"result\">waiting</div><script>setTimeout(() => document.querySelector(\"#overlay\").hidden=false,100)</script>"
              )
            }`
          )
          let calls = 0
          yield* page.addLocatorHandler(page.locator("#overlay"), () =>
            Effect.gen(function*() {
              calls++
              yield* page.evaluateInMainWorld(() => {
                document.querySelector<HTMLElement>("#overlay")!.hidden = true
                document.querySelector("#result")!.textContent = "done"
              })
            }))
          yield* Expect.toHaveText(page.locator("#result"), "done")
          assert.strictEqual(calls, 1)
        }).pipe(Effect.scoped))

      it.effect("runs an unlimited body handler once per check without final-check restart loops", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent("<input id=\"target\">")}`)
          let calls = 0
          const registration = yield* page.addLocatorHandler(page.locator("body"), () =>
            Effect.sync(() => {
              calls++
            }), { noWaitAfter: true })
          yield* page.locator("#target").focus()
          assert.strictEqual(calls, 1)
          yield* Expect.toBeVisible(page.locator("#target"))
          assert.strictEqual(calls, 2)
          yield* registration.remove
          yield* page.locator("#target").focus()
          assert.strictEqual(calls, 2)
        }).pipe(Effect.scoped))

      it.effect("dismisses an overlay before resolving a file input for upload", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(
            `${served.origin}/fixture?html=${
              encodeURIComponent("<div id=\"overlay\">Overlay</div><input id=\"file\" type=\"file\">")
            }`
          )
          let calls = 0
          yield* page.addLocatorHandler(page.locator("#overlay"), () =>
            Effect.gen(function*() {
              calls++
              yield* page.evaluateInMainWorld(() => {
                document.querySelector<HTMLElement>("#overlay")!.hidden = true
              })
            }))
          yield* page.locator("#file").setInputFiles(
            FileInput.bytes("note.txt", "text/plain", new TextEncoder().encode("hello"))
          )
          assert.strictEqual(calls, 1)
          assert.strictEqual(
            yield* page.evaluateInMainWorld(() => document.querySelector<HTMLInputElement>("#file")!.files![0]!.name),
            "note.txt"
          )
        }).pipe(Effect.scoped))

      it.effect("handles overlays before initial and retrying URL assertions created before registration", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(
            `${served.origin}/fixture?html=${
              encodeURIComponent(
                "<div id=\"overlay\" hidden>Overlay</div><script>setTimeout(() => document.querySelector(\"#overlay\").hidden=false,100)</script>"
              )
            }`
          )
          const assertion = Expect.toHaveURL(page, /#done$/)
          let calls = 0
          yield* page.addLocatorHandler(page.locator("#overlay"), () =>
            Effect.gen(function*() {
              calls++
              yield* page.evaluateInMainWorld(() => {
                document.querySelector<HTMLElement>("#overlay")!.hidden = true
                location.hash = "done"
              })
            }))
          yield* assertion
          yield* page.addLocatorHandler(page.locator("body"), () =>
            Effect.sync(() => {
              calls++
            }), { times: 1, noWaitAfter: true })
          yield* Expect.toHaveURL(page, /#done$/)
          assert.strictEqual(calls, 2)
        }).pipe(Effect.scoped))

      it.effect("supports an always-visible trigger once without disappearance waiting", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* Browser.newPage()
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
