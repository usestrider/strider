import { assert, it } from "@effect/vitest"
import { NetworkRequest, Target, Url, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Fold from "../src/internal/fold.ts"

it.effect("dispatches storage tracking only to its context using the existing request owner, and releases it", () =>
  Effect.gen(function*() {
    const fold = yield* Fold.make({ release: () => Effect.void })
    const entries = []
    for (const name of ["tracked", "sibling", "other-tracked"]) {
      const id = name as UserContext.Id
      yield* fold.sink({
        _tag: "PageAdded",
        page: name as Target.NavigableId,
        context: id,
        kind: "tab",
        origin: { _tag: "Created" },
        url: "about:blank" as Url.Url
      })
      entries.push(yield* fold.context(id, false))
    }
    const calls: Array<ReadonlyArray<string>> = []
    const scope = yield* Scope.make()
    const other = yield* Scope.make()
    yield* fold.observeStorageSources(entries[0]!, (origins) => calls.push(origins)).pipe(Scope.provide(scope))
    let otherCalls = 0
    yield* fold.observeStorageSources(entries[2]!, () => otherCalls++).pipe(Scope.provide(other))
    let sequence = 0
    const send = Effect.fnUntraced(function*(name: string) {
      let ownerReads = 0
      const request = new NetworkRequest.NetworkRequest({
        hop: `${sequence++}.0` as NetworkRequest.HopId,
        method: "GET",
        url: "https://example.com/" as Url.Url,
        headers: Headers.empty,
        resourceType: "fetch",
        initiator: { _tag: "Document", navigable: name as Target.NavigableId, navigation: Option.none() },
        at: 0 as NetworkRequest.NetworkRequest["at"]
      })
      // Count entry into owner resolution, not just delivered callbacks: filtering a browser-wide
      // observer after a second lookup still violates isolation even if no callback is delivered.
      Object.defineProperty(request.initiator, "navigable", {
        get() {
          ownerReads++
          return name as Target.NavigableId
        }
      })
      yield* fold.sink({ _tag: "RequestSent", request })
      assert.strictEqual(ownerReads, 1)
    })
    const commit = Effect.fnUntraced(function*(name: string) {
      let navigableReads = 0
      yield* fold.sink({
        _tag: "DocumentCommitted",
        document: `${sequence++}` as Target.DocumentId,
        get navigable() {
          navigableReads++
          return name as Target.NavigableId
        },
        url: "https://example.com/" as Url.Url,
        origin: "https://example.com",
        createdBy: { _tag: "Adopted" },
        replaced: Option.none(),
        evidence: "test"
      })
      return navigableReads
    })
    // The sibling's committed fact must use only the fold's existing page/frame resolution.
    const siblingReads = yield* commit("sibling")
    assert.strictEqual(siblingReads, 3)
    yield* commit("tracked")
    assert.deepStrictEqual(calls, [["https://example.com"]])
    calls.length = 0
    yield* send("sibling")
    assert.deepStrictEqual(calls, [])
    yield* send("tracked")
    assert.deepStrictEqual(calls, [["https://example.com"]])
    yield* Scope.close(scope, Exit.void)
    yield* send("other-tracked")
    assert.strictEqual(otherCalls, 1)
    yield* send("tracked")
    yield* send("sibling")
    assert.strictEqual(yield* commit("tracked"), siblingReads)
    assert.strictEqual(yield* commit("sibling"), siblingReads)
    assert.strictEqual(calls.length, 1)
    yield* Scope.close(other, Exit.void)
    yield* send("other-tracked")
    assert.strictEqual(otherCalls, 1)
  }))
