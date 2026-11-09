/** Redirect identity and bounded evidence access without browser traffic. */
import { assert, describe, it } from "@effect/vitest"
import { NetworkRequest, NetworkResponse, Page, Target, Url, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
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
      assert.strictEqual((yield* Effect.flip(links.to(first))).reason.why, "Pending")
      const second = yield* send("chain.1")
      const last = yield* send("chain.2")
      assert.strictEqual(Option.getOrThrow(yield* links.to(first)), second)
      assert.strictEqual(Option.getOrThrow(yield* links.from(last)), second)
      assert.strictEqual(Option.getOrThrow(yield* links.from(second)), first)
      assert.strictEqual(Option.getOrThrow(yield* links.to(second)), last)
      yield* fold.sink({ _tag: "RequestFailed", hop: last.hop, error: "canceled", canceled: true, at: last.at })
      assert.isTrue(Option.isNone(yield* links.to(last)))
      const clone = new NetworkRequest.NetworkRequest({ ...first })
      assert.strictEqual((yield* Effect.flip(links.from(clone))).reason.why, "Unavailable")
    }))

  it.effect("requires terminal evidence and distinguishes redirects from other 3xx responses", () =>
    Effect.gen(function*() {
      const { page, send, fold } = yield* setup()
      const links = yield* NetworkRequest.redirects(page)
      for (const status of [200, 304, 302]) {
        const request = yield* send(`status-${status}.0`)
        const response = new NetworkResponse.NetworkResponse({
          hop: request.hop,
          url: request.url,
          status: status as NetworkResponse.StatusCode,
          statusText: "",
          httpVersion: Option.none(),
          headers: Headers.empty,
          servedBy: "network",
          at: request.at
        })
        yield* fold.sink({ _tag: "ResponseReceived", response })
        assert.strictEqual((yield* Effect.flip(links.to(request))).reason.why, "Pending")
        yield* fold.sink({ _tag: "RequestFinished", hop: request.hop, encodedBytes: 0, at: request.at })
        if (status === 302) assert.strictEqual((yield* Effect.flip(links.to(request))).reason.why, "Unavailable")
        else assert.isTrue(Option.isNone(yield* links.to(request)))
      }
      const missing = yield* send("no-response.0")
      yield* fold.sink({ _tag: "RequestFinished", hop: missing.hop, encodedBytes: 0, at: missing.at })
      assert.strictEqual((yield* Effect.flip(links.to(missing))).reason.why, "Unavailable")
      yield* fold.loseConnection
      assert.strictEqual((yield* Effect.flip(links.from(missing))).reason.why, "TargetClosed")
    }))

  it.effect("opens and releases access without subscribing, reading hops or changing context settings", () =>
    Effect.gen(function*() {
      const { page, send, fold } = yield* setup()
      const entry = Option.getOrThrow(fold.page("page" as Target.NavigableId))
      const context = yield* fold.context("context" as UserContext.Id, false)
      const settings = (yield* context.state.get).settings
      let lookups = 0
      const model = {
        ...fold,
        hop: (id: NetworkRequest.HopId) => {
          lookups++
          return fold.hop(id)
        }
      }
      Handles.registerPage(page, { runtime: { model } as unknown as Runtime.Runtime, entry, grant: Option.none() })
      const first = yield* send("unobserved.0")
      assert.strictEqual(lookups, 0)
      yield* Effect.scoped(NetworkRequest.redirects(page))
      assert.strictEqual(lookups, 0)
      assert.strictEqual(entry.events.request.subscribers.size, 0)
      assert.strictEqual(context.events.request.subscribers.size, 0)
      assert.strictEqual((yield* context.state.get).settings, settings)
      assert.strictEqual(Option.getOrThrow(fold.hop(first.hop)).request, first)
      // Context access accepts its own page snapshots without installing tracking there either.
      const target = {} as UserContext.UserContext
      Handles.registerContext(target, {
        runtime: { model } as unknown as Runtime.Runtime,
        entry: context,
        grant: Option.none()
      })
      const links = yield* NetworkRequest.redirects(target)
      assert.strictEqual(lookups, 0)
      assert.isTrue(Option.isNone(yield* links.from(first)))
      assert.strictEqual(lookups, 1)
    }))

  it.effect("reports eviction instead of inventing a first hop or absent successor", () =>
    Effect.gen(function*() {
      const { page, send } = yield* setup()
      const links = yield* NetworkRequest.redirects(page)
      const first = yield* send("chain.0")
      const second = yield* send("chain.1")
      for (let i = 0; i < Fold.maxHops - 1; i++) yield* send(`other-${i}.0`)
      assert.strictEqual((yield* Effect.flip(links.from(second))).reason.why, "Unavailable")
      assert.strictEqual((yield* Effect.flip(links.to(first))).reason.why, "Unavailable")
    }))

  it.effect("revokes access on scope release and target removal", () =>
    Effect.gen(function*() {
      const { page, send, fold } = yield* setup()
      const first = yield* send("chain.0")
      const scope = yield* Scope.make()
      const released = yield* NetworkRequest.redirects(page).pipe(Scope.provide(scope))
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual((yield* Effect.flip(released.from(first))).reason.why, "Released")
      const closed = yield* NetworkRequest.redirects(page)
      yield* fold.sink({
        _tag: "NavigableRemoved",
        navigable: "page" as Target.NavigableId,
        reason: new Target.PageClosed({ by: "command" }),
        evidence: "test"
      })
      assert.strictEqual((yield* Effect.flip(closed.from(first))).reason.why, "TargetClosed")
    }))
})
