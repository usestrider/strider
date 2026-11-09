/** Redirect identity and bounded evidence access without browser traffic. */
import { assert, describe, it } from "@effect/vitest"
import { NetworkRequest, Page, Target, Url, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Fold from "../src/internal/fold.ts"
import * as Handles from "../src/internal/handles.ts"
import type * as Runtime from "../src/internal/runtime.ts"

const setup = Effect.fnUntraced(function*() {
  const fold = yield* Fold.make({ release: () => Effect.void })
  const id = "page" as Target.NavigableId
  yield* fold.sink({
    _tag: "PageAdded",
    page: id,
    context: "context" as UserContext.Id,
    kind: "tab",
    origin: { _tag: "Created" },
    url: "about:blank" as Url.Url
  })
  const page = {} as Page.Page
  Handles.registerPage(page, {
    runtime: { model: fold } as unknown as Runtime.Runtime,
    entry: Option.getOrThrow(fold.page(id)),
    grant: Option.none()
  })
  const send = (hop: string) => {
    const request = new NetworkRequest.NetworkRequest({
      hop: hop as NetworkRequest.HopId,
      method: "GET",
      url: "https://example.com/repeated" as Url.Url,
      headers: Headers.empty,
      resourceType: "document",
      initiator: { _tag: "Document", navigable: id, navigation: Option.none() },
      at: 0 as NetworkRequest.NetworkRequest["at"]
    })
    return fold.sink({ _tag: "RequestSent", request }).pipe(Effect.as(request))
  }
  return { fold, page, send }
})

describe("Scoped redirect evidence", () => {
  it.effect("joins repeated URLs by ordinal and distinguishes boundaries from unfinished evidence", () =>
    Effect.gen(function*() {
      const { page, send, fold } = yield* setup()
      const links = yield* NetworkRequest.redirects(page)
      const first = yield* send("chain.0")
      assert.isTrue(Option.isNone(yield* links.from(first)))
      assert.strictEqual((yield* Effect.flip(links.to(first))).reason._tag, "Pending")
      const second = yield* send("chain.1")
      const last = yield* send("chain.2")
      assert.strictEqual(Option.getOrThrow(yield* links.to(first)), second)
      assert.strictEqual(Option.getOrThrow(yield* links.from(last)), second)
      assert.strictEqual(Option.getOrThrow(yield* links.from(second)), first)
      assert.strictEqual(Option.getOrThrow(yield* links.to(second)), last)
      yield* fold.sink({ _tag: "RequestFailed", hop: last.hop, error: "canceled", canceled: true, at: last.at })
      assert.isTrue(Option.isNone(yield* links.to(last)))
      const clone = new NetworkRequest.NetworkRequest({ ...first })
      assert.strictEqual((yield* Effect.flip(links.from(clone))).reason._tag, "Unavailable")
    }))

  it.effect("reports eviction instead of inventing a first hop or absent successor", () =>
    Effect.gen(function*() {
      const { page, send } = yield* setup()
      const links = yield* NetworkRequest.redirects(page)
      const first = yield* send("chain.0")
      const second = yield* send("chain.1")
      for (let i = 0; i < Fold.maxHops - 1; i++) yield* send(`other-${i}.0`)
      assert.strictEqual((yield* Effect.flip(links.from(second))).reason._tag, "Unavailable")
      assert.strictEqual((yield* Effect.flip(links.to(first))).reason._tag, "Unavailable")
    }))

  it.effect("revokes access on scope release and target removal", () =>
    Effect.gen(function*() {
      const { page, send, fold } = yield* setup()
      const first = yield* send("chain.0")
      const scope = yield* Scope.make()
      const released = yield* NetworkRequest.redirects(page).pipe(Scope.provide(scope))
      yield* Scope.close(scope, { _tag: "Success", value: undefined })
      assert.strictEqual((yield* Effect.flip(released.from(first))).reason._tag, "Released")
      const closed = yield* NetworkRequest.redirects(page)
      yield* fold.sink({
        _tag: "NavigableRemoved",
        navigable: "page" as Target.NavigableId,
        reason: new Target.PageClosed({}),
        evidence: "test"
      })
      assert.strictEqual((yield* Effect.flip(closed.from(first))).reason._tag, "TargetClosed")
    }))
})
