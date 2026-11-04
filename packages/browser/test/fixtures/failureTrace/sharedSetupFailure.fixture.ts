import { layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { connection } from "../../integration/failureTrace.ts"
const backend = Layer.effectDiscard(Effect.gen(function*() {
  connection("shared-setup-failure")("send", "LAYER_SETUP_FAILURE")
  return yield* Effect.die("deliberate shared acquisition failure")
}))
layer(backend, { excludeTestServices: true })((it) => {
  it.effect("cannot enter its body", () => Effect.void)
})
