/**
 * Chromium's endpoint discovery through the environment's proxy: an `http:` endpoint's `/json/version` is asked of
 * `HTTP_PROXY` (or `http_proxy`) in absolute form with the endpoint's `Host`, an `https:` one through a `CONNECT` to
 * `HTTPS_PROXY`, and `NO_PROXY` sends the request straight to the endpoint.
 */
import { assert, describe, it } from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as fs from "node:fs"
import * as http from "node:http"
import * as https from "node:https"
import * as net from "node:net"
import * as tls from "node:tls"
import * as Browser from "../src/Browser.ts"
import * as Attach from "../src/internal/cli/attach.ts"
import * as Connect from "../src/internal/connect.ts"
import * as ProxyHttpClient from "../src/internal/proxyHttpClient.ts"

interface Seen {
  readonly method: string
  readonly url: string
  readonly host: string | undefined
}

/** A server on a free loopback port that records what it was asked and answers with `answer`. */
const serve = (answer: (request: http.IncomingMessage, response: http.ServerResponse) => void) =>
  Effect.acquireRelease(
    Effect.callback<{ readonly port: number; readonly seen: Array<Seen>; readonly server: http.Server }>(
      (resume) => {
        const seen: Array<Seen> = []
        const server = http.createServer((request, response) => {
          seen.push({ method: request.method!, url: request.url!, host: request.headers.host })
          answer(request, response)
        })
        server.on("connect", (request: http.IncomingMessage, socket: net.Socket) => {
          seen.push({ method: "CONNECT", url: request.url!, host: request.headers.host })
          socket.end("HTTP/1.1 403 Forbidden\r\n\r\n")
        })
        server.listen(0, "127.0.0.1", () =>
          resume(Effect.succeed({ port: (server.address() as net.AddressInfo).port, seen, server })))
      }
    ),
    ({ server }) =>
      Effect.callback<void>((resume) => {
        server.closeAllConnections()
        server.close(() =>
          resume(Effect.void)
        )
      })
  )

const version = (webSocket: string) => (_request: http.IncomingMessage, response: http.ServerResponse) => {
  response.writeHead(200, { "content-type": "application/json" })
  response.end(JSON.stringify({ webSocketDebuggerUrl: webSocket }))
}

const resolve = (endpoint: string, env: Record<string, string>) =>
  Connect.chromiumWebSocket(endpoint, undefined).pipe(
    Effect.provide(ProxyHttpClient.layer),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))
  )

/** The reason a failed resolution gave. */
const reasonOf = <A>(exit: Exit.Exit<A, Browser.BrowserError>) => {
  assert.isTrue(Exit.isFailure(exit), "expected a failure")
  return Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit))?.reason : undefined
}

describe("Chromium endpoint discovery through a proxy", () => {
  it.live("asks HTTP_PROXY for an http endpoint, in absolute form with the endpoint's Host", () =>
    Effect.gen(function*() {
      const proxy = yield* serve(version("ws://browser.test:9222/devtools/browser/proxied"))
      const url = yield* resolve("http://browser.test:9222", { http_proxy: `http://127.0.0.1:${proxy.port}` })
      assert.strictEqual(url, "ws://browser.test:9222/devtools/browser/proxied")
      assert.deepStrictEqual(proxy.seen, [
        { method: "GET", url: "http://browser.test:9222/json/version", host: "browser.test:9222" }
      ])
    }).pipe(Effect.scoped))

  it.live("fails as ConnectionFailed, naming the status, when the proxy answers 404", () =>
    Effect.gen(function*() {
      const proxy = yield* serve((_request, response) => {
        response.writeHead(404)
        response.end()
      })
      const exit = yield* Effect.exit(
        resolve("http://browser.test:9222", { HTTP_PROXY: `http://127.0.0.1:${proxy.port}` })
      )
      const reason = reasonOf(exit)
      assert.strictEqual(reason?._tag, "ConnectionFailed")
      assert.include(reason?.message, "404")
      assert.strictEqual(proxy.seen.length, 1)
    }).pipe(Effect.scoped))

  it.live("sends an https endpoint's request through a CONNECT to HTTPS_PROXY", () =>
    Effect.gen(function*() {
      const proxy = yield* serve(version("ws://unused/devtools/browser/none"))
      const exit = yield* Effect.exit(
        resolve("https://browser.test:9443", { HTTPS_PROXY: `127.0.0.1:${proxy.port}` })
      )
      assert.strictEqual(reasonOf(exit)?._tag, "ConnectionFailed")
      assert.include(reasonOf(exit)?.message, "403")
      assert.deepStrictEqual(proxy.seen, [{ method: "CONNECT", url: "browser.test:9443", host: "browser.test:9443" }])
    }).pipe(Effect.scoped))

  it.live("goes straight to an endpoint NO_PROXY names", () =>
    Effect.gen(function*() {
      const proxy = yield* serve(version("ws://unused/devtools/browser/proxied"))
      const target = yield* serve(version("ws://127.0.0.1/devtools/browser/direct"))
      const url = yield* resolve(`http://127.0.0.1:${target.port}`, {
        HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
        NO_PROXY: "example.com, 127.0.0.1"
      })
      assert.strictEqual(url, "ws://127.0.0.1/devtools/browser/direct")
      assert.deepStrictEqual(proxy.seen, [])
      assert.strictEqual(target.seen.length, 1)
    }).pipe(Effect.scoped))

  it.live("goes straight to the endpoint when no proxy is set", () =>
    Effect.gen(function*() {
      const target = yield* serve(version("ws://127.0.0.1/devtools/browser/direct"))
      const url = yield* resolve(`http://127.0.0.1:${target.port}`, {})
      assert.strictEqual(url, "ws://127.0.0.1/devtools/browser/direct")
    }).pipe(Effect.scoped))
})

describe("NO_PROXY matching", () => {
  const matches = (noProxy: string, url: string) => ProxyHttpClient.bypasses(noProxy, new URL(url))
  it("matches hosts exactly, suffixes after a leading dot or star, ports, and everything with a star", () => {
    assert.isTrue(matches("browser.test", "http://browser.test:9222"))
    assert.isFalse(matches("browser.test", "http://sub.browser.test:9222"))
    assert.isTrue(matches(".browser.test", "http://sub.browser.test:9222"))
    assert.isTrue(matches("*.browser.test", "http://sub.browser.test"))
    assert.isTrue(matches("browser.test:9222", "http://browser.test:9222"))
    assert.isFalse(matches("browser.test:9333", "http://browser.test:9222"))
    assert.isTrue(matches("*", "http://anything:1"))
    assert.isFalse(matches("", "http://browser.test"))
  })
})

describe("HTTPS proxy tunnels", () => {
  it("discovers through a successful tunnel with a trusted certificate", async () => {
    const fixture = (name: string) =>
      fs.readFileSync(new URL(`./fixtures/client-certificates/${name}`, import.meta.url))
    const previous = tls.getCACertificates("default")
    tls.setDefaultCACertificates([...previous, fixture("ca.pem").toString()])
    const sockets = new Set<net.Socket>()
    const track = (socket: net.Socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
    }
    const target = https.createServer(
      { key: fixture("server-key.pem"), cert: fixture("server.pem") },
      version("ws://localhost/devtools/browser/tunneled")
    )
    const direct = https.createServer(
      { key: fixture("server-key.pem"), cert: fixture("server.pem") },
      version("ws://localhost/devtools/browser/direct")
    )
    const proxy = http.createServer()
    direct.on("connection", track)
    target.on("connection", track)
    proxy.on("connection", track)
    const listen = (server: http.Server | https.Server) =>
      new Promise<number>((done) =>
        server.listen(0, "127.0.0.1", () => done((server.address() as net.AddressInfo).port))
      )
    try {
      const targetPort = await listen(target)
      const directPort = await listen(direct)
      const proxyPort = await listen(proxy)
      const seen: Array<string> = []
      proxy.on("connect", (request, socket, head) => {
        seen.push(request.url!)
        const upstream = net.connect(targetPort, "127.0.0.1", () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
          upstream.write(head)
          socket.pipe(upstream).pipe(socket)
        })
        track(upstream)
      })
      // The proxy routes the authority to a different browser; bypassing it returns the wrong endpoint.
      const result = await Effect.runPromise(resolve(`https://localhost:${directPort}`, {
        HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`
      }))
      assert.strictEqual(result, "ws://localhost/devtools/browser/tunneled")
      assert.deepStrictEqual(seen, [`localhost:${directPort}`])
    } finally {
      tls.setDefaultCACertificates(previous)
      for (const socket of sockets) socket.destroy()
      await Promise.all(
        [target, direct, proxy].map((server) => new Promise<void>((done) => server.close(() => done())))
      )
    }
  })
})

describe("proxy discovery response handling", () => {
  it.live("rejects an oversized CLI discovery body before the response ends", () =>
    Effect.gen(function*() {
      const proxy = yield* serve((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" })
        response.write(Buffer.alloc(65537, " "))
      })
      const error = yield* Attach.detect("http://browser.test:9222").pipe(
        Effect.provide(ProxyHttpClient.layer),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({
          env: {
            HTTP_PROXY: `http://127.0.0.1:${proxy.port}`
          }
        }))),
        Effect.flip
      )
      assert.include(error.message, "exceeds 65536 bytes")
    }).pipe(Effect.scoped), 10_000)

  it.live("follows discovery redirects through the proxy as direct discovery does", () =>
    Effect.gen(function*() {
      const proxy = yield* serve((request, response) => {
        if (request.url?.endsWith("/json/version")) {
          response.writeHead(302, { location: "http://browser.test:9222/version" })
          response.end()
        } else {
          version("ws://browser.test:9222/devtools/browser/redirected")(request, response)
        }
      })
      const result = yield* resolve("http://browser.test:9222", {
        HTTP_PROXY: `http://127.0.0.1:${proxy.port}`
      })
      assert.strictEqual(result, "ws://browser.test:9222/devtools/browser/redirected")
    }).pipe(Effect.scoped))
})

describe("NO_PROXY compatibility", () => {
  it("a leading dot matches subdomains, not the bare domain", () => {
    assert.isFalse(ProxyHttpClient.bypasses(".browser.test", new URL("http://browser.test")))
  })
  it("a leading wildcard matches a hostname suffix without requiring a dot", () => {
    assert.isTrue(ProxyHttpClient.bypasses("*browser.test", new URL("http://mybrowser.test")))
  })
})

describe("HTTPS proxy tunnels, untrusted", () => {
  it("refuses an endpoint whose certificate isn't trusted, inside a tunnel", async () => {
    const fixture = (name: string) =>
      fs.readFileSync(new URL(`./fixtures/client-certificates/${name}`, import.meta.url))
    const sockets = new Set<net.Socket>()
    const target = https.createServer(
      { key: fixture("server-key.pem"), cert: fixture("server.pem") },
      version("ws://localhost/devtools/browser/untrusted")
    )
    const proxy = http.createServer()
    target.on("connection", (socket) => sockets.add(socket))
    const listen = (server: http.Server | https.Server) =>
      new Promise<number>((done) =>
        server.listen(0, "127.0.0.1", () => done((server.address() as net.AddressInfo).port))
      )
    try {
      const targetPort = await listen(target)
      const proxyPort = await listen(proxy)
      proxy.on("connect", (_request, socket: net.Socket, head) => {
        sockets.add(socket)
        const upstream = net.connect(targetPort, "127.0.0.1", () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
          upstream.write(head)
          socket.pipe(upstream).pipe(socket)
        })
        sockets.add(upstream)
      })
      const exit = await Effect.runPromise(Effect.exit(resolve(`https://localhost:${targetPort}`, {
        HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`
      })))
      const reason = reasonOf(exit)
      assert.strictEqual(reason?._tag, "ConnectionFailed")
      assert.match(reason?.message ?? "", /certificate/i)
    } finally {
      for (const socket of sockets) socket.destroy()
      await Promise.all([target, proxy].map((server) => new Promise<void>((done) => server.close(() => done()))))
    }
  })
})

describe("discovery redirect boundaries", () => {
  it.live("reselects the proxy after a redirect from a NO_PROXY host", () =>
    Effect.gen(function*() {
      const proxy = yield* serve(version("ws://browser.test/devtools/browser/proxied"))
      const direct = yield* serve((_request, response) => {
        response.writeHead(302, { location: "http://browser.test:9222/json/version" })
        response.end()
      })
      const result = yield* resolve(`http://127.0.0.1:${direct.port}`, {
        HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
        NO_PROXY: "127.0.0.1"
      })
      assert.strictEqual(result, "ws://browser.test/devtools/browser/proxied")
      assert.strictEqual(proxy.seen.length, 1)
    }).pipe(Effect.scoped))

  it.live("removes credentials when a proxied redirect changes origin", () =>
    Effect.gen(function*() {
      const credentials: Array<string | undefined> = []
      const proxy = yield* serve((request, response) => {
        credentials.push(request.headers.authorization)
        if (request.headers.host === "browser.test:9222") {
          response.writeHead(302, { location: "http://other.test:9222/json/version" })
          response.end()
        } else {
          version("ws://other.test/devtools/browser/redirected")(request, response)
        }
      })
      yield* Connect.chromiumWebSocket("http://browser.test:9222", {
        headers: { authorization: "Bearer test-credential" }
      }).pipe(
        Effect.provide(ProxyHttpClient.layer),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({
          env: {
            HTTP_PROXY: `http://127.0.0.1:${proxy.port}`
          }
        })))
      )
      assert.deepStrictEqual(credentials, ["Bearer test-credential", undefined])
    }).pipe(Effect.scoped))

  it.live("follows a redirect without waiting for its body to end", () =>
    Effect.gen(function*() {
      const proxy = yield* serve((request, response) => {
        if (request.url?.endsWith("/json/version")) {
          response.writeHead(302, { location: "http://browser.test:9222/version" })
          response.flushHeaders()
        } else {
          version("ws://browser.test/devtools/browser/redirected")(request, response)
        }
      })
      const result = yield* resolve("http://browser.test:9222", {
        HTTP_PROXY: `http://127.0.0.1:${proxy.port}`
      }).pipe(Effect.timeoutOption("1 second"))
      assert.deepStrictEqual(result, Option.some("ws://browser.test/devtools/browser/redirected"))
    }).pipe(Effect.scoped))
})

describe("invalid discovery redirects", () => {
  it.live("reports an invalid redirect URL as ConnectionFailed", () =>
    Effect.gen(function*() {
      const proxy = yield* serve((_request, response) => {
        response.writeHead(302, { location: "http://[" })
        response.end()
      })
      const exit = yield* Effect.exit(resolve("http://browser.test:9222", {
        HTTP_PROXY: `http://127.0.0.1:${proxy.port}`
      }))
      assert.strictEqual(reasonOf(exit)?._tag, "ConnectionFailed")
    }).pipe(Effect.scoped))
})
