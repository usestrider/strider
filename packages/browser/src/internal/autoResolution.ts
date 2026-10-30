/**
 * The decisions made for a page or a context when nothing decided (`AutoResolution`): which entries a filter takes
 * and how one is delivered.
 */
import * as Effect from "effect/Effect"
import * as AutoResolution from "../AutoResolution.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"

const kinds = {
  alert: "Alert",
  confirm: "Confirm",
  prompt: "Prompt",
  beforeunload: "BeforeUnload",
  unknown: "Unknown"
} as const

const deliver = (event: Model.AutoResolutionEvent): AutoResolution.AutoResolution => {
  switch (event._tag) {
    case "Dialog":
      return new AutoResolution.AutoResolution({
        subject: { _tag: "Dialog", kind: kinds[event.prompt.kind], message: event.prompt.message },
        decision: event.decision,
        policy: { _tag: "ContextOption", name: "dialogs", value: event.policy },
        at: event.at
      })
    case "FileChooser":
      return new AutoResolution.AutoResolution({
        subject: { _tag: "FileChooser" },
        decision: event.decision,
        // No option sets it: the one rule for a chooser nothing decides (QUIRKS.md, Q63)
        policy: { _tag: "Default" },
        at: event.at
      })
    case "PausedRequest":
      // No route decided a request one matched
      return new AutoResolution.AutoResolution({
        subject: { _tag: "PausedRequest", request: event.request },
        decision: event.decision,
        // No option sets it either (QUIRKS.md, Q105)
        policy: { _tag: "Default" },
        at: event.at
      })
  }
}

export const { history, next, stream } = EventModule.make<
  Page.Page | UserContext.UserContext,
  AutoResolution.Filter,
  Model.AutoResolutionEvent,
  AutoResolution.AutoResolution
>({
  name: "AutoResolution",
  noun: "an automatic decision",
  prepare: (target, filter) => {
    const wanted = Filters.among(filter?.subject)
    return Effect.succeed({
      channel: Handles.target(target).behind.entry.events.autoResolution,
      accepts: (entry) => wanted(entry.value._tag),
      deliver
    })
  }
})
