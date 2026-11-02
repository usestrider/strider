/**
 * The workers of a page or a context (`BrowserWorker`): which entries a filter takes.
 */
import * as Effect from "effect/Effect"
import type * as BrowserWorker from "../BrowserWorker.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"

export const { history, next, stream } = EventModule.make<
  Page.ObservedPage | UserContext.ObservedUserContext,
  BrowserWorker.Filter,
  Model.WorkerEntry,
  BrowserWorker.BrowserWorker
>({
  name: "BrowserWorker",
  noun: "a worker",
  prepare: (target, filter, operation) => {
    const found = Handles.target(target)
    const runtime = found.behind.runtime
    const wanted = filter?.kind
    const checked = wanted === undefined || wanted === "dedicated"
      ? Effect.void
      : found._tag === "Page"
      ? Effect.fail(Filters.invalid(
        operation,
        "filter.kind",
        `"dedicated", or none`,
        `A page's workers are dedicated; ${wanted} workers belong to its context, so subscribe to the context`
      ))
      : Filters.requires(runtime, operation, `workers.${wanted}`)
    return checked.pipe(
      Effect.andThen(Filters.url(operation, filter?.url)),
      Effect.map((matches) => ({
        channel: found.behind.entry.events.worker,
        accepts: (entry) =>
          Filters.urlMatches(matches, entry.value.url) && (wanted === undefined || entry.value.kind === wanted),
        deliver: (entry) => runtime.worker(entry)
      }))
    )
  }
})
