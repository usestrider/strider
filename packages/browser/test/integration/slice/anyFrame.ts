/**
 * The search across a page's frames (`page.anyFrame`, `frameLocator.anyFrame`): one case for each rule of it.
 */
import { assert, describe, layer } from "@effect/vitest"
import { type Browser, Deadline, Expect, Locator } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import { vi } from "vitest"
import * as Handles from "../../../src/internal/handles.ts"
import { site } from "../adapter/harness.ts"
import * as SharedContext from "./sharedContext.ts"
import { newPage } from "./sharedContext.ts"

const timeout = 60_000

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

/** A button that writes "clicked" into the `#out` of its own document. */
const button = (label: string) =>
  `<button onclick="document.getElementById('out').textContent='clicked'">${label}</button><p id="out"></p>`

const frame = (origin: string, html: string) => `<iframe src="${fixtureUrl(origin, html)}"></iframe>`

const strict = (error: unknown, frames: number) => {
  assert(Locator.isLocatorError(error), String(error))
  assert.strictEqual(error.reason._tag, "StrictViolation")
  if (error.reason._tag === "StrictViolation") {
    assert.include(error.reason.hint, `${frames} frames`)
  }
}

export const anyFrame = (name: "Chromium" | "Firefox" | "WebKit", backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} any-frame locators`, () => {
    layer(SharedContext.layer(backend), { excludeTestServices: true, timeout })((suite) => {
      const it = SharedContext.guard(suite)

      it.effect(
        "acts in the main frame or the one child frame that matches",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            yield* page.goto(fixtureUrl(origin, `${button("Main")}${frame(origin, button("Pay"))}`))
            yield* page.anyFrame.getByRole("button", { name: "Main" }).click()
            assert.strictEqual(yield* page.locator("#out").readText, "clicked")
            yield* page.anyFrame.getByRole("button", { name: "Pay" }).click()
            assert.strictEqual(yield* page.frame(page.locator("iframe")).locator("#out").readText, "clicked")
            assert.strictEqual(yield* page.anyFrame.getByRole("button", { name: "Pay" }).count, 1)
          })),
        timeout
      )

      it.effect(
        "fails strictly when more than one frame matches, for actions and count alike",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            yield* page.goto(fixtureUrl(origin, `${button("Pay")}${frame(origin, button("Pay"))}`))
            const pay = page.anyFrame.getByRole("button", { name: "Pay" })
            strict(yield* pay.click().pipe(Deadline.within("1 second"), Effect.flip), 2)
            strict(yield* pay.count.pipe(Effect.flip), 2)
            assert.strictEqual(yield* page.locator("#out").readText, "")
          })),
        timeout
      )

      it.effect(
        "matches nothing until a frame with a match appears, and waits for it",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            const later = frame(origin, button("Pay"))
            yield* page.goto(fixtureUrl(origin, `<p id="out"></p>`))
            const pay = page.anyFrame.getByRole("button", { name: "Pay" })
            assert.strictEqual(yield* pay.count, 0)
            const missing = yield* pay.readText.pipe(Effect.flip)
            assert(Locator.isLocatorError(missing), String(missing))
            assert.strictEqual(missing.reason._tag, "NoMatch")
            const clicked = yield* pay.click().pipe(Deadline.within("5 seconds"), Effect.forkScoped)
            yield* page.evaluateInMainWorld(
              (html: string) => document.body.insertAdjacentHTML("beforeend", html),
              later
            )
            yield* Fiber.join(clicked)
            assert.strictEqual(yield* page.frame(page.locator("iframe")).locator("#out").readText, "clicked")
          })),
        timeout
      )

      it.effect(
        "describes each actual match in a cross-frame strictness error",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            yield* page.goto(fixtureUrl(origin, `${button("Pay")}${frame(origin, button("Pay") + button("Pay"))}`))
            const error = yield* page.anyFrame.getByRole("button", { name: "Pay" }).count.pipe(Effect.flip)
            assert(Locator.isLocatorError(error), String(error))
            assert.strictEqual(error.reason._tag, "StrictViolation")
            if (error.reason._tag === "StrictViolation") {
              assert.deepEqual(error.reason.candidates.map((candidate) => candidate.visible), [true, true, true])
              for (const candidate of error.reason.candidates) assert.include(candidate.description, "Pay")
            }
          })),
        timeout
      )

      it.effect(
        "keeps the selected frame when a preceding sibling disappears before input",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            yield* page.goto(
              fixtureUrl(
                origin,
                `<style>iframe { display: block; width: 300px; height: 100px; }</style>${
                  frame(origin, "<p>Before</p>")
                }${frame(origin, button("Pay"))}${frame(origin, button("Decoy"))}`
              )
            )
            const execution = Handles.page(page).entry.execution
            const original = execution.action
            let removed = false
            const hook = vi.spyOn(execution, "action").mockImplementation((...args) =>
              original(...args).pipe(Effect.tap((answer) => {
                if (!removed && args[2].apply && !("_tag" in answer) && answer.response._tag === "Ready") {
                  removed = true
                  // Remove the sibling after the final target check and before parent-frame translation.
                  return page.evaluateInMainWorld(() => document.querySelector("iframe")!.remove()).pipe(Effect.orDie)
                }
                return Effect.void
              }))
            )
            yield* Effect.addFinalizer(() => Effect.sync(() => hook.mockRestore()))
            yield* page.anyFrame.getByRole("button", { name: "Pay" }).click()
            hook.mockRestore()
            assert.isTrue(removed)
            assert.deepEqual({
              pay: yield* page.frame(page.locator("iframe").nth(0)).locator("#out").readText,
              decoy: yield* page.frame(page.locator("iframe").nth(1)).locator("#out").readText
            }, { pay: "clicked", decoy: "" })
          })),
        timeout
      )

      it.effect(
        "acts through no other iframe when the one page.frame named by position changes before input",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            yield* page.goto(
              fixtureUrl(
                origin,
                `<style>iframe { display: block; width: 300px; height: 100px; }</style>${
                  frame(origin, "<p>Before</p>")
                }${frame(origin, button("Pay"))}${frame(origin, button("Decoy"))}`
              )
            )
            const execution = Handles.page(page).entry.execution
            const original = execution.action
            let removed = false
            const hook = vi.spyOn(execution, "action").mockImplementation((...args) =>
              original(...args).pipe(Effect.tap((answer) => {
                if (!removed && args[2].apply && !("_tag" in answer) && answer.response._tag === "Ready") {
                  removed = true
                  // Remove the sibling after the final target check and before parent-frame translation.
                  return page.evaluateInMainWorld(() => document.querySelector("iframe")!.remove()).pipe(Effect.orDie)
                }
                return Effect.void
              }))
            )
            yield* Effect.addFinalizer(() => Effect.sync(() => hook.mockRestore()))
            // nth(1) holds the Pay frame until the sibling before it goes; then it holds the decoy, which has no Pay
            const error = yield* page.frame(page.locator("iframe").nth(1)).getByRole("button", { name: "Pay" }).click()
              .pipe(Deadline.within("1 second"), Effect.flip)
            assert(Deadline.isTimeout(error), String(error))
            hook.mockRestore()
            assert.isTrue(removed)
            assert.deepEqual({
              pay: yield* page.frame(page.locator("iframe").nth(0)).locator("#out").readText,
              decoy: yield* page.frame(page.locator("iframe").nth(1)).locator("#out").readText
            }, { pay: "", decoy: "" })
          })),
        timeout
      )

      it.effect(
        "looks up a page.frame iframe's frame once in each round of a click",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            yield* page.goto(fixtureUrl(origin, frame(origin, button("Pay"))))
            const locator = page.frame(page.locator("iframe")).getByRole("button", { name: "Pay" })
            assert.strictEqual(yield* locator.count, 1)
            const behind = Handles.page(page)
            const lookup = vi.spyOn(behind.runtime.model.adapter, "contentFrame")
            const round = vi.spyOn(behind.entry.execution, "action")
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                lookup.mockRestore()
                round.mockRestore()
              })
            )
            yield* locator.click()
            const counted = { lookups: lookup.mock.calls.length, rounds: round.mock.calls.length }
            lookup.mockRestore()
            round.mockRestore()
            assert.strictEqual(yield* page.frame(page.locator("iframe")).locator("#out").readText, "clicked")
            // Each round routes through the iframe once; checking it still holds its frame reads that frame again
            assert.isAbove(counted.rounds, 0)
            assert.deepEqual(counted, { lookups: counted.rounds, rounds: counted.rounds })
          })),
        timeout
      )

      it.effect(
        "completes a framed click while other callers read the same frame",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            yield* page.goto(fixtureUrl(origin, frame(origin, button("Pay"))))
            const pay = page.frame(page.locator("iframe")).getByRole("button", { name: "Pay" })
            assert.strictEqual(yield* pay.count, 1)
            const execution = Handles.page(page).entry.execution
            const original = execution.action
            const hook = vi.spyOn(execution, "action").mockImplementation((...args) =>
              original(...args).pipe(Effect.tap((answer) => {
                if (args[2].apply && !("_tag" in answer) && answer.response._tag === "Ready") {
                  // Other callers can finish reads between the target check and parent geometry read.
                  // The page stays unchanged: reading it must not invalidate an action's frame identity.
                  return Effect.forEach(Array.from({ length: 17 }), () => pay.count, { discard: true }).pipe(
                    Effect.orDie
                  )
                }
                return Effect.void
              }))
            )
            yield* Effect.addFinalizer(() => Effect.sync(() => hook.mockRestore()))
            yield* pay.click().pipe(Deadline.within("5 seconds"))
            hook.mockRestore()
            assert.strictEqual(yield* page.frame(page.locator("iframe")).locator("#out").readText, "clicked")
          })),
        timeout
      )

      it.effect(
        "fills an editable element in a cross-site frame without a preceding click",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin, crossSite } = yield* site
            const page = yield* newPage
            yield* page.goto(fixtureUrl(origin, frame(crossSite, "<div contenteditable id=\"edit\">old</div>")))
            const edit = page.frame(page.locator("iframe")).locator("#edit")
            yield* edit.fill("new")
            assert.strictEqual(yield* edit.readText, "new")
          })),
        timeout
      )

      it.effect(
        "caps cross-frame candidate descriptions at ten while retaining the total",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            const labels = Array.from({ length: 12 }, (_, index) => `Pay ${index}`)
            yield* page.goto(
              fixtureUrl(
                origin,
                labels.slice(0, 6).map(button).join("") + frame(origin, labels.slice(6).map(button).join(""))
              )
            )
            const error = yield* page.anyFrame.getByRole("button", { name: "Pay" }).count.pipe(Effect.flip)
            assert(Locator.isLocatorError(error), String(error))
            assert.strictEqual(error.reason._tag, "StrictViolation")
            if (error.reason._tag === "StrictViolation") {
              assert.include(error.reason.hint, "12 elements match in 2 frames")
              assert.lengthOf(error.reason.candidates, 10)
              assert.strictEqual(error.reason.count, 12)
              assert.match(error.reason.message, /^12 matches/)
              for (const [index, candidate] of error.reason.candidates.entries()) {
                assert.include(candidate.description, labels[index]!)
                assert.isTrue(candidate.visible)
              }
            }
          })),
        timeout
      )

      it.effect(
        "does not infer a unique visible match from truncated candidates",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            const hidden = `<button hidden>Pay</button>`.repeat(10)
            yield* page.goto(fixtureUrl(origin, `${button("Pay")}${frame(origin, hidden + button("Pay"))}`))
            const pay = page.anyFrame.locator("button")
            const error = yield* pay.count.pipe(Effect.flip)
            assert(Locator.isLocatorError(error), String(error))
            assert.strictEqual(error.reason._tag, "StrictViolation")
            if (error.reason._tag === "StrictViolation") {
              assert.include(error.reason.hint, "12 elements match in 2 frames")
              strict(yield* pay.filter({ visible: true }).count.pipe(Effect.flip), 2)
              assert.deepEqual(error.reason.suggestions, [])
              assert.strictEqual(error.reason.count, 12)
              assert.match(error.reason.message, /^12 matches/)
            }
            // The single-document path must count visibility beyond its own ten-candidate sample too.
            const child = page.frame(page.locator("iframe")).locator("button")
            const single = yield* child.readText.pipe(Effect.flip)
            assert(Locator.isLocatorError(single), String(single))
            assert.strictEqual(single.reason._tag, "StrictViolation")
            if (single.reason._tag === "StrictViolation") {
              assert.strictEqual(single.reason.count, 11)
              assert.match(single.reason.message, /^11 matches/)
              assert.deepEqual(single.reason.candidates.map((candidate) => candidate.visible), Array(10).fill(false))
              assert.lengthOf(single.reason.suggestions, 1)
              assert.strictEqual(yield* child.filter({ visible: true }).count, 1)
            }
            yield* page.evaluateInMainWorld(() =>
              document.querySelector("iframe")!.contentDocument!.querySelector("button")!.removeAttribute("hidden")
            )
            const two = yield* child.readText.pipe(Effect.flip)
            assert(Locator.isLocatorError(two), String(two))
            assert.strictEqual(two.reason._tag, "StrictViolation")
            if (two.reason._tag === "StrictViolation") {
              assert.strictEqual(two.reason.count, 11)
              assert.deepEqual(two.reason.suggestions, [])
            }
          })),
        timeout
      )

      it.effect(
        "refuses a ref whose live document is outside the current search",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            yield* page.goto(
              fixtureUrl(
                origin,
                `<iframe id="scope" src="${fixtureUrl(origin, button("Pay"))}"></iframe>${
                  frame(origin, button("Other"))
                }`
              )
            )
            const snapshot = yield* page.frame(page.locator("#scope")).anyFrame.getByRole("button", { name: "Pay" })
              .snapshot()
            const match = [...snapshot.refs].find(([, node]) => node.role.role === "button")!
            yield* page.evaluateInMainWorld(() => {
              document.querySelector("#scope")!.removeAttribute("id")
              document.querySelectorAll("iframe")[1]!.id = "scope"
            })
            const error = yield* snapshot.ref(match[0]).click().pipe(Effect.flip)
            assert(Locator.isLocatorError(error), String(error))
            assert.strictEqual(error.reason._tag, "StaleRef")
            if (error.reason._tag === "StaleRef") assert.strictEqual(error.reason.why, "Replaced")
            assert.strictEqual(yield* page.frame(page.locator("iframe").nth(0)).locator("#out").readText, "")
          })),
        timeout
      )

      it.effect(
        "uses snapshot refs from the document selected by an any-frame search",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            yield* page.goto(fixtureUrl(origin, frame(origin, button("Pay"))))
            const snapshot = yield* page.anyFrame.getByRole("button", { name: "Pay" }).snapshot()
            const match = [...snapshot.refs].find(([, node]) => node.role.role === "button")!
            yield* snapshot.ref(match[0]).click()
            assert.strictEqual(yield* page.frame(page.locator("iframe")).locator("#out").readText, "clicked")
          })),
        timeout
      )

      it.effect("never matches a chain across a frame boundary", () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* newPage
          yield* page.goto(fixtureUrl(origin, `<div id="outer">${frame(origin, `<p id="inner">x</p>`)}</div>`))
          assert.strictEqual(yield* page.anyFrame.locator("#outer #inner").count, 0)
          assert.strictEqual(yield* page.anyFrame.locator("#inner").count, 1)
        })), timeout)

      it.effect(
        "enters a frame it found, and searches below a frame locator only",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* newPage
            const checkout = `<iframe id="checkout" src="${
              fixtureUrl(origin, `${button("Pay")}${frame(origin, button("Pay"))}`)
            }"></iframe>`
            yield* page.goto(fixtureUrl(origin, `${button("Pay")}${frame(origin, checkout)}`))
            // The entered frame's own subframes aren't searched
            const entered = page.anyFrame.frame(page.anyFrame.locator("#checkout"))
            yield* entered.getByRole("button", { name: "Pay" }).click()
            assert.strictEqual(yield* entered.locator("#out").readText, "clicked")
            // Below the frame locator, its subframe and it both match; the page's own button is outside
            const below = page.frame(page.locator("iframe")).anyFrame
            assert.strictEqual(yield* below.locator("#checkout").count, 1)
            strict(yield* below.getByRole("button", { name: "Pay" }).count.pipe(Effect.flip), 2)
            assert.strictEqual(yield* page.locator("#out").readText, "")
          })),
        timeout
      )

      it.effect("searches past a sibling frame that has no document yet", () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* newPage
          yield* page.goto(
            fixtureUrl(origin, `<iframe src="${origin}/pending-page"></iframe>${frame(origin, button("Pay"))}`),
            { waitUntil: "commit" }
          )
          const pay = page.anyFrame.getByRole("button", { name: "Pay" })
          // The bound is on finding Pay, which needs no rendered frame; a click also waits for the page to draw
          yield* pay.pipe(Expect.toHaveText("Pay"), Deadline.within("1 second"))
          yield* pay.click()
          assert.strictEqual(yield* page.anyFrame.locator("#out").readText, "clicked")
        })), timeout)

      it.effect("acts in a cross-site frame", () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin, crossSite } = yield* site
          const page = yield* newPage
          yield* page.goto(fixtureUrl(origin, frame(crossSite, button("Pay"))))
          yield* page.anyFrame.getByRole("button", { name: "Pay" }).click()
          assert.strictEqual(yield* page.anyFrame.locator("#out").readText, "clicked")
        })), timeout)
    })
  })
