// A segment for the CLI tests: looks up a page the session doesn't have.
import * as Effect from "effect/Effect"
import { CurrentSession } from "../../../src/cli/index.ts"

export default Effect.gen(function*() {
  const session = yield* CurrentSession.CurrentSession
  yield* session.page("nowhere")
})
