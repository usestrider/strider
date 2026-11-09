/**
 * The network on stock WebKit: requests and their hops, responses, bodies, and WebSockets. A redirect is the same
 * request's next hop; a request answered from the memory cache is reported whole at once. A document's request is
 * its navigation's: stock WebKit reports neither a failed load nor a download any other way (QUIRKS.md, Q198).
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { Frame as NetworkConnectionFrame } from "../../NetworkConnection.ts"
import * as NetworkRequest from "../../NetworkRequest.ts"
import * as NetworkResponse from "../../NetworkResponse.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Network from "../../webkit-stock-protocol/Network.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import type * as ProtocolClient from "../protocolClient.ts"
import * as Urls from "../urls.ts"
import {
  type Event,
  frameKey,
  loaderKey,
  type NavigationEntry,
  type PageEntry,
  placement,
  type RequestEntry,
  requestKey,
  type State
} from "./state.ts"
import { endNavigation, errorPage, failLoad, startNavigation } from "./tree.ts"

// ── Mapping ───────────────────────────────────────────────────────────────────────────────────────────────

export const resourceTypes: Readonly<Record<string, NetworkRequest.ResourceType>> = {
  Document: "document",
  StyleSheet: "stylesheet",
  Image: "image",
  Font: "font",
  Script: "script",
  XHR: "xhr",
  Fetch: "fetch",
  Ping: "ping",
  Beacon: "ping",
  WebSocket: "webSocket",
  EventSource: "eventSource"
}

// ── Responses ─────────────────────────────────────────────────────────────────────────────────────────────

const emitResponse = (state: State, request: RequestEntry, response: Network.Response) => {
  if (request.responded === request.hop) return
  request.responded = request.hop
  // The headers sent, cookies included, come with the response: the request event's leave cookies out, and a
  // redirect's response has none (QUIRKS.md, Q181)
  const sent = response.requestHeaders
  state.buffer.emit({
    _tag: "HopHeaders",
    hop: request.hop,
    phase: "request",
    headers: Kit.headersOf(sent !== undefined && Object.keys(sent).length > 0 ? sent : request.requestHeaders)
  })
  if (request.navigation !== undefined && request.navigation.documentHop === request.hop) {
    request.navigation.status = response.status
    request.navigation.attachment = Object.entries(response.headers).some(([name, value]) =>
      name.toLowerCase() === "content-disposition" && /^\s*attachment/i.test(String(value))
    )
  }
  state.buffer.emit({
    _tag: "ResponseReceived",
    response: new NetworkResponse.NetworkResponse({
      hop: request.hop,
      url: Urls.reported(response.url),
      status: Math.min(599, Math.max(100, response.status || 200)) as NetworkResponse.StatusCode,
      statusText: response.statusText,
      httpVersion: Option.none(),
      headers: Kit.headersOf(response.headers),
      servedBy: servedBy(request, response),
      at: Adapter.now()
    })
  })
}

/** What answered, from the response's source; a route's response is `inspector-override`. */
export const servedBy = (request: RequestEntry | undefined, response: Network.Response): NetworkResponse.ServedBy => {
  if (request?.fulfilled === true) return "route"
  switch (response.source) {
    case "network":
      return "network"
    case "memory-cache":
    case "disk-cache":
      return "cache"
    case "service-worker":
      return "serviceWorker"
    case "inspector-override":
      return "route"
    default:
      return "unknown"
  }
}

const webSocketFrame = (
  state: State,
  session: ProtocolClient.Session,
  requestId: string,
  direction: "sent" | "received",
  frame: Network.WebSocketFrame
) => {
  const id = state.connections.get(requestKey(session, requestId))
  // Control frames (close, ping, pong) aren't messages; WebKit reports the close handshake
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
    .on(Network.requestWillBeSent, (params, { state, session, target }) => {
      if (target === undefined) return
      const key = requestKey(session, params.requestId)
      let request = state.requests.get(key)
      if (request !== undefined && params.redirectResponse !== undefined) {
        emitResponse(state, request, params.redirectResponse)
        state.buffer.emit({ _tag: "RequestFinished", hop: request.hop, encodedBytes: 0, at: Adapter.now() })
        // The earlier hop's id stays, so a body read for it says it was a redirect (QUIRKS.md, Q39)
        request.redirects++
        request.hop = state.ids.hop(request.id, request.redirects)
        request.url = params.request.url
        request.postData[request.redirects] = params.request.postData
        request.requestHeaders = params.request.headers
        state.hops.set(request.hop, request)
      } else {
        const frame = state.frames.get(frameKey(target, params.frameId))
        const loader = loaderKey(target, params.loaderId)
        let navigation: NavigationEntry | undefined
        if (params.type === "Document" && frame !== undefined) {
          navigation = state.navigations.get(loader)
          if (
            navigation === undefined && frame.document?.loaderId !== loader &&
            errorPage(state, frame, loader, params.request.url) === undefined
          ) {
            navigation = startNavigation(state, frame, loader, params.request.url, "crossDocument", false)
          }
        }
        const worker = params.targetId === undefined
          ? undefined
          : [...state.workers.values()].find((worker) => worker.workerId === params.targetId)
        const id = state.ids.request()
        request = {
          id,
          session: session,
          requestId: params.requestId,
          loaderId: loader,
          redirects: 0,
          hop: state.ids.hop(id, 0),
          responded: undefined,
          url: params.request.url,
          frame,
          navigation: navigation !== undefined && navigation.documentHop === undefined ? navigation : undefined,
          worker,
          finished: Deferred.makeUnsafe(),
          fulfilled: false,
          resourceType: resourceTypes[params.type ?? "Other"] ?? "other",
          postData: [params.request.postData],
          requestHeaders: params.request.headers,
          kept: undefined
        }
        state.requests.set(key, request)
        state.hops.set(request.hop, request)
      }
      if (request.navigation !== undefined) request.navigation.documentHop = request.hop
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
            : request.worker?.realm !== undefined
            ? { _tag: "Worker", realm: request.worker.realm.id }
            : { _tag: "Unattributed" },
          at: Adapter.now()
        })
      })
    })
    .on(Network.responseReceived, (params, { state, session }) => {
      const request = state.requests.get(requestKey(session, params.requestId))
      if (request !== undefined) emitResponse(state, request, params.response)
    })
    .on(Network.loadingFinished, (params, { state, session }) => {
      const request = state.requests.get(requestKey(session, params.requestId))
      if (request === undefined) return
      state.buffer.emit({
        _tag: "RequestFinished",
        hop: request.hop,
        encodedBytes: params.metrics?.responseBodyBytesReceived ?? 0,
        at: Adapter.now(),
        httpVersion: params.metrics?.protocol
      })
      if (
        request.resourceType === "document" && request.frame !== undefined &&
        Option.isSome(state.registry.bodyLimit(placement(request.frame.page), "response"))
      ) {
        const page = request.frame.page
        const kept = Deferred.makeUnsafe<Uint8Array, Adapter.AdapterError>()
        request.kept = kept
        page.retaining.add(request)
        state.buffer.later(
          Deferred.into(readBody(request), kept).pipe(
            Effect.ensuring(state.buffer.run(() => {
              page.retaining.delete(request)
            }))
          )
        )
      }
      Deferred.doneUnsafe(request.finished, Effect.void)
      state.retire(requestKey(session, params.requestId))
    })
    .on(Network.requestServedFromMemoryCache, (params, { state, session, target }) => {
      // A request answered from the memory cache without a load: its request, response and end at once
      if (target === undefined) return
      const frame = state.frames.get(frameKey(target, params.frameId))
      const resource = params.resource
      const id = state.ids.request()
      const request: RequestEntry = {
        id,
        session: session,
        requestId: params.requestId,
        loaderId: undefined,
        redirects: 0,
        hop: state.ids.hop(id, 0),
        responded: undefined,
        url: resource.url,
        frame,
        navigation: undefined,
        worker: undefined,
        finished: Deferred.makeUnsafe(),
        fulfilled: false,
        resourceType: resourceTypes[resource.type] ?? "other",
        postData: [],
        requestHeaders: resource.response?.requestHeaders ?? ({} as Network.Headers),
        kept: undefined
      }
      state.requests.set(requestKey(session, params.requestId), request)
      state.hops.set(request.hop, request)
      state.buffer.emit({
        _tag: "RequestSent",
        request: new NetworkRequest.NetworkRequest({
          hop: request.hop,
          method: "GET",
          url: Urls.reported(resource.url),
          headers: Kit.headersOf(resource.response?.requestHeaders),
          resourceType: resourceTypes[resource.type] ?? "other",
          initiator: frame !== undefined
            ? { _tag: "Document", navigable: frame.id, navigation: Option.none() }
            : { _tag: "Unattributed" },
          at: Adapter.now()
        })
      })
      state.buffer.emit({
        _tag: "HopHeaders",
        hop: request.hop,
        phase: "request",
        headers: Kit.headersOf(resource.response?.requestHeaders)
      })
      request.responded = request.hop
      state.buffer.emit({
        _tag: "ResponseReceived",
        response: new NetworkResponse.NetworkResponse({
          hop: request.hop,
          url: Urls.reported(resource.url),
          status: Math.min(599, Math.max(100, resource.response?.status || 200)) as NetworkResponse.StatusCode,
          statusText: resource.response?.statusText ?? "",
          httpVersion: Option.none(),
          headers: Kit.headersOf(resource.response?.headers),
          servedBy: "cache",
          at: Adapter.now()
        })
      })
      state.buffer.emit({ _tag: "RequestFinished", hop: request.hop, encodedBytes: 0, at: Adapter.now() })
      Deferred.doneUnsafe(request.finished, Effect.void)
      state.retire(requestKey(session, params.requestId))
    })
    .on(Network.loadingFailed, (params, { state, session }) => {
      const request = state.requests.get(requestKey(session, params.requestId))
      if (request === undefined) return
      state.buffer.emit({
        _tag: "RequestFailed",
        hop: request.hop,
        error: params.errorText,
        canceled: params.canceled ?? false,
        at: Adapter.now()
      })
      Deferred.doneUnsafe(request.finished, Effect.fail(params.errorText))
      state.retire(requestKey(session, params.requestId))
      // A document's load that failed after a 204 or 205 kept the old document
      const navigation = request.navigation
      if (navigation !== undefined && (navigation.status === 204 || navigation.status === 205)) {
        failLoad(state, navigation, params.errorText, "webkit:Network.loadingFailed")
      } else if (navigation !== undefined && navigation.documentHop === request.hop) {
        // Stock WebKit reports neither a failed load nor a download: its document's request does (QUIRKS.md, Q198)
        if (navigation.attachment) {
          endNavigation(
            state,
            navigation,
            { _tag: "Download", download: Option.none() },
            "webkit:Network.loadingFailed"
          )
        } else {
          failLoad(state, navigation, params.errorText, "webkit:Network.loadingFailed")
          if (!params.canceled) state.errorPageFor.set(navigation.frame, navigation.id)
        }
      }
    })
    .on(Network.webSocketCreated, (params, { state, page, session }) => {
      const id = state.ids.connection()
      state.connections.set(requestKey(session, params.requestId), id)
      state.buffer.emit({
        _tag: "ConnectionOpened",
        connection: id,
        kind: "webSocket",
        url: Urls.reported(params.url),
        navigable: Option.fromUndefinedOr(page?.id)
      })
    })
    .on(
      Network.webSocketFrameSent,
      (params, { state, session }) => webSocketFrame(state, session, params.requestId, "sent", params.response)
    )
    .on(
      Network.webSocketFrameReceived,
      (params, { state, session }) => webSocketFrame(state, session, params.requestId, "received", params.response)
    )
    .on(Network.webSocketClosed, (params, { state, session }) => {
      const key = requestKey(session, params.requestId)
      const id = state.connections.get(key)
      if (id === undefined) return
      state.connections.delete(key)
      state.buffer.emit({ _tag: "ConnectionClosed", connection: id })
    })

// ── Bodies ────────────────────────────────────────────────────────────────────────────────────────────────

// A request's body: stock WebKit's text, which it decoded as UTF-8 or else Latin-1 (QUIRKS.md, Q221)
export const bodyOf = (postData: string): Uint8Array => new TextEncoder().encode(postData)

const hopOf = (state: State, hop: NetworkRequest.HopId) =>
  Kit.lookup(state.ids, state.hops, hop, () => Kit.ended({ _tag: "Hop", id: hop }))

export const requestBody = (state: State, hop: NetworkRequest.HopId) =>
  Effect.map(hopOf(state, hop), (request) => {
    const sent = request.postData[state.ids.redirectsOf(hop)]
    return sent === undefined ? Option.none<Uint8Array>() : Option.some(bodyOf(sent))
  })

const readBody = (request: RequestEntry) =>
  Kit.protocol(
    Network.getResponseBody({ requestId: request.requestId as Network.RequestId }).pipe(
      Protocol.on(request.session)
    )
  ).pipe(Effect.flatMap(({ base64Encoded, body }) => Kit.bodyBytes(body, base64Encoded, "Network.getResponseBody")))

export const responseBody = Effect.fnUntraced(function*(state: State, hop: NetworkRequest.HopId) {
  const request = yield* hopOf(state, hop)
  if (request.hop !== hop) {
    return yield* Effect.fail(Kit.unsupported("body.redirect", "A redirect's body isn't kept; only the last hop's is"))
  }
  // The body is complete once the request has finished loading
  yield* Deferred.await(request.finished).pipe(
    Effect.mapError((error) => Kit.unsupported("body.failed", `The request failed (${error}), so it has no body`))
  )
  return yield* request.kept === undefined ? readBody(request) : Deferred.await(request.kept)
})

/** Selects a retention wait in the running navigation; collection off selects no Effect to yield. */
export const beforeNavigation = (state: State, page: PageEntry) => {
  if (Option.isNone(state.registry.bodyLimit(placement(page), "response"))) return undefined
  return state.buffer.waitFor(() => {
    if (page.ended || Option.isNone(state.registry.bodyLimit(placement(page), "response"))) return true
    if (page.retaining.size > 0) return undefined
    const main = page.main
    const document = main.document
    if (main.removed || document === undefined) return true
    for (const request of state.requests.values()) {
      if (
        request.resourceType !== "document" || request.frame !== main ||
        request.loaderId !== document.loaderId || request.responded !== request.hop
      ) continue
      if (!Deferred.isDoneUnsafe(request.finished)) return undefined
    }
    return true
  })
}

/** Stock WebKit supplies decoded text, with no lossless way back to the original bytes (Q221). */
export const captureRequestBody = Effect.fnUntraced(
  function*(
    state: State,
    snapshot: NetworkRequest.NetworkRequest,
    limit: number
  ): Effect.fn.Return<Adapter.RequestBody, Adapter.AdapterError> {
    const request = yield* hopOf(state, snapshot.hop)
    const page = request.frame?.page ?? request.worker?.target.page
    if (page === undefined || Option.isNone(state.registry.bodyLimit(placement(page), "request"))) {
      return { _tag: "Unavailable", why: "notCollected" }
    }
    // Multipart reports may silently omit files (Q184); the protocol cannot establish completeness.
    if (/^multipart\//i.test(snapshot.headers["content-type"] ?? "")) return { _tag: "Incomplete" }
    const text = request.postData[state.ids.redirectsOf(snapshot.hop)]
    // Blob/File-backed parts can produce an empty report. A missing field supplies no
    // affirmative absence signal either; neither report establishes completeness.
    if (text === undefined || text === "") return { _tag: "Unavailable", why: "unavailable" }
    if (new TextEncoder().encode(text).length > limit) return { _tag: "OverLimit" }
    return { _tag: "ReportedText", text }
  }
)
