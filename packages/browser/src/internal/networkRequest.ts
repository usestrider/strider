import * as ByteSize from "effect/ByteSize"
import * as Context from "effect/Context"
import type * as Duration from "effect/Duration"
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage"
import * as UrlParams from "effect/http/UrlParams"
import * as Inspectable from "effect/Inspectable"
import * as Redactable from "effect/Redactable"
import * as Stream from "effect/Stream"
import * as Reason from "../Reason.ts"
import * as Subscription from "../Subscription.ts"
import type * as Url from "../Url.ts"
import type * as Adapter from "./adapter.ts"
import * as Events from "./events.ts"
import type * as Model from "./model.ts"
import * as Redaction from "./redaction.ts"
import type * as Runtime from "./runtime.ts"
/**
 * The requests a page or a context makes (`NetworkRequest`): which entries a filter takes, and the headers the
 * browser sent.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Deadline from "../Deadline.ts"
import * as NetworkRequest from "../NetworkRequest.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import * as Operation from "./operation.ts"

const plain = EventModule.make<
  Page.ObservedPage | UserContext.ObservedUserContext,
  NetworkRequest.Filter,
  NetworkRequest.NetworkRequest,
  NetworkRequest.NetworkRequest
>({
  name: "NetworkRequest",
  noun: "a request",
  prepare: (target, filter, operation) => {
    const channel = Handles.target(target).behind.entry.events.request
    const method = Filters.among<string>(filter?.method)
    const resourceType = Filters.among(filter?.resourceType)
    return Effect.map(Filters.url(operation, filter?.url), (matches) => ({
      channel,
      accepts: (entry) =>
        Filters.urlMatches(matches, entry.value.url) && method(entry.value.method) &&
        resourceType(entry.value.resourceType),
      deliver: (request) => request
    }))
  }
})

/** The headers the browser sent for a request, once it has said which. */
export const headersSent = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest.NetworkRequest
): Effect.Effect<Headers.Headers, Deadline.Timeout> =>
  Effect.gen(function*() {
    const { runtime } = Handles.target(target as Page.Page | UserContext.UserContext).behind
    const hop = runtime.model.hop(request.hop)
    if (Option.isNone(hop)) return request.headers
    const record = yield* Operation.record
    yield* record.bound(
      Deferred.await(hop.value.sentKnown),
      () => Option.some("The browser hadn't said which headers it sent by the deadline"),
      "waitingForEvent"
    )
    return Option.getOrElse((yield* hop.value.state.get).sent, () => request.headers)
  }).pipe(Operation.named("NetworkRequest.headersSent", { attributes: { "browser.hop.id": request.hop } }))

export const history = plain.history

type Target = Page.ObservedPage | UserContext.ObservedUserContext

type BodyFilter = NetworkRequest.Filter & {
  readonly body?: NetworkRequest.BodyDecoder<unknown, unknown, unknown> | undefined
}

const requestError = (request: NetworkRequest.NetworkRequest, reason: NetworkRequest.RequestErrorReason) =>
  new NetworkRequest.RequestError({
    hop: request.hop,
    url: request.url,
    reason,
    diagnostics: Operation.diagnosticsNow()
  })

/** Owned decoder input. Native WebKit text is never presented as original bytes. */
class Message extends Inspectable.Class
  implements HttpIncomingMessage.HttpIncomingMessage<NetworkRequest.RequestError>
{
  readonly [HttpIncomingMessage.TypeId] = HttpIncomingMessage.TypeId
  readonly remoteAddress = Option.none<string>()
  readonly headers: Headers.Headers
  readonly text: Effect.Effect<string>
  readonly json: HttpIncomingMessage.HttpIncomingMessage<NetworkRequest.RequestError>["json"]
  readonly urlParamsBody: Effect.Effect<UrlParams.UrlParams>
  readonly arrayBuffer: Effect.Effect<ArrayBuffer, NetworkRequest.RequestError>
  readonly stream: Stream.Stream<Uint8Array, NetworkRequest.RequestError>

  constructor(
    request: NetworkRequest.NetworkRequest,
    body: Extract<Adapter.RequestBody, { _tag: "Bytes" | "ReportedText" }>
  ) {
    super()
    this.headers = request.headers
    const bytes = body._tag === "Bytes" ? body.bytes.slice() : undefined
    const unavailable = requestError(
      request,
      new NetworkRequest.BodyUnavailable({
        why: "unsupportedRepresentation",
        hint: "The browser reports text, not the original request bytes"
      })
    )
    this.arrayBuffer = bytes === undefined ? Effect.fail(unavailable) : Effect.sync(() => bytes.slice().buffer)
    this.stream = bytes === undefined ? Stream.fail(unavailable) : Stream.suspend(() => Stream.succeed(bytes.slice()))
    this.text = Effect.sync(() => {
      if (body._tag === "ReportedText") return body.text
      const charset =
        /charset=([^;]+)/i.exec(request.headers["content-type"] ?? "")?.[1]?.trim().replace(/^"|"$/g, "") ?? "utf-8"
      let decoder: TextDecoder
      try {
        decoder = new TextDecoder(charset)
      } catch {
        decoder = new TextDecoder("utf-8")
      }
      return decoder.decode(bytes)
    })
    this.json = Effect.flatMap(this.text, (text) =>
      Effect.try({
        try: () => JSON.parse(text),
        catch: () =>
          requestError(
            request,
            new NetworkRequest.MalformedBody({ expected: "json", hint: "The collected body is not valid JSON" })
          )
      }))
    this.urlParamsBody = Effect.map(this.text, (text) => UrlParams.fromInput(new URLSearchParams(text)))
  }

  toJSON(): unknown {
    return { _id: "RequestBody" }
  }
}

class Captured<B> extends Inspectable.Class implements NetworkRequest.CapturedRequest<B> {
  readonly hop: NetworkRequest.HopId
  readonly method: NetworkRequest.NetworkRequest["method"]
  readonly url: NetworkRequest.NetworkRequest["url"]
  readonly headers: Headers.Headers
  readonly resourceType: NetworkRequest.ResourceType
  readonly initiator: NetworkRequest.Initiator
  readonly at: NetworkRequest.NetworkRequest["at"]
  readonly body: Option.Option<B>
  constructor(request: NetworkRequest.NetworkRequest, body: Option.Option<B>) {
    super()
    this.hop = request.hop
    this.method = request.method
    this.url = request.url
    this.headers = request.headers
    this.resourceType = request.resourceType
    this.initiator = request.initiator
    this.at = request.at
    this.body = body
  }
  toJSON(): unknown {
    return { _id: "CapturedRequest", ...new NetworkRequest.NetworkRequest(this) }
  }
  [Redactable.symbolRedactable](context: Context.Context<never>): unknown {
    return Redaction.withUrl("NetworkRequest", new NetworkRequest.NetworkRequest(this), context)
  }
}

const delivery = (
  runtime: Runtime.Runtime,
  decoder: NetworkRequest.BodyDecoder<unknown, unknown, unknown>,
  context: Context.Context<unknown>,
  limit: number,
  budget: Duration.Duration
): Events.Delivery<NetworkRequest.NetworkRequest, NetworkRequest.CapturedRequest<unknown>, unknown> => ({
  deliver: Effect.fnUntraced(function*(request) {
    const result = yield* runtime.model.adapter.captureRequestBody(request, limit).pipe(Effect.mapError((error) => {
      const mapped = Operation.fromAdapter(error, Operation.idNow(), runtime.backend)
      return mapped._tag === "Timeout"
        ? mapped.error
        : mapped._tag === "Gone"
        ? mapped.error
        : requestError(request, mapped.reason)
    }))
    if (result._tag === "Absent") return new Captured(request, Option.none())
    if (result._tag === "Unavailable") {
      return yield* Effect.fail(requestError(
        request,
        new NetworkRequest.BodyUnavailable({
          why: result.why,
          hint: "The browser cannot supply this hop's collected request body"
        })
      ))
    }
    if (result._tag === "Incomplete" || result._tag === "OverLimit") {
      return yield* Effect.fail(requestError(
        request,
        new NetworkRequest.BodyTruncated({
          why: result._tag === "Incomplete" ? "incomplete" : "overLimit",
          hint: "The request body is incomplete or exceeds the subscription's collection limit"
        })
      ))
    }
    const size = result._tag === "Bytes" ? result.bytes.length : new TextEncoder().encode(result.text).length
    if (size > limit) {
      return yield* Effect.fail(requestError(
        request,
        new NetworkRequest.BodyTruncated({
          why: "overLimit",
          hint: "The request body exceeds the subscription's collection limit"
        })
      ))
    }
    const body = yield* Effect.provideContext(decoder(new Message(request, result)), context)
    return new Captured(request, Option.some(body))
  }, Operation.apart("NetworkRequest.body", budget)),
  unfinished: () => "A request matched, but its body has not been collected and decoded"
})

/** Shares filtering with metadata subscriptions, without changing their default path. */
const prepare = (target: Target, filter: BodyFilter, operation: string) => {
  const found = Handles.target(target)
  const method = Filters.among<string>(filter.method)
  const resourceType = Filters.among(filter.resourceType)
  return Effect.map(Filters.url(operation, filter.url), (matches) => ({
    found,
    channel: found.behind.entry.events.request,
    accepts: (entry: Events.Entry<NetworkRequest.NetworkRequest>) =>
      Filters.urlMatches(matches, entry.value.url) && method(entry.value.method) &&
      resourceType(entry.value.resourceType)
  }))
}

const collect = (found: ReturnType<typeof Handles.target>, limit: number, operation: string) => {
  const { runtime, entry } = found.behind
  const scope: Adapter.DeclarationScope = found._tag === "Page"
    ? { _tag: "Page", page: (entry as Model.PageEntry).id }
    : { _tag: "UserContext", context: (entry as Model.ContextEntry).id }
  return runtime.model.adapter.declare(scope, { _tag: "BodyCollection", bodies: ["request"], maxBytes: limit }).pipe(
    Effect.asVoid,
    Effect.mapError((error) => {
      const mapped = Operation.fromAdapter(error, Operation.idNow(), runtime.backend)
      return mapped._tag === "Timeout" ? mapped.error : new Subscription.SubscriptionError({
        operation,
        reason: mapped._tag === "Gone"
          ? new Reason.BackendFailure({
            kind: "Rejected",
            method: "BodyCollection",
            hint: "The collection target closed"
          })
          : mapped.reason,
        diagnostics: Operation.diagnosticsNow()
      })
    })
  )
}

const kind = (
  operation: string
): Events.Kind<NetworkRequest.NetworkRequest, NetworkRequest.CapturedRequest<unknown>> => ({
  operation,
  noun: "a request",
  deliver: (request) => new Captured(request, Option.none())
})

export const next = (
  target: Target,
  filter: BodyFilter & { readonly url: string | Url.Pattern },
  where?: Subscription.Where<any, unknown, unknown>
) => {
  if (filter.body === undefined) return plain.next(target, filter, where)
  const decoder = filter.body
  return Effect.flatMap(
    prepare(target, filter, "NetworkRequest.next"),
    ({ found, channel, accepts }) =>
      Effect.gen(function*() {
        const limit = ByteSize.toNumberUnsafe(yield* NetworkRequest.BodyLimit)
        const budget = yield* Deadline.DefaultBudget
        yield* collect(found, limit, "NetworkRequest.next")
        const context = Context.omit(Context.Service<never, unknown>(Operation.CurrentKey), Deadline.CurrentDeadline)(
          yield* Effect.context<unknown>()
        )
        return yield* Events.next(
          kind("NetworkRequest.next"),
          channel,
          accepts,
          where,
          delivery(found.behind.runtime, decoder, context, limit, budget)
        )
      })
  ).pipe(Operation.named("NetworkRequest.next"))
}

export const stream = (target: Target, filter?: BodyFilter, where?: Subscription.Where<any, unknown, unknown>) => {
  if (filter?.body === undefined) return plain.stream(target, filter, where)
  const decoder = filter.body
  return Effect.flatMap(
    prepare(target, filter, "NetworkRequest.stream"),
    ({ found, channel, accepts }) =>
      Effect.gen(function*() {
        const limit = ByteSize.toNumberUnsafe(yield* NetworkRequest.BodyLimit)
        const budget = yield* Deadline.DefaultBudget
        yield* collect(found, limit, "NetworkRequest.stream")
        const context = Context.omit(Context.Service<never, unknown>(Operation.CurrentKey), Deadline.CurrentDeadline)(
          yield* Effect.context<unknown>()
        )
        const stream = yield* Events.stream(
          kind("NetworkRequest.stream"),
          channel,
          accepts,
          undefined,
          delivery(found.behind.runtime, decoder, context, limit, budget)
        )
        const filtered = where === undefined ?
          stream :
          stream.pipe(
            Stream.filterEffect((request) =>
              Effect.provideContext(where(request), context).pipe(Operation.apart("NetworkRequest.where", budget))
            )
          )
        // Start capture at acquisition, rather than waiting for the caller to consume the stream.
        const queue = yield* Stream.toQueue(filtered, { capacity: yield* Subscription.Capacity }).pipe(
          Operation.detached
        )
        return Stream.fromQueue(queue)
      })
  ).pipe(Operation.named("NetworkRequest.stream"))
}
