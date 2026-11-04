/**
 * The fourth slice: interacting and asserting, through the public API on every backend's layer.
 * Call site 1 up to its storage state, every action, the guard on the first trusted event, held input released
 * with its scope, every read and matcher, the keyboard and the mouse, and two pages of one context.
 */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Condition, Deadline, Expect, FileInput, Keyboard, Locator, Mouse } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { LocatorImpl } from "../../../src/internal/locator.ts"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"

const timeout = 60_000

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

const fixture = Effect.fnUntraced(function*(html: (origin: string) => string) {
  const served = yield* site
  return { url: fixtureUrl(served.origin, html(served.origin)), origin: served.origin }
})

/** An element whose text a script writes, for asserting what happened. */
const out = `<p id="out">nothing yet</p>`
const say = (text: string) => `document.getElementById('out').textContent = ${text}`

export const interaction = (name: "Chromium" | "Firefox" | "WebKit", backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} interaction`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      for (const change of ["replaced", "moved", "disabled", "covered", "interrupted", "expired"] as const) {
        it.effect(`handles a queued click when ${change}`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<button id="go" data-name="old" onclick="const out = document.getElementById('out'); out.dataset.count = String(Number(out.dataset.count ?? 0) + 1); out.textContent = this.dataset.name + ' clicked ' + out.dataset.count">Go</button>${out}`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const locator = page.locator("#go")
              assert(locator instanceof LocatorImpl)
              const input = locator.owner.page.input
              const original = input.withPermit
              const waiting = yield* Deferred.make<void>()
              // Observe the actual permit boundary after preflight, without a sleep or a timing assumption.
              yield* Effect.acquireRelease(
                Effect.sync(() => {
                  input.withPermit = (effect) => Effect.andThen(Deferred.succeed(waiting, undefined), original(effect))
                }),
                () =>
                  Effect.sync(() => {
                    input.withPermit = original
                  })
              )
              const clicked = yield* original(Effect.gen(function*() {
                const fiber = yield* locator.click().pipe(Deadline.within("2 seconds"), Effect.forkScoped)
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
                    const button = document.getElementById("go") as HTMLButtonElement
                    if (change === "replaced") {
                      const replacement = button.cloneNode(true) as HTMLButtonElement
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
                assert(error.history.some((entry) =>
                  (entry.value as { _tag: string })._tag === (change === "disabled" ? "Disabled" : "Covered")
                ))
                assert.strictEqual(yield* page.locator("#out").readText, "nothing yet")
              } else {
                if (change === "interrupted" || change === "expired") {
                  yield* locator.click()
                } else yield* Fiber.join(clicked)
                assert.strictEqual(
                  yield* page.locator("#out").readText,
                  `${change === "replaced" ? "new" : "old"} clicked 1`
                )
              }
            }))
          }), timeout)
      }

      // On stock WebKit the page sees only the press
      if (name !== "WebKit") {
        it.effect("finishes a click whose mousedown opens a dialog", () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<button id="go" onmousedown="confirm('Go?'); out.textContent += 'down '" onmouseup="out.textContent += 'up '" onclick="out.textContent += 'click'">Go</button><p id="out"></p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
              const page = yield* Browser.newPage()
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
              const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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

      for (const type of ["range", "file", "checkbox"] as const) {
        it.effect(`rejects a date fill after a focus handler changes type to ${type}`, () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<input id="field" type="date" tabindex="0" value="2020-03-02" onfocus="this.type = '${type}'; before.textContent = this.value; events.textContent += 'focus;'" oninput="events.textContent += 'input;'" onchange="events.textContent += 'change;'"><p id="before"></p><p id="events"></p>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
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
                const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.locator("#field").fill("2020-03-03")
            assert.strictEqual(yield* page.locator("#field").readValue, "2020-03-03")
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
              const page = yield* Browser.newPage()
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
              const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
              const page = yield* Browser.newPage()
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

      it.effect("fills a paragraph of a design-mode frame after filling the parent", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture((origin) =>
            `<div id="parent" contenteditable>old parent</div><iframe src="${
              fixtureUrl(origin, `<body><p id="target">old</p><script>document.designMode = "on"</script></body>`)
            }"></iframe>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
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
                const page = yield* Browser.newPage()
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
              const page = yield* Browser.newPage()
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
                  const page = yield* Browser.newPage()
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
              const page = yield* Browser.newPage()
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

      // Optional checkability must be established before dispatching input.
      for (const kind of ["option", "treeitem", "native option"] as const) {
        for (const state of ["absent", "undefined", "empty"] as const) {
          for (const operation of ["read", "check", "uncheck"] as const) {
            it.effect(
              `rejects ${kind} checked ${operation} before input when aria-checked is ${state}`,
              () =>
                Effect.gen(function*() {
                  const attribute = state === "absent"
                    ? ""
                    : state === "empty"
                    ? "aria-checked=\"\""
                    : "aria-checked=\"undefined\""
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
                    const page = yield* Browser.newPage()
                    yield* page.goto(url)
                    const target = page.locator("#target")
                    const failure = yield* (operation === "read"
                      ? target.isChecked
                      : operation === "check"
                      ? target.check()
                      : target.uncheck()).pipe(
                        Deadline.within("1 second"),
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
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const target = page.locator("#target")
              assert.isFalse(yield* target.isChecked)
              assert.isFalse(yield* page.locator("#undefined").isChecked)
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
              const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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

      for (const checked of [true, false]) {
        for (const association of ["explicit", "wrapping"] as const) {
          for (
            const kind of [
              "ordinary",
              "inert-link",
              "inert-media",
              "image",
              "nearest",
              "own-ancestor",
              "prevented",
              "own",
              "native",
              "missing",
              "text",
              "plain",
              "button",
              "a",
              "area",
              "input",
              "select",
              "textarea",
              "summary",
              "audio",
              "video",
              "iframe",
              "embed",
              "object",
              "details",
              "img",
              "role-link",
              "editable",
              "role",
              "ancestor",
              "link-ancestor",
              "editable-false",
              "editable-ancestor"
            ] as const
          ) {
            it.effect(
              `label descendant ${association} ${kind} ${checked ? "check" : "uncheck"}`,
              () =>
                Effect.gen(function*() {
                  const ordinary = kind === "ordinary" || kind === "prevented" || kind === "inert-link" ||
                    kind === "inert-media" || kind === "image"
                  const own = kind === "own" || kind === "own-ancestor" || kind === "native"
                  const attrs = kind === "a" || kind === "area" ?
                    "href=\"#away\"" :
                    kind === "audio" || kind === "video" ?
                    "controls" :
                    kind === "editable" ?
                    "contenteditable=\"true\"" :
                    kind === "role"
                    ? "role=\"button\""
                    : kind === "role-link"
                    ? "role=\"link\""
                    : kind === "editable-false" ?
                    "contenteditable=\"false\""
                    : kind === "img"
                    ? "usemap=\"#map\""
                    : ""
                  const tag = [
                      "button",
                      "a",
                      "area",
                      "input",
                      "select",
                      "textarea",
                      "summary",
                      "audio",
                      "video",
                      "iframe",
                      "embed",
                      "object",
                      "details",
                      "img"
                    ].includes(kind) ?
                    kind :
                    "span"
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
                    } style="display:inline-block;width:100px;height:30px">Toggle</${targetTag}>`
                  const wrapped = kind === "ancestor" || kind === "own-ancestor" ?
                    `<button>${target}</button>` :
                    kind === "link-ancestor" ?
                    `<a href="#away">${target}</a>` :
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
                    const page = yield* Browser.newPage()
                    yield* page.goto(url)
                    const target = page.locator("#target")
                    const action = () =>
                      checked
                        ? target.check({ position: { x: 7, y: 9 } })
                        : target.uncheck({ position: { x: 7, y: 9 } })
                    if (ordinary || own) {
                      if (kind === "prevented") {
                        const error = yield* action().pipe(Effect.flip)
                        assert(Locator.isLocatorError(error) && error.reason._tag === "StateUnchanged", String(error))
                        assert.strictEqual(yield* page.locator("#box").isChecked, !checked)
                        assert.strictEqual(yield* page.locator("#out").readText, "target:7:9")
                      } else {
                        yield* action()
                        assert.strictEqual(yield* (own ? target : page.locator("#box")).isChecked, checked)
                        assert.strictEqual(yield* page.locator("#out").readText, "target:7:9")
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
            const page = yield* Browser.newPage()
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
              const page = yield* Browser.newPage()
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
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              yield* page.locator("#target").check()
              assert.strictEqual(yield* page.locator("#box").isChecked, true)
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
                  const page = yield* Browser.newPage()
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
                const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
                const page = yield* Browser.newPage()
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
                const page = yield* Browser.newPage()
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
              const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
              const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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

      it.effect("expects what changes later, in the page, and fails with what it saw", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            `<title>Waiting</title><p id="status">Working</p><button id="b" disabled>Go</button><input id="c" type="checkbox"><input id="v"><ul><li>a</li></ul><p id="tag">Tag</p><script>setTimeout(() => { document.getElementById('status').textContent = 'Done for now'; document.getElementById('b').disabled = false; document.getElementById('c').checked = true; document.getElementById('v').value = 'set by script'; document.getElementById('v').focus(); document.getElementById('tag').dataset.state = 'ready'; document.querySelector('ul').innerHTML = '<li>a</li><li>b</li><li>c</li>'; document.title = 'Finished' }, 300)</script>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
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
            assert.deepStrictEqual(error.history.map((each) => each.value), ["Done for now"])
          }))
        }), timeout)

      it.effect(
        "expects a page's URL across a navigation, and anything with Expect.that",
        () =>
          Effect.gen(function*() {
            const { origin, url } = yield* fixture(() => `<a href="/orders">Orders</a>`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const first = yield* Browser.newPage()
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
