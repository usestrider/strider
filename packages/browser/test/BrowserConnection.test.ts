/** `Browser.layerTest`'s connection state: `close` ends the fake browser, its pages with it, as a browser's does. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Target } from "@usestrider/browser"
import * as Effect from "effect/Effect"

describe("Browser connection", () => {
  it.effect("close ends the connection, and closed and the pages say the browser closed", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const page = yield* browser.newPage()
      assert.isTrue(yield* browser.isConnected)
      yield* browser.close
      assert.isFalse(yield* browser.isConnected)
      assert.deepStrictEqual(yield* browser.closed, new Target.BrowserClosed({}) satisfies Target.CloseReason)
      assert.deepStrictEqual(yield* page.closed, new Target.BrowserClosed({}) satisfies Target.CloseReason)
      // A closed browser has nothing left to close
      yield* browser.close
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})
