/**
 * The second slice: events, through the public API on every backend's layer. Call site 3 of
 * API.md, a popup with a dialog inside it, and around it what the design says the mechanism does: popups
 * matched by URL and owned by their opener's scope, late subscriptions diagnosed, dialogs decided by the latest
 * handler or else by the policy and reported, streams that end with their page or overflow, and operations a
 * dialog nothing will decide blocks.
 */
import { assert, describe, layer } from "@effect/vitest"
import {
  AutoResolution,
  Browser,
  Deadline,
  Dialog,
  Expect,
  Locator,
  Page,
  Popup,
  Subscription,
  Target
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"

const timeout = 60_000

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

/** A page on the local site, showing `html`, and the site's origin. */
const fixture = Effect.fnUntraced(function*(html: (origin: string) => string) {
  const served = yield* site
  return { url: fixtureUrl(served.origin, html(served.origin)), origin: served.origin }
})

const attribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll(`"`, "&quot;")

/** A button that opens `url` in a popup. */
const opener = (label: string, url: string) =>
  `<button onclick="${attribute(`window.open(${JSON.stringify(url)})`)}">${label}</button>`

// A button whose click shows a dialog, and what the dialog returned
const asking = (call: string) =>
  `<button onclick="document.getElementById('out').textContent = String(${call})">Ask</button><p id="out">nothing yet</p>`

const connect = (origin: string) =>
  `<title>Shop</title>${
    opener(
      "Connect account",
      fixtureUrl(
        origin,
        `<title>Connect</title><p id="s">Waiting</p><button onclick="if (confirm('Allow access?')) document.getElementById('s').textContent = 'Connected'">Allow</button>`
      )
    )
  }`

/**
 * Where the backend can't say which page opened a page, `Popup` refuses to wait for one, naming the capability
 * (QUIRKS.md, Q212): whether it did.
 */
const popupsRefused = Effect.fnUntraced(function*() {
  if (yield* supports("popups.opener")) return false
  yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const error = yield* Effect.flip(Effect.asVoid(Popup.next(page)))
    assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "popups.opener" })
  }))
  return true
})

export const events = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} events`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect("runs call site 3: a popup, with a dialog inside it a handler accepts", () =>
        Effect.gen(function*() {
          if (yield* popupsRefused()) return
          const { url } = yield* fixture(connect)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const popups = yield* Popup.next(page)
            yield* page.getByText("Connect account").click()
            const popup = yield* popups
            const handler = yield* Dialog.handle(popup, Dialog.acceptAll)
            yield* popup.getByRole("button", { name: "Allow" }).click()
            yield* popup.getByText("Connected").pipe(Expect.toBeVisible)
            assert.strictEqual(yield* handler.handled, 1)
            // One handle per page: the context's pages and the history hand out the same one
            assert.isTrue((yield* page.context.pages).some((each) => each === popup))
            const seen = yield* Popup.history(page)
            assert.deepStrictEqual(seen.entries, [popup])
            assert.strictEqual(seen.dropped, 0)
          }))
        }), timeout)

      it.effect(
        "keeps a popup's opener rendering: on Firefox as launched, elsewhere with focus emulated",
        () =>
          Effect.gen(function*() {
            if (yield* popupsRefused()) return
            const { origin, url } = yield* fixture((origin) =>
              opener("Open", `${origin}/child`) +
              `<button onclick="document.getElementById('out').textContent = 'clicked'">After</button><p id="out">not yet</p>`
            )
            // Firefox opens the popup as a window, so its opener stays in front of its own (QUIRKS.md, Q71); Chromium
            // opens it as a tab over its opener, which renders nothing until focus is emulated (Q19)
            const act = (focus: "system" | "emulated") =>
              Effect.scoped(Effect.gen(function*() {
                const context = yield* Browser.newContext({ focus })
                const page = yield* context.newPage
                yield* page.goto(url)
                const popup = yield* Popup.next(page, { url: `${origin}/child` })
                yield* page.getByText("Open").click()
                yield* popup
                return yield* page.getByText("After").click().pipe(
                  Effect.andThen(page.getByText("clicked", { exact: true }).pipe(Expect.toBeVisible)),
                  Deadline.within("5 seconds"),
                  Effect.exit
                )
              }))
            if (name === "Firefox") {
              assert.isTrue(Exit.isSuccess(yield* act("system")))
            } else {
              const unemulated = yield* act("system")
              if (name === "Chromium") {
                assert(Exit.isFailure(unemulated))
                const error = Option.getOrThrow(Exit.findErrorOption(unemulated))
                assert(Deadline.isTimeout(error), String(error))
                assert.include(Option.getOrElse(error.hint, () => ""), `focus: "emulated"`)
              }
              assert.isTrue(Exit.isSuccess(yield* act("emulated")))
            }
          }),
        timeout
      )

      it.effect("matches a popup by the URL it was opened for, among two", () =>
        Effect.gen(function*() {
          if (yield* popupsRefused()) return
          const { origin, url } = yield* fixture((origin) =>
            opener("First", fixtureUrl(origin, "<title>First</title>")) + opener("Second", `${origin}/child?second`)
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const second = yield* Popup.next(page, { url: `${origin}/child*` })
            yield* page.getByText("First").click()
            // The opener of a popup may be in the background now, rendering nothing: bring it back, explicitly
            yield* page.activate
            yield* page.getByText("Second").click()
            const popup = yield* second
            const at = yield* popup.url.waitFor((each) => each.includes("/child"))
            assert.strictEqual(at, `${origin}/child?second`)
            assert.strictEqual((yield* Popup.history(page)).entries.length, 2)
            assert.strictEqual((yield* Popup.history(page, { url: `${origin}/child*` })).entries.length, 1)
          }))
        }), timeout)

      it.effect("names the event a late next missed", () =>
        Effect.gen(function*() {
          if (yield* popupsRefused()) return
          const { url } = yield* fixture(connect)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const first = yield* Popup.next(page)
            yield* page.getByText("Connect account").click()
            yield* first
            const late = yield* Popup.next(page).pipe(Deadline.within("300 millis"))
            const error = yield* late.pipe(Effect.flip)
            assert(Deadline.isTimeout(error), String(error))
            assert.strictEqual(error.phase, "waitingForEvent")
            const hint = Option.getOrElse(error.hint, () => "")
            assert.match(hint, /a popup came \d+ ms before Popup\.next subscribed/)
          }))
        }), timeout)

      // A real browser runs in real time, so its deadlines do too: TestClock never moves them (QUIRKS.md, Q235)
      it.effect("times an event wait out on the browser's clock, under TestClock", () =>
        Effect.gen(function*() {
          if (yield* popupsRefused()) return
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const started = performance.now()
            const wait = yield* Popup.next(page).pipe(Deadline.within("300 millis"))
            const error = yield* Effect.flip(wait)
            assert(Deadline.isTimeout(error), String(error))
            assert.strictEqual(error.phase, "waitingForEvent")
            assert.isBelow(performance.now() - started, 10_000)
          }))
        }).pipe(Effect.provide(TestClock.layer())), timeout)

      it.effect("closes a popup with the scope that acquired its opener", () =>
        Effect.gen(function*() {
          if (yield* popupsRefused()) return
          const { url } = yield* fixture(connect)
          const scope = yield* Scope.make()
          const popup = yield* Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const popups = yield* Popup.next(page)
            yield* page.getByText("Connect account").click()
            return yield* popups
          }).pipe(Scope.provide(scope))
          assert.strictEqual((yield* popup.status)._tag, "Open")
          yield* Scope.close(scope, Exit.void)
          assert.strictEqual((yield* popup.closed)._tag, "PageClosed")
        }), timeout)

      it.effect("fails a wait with TargetGone when its page closes", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(connect)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            // A popup's wait, or a dialog's where the backend can't say which page opened a page
            const waiting = (yield* supports("popups.opener"))
              ? Effect.asVoid(yield* Popup.next(page))
              : Effect.asVoid(yield* Dialog.next(page))
            yield* page.close()
            const error = yield* waiting.pipe(Effect.flip)
            assert(Target.isTargetGone(error), String(error))
            assert.deepStrictEqual(error.reason, new Target.PageClosed({ by: "command" }))
          }))
        }), timeout)

      it.effect("reports a dialog the policy decides, as a Dialog and an AutoResolution", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => asking("confirm('Sure?')"))
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const dialogs = yield* Dialog.next(page)
            const decisions = yield* AutoResolution.next(page)
            yield* page.getByText("Ask").click()
            const dialog = yield* dialogs
            // A backend that can't say a dialog's kind says it's unknown (QUIRKS.md, Q206)
            const kind = (yield* supports("prompts.kind")) ? "Confirm" : "Unknown"
            assert(dialog._tag === kind)
            assert.strictEqual(dialog.message, "Sure?")
            const decided = yield* decisions
            assert.deepStrictEqual(decided.subject, { _tag: "Dialog", kind, message: "Sure?" })
            assert.strictEqual(decided.decision, "dismiss")
            assert.deepStrictEqual(decided.policy, { _tag: "ContextOption", name: "dialogs", value: "dismiss" })
            yield* page.getByText("false", { exact: true }).pipe(Expect.toBeVisible)
            assert.strictEqual((yield* AutoResolution.history(page.context)).entries.length, 1)
          }))
        }), timeout)

      it.effect("leaves a dialog to the policy when its handler fails", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => asking("confirm('Sure?')"))
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const handler = yield* Dialog.handle(page, () => Effect.fail("no answer"))
            const decisions = yield* AutoResolution.next(page)
            yield* page.getByText("Ask").click()
            assert.strictEqual((yield* decisions).decision, "dismiss")
            yield* page.getByText("false", { exact: true }).pipe(Expect.toBeVisible)
            assert.strictEqual(yield* handler.handled, 0)
          }))
        }), timeout)

      it.effect(
        "leaves a dialog to the policy when its handler's decision can't be applied",
        () =>
          Effect.gen(function*() {
            // Only a dialog whose kind isn't known can be given text it doesn't take (QUIRKS.md, Q206)
            if (yield* supports("prompts.kind")) return
            const { url } = yield* fixture(() => asking("confirm('Sure?')"))
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              yield* Dialog.handle(
                page,
                (dialog) =>
                  dialog._tag === "Unknown" ? Effect.succeed(dialog.respond("typed")) : Dialog.acceptAll(dialog)
              )
              const decisions = yield* AutoResolution.next(page)
              yield* page.getByText("Ask").click()
              assert.strictEqual((yield* decisions).decision, "dismiss")
              yield* page.getByText("false", { exact: true }).pipe(Expect.toBeVisible)
            }))
          }),
        timeout
      )

      it.effect("asks the latest handler, and the one before once it is removed", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => asking("confirm('Sure?')"))
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const accepting = yield* Dialog.handle(page, Dialog.acceptAll)
            const declining = yield* Dialog.handle(page, Dialog.dismissAll)
            yield* page.getByText("Ask").click()
            yield* page.getByText("false", { exact: true }).pipe(Expect.toBeVisible)
            yield* declining.remove
            yield* page.getByText("Ask").click()
            yield* page.getByText("true", { exact: true }).pipe(Expect.toBeVisible)
            assert.deepStrictEqual([yield* declining.handled, yield* accepting.handled], [1, 1])
            assert.strictEqual((yield* AutoResolution.history(page)).entries.length, 0)
          }))
        }), timeout)

      it.effect(
        "ends a stream when its page closes, with every dialog, which encode as data",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() => asking("(alert('one'), confirm('two'))"))
            const kinds = yield* supports("prompts.kind")
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const dialogs = yield* Dialog.stream(page)
              const collected = yield* Stream.runCollect(dialogs).pipe(Effect.forkChild)
              yield* page.getByText("Ask").click()
              yield* page.getByText("false", { exact: true }).pipe(Expect.toBeVisible)
              const history = yield* Dialog.history(page)
              const encoded = Schema.encodeUnknownSync(Subscription.History(Dialog.Dialog))(history)
              assert.deepStrictEqual(
                (encoded as { entries: ReadonlyArray<{ _tag: string; message: string }> }).entries.map((each) => [
                  each._tag,
                  each.message
                ]),
                kinds ? [["Alert", "one"], ["Confirm", "two"]] : [["Unknown", "one"], ["Unknown", "two"]]
              )
              yield* page.close()
              const all = yield* Fiber.join(collected)
              assert.deepStrictEqual(
                Array.from(all).map((each) => each._tag),
                kinds ? ["Alert", "Confirm"] : ["Unknown", "Unknown"]
              )
            }))
          }),
        timeout
      )

      it.effect("fails at once on a page whose dialog nothing will decide", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => asking("confirm('Stop?')"))
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage({ dialogs: "leaveOpen" })
            yield* page.goto(url)
            const clicked = Date.now()
            const error = yield* page.getByText("Ask").click().pipe(Effect.flip)
            // The page can't confirm a release while its dialog is open, so the click doesn't wait to try
            assert.isBelow(Date.now() - clicked, 1000)
            assert(Locator.isLocatorError(error), String(error))
            assert(error.reason._tag === "PromptBlocking", String(error))
            assert.strictEqual(error.reason.kind, (yield* supports("prompts.kind")) ? "confirm" : "unknown")
            assert.strictEqual(error.reason.text, "Stop?")
            assert.strictEqual(error.diagnostics.dispatch._tag, "MayHaveBeenSent")
            const started = Date.now()
            const read = yield* page.title.pipe(Effect.flip)
            assert(Page.isPageError(read) && read.reason._tag === "PromptBlocking", String(read))
            assert.isBelow(Date.now() - started, 2000)
          }))
        }), timeout)

      it.effect("fails a stream that falls more than its capacity behind", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => asking("(alert('one'), alert('two'), alert('three'))"))
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const dialogs = yield* Dialog.stream(page).pipe(Subscription.withCapacity(1))
            yield* page.getByText("Ask").click()
            yield* page.getByText("undefined", { exact: true }).pipe(Expect.toBeVisible)
            const error = yield* Stream.runCollect(dialogs).pipe(Effect.flip)
            assert(Subscription.isEventOverflow(error), String(error))
            assert.strictEqual(error.bound, 1)
          }))
        }), timeout)
    })
  })
