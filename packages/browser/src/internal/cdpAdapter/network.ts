/**
 * The network on CDP: the `Network` domain's requests, one hop per redirect, keyed by session and request id;
 * their headers as the network sent and received them (`ExtraInfo`, QUIRKS.md, Q158); WebSocket and EventSource
 * connections; and the bodies kept for them.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Network from "../../cdp/Network.ts"
import { Frame as NetworkConnectionFrame } from "../../NetworkConnection.ts"
import * as NetworkRequest from "../../NetworkRequest.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Urls from "../urls.ts"
import { postData, resourceTypes } from "./mapping.ts"
import { emitResponse, release, servedBy } from "./responses.ts"
import {
  type Event,
  type ExtraInfo,
  frameOf,
  placement,
  type RequestEntry,
  requestKey,
  type State,
  type TargetEntry
} from "./state.ts"
import { endNavigation } from "./tree.ts"

/** A hop this connection no longer keeps: it keeps the last finished requests while there is room (Q177). */
const notKept = (state: State, hop: NetworkRequest.HopId) =>
  Kit.missing(
    state.ids,
    hop,
    () => Kit.unsupported("body.notCollected", "Strider no longer keeps this request: it keeps the last ones finished")
  )

/** A request's body is kept as its event carried it where a body collection covers the page and it fits. */
const sentBody = (state: State, target: TargetEntry, request: Network.Request) => {
  const limit = target.page === undefined
    ? Option.none<number>()
    : state.registry.bodyLimit(placement(target.page), "request")
  return {
    hasBody: request.hasPostData === true,
    carried: Option.isNone(limit)
      ? Option.none<Uint8Array>()
      : Option.filter(postData(request), (bytes) => bytes.length <= limit.value)
  }
}

/**
 * Gives a hop the headers the network sent or received for it. A request's `ExtraInfo` comes in hop order, but
 * can overtake the page's events, so it goes to the earliest hop still waiting for it: an earlier hop reported
 * before it came, then the current hop, or else a hop not started yet (QUIRKS.md, Q158).
 */
const assign = (state: State, request: RequestEntry, { headers, phase }: ExtraInfo) => {
  const owed = request.owed.findIndex((entry) => entry.phase === phase)
  if (owed !== -1) {
    const { hop } = request.owed.splice(owed, 1)[0]!
    state.buffer.emit({ _tag: "HopHeaders", hop, phase, headers: Kit.headersOf(headers) })
    return
  }
  if (phase === "request" ? request.sentReported : request.received !== undefined) {
    request.ahead.push({ phase, headers })
    return
  }
  state.buffer.emit({ _tag: "HopHeaders", hop: request.hop, phase, headers: Kit.headersOf(headers) })
  if (phase === "response") {
    request.received = headers
    release(state, request)
  } else request.sentReported = true
}

/** The headers as sent and received: to the hop they belong to, or kept until its request is sent. */
const rawHeaders = (state: State, key: string, extra: ExtraInfo) => {
  const request = state.requests.get(key)
  if (request !== undefined) return assign(state, request, extra)
  const early = state.earlyHeaders.get(key) ?? []
  early.push(extra)
  state.earlyHeaders.set(key, early)
  if (state.earlyHeaders.size > 500) state.earlyHeaders.delete(state.earlyHeaders.keys().next().value!)
}

const webSocketFrame = (
  { state, target }: Event,
  requestId: string,
  direction: "sent" | "received",
  frame: Network.WebSocketFrame
) => {
  if (target === undefined) return
  const id = state.connections.get(requestKey(target, requestId))
  // Control frames (close, ping, pong) aren't messages
  if (id === undefined || frame.opcode >= 8) return
  const bytes = frame.opcode === 1 ? undefined : Kit.tryDecodeBase64(frame.payloadData)
  // A binary frame whose payload doesn't decode isn't reported as bytes it didn't have
  if (frame.opcode !== 1 && bytes === undefined) return
  state.buffer.emit({
    _tag: "ConnectionFrame",
    connection: id,
    frame: new NetworkConnectionFrame({
      direction,
      payload: bytes === undefined ? { _tag: "Text", text: frame.payloadData } : { _tag: "Binary", bytes },
      at: Adapter.now()
    })
  })
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Network.requestWillBeSent, (params, { state, target }) => {
      if (target === undefined) return
      const key = requestKey(target, params.requestId)
      let request = state.requests.get(key)
      let ahead: ReadonlyArray<ExtraInfo> = []
      if (request !== undefined && params.redirectResponse !== undefined) {
        // The redirect says whether `ExtraInfo` comes for the hop it ends: what hasn't come yet is owed to it
        if (params.redirectHasExtraInfo === true) {
          if (!request.sentReported) request.owed.push({ hop: request.hop, phase: "request" })
          if (request.received === undefined) request.owed.push({ hop: request.hop, phase: "response" })
        } else if (params.redirectHasExtraInfo === false && !request.sentReported) {
          state.buffer.emit({
            _tag: "HopHeaders",
            hop: request.hop,
            phase: "request",
            headers: Kit.headersOf(request.requestHeaders)
          })
        }
        emitResponse(state, request, params.redirectResponse)
        state.buffer.emit({ _tag: "RequestFinished", hop: request.hop, encodedBytes: 0, at: Adapter.now() })
        // The earlier hop's id stays, so a body read for it says it was a redirect (QUIRKS.md, Q39)
        request.servedFromCache = false
        request.received = undefined
        request.requestHeaders = params.request.headers
        request.sentReported = false
        request.redirects++
        request.hop = state.ids.hop(request.id, request.redirects)
        request.url = params.request.url
        request.sentBodies[request.redirects] = sentBody(state, target, params.request)
        state.hops.set(request.hop, request)
        ahead = request.ahead.splice(0)
      } else {
        const frame = frameOf(state, params.frameId)
        const navigation = params.type === "Document" ? state.navigations.get(params.loaderId) : undefined
        const id = state.ids.request()
        request = {
          id,
          target,
          requestId: params.requestId,
          redirects: 0,
          hop: state.ids.hop(id, 0),
          url: params.request.url,
          frame,
          navigation,
          finished: Deferred.makeUnsafe(),
          servedFromCache: false,
          fulfilled: false,
          resourceType: resourceTypes[params.type ?? "Other"] ?? "other",
          received: undefined,
          held: undefined,
          requestHeaders: params.request.headers,
          sentReported: false,
          ahead: [],
          owed: [],
          sentBodies: [sentBody(state, target, params.request)]
        }
        state.requests.set(key, request)
        state.hops.set(request.hop, request)
      }
      if (request.navigation !== undefined && (params.requestId as string) === (params.loaderId as string)) {
        request.navigation.documentHop = request.hop
      }
      state.buffer.emit({
        _tag: "RequestSent",
        request: new NetworkRequest.NetworkRequest({
          hop: request.hop,
          method: Kit.methodOf(params.request.method),
          url: Urls.reported(params.request.url),
          headers: Kit.headersOf(params.request.headers),
          resourceType: resourceTypes[params.type ?? "Other"] ?? "other",
          initiator: request.frame !== undefined
            ? {
              _tag: "Document",
              navigable: request.frame.id,
              navigation: Option.fromUndefinedOr(request.navigation?.id)
            }
            : target.realm !== undefined
            ? { _tag: "Worker", realm: target.realm.id }
            : { _tag: "Unattributed" },
          at: Adapter.now()
        })
      })
      const early = state.earlyHeaders.get(key)
      if (early !== undefined) {
        state.earlyHeaders.delete(key)
        ahead = early
      }
      for (const extra of ahead) assign(state, request, extra)
    })
    .on(Network.requestWillBeSentExtraInfo, (params, { state, target }) => {
      if (target === undefined) return
      rawHeaders(state, requestKey(target, params.requestId), { phase: "request", headers: params.headers })
    })
    .on(Network.responseReceivedExtraInfo, (params, { state, target }) => {
      if (target === undefined) return
      rawHeaders(state, requestKey(target, params.requestId), { phase: "response", headers: params.headers })
    })
    .on(Network.requestServedFromCache, (params, { state, target }) => {
      if (target === undefined) return
      const request = state.requests.get(requestKey(target, params.requestId))
      // Its response comes next, and doesn't say it came from the cache (recorded)
      if (request !== undefined) request.servedFromCache = true
    })
    .on(Network.responseReceived, (params, { state, target }) => {
      if (target === undefined) return
      const request = state.requests.get(requestKey(target, params.requestId))
      if (request === undefined) return
      // A response that says no ExtraInfo will come, as one from a cache, was sent with the request event's
      // headers, if it was sent at all
      if (!params.hasExtraInfo && !request.sentReported) {
        request.sentReported = true
        state.buffer.emit({
          _tag: "HopHeaders",
          hop: request.hop,
          phase: "request",
          headers: Kit.headersOf(request.requestHeaders)
        })
      }
      // The network's headers, `Set-Cookie` among them, come in an `ExtraInfo` the response says will follow; it
      // is reported with them (QUIRKS.md, Q158). A response from a cache, a service worker or a route can say so
      // too and get none, so only the network's waits
      if (params.hasExtraInfo && request.received === undefined && servedBy(request, params.response) === "network") {
        request.held = { response: params.response, after: [] }
        return
      }
      emitResponse(state, request, params.response)
    })
    .on(Network.loadingFinished, (params, { state, target }) => {
      if (target === undefined) return
      const request = state.requests.get(requestKey(target, params.requestId))
      if (request === undefined) return
      const finished: Adapter.Fact = {
        _tag: "RequestFinished",
        hop: request.hop,
        encodedBytes: params.encodedDataLength,
        at: Adapter.now()
      }
      // An image's `ExtraInfo` can come after its load finished
      if (request.held !== undefined) request.held.after.push(finished)
      else state.buffer.emit(finished)
      Deferred.doneUnsafe(request.finished, Effect.void)
      state.retire(requestKey(target, params.requestId))
    })
    .on(Network.loadingFailed, (params, { state, target }) => {
      if (target === undefined) return
      const routed = state.routeFailed.delete(requestKey(target, params.requestId))
      const request = state.requests.get(requestKey(target, params.requestId))
      if (request === undefined) return
      // A request that fails after its response gets no more: the response goes with the headers it has
      release(state, request)
      state.buffer.emit({
        _tag: "RequestFailed",
        hop: request.hop,
        error: params.errorText,
        canceled: params.canceled ?? false,
        at: Adapter.now()
      })
      Deferred.doneUnsafe(request.finished, Effect.fail(params.errorText))
      state.retire(requestKey(target, params.requestId))
      const navigation = request.navigation
      if (navigation === undefined || navigation.ended || request.requestId !== navigation.loaderId) return
      navigation.failed = params.errorText
      if (navigation.status === 204 || navigation.status === 205) {
        endNavigation(state, navigation, {
          _tag: "NoContent",
          status: navigation.status,
          response: Option.fromUndefinedOr(navigation.documentHop)
        }, "cdp:Network.loadingFailed")
      } else if (params.errorText !== "net::ERR_ABORTED" || routed) {
        // An error page may still commit under this loader; it is reported as the document it created
        navigation.frame.failed.set(navigation.loaderId, navigation)
        endNavigation(
          state,
          navigation,
          { _tag: "Failed", error: params.errorText, errorDocument: Option.none() },
          "cdp:Network.loadingFailed"
        )
      }
      // An abort stays pending until a download, a new navigation or an error page says what it was
    })
    .on(Network.webSocketCreated, (params, { state, target }) => {
      if (target === undefined) return
      const id = state.ids.connection()
      state.connections.set(requestKey(target, params.requestId), id)
      state.buffer.emit({
        _tag: "ConnectionOpened",
        connection: id,
        kind: "webSocket",
        url: params.url,
        navigable: Option.fromUndefinedOr(target.page?.id)
      })
    })
    .on(Network.webSocketFrameSent, (params, event) => webSocketFrame(event, params.requestId, "sent", params.response))
    .on(
      Network.webSocketFrameReceived,
      (params, event) => webSocketFrame(event, params.requestId, "received", params.response)
    )
    .on(Network.webSocketClosed, (params, { state, target }) => {
      if (target === undefined) return
      const key = requestKey(target, params.requestId)
      const id = state.connections.get(key)
      if (id === undefined) return
      state.connections.delete(key)
      state.buffer.emit({ _tag: "ConnectionClosed", connection: id })
    })
    .on(Network.eventSourceMessageReceived, (params, { state, target }) => {
      if (target === undefined) return
      const key = requestKey(target, params.requestId)
      let id = state.connections.get(key)
      if (id === undefined) {
        id = state.ids.connection()
        state.connections.set(key, id)
        state.buffer.emit({
          _tag: "ConnectionOpened",
          connection: id,
          kind: "eventSource",
          url: state.requests.get(key)?.url ?? "",
          navigable: Option.fromUndefinedOr(target.page?.id)
        })
      }
      state.buffer.emit({
        _tag: "ConnectionFrame",
        connection: id,
        frame: new NetworkConnectionFrame({
          direction: "received",
          payload: { _tag: "Text", text: params.data },
          at: Adapter.now()
        })
      })
    })

// ── Bodies ────────────────────────────────────────────────────────────────────────────────────────────────

const hopOf = (state: State, hop: NetworkRequest.HopId): Effect.Effect<RequestEntry, Adapter.AdapterError> =>
  Effect.suspend(() => {
    const request = state.hops.get(hop)
    return request === undefined ? Effect.fail(notKept(state, hop)) : Effect.succeed(request)
  })

export const responseBody = Effect.fnUntraced(function*(state: State, hop: NetworkRequest.HopId) {
  const request = yield* hopOf(state, hop)
  if (request.hop !== hop) {
    return yield* Effect.fail(Kit.unsupported("body.redirect", "A redirect's body isn't kept; only the last hop's is"))
  }
  // The body is complete once the request has finished loading
  yield* Deferred.await(request.finished).pipe(
    Effect.mapError((error) => Kit.unsupported("body.failed", `The request failed (${error}), so it has no body`))
  )
  const { body, base64Encoded } = yield* Kit.protocol(
    Network.getResponseBody({ requestId: request.requestId as Network.RequestId }).pipe(
      Protocol.on(request.target.session)
    )
  )
  return yield* Kit.bodyBytes(body, base64Encoded, "Network.getResponseBody")
})

// Chromium keeps only a request's last body, so an earlier hop's is read from what its event carried (QUIRKS.md,
// Q182)
export const requestBody = Effect.fnUntraced(function*(state: State, hop: NetworkRequest.HopId) {
  const request = yield* hopOf(state, hop)
  const sent = request.sentBodies[state.ids.redirectsOf(hop)]
  if (sent === undefined || !sent.hasBody) return Option.none<Uint8Array>()
  if (Option.isSome(sent.carried)) return sent.carried
  if (request.hop !== hop) {
    return yield* Effect.fail(
      Kit.unsupported("body.redirect", "Chromium keeps only the last hop's request body, and the event didn't carry it")
    )
  }
  const { base64Encoded, postData } = yield* Kit.protocol(
    Network.getRequestPostData({ requestId: request.requestId as Network.RequestId }).pipe(
      Protocol.on(request.target.session)
    )
  )
  return Option.some(yield* Kit.bodyBytes(postData, base64Encoded === true, "Network.getRequestPostData"))
})
