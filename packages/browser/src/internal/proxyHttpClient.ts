/**
 * The HTTP client endpoint discovery asks through: `fetch`, unless the environment names a proxy for the request's
 * URL, as `curl` and Playwright read it. `http_proxy` or `HTTP_PROXY` serves `http:` URLs, sent to the proxy in
 * absolute form with the URL's `Host`; `https_proxy` or `HTTPS_PROXY` serves `https:` URLs, tunneled through a
 * `CONNECT`, with TLS to the endpoint inside it. `no_proxy` or `NO_PROXY` lists the hosts asked directly. A proxy
 * URL's credentials go as `Proxy-Authorization`. Only a discovery's requests go this way: they have no body, and
 * the answer is read whole. The browser's WebSocket isn't proxied.
 */
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import type * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as http from "node:http"
import * as https from "node:https"
import type * as net from "node:net"
import * as tls from "node:tls"

const defaultPort = (url: URL) => url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80"

/**
 * Whether `noProxy`, a list separated by commas or spaces, names the URL's host: `*` names every host, an entry
 * starting with `.` or `*.` a domain and its subdomains, any other only that host, and an entry with a port only
 * that port.
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
    if (host.startsWith("*.") || host.startsWith(".")) {
      const suffix = host.replace(/^\*/, "")
      return hostname.endsWith(suffix) || hostname === suffix.slice(1)
    }
    return hostname === host
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

/** A response read whole, as a web `Response`. */
const collect = (
  request: HttpClientRequest.HttpClientRequest,
  response: http.IncomingMessage,
  resume: (effect: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>) => void
) => {
  const chunks: Array<Buffer> = []
  response.on("data", (chunk: Buffer) => chunks.push(chunk))
  response.on("error", (cause) => resume(Effect.fail(transportError(request, cause.message, cause))))
  response.on("end", () => {
    const headers = new Headers()
    for (const [name, value] of Object.entries(response.headers)) {
      if (value === undefined) continue
      for (const each of Array.isArray(value) ? value : [value]) headers.append(name, each)
    }
    const status = response.statusCode ?? 0
    const body = nullBody.has(status) ? null : Buffer.concat(chunks)
    resume(Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status, headers }))))
  })
}

/** A request sent through `proxy`: in absolute form for `http:`, through a `CONNECT` tunnel for `https:`. */
const viaProxy = (request: HttpClientRequest.HttpClientRequest, url: URL, proxy: URL, signal: AbortSignal) =>
  Effect.callback<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>((resume) => {
    const fail = (description: string, cause?: unknown) =>
      resume(Effect.fail(transportError(request, `${description} (proxy ${proxy.host})`, cause)))
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
      sent.on("response", (response) => collect(request, response, resume))
      sent.on("error", (cause) => fail(cause.message, cause))
      sent.end()
      return
    }
    const authority = `${url.hostname}:${defaultPort(url)}`
    const tunnel = send({
      ...proxyOptions(proxy),
      method: "CONNECT",
      path: authority,
      headers: { host: authority, ...proxyHeaders(proxy) },
      signal
    })
    tunnel.on("connect", (answer: http.IncomingMessage, socket: net.Socket) => {
      if (answer.statusCode !== 200) {
        socket.destroy()
        return fail(`the proxy answered CONNECT ${authority} with ${answer.statusCode}`)
      }
      const secure = tls.connect({ socket, servername: url.hostname.replace(/^\[(.*)\]$/, "$1") })
      const sent = https.request({
        host: url.hostname,
        port: defaultPort(url),
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers,
        agent: false,
        createConnection: () => secure,
        signal
      })
      sent.on("response", (response) => collect(request, response, resume))
      sent.on("error", (cause) => fail(cause.message, cause))
      sent.end()
    })
    tunnel.on("error", (cause) => fail(cause.message, cause))
    tunnel.end()
  })

/**
 * The discovery client: `fetch`'s, from `FetchHttpClient`, with a request the environment names a proxy for sent
 * through that proxy instead.
 */
export const layer: Layer.Layer<HttpClient.HttpClient> = Layer.effect(HttpClient.HttpClient)(
  Effect.map(
    Effect.service(HttpClient.HttpClient),
    (direct) =>
      HttpClient.make((request, url, signal) =>
        Effect.flatMap(
          proxyFor(url),
          (proxy) => proxy === undefined ? direct.execute(request) : viaProxy(request, url, proxy, signal)
        )
      )
  )
).pipe(Layer.provide(FetchHttpClient.layer))
