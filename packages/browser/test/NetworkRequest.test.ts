/** Immediate failure observations use existing model facts, without browser work. */
import { assert, describe, it } from "@effect/vitest"
import { NetworkRequest, NetworkResponse, Page, Target, Url, UserContext } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Fold from "../src/internal/fold.ts"
import * as Handles from "../src/internal/handles.ts"
import type * as Runtime from "../src/internal/runtime.ts"

const contextId = "context" as UserContext.Id
const pageId = "page" as Target.NavigableId
const frameId = "frame" as Target.NavigableId
const realm = "worker" as Target.RealmId

const setup = Effect.fnUntraced(function*(protocol: "cdp" | "bidi" | "webkit" = "cdp") {
  const fold = yield* Fold.make({ release: () => Effect.void })
  yield* fold.sink({
    _tag: "PageAdded",
    page: pageId,
    context: contextId,
    kind: "tab",
    origin: { _tag: "Created" },
    url: "about:blank" as Url.Url
  })
  const entry = Option.getOrThrow(fold.page(pageId))
  // Only model reads are available: accidentally adding feature declarations or protocol calls fails here.
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
  const sent = (id = "request", initiator: NetworkRequest.Initiator = {
    _tag: "Document",
    navigable: pageId,
    navigation: Option.none()
  }) =>
    new NetworkRequest.NetworkRequest({
      hop: `${id}.0` as NetworkRequest.HopId,
      method: "GET",
      url: "https://example.com/" as Url.Url,
      headers: Headers.empty,
      resourceType: "fetch",
      initiator,
      at: 0 as NetworkRequest.NetworkRequest["at"]
    })
  const request = sent()
  yield* fold.sink({ _tag: "RequestSent", request })
  const fail = (canceled = false, error = "net::ERR_FAILED") =>
    fold.sink({
      _tag: "RequestFailed",
      hop: request.hop,
      error,
      canceled,
      at: request.at
    })
  return { fold, runtime, page, context, request, sent, fail }
})

describe("NetworkRequest.failure", () => {
  it.effect("reads pending and HTTP-error success immediately without adapter work or terminal changes", () =>
    Effect.gen(function*() {
      const { fold, page, context, request } = yield* setup()
      const hop = Option.getOrThrow(fold.hop(request.hop))
      assert.isTrue(Option.isNone(yield* NetworkRequest.failure(page, request)))
      assert.isFalse(Deferred.isDoneUnsafe(hop.end))
      yield* fold.sink({
        _tag: "ResponseReceived",
        response: new NetworkResponse.NetworkResponse({
          hop: request.hop,
          url: request.url,
          status: 503 as NetworkResponse.StatusCode,
          statusText: "Unavailable",
          httpVersion: Option.none(),
          headers: Headers.empty,
          servedBy: "network",
          at: request.at
        })
      })
      yield* fold.sink({ _tag: "RequestFinished", hop: request.hop, encodedBytes: 0, at: request.at })
      assert.isTrue(Option.isNone(yield* NetworkRequest.failure(context, request)))
    }))

  for (const protocol of ["cdp", "webkit", "bidi"] as const) {
    it.effect(`preserves failure text and cancellation evidence on ${protocol}`, () =>
      Effect.gen(function*() {
        const { page, context, request, fail } = yield* setup(protocol)
        yield* fail(true, "arbitrary ABORTED text")
        const failure = Option.getOrThrow(yield* NetworkRequest.failure(page, request))
        assert.strictEqual(failure.errorText, "arbitrary ABORTED text")
        assert.deepStrictEqual(failure.canceled, protocol === "bidi" ? Option.none() : Option.some(true))
        assert.deepStrictEqual(yield* NetworkRequest.failure(context, request), Option.some(failure))
      }))
  }

  it.effect("does not infer cancellation from text or confuse another redirect hop", () =>
    Effect.gen(function*() {
      const { fold, page, request, fail } = yield* setup()
      yield* fail(false, "ABORTED")
      assert.deepStrictEqual(
        Option.getOrThrow(yield* NetworkRequest.failure(page, request)).canceled,
        Option.some(false)
      )
      const next = new NetworkRequest.NetworkRequest({ ...request, hop: "request.1" as NetworkRequest.HopId })
      yield* fold.sink({ _tag: "RequestSent", request: next })
      assert.isTrue(Option.isNone(yield* NetworkRequest.failure(page, next)))
    }))

  it.effect("refuses unknown, copied and cross-runtime requests even when hop ids collide", () =>
    Effect.gen(function*() {
      const first = yield* setup()
      const other = yield* setup()
      for (
        const request of [first.sent("missing"), new NetworkRequest.NetworkRequest({ ...first.request }), other.request]
      ) {
        const error = yield* NetworkRequest.failure(first.page, request).pipe(Effect.flip)
        assert.strictEqual(error.reason._tag, "RequestUnavailable")
      }
      assert.isFalse(Deferred.isDoneUnsafe(Option.getOrThrow(other.fold.hop(other.request.hop)).end))
    }))

  it.effect("refuses another page and context without adding work to that context", () =>
    Effect.gen(function*() {
      const { fold, runtime, request } = yield* setup()
      const otherId = "other" as Target.NavigableId
      yield* fold.sink({
        _tag: "PageAdded",
        page: otherId,
        context: "other" as UserContext.Id,
        kind: "tab",
        origin: { _tag: "Created" },
        url: "about:blank" as Url.Url
      })
      const entry = Option.getOrThrow(fold.page(otherId))
      const page = {} as Page.ObservedPage
      const context = {} as UserContext.ObservedUserContext
      Handles.registerPage(page, { runtime, entry, grant: Option.none() })
      Handles.registerContext(context, { runtime, entry: entry.contextEntry, grant: Option.none() })
      for (const target of [page, context]) {
        const error = yield* NetworkRequest.failure(target, request).pipe(Effect.flip)
        assert.strictEqual(error.reason._tag, "RequestUnavailable")
      }
      assert.deepStrictEqual(entry.state.getUnsafe().routes, [])
      assert.deepStrictEqual(entry.contextEntry.state.getUnsafe().routes, [])
    }))

  it.effect("refuses an evicted hop", () =>
    Effect.gen(function*() {
      const { fold, page, request, sent } = yield* setup()
      for (let i = 0; i < Fold.maxHops; i++) yield* fold.sink({ _tag: "RequestSent", request: sent(`evict-${i}`) })
      const error = yield* NetworkRequest.failure(page, request).pipe(Effect.flip)
      assert.strictEqual(error.reason._tag, "RequestUnavailable")
    }))

  for (const terminal of ["frame", "worker", "page", "context", "disconnect"] as const) {
    it.effect(`refuses previously failed requests after ${terminal} loss`, () =>
      Effect.gen(function*() {
        const { fold, page, context, sent } = yield* setup()
        yield* fold.sink({ _tag: "FrameAdded", frame: frameId, parent: pageId, page: pageId })
        yield* fold.sink({
          _tag: "RealmAdded",
          realm,
          origin: "https://example.com",
          kind: {
            _tag: "Worker",
            worker: { _tag: "Shared" },
            url: "https://example.com/worker.js" as Url.Url,
            page: Option.none(),
            context: Option.some(contextId)
          }
        })
        const request = sent(
          "owned",
          terminal === "worker" ? { _tag: "Worker", realm } : {
            _tag: "Document",
            navigable: terminal === "frame" ? frameId : pageId,
            navigation: Option.none()
          }
        )
        yield* fold.sink({ _tag: "RequestSent", request })
        yield* fold.sink({ _tag: "RequestFailed", hop: request.hop, error: "failed", canceled: false, at: request.at })
        const target = terminal === "worker" ? context : page
        assert.isTrue(Option.isSome(yield* NetworkRequest.failure(target, request)))
        if (terminal === "frame" || terminal === "page") {
          yield* fold.sink({
            _tag: "NavigableRemoved",
            navigable: terminal === "frame" ? frameId : pageId,
            reason: new Target.FrameDetached({}),
            evidence: "test"
          })
        } else if (terminal === "worker") {
          yield* fold.sink({ _tag: "RealmRemoved", realm, reason: new Target.ConnectionLost({}) })
        } else if (terminal === "context") {
          yield* fold.sink({ _tag: "UserContextRemoved", context: contextId })
        } else yield* fold.loseConnection
        const error = yield* NetworkRequest.failure(target, request).pipe(Effect.flip)
        assert.strictEqual(error.reason._tag, "RequestUnavailable")
      }))
  }

  it.effect("refuses a synthetic disconnect failure instead of exposing it", () =>
    Effect.gen(function*() {
      const { fold, page, request } = yield* setup()
      yield* fold.loseConnection
      const error = yield* NetworkRequest.failure(page, request).pipe(Effect.flip)
      assert.strictEqual(error.reason._tag, "RequestUnavailable")
    }))
})
