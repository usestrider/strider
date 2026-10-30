/**
 * The CDP adapter's state, without a browser: a page that ended takes its input state with it, and an operation
 * that names it after gets `Gone` with the page's reason, never `Foreign`; a redirect's hops each get the headers
 * the network received for them, in whatever order the browser's events come; a realm that ended takes its handles.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Network from "../src/internal/cdpAdapter/network.ts"
import * as Responses from "../src/internal/cdpAdapter/responses.ts"
import * as State from "../src/internal/cdpAdapter/state.ts"
import * as Tree from "../src/internal/cdpAdapter/tree.ts"
import * as Groups from "../src/internal/objectGroups.ts"
import type * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Target from "../src/Target.ts"

const session = { key: "S1" } as ProtocolClient.Session

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
