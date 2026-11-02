/**
 * The uncaught exceptions of a page or a context (`UncaughtException`): which entries a filter takes.
 */
import * as Effect from "effect/Effect"
import type * as Page from "../Page.ts"
import type * as UncaughtException from "../UncaughtException.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"

export const { history, next, stream } = EventModule.make<
  Page.ObservedPage | UserContext.ObservedUserContext,
  UncaughtException.Filter,
  UncaughtException.UncaughtException,
  UncaughtException.UncaughtException
>({
  name: "UncaughtException",
  noun: "an uncaught exception",
  prepare: (target, filter) => {
    const message = Filters.text(filter?.message)
    return Effect.succeed({
      channel: Handles.target(target).behind.entry.events.exception,
      accepts: (entry) => message(entry.value.message),
      deliver: (exception) => exception
    })
  }
})
