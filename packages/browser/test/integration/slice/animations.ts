/**
 * Screenshots with `animations: "disabled"`: an infinite animation captured at its start and running again after, a
 * finite transition finished with its event's handler in the capture, animations in shadow roots and child frames,
 * one paused at a playback rate of 0 left alone, and an element captured where its animation leaves it.
 */
import { assert } from "@effect/vitest"
import { Expect } from "@usestrider/browser"
import type { Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { pngRegion } from "../../pngRegion.ts"
import { site } from "../adapter/harness.ts"
import type * as SharedContext from "./sharedContext.ts"
import { newPage } from "./sharedContext.ts"

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

const isRed = (pixel: ReadonlyArray<number>) => pixel[0]! > 240 && pixel[1]! < 10 && pixel[2]! < 10
const isBlue = (pixel: ReadonlyArray<number>) => pixel[0]! < 10 && pixel[1]! < 10 && pixel[2]! > 240

/** Whether the 4×4 pixels at (`x`, `y`) of `png` are the colour `test` accepts. */
const pixelsAt = (png: Uint8Array, x: number, y: number, test: (pixel: ReadonlyArray<number>) => boolean) =>
  pngRegion(png, { x, y, width: 4, height: 4 }).every(test)

/** A red 40×40 box at the top left of its document whose infinite animation paints it blue, with `extra` CSS. */
const infinite = (extra = "") =>
  `<style>body{margin:0}@keyframes blue{from{background:rgb(0,0,255)}to{background:rgb(0,0,255)}}` +
  `.box{position:absolute;left:0;top:0;width:40px;height:40px;background:rgb(255,0,0);` +
  `animation:blue 1s infinite}${extra}</style>`

/** A fresh page showing `html` on the local site. */
const opened = Effect.fnUntraced(function*(html: string) {
  const served = yield* site
  const page = yield* newPage
  yield* page.goto(fixtureUrl(served.origin, html))
  return page
})

const playStates = (page: Page.Page) =>
  page.evaluateInMainWorld(() => document.getAnimations().map((animation) => animation.playState))

/** The animation cases, registered in a suite whose shared context they leave as they found it. */
export const animations = <R>(it: ReturnType<typeof SharedContext.guard<R>>) => {
  it.effect("captures an infinite animation at its start and runs it again after", () =>
    Effect.gen(function*() {
      const page = yield* opened(`${infinite()}<div class="box"></div>`)
      assert.isTrue(pixelsAt(yield* page.screenshot(), 10, 10, isBlue))
      assert.isTrue(pixelsAt(yield* page.screenshot({ animations: "disabled" }), 10, 10, isRed))
      assert.deepStrictEqual(yield* playStates(page), ["running"])
      assert.isTrue(pixelsAt(yield* page.screenshot(), 10, 10, isBlue))
    }))

  it.effect("finishes a transition, and captures what its transitionend handler changed", () =>
    Effect.gen(function*() {
      const page = yield* opened(
        `<style>body{margin:0}div{position:absolute;top:0;width:40px;height:40px;background:rgb(255,0,0)}` +
          `#box{left:0;transition:background-color 1000s linear}#box.on{background:rgb(0,0,255)}` +
          `#mark{left:60px}</style><div id="box"></div><div id="mark"></div>` +
          `<script>box.addEventListener("transitionend",()=>{mark.style.background="rgb(0,0,255)"});` +
          `getComputedStyle(box).backgroundColor;box.classList.add("on")</script>`
      )
      const png = yield* page.screenshot({ animations: "disabled" })
      assert.isTrue(pixelsAt(png, 10, 10, isBlue))
      assert.isTrue(pixelsAt(png, 70, 10, isBlue))
      assert.deepStrictEqual(yield* playStates(page), [])
    }))

  it.effect("stops animations in open shadow roots and in child frames", () =>
    Effect.gen(function*() {
      const { crossSite } = yield* site
      const child = fixtureUrl(crossSite, `${infinite()}<div class="box"></div>`)
      const page = yield* opened(
        `<style>body{margin:0}iframe{position:absolute;left:60px;top:0;border:0;width:60px;height:60px}</style>` +
          `<div id="host"></div><iframe src="${child}"></iframe>` +
          `<script>host.attachShadow({mode:"open"}).innerHTML=${
            JSON.stringify(`${infinite()}<div class="box"></div>`)
          }` +
          `</script>`
      )
      yield* Expect.toBeAttached(page.frame(page.locator("iframe")).locator(".box"))
      const before = yield* page.screenshot()
      assert.isTrue(pixelsAt(before, 10, 10, isBlue))
      assert.isTrue(pixelsAt(before, 70, 10, isBlue))
      const png = yield* page.screenshot({ animations: "disabled" })
      assert.isTrue(pixelsAt(png, 10, 10, isRed))
      assert.isTrue(pixelsAt(png, 70, 10, isRed))
    }))

  it.effect("leaves an animation with a playback rate of 0 as it is", () =>
    Effect.gen(function*() {
      const page = yield* opened(
        `<style>body{margin:0}#box{position:absolute;left:0;top:0;width:40px;height:40px;background:rgb(255,0,0)}` +
          `</style><div id="box"></div><script>const animation=box.animate(` +
          `[{background:"rgb(0,0,255)"},{background:"rgb(0,0,255)"}],{duration:1000});` +
          `animation.currentTime=500;animation.playbackRate=0;window.paused=animation</script>`
      )
      const png = yield* page.screenshot({ animations: "disabled" })
      assert.isTrue(pixelsAt(png, 10, 10, isBlue))
      const after = yield* page.evaluateInMainWorld(() => {
        const animation = (window as unknown as { paused: Animation }).paused
        return { state: animation.playState, time: animation.currentTime }
      })
      assert.deepStrictEqual(after, { state: "running", time: 500 })
    }))

  it.effect("captures an element where it is with its animation stopped", () =>
    Effect.gen(function*() {
      const page = yield* opened(
        `<style>body{margin:0}@keyframes away{from{transform:translateX(100px)}to{transform:translateX(100px)}}` +
          `#box{position:absolute;left:0;top:0;width:40px;height:40px;background:rgb(255,0,0);` +
          `animation:away 1s infinite}</style><div id="box"></div>`
      )
      const png = yield* page.screenshot({ area: { element: page.locator("#box") }, animations: "disabled" })
      assert.isTrue(pixelsAt(png, 10, 10, isRed))
      assert.isTrue(pixelsAt(png, 30, 30, isRed))
    }))
}
