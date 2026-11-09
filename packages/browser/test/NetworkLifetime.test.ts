/** Deterministic terminal header settlement, without browser traffic or elapsed time. */
import { assert, describe, it } from "@effect/vitest"
import { Deadline, NetworkRequest, NetworkResponse, Page, Target, Url, UserContext } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Fold from "../src/internal/fold.ts"
import * as Handles from "../src/internal/handles.ts"
import type * as Runtime from "../src/internal/runtime.ts"

const context = "context" as UserContext.Id
const page = "page" as Target.NavigableId
const frame = "frame" as Target.NavigableId
const realm = "worker" as Target.RealmId
const request = (id: number, initiator: NetworkRequest.Initiator) =>
  new NetworkRequest.NetworkRequest({
    hop: `request-${id}.0` as NetworkRequest.HopId,
    method: "GET",
    url: "https://example.com/" as Url.Url,
    headers: Headers.fromInput({ "x-snapshot": "yes" }),
    resourceType: "fetch",
    initiator,
    at: 0 as NetworkRequest.NetworkRequest["at"]
  })

describe("Request header lifetime", () => {
  it.effect("settles an already-retained waiter when the unfinished hop is evicted", () =>
    Effect.gen(function*() {
      const fold = yield* Fold.make({ release: () => Effect.void })
      const first = request(0, { _tag: "Unattributed" })
      yield* fold.sink({ _tag: "RequestSent", request: first })
      const retained = Option.getOrThrow(fold.hop(first.hop))
      assert.isFalse(Deferred.isDoneUnsafe(retained.sentKnown))
      for (let i = 1; i <= Fold.maxHops; i++) {
        yield* fold.sink({ _tag: "RequestSent", request: request(i, { _tag: "Unattributed" }) })
      }
      // A new lookup uses the immutable snapshot; a waiter already holds the removed entry.
      assert.isTrue(Option.isNone(fold.hop(first.hop)))
      assert.isTrue(Deferred.isDoneUnsafe(retained.end))
      yield* fold.sink({ _tag: "RequestFinished", hop: first.hop, encodedBytes: 0, at: first.at })
      assert.isTrue(Deferred.isDoneUnsafe(retained.sentKnown), "eviction must release the existing header waiter")
    }))

  for (const terminal of ["worker removal", "context removal", "disconnect"] as const) {
    it.effect(`settles page-less worker headers on ${terminal}`, () =>
      Effect.gen(function*() {
        const fold = yield* Fold.make({ release: () => Effect.void })
        yield* fold.context(context, false)
        yield* fold.sink({
          _tag: "RealmAdded",
          realm,
          origin: "https://example.com",
          kind: {
            _tag: "Worker",
            worker: { _tag: "Shared" },
            url: "https://example.com/worker.js" as Url.Url,
            page: Option.none(),
            context: Option.some(context)
          }
        })
        const sent = request(0, { _tag: "Worker", realm })
        yield* fold.sink({ _tag: "RequestSent", request: sent })
        const otherRealm = "other-worker" as Target.RealmId
        const otherContext = terminal === "worker removal" ? context : "other-context" as UserContext.Id
        yield* fold.context(otherContext, false)
        yield* fold.sink({
          _tag: "RealmAdded",
          realm: otherRealm,
          origin: "https://example.com",
          kind: {
            _tag: "Worker",
            worker: { _tag: "Shared" },
            url: "https://example.com/other.js" as Url.Url,
            page: Option.none(),
            context: Option.some(otherContext)
          }
        })
        const other = request(1, { _tag: "Worker", realm: otherRealm })
        yield* fold.sink({ _tag: "RequestSent", request: other })
        const unrelated = Option.getOrThrow(fold.hop(other.hop))
        const hop = Option.getOrThrow(fold.hop(sent.hop))
        assert.isTrue(Option.isNone(hop.page))
        assert.strictEqual(Option.getOrThrow(hop.context).id, context)
        assert.isFalse(Deferred.isDoneUnsafe(hop.sentKnown))
        if (terminal === "worker removal") {
          yield* fold.sink({ _tag: "RealmRemoved", realm, reason: new Target.ConnectionLost({}) })
        } else if (terminal === "context removal") {
          yield* fold.sink({ _tag: "UserContextRemoved", context })
        } else {
          yield* fold.loseConnection
          assert.isTrue(Deferred.isDoneUnsafe(hop.end))
        }
        assert.isTrue(Deferred.isDoneUnsafe(hop.sentKnown), "owner loss must release the existing header waiter")
        assert.strictEqual(Deferred.isDoneUnsafe(unrelated.sentKnown), terminal === "disconnect")
        if (terminal !== "disconnect") assert.isFalse(Deferred.isDoneUnsafe(hop.end))
      }))
  }

  it.effect("settles a removed frame's headers while its page remains open", () =>
    Effect.gen(function*() {
      const fold = yield* Fold.make({ release: () => Effect.void })
      yield* fold.sink({
        _tag: "PageAdded",
        page,
        context,
        kind: "tab",
        origin: { _tag: "Created" },
        url: "about:blank" as Url.Url
      })
      yield* fold.sink({ _tag: "FrameAdded", frame, parent: page, page })
      const child = "child" as Target.NavigableId
      yield* fold.sink({ _tag: "FrameAdded", frame: child, parent: frame, page })
      const descendant = request(1, { _tag: "Document", navigable: child, navigation: Option.none() })
      const unrelated = request(2, { _tag: "Document", navigable: page, navigation: Option.none() })
      yield* fold.sink({ _tag: "RequestSent", request: descendant })
      yield* fold.sink({ _tag: "RequestSent", request: unrelated })
      const sent = request(0, { _tag: "Document", navigable: frame, navigation: Option.none() })
      yield* fold.sink({ _tag: "RequestSent", request: sent })
      const hop = Option.getOrThrow(fold.hop(sent.hop))
      assert.strictEqual(Option.getOrThrow(hop.page).id, page)
      yield* fold.sink({
        _tag: "NavigableRemoved",
        navigable: frame,
        reason: new Target.FrameDetached({}),
        evidence: "test"
      })
      assert.isFalse(Deferred.isDoneUnsafe(Option.getOrThrow(fold.page(page)).closed))
      assert.isTrue(Deferred.isDoneUnsafe(hop.sentKnown), "frame loss must release the existing header waiter")
      assert.isTrue(Deferred.isDoneUnsafe(Option.getOrThrow(fold.hop(descendant.hop)).sentKnown))
      assert.isFalse(Deferred.isDoneUnsafe(Option.getOrThrow(fold.hop(unrelated.hop)).sentKnown))
      assert.isFalse(Deferred.isDoneUnsafe(hop.end))
    }))
})

const responseFixture = Effect.gen(function*() {
  const fold = yield* Fold.make({ release: () => Effect.void })
  const entry = yield* fold.context(context, false)
  const target = {} as UserContext.ObservedUserContext
  Handles.registerContext(target, {
    runtime: { model: fold } as unknown as Runtime.Runtime,
    entry,
    grant: Option.none()
  })
  yield* fold.sink({
    _tag: "PageAdded",
    page,
    context,
    kind: "tab",
    origin: { _tag: "Created" },
    url: "about:blank" as Url.Url
  })
  const sent = request(0, { _tag: "Document", navigable: page, navigation: Option.none() })
  yield* fold.sink({ _tag: "RequestSent", request: sent })
  const response = new NetworkResponse.NetworkResponse({
    hop: sent.hop,
    url: sent.url,
    status: 200 as NetworkResponse.StatusCode,
    statusText: "OK",
    httpVersion: Option.none(),
    headers: Headers.empty,
    servedBy: "network",
    at: sent.at
  })
  return { fold, target, sent, response }
})

describe("Request response lifetime", () => {
  for (const already of [false, true]) {
    it.effect(`reads a response ${already ? "before" : "after"} acquiring the wait`, () =>
      Effect.scoped(Effect.gen(function*() {
        const { fold, target, sent, response } = yield* responseFixture
        if (already) yield* fold.sink({ _tag: "ResponseReceived", response })
        const wait = yield* NetworkRequest.response(target, sent)
        if (!already) yield* fold.sink({ _tag: "ResponseReceived", response })
        assert.deepStrictEqual(yield* wait, Option.some(response))
      })))
  }

  it.effect("waits for arrival and returns none when a request fails without a response", () =>
    Effect.scoped(Effect.gen(function*() {
      const { fold, target, sent } = yield* responseFixture
      const wait = yield* NetworkRequest.response(target, sent)
      const fiber = yield* wait.pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      assert.isUndefined(fiber.pollUnsafe())
      yield* fold.sink({ _tag: "RequestFailed", hop: sent.hop, error: "offline", canceled: false, at: sent.at })
      assert.deepStrictEqual(yield* Fiber.join(fiber), Option.none())
    })))

  it.effect("delivers to an already-running waiter and keeps redirect hops separate", () =>
    Effect.scoped(Effect.gen(function*() {
      const { fold, target, sent, response } = yield* responseFixture
      const wait = yield* NetworkRequest.response(target, sent)
      const fiber = yield* wait.pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      assert.isUndefined(fiber.pollUnsafe())
      const redirect = new NetworkResponse.NetworkResponse({ ...response, status: 302 as NetworkResponse.StatusCode })
      yield* fold.sink({ _tag: "ResponseReceived", response: redirect })
      yield* fold.sink({ _tag: "RequestFinished", hop: sent.hop, encodedBytes: 0, at: sent.at })
      const next = new NetworkRequest.NetworkRequest({ ...sent, hop: "request-0.1" as NetworkRequest.HopId })
      yield* fold.sink({ _tag: "RequestSent", request: next })
      yield* fold.sink({
        _tag: "ResponseReceived",
        response: new NetworkResponse.NetworkResponse({ ...response, hop: next.hop })
      })
      assert.strictEqual(Option.getOrThrow(yield* Fiber.join(fiber)).status, 302)
      assert.strictEqual(Option.getOrThrow(yield* (yield* NetworkRequest.response(target, next))).status, 200)
    })))

  it.effect("keeps a request that failed before its target closed answering none", () =>
    Effect.scoped(Effect.gen(function*() {
      const { fold, target, sent } = yield* responseFixture
      const wait = yield* NetworkRequest.response(target, sent)
      yield* fold.sink({ _tag: "RequestFailed", hop: sent.hop, error: "offline", canceled: false, at: sent.at })
      assert.deepStrictEqual(yield* wait, Option.none())
      yield* fold.sink({ _tag: "UserContextRemoved", context })
      assert.deepStrictEqual(yield* wait, Option.none())
    })))

  it.effect("wakes when the target closes before arrival", () =>
    Effect.scoped(Effect.gen(function*() {
      const { fold, target, sent } = yield* responseFixture
      const wait = yield* NetworkRequest.response(target, sent)
      const fiber = yield* wait.pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* fold.sink({ _tag: "UserContextRemoved", context })
      assert.strictEqual(unavailableWhy(yield* Effect.flip(Fiber.join(fiber))), "targetClosed")
    })))

  for (const running of [false, true]) {
    it.effect(`reports connection loss ${running ? "during" : "before"} waiting as target closure`, () =>
      Effect.scoped(Effect.gen(function*() {
        const { fold, target, sent } = yield* responseFixture
        const wait = yield* NetworkRequest.response(target, sent)
        const fiber = running ? yield* wait.pipe(Effect.forkScoped) : undefined
        if (running) yield* Effect.yieldNow
        yield* fold.loseConnection
        const error = yield* Effect.flip(fiber === undefined ? wait : Fiber.join(fiber))
        assert.strictEqual(unavailableWhy(error), "targetClosed")
      })))
  }

  it.effect("clears retention and wakes a pending wait when its scope closes", () =>
    Effect.scoped(Effect.gen(function*() {
      const { target, sent } = yield* responseFixture
      const scope = yield* Scope.make()
      const wait = yield* NetworkRequest.response(target, sent).pipe(Effect.provideService(Scope.Scope, scope))
      const fiber = yield* wait.pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(unavailableWhy(yield* Effect.flip(Fiber.join(fiber))), "released")
      assert.strictEqual(unavailableWhy(yield* Effect.flip(wait)), "released")
    })))

  it.effect("rejects a request owned by another context", () =>
    Effect.scoped(Effect.gen(function*() {
      const { fold, sent } = yield* responseFixture
      const entry = yield* fold.context("foreign" as UserContext.Id, false)
      const target = {} as UserContext.ObservedUserContext
      Handles.registerContext(target, {
        runtime: { model: fold } as unknown as Runtime.Runtime,
        entry,
        grant: Option.none()
      })
      assert.strictEqual(
        (yield* Effect.flip(Effect.asVoid(NetworkRequest.response(target, sent)))).reason.why,
        "foreignTarget"
      )
    })))

  it.effect("reports eviction both for an acquired hop and a later lookup", () =>
    Effect.scoped(Effect.gen(function*() {
      const { fold, target, sent } = yield* responseFixture
      const wait = yield* NetworkRequest.response(target, sent)
      for (let i = 1; i <= Fold.maxHops; i++) {
        yield* fold.sink({ _tag: "RequestSent", request: request(i, { _tag: "Unattributed" }) })
      }
      assert.strictEqual(unavailableWhy(yield* Effect.flip(wait)), "evicted")
      assert.strictEqual(
        (yield* Effect.flip(Effect.asVoid(NetworkRequest.response(target, sent)))).reason.why,
        "evicted"
      )
    })))

  it.effect("keeps an acquired completed response through index eviction, without retaining its body", () =>
    Effect.scoped(Effect.gen(function*() {
      const { fold, target, sent, response } = yield* responseFixture
      yield* fold.sink({ _tag: "ResponseReceived", response })
      yield* fold.sink({ _tag: "RequestFinished", hop: sent.hop, encodedBytes: 0, at: sent.at })
      const wait = yield* NetworkRequest.response(target, sent)
      for (let i = 1; i <= Fold.maxHops; i++) {
        yield* fold.sink({ _tag: "RequestSent", request: request(i, { _tag: "Unattributed" }) })
      }
      assert.isTrue(Option.isNone(fold.hop(sent.hop)))
      assert.deepStrictEqual(yield* wait, Option.some(response))
      assert.isFalse("body" in Option.getOrThrow(yield* wait))
    })))

  it.effect("rejects another page even within the owning context", () =>
    Effect.scoped(Effect.gen(function*() {
      const { fold, sent } = yield* responseFixture
      const otherPage = "other-page" as Target.NavigableId
      yield* fold.sink({
        _tag: "PageAdded",
        page: otherPage,
        context,
        kind: "tab",
        origin: { _tag: "Created" },
        url: sent.url
      })
      const target = {} as Page.ObservedPage
      Handles.registerPage(target, {
        runtime: { model: fold } as unknown as Runtime.Runtime,
        entry: Option.getOrThrow(fold.page(otherPage)),
        grant: Option.none()
      })
      const error = yield* NetworkRequest.response(target, sent).pipe(Effect.asVoid, Effect.flip)
      assert.strictEqual(error.reason.why, "foreignTarget")
    })))

  it.effect("bounds waits by the operation deadline", () =>
    Effect.scoped(Effect.gen(function*() {
      const { target, sent } = yield* responseFixture
      const wait = yield* NetworkRequest.response(target, sent)
      const error = yield* Effect.flip(wait.pipe(Deadline.within("1 millis")))
      assert(Deadline.isTimeout(error))
      assert.strictEqual(error.phase, "waitingForEvent")
    })))
})

const unavailableWhy = (error: NetworkRequest.RequestError | Deadline.Timeout) => {
  assert.strictEqual(error._tag, "RequestError")
  if (error._tag !== "RequestError") throw error
  return error.reason.why
}
