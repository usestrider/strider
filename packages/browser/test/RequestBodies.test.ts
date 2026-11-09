/** Request body subscriptions without a browser: ownership, decoding and scoped collection. */
import { assert, describe, it } from "@effect/vitest"
import { NetworkRequest, Page, Target, Url } from "@usestrider/browser"
import * as ByteSize from "effect/ByteSize"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Events from "../src/internal/events.ts"
import * as Handles from "../src/internal/handles.ts"
import type * as Model from "../src/internal/model.ts"
import type * as Runtime from "../src/internal/runtime.ts"

const sent = (headers: Record<string, string> = {}) => new NetworkRequest.NetworkRequest({
  hop: "request.0" as NetworkRequest.HopId,
  method: "POST",
  url: "https://example.test/send" as Url.Url,
  headers: Headers.fromInput(headers),
  resourceType: "fetch",
  initiator: { _tag: "Unattributed" },
  at: 0 as NetworkRequest.NetworkRequest["at"]
})

const setup = (body: unknown) => {
  const channel = Events.make<NetworkRequest.NetworkRequest>({ _tag: "Browser" }, () => 10)
  const declarations: Array<Adapter.Declaration> = []
  let reads = 0
  let released = 0
  const page = {} as Page.ReadonlyPage
  const adapter = {
    declare: (_scope: Adapter.DeclarationScope, declaration: Adapter.Declaration) =>
      Effect.gen(function*() {
        declarations.push(declaration)
        yield* Effect.addFinalizer(() => Effect.sync(() => { released++ }))
        return "registration" as Adapter.RegistrationId
      }),
    captureRequestBody: () => Effect.sync(() => { reads++; return body })
  }
  Handles.registerPage(page, {
    grant: Option.none(),
    entry: { id: "page" as Target.NavigableId, events: { request: channel } } as Model.PageEntry,
    runtime: { backend: "test", model: { adapter } } as unknown as Runtime.Runtime
  })
  return { page, channel, declarations, reads: () => reads, released: () => released }
}

const bytes = (text: string) => ({ _tag: "Bytes", bytes: new TextEncoder().encode(text) })

describe("Request body subscriptions", () => {
  it.live("collects before returning, decodes before any response and owns the result after scope closure", () =>
    Effect.gen(function*() {
      const world = setup(bytes("hello"))
      const result = yield* Effect.scoped(Effect.gen(function*() {
        const wait = yield* NetworkRequest.next(world.page, { url: "**/send", body: (message) => message.text })
        assert.deepStrictEqual(world.declarations, [{ _tag: "BodyCollection", bodies: ["request"], maxBytes: 10485760 }])
        Events.publish(world.channel, sent())
        return yield* wait
      }))
      assert.deepStrictEqual(result.body, Option.some("hello"))
      assert.strictEqual(world.released(), 1)
    }))

  it.live("keeps plain subscriptions and history free of body work", () => Effect.scoped(Effect.gen(function*() {
    const world = setup(bytes("unused"))
    const wait = yield* NetworkRequest.next(world.page, { url: "**/send" })
    const request = sent()
    Events.publish(world.channel, request)
    assert.strictEqual(yield* wait, request)
    assert.strictEqual((yield* NetworkRequest.history(world.page)).entries[0], request)
    assert.isEmpty(world.declarations)
    assert.strictEqual(world.reads(), 0)
  })))

  it.live("distinguishes absent from an explicit empty body without invoking the absent decoder", () => Effect.scoped(Effect.gen(function*() {
    let calls = 0
    for (const [body, expected] of [[{ _tag: "Absent" }, Option.none()], [bytes(""), Option.some("")]] as const) {
      const world = setup(body)
      const wait = yield* NetworkRequest.next(world.page, {
        url: "**/send",
        body: (message) => Effect.tap(message.text, () => Effect.sync(() => { calls++ }))
      })
      Events.publish(world.channel, sent())
      assert.deepStrictEqual((yield* wait).body, expected)
    }
    assert.strictEqual(calls, 1)
  })))

  it.live("rejects over-limit and incomplete bodies before the decoder sees them", () => Effect.scoped(Effect.gen(function*() {
    for (const body of [bytes("12345"), { _tag: "Incomplete" }]) {
      const world = setup(body)
      let decoded = false
      const wait = yield* NetworkRequest.next(world.page, {
        url: "**/send", body: () => Effect.sync(() => { decoded = true })
      }).pipe(Effect.provideService(NetworkRequest.BodyLimit, ByteSize.bytes(4)))
      Events.publish(world.channel, sent())
      const error = yield* wait.pipe(Effect.flip)
      assert.strictEqual(error._tag, "RequestError")
      if (error._tag === "RequestError") assert.strictEqual(error.reason._tag, "BodyTruncated")
      assert.isFalse(decoded)
    }
  })))

  it.live("copies binary data for every read and subscriber", () => Effect.scoped(Effect.gen(function*() {
    const body = { _tag: "Bytes", bytes: new Uint8Array([0, 255, 128]) }
    const world = setup(body)
    const mutate = yield* NetworkRequest.next(world.page, { url: "**/send", body: (message) => Effect.gen(function*() {
      new Uint8Array(yield* message.arrayBuffer)[0] = 99
      return [...new Uint8Array(yield* message.arrayBuffer)]
    }) })
    const read = yield* NetworkRequest.next(world.page, { url: "**/send", body: (message) => message.arrayBuffer })
    Events.publish(world.channel, sent())
    assert.deepStrictEqual((yield* mutate).body, Option.some([0, 255, 128]))
    assert.deepStrictEqual([...new Uint8Array(Option.getOrThrow((yield* read).body))], [0, 255, 128])
    assert.deepStrictEqual([...body.bytes], [0, 255, 128])
  })))

  it.live("decodes forms without losing duplicate keys and keeps malformed JSON out of hints", () => Effect.scoped(Effect.gen(function*() {
    const world = setup(bytes("x=a+b&x=%2B&empty="))
    const wait = yield* NetworkRequest.next(world.page, { url: "**/send", body: (message) => message.urlParamsBody })
    Events.publish(world.channel, sent({ "content-type": "application/x-www-form-urlencoded" }))
    assert.deepStrictEqual(Option.getOrThrow((yield* wait).body), [["x", "a b"], ["x", "+"], ["empty", ""]])
    const invalid = setup(bytes("secret-payload"))
    const json = yield* NetworkRequest.next(invalid.page, { url: "**/send", body: (message) => message.json })
    Events.publish(invalid.channel, sent())
    const error = yield* json.pipe(Effect.flip)
    assert.strictEqual(error._tag, "RequestError")
    assert.notInclude(JSON.stringify(error), "secret-payload")
  })))

  it.live("preserves reported text while refusing exact-byte reads", () => Effect.scoped(Effect.gen(function*() {
    const world = setup({ _tag: "ReportedText", text: "héllo" })
    const text = yield* NetworkRequest.next(world.page, { url: "**/send", body: (message) => message.text })
    const binary = yield* NetworkRequest.next(world.page, { url: "**/send", body: (message) => message.arrayBuffer })
    Events.publish(world.channel, sent())
    assert.deepStrictEqual((yield* text).body, Option.some("héllo"))
    const error = yield* binary.pipe(Effect.flip)
    assert.strictEqual(error._tag, "RequestError")
    if (error._tag === "RequestError") assert.deepInclude(error.reason, { _tag: "BodyUnavailable", why: "unsupportedRepresentation" })
  })))

  it.live("starts stream capture before consumption and cancels reads with its scope", () => Effect.gen(function*() {
    const world = setup(bytes("streamed"))
    const scope = yield* Scope.make()
    const started = yield* Deferred.make<void>()
    const stream = yield* NetworkRequest.stream(world.page, { body: (message) => Effect.tap(message.text, () => Deferred.succeed(started, undefined)) }).pipe(Effect.provideService(Scope.Scope, scope))
    Events.publish(world.channel, sent())
    yield* Deferred.await(started)
    const result = yield* Stream.runHead(stream)
    assert.deepStrictEqual(Option.getOrThrow(result).body, Option.some("streamed"))
    yield* Scope.close(scope, (yield* Effect.exit(Effect.void)))
    assert.strictEqual(world.released(), 1)
  }))
})
