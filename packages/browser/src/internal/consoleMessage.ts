/**
 * The console messages of a page or a context (`ConsoleMessage`): which entries a filter takes.
 */
import * as Effect from "effect/Effect"
import type * as ConsoleMessage from "../ConsoleMessage.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"

export const { history, next, stream } = EventModule.make<
  Page.ObservedPage | UserContext.ObservedUserContext,
  ConsoleMessage.Filter,
  ConsoleMessage.ConsoleMessage,
  ConsoleMessage.ConsoleMessage
>({
  name: "ConsoleMessage",
  noun: "a console message",
  prepare: (target, filter) => {
    const level = Filters.among(filter?.level)
    const text = Filters.text(filter?.text)
    return Effect.succeed({
      channel: Handles.target(target).behind.entry.events.console,
      accepts: (entry) => level(entry.value.level) && text(entry.value.text),
      deliver: (message) => message
    })
  }
})
