/**
 * Puppeteer's `test/src/proxy.test.ts`: a request routed through an HTTP proxy, with its bypass list, at the browser
 * level, the incognito context level, and the context level.
 *
 * What the port changes:
 * - Puppeteer's tests 1 to 4 pass the proxy to the browser at launch (`--proxy-server`, `--proxy-bypass-list`). Strider
 *   has no launch-level proxy (`option-browsertype-launch-proxy`), so each of them makes a context with the same proxy
 *   and opens its page there, as `browsercontext-proxy` and `proxy` in the Playwright ports do. Tests 1 and 3 are the
 *   same in Strider, and so are 2 and 4 (the same proxy, the same bypass): each keeps its key and its steps.
 * - The original's `getEmptyPageUrl` is the machine's external address, so that the proxy doesn't skip it as loopback.
 *   Strider keeps loopback direct (the decision on context proxy routing), so the proxied page is
 *   `http://non-existent.test/empty.html`, which the proxy forwards to the fixture server. A bypassed page is the
 *   fixture server's own (`server.EMPTY_PAGE`, on `localhost`), which goes direct whether or not it is bypassed: the
 *   bypass tests pass for that reason too, as `browsercontext-proxy` PR-006 does. No non-loopback host resolves to the
 *   fixture server on every browser, so a bypass that could be seen to matter isn't tested here.
 * - Puppeteer's `proxyBypassList` takes a host with its port (`new URL(emptyPageUrl).host`). Strider's bypass takes
 *   hostnames, so the list is `["localhost"]`.
 * - The proxy is an HTTP proxy of the port's own (the fixture server isn't one): it forwards each request to the
 *   fixture server on 127.0.0.1 and records its URL, as the original's `proxyServer` does. Its
 *   `update.googleapis.com` answer is Chrome's launch-time traffic, which a context's proxy doesn't carry, so it isn't
 *   answered here.
 * - Chromium requests `/favicon.ico` through the proxy after the document, sometimes: the proxy
 *   forwards it but doesn't record it, as the other ports leave out the favicon request (Strider's own is an open
 *   question).
 * - `response.ok()` is the committed navigation's response having a 2xx status, as in `acceptInsecureCerts`.
 * - `page.goto` waits for `load` by default in Puppeteer and returns at commit in Strider, so each `goto` names
 *   `waitUntil: "load"`.
 * - Puppeteer's runner skips these tests on Firefox ("Chrome-specific test"). They run on Chromium and on stock WebKit,
 *   which is what the port's `browsers` option says; Firefox's ledger entries are not applicable.
 */
import { assert } from "@effect/vitest"
import { Browser, type PageNavigation } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as http from "node:http"
import * as net from "node:net"
import { upstream } from "../harness/upstream.ts"

const load = { waitUntil: "load" } as const

/** The page the tests load through the proxy: a host the proxy must see, as the original's external address was. */
const proxiedPageUrl = "http://non-existent.test/empty.html"

/** Puppeteer's `response.ok()`: the navigation committed with a response whose status is 2xx. */
const isOk = (navigation: PageNavigation.PageNavigation) =>
  navigation._tag === "Committed" &&
  Option.match(navigation.response, {
    onNone: () => false,
    onSome: (response) => response.status >= 200 && response.status < 300
  })

/** An HTTP proxy the scope runs: its URL, and each request's URL as the client wrote it. */
interface ProxyServer {
  /** The proxy's URL, as the original's `proxyServerUrl`. */
  readonly url: string
  /** Each request's URL, in the order the proxy received them. */
  readonly requestUrls: Array<string>
}

/**
 * An HTTP proxy for the scope. It forwards each request to the fixture server on 127.0.0.1 and records its URL. The
 * scope closes the server and the connections it accepted.
 */
const proxyServer = (target: number) =>
  Effect.acquireRelease(
    Effect.callback<ProxyServer & { readonly server: http.Server; readonly sockets: Set<net.Socket> }>((resume) => {
      const requestUrls: Array<string> = []
      const sockets = new Set<net.Socket>()
      const server = http.createServer((request, response) => {
        // Chromium's own `/favicon.ico` request follows the document through the proxy, which the original
        // doesn't count; the page's requests are what is recorded
        if (new URL(request.url ?? "/").pathname !== "/favicon.ico") requestUrls.push(request.url ?? "")
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
      server.on("connection", (socket) => {
        sockets.add(socket)
        socket.on("close", () => sockets.delete(socket))
      })
      server.listen(0, () => {
        const port = (server.address() as net.AddressInfo).port
        resume(Effect.succeed({ url: `http://localhost:${port}`, requestUrls, server, sockets }))
      })
    }),
    ({ server, sockets }) =>
      Effect.callback<void>((resume) => {
        for (const socket of sockets) socket.destroy()
        server.closeAllConnections()
        server.close(() => resume(Effect.void))
      })
  )

upstream(import.meta.filename, {}, (test) => {
  test(
    "request proxy should proxy requests when configured",
    { page: false, browsers: ["chromium", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const proxy = yield* proxyServer(server.PORT)
        // Puppeteer's `--proxy-server` at launch, as a context's proxy
        const context = yield* Browser.newContext({ proxy: { server: proxy.url } })
        const page = yield* context.newPage
        const navigation = yield* page.goto(proxiedPageUrl, load)
        assert.isTrue(isOk(navigation))
        assert.deepStrictEqual(proxy.requestUrls, [proxiedPageUrl])
      }))
  )

  test(
    "request proxy should respect proxy bypass list",
    { page: false, browsers: ["chromium", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const proxy = yield* proxyServer(server.PORT)
        const context = yield* Browser.newContext({ proxy: { server: proxy.url, bypass: ["localhost"] } })
        const page = yield* context.newPage
        const navigation = yield* page.goto(server.EMPTY_PAGE, load)
        assert.isTrue(isOk(navigation))
        assert.deepStrictEqual(proxy.requestUrls, [])
      }))
  )

  test(
    "request proxy in incognito browser context should proxy requests when configured at browser level",
    { page: false, browsers: ["chromium", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const proxy = yield* proxyServer(server.PORT)
        const context = yield* Browser.newContext({ proxy: { server: proxy.url } })
        const page = yield* context.newPage
        const navigation = yield* page.goto(proxiedPageUrl, load)
        assert.isTrue(isOk(navigation))
        assert.deepStrictEqual(proxy.requestUrls, [proxiedPageUrl])
      }))
  )

  test(
    "request proxy in incognito browser context should respect proxy bypass list when configured at browser level",
    { page: false, browsers: ["chromium", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const proxy = yield* proxyServer(server.PORT)
        const context = yield* Browser.newContext({ proxy: { server: proxy.url, bypass: ["localhost"] } })
        const page = yield* context.newPage
        const navigation = yield* page.goto(server.EMPTY_PAGE, load)
        assert.isTrue(isOk(navigation))
        assert.deepStrictEqual(proxy.requestUrls, [])
      }))
  )

  test(
    "request proxy in incognito browser context should proxy requests when configured at context level",
    { page: false, browsers: ["chromium", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const proxy = yield* proxyServer(server.PORT)
        const context = yield* Browser.newContext({ proxy: { server: proxy.url } })
        const page = yield* context.newPage
        const navigation = yield* page.goto(proxiedPageUrl, load)
        assert.isTrue(isOk(navigation))
        assert.deepStrictEqual(proxy.requestUrls, [proxiedPageUrl])
      }))
  )

  test(
    "request proxy in incognito browser context should respect proxy bypass list when configured at context level",
    { page: false, browsers: ["chromium", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const proxy = yield* proxyServer(server.PORT)
        // Puppeteer's `proxyBypassList` names the page's host, with its port; Strider's bypass takes the hostname
        const context = yield* Browser.newContext({ proxy: { server: proxy.url, bypass: ["localhost"] } })
        const page = yield* context.newPage
        const navigation = yield* page.goto(server.EMPTY_PAGE, load)
        assert.isTrue(isOk(navigation))
        assert.deepStrictEqual(proxy.requestUrls, [])
      }))
  )
})
