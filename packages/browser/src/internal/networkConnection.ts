/**
 * The WebSocket and event-source connections of a page or a context (`NetworkConnection`): which entries a filter
 * takes.
 */
import * as Effect from "effect/Effect"
import type * as NetworkConnection from "../NetworkConnection.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"

export const { history, next, stream } = EventModule.make<
  Page.ObservedPage | UserContext.ObservedUserContext,
  NetworkConnection.Filter,
  Model.ConnectionEntry,
  NetworkConnection.NetworkConnection
>({
  name: "NetworkConnection",
  noun: "a connection",
  prepare: (target, filter, operation) => {
    const found = Handles.target(target)
    const runtime = found.behind.runtime
    const wanted = filter?.kind
    return Filters.requires(runtime, operation, "networkConnections").pipe(
      Effect.andThen(
        wanted === "eventSource" ? Filters.requires(runtime, operation, "networkConnections.eventSource") : Effect.void
      ),
      Effect.andThen(Filters.url(operation, filter?.url)),
      Effect.map((matches) => ({
        channel: found.behind.entry.events.connection,
        accepts: (entry) =>
          Filters.urlMatches(matches, entry.value.url) && (wanted === undefined || entry.value.kind === wanted),
        deliver: (entry) => runtime.connection(entry)
      }))
    )
  }
})
