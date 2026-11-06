/** Data-only claim observations, shared without loading the operation entry points. */
import * as Schema from "effect/Schema"
import * as Page from "../Page.ts"
export const Found = Schema.Union([
  Schema.Struct({
    _tag: Schema.tag("Observed"),
    dialogs: Schema.Array(Schema.Struct({
      kind: Page.Prompt.fields.kind,
      message: Schema.String
    }))
  }),
  Schema.Struct({ _tag: Schema.tag("Unknown") })
])
export const Handoff = Schema.Union([
  Schema.Struct({
    _tag: Schema.tag("Complete"),
    events: Schema.Array(Schema.Struct({
      _tag: Schema.tag("DialogDismissed"),
      kind: Page.Prompt.fields.kind,
      message: Schema.String
    }))
  }),
  Schema.Struct({
    _tag: Schema.tag("Unknown"),
    events: Schema.Array(Schema.Struct({
      _tag: Schema.tag("DialogDismissed"),
      kind: Page.Prompt.fields.kind,
      message: Schema.String
    }))
  })
])
export const LastKnown = Schema.Struct({
  _tag: Schema.tag("LastKnown"),
  claim: Schema.String,
  handoff: Schema.optional(Handoff),
  dialogs: Schema.Array(Schema.Struct({ kind: Page.Prompt.fields.kind, message: Schema.String }))
})
