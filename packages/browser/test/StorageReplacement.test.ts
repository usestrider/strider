/** Creation-only tracking options on the existing context recovery path. */
import { assert, it } from "@effect/vitest"
import { Browser, StorageState } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Hooks from "../src/internal/claimHooks.ts"

for (const tracking of [false, true, undefined]) {
  it.effect(`recovered context reports its actual tracking restriction (${tracking})`, () =>
    Effect.scoped(Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const original = yield* Browser.newContext()
      const hooks = Hooks.get(browser)
      const result = yield* hooks.context(
        tracking === undefined ? undefined : { storageStateTracking: tracking },
        { context: original.id }
      ).pipe(Effect.result)
      if (tracking === true) {
        assert.equal(result._tag, "Failure")
        if (result._tag !== "Failure") return
        assert.equal(result.failure._tag, "UserContextError")
        if (result.failure._tag === "UserContextError") assert.equal(result.failure.reason._tag, "InvalidInput")
      } else {
        assert.equal(result._tag, "Success")
        if (result._tag !== "Success") return
        const error = yield* result.success.setStorageState(new StorageState.StorageState({ cookies: [], origins: [] }))
          .pipe(Effect.flip)
        assert.equal(error._tag, "UserContextError")
        assert.match(error.message, /reclaim|recover|adopt/i)
      }
    })).pipe(Effect.provide(Browser.layerTest(""))))
}
