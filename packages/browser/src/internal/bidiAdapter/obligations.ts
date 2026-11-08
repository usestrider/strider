/**
 * Obligations on BiDi: paused requests, prompts and file choosers, and the decisions that resolve them.
 * Intercepts are compiled to BiDi URL patterns that cover each glob, and the glob itself is checked here: a
 * paused request no registration matches continues at once. BiDi can't scope an intercept to a user context, so
 * one scoped to a user context intercepts browser-wide and filters here too.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as BrowsingContext from "../../bidi-protocol/BrowsingContext.ts"
import * as Input from "../../bidi-protocol/Input.ts"
import * as Network from "../../bidi-protocol/Network.ts"
import * as NetworkRequest from "../../NetworkRequest.ts"
import type * as NetworkResponse from "../../NetworkResponse.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Declarations from "../declarations.ts"
import * as Urls from "../urls.ts"
import { bidiHeaders, bytesOf, bytesText, headersOf, originOf, resourceType } from "./mapping.ts"
import {
  type Event,
  navigableOf,
  type ObligationEntry,
  type Phase,
  placement,
  type RequestEntry,
  type State
} from "./state.ts"

// ── Paused requests ───────────────────────────────────────────────────────────────────────────────────────

export const requestSnapshot = (
  params: { readonly request: Network.RequestData },
  request: RequestEntry
) =>
  new NetworkRequest.NetworkRequest({
    hop: request.hop,
    method: Kit.methodOf(params.request.method),
    url: Urls.reported(params.request.url),
    headers: headersOf(params.request.headers),
    resourceType: resourceType(params.request),
    initiator: request.navigable === undefined
      ? { _tag: "Unattributed" }
      : {
        _tag: "Document",
        navigable: request.navigable.id,
        navigation: Option.fromUndefinedOr(request.navigation?.id)
      },
    at: Adapter.now()
  })

/** Continues a paused request as if nothing had paused it. */
const continued = (state: State, phase: Phase, request: Network.Request) =>
  phase === "auth"
    ? state.send(Network.continueWithAuth({ request, action: "default" }))
    : phase === "response"
    ? state.send(Network.continueResponse({ request }))
    : state.send(Network.continueRequest({ request }))

/**
 * A blocked request becomes an obligation if a registration's glob matches it; otherwise it continues, after the
 * fold, never on it.
 */
export const pause = (
  state: State,
  params: {
    readonly request: Network.RequestData
    readonly context: string | null
    readonly intercepts?: ReadonlyArray<string> | undefined
  },
  phase: Phase,
  request: NetworkRequest.NetworkRequest,
  response: Option.Option<NetworkResponse.NetworkResponse>,
  challenge?: Network.AuthChallenge
) => {
  const navigable = navigableOf(state, params.context)
  const where = navigable === undefined ? undefined : placement(navigable)
  const wanted = [...state.intercepts.values()].some((intercept) =>
    (params.intercepts ?? []).includes(intercept.bidi) && intercept.phases.includes(phase) &&
    (where === undefined
      ? intercept.scope._tag === "Browser"
      : Declarations.covers(intercept.scope, where)) &&
    (intercept.globs.length === 0 || intercept.globs.some((glob) => glob.test(params.request.url)))
  )
  if (!wanted) {
    state.buffer.later(continued(state, phase, params.request.request))
    return
  }
  const obligation = state.ids.obligation()
  state.obligations.set(obligation, {
    _tag: "PausedRequest",
    id: obligation,
    request: params.request.request,
    phase,
    headers: params.request.headers
  })
  state.buffer.emit({
    _tag: "ObligationOpened",
    obligation,
    subject: {
      _tag: "PausedRequest",
      request,
      phase,
      response,
      challenge: challenge === undefined
        ? Option.none()
        : Option.some({ origin: originOf(params.request.url), scheme: challenge.scheme, realm: challenge.realm })
    }
  })
}

/** The first challenge's scheme and realm, as BiDi normally reports them. */
export const websiteChallenge = (header: string): Network.AuthChallenge | undefined => {
  const first = /^[ \t]*([!#$%&'*+.^_`|~0-9A-Za-z-]+)(?:[ \t]+|$)/.exec(header)
  if (first === null) return undefined
  const parameter =
    /[ \t]*([!#$%&'*+.^_`|~0-9A-Za-z-]+)[ \t]*=[ \t]*(?:"((?:[^"\\]|\\.)*)"|([!#$%&'*+.^_`|~0-9A-Za-z-]+))[ \t]*(?:,|$)/y
  parameter.lastIndex = first[0].length
  let realm = ""
  let value: RegExpExecArray | null
  while ((value = parameter.exec(header)) !== null) {
    if (value[1]!.toLowerCase() === "realm") realm = value[2]?.replace(/\\(.)/g, "$1") ?? value[3] ?? ""
  }
  return { scheme: first[1]!, realm }
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Network.authRequired, (params, { state }) => {
      const request = state.requests.get(params.request.request)
      if (request === undefined || !params.isBlocked) return
      const context = state.contextsByBidi.get(params.userContext ?? "") ?? navigableOf(state, params.context)?.context
      const proxyHeader = params.response.headers.find((header) => header.name.toLowerCase() === "proxy-authenticate")
      const website = params.response.headers.find((header) => header.name.toLowerCase() === "www-authenticate")
      // An origin can add Proxy-Authenticate to its own response. Never answer its website challenge
      // with the proxy's credentials, even when Firefox retains a stale 407 or proxy challenge metadata.
      if (proxyHeader !== undefined && website === undefined && context?.proxy?.credentials !== undefined) {
        const attempted = context.proxyAttempts?.has(params.request.request) === true
        context.proxyAttempts ??= new Set()
        context.proxyAttempts.add(params.request.request)
        state.buffer.later(state.send(Network.continueWithAuth({
          request: params.request.request,
          ...(attempted
            ? { action: "cancel" as const }
            : {
              action: "provideCredentials" as const,
              credentials: { type: "password" as const, ...context.proxy.credentials }
            })
        })))
        return
      }
      // Firefox can retain a proxy's 407 and omit authChallenges when the origin then sends a 401.
      // The current WWW-Authenticate header still supplies the website's challenge.
      const challenge = context?.proxy?.credentials !== undefined && website !== undefined
        ? websiteChallenge(bytesText(website.value))
        : params.response.authChallenges?.[0]
      pause(state, params, "auth", requestSnapshot(params, request), Option.none(), challenge)
    })
    .on(BrowsingContext.userPromptOpened, (params, { state }) => {
      const navigable = navigableOf(state, params.context)
      if (navigable === undefined) return
      const prompt = state.ids.prompt()
      const obligation = state.ids.obligation()
      state.obligations.set(obligation, { _tag: "Prompt", id: obligation, prompt, context: params.context })
      state.buffer.emit({
        _tag: "ObligationOpened",
        obligation,
        subject: {
          _tag: "Prompt",
          prompt,
          page: navigable.page.id,
          kind: params.type === "beforeunload"
            ? "beforeunload"
            : params.type === "alert"
            ? "alert"
            : params.type === "confirm"
            ? "confirm"
            : "prompt",
          message: params.message,
          defaultValue: params.defaultValue ?? ""
        }
      })
    })
    .on(BrowsingContext.userPromptClosed, (params, { state }) => {
      for (const [id, obligation] of state.obligations) {
        if (obligation._tag !== "Prompt" || obligation.context !== params.context) continue
        state.obligations.delete(id)
        state.buffer.emit({
          _tag: "PromptClosed",
          prompt: obligation.prompt,
          accepted: params.accepted,
          userText: Option.fromUndefinedOr(params.userText)
        })
        state.buffer.emit({
          _tag: "ObligationEnded",
          obligation: id,
          reason: "resolved",
          evidence: "bidi:browsingContext.userPromptClosed"
        })
        return
      }
    })
    .on(Input.fileDialogOpened, (params, { state }) => {
      const navigable = navigableOf(state, params.context)
      if (navigable === undefined) return
      const obligation = state.ids.obligation()
      const element = params.element?.sharedId
      state.obligations.set(obligation, { _tag: "FileChooser", id: obligation, context: params.context, element })
      state.buffer.emit({
        _tag: "ObligationOpened",
        obligation,
        subject: {
          _tag: "FileChooser",
          navigable: navigable.id,
          multiple: params.multiple,
          element: element === undefined || navigable.document === undefined
            ? Option.none()
            : Option.some({ document: navigable.document.id, binding: element })
        }
      })
    })

// ── Operations ────────────────────────────────────────────────────────────────────────────────────────────

const obligationOf = (state: State, id: Adapter.ObligationId) =>
  Kit.lookup(state.ids, state.obligations, id, () => Kit.ended({ _tag: "Obligation", id }))

const refused = (method: string) =>
  Effect.fail(new Protocol.ProtocolError({ reason: new Protocol.Unsupported({ method }) }))

/** The command a decision on a paused request sends. */
const decide = (
  state: State,
  obligation: Extract<ObligationEntry, { _tag: "PausedRequest" }>,
  decision: Adapter.Decision
): Effect.Effect<unknown, Protocol.ProtocolError> => {
  const request = obligation.request
  switch (decision._tag) {
    case "Continue": {
      const overrides = Option.getOrUndefined(decision.overrides)
      if (obligation.phase === "response") {
        return state.send(Network.continueResponse({
          request,
          ...(overrides?.headers === undefined ? {} : { headers: bidiHeaders(overrides.headers) })
        }))
      }
      // Firefox aborts a request continued with a new URL
      if (overrides?.url !== undefined) return refused("interception.continueUrl")
      // Firefox keeps the old Content-Length with a new body, which breaks the request
      const headers = overrides?.body === undefined
        ? overrides?.headers === undefined ? undefined : bidiHeaders(overrides.headers)
        : [
          ...(overrides.headers === undefined ? obligation.headers : bidiHeaders(overrides.headers)).filter((
            header
          ) => header.name.toLowerCase() !== "content-length"),
          { name: "content-length", value: { type: "string", value: String(overrides.body.length) } } as const
        ]
      return state.send(Network.continueRequest({
        request,
        ...(overrides?.method === undefined ? {} : { method: overrides.method }),
        ...(headers === undefined ? {} : { headers }),
        ...(overrides?.body === undefined ? {} : { body: { type: "base64", value: Kit.encodeBase64(overrides.body) } })
      }))
    }
    case "ContinueResponse":
      return state.send(Network.continueResponse({
        request,
        ...(Option.isSome(decision.status) ? { statusCode: decision.status.value } : {}),
        ...(Option.isSome(decision.headers) ? { headers: bidiHeaders(decision.headers.value) } : {})
      }))
    case "Fulfill": {
      // Firefox has no fulfill at the response phase, and leaves a refused one paused
      if (obligation.phase === "response") return refused("interception.responseFulfill")
      // Firefox reports what a route made as an ordinary response
      const entry = state.requests.get(obligation.request)
      if (entry !== undefined) entry.fulfilled = true
      return state.send(Network.provideResponse({
        request,
        statusCode: decision.status,
        headers: bidiHeaders(decision.headers),
        body: { type: "base64", value: Kit.encodeBase64(decision.body) }
      }))
    }
    case "Fail":
      // WebDriver BiDi has one failure for every reason
      return decision.error === "failed"
        ? state.send(Network.failRequest({ request }))
        : refused("interception.abortReason")
    case "ProvideCredentials":
      return state.send(Network.continueWithAuth({
        request,
        action: "provideCredentials",
        credentials: { type: "password", username: decision.username, password: Redacted.make(decision.password) }
      }))
    case "DefaultAuth":
    case "CancelAuth":
      return state.send(Network.continueWithAuth({
        request,
        action: decision._tag === "DefaultAuth" ? "default" : "cancel"
      }))
    default:
      return refused(`resolve ${decision._tag}`)
  }
}

export const resolve = Effect.fnUntraced(function*(state: State, id: Adapter.ObligationId, decision: Adapter.Decision) {
  const obligation = yield* obligationOf(state, id)
  switch (obligation._tag) {
    case "PausedRequest": {
      yield* Kit.protocol(decide(state, obligation, decision))
      state.obligations.delete(id)
      // A request's collected body is kept until it is given up
      for (const collector of state.requestCollectors.values()) {
        state.buffer.start(
          state.send(Network.disownData({ dataType: "request", collector, request: obligation.request }))
        )
      }
      yield* state.buffer.run(() =>
        state.buffer.emit({ _tag: "ObligationEnded", obligation: id, reason: "resolved", evidence: "bidi:network" })
      )
      return
    }
    case "Prompt": {
      if (decision._tag !== "Accept" && decision._tag !== "Dismiss") {
        return yield* Effect.fail(Kit.unsupported(decision._tag, "A prompt is accepted or dismissed"))
      }
      yield* Kit.protocol(state.send(BrowsingContext.handleUserPrompt({
        context: obligation.context,
        accept: decision._tag === "Accept",
        ...(decision._tag === "Accept" && Option.isSome(decision.promptText)
          ? { userText: decision.promptText.value }
          : {})
      })))
      return
    }
    case "FileChooser": {
      state.obligations.delete(id)
      if (decision._tag === "SetFiles" && obligation.element !== undefined) {
        yield* Kit.protocol(state.send(Input.setFiles({
          context: obligation.context,
          element: { sharedId: obligation.element },
          files: [...decision.files]
        })))
      }
      yield* state.buffer.run(() =>
        state.buffer.emit({
          _tag: "ObligationEnded",
          obligation: id,
          reason: "resolved",
          evidence: "bidi:input.setFiles"
        })
      )
      return
    }
  }
})

export const pausedRequestBody = Effect.fnUntraced(function*(state: State, id: Adapter.ObligationId) {
  const obligation = yield* obligationOf(state, id)
  if (obligation._tag !== "PausedRequest") return yield* Effect.fail(Kit.foreign(id))
  const data = yield* state.send(Network.getData({ dataType: "request", request: obligation.request })).pipe(
    Effect.map((result) => Option.some(result.bytes)),
    // A request without a body has no data to give
    Effect.catchIf(
      (error) =>
        error.reason._tag === "Rejected" &&
        /(no such|unavailable) network data|network data .* not found/i.test(error.message),
      () => Effect.succeedNone
    ),
    Effect.mapError(Kit.protocolError)
  )
  return Option.isNone(data) ? Option.none<Uint8Array>() : Option.some(yield* bytesOf(data.value, "network.getData"))
})

export const pausedResponseBody = (_state: State, _id: Adapter.ObligationId) =>
  Effect.fail(
    Kit.unsupported("interception.responseBody", "WebDriver BiDi has no body for a response paused as it starts")
  )
