import * as ByteSize from "effect/ByteSize"
import * as Context from "effect/Context"
import type * as Duration from "effect/Duration"
import * as Exit from "effect/Exit"
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage"
import * as UrlParams from "effect/http/UrlParams"
import * as Inspectable from "effect/Inspectable"
import * as Redactable from "effect/Redactable"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Reason from "../Reason.ts"
import * as Subscription from "../Subscription.ts"
import type * as Url from "../Url.ts"
import * as Access from "./access.ts"
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
import * as Filter from "effect/Filter"
import type * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Deadline from "../Deadline.ts"
import * as NetworkRequest from "../NetworkRequest.ts"
import type * as NetworkResponse from "../NetworkResponse.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import * as Operation from "./operation.ts"
import * as Timing from "./requestTiming.ts"

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
  grant: Option.Option<Access.Grant>,
  decoder: NetworkRequest.BodyDecoder<unknown, unknown, unknown>,
  context: Context.Context<unknown>,
  limit: number,
  budget: Duration.Duration
): Events.Delivery<NetworkRequest.NetworkRequest, NetworkRequest.CapturedRequest<unknown>, unknown> => ({
  deliver: Effect.fnUntraced(function*(request) {
    yield* Access.check(grant)
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
  }, (self) =>
    Effect.flatMap(Operation.record, (record) =>
      record.bound(
        self,
        () => Option.some("The request body could not be collected and decoded before the deadline"),
        "resolving"
      )), Operation.apart("NetworkRequest.body", budget)),
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
  return runtime.model.adapter.declare(scope, {
    _tag: "BodyCollection",
    bodies: ["request"],
    maxBytes: limit,
    decodedRequestBytes: true
  }).pipe(
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

/** A body subscription cannot outlive the borrowed access that allowed collecting it. */
const withGrant = Effect.fnUntraced(
  function*<A, E, R>(found: ReturnType<typeof Handles.target>, self: Effect.Effect<A, E, R>) {
    const grant = found.behind.grant
    yield* Access.check(grant)
    if (Option.isNone(grant)) return yield* self
    const lifetime = yield* Scope.fork(yield* Effect.scope)
    const close = Scope.close(lifetime, Exit.void)
    const result = yield* self.pipe(Scope.provide(lifetime), Effect.onError(() => close))
    // Register after acquisition: release during acquisition closes everything once its native resources exist.
    yield* grant.value.onRelease(close)
    yield* Access.check(grant)
    return result
  }
)

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
      withGrant(
        found,
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
            delivery(found.behind.runtime, found.behind.grant, decoder, context, limit, budget)
          )
        })
      )
  ).pipe(Operation.named("NetworkRequest.next"))
}

export const stream = (target: Target, filter?: BodyFilter, where?: Subscription.Where<any, unknown, unknown>) => {
  if (filter?.body === undefined) return plain.stream(target, filter, where)
  const decoder = filter.body
  return Effect.flatMap(
    prepare(target, filter, "NetworkRequest.stream"),
    ({ found, channel, accepts }) =>
      withGrant(
        found,
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
            delivery(found.behind.runtime, found.behind.grant, decoder, context, limit, budget)
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
      )
  ).pipe(Operation.named("NetworkRequest.stream"))
}

/** An immediate read of existing terminal facts, valid only while the original owner remains observable. */
export const timing = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest.NetworkRequest
): Effect.Effect<NetworkRequest.Timing, NetworkRequest.RequestError> => {
  const owner = Handles.target(target)
  return Effect.gen(function*() {
    const { model } = owner.behind.runtime
    const unavailable = (why: NetworkRequest.RequestUnavailable["why"]) =>
      Effect.fail(
        new NetworkRequest.RequestError({
          hop: request.hop,
          reason: new NetworkRequest.RequestUnavailable({ why }),
          diagnostics: Operation.diagnosticsNow()
        })
      )
    const found = model.hop(request.hop)
    if (Option.isNone(found) || found.value.request !== request) return yield* unavailable("notRetained")
    const hop = found.value
    return yield* Effect.suspend(() => {
      // Validate ownership at the read, even when phase data was retained before the owner ended.
      if (Option.getOrUndefined(model.hop(request.hop)) !== hop) return unavailable("notRetained")
      if (
        owner._tag === "Page"
          ? Option.getOrUndefined(hop.page) !== owner.behind.entry
          : Option.getOrUndefined(hop.context) !== owner.behind.entry
      ) return unavailable("foreignTarget")
      if (
        Deferred.isDoneUnsafe(model.lost) || Deferred.isDoneUnsafe(owner.behind.entry.closed) ||
        Option.exists(hop.page, (page) => Deferred.isDoneUnsafe(page.closed)) ||
        Option.exists(hop.context, (context) => Deferred.isDoneUnsafe(context.closed))
      ) return unavailable("ownerLost")
      const initiator = request.initiator
      if (initiator._tag === "Document") {
        const page = Option.getOrUndefined(hop.page)
        if (
          page === undefined || (page.id !== initiator.navigable &&
            !page.state.getUnsafe().frames.some((frame) => frame.id === initiator.navigable))
        ) return unavailable("ownerLost")
      } else if (initiator._tag === "Worker") {
        const workers = Option.isSome(hop.context)
          ? hop.context.value.state.getUnsafe().workers
          : Option.isSome(hop.page)
          ? hop.page.value.state.getUnsafe().workers
          : []
        if (!workers.some((worker) => worker.realm === initiator.realm && !Deferred.isDoneUnsafe(worker.closed))) {
          return unavailable("ownerLost")
        }
      }
      const context = Option.getOrUndefined(hop.context)
      if (context?.timings === undefined) return unavailable("timingNotEnabled")
      return Effect.succeed(context.timings.get(request.hop) ?? Timing.empty())
    })
  }).pipe(Operation.named("NetworkRequest.timing", {
    attributes: {
      "browser.hop.id": request.hop,
      [owner._tag === "Page" ? "browser.page.id" : "browser.context.id"]: owner.behind.entry.id
    }
  }))
}

/** Opt-in retention of one existing hop; no model or adapter work is installed. */
export const response = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  request: NetworkRequest.NetworkRequest
): Effect.Effect<
  Effect.Effect<Option.Option<NetworkResponse.NetworkResponse>, NetworkRequest.RequestError | Deadline.Timeout>,
  NetworkRequest.RequestError,
  Scope.Scope
> =>
  Effect.gen(function*() {
    const found = Handles.target(target)
    const unavailable = (why: NetworkRequest.ResponseUnavailable["why"]) =>
      new NetworkRequest.RequestError({
        hop: request.hop,
        reason: new NetworkRequest.ResponseUnavailable({ why }),
        diagnostics: Operation.diagnosticsNow()
      })
    const retained = found.behind.runtime.model.hop(request.hop)
    if (Option.isNone(retained)) return yield* Effect.fail(unavailable("evicted"))
    const owner: Option.Option<Model.PageEntry | Model.ContextEntry> = found._tag === "Page"
      ? retained.value.page
      : retained.value.context
    if (Option.isNone(owner) || owner.value !== found.behind.entry) {
      return yield* Effect.fail(unavailable("foreignTarget"))
    }
    const targetClosed = found.behind.entry.closed
    let held: Model.HopEntry | undefined = retained.value
    const released = Deferred.makeUnsafe<void>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        held = undefined
        Deferred.doneUnsafe(released, Effect.void)
      })
    )
    return Effect.gen(function*() {
      const hop = held
      if (hop === undefined) return yield* Effect.fail(unavailable("released"))
      const existing = (yield* hop.state.get).response
      if (Option.isSome(existing)) return existing
      const record = yield* Operation.record
      const ended = Effect.flatMap(Deferred.await(hop.end), (end) =>
        Effect.flatMap(hop.state.get, (state) =>
          Option.isSome(state.response) ?
            Effect.succeed(state.response)
            : end._tag === "Failed" && end.connectionLost === true ?
            Effect.fail(unavailable("targetClosed"))
            : end._tag === "Forgotten" ?
            Effect.fail(unavailable("evicted"))
            : Effect.succeed(Option.none<NetworkResponse.NetworkResponse>())))
      const arrived = hop.state.changes.pipe(
        Stream.filterMap(Filter.fromPredicateOption((state: Model.HopState) =>
          state.response
        )),
        Stream.runHead
      )
      const closed = Deferred.await(targetClosed).pipe(
        Effect.andThen(Effect.suspend(() =>
          Deferred.isDoneUnsafe(hop.end) ? ended : Effect.fail(unavailable("targetClosed"))
        ))
      )
      const release = Deferred.await(released).pipe(Effect.andThen(Effect.fail(unavailable("released"))))
      return yield* record.bound(
        Effect.raceFirst(Effect.raceFirst(arrived, ended), Effect.raceFirst(closed, release)),
        () => Option.some("The request had not received a response by the deadline"),
        "waitingForEvent"
      )
    }).pipe(Operation.named("NetworkRequest.response", { attributes: { "browser.hop.id": request.hop } }))
  }).pipe(Operation.named("NetworkRequest.response.acquire", { attributes: { "browser.hop.id": request.hop } }))
