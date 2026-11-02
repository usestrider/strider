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
export const LastKnown = Schema.Struct({
  _tag: Schema.tag("LastKnown"),
  claim: Schema.String,
  dialogs: Schema.Array(Schema.Struct({ kind: Page.Prompt.fields.kind, message: Schema.String }))
})
