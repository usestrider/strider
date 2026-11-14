/**
 * Playwright's `tests/page/network-post-data.spec.ts`: a request's post data as text, bytes, and JSON, for a fetch
 * with a JSON, PUT, or Blob body, and for `navigator.sendBeacon`.
 *
 * What the port changes:
 * - `request.postDataBuffer()`, `postDataJSON()`, and `postData()` are the body decoders of `NetworkRequest.next`:
 *   `arrayBuffer`, `json`, and `text`, read from the request's captured body. A subscription takes one decoder, so
 *   NE-108 subscribes twice, once per decoder, before its fetch. A request without a body reads `None`, where
 *   Playwright's `postData()` is `null`.
 * - `page.waitForRequest('**')` is `NetworkRequest.next` with a narrower URL: Strider reports the browser's own
 *   `/favicon.ico` request too, which Playwright never does, and it could be the first match. NE-108 and NE-109 wait for
 *   `**\/title.html`, NE-110 and NE-111 for the same, and NE-112 and NE-113 for the URL the original's fetch or beacon
 *   sends.
 * - NE-110's `request.postDataJSON()` throws Playwright's error, which the original catches. Strider's `json` decoder
 *   fails the subscription with `MalformedBody`, so the port reads that failure and asserts its reason, not the wording
 *   of Playwright's message.
 * - NE-112 and NE-113 carry `it.fail` for Chromium (and WebKit, for NE-113): upstream expects their assertions to fail
 *   there. The port asserts what the original asserts, on every browser, so Chromium's result is Strider's own.
 * - `page.goto(server.EMPTY_PAGE)` waits for `load`, as the original's default does. `page.evaluate` is
 *   `page.evaluateInMainWorld`, and each fetch or beacon ends inside its evaluation, since a `Response` doesn't cross by
 *   value.
 */
import { assert } from "@effect/vitest"
import { NetworkRequest } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("NE-108", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const value = "baẞ"
      const bytes = yield* NetworkRequest.next(page, {
        url: "**/title.html",
        body: (message) => message.arrayBuffer
      })
      const json = yield* NetworkRequest.next(page, {
        url: "**/title.html",
        body: (message) => message.json
      })
      yield* page.evaluateInMainWorld(async ({ url, value }) => {
        const request = new Request(url, {
          method: "POST",
          body: JSON.stringify(value)
        })
        request.headers.set("content-type", "application/json;charset=UTF-8")
        await fetch(request)
      }, { url: server.PREFIX + "/title.html", value })
      const sentBytes = yield* bytes
      assert.isTrue(
        Buffer.from(Option.getOrThrow(sentBytes.body)).equals(Buffer.from(JSON.stringify(value), "utf-8"))
      )
      const sentJson = yield* json
      assert.strictEqual(Option.getOrThrow(sentJson.body), value)
    }))

  test("NE-109", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const sent = yield* NetworkRequest.next(page, {
        url: "**/title.html",
        body: (message) => message.json
      })
      yield* page.evaluateInMainWorld(async ({ url }) => {
        const request = new Request(url, {
          method: "POST",
          body: JSON.stringify({ value: 42 })
        })
        // The original sets the content type to an empty string
        request.headers.set("content-type", "")
        await fetch(request)
      }, { url: server.PREFIX + "/title.html" })
      const request = yield* sent
      assert.deepStrictEqual(Option.getOrThrow(request.body), { value: 42 })
    }))

  test("NE-110", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const sent = yield* NetworkRequest.next(page, {
        url: "**/title.html",
        body: (message) => message.json
      })
      yield* page.evaluateInMainWorld(async ({ url }) => {
        const request = new Request(url, {
          method: "POST",
          body: "<not a json>"
        })
        await fetch(request)
      }, { url: server.PREFIX + "/title.html" })
      // Playwright's `postDataJSON()` throws its message; Strider's decoder fails the subscription with a typed reason
      const failure = yield* failureOf(sent, "reading the request's JSON")
      if (!(failure instanceof NetworkRequest.RequestError)) throw new Error(`not a RequestError: ${failure}`)
      assert.strictEqual(failure.reason._tag, "MalformedBody")
      assert.include(failure.message, "Request body is not json")
    }))

  test("NE-111", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const sent = yield* NetworkRequest.next(page, {
        url: "**/title.html",
        body: (message) => message.json
      })
      yield* page.evaluateInMainWorld(async ({ url }) => {
        const request = new Request(url, {
          method: "PUT",
          body: JSON.stringify({ value: 42 })
        })
        await fetch(request)
      }, { url: server.PREFIX + "/title.html" })
      const request = yield* sent
      assert.strictEqual(request.method, "PUT")
      assert.deepStrictEqual(Option.getOrThrow(request.body), { value: 42 })
    }))

  test("NE-112", ({ page, server }) =>
    Effect.gen(function*() {
      // it.fail on Chromium and WebKit upstream: the assertion below is the original's, asserted on every browser
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const sent = yield* NetworkRequest.next(page, {
        url: "**/data",
        body: (message) => message.text
      })
      yield* page.evaluateInMainWorld(() => {
        const file = new File(["file-contents"], "filename.txt")
        void fetch("/data", {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream"
          },
          body: file
        })
      })
      const request = yield* sent
      assert.strictEqual(Option.getOrThrow(request.body), "file-contents")
    }))

  test("NE-113", ({ page, server }) =>
    Effect.gen(function*() {
      // it.fail on Chromium and WebKit upstream (issue 12231): asserted here on every browser, as the original asserts
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const sent = yield* NetworkRequest.next(page, {
        url: "**/api/foo",
        body: (message) => message.json
      })
      yield* page.evaluateInMainWorld(() =>
        navigator.sendBeacon(window.location.origin + "/api/foo", new Blob([JSON.stringify({ foo: "bar" })]))
      )
      const request = yield* sent
      assert.strictEqual(request.method, "POST")
      assert.strictEqual(request.url, server.PREFIX + "/api/foo")
      assert.deepStrictEqual(Option.getOrThrow(request.body), { foo: "bar" })
    }))
})
