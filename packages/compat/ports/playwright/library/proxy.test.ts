/**
 * Playwright's `tests/library/proxy.spec.ts`: a browser routed through a proxy, with its bypass list, its credentials,
 * the CONNECT and redirect paths through it, and the SOCKS and websocket cases.
 *
 * What the port changes:
 * - The original's `browserType.launch({ proxy })` has no Strider counterpart: `LaunchOptions` has no `proxy`, and the
 *   matrix row `option-browsertype-launch-proxy` is missing. A proxy is a context option (`Browser.newContext({ proxy })`),
 *   so each test that launches with a proxy makes a context with that proxy and opens its pages in it, where the
 *   original opens them on the browser. The routing these tests check is the same; a launch-level proxy would also
 *   apply to contexts the original doesn't create, which none of these tests makes.
 * - The original's `proxyServer` (the fixture server acting as a proxy) is a small HTTP proxy of the port's own, as in
 *   `browsercontext-proxy.test.ts`: it forwards plain requests to `target` and tunnels CONNECT to it, records each
 *   request's URL and each CONNECT's host, and answers 407 unless its auth handler allows the request. Its
 *   `removePrefix` option is the original's `forwardTo(port, { removePrefix })`. The scope closes the server and every
 *   socket it accepted.
 * - Loopback destinations (`localhost`, `127.0.0.1`) stay direct in Strider on every backend (the decision on context
 *   proxy routing). PR-005's loopback variants expect the proxy to see those requests, so they fail, and PR-006 and PR-011
 *   pass for the direct reason. The link-local variants are the original's. PR-005 runs its six variants as the
 *   original does, so no variant is left out.
 * - PR-005 and PR-006's `localhost:${PORT}` and `bypass` strings are Strider's list of hosts: `bypass: [host]`.
 * - PR-010 and PR-035's bypass list is Strider's: Strider takes hostnames and refuses a leading dot, so the original's
 *   `.another.test` (which matches its subdomains) is the exact host the original's last bypassed step visits.
 *   A bypassed host still goes direct; the suffix pattern isn't tested.
 * - `page.goto` waits for `load` by default in Playwright and returns at commit in Strider, so each `goto` names
 *   `waitUntil: "load"`. `page.title()` is `page.title`, and `page.close()` is the end of the scope that opened the page.
 * - `page.evaluate` runs in the page's main world, so PR-017's websocket check is `page.evaluateInMainWorld`.
 * - `ignoreHTTPSErrors` is `acceptInsecureCerts` on the context. Chromium refuses it per context, so PR-008 is
 *   `needsFeature` there, as PR-028 is in `browsercontext-proxy`.
 * - `browser.newPage({ userAgent })` is `Browser.newContext({ emulation: { userAgent } })`.
 * - Credentials are `Redacted`, as Strider's proxy credentials are. Stock WebKit has no proxy credentials, so the tests
 *   that use them are `needsFeature` there.
 * - PR-012, PR-013, and PR-016 use Playwright's SOCKS proxy, and the harness has no SOCKS server. Strider refuses SOCKS
 *   endpoints (`userContexts.proxy.scheme`), so they are not ported.
 * - PR-001 asserts the typed reason of the refused proxy, as `browsercontext-proxy` PR-020 does, where the original
 *   checks Playwright's message.
 * - PR-015 is an upstream `it.fixme`, and it runs as the others do, so its failure is the port's.
 * - PR-017 checks Chromium's and Firefox's CONNECT to the proxy. WebKit sends the websocket as a plain request whose
 *   target is the `ws://` URL, so the port checks that request on WebKit. The original's Windows branch doesn't apply on
 *   this Linux harness, and its Mac 13 skip doesn't either.
 * - The original's `setupSocksForwardingServer` and PR-016's websocket targets need the SOCKS server; see above.
 * - PR-008's `proxyServer.setAuthHandler` sees the CONNECT, as the original's handler does, and refuses the first one.
 *   The refusal ends the socket with 407, as the original's proxy does.
 */
import { assert } from "@effect/vitest"
import { Browser, Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as http from "node:http"
import * as net from "node:net"
import type * as stream from "node:stream"
import { failureOf } from "../../harness/playwright.ts"
import type { ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

/** An HTTP proxy the scope runs: what it saw, and whether it answers a request. */
interface ProxyServer {
  /** The proxy's URL, as the original's `proxyServer.HOST`. */
  readonly HOST: string
  /** The proxy's port, as the original's `proxyServer.PORT`. */
  readonly PORT: number
  /** Each request's URL, as the client wrote it. */
  readonly requestUrls: Array<string>
  /** Each CONNECT's `host:port`. */
  readonly connectHosts: Array<string>
  /** Answers a request with 407 unless this returns true: the original's `setAuthHandler`. */
  readonly setAuthHandler: (handler: (request: http.IncomingMessage) => boolean) => void
  /** The Node server, which the scope closes. */
  readonly server: http.Server
  /** The CONNECT tunnels' sockets, which the scope destroys. */
  readonly sockets: Set<stream.Duplex>
}

/**
 * An HTTP proxy for the scope. It forwards each request to `target` on 127.0.0.1, and each CONNECT by tunneling to
 * `target`, so the page's requests for other hosts reach the fixture server. `removePrefix` drops a path prefix before
 * forwarding, as the original's `forwardTo` does.
 */
const proxyServer = (target: number, options: { readonly removePrefix?: string | undefined } = {}) =>
  Effect.acquireRelease(
    Effect.callback<ProxyServer>((resume) => {
      const requestUrls: Array<string> = []
      const connectHosts: Array<string> = []
      // CONNECT tunnels leave the HTTP server, so its close doesn't end them: the scope destroys each one
      const sockets = new Set<stream.Duplex>()
      let authorize: (request: http.IncomingMessage) => boolean = () => true
      const server = http.createServer((request, response) => {
        requestUrls.push(request.url ?? "")
        if (!authorize(request)) {
          response.writeHead(407, { "Proxy-Authenticate": "Basic realm=\"Dummy\"" }).end()
          return
        }
        const url = new URL(request.url ?? "/")
        const prefix = options.removePrefix
        const pathname = prefix !== undefined && url.pathname.startsWith(prefix)
          ? url.pathname.slice(prefix.length)
          : url.pathname
        const forward = http.request({
          host: "127.0.0.1",
          port: target,
          method: request.method,
          path: pathname + url.search,
          headers: request.headers
        }, (reply) => {
          response.writeHead(reply.statusCode ?? 502, reply.headers)
          reply.pipe(response)
        })
        forward.on("error", () => response.destroy())
        request.pipe(forward)
      })
      server.on("connect", (request, socket, head) => {
        connectHosts.push(request.url ?? "")
        // Tracked before the auth check, so a refused CONNECT's socket is destroyed too
        sockets.add(socket)
        socket.on("close", () => sockets.delete(socket))
        if (!authorize(request)) {
          socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Dummy\"\r\n\r\n")
          return
        }
        const tunnel = net.connect(target, "127.0.0.1", () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
          tunnel.write(head)
          tunnel.pipe(socket)
          socket.pipe(tunnel)
        })
        sockets.add(tunnel)
        tunnel.on("close", () => sockets.delete(tunnel))
        tunnel.on("error", () => socket.destroy())
        socket.on("error", () => tunnel.destroy())
      })
      server.listen(0, () => {
        const port = (server.address() as net.AddressInfo).port
        resume(Effect.succeed({
          sockets,
          HOST: `http://localhost:${port}`,
          PORT: port,
          requestUrls,
          connectHosts,
          setAuthHandler: (handler) => {
            authorize = handler
          },
          server
        }))
      })
    }),
    ({ server, sockets }) =>
      Effect.callback<void>((resume) => {
        for (const socket of sockets) socket.destroy()
        server.closeAllConnections()
        server.close(() => resume(Effect.void))
      })
  )

/** A raw TCP server for PR-015: it records the first bytes of each connection, then ends it. The scope closes it. */
interface RawProxy {
  /** The server's port. */
  readonly port: number
  /** The first bytes each connection sent, in order. */
  readonly requestTexts: Array<string>
  /** The Node server, which the scope closes. */
  readonly server: net.Server
  /** Each accepted connection, which the scope destroys. */
  readonly sockets: Set<net.Socket>
}

const rawProxy = Effect.acquireRelease(
  Effect.callback<RawProxy>((resume) => {
    const requestTexts: Array<string> = []
    const sockets = new Set<net.Socket>()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
      socket.on("data", (data) => {
        requestTexts.push(data.toString())
        socket.end()
      })
    })
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port
      resume(Effect.succeed({ port, requestTexts, server, sockets }))
    })
  }),
  ({ server, sockets }) =>
    Effect.callback<void>((resume) => {
      for (const socket of sockets) socket.destroy()
      server.close(() => resume(Effect.void))
    })
)

/** Playwright's `beforeEach` route: the page the proxy's requests reach. */
const serveTarget = (server: ServerShape) =>
  server.setRoute("/target.html", (_request, response) => {
    response.end("<html><title>Served by the proxy</title></html>")
  })

/** `Basic` credentials as a proxy's `proxy-authorization` header carries them. */
const basic = (user: string, password: string) => "Basic " + Buffer.from(`${user}:${password}`).toString("base64")

upstream(import.meta.filename, {}, (test) => {
  test("PR-001", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      // Strider's proxy setting is typed, so the port passes the wrong type through `as never`
      const error = yield* failureOf(Browser.newContext({ proxy: { server: 123 as never } }))
      assert(
        error._tag === "UserContextError" && error.reason._tag === "InvalidInput",
        `failed for another reason: ${error._tag === "UserContextError" ? error.reason._tag : error._tag}`
      )
      assert.strictEqual(error.reason.input, "proxy")
    })))

  test("PR-002", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({ proxy: { server: proxy.HOST } })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.title, "Served by the proxy")
    })))

  test("PR-003", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({ proxy: { server: `localhost:${proxy.PORT}` } })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.title, "Served by the proxy")

      const page2 = yield* context.newPage
      yield* page2.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.strictEqual(yield* page2.title, "Served by the proxy")
    })))

  test("PR-004", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({ proxy: { server: `127.0.0.1:${proxy.PORT}` } })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.title, "Served by the proxy")
    })))

  // The original's "should proxy local network requests" describe block: each variant is one PR-005 expansion
  for (const additionalBypass of [false, true]) {
    for (
      const params of [
        { target: "localhost", description: "localhost" },
        { target: "127.0.0.1", description: "loopback address" },
        { target: "169.254.3.4", description: "link-local" }
      ]
    ) {
      test("PR-005", {
        page: false,
        variant: `${additionalBypass ? "with other bypasses" : "by default"}, ${params.description}`
      }, ({ server }) =>
        Effect.scoped(Effect.gen(function*() {
          const path = `/target-${additionalBypass}-${params.target}.html`
          server.setRoute(path, (_request, response) => {
            response.end("<html><title>Served by the proxy</title></html>")
          })
          const url = `http://${params.target}:55555${path}`
          const proxy = yield* proxyServer(server.PORT)
          const context = yield* Browser.newContext({
            proxy: {
              server: `localhost:${proxy.PORT}`,
              bypass: additionalBypass ? ["1.non.existent.domain.for.the.test"] : undefined
            }
          })
          const page = yield* context.newPage
          yield* page.goto(url, { waitUntil: "load" })
          assert.include(proxy.requestUrls, url)
          assert.strictEqual(yield* page.title, "Served by the proxy")

          yield* page.goto("http://1.non.existent.domain.for.the.test/foo.html", { waitUntil: "load" }).pipe(
            Effect.ignore
          )
          if (additionalBypass) {
            assert.notInclude(proxy.requestUrls, "http://1.non.existent.domain.for.the.test/foo.html")
          } else {
            assert.include(proxy.requestUrls, "http://1.non.existent.domain.for.the.test/foo.html")
          }
        })))
    }
  }

  for (const host of ["localhost", "127.0.0.1"]) {
    test("PR-006", { page: false, variant: host }, ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        server.setRoute("/proxied/target.html", (_request, response) => {
          response.end("<html><title>Served by the server</title></html>")
        })
        serveTarget(server)
        const proxy = yield* proxyServer(server.PORT, { removePrefix: "/proxied" })
        const context = yield* Browser.newContext({ proxy: { server: `localhost:${proxy.PORT}`, bypass: [host] } })
        const page = yield* context.newPage
        yield* page.goto(`http://${host}:${server.PORT}/proxied/target.html`, { waitUntil: "load" })
        assert.strictEqual(yield* page.title, "Served by the server")
      })))
  }

  test("PR-007", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/target.html", (request, response) => {
        const auth = request.headers["proxy-authorization"]
        if (!auth) {
          response.writeHead(407, "Proxy Authentication Required", {
            "Proxy-Authenticate": "Basic realm=\"Access to internal site\""
          })
          response.end()
        } else {
          response.end(`<html><title>${auth}</title></html>`)
        }
      })
      server.setRoute("/protected.html", (request, response) => {
        if (!request.headers["proxy-authorization"]) {
          response.writeHead(407, { "Proxy-Authenticate": "Basic realm=\"Access to internal site\"" })
          response.end()
          return
        }
        response.writeHead(401, { "WWW-Authenticate": "Basic realm=\"site\"" })
        response.end(request.headers["authorization"] || "no credentials")
      })
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({
        proxy: {
          server: proxy.HOST,
          credentials: { username: "user", password: Redacted.make("secret") }
        }
      })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.title, basic("user", "secret"))
      // Proxy credentials must not be sent to the website's own auth challenge. The original's branded Chromium
      // shows a login dialog for the 401 and fails the navigation; Strider's Chromium answers with the 401.
      const navigation = yield* page.goto("http://non-existent.test/protected.html", { waitUntil: "load" })
      assert.strictEqual(navigation._tag, "Committed")
      if (navigation._tag !== "Committed") return
      const response = Option.getOrThrow(navigation.response)
      assert.strictEqual(response.status, 401)
      yield* Expect.toHaveText(page.locator("body"), "no credentials")
    })))

  test("PR-008", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      // Some HTTP proxies send 407 and close the socket on the first CONNECT, expecting the client to reconnect on a
      // new TCP connection with Proxy-Authorization.
      server.setRoute("/target.html", (_request, response) => {
        response.end("<html><title>Served by https server via proxy</title></html>")
      })
      const proxy = yield* proxyServer(server.https.PORT)

      const connectAttempts: Array<{ hadAuth: boolean }> = []
      let closedFirstConnect = false
      proxy.setAuthHandler((request) => {
        // Force the first CONNECT to fail regardless of what the client sends preemptively, to exercise the reconnect
        if (request.method !== "CONNECT" || !request.headers.host?.startsWith("non-existent.test")) return true
        connectAttempts.push({ hadAuth: !!request.headers["proxy-authorization"] })
        if (!closedFirstConnect) {
          closedFirstConnect = true
          return false
        }
        return !!request.headers["proxy-authorization"]
      })

      const context = yield* Browser.newContext({
        proxy: {
          server: proxy.HOST,
          credentials: { username: "user", password: Redacted.make("secret") }
        },
        acceptInsecureCerts: true
      })
      const page = yield* context.newPage
      yield* page.goto("https://non-existent.test/target.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.title, "Served by https server via proxy")
      assert.isAtLeast(connectAttempts.length, 2)
      assert.isTrue(connectAttempts.some((attempt) => attempt.hadAuth))
    })))

  test("PR-009", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const hasAuth = (request: http.IncomingMessage, response: http.ServerResponse) => {
        if (!request.headers["proxy-authorization"]) {
          response.writeHead(407, "Proxy Authentication Required", {
            "Proxy-Authenticate": "Basic realm=\"Access to internal site\""
          })
          response.end()
          return false
        }
        return true
      }
      server.setRoute("/page1.html", (request, response) => {
        if (!hasAuth(request, response)) return
        response.writeHead(302, { location: "/page2.html" })
        response.end()
      })
      server.setRoute("/page2.html", (request, response) => {
        if (!hasAuth(request, response)) return
        response.end("<html><title>Served by the proxy</title></html>")
      })
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({
        proxy: {
          server: proxy.HOST,
          credentials: { username: "user", password: Redacted.make("secret") }
        }
      })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/page1.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.title, "Served by the proxy")
    })))

  test("PR-010", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      // Playwright's bypass is one comma-separated string, with `.another.test` matching its subdomains. Strider takes
      // hostnames in a list and refuses a leading dot, so the bypass names the exact host the original's last bypassed
      // step visits.
      const context = yield* Browser.newContext({
        proxy: {
          server: proxy.HOST,
          bypass: [
            "1.non.existent.domain.for.the.test",
            "2.non.existent.domain.for.the.test",
            "foo.is.the.another.test"
          ]
        }
      })

      // Each page the original closes is a scope here
      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* context.newPage
        yield* page.goto("http://0.non.existent.domain.for.the.test/target.html", { waitUntil: "load" })
        assert.strictEqual(yield* page.title, "Served by the proxy")
      }))

      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* context.newPage
        yield* failureOf(page.goto("http://1.non.existent.domain.for.the.test/target.html", { waitUntil: "load" }))
      }))

      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* context.newPage
        yield* failureOf(page.goto("http://2.non.existent.domain.for.the.test/target.html", { waitUntil: "load" }))
      }))

      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* context.newPage
        yield* failureOf(page.goto("http://foo.is.the.another.test/target.html", { waitUntil: "load" }))
      }))

      yield* Effect.scoped(Effect.gen(function*() {
        const page = yield* context.newPage
        yield* page.goto("http://3.non.existent.domain.for.the.test/target.html", { waitUntil: "load" })
        assert.strictEqual(yield* page.title, "Served by the proxy")
      }))
    })))

  for (const host of ["localhost", "127.0.0.1"]) {
    test("PR-011", { page: false, variant: host }, ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        server.setRoute("/proxied/target.html", (_request, response) => {
          response.end("<html><title>Served by the server</title></html>")
        })
        serveTarget(server)
        const proxy = yield* proxyServer(server.PORT, { removePrefix: "/proxied" })
        const context = yield* Browser.newContext({ proxy: { server: `localhost:${proxy.PORT}`, bypass: [host] } })
        const page = yield* context.newPage
        yield* page.goto(`http://${host}:${server.PORT}/proxied/target.html`, { waitUntil: "load" })
        assert.strictEqual(yield* page.title, "Served by the server")
      })))
  }

  test("PR-014", { page: false }, () => Effect.scoped(Browser.newContext({ proxy: { server: "http://localhost" } })))

  test("PR-015", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      // Playwright's `it.fixme`: the original expects the CONNECT not to carry the emulated user agent yet, and the port
      // runs it as the others do. The proxy is the raw server, which records the CONNECT's first bytes and ends them.
      const raw = yield* rawProxy
      const context = yield* Browser.newContext({
        proxy: { server: `http://127.0.0.1:${raw.port}` },
        emulation: { userAgent: "MyUserAgent" }
      })
      const page = yield* context.newPage
      // HTTPS over HTTP proxy will start with CONNECT request. The page's navigation fails, as the original's `catch`
      yield* page.goto("https://bing.com/", { waitUntil: "load" }).pipe(Effect.ignore)
      // This connect request should have emulated user agent. The original reads the last bytes the proxy got; Strider's
      // Chromium also connects for www.google.com after the failed navigation, so the port reads the CONNECT for the
      // page's own target.
      const connect = raw.requestTexts.find((text) => text.startsWith("CONNECT bing.com:443"))
      assert(connect !== undefined, `no CONNECT for bing.com: ${JSON.stringify(raw.requestTexts)}`)
      assert.include(connect, "MyUserAgent")
    })))

  test("PR-017", { page: false }, ({ server, browserName }) =>
    Effect.scoped(Effect.gen(function*() {
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({ proxy: { server: `localhost:${proxy.PORT}` } })
      server.sendOnWebSocketConnection("incoming")
      server.setRoute("/target.html", (_request, response) => {
        response.end("<html><title>Served by the proxy</title></html>")
      })

      const page = yield* context.newPage
      yield* page.goto("http://fake-localhost-127-0-0-1.nip.io:1337/target.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.title, "Served by the proxy")

      const value = yield* page.evaluateInMainWorld(() => {
        let cb: (data: unknown) => void = () => {}
        const result = new Promise((resolve) => cb = resolve)
        const ws = new WebSocket("ws://fake-localhost-127-0-0-1.nip.io:1337/ws")
        ws.addEventListener("message", (data) => {
          ws.close()
          cb(data.data)
        })
        return result
      })
      assert.strictEqual(value, "incoming")

      // WebKit does not use CONNECT for websockets, but other browsers do.
      if (browserName === "webkit") {
        assert.include(proxy.requestUrls, "ws://fake-localhost-127-0-0-1.nip.io:1337/ws")
      } else {
        assert.include(proxy.connectHosts, "fake-localhost-127-0-0-1.nip.io:1337")
      }
    })))

  // PR-012, PR-013, and PR-016 use Playwright's SOCKS proxy: Strider refuses SOCKS endpoints and the harness has no
  // SOCKS server, so they are ledgered as needsFeature.
})
