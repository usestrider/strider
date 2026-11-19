/** Recording overlays, `Capability.Overlay`: shown, removed, hidden, kept across navigation, and out of queries. */
import { assert } from "@effect/vitest"
import { Capability } from "@usestrider/browser"
import type { Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
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

/** The overlay cases, registered in a suite whose shared context they leave as they found it. */
export const overlays = <R>(it: ReturnType<typeof SharedContext.guard<R>>) => {
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
}
