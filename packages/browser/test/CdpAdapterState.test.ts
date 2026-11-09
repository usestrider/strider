/**
 * The CDP adapter's state, without a browser: a page that ended takes its input state with it, and an operation
 * that names it after gets `Gone` with the page's reason, never `Foreign`; a redirect's hops each get the headers
 * the network received for them, in whatever order the browser's events come; a realm that ended takes its handles.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import * as Deadline from "../src/Deadline.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Capture from "../src/internal/cdpAdapter/capture.ts"
import * as Contexts from "../src/internal/cdpAdapter/contexts.ts"
import * as Declare from "../src/internal/cdpAdapter/declare.ts"
import * as Evaluation from "../src/internal/cdpAdapter/evaluation.ts"
import * as CdpInput from "../src/internal/cdpAdapter/input.ts"
import * as Network from "../src/internal/cdpAdapter/network.ts"
import * as Obligations from "../src/internal/cdpAdapter/obligations.ts"
import * as Responses from "../src/internal/cdpAdapter/responses.ts"
import * as State from "../src/internal/cdpAdapter/state.ts"
import * as Targets from "../src/internal/cdpAdapter/targets.ts"
import * as Tree from "../src/internal/cdpAdapter/tree.ts"
import * as CdpWire from "../src/internal/cdpWire.ts"
import * as Cleanup from "../src/internal/declarationCleanup.ts"
import * as Input from "../src/internal/input.ts"
import * as Groups from "../src/internal/objectGroups.ts"
import * as Operation from "../src/internal/operation.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Protocol from "../src/protocol/Protocol.ts"
import * as Target from "../src/Target.ts"
import { makeBrowser } from "./utils/FakeBrowser.ts"

const session = { key: "S1", send: () => Effect.succeed({}) } as unknown as ProtocolClient.Session

const control: ProtocolClient.FoldControl = {
  sync: () => {},
  session: () => undefined,
  run: (effect) => effect
}

/** A state with one page in the default context, and the facts it reports once flushed. */
const withPage = Effect.fnUntraced(function*(protocolSession = session) {
  const facts: Array<Adapter.Fact> = []
  const buffer = yield* Kit.makeFactBuffer((fact) => Effect.sync(() => void facts.push(fact)))
  buffer.connect(control)
  const state = State.make({
    cleanupScope: yield* Effect.scope,
    connect: { sink: () => Effect.void, ownership: "launched" },
    ids: Kit.makeIds(),
    buffer,
    control,
    root: () => protocolSession,
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
    session: protocolSession,
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

describe("CDP click cleanup", () => {
  it.effect("releases a successful press when interruption arrives before release dispatch", () =>
    Effect.gen(function*() {
      const sent: Array<string> = []
      let calls = 0
      const protocolSession = {
        ...session,
        sendOrdered: (
          commands: ReadonlyArray<Protocol.Command<string, { type: string }, void>>,
          onWritten?: () => void
        ) =>
          Effect.suspend(() => {
            calls++
            // The press has succeeded, but cancellation wins before the normal release can write.
            if (calls === 2) return Effect.interrupt
            sent.push(...commands.map((command) => command.params.type))
            onWritten?.()
            return Effect.void
          })
      } as unknown as ProtocolClient.Session
      const { state, page } = yield* withPage(protocolSession)
      const exit = yield* CdpInput.dispatchInput(
        state,
        page.id,
        Input.click(Input.make(), { x: 10, y: 20 }, "left", 1)
      ).pipe(Effect.exit)
      assert(Exit.isFailure(exit))
      assert.isTrue(Cause.hasInterruptsOnly(exit.cause))
      assert.deepStrictEqual(sent, ["mouseMoved", "mousePressed", "mouseReleased"])
    }).pipe(Effect.scoped))

  it.effect("doesn't release again when interruption arrives after the release was written", () =>
    Effect.gen(function*() {
      const sent: Array<string> = []
      let calls = 0
      const protocolSession = {
        ...session,
        sendOrdered: (
          commands: ReadonlyArray<Protocol.Command<string, { type: string }, void>>,
          onWritten?: () => void
        ) =>
          Effect.suspend(() => {
            calls++
            sent.push(...commands.map((command) => command.params.type))
            onWritten?.()
            // The release has been written; cancellation arrives while its reply is outstanding.
            return calls === 2 ? Effect.interrupt : Effect.void
          })
      } as unknown as ProtocolClient.Session
      const { state, page } = yield* withPage(protocolSession)
      const exit = yield* CdpInput.dispatchInput(
        state,
        page.id,
        Input.click(Input.make(), { x: 10, y: 20 }, "left", 1)
      ).pipe(Effect.exit)
      assert(Exit.isFailure(exit))
      assert.isTrue(Cause.hasInterruptsOnly(exit.cause))
      assert.deepStrictEqual(sent, ["mouseMoved", "mousePressed", "mouseReleased"])
    }).pipe(Effect.scoped))
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
  it.effect("attributes a fulfilled 302 and its network 200 to their own hops", () =>
    Effect.gen(function*() {
      const { facts, state, target } = yield* withPage()
      const handlers = Obligations.register(Network.register(Kit.handlers<State.Event>()))
      const event = { state, target }
      const request = sent(`${origin}/redirect`)
      handlers.apply("Network.requestWillBeSent", request, event)
      handlers.apply("Fetch.requestPaused", {
        requestId: "F1",
        networkId: "R1",
        frameId: "T1",
        resourceType: "Fetch",
        request: request.request
      }, event)
      const obligation = [...state.obligations.values()][0]!
      assert.strictEqual(obligation._tag, "PausedRequest")
      yield* Obligations.resolve(state, obligation.id, {
        _tag: "Fulfill",
        status: 302,
        headers: { location: `${origin}/landed` },
        body: new Uint8Array()
      })
      // CDP delivers the redirect response on the next request event, not responseReceived.
      handlers.apply(
        "Network.requestWillBeSent",
        sent(`${origin}/landed`, {
          location: "/landed",
          hasExtraInfo: false
        }),
        event
      )
      handlers.apply("Network.responseReceived", landedAs({ hasExtraInfo: false, fromDiskCache: false }), event)
      yield* state.buffer.flush
      const responses = facts.flatMap((fact) => fact._tag === "ResponseReceived" ? [fact.response] : [])
      assert.deepStrictEqual(
        responses.map((response) => [response.url, response.status, response.servedBy]),
        [[`${origin}/redirect`, 302, "route"], [`${origin}/landed`, 200, "network"]]
      )
      assert.notStrictEqual(responses[0]!.hop, responses[1]!.hop)
    }))

  // The failing order permutes captured events; it was not captured in the live failure.
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

  it.effect("restores only the affected context when local downloads release", () =>
    Effect.gen(function*() {
      const restored: Array<string | undefined> = []
      const mock = {
        ...session,
        send: (command: { readonly params: { readonly behavior: string; readonly browserContextId?: string } }) => {
          if (command.params.behavior === "default") restored.push(command.params.browserContextId)
          return Effect.succeed({})
        }
      } as unknown as ProtocolClient.Session
      const { state, page } = yield* withPage(mock)
      const other = { ...page.context, id: state.ids.userContext(), browserContextId: "unrelated" }
      state.contexts.set(other.id, other)
      yield* Effect.scoped(Declare.declare(state, { _tag: "UserContext", context: page.context.id }, {
        _tag: "Downloads",
        behavior: { _tag: "Deny" }
      }))
      assert.deepStrictEqual(restored, [undefined])
    }))

  for (const outcome of ["success", "failure", "interruption"] as const) {
    it.effect(`restores browser-wide downloads across concurrent disposal: ${outcome}`, () =>
      Effect.scoped(Effect.gen(function*() {
        const snapshotTaken = yield* Deferred.make<void>()
        const continueRelease = yield* Deferred.make<void>()
        const disposalSent = yield* Deferred.make<void>()
        const finishDisposal = yield* Deferred.make<void>()
        const disposed = new Set<string>()
        const restored: Array<string> = []
        const warnings: Array<unknown> = []
        const mock = {
          ...session,
          ended: Effect.void,
          send: (command: {
            readonly method: string
            readonly params: { readonly browserContextId: string; readonly behavior?: string }
          }) =>
            Effect.suspend(() => {
              const id = command.params.browserContextId
              if (command.method === "Target.disposeBrowserContext") {
                if (outcome === "success") disposed.add(id)
                return Deferred.succeed(disposalSent, undefined).pipe(
                  Effect.andThen(Deferred.await(finishDisposal)),
                  Effect.andThen(
                    outcome === "failure"
                      ? Effect.fail(
                        new Protocol.ProtocolError({ reason: new Protocol.SessionEnded({ why: "targetDestroyed" }) })
                      )
                      : Effect.succeed({})
                  )
                )
              }
              if (command.method === "Browser.setDownloadBehavior" && command.params.behavior === "default") {
                if (id === undefined) {
                  return Deferred.succeed(snapshotTaken, undefined).pipe(
                    Effect.andThen(Deferred.await(continueRelease)),
                    Effect.as({})
                  )
                }
                restored.push(id)
                if (disposed.has(id)) {
                  return Effect.fail(
                    new Protocol.ProtocolError({
                      reason: new Protocol.Rejected({
                        method: command.method,
                        reason: "Unrecognized",
                        code: -32602,
                        description: `Failed to find browser context for id ${id}`
                      })
                    })
                  )
                }
              }
              return Effect.succeed({})
            })
        } as unknown as ProtocolClient.Session
        const { state, page } = yield* withPage(mock)
        // The page session has ended, but another declaration's release snapshots the context before disposal.
        const closing = {
          ...page.context,
          id: state.ids.userContext(),
          browserContextId: "disposing",
          isDefault: false
        }
        state.contexts.set(closing.id, closing)
        state.contextsByCdp.set("disposing", closing)
        state.pages.set(page.id, { ...page, context: closing })
        const other = { ...closing, id: state.ids.userContext(), browserContextId: "live" }
        state.contexts.set(other.id, other)
        state.contextsByCdp.set("live", other)
        const lifetime = yield* Scope.make()
        yield* Declare.declare(state, { _tag: "Browser" }, {
          _tag: "Downloads",
          behavior: { _tag: "Deny" }
        }).pipe(Scope.provide(lifetime))
        const releasing = yield* Scope.close(lifetime, Exit.void).pipe(
          Effect.provideService(
            Logger.CurrentLoggers,
            new Set([Logger.make((entry) => {
              if (entry.logLevel === "Warn") warnings.push(entry.message)
            })])
          ),
          Effect.forkScoped
        )
        yield* Deferred.await(snapshotTaken)
        const removing = yield* Contexts.removeUserContext(state, closing.id).pipe(Effect.forkScoped)
        yield* Deferred.await(disposalSent)
        assert.isTrue(state.contexts.has(closing.id), "disposal has not yet replied")
        yield* Deferred.succeed(continueRelease, undefined)
        if (outcome === "interruption") yield* Fiber.interrupt(removing)
        yield* Deferred.succeed(finishDisposal, undefined)
        yield* Fiber.await(removing)
        yield* Fiber.join(releasing)
        if (outcome === "success") {
          yield* state.buffer.waitFor(() => state.contexts.has(closing.id) ? undefined : true)
          assert.isFalse(state.contextsByCdp.has("disposing"))
          assert.notInclude(restored, "disposing")
        } else {
          assert.isFalse(closing.removing)
          assert.include(restored, "disposing")
        }
        assert.include(restored, "live", "the surviving context still has its download behavior restored")
        assert.strictEqual(warnings.length, 0)
      })))
  }

  it.effect("holds disposal until a download restore already sent to the context has replied", () =>
    Effect.scoped(Effect.gen(function*() {
      const restoreSent = yield* Deferred.make<void>()
      const finishRestore = yield* Deferred.make<void>()
      const order: Array<string> = []
      const mock = {
        ...session,
        ended: Effect.void,
        send: (command: {
          readonly method: string
          readonly params: { readonly browserContextId?: string; readonly behavior?: string }
        }) =>
          Effect.suspend(() => {
            if (command.method === "Target.disposeBrowserContext") {
              order.push("dispose")
              return Effect.succeed({})
            }
            if (
              command.method === "Browser.setDownloadBehavior" && command.params.behavior === "default" &&
              command.params.browserContextId === "disposing"
            ) {
              order.push("restore sent")
              return Deferred.succeed(restoreSent, undefined).pipe(
                Effect.andThen(Deferred.await(finishRestore)),
                Effect.andThen(Effect.sync(() => order.push("restore replied"))),
                Effect.as({})
              )
            }
            return Effect.succeed({})
          })
      } as unknown as ProtocolClient.Session
      const { state, page } = yield* withPage(mock)
      const closing = {
        id: state.ids.userContext(),
        browserContextId: "disposing",
        isDefault: false,
        removing: false
      }
      state.contexts.set(closing.id, closing)
      state.contextsByCdp.set("disposing", closing)
      state.pages.set(page.id, { ...page, context: closing })
      const lifetime = yield* Scope.make()
      yield* Declare.declare(state, { _tag: "Browser" }, {
        _tag: "Downloads",
        behavior: { _tag: "Deny" }
      }).pipe(Scope.provide(lifetime))
      const releasing = yield* Scope.close(lifetime, Exit.void).pipe(Effect.forkScoped)
      yield* Deferred.await(restoreSent)
      const removing = yield* Contexts.removeUserContext(state, closing.id).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      assert.deepStrictEqual(order, ["restore sent"], "disposal waits for the restore in flight")
      yield* Deferred.succeed(finishRestore, undefined)
      yield* Fiber.join(releasing)
      yield* Fiber.join(removing)
      assert.deepStrictEqual(order, ["restore sent", "restore replied", "dispose"])
    })))

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
        Declare.declare({ ...state, root: () => mock }, { _tag: "Browser" }, {
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

describe("Chromium screenshot guard lifecycle", () => {
  for (const outcome of ["success", "failure", "interruption"] as const) {
    it.effect(`removes its registration on ${outcome}`, () =>
      Effect.gen(function*() {
        const { state, page } = yield* withPage()
        const entered = yield* Deferred.make<void>()
        const effect = Effect.gen(function*() {
          assert.strictEqual(state.captures.size, 1)
          yield* Deferred.succeed(entered, undefined)
          if (outcome === "failure") return yield* Effect.fail("original failure")
          if (outcome === "interruption") return yield* Effect.never
          return "pixels"
        })
        const fiber = yield* Effect.forkScoped(Capture.guard(state, page.id, effect))
        yield* Deferred.await(entered)
        if (outcome === "interruption") yield* Fiber.interrupt(fiber)
        else {
          const exit = yield* Fiber.await(fiber)
          if (outcome === "success") assert.deepStrictEqual(exit, Exit.succeed("pixels"))
          else assert.deepStrictEqual(exit, Exit.fail("original failure"))
        }
        assert.strictEqual(state.captures.size, 0)
      }))
  }

  it.effect("keeps a received native reply while its decoding/delivery is suspended across replacement", () =>
    Effect.gen(function*() {
      const receipt = yield* Deferred.make<void>()
      const decoded = yield* Deferred.make<void>()
      const native = {
        ...session,
        drainObserved: Effect.void,
        send: Effect.fnUntraced(function*(command: { readonly method: string }) {
          if (command.method === "Page.getLayoutMetrics") return {}
          assert.strictEqual(command.method, "Page.captureScreenshot")
          const observe = yield* ProtocolClient.ReplyReceived
          observe?.(10)
          yield* Deferred.succeed(receipt, undefined)
          yield* Deferred.await(decoded)
          return { data: "AA==" }
        })
      } as unknown as ProtocolClient.Session
      const { state, page } = yield* withPage(native)
      const frame = state.navigables.get(page.id)!
      Tree.commit(
        state,
        frame,
        { loaderId: "initial", url: "about:blank", origin: "://" },
        () => ({ _tag: "InitialBlank" }),
        undefined,
        "test"
      )
      const fiber = yield* Effect.forkScoped(Capture.guard(
        state,
        page.id,
        Capture.screenshot(state, page.id, {
          format: "png",
          quality: Option.none(),
          clip: Option.none(),
          fullPage: false,
          scale: "device",
          omitBackground: false
        })
      ))
      yield* Deferred.await(receipt)
      const replacement = Tree.commit(
        state,
        frame,
        { loaderId: "replacement", url: "about:blank", origin: "://" },
        () => ({ _tag: "Adopted" }),
        undefined,
        "test"
      )
      for (const guard of state.captures) guard.replaced(replacement.id, 11)
      assert.isUndefined(fiber.pollUnsafe())
      yield* Deferred.succeed(decoded, undefined)
      assert.deepStrictEqual(Array.from(yield* Fiber.join(fiber)), [0])
      assert.strictEqual(state.captures.size, 0)
    }))
})

describe("CDP declaration cleanup lifetime", () => {
  it.effect("does not interrupt a releasing caller when the connection closes its cleanup fiber", () =>
    Effect.scoped(Effect.gen(function*() {
      const { state, page, target } = yield* withPage()
      const connection = yield* Scope.make()
      const entered = yield* Deferred.make<void>()
      const mock = {
        ...session,
        send: (command: { readonly params?: { readonly timezoneId?: string } }) =>
          command.params?.timezoneId === ""
            ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.succeed({})
      } as unknown as ProtocolClient.Session
      state.targets.set(mock, { ...target, session: mock, page })
      const task = yield* Effect.scoped(
        Declare.declare({ ...state, cleanupScope: connection }, { _tag: "Page", page: page.id }, {
          _tag: "Override",
          override: { _tag: "TimeZone", timeZone: "Asia/Tokyo" }
        })
      ).pipe(Operation.named("test.connectionCleanup"), Effect.forkChild)
      yield* Deferred.await(entered)
      yield* Scope.close(connection, Exit.void)
      assert.isTrue(
        Exit.isSuccess(yield* Fiber.await(task)),
        "connection teardown must not interrupt the declaration finalizer's caller"
      )
    })))

  for (const confirm of [false, true]) {
    it.effect(
      confirm
        ? "confirms borrowed rollback before returning"
        : "continues release after the ordinary caller stops waiting",
      () =>
        Effect.scoped(Effect.gen(function*() {
          const { state, page, target } = yield* withPage()
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          let completed = false
          const mock = {
            ...session,
            send: (command: { readonly params?: { readonly timezoneId?: string } }) =>
              command.params?.timezoneId === "" ?
                Effect.gen(function*() {
                  yield* Deferred.succeed(entered, undefined)
                  yield* Deferred.await(release)
                  completed = true
                  return {}
                }) :
                Effect.succeed({})
          } as unknown as ProtocolClient.Session
          state.targets.set(mock, { ...target, session: mock, page })
          const task = Effect.scoped(Effect.gen(function*() {
            yield* Declare.declare(state, { _tag: "Page", page: page.id }, {
              _tag: "Override",
              override: { _tag: "TimeZone", timeZone: "Asia/Tokyo" }
            })
            return yield* (yield* Operation.record).bound(Effect.never)
          })).pipe(
            Operation.named("test.cleanup"),
            Deadline.within("50 millis"),
            Effect.provideService(Cleanup.Confirm, confirm)
          )
          const fiber = yield* task.pipe(Effect.forkChild)
          yield* Deferred.await(entered)
          yield* BrowserClock.sleep(50)
          assert.strictEqual(fiber.pollUnsafe() !== undefined, !confirm)
          assert.isFalse(completed)
          assert.strictEqual(state.registry.overrides({ page: page.id, context: page.context.id }).size, 0)
          yield* Deferred.succeed(release, undefined)
          const exit = yield* Fiber.await(fiber)
          assert.isTrue(Exit.isFailure(exit))
          yield* BrowserClock.sleep(1)
          assert.isTrue(completed, "the cleanup lifetime must survive the caller deadline")
        }))
    )
  }
})

describe("CDP proxy and website challenge separation", () => {
  for (const coverage of ["none", "auth route", "request route", "document policy"] as const) {
    it.effect(`preserves website challenge coverage: ${coverage}`, () =>
      Effect.gen(function*() {
        const calls: Array<{ method: string; params: unknown }> = []
        const wrote = yield* Deferred.make<void>()
        const mock = {
          ...session,
          send: (command: { method: string; params: unknown }) =>
            Effect.andThen(
              Effect.sync(() => calls.push({ method: command.method, params: command.params })),
              Deferred.succeed(wrote, undefined)
            )
        } as unknown as ProtocolClient.Session
        const { state, page, target: original } = yield* withPage(mock)
        const target = {
          ...original,
          page: {
            ...page,
            context: {
              ...page.context,
              proxy: {
                server: "proxy.test:8080",
                bypass: [],
                credentials: { username: "proxy-user", password: Redacted.make("fixture-password") }
              }
            }
          }
        }
        if (coverage !== "none") {
          state.registry.add(
            { _tag: "Page", page: page.id },
            coverage === "document policy"
              ? { _tag: "Challenges" }
              : { _tag: "Intercept", patterns: ["*"], phases: [coverage === "auth route" ? "auth" : "request"] },
            state.ids.registration()
          )
        }
        const handlers = Obligations.register(Kit.handlers<State.Event>())
        handlers.apply("Fetch.authRequired", {
          requestId: "F1",
          frameId: "T1",
          resourceType: coverage === "document policy" ? "Document" : "Fetch",
          request: sent(`${origin}/auth`).request,
          authChallenge: { source: "Server", origin, scheme: "basic", realm: "website" }
        }, { state, target })
        assert.strictEqual(state.obligations.size, coverage === "none" ? 0 : 1)
        yield* state.buffer.flush
        if (coverage === "none") {
          yield* Deferred.await(wrote)
          assert.deepStrictEqual(calls, [{
            method: "Fetch.continueWithAuth",
            params: { requestId: "F1", authChallengeResponse: { response: "Default" } }
          }])
        } else assert.deepStrictEqual(calls, [])
      }))
  }
})

for (const terminal of ["Network.loadingFinished", "Network.loadingFailed"]) {
  it.effect(`cleans up a worker's proxy authentication attempt on ${terminal}`, () =>
    Effect.gen(function*() {
      const { state, page, target } = yield* withPage()
      page.context.proxy = {
        server: "proxy.test:8080",
        bypass: [],
        credentials: { username: "proxy-user", password: Redacted.make("fixture-password") }
      }
      const worker: State.TargetEntry = { ...target, kind: "worker", page: undefined }
      state.workerContexts.set(worker, page.context)
      const handlers = Obligations.register(Network.register(Kit.handlers<State.Event>()))
      const request = sent(`${origin}/worker`).request
      handlers.apply("Fetch.requestPaused", {
        requestId: "F1",
        networkId: "R1",
        frameId: "T1",
        resourceType: "Fetch",
        request
      }, { state, target: worker })
      handlers.apply("Fetch.authRequired", {
        requestId: "F1",
        frameId: "T1",
        resourceType: "Fetch",
        request,
        authChallenge: { source: "Proxy", origin: "http://proxy.test:8080", scheme: "basic", realm: "proxy" }
      }, { state, target: worker })
      assert.strictEqual(worker.proxyAuth?.size, 1)
      handlers.apply(terminal, { requestId: "R1", encodedDataLength: 0, errorText: "canceled" }, {
        state,
        target: worker
      })
      assert.strictEqual(worker.proxyAuth?.size, 0)
      yield* state.buffer.flush
    }))
}

describe("CdpAdapter navigation-interrupted evaluation", () => {
  for (const outcome of ["retired", "closed", "deadline", "unrelated"] as const) {
    it.effect(`waits for lifecycle confirmation without replay (${outcome})`, () =>
      Effect.gen(function*() {
        const rejected = yield* Deferred.make<void>()
        const reply = yield* Deferred.make<void>()
        let calls = 0
        const error = new Protocol.ProtocolError({
          reason: new Protocol.Rejected({
            method: "Runtime.callFunctionOn",
            reason: "Unrecognized",
            code: -32000,
            description: outcome === "unrelated" ? "Something else failed" : "Inspected target navigated or closed"
          })
        })
        const mock = {
          ...session,
          send: Effect.fnUntraced(function*() {
            calls++
            yield* Deferred.await(reply)
            yield* Deferred.succeed(rejected, undefined)
            return yield* Effect.fail(error)
          })
        } as unknown as ProtocolClient.Session
        const { state, target, page } = yield* withPage(mock)
        const frame = state.frames.get("T1")!
        const document = Tree.commit(
          state,
          frame,
          {
            loaderId: "initial",
            url: "about:blank",
            origin: "://"
          },
          () => ({ _tag: "InitialBlank" }),
          undefined,
          "test"
        )
        const realm = Tree.addRealm(state, {
          uniqueId: "interrupted",
          contextId: 1,
          target,
          frame,
          world: { _tag: "Main" },
          origin: "://"
        })
        document.realms.add(realm)
        const at = yield* BrowserClock.after(100)
        // The call may have mutated the page before its reply was cut off. It must run exactly once.
        const waiting = yield* Evaluation.evaluate(state, realm.id, {
          functionDeclaration: "() => { globalThis.applied = true; return new Promise(() => {}) }",
          arguments: [],
          awaitPromise: true,
          result: "value",
          userActivation: false
        }).pipe(
          Effect.provideService(ProtocolClient.CommandDeadline, Option.some(at)),
          Effect.flip,
          Effect.forkChild
        )
        yield* TestClock.adjust("40 millis")
        yield* Deferred.succeed(reply, undefined)
        yield* Deferred.await(rejected)
        yield* TestClock.adjust("0 millis")
        if (outcome === "unrelated") {
          const result = yield* Fiber.join(waiting)
          assert.strictEqual(result.reason._tag, "Protocol")
          assert.strictEqual(calls, 1)
          return
        }
        assert.isUndefined(waiting.pollUnsafe(), "rejection alone must not claim the realm ended")
        yield* TestClock.adjust("59 millis")
        assert.isUndefined(waiting.pollUnsafe())
        if (outcome === "deadline") {
          yield* TestClock.adjust("1 millis")
          const result = yield* Fiber.join(waiting)
          assert.strictEqual(result.reason._tag, "Protocol")
          if (result.reason._tag === "Protocol") assert.strictEqual(result.reason.error.reason._tag, "NoReply")
          // A later lifecycle event cannot restart an expired evaluation.
          Tree.removeRealm(state, realm, new Target.RealmDestroyed({}))
        } else if (outcome === "closed") {
          Tree.endPage(state, page, new Target.PageClosed({ by: "command" }), "test closure")
        } else {
          Tree.removeRealm(state, realm, new Target.RealmDestroyed({}))
        }
        yield* state.buffer.flush
        if (outcome !== "deadline") {
          const result = yield* Fiber.join(waiting)
          assert.strictEqual(result.reason._tag, "Gone")
          if (result.reason._tag === "Gone") {
            assert.deepStrictEqual(result.reason.target, { _tag: "Realm", id: realm.id })
          }
        }
        assert.strictEqual(calls, 1)
      }).pipe(
        Effect.scoped,
        Effect.provideServiceEffect(
          BrowserClock.CurrentClock,
          Effect.map(Effect.service(Clock.Clock), BrowserClock.fromClock)
        )
      ))
  }
})

describe("CdpAdapter transient evaluation results", () => {
  for (const releaseResult of [false, true]) {
    for (const thrown of [false, true]) {
      it.effect(`releases incidental result ids only when requested (${releaseResult}, thrown=${thrown})`, () =>
        Effect.gen(function*() {
          const released: Array<string> = []
          const mock = {
            ...session,
            send: (command: { readonly method: string; readonly params: { readonly objectId?: string } }) => {
              if (command.method === "Runtime.releaseObject") {
                released.push(command.params.objectId!)
                return Effect.succeed({})
              }
              assert.strictEqual(command.method, "Runtime.callFunctionOn")
              return Effect.succeed({
                result: { type: "object", objectId: "array", deepSerializedValue: { type: "array", value: [] } },
                ...(thrown
                  ? { exceptionDetails: { text: "failed", exception: { type: "object", objectId: "exception" } } }
                  : {})
              })
            }
          } as unknown as ProtocolClient.Session
          const { state, target } = yield* withPage(mock)
          const realm = Tree.addRealm(state, {
            uniqueId: "transient",
            contextId: 1,
            target,
            frame: undefined,
            world: { _tag: "Main" },
            origin: "http://127.0.0.1:8000"
          })
          const result = yield* Evaluation.evaluate(state, realm.id, {
            functionDeclaration: "() => []",
            arguments: [],
            awaitPromise: true,
            result: "value",
            userActivation: false,
            releaseResult
          })
          assert.strictEqual(result._tag, thrown ? "Exception" : "Value")
          assert.deepStrictEqual(released, releaseResult ? thrown ? ["array", "exception"] : ["array"] : [])
          assert.strictEqual(state.handles.size, 0)
        }).pipe(Effect.scoped))
    }
  }
})

describe("CdpAdapter node arguments under interruption", () => {
  it.effect("releases the nodes it resolved when the call is interrupted before dispatch", () =>
    Effect.gen(function*() {
      const released: Array<string> = []
      const resolving = yield* Deferred.make<void>()
      const mock = {
        ...session,
        send: (
          command: {
            readonly method: string
            readonly params: { readonly backendNodeId?: number; readonly objectId?: string }
          }
        ) => {
          if (command.method === "Runtime.releaseObject") {
            released.push(command.params.objectId!)
            return Effect.succeed({})
          }
          assert.strictEqual(command.method, "DOM.resolveNode")
          // The first two nodes resolve; the third never answers, as when a deadline ends the call on its way
          return command.params.backendNodeId === 3
            ? Effect.andThen(Deferred.succeed(resolving, undefined), Effect.never)
            : Effect.succeed({ object: { type: "object", objectId: `node-${command.params.backendNodeId}` } })
        }
      } as unknown as ProtocolClient.Session
      const { state, target } = yield* withPage(mock)
      const realm = Tree.addRealm(state, {
        uniqueId: "nodes",
        contextId: 1,
        target,
        frame: undefined,
        world: { _tag: "Main" },
        origin: "http://127.0.0.1:8000"
      })
      const node = (binding: string): Adapter.LocalValue => ({
        _tag: "Node",
        node: { document: "document" as never, binding }
      })
      const fiber = yield* Evaluation.evaluate(state, realm.id, {
        functionDeclaration: "(...nodes) => nodes.length",
        arguments: [node("1"), node("2"), node("3")],
        awaitPromise: true,
        result: "value",
        userActivation: false,
        releaseResult: true
      }).pipe(Effect.forkChild)
      yield* Deferred.await(resolving)
      yield* Fiber.interrupt(fiber)
      assert.deepStrictEqual(released.sort(), ["node-1", "node-2"])
    }).pipe(Effect.scoped))
})

it.effect("releases a callback reply lost to interruption during node cleanup", () =>
  Effect.gen(function*() {
    const cleaning = yield* Deferred.make<void>()
    const finishCleanup = yield* Deferred.make<void>()
    const released: Array<string> = []
    const mock = {
      ...session,
      send: (command: { method: string; params: { objectId?: string } }) => {
        if (command.method === "DOM.resolveNode") {
          return Effect.succeed({ object: { type: "object", objectId: "node" } })
        }
        if (command.method === "Runtime.callFunctionOn") {
          return Effect.succeed({
            result: { type: "object", objectId: "result", deepSerializedValue: { type: "array", value: [] } }
          })
        }
        assert.strictEqual(command.method, "Runtime.releaseObject")
        return Effect.gen(function*() {
          if (command.params.objectId === "node") {
            yield* Deferred.succeed(cleaning, undefined)
            yield* Deferred.await(finishCleanup)
          }
          released.push(command.params.objectId!)
          return {}
        })
      }
    } as unknown as ProtocolClient.Session
    const { state, target } = yield* withPage(mock)
    const realm = Tree.addRealm(state, {
      uniqueId: "reply",
      contextId: 1,
      target,
      frame: undefined,
      world: { _tag: "Main" },
      origin: "http://127.0.0.1"
    })
    const waiting = yield* Evaluation.evaluate(state, realm.id, {
      functionDeclaration: "() => []",
      arguments: [{ _tag: "Node", node: { document: "document" as never, binding: "1" } }],
      awaitPromise: true,
      result: "value",
      releaseResult: true,
      userActivation: false
    }).pipe(Effect.forkChild)
    yield* Deferred.await(cleaning)
    const interrupting = yield* Fiber.interrupt(waiting).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Deferred.succeed(finishCleanup, undefined)
    yield* Fiber.join(interrupting)
    assert.deepStrictEqual(released.sort(), ["node", "result"])
  }).pipe(Effect.scoped))

for (const command of ["resolve", "callback"] as const) {
  it.effect(`releases late ${command} objects after interruption while the browser reply is pending`, () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire)
      const { state, target } = yield* withPage(client.root)
      const realm = Tree.addRealm(state, {
        uniqueId: "pending",
        contextId: 1,
        target,
        frame: undefined,
        world: { _tag: "Main" },
        origin: "http://127.0.0.1"
      })
      const waiting = yield* Evaluation.evaluate(state, realm.id, {
        functionDeclaration: "async () => await new Promise(() => {})",
        arguments: command === "resolve"
          ? [{ _tag: "Node", node: { document: "document" as never, binding: "1" } }]
          : [],
        awaitPromise: true,
        result: "value",
        releaseResult: true,
        userActivation: false
      }).pipe(Effect.forkChild)
      const sent = yield* browser.next
      assert.strictEqual(sent.method, command === "resolve" ? "DOM.resolveNode" : "Runtime.callFunctionOn")
      // No reply exists yet: interrupt must finish without waiting for the page's promise.
      yield* Fiber.interrupt(waiting)
      assert.strictEqual(yield* browser.pending, 0)
      // The page finishes later. Cleanup must be triggered by these newly-created ids, not an earlier group release.
      yield* browser.receive({
        id: sent.id,
        result: command === "resolve"
          ? { object: { type: "object", objectId: "late-node" } }
          : {
            result: { type: "object", objectId: "late-result" },
            exceptionDetails: { text: "late", exception: { type: "object", objectId: "late-exception" } }
          }
      })
      const first = yield* browser.next
      assert.strictEqual(first.method, "Runtime.releaseObject")
      assert.strictEqual(first.params?.objectId, command === "resolve" ? "late-node" : "late-result")
      yield* browser.receive({ id: first.id, result: {} })
      if (command === "callback") {
        const second = yield* browser.next
        assert.strictEqual(second.method, "Runtime.releaseObject")
        assert.strictEqual(second.params?.objectId, "late-exception")
        yield* browser.receive({ id: second.id, result: {} })
      }
      yield* browser.delivered
      assert.strictEqual(state.handles.size, 0)
    }).pipe(Effect.scoped))
}

for (const failure of ["resolution", "conversion", "dispatch"] as const) {
  it.effect(`cleans acquired node ids outside the command deadline on ${failure} failure`, () =>
    Effect.gen(function*() {
      const released: Array<string> = []
      const mock = {
        ...session,
        send: (command: { method: string; params: { backendNodeId?: number; objectId?: string } }) => {
          if (command.method === "Runtime.releaseObject") {
            return Effect.gen(function*() {
              assert(Option.isNone(yield* ProtocolClient.CommandDeadline))
              assert(Option.isNone(yield* Operation.current))
              released.push(command.params.objectId!)
              return {}
            })
          }
          if (command.method === "DOM.resolveNode" && command.params.backendNodeId === 1) {
            return Effect.succeed({ object: { type: "object", objectId: "acquired" } })
          }
          assert.strictEqual(command.method, failure === "resolution" ? "DOM.resolveNode" : "Runtime.callFunctionOn")
          return Effect.fail(
            new Protocol.ProtocolError({
              reason: new Protocol.Rejected({
                method: command.method,
                reason: "Unrecognized",
                code: -32000,
                description: "failed"
              })
            })
          )
        }
      } as unknown as ProtocolClient.Session
      const { state, target } = yield* withPage(mock)
      const realm = Tree.addRealm(state, {
        uniqueId: "failure",
        contextId: 1,
        target,
        frame: undefined,
        world: { _tag: "Main" },
        origin: "http://127.0.0.1"
      })
      const node = (binding: string): Adapter.LocalValue => ({
        _tag: "Node",
        node: { document: "document" as never, binding }
      })
      const extra: Array<Adapter.LocalValue> = failure === "resolution"
        ? [node("2")]
        : failure === "conversion"
        ? [{ _tag: "Handle", handle: "missing" as Adapter.HandleId }]
        : []
      yield* Evaluation.evaluate(state, realm.id, {
        functionDeclaration: "() => []",
        arguments: [node("1"), ...extra],
        awaitPromise: true,
        result: "value",
        releaseResult: true,
        userActivation: false
      }).pipe(
        Operation.named("test.evaluation"),
        Effect.provideService(ProtocolClient.CommandDeadline, Option.some(BrowserClock.live.now())),
        Effect.flip
      )
      assert.deepStrictEqual(released, ["acquired"])
    }).pipe(Effect.scoped))
}

it.effect("interruption doesn't wait for a busy page to acknowledge node releases", () =>
  Effect.gen(function*() {
    const browser = yield* makeBrowser
    const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire)
    const { state, target } = yield* withPage(client.root)
    const realm = Tree.addRealm(state, {
      uniqueId: "busy",
      contextId: 1,
      target,
      frame: undefined,
      world: { _tag: "Main" },
      origin: "http://127.0.0.1"
    })
    const waiting = yield* Evaluation.evaluate(state, realm.id, {
      functionDeclaration: "(node) => { while (true) {} }",
      arguments: [{ _tag: "Node", node: { document: "document" as never, binding: "1" } }],
      awaitPromise: true,
      result: "value",
      releaseResult: true,
      userActivation: false
    }).pipe(Effect.forkChild)
    const resolve = yield* browser.next
    assert.strictEqual(resolve.method, "DOM.resolveNode")
    yield* browser.receive({ id: resolve.id, result: { object: { type: "object", objectId: "node" } } })
    const callback = yield* browser.next
    assert.strictEqual(callback.method, "Runtime.callFunctionOn")
    // The callback never returns, so the page's main thread answers nothing more, including the release below.
    const interrupting = yield* Fiber.interrupt(waiting).pipe(Effect.forkChild)
    const release = yield* browser.next
    assert.strictEqual(release.method, "Runtime.releaseObject")
    for (let i = 0; i < 100; i++) yield* Effect.yieldNow
    assert.isDefined(interrupting.pollUnsafe(), "interrupting the caller waited for the busy page's release reply")
  }).pipe(Effect.scoped))

for (const finish of ["reply", "shutdown", "success", "shutdown-success"] as const) {
  it.effect(`evaluation cleanup waits and remains owned on ${finish}`, () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire)
      const owner = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(owner, Exit.void))
      const { state, target } = yield* withPage(client.root)
      const realm = Tree.addRealm(state, {
        uniqueId: "owned-cleanup",
        contextId: 1,
        target,
        frame: undefined,
        world: { _tag: "Main" },
        origin: "http://127.0.0.1"
      })
      const node = (binding: string): Adapter.LocalValue => ({
        _tag: "Node",
        node: { document: "document" as never, binding }
      })
      const waiting = yield* Evaluation.evaluate({ ...state, cleanupScope: owner }, realm.id, {
        functionDeclaration: "() => []",
        arguments: [node("1"), node("2")],
        awaitPromise: true,
        result: "value",
        releaseResult: true,
        userActivation: false
      }).pipe(Effect.forkChild)
      for (const id of ["node-1", "node-2"]) {
        const resolving = yield* browser.next
        assert.strictEqual(resolving.method, "DOM.resolveNode")
        yield* browser.receive({ id: resolving.id, result: { object: { type: "object", objectId: id } } })
      }
      const callback = yield* browser.next
      yield* browser.receive({
        id: callback.id,
        result: {
          result: { type: "object", objectId: "result", deepSerializedValue: { type: "array", value: [] } },
          exceptionDetails: {
            exceptionId: 1,
            text: "failed",
            lineNumber: 0,
            columnNumber: 0,
            exception: { type: "object", objectId: "exception" }
          }
        }
      })
      const first = yield* browser.next
      assert.strictEqual(first.method, "Runtime.releaseObject")
      assert.strictEqual(first.params?.objectId, "node-1")
      assert.isUndefined(waiting.pollUnsafe(), "successful completion must still wait for its cleanup")
      if (finish === "reply" || finish === "shutdown") {
        const interrupting = yield* Fiber.interrupt(waiting).pipe(Effect.forkChild)
        for (let i = 0; i < 100; i++) yield* Effect.yieldNow
        assert.isDefined(interrupting.pollUnsafe(), "caller interruption must not wait for a release acknowledgment")
      }
      if (finish === "reply" || finish === "success") {
        // Resuming the page drains every id already owned before interruption, including the received result.
        yield* browser.receive({ id: first.id, result: {} })
        for (const id of ["node-2", "result", "exception"]) {
          const release = yield* browser.next
          assert.strictEqual(release.method, "Runtime.releaseObject")
          assert.strictEqual(release.params?.objectId, id)
          yield* browser.receive({ id: release.id, result: {} })
        }
        yield* browser.delivered
        assert.strictEqual(yield* browser.pending, 0)
        if (finish === "success") assert.strictEqual((yield* Fiber.join(waiting))._tag, "Exception")
        yield* Scope.close(owner, Exit.void)
      } else {
        const closing = yield* Scope.close(owner, Exit.void).pipe(Effect.forkChild)
        for (let i = 0; i < 100; i++) yield* Effect.yieldNow
        assert.isDefined(closing.pollUnsafe(), "shutdown must interrupt an unanswered cleanup request")
        if (finish === "shutdown-success") {
          for (let i = 0; i < 100; i++) yield* Effect.yieldNow
          assert.isDefined(waiting.pollUnsafe(), "closing the cleanup owner must end a successful caller's wait")
          assert.strictEqual((yield* Fiber.join(waiting))._tag, "Exception")
        }
        // An acknowledgment after shutdown cannot restart cleanup in an unowned fiber.
        yield* browser.receive({ id: first.id, result: {} })
        yield* browser.delivered
        assert.strictEqual(yield* browser.pending, 0)
      }
    }).pipe(Effect.scoped))
}

it.effect("does not register evaluation cleanup in the connection scope when it owns no ids", () =>
  Effect.gen(function*() {
    const owner = yield* Scope.make()
    const { state, target } = yield* withPage(
      {
        ...session,
        send: () => Effect.succeed({ result: { type: "number", value: 1 } })
      } as unknown as ProtocolClient.Session
    )
    const realm = Tree.addRealm(state, {
      uniqueId: "no-objects",
      contextId: 1,
      target,
      frame: undefined,
      world: { _tag: "Main" },
      origin: "http://127.0.0.1"
    })
    const result = yield* Evaluation.evaluate({ ...state, cleanupScope: owner }, realm.id, {
      functionDeclaration: "() => 1",
      arguments: [],
      awaitPromise: true,
      result: "value",
      userActivation: false
    })
    assert.deepStrictEqual(result, { _tag: "Value", value: { type: "number", value: 1 } })
    assert.strictEqual(owner.state._tag, "Empty")
    yield* Scope.close(owner, Exit.void)
  }).pipe(Effect.scoped))
