/**
 * Stock WebKit's remote inspector as one transport (review 22, candidate 7). WebKitGTK's and WPE's inspector
 * server (`WEBKIT_INSPECTOR_HTTP_SERVER`) lists its pages at `/`, as HTML, and reaches each through a WebSocket of
 * its own, `/socket/<connection>/<target>/WebPage`, speaking the inspector protocol of that page: `Target` events
 * for its inspector targets, and commands to them wrapped in `Target.sendMessageToTarget`.
 *
 * - **Pages are page proxies.** The transport polls the list and connects to each page it hasn't, and speaks to
 *   the WebKit adapter in Playwright's envelope, which the WebKit wire routes (`webkitWire.ts`): a page's messages
 *   carry its `pageProxyId`, and its arrival and end are `Playwright.pageProxyCreated` and
 *   `Playwright.pageProxyDestroyed`, in the default context. One adapter serves both builds.
 * - **There is no browser session.** `Playwright.enable` is answered as Playwright's build does: the pages open
 *   are announced, then the reply, and the list is read for new ones from then on. Any other command with no page
 *   proxy is answered `Method not found`, which the wire reads as `Unsupported`; one to a page whose WebSocket
 *   closed, as Playwright's build answers a page proxy that is gone.
 * - **Ids are a target's own.** Stock WebKit numbers frames, loaders and requests from `0.1` in each web process
 *   (QUIRKS.md, Q195), and a page's targets are its processes, where Playwright's build numbers them for the
 *   browser: the transport qualifies a target's with its page proxy's and its own id, on the paths the adapter
 *   reads, and takes the qualification off a command's.
 * - **The connection** lives while the inspector server answers: a list that can't be read ends it.
 */
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Socket from "effect/socket/Socket"
import * as Stream from "effect/Stream"
import * as Transport from "../protocol/Transport.ts"

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

// ── A page's ids ──

type Change = (id: string) => string
type Json = Record<string, any>

const named = (value: Json, names: ReadonlyArray<string>, change: Change): Json => {
  const changed = { ...value }
  for (const name of names) if (typeof changed[name] === "string") changed[name] = change(changed[name])
  return changed
}
const frameOf = (frame: Json, change: Change) => named(frame, ["id", "parentId", "loaderId"], change)
const treeOf = (tree: Json, change: Change): Json => ({
  ...tree,
  frame: frameOf(tree.frame, change),
  ...(tree.childFrames === undefined
    ? {}
    : { childFrames: tree.childFrames.map((child: Json) => treeOf(child, change)) })
})

/**
 * Where an event carries a frame, loader or request id, by its method: a path each, never a walk, so a value a page
 * gave (an evaluation's, a header's name) is never taken for one.
 */
const eventIds: Readonly<Record<string, (params: Json, change: Change) => Json>> = {
  "Page.frameNavigated": (params, change) => ({ ...params, frame: frameOf(params.frame, change) }),
  "Page.frameDetached": (params, change) => named(params, ["frameId"], change),
  "Runtime.executionContextCreated": (params, change) => ({
    ...params,
    context: named(params.context, ["frameId"], change)
  }),
  "Console.messageAdded": (params, change) => ({
    ...params,
    message: named(params.message, ["networkRequestId"], change)
  })
}
const networkIds = (params: Json, change: Change) => named(params, ["requestId", "frameId", "loaderId"], change)

/** Where a command's result carries them. */
const resultIds: Readonly<Record<string, (result: Json, change: Change) => Json>> = {
  "Page.getResourceTree": (result, change) => ({ ...result, frameTree: treeOf(result.frameTree, change) })
}

/** A target's ids, qualified: its page proxy's id and its own come first. */
const prefixOf = (pageProxyId: string, targetId: string) => `${pageProxyId}:${targetId}:`

/** A page's message from its WebSocket, with its target's ids qualified, and the method of each command answered. */
export const qualifyIncoming = (message: Json, pageProxyId: string, answering: Map<string, string>): Json => {
  if (message.method !== "Target.dispatchMessageFromTarget") return message
  const prefix = prefixOf(pageProxyId, message.params.targetId)
  const change: Change = (id) => `${prefix}${id}`
  const inner = JSON.parse(message.params.message) as Json
  let changed = inner
  if (typeof inner.method === "string" && inner.params !== undefined) {
    const ids = eventIds[inner.method] ?? (inner.method.startsWith("Network.") ? networkIds : undefined)
    if (ids !== undefined) changed = { ...inner, params: ids(inner.params, change) }
  } else if (inner.id !== undefined) {
    const key = `${message.params.targetId}:${inner.id}`
    const method = answering.get(key)
    answering.delete(key)
    const ids = method === undefined ? undefined : resultIds[method]
    if (ids !== undefined && inner.result !== undefined) changed = { ...inner, result: ids(inner.result, change) }
  }
  return changed === inner ? message : { ...message, params: { ...message.params, message: JSON.stringify(changed) } }
}

/** A command to a target, with the qualification off its ids, as the adapter names them in its parameters. */
export const unqualifyOutgoing = (message: Json, pageProxyId: string, answering: Map<string, string>): Json => {
  if (message.method !== "Target.sendMessageToTarget") return message
  const prefix = prefixOf(pageProxyId, message.params.targetId)
  const change: Change = (id) => id.startsWith(prefix) ? id.slice(prefix.length) : id
  const inner = JSON.parse(message.params.message) as Json
  if (resultIds[inner.method] !== undefined) answering.set(`${message.params.targetId}:${inner.id}`, inner.method)
  if (inner.params === undefined) return message
  const params = named(inner.params, ["frameId", "requestId", "loaderId"], change)
  return { ...message, params: { ...message.params, message: JSON.stringify({ ...inner, params }) } }
}

interface Options {
  /** Headers for the list's requests and each page's handshake. */
  readonly headers?: Readonly<Record<string, string>> | undefined
  /** How often the list is read for pages that arrived. */
  readonly poll: Duration.Input
}

/** The transport to an inspector server at `endpoint`, `http://host:port`, until the scope closes. */
export const connect = Effect.fnUntraced(function*(endpoint: URL, options: Options) {
  const scope = yield* Effect.scope
  const constructor = yield* Socket.WebSocketConstructor
  const incoming = yield* Queue.unbounded<string>()
  const lost = Deferred.makeUnsafe<Transport.ConnectionLost>()
  const pages = new Map<string, Transport.Transport>()
  // Each command whose result carries ids, by its target and id, until it's answered
  const answering = new Map<string, string>()
  const deliver = (message: Record<string, unknown>) => Queue.offerUnsafe(incoming, JSON.stringify(message))
  const http = (yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))).pipe(
    HttpClient.filterStatusOk
  )
  const list = http.execute(
    HttpClientRequest.get(new URL("/", endpoint).href).pipe(HttpClientRequest.setHeaders(options.headers ?? {}))
  ).pipe(Effect.flatMap((response) => response.text), Effect.map(pagesOf))

  const unanswered = (error: { readonly message: string }) =>
    Deferred.succeed(
      lost,
      new Transport.ConnectionLost({
        initiator: "remote",
        description: `The inspector server stopped answering: ${error.message}`
      })
    )

  // A page's WebSocket: its messages in Playwright's envelope, then its end
  const attach = Effect.fnUntraced(function*(path: string) {
    const pageProxyId = pageProxyIdOf(path)
    const own = yield* Scope.fork(scope)
    const url = new URL(`/${path}`, endpoint)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const transport = yield* Transport.webSocket(
      url.href,
      options.headers === undefined ? {} : {
        headers: options.headers
      }
    ).pipe(Scope.provide(own), Effect.provideService(Socket.WebSocketConstructor, constructor), Effect.option)
    if (transport._tag === "None") return yield* Scope.close(own, Exit.void)
    pages.set(pageProxyId, transport.value)
    deliver({ method: "Playwright.pageProxyCreated", params: { pageProxyId, browserContextId: "default" } })
    yield* transport.value.messages.pipe(
      Stream.runForEach((text) =>
        Effect.sync(() => {
          deliver({ ...qualifyIncoming(JSON.parse(text) as Json, pageProxyId, answering), pageProxyId })
        })
      ),
      Effect.ignore,
      // A page's WebSocket closes with its page, and with the browser: the list says which, unless the connection
      // ended first, and within a second, so a server that hangs can't hold the scope's close
      Effect.ensuring(Effect.gen(function*() {
        pages.delete(pageProxyId)
        if (yield* Deferred.isDone(lost)) return yield* Scope.close(own, Exit.void)
        const listed = yield* Effect.exit(Effect.timeout(list, "1 second"))
        if (Exit.isFailure(listed)) {
          yield* unanswered({ message: "a page's WebSocket closed, and the list can't be read" })
        } else {
          deliver({ method: "Playwright.pageProxyDestroyed", params: { pageProxyId } })
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
  // The list is read once now, so an endpoint that isn't an inspector server fails the connection
  yield* list.pipe(Effect.mapError((error) =>
    new Transport.TransportError({
      reason: new Transport.ConnectFailed({ description: `${endpoint.href} listed no pages: ${error.message}` })
    })
  ))
  yield* Effect.addFinalizer(() =>
    Deferred.succeed(lost, new Transport.ConnectionLost({ initiator: "local", description: "The scope closed" }))
  )

  // The pages open now, announced before the reply, then the ones that arrive
  let enabled = false
  const enable = (id: unknown) =>
    Effect.gen(function*() {
      if (!enabled) {
        enabled = true
        yield* poll
        yield* Effect.forkIn(
          poll.pipe(Effect.delay(options.poll), Effect.forever, Effect.catch(unanswered)),
          scope
        )
      }
      deliver({ id, result: {} })
    }).pipe(Effect.catch((error) =>
      unanswered(error).pipe(Effect.andThen(Effect.sync(() => {
        deliver({ id, error: { code: -32000, message: error.message } })
      })))
    ))

  const send = (text: string): Effect.Effect<void, Transport.TransportError> =>
    Effect.suspend(() => {
      const message = JSON.parse(text) as Record<string, unknown>
      const { pageProxyId, ...rest } = message
      if (typeof pageProxyId !== "string") {
        if (message.method === "Playwright.enable") return enable(message.id)
        deliver({ id: message.id, error: { code: -32601, message: `'${String(message.method)}' was not found` } })
        return Effect.void
      }
      const page = pages.get(pageProxyId)
      if (page === undefined) {
        deliver({
          id: message.id,
          pageProxyId,
          error: { code: -32602, message: "Cannot find page proxy with provided 'pageProxyId'" }
        })
        return Effect.void
      }
      return page.send(JSON.stringify(unqualifyOutgoing(rest, pageProxyId, answering)))
    })

  return {
    send,
    messages: Stream.fromQueue(incoming).pipe(Stream.interruptWhen(Deferred.await(lost))),
    closed: Deferred.await(lost)
  } satisfies Transport.Transport
}) as (endpoint: URL, options: Options) => Effect.Effect<
  Transport.Transport,
  Transport.TransportError,
  Scope.Scope | Socket.WebSocketConstructor
>
