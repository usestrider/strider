/** The pages a toolkit session names: `session.page` finds a page by a name it was given, not by a generated handle. */
import { assert, describe, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { CapturePolicy } from "@usestrider/browser/ai"
import * as Effect from "effect/Effect"
import * as ToolkitImpl from "../src/internal/toolkit.ts"

describe("Session.page", () => {
  it.effect("fails PageNotFound for a generated handle no one kept", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      yield* context.newPage
      yield* context.newPage
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      // The pages are named p1 and p2 by the first lookup; neither was given a name with keep.
      const result = yield* Effect.result(session.page("p2"))
      if (result._tag === "Success") return assert.fail(`session.page("p2") returned page ${result.success.id}`)
      assert.strictEqual(result.failure.error, "PageNotFound")
      assert.include(result.failure.message, "generated handle")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})
