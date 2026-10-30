/**
 * Obligations on stock WebKit: requests paused by its interception, at the request or the response, and dialogs,
 * which only a launched browser's Automation reports and answers (QUIRKS.md, Q206).
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as NetworkRequest from "../../NetworkRequest.ts"
import * as NetworkResponse from "../../NetworkResponse.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Automation from "../../webkit-automation-protocol/Automation.ts"
import * as Network from "../../webkit-stock-protocol/Network.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Urls from "../urls.ts"
import { automationOf, pageHandleOf, processOfContext } from "./automation.ts"
import { bodyOf, servedBy } from "./network.ts"
import {
  endedThing,
  type Event,
  type PageEntry,
  type RequestEntry,
  requestKey,
  type State,
  type TargetEntry
} from "./state.ts"

// ── Paused requests ───────────────────────────────────────────────────────────────────────────────────────

const pausedRequest = (
  hop: NetworkRequest.HopId,
  request: Pick<Network.Request, "url" | "method" | "headers">,
  entry: RequestEntry | undefined,
  target: TargetEntry
) =>
  new NetworkRequest.NetworkRequest({
    hop,
    method: Kit.methodOf(request.method),
    url: Urls.reported(request.url),
    headers: Kit.headersOf(request.headers),
    resourceType: entry?.resourceType ?? "other",
    initiator: entry?.frame !== undefined
      ? { _tag: "Document", navigable: entry.frame.id, navigation: Option.fromUndefinedOr(entry.navigation?.id) }
      : { _tag: "Document", navigable: target.page.id, navigation: Option.none() },
    at: Adapter.now()
  })

// ── Dialogs: opened and closed, as stock WebKit's Automation says when asked (QUIRKS.md, Q206) ──────────────

export const promptOpened = (
  state: State,
  page: PageEntry,
  kind: "alert" | "confirm" | "prompt" | "beforeunload" | "unknown",
  message: string,
  defaultValue: string
) => {
  const prompt = state.ids.prompt()
  const obligation = state.ids.obligation()
  state.obligations.set(obligation, { _tag: "Prompt", id: obligation, prompt, page, answer: undefined })
  page.dialog = obligation
  state.buffer.emit({
    _tag: "ObligationOpened",
    obligation,
    subject: { _tag: "Prompt", prompt, page: page.id, kind, message, defaultValue }
  })
}

export const promptClosed = (state: State, page: PageEntry, evidence: string) => {
  const id = page.dialog
  if (id === undefined) return
  page.dialog = undefined
  const obligation = state.obligations.get(id)
  if (obligation?._tag !== "Prompt") return
  state.obligations.delete(id)
  state.buffer.emit({
    _tag: "PromptClosed",
    prompt: obligation.prompt,
    accepted: obligation.answer?.accepted ?? false,
    userText: obligation.answer?.userText ?? Option.none()
  })
  state.buffer.emit({ _tag: "ObligationEnded", obligation: id, reason: "resolved", evidence })
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Network.requestIntercepted, (params, { state, session, target }) => {
      if (target === undefined) return
      const request = state.requests.get(requestKey(session, params.requestId))
      state.pausedRequests.set(target, (state.pausedRequests.get(target) ?? 0) + 1)
      const obligation = state.ids.obligation()
      state.obligations.set(obligation, {
        _tag: "PausedRequest",
        id: obligation,
        target,
        requestId: params.requestId,
        phase: "request",
        postData: params.request.postData ?? request?.postData[request.redirects]
      })
      state.buffer.emit({
        _tag: "ObligationOpened",
        obligation,
        subject: {
          _tag: "PausedRequest",
          request: pausedRequest(
            request?.hop ?? state.ids.hop(state.ids.request(), 0),
            params.request,
            request,
            target
          ),
          phase: "request",
          response: Option.none(),
          challenge: Option.none()
        }
      })
    })
    .on(Network.responseIntercepted, (params, { state, session, target }) => {
      if (target === undefined) return
      const request = state.requests.get(requestKey(session, params.requestId))
      state.pausedRequests.set(target, (state.pausedRequests.get(target) ?? 0) + 1)
      const obligation = state.ids.obligation()
      state.obligations.set(obligation, {
        _tag: "PausedRequest",
        id: obligation,
        target,
        requestId: params.requestId,
        phase: "response",
        postData: request?.postData[request.redirects]
      })
      const hop = request?.hop ?? state.ids.hop(state.ids.request(), 0)
      state.buffer.emit({
        _tag: "ObligationOpened",
        obligation,
        subject: {
          _tag: "PausedRequest",
          request: pausedRequest(
            hop,
            { url: params.response.url, method: "GET", headers: {} as Network.Headers },
            request,
            target
          ),
          phase: "response",
          response: Option.some(
            new NetworkResponse.NetworkResponse({
              hop,
              url: Urls.reported(params.response.url),
              status: Math.min(599, Math.max(100, params.response.status || 200)) as NetworkResponse.StatusCode,
              statusText: params.response.statusText,
              httpVersion: Option.none(),
              headers: Kit.headersOf(params.response.headers),
              servedBy: servedBy(request, params.response),
              at: Adapter.now()
            })
          ),
          challenge: Option.none()
        }
      })
    })

// ── Operations ────────────────────────────────────────────────────────────────────────────────────────────

const obligationOf = (state: State, id: Adapter.ObligationId) =>
  Kit.lookup(state.ids, state.obligations, id, endedThing)

export const resolve = Effect.fnUntraced(function*(
  state: State,
  id: Adapter.ObligationId,
  decision: Adapter.Decision
) {
  const obligation = yield* obligationOf(state, id)
  switch (obligation._tag) {
    case "PausedRequest": {
      const on = Protocol.on(obligation.target.session)
      const requestId = obligation.requestId as Network.RequestId
      const send = (() => {
        switch (decision._tag) {
          case "Continue": {
            const overrides = Option.getOrUndefined(decision.overrides)
            return obligation.phase === "response" || overrides === undefined
              ? Network.interceptContinue({ requestId, stage: obligation.phase }).pipe(on)
              : Network.interceptWithRequest({
                requestId,
                ...(overrides.url === undefined ? {} : { url: overrides.url }),
                ...(overrides.method === undefined ? {} : { method: overrides.method }),
                ...(overrides.headers === undefined ? {} : { headers: overrides.headers as Network.Headers }),
                ...(overrides.body === undefined ? {} : { postData: Kit.encodeBase64(overrides.body) })
              }).pipe(on)
          }
          case "ContinueResponse":
            return Effect.fail(
              new Protocol.ProtocolError({
                reason: new Protocol.Unsupported({ method: "interception.responseHeaders" })
              })
            )
          case "Fulfill": {
            const entry = state.requests.get(requestKey(obligation.target.session, obligation.requestId))
            if (entry !== undefined) entry.fulfilled = true
            const headers = decision.headers
            const mimeType = Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1]
              ?.split(";")[0] ?? ""
            const response = {
              requestId,
              content: Kit.encodeBase64(decision.body),
              base64Encoded: true,
              mimeType,
              status: decision.status,
              statusText: "",
              headers: headers as Network.Headers
            }
            return obligation.phase === "response"
              ? Network.interceptWithResponse(response).pipe(on)
              : Network.interceptRequestWithResponse(response).pipe(on)
          }
          case "Fail":
            return obligation.phase === "request"
              ? decision.error === "failed"
                ? Network.interceptRequestWithError({ requestId, errorType: "General" }).pipe(on)
                // WebKit reports every reason as "Blocked by Web Inspector"
                : Effect.fail(
                  new Protocol.ProtocolError({
                    reason: new Protocol.Unsupported({ method: "interception.abortReason" })
                  })
                )
              : Effect.fail(
                new Protocol.ProtocolError({
                  reason: new Protocol.Unsupported({ method: "resolve Fail at the response stage" })
                })
              )
          default:
            return Effect.fail(
              new Protocol.ProtocolError({
                reason: new Protocol.Unsupported({ method: `resolve ${decision._tag}` })
              })
            )
        }
      })()
      yield* Kit.protocol(send)
      state.pausedRequests.set(obligation.target, Math.max(0, (state.pausedRequests.get(obligation.target) ?? 1) - 1))
      state.obligations.delete(id)
      yield* state.buffer.run(() =>
        state.buffer.emit({ _tag: "ObligationEnded", obligation: id, reason: "resolved", evidence: "webkit:Network" })
      )
      return
    }
    case "Prompt": {
      // A dialog is reported, and answered, through Automation (QUIRKS.md, Q206); attached, none is reported
      if (decision._tag !== "Accept" && decision._tag !== "Dismiss") {
        return yield* Effect.fail(Kit.unsupported(decision._tag, "A dialog is accepted or dismissed"))
      }
      // A dialog answered already, or closed, is over
      if (obligation.page.dialog !== id || obligation.answer !== undefined) return yield* Effect.fail(endedThing())
      const handle = yield* pageHandleOf(state, obligation.page)
      const process = yield* processOfContext(state, obligation.page.context)
      const promptText = decision._tag === "Accept" ? Option.getOrUndefined(decision.promptText) : undefined
      if (promptText !== undefined) {
        // Only a prompt takes text; Automation says so of any other dialog
        yield* automationOf(
          process,
          Automation.setUserInputForCurrentJavaScriptPrompt({
            browsingContextHandle: handle,
            userInput: promptText
          })
        ).pipe(
          Effect.mapError(() => Kit.unsupported("prompt.respond", "the dialog wasn't a prompt, so it takes no text"))
        )
      }
      obligation.answer = { accepted: decision._tag === "Accept", userText: Option.fromUndefinedOr(promptText) }
      yield* automationOf(
        process,
        decision._tag === "Accept"
          ? Automation.acceptCurrentJavaScriptDialog({ browsingContextHandle: handle })
          : Automation.dismissCurrentJavaScriptDialog({ browsingContextHandle: handle })
      )
      yield* state.buffer.run(() =>
        promptClosed(state, obligation.page, "webkit:Automation.acceptCurrentJavaScriptDialog")
      )
      return
    }
  }
})

export const pausedRequestBody = (state: State, id: Adapter.ObligationId) =>
  Effect.flatMap(obligationOf(state, id), (obligation) =>
    obligation._tag !== "PausedRequest"
      ? Effect.fail(Kit.unsupported("pausedRequestBody", "A dialog has no request body"))
      : Effect.succeed(
        obligation.postData === undefined ? Option.none<Uint8Array>() : Option.some(bodyOf(obligation.postData))
      ))

export const pausedResponseBody = (_state: State, _id: Adapter.ObligationId) =>
  Effect.fail(Kit.unsupported("interception.responseBody", "WebKit can't read a response paused there"))
