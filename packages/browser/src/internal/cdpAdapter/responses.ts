/**
 * Responses, reported with the headers the network received: a response that says `ExtraInfo` will follow is held
 * until it does, with the facts after it (QUIRKS.md, Q158), and goes with the headers it has when its request or
 * its navigation ends first.
 */
import * as Option from "effect/Option"
import type * as Network from "../../cdp/Network.ts"
import * as NetworkResponse from "../../NetworkResponse.ts"
import type * as Url from "../../Url.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import type { NavigationEntry, RequestEntry, State } from "./state.ts"

/** What answered, from the response's flags and what came before it. */
export const servedBy = (request: RequestEntry, response: Network.Response): NetworkResponse.ServedBy =>
  request.fulfilled
    ? "route"
    : response.fromServiceWorker === true
    ? "serviceWorker"
    : request.servedFromCache || response.fromDiskCache === true || response.fromPrefetchCache === true
    ? "cache"
    : "network"

export const emitResponse = (state: State, request: RequestEntry, response: Network.Response) => {
  if (request.navigation !== undefined && request.requestId === request.navigation.loaderId) {
    request.navigation.status = response.status
  }
  state.buffer.emit({
    _tag: "ResponseReceived",
    response: new NetworkResponse.NetworkResponse({
      hop: request.hop,
      url: response.url as Url.Url,
      status: Math.min(599, Math.max(100, response.status || 200)) as NetworkResponse.StatusCode,
      statusText: response.statusText,
      httpVersion: Option.fromUndefinedOr(response.protocol || undefined),
      // The headers as received, where `ExtraInfo` said them: the main event leaves out cookies (Q158)
      headers: Kit.headersOf(request.received ?? response.headers),
      servedBy: servedBy(request, response),
      at: Adapter.now()
    })
  })
}

/** Reports a held response, then what came after it. */
export const release = (state: State, request: RequestEntry) => {
  const held = request.held
  if (held === undefined) return
  request.held = undefined
  emitResponse(state, request, held.response)
  for (const fact of held.after) state.buffer.emit(fact)
}

/**
 * A navigation's response comes before its end and its document's commit, as the model expects: a response
 * still waiting for its headers then goes with the ones it has (QUIRKS.md, Q158).
 */
export const releaseDocument = (state: State, navigation: NavigationEntry | undefined) => {
  const hop = navigation?.documentHop
  const request = hop === undefined ? undefined : state.hops.get(hop)
  if (request !== undefined) release(state, request)
}
