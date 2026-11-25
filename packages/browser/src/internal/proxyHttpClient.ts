/**
 * The HTTP client endpoint discovery asks through: `fetch`, unless the environment names a proxy for the request's
 * URL, as `curl` and Playwright read it. `http_proxy` or `HTTP_PROXY` serves `http:` URLs, sent to the proxy in
 * absolute form with the URL's `Host`; `https_proxy` or `HTTPS_PROXY` serves `https:` URLs, tunneled through a
 * `CONNECT`, with TLS to the endpoint inside it. `no_proxy` or `NO_PROXY` lists the hosts asked directly. A proxy
 * URL's credentials go as `Proxy-Authorization`. Only a discovery's requests go this way: they have no body, and
 * the answer streams, so its reader bounds what it reads. The browser's WebSocket isn't proxied.
 */
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as http from "node:http"
import * as https from "node:https"
import type * as net from "node:net"
import * as stream from "node:stream"
import * as tls from "node:tls"

const defaultPort = (url: URL) => url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80"

/**
 * Whether `noProxy`, a list separated by commas or spaces, names the URL's host, as Playwright reads it: `*` names
 * every host; an entry with a port names only that port; an entry starting with `.` names the hosts ending with
 * it, so `.example.com` names `www.example.com` but not `example.com`; an entry starting with `*` names the hosts
 * ending with the rest, so `*example.com` names `myexample.com` too; and any other entry names only that host.
 */
export const bypasses = (noProxy: string, url: URL): boolean => {
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1")
  const port = defaultPort(url)
  return noProxy.toLowerCase().split(/[,\s]+/).some((entry) => {
    if (entry === "") return false
    if (entry === "*") return true
    const parsed = /^(.+):(\d+)$/.exec(entry)
    const host = (parsed?.[1] ?? entry).replace(/^\[(.*)\]$/, "$1")
    if (parsed !== null && parsed[2] !== port) return false
    if (!/^[.*]/.test(host)) return hostname === host
    return hostname.endsWith(host.startsWith("*") ? host.slice(1) : host)
  })
}

/** The first of the names the environment sets, lower-case first; a value that doesn't read is unset. */
const variable = (name: string): Effect.Effect<string | undefined> =>
  Effect.gen(function*() {
    const lower = yield* Config.option(Config.String(name))
    const upper = yield* Config.option(Config.String(name.toUpperCase()))
    return Option.getOrUndefined(Option.orElse(Option.filter(lower, (value) => value !== ""), () => upper))
  }).pipe(Effect.orElseSucceed(() => undefined))

/** The proxy the environment names for a URL, if any. */
const proxyFor = (url: URL): Effect.Effect<URL | undefined> =>
  Effect.gen(function*() {
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    const proxy = yield* variable(url.protocol === "https:" ? "https_proxy" : "http_proxy")
    if (proxy === undefined || proxy === "") return undefined
    const noProxy = yield* variable("no_proxy")
    if (noProxy !== undefined && bypasses(noProxy, url)) return undefined
    return URL.parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(proxy) ? proxy : `http://${proxy}`) ?? undefined
  })

const transportError = (request: HttpClientRequest.HttpClientRequest, description: string, cause?: unknown) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, description, cause })
  })

/** What a proxy URL adds to every request sent to it: its credentials. */
const proxyHeaders = (proxy: URL): Record<string, string> =>
  proxy.username === ""
    ? {}
    : {
      "proxy-authorization": `Basic ${
        Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")
      }`
    }

const proxyOptions = (proxy: URL) => ({
  host: proxy.hostname.replace(/^\[(.*)\]$/, "$1"),
  port: defaultPort(proxy),
  agent: false as const
})

/** Statuses whose responses have no body, which a web `Response` refuses one for. */
const nullBody = new Set([101, 204, 205, 304])

/** A response as a web `Response` whose body streams from the socket, and whose cancellation destroys it. */
const toResponse = (request: HttpClientRequest.HttpClientRequest, response: http.IncomingMessage) => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue
    for (const each of Array.isArray(value) ? value : [value]) headers.append(name, each)
  }
  const status = response.statusCode ?? 0
  if (nullBody.has(status)) response.destroy()
  const body = nullBody.has(status) ? null : stream.Readable.toWeb(response) as ReadableStream<Uint8Array>
  return HttpClientResponse.fromWeb(request, new Response(body, { status, headers }))
}

/**
 * A request sent through `proxy`: in absolute form for `http:`; for `https:`, through a `CONNECT` tunnel, inside
 * which TLS to the endpoint, checked against the endpoint's name, carries the request. Interrupting it destroys
 * its sockets.
 */
const viaProxy = (request: HttpClientRequest.HttpClientRequest, url: URL, proxy: URL, signal: AbortSignal) =>
  Effect.callback<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>((resume) => {
    let done = false
    const settle = (effect: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>) => {
      if (done) return
      done = true
      resume(effect)
    }
    const fail = (description: string, cause?: unknown) =>
      settle(Effect.fail(transportError(request, `${description} (proxy ${proxy.host})`, cause)))
    const sockets: Array<{ destroy: () => void }> = []
    const send = proxy.protocol === "https:" ? https.request : http.request
    const headers = { ...request.headers, host: url.host }
    if (url.protocol === "http:") {
      const sent = send({
        ...proxyOptions(proxy),
        method: request.method,
        path: url.href,
        headers: { ...headers, ...proxyHeaders(proxy) },
        signal
      })
      sockets.push(sent)
      sent.on("response", (response) => settle(Effect.succeed(toResponse(request, response))))
      sent.on("error", (cause) => fail(cause.message, cause))
      sent.end()
    } else {
      const authority = `${url.hostname}:${defaultPort(url)}`
      const tunnel = send({
        ...proxyOptions(proxy),
        method: "CONNECT",
        path: authority,
        headers: { host: authority, ...proxyHeaders(proxy) },
        signal
      })
      sockets.push(tunnel)
      tunnel.on("connect", (answer: http.IncomingMessage, socket: net.Socket) => {
        sockets.push(socket)
        if (answer.statusCode !== 200) {
          socket.destroy()
          return fail(`the proxy answered CONNECT ${authority} with ${answer.statusCode}`)
        }
        const secure = tls.connect({ socket, servername: url.hostname.replace(/^\[(.*)\]$/, "$1") })
        sockets.push(secure)
        secure.on("error", (cause) => fail(cause.message, cause))
        // The request is written over the tunnel's TLS socket: plain HTTP framing, which the socket encrypts
        const sent = http.request({
          method: request.method,
          path: `${url.pathname}${url.search}`,
          headers,
          createConnection: () => secure,
          signal
        })
        sockets.push(sent)
        sent.on("response", (response) => settle(Effect.succeed(toResponse(request, response))))
        sent.on("error", (cause) => fail(cause.message, cause))
        sent.end()
      })
      tunnel.on("error", (cause) => fail(cause.message, cause))
      tunnel.end()
    }
    return Effect.sync(() => {
      if (done) return
      done = true
      for (const socket of sockets) socket.destroy()
    })
  })

const redirects = new Set([301, 302, 303, 307, 308])

/** How many redirects a discovery follows, as `fetch` does. */
const maxRedirects = 20

/**
 * The discovery client: `fetch`'s, from `FetchHttpClient`, with a request the environment names a proxy for sent
 * through that proxy instead. Through a proxy, redirects are followed as `fetch` follows them, each hop asked
 * through the proxy its URL calls for, unless `FetchHttpClient.RequestInit` sets `redirect: "manual"`.
 */
export const layer: Layer.Layer<HttpClient.HttpClient> = Layer.effect(HttpClient.HttpClient)(
  Effect.map(
    Effect.service(HttpClient.HttpClient),
    (direct) =>
      HttpClient.make((request, url, signal) =>
        Effect.gen(function*() {
          const init = yield* Effect.serviceOption(FetchHttpClient.RequestInit)
          const manual = Option.isSome(init) && init.value.redirect === "manual"
          let current = request
          let target = url
          for (let hop = 0;; hop++) {
            const proxy = yield* proxyFor(target)
            if (proxy === undefined) return yield* direct.execute(current)
            const response = yield* viaProxy(current, target, proxy, signal)
            const location = response.headers.location
            if (manual || !redirects.has(response.status) || location === undefined) return response
            if (hop === maxRedirects) {
              return yield* Effect.fail(transportError(request, `more than ${maxRedirects} redirects`))
            }
            yield* Effect.ignore(response.stream.pipe(Stream.runDrain))
            target = new URL(location, target)
            current = HttpClientRequest.setUrl(current, target.href)
          }
        })
      )
  )
).pipe(Layer.provide(FetchHttpClient.layer))
