/**
 * Obligations on CDP: requests `Fetch` paused, prompts and file choosers, each awaiting one decision, and the
 * commands that carry the decision out.
 */
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as DOM from "../../cdp/DOM.ts"
import * as Fetch from "../../cdp/Fetch.ts"
import * as Network from "../../cdp/Network.ts"
import * as Page from "../../cdp/Page.ts"
import * as NetworkRequest from "../../NetworkRequest.ts"
import * as NetworkResponse from "../../NetworkResponse.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Declarations from "../declarations.ts"
import * as Urls from "../urls.ts"
import { failReasons, fetchHeaders, postData, resourceTypes } from "./mapping.ts"
import {
  endedThing,
  type Event,
  frameOf,
  type ObligationEntry,
  placement,
  type RequestEntry,
  requestKey,
  type State,
  type TargetEntry
} from "./state.ts"

const pausedRequest = (
  hop: NetworkRequest.HopId,
  request: Network.Request,
  resourceType: string,
  entry: RequestEntry | undefined,
  target: TargetEntry
) =>
  new NetworkRequest.NetworkRequest({
    hop,
    method: Kit.methodOf(request.method),
    url: Urls.reported(request.url),
    headers: Kit.headersOf(request.headers),
    resourceType: entry?.resourceType ?? resourceTypes[resourceType] ?? "other",
    initiator: entry?.frame !== undefined
      ? { _tag: "Document", navigable: entry.frame.id, navigation: Option.fromUndefinedOr(entry.navigation?.id) }
      : target.page !== undefined
      ? { _tag: "Document", navigable: target.page.id, navigation: Option.none() }
      : { _tag: "Unattributed" },
    at: Adapter.now()
  })

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Fetch.requestPaused, (params, { state, target }) => {
      if (target === undefined) return
      const request = params.networkId === undefined
        ? undefined
        : state.requests.get(requestKey(target, params.networkId))
      const phase = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined
        ? "response"
        : "request"
      // Authentication intercepts every request so the browser asks about its challenges; a request no intercept
      // of this phase wants goes on at once
      const intercepts = target.page === undefined ? undefined : state.registry.intercepts(placement(target.page))
      const wanted = intercepts === undefined ||
        (phase === "request" ? intercepts.request : intercepts.response).some((pattern) =>
          Declarations.glob(pattern).test(params.request.url)
        )
      if (!wanted) {
        const on = Protocol.on(target.session)
        state.buffer.later(
          phase === "request"
            ? Fetch.continueRequest({ requestId: params.requestId }).pipe(on)
            : Fetch.continueResponse({ requestId: params.requestId }).pipe(on)
        )
        return
      }
      const obligation = state.ids.obligation()
      state.obligations.set(obligation, {
        _tag: "PausedRequest",
        id: obligation,
        target,
        requestId: params.requestId,
        phase,
        request,
        body: postData(params.request),
        networkId: params.networkId,
        hasBody: params.request.hasPostData === true
      })
      const hop = request?.hop ?? state.ids.hop(state.ids.request(), 0)
      state.buffer.emit({
        _tag: "ObligationOpened",
        obligation,
        subject: {
          _tag: "PausedRequest",
          request: pausedRequest(hop, params.request, params.resourceType, request, target),
          phase,
          response: params.responseStatusCode === undefined
            ? Option.none()
            : Option.some(
              new NetworkResponse.NetworkResponse({
                hop,
                url: Urls.reported(params.request.url),
                status: params.responseStatusCode as NetworkResponse.StatusCode,
                statusText: params.responseStatusText ?? "",
                httpVersion: Option.none(),
                headers: Headers.fromInput(
                  Object.fromEntries((params.responseHeaders ?? []).map((header) => [header.name, header.value]))
                ),
                servedBy: request?.servedFromCache === true ? "cache" : "network",
                at: Adapter.now()
              })
            ),
          challenge: Option.none()
        }
      })
    })
    .on(Fetch.authRequired, (params, { state, target }) => {
      if (target === undefined) return
      const obligation = state.ids.obligation()
      state.obligations.set(obligation, {
        _tag: "PausedRequest",
        id: obligation,
        target,
        requestId: params.requestId,
        phase: "auth",
        request: undefined,
        body: postData(params.request),
        networkId: undefined,
        hasBody: params.request.hasPostData === true
      })
      const hop = state.ids.hop(state.ids.request(), 0)
      state.buffer.emit({
        _tag: "ObligationOpened",
        obligation,
        subject: {
          _tag: "PausedRequest",
          request: pausedRequest(hop, params.request, params.resourceType, undefined, target),
          phase: "auth",
          response: Option.none(),
          challenge: Option.some({
            origin: params.authChallenge.origin,
            scheme: params.authChallenge.scheme,
            realm: params.authChallenge.realm
          })
        }
      })
    })
    .on(Page.javascriptDialogOpening, (params, { state, target }) => {
      const page = target?.page
      if (target === undefined || page === undefined) return
      const prompt = state.ids.prompt()
      const obligation = state.ids.obligation()
      state.obligations.set(obligation, { _tag: "Prompt", id: obligation, prompt, target })
      state.buffer.emit({
        _tag: "ObligationOpened",
        obligation,
        subject: {
          _tag: "Prompt",
          prompt,
          page: page.id,
          kind: params.type === "beforeunload"
            ? "beforeunload"
            : params.type === "alert"
            ? "alert"
            : params.type === "confirm"
            ? "confirm"
            : "prompt",
          message: params.message,
          defaultValue: params.defaultPrompt ?? ""
        }
      })
    })
    .on(Page.javascriptDialogClosed, (params, { state, target }) => {
      for (const [id, obligation] of state.obligations) {
        if (obligation._tag !== "Prompt" || obligation.target !== target) continue
        state.obligations.delete(id)
        state.buffer.emit({
          _tag: "PromptClosed",
          prompt: obligation.prompt,
          accepted: params.result,
          userText: params.userInput === "" ? Option.none() : Option.some(params.userInput)
        })
        state.buffer.emit({
          _tag: "ObligationEnded",
          obligation: id,
          reason: "resolved",
          evidence: "cdp:Page.javascriptDialogClosed"
        })
        return
      }
    })
    .on(Page.fileChooserOpened, (params, { state, target }) => {
      const frame = frameOf(state, params.frameId)
      if (target === undefined || frame === undefined) return
      const obligation = state.ids.obligation()
      const backendNodeId = params.backendNodeId as number | undefined
      state.obligations.set(obligation, { _tag: "FileChooser", id: obligation, target, backendNodeId })
      state.buffer.emit({
        _tag: "ObligationOpened",
        obligation,
        subject: {
          _tag: "FileChooser",
          navigable: frame.id,
          multiple: params.mode === "selectMultiple",
          element: backendNodeId === undefined || frame.document === undefined
            ? Option.none()
            : Option.some({ document: frame.document.id, binding: String(backendNodeId) })
        }
      })
    })

// ── Operations ────────────────────────────────────────────────────────────────────────────────────────────

const obligationOf = (state: State, id: Adapter.ObligationId) =>
  Kit.lookup(state.ids, state.obligations, id, () => endedThing({ _tag: "Obligation", id }))

const pausedOf = (state: State, id: Adapter.ObligationId) =>
  Effect.flatMap(
    obligationOf(state, id),
    (obligation): Effect.Effect<Extract<ObligationEntry, { _tag: "PausedRequest" }>, Adapter.AdapterError> =>
      obligation._tag === "PausedRequest"
        ? Effect.succeed(obligation)
        // Only a paused request has a body: L1 never asks another obligation for one
        : Effect.fail(Kit.foreign(id))
  )

const decide = (
  state: State,
  obligation: Extract<ObligationEntry, { _tag: "PausedRequest" }>,
  decision: Adapter.Decision
): Effect.Effect<void, Protocol.ProtocolError> => {
  const on = Protocol.on(obligation.target.session)
  const requestId = obligation.requestId as Fetch.RequestId
  switch (decision._tag) {
    case "Continue": {
      const overrides = Option.getOrUndefined(decision.overrides)
      return obligation.phase === "response" && overrides === undefined
        ? Fetch.continueResponse({ requestId }).pipe(on)
        : Fetch.continueRequest({
          requestId,
          ...(overrides?.url === undefined ? {} : { url: overrides.url }),
          ...(overrides?.method === undefined ? {} : { method: overrides.method }),
          ...(overrides?.headers === undefined
            ? {}
            : { headers: Object.entries(overrides.headers).map(([name, value]) => ({ name, value })) }),
          ...(overrides?.body === undefined ? {} : { postData: Kit.encodeBase64(overrides.body) })
        }).pipe(on)
    }
    case "ContinueResponse":
      return Fetch.continueResponse({
        requestId,
        ...(Option.isSome(decision.status) ? { responseCode: decision.status.value } : {}),
        ...(Option.isSome(decision.headers) ? { responseHeaders: fetchHeaders(decision.headers.value) } : {})
      }).pipe(on)
    case "Fulfill":
      // The browser reports what a route made as an ordinary response
      if (obligation.request !== undefined) obligation.request.fulfilled = true
      return Fetch.fulfillRequest({
        requestId,
        responseCode: decision.status,
        responseHeaders: fetchHeaders(decision.headers),
        body: Kit.encodeBase64(decision.body)
      }).pipe(on)
    case "Fail":
      // An abort is ended by what follows it, which a route's abort lacks
      if (obligation.networkId !== undefined) {
        state.routeFailed.add(requestKey(obligation.target, obligation.networkId))
      }
      return Fetch.failRequest({ requestId, errorReason: failReasons[decision.error] }).pipe(on)
    case "ProvideCredentials":
      return Fetch.continueWithAuth({
        requestId,
        authChallengeResponse: {
          response: "ProvideCredentials",
          username: decision.username,
          password: Redacted.make(decision.password)
        }
      }).pipe(on)
    case "DefaultAuth":
    case "CancelAuth":
      return Fetch.continueWithAuth({
        requestId,
        authChallengeResponse: { response: decision._tag === "DefaultAuth" ? "Default" : "CancelAuth" }
      }).pipe(on)
    default:
      return Effect.fail(
        new Protocol.ProtocolError({ reason: new Protocol.Unsupported({ method: `resolve ${decision._tag}` }) })
      )
  }
}

export const resolve = Effect.fnUntraced(
  function*(state: State, id: Adapter.ObligationId, decision: Adapter.Decision) {
    const obligation = yield* obligationOf(state, id)
    const on = Protocol.on(obligation.target.session)
    switch (obligation._tag) {
      case "PausedRequest": {
        yield* Kit.protocol(decide(state, obligation, decision))
        state.obligations.delete(id)
        yield* state.buffer.run(() =>
          state.buffer.emit({ _tag: "ObligationEnded", obligation: id, reason: "resolved", evidence: "cdp:Fetch" })
        )
        return
      }
      case "Prompt": {
        if (decision._tag !== "Accept" && decision._tag !== "Dismiss") {
          return yield* Effect.fail(Kit.unsupported(decision._tag, "A prompt is accepted or dismissed"))
        }
        yield* Kit.protocol(
          Page.handleJavaScriptDialog({
            accept: decision._tag === "Accept",
            ...(decision._tag === "Accept" && Option.isSome(decision.promptText)
              ? { promptText: decision.promptText.value }
              : {})
          }).pipe(on)
        )
        return
      }
      case "FileChooser": {
        state.obligations.delete(id)
        if (decision._tag === "SetFiles" && obligation.backendNodeId !== undefined) {
          yield* Kit.protocol(
            DOM.setFileInputFiles({
              files: [...decision.files],
              backendNodeId: obligation.backendNodeId as DOM.BackendNodeId
            }).pipe(on)
          )
        }
        yield* state.buffer.run(() =>
          state.buffer.emit({
            _tag: "ObligationEnded",
            obligation: id,
            reason: "resolved",
            evidence: "cdp:DOM.setFileInputFiles"
          })
        )
        return
      }
    }
  }
)

export const pausedRequestBody = Effect.fnUntraced(function*(state: State, id: Adapter.ObligationId) {
  const obligation = yield* pausedOf(state, id)
  if (Option.isSome(obligation.body) || !obligation.hasBody || obligation.networkId === undefined) {
    return obligation.body
  }
  // A body too large for the pause's event is read by the request's network id
  const { base64Encoded, postData } = yield* Kit.protocol(
    Network.getRequestPostData({ requestId: obligation.networkId as Network.RequestId }).pipe(
      Protocol.on(obligation.target.session)
    )
  )
  return Option.some(yield* Kit.bodyBytes(postData, base64Encoded === true, "Network.getRequestPostData"))
})

export const pausedResponseBody = Effect.fnUntraced(function*(state: State, id: Adapter.ObligationId) {
  const obligation = yield* pausedOf(state, id)
  if (obligation.phase !== "response") {
    return yield* Effect.fail(
      Kit.unsupported("interception.responseBody", "A request has a response only at the response phase")
    )
  }
  const { body, base64Encoded } = yield* Kit.protocol(
    Fetch.getResponseBody({ requestId: obligation.requestId as Fetch.RequestId }).pipe(
      Protocol.on(obligation.target.session)
    )
  )
  return yield* Kit.bodyBytes(body, base64Encoded, "Fetch.getResponseBody")
})
