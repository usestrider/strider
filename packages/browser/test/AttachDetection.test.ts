import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as Result from "effect/Result"
import * as TestClock from "effect/testing/TestClock"
import * as Attach from "../src/internal/cli/attach.ts"

const probe = (response: Response) => {
  const requests: Array<string> = []
  const client = HttpClient.make((request, url) => {
    requests.push(url.href)
    return Effect.succeed(HttpClientResponse.fromWeb(request, response))
  })
  return {
    requests,
    run: Attach.detect("http://localhost:9222/").pipe(Effect.provideService(HttpClient.HttpClient, client))
  }
}
const discovery = (webSocketDebuggerUrl = "ws://localhost:9222/devtools/browser/one") =>
  JSON.stringify({ Browser: "Chrome/155", "Protocol-Version": "1.3", webSocketDebuggerUrl })

describe("CLI HTTP attachment detection", () => {
  it.effect("requests discovery once and retains its browser WebSocket", () =>
    Effect.gen(function*() {
      const { requests, run } = probe(new Response(discovery()))
      assert.deepStrictEqual(yield* run, {
        browser: { _tag: "Attach", backend: "chromium", endpoint: "http://localhost:9222/" },
        connectionEndpoint: "ws://localhost:9222/devtools/browser/one"
      })
      assert.deepStrictEqual(requests, ["http://localhost:9222/json/version"])
    }))
  it.effect("recognizes an empty WebKit inspector from its exact Server token on 404", () =>
    Effect.gen(function*() {
      const { run } = probe(
        new Response("", { status: 404, headers: { server: "WebKitInspectorHTTPServer libsoup/3.6.6" } })
      )
      assert.deepStrictEqual(yield* run, {
        browser: { _tag: "Attach", backend: "webkit", endpoint: "http://localhost:9222/" },
        connectionEndpoint: undefined
      })
    }))
  it.effect("reports a connection failure without response content", () =>
    Effect.gen(function*() {
      const client = HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: "connection refused" })
          })
        )
      )
      const result = yield* Attach.detect("http://localhost:1").pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.result
      )
      assert.isTrue(Result.isFailure(result))
      if (Result.isFailure(result)) assert.include(result.failure.message, "connection refused")
    }))
  it.effect("bounds a server that never responds to five seconds", () =>
    Effect.gen(function*() {
      const client = HttpClient.make(() => Effect.never)
      const fiber = yield* Attach.detect("http://localhost:9222").pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.result,
        Effect.forkChild
      )
      yield* TestClock.adjust("5 seconds")
      const result = yield* Fiber.join(fiber)
      assert.isTrue(Result.isFailure(result))
      if (Result.isFailure(result)) assert.include(result.failure.message, "timed out after 5 seconds")
    }))
  for (
    const [name, response] of [
      ["generic 404", () => new Response("", { status: 404 })],
      ["misleading page HTML", () => new Response("<title>WebKitInspectorHTTPServer</title>")],
      [
        "partial Server token",
        () => new Response("", { status: 404, headers: { server: "FakeWebKitInspectorHTTPServer" } })
      ],
      [
        "missing discovery fields",
        () => new Response("{\"webSocketDebuggerUrl\":\"ws://localhost/devtools/browser/x\"}")
      ],
      ["page WebSocket", () => new Response(discovery("ws://localhost/devtools/page/x"))],
      ["non-WebSocket URL", () => new Response(discovery("http://localhost/devtools/browser/x"))],
      ["oversized discovery", () => new Response("x".repeat(65537))],
      ["redirect", () => new Response("", { status: 302, headers: { location: "/elsewhere" } })]
    ] as const
  ) {
    it.effect(`rejects ${name} with bounded diagnostics`, () =>
      Effect.gen(function*() {
        const result = yield* Effect.result(probe(response()).run)
        assert.isTrue(Result.isFailure(result))
        if (Result.isFailure(result)) {
          assert.include(result.failure.message, "Cannot detect attachment backend:")
          assert.isBelow(result.failure.message.length, 600)
        }
      }))
  }
})
