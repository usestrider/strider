import { assert, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { connection } from "../../integration/failureTrace.ts"
let browser: ReturnType<typeof connection>
// The form every slice group uses: `layer(backend)((it) => …)` builds in the first test's beforeEach, not in beforeAll.
const backend = Layer.effectDiscard(Effect.sync(() => {
  browser = connection("shared-layer")
  browser("send", "LAYER_BUILT")
}))
layer(backend, { excludeTestServices: true })((it) => {
  it.effect("first test passes", () => Effect.sync(() => browser("send", "FIRST_TEST")))
  it.effect("later test fails", () =>
    Effect.sync(() => {
      browser("send", "LATER_TEST")
      assert.fail("deliberate")
    }))
})
