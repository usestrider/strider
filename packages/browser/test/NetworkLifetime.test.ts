/** Deterministic terminal header settlement, without browser traffic or elapsed time. */
import { assert, describe, it } from "@effect/vitest"
import { NetworkRequest, Target, Url, UserContext } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Fold from "../src/internal/fold.ts"

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
