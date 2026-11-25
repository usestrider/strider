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
import * as http from "node:http"
import type * as net from "node:net"
import * as Browser from "../src/Browser.ts"
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
        server.close(() => resume(Effect.void))
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
