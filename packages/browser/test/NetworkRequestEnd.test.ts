/** Request ends are published from the model's existing facts, and one hop's end can be awaited. */
import { assert, describe, it } from "@effect/vitest"
import { NetworkRequest, NetworkRequestEnd, NetworkResponse, Page, Target, Url, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Fold from "../src/internal/fold.ts"
import * as Handles from "../src/internal/handles.ts"
import type * as Runtime from "../src/internal/runtime.ts"

const contextId = "context" as UserContext.Id
const pageId = "page" as Target.NavigableId

const setup = Effect.fnUntraced(function*(protocol: "cdp" | "bidi" | "webkit" = "cdp") {
  const fold = yield* Fold.make({ release: () => Effect.void })
  const addPage = (page: Target.NavigableId, context: UserContext.Id) =>
    fold.sink({
      _tag: "PageAdded",
      page,
      context,
      kind: "tab",
      origin: { _tag: "Created" },
      url: "about:blank" as Url.Url
    })
  yield* addPage(pageId, contextId)
  yield* addPage("other-page" as Target.NavigableId, "other-context" as UserContext.Id)
  const entry = Option.getOrThrow(fold.page(pageId))
  const adapter = new Proxy({ info: { protocol } }, {
    get(target, key) {
      if (key === "info") return target.info
      throw new Error(`Unexpected adapter work: ${String(key)}`)
    }
  })
  const runtime = { model: { ...fold, adapter } } as unknown as Runtime.Runtime
  const page = {} as Page.ObservedPage
  const context = {} as UserContext.ObservedUserContext
  Handles.registerPage(page, { runtime, entry, grant: Option.none() })
  Handles.registerContext(context, { runtime, entry: entry.contextEntry, grant: Option.none() })
  const send = Effect.fnUntraced(function*(id: string, navigable: Target.NavigableId = pageId) {
    const request = new NetworkRequest.NetworkRequest({
      hop: `${id}.0` as NetworkRequest.HopId,
      method: "GET",
      url: `https://example.com/${id}` as Url.Url,
      headers: Headers.empty,
      resourceType: "fetch",
      initiator: { _tag: "Document", navigable, navigation: Option.none() },
      at: 0 as NetworkRequest.NetworkRequest["at"]
    })
    yield* fold.sink({ _tag: "RequestSent", request })
    return request
  })
  const respond = (request: NetworkRequest.NetworkRequest, status = 404) =>
    fold.sink({
      _tag: "ResponseReceived",
      response: new NetworkResponse.NetworkResponse({
        hop: request.hop,
        url: request.url,
        status: status as NetworkResponse.StatusCode,
        statusText: "",
        httpVersion: Option.none(),
        headers: Headers.empty,
        servedBy: "network",
        at: request.at
      })
    })
  const finish = (request: NetworkRequest.NetworkRequest) =>
    fold.sink({
      _tag: "RequestFinished",
      hop: request.hop,
      transferBytes: Option.none(),
      bodyBytes: Option.none(),
      at: request.at
    })
  const fail = (request: NetworkRequest.NetworkRequest, error = "net::ERR_FAILED", canceled = false) =>
    fold.sink({ _tag: "RequestFailed", hop: request.hop, error, canceled, at: request.at })
  return { fold, page, context, send, respond, finish, fail }
})

describe("NetworkRequestEnd", () => {
  it.effect("delivers a finished hop on its page and its context, after its response", () =>
    Effect.gen(function*() {
      const { page, context, send, respond, finish } = yield* setup()
      const onPage = yield* NetworkRequestEnd.stream(page)
      const onContext = yield* NetworkRequestEnd.stream(context)
      const request = yield* send("a")
      yield* respond(request)
      yield* finish(request)
      for (const ends of [onPage, onContext]) {
        const end = Option.getOrThrow(yield* Stream.runHead(ends))
        assert.strictEqual(end._tag, "Finished")
        assert.strictEqual(end.request, request)
      }
      const history = yield* NetworkRequestEnd.history(page, { end: "finished" })
      assert.strictEqual(history.entries.length, 1)
    }).pipe(Effect.scoped))

  for (const protocol of ["cdp", "webkit", "bidi"] as const) {
    it.effect(`delivers a failure with its text on ${protocol}`, () =>
      Effect.gen(function*() {
        const { page, send, fail } = yield* setup(protocol)
        const failed = yield* NetworkRequestEnd.next(page, { url: "https://example.com/a", end: "failed" })
        const request = yield* send("a")
        yield* fail(request, "net::ERR_ABORTED", true)
        const end = yield* failed
        assert.strictEqual(end._tag, "Failed")
        if (end._tag !== "Failed") return
        assert.strictEqual(end.request, request)
        assert.strictEqual(end.failure.errorText, "net::ERR_ABORTED")
        assert.deepStrictEqual(end.failure.canceled, protocol === "bidi" ? Option.none() : Option.some(true))
      }).pipe(Effect.scoped))
  }

  it.effect("delivers nothing from before the subscription or from another context", () =>
    Effect.gen(function*() {
      const { context, send, finish } = yield* setup()
      const early = yield* send("early")
      yield* finish(early)
      const ends = yield* NetworkRequestEnd.stream(context)
      const elsewhere = yield* send("elsewhere", "other-page" as Target.NavigableId)
      yield* finish(elsewhere)
      const late = yield* send("late")
      yield* finish(late)
      const end = Option.getOrThrow(yield* Stream.runHead(ends))
      assert.strictEqual(end.request, late)
    }).pipe(Effect.scoped))

  it.effect("publishes nothing for a forgotten or torn-down hop", () =>
    Effect.gen(function*() {
      const { fold, page, send } = yield* setup()
      yield* send("forgotten")
      for (let i = 0; i < Fold.maxHops; i++) yield* send(`evict-${i}`)
      yield* send("torn")
      yield* fold.loseConnection(new Target.ConnectionLost({}))
      const history = yield* NetworkRequestEnd.history(page)
      assert.strictEqual(history.entries.length, 0)
    }))

  it.effect("filters by the request's URL, method and resource type", () =>
    Effect.gen(function*() {
      const { page, send, finish } = yield* setup()
      yield* finish(yield* send("a"))
      yield* finish(yield* send("b"))
      const history = yield* NetworkRequestEnd.history(page, { url: "https://example.com/b", method: "GET" })
      assert.deepStrictEqual(history.entries.map((end) => end.request.url), ["https://example.com/b"])
    }))
})

describe("NetworkRequestEnd.of", () => {
  it.effect("gives an ended hop's end at once", () =>
    Effect.gen(function*() {
      const { page, send, respond, finish } = yield* setup()
      const request = yield* send("a")
      yield* respond(request, 200)
      yield* finish(request)
      const end = yield* yield* NetworkRequestEnd.of(page, request)
      assert.strictEqual(end._tag, "Finished")
      assert.strictEqual(end.request, request)
    }).pipe(Effect.scoped))

  it.effect("waits for an in-flight hop, and gives its failure", () =>
    Effect.gen(function*() {
      const { context, send, finish, fail } = yield* setup()
      const finished = yield* send("finished")
      const failed = yield* send("failed")
      const finishing = yield* Effect.forkChild(yield* NetworkRequestEnd.of(context, finished))
      const failing = yield* Effect.forkChild(yield* NetworkRequestEnd.of(context, failed))
      yield* Effect.yieldNow
      yield* finish(finished)
      yield* fail(failed, "net::ERR_CONNECTION_REFUSED")
      assert.strictEqual((yield* Fiber.join(finishing))._tag, "Finished")
      const end = yield* Fiber.join(failing)
      assert.isTrue(end._tag === "Failed" && end.failure.errorText === "net::ERR_CONNECTION_REFUSED")
    }).pipe(Effect.scoped))

  it.effect("fails once released, evicted or torn down, and for another target's hop", () =>
    Effect.gen(function*() {
      const { fold, page, context, send } = yield* setup()
      const reason = (exit: Exit.Exit<unknown, NetworkRequest.RequestError | unknown>) => {
        const error = Exit.isFailure(exit) ? Option.getOrThrow(Exit.findErrorOption(exit)) : undefined
        return (error as NetworkRequest.RequestError).reason as NetworkRequest.ResponseUnavailable
      }

      const scope = yield* Scope.make()
      const released = yield* NetworkRequestEnd.of(page, yield* send("released")).pipe(Scope.provide(scope))
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(reason(yield* Effect.exit(released)).why, "released")

      const evicted = yield* NetworkRequestEnd.of(page, yield* send("evicted"))
      for (let i = 0; i < Fold.maxHops; i++) yield* send(`evict-${i}`)
      assert.strictEqual(reason(yield* Effect.exit(evicted)).why, "evicted")

      const foreign = yield* send("foreign", "other-page" as Target.NavigableId)
      assert.strictEqual(reason(yield* Effect.exit(NetworkRequestEnd.of(context, foreign))).why, "foreignTarget")

      const torn = yield* NetworkRequestEnd.of(page, yield* send("torn"))
      yield* fold.loseConnection(new Target.ConnectionLost({}))
      assert.strictEqual(reason(yield* Effect.exit(torn)).why, "targetClosed")
    }).pipe(Effect.scoped))
})
