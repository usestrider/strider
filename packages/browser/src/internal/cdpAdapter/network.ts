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
import type * as ProtocolClient from "../protocolClient.ts"
import * as Sizes from "../requestSizes.ts"
import * as Timing from "../requestTiming.ts"
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

/** Reports headers the network sent or received for a hop; the current hop's received ones go with its response. */
const deliver = (
  state: State,
  request: RequestEntry,
  hop: NetworkRequest.HopId,
  { headers, phase, statusCode }: ExtraInfo
) => {
  if (statusCode === 304) {
    const sizes = request.frame?.page.context.requestSizes?.get(hop)
    if (sizes !== undefined) sizes.network = false
  }
  state.buffer.emit({ _tag: "HopHeaders", hop, phase, headers: Kit.headersOf(headers) })
  if (hop !== request.hop) return
  if (phase === "response") {
    request.received = headers
    release(state, request)
  } else request.sentReported = true
}

/**
 * Gives a hop the headers the network sent or received for it. A request's `ExtraInfo` comes in hop order, for
 * the hops that get one, but can overtake the page's events; and a hop says whether it gets one only as it ends:
 * one from a cache or a service worker gets none, and would otherwise take the next hop's. So an `ExtraInfo` goes
 * to the earliest hop that said it would get one and hasn't, or waits for a hop to say so (QUIRKS.md, Q158).
 */
const assign = (state: State, request: RequestEntry, extra: ExtraInfo) => {
  const owed = request.owed.findIndex((entry) => entry.phase === extra.phase)
  if (owed === -1) return void request.ahead.push(extra)
  const { hop } = request.owed.splice(owed, 1)[0]!
  deliver(state, request, hop, extra)
}

/** The current hop gets `ExtraInfo`: what of it waits is its own, as hops come in order, and the rest is owed it. */
const expectExtraInfo = (state: State, request: RequestEntry, phases: ReadonlyArray<ExtraInfo["phase"]>) => {
  const hop = request.hop
  for (const phase of phases) {
    if (phase === "request" ? request.sentReported : request.received !== undefined) continue
    const waiting = request.ahead.findIndex((extra) => extra.phase === phase)
    if (waiting === -1) request.owed.push({ hop, phase })
    else deliver(state, request, hop, request.ahead.splice(waiting, 1)[0]!)
  }
}

/** The current hop gets no `ExtraInfo`: it was sent with the request event's headers, if it was sent at all. */
const noExtraInfo = (state: State, request: RequestEntry) => {
  if (request.sentReported) return
  request.sentReported = true
  state.buffer.emit({
    _tag: "HopHeaders",
    hop: request.hop,
    phase: "request",
    headers: Kit.headersOf(request.requestHeaders)
  })
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

/** Chunk accounting belongs only to live page-attributed sessions in an opted-in context. */
export const eventScopes = (state: State): NonNullable<ProtocolClient.Fold["eventScopes"]> =>
  new Map([
    [Network.dataReceived.method, (session: ProtocolClient.Session) => {
      const target = state.targets.get(session)
      const page = target?.page ?? target?.frame?.page
      return target !== undefined && !target.ended &&
        page !== undefined && !page.ended && !page.context.disposed &&
        page.context.requestSizes !== undefined
    }]
  ])

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Network.requestWillBeSent, (params, { state, target }) => {
      if (target === undefined) return
      const key = requestKey(target, params.requestId)
      let request = state.requests.get(key)
      if (request !== undefined && params.redirectResponse !== undefined) {
        // The redirect says whether `ExtraInfo` comes for the hop it ends
        if (params.redirectHasExtraInfo === true) expectExtraInfo(state, request, ["request", "response"])
        else noExtraInfo(state, request)
        request.frame?.page.context.requestTiming?.get(request.hop)?.response(params.redirectResponse.timing)
        request.frame?.page.context.requestTiming?.get(request.hop)?.finish(params.timestamp)
        request.frame?.page.context.requestTiming?.delete(request.hop)
        request.frame?.page.context.requestSizes?.delete(request.hop)
        emitResponse(state, request, params.redirectResponse)
        state.buffer.emit({ _tag: "RequestFinished", hop: request.hop, encodedBytes: 0, at: Adapter.now() })
        // The earlier hop's id stays, so a body read for it says it was a redirect (QUIRKS.md, Q39)
        request.attribution = state.pendingAttribution.get(key) ?? { target, fulfilled: false }
        request.servedFromCache = false
        request.received = undefined
        request.requestHeaders = params.request.headers
        request.sentReported = false
        request.redirects++
        request.hop = state.ids.hop(request.id, request.redirects)
        request.url = params.request.url
        request.sentBodies[request.redirects] = sentBody(state, target, params.request)
        state.hops.set(request.hop, request)
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
          attribution: state.pendingAttribution.get(key) ?? { target, fulfilled: false },
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
      if (request.frame?.page.context.requestSizes !== undefined) {
        Sizes.keep(request.frame.page.context.requestSizes, request.hop, request.frame.id)
      }
      if (request.frame?.page.context.requestTiming !== undefined) {
        const hop = request.hop
        Timing.keep(
          request.frame.page.context.requestTiming,
          hop,
          Timing.collector(
            Timing.cdp,
            { timestamp: params.timestamp, wallTime: params.wallTime },
            (timing) => state.buffer.emit({ _tag: "HopTiming", hop, timing }),
            request.frame.id
          )
        )
      }
      state.pendingAttribution.delete(key)
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
        for (const extra of early) assign(state, request, extra)
      }
    })
    .on(Network.requestWillBeSentExtraInfo, (params, { state, target }) => {
      if (target === undefined) return
      rawHeaders(state, requestKey(target, params.requestId), { phase: "request", headers: params.headers })
    })
    .on(Network.responseReceivedExtraInfo, (params, { state, target }) => {
      if (target === undefined) return
      rawHeaders(state, requestKey(target, params.requestId), {
        phase: "response",
        headers: params.headers,
        ...((target.page ?? target.frame?.page)?.context.requestSizes === undefined
          ? {}
          : { statusCode: params.statusCode })
      })
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
      const sizes = request.frame?.page.context.requestSizes?.get(request.hop)
      if (sizes !== undefined) {
        sizes.network = servedBy(request, params.response) === "network" && params.response.status !== 304
      }
      request.frame?.page.context.requestTiming?.get(request.hop)?.response(
        servedBy(request, params.response) === "network" ? params.response.timing : undefined
      )
      // The network's headers, `Set-Cookie` among them, come in an `ExtraInfo` the response says will follow; it
      // is reported with them (QUIRKS.md, Q158). A response from a cache, a service worker or a route can say so
      // too and get none, so only the network's waits; one that gets none was sent with the request event's
      // headers, if it was sent at all
      if (params.hasExtraInfo === true && servedBy(request, params.response) === "network") {
        request.held = { response: params.response, after: [] }
        return expectExtraInfo(state, request, ["request", "response"])
      }
      noExtraInfo(state, request)
      emitResponse(state, request, params.response)
    })
    .on(Network.dataReceived, (params, { state, target }) => {
      if (target === undefined || (target.page ?? target.frame?.page)?.context.requestSizes === undefined) return
      const request = state.requests.get(requestKey(target, params.requestId))
      const sizes = request?.frame?.page.context.requestSizes?.get(request.hop)
      if (sizes !== undefined && sizes.decoded !== undefined) {
        const length = Sizes.count(params.dataLength)
        sizes.decoded = Option.isSome(length)
          ? Option.getOrUndefined(Sizes.count(sizes.decoded + length.value))
          : undefined
      }
    })
    .on(Network.loadingFinished, (params, { state, target }) => {
      if (target === undefined) return
      state.pendingAttribution.delete(requestKey(target, params.requestId))
      for (const [id, auth] of target.proxyAuth ?? []) {
        if (auth.networkId === params.requestId) target.proxyAuth!.delete(id)
      }
      const request = state.requests.get(requestKey(target, params.requestId))
      if (request === undefined) return
      const sizes = request.frame?.page.context.requestSizes?.get(request.hop)
      // A still-held response lacks final raw-header evidence (including a possible 304).
      if (sizes?.network && request.held === undefined) {
        state.buffer.emit({
          _tag: "HopSizes",
          hop: request.hop,
          sizes: Sizes.cdp(params.encodedDataLength, sizes.decoded)
        })
      }
      request.frame?.page.context.requestTiming?.get(request.hop)?.finish(params.timestamp)
      request.frame?.page.context.requestTiming?.delete(request.hop)
      request.frame?.page.context.requestSizes?.delete(request.hop)
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
      state.pendingAttribution.delete(requestKey(target, params.requestId))
      for (const [id, auth] of target.proxyAuth ?? []) {
        if (auth.networkId === params.requestId) target.proxyAuth!.delete(id)
      }
      const routed = state.routeFailed.delete(requestKey(target, params.requestId))
      const request = state.requests.get(requestKey(target, params.requestId))
      if (request === undefined) return
      request.frame?.page.context.requestTiming?.delete(request.hop)
      request.frame?.page.context.requestSizes?.delete(request.hop)
      // Keep the failed hop eligible for late sent headers. Earlier redirect obligations
      // still consume their own ExtraInfo first; failure itself settles public waits.
      const phases = new Set<ExtraInfo["phase"]>(["request", ...request.ahead.map((extra) => extra.phase)])
      expectExtraInfo(
        state,
        request,
        Array.from(phases).filter((phase) =>
          !request.owed.some((entry) => entry.hop === request.hop && entry.phase === phase)
        )
      )
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
        url: Urls.reported(params.url),
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
          url: Urls.reported(state.requests.get(key)?.url ?? ""),
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

/** Exact event bytes, or a guarded current-hop native read; legacy recording reads remain unchanged. */
export const captureRequestBody = Effect.fnUntraced(
  function*(
    state: State,
    snapshot: NetworkRequest.NetworkRequest,
    limit: number
  ): Effect.fn.Return<Adapter.RequestBody, Adapter.AdapterError> {
    const request = yield* hopOf(state, snapshot.hop)
    const page = request.target.page
    if (page === undefined || Option.isNone(state.registry.bodyLimit(placement(page), "request"))) {
      return { _tag: "Unavailable", why: "notCollected" }
    }
    const sent = request.sentBodies[state.ids.redirectsOf(snapshot.hop)]
    if (sent === undefined) return { _tag: "Unavailable", why: "unavailable" }
    if (!sent.hasBody) return { _tag: "Absent" }
    if (Option.isSome(sent.carried)) {
      return sent.carried.value.length > limit
        ? { _tag: "OverLimit" }
        : { _tag: "Bytes", bytes: sent.carried.value }
    }
    // A multipart fallback can silently omit files. No partial input reaches a decoder.
    if (/^multipart\//i.test(snapshot.headers["content-type"] ?? "")) return { _tag: "Incomplete" }
    if (request.hop !== snapshot.hop) return { _tag: "Unavailable", why: "redirect" }
    const result = yield* Kit.protocol(
      Network.getRequestPostData({ requestId: request.requestId as Network.RequestId }).pipe(
        Protocol.on(request.target.session)
      )
    ).pipe(Effect.result)
    if (request.hop !== snapshot.hop) return { _tag: "Unavailable", why: "redirect" }
    if (result._tag === "Failure") {
      if (result.failure.reason._tag === "Protocol" && result.failure.reason.error.reason._tag === "Rejected") {
        return { _tag: "Unavailable", why: "unavailable" }
      }
      return yield* Effect.fail(result.failure)
    }
    const bytes = yield* Kit.bodyBytes(
      result.success.postData,
      result.success.base64Encoded === true,
      "Network.getRequestPostData"
    )
    // The fallback can omit file parts. An empty string cannot establish a complete
    // empty payload; only carried event bytes can establish that representation.
    if (bytes.length === 0) return { _tag: "Unavailable", why: "unavailable" }
    return bytes.length > limit ? { _tag: "OverLimit" } : { _tag: "Bytes", bytes }
  }
)
