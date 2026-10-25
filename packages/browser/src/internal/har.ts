/**
 * HAR recordings (review 20, candidate 4): a page's or context's requests from the event model, one entry per
 * hop, written as HAR 1.2.
 *
 * - **What is recorded.** Each request the target's channel delivers while the recording lives, with the
 *   response its hop got and how the hop ended; a response body is read as the hop finishes, unless `content` is
 *   `omit`. A recording keeps every entry: its subscription has no bound.
 * - **Timings** come from the library's clock, so they mean the same on every backend (P2): `send` is 0, `wait`
 *   runs from the request to its response, and `receive` from the response to the hop's end. The phases no
 *   backend reports alike (`blocked`, `dns`, `connect`, `ssl`) are -1.
 * - **Redaction.** Cookie values, `Authorization` and `Proxy-Authorization`, and a URL's credentials are
 *   `REDACTED` unless the export includes their class.
 * - **Playwright's extensions**, which its trace viewer reads: `_monotonicTime`, `_resourceType`, `_frameref`,
 *   `_transferSize`, `_failureText`, `_file` and `_webSocketMessages`; and ours, `_servedBy` and `_incomplete`.
 */
import * as ByteSize from "effect/ByteSize"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as Exit from "effect/Exit"
import * as FiberSet from "effect/FiberSet"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as Har from "../Har.ts"
import type * as NetworkConnection from "../NetworkConnection.ts"
import type * as NetworkRequest from "../NetworkRequest.ts"
import * as Reason from "../Reason.ts"
import type * as Adapter from "./adapter.ts"
import * as Events from "./events.ts"
import type * as Handles from "./handles.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Recordings from "./recordings.ts"
import type * as Runtime from "./runtime.ts"

/** One hop, as recorded: its request, the model's hop, and what the recording read as it ended. */
export interface Recorded {
  readonly request: NetworkRequest.NetworkRequest
  readonly hop: Option.Option<Model.HopEntry>
  end: Option.Option<Model.HopEnd>
  body: Option.Option<Uint8Array>
  /** A WebSocket's frames, on its handshake's entry. */
  readonly frames: Array<NetworkConnection.Frame>
  /** Done once the hop has ended and its body, if any, was read. */
  readonly done: Deferred.Deferred<void>
}

/** What a recording asks for. */
export interface Settings {
  readonly content: "embed" | "attach" | "omit"
  readonly matches: (url: string) => boolean
  readonly webSocketFrames: boolean
  readonly inFlightAtStop: "wait" | "markIncomplete"
}

/** A recording's entries, as they are while it lives and as it left them when it stopped. */
export interface Recorder {
  readonly clock: Recordings.Clock
  readonly entries: ReadonlyArray<Recorded>
  readonly count: SubscriptionRef.SubscriptionRef<number>
  /** Waits, within the deadline in force, for the hops still in flight and their bodies. */
  readonly settle: Effect.Effect<void>
  /** Waits, within the deadline in force, for the bodies of the hops that have ended. */
  readonly flush: Effect.Effect<void>
}

/** Declares body collection for a page or context in the caller's scope, as a recording needs before requests. */
export const collect = (
  runtime: Runtime.Runtime,
  found: ReturnType<typeof Handles.target>,
  limit: ByteSize.ByteSize,
  id: Diagnostics.OperationId
): Effect.Effect<void, Reason.BackendFailure | Reason.Unsupported, Scope.Scope> => {
  const scope: Adapter.DeclarationScope = found._tag === "Page"
    ? { _tag: "Page", page: (found.behind.entry as Model.PageEntry).id }
    : { _tag: "UserContext", context: (found.behind.entry as Model.ContextEntry).id }
  return runtime.model.adapter.declare(scope, { _tag: "BodyCollection", maxBytes: ByteSize.toNumberUnsafe(limit) })
    .pipe(
      Effect.asVoid,
      Effect.mapError((error) => {
        const mapped = Operation.fromAdapter(error, id, runtime.backend)
        return mapped._tag === "Gone"
          ? new Reason.BackendFailure({
            kind: "Rejected",
            method: "BodyCollection",
            metadata: {},
            hint: mapped.error.message
          })
          : mapped.reason
      })
    )
}

/** Whether a response has a body to read: not a redirect, and not one of the statuses that have none. */
const hasBody = (status: number) =>
  !(status >= 300 && status < 400) && status !== 204 && status !== 205 && status !== 101

/** Starts recording a page's or context's requests for the scope: a child scope of it, which `stop` closes. */
export const start = (
  runtime: Runtime.Runtime,
  target: Model.PageEntry | Model.ContextEntry,
  settings: Settings,
  scope: Scope.Scope
): Effect.Effect<{ readonly recorder: Recorder; readonly stop: Effect.Effect<void> }> =>
  Effect.gen(function*() {
    const own = yield* Scope.fork(scope)
    const entries: Array<Recorded> = []
    const count = yield* SubscriptionRef.make(0)
    const hops = yield* FiberSet.make<void>().pipe(Scope.provide(own))
    let stopped = false
    // Bodies are read as each hop ends, while the browser still has them
    const follow = (recorded: Recorded) => Effect.ensuring(read(recorded), Deferred.done(recorded.done, Exit.void))
    const read = Effect.fnUntraced(function*(recorded: Recorded) {
      if (Option.isNone(recorded.hop)) return
      const hop = recorded.hop.value
      const end = yield* Deferred.await(hop.end)
      recorded.end = Option.some(end)
      const response = hop.response
      if (
        settings.content !== "omit" && end._tag === "Finished" && Option.isSome(response) &&
        hasBody(response.value.status)
      ) {
        recorded.body = yield* runtime.model.adapter.responseBody(recorded.request.hop).pipe(
          Effect.option
        )
      }
    })
    const queue = yield* Events.recorded(
      target.events.request,
      (entry) => settings.matches(entry.value.url)
    ).pipe(Scope.provide(own))
    yield* Effect.gen(function*() {
      while (true) {
        const entry = yield* Queue.take(queue)
        if (stopped) continue
        const recorded: Recorded = {
          request: entry.value,
          hop: runtime.model.hop(entry.value.hop),
          end: Option.none(),
          body: Option.none(),
          frames: [],
          done: Deferred.makeUnsafe<void>()
        }
        entries.push(recorded)
        // Followed before it is counted, so a wait woken by the count finds it in flight
        yield* FiberSet.run(hops, follow(recorded))
        yield* SubscriptionRef.set(count, entries.length)
      }
    }).pipe(Effect.ignore, Effect.forkIn(own))
    if (settings.webSocketFrames) {
      const connections = yield* Events.recorded(
        target.events.connection,
        (entry) => entry.value.kind === "webSocket" && settings.matches(entry.value.url)
      ).pipe(Scope.provide(own))
      yield* Effect.gen(function*() {
        while (true) {
          const connection = (yield* Queue.take(connections)).value
          // The frames go on the latest handshake to the connection's URL
          const handshake = entries.findLast((each) =>
            each.request.url === connection.url && each.request.resourceType === "webSocket"
          )
          if (handshake === undefined) continue
          const frames = yield* Events.recorded(connection.frames, () => true).pipe(Scope.provide(own))
          yield* Effect.gen(function*() {
            while (true) handshake.frames.push((yield* Queue.take(frames)).value)
          }).pipe(Effect.ignore, Effect.forkIn(own))
        }
      }).pipe(Effect.ignore, Effect.forkIn(own))
    }
    const settle = Effect.gen(function*() {
      const { at } = yield* Operation.budget
      yield* FiberSet.awaitEmpty(hops).pipe(Effect.timeoutOption(Operation.millisLeft(at)), Effect.asVoid)
    })
    // A hop that ended has its body read at once; an export waits for that, never for a hop in flight
    const flush = Effect.gen(function*() {
      const { at } = yield* Operation.budget
      const ended = entries.filter((recorded) => Option.exists(recorded.hop, (hop) => Deferred.isDoneUnsafe(hop.end)))
      yield* Effect.forEach(ended, (recorded) => Deferred.await(recorded.done), { discard: true }).pipe(
        Effect.timeoutOption(Operation.millisLeft(at)),
        Effect.asVoid
      )
    })
    // Stopping waits for the hops in flight only when asked, and records nothing new meanwhile
    yield* Scope.addFinalizer(
      own,
      Effect.suspend(() => {
        stopped = true
        return settings.inFlightAtStop === "wait" ? settle : Effect.void
      })
    )
    return {
      recorder: { clock: Recordings.anchor(), entries, count, settle, flush },
      stop: Scope.close(own, Exit.void)
    }
  })

// ── HAR 1.2 ──

export interface Header {
  readonly name: string
  readonly value: string
}

/** How an export writes entries. */
export interface Writing {
  readonly detail: "full" | "minimal"
  readonly include: ReadonlySet<Har.SecretClass>
  /** Where a body goes: in the entry, in a file beside it at `prefix`, or nowhere. */
  readonly bodies: { readonly _tag: "Embed" } | { readonly _tag: "File"; readonly prefix: string } | {
    readonly _tag: "Omit"
  }
}

const redacted = "REDACTED"

/** A URL with its credentials redacted, unless they are included. */
const urlOf = (url: string, writing: Writing): string => {
  if (writing.include.has("credentials")) return url
  try {
    const parsed = new URL(url)
    if (parsed.username === "" && parsed.password === "") return url
    parsed.username = redacted
    parsed.password = ""
    return parsed.href
  } catch {
    return url
  }
}

const isAuthorization = (name: string) => name === "authorization" || name === "proxy-authorization"

/** One `name=value` pair of a cookie header, its value redacted unless cookies are included. */
const cookiePair = (pair: string, writing: Writing): string => {
  if (writing.include.has("cookies")) return pair
  const at = pair.indexOf("=")
  return at < 0 ? pair : `${pair.slice(0, at)}=${redacted}`
}

/** Headers as HAR lists them, a repeated one once per value, with secrets redacted. */
const headersOf = (headers: Readonly<Record<string, string | undefined>>, writing: Writing): Array<Header> =>
  Object.entries(headers).flatMap(([name, joined]) =>
    (joined ?? "").split("\n").map((value) => ({
      name,
      value: isAuthorization(name) && !writing.include.has("authorizationHeaders")
        ? redacted
        : name === "cookie"
        ? value.split(/;\s*/).map((pair) => cookiePair(pair, writing)).join("; ")
        : name === "set-cookie"
        ? [cookiePair(value.split(";")[0]!, writing), ...value.split(";").slice(1)].join(";")
        : value
    }))
  )

/** The cookies a request sent, from its `Cookie` header. */
const requestCookies = (headers: Readonly<Record<string, string | undefined>>, writing: Writing) =>
  (headers.cookie ?? "").split(/;\s*/).filter((pair) => pair.includes("=")).map((pair) => {
    const at = pair.indexOf("=")
    return { name: pair.slice(0, at), value: writing.include.has("cookies") ? pair.slice(at + 1) : redacted }
  })

/** The cookies a response set, from its `Set-Cookie` headers. */
const responseCookies = (headers: Readonly<Record<string, string | undefined>>, writing: Writing) =>
  (headers["set-cookie"] ?? "").split("\n").filter((line) => line.includes("=")).map((line) => {
    const [pair, ...attributes] = line.split(";").map((part) => part.trim())
    const at = pair!.indexOf("=")
    const cookie: Record<string, string | boolean> = {
      name: pair!.slice(0, at),
      value: writing.include.has("cookies") ? pair!.slice(at + 1) : redacted
    }
    for (const attribute of attributes) {
      const [key, value = ""] = attribute.split("=")
      switch (key!.toLowerCase()) {
        case "path":
          cookie.path = value
          break
        case "domain":
          cookie.domain = value
          break
        case "expires":
          cookie.expires = value
          break
        case "httponly":
          cookie.httpOnly = true
          break
        case "secure":
          cookie.secure = true
          break
        case "samesite":
          cookie.sameSite = value
          break
      }
    }
    return cookie
  })

const queryOf = (url: string) => {
  try {
    const query: Array<Header> = []
    new URL(url).searchParams.forEach((value, name) => query.push({ name, value }))
    return query
  } catch {
    return []
  }
}

const textual = (mimeType: string) =>
  /^text\/|[+/](json|xml|javascript|ecmascript)\b|^application\/(x-www-form-urlencoded|graphql)/i.test(mimeType)

/** A HAR entry for one recorded hop, and the body file it names, if any. */
export const entryOf = (
  recorded: Recorded,
  clock: Recordings.Clock,
  writing: Writing
): { readonly entry: Record<string, unknown>; readonly file: Option.Option<{ path: string; content: Uint8Array }> } => {
  const { request } = recorded
  const response = Option.flatMap(recorded.hop, (hop) => hop.response)
  const end = recorded.end
  const minimal = writing.detail === "minimal"
  // The headers as the network sent and received them, where the backend reports them apart (CDP's ExtraInfo)
  const sent = Option.flatMap(recorded.hop, (hop) => hop.sent)
  const received = Option.flatMap(recorded.hop, (hop) => hop.received)
  const requestHeaders = Option.getOrElse(sent, () => request.headers) as Readonly<Record<string, string>>
  const responseHeaders: Readonly<Record<string, string | undefined>> = Option.match(response, {
    onNone: () => ({}),
    onSome: (response) => Option.getOrElse(received, () => response.headers) as Readonly<Record<string, string>>
  })
  const endedAt = Option.flatMap(end, (end) => end._tag === "Forgotten" ? Option.none() : Option.some(end.at))
  const wait = Option.match(response, {
    onNone: () => -1,
    onSome: (response) => Recordings.between(request.at, response.at)
  })
  const receive = Option.isSome(response) && Option.isSome(endedAt)
    ? Recordings.between(response.value.at, endedAt.value)
    : -1
  const timings = minimal
    ? { send: -1, wait: -1, receive: -1 }
    : { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait, receive }
  const time = minimal ? -1 : [0, wait, receive].filter((each) => each >= 0).reduce((sum, each) => sum + each, 0)
  const mimeType = (responseHeaders["content-type"] ?? "x-unknown").split(";")[0]!.trim()
  const httpVersion = Option.getOrElse(
    Option.orElse(
      Option.flatMap(response, (response) => response.httpVersion),
      () => Option.flatMap(end, (end) => end._tag === "Finished" ? end.httpVersion : Option.none())
    ),
    () => ""
  )
  const content: Record<string, unknown> = {
    size: Option.match(recorded.body, { onNone: () => -1, onSome: (body) => body.length }),
    mimeType
  }
  let file = Option.none<{ path: string; content: Uint8Array }>()
  if (Option.isSome(recorded.body)) {
    const body = recorded.body.value
    switch (writing.bodies._tag) {
      case "Embed":
        if (textual(mimeType)) content.text = new TextDecoder().decode(body)
        else {
          content.text = Encoding.encode(body)
          content.encoding = "base64"
        }
        break
      case "File": {
        const name = `${request.hop}.${Recordings.extension(mimeType)}`
        content._file = `${writing.bodies.prefix}${name}`
        file = Option.some({ path: `${writing.bodies.prefix}${name}`, content: body })
        break
      }
    }
  }
  const status = Option.match(response, { onNone: () => -1, onSome: (response) => response.status })
  const entry: Record<string, unknown> = {
    ...(request.initiator._tag === "Document" ? { pageref: request.initiator.navigable } : {}),
    startedDateTime: Recordings.wallTime(clock, request.at),
    time,
    request: {
      method: request.method,
      url: urlOf(request.url, writing),
      httpVersion,
      cookies: minimal ? [] : requestCookies(requestHeaders, writing),
      headers: minimal ? [] : headersOf(requestHeaders, writing),
      queryString: queryOf(request.url),
      headersSize: -1,
      bodySize: -1
    },
    response: {
      status,
      statusText: Option.match(response, { onNone: () => "", onSome: (response) => response.statusText }),
      httpVersion,
      cookies: minimal ? [] : responseCookies(responseHeaders, writing),
      headers: minimal ? [] : headersOf(responseHeaders, writing),
      content,
      redirectURL: status >= 300 && status < 400 ? (responseHeaders.location ?? "") : "",
      headersSize: -1,
      bodySize: Option.match(end, {
        onNone: () => -1,
        onSome: (end) => end._tag === "Finished" ? end.encodedBytes : -1
      }),
      _transferSize: Option.match(end, {
        onNone: () => -1,
        onSome: (end) => end._tag === "Finished" ? end.encodedBytes : -1
      }),
      ...(Option.isSome(end) && end.value._tag === "Failed" ? { _failureText: end.value.error } : {})
    },
    cache: {},
    timings,
    _monotonicTime: Recordings.millis(request.at),
    _resourceType: request.resourceType,
    ...(request.initiator._tag === "Document" ? { _frameref: request.initiator.navigable } : {}),
    ...(Option.isSome(response) ? { _servedBy: response.value.servedBy } : {}),
    ...(Option.isNone(end) ? { _incomplete: true } : {}),
    ...(recorded.frames.length === 0 ? {} : {
      _webSocketMessages: recorded.frames.map((frame) => ({
        type: frame.direction === "sent" ? "send" : "receive",
        time: (clock.wall + (frame.at - clock.monotonic) / 1e6) / 1e3,
        opcode: frame.payload._tag === "Text" ? 1 : 2,
        data: frame.payload._tag === "Text" ? frame.payload.text : Encoding.encode(frame.payload.bytes)
      }))
    })
  }
  return { entry, file }
}

/** A HAR 1.2 log of entries, and the body files they name. */
export const logOf = (
  entries: ReadonlyArray<Recorded>,
  clock: Recordings.Clock,
  writing: Writing,
  browser: { readonly name: string; readonly version: string }
) => {
  const files: Array<{ path: string; content: Uint8Array }> = []
  const written = entries.map((recorded) => {
    const { entry, file } = entryOf(recorded, clock, writing)
    if (Option.isSome(file)) files.push(file.value)
    return entry
  })
  const pages = [
    ...new Set(
      entries.flatMap((recorded) =>
        recorded.request.initiator._tag === "Document" ? [recorded.request.initiator.navigable] : []
      )
    )
  ]
  const log = {
    log: {
      version: "1.2",
      creator: { name: "Strider", version: "0.1.0" },
      browser,
      pages: writing.detail === "minimal" ? [] : pages.map((id) => {
        const first = entries.find((recorded) =>
          recorded.request.initiator._tag === "Document" && recorded.request.initiator.navigable === id
        )!
        return {
          startedDateTime: Recordings.wallTime(clock, first.request.at),
          id,
          title: id,
          pageTimings: {}
        }
      }),
      entries: written
    }
  }
  return { log, files }
}
