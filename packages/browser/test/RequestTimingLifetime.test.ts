import { assert, describe, it } from "@effect/vitest"
import { NetworkRequest, Page, Target, Url, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Fold from "../src/internal/fold.ts"
import * as Handles from "../src/internal/handles.ts"
import type * as Runtime from "../src/internal/runtime.ts"
const empty = () =>
  new NetworkRequest.Timing({
    startTime: Option.none(),
    domainLookupStart: Option.none(),
    domainLookupEnd: Option.none(),
    connectStart: Option.none(),
    connectEnd: Option.none(),
    secureConnectionStart: Option.none(),
    requestStart: Option.none(),
    responseStart: Option.none(),
    responseEnd: Option.none()
  })
const contextId = "context" as UserContext.Id
const pageId = "page" as Target.NavigableId

const setup = Effect.fnUntraced(function*(enabled = true) {
  const fold = yield* Fold.make({ release: () => Effect.void })
  yield* fold.sink({ _tag: "UserContextAdded", context: contextId, isDefault: false, requestTiming: enabled })
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

describe("request timing ownership and isolation", () => {
  it.effect("allocates timing storage only for opted-in contexts and never sends adapter work", () =>
    Effect.gen(function*() {
      const off = yield* setup(false)
      const on = yield* setup()
      const offOwner = Option.getOrThrow(off.fold.hop(off.request.hop)).context
      const onOwner = Option.getOrThrow(on.fold.hop(on.request.hop)).context
      assert.isUndefined(Option.getOrThrow(offOwner).timings)
      assert.instanceOf(Option.getOrThrow(onOwner).timings, Map)
      const refused = yield* NetworkRequest.timing(off.page, off.request).pipe(Effect.flip)
      assert.strictEqual(refused.reason._tag, "RequestUnavailable")
      assert.strictEqual(refused.reason.why, "timingNotEnabled")
      yield* off.fold.sink({ _tag: "HopTiming", hop: off.request.hop, timing: empty() })
      assert.isUndefined(Option.getOrThrow(offOwner).timings)
      assert.deepStrictEqual((yield* NetworkRequest.timing(on.page, on.request)).responseEnd, Option.none())
    }))
})

describe("request timing lifecycle", () => {
  it.effect("returns immutable observations and preserves header phases after failure", () =>
    Effect.gen(function*() {
      const { fold, page, request, fail } = yield* setup()
      const before = yield* NetworkRequest.timing(page, request)
      const headers = new NetworkRequest.Timing({ ...before, responseStart: Option.some(4) })
      yield* fold.sink({ _tag: "HopTiming", hop: request.hop, timing: headers })
      yield* fail()
      const after = yield* NetworkRequest.timing(page, request)
      assert.deepStrictEqual(before.responseStart, Option.none())
      assert.deepStrictEqual(after.responseStart, Option.some(4))
      assert.deepStrictEqual(after.responseEnd, Option.none())
      const next = new NetworkRequest.NetworkRequest({ ...request, hop: "request.1" as NetworkRequest.HopId })
      yield* fold.sink({ _tag: "RequestSent", request: next })
      assert.deepStrictEqual((yield* NetworkRequest.timing(page, next)).responseStart, Option.none())
    }))
  it.effect("refuses copied and cross-runtime requests and gives owner loss precedence", () =>
    Effect.gen(function*() {
      const a = yield* setup()
      const b = yield* setup()
      for (const request of [new NetworkRequest.NetworkRequest({ ...a.request }), b.request]) {
        const error = yield* NetworkRequest.timing(a.page, request).pipe(Effect.flip)
        assert.strictEqual(error.reason.why, "notRetained")
      }
      const owner = Option.getOrThrow(Option.getOrThrow(a.fold.hop(a.request.hop)).context)
      yield* a.fold.sink({ _tag: "HopTiming", hop: a.request.hop, timing: empty() })
      yield* a.fold.loseConnection
      assert.strictEqual(owner.timings?.size, 0)
      const error = yield* NetworkRequest.timing(a.page, a.request).pipe(Effect.flip)
      assert.strictEqual(error.reason.why, "ownerLost")
    }))
  it.effect("bounds timing retention by hop eviction", () =>
    Effect.gen(function*() {
      const { fold, page, request, sent } = yield* setup()
      const owner = Option.getOrThrow(Option.getOrThrow(fold.hop(request.hop)).context)
      yield* fold.sink({ _tag: "HopTiming", hop: request.hop, timing: empty() })
      for (let i = 0; i < Fold.maxHops; i++) yield* fold.sink({ _tag: "RequestSent", request: sent(`other-${i}`) })
      assert.strictEqual(owner.timings?.size, 0)
      const error = yield* NetworkRequest.timing(page, request).pipe(Effect.flip)
      assert.strictEqual(error.reason.why, "notRetained")
    }))
})

it.effect("refuses another live target and removes a detached frame's retained timing", () =>
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
    const error = yield* NetworkRequest.timing(other, request).pipe(Effect.flip)
    assert.strictEqual(error.reason.why, "foreignTarget")
    const frame = "frame" as Target.NavigableId
    yield* fold.sink({ _tag: "FrameAdded", frame, parent: pageId, page: pageId })
    const child = sent("child", { _tag: "Document", navigable: frame, navigation: Option.none() })
    yield* fold.sink({ _tag: "RequestSent", request: child })
    yield* fold.sink({ _tag: "HopTiming", hop: child.hop, timing: empty() })
    const context = Option.getOrThrow(Option.getOrThrow(fold.hop(child.hop)).context)
    assert.strictEqual(context.timings?.size, 1)
    yield* fold.sink({
      _tag: "NavigableRemoved",
      navigable: frame,
      reason: new Target.FrameDetached({}),
      evidence: "test"
    })
    assert.strictEqual(context.timings?.size, 0)
    yield* fold.sink({ _tag: "HopTiming", hop: child.hop, timing: empty() })
    assert.strictEqual(context.timings?.size, 0, "late facts cannot revive a removed owner's timing")
    const unavailable = yield* NetworkRequest.timing(page, child).pipe(Effect.flip)
    assert.strictEqual(unavailable.reason.why, "ownerLost")
  }))
