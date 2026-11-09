/**
 * The requests a page or a context makes (`NetworkRequest`): which entries a filter takes, and the headers the
 * browser sent.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import type * as Deadline from "../Deadline.ts"
import * as NetworkRequest from "../NetworkRequest.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as Adapter from "./adapter.ts"
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
