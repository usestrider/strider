/** Native size accounting and context isolation through the public API. */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, NetworkRequest, NetworkResponse, type Page } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as http from "node:http"
import { gzipSync } from "node:zlib"
import * as Handles from "../../../src/internal/handles.ts"
import { supports } from "./capabilities.ts"

const text = "x".repeat(4096)
const compressed = gzipSync(text)
const site = Effect.gen(function*() {
  let hits = 0
  let revalidated = 0
  let release: (() => void) | undefined
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/stream" })
      response.end()
    } else if (request.url === "/stream" || request.url === "/broken") {
      response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" })
      response.write("first")
      release = request.url === "/broken" ? () => response.destroy() : () => response.end("last")
    } else if (request.url === "/fixed" || request.url === "/chunked") {
      response.writeHead(200, {
        "content-type": "text/plain",
        "content-encoding": "gzip",
        "cache-control": "no-store",
        ...(request.url === "/fixed" ? { "content-length": compressed.length } : {})
      })
      response.end(compressed)
    } else if (request.url === "/empty") {
      response.writeHead(200, { "content-length": 0, "cache-control": "no-store" })
      response.end()
    } else if (request.url === "/revalidate-script") {
      if (request.headers["if-none-match"] === "\"v1\"") revalidated++
      response.writeHead(request.headers["if-none-match"] === "\"v1\"" ? 304 : 200, {
        "content-type": "text/javascript",
        "cache-control": "no-cache",
        etag: "\"v1\""
      })
      response.end(request.headers["if-none-match"] === "\"v1\"" ? undefined : "globalThis.revalidated = true")
    } else if (request.url === "/cache-script") {
      hits++
      response.writeHead(200, { "content-type": "text/javascript", "cache-control": "max-age=3600" })
      response.end("globalThis.cacheLoads = (globalThis.cacheLoads || 0) + 1")
    } else response.end("<title>sizes</title>")
  })
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      server.closeAllConnections()
      server.close()
    })
  )
  yield* Effect.promise(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)))
  const address = server.address()
  assert(address !== null && typeof address !== "string")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    hits: () => hits,
    revalidated: () => revalidated,
    release: () => {
      assert(release !== undefined)
      release()
    }
  }
})

// A test-only terminal fact barrier: sizes itself must remain an immediate read, and tests must
// not enable body capture to wait (stock WebKit does not retain content for empty responses).
const ended = (page: Page.ObservedPage, request: NetworkRequest.NetworkRequest) =>
  Deferred.await(Option.getOrThrow(Handles.page(page).runtime.model.hop(request.hop)).end).pipe(
    Effect.timeout("5 seconds")
  )

export const requestSizes = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} request sizes`, () => {
    layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
      it.effect(
        "distinguishes compressed entity, transferred and decoded bytes, including known empty bodies",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const context = yield* Browser.newContext({ requestSizes: true })
            const page = yield* context.newPage
            yield* page.goto(served.origin)
            for (const path of ["/fixed", "/chunked", "/empty"]) {
              const sent = yield* NetworkRequest.next(page, { url: served.origin + path })
              yield* page.evaluateInMainWorld((path) =>
                fetch(path, path === "/fixed" ? { method: "POST", body: "€" } : undefined).then((r) => r.text()), path)
              const original = yield* sent
              yield* ended(page, original)
              const sizes = yield* NetworkRequest.sizes(context, original)
              assert.isTrue(Option.isSome(sizes.responseTransferSize))
              if (yield* supports("network.sizes.decoded")) {
                assert.deepStrictEqual(sizes.responseBodyDecodedSize, Option.some(path === "/empty" ? 0 : text.length))
              } else assert.deepStrictEqual(sizes.responseBodyDecodedSize, Option.none())
              if (yield* supports("network.sizes.encoded")) {
                assert.deepStrictEqual(
                  sizes.responseBodyEncodedSize,
                  Option.some(path === "/empty" ? 0 : compressed.length)
                )
              } else assert.deepStrictEqual(sizes.responseBodyEncodedSize, Option.none())
              if (yield* supports("network.sizes.responseBody")) {
                const body = Option.getOrThrow(sizes.responseBodySize)
                assert.strictEqual(body, path === "/empty" ? 0 : compressed.length + (path === "/chunked" ? 11 : 0))
                assert.strictEqual(
                  Option.getOrThrow(sizes.responseTransferSize),
                  Option.getOrThrow(sizes.responseHeadersSize) + body
                )
              } else assert.deepStrictEqual(sizes.responseBodySize, Option.none())
              if (yield* supports("network.sizes.request")) {
                assert.deepStrictEqual(sizes.requestBodySize, Option.some(path === "/fixed" ? 3 : 0))
              } else assert.deepStrictEqual(sizes.requestBodySize, Option.none())
            }
          }).pipe(Effect.scoped),
        60_000
      )

      it.effect(
        "keeps redirect hops and in-progress snapshots separate and never finalizes failed bodies",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const context = yield* Browser.newContext({ requestSizes: true })
            const page = yield* context.newPage
            yield* page.goto(served.origin)
            for (const failed of [false, true]) {
              const path = failed ? "/broken" : "/redirect"
              const sent = yield* NetworkRequest.next(page, { url: served.origin + (failed ? "/broken" : "/stream") })
              const first = failed ? undefined : yield* NetworkRequest.next(page, { url: served.origin + "/redirect" })
              const headers = yield* NetworkResponse.next(page, {
                url: served.origin + (failed ? "/broken" : "/stream")
              })
              const fetched = yield* page.evaluateInMainWorld(
                (path) => fetch(path).then((r) => r.text()).catch(() => "failed"),
                path
              ).pipe(Effect.forkScoped)
              const original = yield* sent
              yield* headers
              const before = yield* NetworkRequest.sizes(page, original)
              assert.deepStrictEqual(before.responseTransferSize, Option.none())
              served.release()
              assert.strictEqual(yield* Fiber.join(fetched), failed ? "failed" : "firstlast")
              yield* ended(page, original)
              const after = yield* NetworkRequest.sizes(page, original)
              assert.deepStrictEqual(before.responseTransferSize, Option.none())
              if (failed) {
                assert.deepStrictEqual(after.responseTransferSize, Option.none())
                assert.deepStrictEqual(after.responseBodyDecodedSize, Option.none())
              } else {
                assert.isTrue(Option.isSome(after.responseTransferSize))
                const earlier = yield* NetworkRequest.sizes(page, yield* first!)
                assert.notDeepEqual(earlier, after)
              }
            }
          }).pipe(Effect.scoped),
        60_000
      )

      it.effect(
        "isolates omitted and enabled contexts and keeps cached network counts unavailable",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const off = yield* Browser.newContext()
            const on = yield* Browser.newContext({ requestSizes: true })
            const other = yield* off.newPage
            const page = yield* on.newPage
            for (const current of [other, page]) {
              yield* current.goto(served.origin)
              const load = () =>
                current.evaluateInMainWorld(async () => {
                  await new Promise<void>((resolve, reject) => {
                    const script = document.createElement("script")
                    script.src = "/cache-script"
                    script.onload = () => resolve()
                    script.onerror = () => reject(new Error("script failed"))
                    document.head.append(script)
                  })
                })
              const sent = yield* NetworkRequest.next(current, { url: served.origin + "/cache-script" })
              yield* load()
              const request = yield* sent
              yield* ended(current, request)
              if (current === other) {
                const error = yield* NetworkRequest.sizes(current, request).pipe(Effect.flip)
                assert.deepInclude(error.reason, { _tag: "RequestUnavailable", why: "sizesNotEnabled" })
              } else {
                assert.isTrue(Option.isSome((yield* NetworkRequest.sizes(current, request)).responseTransferSize))
                const hits = served.hits()
                yield* load()
                assert.strictEqual(served.hits(), hits, "cache reuse does not reach the local server")
                const history = yield* NetworkRequest.history(current, { url: served.origin + "/cache-script" })
                const observed = history.entries.filter((r) => r.hop !== request.hop)
                // Some memory caches omit a request event altogether. Neither absence nor source labels imply zero.
                for (const cached of observed) {
                  yield* ended(current, cached)
                  assert.deepStrictEqual(
                    (yield* NetworkRequest.sizes(current, cached)).responseTransferSize,
                    Option.none()
                  )
                }
              }
            }
          }).pipe(Effect.scoped),
        60_000
      )
      it.effect("leaves revalidated transfer accounting unavailable", () =>
        Effect.gen(function*() {
          const served = yield* site
          const context = yield* Browser.newContext({ requestSizes: true })
          const page = yield* context.newPage
          yield* page.goto(served.origin)
          for (let i = 0; i < 2; i++) {
            const sent = yield* NetworkRequest.next(page, { url: served.origin + "/revalidate-script" })
            yield* page.evaluateInMainWorld(async () => {
              await new Promise<void>((resolve, reject) => {
                const script = document.createElement("script")
                script.src = "/revalidate-script"
                script.onload = () => resolve()
                script.onerror = () => reject(new Error("script failed"))
                document.head.append(script)
              })
            })
            const request = yield* sent
            yield* ended(page, request)
            if (i === 1) {
              assert.strictEqual(served.revalidated(), 1, "the server actually answered a conditional request with 304")
              assert.deepStrictEqual((yield* NetworkRequest.sizes(page, request)).responseTransferSize, Option.none())
            }
          }
        }).pipe(Effect.scoped), 60_000)
    })
  })
