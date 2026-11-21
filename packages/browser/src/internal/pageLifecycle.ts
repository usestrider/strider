/**
 * The life of a page or a context's pages (`PageLifecycle`): which entries a filter takes.
 */
import * as Effect from "effect/Effect"
import type * as Page from "../Page.ts"
import type * as PageLifecycle from "../PageLifecycle.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"

export const { history, next, stream } = EventModule.make<
  Page.ObservedPage | UserContext.ObservedUserContext,
  PageLifecycle.Filter,
  PageLifecycle.PageLifecycle,
  PageLifecycle.PageLifecycle
>({
  name: "PageLifecycle",
  noun: "a page lifecycle event",
  prepare: (target, filter) => {
    const kinds = Filters.among(filter?.events)
    const all = filter?.frames === "all"
    return Effect.succeed({
      channel: Handles.target(target).behind.entry.events.lifecycle,
      accepts: ({ value }) =>
        kinds(value._tag) &&
        (all || (value._tag !== "DomContentLoaded" && value._tag !== "Loaded") || value.frame === value.page),
      deliver: (event) => event
    })
  }
})
