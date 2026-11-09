/**
 * The fourth slice: interacting and asserting, through the public API on every backend's layer.
 * Call site 1 up to its storage state, every action, the guard on the first trusted event, held input released
 * with its scope, every read and matcher, the keyboard and the mouse, and two pages of one context.
 */
import { assert, describe, layer } from "@effect/vitest"
import {
  Browser,
  Condition,
  Deadline,
  Expect,
  FileInput,
  Keyboard,
  Locator,
  Mouse,
  Operation,
  type Page,
  Route,
  type UserContext
} from "@usestrider/browser"
import { Protocol } from "@usestrider/browser/protocol"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import * as Adapter from "../../../src/internal/adapter.ts"
import * as BoundedAdapter from "../../../src/internal/boundedAdapter.ts"
import * as Engine from "../../../src/internal/engine.ts"
import { LocatorImpl } from "../../../src/internal/locator.ts"
import * as InternalOperation from "../../../src/internal/operation.ts"
import { site } from "../adapter/harness.ts"
import { type LinkGeometry, wrappedLinkHtml, wrappedLinks } from "../wrappedLinks.ts"
import { supports } from "./capabilities.ts"
import * as SharedContext from "./sharedContext.ts"
import { newPage } from "./sharedContext.ts"

const timeout = 60_000

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

const fixture = Effect.fnUntraced(function*(html: (origin: string) => string) {
  const served = yield* site
  return { url: fixtureUrl(served.origin, html(served.origin)), origin: served.origin }
})

/** An element whose text a script writes, for asserting what happened. */
const out = `<p id="out">nothing yet</p>`
const say = (text: string) => `document.getElementById('out').textContent = ${text}`
/** Writes the target and coordinates of the page's pointerdown into `#out`, keeping the click from navigating. */
const recordsClick =
  `<script>document.addEventListener("pointerdown",e=>document.getElementById("out").textContent=JSON.stringify({target:e.target.id,x:e.clientX,y:e.clientY}));document.addEventListener("click",e=>e.preventDefault())</script>`

/** Observe the real engine boundary, counting rendering callbacks only while a check is in progress. */
const observeChecks = Effect.fnUntraced(function*(locator: LocatorImpl, notifyFocus = false) {
  const adapter = locator.owner.runtime.model.adapter
  const original = adapter.evaluate
  const rounds: Array<{
    request: Extract<Engine.Request, { op: "act" }>
    response: Engine.Response
    frames: number
  }> = []
  const measured = `async function(request) {
    let frames = 0;
    let handle;
    const focus = HTMLElement.prototype.focus;
    // Inject missing focus notifications after native focus; insertion remains native.
    if (${notifyFocus}) HTMLElement.prototype.focus = function(options) {
      focus.call(this, options);
      if (this.hasAttribute("onfocus")) this.dispatchEvent(new FocusEvent("focus"));
    };
    const tick = () => { frames++; handle = requestAnimationFrame(tick); };
    handle = requestAnimationFrame(tick);
    try {
      const result = JSON.parse(await (${Engine.run})(request));
      result.__testFrames = frames;
      return JSON.stringify(result);
    } finally {
      cancelAnimationFrame(handle);
      HTMLElement.prototype.focus = focus;
    }
  }`
  const evaluate: typeof original = (realm, call) =>
    Effect.suspend(() => {
      const argument = call.arguments[0]
      const request = call.functionDeclaration === Engine.run && argument?._tag === "Value" &&
          argument.value.type === "string"
        ? JSON.parse(argument.value.value) as Engine.Request
        : undefined
      if (request?.op !== "act") return original(realm, call)
      return original(realm, { ...call, functionDeclaration: measured }).pipe(Effect.tap((result) =>
        Effect.sync(() => {
          assert(result._tag === "Value" && result.value.type === "string")
          const response = JSON.parse(result.value.value) as Engine.Response & { __testFrames: number }
          rounds.push({ request, response, frames: response.__testFrames })
        })
      ))
    })
  yield* Effect.acquireRelease(
    Effect.sync(() => Object.assign(adapter, { evaluate })),
    () =>
      Effect.sync(() => {
        Object.assign(adapter, { evaluate: original })
      })
  )
  return rounds
})

export const interaction = (name: "Chromium" | "Firefox" | "WebKit", backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} interaction`, () => {
    layer(SharedContext.layer(backend), { excludeTestServices: true, timeout })((suite) => {
      const it = SharedContext.guard(suite)

      it.effect(
        "selectText selects control values and DOM contents without editing",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="input" value="Ada Lovelace"><textarea id="area">two lines</textarea><div id="editable" contenteditable>nested <b>text</b></div><p id="plain" tabindex="0">plain <b>text</b></p><p id="unfocusable">unfocusable text</p>`
            )
            const page = yield* newPage
            yield* page.goto(url)
            for (
              const [id, text] of [["input", "Ada Lovelace"], ["area", "two lines"], ["editable", "nested text"], [
                "plain",
                "plain text"
              ]] as const
            ) {
              const target = page.locator(`#${id}`)
              yield* target.selectText()
              const selected = yield* page.evaluateInMainWorld((id: string) => {
                const element = document.getElementById(id)!
                if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                  return element.value.slice(element.selectionStart ?? 0, element.selectionEnd ?? 0)
                }
                return element.ownerDocument.getSelection()?.toString() ?? ""
              }, id)
              assert.strictEqual(selected, text)
              assert.isTrue(yield* page.evaluateInMainWorld((id: string) => document.activeElement?.id === id, id))
            }
            yield* page.locator("#unfocusable").selectText()
            assert.strictEqual(yield* page.evaluateInMainWorld(() => getSelection()?.toString()), "unfocusable text")
            assert.isFalse(
              yield* page.evaluateInMainWorld(() => document.activeElement?.id === "unfocusable")
            )
            assert.strictEqual(yield* page.locator("#input").readValue, "Ada Lovelace")
          })),
        timeout
      )

      it.effect(
        "selectText selects email values without relying on selection offsets",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { url } = yield* fixture(() => `<input type="email" value="ada@example.com">`)
            const page = yield* newPage
            yield* page.goto(url)
            const email = page.locator("input")
            yield* email.selectText()
            assert.strictEqual(yield* email.readValue, "ada@example.com")
            yield* email.press("Backspace")
            assert.strictEqual(yield* email.readValue, "")
          })),
        timeout
      )

      it.effect(
        "selectText trial preserves focus and selection; visibility can be overridden",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="field" value="hello"><p id="hidden" style="display:none">hidden text</p>`
            )
            const page = yield* newPage
            yield* page.goto(url)
            const field = page.locator("#field")
            yield* field.selectText({ trial: true })
            assert.isFalse(yield* page.evaluateInMainWorld(() => document.activeElement?.id === "field"))
            assert.strictEqual(
              yield* page.evaluateInMainWorld(() =>
                (document.getElementById("field") as HTMLInputElement).selectionEnd
              ),
              0
            )
            const hidden = page.locator("#hidden")
            const error = yield* hidden.selectText().pipe(Deadline.within("150 millis"), Effect.flip)
            assert(Deadline.isTimeout(error))
            yield* hidden.selectText({ checks: { visible: false } })
          })),
        timeout
      )

      it.effect(
        "selectText rejects ambiguous matches and unsupported input kinds",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { url } = yield* fixture(() => `<input type="number" value="42"><p>one</p><p>two</p>`)
            const page = yield* newPage
            yield* page.goto(url)
            for (const [selector, reason] of [["p", "StrictViolation"], ["input", "WrongElement"]] as const) {
              const error = yield* page.locator(selector).selectText().pipe(Effect.flip)
              assert(Locator.isLocatorError(error))
              assert.strictEqual(error.reason._tag, reason)
            }
            const trial = yield* page.locator("input").selectText({ trial: true }).pipe(Effect.flip)
            assert(Locator.isLocatorError(trial))
            assert.strictEqual(trial.reason._tag, "WrongElement")
            const missing = yield* page.locator("#missing").selectText().pipe(
              Deadline.within("150 millis"),
              Effect.flip
            )
            assert(Deadline.isTimeout(missing))
          })),
        timeout
      )

      it.effect(
        "selectText permits readonly, disabled, inert and covered targets without input events",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<div inert><input id="field" readonly disabled value="unchanged"></div><div style="position:fixed;inset:0">cover</div><label id="label" for="field">label text</label><script>window.edits=0;document.addEventListener('input',()=>window.edits++);document.addEventListener('change',()=>window.edits++);</script>`
            )
            const page = yield* newPage
            yield* page.goto(url)
            const field = page.locator("#field")
            yield* field.selectText()
            assert.deepStrictEqual(
              yield* page.evaluateInMainWorld(() => {
                const input = document.getElementById("field") as HTMLInputElement
                return [input.selectionStart, input.selectionEnd, input.value]
              }),
              [0, 9, "unchanged"]
            )
            yield* page.locator("#label").selectText()
            assert.strictEqual(yield* page.evaluateInMainWorld(() => getSelection()?.toString()), "label text")
            assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as unknown as { edits: number }).edits), 0)
          })),
        timeout
      )

      it.effect("selectText selects within the target frame document", () =>
        Effect.scoped(Effect.gen(function*() {
          const { url } = yield* fixture(() => `<iframe srcdoc='<p id="target" tabindex="0">frame text</p>'></iframe>`)
          const page = yield* newPage
          yield* page.goto(url)
          const target = page.frame(page.locator("iframe")).locator("#target")
          yield* target.selectText()
          assert.strictEqual(
            yield* page.evaluateInMainWorld(() =>
              (document.querySelector("iframe") as HTMLIFrameElement).contentDocument!.getSelection()?.toString()
            ),
            "frame text"
          )
          assert.strictEqual(yield* page.evaluateInMainWorld(() => getSelection()?.toString()), "")
        })), timeout)

      // The guard itself: each thing a case can leave in the shared context is reported, and the cases after get a
      // new context. Each is left through a scope that is never closed, as a case's own leak would be. A popup closes
      // with its opener's scope where the backend knows its opener, so it can be left only where it doesn't
      suite.effect(
        "the shared context reports what a case leaves in it, and is replaced",
        () =>
          Effect.gen(function*() {
            const shared = yield* SharedContext.Shared
            const { url, origin } = yield* fixture(() =>
              `<button onclick="window.open(location.href)">Open</button>${out}`
            )
            const inContext =
              <A, E>(f: (context: UserContext.UserContext) => Effect.Effect<A, E, Scope.Scope>) =>
              (leaked: Scope.Scope) => Effect.flatMap(shared.current, f).pipe(Scope.provide(leaked))
            const inPage = (act: (page: Page.Page) => Effect.Effect<unknown, unknown>) => () =>
              Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                yield* act(page)
              }))
            const leaks: ReadonlyArray<
              readonly [
                string | undefined,
                (leaked: Scope.Scope) => Effect.Effect<unknown, unknown, SharedContext.Shared>
              ]
            > = [
              ["page(s) open", inContext((context) => context.newPage)],
              [
                (yield* supports("popups.opener")) ? undefined : "page(s) open",
                inPage((page) =>
                  page.getByRole("button", { name: "Open" }).click().pipe(
                    Effect.andThen(page.context.pages.waitFor((pages) => pages.length > 1))
                  )
                )
              ],
              ["route(s) on the context", inContext((context) => context.route("**/never", () => Route.fallthrough))],
              ["InitScript declaration on the context", inContext((context) => context.addInitScript(() => {}))],
              [
                "a cookie left",
                inPage((page) => page.evaluateInMainWorld(() => void (document.cookie = "left=1; path=/")))
              ],
              [
                "localStorage item(s)",
                inPage((page) => page.evaluateInMainWorld(() => localStorage.setItem("left", "1")))
              ],
              ...((yield* supports("permissions"))
                ? [
                  [
                    "a grant of geolocation",
                    inContext((context) => context.grant(["geolocation"], { origin }))
                  ] as const
                ]
                : [])
            ]
            for (const [index, [expected, leak]] of leaks.entries()) {
              const leaked = yield* Scope.make()
              const before = yield* shared.current
              yield* leak(leaked)
              const left = yield* shared.settle
              if (expected === undefined) {
                assert.deepStrictEqual(left, [], `${index}: nothing is left`)
                assert.strictEqual(yield* shared.current, before, `${index}: a clean context is kept`)
              } else {
                assert(left.some((each) => each.includes(expected)), `${index}, ${expected}: ${JSON.stringify(left)}`)
                assert.notStrictEqual(yield* shared.current, before, `${index}, ${expected}: the context is replaced`)
              }
              yield* Scope.close(leaked, Exit.void)
            }
            const kept = yield* shared.current
            assert.deepStrictEqual(yield* shared.settle, [], "a clean context")
            assert.strictEqual(yield* shared.current, kept, "a clean context is kept")
          }),
        timeout
      )
      it.effect(
        "reports an unsupported role filter in a nested branch beyond a missing frame",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { url } = yield* fixture(() => "<a href=\"/\">Link</a>")
            const page = yield* newPage
            yield* page.goto(url)
            const outer = page.frame(page.locator("#absent-frame"))
            const nested = outer.frame(outer.locator("#deeper")).locator("a")
              .filter({ has: Locator.relative.getByRole("link", { pressed: false }) })
            const error = yield* nested.count.pipe(Effect.flip)
            assert(Locator.isLocatorError(error), String(error))
            assert.strictEqual(error.reason._tag, "InvalidInput")
          })),
        timeout
      )

      it.effect(
        "reports unsupported role filters as typed selector errors on use",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { url } = yield* fixture(() => "<a href=\"/\">Link</a>")
            const page = yield* newPage
            yield* page.goto(url)
            // Construction remains lazy, including under a scope that matches nothing.
            const invalid = page.getByRole("link", { pressed: false })
            const empty = page.locator("#missing").getByRole("link", { pressed: false })
            const missingFrame = page.frame(page.locator("#absent-frame")).getByRole("link", { pressed: false })
            for (
              const operation of [
                invalid.count,
                empty.count,
                invalid.readText,
                invalid.click(),
                invalid.evaluate(() => true),
                missingFrame.count,
                missingFrame.readText,
                missingFrame.click(),
                missingFrame.evaluate(() => true)
              ]
            ) {
              const error = yield* operation.pipe(Effect.flip)
              assert(Locator.isLocatorError(error), String(error))
              assert.strictEqual(error.reason._tag, "InvalidInput")
              if (error.reason._tag === "InvalidInput") {
                assert.strictEqual(error.reason.input, "selector")
                assert.strictEqual(error.reason.expected, "a role query with supported state filters")
                assert.include(error.reason.hint ?? "", "pressed")
              }
            }
            for (const candidate of [invalid, missingFrame]) {
              const assertion = yield* candidate.pipe(Expect.toHaveCount(0), Effect.flip)
              assert.strictEqual(assertion._tag, "ExpectationFailed")
            }
            assert.strictEqual(yield* page.frame(page.locator("#absent-frame")).getByRole("link").count, 0)
            assert.strictEqual(yield* page.getByRole("link").count, 1)
          })),
        timeout
      )

      for (const ancestor of [false, true]) {
        for (const action of ["click", "check", "fill"] as const) {
          it.effect(
            `acts on transparent controls with ${ancestor ? "ancestor" : "own"} opacity using ${action}`,
            () =>
              Effect.gen(function*() {
                const { url } = yield* fixture(() =>
                  `<!doctype html><div style="opacity:${ancestor ? 0 : 1}"><input id="target" type="${
                    action === "check" ? "checkbox" : "text"
                  }" style="opacity:${
                    ancestor ? 1 : 0
                  }" onclick="document.querySelector('#out').textContent='clicked'"></div><output id="out"></output>`
                )
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* newPage
                  yield* page.goto(url)
                  const target = page.locator("#target")
                  assert.strictEqual(yield* target.isVisible, false)
                  yield* target.filter({ visible: true }).pipe(Expect.toHaveCount(0))
                  yield* target.filter({ visible: false }).pipe(Expect.toHaveCount(1))
                  yield* target.pipe(Expect.toBeHidden)
                  const unseen = yield* target.pipe(Expect.toBeVisible, Deadline.within("200 millis"), Effect.flip)
                  assert.strictEqual(unseen._tag, "ExpectationFailed")
                  if (action === "fill") {
                    yield* target.fill("Ada").pipe(Deadline.within("1 second"))
                    yield* target.pipe(Expect.toHaveValue("Ada"))
                  } else {
                    yield* target[action]().pipe(Deadline.within("1 second"))
                    yield* page.locator("#out").pipe(Expect.toHaveText("clicked"))
                    if (action === "check") yield* target.pipe(Expect.toBeChecked)
                  }
                }))
              }),
            timeout
          )
        }
      }

      for (const ancestor of [false, true]) {
        for (
          const action of ["clear", "focus", "press", "pressSequentially", "selectOption", "scrollIntoView"] as const
        ) {
          it.effect(
            `runs ${action} on transparent controls with ${ancestor ? "ancestor" : "own"} opacity`,
            () =>
              Effect.gen(function*() {
                const opacity = ancestor ? 1 : 0
                const control = action === "selectOption"
                  ? `<select id="target" style="opacity:${opacity}"><option>a</option><option>b</option></select>`
                  : `<input id="target" value="${action === "clear" ? "x" : ""}" style="opacity:${opacity}">`
                const { url } = yield* fixture(() =>
                  `<!doctype html>${
                    action === "scrollIntoView" ? "<div style=\"height:3000px\"></div>" : ""
                  }<div style="opacity:${ancestor ? 0 : 1}">${control}</div>`
                )
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* newPage
                  yield* page.goto(url)
                  const target = page.locator("#target")
                  const within = Deadline.within("3 seconds")
                  if (action === "clear") {
                    yield* target.clear().pipe(within)
                    yield* target.pipe(Expect.toHaveValue(""))
                  } else if (action === "focus") {
                    yield* target.focus().pipe(within)
                    yield* target.pipe(Expect.toBeFocused)
                  } else if (action === "press") {
                    yield* target.press("a").pipe(within)
                    yield* target.pipe(Expect.toHaveValue("a"))
                  } else if (action === "pressSequentially") {
                    yield* target.pressSequentially("a").pipe(within)
                    yield* target.pipe(Expect.toHaveValue("a"))
                  } else if (action === "selectOption") {
                    yield* target.selectOption({ label: "b" }).pipe(within)
                    yield* target.pipe(Expect.toHaveValue("b"))
                  } else {
                    yield* target.scrollIntoView().pipe(within)
                    assert.isAbove(yield* page.evaluateInMainWorld(() => globalThis.scrollY), 0)
                  }
                }))
              }),
            timeout
          )
        }
      }

      for (
        const [layout, html] of [
          [
            "behind",
            `<label style="position:relative;display:block;padding:10px"><input id="target" type="checkbox" style="position:absolute;opacity:0;z-index:-1"><span>Accept terms</span></label>`
          ],
          [
            "under",
            `<input id="target" type="checkbox" style="position:absolute;opacity:0"><label for="target" style="position:relative;display:block;padding:10px"><span>Accept terms</span></label>`
          ]
        ] as const
      ) {
        it.effect(
          `checks a transparent control ${layout} its label through the label's text`,
          () =>
            Effect.gen(function*() {
              const { url } = yield* fixture(() => `<!doctype html>${html}`)
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const control = page.locator("#target")
                const error = yield* control.check().pipe(Deadline.within("1 second"), Effect.flip)
                assert.strictEqual(error._tag, "Timeout")
                assert.include(
                  String((error as Deadline.Timeout).hint.pipe(Option.getOrUndefined)),
                  "covers the element's action point"
                )
                yield* page.getByText("Accept terms").check().pipe(Deadline.within("3 seconds"))
                yield* control.pipe(Expect.toBeChecked)
                yield* page.getByText("Accept terms").uncheck().pipe(Deadline.within("3 seconds"))
                assert.strictEqual(yield* control.isChecked, false)
              }))
            }),
          timeout
        )
      }

      it.effect("fills a transparent control under a cover, with no pointer to hit-test", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<!doctype html><input id="target" style="opacity:0;position:absolute;left:20px;top:20px"><div style="position:absolute;inset:0;background:white"></div>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const target = page.locator("#target")
            yield* target.fill("Ada").pipe(Deadline.within("3 seconds"))
            yield* target.pipe(Expect.toHaveValue("Ada"))
          }))
        }), timeout)

      for (const state of ["covered", "display", "visibility", "disabled", "readonly", "inert"] as const) {
        for (const action of ["click", "fill"] as const) {
          if (state === "covered" && action === "fill" || state === "readonly" && action === "click") continue
          it.effect(`blocks transparent ${state} controls for ${action}`, () =>
            Effect.gen(function*() {
              const { url } = yield* fixture(() =>
                `<!doctype html><input id="target" style="opacity:0;position:absolute;left:20px;top:20px;${
                  state === "display" ? "display:none" : state === "visibility" ? "visibility:hidden" : ""
                }" ${
                  state === "disabled" || state === "readonly" || state === "inert" ? state : ""
                } onclick="document.querySelector('#out').textContent='clicked'">${
                  state === "covered" ? "<div style=\"position:absolute;inset:0;background:white\"></div>" : ""
                }<output id="out"></output>`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const target = page.locator("#target")
                const error = yield* (action === "fill" ? target.fill("Ada") : target.click()).pipe(
                  Deadline.within("1 second"),
                  Effect.flip
                )
                assert.strictEqual(error._tag, "Timeout")
                assert.include(
                  String((error as Deadline.Timeout).hint.pipe(Option.getOrUndefined)),
                  {
                    covered: "covers the element's action point",
                    display: "isn't visible",
                    visibility: "isn't visible",
                    disabled: "disabled",
                    readonly: "read-only",
                    inert: "inert"
                  }[state]
                )
                yield* target.pipe(Expect.toHaveValue(""))
                yield* page.locator("#out").pipe(Expect.toHaveText(""))
              }))
            }), timeout)
        }
      }

      for (const shape of wrappedLinks) {
        for (const partial of shape.id === "three" ? [false, true] : [false]) {
          it.effect(
            `dispatches click to first visible fragment for wrapped link ${shape.id}${
              partial ? " partially above viewport" : ""
            }`,
            () =>
              Effect.gen(function*() {
                const { url } = yield* fixture(() => wrappedLinkHtml(shape, partial))
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* newPage
                  yield* page.goto(url)
                  const geometry: LinkGeometry = yield* page.evaluateInMainWorld(() => ({
                    rects: Array.from(
                      document.querySelector("#go")!.getClientRects(),
                      (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
                    ),
                    width: innerWidth,
                    height: innerHeight
                  }))
                  assert.strictEqual(geometry.rects.length, shape.fragments)
                  if (partial) assert.isBelow(geometry.rects[0]!.bottom, 0)
                  const first = geometry.rects.find((r) => r.bottom > 0 && r.top < geometry.height)!
                  yield* page.locator("#go").click().pipe(Deadline.within("1 second"))
                  const event = JSON.parse(yield* page.locator("#out").readText) as {
                    target: string
                    x: number
                    y: number
                  }
                  assert.strictEqual(event.target, "go")
                  assert.strictEqual(
                    yield* page.evaluateInMainWorld(() => document.querySelector("#out")!.getAttribute("data-clicked")),
                    "go"
                  )
                  const x = (Math.max(0, first.left) + Math.min(geometry.width, first.right)) / 2
                  const y = (Math.max(0, first.top) + Math.min(geometry.height, first.bottom)) / 2
                  assert.closeTo(event.x, x, 1)
                  assert.closeTo(event.y, y, 1)
                  assert.isAtLeast(event.x, first.left)
                  assert.isBelow(event.x, first.right)
                  assert.isAtLeast(event.y, Math.max(0, first.top))
                  assert.isBelow(event.y, first.bottom)
                  if (name === "Firefox") {
                    assert.strictEqual(event.x, Math.round(x))
                    assert.strictEqual(event.y, Math.round(y))
                  }
                }))
              }),
            timeout
          )
        }
      }

      it.effect("clicks a later line when the first fragment centre is covered", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<style>body{margin:0;font:16px/24px monospace}#box{position:absolute;left:20px;top:20px;width:240px}</style><div id="box"><a id="go" href="#">${
              Array(6).fill("abcdefghij").join(" ")
            }</a></div><div style="position:absolute;left:0;top:0;width:400px;height:44px"></div><output id="out"></output>${recordsClick}`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const centers = yield* page.evaluateInMainWorld(() =>
              Array.from(document.querySelector("#go")!.getClientRects(), (r) => (r.top + r.bottom) / 2)
            )
            assert.strictEqual(centers.length, 3)
            yield* page.locator("#go").click().pipe(Deadline.within("1 second"))
            const event = JSON.parse(yield* page.locator("#out").readText) as { target: string; y: number }
            assert.strictEqual(event.target, "go")
            assert.closeTo(event.y, centers[1]!, 1)
          }))
        }), timeout)

      it.effect("retries a frame-bounds NoMatch response", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<iframe srcdoc='<a id="go" href="#">Go</a><output id="out"></output>${recordsClick}'></iframe>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const locator = page.frame(page.locator("iframe")).locator("#go")
            assert(locator instanceof LocatorImpl)
            const adapter = locator.owner.runtime.model.adapter
            const descriptor = Object.getOwnPropertyDescriptor(adapter, "evaluate")!
            const original = adapter.evaluate
            let reads = 0
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                Object.defineProperty(adapter, "evaluate", {
                  ...descriptor,
                  value: ((realm, call) => {
                    const arg = call.arguments[0]
                    if (
                      call.functionDeclaration === Engine.run && arg?._tag === "Value" && arg.value.type === "string" &&
                      JSON.parse(arg.value.value).op === "frame"
                    ) {
                      reads++
                      if (reads === 1) {
                        return Effect.succeed(
                          {
                            _tag: "Value",
                            value: { type: "string", value: JSON.stringify({ _tag: "NoMatch" }) }
                          } as const
                        )
                      }
                    }
                    return original(realm, call)
                  }) as typeof adapter.evaluate
                })
              }),
              () => Effect.sync(() => Object.defineProperty(adapter, "evaluate", descriptor))
            )
            yield* locator.click().pipe(Deadline.within("2 seconds"))
            assert.isAtLeast(reads, 2)
            const event = JSON.parse(yield* page.frame(page.locator("iframe")).locator("#out").readText) as {
              target: string
            }
            assert.strictEqual(event.target, "go")
          }))
        }), timeout)

      for (
        const [title, parent] of [
          [
            "whose first line its parent's scrolling ancestor clips",
            (frame: string) =>
              `<style>body{margin:0}#s{position:absolute;left:20px;top:20px;width:300px;height:100px;overflow:auto}iframe{display:block;width:280px;height:300px;border:0}</style><div id="s">${frame}</div><script>s.scrollTop=24</script>`
          ],
          [
            "whose first line an overlay in its parent covers",
            (frame: string) =>
              `<style>body{margin:0}iframe{position:absolute;left:20px;top:20px;width:300px;height:200px;border:0}#o{position:absolute;left:0;top:0;width:400px;height:44px;background:#fff}</style>${frame}<div id="o"></div>`
          ]
        ] as const
      ) {
        it.effect(`clicks a wrapped link in an iframe ${title}`, () =>
          Effect.gen(function*() {
            const inner =
              `<!doctype html><style>body{margin:0;font:16px/24px monospace;width:240px}</style><a id="go" href="#go">${
                Array(6).fill("abcdefghij").join(" ")
              }</a><output id="out"></output>${recordsClick}`
            const { url } = yield* fixture(() => `<!doctype html>${parent(`<iframe srcdoc='${inner}'></iframe>`)}`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const frame = page.frame(page.locator("iframe"))
              yield* frame.locator("#go").click().pipe(Deadline.within("1 second"))
              assert.strictEqual(JSON.parse(yield* frame.locator("#out").readText).target, "go")
            }))
          }), timeout)
      }

      for (const coveredIn of ["outer", "middle"] as const) {
        it.effect(
          `selects a later fragment through nested cross-origin frames covered in ${coveredIn}`,
          () =>
            Effect.gen(function*() {
              const { origin, crossSite } = yield* site
              const leaf =
                `<!doctype html><style>body{margin:0;font:16px/24px monospace;width:240px}</style><a id="go" href="#">${
                  Array(6).fill("abcdefghij").join(" ")
                }</a><output id="out"></output>${recordsClick}`
              const cover =
                `<div id="cover" style="position:absolute;left:0;top:0;width:400px;height:24px;background:white"></div>`
              const middle = `<style>body{margin:0}iframe{width:300px;height:150px;border:0}</style><iframe src="${
                fixtureUrl(origin, leaf)
              }"></iframe>${coveredIn === "middle" ? cover : ""}`
              const html = `<style>body{margin:0}iframe{width:300px;height:160px;border:0}</style><iframe src="${
                fixtureUrl(crossSite, middle)
              }"></iframe>${coveredIn === "outer" ? cover : ""}`
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(fixtureUrl(origin, html))
                const outer = page.frame(page.locator("iframe"))
                const inner = outer.frame(outer.locator("iframe"))
                yield* inner.locator("#go").click().pipe(Deadline.within("1 second"))
                const event = JSON.parse(yield* inner.locator("#out").readText) as { target: string; y: number }
                assert.strictEqual(event.target, "go")
                assert.isAtLeast(event.y, 24)
                assert.isBelow(event.y, 48)
              }))
            }),
          timeout
        )
      }

      for (const mode of ["wholly covered", "explicit covered", "disabled pointer checks", "drag target"] as const) {
        it.effect(`preserves ${mode} through parent coverage`, () =>
          Effect.gen(function*() {
            const inner =
              `<!doctype html><style>body{margin:0;font:16px/24px monospace;width:240px}</style><a id="go" href="#">${
                Array(6).fill("abcdefghij").join(" ")
              }</a><output id="out"></output>${recordsClick}`
            const { url } = yield* fixture(() =>
              `<style>body{margin:0}iframe{position:absolute;left:20px;top:20px;width:300px;height:150px;border:0}</style><iframe srcdoc='${inner}'></iframe><div id="cover" style="position:absolute;left:0;top:0;width:400px;height:200px"></div>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const frame = page.frame(page.locator("iframe"))
              const target = frame.locator("#go")
              if (mode === "disabled pointer checks") {
                yield* target.click({ trial: true, checks: { receivesPointer: false } }).pipe(
                  Deadline.within("1 second")
                )
              } else if (mode === "drag target") {
                assert(target instanceof LocatorImpl)
                const point = yield* target.pointOf(undefined).pipe(Operation.named("test.dragTarget"))
                assert(Option.isSome(point))
                const expected = yield* page.evaluateInMainWorld(() => {
                  const rect = document.querySelector("iframe")!.contentDocument!.querySelector("#go")!
                    .getClientRects()[0]!
                  return { x: 20 + (rect.left + rect.right) / 2, y: 20 + (rect.top + rect.bottom) / 2 }
                })
                assert.deepStrictEqual(point.value, expected)
              } else {
                const error = yield* target.click({
                  position: mode === "explicit covered" ? { x: 2, y: 2 } : undefined
                }).pipe(Deadline.within("1 second"), Effect.flip)
                assert(Deadline.isTimeout(error), String(error))
                assert(error.history.some((e) => {
                  const value = e.value as { _tag: string; by?: string }
                  return value._tag === "Covered" && value.by?.includes("#cover")
                }))
              }
              assert.strictEqual(yield* frame.locator("#out").readText, "")
            }))
          }), timeout)
      }

      it.effect("clicks a wrapped link whose first line a scrolling ancestor clips", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<!doctype html><style>body{margin:0;font:16px/24px monospace}#s{position:absolute;left:20px;top:100px;width:240px;height:48px;overflow:auto}</style><div id="s"><a id="go" href="#go">${
              Array(6).fill("abcdefghij").join(" ")
            }</a></div><output id="out"></output>${recordsClick}<script>s.scrollTop=24</script>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const lines = yield* page.evaluateInMainWorld(() => {
              const rects = document.querySelector("#go")!.getClientRects()
              return { count: rects.length, firstBottom: rects[0]!.bottom }
            })
            assert.strictEqual(lines.count, 3)
            assert.isAtMost(lines.firstBottom, 100)
            yield* page.locator("#go").click().pipe(Deadline.within("1 second"))
            assert.strictEqual(JSON.parse(yield* page.locator("#out").readText).target, "go")
          }))
        }), timeout)

      it.effect(
        "clicks a wrapped link in an iframe whose first line is above the page's viewport",
        () =>
          Effect.gen(function*() {
            const inner =
              `<!doctype html><style>body{margin:0;font:16px/24px monospace;width:240px}</style><a id="go" href="#go">${
                Array(6).fill("abcdefghij").join(" ")
              }</a><output id="out"></output>${recordsClick}`
            const { url } = yield* fixture(() =>
              `<!doctype html><style>body{margin:0}iframe{position:absolute;left:20px;top:-24px;width:300px;height:200px;border:0}</style><iframe srcdoc='${inner}'></iframe>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const frame = page.frame(page.locator("iframe"))
              yield* frame.locator("#go").click().pipe(Deadline.within("1 second"))
              assert.strictEqual(JSON.parse(yield* frame.locator("#out").readText).target, "go")
            }))
          }),
        timeout
      )

      it.effect(
        "clicks a wrapped link whose box crosses the viewport while no line does",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<!doctype html><style>body{margin:0;width:6000px;font:16px/24px monospace}#b{width:5100px}#p{display:inline-block;width:5000px;height:1px}</style><div id="b"><span id="p"></span><a id="go" href="#go">abcdefghij abcdefghij</a></div><output id="out"></output>${recordsClick}<script>scrollTo(1000,0)</script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url, { waitUntil: "domContentLoaded" })
              const seen = yield* page.evaluateInMainWorld(() => {
                const go = document.querySelector("#go")!
                const box = go.getBoundingClientRect()
                return {
                  lines: go.getClientRects().length,
                  visibleLines: Array.from(go.getClientRects()).filter((r) =>
                    r.right > 0 && r.left < innerWidth
                  ).length,
                  boxCrosses: box.left < innerWidth && box.right > 0
                }
              })
              assert.deepStrictEqual(seen, { lines: 2, visibleLines: 0, boxCrosses: true })
              yield* page.locator("#go").click().pipe(Deadline.within("1 second"))
              assert.strictEqual(JSON.parse(yield* page.locator("#out").readText).target, "go")
            }))
          }),
        timeout
      )

      for (const position of ["fixed", "absolute"] as const) {
        it.effect(`clicks a ${position} link that escapes an overflow ancestor`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<!doctype html><style>body{margin:0}#s{margin:100px;width:30px;height:30px;overflow:hidden}#go{position:${position};left:300px;top:100px}</style><div id="s"><a id="go" href="#go">Go</a></div><output id="out"></output>${recordsClick}`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#go").click().pipe(Deadline.within("1 second"))
              assert.strictEqual(JSON.parse(yield* page.locator("#out").readText).target, "go")
            }))
          }), timeout)
      }

      for (const position of ["fixed", "absolute"] as const) {
        it.effect(
          `clicks a link inside a ${position} box that escapes an overflow ancestor`,
          () =>
            Effect.gen(function*() {
              const { url } = yield* fixture(() =>
                `<!doctype html><style>body{margin:0}#s{margin:100px;width:30px;height:30px;overflow:hidden}#box{position:${position};left:300px;top:100px}</style><div id="s"><span id="box"><a id="go" href="#go">Go</a></span></div><output id="out"></output>${recordsClick}`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                yield* page.locator("#go").click().pipe(Deadline.within("1 second"))
                assert.strictEqual(JSON.parse(yield* page.locator("#out").readText).target, "go")
              }))
            }),
          timeout
        )
      }

      it.effect("clicks a wrapped link clipped by nested cross-origin parent frames", () =>
        Effect.gen(function*() {
          const { origin, crossSite } = yield* site
          const inner =
            `<!doctype html><style>body{margin:0;font:16px/24px monospace;width:240px}</style><a id="go" href="#go">${
              Array(6).fill("abcdefghij").join(" ")
            }</a><output id="out"></output>${recordsClick}`
          const innerUrl = fixtureUrl(origin, inner)
          const middle =
            `<!doctype html><style>body{margin:0}iframe{position:absolute;left:0;top:0;width:300px;height:200px;border:0}</style><iframe src="${innerUrl}"></iframe>`
          const url = fixtureUrl(
            origin,
            `<!doctype html><style>body{margin:0}iframe{position:absolute;left:20px;top:-24px;width:300px;height:200px;border:0}</style><iframe src="${
              fixtureUrl(crossSite, middle)
            }"></iframe>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const outer = page.frame(page.locator("iframe"))
            const innerFrame = outer.frame(outer.locator("iframe"))
            yield* innerFrame.locator("#go").click().pipe(Deadline.within("1 second"))
            const event = JSON.parse(yield* innerFrame.locator("#out").readText) as { target: string; y: number }
            assert.strictEqual(event.target, "go")
            assert.isAtLeast(event.y, 24)
            assert.isBelow(event.y, 48)
          }))
        }), timeout)

      const clippingFixtures = [
        {
          title: "a link inside an inline ancestor whose overflow has no effect",
          html:
            `<!doctype html><span style="overflow:hidden"><a id="go" href="#go">Go somewhere</a></span><output id="out"></output>`
        },
        {
          title: "a link inside a display: contents ancestor with overflow set",
          html:
            `<!doctype html><div style="display:contents;overflow:hidden"><a id="go" href="#go">Go somewhere</a></div><output id="out"></output>`
        },
        {
          title: "a shape inside a nested svg",
          html:
            `<!doctype html><svg width="200" height="200"><svg x="10" y="10" width="100" height="100"><rect id="go" width="50" height="50"/></svg></svg><output id="out"></output>`
        },
        {
          title: "a button in a foreignObject of an svg scaled by its viewBox",
          html:
            `<!doctype html><style>body{margin:0}</style><svg viewBox="0 0 100 100" width="400" height="400"><foreignObject width="100" height="100"><button id="go" style="margin-left:60px;margin-top:60px;display:block">Go</button></foreignObject></svg><output id="out"></output>`
        },
        {
          title: "a shape in an svg under a scaling transform",
          html:
            `<!doctype html><style>body{margin:0}</style><div style="transform:scale(2);transform-origin:0 0;width:100px;height:100px"><svg width="100" height="100"><rect id="go" x="80" y="80" width="15" height="15"/></svg></div><output id="out"></output>`
        },
        {
          title: "an absolute link outside a zero-height body whose overflow is hidden",
          html:
            `<!doctype html><style>html,body{margin:0;overflow:hidden}</style><a id="go" href="#go" style="position:absolute;left:50px;top:50px">Go</a><output id="out" style="position:absolute;top:100px"></output>`
        },
        {
          title: "a button in a popover whose transformed ancestor clips its box",
          html:
            `<!doctype html><style>body{margin:0}#c{transform:translateY(0);overflow:hidden;width:20px;height:20px}#p{position:fixed;inset:auto;left:100px;top:100px;margin:0}</style><div id="c"><div id="p" popover><button id="go">Go</button></div></div><output id="out" style="position:absolute;top:200px"></output><script>p.showPopover()</script>`
        }
      ] as const
      for (const { html, title } of clippingFixtures) {
        it.effect(`clicks ${title}`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() => `${html}${recordsClick}`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#go").click().pipe(Deadline.within("1 second"))
              assert.strictEqual(JSON.parse(yield* page.locator("#out").readText).target, "go")
            }))
          }), timeout)
      }

      it.effect(
        "clicks at an explicit position inside an inline ancestor whose overflow has no effect",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<!doctype html><span style="overflow:hidden"><a id="go" href="#go">Go somewhere</a></span><output id="out"></output>${recordsClick}`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#go").click({ position: { x: 2, y: 2 } }).pipe(Deadline.within("1 second"))
              assert.strictEqual(JSON.parse(yield* page.locator("#out").readText).target, "go")
            }))
          }),
        timeout
      )

      it.effect("dispatches click inside a one-pixel fragment after rounding", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<!doctype html><a id="go" style="position:fixed;left:0;top:20px;width:1px;height:10px"></a><output id="out"></output><script>go.onpointerdown=e=>out.textContent=JSON.stringify({x:e.clientX,y:e.clientY,target:e.target.id});go.onclick=()=>out.dataset.clicked="go"</script>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            yield* page.locator("#go").click().pipe(Deadline.within("1 second"))
            assert.deepStrictEqual(JSON.parse(yield* page.locator("#out").readText), { x: 0, y: 25, target: "go" })
            assert.strictEqual(
              yield* page.evaluateInMainWorld(() => document.querySelector("#out")!.getAttribute("data-clicked")),
              "go"
            )
          }))
        }), timeout)

      it.effect("dispatches explicit position from the padding-box origin", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<!doctype html><style>body{margin:0}#go{position:absolute;left:40px;top:60px;border-style:solid;border-width:7px 11px 13px 5px;padding:19px;width:100px;height:80px}</style><a id="go" href="#">Go</a><output id="out"></output><script>go.onpointerdown=e=>out.textContent=JSON.stringify({x:e.clientX,y:e.clientY,target:e.target.id});go.onclick=e=>e.preventDefault()</script>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            yield* page.locator("#go").click({ position: { x: 13, y: 9 } })
            assert.deepStrictEqual(JSON.parse(yield* page.locator("#out").readText), { x: 58, y: 76, target: "go" })
          }))
        }), timeout)

      for (const action of ["click", "check", "uncheck"] as const) {
        for (const change of ["replaced", "moved", "disabled", "covered", "interrupted", "expired"] as const) {
          it.effect(`handles a queued ${action} when ${change}`, () =>
            Effect.gen(function*() {
              const { url } = yield* fixture(() =>
                `<${
                  action === "click" ? "button" : `input type="checkbox" ${action === "uncheck" ? "checked" : ""}`
                } id="go" data-name="old" onclick="const out = document.getElementById('out'); out.dataset.count = String(Number(out.dataset.count ?? 0) + 1); out.textContent = this.dataset.name + ' clicked ' + out.dataset.count">${
                  action === "click" ? "Go</button>" : ""
                }${out}`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const locator = page.locator("#go")
                assert(locator instanceof LocatorImpl)
                const rounds = yield* observeChecks(locator)
                const input = locator.owner.page.input
                const original = input.withPermit
                const waiting = yield* Deferred.make<void>()
                // Observe the actual permit boundary after preflight, without a sleep or a timing assumption.
                yield* Effect.acquireRelease(
                  Effect.sync(() => {
                    input.withPermit = (effect) =>
                      Effect.andThen(Deferred.succeed(waiting, undefined), original(effect))
                  }),
                  () =>
                    Effect.sync(() => {
                      input.withPermit = original
                    })
                )
                const clicked = yield* original(Effect.gen(function*() {
                  const fiber = yield* locator[action]().pipe(Deadline.within("2 seconds"), Effect.forkScoped)
                  yield* Deferred.await(waiting)
                  assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
                  if (change === "expired") {
                    const error = yield* Fiber.join(fiber).pipe(Effect.flip)
                    assert(Deadline.isTimeout(error), String(error))
                    assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
                  } else if (change === "interrupted") {
                    yield* Fiber.interrupt(fiber)
                  } else {
                    yield* page.evaluateInMainWorld((change: string) => {
                      const button = document.getElementById("go") as HTMLInputElement
                      if (change === "replaced") {
                        const replacement = button.cloneNode(true) as HTMLInputElement
                        replacement.dataset["name"] = "new"
                        button.replaceWith(replacement)
                      } else if (change === "moved") {
                        button.style.marginLeft = "200px"
                      } else if (change === "disabled") {
                        button.disabled = true
                      } else {
                        const cover = document.createElement("div")
                        cover.style.cssText = "position:fixed;inset:0;z-index:1"
                        document.body.append(cover)
                      }
                    }, change)
                  }
                  return fiber
                }))
                if (change === "disabled" || change === "covered") {
                  const error = yield* Fiber.join(clicked).pipe(Effect.flip)
                  assert(Deadline.isTimeout(error), String(error))
                  assert(
                    error.history.some((entry) =>
                      (entry.value as { _tag: string })._tag === (change === "disabled" ? "Disabled" : "Covered")
                    )
                  )
                  assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
                } else {
                  if (change === "interrupted" || change === "expired") {
                    rounds.length = 0
                    yield* locator[action]()
                  } else yield* Fiber.join(clicked)
                  assert.strictEqual(
                    yield* page.locator("#out").readText,
                    `${change === "replaced" ? "new" : "old"} clicked 1`
                  )
                }
                if (change !== "expired" && change !== "interrupted") {
                  assert(
                    rounds.filter((round) => round.request.apply).every((round) =>
                      round.request.stability === undefined
                    )
                  )
                }
                if (change !== "expired" && change !== "interrupted") {
                  const applied = rounds.find((round) => round.request.apply)
                  if (applied?.response._tag === "Ready") assert.isAtLeast(applied.frames, 2)
                }
                if (action !== "click" && change !== "disabled" && change !== "covered") {
                  assert.strictEqual(yield* locator.isChecked, action === "check")
                }
              }))
            }), timeout)
        }
      }

      // On stock WebKit, a mousedown handler that opens a dialog loses mouseup and click,
      // even though the click operation can succeed.
      if (name !== "WebKit") {
        it.effect("finishes a click whose mousedown opens a dialog", () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<button id="go" onmousedown="confirm('Go?'); out.textContent += 'down '" onmouseup="out.textContent += 'up '" onclick="out.textContent += 'click'">Go</button><p id="out"></p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#go").click()
              assert.strictEqual(yield* page.locator("#out").readText, "down up click")
            }))
          }), timeout)
      }

      it.effect("serializes competing clicks and delivers each gesture once", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<button id="go" onmousedown="out.textContent += 'down '" onmouseup="out.textContent += 'up '" onclick="out.textContent += 'click '">Go</button><p id="out"></p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const button = page.locator("#go")
            yield* Effect.all([button.click(), button.click()], { concurrency: "unbounded" })
            assert.strictEqual(yield* page.locator("#out").readText, "down up click down up click")
          }))
        }), timeout)

      it.effect("runs call site 1 up to its storage state: fill, click, and expect", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<form onsubmit="event.preventDefault(); ${
              say("'Welcome ' + this.email.value + ' (' + this.password.value.length + ')'")
            }"><label>Email <input name="email"></label><label>Password <input name="password" type="password"></label><button>Sign in</button></form>${out}`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            yield* page.getByLabel("Email").fill("me@example.com")
            yield* page.getByLabel("Password").fill(Redacted.make("hunter2"))
            yield* page.getByRole("button", { name: "Sign in" }).click()
            yield* page.getByText("Welcome me@example.com (7)").pipe(Expect.toBeVisible)
            assert.strictEqual(yield* page.getByLabel("Email").readValue, "me@example.com")
          }))
        }), timeout)

      it.effect("fills an unknown input type as text", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => `<input id="field" type="invalid-type" value="old">`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const field = page.locator("#field")
            assert.strictEqual(
              yield* page.evaluateInMainWorld(() => (document.querySelector("#field") as HTMLInputElement).type),
              "text"
            )
            yield* field.fill("new text")
            assert.strictEqual(yield* field.readValue, "new text")
          }))
        }), timeout)

      it.effect("fills, clears and types into every kind of field", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<input id="name" value="old"><textarea id="notes"></textarea><div id="rich" contenteditable="true">old</div><input id="day" type="date"><input id="keys"><div id="plain">plain</div>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const field = page.locator("#name")
            yield* field.fill("Ada")
            assert.strictEqual(yield* field.readValue, "Ada")
            yield* field.clear()
            assert.strictEqual(yield* field.readValue, "")
            yield* page.locator("#notes").fill("one\ntwo")
            assert.strictEqual(yield* page.locator("#notes").readValue, "one\ntwo")
            yield* page.locator("#rich").fill("new text")
            assert.strictEqual(yield* page.locator("#rich").readText, "new text")
            yield* page.locator("#day").fill("2026-10-23")
            assert.strictEqual(yield* page.locator("#day").readValue, "2026-10-23")
            yield* page.locator("#day").clear()
            assert.strictEqual(yield* page.locator("#day").readValue, "")
            const refused = yield* page.locator("#day").fill("soon").pipe(Effect.flip)
            assert(Locator.isLocatorError(refused) && refused.reason._tag === "InvalidInput", String(refused))
            const plain = yield* page.locator("#plain").fill("x").pipe(Effect.flip)
            assert(Locator.isLocatorError(plain) && plain.reason._tag === "NotEditable", String(plain))
            const keys = page.locator("#keys")
            yield* keys.pressSequentially(Redacted.make("héllo"), { delay: "10 millis" })
            yield* keys.press("a", { modifiers: ["Shift"] })
            assert.strictEqual(yield* keys.readValue, "hélloA")
            yield* keys.press("Backspace")
            assert.strictEqual(yield* keys.readValue, "héllo")
            const unknown = yield* keys.press("NotAKey").pipe(Effect.flip)
            assert(Locator.isLocatorError(unknown) && unknown.reason._tag === "InvalidInput", String(unknown))
          }))
        }), timeout)

      // Browsers serialize valid values differently from their source spelling.
      for (
        const [type, value, expected] of [
          ["range", "42.0", "42"],
          ["range", "1e1", "10"],
          ["range", "0", "0"],
          ["range", "100", "100"],
          ["color", "#AbCd00", "#abcd00"],
          ["datetime-local", "2020-03-02T06:20:00", "2020-03-02T06:20"],
          ["datetime-local", "2020-03-02T06:20:01.123", "2020-03-02T06:20:01.123"],
          ["datetime-local", "", ""]
        ] as const
      ) {
        it.effect(`fills normalized ${type} value ${value}`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="field" type="${type}" min="0" max="100" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#field").fill(value)
              const actual = yield* page.locator("#field").readValue
              assert.strictEqual(
                type === "range" ? Number(actual) : actual,
                type === "range" ? Number(expected) : expected
              )
              assert.strictEqual(yield* page.locator("#events").readText, "input;change;")
            }))
          }), timeout)
      }

      for (
        const [type, initial, invalid] of [
          ["range", "25", "soon"],
          ["range", "25", "101"],
          ["range", "25", "-1"],
          ["range", "25", "42.5"],
          ["range", "25", ""],
          ["range", "25", "0x19"],
          ["range", "25", "Infinity"],
          ["color", "#123456", ""],
          ["color", "#123456", "#gggggg"],
          ["datetime-local", "2020-03-02T05:15", "2020-02-30T06:20"]
        ] as const
      ) {
        it.effect(`rejects invalid ${type} value ${invalid} without mutation or events`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="field" type="${type}" min="0" max="100" value="${initial}" onfocus="events.textContent += 'focus;'" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const refused = yield* page.locator("#field").fill(invalid).pipe(Effect.flip)
              assert(Locator.isLocatorError(refused) && refused.reason._tag === "InvalidInput", String(refused))
              const state = {
                value: yield* page.locator("#field").readValue,
                events: yield* page.locator("#events").readText
              }
              assert.deepStrictEqual(state, { value: initial, events: "" })
            }))
          }), timeout)
      }

      // A focus handler runs between validation and assignment, and may change the constraints.
      it.effect("rejects a range value a focus handler's new max clamps, without events", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<input id="field" type="range" min="0" max="100" value="25" onfocus="this.max = '10'; events.textContent += 'focus;'" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const result = yield* page.locator("#field").fill("42").pipe(Effect.result)
            const state = {
              refused: result._tag === "Failure" && Locator.isLocatorError(result.failure) &&
                result.failure.reason._tag === "InvalidInput",
              value: yield* page.locator("#field").readValue,
              events: yield* page.locator("#events").readText
            }
            // Stock WebKit doesn't focus a range here, so its handler never runs and the fill stands.
            assert.deepStrictEqual(
              state,
              state.events.startsWith("focus;")
                ? { refused: true, value: "10", events: "focus;" }
                : { refused: false, value: "42", events: "input;change;" }
            )
          }))
        }), timeout)

      // Focus can remove editability after the initial actionability check.
      for (const changesType of [false, true]) {
        for (const property of ["readOnly", "disabled"] as const) {
          for (const restores of changesType ? [false] : [false, true]) {
            it.effect(
              `focus-time ${property}: ${
                restores ? "waits until editability returns" : "times out without writing or input/change events"
              }${changesType ? " after switching to text" : ""}`,
              () =>
                Effect.gen(function*() {
                  const { url } = yield* fixture(() =>
                    `<input id="field" type="date" tabindex="0" value="2020-03-02" onfocus="if (this.dataset.focused) return; this.dataset.focused = 'yes'; ${
                      changesType ? "this.type = 'text';" : ""
                    } this.${property} = true; events.textContent += 'focus;'; ${
                      restores
                        ? `setTimeout(() => { before.textContent = this.value + '|' + events.textContent; this.${property} = false; events.textContent += 'editable;'; }, 250);`
                        : ""
                    }" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p><p id="before"></p>`
                  )
                  yield* Effect.scoped(Effect.gen(function*() {
                    const page = yield* newPage
                    yield* page.goto(url)
                    const result = yield* page.locator("#field").fill("2020-03-03").pipe(
                      Deadline.within("1 second"),
                      Effect.result
                    )
                    const events = yield* page.locator("#events").readText
                    const value = yield* page.locator("#field").readValue
                    // Stock WebKit can leave date inputs unfocused. This branch covers only that path.
                    if (name === "WebKit" && !events.startsWith("focus;")) {
                      assert.deepStrictEqual({ result: result._tag, value, events }, {
                        result: "Success",
                        value: "2020-03-03",
                        events: "input;change;"
                      })
                      return
                    }
                    assert.isTrue(events.startsWith("focus;"), "the focus handler ran")
                    if (restores) {
                      assert.deepStrictEqual({
                        result: result._tag,
                        value,
                        events,
                        before: yield* page.locator("#before").readText
                      }, {
                        result: "Success",
                        value: "2020-03-03",
                        events: "focus;editable;input;change;",
                        before: "2020-03-02|focus;"
                      })
                    } else {
                      assert.deepStrictEqual({ result: result._tag, value, events }, {
                        result: "Failure",
                        value: "2020-03-02",
                        events: "focus;"
                      })
                      assert(result._tag === "Failure")
                      assert(Deadline.isTimeout(result.failure), String(result.failure))
                      assert(result.failure.history.some((entry) =>
                        (entry.value as { _tag: string })._tag === (property === "readOnly" ? "ReadOnly" : "Disabled")
                      ))
                    }
                  }))
                }),
              timeout
            )
          }
        }
      }

      // Turning a check off skips it after focus too.
      for (
        const [property, attribute, check] of [["readOnly", "readonly", "editable"], [
          "disabled",
          "disabled",
          "enabled"
        ]] as const
      ) {
        it.effect(
          `focus-time ${property}: ${check} check turned off writes the date input`,
          () =>
            Effect.gen(function*() {
              const { url } = yield* fixture(() =>
                `<input id="field" type="date" tabindex="0" value="2020-03-02" ${attribute} onfocus="events.textContent += 'focus;'" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p>`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const result = yield* page.locator("#field").fill("2020-03-03", { checks: { [check]: false } }).pipe(
                  Deadline.within("1 second"),
                  Effect.result
                )
                assert.deepStrictEqual({
                  result: result._tag,
                  value: yield* page.locator("#field").readValue
                }, { result: "Success", value: "2020-03-03" })
              }))
            }),
          timeout
        )
      }

      for (
        const [change, handler, reason] of [
          ["hidden target", `this.style.visibility='hidden'`, "NotVisible"],
          ["inert target", `this.inert=true`, "Inert"]
        ] as const
      ) {
        it.effect(
          `checks fill rendering after focus-time ${change} before native insertion`,
          () =>
            Effect.scoped(Effect.gen(function*() {
              const { url } = yield* fixture(() =>
                `<input id="go" value="old" onfocus="this.removeAttribute('onfocus');${handler}" oninput="out.textContent=this.value+':'+event.isTrusted"><output id="out">untouched</output>`
              )
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const target = page.locator("#go")
              assert(target instanceof LocatorImpl)
              // Stock WebKit needs a synthetic missing-focus notification; this does not cover native focus events.
              yield* observeChecks(target, true)
              const error = yield* target.fill("filled").pipe(Deadline.within("1 second"), Effect.flip)
              assert(Deadline.isTimeout(error), String(error))
              assert(error.history.some((entry) => (entry.value as { _tag: string })._tag === reason))
              assert.strictEqual(yield* target.readValue, "old")
              assert.strictEqual(yield* page.locator("#out").readText, "untouched")
            })),
          timeout
        )
      }

      for (const type of ["text", "date"] as const) {
        for (
          const [property, block, restore, check, reason] of [
            ["hidden", "this.style.visibility='hidden'", "this.style.visibility='visible'", "visible", "NotVisible"],
            ["inert", "this.inert=true", "this.inert=false", "notInert", "Inert"]
          ] as const
        ) {
          for (
            const mode of type === "text"
              ? ["recovery", "override"] as const
              : ["blocked", "recovery", "override"] as const
          ) {
            it.effect(`focus-time rendering: ${type} ${property} ${mode}`, () =>
              Effect.scoped(Effect.gen(function*() {
                const old = type === "date" ? "2020-03-02" : "old"
                const value = type === "date" ? "2020-03-03" : "filled"
                const { url } = yield* fixture(() =>
                  `<input id="go" type="${type}" value="${old}" onfocus="this.removeAttribute('onfocus');${block};${
                    mode === "recovery"
                      ? `setTimeout(() => { before.textContent=this.value+'|'+out.textContent; ${restore} }, 250)`
                      : ""
                  }" oninput="out.textContent='input'" onchange="out.textContent+=';change'"><output id="out">untouched</output><output id="before"></output>`
                )
                const page = yield* Browser.newPage()
                yield* page.goto(url)
                const target = page.locator("#go")
                assert(target instanceof LocatorImpl)
                // WebKit uses a synthetic missing-focus notification with native insertion, not native focus-event coverage.
                yield* observeChecks(target, true)
                const result = yield* target.fill(value, {
                  checks: mode === "override" ? { [check]: false } : {}
                }).pipe(Deadline.within("1 second"), Effect.result)
                if (mode === "blocked") {
                  assert(result._tag === "Failure")
                  assert(Deadline.isTimeout(result.failure), String(result.failure))
                  assert(result.failure.history.some((entry) => (entry.value as { _tag: string })._tag === reason))
                  assert.strictEqual(yield* target.readValue, old)
                  assert.strictEqual(yield* page.locator("#out").readText, "untouched")
                } else {
                  assert.strictEqual(result._tag, "Success")
                  if (mode === "recovery") {
                    assert.strictEqual(yield* page.locator("#before").readText, old + "|untouched")
                    assert.strictEqual(yield* target.readValue, value)
                    assert.isTrue((yield* page.locator("#out").readText).startsWith("input"))
                  } else if (type === "date") {
                    assert.strictEqual(yield* target.readValue, value)
                    assert.strictEqual(yield* page.locator("#out").readText, "input;change")
                  }
                  // An override skips readiness; native typing can still refuse a hidden or inert target.
                }
              })), timeout)
          }
        }
      }

      // A text input takes the typing path; a focus handler can make it read-only there too.
      it.effect("focus-time readOnly: a text input times out with ReadOnly, unchanged", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<input id="field" type="text" value="old" onfocus="this.readOnly = true; events.textContent += 'focus;'" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const result = yield* page.locator("#field").fill("new").pipe(
              Deadline.within("1 second"),
              Effect.result
            )
            const state = {
              result: result._tag,
              timeout: result._tag === "Failure" && Deadline.isTimeout(result.failure) &&
                result.failure.history.some((entry) => (entry.value as { _tag: string })._tag === "ReadOnly"),
              value: yield* page.locator("#field").readValue,
              events: yield* page.locator("#events").readText
            }
            // Stock WebKit leaves this input unfocused, so the read-only transition is unexercised.
            if (name === "WebKit" && !state.events.startsWith("focus;")) {
              assert.deepStrictEqual(state, {
                result: "Success",
                timeout: false,
                value: "new",
                events: "input;input;input;"
              })
              return
            }
            assert.deepStrictEqual(state, { result: "Failure", timeout: true, value: "old", events: "focus;" })
          }))
        }), timeout)

      for (const property of ["readOnly", "disabled"] as const) {
        for (const mode of ["blocked", "restored", "override"] as const) {
          it.effect(`focus-time ${property}: text fill ${mode}`, () =>
            Effect.gen(function*() {
              const { url } = yield* fixture(() =>
                `<input id="field" type="text" value="old" onfocus="if (this.dataset.focused) return; this.dataset.focused = 'yes'; this.${property} = true; events.textContent += 'focus;'; ${
                  mode === "restored"
                    ? `setTimeout(() => { before.textContent = this.value + '|' + events.textContent; this.${property} = false; events.textContent += 'editable;'; }, 250);`
                    : ""
                }" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p><p id="before"></p>`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const result = yield* page.locator("#field").fill("new", {
                  checks: mode === "override" ? { [property === "readOnly" ? "editable" : "enabled"]: false } : {}
                }).pipe(Deadline.within("1 second"), Effect.result)
                const state = {
                  result: result._tag,
                  value: yield* page.locator("#field").readValue,
                  events: yield* page.locator("#events").readText
                }
                // This asserts WebKit's unchanged typing path, not a post-focus transition.
                if (name === "WebKit" && !state.events.startsWith("focus;")) {
                  assert.deepStrictEqual(state, { result: "Success", value: "new", events: "input;input;input;" })
                  return
                }
                if (mode === "blocked") {
                  assert.deepStrictEqual(state, { result: "Failure", value: "old", events: "focus;" })
                  assert(result._tag === "Failure")
                  assert(Deadline.isTimeout(result.failure), String(result.failure))
                  assert(result.failure.history.some((entry) =>
                    (entry.value as { _tag: string })._tag === (property === "readOnly" ? "ReadOnly" : "Disabled")
                  ))
                } else if (mode === "restored") {
                  assert.deepStrictEqual(state, {
                    result: "Success",
                    value: "new",
                    events: name === "Chromium" ? "focus;editable;input;" : "focus;editable;input;input;input;"
                  })
                  assert.strictEqual(yield* page.locator("#before").readText, "old|focus;")
                } else {
                  // Skipping actionability does not bypass the browser's native typing restrictions.
                  assert.deepStrictEqual(state, { result: "Success", value: "old", events: "focus;" })
                }
              }))
            }), timeout)
        }
      }

      // A focus handler can also make the typing target a kind that takes no text at all.
      for (
        const [kind, html] of [
          [
            "contenteditable off",
            `<div id="field" contenteditable="true" onfocus="this.contentEditable = 'false'; events.textContent += 'focus;'" oninput="events.textContent += 'input;'">old</div><p id="events"></p>`
          ],
          [
            "type checkbox",
            `<input id="field" type="text" value="old" onfocus="this.type = 'checkbox'; events.textContent += 'focus;'" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p>`
          ]
        ] as const
      ) {
        for (const editable of [true, false]) {
          it.effect(
            `focus-time ${kind}: text fill ${
              editable ? "fails NotEditable, unchanged" : "skips NotEditable with editable check off"
            }`,
            () =>
              Effect.gen(function*() {
                const { url } = yield* fixture(() => html)
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* newPage
                  yield* page.goto(url)
                  const result = yield* page.locator("#field").fill("new", { checks: { editable } }).pipe(
                    Deadline.within("1 second"),
                    Effect.result
                  )
                  const field = page.locator("#field")
                  const state = {
                    notEditable: result._tag === "Failure" && Locator.isLocatorError(result.failure) &&
                      result.failure.reason._tag === "NotEditable",
                    value: kind === "type checkbox" ? yield* field.readValue : yield* field.readText,
                    events: yield* page.locator("#events").readText
                  }
                  // Stock WebKit may leave the target unfocused; then the transition is unexercised.
                  if (name === "WebKit" && !state.events.startsWith("focus;")) {
                    assert.strictEqual(result._tag, "Success")
                    assert.deepStrictEqual(state, { notEditable: false, value: "new", events: "input;input;input;" })
                    return
                  }
                  assert.strictEqual(result._tag, editable ? "Failure" : "Success")
                  assert.deepStrictEqual(
                    state,
                    { notEditable: editable, value: "old", events: "focus;" },
                    String(result)
                  )
                }))
              }),
            timeout
          )
        }
      }

      for (const type of ["range", "file", "checkbox"] as const) {
        it.effect(`rejects a date fill after a focus handler changes type to ${type}`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="field" type="date" tabindex="0" value="2020-03-02" onfocus="this.type = '${type}'; before.textContent = this.value; events.textContent += 'focus;'" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="before"></p><p id="events"></p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const result = yield* page.locator("#field").fill("2020-03-03").pipe(Effect.result)
              const state = {
                refused: result._tag === "Failure" && Locator.isLocatorError(result.failure) &&
                  result.failure.reason._tag === "InvalidInput",
                value: yield* page.locator("#field").readValue,
                events: yield* page.locator("#events").readText
              }
              // As with range, stock WebKit may leave this input unfocused; then its type stays date.
              assert.deepStrictEqual(
                state,
                state.events.startsWith("focus;")
                  ? { refused: true, value: yield* page.locator("#before").readText, events: "focus;" }
                  : { refused: false, value: "2020-03-03", events: "input;change;" }
              )
            }))
          }), timeout)
      }

      for (
        const [type, initial, value] of [["date", "2020-03-02", "2020-03-03"], ["time", "12:30", "12:34"]] as const
      ) {
        it.effect(
          `rejects invalid numeric text after a focus handler changes ${type} to number`,
          () =>
            Effect.gen(function*() {
              const { url } = yield* fixture(() =>
                `<input id="field" type="${type}" tabindex="0" value="${initial}" onfocus="this.type = 'number'; this.value = '7'; before.textContent = this.value; events.textContent += 'focus;'" onkeydown="events.textContent += 'keydown;'" onbeforeinput="events.textContent += 'beforeinput;'" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="before"></p><p id="events"></p>`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const result = yield* page.locator("#field").fill(value).pipe(Effect.result)
                const state = {
                  refused: result._tag === "Failure" && Locator.isLocatorError(result.failure) &&
                    result.failure.reason._tag === "InvalidInput",
                  value: yield* page.locator("#field").readValue,
                  events: yield* page.locator("#events").readText
                }
                assert.deepStrictEqual(
                  state,
                  state.events.startsWith("focus;")
                    ? { refused: true, value: "7", events: "focus;" }
                    : { refused: false, value, events: "input;change;" }
                )
                if (state.events.startsWith("focus;")) {
                  assert.strictEqual(yield* page.locator("#before").readText, "7")
                }
              }))
            }),
          timeout
        )
      }

      it.effect("fills as text after a focus handler changes a date input to text", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<input id="field" type="date" tabindex="0" value="2020-03-02" onfocus="this.type = 'text'">`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            yield* page.locator("#field").fill("2020-03-03")
            assert.strictEqual(yield* page.locator("#field").readValue, "2020-03-03")
          }))
        }), timeout)

      for (
        const [label, value] of [
          ["number", 123],
          ["null", null],
          ["undefined", undefined],
          ["boolean", true],
          ["object", {}],
          ["array", ["private-caller-value"]],
          ["Redacted number", Redacted.make(123)],
          ["Redacted null", Redacted.make(null)],
          ["Redacted object", Redacted.make({ secret: "private-caller-value" })],
          ["Redacted array", Redacted.make(["private-caller-value"])]
        ] as const
      ) {
        it.effect(`pressSequentially rejects ${label} without mutation or events`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="field" value="old" onfocus="events.textContent += 'focus;'" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const field = page.locator("#field")
              const result = yield* Effect.suspend(() => field.pressSequentially(value as unknown as string)).pipe(
                Effect.exit
              )
              const error = result._tag === "Failure" ? Cause.findErrorOption(result.cause) : Option.none()
              assert.deepStrictEqual({
                value: yield* field.readValue,
                events: yield* page.locator("#events").readText,
                reason: Option.isSome(error) && Locator.isLocatorError(error.value)
                  ? error.value.reason._tag
                  : result._tag
              }, { value: "old", events: "", reason: "InvalidInput" })
              assert.notInclude(JSON.stringify(result), "private-caller-value")
            }))
          }), timeout)
      }

      it.effect("pressSequentially preserves strings and Redacted strings", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => `<input id="field">`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const field = page.locator("#field")
            for (const value of ["123", Redacted.make("abc"), "", Redacted.make("")]) {
              yield* field.clear()
              yield* field.pressSequentially(value)
              assert.strictEqual(yield* field.readValue, Redacted.isRedacted(value) ? Redacted.value(value) : value)
            }
          }))
        }), timeout)

      // JavaScript callers bypass the string type, including inside Redacted.
      for (
        const [label, value] of [
          ["number", 123],
          ["null", null],
          ["undefined", undefined],
          ["boolean", true],
          ["object", {}],
          ["Redacted number", Redacted.make(123)],
          ["nonnumeric text", "abc"],
          ["whitespace", " "],
          ["hexadecimal", "0x10"],
          ["infinity", "Infinity"],
          ["overflow", "1e309"],
          ["leading plus", "+1"],
          ["trailing decimal point", "1."],
          ["incomplete exponent", "1e"],
          ["Redacted nonnumeric text", Redacted.make("abc")]
        ] as const
      ) {
        it.effect(`fill rejects ${label} without mutation or events`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="field" type="number" value="42" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="events"></p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const field = page.locator("#field")
              const result = yield* field.fill(value as unknown as string).pipe(Effect.exit)
              const error = result._tag === "Failure" ? Cause.findErrorOption(result.cause) : Option.none()
              assert.deepStrictEqual({
                value: yield* field.readValue,
                events: yield* page.locator("#events").readText,
                reason: Option.isSome(error) && Locator.isLocatorError(error.value)
                  ? error.value.reason._tag
                  : result._tag
              }, { value: "42", events: "", reason: "InvalidInput" })
            }))
          }), timeout)
      }

      it.effect(
        "fill preserves valid numeric strings, Redacted strings and empty clearing",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() => `<input id="field" type="number" value="42">`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const field = page.locator("#field")
              for (const value of ["123", "-12.5", ".5", "1e2", "-0", Redacted.make("7"), "", Redacted.make("")]) {
                yield* field.fill(value)
                assert.strictEqual(yield* field.readValue, Redacted.isRedacted(value) ? Redacted.value(value) : value)
              }
            }))
          }),
        timeout
      )

      it.effect("fill rejects number-input text without focusing the input", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<input id="other"><input id="field" type="number" value="42" onfocus="events.textContent += 'focus;'" onselect="events.textContent += 'select;'"><p id="events"></p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            yield* page.locator("#other").focus()
            yield* page.locator("#field").fill("abc").pipe(Effect.exit)
            assert.strictEqual(yield* page.locator("#events").readText, "")
            yield* page.keyboard.press("z")
            assert.strictEqual(yield* page.locator("#other").readValue, "z")
          }))
        }), timeout)

      it.effect("fill ignores a number input's min, max and step", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => `<input id="field" type="number" min="10" max="20" step="3" value="13">`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const field = page.locator("#field")
            for (const value of ["5", "25", "14.5"]) {
              yield* field.fill(value)
              assert.strictEqual(yield* field.readValue, value)
            }
          }))
        }), timeout)

      it.effect(
        "fills an inherited editable descendant across frames without replacing surrounding content",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture((origin) =>
              `<div id="parent" contenteditable>old parent</div><iframe src="${
                fixtureUrl(
                  origin,
                  `<body contenteditable onfocus="getSelection().selectAllChildren(this)"><p id="before">before</p><section><p id="target">old</p></section><p id="after">after</p></body>`
                )
              }"></iframe>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#parent").fill("parent")
              const frame = page.frame(page.locator("iframe"))
              yield* frame.locator("#target").fill("new")
              assert.strictEqual(yield* frame.locator("#target").readText, "new")
              assert.strictEqual(yield* frame.locator("#before").readText, "before")
              assert.strictEqual(yield* frame.locator("#after").readText, "after")
              assert.strictEqual(yield* page.locator("#parent").readText, "parent")
            }))
          }),
        timeout
      )

      it.effect(
        "fills an input then a paragraph in a top-level design-mode document",
        (context) =>
          Effect.gen(function*() {
            if (!(yield* supports("input.topLevelDesignMode"))) {
              context.skip("Firefox cannot focus inputs in top-level design-mode documents; native typing reaches BODY")
            }
            const { url } = yield* fixture(() =>
              "<input id=\"other\"><p id=\"target\">old</p><script>document.designMode = \"on\"</script>"
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#other").fill("other")
              yield* page.locator("#target").fill("new")
              assert.deepStrictEqual({
                input: yield* page.locator("#other").readValue,
                paragraph: yield* page.locator("#target").readText
              }, { input: "other", paragraph: "new" })
            }))
          }),
        timeout
      )

      for (
        const change of [
          "replace",
          "detach",
          "hide",
          "inert",
          "disable",
          "disable with checks off",
          "readonly",
          "readonly with checks off",
          "restore"
        ] as const
      ) {
        it.effect(
          `rechecks a top-level design-mode target when blur handlers ${change} it`,
          (context) =>
            Effect.gen(function*() {
              if (!(yield* supports("input.topLevelDesignMode"))) {
                context.skip(
                  "Firefox cannot focus inputs in top-level design-mode documents; native typing reaches BODY"
                )
              }
              const mutation = change === "replace"
                ? "target.outerHTML = \"<p id=target>replacement</p>\""
                : change === "detach"
                ? "target.remove()"
                : change === "hide"
                ? "target.style.display = \"none\""
                : change === "inert"
                ? "target.inert = true"
                : change === "restore"
                ? "target.style.display = \"none\"; setTimeout(() => target.style.display = \"\", 100)"
                : change.startsWith("readonly")
                ? "target.setAttribute(\"aria-readonly\", \"true\")"
                : "target.setAttribute(\"aria-disabled\", \"true\")"
              const { url } = yield* fixture(() =>
                `<input id="other"><p id="target">old</p><script>
              document.designMode = "on";
              document.getElementById("other").onblur = () => {
                document.body.dataset.blurred = "yes";
                const target = document.getElementById("target");
                ${mutation};
              };
              </script>`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                yield* page.activate
                yield* page.locator("#other").click()
                yield* page.locator("#other").fill("other")
                if (
                  change === "replace" || change === "restore" || change === "disable with checks off" ||
                  change === "readonly with checks off"
                ) {
                  yield* page.locator("#target").fill("new", {
                    checks: {
                      enabled: change !== "disable with checks off",
                      editable: change !== "readonly with checks off"
                    }
                  }).pipe(Deadline.within("3 seconds"))
                  assert.strictEqual(yield* page.locator("#target").readText, "new")
                } else {
                  // WebKit makes inert content non-editable too; isolate the inert check on every backend.
                  const error = yield* page.locator("#target").fill("new", {
                    checks: { editable: change !== "inert" }
                  }).pipe(
                    Deadline.within("1 second"),
                    Effect.flip
                  )
                  assert(Deadline.isTimeout(error), String(error))
                  const expected = {
                    detach: "NoMatch",
                    hide: "NotVisible",
                    inert: "Inert",
                    disable: "Disabled",
                    readonly: "ReadOnly"
                  }[change]
                  assert(error.history.some((entry) => (entry.value as { _tag: string })._tag === expected))
                  if (change !== "detach") assert.strictEqual(yield* page.locator("#target").readText, "old")
                }
                assert.strictEqual(yield* page.locator("#other").readValue, "other")
                assert.strictEqual(yield* page.evaluateInMainWorld(() => document.body.dataset.blurred), "yes")
              }))
            }),
          timeout
        )
      }

      it.effect(
        "fills a paragraph after an input in a shadow root of a top-level design-mode document",
        (context) =>
          Effect.gen(function*() {
            if (!(yield* supports("input.topLevelDesignMode"))) {
              context.skip("Firefox cannot focus inputs in top-level design-mode documents; native typing reaches BODY")
            }
            const { url } = yield* fixture(() =>
              `<div id="host"></div><p id="target">old</p><script>
              document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = "<input id=other>";
              document.designMode = "on";
              </script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#other").fill("other")
              yield* page.locator("#target").fill("new")
              assert.deepStrictEqual({
                input: yield* page.locator("#other").readValue,
                paragraph: yield* page.locator("#target").readText
              }, { input: "other", paragraph: "new" })
            }))
          }),
        timeout
      )

      it.effect(
        "fills safely or reports the blocker when a top-level design-mode blur handler refocuses the input",
        (context) =>
          Effect.gen(function*() {
            if (!(yield* supports("input.topLevelDesignMode"))) {
              context.skip("Firefox cannot focus inputs in top-level design-mode documents; native typing reaches BODY")
            }
            const { url } = yield* fixture(() =>
              `<input id="other"><p id="target">old</p><script>
              document.designMode = "on";
              const other = document.getElementById("other");
              other.onblur = () => {
                document.body.dataset.blurs = String(Number(document.body.dataset.blurs ?? 0) + 1);
                setTimeout(() => {
                  other.focus();
                  document.body.dataset.refocuses = String(Number(document.body.dataset.refocuses ?? 0) + 1);
                });
              };
              </script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.activate
              yield* page.locator("#other").click()
              yield* page.locator("#other").fill("other")
              const error = yield* page.locator("#target").fill("new").pipe(
                Deadline.within("1 second"),
                Effect.match({ onSuccess: () => undefined, onFailure: (error) => error })
              )
              assert.isAbove(
                yield* page.evaluateInMainWorld(() => Number(document.body.dataset.blurs ?? 0)),
                0,
                "the native blur handler must execute"
              )
              assert.strictEqual(yield* page.locator("#other").readValue, "other")
              // Scheduled refocus can race insertion. Successful completion is valid only on the intended target.
              assert.strictEqual(yield* page.locator("#target").readText, error === undefined ? "new" : "old")
              if (error !== undefined) {
                assert(Deadline.isTimeout(error), String(error))
                assert.isAbove(
                  yield* page.evaluateInMainWorld(() => Number(document.body.dataset.refocuses ?? 0)),
                  0,
                  "the asynchronous handler must run before it can block filling"
                )
                // A confirmed focus blocker was not sent. An unanswered apply call may have mutated the page,
                // so its dispatch stays unconfirmed even when earlier rounds reported PreparingFocus.
                assert.oneOf(JSON.stringify([error.phase, error.diagnostics.dispatch]), [
                  JSON.stringify(["waitingForCondition", { _tag: "NotSent" }]),
                  JSON.stringify(["dispatchedUnconfirmed", { _tag: "MayHaveBeenSent" }])
                ])
                // The target exists and passes every check. The focus blocker must not erase that evidence.
                assert(
                  error.history.some((entry) => {
                    const value = entry.value as { _tag: string; from?: string }
                    return value._tag === "PreparingFocus" && value.from?.includes("#other")
                  }),
                  JSON.stringify(error.history)
                )
              }
            }))
          }),
        timeout
      )

      it.effect("fills a paragraph of a design-mode frame after filling the parent", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture((origin) =>
            `<div id="parent" contenteditable>old parent</div><iframe src="${
              fixtureUrl(origin, `<body><p id="target">old</p><script>document.designMode = "on"</script></body>`)
            }"></iframe>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            yield* page.locator("#parent").fill("parent")
            const frame = page.frame(page.locator("iframe"))
            yield* frame.locator("#target").fill("new")
            assert.strictEqual(yield* frame.locator("#target").readText, "new")
            assert.strictEqual(yield* page.locator("#parent").readText, "parent")
          }))
        }), timeout)

      // Selection and checked state are independent on these ARIA roles.
      for (const role of ["option", "treeitem"] as const) {
        for (
          const [state, attributes, expected] of [
            ["checked", "aria-checked=\"true\" aria-selected=\"false\"", true],
            ["unchecked", "aria-checked=\"false\" aria-selected=\"true\"", false]
          ] as const
        ) {
          it.effect(`reads ${role} checked state from aria-checked when ${state}`, () =>
            Effect.gen(function*() {
              const { url } = yield* fixture(() => `<div id="target" role="${role}" ${attributes}>Item</div>`)
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const target = page.locator("#target")
                assert.strictEqual(yield* target.isChecked, expected)
              }))
            }), timeout)
        }

        it.effect(`expects ${role} checked state independently of selection`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<div id="target" role="${role}" aria-checked="true" aria-selected="false">Item</div>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#target").pipe(Expect.toBeChecked, Deadline.within("1 second"))
            }))
          }), timeout)

        for (const initial of [false, true] as const) {
          const checked = initial !== true
          it.effect(
            `${checked ? "checks" : "unchecks"} ${role} with aria-checked ${String(initial)}`,
            () =>
              Effect.gen(function*() {
                const { url } = yield* fixture(() =>
                  `<div id="target" role="${role}" aria-checked="${initial}" aria-selected="${!initial}" onclick="this.setAttribute('aria-checked', '${checked}')">Item</div>`
                )
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* newPage
                  yield* page.goto(url)
                  const target = page.locator("#target")
                  yield* checked ? target.check() : target.uncheck()
                  assert.deepStrictEqual(yield* target.readAttribute("aria-checked"), Option.some(String(checked)))
                }))
              }),
            timeout
          )
        }

        it.effect(`snapshots ${role} checked and selected independently`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<div role="${role}" aria-label="Checked" aria-checked="true" aria-selected="false">Checked</div><div role="${role}" aria-label="Selected" aria-checked="false" aria-selected="true">Selected</div><div role="${role}" aria-label="Both" aria-checked="true" aria-selected="true">Both</div>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const snapshot = yield* page.snapshot()
              const nodes = [...snapshot.refs.values()]
              const checked = nodes.find((node) => node.name._tag === "Accessible" && node.name.value === "Checked")!
              const selected = nodes.find((node) => node.name._tag === "Accessible" && node.name.value === "Selected")!
              assert.isTrue(checked.states.has("checked"))
              assert.isFalse(checked.states.has("selected"))
              assert.isFalse(selected.states.has("checked"))
              assert.isTrue(selected.states.has("selected"))
              const both = nodes.find((node) => node.name._tag === "Accessible" && node.name.value === "Both")!
              assert.isTrue(both.states.has("checked"))
              assert.isTrue(both.states.has("selected"))
            }))
          }), timeout)
      }

      for (
        const role of [
          "checkbox",
          "radio",
          "switch",
          "menuitemcheckbox",
          "menuitemradio",
          "option",
          "treeitem"
        ] as const
      ) {
        it.effect(`interprets checked keywords consistently for ${role}`, () =>
          Effect.gen(function*() {
            const tokens = ["true", "TRUE", "True", "false", "FALSE", "False", "mixed", "MIXED", "Mixed"]
            const { url } = yield* fixture(() =>
              tokens.map((token, i) =>
                `<div id="token${i}" role="${role}" aria-label="Token${i}" aria-checked="${token}" onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked').toLowerCase() === 'true' ? 'false' : 'true')">Token${i}</div>`
              ).join("")
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const snapshot = yield* page.snapshot()
              for (const [i, token] of tokens.entries()) {
                const target = page.locator(`#token${i}`)
                const checked = i < 3
                const mixed = i >= 6 && ["checkbox", "menuitemcheckbox", "option", "treeitem"].includes(role)
                assert.strictEqual(yield* target.isChecked, checked, token)
                for (const value of [true, false]) {
                  assert.strictEqual(
                    yield* page.getByRole(role, { name: `Token${i}`, exact: true, checked: value }).count,
                    !mixed && checked === value ? 1 : 0,
                    token
                  )
                }
                const node = [...snapshot.refs.values()].find((node) =>
                  node.name._tag === "Accessible" && node.name.value === `Token${i}`
                )!
                assert.strictEqual(node.states.has("checked"), checked, token)
                // Exercise actual clicks and their postconditions, including the boolean view of mixed.
                if (checked) {
                  yield* target.check()
                  yield* target.uncheck()
                  assert.isFalse(yield* target.isChecked)
                } else {
                  yield* target.uncheck()
                  yield* target.check()
                  assert.isTrue(yield* target.isChecked)
                }
              }
            }))
          }), timeout)
      }

      // Optional checkability must be established before dispatching input. Check and uncheck read it the same way
      for (const kind of ["option", "treeitem", "native option"] as const) {
        for (
          const state of [
            "absent",
            "undefined",
            "empty",
            "UNDEFINED",
            "Undefined",
            " ",
            "\t\n",
            " true ",
            " false ",
            " mixed ",
            " undefined ",
            "yes",
            "bogus"
          ] as const
        ) {
          for (const operation of ["read", "check"] as const) {
            it.effect(
              `rejects ${kind} checked ${operation} before input when aria-checked is ${state}`,
              () =>
                Effect.gen(function*() {
                  const attribute = state === "absent"
                    ? ""
                    : state === "empty"
                    ? "aria-checked=\"\""
                    : `aria-checked="${state}"`
                  const { url } = yield* fixture(() =>
                    `${
                      kind === "native option"
                        ? `<select id="selection" size="2"><option value="a" selected>First</option><option id="target" value="b" ${attribute}>Second</option></select>`
                        : `<div id="target" role="${kind}" aria-selected="true" ${attribute}>Item</div>`
                    }<script>document.body.dataset.events = '0';
                  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'input', 'change', 'focusin', 'keydown']) {
                    document.addEventListener(type, () => { document.body.dataset.events = String(Number(document.body.dataset.events) + 1) }, true)
                  }</script>`
                  )
                  yield* Effect.scoped(Effect.gen(function*() {
                    const page = yield* newPage
                    yield* page.goto(url)
                    const target = page.locator("#target")
                    if (operation === "read") {
                      for (const checked of [true, false]) {
                        assert.strictEqual(
                          yield* page.getByRole(kind === "native option" ? "option" : kind, { checked }).count,
                          0
                        )
                      }
                      const snapshot = yield* page.snapshot()
                      assert.isFalse([...snapshot.refs.values()].some((node) => node.states.has("checked")))
                    }
                    const failure = yield* (operation === "read" ? target.isChecked : target.check()).pipe(
                      Effect.match({
                        onFailure: (error) => error,
                        onSuccess: () => undefined
                      })
                    )
                    assert.deepStrictEqual(yield* page.locator("body").readAttribute("data-events"), Option.some("0"))
                    if (kind === "native option") {
                      assert.strictEqual(yield* page.locator("#selection").readValue, "a")
                    }
                    assert(Locator.isLocatorError(failure) && failure.reason._tag === "WrongElement", String(failure))
                  }))
                }),
              timeout
            )
          }
        }
      }

      for (const role of ["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"] as const) {
        it.effect(`preserves ${role} checked defaults and actions`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<div id="target" role="${role}" onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') === 'true' ? 'false' : 'true')">Item</div><div id="undefined" role="${role}" aria-checked="undefined">Undefined</div>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const target = page.locator("#target")
              assert.isFalse(yield* target.isChecked)
              assert.isFalse(yield* page.locator("#undefined").isChecked)
              for (
                const token of [
                  "",
                  "undefined",
                  "UNDEFINED",
                  "Undefined",
                  " ",
                  "\t\n",
                  " true ",
                  " false ",
                  " mixed ",
                  " undefined ",
                  "yes",
                  "bogus"
                ]
              ) {
                yield* page.evaluateInMainWorld(
                  (token) => document.getElementById("undefined")!.setAttribute("aria-checked", token),
                  token
                )
                assert.isFalse(yield* page.locator("#undefined").isChecked, token)
                assert.strictEqual(yield* page.getByRole(role, { name: "Undefined", checked: false }).count, 1, token)
                const snapshot = yield* page.snapshot()
                assert.isFalse([...snapshot.refs.values()].some((node) => node.states.has("checked")), token)
              }
              yield* target.check()
              assert.isTrue(yield* target.isChecked)
              yield* target.uncheck()
              assert.isFalse(yield* target.isChecked)
            }))
          }), timeout)
      }

      it.effect(
        "preserves native checkbox and radio checked properties over ARIA states",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="checkbox" type="checkbox" role="option" aria-checked="undefined"><input id="radio" type="radio" role="treeitem" aria-checked="false"><input id="checked" type="checkbox" checked aria-checked="false">`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              for (const id of ["checkbox", "radio"]) {
                const target = page.locator(`#${id}`)
                assert.isFalse(yield* target.isChecked)
                yield* target.check()
                assert.isTrue(yield* target.isChecked)
              }
              yield* page.locator("#checkbox").uncheck()
              assert.isFalse(yield* page.locator("#checkbox").isChecked)
              assert.isTrue(yield* page.locator("#checked").isChecked)
            }))
          }),
        timeout
      )

      for (const action of ["check", "uncheck"] as const) {
        it.effect(`chooses a reachable label fragment while performing ${action}`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<style>body{margin:0;font:16px/24px monospace}#wrap{position:absolute;left:20px;top:60px;width:240px}#cover{position:fixed;left:0;top:0;width:400px;height:84px}</style><input id="box" type="checkbox" ${
                action === "uncheck" ? "checked" : ""
              } onchange="out.textContent += event.isTrusted + ' '"><div id="wrap"><label id="label" for="box">${
                Array(6).fill("abcdefghij").join(" ")
              }</label></div><div id="cover"></div><output id="out" style="position:absolute;top:260px"></output>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              assert.isAbove(
                yield* page.evaluateInMainWorld(() => document.getElementById("label")!.getClientRects().length),
                1
              )
              yield* page.locator("#label")[action]().pipe(Deadline.within("2 seconds"))
              assert.strictEqual(yield* page.locator("#box").isChecked, action === "check")
              assert.strictEqual(yield* page.locator("#out").readText, "true")
            }))
          }), timeout)

        for (const stable of [false, 2, 4] as const) {
          it.effect(
            `offers immediate ${action} stability evidence with ${stable} frames`,
            () =>
              Effect.gen(function*() {
                const { url } = yield* fixture(() =>
                  `<input id="box" type="checkbox" ${
                    action === "uncheck" ? "checked" : ""
                  } onchange="out.textContent += event.isTrusted + ' '"><output id="out"></output>`
                )
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* newPage
                  yield* page.goto(url)
                  const box = page.locator("#box")
                  assert(box instanceof LocatorImpl)
                  const rounds = yield* observeChecks(box)
                  yield* box[action]({ checks: { stable: stable === false ? false : { frames: stable } } })
                  assert.strictEqual(rounds.length, 2)
                  assert.strictEqual(rounds[0]!.request.checks.stable, stable === false ? 0 : stable)
                  if (stable === false) {
                    assert.strictEqual(rounds[0]!.request.stability, undefined)
                    assert.strictEqual(rounds[1]!.request.stability, undefined)
                    assert.isAtLeast(rounds[1]!.frames, 1)
                  } else {
                    assert.strictEqual(rounds[0]!.request.stability, "capture")
                    const first = rounds[0]!.response
                    assert(first._tag === "Ready" && typeof first.stability === "string")
                    assert.strictEqual(rounds[1]!.request.stability, first.stability)
                    assert.strictEqual(rounds[0]!.frames, stable)
                  }
                  assert.strictEqual(yield* box.isChecked, action === "check")
                  assert.strictEqual(yield* page.locator("#out").readText, "true")
                }))
              }),
            timeout
          )
        }

        for (const trial of [false, true]) {
          it.effect(`keeps an already-correct ${action} a no-op with trial ${trial}`, () =>
            Effect.gen(function*() {
              const { url } = yield* fixture(() =>
                `<input id="box" type="checkbox" ${
                  action === "check" ? "checked" : ""
                } onclick="out.textContent += 'click '"><output id="out"></output>`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const box = page.locator("#box")
                assert(box instanceof LocatorImpl)
                const rounds = yield* observeChecks(box)
                yield* box[action]({ trial })
                assert.strictEqual(rounds.length, 0)
                assert.strictEqual(yield* box.isChecked, action === "check")
                assert.strictEqual(yield* page.locator("#out").readText, "")
              }))
            }), timeout)
        }

        it.effect(`revalidates a trial ${action} without input or state changes`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="box" type="checkbox" ${
                action === "uncheck" ? "checked" : ""
              } onclick="out.textContent += 'click '"><output id="out"></output>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const box = page.locator("#box")
              assert(box instanceof LocatorImpl)
              const rounds = yield* observeChecks(box)
              yield* box[action]({ trial: true })
              assert.strictEqual(rounds.length, 2)
              const first = rounds[0]!.response
              assert(first._tag === "Ready" && typeof first.stability === "string")
              assert.strictEqual(rounds[1]!.request.stability, first.stability)
              assert(rounds.every((round) => !round.request.apply))
              assert.strictEqual(yield* box.isChecked, action === "uncheck")
              assert.strictEqual(yield* page.locator("#out").readText, "")
              // A trial leaves no guard or held permit behind.
              yield* box[action]()
              assert.strictEqual(yield* box.isChecked, action === "check")
              assert.strictEqual(yield* page.locator("#out").readText, "click")
            }))
          }), timeout)

        it.effect(`resamples expired ${action} evidence under the immediate permit`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="box" type="checkbox" ${
                action === "uncheck" ? "checked" : ""
              } onchange="out.textContent += event.isTrusted + ' '"><output id="out"></output>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const box = page.locator("#box")
              assert(box instanceof LocatorImpl)
              const rounds = yield* observeChecks(box)
              const input = box.owner.page.input
              const original = input.withPermitsIfAvailable
              const available = original.bind(input)
              yield* Effect.acquireRelease(
                Effect.sync(() => {
                  input.withPermitsIfAvailable = (permits) => (effect) =>
                    available(permits)(Effect.andThen(
                      page.evaluateInMainWorld(() =>
                        new Promise<void>((resolve) =>
                          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
                        )
                      ).pipe(Effect.orDie),
                      effect
                    ))
                }),
                () =>
                  Effect.sync(() => {
                    input.withPermitsIfAvailable = original
                  })
              )
              yield* box[action]()
              assert.strictEqual(rounds.length, 2)
              assert.strictEqual(rounds[0]!.request.stability, "capture")
              assert.strictEqual(typeof rounds[1]!.request.stability, "string")
              assert.isAtLeast(rounds[1]!.frames, 2)
              assert.strictEqual(yield* box.isChecked, action === "check")
              assert.strictEqual(yield* page.locator("#out").readText, "true")
            }))
          }), timeout)

        it.effect(`serializes competing ${action} actions and confirms each state`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="a" type="checkbox" ${
                action === "uncheck" ? "checked" : ""
              } onchange="out.textContent += this.id + ':' + event.isTrusted + ' '"><input id="b" type="checkbox" ${
                action === "uncheck" ? "checked" : ""
              } onchange="out.textContent += this.id + ':' + event.isTrusted + ' '"><output id="out"></output>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* Effect.all([page.locator("#a")[action](), page.locator("#b")[action]()], {
                concurrency: "unbounded"
              })
              assert.strictEqual(yield* page.locator("#a").isChecked, action === "check")
              assert.strictEqual(yield* page.locator("#b").isChecked, action === "check")
              assert.deepStrictEqual((yield* page.locator("#out").readText).trim().split(" ").sort(), [
                "a:true",
                "b:true"
              ])
            }))
          }), timeout)

        it.effect(`takes new evidence and acts once after the guard stops a ${action}`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="box" type="checkbox" ${
                action === "uncheck" ? "checked" : ""
              } onclick="out.textContent += 'click '"><output id="out"></output>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const box = page.locator("#box")
              assert(box instanceof LocatorImpl)
              const rounds = yield* observeChecks(box)
              const adapter = box.owner.runtime.model.adapter
              const original = adapter.dispatchInput
              const toggleCover = (present: boolean) =>
                page.evaluateInMainWorld((present: boolean) => {
                  if (!present) return document.getElementById("cover")!.remove()
                  const cover = document.createElement("div")
                  cover.id = "cover"
                  cover.style.cssText = "position:fixed;inset:0;z-index:1"
                  document.body.append(cover)
                }, present).pipe(Effect.orDie)
              let dispatches = 0
              const dispatchInput: typeof original = (...args) =>
                ++dispatches === 1
                  // The cover arrives after the check under the permit, so only the armed guard can stop the gesture
                  ? toggleCover(true).pipe(
                    Effect.andThen(original(...args)),
                    Effect.tap(() => toggleCover(false))
                  )
                  : original(...args)
              yield* Effect.acquireRelease(
                Effect.sync(() => Object.assign(adapter, { dispatchInput })),
                () =>
                  Effect.sync(() => {
                    Object.assign(adapter, { dispatchInput: original })
                  })
              )
              yield* box[action]()
              assert.strictEqual(dispatches, 2)
              assert.strictEqual(yield* box.isChecked, action === "check")
              assert.strictEqual(yield* page.locator("#out").readText, "click")
              const tokens = rounds.flatMap((round) =>
                round.response._tag === "Ready" && round.response.stability !== undefined
                  ? [round.response.stability]
                  : []
              )
              assert.strictEqual(tokens.length, 2)
              assert.notStrictEqual(tokens[0], tokens[1])
              assert.deepStrictEqual(
                rounds.filter((round) => round.request.apply).map((round) => round.request.stability),
                tokens
              )
            }))
          }), timeout)

        it.effect(`reports prevented ${action} once without retrying input`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="box" type="checkbox" ${
                action === "uncheck" ? "checked" : ""
              } onclick="event.preventDefault(); out.textContent += event.isTrusted + ' '"><output id="out"></output>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const box = page.locator("#box")
              const error = yield* box[action]().pipe(Effect.flip)
              assert(Locator.isLocatorError(error) && error.reason._tag === "StateUnchanged")
              assert.deepStrictEqual(error.diagnostics.dispatch, { _tag: "Acknowledged", result: "ok" })
              assert.strictEqual(yield* box.isChecked, action === "uncheck")
              assert.strictEqual(yield* page.locator("#out").readText, "true")
            }))
          }), timeout)
      }

      it.effect("preserves browser rejection in a public locator failure", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => `<button id="button">Press</button>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const button = page.locator("#button")
            assert(button instanceof LocatorImpl)
            const adapter = button.owner.runtime.model.adapter
            const original = adapter.dispatchInput
            const rejected = new Protocol.ProtocolError({
              reason: new Protocol.Rejected({
                method: "Input.dispatchMouseEvent",
                reason: "InvalidArgument",
                code: -32602,
                description: "refused"
              })
            })
            const fake = BoundedAdapter.make({
              dispatchInput: () =>
                Effect.fail(
                  new Adapter.AdapterError({
                    reason: { _tag: "Protocol", error: rejected }
                  })
                )
            } as unknown as Adapter.AdapterConnection)
            yield* Effect.acquireRelease(
              Effect.sync(() => Object.assign(adapter, { dispatchInput: fake.dispatchInput })),
              () => Effect.sync(() => Object.assign(adapter, { dispatchInput: original }))
            )
            const error = yield* button.click().pipe(Effect.flip)
            assert(Locator.isLocatorError(error) && error.reason._tag === "BackendFailure")
            assert.deepStrictEqual(error.diagnostics.dispatch, { _tag: "Acknowledged", result: "rejected" })
            assert.strictEqual(error.reason.cause, rejected)
          }))
        }), timeout)

      for (const action of ["fill", "focus"] as const) {
        it.effect(`records the engine's confirmed ${action} answer`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() => `<input id="field">`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const field = page.locator("#field")
              assert(field instanceof LocatorImpl)
              const adapter = field.owner.runtime.model.adapter
              const original = adapter.evaluate
              let reject = false
              const rejected = new Protocol.ProtocolError({
                reason: new Protocol.Rejected({
                  method: "Runtime.callFunctionOn",
                  reason: "InvalidArgument",
                  code: -32602,
                  description: "refused"
                })
              })
              let actionRecord: InternalOperation.Record | undefined
              yield* Effect.acquireRelease(
                Effect.sync(() =>
                  Object.assign(adapter, {
                    evaluate: (...args: Parameters<typeof original>) =>
                      Effect.flatMap(InternalOperation.current, (record) => {
                        if (Option.isSome(record)) actionRecord = record.value
                        const call = args[1]
                        const argument = call.arguments[0]
                        if (
                          reject && call.functionDeclaration === Engine.run && argument?._tag === "Value" &&
                          argument.value.type === "string"
                        ) {
                          const request = JSON.parse(argument.value.value) as Engine.Request
                          if (request.op === "act" && request.apply) {
                            return Effect.fail(
                              new Adapter.AdapterError({
                                reason: { _tag: "Protocol", error: rejected }
                              })
                            )
                          }
                        }
                        return original(...args)
                      })
                  })
                ),
                () => Effect.sync(() => Object.assign(adapter, { evaluate: original }))
              )
              const result = yield* Effect.gen(function*() {
                yield* (action === "fill" ? field.fill("value") : field.focus())
                assert.deepStrictEqual(actionRecord?.dispatch, { _tag: "Acknowledged", result: "ok" })
                const record = yield* InternalOperation.record
                return record.timeout(Option.none())
              }).pipe(Operation.named("engine action"))
              assert.deepStrictEqual(result.diagnostics.dispatch, { _tag: "Acknowledged", result: "ok" })
              reject = true
              const error = yield* (action === "fill" ? field.fill("other") : field.focus()).pipe(Effect.flip)
              assert(Locator.isLocatorError(error) && error.reason._tag === "BackendFailure")
              assert.deepStrictEqual(error.diagnostics.dispatch, { _tag: "Acknowledged", result: "rejected" })
              assert.strictEqual(error.reason.cause, rejected)
            }))
          }), timeout)
      }

      it.effect("chooses options, checks boxes and sets files", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<select id="s" onchange="${
              say("'chose ' + this.value")
            }"><option value="a">Ay</option><option value="b">Bee</option></select><input id="c" type="checkbox"><input id="stuck" type="checkbox" onclick="event.preventDefault()"><input id="f" type="file" onchange="${
              say("this.files[0].name")
            }"><button id="go">Go</button><script>setTimeout(() => document.getElementById('s').add(new Option('Late', 'l')), 300)</script>${out}`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            yield* page.locator("#s").selectOption({ label: "Bee" })
            yield* page.getByText("chose b").pipe(Expect.toBeVisible)
            // An option that arrives later is waited for
            yield* page.locator("#s").selectOption({ value: "l" })
            assert.strictEqual(yield* page.locator("#s").readValue, "l")
            const notSelect = yield* page.locator("#go").selectOption({ index: 0 }).pipe(Effect.flip)
            assert(Locator.isLocatorError(notSelect) && notSelect.reason._tag === "WrongElement", String(notSelect))
            const box = page.locator("#c")
            yield* box.check()
            assert.isTrue(yield* box.isChecked)
            yield* box.check()
            assert.isTrue(yield* box.isChecked)
            yield* box.uncheck()
            assert.isFalse(yield* box.isChecked)
            const stuck = yield* page.locator("#stuck").check().pipe(Effect.flip)
            assert(Locator.isLocatorError(stuck) && stuck.reason._tag === "StateUnchanged", String(stuck))
            const notBox = yield* page.locator("#go").check().pipe(Effect.flip)
            assert(Locator.isLocatorError(notBox) && notBox.reason._tag === "WrongElement", String(notBox))
            yield* page.locator("#f").setInputFiles(FileInput.local(import.meta.filename))
            yield* page.getByText("interaction.ts").pipe(Expect.toBeVisible)
            const missing = yield* page.locator("#f").setInputFiles(FileInput.local("/nowhere/at/all.txt")).pipe(
              Effect.flip
            )
            assert(Locator.isLocatorError(missing) && missing.reason._tag === "FileUnreadable", String(missing))
            const notFile = yield* page.locator("#go").setInputFiles(FileInput.local(import.meta.filename)).pipe(
              Effect.flip
            )
            assert(Locator.isLocatorError(notFile) && notFile.reason._tag === "WrongElement", String(notFile))
          }))
        }), timeout)

      for (const selector of ["#radio", "#label", "#descendant"]) {
        for (const [checked, trial] of [[true, false], [false, false], [true, true], [false, true]] as const) {
          it.effect(
            `native radio uncheck ${selector} initially checked ${checked} trial ${trial} delivers no input`,
            () =>
              Effect.gen(function*() {
                const { url } = yield* fixture(() =>
                  `<input id="radio" type="radio" ${
                    checked ? "checked" : ""
                  }><label id="label" for="radio"><span id="descendant">Choice</span></label><p id="clicks">0</p><script>["pointerdown", "mousedown", "mouseup", "click"].forEach(type => document.addEventListener(type, () => document.getElementById("clicks").textContent = String(Number(document.getElementById("clicks").textContent) + 1)))</script>`
                )
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* newPage
                  yield* page.goto(url)
                  const result = yield* page.locator(selector).uncheck({ trial }).pipe(Effect.exit)
                  assert.strictEqual(yield* page.locator("#radio").isChecked, checked)
                  assert.strictEqual(yield* page.locator("#clicks").readText, "0")
                  if (checked) {
                    assert.strictEqual(result._tag, "Failure")
                    const error = result._tag === "Failure" ? Cause.findErrorOption(result.cause) : Option.none()
                    assert(
                      Option.isSome(error) && Locator.isLocatorError(error.value) &&
                        error.value.reason._tag === "WrongElement"
                    )
                    if (
                      Option.isSome(error) && Locator.isLocatorError(error.value) &&
                      error.value.reason._tag === "WrongElement"
                    ) {
                      assert.include(error.value.reason.hint, "another radio in the group")
                    }
                  } else yield* result
                }))
              }),
            timeout
          )
        }
      }

      for (const selector of ["#label", "#descendant"]) {
        it.effect(`native radio uncheck control preserves ${selector}'s own ARIA state`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="radio" type="radio" checked><label id="label" for="radio" role="checkbox" aria-checked="false"><span id="descendant" role="checkbox" aria-checked="false">Choice</span></label>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator(selector).uncheck()
              yield* page.locator(selector).uncheck({ trial: true })
              assert.strictEqual(yield* page.locator(selector).isChecked, false)
              assert.strictEqual(yield* page.locator("#radio").isChecked, true)
            }))
          }), timeout)
      }

      it.effect(
        "native radio uncheck refusal is never reported as unsent after the click",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="box" type="checkbox" checked onclick="this.type = 'radio'; this.checked = true; document.getElementById('clicks').textContent = '1'"><p id="clicks">0</p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const result = yield* page.locator("#box").uncheck().pipe(Effect.exit)
              assert.strictEqual(yield* page.locator("#clicks").readText, "1")
              const error = result._tag === "Failure" ? Cause.findErrorOption(result.cause) : Option.none()
              assert(Option.isSome(error) && Locator.isLocatorError(error.value))
              if (Option.isSome(error) && Locator.isLocatorError(error.value)) {
                assert.deepStrictEqual(error.value.diagnostics.dispatch, { _tag: "Acknowledged", result: "ok" })
                assert.strictEqual(error.value.reason._tag, "StateUnchanged")
              }
            }))
          }),
        timeout
      )

      it.effect(
        "native radio uncheck control allows a page-managed ARIA radio to uncheck",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<div id="radio" role="radio" aria-checked="true" onclick="this.setAttribute('aria-checked', 'false'); document.getElementById('clicks').textContent = '1'">Choice</div><p id="clicks">0</p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#radio").uncheck()
              assert.isFalse(yield* page.locator("#radio").isChecked)
              assert.strictEqual(yield* page.locator("#clicks").readText, "1")
            }))
          }),
        timeout
      )

      it.effect("label descendant geometry requires the parsed fixture", () =>
        Effect.scoped(Effect.gen(function*() {
          const { url, origin } = yield* fixture(() =>
            `<script src="/parser-gate.js"></script><label><input id="box" type="checkbox"><span id="target">Toggle</span></label>`
          )
          const page = yield* newPage
          const requested = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          yield* page.route(`${origin}/parser-gate.js`, () =>
            Effect.gen(function*() {
              yield* Deferred.succeed(requested, undefined)
              yield* Deferred.await(release)
              return yield* Route.fulfill(HttpServerResponse.text("", { contentType: "text/javascript" }))
            }))
          // Hold parsing at a real resource boundary, without a sleep or machine load.
          yield* Effect.gen(function*() {
            const navigation = yield* page.goto(url, { waitUntil: "domContentLoaded" }).pipe(Effect.forkScoped)
            yield* Deferred.await(requested)
            assert.isTrue(yield* page.evaluateInMainWorld(() => document.querySelector("#target") === null))
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.join(navigation)
            const width = yield* page.evaluateInMainWorld(() =>
              document.querySelector("#target")!.getBoundingClientRect().width
            )
            assert.isAbove(width, 0)
            yield* page.locator("#target").check()
            assert.isTrue(yield* page.locator("#box").isChecked)
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
        })), timeout)

      // A label acts for its control, or the target is checkable itself, both ways. Every other kind is refused before
      // any input, the same way for check and uncheck, so each is one of the engine's rules, checked once: `button`
      // stands for the elements interactive by their tag, and `a`, `video` and `img` are interactive by an attribute,
      // without which (`inert-link`, `inert-media`, `image`) the label acts
      for (const association of ["explicit", "wrapping"] as const) {
        for (
          const kind of [
            "ordinary",
            "inert-link",
            "inert-media",
            "image",
            "prevented",
            "own",
            "own-ancestor",
            "native",
            "nearest",
            "missing",
            "plain",
            "text",
            "button",
            "a",
            "video",
            "img",
            "role",
            "editable",
            "editable-false",
            "editable-ancestor",
            "ancestor"
          ] as const
        ) {
          const acts = ["ordinary", "inert-link", "inert-media", "image", "prevented", "own", "own-ancestor", "native"]
            .includes(kind)
          for (const checked of acts ? [true, false] : [true]) {
            it.effect(
              `label descendant ${association} ${kind} ${checked ? "check" : "uncheck"}`,
              () =>
                Effect.gen(function*() {
                  const ordinary = kind === "ordinary" || kind === "prevented" || kind === "inert-link" ||
                    kind === "inert-media" || kind === "image"
                  const own = kind === "own" || kind === "own-ancestor" || kind === "native"
                  const attrs = kind === "a" ?
                    "href=\"#away\"" :
                    kind === "video" ?
                    "controls" :
                    kind === "editable" ?
                    "contenteditable=\"true\"" :
                    kind === "role"
                    ? "role=\"button\""
                    : kind === "editable-false" ?
                    "contenteditable=\"false\""
                    : kind === "img"
                    ? "usemap=\"#map\""
                    : ""
                  const tag = kind === "button" || kind === "a" || kind === "video" || kind === "img" ? kind : "span"
                  const targetTag = kind === "inert-link"
                    ? "a"
                    : kind === "inert-media"
                    ? "video"
                    : kind === "image"
                    ? "img"
                    : tag
                  const target = kind === "native" ?
                    `<input id="target" type="checkbox" ${checked ? "" : "checked"}>` :
                    `<${targetTag} id="target" ${attrs} ${
                      (kind === "own" || kind === "own-ancestor")
                        ? `role="checkbox" aria-checked="${!checked}" onclick="event.preventDefault();this.setAttribute('aria-checked', String(this.getAttribute('aria-checked') !== 'true'))"`
                        : ""
                    } style="display:inline-block;position:relative;left:0.4px;top:0.4px;width:100px;height:30px">Toggle</${targetTag}>`
                  const wrapped = kind === "ancestor" || kind === "own-ancestor" ?
                    `<button>${target}</button>` :
                    kind === "editable-ancestor" || kind === "editable-false"
                    ? `<div contenteditable="true">${target}</div>`
                    : target
                  const input = `<input id="box" type="${kind === "text" ? "text" : "checkbox"}" ${
                    checked ? "" : "checked"
                  }>`
                  const { url } = yield* fixture(() =>
                    `${association === "explicit" ? input : ""}<label for="${
                      kind === "missing" ? "absent" : kind === "plain" ? "" : "box"
                    }" ${
                      association === "wrapping" && kind !== "missing" && kind !== "plain" ? "id=\"wrapping\"" : ""
                    } ${kind === "prevented" ? "onclick=\"event.preventDefault()\"" : ""}>${
                      association === "wrapping" ? input : ""
                    }${wrapped}</label>${out}<script>
                  const label = document.querySelector('#wrapping'); if(label) label.removeAttribute('for');
                  ${
                      kind === "nearest"
                        ? "const target = document.querySelector('#target'); const inner = document.createElement('label'); inner.htmlFor = 'absent'; target.before(inner); inner.append(target);"
                        : ""
                    }
                  document.addEventListener('pointerdown', e => { const r=document.querySelector('#target').getBoundingClientRect(); ${
                      say("e.target.id + ':' + (e.clientX-r.left) + ':' + (e.clientY-r.top)")
                    } });
                  </script>`
                  )
                  yield* Effect.scoped(Effect.gen(function*() {
                    const page = yield* newPage
                    yield* page.goto(url, { waitUntil: "domContentLoaded" })
                    const target = page.locator("#target")
                    // CDP accepts fractional viewport input; BiDi and WebKit require integer coordinates.
                    const roundsInput = (yield* Browser.Browser).info.protocol !== "cdp"
                    const expectedPoint = yield* page.evaluateInMainWorld((roundsInput) => {
                      const element = document.querySelector("#target")!
                      const rect = element.getBoundingClientRect()
                      const style = getComputedStyle(element)
                      const viewportX = rect.left + parseFloat(style.borderLeftWidth) + 7
                      const viewportY = rect.top + parseFloat(style.borderTopWidth) + 9
                      const x = (roundsInput ? Math.round(viewportX) : viewportX) - rect.left
                      const y = (roundsInput ? Math.round(viewportY) : viewportY) - rect.top
                      return `target:${x}:${y}`
                    }, roundsInput)
                    const action = () =>
                      checked
                        ? target.check({ position: { x: 7, y: 9 } })
                        : target.uncheck({ position: { x: 7, y: 9 } })
                    if (ordinary || own) {
                      if (kind === "prevented") {
                        const error = yield* action().pipe(Effect.flip)
                        assert(Locator.isLocatorError(error) && error.reason._tag === "StateUnchanged", String(error))
                        assert.strictEqual(yield* page.locator("#box").isChecked, !checked)
                        assert.strictEqual(yield* page.locator("#out").readText, expectedPoint)
                      } else {
                        yield* action()
                        assert.strictEqual(yield* (own ? target : page.locator("#box")).isChecked, checked)
                        assert.strictEqual(yield* page.locator("#out").readText, expectedPoint)
                        yield* page.evaluateInMainWorld(() => {
                          document.querySelector("#out")!.textContent = "reset"
                        })
                        yield* action()
                        assert.strictEqual(yield* page.locator("#out").readText, "reset")
                      }
                      if (!own) {
                        const error = yield* target.isChecked.pipe(Effect.flip)
                        assert(Locator.isLocatorError(error) && error.reason._tag === "WrongElement", String(error))
                        const expectation = yield* target.pipe(
                          Expect.toBeChecked,
                          Deadline.within("1 second"),
                          Effect.flip
                        )
                        assert(expectation instanceof Expect.ExpectationFailed, String(expectation))
                      } else assert.strictEqual(yield* page.locator("#box").isChecked, !checked)
                    } else {
                      for (const state of [false, true]) {
                        yield* page.evaluateInMainWorld((value: boolean) => {
                          ;(document.querySelector("#box") as HTMLInputElement).checked = value
                        }, state)
                        const error = yield* action().pipe(Effect.flip)
                        assert(Locator.isLocatorError(error) && error.reason._tag === "WrongElement", String(error))
                        assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
                      }
                    }
                  }))
                }),
              timeout
            )
          }
        }
      }

      it.effect("label descendant refuses ARIA widget ancestors before input", () =>
        Effect.gen(function*() {
          const roles = [
            "button",
            "checkbox",
            "combobox",
            "grid",
            "gridcell",
            "link",
            "listbox",
            "menu",
            "menubar",
            "menuitem",
            "menuitemcheckbox",
            "menuitemradio",
            "option",
            "radio",
            "radiogroup",
            "scrollbar",
            "searchbox",
            "separator",
            "slider",
            "spinbutton",
            "switch",
            "tab",
            "tablist",
            "textbox",
            "tree",
            "treegrid",
            "treeitem"
          ]
          const { url } = yield* fixture(() =>
            `<input id="box" type="checkbox">${
              roles.map((role) =>
                `<label for="box"><span role="${role}"><span id="${role}">Toggle</span></span></label>`
              ).join("")
            }${out}<script>document.addEventListener('pointerdown', () => { ${say("'pointer sent'")} })</script>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            for (const role of roles) {
              const target = page.locator(`#${role}`)
              for (const action of [target.check(), target.uncheck()]) {
                const error = yield* action.pipe(Effect.flip)
                assert(Locator.isLocatorError(error) && error.reason._tag === "WrongElement", String(error))
              }
            }
            assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
            assert.strictEqual(yield* page.locator("#box").isChecked, false)
          }))
        }), timeout)

      // A slot places light DOM inside a shadow tree's control, and SVG links may carry only xlink:href; the pointer
      // reaches that control or link, so each is an interactive ancestor the parent chain alone doesn't show.
      const slotted = `<span id="host"><span id="target">Toggle</span></span>`
      const shadowed = (inner: string) =>
        `document.querySelector("#host").attachShadow({mode:"open"}).innerHTML=${JSON.stringify(inner)};`
      for (
        const [kind, content, script] of [
          ["slotted into a shadow button", slotted, shadowed("<button><slot></slot></button>")],
          ["slotted into a shadow link", slotted, shadowed(`<a href="#away"><slot></slot></a>`)],
          [
            "in an SVG xlink:href link",
            `<svg width="100" height="30" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="#away"><rect id="target" width="100" height="30"/></a></svg>`,
            ""
          ]
        ] as const
      ) {
        it.effect(`label descendant refuses before input when ${kind}`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="box" type="checkbox"><label for="box">${content}</label>${out}<script>${script}
              document.addEventListener('pointerdown', () => { ${say("'pointer sent'")} }, true)</script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const target = page.locator("#target")
              for (const state of [false, true]) {
                yield* page.evaluateInMainWorld((value: boolean) => {
                  ;(document.querySelector("#box") as HTMLInputElement).checked = value
                }, state)
                for (const action of [target.check(), target.uncheck()]) {
                  const error = yield* action.pipe(Effect.flip)
                  assert(Locator.isLocatorError(error) && error.reason._tag === "WrongElement", String(error))
                }
                assert.strictEqual(yield* page.locator("#box").isChecked, state)
              }
              assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
              assert.strictEqual(yield* page.evaluateInMainWorld(() => location.hash), "")
            }))
          }), timeout)
      }

      it.effect(
        "label descendant slotted into an ordinary shadow element follows the label",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="box" type="checkbox"><label for="box">${slotted}</label><script>${
                shadowed("<b><slot></slot></b>")
              }</script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#target").check()
              assert.strictEqual(yield* page.locator("#box").isChecked, true)
            }))
          }),
        timeout
      )

      it.effect(
        "label descendant boundary follows the DOM label control rather than its ARIA state",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="box" type="checkbox"><label for="box" role="checkbox" aria-checked="true"><span id="target">Toggle</span></label><label role="checkbox" aria-checked="true"><span id="orphan">Orphan</span></label>${out}<script>document.addEventListener('pointerdown', e => { ${
                say("'pointer ' + e.target.id")
              } }, true)</script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const target = page.locator("#target")
              for (const checked of [true, false]) {
                yield* page.evaluateInMainWorld((value: boolean) => {
                  document.querySelector("label[for=\"box\"]")!.setAttribute("aria-checked", String(value))
                  document.querySelector("#out")!.textContent = "reset"
                }, checked)
                yield* checked ? target.check() : target.uncheck()
                assert.strictEqual(yield* page.locator("#box").isChecked, checked)
                assert.strictEqual(yield* page.locator("#out").readText, "pointer target")
                yield* page.evaluateInMainWorld((value: boolean) => {
                  document.querySelector("label[for=\"box\"]")!.setAttribute("aria-checked", String(!value))
                  document.querySelector("#out")!.textContent = "reset"
                }, checked)
                yield* checked ? target.check() : target.uncheck()
                assert.strictEqual(yield* page.locator("#out").readText, "reset")
              }
              const orphan = page.locator("#orphan")
              for (const action of [orphan.check(), orphan.uncheck()]) {
                const error = yield* action.pipe(Effect.flip)
                assert(Locator.isLocatorError(error) && error.reason._tag === "WrongElement", String(error))
              }
              assert.strictEqual(yield* page.locator("#out").readText, "reset")
            }))
          }),
        timeout
      )

      for (const kind of ["shadow target", "DOM widget behind a shadow label"] as const) {
        it.effect(`label descendant boundary refuses ${kind} without input`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="box" type="checkbox"><label for="box"><span id="host" ${
                kind === "shadow target" ? "" : "role=\"button\""
              }>${kind === "shadow target" ? "" : "<span id=\"target\">Toggle</span>"}</span></label>${out}<script>${
                shadowed(
                  kind === "shadow target" ? "<span id=\"target\">Toggle</span>" : "<label><slot></slot></label>"
                )
              }document.addEventListener('pointerdown', () => { ${say("'pointer sent'")} }, true)</script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const target = page.locator("#target")
              for (const state of [false, true]) {
                yield* page.evaluateInMainWorld((value: boolean) => {
                  ;(document.querySelector("#box") as HTMLInputElement).checked = value
                }, state)
                for (const action of [target.check(), target.uncheck()]) {
                  const error = yield* action.pipe(Effect.flip)
                  assert(Locator.isLocatorError(error) && error.reason._tag === "WrongElement", String(error))
                }
              }
              assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
              assert.strictEqual(yield* page.evaluateInMainWorld(() => location.hash), "")
            }))
          }), timeout)
      }

      for (const kind of ["DOM", "slot"] as const) {
        it.effect(
          `label descendant boundary excludes interactive ancestors above its ${kind} label`,
          () =>
            Effect.gen(function*() {
              const label = "<label for=\"box\"><span id=\"target\">Toggle</span></label>"
              const { url } = yield* fixture(() =>
                `<input id="box" type="checkbox">${
                  kind === "DOM" ? `<a href="#away">${label}</a>` : `<span id="host">${label}</span>`
                }${out}<script>${
                  kind === "slot" ? shadowed("<button><slot></slot></button>") : ""
                }document.addEventListener('pointerdown', e => { ${say("e.target.id")} }, true)</script>`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const target = page.locator("#target")
                yield* target.check()
                assert.strictEqual(yield* page.locator("#box").isChecked, true)
                yield* target.uncheck()
                assert.strictEqual(yield* page.locator("#box").isChecked, false)
                assert.strictEqual(yield* page.locator("#out").readText, "target")
                assert.strictEqual(yield* page.evaluateInMainWorld(() => location.hash), "")
              }))
            }),
          timeout
        )
      }

      it.effect(
        "label descendant boundary preserves own state when slotted into a button",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="box" type="checkbox" checked><label for="box"><span id="host"><span id="target" role="checkbox" aria-checked="false" onclick="event.preventDefault();this.setAttribute('aria-checked', String(this.getAttribute('aria-checked') !== 'true'))">Toggle</span></span></label>${out}<script>${
                shadowed("<button><slot></slot></button>")
              }document.addEventListener('pointerdown', e => { ${say("e.target.id")} }, true)</script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const target = page.locator("#target")
              yield* target.check()
              assert.strictEqual(yield* target.isChecked, true)
              assert.strictEqual(yield* page.locator("#box").isChecked, true)
              assert.strictEqual(yield* page.locator("#out").readText, "target")
              yield* page.evaluateInMainWorld(() => {
                ;(document.querySelector("#box") as HTMLInputElement).checked = false
                document.querySelector("#out")!.textContent = "reset"
              })
              yield* target.check()
              assert.strictEqual(yield* page.locator("#out").readText, "reset")
              yield* target.uncheck()
              assert.strictEqual(yield* target.isChecked, false)
              assert.strictEqual(yield* page.locator("#box").isChecked, false)
              assert.strictEqual(yield* page.locator("#out").readText, "target")
            }))
          }),
        timeout
      )

      // State belongs to the control; pointer input still belongs to the label.
      for (const association of ["explicit", "wrapping"] as const) {
        for (const checked of [true, false]) {
          it.effect(
            `${checked ? "checks" : "unchecks"} a ${association} label beside its link`,
            () =>
              Effect.gen(function*() {
                const input = `<input id="box" type="checkbox" ${
                  checked ? "" : "checked"
                } style="position:absolute;left:10px;top:10px">`
                const { url } = yield* fixture(() =>
                  `${association === "explicit" ? input : ""}<label id="label" ${
                    association === "explicit" ? "for=\"box\"" : ""
                  } style="position:absolute;left:200px;top:100px;width:300px;height:40px" onpointerdown="${
                    say(
                      "event.target.id + ':' + (event.clientX - 200) + ':' + (event.clientY - 100) + ':' + event.isTrusted"
                    )
                  }">${
                    association === "wrapping" ? input : ""
                  }<a href="#wrong" style="display:inline-block;width:240px">A long link</a> Toggle</label>${out}`
                )
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* newPage
                  yield* page.goto(url)
                  const initialUrl = yield* page.url
                  const label = page.locator("#label")
                  const options = { position: { x: 280, y: 20 } }
                  yield* checked ? label.check(options) : label.uncheck(options)
                  assert.strictEqual(yield* page.locator("#box").isChecked, checked)
                  assert.strictEqual(yield* page.locator("#out").readText, "label:280:20:true")
                  // An already-correct state sends no pointer input, even over the embedded link.
                  yield* checked
                    ? label.check({ position: { x: 20, y: 20 } })
                    : label.uncheck({ position: { x: 20, y: 20 } })
                  assert.strictEqual(yield* page.locator("#box").isChecked, checked)
                  assert.strictEqual(yield* page.locator("#out").readText, "label:280:20:true")
                  yield* page.pipe(Expect.toHaveURL(initialUrl))
                }))
              }),
            timeout
          )
        }
      }

      for (const checked of [true, false]) {
        it.effect(
          `reports StateUnchanged when a label activation is prevented while ${checked ? "checking" : "unchecking"}`,
          () =>
            Effect.gen(function*() {
              const { url } = yield* fixture(() =>
                `<input id="box" type="checkbox" ${
                  checked ? "" : "checked"
                }><label id="label" for="box" onclick="event.preventDefault(); ${
                  say("'prevented ' + event.isTrusted")
                }">Toggle</label>${out}`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const label = page.locator("#label")
                const error = yield* (checked ? label.check() : label.uncheck()).pipe(Effect.flip)
                assert(Locator.isLocatorError(error) && error.reason._tag === "StateUnchanged", String(error))
                if (Locator.isLocatorError(error) && error.reason._tag === "StateUnchanged") {
                  assert.strictEqual(error.reason.expected, checked ? "checked" : "unchecked")
                }
                assert.strictEqual(yield* page.locator("#box").isChecked, !checked)
                assert.strictEqual(yield* page.locator("#out").readText, "prevented true")
                const read = yield* label.isChecked.pipe(Effect.flip)
                assert(Locator.isLocatorError(read) && read.reason._tag === "WrongElement", String(read))
              }))
            }),
          timeout
        )
      }

      it.effect("rejects labels without an associated checkable control", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<label id="missing" for="absent">Missing</label><label id="text" for="field">Text</label><input id="field"><label id="plain">Plain</label>${out}<script>document.addEventListener('pointerdown', () => { ${
              say("'pointer sent'")
            } })</script>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            for (const id of ["missing", "text", "plain"]) {
              const label = page.locator(`#${id}`)
              for (const action of [label.check(), label.uncheck()]) {
                const error = yield* action.pipe(Effect.flip)
                assert(Locator.isLocatorError(error) && error.reason._tag === "WrongElement", String(error))
              }
            }
            assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
          }))
        }), timeout)

      // A label that is itself an ARIA checkable keeps its own state, as it did before labels were followed.
      it.effect("checks and unchecks a label that is itself an ARIA checkbox", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<label id="switch" role="checkbox" aria-checked="false" onclick="this.setAttribute('aria-checked', String(this.getAttribute('aria-checked') !== 'true'))">Toggle</label>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const label = page.locator("#switch")
            yield* label.check()
            assert.strictEqual(yield* label.isChecked, true)
            yield* label.uncheck()
            assert.strictEqual(yield* label.isChecked, false)
          }))
        }), timeout)

      for (const checked of [true, false]) {
        it.effect(
          `prefers a label's own state over its conflicting control while ${checked ? "checking" : "unchecking"}`,
          () =>
            Effect.gen(function*() {
              const { url } = yield* fixture(() =>
                `<input id="box" type="checkbox" ${
                  checked ? "checked" : ""
                }><label id="label" for="box" role="checkbox" aria-checked="${!checked}" onclick="event.preventDefault(); const next = this.getAttribute('aria-checked') !== 'true'; this.setAttribute('aria-checked', String(next)); document.getElementById('box').checked = !next; ${
                  say("'clicked ' + event.isTrusted")
                }">Toggle</label>${out}`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const label = page.locator("#label")
                // The associated control disagrees even when the requested state already holds.
                yield* checked ? label.uncheck() : label.check()
                assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
                yield* checked ? label.check() : label.uncheck()
                assert.strictEqual(yield* label.isChecked, checked)
                assert.strictEqual(yield* page.locator("#box").isChecked, !checked)
                assert.strictEqual(yield* page.locator("#out").readText, "clicked true")
                yield* checked ? label.check() : label.uncheck()
                assert.strictEqual(yield* label.isChecked, checked)
                assert.strictEqual(yield* page.locator("#box").isChecked, !checked)
                assert.strictEqual(yield* page.locator("#out").readText, "clicked true")
              }))
            }),
          timeout
        )
      }

      for (const action of ["check", "uncheck"] as const) {
        it.effect(
          `trial ${action} succeeds without changing checked state or dispatching a click`,
          () =>
            Effect.gen(function*() {
              const checked = action === "uncheck"
              const { url } = yield* fixture(() =>
                `<input id="c" type="checkbox" ${checked ? "checked" : ""} onclick="${say("'clicked'")}">${out}`
              )
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* newPage
                yield* page.goto(url)
                const box = page.locator("#c")
                assert.strictEqual(yield* box.isChecked, checked)
                const result = yield* box[action]({ trial: true }).pipe(Effect.exit)
                assert.strictEqual(yield* box.isChecked, checked)
                assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
                yield* result
              }))
            }),
          timeout
        )
      }

      for (const action of ["check", "uncheck"] as const) {
        it.effect(`trial ${action} rejects a disabled checkbox`, () =>
          Effect.gen(function*() {
            const checked = action === "uncheck"
            const { url } = yield* fixture(() =>
              `<input id="c" type="checkbox" disabled ${checked ? "checked" : ""} onclick="${say("'clicked'")}">${out}`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const box = page.locator("#c")
              const failure = yield* box[action]({ trial: true }).pipe(
                Deadline.within("300 millis"),
                Effect.flip
              )
              assert(Deadline.isTimeout(failure), String(failure))
              assert.strictEqual(yield* box.isChecked, checked)
              assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
            }))
          }), timeout)
      }

      it.effect("double-clicks, hovers, taps, and holds modifiers where the backend can", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<button id="d" ondblclick="${
              say("'double'")
            }">Twice</button><div id="h" style="width:100px;height:40px" onmouseover="${
              say("'hovered'")
            }">Hover</div><button id="t">Touch</button><script>document.getElementById('t').addEventListener('touchstart', (event) => { ${
              say("'touched'")
            } })</script><button id="m" onclick="${say("'shift ' + event.shiftKey")}">Modified</button>${out}`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            yield* page.locator("#d").dblclick()
            yield* page.getByText("double").pipe(Expect.toBeVisible)
            yield* page.locator("#h").hover()
            yield* page.getByText("hovered").pipe(Expect.toBeVisible)
            const tapped = page.locator("#t").tap()
            if (yield* supports("input.touch")) {
              yield* tapped
              yield* page.getByText("touched").pipe(Expect.toBeVisible)
            } else {
              const error = yield* Effect.flip(tapped)
              assert(Locator.isLocatorError(error) && error.reason._tag === "Unsupported", String(error))
              assert.strictEqual(error.reason.capability, "input.touch")
            }
            const modified = page.locator("#m").click({ modifiers: ["Shift"] })
            if (!(yield* supports("input.pointerModifiers"))) {
              const error = yield* Effect.flip(modified)
              assert(Locator.isLocatorError(error) && error.reason._tag === "Unsupported", String(error))
              assert.strictEqual(error.reason.capability, "input.pointerModifiers")
            } else {
              yield* modified
              yield* page.getByText("shift true").pipe(Expect.toBeVisible)
            }
          }))
        }), timeout)

      it.effect("drags with pointer events, and with HTML drag where the backend can", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<div id="knob" style="position:absolute;left:0;top:100px;width:40px;height:40px;background:red" onpointerdown="window.dragging = true" onpointerup="if (window.dragging) ${
              say("'dropped at ' + Math.round(event.clientX)")
            }">K</div><div id="end" style="position:absolute;left:300px;top:100px;width:40px;height:40px;background:blue">E</div><div id="card" draggable="true" style="position:absolute;left:0;top:200px;width:40px;height:40px;background:green">C</div><div id="bin" style="position:absolute;left:300px;top:200px;width:40px;height:40px;background:gray" ondragover="event.preventDefault()" ondrop="event.preventDefault(); ${
              say("'binned'")
            }">B</div>${out}`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            // The knob's pointerup lands on the end box, which doesn't stop it: pointer events go where the pointer is
            yield* page.locator("#knob").dragTo(page.locator("#end"), { steps: 5, checks: { receivesPointer: false } })
            const html = page.locator("#card").dragTo(page.locator("#bin"), { steps: 5 })
            if (name === "Chromium") {
              yield* html
              yield* page.getByText("binned").pipe(Expect.toBeVisible)
            } else {
              const error = yield* Effect.flip(html)
              assert(Locator.isLocatorError(error) && error.reason._tag === "Unsupported", String(error))
              assert.strictEqual(error.reason.capability, "input.dragAndDrop")
              assert.include(error.reason.hint, `html: "synthetic"`)
            }
          }))
        }), timeout)

      it.effect(
        "types on its context's keyboard layout: the layout's keys, Shift, AltGr and dead keys",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="field"><p id="log"></p><script>
              const log = []
              document.getElementById("field").addEventListener("keydown", (event) => {
                log.push(event.key + ":" + event.code + (event.shiftKey ? "+S" : ""))
                document.getElementById("log").textContent = log.join(" ")
              })
            </script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const context = yield* Browser.newContext({ keyboardLayout: "de" })
              const page = yield* context.newPage
              yield* page.goto(url)
              const field = page.locator("#field")
              if (!(yield* supports("input.keyboardLayout"))) {
                // A backend that types characters, not a layout's keys, refuses the keys only a layout has
                const error = yield* Effect.flip(field.pressSequentially("zY@ê"))
                assert(Locator.isLocatorError(error) && error.reason._tag === "Unsupported", String(error))
                assert.strictEqual(error.reason.capability, "input.keyboardLayout")
                return
              }
              yield* field.pressSequentially("zY@ê")
              yield* field.pipe(Expect.toHaveValue("zY@ê"))
              const log = yield* page.locator("#log").readText
              if (name === "Firefox") {
                // WebDriver BiDi sends each character as its value: Firefox gives it the code a US keyboard would
                // (input.keyboardLayout)
                assert.include(log, "z:KeyZ")
                assert.include(log, "ê:")
              } else {
                // WebKit's key events ignore the modifiers held, as its mouse events do (QUIRKS.md, Q188)
                const shift = name === "WebKit" ? "" : "+S"
                assert.strictEqual(
                  log,
                  `z:KeyY Shift:ShiftLeft${shift} Y:KeyZ${shift} AltGraph:AltRight @:KeyQ Dead:Backquote ê:KeyE`
                )
              }
              // A press is a character's strokes too
              yield* page.keyboard.press("@")
              yield* field.pipe(Expect.toHaveValue("zY@ê@"))
            }))
          }),
        timeout
      )

      it.effect("drags with HTML drag events the page dispatches, on every backend", () =>
        Effect.gen(function*() {
          const write = (id: string, text: string) => `document.getElementById('${id}').textContent = ${text}`
          const { url } = yield* fixture(() =>
            `<div id="card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', 'card-7'); event.dataTransfer.effectAllowed = 'move'" ondragend="${
              write("ended", "'ended ' + event.dataTransfer.dropEffect")
            }" style="position:absolute;left:0;top:100px;width:40px;height:40px;background:green">C</div><div id="bin" ondragenter="this.dataset.entered = 'yes'" ondragover="event.preventDefault(); event.dataTransfer.dropEffect = 'move'" ondrop="event.preventDefault(); ${
              write(
                "dropped",
                "'binned ' + event.dataTransfer.getData('text/plain') + ' ' + event.isTrusted + ' ' + this.dataset.entered + ' ' + event.shiftKey"
              )
            }" style="position:absolute;left:300px;top:100px;width:60px;height:60px;background:gray"><span>B</span></div><div id="wall" ondragleave="${
              write("dropped", "'refused'")
            }" style="position:absolute;left:300px;top:200px;width:40px;height:40px;background:black">W</div><p id="dropped">nothing yet</p><p id="ended">nothing yet</p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            yield* page.locator("#card").dragTo(page.locator("#bin"), { html: "synthetic", modifiers: ["Shift"] })
            yield* page.locator("#dropped").pipe(Expect.toHaveText("binned card-7 false yes true"))
            // Chromium and WebKit ignore a dropEffect set on a DataTransfer a script made (QUIRKS.md, Q186)
            yield* page.locator("#ended").pipe(Expect.toHaveText(name === "Firefox" ? "ended move" : "ended none"))
            // A target whose dragover nothing cancels gets no drop
            yield* page.locator("#card").dragTo(page.locator("#wall"), { html: "synthetic" })
            yield* page.locator("#dropped").pipe(Expect.toHaveText("refused"))
            yield* page.locator("#ended").pipe(Expect.toHaveText("ended none"))
          }))
        }), timeout)

      it.effect(
        "stops a click whose element was covered when the input arrived, and clicks again",
        () =>
          Effect.gen(function*() {
            // The overlay appears when the pointer moves over the button, after the checks passed
            const { url } = yield* fixture(() =>
              `<div style="position:relative"><button id="b" onclick="window.clicks = (window.clicks ?? 0) + 1; ${
                say("'clicked ' + window.clicks")
              }" onmousemove="if (!window.covered) { window.covered = true; const o = document.getElementById('o'); o.style.display = 'block'; setTimeout(() => o.style.display = 'none', 300) }">Pay</button><div id="o" onclick="${
                say("'overlay clicked'")
              }" style="display:none;position:absolute;inset:0;background:white">Saving</div></div>${out}`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.locator("#b").click()
              yield* page.getByText("clicked 1").pipe(Expect.toBeVisible)
            }))
          }),
        timeout
      )

      it.effect("releases held keys and buttons when their scope closes, failing or not", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<input id="i"><p id="ups"></p><script>const ups = document.getElementById('ups'); addEventListener('keyup', (e) => ups.textContent += e.key + ' '); addEventListener('mouseup', () => ups.textContent += 'mouse ')</script>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            yield* page.locator("#i").focus()
            yield* Effect.scoped(Effect.gen(function*() {
              yield* page.keyboard.hold("Shift")
              yield* page.keyboard.press("a")
              return yield* Effect.fail("a failed step")
            })).pipe(Effect.ignore)
            yield* page.keyboard.press("b")
            assert.strictEqual(yield* page.locator("#i").readValue, "Ab")
            yield* Effect.scoped(Effect.gen(function*() {
              yield* page.mouse.move({ x: 5, y: 5 })
              const held = yield* page.mouse.hold("left")
              yield* held.release
              yield* held.release
            }))
            // Shift went up with the failed scope, and the button once, however often its release ran
            assert.strictEqual(yield* page.locator("#ups").readText, "A Shift b mouse")
            const unknown = yield* page.keyboard.press("NotAKey").pipe(Effect.flip)
            assert(Keyboard.isKeyboardError(unknown) && unknown.reason._tag === "InvalidInput", String(unknown))
          }))
        }), timeout)

      it.effect("reads one match at once: text, value, html, attributes, states", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<p id="p" data-state="ready">Hello <b>there</b></p><input id="v" value="typed" disabled><input id="c" type="checkbox" checked><p class="two">a</p><p class="two">b</p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const p = page.locator("#p")
            assert.strictEqual(yield* p.readText, "Hello there")
            assert.strictEqual(yield* p.readHtml, `<p id="p" data-state="ready">Hello <b>there</b></p>`)
            assert.deepStrictEqual(yield* p.readAttribute("data-state"), Option.some("ready"))
            assert.deepStrictEqual(yield* p.readAttribute("nope"), Option.none())
            assert.strictEqual(yield* page.locator("#v").readValue, "typed")
            assert.isFalse(yield* page.locator("#v").isEnabled)
            assert.isTrue(yield* page.locator("#c").isChecked)
            const none = yield* page.locator("#absent").readText.pipe(Effect.flip)
            assert(Locator.isLocatorError(none) && none.reason._tag === "NoMatch", String(none))
            const two = yield* page.locator(".two").readText.pipe(Effect.flip)
            assert(Locator.isLocatorError(two) && two.reason._tag === "StrictViolation", String(two))
            const wrong = yield* p.readValue.pipe(Effect.flip)
            assert(Locator.isLocatorError(wrong) && wrong.reason._tag === "WrongElement", String(wrong))
          }))
        }), timeout)

      it.effect(
        "starts fresh observations after timeout, interruption and document replacement",
        () =>
          Effect.gen(function*() {
            const { url, origin } = yield* fixture(() => `<p id="ready" hidden>Old</p>`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              const expired = yield* page.locator("#ready").pipe(
                Expect.toBeVisible,
                Deadline.within("100 millis"),
                Effect.flip
              )
              assert(Expect.isExpectationFailed(expired), String(expired))
              const interrupted = yield* page.locator("#ready").pipe(Expect.toBeVisible, Effect.forkChild)
              yield* Fiber.interrupt(interrupted)
              yield* page.evaluateInMainWorld(() => {
                document.querySelector("#ready")!.outerHTML = "<p id=\"ready\">Replacement</p>"
              })
              yield* page.locator("#ready").pipe(Expect.toHaveText("Replacement"))
              yield* page.goto(fixtureUrl(origin, `<p id="ready">New document</p>`))
              yield* Effect.forEach(
                Array.from({ length: 20 }),
                () => page.locator("#ready").pipe(Expect.toHaveText("New document")),
                { concurrency: "unbounded" }
              )
            }))
          }),
        timeout
      )

      it.effect("expects what changes later, in the page, and fails with what it saw", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<title>Waiting</title><p id="status">Working</p><button id="b" disabled>Go</button><input id="c" type="checkbox"><input id="v"><ul><li>a</li></ul><p id="tag">Tag</p><script>setTimeout(() => { document.getElementById('status').textContent = 'Done for now'; document.getElementById('b').disabled = false; document.getElementById('c').checked = true; document.getElementById('v').value = 'set by script'; document.getElementById('v').focus(); document.getElementById('tag').dataset.state = 'ready'; document.querySelector('ul').innerHTML = '<li>a</li><li>b</li><li>c</li>'; document.title = 'Finished' }, 300)</script>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            const status = page.locator("#status")
            yield* status.pipe(Expect.toHaveText("Done for now"))
            yield* Expect.toContainText(status, "for")
            yield* page.locator("#b").pipe(Expect.toBeEnabled)
            yield* page.locator("#c").pipe(Expect.toBeChecked)
            yield* page.locator("#v").pipe(Expect.toHaveValue("set by script"))
            yield* page.locator("#v").pipe(Expect.toBeFocused)
            yield* page.locator("#v").pipe(Expect.toBeEditable)
            yield* page.locator("#tag").pipe(Expect.toHaveAttribute("data-state", "ready"))
            yield* page.locator("#tag").pipe(Expect.toHaveAttribute("data-state"))
            yield* page.getByRole("listitem").pipe(Expect.toHaveCount(3))
            yield* page.getByRole("listitem").pipe(Expect.toHaveText(["a", "b", /c/]))
            yield* page.pipe(Expect.toHaveTitle("Finished"))
            yield* page.locator("#tag").pipe(Expect.toBeDisabled, Deadline.within("200 millis"), Effect.flip)
            const error = yield* status.pipe(Expect.toHaveText("Never"), Deadline.within("300 millis"), Effect.flip)
            assert(Expect.isExpectationFailed(error), String(error))
            assert.strictEqual(error.condition, `to have the text "Never"`)
            // A round may return after the deadline; every timely value must still be the settled text.
            assert(error.history.length <= 1)
            assert.deepStrictEqual(
              error.history.map((each) => each.value),
              error.history.length === 0 ? [] : ["Done for now"]
            )
            assert.deepStrictEqual(error.last, Option.fromNullishOr(error.history.at(-1)))
          }))
        }), timeout)

      it.effect(
        "expects a page's URL across a navigation, and anything with Expect.that",
        () =>
          Effect.gen(function*() {
            const { origin, url } = yield* fixture(() => `<a href="/orders">Orders</a>`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* newPage
              yield* page.goto(url)
              yield* page.getByRole("link", { name: "Orders" }).click()
              yield* page.pipe(Expect.toHaveURL(`${origin}/orders`))
              yield* Expect.that(
                page.status,
                Condition.make(
                  "complete",
                  (status) => status._tag === "Open" && status.document.readiness === "complete"
                )
              )
              yield* Expect.that(
                page.getByText("/orders").count,
                Condition.make("one match", (count) => count === 1)
              )
              const error = yield* Expect.that(
                page.getByText("/orders").count,
                Condition.because(Condition.make("two matches", (count: number) => count === 2), "there are two")
              ).pipe(Deadline.within("250 millis"), Effect.flip)
              // However slow a check is, the deadline ends the expectation, not the subject
              assert(Expect.isExpectationFailed(error), String(error))
              assert.strictEqual(error.condition, "two matches, because there are two")
              assert.isAtLeast(error.checks.count, 1)
              const hung = yield* Expect.that(
                Effect.as(Effect.sleep("1 hour"), 1),
                Condition.make("one", (value: number) => value === 1)
              ).pipe(Deadline.within("100 millis"), Effect.flip)
              assert(Expect.isExpectationFailed(hung), String(hung))
              assert.deepStrictEqual(hung.history.map((each) => each.value), [{
                error: "a check was still running at the deadline"
              }])
            }))
          }),
        timeout
      )

      it.effect("types, clicks and scrolls with the keyboard and the mouse", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<input id="a"><input id="b"><button id="spot" style="position:absolute;left:0;top:200px;width:100px;height:50px" onclick="${
              say("'spot ' + event.detail")
            }">Spot</button><div style="height:3000px"></div>${out}<script>addEventListener('scroll', () => document.getElementById('scrolled').textContent = 'scrolled', { once: true })</script><p id="scrolled" style="position:fixed;top:0">not scrolled</p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* newPage
            yield* page.goto(url)
            yield* page.locator("#a").focus()
            yield* page.keyboard.insertText("inserted")
            yield* page.keyboard.press("Tab")
            yield* page.keyboard.pressSequentially("typed")
            assert.strictEqual(yield* page.locator("#a").readValue, "inserted")
            assert.strictEqual(yield* page.locator("#b").readValue, "typed")
            yield* page.mouse.click({ x: 50, y: 225 }, { clickCount: 2 })
            yield* page.getByText("spot 2").pipe(Expect.toBeVisible)
            assert.deepStrictEqual(yield* page.mouse.position, { x: 50, y: 225 })
            yield* page.mouse.wheel({ x: 0, y: 500 })
            yield* page.locator("#scrolled").pipe(Expect.toHaveText("scrolled"))
            const modified = page.mouse.click({ x: 50, y: 225 }, { modifiers: ["Shift"] })
            if (!(yield* supports("input.pointerModifiers"))) {
              const error = yield* Effect.flip(modified)
              assert(Mouse.isMouseError(error) && error.reason._tag === "Unsupported", String(error))
            } else {
              yield* modified
            }
          }))
        }), timeout)

      it.effect("acts on a page after another opens in its context", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => `<button onclick="${say("'clicked'")}">Click me</button>${out}`)
          yield* Effect.scoped(Effect.gen(function*() {
            const first = yield* newPage
            yield* first.goto(url)
            const second = yield* first.context.newPage
            yield* second.goto(url)
            // Each page is a window of its own, which keeps rendering behind another: a tab behind another
            // rendered about once a second in Firefox (QUIRKS.md, Q71)
            yield* first.getByRole("button", { name: "Click me" }).click().pipe(Deadline.within("5 seconds"))
            yield* first.getByText("clicked", { exact: true }).pipe(Expect.toBeVisible)
          }))
        }), timeout)
    })
  })
