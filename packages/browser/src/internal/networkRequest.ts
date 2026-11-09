/**
 * The requests a page or a context makes (`NetworkRequest`): which entries a filter takes, and the headers the
 * browser sent.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Filter from "effect/Filter"
import type * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as Deadline from "../Deadline.ts"
import * as NetworkRequest from "../NetworkRequest.ts"
import type * as NetworkResponse from "../NetworkResponse.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"
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

/** Opt-in retention of one existing hop; no model or adapter work is installed. */
export const response = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest.NetworkRequest
): Effect.Effect<
  Effect.Effect<Option.Option<NetworkResponse.NetworkResponse>, NetworkRequest.RequestError | Deadline.Timeout>,
  NetworkRequest.RequestError,
  Scope.Scope
> =>
  Effect.gen(function*() {
    const found = Handles.target(target)
    const unavailable = (why: NetworkRequest.ResponseUnavailable["why"]) =>
      new NetworkRequest.RequestError({
        hop: request.hop,
        reason: new NetworkRequest.ResponseUnavailable({ why }),
        diagnostics: Operation.diagnosticsNow()
      })
    const retained = found.behind.runtime.model.hop(request.hop)
    if (Option.isNone(retained)) return yield* Effect.fail(unavailable("evicted"))
    const owner: Option.Option<Model.PageEntry | Model.ContextEntry> = found._tag === "Page"
      ? retained.value.page
      : retained.value.context
    if (Option.isNone(owner) || owner.value !== found.behind.entry) {
      return yield* Effect.fail(unavailable("foreignTarget"))
    }
    const targetClosed = found.behind.entry.closed
    let held: Model.HopEntry | undefined = retained.value
    const released = Deferred.makeUnsafe<void>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        held = undefined
        Deferred.doneUnsafe(released, Effect.void)
      })
    )
    return Effect.gen(function*() {
      const hop = held
      if (hop === undefined) return yield* Effect.fail(unavailable("released"))
      const existing = (yield* hop.state.get).response
      if (Option.isSome(existing)) return existing
      const record = yield* Operation.record
      const ended = Effect.flatMap(Deferred.await(hop.end), (end) =>
        Effect.flatMap(hop.state.get, (state) =>
          Option.isSome(state.response) ?
            Effect.succeed(state.response)
            : end._tag === "Failed" && end.connectionLost === true ?
            Effect.fail(unavailable("targetClosed"))
            : end._tag === "Forgotten" ?
            Effect.fail(unavailable("evicted"))
            : Effect.succeed(Option.none<NetworkResponse.NetworkResponse>())))
      const arrived = hop.state.changes.pipe(
        Stream.filterMap(Filter.fromPredicateOption((state: Model.HopState) =>
          state.response
        )),
        Stream.runHead
      )
      const closed = Deferred.await(targetClosed).pipe(
        Effect.andThen(Effect.suspend(() =>
          Deferred.isDoneUnsafe(hop.end) ? ended : Effect.fail(unavailable("targetClosed"))
        ))
      )
      const release = Deferred.await(released).pipe(Effect.andThen(Effect.fail(unavailable("released"))))
      return yield* record.bound(
        Effect.raceFirst(Effect.raceFirst(arrived, ended), Effect.raceFirst(closed, release)),
        () => Option.some("The request had not received a response by the deadline"),
        "waitingForEvent"
      )
    }).pipe(Operation.named("NetworkRequest.response", { attributes: { "browser.hop.id": request.hop } }))
  }).pipe(Operation.named("NetworkRequest.response.acquire", { attributes: { "browser.hop.id": request.hop } }))
