/**
 * The network on BiDi: the `network` domain's requests, hops and responses as L1's, and their bodies, which
 * Firefox keeps only for a data collector declared before the request.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Network from "../../bidi-protocol/Network.ts"
import * as NetworkRequest from "../../NetworkRequest.ts"
import * as NetworkResponse from "../../NetworkResponse.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Sizes from "../requestSizes.ts"
import * as Timing from "../requestTiming.ts"
import * as Urls from "../urls.ts"
import { bytesOf, headersOf, resourceType } from "./mapping.ts"
import { pause, requestSnapshot } from "./obligations.ts"
import { type Event, navigableOf, placement, type RequestEntry, type State } from "./state.ts"
import { endNavigation } from "./tree.ts"

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Network.beforeRequestSent, (params, { state }) => {
      const data = params.request
      let request = state.requests.get(data.request)
      if (request !== undefined && params.redirectCount > request.redirects) {
        // The earlier hop's id stays, so a body read for it says it was a redirect (QUIRKS.md, Q39)
        const previous = request.finished
        request.finished = Deferred.makeUnsafe()
        request.terminalRedirect = false
        request.redirects = params.redirectCount
        request.hop = state.ids.hop(request.id, request.redirects)
        request.bodySizes[request.redirects] = data.bodySize
        state.hops.set(request.hop, request)
        Deferred.doneUnsafe(previous, Effect.void)
      } else if (request === undefined) {
        const navigation = params.navigation === null ? undefined : state.navigations.get(params.navigation)
        const id = state.ids.request()
        request = {
          id,
          bidi: data.request,
          redirects: params.redirectCount,
          hop: state.ids.hop(id, params.redirectCount),
          navigable: navigableOf(state, params.context),
          navigation: navigation !== undefined && resourceType(data) === "document" ? navigation : undefined,
          finished: Deferred.makeUnsafe(),
          terminalRedirect: false,
          fulfilled: false,
          bodySizes: []
        }
        request.bodySizes[params.redirectCount] = data.bodySize
        state.requests.set(data.request, request)
        state.hops.set(request.hop, request)
      }
      if (request.navigation !== undefined) request.navigation.documentHop = request.hop
      const navigable = navigableOf(state, params.context)
      const snapshot = new NetworkRequest.NetworkRequest({
        hop: request.hop,
        method: Kit.methodOf(data.method),
        url: Urls.reported(data.url),
        headers: headersOf(data.headers),
        resourceType: resourceType(data),
        initiator: navigable === undefined
          ? { _tag: "Unattributed" }
          : { _tag: "Document", navigable: navigable.id, navigation: Option.fromUndefinedOr(request.navigation?.id) },
        at: Adapter.now()
      })
      state.buffer.emit({ _tag: "RequestSent", request: snapshot })
      if (request.navigable?.context.requestTiming) {
        state.buffer.emit({ _tag: "HopTiming", hop: request.hop, timing: Timing.bidi(data.timings, false) })
      }
      // The headers the request event gives are the ones sent, cookies included
      state.buffer.emit({ _tag: "HopHeaders", hop: snapshot.hop, phase: "request", headers: snapshot.headers })
      if (params.isBlocked) pause(state, params, "request", snapshot, Option.none())
    })
    .on(Network.responseStarted, (params, { state }) => {
      const request = state.requests.get(params.request.request)
      if (request === undefined) return
      if (request.navigable?.context.requestSizes && !request.fulfilled) {
        state.buffer.emit({
          _tag: "HopSizes",
          hop: state.ids.hop(request.id, params.redirectCount),
          sizes: Sizes.bidi(params.response, false)
        })
      }
      if (request.navigable?.context.requestTiming) {
        state.buffer.emit({ _tag: "HopTiming", hop: request.hop, timing: Timing.bidi(params.request.timings, false) })
      }
      request.terminalRedirect = [301, 302, 303, 307, 308].includes(params.response.status) &&
        headersOf(params.response.headers)["location"] === undefined
      if (request.navigation !== undefined) request.navigation.status = params.response.status
      const response = new NetworkResponse.NetworkResponse({
        hop: request.hop,
        url: Urls.reported(params.response.url),
        status: Math.min(599, Math.max(100, params.response.status || 200)) as NetworkResponse.StatusCode,
        statusText: params.response.statusText,
        httpVersion: Option.fromUndefinedOr(params.response.protocol || undefined),
        headers: headersOf(params.response.headers),
        // BiDi says only whether the network served it: Firefox's fromCache is true for a service
        // worker's response too
        servedBy: request.fulfilled ? "route" : params.response.fromCache ? "cacheOrServiceWorker" : "network",
        at: Adapter.now()
      })
      state.buffer.emit({ _tag: "ResponseReceived", response })
      if (params.isBlocked) {
        pause(state, params, "response", requestSnapshot(params, request), Option.some(response))
      }
    })
    .on(Network.responseCompleted, (params, { state }) => {
      ;(state.contextsByBidi.get(params.userContext ?? "") ?? navigableOf(state, params.context)?.context)
        ?.proxyAttempts?.delete(params.request.request)
      const request = state.requests.get(params.request.request)
      if (request === undefined) return
      if (request.navigable?.context.requestSizes && !request.fulfilled) {
        state.buffer.emit({
          _tag: "HopSizes",
          hop: state.ids.hop(request.id, params.redirectCount),
          sizes: Sizes.bidi(params.response, true)
        })
      }
      if (request.navigable?.context.requestTiming) {
        state.buffer.emit({ _tag: "HopTiming", hop: request.hop, timing: Timing.bidi(params.request.timings, true) })
      }
      state.buffer.emit({
        _tag: "RequestFinished",
        hop: request.hop,
        encodedBytes: params.response.bytesReceived,
        at: Adapter.now()
      })
      // Completion belongs to this hop, including a terminal 3xx without a followed redirect.
      Deferred.doneUnsafe(request.finished, Effect.void)
      state.retire(params.request.request)
    })
    .on(Network.fetchError, (params, { state }) => {
      ;(state.contextsByBidi.get(params.userContext ?? "") ?? navigableOf(state, params.context)?.context)
        ?.proxyAttempts?.delete(params.request.request)
      const request = state.requests.get(params.request.request)
      if (request === undefined) return
      state.buffer.emit({
        _tag: "RequestFailed",
        hop: request.hop,
        error: params.errorText,
        canceled: params.errorText.includes("ABORTED"),
        at: Adapter.now()
      })
      Deferred.doneUnsafe(request.finished, Effect.fail(params.errorText))
      state.retire(params.request.request)
      const navigation = request.navigation
      if (navigation === undefined || navigation.ended) return
      if (navigation.status === 204 || navigation.status === 205) {
        endNavigation(state, navigation, {
          _tag: "NoContent",
          status: navigation.status,
          response: Option.fromUndefinedOr(navigation.documentHop)
        }, "bidi:network.fetchError")
      } else if (!params.errorText.includes("ABORTED")) {
        // An error page may still commit for this navigation; it is reported as the document it created
        endNavigation(
          state,
          navigation,
          { _tag: "Failed", error: params.errorText, errorDocument: Option.none() },
          "bidi:network.fetchError"
        )
      }
    })

// ── Bodies ────────────────────────────────────────────────────────────────────────────────────────────────

const hopOf = (state: State, hop: NetworkRequest.HopId): Effect.Effect<RequestEntry, Adapter.AdapterError> =>
  Kit.lookup(
    state.ids,
    state.hops,
    hop,
    () => Kit.unsupported("body.notCollected", "Strider no longer keeps this request: it keeps the last ones finished")
  )

const notCollected = (error: Parameters<typeof Kit.protocolError>[0]) =>
  error.reason._tag === "Rejected"
    ? Kit.unsupported(
      "body.notCollected",
      "Declare BodyCollection before the request starts; BiDi keeps no body otherwise"
    )
    : Kit.protocolError(error)

const terminalRedirect = () =>
  Kit.unsupported(
    "network.responseBody.terminalRedirect",
    "Firefox does not answer network.getData for a terminal response with status 301, 302, 303, 307, or 308 without a Location header"
  )

export const responseBody = Effect.fnUntraced(function*(state: State, hop: NetworkRequest.HopId) {
  const request = yield* hopOf(state, hop)
  if (request.hop !== hop) {
    return yield* Effect.fail(Kit.unsupported("body.redirect", "A redirect's body isn't kept; only the last hop's is"))
  }
  if (request.terminalRedirect) return yield* Effect.fail(terminalRedirect())
  yield* Deferred.await(request.finished).pipe(
    Effect.mapError((error) => Kit.unsupported("body.failed", `The request failed (${error}), so it has no body`))
  )
  if (request.hop !== hop) {
    return yield* Effect.fail(Kit.unsupported("body.redirect", "A redirect's body isn't kept; only the last hop's is"))
  }
  if (request.terminalRedirect) return yield* Effect.fail(terminalRedirect())
  const result = yield* state.send(Network.getData({ dataType: "response", request: request.bidi })).pipe(
    Effect.mapError(notCollected),
    Effect.result
  )
  // The native request id is reused: a successor can arrive while getData is in flight.
  if (request.hop !== hop) {
    return yield* Effect.fail(Kit.unsupported("body.redirect", "A redirect's body isn't kept; only the last hop's is"))
  }
  if (result._tag === "Failure") return yield* Effect.fail(result.failure)
  return yield* bytesOf(result.success.bytes, "network.getData")
})

export const requestBody = Effect.fnUntraced(function*(state: State, hop: NetworkRequest.HopId) {
  const request = yield* hopOf(state, hop)
  const size = request.bodySizes[state.ids.redirectsOf(hop)]
  if (size === 0) return Option.none<Uint8Array>()
  const { bytes } = yield* state.send(Network.getData({ dataType: "request", request: request.bidi })).pipe(
    Effect.mapError(notCollected)
  )
  return Option.some(yield* bytesOf(bytes, "network.getData"))
})

/** BiDi's native data belongs to a request id, not an independently addressable redirect hop. */
export const captureRequestBody = Effect.fnUntraced(
  function*(
    state: State,
    snapshot: NetworkRequest.NetworkRequest,
    limit: number
  ): Effect.fn.Return<Adapter.RequestBody, Adapter.AdapterError> {
    const request = yield* hopOf(state, snapshot.hop)
    if (
      request.navigable === undefined ||
      Option.isNone(state.registry.bodyLimit(placement(request.navigable), "request"))
    ) return { _tag: "Unavailable", why: "notCollected" }
    const size = request.bodySizes[state.ids.redirectsOf(snapshot.hop)]
    if (size === 0) return { _tag: "Absent" }
    // Firefox reports the base64 representation length for binary bodies, not their decoded byte count.
    if (size !== null && size !== undefined && size > Math.ceil(limit / 3) * 4) return { _tag: "OverLimit" }
    // Firefox can retain the first body's data even after a later hop changes it (Q183).
    if (request.hop !== snapshot.hop || request.redirects !== 0) return { _tag: "Unavailable", why: "redirect" }
    const result = yield* state.send(Network.getData({ dataType: "request", request: request.bidi })).pipe(
      Effect.mapError(Kit.protocolError),
      Effect.result
    )
    if (request.hop !== snapshot.hop) return { _tag: "Unavailable", why: "redirect" }
    if (result._tag === "Failure") {
      if (result.failure.reason._tag === "Protocol" && result.failure.reason.error.reason._tag === "Rejected") {
        return {
          _tag: "Unavailable",
          why: "unavailable"
        }
      }
      return yield* Effect.fail(result.failure)
    }
    const bytes = yield* bytesOf(result.success.bytes, "network.getData")
    if (bytes.length > limit) return { _tag: "OverLimit" }
    return { _tag: "Bytes", bytes }
  }
)
