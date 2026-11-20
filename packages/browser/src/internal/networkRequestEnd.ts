/**
 * The ends of the requests a page or a context makes (`NetworkRequestEnd`): which entries a filter takes, the
 * events made from the model's hop ends, and the wait on one hop's end.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import type * as Deadline from "../Deadline.ts"
import * as NetworkRequest from "../NetworkRequest.ts"
import * as NetworkRequestEnd from "../NetworkRequestEnd.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"
import * as NetworkRequestImpl from "./networkRequest.ts"
import * as Operation from "./operation.ts"

type Target = Page.ObservedPage | UserContext.ObservedUserContext

/** The event a hop's end makes; whether a failure was a cancellation is known only where the protocol says. */
const event = (protocol: string) => (value: Model.RequestEndEvent): NetworkRequestEnd.NetworkRequestEnd =>
  value.end._tag === "Finished"
    ? new NetworkRequestEnd.Finished({ request: value.hop.request, at: value.end.at })
    : new NetworkRequestEnd.Failed({
      request: value.hop.request,
      failure: new NetworkRequest.Failure({
        errorText: value.end.error,
        canceled: protocol === "cdp" || protocol === "webkit" ? Option.some(value.end.canceled) : Option.none()
      }),
      at: value.end.at
    })

export const { history, next, stream } = EventModule.make<
  Target,
  NetworkRequestEnd.Filter,
  Model.RequestEndEvent,
  NetworkRequestEnd.NetworkRequestEnd
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
      deliver: event(found.behind.runtime.model.adapter.info.protocol)
    }))
  }
})

/** Opt-in retention of one existing hop until the caller's scope closes; installs no model or adapter work. */
export const of = (
  target: Target,
  request: NetworkRequest.NetworkRequest
): Effect.Effect<
  Effect.Effect<NetworkRequestEnd.NetworkRequestEnd, NetworkRequest.RequestError | Deadline.Timeout>,
  NetworkRequest.RequestError,
  Scope.Scope
> =>
  Effect.gen(function*() {
    const found = Handles.target(target)
    const { model } = found.behind.runtime
    const deliver = event(model.adapter.info.protocol)
    const unavailable = (why: NetworkRequest.ResponseUnavailable["why"]) =>
      new NetworkRequest.RequestError({
        hop: request.hop,
        reason: new NetworkRequest.ResponseUnavailable({ why }),
        diagnostics: Operation.diagnosticsNow()
      })
    const retained = model.hop(request.hop)
    if (Option.isNone(retained)) return yield* Effect.fail(unavailable("evicted"))
    if (!NetworkRequestImpl.ownsHop(found, retained.value)) return yield* Effect.fail(unavailable("foreignTarget"))
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
      const ended = Effect.flatMap(Deferred.await(hop.end), (end) =>
        end._tag === "Forgotten" ?
          Effect.fail(unavailable("evicted"))
          : end._tag === "Failed" && end.connectionLost === true ?
          Effect.fail(unavailable("targetClosed"))
          : Effect.succeed(deliver({ hop, end })))
      if (Deferred.isDoneUnsafe(hop.end)) return yield* ended
      const record = yield* Operation.record
      const closed = Deferred.await(targetClosed).pipe(
        Effect.andThen(
          Effect.suspend(() => Deferred.isDoneUnsafe(hop.end) ? ended : Effect.fail(unavailable("targetClosed")))
        )
      )
      const release = Deferred.await(released).pipe(Effect.andThen(Effect.fail(unavailable("released"))))
      return yield* record.bound(
        Effect.raceFirst(ended, Effect.raceFirst(closed, release)),
        () => Option.some("The request had not ended by the deadline"),
        "waitingForEvent"
      )
    }).pipe(Operation.named("NetworkRequestEnd.of", { attributes: { "browser.hop.id": request.hop } }))
  }).pipe(Operation.named("NetworkRequestEnd.of.acquire", { attributes: { "browser.hop.id": request.hop } }))
