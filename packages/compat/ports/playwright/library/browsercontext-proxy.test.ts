/**
 * Playwright's `tests/library/browsercontext-proxy.spec.ts`: a context routed through a proxy, with its bypass list and
 * its credentials, and what the proxy sees.
 *
 * What the port changes:
 * - The original's proxy (`proxyServer`) forwards to the fixture server, records each request's URL and each CONNECT's
 *   host, and answers 407 unless its auth handler allows the request. The harness's fixture server isn't a proxy, so
 *   `proxyServer` here is a small HTTP proxy of the port's own: it forwards plain requests to the fixture server and
 *   tunnels CONNECT to `target`, which is the fixture server's port (or its TLS port for PR-028).
 * - `browserType.launch({ proxy })` has no Strider counterpart (option-browsertype-launch-proxy), so PR-019 isn't
 *   ported. Strider's proxy is a context option only.
 * - Strider's `Browser.newContext({ proxy })` is the original's `browser.newContext({ proxy })`. Each context the original
 *   closes is a scope here, and each page the original closes is too: a block that closes its page ends its scope.
 * - `page.goto` waits for `load` by default in Playwright and returns at commit in Strider, so each `goto` names
 *   `waitUntil: "load"`. `page.title()` is `page.title`.
 * - `context.request.get(url)` (PR-023) is an APIRequestContext, which Strider doesn't have. The port makes the same
 *   request by navigating a page of the context to it, which goes through the same proxy and sets the same cookie.
 * - `context.cookies()` is `context.cookies.list`, and `context.cookies(url)` is `context.cookies.listFor(url)`.
 * - `expect(locator).toHaveText` is `Expect.toHaveText`, and `page.getByTestId` is the same method.
 * - Strider rejects a proxy setting it can't express with a typed reason, where Playwright's error is its message. PR-020
 *   asserts `InvalidInput` for `proxy`, and PR-030 and PR-031 assert `Unsupported` for `userContexts.proxy.scheme`.
 * - Strider's bypass list takes hostnames without a leading dot (`internal/proxy.ts` refuses one), so it can't express
 *   PR-035's `.another.test`, which Playwright's bypass applies to every subdomain. Chromium's native matching of a bare
 *   `another.test` is exact, so the original's `foo.is.the.another.test` step is the exact host `foo.is.the.another.test`
 *   here: a bypassed host still goes direct, but the suffix pattern itself isn't tested.
 * - Loopback destinations (`localhost`, `127.0.0.1`, `::1`) stay direct in Strider on every backend (the decision on
 *   context proxy routing), where PR-024's `localhost` and `loopback address` variants expect the proxy to see the
 *   request. Those four variants (each with and without the extra bypass) aren't ported: no browser can pass them, and
 *   the ledger can't hold a differentByDesign entry for part of a test on every browser. The two link-local variants are
 *   the original's. Chromium sends 169.254.0.0/16 direct as well, through its implicit bypass rules, which Strider doesn't
 *   lift (Playwright adds `<-loopback>`), so the page's connection to the unroutable address hangs and Strider's
 *   `Timeout` for `goto` arrives about six seconds after its deadline, past the harness's end of the test.
 * - PR-028 sets `acceptInsecureCerts` where the original sets `ignoreHTTPSErrors`. Chromium refuses it (the ledger marks
 *   that), so the test runs on the other browsers.
 * - PR-025's IPv6 proxy uses the fixture's `it.fail` for classic Firefox only, which Strider's Firefox isn't, so the
 *   test runs as written.
 * - PR-036 and PR-037 use Playwright's SOCKS proxy fixture, and Strider has no SOCKS endpoint (the ledger has them).
 * - PR-038's `http://localhost` has no port, so the proxy is port 80, as the original expects.
 * - The original's `proxyServer.requestUrls = []` is `requestUrls.splice(0)` here, since the proxy's list is shared with
 *   its request handler.
 * - PR-034 and PR-039 use two contexts with different credentials for one endpoint. Firefox refuses the second pair
 *   (the decision on context proxy routing), so the ledger marks Firefox there, and WebKit has no proxy credentials.
 */
import { assert } from "@effect/vitest"
import { Browser, Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
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
 * `target`, so the page's requests for other hosts reach the fixture server.
 */
const proxyServer = (target: number) =>
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
        const forward = http.request({
          host: "127.0.0.1",
          port: target,
          method: request.method,
          path: url.pathname + url.search,
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

/** Playwright's `beforeEach` route: the page the proxy's requests reach. */
const serveTarget = (server: ServerShape) =>
  server.setRoute("/target.html", (_request, response) => {
    response.end("<html><title>Served by the proxy</title></html>")
  })

/** `Basic` credentials as a proxy's `proxy-authorization` header carries them. */
const basic = (user: string, password: string) => "Basic " + Buffer.from(`${user}:${password}`).toString("base64")

upstream(import.meta.filename, {}, (test) => {
  test("PR-018", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      // Playwright launches a browser with no proxy and gives the proxy to the context; the harness's browser has none
      const context = yield* Browser.newContext({ proxy: { server: proxy.HOST } })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.include(proxy.requestUrls, "http://non-existent.test/target.html")
      assert.strictEqual(yield* page.title, "Served by the proxy")
    })))

  test("PR-020", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      // Strider's proxy setting is typed, so the port passes the wrong type through `as never`
      const error = yield* failureOf(Browser.newContext({ proxy: { server: 123 as never } }))
      assert(
        error._tag === "UserContextError" && error.reason._tag === "InvalidInput",
        `failed for another reason: ${error._tag === "UserContextError" ? error.reason._tag : error._tag}`
      )
      assert.strictEqual(error.reason.input, "proxy")
    })))

  test("PR-021", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({ proxy: { server: proxy.HOST } })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.include(proxy.requestUrls, "http://non-existent.test/target.html")
      assert.strictEqual(yield* page.title, "Served by the proxy")
    })))

  test("PR-022", { page: false }, ({ server, browserName }) =>
    Effect.scoped(Effect.gen(function*() {
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({ proxy: { server: proxy.HOST } })
      server.setRoute("/set-cookie.html", (_request, response) => {
        response.setHeader("Set-Cookie", ["non-secure=1; HttpOnly", "secure=1; HttpOnly; Secure"])
        response.end()
      })
      server.setRoute("/read-cookie.html", (request, response) => {
        response.setHeader("Content-Type", "text/html")
        response.end(`<div>Cookie: ${request.headers.cookie!.split(";").map((c) => c.trim()).sort().join("; ")}</div>`)
      })
      const page = yield* context.newPage
      yield* page.goto("http://subdomain.localhost/set-cookie.html", { waitUntil: "load" })
      const cookies = yield* context.cookies.listFor("http://subdomain.localhost")
      assert.deepStrictEqual(cookies.map(({ name, domain }) => ({ name, domain })), [
        { name: "non-secure", domain: "subdomain.localhost" },
        // The original omits the Secure cookie on WebKit, which doesn't keep it on this origin
        ...(browserName === "webkit" ? [] : [{ name: "secure", domain: "subdomain.localhost" }])
      ])
      yield* page.goto("http://subdomain.localhost/read-cookie.html", { waitUntil: "load" })
      yield* Expect.toHaveText(
        page.locator("div"),
        browserName === "webkit" ? "Cookie: non-secure=1" : "Cookie: non-secure=1; secure=1"
      )
    })))

  test("PR-023", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({ proxy: { server: proxy.HOST } })
      server.setRoute("/empty.html", (_request, response) => {
        response.setHeader("Set-Cookie", "name=val; Domain=codes; Path=/;")
        response.end()
      })
      // The original's `context.request.get`, which Strider has no APIRequestContext for: a page of the context makes the
      // same request through the same proxy
      const page = yield* context.newPage
      yield* page.goto("http://codes/empty.html", { waitUntil: "load" })
      const [cookie] = yield* context.cookies.list
      assert.isDefined(cookie)
      assert.strictEqual(cookie.name, "name")
      assert.strictEqual(Redacted.value(cookie.value), "val")
    })))

  for (const additionalBypass of [false, true]) {
    // The original's `localhost` and `127.0.0.1` targets are left out: see the header
    for (const params of [{ target: "169.254.3.4", description: "link-local" }]) {
      test("PR-024", {
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
              server: proxy.HOST,
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

  test("PR-025", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({ proxy: { server: `[0:0:0:0:0:0:0:1]:${proxy.PORT}` } })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.include(proxy.requestUrls, "http://non-existent.test/target.html")
      assert.strictEqual(yield* page.title, "Served by the proxy")
    })))

  test("PR-026", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({ proxy: { server: proxy.HOST } })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.include(proxy.requestUrls, "http://non-existent.test/target.html")
      yield* page.goto("http://non-existent-2.test/target.html", { waitUntil: "load" })
      assert.include(proxy.requestUrls, "http://non-existent-2.test/target.html")
      assert.strictEqual(yield* page.title, "Served by the proxy")
    })))

  test("PR-027", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({ proxy: { server: proxy.HOST } })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.include(proxy.requestUrls, "http://non-existent.test/target.html")
      assert.strictEqual(yield* page.title, "Served by the proxy")
      const page2 = yield* context.newPage
      proxy.requestUrls.splice(0)
      yield* page2.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.include(proxy.requestUrls, "http://non-existent.test/target.html")
      assert.strictEqual(yield* page2.title, "Served by the proxy")
    })))

  test("PR-028", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/target.html", (_request, response) => {
        response.end("<html><title>Served by https server via proxy</title></html>")
      })
      const proxy = yield* proxyServer(server.https.PORT)
      const context = yield* Browser.newContext({
        acceptInsecureCerts: true,
        proxy: { server: proxy.HOST }
      })
      const page = yield* context.newPage
      yield* page.goto("https://non-existent.test/target.html", { waitUntil: "load" })
      assert.include(proxy.connectHosts, "non-existent.test:443")
      assert.strictEqual(yield* page.title, "Served by https server via proxy")
    })))

  test("PR-029", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      const context = yield* Browser.newContext({ proxy: { server: `127.0.0.1:${proxy.PORT}` } })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.include(proxy.requestUrls, "http://non-existent.test/target.html")
      assert.strictEqual(yield* page.title, "Served by the proxy")
    })))

  test("PR-030", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const error = yield* failureOf(Browser.newContext({
        proxy: {
          server: "socks5://localhost:1234",
          credentials: { username: "user", password: Redacted.make("secret") }
        }
      }))
      assert(
        error._tag === "UserContextError" && error.reason._tag === "Unsupported",
        `failed for another reason: ${error._tag === "UserContextError" ? error.reason._tag : error._tag}`
      )
      assert.strictEqual(error.reason.capability, "userContexts.proxy.scheme")
    })))

  test("PR-031", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const error = yield* failureOf(Browser.newContext({
        proxy: {
          server: "socks4://localhost:1234",
          credentials: { username: "user", password: Redacted.make("secret") }
        }
      }))
      assert(
        error._tag === "UserContextError" && error.reason._tag === "Unsupported",
        `failed for another reason: ${error._tag === "UserContextError" ? error.reason._tag : error._tag}`
      )
      assert.strictEqual(error.reason.capability, "userContexts.proxy.scheme")
    })))

  test("PR-032", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      const seen: { auth?: string | undefined } = {}
      proxy.setAuthHandler((request) => {
        seen.auth = request.headers["proxy-authorization"]
        return seen.auth !== undefined
      })
      const context = yield* Browser.newContext({
        proxy: { server: proxy.HOST, credentials: { username: "user", password: Redacted.make("secret") } }
      })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.include(proxy.requestUrls, "http://non-existent.test/target.html")
      assert.strictEqual(seen.auth, basic("user", "secret"))
      assert.strictEqual(yield* page.title, "Served by the proxy")
    })))

  test("PR-033", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      const seen: { auth?: string | undefined } = {}
      proxy.setAuthHandler((request) => {
        seen.auth = request.headers["proxy-authorization"]
        return seen.auth !== undefined
      })
      const context = yield* Browser.newContext({
        proxy: { server: proxy.HOST, credentials: { username: "user", password: Redacted.make("") } }
      })
      const page = yield* context.newPage
      yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      assert.strictEqual(seen.auth, basic("user", ""))
      assert.strictEqual(yield* page.title, "Served by the proxy")
    })))

  test("PR-034", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      const seen: { auth?: string | undefined } = {}
      proxy.setAuthHandler((request) => {
        seen.auth = request.headers["proxy-authorization"]
        return seen.auth !== undefined
      })
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({
          proxy: { server: proxy.HOST, credentials: { username: "user1", password: Redacted.make("secret1") } }
        })
        const page = yield* context.newPage
        yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
        assert.strictEqual(seen.auth, basic("user1", "secret1"))
        assert.strictEqual(yield* page.title, "Served by the proxy")
      }))
      seen.auth = undefined
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({
          proxy: { server: proxy.HOST, credentials: { username: "user2", password: Redacted.make("secret2") } }
        })
        const page = yield* context.newPage
        yield* page.goto("http://non-existent.test/target.html", { waitUntil: "load" })
        assert.strictEqual(yield* page.title, "Served by the proxy")
        assert.strictEqual(seen.auth, basic("user2", "secret2"))
      }))
    })))

  test("PR-035", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveTarget(server)
      const proxy = yield* proxyServer(server.PORT)
      // Playwright's bypass is one comma-separated string, with `.another.test` matching its subdomains. Strider takes
      // hostnames in a list and refuses a leading dot, so it can't say that: the bypass names the exact host the
      // original's last bypassed step visits.
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
      const nonFaviconUrls = () => proxy.requestUrls.filter((url) => !url.includes("favicon"))

      yield* Effect.scoped(Effect.gen(function*() {
        proxy.requestUrls.splice(0)
        const page = yield* context.newPage
        yield* page.goto("http://0.non.existent.domain.for.the.test/target.html", { waitUntil: "load" })
        assert.include(proxy.requestUrls, "http://0.non.existent.domain.for.the.test/target.html")
        assert.strictEqual(yield* page.title, "Served by the proxy")
      }))

      yield* Effect.scoped(Effect.gen(function*() {
        proxy.requestUrls.splice(0)
        const page = yield* context.newPage
        yield* failureOf(page.goto("http://1.non.existent.domain.for.the.test/target.html", { waitUntil: "load" }))
        assert.deepStrictEqual(nonFaviconUrls(), [])
      }))

      yield* Effect.scoped(Effect.gen(function*() {
        proxy.requestUrls.splice(0)
        const page = yield* context.newPage
        yield* failureOf(page.goto("http://2.non.existent.domain.for.the.test/target.html", { waitUntil: "load" }))
        assert.deepStrictEqual(nonFaviconUrls(), [])
      }))

      yield* Effect.scoped(Effect.gen(function*() {
        proxy.requestUrls.splice(0)
        const page = yield* context.newPage
        yield* failureOf(page.goto("http://foo.is.the.another.test/target.html", { waitUntil: "load" }))
        assert.deepStrictEqual(nonFaviconUrls(), [])
      }))

      yield* Effect.scoped(Effect.gen(function*() {
        proxy.requestUrls.splice(0)
        const page = yield* context.newPage
        yield* page.goto("http://3.non.existent.domain.for.the.test/target.html", { waitUntil: "load" })
        assert.include(nonFaviconUrls(), "http://3.non.existent.domain.for.the.test/target.html")
        assert.strictEqual(yield* page.title, "Served by the proxy")
      }))
    })))

  test("PR-038", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      // A proxy with no port is port 80, and creating the context is the whole test
      yield* Browser.newContext({ proxy: { server: "http://localhost" } })
    })))

  test("PR-039", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/target.html", (request, response) => {
        const authHeader = request.headers["proxy-authorization"]
        if (!authHeader) {
          response.writeHead(407, { "Proxy-Authenticate": "Basic realm=\"proxy\"" })
          response.end("Proxy authorization required")
          return
        }
        const [username] = Buffer.from(authHeader.split(" ")[1]!, "base64").toString().split(":")
        response.writeHead(200, { "Content-Type": "text/html" })
        response.end(`Hello <div data-testid=user>${username}</div>!\n`)
      })
      // The fixture server is the proxy here, as in the original
      const context1 = yield* Browser.newContext({
        proxy: { server: server.PREFIX, credentials: { username: "user1", password: Redacted.make("secret1") } }
      })
      const page1 = yield* context1.newPage
      yield* page1.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      yield* Expect.toHaveText(page1.getByTestId("user"), "user1")

      const context2 = yield* Browser.newContext({
        proxy: { server: server.PREFIX, credentials: { username: "user2", password: Redacted.make("secret2") } }
      })
      const page2 = yield* context2.newPage
      yield* page2.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      yield* Expect.toHaveText(page2.getByTestId("user"), "user2")

      yield* page1.goto("http://non-existent.test/target.html", { waitUntil: "load" })
      yield* Expect.toHaveText(page1.getByTestId("user"), "user1")
    })))
})
