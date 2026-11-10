/** Native request collection, before responses finish, with per-subscription limits and representation refusals. */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Har, NetworkRequest, Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"
import * as SharedContext from "./sharedContext.ts"

const timeout = 60_000
const open = Effect.fnUntraced(function*() {
  const served = yield* site
  const page = yield* SharedContext.newPage
  yield* page.goto(`${served.origin}/form`)
  return { page, origin: served.origin }
})
const post = (page: Page.Page, path: string, body: string) =>
  page.evaluateInMainWorld((input) => {
    void fetch(input.path, { method: "POST", body: input.body }).catch(() => {})
  }, { path, body })

export const requestBodies = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} request bodies`, () => {
    layer(SharedContext.layer(backend), { excludeTestServices: true, timeout })((raw) => {
      const it = SharedContext.guard(raw)
      it.effect(
        "collects native text without waiting for an unfinished response, and probes absent versus empty",
        () =>
          Effect.gen(function*() {
            const { page, origin } = yield* open()
            const wait = yield* NetworkRequest.next(page, { url: "**/pending-image", body: (message) => message.text })
            yield* post(page, `${origin}/pending-image`, "hello")
            assert.deepStrictEqual((yield* wait).body, Option.some("hello"))
            for (const empty of [false, true]) {
              const captured = yield* NetworkRequest.next(page, { url: "**/echo", body: (message) => message.text })
              yield* page.evaluateInMainWorld((empty) => {
                void fetch("/echo", empty ? { method: "POST", body: "" } : {}).catch(() => {})
              }, empty)
              if (!(yield* supports("network.requestBody.absence"))) {
                const error = yield* captured.pipe(Effect.flip)
                assert.strictEqual(error._tag, "RequestError")
                if (error._tag === "RequestError") {
                  assert.deepInclude(error.reason, { _tag: "BodyUnavailable", why: "unavailable" })
                }
                continue
              }
              const body = (yield* captured).body
              console.log(
                `${name} native ${empty ? "empty POST" : "bodyless GET"}: ${
                  Option.isSome(body) ? JSON.stringify(body.value) : "None"
                }`
              )
              if (!empty) assert.isTrue(Option.isNone(body))
              else if (yield* supports("network.requestBody.empty")) assert.deepStrictEqual(body, Option.some(""))
              else assert.isTrue(Option.isNone(body))
            }
          }),
        timeout
      )

      it.effect("returns owned bytes or a typed native representation refusal", () =>
        Effect.gen(function*() {
          const { page } = yield* open()
          const hasBytes = yield* supports("network.requestBody.bytes")
          const wait = yield* NetworkRequest.next(page, { url: "**/echo", body: (message) => message.arrayBuffer })
            .pipe(NetworkRequest.withBodyLimit(hasBytes ? 4 : "10 MiB"))
          yield* page.evaluateInMainWorld(() => {
            void fetch("/echo", { method: "POST", body: new Uint8Array([0, 255, 128, 42]) }).catch(() => {})
          })
          if (hasBytes) {
            assert.deepStrictEqual([...new Uint8Array(Option.getOrThrow((yield* wait).body))], [0, 255, 128, 42])
          } else {
            const error = yield* wait.pipe(Effect.flip)
            assert.strictEqual(error._tag, "RequestError")
            if (error._tag === "RequestError") {
              assert.deepInclude(error.reason, { _tag: "BodyUnavailable", why: "unsupportedRepresentation" })
            }
          }
        }), timeout)

      it.effect(
        "enforces each subscriber's limit without disabling the surviving collection",
        () =>
          Effect.gen(function*() {
            const { page, origin } = yield* open()
            const smallScope = yield* Scope.fork(yield* Effect.scope)
            const small = yield* NetworkRequest.next(page, { url: "**/echo", body: (message) => message.text }).pipe(
              NetworkRequest.withBodyLimit(4),
              Scope.provide(smallScope)
            )
            const exact = yield* NetworkRequest.next(page, { url: "**/echo", body: (message) => message.text }).pipe(
              NetworkRequest.withBodyLimit(5)
            )
            yield* post(page, `${origin}/echo`, "12345")
            const error = yield* small.pipe(Effect.flip)
            assert.strictEqual(error._tag, "RequestError")
            if (error._tag === "RequestError") {
              assert.deepInclude(error.reason, { _tag: "BodyTruncated", why: "overLimit" })
            }
            yield* Scope.close(smallScope, Exit.void)
            assert.deepStrictEqual((yield* exact).body, Option.some("12345"))
          }),
        timeout
      )

      it.effect(
        "keeps redirect hop identity and refuses native data that cannot address a later body",
        () =>
          Effect.gen(function*() {
            const { page, origin } = yield* open()
            const independent = yield* supports("network.requestBody.redirects")
            const first = yield* NetworkRequest.next(page, { url: "**/to-echo" })
            const last = yield* NetworkRequest.next(page, { url: "**/echo", body: (message) => message.text })
            yield* post(page, `${origin}/to-echo`, "preserved")
            const initial = yield* first
            if (independent) {
              const redirected = yield* last
              assert.notStrictEqual(redirected.hop, initial.hop)
              assert.deepStrictEqual(redirected.body, Option.some("preserved"))
            } else {
              const error = yield* last.pipe(Effect.flip)
              assert.strictEqual(error._tag, "RequestError")
              if (error._tag === "RequestError") {
                assert.deepInclude(error.reason, { _tag: "BodyUnavailable", why: "redirect" })
              }
            }
            const after302 = yield* NetworkRequest.next(page, {
              url: "**/landed",
              body: (message) => message.text
            })
            yield* post(page, `${origin}/redirect`, "discarded")
            if (yield* supports("network.requestBody.absence")) {
              assert.isTrue(Option.isNone((yield* after302).body))
            } else {
              const error = yield* after302.pipe(Effect.flip)
              assert.strictEqual(error._tag, "RequestError")
              if (error._tag === "RequestError") {
                assert.deepInclude(error.reason, { _tag: "BodyUnavailable", why: "unavailable" })
              }
            }
          }),
        timeout
      )

      it.effect(
        "keeps a body stream collecting after overlapping HAR and smaller subscriptions close",
        () =>
          Effect.gen(function*() {
            const { page, origin } = yield* open()
            const stream = yield* NetworkRequest.stream(page, { url: "**/echo", body: (message) => message.text }).pipe(
              NetworkRequest.withBodyLimit(5)
            )
            const queue = yield* Stream.toQueue(stream, { capacity: 2 })
            const overlapping = yield* Scope.fork(yield* Effect.scope)
            const har = yield* Har.record(page, { content: "omit", url: "**/echo" }).pipe(Scope.provide(overlapping))
            const small = yield* NetworkRequest.next(page, { url: "**/echo", body: (message) => message.text }).pipe(
              NetworkRequest.withBodyLimit(4),
              Scope.provide(overlapping)
            )
            yield* post(page, `${origin}/echo`, "first")
            const refused = yield* small.pipe(Effect.flip)
            assert.strictEqual(refused._tag, "RequestError")
            assert.deepStrictEqual((yield* Queue.take(queue)).body, Option.some("first"))
            yield* har.entries.waitFor((count) => count >= 1)
            yield* Scope.close(overlapping, Exit.void)
            yield* post(page, `${origin}/echo`, "later")
            assert.deepStrictEqual((yield* Queue.take(queue)).body, Option.some("later"))
          }),
        timeout
      )

      it.effect("never reports a Blob body as absent or empty", () =>
        Effect.gen(function*() {
          const { page } = yield* open()
          const wait = yield* NetworkRequest.next(page, { url: "**/echo", body: (message) => message.text })
          yield* page.evaluateInMainWorld(() => {
            void fetch("/echo", { method: "POST", body: new Blob(["blob-content"]) }).catch(() => {})
          })
          const result = yield* Effect.result(wait)
          // The browser sent twelve bytes: they are delivered, or the read fails as a typed refusal.
          if (result._tag === "Success") assert.deepStrictEqual(result.success.body, Option.some("blob-content"))
          else {
            assert.strictEqual(result.failure._tag, "RequestError")
            if (result.failure._tag === "RequestError") {
              assert.deepInclude(result.failure.reason, { _tag: "BodyUnavailable", why: "unavailable" })
            }
          }
        }), timeout)

      it.effect("does not decode multipart reports with unknown completeness", () =>
        Effect.gen(function*() {
          const { page } = yield* open()
          // Firefox's collector can return complete multipart bytes; CDP and WebKit omit file data in event reports.
          const nativeMultipart = yield* supports("network.requestBody.multipart")
          let decoded = false
          const wait = yield* NetworkRequest.next(page, {
            url: "**/echo",
            body: (message) =>
              Effect.tap(message.text, () =>
                Effect.sync(() => {
                  decoded = true
                }))
          })
          yield* page.evaluateInMainWorld(() => {
            const form = new FormData()
            form.append("file", new Blob(["file-content"]), "file.txt")
            void fetch("/echo", { method: "POST", body: form }).catch(() => {})
          })
          if (nativeMultipart) assert.include(Option.getOrThrow((yield* wait).body), "file-content")
          else {
            const error = yield* wait.pipe(Effect.flip)
            assert.strictEqual(error._tag, "RequestError")
            if (error._tag === "RequestError") {
              assert.deepInclude(error.reason, { _tag: "BodyTruncated", why: "incomplete" })
            }
            assert.isFalse(decoded)
          }
        }), timeout)
    })

    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect(
        "isolates body subscriptions between contexts with the same URL",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const served = yield* site
            const browser = yield* Browser.Browser
            const first = yield* browser.newContext()
            const second = yield* browser.newContext()
            const page = yield* first.newPage
            const other = yield* second.newPage
            yield* page.goto(`${served.origin}/form`)
            yield* other.goto(`${served.origin}/form`)
            const captured = yield* NetworkRequest.next(first, { url: "**/echo", body: (message) => message.text })
            const plain = yield* NetworkRequest.next(second, { url: "**/echo" })
            yield* post(other, `${served.origin}/echo`, "foreign")
            yield* plain
            yield* post(page, `${served.origin}/echo`, "owned")
            assert.deepStrictEqual((yield* captured).body, Option.some("owned"))
          })),
        timeout
      )
    })
  })
