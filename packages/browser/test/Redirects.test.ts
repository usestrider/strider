/** Redirect identity and bounded evidence access without browser traffic. */
import { assert, describe, it } from "@effect/vitest"
import { NetworkRequest, NetworkResponse, Page, PageNavigation, Target, Url, UserContext } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Fold from "../src/internal/fold.ts"
import * as Handles from "../src/internal/handles.ts"
import * as NetworkIndex from "../src/internal/networkIndex.ts"
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
  const send = (hop: string, navigation: Option.Option<PageNavigation.Id> = Option.none()) => {
    const request = new NetworkRequest.NetworkRequest({
      hop: hop as NetworkRequest.HopId,
      method: "GET",
      url: "https://example.com/repeated" as Url.Url,
      headers: Headers.empty,
      resourceType: "document",
      initiator: { _tag: "Document", navigable: id, navigation },
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
      assert.strictEqual((yield* Effect.flip(links.to(first))).reason.why, "inFlight")
      const second = yield* send("chain.1")
      const last = yield* send("chain.2")
      assert.strictEqual(Option.getOrThrow(yield* links.to(first)), second)
      assert.strictEqual(Option.getOrThrow(yield* links.from(last)), second)
      assert.strictEqual(Option.getOrThrow(yield* links.from(second)), first)
      assert.strictEqual(Option.getOrThrow(yield* links.to(second)), last)
      yield* fold.sink({ _tag: "RequestFailed", hop: last.hop, error: "canceled", canceled: true, at: last.at })
      assert.isTrue(Option.isNone(yield* links.to(last)))
      const clone = new NetworkRequest.NetworkRequest({ ...first })
      assert.strictEqual((yield* Effect.flip(links.from(clone))).reason.why, "unavailable")
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
        assert.strictEqual((yield* Effect.flip(links.to(request))).reason.why, "inFlight")
        yield* fold.sink({ _tag: "RequestFinished", hop: request.hop, encodedBytes: 0, at: request.at })
        if (status === 302) {
          const unknown = yield* Effect.flip(links.to(request))
          assert.strictEqual(unknown.reason._tag, "RedirectUnknown")
          assert.strictEqual(unknown.reason.why, "completedRedirect")
        } else assert.isTrue(Option.isNone(yield* links.to(request)))
      }
      const missing = yield* send("no-response.0")
      yield* fold.sink({ _tag: "RequestFinished", hop: missing.hop, encodedBytes: 0, at: missing.at })
      assert.strictEqual((yield* Effect.flip(links.to(missing))).reason.why, "unavailable")
      yield* fold.loseConnection
      assert.strictEqual((yield* Effect.flip(links.from(missing))).reason.why, "targetClosed")
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

  it.effect("reports unknown before a completed redirect successor is folded", () =>
    Effect.gen(function*() {
      const { page, send, fold } = yield* setup()
      const links = yield* NetworkRequest.redirects(page)
      const first = yield* send("gap.0")
      yield* fold.sink({
        _tag: "ResponseReceived",
        response: new NetworkResponse.NetworkResponse({
          hop: first.hop,
          url: first.url,
          status: 302 as NetworkResponse.StatusCode,
          statusText: "Found",
          httpVersion: Option.none(),
          headers: Headers.fromInput({ location: "/next" }),
          servedBy: "network",
          at: first.at
        })
      })
      // Firefox reports responseCompleted before the next beforeRequestSent. No next hop is visible yet.
      yield* fold.sink({ _tag: "RequestFinished", hop: first.hop, encodedBytes: 0, at: first.at })
      const unknown = yield* Effect.flip(links.to(first))
      assert.strictEqual(unknown.reason._tag, "RedirectUnknown")
      assert.strictEqual(unknown.reason.why, "completedRedirect")
      const second = yield* send("gap.1")
      assert.strictEqual(Option.getOrThrow(yield* links.to(first)), second)
    }))

  it.effect("proves a redirect navigation boundary only from the exact committed hop", () =>
    Effect.gen(function*() {
      for (const mismatch of ["none", "navigation", "hop", "notRetained"] as const) {
        const { page, send, fold } = yield* setup()
        const links = yield* NetworkRequest.redirects(page)
        if (mismatch === "notRetained") {
          const context = yield* fold.context("context" as UserContext.Id, false)
          yield* fold.configure(context, { ...(yield* context.state.get).settings, eventLog: 0 })
        }
        const navigation = "navigation" as PageNavigation.Id
        const endedNavigation = (mismatch === "navigation" ? "other-navigation" : navigation) as PageNavigation.Id
        yield* fold.sink({
          _tag: "NavigationStarted",
          navigation: endedNavigation,
          navigable: "page" as Target.NavigableId,
          url: "https://example.com/repeated" as Url.Url,
          initiatedAs: "crossDocument"
        })
        const first = yield* send("navigation.0", Option.some(navigation))
        yield* fold.sink({
          _tag: "ResponseReceived",
          response: new NetworkResponse.NetworkResponse({
            hop: first.hop,
            url: first.url,
            status: 302 as NetworkResponse.StatusCode,
            statusText: "Found",
            httpVersion: Option.none(),
            headers: Headers.empty,
            servedBy: "network",
            at: first.at
          })
        })
        yield* fold.sink({ _tag: "RequestFinished", hop: first.hop, encodedBytes: 0, at: first.at })
        assert.strictEqual(
          (yield* Effect.flip(links.to(first))).reason._tag,
          mismatch === "notRetained" ? "RedirectUnavailable" : "RedirectUnknown"
        )
        yield* fold.sink({
          _tag: "NavigationEnded",
          navigation: endedNavigation,
          outcome: {
            _tag: "Committed",
            document: "document" as Target.DocumentId,
            response: Option.some(mismatch === "hop" ? "other.0" as NetworkRequest.HopId : first.hop)
          },
          evidence: "test"
        })
        if (mismatch === "none") assert.isTrue(Option.isNone(yield* links.to(first)))
        else {assert.strictEqual(
            (yield* Effect.flip(links.to(first))).reason._tag,
            mismatch === "notRetained" ? "RedirectUnavailable" : "RedirectUnknown"
          )}
        // An observed link remains authoritative even when terminal navigation evidence is retained.
        const second = yield* send("navigation.1", Option.some(navigation))
        assert.strictEqual(Option.getOrThrow(yield* links.to(first)), second)
      }
    }))

  it.effect("preserves unavailable terminal history instead of collapsing its eviction to unknown", () =>
    Effect.gen(function*() {
      const { page, send, fold } = yield* setup()
      const links = yield* NetworkRequest.redirects(page)
      const navigation = "retained-navigation" as PageNavigation.Id
      yield* fold.sink({
        _tag: "NavigationStarted",
        navigation,
        navigable: "page" as Target.NavigableId,
        url: "https://example.com/repeated" as Url.Url,
        initiatedAs: "crossDocument"
      })
      const request = yield* send("retained.0", Option.some(navigation))
      yield* fold.sink({
        _tag: "ResponseReceived",
        response: new NetworkResponse.NetworkResponse({
          hop: request.hop,
          url: request.url,
          status: 302 as NetworkResponse.StatusCode,
          statusText: "Found",
          httpVersion: Option.none(),
          headers: Headers.empty,
          servedBy: "network",
          at: request.at
        })
      })
      yield* fold.sink({ _tag: "RequestFinished", hop: request.hop, encodedBytes: 0, at: request.at })
      yield* fold.sink({
        _tag: "NavigationEnded",
        navigation,
        outcome: { _tag: "Committed", document: "document" as Target.DocumentId, response: Option.some(request.hop) },
        evidence: "test"
      })
      assert.isTrue(Option.isNone(yield* links.to(request)))
      for (let i = 0; i < 100; i++) {
        const next = `later-navigation-${i}` as PageNavigation.Id
        yield* fold.sink({
          _tag: "NavigationStarted",
          navigation: next,
          navigable: "page" as Target.NavigableId,
          url: "https://example.com/later" as Url.Url,
          initiatedAs: "crossDocument"
        })
        yield* fold.sink({
          _tag: "NavigationEnded",
          navigation: next,
          outcome: { _tag: "Committed", document: `later-document-${i}` as Target.DocumentId, response: Option.none() },
          evidence: "test"
        })
      }
      assert.isTrue(Option.isSome(fold.hop(request.hop)), "the request itself remains retained")
      const error = yield* Effect.flip(
        links.to(request).pipe(
          Effect.catchReason("RequestError", "RedirectUnknown", () => Effect.succeedNone)
        )
      )
      assert.strictEqual(error.reason._tag, "RedirectUnavailable")
      assert.strictEqual(error.reason.why, "unavailable")
    }))

  it.effect("collapses only unknown with catchReason and preserves ownership, eviction and lifetime errors", () =>
    Effect.gen(function*() {
      const { page, send, fold } = yield* setup()
      const links = yield* NetworkRequest.redirects(page)
      const first = yield* send("recovery.0")
      const seen = (effect: Effect.Effect<Option.Option<NetworkRequest.NetworkRequest>, NetworkRequest.RequestError>) =>
        effect.pipe(Effect.catchReason("RequestError", "RedirectUnknown", () => Effect.succeedNone))
      assert.isTrue(Option.isNone(yield* seen(links.to(first))))
      const clone = new NetworkRequest.NetworkRequest({ ...first })
      assert.strictEqual((yield* Effect.flip(seen(links.to(clone)))).reason.why, "unavailable")
      const foreign = {} as Page.Page
      yield* fold.sink({
        _tag: "PageAdded",
        page: "foreign" as Target.NavigableId,
        context: "foreign-context" as UserContext.Id,
        kind: "tab",
        origin: { _tag: "Created" },
        url: "about:blank" as Url.Url
      })
      Handles.registerPage(foreign, {
        runtime: { model: fold } as unknown as Runtime.Runtime,
        entry: Option.getOrThrow(fold.page("foreign" as Target.NavigableId)),
        grant: Option.none()
      })
      const foreignLinks = yield* NetworkRequest.redirects(foreign)
      assert.strictEqual((yield* Effect.flip(seen(foreignLinks.to(first)))).reason.why, "foreignTarget")
      const scope = yield* Scope.make()
      const released = yield* NetworkRequest.redirects(page).pipe(Scope.provide(scope))
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual((yield* Effect.flip(seen(released.to(first)))).reason.why, "released")
      for (let i = 0; i < Fold.maxHops; i++) yield* send(`evict-${i}.0`)
      assert.strictEqual((yield* Effect.flip(seen(links.to(first)))).reason.why, "evicted")
      yield* fold.loseConnection
      assert.strictEqual((yield* Effect.flip(seen(links.to(first)))).reason.why, "targetClosed")
      const other = { _tag: "Other" as const }
      const failed: Effect.Effect<
        Option.Option<NetworkRequest.NetworkRequest>,
        NetworkRequest.RequestError | typeof other
      > = Effect.fail(other)
      assert.strictEqual(
        yield* Effect.flip(
          failed.pipe(Effect.catchReason("RequestError", "RedirectUnknown", () => Effect.succeedNone))
        ),
        other
      )
    }))

  it.effect("requires a completed source for the successor retention invariant", () =>
    Effect.gen(function*() {
      const id = (value: string) => value as NetworkRequest.HopId
      const make = () => ({ end: Deferred.makeUnsafe<void>() })
      for (const sourceCompleted of [true, false]) {
        const index = NetworkIndex.hops<{ readonly end: Deferred.Deferred<void> }, void>(2, undefined)
        const source = make()
        const successor = make()
        if (sourceCompleted) yield* Deferred.succeed(source.end, undefined)
        index.keep(id("chain.0"), source)
        index.keep(id("chain.1"), successor)
        yield* Deferred.succeed(successor.end, undefined)
        index.keep(id("other.0"), make())
        assert.strictEqual(Option.isSome(index.get(id("chain.0"))), !sourceCompleted)
        assert.strictEqual(Option.isSome(index.get(id("chain.1"))), sourceCompleted)
      }
    }))

  it.effect("reports eviction instead of inventing a first hop or absent successor", () =>
    Effect.gen(function*() {
      const { page, send } = yield* setup()
      const links = yield* NetworkRequest.redirects(page)
      const first = yield* send("chain.0")
      const second = yield* send("chain.1")
      for (let i = 0; i < Fold.maxHops - 1; i++) yield* send(`other-${i}.0`)
      assert.strictEqual((yield* Effect.flip(links.from(second))).reason.why, "evicted")
      assert.strictEqual((yield* Effect.flip(links.to(first))).reason.why, "evicted")
    }))

  it.effect("revokes access on scope release and target removal", () =>
    Effect.gen(function*() {
      const { page, send, fold } = yield* setup()
      const first = yield* send("chain.0")
      const scope = yield* Scope.make()
      const released = yield* NetworkRequest.redirects(page).pipe(Scope.provide(scope))
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual((yield* Effect.flip(released.from(first))).reason.why, "released")
      const closed = yield* NetworkRequest.redirects(page)
      yield* fold.sink({
        _tag: "NavigableRemoved",
        navigable: "page" as Target.NavigableId,
        reason: new Target.PageClosed({ by: "command" }),
        evidence: "test"
      })
      assert.strictEqual((yield* Effect.flip(closed.from(first))).reason.why, "targetClosed")
    }))
})
