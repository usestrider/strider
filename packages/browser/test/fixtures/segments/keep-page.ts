// A segment for the CLI tests: opens a page of its own and keeps it, so it outlives the segment. Looking up the
// session's shop names every page first, the new one as p2, so keeping it renames it.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { CurrentSession, Segment } from "../../../src/cli/index.ts"

export default Segment.make(Schema.Record(Schema.String, Schema.Never), () =>
  Effect.gen(function*() {
    const session = yield* CurrentSession.CurrentSession
    const page = yield* session.context.newPage
    yield* session.page("shop")
    yield* session.keep(page, "kept")
  }))
