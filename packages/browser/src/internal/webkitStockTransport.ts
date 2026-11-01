/**
 * Stock WebKit's remote inspector as one transport. WebKitGTK's and WPE's inspector
 * server (`WEBKIT_INSPECTOR_HTTP_SERVER`) lists its pages at `/`, as HTML, and reaches each through a WebSocket of
 * its own, `/socket/<connection>/<target>/WebPage`, speaking the inspector protocol of that page: `Target` events
 * for its inspector targets, and commands to them wrapped in `Target.sendMessageToTarget`.
 *
 * - **Pages are page proxies.** The transport polls the list and connects to each page it hasn't, and presents them
 *   to the WebKit adapter through the envelope's endpoint (`webkitEnvelope.ts`), which the WebKit wire routes
 *   (`webkitWire.ts`): a page's messages carry its `pageProxyId`, and its arrival and end are
 *   `Envelope.pageProxyCreated` and `Envelope.pageProxyDestroyed`, in the default context. It moves a page's text
 *   as it is: the ids in it are its target's own, which the adapter keys by the target (QUIRKS.md, Q195).
 * - **There is no browser session.** `Envelope.enable` announces the pages open, then replies, and the list is
 *   read for new ones from then on.
 * - **The connection** lives while the inspector server answers: a list that can't be read ends it.
 */
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import * as Socket from "effect/socket/Socket"
import * as Stream from "effect/Stream"
import * as Transport from "../protocol/Transport.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Envelope from "./webkitEnvelope.ts"

/**
 * The pages an inspector server lists, by their WebSocket's path, from each Inspect button's script. The list
 * writes a page's title and URL into its HTML unescaped (QUIRKS.md, Q196), so the path is read only where the
 * script names it.
 */
export const pagesOf = (html: string): ReadonlyArray<string> => [
  ...new Set(
    Array.from(html.matchAll(/window\.location\.host \+ '\/(socket\/\d+\/\d+\/WebPage)'/g), (match) => match[1]!)
  )
]

/** A page's id as a page proxy: its connection's and its target's, which the server's path names. */
const pageProxyIdOf = (path: string) => path.split("/").slice(1, 3).join("-")

interface Options {
  /** Headers for the list's requests and each page's handshake. */
  readonly headers?: Readonly<Record<string, string>> | undefined
  /** How often the list is read for pages that arrived. */
  readonly poll: Duration.Input
}

const unanswered = (error: { readonly message: string }) =>
  new Transport.ConnectionLost({
    initiator: "remote",
    description: `The inspector server stopped answering: ${error.message}`
  })

/** The transport to an inspector server at `endpoint`, `http://host:port`, until the scope closes. */
export const connect: (endpoint: URL, options: Options) => Effect.Effect<
  Transport.Transport,
  Transport.TransportError,
  Scope.Scope | Socket.WebSocketConstructor | HttpClient.HttpClient
> = Effect.fnUntraced(function*(endpoint: URL, options: Options) {
  const scope = yield* Effect.scope
  const constructor = yield* Socket.WebSocketConstructor
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  const list = http.execute(
    HttpClientRequest.get(new URL("/", endpoint).href).pipe(HttpClientRequest.setHeaders(options.headers ?? {}))
  ).pipe(Effect.flatMap((response) => response.text), Effect.map(pagesOf))

  // A page's WebSocket: its messages in the envelope, then its end
  const attach = Effect.fnUntraced(function*(path: string) {
    const pageProxyId = pageProxyIdOf(path)
    const own = yield* Scope.fork(scope)
    const url = new URL(`/${path}`, endpoint)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const page = yield* Transport.webSocket(url.href, options.headers === undefined ? {} : { headers: options.headers })
      .pipe(Scope.provide(own), Effect.provideService(Socket.WebSocketConstructor, constructor), Effect.option)
    if (page._tag === "None") return yield* Scope.close(own, Exit.void)
    pages.created(pageProxyId, "default", page.value.send)
    yield* page.value.messages.pipe(
      Stream.runForEach((text) => Effect.sync(() => pages.message(pageProxyId, text))),
      Effect.ignore,
      // A page's WebSocket closes with its page, and with the browser: the list says which, unless the connection
      // ended first, and within a second, so a server that hangs can't hold the scope's close
      Effect.ensuring(Effect.gen(function*() {
        pages.detached(pageProxyId)
        if (pages.lost() !== undefined) return yield* Scope.close(own, Exit.void)
        const listed = yield* Effect.exit(Effect.timeout(list, "1 second"))
        if (Exit.isFailure(listed)) {
          pages.lose(unanswered({ message: "a page's WebSocket closed, and the list can't be read" }))
        } else {
          pages.destroyed(pageProxyId)
        }
        yield* Scope.close(own, Exit.void)
      })),
      Effect.forkIn(scope)
    )
  })

  const known = new Set<string>()
  const poll = Effect.gen(function*() {
    for (const path of yield* list) {
      if (known.has(path)) continue
      known.add(path)
      yield* attach(path)
    }
  })

  // The pages open now, announced before the reply, then the ones that arrive
  const pages: Envelope.Endpoint = yield* Envelope.makeEndpoint(
    poll.pipe(
      Effect.andThen(Effect.forkIn(
        poll.pipe(
          Effect.schedule(Schedule.spaced(options.poll)),
          Effect.catch((error) => Effect.sync(() => pages.lose(unanswered(error)))),
          BrowserClock.onLive
        ),
        scope
      )),
      Effect.asVoid,
      Effect.mapError(unanswered)
    )
  )
  // The list is read once now, so an endpoint that isn't an inspector server fails the connection
  yield* list.pipe(Effect.mapError((error) =>
    new Transport.TransportError({
      reason: new Transport.ConnectFailed({ description: `${endpoint.href} listed no pages: ${error.message}` })
    })
  ))
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => pages.lose(new Transport.ConnectionLost({ initiator: "local", description: "The scope closed" })))
  )
  return pages.transport
})
