/**
 * The requests a page or a context makes (`NetworkRequest`): which entries a filter takes, and the headers the
 * browser sent.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import type * as Deadline from "../Deadline.ts"
import * as NetworkRequest from "../NetworkRequest.ts"
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

/** An immediate read of existing terminal facts, valid only while the original owner remains observable. */
export const failure = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest.NetworkRequest
): Effect.Effect<Option.Option<NetworkRequest.Failure>, NetworkRequest.RequestError> =>
  Effect.gen(function*() {
    const owner = Handles.target(target)
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
      if (
        owner._tag === "Page"
          ? Option.getOrUndefined(hop.page) !== owner.behind.entry
          : Option.getOrUndefined(hop.context) !== owner.behind.entry
      ) return unavailable("foreignTarget")
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
  }).pipe(Operation.named("NetworkRequest.failure", { attributes: { "browser.hop.id": request.hop } }))
