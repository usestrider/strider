/** Recording overlays, `Capability.Overlay`: shown, removed, hidden, kept across navigation, and out of queries. */
import { assert } from "@effect/vitest"
import { Capability, Deadline } from "@usestrider/browser"
import type { Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import { pngRegion } from "../../pngRegion.ts"
import { site } from "../adapter/harness.ts"
import type * as SharedContext from "./sharedContext.ts"
import { newPage } from "./sharedContext.ts"

/** A red square at the page's top left, which the overlay's presence is read from. */
const square = `<div style="position:fixed;left:0;top:0;width:40px;height:40px;background:rgb(255,0,0)"></div>`

/** Whether the page's top left pixels are the overlay's red. */
const red = Effect.fnUntraced(function*(page: Page.Page) {
  const pixels = pngRegion(yield* page.screenshot(), { x: 10, y: 10, width: 4, height: 4 })
  return pixels.every((pixel) => pixel[0]! > 240 && pixel[1]! < 10 && pixel[2]! < 10)
})

/** A fresh page showing `html` on the local site. */
const opened = Effect.fnUntraced(function*(html: string) {
  const served = yield* site
  const page = yield* newPage
  yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`)
  return page
})

/** Whether the 4×4 pixels at (`x`, `y`) are the colour `test` accepts. */
const pixelsAt = Effect.fnUntraced(function*(
  page: Page.Page,
  x: number,
  y: number,
  test: (pixel: ReadonlyArray<number>) => boolean
) {
  const pixels = pngRegion(yield* page.screenshot(), { x, y, width: 4, height: 4 })
  return pixels.every(test)
})
const isRed = (pixel: ReadonlyArray<number>) => pixel[0]! > 240 && pixel[1]! < 10 && pixel[2]! < 10
const isWhite = (pixel: ReadonlyArray<number>) => pixel.slice(0, 3).every((channel) => channel > 245)
const isDark = (pixel: ReadonlyArray<number>) => pixel.slice(0, 3).every((channel) => channel < 60)

/** A 60×60 button at the page's top left that records when it was clicked in the title. */
const button = `<style>body{margin:0}button{position:absolute;left:0;top:0;width:60px;height:60px;margin:0}</style>` +
  `<button onclick="document.title = 'clicked'">Go</button>`

/** A point marker 40 pixels square, red, centered on the action's point. */
const point = "background:rgb(255,0,0);width:40px;height:40px"

/** The overlay cases, registered in a suite whose shared context they leave as they found it. */
export const overlays = <R>(it: ReturnType<typeof SharedContext.guard<R>>) => {
  it.effect("excludes a moved overlay host from readHtml", () =>
    Effect.gen(function*() {
      const page = yield* opened("<p>page</p><strider-overlay id='page-owned'>Own</strider-overlay>")
      const before = yield* page.readHtml
      const overlay = yield* page.capability(Capability.Overlay)
      yield* overlay.add(square)
      yield* page.evaluateInMainWorld(() => {
        document.body.appendChild(document.documentElement.lastElementChild!)
      })
      assert.strictEqual(yield* page.locator("strider-overlay").count, 1)
      assert.strictEqual(yield* page.readHtml, before)
    }))

  it.effect("readHtml preserves page markup identical to the overlay host", () =>
    Effect.gen(function*() {
      const page = yield* opened("<p>page</p>")
      const overlay = yield* page.capability(Capability.Overlay)
      yield* overlay.add(square)
      const expected = yield* page.evaluateInMainWorld(() => {
        const host = document.documentElement.lastElementChild!
        const copy = host.cloneNode(true)
        const section = document.createElement("section")
        section.appendChild(copy)
        document.documentElement.appendChild(section)
        const expected = document.documentElement.cloneNode(true) as Element
        expected.children[2]!.remove()
        return document.doctype === null ?
          expected.outerHTML :
          new XMLSerializer().serializeToString(document.doctype) + expected.outerHTML
      })
      assert.strictEqual(yield* page.readHtml, expected)
    }))

  it.effect("a released overlay chapter cannot erase a later acquisition", () =>
    Effect.gen(function*() {
      const page = yield* opened("<p>page</p>")
      const held = yield* Scope.make()
      const old = yield* page.capability(Capability.Overlay).pipe(Scope.provide(held))
      const chapter = yield* old.chapter("Old chapter", { duration: "1 second" }).pipe(Effect.forkChild)
      let drawn = false
      const started = performance.now()
      while (!drawn && performance.now() - started < 900) {
        drawn = yield* page.evaluateInMainWorld(() => document.querySelector("strider-overlay") !== null)
      }
      assert.isTrue(drawn)
      yield* Scope.close(held, Exit.void)
      const current = yield* page.capability(Capability.Overlay)
      yield* current.add(square)
      assert.isTrue(yield* red(page))
      yield* Fiber.join(chapter)
      assert.isTrue(yield* red(page))
    }))

  it.effect("bounds a chapter wait by its operation deadline", () =>
    Effect.gen(function*() {
      const page = yield* opened("<p>page</p>")
      const overlay = yield* page.capability(Capability.Overlay)
      const started = performance.now()
      const error = yield* overlay.chapter("Long chapter", { duration: "2 seconds" }).pipe(
        Deadline.within("200 millis"),
        Effect.flip
      )
      assert.strictEqual(error._tag, "Timeout")
      assert.isBelow(performance.now() - started, 1_500)
    }))

  it.effect("removes the existing cursor when the latest actions scope selects none", () =>
    Effect.gen(function*() {
      const page = yield* opened(button)
      const overlay = yield* page.capability(Capability.Overlay)
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.style.background = "white"
        document.querySelector("button")!.style.border = "0"
      })
      yield* overlay.actions({ duration: "0 millis" })
      yield* page.getByRole("button", { name: "Go" }).click()
      assert.isTrue(yield* pixelsAt(page, 31, 40, isDark))
      yield* Effect.scoped(Effect.gen(function*() {
        yield* overlay.actions({ duration: "0 millis", cursor: "none" })
        yield* page.getByRole("button", { name: "Go" }).click()
        assert.isTrue(yield* pixelsAt(page, 31, 40, isWhite))
      }))
    }))

  it.effect("shows an overlay until the scope that added it closes", () =>
    Effect.gen(function*() {
      const page = yield* opened("<p>page</p>")
      const overlay = yield* page.capability(Capability.Overlay)
      yield* Effect.scoped(Effect.gen(function*() {
        yield* overlay.add(square)
        assert.isTrue(yield* red(page))
      }))
      assert.isFalse(yield* red(page))
    }))

  it.effect("removes an overlay once its duration passes, and not before", () =>
    Effect.gen(function*() {
      const page = yield* opened("<p>page</p>")
      const overlay = yield* page.capability(Capability.Overlay)
      const started = performance.now()
      yield* overlay.add(square, { duration: "1 second" })
      const shown = yield* red(page)
      const before = performance.now() - started
      let gone = false
      while (!gone && performance.now() - started < 5_000) gone = !(yield* red(page))
      const removed = performance.now() - started
      // Only a screenshot taken before the duration passed must show it
      if (before < 900) assert.isTrue(shown)
      assert.isTrue(gone)
      assert.isAtLeast(removed, 1_000)
    }))

  it.effect("shows its overlays again in the document a main-frame navigation commits", () =>
    Effect.gen(function*() {
      const served = yield* site
      const page = yield* opened("<p>first</p>")
      const overlay = yield* page.capability(Capability.Overlay)
      yield* overlay.add(square)
      yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent("<p>second</p>")}`)
      let shown = false
      const started = performance.now()
      while (!shown && performance.now() - started < 5_000) shown = yield* red(page)
      assert.isTrue(shown)
    }))

  it.effect("hides every overlay without removing it, and shows it again", () =>
    Effect.gen(function*() {
      const page = yield* opened("<p>page</p>")
      const overlay = yield* page.capability(Capability.Overlay)
      yield* overlay.add(square)
      yield* overlay.hide
      assert.isFalse(yield* red(page))
      yield* overlay.show
      assert.isTrue(yield* red(page))
    }))

  it.effect("keeps overlays out of locators, snapshots and the hit test", () =>
    Effect.gen(function*() {
      const page = yield* opened(
        `<button onclick="document.title = 'clicked'">Under</button>`
      )
      const overlay = yield* page.capability(Capability.Overlay)
      yield* overlay.add(
        `<div style="position:fixed;inset:0;background:rgba(0,0,255,0.2)"><button>Overlay text</button></div>`
      )
      yield* overlay.chapter("Chapter text", { description: "Chapter detail", duration: "1 millis" })
      yield* overlay.add(`<h1>Overlay heading</h1>`)
      assert.strictEqual(yield* page.getByText("Overlay text").count, 0)
      assert.strictEqual(yield* page.getByRole("heading").count, 0)
      assert.strictEqual(yield* page.locator("body *").count, 1)
      assert.strictEqual(yield* page.locator("html > *").count, 2)
      const snapshot = yield* page.snapshot()
      assert.notInclude(snapshot.text, "Overlay")
      yield* page.getByRole("button", { name: "Under" }).click()
      assert.strictEqual(yield* page.title, "clicked")
    }))

  it.effect("returns from a chapter once its duration has passed", () =>
    Effect.gen(function*() {
      const page = yield* opened("<p>page</p>")
      const overlay = yield* page.capability(Capability.Overlay)
      const started = performance.now()
      yield* overlay.chapter("<b>Checkout</b>", { description: "Paying by card", duration: "500 millis" })
      assert.isAtLeast(performance.now() - started, 500)
      assert.strictEqual(yield* page.getByText("Checkout").count, 0)
    }))
  it.effect("draws an action's annotation and waits its duration before the input", () =>
    Effect.gen(function*() {
      const page = yield* opened(button)
      const overlay = yield* page.capability(Capability.Overlay)
      yield* overlay.actions({ duration: "1 second", style: { point } })
      const started = performance.now()
      const click = yield* page.getByRole("button", { name: "Go" }).click().pipe(Effect.forkChild)
      let shown = false
      while (!shown && performance.now() - started < 900) shown = yield* pixelsAt(page, 14, 14, isRed)
      const title = yield* page.title
      yield* Fiber.join(click)
      assert.isTrue(shown)
      assert.notStrictEqual(title, "clicked")
      assert.strictEqual(yield* page.title, "clicked")
      assert.isAtLeast(performance.now() - started, 1_000)
    }))

  it.effect("removes an action's annotation when the action is interrupted during its wait", () =>
    Effect.gen(function*() {
      const page = yield* opened(button)
      const overlay = yield* page.capability(Capability.Overlay)
      yield* overlay.actions({ duration: "2 seconds", cursor: "none", style: { point } })
      const started = performance.now()
      const click = yield* page.getByRole("button", { name: "Go" }).click().pipe(Effect.forkChild)
      let shown = false
      while (!shown && performance.now() - started < 1_500) shown = yield* pixelsAt(page, 14, 14, isRed)
      yield* Fiber.interrupt(click)
      assert.isTrue(shown)
      const interrupted = performance.now()
      let removed = false
      while (!removed && performance.now() - interrupted < 1_000) removed = !(yield* pixelsAt(page, 14, 14, isRed))
      assert.isTrue(removed)
      assert.notStrictEqual(yield* page.title, "clicked")
    }))

  it.effect("draws a cursor at the last action's point, and none with cursor none", () =>
    Effect.gen(function*() {
      const page = yield* opened(button)
      const overlay = yield* page.capability(Capability.Overlay)
      yield* Effect.scoped(Effect.gen(function*() {
        yield* overlay.actions({ duration: "0 millis" })
        yield* page.getByRole("button", { name: "Go" }).click()
        assert.isTrue(yield* pixelsAt(page, 31, 40, isDark))
      }))
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.style.background = "white"
        document.querySelector("button")!.style.border = "0"
      })
      yield* overlay.actions({ duration: "0 millis", cursor: "none" })
      yield* page.getByRole("button", { name: "Go" }).click()
      assert.isTrue(yield* pixelsAt(page, 31, 40, isWhite))
    }))

  it.effect("annotates an action in an iframe at its point in the top-level page", () =>
    Effect.gen(function*() {
      const page = yield* opened(
        `<style>body{margin:0}iframe{position:absolute;left:100px;top:100px;width:200px;height:200px;border:0}</style>` +
          `<iframe srcdoc="${button.replaceAll("\"", "&quot;")}"></iframe>`
      )
      const overlay = yield* page.capability(Capability.Overlay)
      yield* overlay.actions({ duration: "1 second", style: { point } })
      const target = page.frame(page.locator("iframe")).getByRole("button", { name: "Go" })
      const started = performance.now()
      const click = yield* target.click().pipe(Effect.forkChild)
      let shown = false
      while (!shown && performance.now() - started < 900) shown = yield* pixelsAt(page, 114, 114, isRed)
      yield* Fiber.join(click)
      assert.isTrue(shown)
    }))

  it.effect("runs actions undelayed once the scope of actions closes", () =>
    Effect.gen(function*() {
      const page = yield* opened(button)
      const overlay = yield* page.capability(Capability.Overlay)
      // A trial sends no input, so it isn't annotated or delayed while actions are shown
      yield* Effect.scoped(Effect.gen(function*() {
        yield* overlay.actions({ duration: "1 second" })
        const trial = performance.now()
        yield* page.getByRole("button", { name: "Go" }).click({ trial: true })
        assert.isBelow(performance.now() - trial, 900)
      }))
      const started = performance.now()
      yield* page.getByRole("button", { name: "Go" }).click()
      assert.isBelow(performance.now() - started, 900)
      assert.strictEqual(yield* page.title, "clicked")
    }))

  it.effect("annotates actions alongside a locator handler, released in either order", () =>
    Effect.gen(function*() {
      const page = yield* opened(button)
      const overlay = yield* page.capability(Capability.Overlay)
      const go = page.getByRole("button", { name: "Go" })
      const timed = Effect.gen(function*() {
        const started = performance.now()
        yield* go.click()
        return performance.now() - started
      })
      for (const handlerFirst of [true, false]) {
        const handler = yield* Scope.make()
        const actions = yield* Scope.make()
        yield* page.addLocatorHandler(page.locator("#never"), () => Effect.void).pipe(Scope.provide(handler))
        yield* overlay.actions({ duration: "400 millis" }).pipe(Scope.provide(actions))
        assert.isAtLeast(yield* timed, 400)
        yield* Scope.close(handlerFirst ? handler : actions, Exit.void)
        const between = yield* timed
        if (handlerFirst) assert.isAtLeast(between, 400)
        else assert.isBelow(between, 390)
        yield* Scope.close(handlerFirst ? actions : handler, Exit.void)
        assert.isBelow(yield* timed, 390)
      }
    }))
}
