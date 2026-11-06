import * as Effect from "effect/Effect"
import { it } from "vitest"
import { scenario } from "../traceVideo.ts"
for (const stage of ["acquisition", "stop", "file-read"] as const) {
  it(`retains native video ${stage} failure evidence`, async () => {
    await Effect.runPromise(Effect.scoped(scenario(stage)))
    throw new Error("Intentional failure to retain video evidence")
  })
}
