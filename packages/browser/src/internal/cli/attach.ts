/** One startup probe for HTTP attachment; page content never identifies a backend (ROOK-4). */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

class DetectionError extends Data.TaggedError("DetectionError")<{ readonly message: string }> {}

const failure = (message: string) => new DetectionError({ message })

const Discovery = Schema.Struct({
  Browser: Schema.NonEmptyString,
  "Protocol-Version": Schema.NonEmptyString,
  webSocketDebuggerUrl: Schema.String
})

/** Detects a pinned-compatible inspector or validates Chromium discovery, without following redirects. */
export const detect = Effect.fnUntraced(
  function*(endpoint: string) {
    const url = URL.parse(endpoint)
    if (url === null || !/^https?:$/.test(url.protocol)) {
      return yield* Effect.fail(failure("Attachment requires an HTTP inspector endpoint"))
    }
    const client = yield* HttpClient.HttpClient
    const response = yield* HttpClient.withScope(client).execute(
      HttpClientRequest.get(new URL("/json/version", url).href)
    )
    // The exact product token is sent even on WebKit's 404 and when there are no targets.
    if (/(?:^|\s)WebKitInspectorHTTPServer(?:\s|$)/.test(response.headers.server ?? "")) {
      return { _tag: "Attach", backend: "webkit", endpoint: url.href } as const
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        failure(
          `Unsupported HTTP attachment response (status ${response.status}); expected Chromium discovery or the WebKitInspectorHTTPServer Server token`
        )
      )
    }
    let size = 0
    const decoder = new TextDecoder()
    const chunks = yield* response.stream.pipe(Stream.runFoldEffect(() => "", (body, chunk) => {
      size += chunk.length
      return size > 65536
        ? Effect.fail(failure("Chromium discovery exceeds 65536 bytes"))
        : Effect.succeed(body + decoder.decode(chunk, { stream: true }))
    }))
    const discovery = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Discovery))(chunks + decoder.decode())
      .pipe(
        Effect.mapError(() =>
          failure("Malformed Chromium discovery: expected Browser, Protocol-Version and webSocketDebuggerUrl")
        )
      )
    const socket = URL.parse(discovery.webSocketDebuggerUrl)
    if (
      socket === null || !/^wss?:$/.test(socket.protocol) || !/^\/devtools\/browser\/[^/]+$/.test(socket.pathname) ||
      socket.username !== "" || socket.password !== ""
    ) {
      return yield* Effect.fail(
        failure(
          "Malformed Chromium discovery: expected a ws:// or wss:// browser WebSocket at /devtools/browser/<id>"
        )
      )
    }
    return { _tag: "Attach", backend: "chromium", endpoint: socket.href } as const
  },
  Effect.scoped,
  Effect.timeoutOrElse({
    duration: "5 seconds",
    orElse: () => Effect.fail(failure("HTTP attachment detection timed out after 5 seconds"))
  }),
  Effect.mapError((error) => failure(`Cannot detect attachment backend: ${error.message.slice(0, 512)}`))
)
