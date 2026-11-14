/**
 * HAR recordings: a page's or context's requests from the event model, one entry per
 * hop, written as HAR 1.2.
 *
 * - **What is recorded.** Each request the target's channel delivers while the recording lives, with the
 *   response its hop got and how the hop ended; as the hop finishes, the body its request sent is read, and its
 *   response's unless `content` is `omit`. A recording keeps every entry: its subscription has no bound.
 * - **Timings** come from the library's clock, so they mean the same on every backend: `send` is 0, `wait`
 *   runs from the request to its response, and `receive` from the response to the hop's end. The phases no
 *   backend reports alike (`blocked`, `dns`, `connect`, `ssl`) are -1.
 * - **Redaction.** Cookie values, a nameless cookie's whole pair among them, `Authorization` and
 *   `Proxy-Authorization`, and a URL's credentials are `REDACTED` unless the export includes their class; a
 *   request's body is left out unless it includes `requestBodies`.
 * - **Fields.** A `mimeType` is the `Content-Type` with its parameters; a body is text only where its type is
 *   textual and its bytes are valid UTF-8, and base64 otherwise. A request's `bodySize` is 0 where it sent no
 *   body and -1 where its body wasn't read. A `Set-Cookie`'s `Max-Age` gives its `expires`, ahead of `Expires`,
 *   and a cookie with no `=` has the name `""`. The creator's version is the package's, generated into `version.ts`.
 * - **The format** is `harLog.ts`'s schema, which replay reads with: HAR 1.2, Playwright's extensions, which its
 *   trace viewer reads, and ours.
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
import type * as Types from "effect/Types"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as Har from "../Har.ts"
import type * as NetworkConnection from "../NetworkConnection.ts"
import type * as NetworkRequest from "../NetworkRequest.ts"
import * as Reason from "../Reason.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Events from "./events.ts"
import type * as Handles from "./handles.ts"
import type * as HarLog from "./harLog.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Recordings from "./recordings.ts"
import type * as Runtime from "./runtime.ts"
import * as Version from "./version.ts"

/** One hop, as recorded: its request, the model's hop, and what the recording read as it ended. */
export interface Recorded {
  readonly request: NetworkRequest.NetworkRequest
  readonly hop: Option.Option<Model.HopEntry>
  end: Option.Option<Model.HopEnd>
  body: Option.Option<Uint8Array>
  /** The body the hop's request sent (Q164): `None` until it is read, and `Some(None)` where it sent none. */
  requestBody: Option.Option<Option.Option<Uint8Array>>
  /** A WebSocket's frames, on its handshake's entry. */
  readonly frames: Array<NetworkConnection.Frame>
  /** Done once the hop has ended and its bodies, if any, were read. */
  readonly done: Deferred.Deferred<void>
}

/** What a recording asks for. */
export interface Settings {
  readonly content: "embed" | "attach" | "omit"
  /** Whether requests' bodies are read, which only an export that can include them needs. */
  readonly requestBodies: boolean
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
  bodies: ReadonlyArray<"request" | "response">,
  limit: ByteSize.ByteSize,
  id: Diagnostics.OperationId
): Effect.Effect<void, Reason.BackendFailure | Reason.Unsupported | Deadline.Timeout, Scope.Scope> => {
  const scope: Adapter.DeclarationScope = found._tag === "Page"
    ? { _tag: "Page", page: (found.behind.entry as Model.PageEntry).id }
    : { _tag: "UserContext", context: (found.behind.entry as Model.ContextEntry).id }
  return runtime.model.adapter.declare(scope, {
    _tag: "BodyCollection",
    bodies,
    maxBytes: ByteSize.toNumberUnsafe(limit)
  })
    .pipe(
      Effect.asVoid,
      Effect.mapError((error) => {
        const mapped = Operation.fromAdapter(error, id, runtime.backend)
        return mapped._tag === "Timeout"
          ? mapped.error
          : mapped._tag === "Gone"
          ? new Reason.BackendFailure({
            kind: "Rejected",
            method: "BodyCollection",
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
      // A body the browser didn't keep is left out, as a response's is
      if (settings.requestBodies) {
        recorded.requestBody = yield* runtime.model.adapter.requestBody(recorded.request.hop).pipe(Effect.option)
      }
      const response = (yield* hop.state.get).response
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
          requestBody: Option.none(),
          frames: [],
          done: Deferred.makeUnsafe<void>()
        }
        entries.push(recorded)
        // Followed before it is counted, so a wait woken by the count finds it in flight
        yield* FiberSet.run(hops, follow(recorded))
        yield* SubscriptionRef.set(count, entries.length)
      }
    }).pipe(Effect.ignore, Operation.detached, Effect.forkIn(own))
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
          }).pipe(Effect.ignore, Operation.detached, Effect.forkIn(own))
        }
      }).pipe(Effect.ignore, Operation.detached, Effect.forkIn(own))
    }
    const settle = Effect.gen(function*() {
      const { at } = yield* Operation.budget
      yield* FiberSet.awaitEmpty(hops).pipe(BrowserClock.until(at), Effect.asVoid)
    })
    // A hop that ended has its body read at once; an export waits for that, never for a hop in flight
    const flush = Effect.gen(function*() {
      const { at } = yield* Operation.budget
      const ended = entries.filter((recorded) => Option.exists(recorded.hop, (hop) => Deferred.isDoneUnsafe(hop.end)))
      yield* Effect.forEach(ended, (recorded) => Deferred.await(recorded.done), { discard: true }).pipe(
        BrowserClock.until(at),
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
  const parsed = URL.parse(url)
  if (parsed === null || (parsed.username === "" && parsed.password === "")) return url
  parsed.username = redacted
  parsed.password = ""
  return parsed.href
}

const isAuthorization = (name: string) => name === "authorization" || name === "proxy-authorization"

/**
 * One `name=value` pair of a cookie header, its value redacted unless cookies are included. A pair with no `=`
 * is a cookie with no name, all value, so all of it is redacted.
 */
const cookiePair = (pair: string, writing: Writing): string => {
  if (writing.include.has("cookies")) return pair
  const at = pair.indexOf("=")
  return at < 0 ? redacted : `${pair.slice(0, at)}=${redacted}`
}

/** A cookie's name and value from its `name=value` pair; a pair with no `=` is a value with no name. */
const nameAndValue = (pair: string): { readonly name: string; readonly value: string } => {
  const at = pair.indexOf("=")
  return at < 0 ? { name: "", value: pair } : { name: pair.slice(0, at), value: pair.slice(at + 1) }
}

/** Headers as HAR lists them, a repeated one once per value, with secrets redacted. */
const headersOf = (
  headers: Readonly<Record<string, string | undefined>>,
  writing: Writing
): Array<typeof HarLog.NameValue.Type> =>
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
const requestCookies = (
  headers: Readonly<Record<string, string | undefined>>,
  writing: Writing
): Array<typeof HarLog.Cookie.Type> =>
  (headers.cookie ?? "").split(/;\s*/).filter((pair) => pair !== "").map((pair) => {
    const { name, value } = nameAndValue(pair)
    return { name, value: writing.include.has("cookies") ? value : redacted }
  })

/**
 * The cookies a response set, from its `Set-Cookie` headers, as the response wrote them. Effect's
 * `Cookies.fromSetCookie` isn't used: it reads a cookie for a jar, so it drops a cookie whose name isn't a token
 * and a path that doesn't start with `/`, takes the leading `.` off a domain and lowercases `SameSite`, where a HAR
 * records what the server sent. A `Max-Age` is counted from `receivedAt`, the response's wall time in
 * milliseconds, and wins over an `Expires`, as RFC 6265 has it; one of 0 or less is the earliest time there is.
 */
const responseCookies = (
  headers: Readonly<Record<string, string | undefined>>,
  writing: Writing,
  receivedAt: number
): Array<typeof HarLog.Cookie.Type> =>
  (headers["set-cookie"] ?? "").split("\n").filter((line) => line.trim() !== "").map((line) => {
    const [pair, ...attributes] = line.split(";").map((part) => part.trim())
    const { name, value } = nameAndValue(pair!)
    const cookie: Types.Mutable<typeof HarLog.Cookie.Type> = {
      name,
      value: writing.include.has("cookies") ? value : redacted
    }
    let maxAge = false
    for (const attribute of attributes) {
      // An attribute's value runs to the end, `=` and all
      const equals = attribute.indexOf("=")
      const key = equals < 0 ? attribute : attribute.slice(0, equals).trim()
      const value = equals < 0 ? "" : attribute.slice(equals + 1).trim()
      switch (key.toLowerCase()) {
        case "path":
          cookie.path = value
          break
        case "domain":
          cookie.domain = value
          break
        case "expires": {
          // HAR writes a cookie's expiry in ISO 8601; a date that doesn't parse is left out
          const date = new Date(value)
          if (!maxAge && !Number.isNaN(date.getTime())) cookie.expires = date.toISOString()
          break
        }
        case "max-age": {
          // Only digits, with an optional leading `-`, are a Max-Age; anything else is ignored
          if (!/^-?\d+$/.test(value)) break
          const seconds = Number(value)
          maxAge = true
          cookie.expires = new Date(seconds <= 0 ? 0 : receivedAt + seconds * 1000).toISOString()
          break
        }
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
  const query: Array<typeof HarLog.NameValue.Type> = []
  URL.parse(url)?.searchParams.forEach((value, name) => query.push({ name, value }))
  return query
}

const textual = (mimeType: string) =>
  /^text\/|[+/](json|xml|javascript|ecmascript)\b|^application\/(x-www-form-urlencoded|graphql)/i.test(mimeType)

/** A MIME type without its parameters, as `textual` and a file's extension read it. */
const essence = (mimeType: string) => mimeType.split(";")[0]!.trim().toLowerCase()

/** A body as text, where its MIME type is textual and its bytes are valid UTF-8. */
const textOf = (mimeType: string, body: Uint8Array): Option.Option<string> => {
  if (!textual(essence(mimeType))) return Option.none()
  try {
    return Option.some(new TextDecoder("utf-8", { fatal: true }).decode(body))
  } catch {
    return Option.none()
  }
}

/**
 * A request's body as HAR's `postData` (Q164), its MIME type with its parameters: text where its type is textual
 * and it is valid UTF-8, with a form's `params`; otherwise base64 with `_encoding` where bodies are embedded, or a file beside the HAR where they are attached.
 * HAR's `postData` has no `encoding`, as a response's `content` has, so the flag is an extension.
 */
const postDataOf = (
  request: NetworkRequest.NetworkRequest,
  body: Uint8Array,
  headers: Readonly<Record<string, string | undefined>>,
  writing: Writing
): {
  readonly postData: typeof HarLog.PostData.Type
  readonly file: Option.Option<{ path: string; content: Uint8Array }>
} => {
  const mimeType = (headers["content-type"] ?? "application/octet-stream").trim()
  const text = textOf(mimeType, body)
  if (Option.isSome(text)) {
    return {
      postData: {
        mimeType,
        text: text.value,
        ...(essence(mimeType) === "application/x-www-form-urlencoded"
          ? { params: [...new URLSearchParams(text.value)].map(([name, value]) => ({ name, value })) }
          : {})
      },
      file: Option.none()
    }
  }
  if (writing.bodies._tag === "File") {
    const path = `${writing.bodies.prefix}${request.hop}-request.${Recordings.extension(essence(mimeType))}`
    return { postData: { mimeType, text: "", _file: path }, file: Option.some({ path, content: body }) }
  }
  return { postData: { mimeType, text: Encoding.encode(body), _encoding: "base64" }, file: Option.none() }
}

/** A HAR entry for one recorded hop, and the body files it names. */
export const entryOf = (
  recorded: Recorded,
  clock: Recordings.Clock,
  writing: Writing
): {
  readonly entry: HarLog.Entry
  readonly files: ReadonlyArray<{ path: string; content: Uint8Array }>
} => {
  const { request } = recorded
  // What the hop received, as it is now
  const received_ = Option.map(recorded.hop, (hop) => hop.state.getUnsafe())
  const response = Option.flatMap(received_, (state) => state.response)
  const end = recorded.end
  const minimal = writing.detail === "minimal"
  // The headers as the network sent and received them, where the backend reports them apart (CDP's ExtraInfo)
  const sent = Option.flatMap(received_, (state) => state.sent)
  const received = Option.flatMap(received_, (state) => state.received)
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
  // HAR's `mimeType` is the Content-Type, its parameters and all
  const mimeType = (responseHeaders["content-type"] ?? "x-unknown").trim()
  const httpVersion = Option.getOrElse(
    Option.orElse(
      Option.flatMap(response, (response) => response.httpVersion),
      () => Option.flatMap(end, (end) => end._tag === "Finished" ? end.httpVersion : Option.none())
    ),
    () => ""
  )
  const content: Types.Mutable<typeof HarLog.Content.Type> = {
    size: Option.match(recorded.body, { onNone: () => -1, onSome: (body) => body.length }),
    mimeType
  }
  let file = Option.none<{ path: string; content: Uint8Array }>()
  if (Option.isSome(recorded.body)) {
    const body = recorded.body.value
    switch (writing.bodies._tag) {
      case "Embed": {
        const text = textOf(mimeType, body)
        if (Option.isSome(text)) content.text = text.value
        else {
          content.text = Encoding.encode(body)
          content.encoding = "base64"
        }
        break
      }
      case "File": {
        const name = `${request.hop}.${Recordings.extension(essence(mimeType))}`
        content._file = `${writing.bodies.prefix}${name}`
        file = Option.some({ path: `${writing.bodies.prefix}${name}`, content: body })
        break
      }
    }
  }
  const requestBody = Option.flatten(recorded.requestBody)
  const sentBody = !minimal && writing.include.has("requestBodies") && Option.isSome(requestBody)
    ? Option.some(postDataOf(request, requestBody.value, requestHeaders, writing))
    : Option.none()
  const status = Option.match(response, { onNone: () => -1, onSome: (response) => response.status })
  const entry: HarLog.Entry = {
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
      ...(Option.isSome(sentBody) ? { postData: sentBody.value.postData } : {}),
      headersSize: -1,
      // 0 for a request that sent no body, and -1 where its body wasn't read
      bodySize: Option.match(recorded.requestBody, {
        onNone: () => -1,
        onSome: (body) => Option.match(body, { onNone: () => 0, onSome: (body) => body.length })
      })
    },
    response: {
      status,
      statusText: Option.match(response, { onNone: () => "", onSome: (response) => response.statusText }),
      httpVersion,
      cookies: minimal ? [] : responseCookies(
        responseHeaders,
        writing,
        clock.wall + ((Option.isSome(response) ? response.value.at : request.at) - clock.monotonic) / 1e6
      ),
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
        type: frame.direction === "sent" ? "send" as const : "receive" as const,
        time: (clock.wall + (frame.at - clock.monotonic) / 1e6) / 1e3,
        opcode: frame.payload._tag === "Text" ? 1 : 2,
        data: frame.payload._tag === "Text" ? frame.payload.text : Encoding.encode(frame.payload.bytes)
      }))
    })
  }
  return {
    entry,
    files: [
      ...Option.toArray(file),
      ...Option.toArray(Option.flatMap(sentBody, (sent) => sent.file))
    ]
  }
}

/** A HAR 1.2 log of entries, and the body files they name, its creator Strider at the package's version. */
export const logOf = (
  entries: ReadonlyArray<Recorded>,
  clock: Recordings.Clock,
  writing: Writing,
  browser: { readonly name: string; readonly version: string }
): { readonly log: HarLog.Log; readonly files: ReadonlyArray<{ path: string; content: Uint8Array }> } => {
  const files: Array<{ path: string; content: Uint8Array }> = []
  const written = entries.map((recorded) => {
    const { entry, files: named } = entryOf(recorded, clock, writing)
    files.push(...named)
    return entry
  })
  const pages = [
    ...new Set(
      entries.flatMap((recorded) =>
        recorded.request.initiator._tag === "Document" ? [recorded.request.initiator.navigable] : []
      )
    )
  ]
  const log: HarLog.Log = {
    log: {
      version: "1.2",
      creator: { name: "Strider", version: Version.version },
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
