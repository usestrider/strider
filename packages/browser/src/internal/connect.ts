/**
 * Connecting to a browser this program didn't start. An endpoint is resolved to the
 * browser's WebSocket and the adapter connects as attached: it adopts what is open, and leaves it open.
 *
 * - **Chromium** takes its WebSocket URL, or its HTTP endpoint, whose `/json/version` names the WebSocket.
 * - **Firefox** takes its remote agent's WebSocket; `/session` is added when the URL has no path.
 * - **Any WebDriver BiDi endpoint** is taken as given.
 * - **Stock WebKit** takes its inspector server's HTTP endpoint, whose list names a WebSocket per page.
 *
 * The headers go with the WebSocket handshake, and with Chromium's and WebKit's HTTP requests.
 */
import * as Effect from "effect/Effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpUrl from "effect/http/Url"
import * as Redacted from "effect/Redacted"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Socket from "effect/socket/Socket"
import * as Browser from "../Browser.ts"
import * as Transport from "../protocol/Transport.ts"
import * as Reason from "../Reason.ts"
import * as Launch from "./launch.ts"
import * as Spans from "./spans.ts"
import * as WebKitStockTransport from "./webkitStockTransport.ts"

const invalid = (expected: string, hint: string) =>
  Launch.fail(new Reason.InvalidInput({ input: "endpoint", expected, hint }), "check the endpoint")

const refused = (hint: string) => Launch.fail(new Browser.ConnectionFailed({ stage: "refused", hint }), "connect")

/** The endpoint, parsed, with its scheme one of `schemes`. */
const parse = (endpoint: string, schemes: ReadonlyArray<string>, expected: string) =>
  Effect.suspend(() => {
    const parsed = HttpUrl.fromString(endpoint)
    if (Result.isFailure(parsed)) return invalid(expected, `${JSON.stringify(endpoint)} doesn't parse`)
    const url = parsed.success
    return schemes.includes(url.protocol)
      ? Effect.succeed(url)
      : invalid(expected, `${url.protocol} isn't one of ${schemes.join(", ")}`)
  })

const plainHeaders = (headers: Browser.ConnectOptions["headers"]) =>
  Object.fromEntries(
    Object.entries(headers ?? {}).map((
      [name, value]
    ) => [name, Redacted.isRedacted(value) ? Redacted.value(value) : value])
  )

const Version = Schema.Struct({ webSocketDebuggerUrl: Schema.String })

/**
 * Chromium's browser WebSocket: the URL given, or the one its HTTP endpoint's `/json/version` names, asked
 * through the `HttpClient` in context.
 */
export const chromiumWebSocket = (
  endpoint: string,
  options: Browser.ConnectOptions | undefined
): Effect.Effect<string, Browser.BrowserError, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const url = yield* parse(
      endpoint,
      ["ws:", "wss:", "http:", "https:"],
      "a Chromium browser's WebSocket URL (ws://…/devtools/browser/…) or its HTTP endpoint (http://host:port)"
    )
    if (url.protocol === "ws:" || url.protocol === "wss:") return url.href
    const version = new URL("/json/version", url)
    const answer = yield* Effect.flatMap(
      HttpClient.HttpClient,
      (client) =>
        client.pipe(HttpClient.filterStatusOk).execute(
          HttpClientRequest.get(version.href).pipe(HttpClientRequest.setHeaders(plainHeaders(options?.headers)))
        )
    ).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Version)),
      Effect.catch((error) => refused(`${version.href} named no browser WebSocket: ${error.message}`))
    )
    return answer.webSocketDebuggerUrl
  }).pipe(Spans.operation("Chromium.resolveEndpoint", { attributes: { "browser.endpoint": endpoint } }))

/** Firefox's session endpoint: its remote agent's WebSocket, with `/session` when the URL has no path. */
export const firefoxWebSocket = (endpoint: string) =>
  Effect.map(
    parse(endpoint, ["ws:", "wss:"], "Firefox's remote agent WebSocket, such as ws://127.0.0.1:9222"),
    (url) => url.pathname === "/" || url.pathname === "" ? new URL("/session", url).href : url.href
  )

/** A BiDi endpoint, as given. */
export const bidiWebSocket = (endpoint: string) =>
  Effect.map(parse(endpoint, ["ws:", "wss:"], "a WebDriver BiDi WebSocket URL"), (url) => url.href)

/** The WebSocket to a browser's endpoint, with the connect options' headers. */
export const webSocket = (
  url: string,
  options: Browser.ConnectOptions | undefined
): Effect.Effect<Transport.Transport, Browser.BrowserError, Scope.Scope | Socket.WebSocketConstructor> =>
  Transport.webSocket(url, options?.headers === undefined ? {} : { headers: options.headers }).pipe(
    Effect.catch((error) => refused(`${url}: ${error.message}`)),
    Spans.operation("Browser.connect", { attributes: { "browser.endpoint": url } })
  )

/** Stock WebKit's inspector server at its HTTP endpoint, as one transport: its pages, read from its list. */
export const webkitInspector = (
  endpoint: string,
  options: Browser.ConnectOptions | undefined
): Effect.Effect<Transport.Transport, Browser.BrowserError, Scope.Scope | Socket.WebSocketConstructor> =>
  Effect.gen(function*() {
    const url = yield* parse(
      endpoint,
      ["http:", "https:"],
      "a WebKit inspector server's HTTP endpoint (http://host:port), as WEBKIT_INSPECTOR_HTTP_SERVER names it"
    )
    return yield* WebKitStockTransport.connect(url, { headers: plainHeaders(options?.headers), poll: "250 millis" })
      .pipe(
        Effect.catch((error) => refused(error.message))
      )
  }).pipe(Spans.operation("Browser.connect", { attributes: { "browser.endpoint": endpoint } }))
