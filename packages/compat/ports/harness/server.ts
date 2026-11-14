/**
 * The fixture server, named as Playwright's and Puppeteer's test servers are, so a port reads like its original:
 * `server.PREFIX` is `http://localhost:<port>` and `server.CROSS_PROCESS_PREFIX` is `http://127.0.0.1:<port>`. They
 * are different sites, so a browser that isolates sites puts a frame from one inside a page from the other in a
 * process of its own, as it does on the web.
 *
 * It serves a source's vendored assets (`sources/<source>/assets`), each checked against its SHA-256 in
 * `assets.json` the first time it's served. An asset that isn't vendored is a 404 the server remembers, so a failing
 * port says which file to vendor (`pnpm compat:ledger vendor`).
 */
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as http from "node:http"
import * as https from "node:https"
import type * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import type * as Stream from "node:stream"
import * as zlib from "node:zlib"
import { openssl } from "../../../browser/test/integration/browsers.ts"
import { accept, type WebSocketPeer } from "./webSocket.ts"

export type { WebSocketPeer } from "./webSocket.ts"

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".avif": "image/avif"
}

/** A request the server received. */
export interface Received {
  readonly method: string
  readonly path: string
  readonly headers: http.IncomingHttpHeaders
  /** The header fields as received, alternating names and values, repeats and case kept (Node's `rawHeaders`). */
  readonly rawHeaders: ReadonlyArray<string>
  readonly body: Buffer
}

/**
 * A request as a route sees it, as Playwright's server gives it: the route runs as the request arrives, and
 * `postBody` is its body once the request ends.
 */
export type RouteRequest = http.IncomingMessage & { readonly postBody: Promise<Buffer> }

export type Handler = (request: RouteRequest, response: http.ServerResponse) => void

export interface ServerShape {
  readonly PORT: number
  /** `http://localhost:<port>` */
  readonly PREFIX: string
  /** `http://127.0.0.1:<port>`: another site than `PREFIX`. */
  readonly CROSS_PROCESS_PREFIX: string
  /** `PREFIX + "/empty.html"`, an empty document. */
  readonly EMPTY_PAGE: string
  /**
   * The same routes and assets over TLS, Playwright's `httpsServer`: `https://localhost:<port>`, and
   * `https://127.0.0.1:<port>` across sites. Its certificate is self-signed for both names, so a browser trusts it only
   * when told to accept insecure certificates.
   */
  readonly https: {
    readonly PORT: number
    readonly PREFIX: string
    readonly CROSS_PROCESS_PREFIX: string
    readonly EMPTY_PAGE: string
  }
  /** Answer `path` with `handler` instead of an asset, until the next test. A path with a query matches only that query. */
  readonly setRoute: (path: string, handler: Handler) => void
  /**
   * Require Basic credentials for `path`, until the next test: a request without them gets a `401` with a
   * `WWW-Authenticate` challenge, as Playwright's `setAuth`; one with them is answered as usual.
   */
  readonly setAuth: (path: string, username: string, password: string) => void
  /** Redirect `from` to `to` with a 302, until the next test. */
  readonly setRedirect: (from: string, to: string) => void
  /** Serve the asset at `path` gzip-compressed, as Playwright's `enableGzip`, until the next test. */
  readonly enableGzip: (path: string) => void
  /** Add headers to `path`'s response, until the next test. */
  readonly setExtraHeaders: (path: string, headers: Record<string, string>) => void
  /**
   * Starts listening for the next request for `path`, now: the Effect it returns waits for it. Listen before the
   * action that sends it.
   */
  readonly waitForRequest: (path: string) => Effect.Effect<Effect.Effect<Received>>
  /**
   * Calls `handler` with the next WebSocket connection, to either server, as Playwright's `onceWebSocketConnection`.
   * As Playwright's server, `/ws` is accepted, `/ws-slow` after two seconds, `/ws-401` answered 401, and any other
   * path 400. A connection no handler takes stays open and ignores what it receives.
   */
  readonly onceWebSocketConnection: (handler: (peer: WebSocketPeer) => void) => void
  /**
   * Starts listening for the next WebSocket connection, now: the Effect it returns waits for it. Its `request` is
   * Playwright's `waitForWebSocketConnectionRequest`. Listen before the action that connects.
   */
  readonly waitForWebSocket: Effect.Effect<Effect.Effect<WebSocketPeer>>
  /**
   * Starts holding the next WebSocket upgrade, now, as Playwright's `waitForUpgrade`: the Effect it returns gives its
   * socket and `doUpgrade`, which accepts it. Until then the page's WebSocket is still connecting.
   */
  readonly waitForUpgrade: Effect.Effect<
    Effect.Effect<{ readonly socket: Stream.Duplex; readonly doUpgrade: () => void }>
  >
  /** Sends `data` on the next WebSocket connection as soon as it opens, as Playwright's `sendOnWebSocketConnection`. */
  readonly sendOnWebSocketConnection: (data: string | Uint8Array) => void
  /** Every request since the last reset. */
  readonly requests: ReadonlyArray<Received>
  /** Assets requested that aren't vendored, since the last reset. */
  readonly missing: ReadonlyArray<string>
  readonly reset: Effect.Effect<void>
}

export class Server extends Context.Service<Server, ServerShape>()("@usestrider/compat/Server") {}

const sha = (content: Buffer) => createHash("sha256").update(content).digest("hex")

/** The server for one source's assets, for the layer's scope. */
export const layer = (source: string): Layer.Layer<Server> =>
  Layer.effect(
    Server,
    Effect.gen(function*() {
      const directory = path.resolve(import.meta.dirname, "../../sources", source)
      const manifestPath = path.join(directory, "assets.json")
      const manifest: Record<string, string> = fs.existsSync(manifestPath)
        ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
        : {}
      const verified = new Set<string>()
      const routes = new Map<string, Handler>()
      const auths = new Map<string, string>()
      const redirects = new Map<string, string>()
      const extraHeaders = new Map<string, Record<string, string>>()
      const gzipped = new Set<string>()
      const waiting = new Map<string, Array<Deferred.Deferred<Received>>>()
      const requests: Array<Received> = []
      const missing: Array<string> = []
      const connectionHandlers: Array<(peer: WebSocketPeer) => void> = []
      const peers = new Set<WebSocketPeer>()

      let upgradeHolder: ((held: { socket: Stream.Duplex; doUpgrade: () => void }) => void) | undefined

      const upgrade = (request: http.IncomingMessage, socket: Stream.Duplex, head: Buffer) => {
        const doUpgrade = () => {
          const peer = accept(request, socket, head)
          peers.add(peer)
          peer.onClose(() => peers.delete(peer))
          // Each handler takes one connection, as `once` listeners do: every one waiting takes this one
          for (const handler of connectionHandlers.splice(0)) handler(peer)
        }
        if (upgradeHolder !== undefined) {
          const hold = upgradeHolder
          upgradeHolder = undefined
          return hold({ socket, doUpgrade })
        }
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname
        if (pathname === "/ws-401") {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\nUnauthorized body")
          return socket.destroy()
        }
        if (pathname !== "/ws" && pathname !== "/ws-slow") {
          socket.write("HTTP/1.1 400 Bad Request\r\n\r\n")
          return socket.destroy()
        }
        if (pathname === "/ws-slow") setTimeout(doUpgrade, 2000)
        else doUpgrade()
      }

      const startTime = new Date()
      const serveAsset = (
        pathname: string,
        response: http.ServerResponse,
        ifModifiedSince: string | undefined
      ) => {
        const relative = decodeURIComponent(pathname).replace(/^\/+/, "")
        const expected = manifest[relative]
        if (expected === undefined) {
          missing.push(relative)
          response.writeHead(404, { "content-type": "text/plain" }).end(`${relative} isn't vendored`)
          return
        }
        const content = fs.readFileSync(path.join(directory, "assets", relative))
        if (!verified.has(relative)) {
          if (sha(content) !== expected) throw new Error(`${source} asset ${relative} doesn't match its SHA-256`)
          verified.add(relative)
        }
        // Puppeteer's server calls `enableHTTPCache` on `assets/cached`: those files are cacheable for a year, and a
        // request that revalidates with `If-Modified-Since` gets a 304. Everything else is served uncached. The
        // `no-cache` directive Playwright's server adds is left off: with it Chromium revalidates the stylesheet on a
        // reload too, where Puppeteer's test expects it served from the cache.
        const cached = source === "puppeteer" && relative.startsWith("cached/")
        if (cached && ifModifiedSince !== undefined) {
          response.writeHead(304).end()
          return
        }
        const headers = {
          "content-type": types[path.extname(relative)] ?? "application/octet-stream",
          ...(cached
            ? { "cache-control": "public, max-age=31536000", "last-modified": startTime.toISOString() }
            : { "cache-control": "no-cache, no-store" })
        }
        if (gzipped.has(pathname)) {
          response.writeHead(200, { ...headers, "content-encoding": "gzip" }).end(zlib.gzipSync(content))
          return
        }
        response.writeHead(200, headers).end(content)
      }

      const handle = (incoming: http.IncomingMessage, response: http.ServerResponse) => {
        // A connection the page drops, or a route destroys, ends the request with an error that isn't the test's
        incoming.on("error", () => response.end())
        const chunks: Array<Buffer> = []
        const request = Object.assign(incoming, {
          postBody: new Promise<Buffer>((resolve) => {
            incoming.on("data", (chunk: Buffer) => chunks.push(chunk))
            incoming.on("end", () => resolve(Buffer.concat(chunks)))
          })
        })
        const url = new URL(request.url ?? "/", "http://localhost")
        // As Playwright's server, a path registered with its query matches only that query; one without matches any
        const withQuery = url.pathname + url.search
        const keyOf = (map: Map<string, unknown>) => map.has(withQuery) ? withQuery : url.pathname
        const listeners = waiting.get(keyOf(waiting)) ?? []
        waiting.delete(keyOf(waiting))
        // The route runs as the request arrives, as Playwright's does: it can answer before an upload ends, or drop it
        for (const [name, value] of Object.entries(extraHeaders.get(keyOf(extraHeaders)) ?? {})) {
          response.setHeader(name, value)
        }
        const auth = auths.get(keyOf(auths))
        const credentials = Buffer.from((request.headers.authorization ?? "").split(" ")[1] ?? "", "base64").toString()
        const redirect = redirects.get(keyOf(redirects))
        const route = routes.get(keyOf(routes))
        if (auth !== undefined && credentials !== auth) {
          response.writeHead(401, { "WWW-Authenticate": "Basic realm=\"Secure Area\"" })
            .end("HTTP Error 401 Unauthorized: Access is denied")
        } else if (redirect !== undefined) response.writeHead(302, { location: redirect }).end()
        else if (route !== undefined) route(request, response)
        else if (url.pathname === "/empty.html" && manifest["empty.html"] === undefined) {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("")
        } else serveAsset(url.pathname, response, request.headers["if-modified-since"])
        // The request is recorded, and its waiters wake, once its body has arrived: after the route's synchronous
        // work, as a Playwright test awaiting `waitForRequest` resumes after its server has called the route
        void request.postBody.then((body) => {
          const received: Received = {
            method: request.method ?? "GET",
            path: url.pathname + url.search,
            headers: request.headers,
            rawHeaders: request.rawHeaders,
            body
          }
          requests.push(received)
          for (const listener of listeners) Deferred.doneUnsafe(listener, Effect.succeed(received))
        })
      }

      const listen = (server: http.Server | https.Server) =>
        Effect.acquireRelease(
          Effect.callback<number>((resume) => {
            server.listen(0, "127.0.0.1", () => resume(Effect.succeed((server.address() as net.AddressInfo).port)))
          }),
          () =>
            Effect.callback<void>((resume) => {
              server.closeAllConnections()
              server.close(() => resume(Effect.void))
            })
        )

      const port = yield* listen(http.createServer(handle).on("upgrade", upgrade))

      // A self-signed certificate for both test hostnames, made with the Nix environment's OpenSSL for the scope
      const certificate = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-compat-tls-"))
          const key = path.join(directory, "key.pem")
          const cert = path.join(directory, "cert.pem")
          execFileSync(openssl, [
            "req",
            "-x509",
            "-newkey",
            "ec",
            "-pkeyopt",
            "ec_paramgen_curve:prime256v1",
            "-nodes",
            "-keyout",
            key,
            "-out",
            cert,
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=DNS:localhost,IP:127.0.0.1"
          ], { stdio: "ignore" })
          return { directory, key: fs.readFileSync(key), cert: fs.readFileSync(cert) }
        }),
        ({ directory }) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
      )
      const httpsPort = yield* listen(
        https.createServer({ key: certificate.key, cert: certificate.cert }, handle).on("upgrade", upgrade)
      )

      const shape: ServerShape = {
        PORT: port,
        PREFIX: `http://localhost:${port}`,
        CROSS_PROCESS_PREFIX: `http://127.0.0.1:${port}`,
        EMPTY_PAGE: `http://localhost:${port}/empty.html`,
        https: {
          PORT: httpsPort,
          PREFIX: `https://localhost:${httpsPort}`,
          CROSS_PROCESS_PREFIX: `https://127.0.0.1:${httpsPort}`,
          EMPTY_PAGE: `https://localhost:${httpsPort}/empty.html`
        },
        setRoute: (path, handler) => routes.set(path, handler),
        setAuth: (path, username, password) => auths.set(path, `${username}:${password}`),
        setRedirect: (from, to) => redirects.set(from, to),
        setExtraHeaders: (path, headers) => extraHeaders.set(path, headers),
        enableGzip: (path) => {
          gzipped.add(path)
        },
        waitForRequest: Effect.fnUntraced(function*(path: string) {
          const received = yield* Deferred.make<Received>()
          waiting.set(path, [...(waiting.get(path) ?? []), received])
          return Deferred.await(received)
        }),
        onceWebSocketConnection: (handler) => {
          connectionHandlers.push(handler)
        },
        waitForWebSocket: Effect.gen(function*() {
          const connected = yield* Deferred.make<WebSocketPeer>()
          connectionHandlers.push((peer) => Deferred.doneUnsafe(connected, Effect.succeed(peer)))
          return Deferred.await(connected)
        }),
        waitForUpgrade: Effect.gen(function*() {
          const held = yield* Deferred.make<{ readonly socket: Stream.Duplex; readonly doUpgrade: () => void }>()
          upgradeHolder = (upgrade) => Deferred.doneUnsafe(held, Effect.succeed(upgrade))
          return Deferred.await(held)
        }),
        sendOnWebSocketConnection: (data) => {
          connectionHandlers.push((peer) => peer.send(data))
        },
        get requests() {
          return requests
        },
        get missing() {
          return missing
        },
        reset: Effect.sync(() => {
          routes.clear()
          auths.clear()
          redirects.clear()
          extraHeaders.clear()
          gzipped.clear()
          waiting.clear()
          connectionHandlers.length = 0
          upgradeHolder = undefined
          // A connection from the last test's page goes with it
          for (const peer of peers) peer.terminate()
          peers.clear()
          requests.length = 0
          missing.length = 0
        })
      }
      return shape
    })
  )
