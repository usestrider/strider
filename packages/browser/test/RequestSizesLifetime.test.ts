import { assert, describe, it } from "@effect/vitest"
import { NetworkRequest, Page, Target, Url, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Fold from "../src/internal/fold.ts"
import * as Handles from "../src/internal/handles.ts"
import type * as Runtime from "../src/internal/runtime.ts"
const empty = () =>
  new NetworkRequest.Sizes({
    requestHeadersSize: Option.none(), requestBodySize: Option.none(), responseHeadersSize: Option.none(),
    responseBodySize: Option.none(), responseBodyEncodedSize: Option.none(), responseBodyDecodedSize: Option.none(),
    responseTransferSize: Option.none()
  })
const contextId = "context" as UserContext.Id
const pageId = "page" as Target.NavigableId

const setup = Effect.fnUntraced(function*(enabled = true) {
  const fold = yield* Fold.make({ release: () => Effect.void })
  yield* fold.sink({ _tag: "UserContextAdded", context: contextId, isDefault: false, requestSizes: enabled })
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
  const adapter = new Proxy({ info: { protocol: "cdp" } }, {
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

describe("request sizes ownership and isolation", () => {
  it.effect("allocates sizes storage only for opted-in contexts and never sends adapter work", () =>
    Effect.gen(function*() {
      const off = yield* setup(false)
      const on = yield* setup()
      const offOwner = Option.getOrThrow(off.fold.hop(off.request.hop)).context
      const onOwner = Option.getOrThrow(on.fold.hop(on.request.hop)).context
      assert.isUndefined(Option.getOrThrow(offOwner).sizess)
      assert.instanceOf(Option.getOrThrow(onOwner).sizess, Map)
      const refused = yield* NetworkRequest.sizes(off.page, off.request).pipe(Effect.flip)
      assert.strictEqual(refused.reason._tag, "RequestUnavailable")
      assert.deepInclude(refused.reason, { _tag: "RequestUnavailable", why: "sizesNotEnabled" })
      yield* off.fold.sink({ _tag: "HopSizes", hop: off.request.hop, sizes: empty() })
      assert.isUndefined(Option.getOrThrow(offOwner).sizess)
      assert.deepStrictEqual((yield* NetworkRequest.sizes(on.page, on.request)).responseTransferSize, Option.none())
    }))
})

describe("request sizes lifecycle", () => {
  it.effect("returns immutable observations and preserves header phases after failure", () =>
    Effect.gen(function*() {
      const { fold, page, request, fail } = yield* setup()
      const before = yield* NetworkRequest.sizes(page, request)
      const headers = new NetworkRequest.Sizes({ ...before, responseHeadersSize: Option.some(4) })
      yield* fold.sink({ _tag: "HopSizes", hop: request.hop, sizes: headers })
      yield* fail()
      const after = yield* NetworkRequest.sizes(page, request)
      assert.deepStrictEqual(before.responseHeadersSize, Option.none())
      assert.deepStrictEqual(after.responseHeadersSize, Option.some(4))
      assert.deepStrictEqual(after.responseTransferSize, Option.none())
      const next = new NetworkRequest.NetworkRequest({ ...request, hop: "request.1" as NetworkRequest.HopId })
      yield* fold.sink({ _tag: "RequestSent", request: next })
      assert.deepStrictEqual((yield* NetworkRequest.sizes(page, next)).responseHeadersSize, Option.none())
    }))
  it.effect("refuses copied and cross-runtime requests and gives owner loss precedence", () =>
    Effect.gen(function*() {
      const a = yield* setup()
      const b = yield* setup()
      for (const request of [new NetworkRequest.NetworkRequest({ ...a.request }), b.request]) {
        const error = yield* NetworkRequest.sizes(a.page, request).pipe(Effect.flip)
        assert.deepInclude(error.reason, { _tag: "RequestUnavailable", why: "notRetained" })
      }
      const owner = Option.getOrThrow(Option.getOrThrow(a.fold.hop(a.request.hop)).context)
      yield* a.fold.sink({ _tag: "HopSizes", hop: a.request.hop, sizes: empty() })
      yield* a.fold.loseConnection
      assert.strictEqual(owner.sizess?.size, 0)
      const error = yield* NetworkRequest.sizes(a.page, a.request).pipe(Effect.flip)
      assert.deepInclude(error.reason, { _tag: "RequestUnavailable", why: "ownerLost" })
    }))
  it.effect("bounds sizes retention by hop eviction", () =>
    Effect.gen(function*() {
      const { fold, page, request, sent } = yield* setup()
      const owner = Option.getOrThrow(Option.getOrThrow(fold.hop(request.hop)).context)
      yield* fold.sink({ _tag: "HopSizes", hop: request.hop, sizes: empty() })
      for (let i = 0; i < Fold.maxHops; i++) yield* fold.sink({ _tag: "RequestSent", request: sent(`other-${i}`) })
      assert.strictEqual(owner.sizess?.size, 0)
      const error = yield* NetworkRequest.sizes(page, request).pipe(Effect.flip)
      assert.deepInclude(error.reason, { _tag: "RequestUnavailable", why: "notRetained" })
    }))
})

it.effect("refuses another live target and removes a detached frame's retained sizes", () =>
  Effect.gen(function*() {
    const { fold, runtime, page, request, sent } = yield* setup()
    const otherId = "other-page" as Target.NavigableId
    yield* fold.sink({
      _tag: "PageAdded",
      page: otherId,
      context: contextId,
      kind: "tab",
      origin: { _tag: "Created" },
      url: "about:blank" as Url.Url
    })
    const other = {} as Page.ObservedPage
    Handles.registerPage(other, { runtime, entry: Option.getOrThrow(fold.page(otherId)), grant: Option.none() })
    const error = yield* NetworkRequest.sizes(other, request).pipe(Effect.flip)
    assert.deepInclude(error.reason, { _tag: "RequestUnavailable", why: "foreignTarget" })
    const frame = "frame" as Target.NavigableId
    yield* fold.sink({ _tag: "FrameAdded", frame, parent: pageId, page: pageId })
    const child = sent("child", { _tag: "Document", navigable: frame, navigation: Option.none() })
    yield* fold.sink({ _tag: "RequestSent", request: child })
    yield* fold.sink({ _tag: "HopSizes", hop: child.hop, sizes: empty() })
    const context = Option.getOrThrow(Option.getOrThrow(fold.hop(child.hop)).context)
    assert.strictEqual(context.sizess?.size, 1)
    yield* fold.sink({
      _tag: "NavigableRemoved",
      navigable: frame,
      reason: new Target.FrameDetached({}),
      evidence: "test"
    })
    assert.strictEqual(context.sizess?.size, 0)
    yield* fold.sink({ _tag: "HopSizes", hop: child.hop, sizes: empty() })
    assert.strictEqual(context.sizess?.size, 0, "late facts cannot revive a removed owner's sizes")
    const unavailable = yield* NetworkRequest.sizes(page, child).pipe(Effect.flip)
    assert.deepInclude(unavailable.reason, { _tag: "RequestUnavailable", why: "ownerLost" })
  }))
