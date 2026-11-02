/**
 * The requests a page or a context makes (`NetworkRequest`): which entries a filter takes, and the headers the
 * browser sent.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import type * as Deadline from "../Deadline.ts"
import type * as NetworkRequest from "../NetworkRequest.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import * as Operation from "./operation.ts"

export const { history, next, stream } = EventModule.make<
  Page.ObservedPage | UserContext.ObservedUserContext,
  NetworkRequest.Filter,
  NetworkRequest.NetworkRequest,
  NetworkRequest.NetworkRequest
>({
  name: "NetworkRequest",
  noun: "a request",
  prepare: (target, filter, operation) => {
    const channel = Handles.target(target).behind.entry.events.request
    const method = Filters.among<string>(filter?.method)
    const resourceType = Filters.among(filter?.resourceType)
    return Effect.map(Filters.url(operation, filter?.url), (matches) => ({
      channel,
      accepts: (entry) =>
        Filters.urlMatches(matches, entry.value.url) && method(entry.value.method) &&
        resourceType(entry.value.resourceType),
      deliver: (request) => request
    }))
  }
})

/** The headers the browser sent for a request, once it has said which. */
export const headersSent = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest.NetworkRequest
): Effect.Effect<Headers.Headers, Deadline.Timeout> =>
  Effect.gen(function*() {
    const { runtime } = Handles.target(target as Page.Page | UserContext.UserContext).behind
    const hop = runtime.model.hop(request.hop)
    if (Option.isNone(hop)) return request.headers
    const record = yield* Operation.record
    yield* record.bound(
      Deferred.await(hop.value.sentKnown),
      () => Option.some("The browser hadn't said which headers it sent by the deadline"),
      "waitingForEvent"
    )
    return Option.getOrElse((yield* hop.value.state.get).sent, () => request.headers)
  }).pipe(Operation.named("NetworkRequest.headersSent", { attributes: { "browser.hop.id": request.hop } }))
