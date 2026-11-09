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
import * as Adapter from "./adapter.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Timing from "./requestTiming.ts"

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

/** Whether a retained hop belongs to this exact page or context entry. */
const ownsHop = (target: ReturnType<typeof Handles.target>, hop: Model.HopEntry): boolean =>
  (target._tag === "Page" ? Option.getOrUndefined(hop.page) : Option.getOrUndefined(hop.context)) ===
    target.behind.entry

/** An immediate read of existing terminal facts, valid only while the original owner remains observable. */
export const timing = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest.NetworkRequest
): Effect.Effect<NetworkRequest.Timing, NetworkRequest.RequestError> => {
  const owner = Handles.target(target)
  return Effect.gen(function*() {
    const { model } = owner.behind.runtime
    const unavailable = (why: NetworkRequest.RequestUnavailable["why"]) =>
      Effect.fail(
        new NetworkRequest.RequestError({
          hop: request.hop,
          reason: new NetworkRequest.RequestUnavailable({ why }),
          diagnostics: Operation.diagnosticsNow()
        })
      )
    const found = model.hop(request.hop)
    if (Option.isNone(found) || found.value.request !== request) return yield* unavailable("notRetained")
    const hop = found.value
    return yield* Effect.suspend(() => {
      // Validate ownership at the read, even when phase data was retained before the owner ended.
      if (Option.getOrUndefined(model.hop(request.hop)) !== hop) return unavailable("notRetained")
      if (!ownsHop(owner, hop)) return unavailable("foreignTarget")
      if (
        Deferred.isDoneUnsafe(model.lost) || Deferred.isDoneUnsafe(owner.behind.entry.closed) ||
        Option.exists(hop.page, (page) => Deferred.isDoneUnsafe(page.closed)) ||
        Option.exists(hop.context, (context) => Deferred.isDoneUnsafe(context.closed))
      ) return unavailable("ownerLost")
      const initiator = request.initiator
      if (initiator._tag === "Document") {
        const page = Option.getOrUndefined(hop.page)
        if (
          page === undefined || (page.id !== initiator.navigable &&
            !page.state.getUnsafe().frames.some((frame) => frame.id === initiator.navigable))
        ) return unavailable("ownerLost")
      } else if (initiator._tag === "Worker") {
        const workers = Option.isSome(hop.context)
          ? hop.context.value.state.getUnsafe().workers
          : Option.isSome(hop.page)
          ? hop.page.value.state.getUnsafe().workers
          : []
        if (!workers.some((worker) => worker.realm === initiator.realm && !Deferred.isDoneUnsafe(worker.closed))) {
          return unavailable("ownerLost")
        }
      }
      const context = Option.getOrUndefined(hop.context)
      if (context?.timings === undefined) return unavailable("timingNotEnabled")
      return Effect.succeed(context.timings.get(request.hop) ?? Timing.empty())
    })
  }).pipe(Operation.named("NetworkRequest.timing", {
    attributes: {
      "browser.hop.id": request.hop,
      [owner._tag === "Page" ? "browser.page.id" : "browser.context.id"]: owner.behind.entry.id
    }
  }))
}

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
    if (!ownsHop(found, retained.value)) {
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

/** An immediate read of existing terminal facts, valid only while the original owner remains observable. */
export const failure = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest.NetworkRequest
): Effect.Effect<Option.Option<NetworkRequest.Failure>, NetworkRequest.RequestError> => {
  const owner = Handles.target(target)
  return Effect.gen(function*() {
    const { model } = owner.behind.runtime
    const unavailable = (why: NetworkRequest.RequestUnavailable["why"]) =>
      Effect.fail(
        new NetworkRequest.RequestError({
          hop: request.hop,
          reason: new NetworkRequest.RequestUnavailable({ why }),
          diagnostics: Operation.diagnosticsNow()
        })
      )
    const found = model.hop(request.hop)
    if (Option.isNone(found) || found.value.request !== request) return yield* unavailable("notRetained")
    const hop = found.value
    const polled = yield* Deferred.poll(hop.end)
    return yield* Effect.suspend(() => {
      // Validate after polling, before reading the captured terminal value. In particular, the fold's
      // synthetic disconnect failure is cleanup evidence, not a browser-reported network failure.
      if (Option.getOrUndefined(model.hop(request.hop)) !== hop) return unavailable("notRetained")
      if (!ownsHop(owner, hop)) return unavailable("foreignTarget")
      if (
        Deferred.isDoneUnsafe(model.lost) || Deferred.isDoneUnsafe(owner.behind.entry.closed) ||
        Option.exists(hop.page, (page) => Deferred.isDoneUnsafe(page.closed)) ||
        Option.exists(hop.context, (context) => Deferred.isDoneUnsafe(context.closed))
      ) return unavailable("ownerLost")
      const initiator = request.initiator
      if (initiator._tag === "Document") {
        const page = Option.getOrUndefined(hop.page)
        if (
          page === undefined || (page.id !== initiator.navigable &&
            !page.state.getUnsafe().frames.some((frame) => frame.id === initiator.navigable))
        ) return unavailable("ownerLost")
      } else if (initiator._tag === "Worker") {
        const workers = Option.isSome(hop.context)
          ? hop.context.value.state.getUnsafe().workers
          : Option.isSome(hop.page)
          ? hop.page.value.state.getUnsafe().workers
          : []
        if (!workers.some((worker) => worker.realm === initiator.realm && !Deferred.isDoneUnsafe(worker.closed))) {
          return unavailable("ownerLost")
        }
      }
      if (Option.isNone(polled)) return Effect.succeedNone
      return Effect.flatMap(polled.value, (end) => {
        if (end._tag === "Forgotten") return unavailable("notRetained")
        return Effect.succeed(
          end._tag === "Failed"
            ? Option.some(
              new NetworkRequest.Failure({
                errorText: end.error,
                canceled: model.adapter.info.protocol === "cdp" || model.adapter.info.protocol === "webkit"
                  ? Option.some(end.canceled)
                  : Option.none()
              })
            )
            : Option.none()
        )
      })
    })
  }).pipe(Operation.named("NetworkRequest.failure", {
    attributes: {
      "browser.hop.id": request.hop,
      [owner._tag === "Page" ? "browser.page.id" : "browser.context.id"]: owner.behind.entry.id
    }
  }))
}

/** Reads existing evidence only; creating access must never start background tracking. */
export const redirects: (
  target: Page.ObservedPage | UserContext.ObservedUserContext
) => Effect.Effect<NetworkRequest.Redirects, never, Scope.Scope> = Effect.fnUntraced(
  function*(target: Page.ObservedPage | UserContext.ObservedUserContext) {
    let owner: ReturnType<typeof Handles.target> | undefined = Handles.target(target)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        owner = undefined
      })
    )
    const ids = Adapter.makeIds()
    const read = Effect.fnUntraced(
      function*(request: NetworkRequest.NetworkRequest, direction: -1 | 1) {
        const fail = (why: NetworkRequest.RedirectUnavailable["why"]) =>
          Effect.fail(
            new NetworkRequest.RequestError({
              hop: request.hop,
              reason: new NetworkRequest.RedirectUnavailable({ why }),
              diagnostics: Operation.diagnosticsNow()
            })
          )
        const unknown = (why: NetworkRequest.RedirectUnknown["why"]) =>
          Effect.fail(
            new NetworkRequest.RequestError({
              hop: request.hop,
              reason: new NetworkRequest.RedirectUnknown({ why }),
              diagnostics: Operation.diagnosticsNow()
            })
          )
        const current = owner
        if (current === undefined) return yield* fail("released")
        const { entry, runtime } = current.behind
        if (Deferred.isDoneUnsafe(entry.closed) || Deferred.isDoneUnsafe(runtime.model.lost)) {
          return yield* fail("targetClosed")
        }
        const owned = (hop: Model.HopEntry) =>
          current._tag === "Page"
            ? Option.exists(hop.page, (page) => page === current.behind.entry)
            : Option.exists(hop.context, (context) => context === current.behind.entry)
        const source = runtime.model.hop(request.hop)
        if (Option.isNone(source)) return yield* fail("evicted")
        if (source.value.request !== request) return yield* fail("unavailable")
        if (!owned(source.value)) return yield* fail("foreignTarget")
        const separator = request.hop.lastIndexOf(".")
        const ordinal = ids.redirectsOf(request.hop)
        if (direction === -1 && ordinal === 0) return Option.none()
        const adjacent = runtime.model.hop(
          ids.hop(request.hop.slice(0, separator) as NetworkRequest.Id, ordinal + direction)
        )
        if (Option.isSome(adjacent)) {
          if (!owned(adjacent.value)) return yield* fail("foreignTarget")
          return Option.some(adjacent.value.request)
        }
        if (direction === -1) return yield* fail("evicted")
        const end = yield* Deferred.poll(source.value.end)
        if (Option.isNone(end)) return yield* unknown("inFlight")
        const terminal = yield* end.value
        if (terminal._tag === "Forgotten") return yield* fail("evicted")
        if (terminal._tag === "Failed") return Option.none()
        const response = (yield* source.value.state.get).response
        if (Option.isNone(response)) return yield* fail("unavailable")
        if ([301, 302, 303, 307, 308].includes(response.value.status)) {
          const navigation = request.initiator._tag === "Document" ? request.initiator.navigation : Option.none()
          if (Option.isSome(navigation) && Option.isSome(source.value.page)) {
            const channel = source.value.page.value.events.navigation
            const ended = channel.entries.find(({ value }) => value.navigation === navigation.value)
            if (
              ended?.value.outcome._tag === "Committed" && Option.contains(ended.value.outcome.response, request.hop)
            ) {
              return Option.none()
            }
            // Incomplete history cannot distinguish missing terminal evidence from discarded evidence.
            if (ended === undefined && (channel.dropped > 0 || channel.cap() === 0)) return yield* fail("unavailable")
          }
          return yield* unknown("completedRedirect")
        }
        return Option.none()
      },
      (effect, request, direction) =>
        effect.pipe(
          Operation.named(direction === -1 ? "NetworkRequest.redirects.from" : "NetworkRequest.redirects.to", {
            attributes: { "browser.hop.id": request.hop }
          })
        )
    )
    return {
      from: (request: NetworkRequest.NetworkRequest) => read(request, -1),
      to: (request: NetworkRequest.NetworkRequest) => read(request, 1)
    }
  }
)
