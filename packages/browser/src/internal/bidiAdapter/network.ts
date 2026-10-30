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
import * as Urls from "../urls.ts"
import { bytesOf, headersOf, resourceType } from "./mapping.ts"
import { pause, requestSnapshot } from "./obligations.ts"
import { type Event, navigableOf, type RequestEntry, type State } from "./state.ts"
import { endNavigation } from "./tree.ts"

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Network.beforeRequestSent, (params, { state }) => {
      const data = params.request
      let request = state.requests.get(data.request)
      if (request !== undefined && params.redirectCount > request.redirects) {
        // The earlier hop's id stays, so a body read for it says it was a redirect (QUIRKS.md, Q39)
        request.redirects = params.redirectCount
        request.hop = state.ids.hop(request.id, request.redirects)
        request.bodySizes[request.redirects] = data.bodySize
        state.hops.set(request.hop, request)
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
      // The headers the request event gives are the ones sent, cookies included
      state.buffer.emit({ _tag: "HopHeaders", hop: snapshot.hop, phase: "request", headers: snapshot.headers })
      if (params.isBlocked) pause(state, params, "request", snapshot, Option.none())
    })
    .on(Network.responseStarted, (params, { state }) => {
      const request = state.requests.get(params.request.request)
      if (request === undefined) return
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
      const request = state.requests.get(params.request.request)
      if (request === undefined) return
      state.buffer.emit({
        _tag: "RequestFinished",
        hop: request.hop,
        encodedBytes: params.response.bytesReceived,
        at: Adapter.now()
      })
      // A redirect's response completes its hop; the request goes on
      if (params.response.status < 300 || params.response.status >= 400) {
        Deferred.doneUnsafe(request.finished, Effect.void)
        state.retire(params.request.request)
      }
    })
    .on(Network.fetchError, (params, { state }) => {
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

export const responseBody = Effect.fnUntraced(function*(state: State, hop: NetworkRequest.HopId) {
  const request = yield* hopOf(state, hop)
  if (request.hop !== hop) {
    return yield* Effect.fail(Kit.unsupported("body.redirect", "A redirect's body isn't kept; only the last hop's is"))
  }
  yield* Deferred.await(request.finished).pipe(
    Effect.mapError((error) => Kit.unsupported("body.failed", `The request failed (${error}), so it has no body`))
  )
  const { bytes } = yield* state.send(Network.getData({ dataType: "response", request: request.bidi })).pipe(
    Effect.mapError(notCollected)
  )
  return yield* bytesOf(bytes, "network.getData")
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
