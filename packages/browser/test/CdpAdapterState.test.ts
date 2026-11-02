/**
 * The CDP adapter's state, without a browser: a page that ended takes its input state with it, and an operation
 * that names it after gets `Gone` with the page's reason, never `Foreign`; a redirect's hops each get the headers
 * the network received for them, in whatever order the browser's events come; a realm that ended takes its handles.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import * as Deadline from "../src/Deadline.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Declare from "../src/internal/cdpAdapter/declare.ts"
import * as Network from "../src/internal/cdpAdapter/network.ts"
import * as Obligations from "../src/internal/cdpAdapter/obligations.ts"
import * as Responses from "../src/internal/cdpAdapter/responses.ts"
import * as State from "../src/internal/cdpAdapter/state.ts"
import * as Targets from "../src/internal/cdpAdapter/targets.ts"
import * as Tree from "../src/internal/cdpAdapter/tree.ts"
import * as Groups from "../src/internal/objectGroups.ts"
import type * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Protocol from "../src/protocol/Protocol.ts"
import * as Target from "../src/Target.ts"

const session = { key: "S1", send: () => Effect.succeed({}) } as unknown as ProtocolClient.Session

const control: ProtocolClient.FoldControl = {
  sync: () => {},
  session: () => undefined,
  run: (effect) => effect
}

/** A state with one page in the default context, and the facts it reports once flushed. */
const withPage = Effect.fnUntraced(function*() {
  const facts: Array<Adapter.Fact> = []
  const buffer = yield* Kit.makeFactBuffer((fact) => Effect.sync(() => void facts.push(fact)))
  buffer.connect(control)
  const state = State.make({
    connect: { sink: () => Effect.void, ownership: "launched" },
    ids: Kit.makeIds(),
    buffer,
    control,
    root: () => session,
    release: Responses.release
  })
  const context: State.ContextEntry = {
    id: state.defaultContext,
    browserContextId: undefined,
    isDefault: true,
    removing: false
  }
  state.contexts.set(context.id, context)
  const target: State.TargetEntry = {
    kind: "page",
    targetId: "T1",
    session,
    page: undefined,
    frame: undefined,
    url: "about:blank",
    realm: undefined,
    intercepts: "",
    scripts: new Map(),
    ended: false
  }
  const page: State.PageEntry = {
    id: state.ids.navigable(),
    targetId: "T1",
    context,
    target,
    ready: Deferred.makeUnsafe(),
    closing: undefined,
    ended: false
  }
  state.pages.set(page.id, page)
  const main = Tree.newFrame({ frameId: "T1", id: page.id, page, parent: undefined, owner: target })
  state.frames.set("T1", main)
  state.navigables.set(page.id, main)
  return { state, page, target, facts }
})

// ── A redirect's headers ──

const origin = "http://127.0.0.1:8000"

/** A hop's request event; for a redirect, with the response that ended the hop before and whether it had ExtraInfo. */
const sent = (
  url: string,
  redirect?: { readonly from?: string; readonly location: string; readonly hasExtraInfo?: boolean }
) => ({
  requestId: "R1",
  loaderId: "L1",
  documentURL: `${origin}/`,
  request: { url, method: "GET", headers: { Accept: "*/*" } },
  timestamp: 0,
  wallTime: 0,
  initiator: { type: "script" },
  type: "Fetch",
  frameId: "T1",
  ...(redirect === undefined ? {} : {
    redirectHasExtraInfo: redirect.hasExtraInfo ?? true,
    redirectResponse: {
      url: `${origin}${redirect.from ?? "/redirect"}`,
      status: 302,
      statusText: "Found",
      headers: { Location: redirect.location },
      mimeType: "text/plain",
      protocol: "http/1.1"
    }
  })
})

const received = (statusCode: number, headers: Record<string, string>) => ({
  requestId: "R1",
  blockedCookies: [],
  headers,
  statusCode
})

const sentAs = (headers: Record<string, string>) => ({ requestId: "R1", associatedCookies: [], headers })

const landedAs = (served?: { readonly hasExtraInfo: boolean; readonly fromDiskCache: boolean }) => ({
  requestId: "R1",
  loaderId: "L1",
  timestamp: 0,
  type: "Fetch",
  hasExtraInfo: served?.hasExtraInfo ?? true,
  frameId: "T1",
  response: {
    url: `${origin}/landed`,
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "text/plain" },
    mimeType: "text/plain",
    protocol: "http/1.1",
    ...(served === undefined ? {} : { fromDiskCache: served.fromDiskCache })
  }
})

const landed = landedAs()

/** Plays a redirect's events in the order given, and gives back the responses and hop headers it reported. */
const play = Effect.fnUntraced(function*(order: ReadonlyArray<readonly [string, unknown]>) {
  const { facts, state, target } = yield* withPage()
  const handlers = Network.register(Kit.handlers<State.Event>())
  for (const [method, params] of order) handlers.apply(method, params, { state, target })
  yield* state.buffer.flush
  const responses = facts.flatMap((fact) => fact._tag === "ResponseReceived" ? [fact.response] : [])
  const hopHeaders = (phase: "request" | "response", name: string) =>
    facts.flatMap((fact) =>
      fact._tag === "HopHeaders" && fact.phase === phase ? [[fact.hop, fact.headers[name]] as const] : []
    )
  return { responses, sent: hopHeaders("request", "cookie"), received: hopHeaders("response", "set-cookie") }
})

describe("CdpAdapter state", () => {
  it.effect("forgets a page's held buttons, drag and drag interception when the page ends", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage()
      state.heldButtons.set(page.id, 1)
      state.drags.set(page.id, { data: { items: [], dragOperationsMask: 1 }, entered: true, stale: false })
      state.interceptingDrags.add(page.id)
      Tree.endPage(state, page, new Target.PageClosed({ by: "command" }), "test")
      assert.isFalse(state.heldButtons.has(page.id))
      assert.isFalse(state.drags.has(page.id))
      assert.isFalse(state.interceptingDrags.has(page.id))
    }))

  it.effect("fails an operation on a page that ended as Gone, with why it ended", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage()
      Tree.endPage(state, page, new Target.PageCrashed({}), "test")
      const error = yield* State.pageOf(state, page.id).pipe(Effect.flip)
      assert.deepStrictEqual(error.reason, {
        _tag: "Gone",
        target: { _tag: "Page", id: page.id },
        reason: new Target.PageCrashed({})
      })
      const frame = yield* State.frameById(state, page.id).pipe(Effect.flip)
      assert.strictEqual(frame.reason._tag, "Gone")
      const foreign = yield* State.pageOf(state, Kit.makeIds().navigable()).pipe(Effect.flip)
      assert.strictEqual(foreign.reason._tag, "Foreign")
    }))

  it.effect("fails a document or realm that ended as Gone", () =>
    Effect.gen(function*() {
      const { state } = yield* withPage()
      const document = yield* State.documentOf(state, state.ids.document()).pipe(Effect.flip)
      assert.strictEqual(document.reason._tag, "Gone")
      const realm = yield* State.realmOf(state, state.ids.realm()).pipe(Effect.flip)
      assert.strictEqual(realm.reason._tag, "Gone")
    }))
})

describe("CdpAdapter handles", () => {
  it.effect("drops the handles of a realm that ended, and a later use fails as Gone", () =>
    Effect.gen(function*() {
      const { state, target } = yield* withPage()
      const realm = Tree.addRealm(state, {
        uniqueId: "U1",
        contextId: 1,
        target,
        frame: undefined,
        world: { _tag: "Main" },
        origin: "http://127.0.0.1:8000"
      })
      const kept = Tree.addRealm(state, {
        uniqueId: "U2",
        contextId: 2,
        target,
        frame: undefined,
        world: { _tag: "Main" },
        origin: "http://127.0.0.1:8000"
      })
      const handle = state.ids.handle()
      const grouped = state.ids.handle()
      const other = state.ids.handle()
      state.handles.set(handle, { target, realm, objectId: "O1", group: undefined })
      state.handles.set(grouped, { target, realm, objectId: "O2", group: "g" })
      state.handles.set(other, { target, realm: kept, objectId: "O3", group: "g" })
      Groups.join(state.groups, "g", grouped)
      Groups.join(state.groups, "g", other)

      Tree.removeRealm(state, realm, new Target.RealmDestroyed({}))

      assert.deepStrictEqual([...state.handles.keys()], [other])
      assert.deepStrictEqual([...(state.groups.get("g") ?? [])], [other])
      // The kit's rule for a handle that is not held: one this connection minted is Gone
      const use = (id: Adapter.HandleId) =>
        Kit.argument<string>({ _tag: "Handle", handle: id }, {
          ids: state.ids,
          realm: realm.id,
          value: () => "value",
          handle: (held) => state.handles.get(held)?.objectId,
          node: () => undefined
        })
      const gone = yield* use(handle).pipe(Effect.flip)
      assert.strictEqual(gone.reason._tag, "Gone")
      assert.strictEqual(yield* use(other), "O3")
    }))
})

describe("CdpAdapter redirect headers", () => {
  // The page's events, and the network's, which come in hop order but can overtake the page's
  const first = ["Network.requestWillBeSent", sent(`${origin}/redirect`)] as const
  const redirect = ["Network.requestWillBeSent", sent(`${origin}/landed`, { location: "/landed" })] as const
  const response = ["Network.responseReceived", landed] as const
  const sent0 = ["Network.requestWillBeSentExtraInfo", sentAs({ Cookie: "q=0" })] as const
  const sent1 = ["Network.requestWillBeSentExtraInfo", sentAs({ Cookie: "q=1" })] as const
  const received0 = [
    "Network.responseReceivedExtraInfo",
    received(302, { Location: "/landed", "Set-Cookie": "a=1" })
  ] as const
  const received1 = [
    "Network.responseReceivedExtraInfo",
    received(200, { "Content-Type": "text/plain", "Set-Cookie": "b=2" })
  ] as const

  for (
    const [name, order] of [
      ["in order", [first, sent0, received0, redirect, sent1, received1, response]],
      // These two recorded under load; the next, which fails the redirect, is the same race a step further
      ["with a hop's headers sent before its request", [sent0, first, received0, redirect, sent1, received1, response]],
      ["with the next hop's headers sent before the redirect", [
        first,
        sent0,
        received0,
        sent1,
        redirect,
        received1,
        response
      ]],
      ["with the next hop's response before the redirect", [
        first,
        sent0,
        received0,
        sent1,
        received1,
        redirect,
        response
      ]],
      ["with every ExtraInfo before the request", [sent0, received0, sent1, received1, first, redirect, response]],
      ["with the redirect before its ExtraInfo", [first, redirect, sent0, received0, sent1, received1, response]]
    ] as const
  ) {
    it.effect(`gives each hop its own headers, ${name}`, () =>
      Effect.gen(function*() {
        const { received, responses, sent } = yield* play(order)
        assert.deepStrictEqual(responses.map((response) => response.status), [302, 200])
        const [hop, last] = responses
        assert.strictEqual(hop!.headers["location"], "/landed")
        assert.isUndefined(last!.headers["location"])
        assert.strictEqual(last!.headers["set-cookie"], "b=2")
        assert.deepStrictEqual(sent, [[hop!.hop, "q=0"], [last!.hop, "q=1"]])
        assert.deepStrictEqual(received, [[hop!.hop, "a=1"], [last!.hop, "b=2"]])
      }))
  }
})

describe("CdpAdapter headers of a hop without ExtraInfo", () => {
  // A hop from a cache or a service worker gets no ExtraInfo, and says so only as it ends: by its redirect's
  // `redirectHasExtraInfo` or its response's `hasExtraInfo`. The network's events for a later hop can come first.
  const first = ["Network.requestWillBeSent", sent(`${origin}/redirect`)] as const
  const sent0 = ["Network.requestWillBeSentExtraInfo", sentAs({ Cookie: "q=0" })] as const
  const received0 = [
    "Network.responseReceivedExtraInfo",
    received(302, { Location: "/landed", "Set-Cookie": "a=1" })
  ] as const
  const sent1 = ["Network.requestWillBeSentExtraInfo", sentAs({ Cookie: "q=1" })] as const
  const received1 = [
    "Network.responseReceivedExtraInfo",
    received(200, { "Content-Type": "text/plain", "Set-Cookie": "b=2" })
  ] as const

  describe("a cached redirect to the network", () => {
    const cached = [
      "Network.requestWillBeSent",
      sent(`${origin}/landed`, { location: "/landed", hasExtraInfo: false })
    ] as const
    const response = ["Network.responseReceived", landed] as const
    for (
      const [name, order] of [
        ["in order", [first, cached, sent1, received1, response]],
        ["with the next hop's headers sent before the redirect", [first, sent1, cached, received1, response]],
        ["with the next hop's response before the redirect", [first, sent1, received1, cached, response]],
        ["with the next hop's ExtraInfo before the request", [sent1, received1, first, cached, response]]
      ] as const
    ) {
      it.effect(`gives the cached hop none of the next hop's headers, ${name}`, () =>
        Effect.gen(function*() {
          const { received, responses, sent } = yield* play(order)
          assert.deepStrictEqual(responses.map((response) => response.status), [302, 200])
          const [hop, last] = responses
          assert.strictEqual(hop!.headers["location"], "/landed")
          assert.isUndefined(hop!.headers["set-cookie"])
          assert.strictEqual(last!.headers["set-cookie"], "b=2")
          // The cached hop goes with its request event's headers, which have no cookie
          assert.deepStrictEqual(sent, [[hop!.hop, undefined], [last!.hop, "q=1"]])
          assert.deepStrictEqual(received, [[last!.hop, "b=2"]])
        }))
    }
  })

  describe("a redirect to a cached response", () => {
    const redirect = ["Network.requestWillBeSent", sent(`${origin}/landed`, { location: "/landed" })] as const
    for (
      const [name, response] of [
        ["that says it has none", landedAs({ hasExtraInfo: false, fromDiskCache: true })],
        // Chromium can say a cached response has ExtraInfo and send none
        ["that says it has some", landedAs({ hasExtraInfo: true, fromDiskCache: true })]
      ] as const
    ) {
      for (
        const [ordering, order] of [
          ["in order", [first, sent0, received0, redirect]],
          ["with the redirect before its ExtraInfo", [first, redirect, sent0, received0]]
        ] as const
      ) {
        it.effect(`gives the network's hop its headers and the cached hop its own, ${name}, ${ordering}`, () =>
          Effect.gen(function*() {
            const { received, responses, sent } = yield* play([...order, ["Network.responseReceived", response]])
            assert.deepStrictEqual(responses.map((response) => response.status), [302, 200])
            const [hop, last] = responses
            assert.strictEqual(last!.servedBy, "cache")
            assert.isUndefined(last!.headers["set-cookie"])
            assert.deepStrictEqual(sent, [[hop!.hop, "q=0"], [last!.hop, undefined]])
            assert.deepStrictEqual(received, [[hop!.hop, "a=1"]])
          }))
      }
    }
  })

  it.effect("gives a cached hop between two of the network's none of the last one's headers", () =>
    Effect.gen(function*() {
      const toCached = ["Network.requestWillBeSent", sent(`${origin}/cached`, { location: "/cached" })] as const
      const fromCached = [
        "Network.requestWillBeSent",
        sent(`${origin}/landed`, { from: "/cached", location: "/landed", hasExtraInfo: false })
      ] as const
      // Every ExtraInfo comes before the page's events
      const { received, responses, sent: sentHeaders } = yield* play([
        sent0,
        received0,
        sent1,
        received1,
        first,
        toCached,
        fromCached,
        ["Network.responseReceived", landed]
      ])
      assert.deepStrictEqual(responses.map((response) => response.status), [302, 302, 200])
      const [hop, cached, last] = responses
      assert.deepStrictEqual(sentHeaders, [[hop!.hop, "q=0"], [cached!.hop, undefined], [last!.hop, "q=1"]])
      assert.deepStrictEqual(received, [[hop!.hop, "a=1"], [last!.hop, "b=2"]])
      assert.strictEqual(last!.headers["set-cookie"], "b=2")
    }))

  it.effect("gives a request that fails the ExtraInfo that came for it", () =>
    Effect.gen(function*() {
      const failed = [
        "Network.loadingFailed",
        { requestId: "R1", timestamp: 0, type: "Fetch", errorText: "net::ERR_CONNECTION_RESET" }
      ] as const
      const { sent } = yield* play([first, sent0, failed])
      assert.deepStrictEqual(sent.map(([, cookie]) => cookie), ["q=0"])
    }))
})

describe("CdpAdapter routed response source", () => {
  for (const end of ["failure", "finish", "page", "session"]) {
    it.effect(`discards early fulfillment attribution on ${end}`, () =>
      Effect.gen(function*() {
        const { facts, state, target: original, page } = yield* withPage()
        const target: State.TargetEntry = end === "session" ? { ...original, kind: "worker" } : original
        state.targets.set(session, target)
        const handlers = Obligations.register(Network.register(Kit.handlers<State.Event>()))
        const event = { state, target }
        handlers.apply("Fetch.requestPaused", {
          requestId: "F1",
          networkId: "R1",
          frameId: "T1",
          resourceType: "Fetch",
          request: sent(`${origin}/landed`).request
        }, event)
        yield* Obligations.resolve(state, [...state.obligations.keys()][0]!, {
          _tag: "Fulfill",
          status: 200,
          headers: {},
          body: new Uint8Array()
        })
        if (end === "page") Tree.endPage(state, page, new Target.PageClosed({ by: "command" }), "test")
        else if (end === "session") Targets.ended(state, session, new Protocol.SessionEnded({ why: "targetDestroyed" }))
        else {handlers.apply(end === "failure" ? "Network.loadingFailed" : "Network.loadingFinished", {
            requestId: "R1",
            timestamp: 0,
            errorText: "net::ERR_FAILED",
            encodedDataLength: 0,
            type: "Fetch"
          }, event)}
        handlers.apply("Network.requestWillBeSent", sent(`${origin}/landed`), event)
        handlers.apply("Network.responseReceived", landedAs({ hasExtraInfo: false, fromDiskCache: false }), event)
        yield* state.buffer.flush
        const responses = facts.flatMap((fact) => fact._tag === "ResponseReceived" ? [fact.response] : [])
        assert.strictEqual(responses.length, 1)
        assert.strictEqual(responses[0]!.servedBy, "network")
      }))
  }
  for (const redirectedRequestId of [undefined, "F1"]) {
    it.effect(`keeps an early pause of a redirect's only intercepted hop off the hop before it (${redirectedRequestId ?? "no redirect id"})`, () =>
      Effect.gen(function*() {
        const { facts, state, target } = yield* withPage()
        const handlers = Obligations.register(Network.register(Kit.handlers<State.Event>()))
        const event = { state, target }
        // The first hop matches no intercept pattern, so Fetch never pauses it; the next hop's pause comes before
        // Network announces that hop.
        handlers.apply("Network.requestWillBeSent", sent(`${origin}/redirect`), event)
        handlers.apply("Fetch.requestPaused", {
          requestId: "F2",
          redirectedRequestId,
          networkId: "R1",
          frameId: "T1",
          resourceType: "Fetch",
          request: sent(`${origin}/landed`).request
        }, event)
        yield* Obligations.resolve(state, [...state.obligations.keys()][0]!, {
          _tag: "Fulfill",
          status: 200,
          headers: {},
          body: new Uint8Array()
        })
        handlers.apply(
          "Network.requestWillBeSent",
          sent(`${origin}/landed`, { location: "/landed", hasExtraInfo: false }),
          event
        )
        handlers.apply("Network.responseReceived", landedAs({ hasExtraInfo: false, fromDiskCache: false }), event)
        yield* state.buffer.flush
        const responses = facts.flatMap((fact) => fact._tag === "ResponseReceived" ? [fact.response.servedBy] : [])
        assert.deepStrictEqual(responses, ["network", "route"])
      }))
  }
  for (const phase of ["request", "response"]) {
    for (const early of [true, false]) {
      for (const repeated of early ? [false] : [false, true]) {
        for (const redirectedRequestId of [undefined, "unobserved-previous-fetch-id"]) {
          it.effect(`correlates a ${phase} pause of the only intercepted hop, Network ${early ? "later" : "earlier"}, ${repeated ? "repeated" : "different"} URL, ${redirectedRequestId ?? "no redirect id"}`, () =>
            Effect.gen(function*() {
              const { facts, state, target } = yield* withPage()
              const handlers = Obligations.register(Network.register(Kit.handlers<State.Event>()))
              const event = { state, target }
              const url = `${origin}/${repeated ? "redirect" : "landed"}`
              const redirect = () =>
                handlers.apply(
                  "Network.requestWillBeSent",
                  sent(url, {
                    location: url,
                    hasExtraInfo: false
                  }),
                  event
                )
              handlers.apply("Network.requestWillBeSent", sent(`${origin}/redirect`), event)
              if (!early) redirect()
              handlers.apply("Fetch.requestPaused", {
                requestId: "F2",
                redirectedRequestId,
                networkId: "R1",
                frameId: "T1",
                resourceType: "Fetch",
                request: sent(url).request,
                ...(phase === "response" ? { responseStatusCode: 200, responseHeaders: [] } : {})
              }, event)
              yield* Obligations.resolve(state, [...state.obligations.keys()][0]!, {
                _tag: "Fulfill",
                status: 200,
                headers: {},
                body: new Uint8Array()
              })
              if (early) redirect()
              handlers.apply("Network.responseReceived", landedAs({ hasExtraInfo: false, fromDiskCache: false }), event)
              yield* state.buffer.flush
              const responses = facts.flatMap((fact) =>
                fact._tag === "ResponseReceived" ? [fact.response.servedBy] : []
              )
              assert.deepStrictEqual(responses, ["network", "route"])
            }))
        }
      }
    }
  }
  for (const phase of ["request", "response"]) {
    it.effect(`keeps an early ${phase} pause of a repeated URL's redirect hop off the first hop when Fetch names a previous request`, () =>
      Effect.gen(function*() {
        const { facts, state, target } = yield* withPage()
        const handlers = Obligations.register(Network.register(Kit.handlers<State.Event>()))
        const event = { state, target }
        // The first hop was never paused, so no Fetch id is known for it; Chromium names the request this hop
        // redirected from even so (comment #35's probe), which only a later hop has.
        handlers.apply("Network.requestWillBeSent", sent(`${origin}/redirect`), event)
        handlers.apply("Fetch.requestPaused", {
          requestId: "F2",
          redirectedRequestId: "unobserved-previous-fetch-id",
          networkId: "R1",
          frameId: "T1",
          resourceType: "Fetch",
          request: sent(`${origin}/redirect`).request,
          ...(phase === "response" ? { responseStatusCode: 200, responseHeaders: [] } : {})
        }, event)
        yield* Obligations.resolve(state, [...state.obligations.keys()][0]!, {
          _tag: "Fulfill",
          status: 200,
          headers: {},
          body: new Uint8Array()
        })
        handlers.apply(
          "Network.requestWillBeSent",
          sent(`${origin}/redirect`, { location: `${origin}/redirect`, hasExtraInfo: false }),
          event
        )
        handlers.apply("Network.responseReceived", landedAs({ hasExtraInfo: false, fromDiskCache: false }), event)
        yield* state.buffer.flush
        const responses = facts.flatMap((fact) => fact._tag === "ResponseReceived" ? [fact.response.servedBy] : [])
        assert.deepStrictEqual(responses, ["network", "route"])
      }))
  }
  it.effect("keeps a response pause on its Fetch request after a URL override", () =>
    Effect.gen(function*() {
      const { facts, state, target } = yield* withPage()
      const handlers = Obligations.register(Network.register(Kit.handlers<State.Event>()))
      const event = { state, target }
      handlers.apply("Network.requestWillBeSent", sent(`${origin}/original`), event)
      handlers.apply("Fetch.requestPaused", {
        requestId: "F1",
        networkId: "R1",
        frameId: "T1",
        resourceType: "Fetch",
        request: sent(`${origin}/original`).request
      }, event)
      yield* Obligations.resolve(state, [...state.obligations.keys()][0]!, {
        _tag: "Continue",
        overrides: Option.some({ url: `${origin}/landed` })
      })
      handlers.apply("Fetch.requestPaused", {
        requestId: "F1",
        networkId: "R1",
        frameId: "T1",
        resourceType: "Fetch",
        request: sent(`${origin}/landed`).request,
        responseStatusCode: 200,
        responseHeaders: []
      }, event)
      yield* Obligations.resolve(state, [...state.obligations.keys()][0]!, {
        _tag: "Fulfill",
        status: 200,
        headers: {},
        body: new Uint8Array()
      })
      handlers.apply("Network.responseReceived", landedAs({ hasExtraInfo: false, fromDiskCache: false }), event)
      yield* state.buffer.flush
      const responses = facts.flatMap((fact) => fact._tag === "ResponseReceived" ? [fact.response.servedBy] : [])
      assert.deepStrictEqual(responses, ["route"])
    }))
  for (const redirectedRequestId of [undefined, "F1"]) {
    for (const first of ["before", "after", "unwanted"]) {
      it.effect(`keeps an early redirected pause off the previous hop with first pause ${first} request (${redirectedRequestId ?? "no redirect id"})`, () =>
        Effect.gen(function*() {
          const { facts, state, target: original, page } = yield* withPage()
          const target = first === "unwanted" ? { ...original, page } : original
          const handlers = Obligations.register(Network.register(Kit.handlers<State.Event>()))
          const event = { state, target }
          if (first === "after") handlers.apply("Network.requestWillBeSent", sent(`${origin}/redirect`), event)
          const pause = (requestId: string, redirectedRequestId?: string) =>
            handlers.apply("Fetch.requestPaused", {
              requestId,
              redirectedRequestId,
              networkId: "R1",
              frameId: "T1",
              resourceType: "Fetch",
              request: sent(`${origin}/redirect`).request
            }, event)
          pause("F1")
          if (first === "unwanted") {
            assert.strictEqual(state.obligations.size, 0)
            state.registry.add({ _tag: "Page", page: page.id }, {
              _tag: "Intercept",
              patterns: ["*"],
              phases: ["request"]
            }, state.ids.registration())
          } else {yield* Obligations.resolve(state, [...state.obligations.keys()][0]!, {
              _tag: "Continue",
              overrides: Option.none()
            })}
          if (first !== "after") handlers.apply("Network.requestWillBeSent", sent(`${origin}/redirect`), event)
          pause("F2", redirectedRequestId)
          yield* Obligations.resolve(state, [...state.obligations.keys()][0]!, {
            _tag: "Fulfill",
            status: 200,
            headers: {},
            body: new Uint8Array()
          })
          // The URL can repeat; Fetch's redirect identity distinguishes the hops.
          handlers.apply(
            "Network.requestWillBeSent",
            sent(`${origin}/redirect`, {
              location: "/redirect",
              hasExtraInfo: false
            }),
            event
          )
          handlers.apply("Network.responseReceived", landedAs({ hasExtraInfo: false, fromDiskCache: false }), event)
          yield* state.buffer.flush
          const responses = facts.flatMap((fact) => fact._tag === "ResponseReceived" ? [fact.response.servedBy] : [])
          assert.deepStrictEqual(responses, ["network", "route"])
        }))
    }
  }
  // ROOK-136: the failing order permutes captured events; it was not captured in the live failure.
  for (const order of ["pause before request", "request before pause", "fulfill before request"]) {
    it.effect(`attributes a fulfilled response to its route with ${order}`, () =>
      Effect.gen(function*() {
        const { facts, state, target } = yield* withPage()
        const handlers = Obligations.register(Network.register(Kit.handlers<State.Event>()))
        const event = { state, target }
        const request = sent(`${origin}/landed`)
        // The helper's target has no page attached, so the real pause handler accepts the interception
        // without requiring a declaration registry entry.
        const pause = () =>
          handlers.apply("Fetch.requestPaused", {
            requestId: "F1",
            networkId: "R1",
            frameId: "T1",
            resourceType: "Fetch",
            request: request.request
          }, event)
        if (order !== "request before pause") pause()
        if (order !== "fulfill before request") handlers.apply("Network.requestWillBeSent", request, event)
        if (order === "request before pause") pause()
        const obligations = [...state.obligations.values()]
        assert.strictEqual(obligations.length, 1)
        const obligation = obligations[0]!
        assert.strictEqual(obligation._tag, "PausedRequest")
        yield* Obligations.resolve(state, obligation.id, {
          _tag: "Fulfill",
          status: 200,
          headers: { "content-type": "text/plain" },
          body: new TextEncoder().encode("from the route")
        })
        if (order === "fulfill before request") handlers.apply("Network.requestWillBeSent", request, event)
        handlers.apply("Network.responseReceived", landedAs({ hasExtraInfo: false, fromDiskCache: false }), event)
        yield* state.buffer.flush
        const responses = facts.flatMap((fact) => fact._tag === "ResponseReceived" ? [fact.response] : [])
        assert.strictEqual(responses.length, 1)
        assert.strictEqual(responses[0]!.servedBy, "route")
        handlers.apply(
          "Network.requestWillBeSent",
          sent(`${origin}/next`, {
            from: "/landed",
            location: "/next",
            hasExtraInfo: false
          }),
          event
        )
        handlers.apply("Network.responseReceived", landedAs({ hasExtraInfo: false, fromDiskCache: false }), event)
        yield* state.buffer.flush
        const last = facts.filter((fact) => fact._tag === "ResponseReceived").at(-1)!
        assert.strictEqual(last.response.servedBy, "network")
      }))
  }
})

describe("CDP declaration release", () => {
  for (
    const reason of [
      new Protocol.SessionEnded({ why: "targetDestroyed" }),
      new Protocol.Rejected({
        method: "Emulation.clearDeviceMetricsOverride",
        reason: "Unrecognized",
        code: -1,
        description: "restore failed"
      })
    ]
  ) {
    it.effect(`releases without failing and ${reason._tag === "SessionEnded" ? "stays silent for SessionEnded" : "warns for Rejected"}`, () =>
      Effect.gen(function*() {
        const { state, target, page } = yield* withPage()
        const warnings: Array<unknown> = []
        const logger = Logger.make((entry) => {
          if (entry.logLevel === "Warn") warnings.push(entry.message)
        })
        const failingSession = {
          ...session,
          subscribe: () => Effect.succeed(Stream.never),
          send: (command: { readonly method: string }) =>
            command.method === "Emulation.clearDeviceMetricsOverride"
              ? Effect.fail(new Protocol.ProtocolError({ reason })) :
              Effect.succeed({ executionContextId: 1, result: { value: [780, 493] } })
        } as unknown as ProtocolClient.Session
        state.targets.set(failingSession, { ...target, session: failingSession, page })
        yield* Effect.scoped(Declare.declare(state, { _tag: "Page", page: page.id }, {
          _tag: "Override",
          override: { _tag: "Viewport", width: 640, height: 480, deviceScaleFactor: 1, mobile: false }
        })).pipe(Effect.provideService(Logger.CurrentLoggers, new Set([logger])))
        assert.strictEqual(warnings.length, reason._tag === "SessionEnded" ? 0 : 1)
      }))
  }
})

describe("CDP restoration cleanup", () => {
  for (const end of ["deadline", "session"] as const) {
    it.effect(`bounds absent-frame restoration after an expired operation and cleans up on ${end}`, () =>
      Effect.gen(function*() {
        const { state, page, target } = yield* withPage()
        const clock = BrowserClock.fromClock(yield* Clock.Clock)
        const measured = yield* Deferred.make<void>()
        const ended = yield* Deferred.make<void, Protocol.ProtocolError>()
        let subscriptions = 0
        let reads = 0
        let restored = false
        let clears = 0
        const warnings: Array<unknown> = []
        const logger = Logger.make((entry) => {
          if (entry.logLevel === "Warn") warnings.push(entry.message)
        })
        const mock = {
          ...session,
          subscribe: () =>
            Effect.acquireRelease(
              Effect.sync(() => {
                subscriptions++
                return Stream.fromEffect(Deferred.await(ended))
              }),
              () =>
                Effect.sync(() => {
                  subscriptions--
                })
            ),
          send: Effect.fnUntraced(function*(command: { readonly method: string }) {
            if (command.method === "Page.createIsolatedWorld") return { executionContextId: 1 }
            if (command.method === "Runtime.evaluate") {
              reads++
              if (reads > 1) yield* Deferred.succeed(measured, undefined)
              return { result: { value: reads === 1 || restored ? [780, 493] : [640, 480] } }
            }
            if (command.method === "Emulation.clearDeviceMetricsOverride") clears++
            return {}
          })
        } as unknown as ProtocolClient.Session
        const entry = { ...target, session: mock, page }
        state.targets.set(mock, entry)
        const release = yield* Effect.scoped(Declare.declare(state, { _tag: "Page", page: page.id }, {
          _tag: "Override",
          override: { _tag: "Viewport", width: 640, height: 480, deviceScaleFactor: 1, mobile: false }
        })).pipe(
          Effect.provideService(BrowserClock.CurrentClock, clock),
          Effect.provideService(Deadline.DefaultBudget, Duration.seconds(1)),
          Effect.provideService(Deadline.CurrentDeadline, Option.some(clock.now())),
          Effect.provideService(Logger.CurrentLoggers, new Set([logger])),
          Effect.forkChild({ startImmediately: true })
        )
        yield* Deferred.await(measured)
        assert.strictEqual(subscriptions, 1)
        if (end === "deadline") yield* TestClock.adjust("1 second")
        else {yield* Deferred.fail(
            ended,
            new Protocol.ProtocolError({ reason: new Protocol.SessionEnded({ why: "targetDestroyed" }) })
          )}
        yield* Fiber.join(release)
        assert.strictEqual(clears, 1, "cleanup still clears after the enclosing deadline")
        assert.strictEqual(subscriptions, 0)
        assert.strictEqual(warnings.length, end === "deadline" ? 1 : 0)
        assert.isTrue(yield* entry.viewportLock!.withPermits(1)(Effect.succeed(true)), "cleanup releases its lock")
        assert.deepStrictEqual(
          entry.viewport,
          { width: 780, height: 493 },
          "incomplete restoration keeps the original dimensions"
        )
        if (end === "deadline") {
          restored = true
          yield* Effect.scoped(Declare.declare(state, { _tag: "Page", page: page.id }, {
            _tag: "Override",
            override: { _tag: "Viewport", width: 640, height: 480, deviceScaleFactor: 1, mobile: false }
          }))
          assert.isUndefined(entry.viewport, "a later successful restoration releases the saved dimensions")
          assert.strictEqual(reads, 3, "a later override must not capture stale dimensions as its original")
          assert.strictEqual(subscriptions, 0)
        }
      }))
  }

  it.effect("does not let one target's ended session hide another target's rejection", () =>
    Effect.gen(function*() {
      const { state, page, target } = yield* withPage()
      const warnings: Array<unknown> = []
      const released: Array<string> = []
      const rejected = new Protocol.ProtocolError({
        reason: new Protocol.Rejected({
          method: "Emulation.setTimezoneOverride",
          reason: "Unrecognized",
          code: -1,
          description: "restore failed"
        })
      })
      for (const key of ["ended", "rejected"]) {
        const mock = {
          ...session,
          key,
          send: (command: { readonly params?: { readonly timezoneId?: string } }) =>
            command.params?.timezoneId === "" ?
              Effect.suspend(() => {
                released.push(key)
                return Effect.fail(
                  key === "ended"
                    ? new Protocol.ProtocolError({ reason: new Protocol.SessionEnded({ why: "targetDestroyed" }) })
                    : rejected
                )
              }) :
              Effect.succeed({})
        } as unknown as ProtocolClient.Session
        state.targets.set(mock, { ...target, session: mock, page })
      }
      yield* Effect.scoped(Declare.declare(state, { _tag: "UserContext", context: page.context.id }, {
        _tag: "Override",
        override: { _tag: "TimeZone", timeZone: "Asia/Tokyo" }
      })).pipe(Effect.provideService(
        Logger.CurrentLoggers,
        new Set([Logger.make((entry) => {
          if (entry.logLevel === "Warn") warnings.push(entry.message)
        })])
      ))
      assert.deepStrictEqual(released.sort(), ["ended", "rejected"])
      assert.strictEqual(warnings.length, 1)
    }))

  it.effect("continues download cleanup after an ended context and warns for a rejected one", () =>
    Effect.gen(function*() {
      const { state, page } = yield* withPage()
      const warnings: Array<unknown> = []
      const released: Array<string> = []
      page.context.browserContextId = "ended"
      const other = { ...page.context, id: state.ids.userContext(), browserContextId: "rejected" }
      state.contexts.set(other.id, other)
      const mock = {
        ...session,
        send: (command: { readonly params: { readonly behavior: string; readonly browserContextId: string } }) =>
          command.params.behavior === "default" ?
            Effect.suspend(() => {
              released.push(command.params.browserContextId)
              return Effect.fail(
                new Protocol.ProtocolError({
                  reason: command.params.browserContextId === "ended"
                    ? new Protocol.SessionEnded({ why: "targetDestroyed" }) :
                    new Protocol.Rejected({
                      method: "Browser.setDownloadBehavior",
                      reason: "Unrecognized",
                      code: -1,
                      description: "restore failed"
                    })
                })
              )
            }) :
            Effect.succeed({})
      } as unknown as ProtocolClient.Session
      yield* Effect.scoped(
        Declare.declare({ ...state, root: () => mock }, { _tag: "UserContext", context: page.context.id }, {
          _tag: "Downloads",
          behavior: { _tag: "Deny" }
        })
      ).pipe(Effect.provideService(
        Logger.CurrentLoggers,
        new Set([Logger.make((entry) => {
          if (entry.logLevel === "Warn") warnings.push(entry.message)
        })])
      ))
      assert.deepStrictEqual(released, ["ended", "rejected"])
      assert.strictEqual(warnings.length, 1)
    }))
})

describe("CDP viewport override and its baseline", () => {
  const override = {
    _tag: "Override",
    override: { _tag: "Viewport", width: 640, height: 480, deviceScaleFactor: 1, mobile: false }
  } as const

  // Chromium ends a `Runtime.evaluate` in flight across a cross-process navigation, and answers none where a page has
  // no default context yet: neither stopped the override before it needed a read
  it.effect("applies the override when reading the page's dimensions is rejected", () =>
    Effect.gen(function*() {
      const { state, page, target } = yield* withPage()
      const methods: Array<string> = []
      const mock = {
        ...session,
        subscribe: () => Effect.succeed(Stream.never),
        send: (command: { readonly method: string }) => {
          methods.push(command.method)
          if (command.method === "Page.createIsolatedWorld") return Effect.succeed({ executionContextId: 1 })
          return command.method === "Runtime.evaluate"
            ? Effect.fail(
              new Protocol.ProtocolError({
                reason: new Protocol.Rejected({
                  method: command.method,
                  reason: "Unrecognized",
                  code: -32000,
                  description: "Inspected target navigated or closed"
                })
              })
            )
            : Effect.succeed({})
        }
      } as unknown as ProtocolClient.Session
      state.targets.set(mock, { ...target, session: mock, page })
      const result = yield* Effect.scoped(Declare.declare(state, { _tag: "Page", page: page.id }, override)).pipe(
        Effect.exit
      )
      assert.include(methods, "Emulation.setDeviceMetricsOverride")
      assert.strictEqual(result._tag, "Success")
    }))

  // `let innerWidth = "wide"` in a page's script: the read runs in the page's own world, where its names win
  it.effect("applies the override when the page has an innerWidth of its own", () =>
    Effect.gen(function*() {
      const { state, page, target } = yield* withPage()
      const methods: Array<string> = []
      const mock = {
        ...session,
        subscribe: () => Effect.succeed(Stream.never),
        send: (command: { readonly method: string }) => {
          methods.push(command.method)
          return Effect.succeed({ executionContextId: 1, result: { value: ["wide", 493] } })
        }
      } as unknown as ProtocolClient.Session
      state.targets.set(mock, { ...target, session: mock, page })
      const result = yield* Effect.scoped(Declare.declare(state, { _tag: "Page", page: page.id }, override)).pipe(
        Effect.exit
      )
      assert.include(methods, "Emulation.setDeviceMetricsOverride")
      assert.strictEqual(result._tag, "Success")
    }))
})

describe("CDP unknown viewport baseline lifecycle", () => {
  for (const value of [undefined, ["wide", 493], [NaN, 493], [Infinity, 493]]) {
    it.effect(`applies nested and replaced overrides with an unknown ${String(value)} baseline`, () =>
      Effect.gen(function*() {
        const { state, page, target } = yield* withPage()
        let reads = 0
        let applied = 0
        let cleared = 0
        const warnings: Array<unknown> = []
        const mock = {
          ...session,
          subscribe: () => Effect.succeed(Stream.never),
          send: (command: { readonly method: string; readonly params?: { readonly contextId?: number } }) =>
            Effect.sync(() => {
              if (command.method === "Page.createIsolatedWorld") return { executionContextId: 7 }
              if (command.method === "Runtime.evaluate") {
                assert.strictEqual(command.params?.contextId, 7)
                reads++
                return { result: { value: reads === 1 ? value : [640, 480] } }
              }
              if (command.method === "Emulation.setDeviceMetricsOverride") applied++
              if (command.method === "Emulation.clearDeviceMetricsOverride") cleared++
              return {}
            })
        } as unknown as ProtocolClient.Session
        const entry = { ...target, page, session: mock }
        state.targets.set(mock, entry)
        const first = yield* Scope.make()
        const second = yield* Scope.make()
        const third = yield* Scope.make()
        const declare = (width: number, context: boolean) =>
          Declare.declare(
            state,
            context ? { _tag: "UserContext", context: page.context.id } : { _tag: "Page", page: page.id },
            {
              _tag: "Override",
              override: { _tag: "Viewport", width, height: 480, deviceScaleFactor: 1, mobile: false }
            }
          )
        yield* Effect.gen(function*() {
          yield* declare(640, true).pipe(Effect.provideService(Scope.Scope, first))
          yield* declare(800, false).pipe(Effect.provideService(Scope.Scope, second))
          yield* declare(1000, false).pipe(Effect.provideService(Scope.Scope, third))
          yield* Scope.close(second, Exit.void)
          yield* Scope.close(third, Exit.void)
          assert.strictEqual(warnings.length, 0)
          yield* Scope.close(first, Exit.void)
          assert.strictEqual(entry.viewport, null)
          assert.strictEqual(reads, 1, "never recapture an emulated baseline")
          assert.strictEqual(applied, 5)
          assert.strictEqual(cleared, 1)
          assert.strictEqual(warnings.length, 1)
          yield* Effect.scoped(declare(640, false))
          assert.strictEqual(reads, 1, "unknown persists after an unverifiable clear")
          assert.strictEqual(warnings.length, 2)
        }).pipe(Effect.provideService(
          Logger.CurrentLoggers,
          new Set([Logger.make((entry) => {
            if (entry.logLevel === "Warn") warnings.push(entry.message)
          })])
        ))
      }))
  }

  it.effect("uses an isolated numeric baseline instead of numeric main-world shadows", () =>
    Effect.gen(function*() {
      const { state, page, target } = yield* withPage()
      const contexts: Array<number | undefined> = []
      const mock = {
        ...session,
        subscribe: () => Effect.succeed(Stream.never),
        send: (command: { readonly method: string; readonly params?: { readonly contextId?: number } }) =>
          Effect.sync(() => {
            if (command.method === "Page.createIsolatedWorld") return { executionContextId: 8 }
            if (command.method === "Runtime.evaluate") {
              contexts.push(command.params?.contextId)
              return { result: { value: command.params?.contextId === 8 ? [780, 493] : [123, 456] } }
            }
            return {}
          })
      } as unknown as ProtocolClient.Session
      const entry = { ...target, session: mock, page }
      state.targets.set(mock, entry)
      yield* Effect.scoped(Declare.declare(state, { _tag: "Page", page: page.id }, {
        _tag: "Override",
        override: { _tag: "Viewport", width: 640, height: 480, deviceScaleFactor: 1, mobile: false }
      }))
      assert.deepStrictEqual(contexts, [8, 8])
      assert.isUndefined(entry.viewport)
    }))
})
