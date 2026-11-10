import { assert, describe, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

describe("shared setup", () => {
  layer(Layer.effectDiscard(Effect.die(new Error("timing probe shared fixture failed"))))("fixture", (it) => {
    it.effect("cannot run without the fixture", () => Effect.sync(() => assert.fail("case body must not run")))
  })
})
