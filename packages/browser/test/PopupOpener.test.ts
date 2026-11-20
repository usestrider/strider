/**
 * `Popup.opener` on `Browser.layerTest`: the page that opened a popup, `None` for a page no page opened or once its
 * opener closed, and the opener still after it crashed.
 */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { TestClock } from "effect/testing"

const openPopup = Effect.fnUntraced(function*() {
  const page = yield* Browser.newPage()
  const popups = yield* Popup.next(page)
  yield* TestClock.adjust("10 millis")
  return { page, popup: yield* popups }
})

describe("Popup.opener", () => {
  it.effect("gives the page that opened a popup", () =>
    Effect.scoped(Effect.gen(function*() {
      const { page, popup } = yield* openPopup()
      const opener = yield* Popup.opener(popup)
      assert(Option.isSome(opener))
      assert.strictEqual(opener.value.id, page.id)
    })).pipe(Effect.provide(Browser.layerTest("-popup"))))

  it.effect("gives None for a page no page opened", () =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      assert(Option.isNone(yield* Popup.opener(page)))
    })).pipe(Effect.provide(Browser.layerTest(""))))

  it.effect("gives None once the opener closed", () =>
    Effect.scoped(Effect.gen(function*() {
      const { page, popup } = yield* openPopup()
      yield* page.close()
      assert(Option.isNone(yield* Popup.opener(popup)))
    })).pipe(Effect.provide(Browser.layerTest("-popup"))))

  it.effect("still gives the opener after it crashed", () =>
    Effect.scoped(Effect.gen(function*() {
      const { page, popup } = yield* openPopup()
      yield* TestClock.adjust("10 millis")
      assert.strictEqual((yield* page.closed)._tag, "PageCrashed")
      const opener = yield* Popup.opener(popup)
      assert(Option.isSome(opener))
      assert.strictEqual(opener.value.id, page.id)
      assert.strictEqual((yield* opener.value.closed)._tag, "PageCrashed")
    })).pipe(Effect.provide(Browser.layerTest("-popup-crash"))))
})
