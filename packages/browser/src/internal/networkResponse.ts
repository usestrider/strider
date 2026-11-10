/**
 * The responses a page or a context receives (`NetworkResponse`): which entries a filter takes, and, when the
 * subscription names a body decoder, collecting each body and decoding it as the response is delivered.
 */
import * as ByteSize from "effect/ByteSize"
import type * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import type * as Headers from "effect/http/Headers"
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage"
import * as UrlParams from "effect/http/UrlParams"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import * as Redactable from "effect/Redactable"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Deadline from "../Deadline.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import type * as NetworkRequest from "../NetworkRequest.ts"
import * as NetworkResponse from "../NetworkResponse.ts"
import type * as Page from "../Page.ts"
import * as Reason from "../Reason.ts"
import * as Subscription from "../Subscription.ts"
import type * as Url from "../Url.ts"
import type * as UserContext from "../UserContext.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as EventModule from "./eventModule.ts"
import * as Events from "./events.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Redaction from "./redaction.ts"
import type * as Runtime from "./runtime.ts"

type Target = Page.ObservedPage | UserContext.ObservedUserContext

type AnyFilter = NetworkResponse.Filter & {
  readonly body?: NetworkResponse.BodyDecoder<unknown, unknown, unknown> | undefined
}

const subscription = (target: Target, filter: AnyFilter | undefined, operation: string) =>
  Effect.suspend(() => {
    const found = Handles.target(target)
    const method = Filters.among<string>(filter?.method)
    const status = filter?.status
    const statusMatches = (code: NetworkResponse.StatusCode) =>
      status === undefined ? true : typeof status === "function" ? status(code) : code === status
    return Effect.map(Filters.url(operation, filter?.url), (matches) => ({
      found,
      channel: found.behind.entry.events.response,
      accepts: (entry: Events.Entry<Model.ResponseEvent>) =>
        Filters.urlMatches(matches, entry.value.response.url) && method(entry.value.hop.request.method) &&
        statusMatches(entry.value.response.status)
    }))
  })

const deliverResponse = (event: Model.ResponseEvent): NetworkResponse.NetworkResponse => event.response

const kind = (operation: string): Events.Kind<Model.ResponseEvent, NetworkResponse.NetworkResponse> => ({
  operation,
  noun: "a response",
  deliver: deliverResponse
})

/** The subscriptions that deliver the response as it is; `next` and `stream` that decode a body are below. */
const plain = EventModule.make<Target, AnyFilter, Model.ResponseEvent, NetworkResponse.NetworkResponse>({
  name: "NetworkResponse",
  noun: "a response",
  prepare: (target, filter, operation) =>
    Effect.map(subscription(target, filter, operation), ({ accepts, channel }) => ({
      channel,
      accepts,
      deliver: deliverResponse
    }))
})

export const history = plain.history

const responseError = (url: Url.Url, reason: NetworkResponse.ResponseErrorReason) =>
  new NetworkResponse.ResponseError({ url, reason, diagnostics: Operation.diagnosticsNow() })

const unavailable = (url: Url.Url, why: NetworkResponse.BodyUnavailable["why"], hint: string) =>
  responseError(url, new NetworkResponse.BodyUnavailable({ why, hint }))

const charset = (headers: Headers.Headers) => {
  const match = /charset=([^;]+)/i.exec(headers["content-type"] ?? "")
  try {
    return new TextDecoder(match?.[1]?.trim() ?? "utf-8")
  } catch {
    return new TextDecoder("utf-8")
  }
}

/** A response with its body collected: the response's fields, an `HttpIncomingMessage` over its bytes, and `body`. */
class Captured<B> extends Inspectable.Class
  implements NetworkResponse.CapturedResponse<B>, HttpIncomingMessage.HttpIncomingMessage<NetworkResponse.ResponseError>
{
  readonly [HttpIncomingMessage.TypeId] = HttpIncomingMessage.TypeId
  readonly hop: NetworkRequest.HopId
  readonly url: Url.Url
  readonly status: NetworkResponse.StatusCode
  readonly statusText: string
  readonly httpVersion: Option.Option<string>
  readonly headers: Headers.Headers
  readonly servedBy: NetworkResponse.ServedBy
  readonly at: MonotonicInstant.MonotonicInstant
  readonly remoteAddress = Option.none<string>()
  readonly text: Effect.Effect<string>
  readonly json: HttpIncomingMessage.HttpIncomingMessage<NetworkResponse.ResponseError>["json"]
  readonly urlParamsBody: HttpIncomingMessage.HttpIncomingMessage<NetworkResponse.ResponseError>["urlParamsBody"]
  readonly arrayBuffer: Effect.Effect<ArrayBuffer>
  readonly stream: Stream.Stream<Uint8Array>
  readonly body: B

  constructor(response: NetworkResponse.NetworkResponse, bytes: Uint8Array, body: B) {
    super()
    this.body = body
    this.hop = response.hop
    this.url = response.url
    this.status = response.status
    this.statusText = response.statusText
    this.httpVersion = response.httpVersion
    this.headers = response.headers
    this.servedBy = response.servedBy
    this.at = response.at
    const text = Effect.sync(() => charset(response.headers).decode(bytes))
    this.text = text
    this.json = Effect.flatMap(text, (text) =>
      Effect.try({
        try: () => JSON.parse(text),
        catch: (error) =>
          responseError(
            response.url,
            new NetworkResponse.MalformedBody({ expected: "json", hint: `The body isn't JSON: ${String(error)}` })
          )
      }))
    this.urlParamsBody = Effect.map(text, (text) => UrlParams.fromInput(new URLSearchParams(text)))
    this.arrayBuffer = Effect.sync(() => bytes.slice().buffer)
    this.stream = Stream.succeed(bytes)
  }

  [Redactable.symbolRedactable](context: Context.Context<never>): unknown {
    return Redaction.withUrl("NetworkResponse", this, context)
  }

  override toString(): string {
    return `CapturedResponse(${this.url})`
  }

  toJSON(): unknown {
    return HttpIncomingMessage.inspect(this, { _id: "CapturedResponse", url: this.url, status: this.status })
  }
}

/**
 * Delivers a response with its body: once its hop ends, the bytes, then the decoder, with the requirements
 * captured when it subscribed. `wait` bounds the wait for the hop's end, when it is given.
 */
const delivery = <B, DE, DR>(
  runtime: Runtime.Runtime,
  decoder: NetworkResponse.BodyDecoder<B, DE, DR>,
  context: Context.Context<DR>,
  limit: number,
  wait: Option.Option<Duration.Duration>
): Events.Delivery<Model.ResponseEvent, NetworkResponse.CapturedResponse<B>, DE | NetworkResponse.ResponseError> => ({
  deliver: Effect.fnUntraced(function*({ hop, response }) {
    const url = response.url
    if (response.status >= 300 && response.status < 400 && response.headers["location"] !== undefined) {
      return yield* Effect.fail(unavailable(url, "redirect", "A redirect hop has no body; its next hop has one"))
    }
    // A stream of server-sent events never finishes, so neither does its body (QUIRKS.md, Q40)
    if (/^text\/event-stream\b/i.test(response.headers["content-type"] ?? "")) {
      return yield* Effect.fail(
        unavailable(url, "streaming", "The response is a stream of server-sent events, which never finishes")
      )
    }
    const ended = yield* Option.match(wait, {
      onNone: () => Effect.map(Deferred.await(hop.end), Option.some),
      // On the browser's clock, which TestClock doesn't move (QUIRKS.md, Q235)
      onSome: (duration) => Deferred.await(hop.end).pipe(BrowserClock.timeoutOption(Duration.toMillis(duration)))
    })
    if (Option.isNone(ended)) {
      return yield* Effect.fail(unavailable(
        url,
        "streaming",
        `The response didn't finish loading within ${Duration.format(Option.getOrThrow(wait))}, as a stream doesn't`
      ))
    }
    const end = ended.value
    if (end._tag === "Failed") {
      return yield* Effect.fail(
        unavailable(url, "failed", `The request failed after its response started: ${end.error}`)
      )
    }
    if (end._tag === "Forgotten") {
      return yield* Effect.fail(unavailable(url, "evicted", "Too many requests were in flight to keep this one"))
    }
    if (end.encodedBytes > limit) {
      return yield* Effect.fail(
        unavailable(url, "overLimit", `The body is ${end.encodedBytes} bytes, over BodyLimit's ${limit}`)
      )
    }
    const bytes = yield* runtime.model.adapter.responseBody(response.hop).pipe(
      Effect.mapError((error) =>
        Deadline.isTimeout(error)
          ? unavailable(url, "streaming", "The browser didn't hand the body over before the deadline")
          // The browser followed it, whatever its headers say: the backend keeps only the last hop's body
          : error.reason._tag === "Unsupported" && error.reason.capability === "body.redirect"
          ? unavailable(url, "redirect", "A redirect hop has no body; its next hop has one")
          : error.reason._tag === "Unsupported" && error.reason.capability === "network.responseBody.terminalRedirect"
          ? responseError(url, new Reason.Unsupported({ ...error.reason, backend: runtime.backend }))
          : unavailable(url, "evicted", `The browser no longer has it: ${error.message}`)
      )
    )
    const message = new Captured(response, bytes, undefined)
    const body = yield* Effect.provideContext(decoder(message), context)
    return new Captured(response, bytes, body)
  }),
  unfinished: ({ response }) => `A response from ${response.url} matched, but its body hadn't finished loading`
})

/** Declares body collection for the target in the caller's scope, before the subscription returns. */
const collect = (
  found: ReturnType<typeof Handles.target>,
  operation: string,
  limit: number
): Effect.Effect<void, Subscription.SubscriptionError | Deadline.Timeout, Scope.Scope> => {
  const { runtime, entry } = found.behind
  const scope: Adapter.DeclarationScope = found._tag === "Page"
    ? { _tag: "Page", page: (entry as Model.PageEntry).id }
    : { _tag: "UserContext", context: (entry as Model.ContextEntry).id }
  return runtime.model.adapter.declare(scope, { _tag: "BodyCollection", bodies: ["response"], maxBytes: limit }).pipe(
    Effect.asVoid,
    Effect.mapError((error) => {
      const id = Operation.idNow()
      const mapped = Operation.fromAdapter(error, id, runtime.backend)
      return mapped._tag === "Timeout" ? mapped.error : new Subscription.SubscriptionError({
        operation,
        reason: mapped._tag === "Gone"
          ? new Reason.BackendFailure({
            kind: "Rejected",
            method: "BodyCollection",
            hint: mapped.error.message
          })
          : mapped.reason,
        diagnostics: Operation.diagnostics(id)
      })
    })
  )
}

export const next = (
  target: Target,
  filter: AnyFilter,
  where?: Subscription.Where<any, unknown, unknown>
) => {
  const decoder = filter.body
  if (decoder === undefined) return plain.next(target, filter, where)
  return Effect.flatMap(
    subscription(target, filter, "NetworkResponse.next"),
    ({ accepts, channel, found }) =>
      Effect.gen(function*() {
        const limit = ByteSize.toNumberUnsafe(yield* NetworkResponse.BodyLimit)
        yield* collect(found, "NetworkResponse.next", limit)
        const context = yield* Effect.context<unknown>()
        return yield* Events.next(
          kind("NetworkResponse.next") as unknown as Events.Kind<
            Model.ResponseEvent,
            NetworkResponse.CapturedResponse<unknown>
          >,
          channel,
          accepts,
          where,
          delivery(found.behind.runtime, decoder, context, limit, Option.none())
        )
      })
  ).pipe(Operation.named("NetworkResponse.next"))
}

export const stream = (
  target: Target,
  filter?: AnyFilter,
  where?: Subscription.Where<any, unknown, unknown>
) => {
  const decoder = filter?.body
  if (decoder === undefined) return plain.stream(target, filter, where)
  return Effect.flatMap(
    subscription(target, filter, "NetworkResponse.stream"),
    ({ accepts, channel, found }) =>
      Effect.gen(function*() {
        const limit = ByteSize.toNumberUnsafe(yield* NetworkResponse.BodyLimit)
        const budget = yield* Deadline.DefaultBudget
        yield* collect(found, "NetworkResponse.stream", limit)
        const context = yield* Effect.context<unknown>()
        return yield* Events.stream(
          kind("NetworkResponse.stream") as unknown as Events.Kind<
            Model.ResponseEvent,
            NetworkResponse.CapturedResponse<unknown>
          >,
          channel,
          accepts,
          where,
          delivery(found.behind.runtime, decoder, context, limit, Option.some(budget))
        )
      })
  )
}
