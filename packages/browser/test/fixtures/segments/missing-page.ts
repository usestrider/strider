// A segment for the CLI tests: looks up a page the session doesn't have.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { CurrentSession, Segment } from "../../../src/cli/index.ts"

export default Segment.make(Schema.Record(Schema.String, Schema.Never), () =>
  Effect.gen(function*() {
    const session = yield* CurrentSession.CurrentSession
    yield* session.page("nowhere")
  }))
