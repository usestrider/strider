import * as Effect from "effect/Effect"
import { it } from "vitest"
import { scenario } from "../traceVideo.ts"
it("retains native video failure evidence", async () => {
  await Effect.runPromise(Effect.scoped(scenario("acquisition")))
  throw new Error("Intentional failure to retain video evidence")
})
