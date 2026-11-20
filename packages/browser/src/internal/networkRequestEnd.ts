/**
 * The ends of the requests a page or a context makes (`NetworkRequestEnd`): which entries a filter takes, and
 * the events made from the model's hop ends.
 */
import * as Effect from "effect/Effect"
import type * as NetworkRequest from "../NetworkRequest.ts"
import type * as NetworkRequestEnd from "../NetworkRequestEnd.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"
import * as NetworkRequestImpl from "./networkRequest.ts"

type Target = Page.ObservedPage | UserContext.ObservedUserContext

export const { history, next, stream } = EventModule.make<
  Target,
  NetworkRequestEnd.Filter,
  Model.RequestEndEvent,
  NetworkRequest.End
>({
  name: "NetworkRequestEnd",
  noun: "a request's end",
  prepare: (target, filter, operation) => {
    const found = Handles.target(target)
    const method = Filters.among<string>(filter?.method)
    const resourceType = Filters.among(filter?.resourceType)
    const end = Filters.among<"finished" | "failed">(filter?.end)
    return Effect.map(Filters.url(operation, filter?.url), (matches) => ({
      channel: found.behind.entry.events.requestEnd,
      accepts: (entry) => {
        const request = entry.value.hop.request
        return Filters.urlMatches(matches, request.url) && method(request.method) &&
          resourceType(request.resourceType) && end(entry.value.end._tag === "Finished" ? "finished" : "failed")
      },
      deliver: NetworkRequestImpl.endOf(found.behind.runtime.model.adapter.info.protocol)
    }))
  }
})
