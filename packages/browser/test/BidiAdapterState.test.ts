/**
 * The BiDi adapter's state, without a browser: an operation that names a page, document or realm of its own that
 * ended gets `Gone`, never `Foreign`; a handle it doesn't hold fails as `Gone` rather than being sent empty; and
 * base64 the browser sent that doesn't decode fails rather than giving empty bytes.
 */
import { assert, describe, it } from "@effect/vitest"
import { Browser, WebSocketRoute } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Headers from "effect/http/Headers"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import type * as BrowsingContext from "../src/bidi-protocol/BrowsingContext.ts"
import * as Script from "../src/bidi-protocol/Script.ts"
import * as Deadline from "../src/Deadline.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Capture from "../src/internal/bidiAdapter/capture.ts"
import * as Contexts from "../src/internal/bidiAdapter/contexts.ts"
import * as Declare from "../src/internal/bidiAdapter/declare.ts"
import * as Evaluation from "../src/internal/bidiAdapter/evaluation.ts"
import * as Navigation from "../src/internal/bidiAdapter/navigation.ts"
import * as Network from "../src/internal/bidiAdapter/network.ts"
import * as Obligations from "../src/internal/bidiAdapter/obligations.ts"
import * as State from "../src/internal/bidiAdapter/state.ts"
import * as Tree from "../src/internal/bidiAdapter/tree.ts"
import * as BidiWire from "../src/internal/bidiWire.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Fold from "../src/internal/fold.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import type * as MonotonicInstant from "../src/MonotonicInstant.ts"
import * as Request from "../src/NetworkRequest.ts"
import type * as PageNavigation from "../src/PageNavigation.ts"
import * as Protocol from "../src/protocol/Protocol.ts"
import * as Target from "../src/Target.ts"
import { makeBrowser } from "./utils/FakeBrowser.ts"
import { harness as webSocketHarness } from "./utils/WebSocketHostHarness.ts"

const control: ProtocolClient.FoldControl = {
  sync: () => {},
  session: () => undefined,
  run: (effect) => effect
}

/** A session that answers each command from `replies`, by method, and records what was sent. */
const session = (
  replies: Readonly<Record<string, unknown>>,
  failures: Readonly<Record<string, () => Protocol.ProtocolError>> = {}
) => {
  const sent: Array<string> = []
  const commands: Array<{ readonly method: string; readonly params: unknown }> = []
  const root = {
    key: undefined,
    send: (command: Protocol.Command<string, unknown, unknown>) =>
      Effect.suspend(() => {
        sent.push(command.method)
        commands.push(command)
        const failure = failures[command.method]
        const reply = replies[command.method]
        return failure === undefined
          ? Effect.isEffect(reply) ? reply : Effect.succeed(reply)
          : Effect.fail(failure())
      }),
    drainObserved: Effect.void
  } as unknown as ProtocolClient.Session
  return { root, sent, commands }
}

/** A state with one page in the default context, its document, and the document's main realm. */
const withPage = Effect.fnUntraced(function*(
  replies: Readonly<Record<string, unknown>> = {},
  failures: Readonly<Record<string, () => Protocol.ProtocolError>> = {},
  protocolRoot?: ProtocolClient.Session
) {
  const facts: Array<Adapter.Fact> = []
  const buffer = yield* Kit.makeFactBuffer((fact) => Effect.sync(() => void facts.push(fact)))
  buffer.connect(control)
  const { root, sent, commands } = session(replies, failures)
  const state = State.make({
    cleanupScope: yield* Effect.scope,
    connect: { sink: () => Effect.void, ownership: "launched" },
    ids: Kit.makeIds(),
    buffer,
    control,
    root: () => protocolRoot ?? root
  })
  const page = Tree.addNavigable(state, {
    context: "C1" as BrowsingContext.BrowsingContext,
    userContext: "default",
    originalOpener: null,
    url: "about:blank"
  }, false)!
  const document = page.document!
  const realm: State.RealmEntry = {
    id: state.ids.realm(),
    bidi: "R1" as Script.Realm,
    navigable: page,
    world: { _tag: "Main" },
    origin: "null",
    ended: false,
    pending: false,
    held: []
  }
  state.realms.set(realm.bidi, realm)
  state.realmsById.set(realm.id, realm)
  Tree.addWindowRealm(state, realm, document)
  return { state, page, document, realm, sent, facts, commands }
})

/** Attribution may arrive with the outcome, or separately when the outcome was already published. */
const errorNavigation = (
  facts: ReadonlyArray<Adapter.Fact>,
  document: Extract<Adapter.Fact, { _tag: "DocumentCommitted" }>
) => {
  if (document.createdBy._tag === "ErrorPage") return document.createdBy.navigation
  assert.deepStrictEqual(document.createdBy, { _tag: "UnattributedErrorPage" })
  for (const fact of facts) {
    if (fact._tag === "ErrorDocumentAttributed" && fact.document === document.document) return fact.navigation
    if (
      fact._tag === "NavigationEnded" && fact.outcome._tag === "Failed" &&
      Option.isSome(fact.outcome.errorDocument) && fact.outcome.errorDocument.value === document.document
    ) return fact.navigation
  }
  return undefined
}

describe("BidiAdapter state", () => {
  it.effect("keeps the active document usable after prospective realms are destroyed without commit", () =>
    Effect.gen(function*() {
      const { document, page, realm, state } = yield* withPage({
        "script.evaluate": { type: "success", realm: "active-tools", result: { type: "number", value: 0 } }
      })
      const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
      const created = (id: string, sandbox?: string) =>
        handlers.apply("script.realmCreated", {
          realm: id,
          context: page.bidi,
          type: "window",
          origin: "null",
          sandbox
        }, { state })
      const navigation = { context: page.bidi, navigation: "aborted", url: "http://next.example/", timestamp: 1 }
      handlers.apply("browsingContext.navigationStarted", navigation, { state })
      // A lifecycle boundary probe, not a replay of the recorded navigation.
      created("prospective-main")
      created("prospective-tools", "tools")
      handlers.apply("script.realmDestroyed", { realm: "prospective-main" }, { state })
      handlers.apply("script.realmDestroyed", { realm: "prospective-tools" }, { state })
      handlers.apply("browsingContext.navigationAborted", navigation, { state })
      created("active-tools", "tools")
      yield* state.buffer.flush
      assert.strictEqual(page.document, document)
      assert.isEmpty(page.pendingRealms)
      assert.strictEqual(yield* Evaluation.realm(state, document.id, { _tag: "Main" }), realm.id)
      assert.strictEqual(
        yield* Evaluation.realm(state, document.id, { _tag: "Isolated", name: "tools" }),
        state.realms.get("active-tools")!.id
      )
    }))

  it.effect("closing a replaced page preserves another page's current and pending realms", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage()
      const sibling = Tree.addNavigable(state, {
        context: "sibling" as BrowsingContext.BrowsingContext,
        userContext: "default",
        originalOpener: page.bidi,
        url: "about:blank"
      }, false)!
      const handlers = Evaluation.register(Kit.handlers<State.Event>())
      for (
        const [context, realm] of [
          [page.bidi, "replacement"],
          [sibling.bidi, "sibling-main"],
          [sibling.bidi, "sibling-pending"]
        ]
      ) {
        handlers.apply("script.realmCreated", { context, realm, type: "window", origin: "null" }, { state })
      }
      Tree.commit(state, page, "http://next.example/", "http://next.example", { _tag: "InitialBlank" }, "next", "test")
      Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
      yield* state.buffer.flush
      assert.deepStrictEqual([...state.realms.keys()], ["sibling-main", "sibling-pending"])
      assert.isFalse(state.realms.get("sibling-pending")!.ended)
      assert.strictEqual(
        yield* Evaluation.realm(state, sibling.document!.id, { _tag: "Main" }),
        state.realms.get("sibling-main")!.id
      )
      assert.strictEqual(sibling.pendingRealms[0], state.realms.get("sibling-pending"))
    }))

  it.effect("selects the destination main realm when the initial realm survives past commit", () =>
    Effect.gen(function*() {
      const url = "http://127.0.0.1:50796/cookie"
      const { page, realm: initial, state } = yield* withPage({
        "browsingContext.navigate": { navigation: "N1", url }
      })
      const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
      yield* Navigation.navigate(state, page.id, url, { referrer: Option.none() })
      const navigation = { context: page.bidi, navigation: "N1", url, timestamp: 0 }
      handlers.apply("browsingContext.navigationStarted", navigation, { state })
      // Captured Firefox 158 macOS ordering: a transient null-origin realm is replaced before
      // commit, while the original about:blank realm is not destroyed until after evaluation.
      handlers.apply("script.realmCreated", {
        realm: "transient",
        context: page.bidi,
        type: "window",
        origin: "null"
      }, { state })
      handlers.apply("script.realmDestroyed", { realm: "transient" }, { state })
      handlers.apply("script.realmCreated", {
        realm: "destination",
        context: page.bidi,
        type: "window",
        origin: "http://127.0.0.1:50796"
      }, { state })
      handlers.apply("browsingContext.navigationCommitted", navigation, { state })
      yield* state.buffer.flush
      assert.isFalse(initial.ended)
      const selected = yield* Evaluation.realm(state, page.document!.id, { _tag: "Main" })
      assert.strictEqual(selected, state.realms.get("destination")!.id)
    }))

  it.effect("publishes only replacement realms at commit, including pending isolated worlds", () =>
    Effect.gen(function*() {
      const { facts, page, realm: initial, state } = yield* withPage()
      const handlers = Evaluation.register(Kit.handlers<State.Event>())
      const created = (realm: string, sandbox?: string) =>
        handlers.apply("script.realmCreated", {
          realm,
          context: page.bidi,
          type: "window",
          origin: "http://next.example",
          sandbox
        }, { state })
      created("old-isolated", "tools")
      const oldIsolated = state.realms.get("old-isolated")!
      // A duplicate sandbox can precede the replacement main realm; a new sandbox can follow it.
      created("next-isolated", "tools")
      created("next-main")
      created("next-extra", "extra")
      yield* state.buffer.flush
      assert.isFalse(facts.some((fact) =>
        fact._tag === "RealmAdded" &&
        fact.realm === state.realms.get("next-isolated")!.id
      ))
      const document = Tree.commit(
        state,
        page,
        "http://next.example/",
        "http://next.example",
        { _tag: "InitialBlank" },
        "next",
        "test"
      )
      yield* state.buffer.flush
      assert.deepStrictEqual([...document.realms].map((realm) => realm.bidi), [
        "next-isolated",
        "next-main",
        "next-extra"
      ])
      assert.isFalse(facts.some((fact) => fact._tag === "RealmDocumentAdded" && fact.document === document.id))
      assert.strictEqual(
        yield* Evaluation.realm(state, document.id, { _tag: "Isolated", name: "tools" }),
        state.realms.get("next-isolated")!.id
      )
      handlers.apply("script.realmDestroyed", { realm: initial.bidi }, { state })
      handlers.apply("script.realmDestroyed", { realm: oldIsolated.bidi }, { state })
      assert.strictEqual(document.realms.size, 3)
    }))

  it.effect("uses sandbox replacement evidence when the main realm arrives after commit", () =>
    Effect.gen(function*() {
      const { facts, page, realm: initial, state } = yield* withPage()
      const handlers = Evaluation.register(Kit.handlers<State.Event>())
      const created = (realm: string, sandbox?: string) =>
        handlers.apply("script.realmCreated", {
          realm,
          context: page.bidi,
          type: "window",
          origin: "http://next.example",
          sandbox
        }, { state })
      created("old-tools", "tools")
      created("new-tools", "tools")
      const document = Tree.commit(
        state,
        page,
        "http://next.example/",
        "http://next.example",
        { _tag: "InitialBlank" },
        "next",
        "test"
      )
      created("late-main")
      yield* state.buffer.flush
      assert.isFalse(initial.ended)
      assert.deepStrictEqual([...document.realms].map((realm) => realm.bidi), ["new-tools", "late-main"])
      assert.strictEqual(
        yield* Evaluation.realm(state, document.id, { _tag: "Main" }),
        state.realms.get("late-main")!.id
      )
      assert.isEmpty(page.pendingRealms)
      assert.isFalse(facts.some((fact) => fact._tag === "RealmDocumentAdded" && fact.document === document.id))
    }))

  it.effect("releases delayed old-document realms when their page closes", () =>
    Effect.gen(function*() {
      const { page, realm, state } = yield* withPage()
      const handlers = Evaluation.register(Kit.handlers<State.Event>())
      handlers.apply("script.realmCreated", {
        realm: "next",
        context: page.bidi,
        type: "window",
        origin: "http://next.example"
      }, { state })
      Tree.commit(state, page, "http://next.example/", "http://next.example", { _tag: "InitialBlank" }, "next", "test")
      Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
      assert.isTrue(realm.ended)
      assert.isEmpty([...state.realms.values()])
    }))

  it.effect("transfers genuinely reused realms and reports their new document", () =>
    Effect.gen(function*() {
      const { facts, page, realm, state } = yield* withPage()
      const document = Tree.commit(state, page, "about:blank", "null", { _tag: "InitialBlank" }, "next", "test")
      yield* state.buffer.flush
      assert.deepStrictEqual([...document.realms], [realm])
      assert.deepStrictEqual(facts.filter((fact) => fact._tag === "RealmDocumentAdded"), [
        { _tag: "RealmDocumentAdded", realm: realm.id, document: document.id }
      ])
      assert.strictEqual(yield* Evaluation.realm(state, document.id, { _tag: "Main" }), realm.id)
    }))

  it.effect("publishes a late main realm directly when no realm survived commit", () =>
    Effect.gen(function*() {
      const { facts, page, realm, state } = yield* withPage()
      const handlers = Evaluation.register(Kit.handlers<State.Event>())
      handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
      const document = Tree.commit(
        state,
        page,
        "http://next.example/",
        "http://next.example",
        { _tag: "InitialBlank" },
        "next",
        "test"
      )
      handlers.apply("script.realmCreated", {
        realm: "late",
        context: page.bidi,
        type: "window",
        origin: "http://next.example"
      }, { state })
      yield* state.buffer.flush
      assert.strictEqual(yield* Evaluation.realm(state, document.id, { _tag: "Main" }), state.realms.get("late")!.id)
      assert.isEmpty(page.pendingRealms)
      assert.isTrue(facts.some((fact) =>
        fact._tag === "RealmAdded" && fact.realm === state.realms.get("late")!.id &&
        fact.kind._tag === "Window" && fact.kind.document === document.id
      ))
    }))

  for (
    const boundary of [
      "event-before-reply",
      "reply-before-event",
      "interrupted",
      "overlap",
      "newer",
      "url",
      "identity"
    ] as const
  ) {
    it.effect(`correlates same-document traversal with ${boundary} ownership`, () =>
      Effect.gen(function*() {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const url = "about:blank#destination"
        const { facts, page, state } = yield* withPage({
          "browsingContext.traverseHistory": Effect.andThen(
            Deferred.succeed(entered, undefined),
            Deferred.await(release)
          ),
          "browsingContext.navigate": { navigation: "exact", url }
        })
        const handlers = Navigation.register(Kit.handlers<State.Event>())
        const fiber = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
        yield* Deferred.await(entered)
        const traversal = page.expected.list[0]!.id
        let other: PageNavigation.Id | undefined
        let overlapping: Fiber.Fiber<Option.Option<PageNavigation.Id>, Adapter.AdapterError> | undefined
        if (boundary === "interrupted") yield* Fiber.interrupt(fiber)
        if (boundary === "overlap") {
          overlapping = yield* Effect.forkChild(Navigation.traverse(state, page.id, 1))
          yield* Effect.yieldNow
        }
        if (boundary === "newer" || boundary === "identity") {
          other = yield* Navigation.navigate(state, page.id, url, { referrer: Option.none() })
        }
        if (boundary === "url") other = Kit.expect(state.ids, page.expected, url)
        if (boundary === "reply-before-event") {
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(fiber)
        }
        handlers.apply(
          boundary === "identity" ? "browsingContext.fragmentNavigated" : "browsingContext.historyUpdated",
          {
            context: page.bidi,
            navigation: "exact",
            url,
            timestamp: 1
          },
          { state }
        )
        yield* Deferred.succeed(release, undefined)
        if (boundary !== "interrupted") yield* Fiber.join(fiber)
        if (overlapping !== undefined) yield* Fiber.join(overlapping)
        yield* state.buffer.flush
        const ends = facts.filter((fact) => fact._tag === "NavigationEnded")
        assert.lengthOf(ends, 1)
        const end = ends[0]!
        assert(end._tag === "NavigationEnded")
        if (boundary === "event-before-reply") {
          assert.strictEqual(end.navigation, traversal)
        } else {
          assert.notStrictEqual(end.navigation, traversal)
          if (boundary === "url" || boundary === "identity") assert.strictEqual(end.navigation, other)
        }
        assert.deepStrictEqual(end.outcome, {
          _tag: "SameDocument",
          document: page.document!.id,
          via: boundary === "identity" ? "fragment" : "historyApi"
        })
        assert.strictEqual(page.document!.url, url)
        assert.isEmpty(page.expected.list)
        assert.isUndefined(page.restoring)
        assert.isEmpty(page.traversalCommands)
      }))
  }

  for (const event of ["historyUpdated", "fragmentNavigated"] as const) {
    it.effect(`leaves a later page-initiated ${event} to the page once a traversal has replied`, () =>
      Effect.gen(function*() {
        const { facts, page, state } = yield* withPage({ "browsingContext.traverseHistory": {} })
        const handlers = Navigation.register(Kit.handlers<State.Event>())
        // Synthetic ownership boundary, not captured Firefox traffic: the traversal replies without
        // a same-document event or a new realm. An unrelated later event cannot identify that traversal.
        const traversal = yield* Navigation.traverse(state, page.id, -1)
        assert(Option.isSome(traversal))
        handlers.apply(
          `browsingContext.${event}`,
          { context: page.bidi, navigation: "later", url: "about:blank#later", timestamp: 1 },
          { state }
        )
        yield* state.buffer.flush
        const ends = facts.filter((fact) => fact._tag === "NavigationEnded")
        assert.lengthOf(ends, 1)
        assert.notStrictEqual(ends[0]!.navigation, traversal.value)
        const starts = facts.filter((fact) => fact._tag === "NavigationStarted")
        assert.lengthOf(starts, 1)
        assert(starts[0]!._tag === "NavigationStarted")
        assert.notStrictEqual(starts[0]!.initiatedAs, "traversal")
        assert.isEmpty(page.expected.list)
        assert.isUndefined(page.restoring)
      }))
  }

  it.effect("claims a same-document event received before the traversal's reply but folded after it", () =>
    Effect.gen(function*() {
      // The protocol client resolves a reply in its reader, but folds the events received before it in a
      // separate worker: the reply can wake the command first. drainObserved completes once those are folded.
      let queued: (() => void) | undefined
      const fold = () => {
        const event = queued
        queued = undefined
        event?.()
      }
      const root = {
        send: () =>
          Effect.flatMap(ProtocolClient.ReplyReceived, (received) =>
            Effect.sync(() => {
              received?.(10)
              return {}
            })),
        drainObserved: Effect.sync(fold)
      } as unknown as ProtocolClient.Session
      const { facts, page, state } = yield* withPage({}, {}, root)
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      queued = () =>
        handlers.apply(
          "browsingContext.historyUpdated",
          { context: page.bidi, url: "about:blank#earlier", timestamp: 1 },
          { state, received: 9 }
        )
      const traversal = yield* Navigation.traverse(state, page.id, -1)
      // The worker reaches the event at last, if the command did not wait for it.
      fold()
      yield* state.buffer.flush
      assert(Option.isSome(traversal))
      const ends = facts.filter((fact) => fact._tag === "NavigationEnded")
      assert.lengthOf(ends, 1)
      assert.strictEqual(ends[0]!.navigation, traversal.value)
      assert.isEmpty(page.expected.list)
    }))

  for (const event of ["historyUpdated", "fragmentNavigated"] as const) {
    it.effect(`rejects a queued ${event} received after the traversal reply while draining`, () =>
      Effect.gen(function*() {
        const root = {
          send: () =>
            Effect.flatMap(ProtocolClient.ReplyReceived, (received) =>
              Effect.sync(() => {
                received?.(10)
                return {}
              })),
          drainObserved: Effect.sync(() => {
            handlers.apply(`browsingContext.${event}`, {
              context: page.bidi,
              navigation: "later",
              url: "about:blank#later",
              timestamp: 1
            }, { state, received: 11 })
          })
        } as unknown as ProtocolClient.Session
        const { facts, page, state } = yield* withPage({}, {}, root)
        const handlers = Navigation.register(Kit.handlers<State.Event>())
        const traversal = yield* Navigation.traverse(state, page.id, -1)
        assert(Option.isSome(traversal))
        yield* state.buffer.flush
        const ends = facts.filter((fact) => fact._tag === "NavigationEnded")
        assert.lengthOf(ends, 1)
        assert.notStrictEqual(ends[0]!.navigation, traversal.value)
        assert.isEmpty(page.expected.list)
        assert.isEmpty(page.traversalCommands)
      }))
  }

  it.effect("drains a real client observation queued before the traversal reply", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      let state: State.State
      const client = yield* ProtocolClient.make(browser.transport, BidiWire.wire, {
        fold: () => ({
          events: handlers.events,
          apply: Effect.fnUntraced(function*(_session, method, params, received) {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            handlers.apply(method, params, { state, received })
          }),
          lost: () => Effect.void,
          ended: () => Effect.void
        })
      })
      const fixture = yield* withPage({}, {}, client.root)
      state = fixture.state
      const fiber = yield* Effect.forkChild(Navigation.traverse(state, fixture.page.id, -1))
      const sent = yield* browser.next
      const reserved = fixture.page.expected.list[0]!.id
      yield* browser.receive({
        type: "event",
        method: "browsingContext.historyUpdated",
        params: {
          context: fixture.page.bidi,
          url: "about:blank#earlier",
          timestamp: 1
        }
      })
      yield* Deferred.await(entered)
      yield* browser.receive({ type: "success", id: sent.id, result: {} })
      yield* browser.delivered
      assert.isUndefined(fiber.pollUnsafe(), "the command must wait for the queued observation")
      yield* Deferred.succeed(release, undefined)
      const traversal = yield* Fiber.join(fiber)
      assert.deepStrictEqual(traversal, Option.some(reserved))
      yield* state.buffer.flush
      const ends = fixture.facts.filter((fact) => fact._tag === "NavigationEnded")
      assert.lengthOf(ends, 1)
      assert.strictEqual(ends[0]!.navigation, reserved)
      assert.isEmpty(fixture.page.traversalCommands)
    }))

  for (const completion of ["interrupted drain", "rejection", "connection failure"] as const) {
    it.effect(`releases traversal ownership on ${completion}`, () =>
      Effect.gen(function*() {
        const draining = yield* Deferred.make<void>()
        let drains = 0
        const root = {
          send: () =>
            completion === "interrupted drain" ? Effect.succeed({}) : Effect.fail(
              new Protocol.ProtocolError({
                reason: completion === "rejection"
                  ? new Protocol.Rejected({
                    method: "browsingContext.traverseHistory",
                    code: "no such history entry",
                    reason: "Unrecognized",
                    description: "end"
                  })
                  : new Protocol.SessionEnded({ why: "connectionLost" })
              })
            ),
          drainObserved: Effect.gen(function*() {
            drains++
            yield* Deferred.succeed(draining, undefined)
            return yield* Effect.never
          })
        } as unknown as ProtocolClient.Session
        const { page, state } = yield* withPage({}, {}, root)
        if (completion === "interrupted drain") {
          const fiber = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
          yield* Deferred.await(draining)
          yield* Fiber.interrupt(fiber)
          assert.strictEqual(drains, 1)
        } else {
          assert(Option.isNone(yield* Navigation.traverse(state, page.id, -1)))
          assert.strictEqual(drains, 0)
        }
        assert.isEmpty(page.expected.list)
        assert.isEmpty(page.traversalCommands)
        assert.isUndefined(page.restoring)
      }))
  }

  for (const arrival of ["before", "after"] as const) {
    it.effect(`ends an unannounced traversal when its realm arrives ${arrival} the reply`, () =>
      Effect.gen(function*() {
        const url = "http://restored.example/"
        const { facts, page, realm, state } = yield* withPage({
          "browsingContext.traverseHistory": {},
          "script.evaluate": { type: "success", realm: "R2", result: { type: "string", value: url } }
        })
        const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
        // Synthetic ordering, not captured Firefox traffic: no navigationStarted or commit is sent.
        // The adapter already supports this unannounced restoration when the realm precedes the reply.
        // Keep the old realm live: restoration must not publish it in the restored document.
        const arrived = () =>
          handlers.apply("script.realmCreated", {
            realm: "R2",
            context: page.bidi,
            type: "window",
            origin: "http://restored.example"
          }, { state })
        if (arrival === "before") arrived()
        const navigation = yield* Navigation.traverse(state, page.id, -1)
        assert(Option.isSome(navigation))
        if (arrival === "after") arrived()
        yield* state.buffer.flush
        yield* state.buffer.waitFor(() =>
          facts.some((fact) => fact._tag === "NavigationEnded" && fact.navigation === navigation.value) ?
            true :
            undefined
        )
        arrived()
        yield* state.buffer.flush
        const started = facts.filter((fact) =>
          fact._tag === "NavigationStarted" && fact.navigation === navigation.value
        )
        const ended = facts.filter((fact) => fact._tag === "NavigationEnded" && fact.navigation === navigation.value)
        assert.lengthOf(started, 1, "the returned traversal must start")
        assert.lengthOf(ended, 1, "the returned traversal must end")
        assert(ended[0]!._tag === "NavigationEnded")
        assert.deepStrictEqual(ended[0]!.outcome, {
          _tag: "Committed",
          document: page.document!.id,
          response: Option.none()
        })
        assert.strictEqual(page.document!.url, url)
        assert.isFalse(realm.ended)
        assert.deepStrictEqual([...page.document!.realms].map((entry) => entry.bidi), ["R2"])
        assert.isFalse(facts.some((fact) => fact._tag === "RealmDocumentAdded" && fact.document === page.document!.id))
        assert.lengthOf(page.pendingRealms, 0)
      }))
  }

  for (const arrival of ["before", "after"] as const) {
    it.effect(`ends an announced restoration exactly once with a realm ${arrival} the reply`, () =>
      Effect.gen(function*() {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const { facts, page, realm, state, sent } = yield* withPage({
          "browsingContext.traverseHistory": Effect.andThen(
            Deferred.succeed(entered, undefined),
            Deferred.await(release)
          )
        })
        const url = "http://past.example/"
        const from = page.document!.id
        page.past.set(url, from)
        const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
        const fiber = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
        yield* Deferred.await(entered)
        handlers.apply("browsingContext.navigationStarted", {
          context: page.bidi,
          navigation: "announced",
          url,
          timestamp: 1
        }, { state })
        handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
        const arrived = () =>
          handlers.apply("script.realmCreated", {
            realm: "R2",
            context: page.bidi,
            type: "window",
            origin: "http://past.example"
          }, { state })
        if (arrival === "before") arrived()
        yield* Deferred.succeed(release, undefined)
        const navigation = yield* Fiber.join(fiber)
        assert(Option.isSome(navigation))
        if (arrival === "after") arrived()
        yield* state.buffer.flush
        yield* state.buffer.waitFor(() =>
          facts.some((fact) => fact._tag === "NavigationEnded" && fact.navigation === navigation.value) ?
            true :
            undefined
        )
        arrived()
        yield* state.buffer.flush
        const ended = facts.filter((fact) => fact._tag === "NavigationEnded" && fact.navigation === navigation.value)
        assert.lengthOf(ended, 1)
        assert(ended[0]!._tag === "NavigationEnded")
        assert.deepStrictEqual(ended[0]!.outcome, { _tag: "Restored", document: page.document!.id })
        const committed = facts.filter((fact) =>
          fact._tag === "DocumentCommitted" && fact.document === page.document!.id
        )
        assert.lengthOf(committed, 1)
        assert(committed[0]!._tag === "DocumentCommitted")
        assert.deepStrictEqual(committed[0]!.createdBy, { _tag: "Restored", navigation: navigation.value, from })
        assert.lengthOf(
          facts.filter((fact) => fact._tag === "NavigationStarted" && fact.navigation === navigation.value),
          1
        )
        assert.isFalse(sent.includes("script.evaluate"))
      }))
  }

  for (const failure of ["failure", "interruption"] as const) {
    it.effect(`releases a traversal reservation on command ${failure}`, () =>
      Effect.gen(function*() {
        const entered = yield* Deferred.make<void>()
        const { page, state } = yield* withPage({
          "browsingContext.traverseHistory": Effect.andThen(
            Deferred.succeed(entered, undefined),
            failure === "failure" ?
              Effect.fail(
                new Protocol.ProtocolError({
                  reason: new Protocol.Rejected({
                    method: "browsingContext.traverseHistory",
                    reason: "Unrecognized",
                    code: "no such history entry",
                    description: "no history"
                  })
                })
              ) :
              Effect.never
          )
        })
        if (failure === "failure") assert(Option.isNone(yield* Navigation.traverse(state, page.id, -1)))
        else {
          const fiber = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
          yield* Deferred.await(entered)
          yield* Fiber.interrupt(fiber)
        }
        assert.lengthOf(page.expected.list, 0)
        assert.strictEqual(page.restoring, undefined)
      }))
  }

  for (const order of ["in order", "out of order"] as const) {
    it.effect(`does not attribute an unrelated navigation to overlapping traversals replying ${order}`, () =>
      Effect.gen(function*() {
        // Synthetic ordering, not captured Firefox traffic: two traversals overlap, neither is announced.
        const url = "http://restored.example/"
        const gates = [yield* Deferred.make<void>(), yield* Deferred.make<void>()] as const
        const entered = [yield* Deferred.make<void>(), yield* Deferred.make<void>()] as const
        let calls = 0
        const { facts, page, realm, state } = yield* withPage({
          "browsingContext.traverseHistory": Effect.suspend(() => {
            const call = calls++
            return Effect.andThen(Deferred.succeed(entered[call]!, undefined), Deferred.await(gates[call]!))
          }).pipe(Effect.as({})),
          "script.evaluate": { type: "success", realm: "R2", result: { type: "string", value: url } }
        })
        const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
        handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
        const first = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
        yield* Deferred.await(entered[0])
        const second = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
        yield* Deferred.await(entered[1])
        const replies = order === "in order" ? [0, 1] : [1, 0]
        yield* Deferred.succeed(gates[replies[0]!]!, undefined)
        const one = yield* Fiber.join(replies[0] === 0 ? first : second)
        yield* Deferred.succeed(gates[replies[1]!]!, undefined)
        const two = yield* Fiber.join(replies[1] === 0 ? first : second)
        assert(Option.isSome(one) && Option.isSome(two))
        handlers.apply("script.realmCreated", {
          realm: "R2",
          context: page.bidi,
          type: "window",
          origin: "http://restored.example"
        }, { state })
        yield* state.buffer.flush
        // A successful reply and a realm cannot identify either overlapping traversal.
        // The next navigation must get its own facts, never a returned traversal id.
        handlers.apply("browsingContext.navigationStarted", {
          context: page.bidi,
          navigation: "unrelated",
          url: "http://unrelated.example/",
          timestamp: 1
        }, { state })
        handlers.apply("browsingContext.navigationCommitted", {
          context: page.bidi,
          navigation: "unrelated",
          url: "http://unrelated.example/",
          timestamp: 2
        }, { state })
        yield* state.buffer.flush
        const unrelated = facts.filter((fact) => fact._tag === "NavigationStarted")
        assert.lengthOf(unrelated, 1, "ambiguous replies must not invent a navigation")
        assert(unrelated[0]!._tag === "NavigationStarted")
        assert.notStrictEqual(unrelated[0]!.navigation, one.value)
        assert.notStrictEqual(unrelated[0]!.navigation, two.value)
        assert.strictEqual(unrelated[0]!.initiatedAs, "crossDocument")
        const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
        assert.lengthOf(ended, 1)
        assert(ended[0]!._tag === "NavigationEnded")
        assert.strictEqual(ended[0]!.navigation, unrelated[0]!.navigation)
        assert.deepStrictEqual(ended[0]!.outcome, {
          _tag: "Committed",
          document: page.document!.id,
          response: Option.none()
        })
        assert.strictEqual(page.restoring, undefined)
        assert.deepStrictEqual(
          page.expected.list.map((expected) => expected.id),
          [],
          "no traversal reservation may leak"
        )
      }))
  }

  for (const order of ["in order", "out of order"] as const) {
    it.effect(`preserves an announced traversal commit while overlapping replies arrive ${order}`, () =>
      Effect.gen(function*() {
        const gates = [yield* Deferred.make<void>(), yield* Deferred.make<void>()] as const
        const entered = [yield* Deferred.make<void>(), yield* Deferred.make<void>()] as const
        let calls = 0
        const { facts, page, state, sent } = yield* withPage({
          "browsingContext.traverseHistory": Effect.suspend(() => {
            const call = calls++
            return Effect.andThen(Deferred.succeed(entered[call]!, undefined), Deferred.await(gates[call]!))
          })
        })
        const handlers = Navigation.register(Kit.handlers<State.Event>())
        const first = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
        yield* Deferred.await(entered[0])
        handlers.apply("browsingContext.navigationStarted", {
          context: page.bidi,
          navigation: "announced",
          url: "http://announced.example/",
          timestamp: 1
        }, { state })
        const second = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
        yield* Deferred.await(entered[1])
        const commit = () =>
          handlers.apply("browsingContext.navigationCommitted", {
            context: page.bidi,
            navigation: "announced",
            url: "http://announced.example/",
            timestamp: 2
          }, { state })
        commit()
        const replies = order === "in order" ? [0, 1] : [1, 0]
        yield* Deferred.succeed(gates[replies[0]!]!, undefined)
        const one = yield* Fiber.join(replies[0] === 0 ? first : second)
        yield* Deferred.succeed(gates[replies[1]!]!, undefined)
        const two = yield* Fiber.join(replies[1] === 0 ? first : second)
        assert(Option.isSome(one) && Option.isSome(two))
        const firstId = order === "in order" ? one.value : two.value
        const secondId = order === "in order" ? two.value : one.value
        commit()
        yield* state.buffer.flush
        const starts = facts.filter((fact) => fact._tag === "NavigationStarted")
        assert.lengthOf(starts, 1)
        assert(starts[0]!._tag === "NavigationStarted")
        assert.strictEqual(starts[0]!.navigation, firstId)
        assert.strictEqual(starts[0]!.initiatedAs, "traversal")
        const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
        assert.lengthOf(ended, 1, "an ambiguous second command has no outcome")
        assert(ended[0]!._tag === "NavigationEnded")
        assert.strictEqual(ended[0]!.navigation, firstId)
        assert.notStrictEqual(ended[0]!.navigation, secondId)
        assert.deepStrictEqual(ended[0]!.outcome, {
          _tag: "Committed",
          document: page.document!.id,
          response: Option.none()
        })
        assert.isFalse(sent.includes("script.evaluate"))
        assert.strictEqual(page.restoring, undefined)
        assert.lengthOf(page.expected.list, 0)
      }))
  }

  it.effect("keeps an invalidated unannounced restoration ambiguous until a document is observed", () =>
    Effect.gen(function*() {
      const { facts, page, realm, state, sent } = yield* withPage({
        "browsingContext.traverseHistory": {},
        "script.evaluate": {
          type: "success",
          realm: "R2",
          result: { type: "string", value: "http://ambiguous.example/" }
        }
      })
      const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
      handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
      const first = yield* Navigation.traverse(state, page.id, -1)
      const second = yield* Navigation.traverse(state, page.id, -1)
      // Both replies are done. Issuing a third command does not identify a late realm from the earlier pair.
      const third = yield* Navigation.traverse(state, page.id, -1)
      assert(Option.isSome(first) && Option.isSome(second) && Option.isSome(third))
      handlers.apply("script.realmCreated", {
        realm: "R2",
        context: page.bidi,
        type: "window",
        origin: "http://ambiguous.example"
      }, { state })
      yield* state.buffer.flush
      handlers.apply("browsingContext.navigationStarted", {
        context: page.bidi,
        navigation: "observed",
        url: "http://observed.example/",
        timestamp: 1
      }, { state })
      handlers.apply("browsingContext.navigationCommitted", {
        context: page.bidi,
        navigation: "observed",
        url: "http://observed.example/",
        timestamp: 2
      }, { state })
      yield* state.buffer.flush
      const starts = facts.filter((fact) => fact._tag === "NavigationStarted")
      assert.lengthOf(starts, 1)
      assert(starts[0]!._tag === "NavigationStarted")
      assert.strictEqual(starts[0]!.initiatedAs, "crossDocument")
      for (const navigation of [first.value, second.value, third.value]) {
        assert.notStrictEqual(starts[0]!.navigation, navigation)
        assert.lengthOf(facts.filter((fact) => fact._tag === "NavigationEnded" && fact.navigation === navigation), 0)
      }
      assert.isFalse(sent.includes("script.evaluate"))
      assert.lengthOf(page.expected.list, 0)
      // The observed commit restores an unambiguous document boundary for the next traversal.
      const next = yield* Navigation.traverse(state, page.id, -1)
      handlers.apply("script.realmDestroyed", { realm: "R2" }, { state })
      handlers.apply("script.realmCreated", {
        realm: "R3",
        context: page.bidi,
        type: "window",
        origin: "http://ambiguous.example"
      }, { state })
      yield* state.buffer.flush
      assert(Option.isSome(next))
      yield* state.buffer.waitFor(() =>
        facts.some((fact) => fact._tag === "NavigationEnded" && fact.navigation === next.value) ? true : undefined
      )
      assert.strictEqual(page.document!.url, "http://ambiguous.example/")
    }))

  for (const newer of ["command", "event", "page removal"] as const) {
    it.effect(`does not reinstall a traversal after a newer ${newer} and a late reply`, () =>
      Effect.gen(function*() {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const { facts, page, realm, state } = yield* withPage({
          "browsingContext.traverseHistory": Effect.andThen(
            Deferred.succeed(entered, undefined),
            Deferred.await(release)
          ),
          "browsingContext.navigate": { navigation: "newer", url: "http://newer.example/" },
          "script.evaluate": {
            type: "success",
            realm: "R2",
            result: { type: "string", value: "http://stale.example/" }
          }
        })
        const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
        handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
        const fiber = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
        yield* Deferred.await(entered)
        let owned: PageNavigation.Id | undefined
        if (newer === "command") {
          owned = yield* Navigation.navigate(state, page.id, "http://newer.example/", { referrer: Option.none() })
        } else if (newer === "event") {
          // The traversal was positively announced before the subsequent navigation replaced it.
          handlers.apply("browsingContext.navigationStarted", {
            context: page.bidi,
            navigation: "traversal",
            url: "http://old.example/",
            timestamp: 1
          }, { state })
          handlers.apply("browsingContext.navigationStarted", {
            context: page.bidi,
            navigation: "newer",
            url: "http://newer.example/",
            timestamp: 2
          }, { state })
        } else Tree.removeNavigable(state, page, new Target.Vanished({}), "test")
        yield* Deferred.succeed(release, undefined)
        const navigation = yield* Fiber.join(fiber)
        assert(Option.isSome(navigation))
        assert.strictEqual(page.restoring, undefined, "a stale reply must not reinstall restoration")
        handlers.apply("script.realmCreated", {
          realm: "R2",
          context: page.bidi,
          type: "window",
          origin: "http://stale.example"
        }, { state })
        if (newer !== "page removal") {
          handlers.apply("browsingContext.navigationStarted", {
            context: page.bidi,
            navigation: "newer",
            url: "http://newer.example/",
            timestamp: 3
          }, { state })
          handlers.apply("browsingContext.navigationCommitted", {
            context: page.bidi,
            navigation: "newer",
            url: "http://newer.example/",
            timestamp: 4
          }, { state })
        }
        yield* state.buffer.flush
        assert.notStrictEqual(page.document?.url, "http://stale.example/")
        const traversalEnds = facts.filter((fact) =>
          fact._tag === "NavigationEnded" && fact.navigation === navigation.value
        )
        if (newer === "event") {
          assert.lengthOf(traversalEnds, 1)
          assert(traversalEnds[0]!._tag === "NavigationEnded")
          assert.strictEqual(traversalEnds[0]!.outcome._tag, "Superseded")
        } else assert.lengthOf(traversalEnds, 0, "command issuance and removal cannot invent an outcome")
        if (owned !== undefined) {
          const starts = facts.filter((fact) => fact._tag === "NavigationStarted" && fact.navigation === owned)
          assert.lengthOf(starts, 1, "the newer command retains its own reply correlation")
          const ends = facts.filter((fact) => fact._tag === "NavigationEnded" && fact.navigation === owned)
          assert.lengthOf(ends, 1)
          assert(ends[0]!._tag === "NavigationEnded")
          assert.deepStrictEqual(ends[0]!.outcome, {
            _tag: "Committed",
            document: page.document!.id,
            response: Option.none()
          })
        }
        assert.lengthOf(page.expected.list, 0)
      }))
  }

  for (
    const failure of ["rejected with no history", "interrupted", "NoReply", "another rejection", "defect"] as const
  ) {
    it.effect(`${failure === "rejected with no history" ? "restores a single traversal" : "keeps ownership ambiguous"} after an earlier traversal was ${failure}, with no commit between`, () =>
      Effect.gen(function*() {
        // Synthetic ordering, not captured Firefox traffic: the second traversal is the only one outstanding
        // when its realm arrives.
        const url = "http://restored.example/"
        const entered = yield* Deferred.make<void>()
        const secondEntered = yield* Deferred.make<void>()
        const secondReply = yield* Deferred.make<void>()
        let calls = 0
        const { facts, page, realm, state } = yield* withPage({
          "browsingContext.traverseHistory": Effect.suspend(() => {
            if (calls++ > 0) {
              return Effect.andThen(Deferred.succeed(secondEntered, undefined), Deferred.await(secondReply))
            }
            if (failure === "interrupted") {
              return Effect.andThen(Deferred.succeed(entered, undefined), Effect.never)
            }
            if (failure === "defect") return Effect.die("uncertain transport defect")
            return Effect.fail(
              new Protocol.ProtocolError({
                reason: failure === "NoReply"
                  ? new Protocol.NoReply({ method: "browsingContext.traverseHistory", timeout: Duration.seconds(30) })
                  : new Protocol.Rejected({
                    method: "browsingContext.traverseHistory",
                    reason: "Unrecognized",
                    code: failure === "rejected with no history" ? "no such history entry" : "unknown error",
                    description: "no history"
                  })
              })
            )
          }),
          "script.evaluate": { type: "success", realm: "R2", result: { type: "string", value: url } }
        })
        const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
        if (failure === "interrupted") {
          const fiber = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
          yield* Deferred.await(entered)
          yield* Fiber.interrupt(fiber)
        } else assert(Option.isNone(yield* Navigation.traverse(state, page.id, 1)))
        handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
        const second = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
        yield* Deferred.await(secondEntered)
        // Uncertain controls put the realm before the reply. Joining the command then waits for any
        // inline lookup and its fact publication, so a removed guard cannot hide behind asynchronous work.
        if (failure === "rejected with no history") {
          yield* Deferred.succeed(secondReply, undefined)
          yield* Fiber.join(second)
        }
        handlers.apply("script.realmCreated", {
          realm: "R2",
          context: page.bidi,
          type: "window",
          origin: "http://restored.example"
        }, { state })
        if (failure !== "rejected with no history") yield* Deferred.succeed(secondReply, undefined)
        const navigation = yield* Fiber.join(second)
        assert(Option.isSome(navigation))
        yield* state.buffer.flush
        if (failure === "rejected with no history") {
          yield* state.buffer.waitFor(() =>
            facts.some((fact) => fact._tag === "NavigationEnded" && fact.navigation === navigation.value) ?
              true :
              undefined
          )
        }
        const started = facts.filter((fact) =>
          fact._tag === "NavigationStarted" && fact.navigation === navigation.value
        )
        const ended = facts.filter((fact) => fact._tag === "NavigationEnded" && fact.navigation === navigation.value)
        if (failure !== "rejected with no history") {
          // An interrupted command may still have reached the browser, so the realm could be its; nothing proves
          // which traversal owns it, and neither is given facts.
          assert.lengthOf(started, 0)
          assert.lengthOf(ended, 0)
          assert.lengthOf(page.expected.list, 0)
          return
        }
        // A rejection is the browser's word that nothing navigated, so it leaves no ambiguity behind.
        assert.lengthOf(started, 1, "the valid traversal must start")
        assert.lengthOf(ended, 1, "the valid traversal must end")
        assert.strictEqual(page.document!.url, url)
      }))
  }

  it.effect("preserves pre-existing overlap ambiguity after a no-history rejection", () =>
    Effect.gen(function*() {
      let calls = 0
      const { facts, page, realm, state } = yield* withPage({
        "browsingContext.traverseHistory": Effect.suspend(() =>
          ++calls === 2
            ? Effect.fail(
              new Protocol.ProtocolError({
                reason: new Protocol.Rejected({
                  method: "browsingContext.traverseHistory",
                  reason: "Unrecognized",
                  code: "no such history entry",
                  description: "no history"
                })
              })
            ) :
            Effect.succeed({})
        ),
        "script.evaluate": {
          type: "success",
          realm: "R2",
          result: { type: "string", value: "http://ambiguous.example/" }
        }
      })
      const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
      assert(Option.isSome(yield* Navigation.traverse(state, page.id, -1)))
      assert(Option.isNone(yield* Navigation.traverse(state, page.id, 1)))
      handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
      handlers.apply("script.realmCreated", {
        realm: "R2",
        context: page.bidi,
        type: "window",
        origin: "http://ambiguous.example"
      }, { state })
      assert(Option.isSome(yield* Navigation.traverse(state, page.id, -1)))
      yield* state.buffer.flush
      assert.lengthOf(facts.filter((fact) => fact._tag === "NavigationStarted" || fact._tag === "NavigationEnded"), 0)
      assert.lengthOf(page.expected.list, 0)
      assert.strictEqual(page.restoring, undefined)
    }))

  it.effect("leaves a newer restoration and another command's reservation intact after a stale no-history rejection", () =>
    Effect.gen(function*() {
      const entered = [yield* Deferred.make<void>(), yield* Deferred.make<void>()] as const
      const replies = [yield* Deferred.make<void>(), yield* Deferred.make<void>()] as const
      let calls = 0
      const { facts, page, state } = yield* withPage({
        "browsingContext.navigate": { navigation: null, url: "http://owned.example/" },
        "browsingContext.traverseHistory": Effect.suspend(() => {
          const call = calls++
          return Effect.andThen(Deferred.succeed(entered[call]!, undefined), Deferred.await(replies[call]!)).pipe(
            Effect.andThen(
              call === 0 ?
                Effect.fail(
                  new Protocol.ProtocolError({
                    reason: new Protocol.Rejected({
                      method: "browsingContext.traverseHistory",
                      reason: "Unrecognized",
                      code: "no such history entry",
                      description: "no history"
                    })
                  })
                ) :
                Effect.succeed({})
            )
          )
        })
      })
      const owned = yield* Navigation.navigate(state, page.id, "http://owned.example/", { referrer: Option.none() })
      const first = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
      yield* Deferred.await(entered[0])
      const second = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
      yield* Deferred.await(entered[1])
      const newer = page.restoring
      assert(newer !== undefined)
      yield* Deferred.succeed(replies[0], undefined)
      assert(Option.isNone(yield* Fiber.join(first)))
      assert.strictEqual(page.restoring, newer)
      assert.deepStrictEqual(page.expected.list.map((entry) => entry.id), [owned])
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      handlers.apply("browsingContext.navigationStarted", {
        context: page.bidi,
        navigation: "owned",
        url: "http://owned.example/",
        timestamp: 1
      }, { state })
      yield* Deferred.succeed(replies[1], undefined)
      const unresolved = yield* Fiber.join(second)
      assert(Option.isSome(unresolved))
      handlers.apply("browsingContext.navigationCommitted", {
        context: page.bidi,
        navigation: "owned",
        url: "http://owned.example/",
        timestamp: 2
      }, { state })
      yield* state.buffer.flush
      const started = facts.filter((fact) => fact._tag === "NavigationStarted")
      const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
      assert.lengthOf(started, 1)
      assert(started[0]!._tag === "NavigationStarted")
      assert.strictEqual(started[0]!.navigation, owned)
      assert.strictEqual(started[0]!.initiatedAs, "crossDocument")
      assert.lengthOf(ended, 1)
      assert(ended[0]!._tag === "NavigationEnded")
      assert.strictEqual(ended[0]!.navigation, owned)
      assert.deepStrictEqual(ended[0]!.outcome, {
        _tag: "Committed",
        document: page.document!.id,
        response: Option.none()
      })
      assert.lengthOf(page.expected.list, 0)
      assert.strictEqual(page.restoring, undefined)
    }))

  it.effect("keeps ownership ambiguous after a no-history rejection of a traversal the browser announced", () =>
    Effect.gen(function*() {
      // Synthetic ordering, not captured Firefox traffic: the browser announces the first traversal, then
      // rejects its command. The announced navigation may still own the next realm, so the second can't claim it.
      const url = "http://restored.example/"
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      let calls = 0
      const { facts, page, realm, state } = yield* withPage({
        "browsingContext.traverseHistory": Effect.suspend(() =>
          calls++ > 0 ? Effect.succeed({}) : Effect.andThen(
            Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(gate)),
            Effect.fail(
              new Protocol.ProtocolError({
                reason: new Protocol.Rejected({
                  method: "browsingContext.traverseHistory",
                  reason: "Unrecognized",
                  code: "no such history entry",
                  description: "no history"
                })
              })
            )
          )
        ),
        "script.evaluate": { type: "success", realm: "R2", result: { type: "string", value: url } }
      })
      const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
      const first = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
      yield* Deferred.await(entered)
      handlers.apply("browsingContext.navigationStarted", {
        context: page.bidi,
        navigation: "announced",
        url,
        timestamp: 1
      }, { state })
      yield* Deferred.succeed(gate, undefined)
      assert(Option.isNone(yield* Fiber.join(first)))
      handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
      const navigation = yield* Navigation.traverse(state, page.id, -1)
      assert(Option.isSome(navigation))
      handlers.apply("script.realmCreated", {
        realm: "R2",
        context: page.bidi,
        type: "window",
        origin: "http://restored.example"
      }, { state })
      yield* state.buffer.flush
      assert.lengthOf(
        facts.filter((fact) => fact._tag === "NavigationStarted" && fact.navigation === navigation.value),
        0,
        "the second traversal must not claim a realm the announced one may own"
      )
    }))

  it.effect("releases a traversal interrupted during its location lookup", () =>
    Effect.gen(function*() {
      const entered = yield* Deferred.make<void>()
      const { page, realm, state } = yield* withPage({
        "browsingContext.traverseHistory": {},
        "script.evaluate": Effect.andThen(Deferred.succeed(entered, undefined), Effect.never)
      })
      const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
      handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
      handlers.apply("script.realmCreated", {
        realm: "R2",
        context: page.bidi,
        type: "window",
        origin: "http://restored.example"
      }, { state })
      const fiber = yield* Effect.forkChild(Navigation.traverse(state, page.id, -1))
      yield* Deferred.await(entered)
      yield* Fiber.interrupt(fiber)
      assert.lengthOf(page.expected.list, 0)
      assert.strictEqual(page.restoring, undefined)
    }))

  for (
    const boundary of [
      "realm removed",
      "page removed",
      "new navigation",
      "unsuccessful lookup",
      "exception lookup",
      "failed lookup"
    ] as const
  ) {
    it.effect(`discards an unannounced traversal lookup after ${boundary}`, () =>
      Effect.gen(function*() {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const finished = yield* Deferred.make<void>()
        const { facts, page, realm, state } = yield* withPage({
          "browsingContext.traverseHistory": {},
          "script.evaluate": Effect.gen(function*() {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            if (boundary === "failed lookup") {
              return yield* Effect.fail(
                new Protocol.ProtocolError({
                  reason: new Protocol.Rejected({
                    method: "script.evaluate",
                    reason: "Unrecognized",
                    code: "no such realm",
                    description: "gone"
                  })
                })
              )
            }
            if (boundary === "exception lookup") return { type: "exception", realm: "R2" }
            return boundary === "unsuccessful lookup"
              ? { type: "success", realm: "R2", result: { type: "undefined" } }
              : { type: "success", realm: "R2", result: { type: "string", value: "http://stale.example/" } }
          })
        })
        const handlers = Evaluation.register(Navigation.register(Kit.handlers<State.Event>()))
        handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
        const navigation = yield* Navigation.traverse(state, page.id, -1)
        assert(Option.isSome(navigation))
        handlers.apply("script.realmCreated", {
          realm: "R2",
          context: page.bidi,
          type: "window",
          origin: "http://stale.example"
        }, { state })
        // Queue a marker behind the lookup's state update, without waiting on wall-clock time.
        const run = state.buffer.run
        ;(state.buffer as { run: typeof run }).run = (facts) =>
          run(() => {
            facts()
            state.buffer.later(Deferred.succeed(finished, undefined))
          })
        yield* state.buffer.flush
        yield* Deferred.await(entered)
        if (boundary === "realm removed") handlers.apply("script.realmDestroyed", { realm: "R2" }, { state })
        if (boundary === "page removed") Tree.removeNavigable(state, page, new Target.Vanished({}), "test")
        if (boundary === "new navigation") {
          Tree.startNavigation(state, page, "new", "http://new.example/", "crossDocument", false, null)
        }
        yield* Deferred.succeed(release, undefined)
        yield* Deferred.await(finished)
        yield* state.buffer.flush
        assert.lengthOf(
          facts.filter((fact) =>
            (fact._tag === "NavigationStarted" || fact._tag === "NavigationEnded") &&
            fact.navigation === navigation.value
          ),
          0
        )
        assert.notStrictEqual(page.document?.url, "http://stale.example/")
        assert.strictEqual(page.restoring, undefined)
      }))
  }

  for (const ownsError of [true, false]) {
    it.effect(`preserves an immediately current error document and immutable provenance when the reply ${ownsError ? "owns" : "does not own"} it`, () =>
      Effect.gen(function*() {
        const first = "http://first.example/"
        const second = "http://second.example/"
        const errorUrl = "about:neterror?e=dnsNotFound&u=" + encodeURIComponent(first)
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        let calls = 0
        const { facts, page, state } = yield* withPage({
          "browsingContext.navigate": Effect.suspend(() =>
            ++calls === 1
              ? Effect.gen(function*() {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
                return { navigation: ownsError ? "error" : "other", url: first }
              })
              : Effect.succeed({ navigation: "newer", url: second })
          )
        })
        const handlers = Navigation.register(Kit.handlers<State.Event>())
        const event = (method: string, navigation: string, url: string) =>
          handlers.apply(method, { context: "C1", navigation, url, timestamp: 1 }, { state })
        // Identical wire prefix in both cases: the reply has not yet established ownership.
        const running = yield* Effect.forkChild(Navigation.navigate(state, page.id, first, { referrer: Option.none() }))
        yield* Deferred.await(entered)
        const reserved = page.expected.list[0]!.id
        event("browsingContext.navigationCommitted", "error", errorUrl)
        // Unknown identity alone must not hide the actual current error document.
        assert.strictEqual(page.document!.url, errorUrl)
        const newer = yield* Navigation.navigate(state, page.id, second, { referrer: Option.none() })
        event("browsingContext.navigationStarted", "newer", second)
        event("browsingContext.navigationCommitted", "newer", second)
        yield* state.buffer.flush
        assert.strictEqual(page.document!.url, second)
        const publishedCount = facts.length
        const published = JSON.stringify(facts)
        const newerBeforeReply = facts.filter((fact) => fact._tag === "DocumentCommitted" && fact.url === second)
        assert.lengthOf(newerBeforeReply, 1)
        yield* Deferred.succeed(release, undefined)
        assert.strictEqual(yield* Fiber.join(running), reserved)
        yield* state.buffer.flush
        // Already delivered facts cannot be changed retrospectively to supply provenance.
        assert.strictEqual(JSON.stringify(facts.slice(0, publishedCount)), published)
        const documents = facts.filter((fact) => fact._tag === "DocumentCommitted")
        const errorDocument = documents.find((fact) => fact.url === errorUrl)!
        assert.isDefined(errorDocument)
        assert.deepStrictEqual(errorDocument.createdBy, { _tag: "UnattributedErrorPage" })
        if (ownsError) assert.strictEqual(errorNavigation(facts, errorDocument), reserved)
        else assert.isUndefined(errorNavigation(facts, errorDocument))
        assert.lengthOf(documents.filter((fact) => fact.url === second), 1)
        assert.strictEqual(documents.at(-1)!.url, second)
        assert.deepStrictEqual(documents.at(-1)!.createdBy, { _tag: "Navigation", navigation: newer })
        assert.strictEqual(page.document!.url, second)
        const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
        assert.deepStrictEqual(ended.filter((fact) => fact.navigation === newer).map((fact) => fact.outcome._tag), [
          "Committed"
        ])
        if (ownsError) {
          assert.deepStrictEqual(
            ended.filter((fact) => fact.navigation === reserved).map((fact) => fact.outcome._tag),
            ["Failed"]
          )
        } else assert.isEmpty(ended.filter((fact) => fact.navigation === reserved))
        Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
        assert.isEmpty(page.expected.list)
        assert.isEmpty(page.commandNavigations)
        assert.isEmpty(page.navigationCommands)
        assert.isEmpty(page.navigations)
        assert.isEmpty(state.navigations)
      }))
  }

  it.effect("associates an observed error document with an already published failure without another outcome", () =>
    Effect.gen(function*() {
      const url = "http://example.com/"
      const errorUrl = "about:neterror?e=dnsNotFound&u=" + encodeURIComponent(url)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let calls = 0
      const { facts, page, state } = yield* withPage({
        "browsingContext.navigate": Effect.suspend(() =>
          ++calls === 1
            ? Effect.fail(
              new Protocol.ProtocolError({
                reason: new Protocol.Rejected({
                  method: "browsingContext.navigate",
                  reason: "Unrecognized",
                  code: "unknown error",
                  description: "refused"
                })
              })
            )
            : Effect.gen(function*() {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              return { navigation: "retry", url }
            })
        )
      })
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      const prior = yield* Navigation.navigate(state, page.id, url, { referrer: Option.none() })
      yield* state.buffer.flush
      const published = JSON.stringify(facts)
      const count = facts.length
      const running = yield* Effect.forkChild(Navigation.navigate(state, page.id, url, { referrer: Option.none() }))
      yield* Deferred.await(entered)
      handlers.apply("browsingContext.navigationCommitted", {
        context: "C1",
        navigation: "old",
        url: errorUrl,
        timestamp: 1
      }, { state })
      assert.strictEqual(page.document!.url, errorUrl)
      const document = page.document!.id
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(running)
      yield* state.buffer.flush
      assert.strictEqual(JSON.stringify(facts.slice(0, count)), published)
      assert.lengthOf(facts.filter((fact) => fact._tag === "NavigationEnded" && fact.navigation === prior), 1)
      assert.include(facts.map((fact) => fact._tag as string), "ErrorDocumentAttributed")
      assert.deepInclude(facts, { _tag: "ErrorDocumentAttributed", document, navigation: prior })
      assert.isEmpty(page.pendingTerminals)
    }))

  // Reduced from Firefox 158's recorded 204, download, HAR and November nightly traffic.
  // The load predates A's start although Firefox assigns it A; B has no document request.
  for (const outcome of ["NoContent", "Download", "Committed", "nightly", "Failed"] as const) {
    it.effect(`correlates Firefox's stale load and replacement identity for ${outcome}`, () =>
      Effect.gen(function*() {
        const url = "http://example.test/fixture"
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const { facts, page, state } = yield* withPage({
          "browsingContext.navigate": Effect.gen(function*() {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            if (outcome === "NoContent" || outcome === "Download") {
              return yield* Effect.fail(
                new Protocol.ProtocolError({
                  reason: new Protocol.Rejected({
                    method: "browsingContext.navigate",
                    reason: "Unrecognized",
                    code: "unknown error",
                    description: "NS_BINDING_ABORTED"
                  })
                })
              )
            }
            return { navigation: "A", url }
          })
        })
        const handlers = Contexts.register(Network.register(Navigation.register(Kit.handlers<State.Event>())))
        const event = (method: string, params: unknown) => handlers.apply(method, params, { state })
        const info = (navigation: string, timestamp: number) => ({ context: "C1", navigation, url, timestamp })
        // The complete nightly trace has an earlier successful command, then a second command.
        // Its initial "failure" names the already committed first navigation, not the second one.
        if (outcome === "nightly") {
          event("browsingContext.navigationStarted", info("prior", 1))
          event("browsingContext.navigationCommitted", info("prior", 2))
        }
        const running = yield* Effect.forkChild(Navigation.navigate(state, page.id, url, { referrer: Option.none() }))
        yield* Deferred.await(entered)
        const reserved = page.expected.list[0]!.id
        if (outcome === "nightly") event("browsingContext.navigationFailed", info("prior", 9))
        event("browsingContext.navigationStarted", info("A", 10))
        const params = {
          ...info("A", 11),
          redirectCount: 0,
          isBlocked: false,
          request: { request: "request", url, method: "GET", headers: [], destination: "document", bodySize: 0 }
        }
        event("network.beforeRequestSent", params)
        event("browsingContext.load", { ...info("A", 9), url: outcome === "nightly" ? url : "about:blank" })
        event("browsingContext.navigationStarted", info("B", 12))
        event("network.responseStarted", {
          ...params,
          response: {
            url,
            status: outcome === "NoContent" ? 204 : 200,
            statusText: "",
            protocol: "HTTP/1.1",
            headers: [],
            fromCache: false
          }
        })
        if (outcome === "NoContent") event("network.fetchError", { ...params, errorText: "NS_BINDING_ABORTED" })
        else if (outcome === "Download") {
          event("browsingContext.downloadWillBegin", {
            ...info("A", 13),
            download: "download",
            suggestedFilename: "file.txt"
          })
        } else if (outcome === "Failed") event("network.fetchError", { ...params, errorText: "connection refused" })
        else event("browsingContext.navigationCommitted", info("B", 13))
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(running)
        event("browsingContext.navigationFailed", info("B", 14))
        if (outcome === "Committed" || outcome === "nightly") {
          event("browsingContext.load", info("A", 9))
          event("browsingContext.load", info("A", 16))
        }
        if (outcome === "Failed") {
          event("browsingContext.navigationCommitted", {
            ...info("B", 15),
            url: "about:neterror?e=connectionFailure&u=" + encodeURIComponent(url)
          })
        }
        yield* state.buffer.flush
        if (outcome === "Failed") {
          const document = facts.filter((fact) => fact._tag === "DocumentCommitted").at(-1)!
          assert.deepStrictEqual(document.createdBy, { _tag: "ErrorPage", navigation: reserved })
        }
        const ends = facts.filter((fact) => fact._tag === "NavigationEnded").filter((fact) =>
          fact.navigation === reserved
        )
        assert.lengthOf(ends, 1)
        assert.strictEqual(ends[0]!.outcome._tag, outcome === "nightly" ? "Committed" : outcome)
        assert.strictEqual(state.requests.get("request")!.navigation!.id, reserved)
        if (ends[0]!.outcome._tag === "Committed") {
          assert.deepStrictEqual(ends[0]!.outcome.response, Option.some(state.requests.get("request")!.hop))
          const readiness = facts.filter((fact) => fact._tag === "DocumentReadiness")
          assert.lengthOf(readiness, 1)
          assert.strictEqual(readiness[0]!.document, ends[0]!.outcome.document)
        }
        assert.isEmpty(page.navigations)
        assert.isEmpty(state.navigations)
        assert.isEmpty(page.expected.list)
        assert.isEmpty(page.commandNavigations)
        assert.isEmpty(page.pendingTerminals)
      }))
  }

  // Reduced from Firefox 158's recorded 204 sent before the previous page's load: the stale load,
  // tagged A, arrives before A's start, and B then starts the same navigation again.
  it.effect("correlates Firefox's stale load that arrives before the start it names", () =>
    Effect.gen(function*() {
      const prior = "http://example.test/start"
      const url = "http://example.test/204"
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const { facts, page, state } = yield* withPage({
        "browsingContext.navigate": Effect.gen(function*() {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          return yield* Effect.fail(
            new Protocol.ProtocolError({
              reason: new Protocol.Rejected({
                method: "browsingContext.navigate",
                reason: "Unrecognized",
                code: "unknown error",
                description: "NS_BINDING_ABORTED"
              })
            })
          )
        })
      })
      const handlers = Contexts.register(Network.register(Navigation.register(Kit.handlers<State.Event>())))
      const event = (method: string, params: unknown) => handlers.apply(method, params, { state })
      const info = (navigation: string, timestamp: number) => ({ context: "C1", navigation, url, timestamp })
      event("browsingContext.navigationStarted", { ...info("prior", 1), url: prior })
      event("browsingContext.navigationCommitted", { ...info("prior", 2), url: prior })
      const running = yield* Effect.forkChild(Navigation.navigate(state, page.id, url, { referrer: Option.none() }))
      yield* Deferred.await(entered)
      const reserved = page.expected.list[0]!.id
      event("browsingContext.navigationFailed", { ...info("prior", 8), url: prior })
      event("browsingContext.load", { ...info("A", 9), url: prior })
      event("browsingContext.navigationStarted", info("A", 10))
      const params = {
        ...info("A", 11),
        redirectCount: 0,
        isBlocked: false,
        request: { request: "request", url, method: "GET", headers: [], destination: "document", bodySize: 0 }
      }
      event("network.beforeRequestSent", params)
      event("browsingContext.navigationStarted", info("B", 12))
      event("network.responseStarted", {
        ...params,
        response: { url, status: 204, statusText: "", protocol: "HTTP/1.1", headers: [], fromCache: false }
      })
      event("network.fetchError", { ...params, errorText: "NS_BINDING_ABORTED" })
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(running)
      event("browsingContext.navigationFailed", info("B", 14))
      yield* state.buffer.flush
      const ends = facts.filter((fact) => fact._tag === "NavigationEnded").filter((fact) =>
        fact.navigation === reserved
      )
      assert.deepStrictEqual(ends.map((fact) => fact.outcome._tag), ["NoContent"])
      assert.strictEqual(state.requests.get("request")!.navigation!.id, reserved)
      assert.isEmpty(page.navigations)
      assert.isEmpty(state.navigations)
      assert.isEmpty(page.expected.list)
      assert.isEmpty(page.commandNavigations)
      assert.isEmpty(page.pendingTerminals)
    }))

  // Reduced from Firefox 158 navigating twice to the same fixture before its first load:
  // the delayed load names A before A starts, B commits, and the successful command replies with A.
  it.effect("correlates an early stale load when the replacement commits and the command replies with the first identity", () =>
    Effect.gen(function*() {
      const url = "http://example.test/fixture"
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const { facts, page, state } = yield* withPage({
        "browsingContext.navigate": Effect.gen(function*() {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          return { navigation: "A", url }
        })
      })
      const handlers = Network.register(Navigation.register(Kit.handlers<State.Event>()))
      const event = (method: string, params: unknown) => handlers.apply(method, params, { state })
      const info = (navigation: string, timestamp: number) => ({ context: "C1", navigation, url, timestamp })
      event("browsingContext.navigationStarted", info("prior", 762))
      event("browsingContext.navigationCommitted", info("prior", 818))
      const running = yield* Effect.forkChild(Navigation.navigate(state, page.id, url, { referrer: Option.none() }))
      yield* Deferred.await(entered)
      const reserved = page.expected.list[0]!.id
      event("browsingContext.domContentLoaded", info("prior", 823))
      event("browsingContext.navigationFailed", info("prior", 833))
      event("browsingContext.load", info("A", 832))
      event("browsingContext.navigationStarted", info("A", 835))
      const params = {
        ...info("A", 835),
        redirectCount: 0,
        isBlocked: false,
        request: { request: "request", url, method: "GET", headers: [], destination: "document", bodySize: 0 }
      }
      event("network.beforeRequestSent", params)
      event("browsingContext.navigationStarted", info("B", 837))
      const response = { url, status: 200, statusText: "OK", protocol: "HTTP/1.1", headers: [], fromCache: false }
      event("network.responseStarted", { ...params, timestamp: 839, response })
      event("network.responseCompleted", { ...params, timestamp: 846, response })
      event("browsingContext.navigationCommitted", info("B", 859))
      event("browsingContext.domContentLoaded", info("B", 855))
      event("browsingContext.load", info("B", 856))
      yield* Deferred.succeed(release, undefined)
      assert.strictEqual(yield* Fiber.join(running), reserved)
      yield* state.buffer.flush
      const ends = facts.filter((fact) => fact._tag === "NavigationEnded").filter((fact) =>
        fact.navigation === reserved
      )
      assert.deepStrictEqual(ends.map((fact) => fact.outcome._tag), ["Committed"])
      const outcome = ends[0]!.outcome
      if (outcome._tag === "Committed") {
        assert.strictEqual(outcome.document, page.document!.id)
        assert.deepStrictEqual(outcome.response, Option.some(state.requests.get("request")!.hop))
      }
      assert.strictEqual(state.requests.get("request")!.navigation!.id, reserved)
      assert.isEmpty(page.navigations)
      assert.isEmpty(state.navigations)
      assert.isEmpty(page.expected.list)
      assert.isEmpty(page.commandNavigations)
      assert.isEmpty(page.pendingTerminals)
    }))

  for (const initial of [true, false]) {
    it.effect(`handles an early stale load ${initial ? "on the initial document" : "followed by a known identity start"}`, () =>
      Effect.gen(function*() {
        const { facts, page, state } = yield* withPage()
        const url = "http://example.test/next"
        const handlers = Network.register(Navigation.register(Kit.handlers<State.Event>()))
        const event = (method: string, navigation: string, timestamp: number, eventUrl = url) =>
          handlers.apply(method, { context: "C1", navigation, url: eventUrl, timestamp }, { state })
        if (!initial) {
          event("browsingContext.navigationStarted", "prior", 1)
          event("browsingContext.navigationCommitted", "prior", 2)
          event("browsingContext.navigationStarted", "known", 3)
        }
        event("browsingContext.load", "A", 9, page.document!.url)
        if (!initial) event("browsingContext.navigationStarted", "known", 3)
        event("browsingContext.navigationStarted", "A", 10)
        const navigation = state.navigations.get("A")!
        handlers.apply("network.beforeRequestSent", {
          context: "C1",
          navigation: "A",
          url,
          timestamp: 11,
          redirectCount: 0,
          isBlocked: false,
          request: { request: "request", url, method: "GET", headers: [], destination: "document", bodySize: 0 }
        }, { state })
        event("browsingContext.navigationStarted", "B", 12)
        event("browsingContext.navigationCommitted", "B", 13)
        yield* state.buffer.flush
        const ends = facts.filter((fact) => fact._tag === "NavigationEnded").filter((fact) =>
          fact.navigation === navigation.id
        )
        assert.deepStrictEqual(ends.map((fact) => fact.outcome._tag), [initial ? "Committed" : "Superseded"])
      }))
  }

  it.effect("discards an early stale load when its start is older than the active navigation", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage()
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      const event = (method: string, navigation: string, timestamp: number) =>
        handlers.apply(method, { context: "C1", navigation, url: "http://example.test/", timestamp }, { state })
      event("browsingContext.navigationStarted", "prior", 1)
      event("browsingContext.navigationCommitted", "prior", 2)
      event("browsingContext.navigationStarted", "current", 20)
      const current = state.navigations.get("current")!
      event("browsingContext.load", "old", 9)
      assert.isDefined(page.staleLoad)
      event("browsingContext.navigationStarted", "old", 10)
      assert.isUndefined(page.staleLoad)
      assert.isFalse(state.navigations.has("old"))
      assert.isFalse(current.ended)
      assert.isUndefined(current.staleLoad)
    }))

  for (const first of ["start", "commit"] as const) {
    it.effect(`discards a stale load kept for its start when another identity's ${first} comes first`, () =>
      Effect.gen(function*() {
        const { page, state } = yield* withPage()
        const prior = "http://example.test/start"
        const handlers = Navigation.register(Kit.handlers<State.Event>())
        const event = (method: string, navigation: string, timestamp: number, url = "http://example.test/next") =>
          handlers.apply(method, { context: "C1", navigation, url, timestamp }, { state })
        event("browsingContext.navigationStarted", "prior", 1, prior)
        event("browsingContext.navigationCommitted", "prior", 2, prior)
        event("browsingContext.load", "A", 9, prior)
        assert.deepStrictEqual(page.staleLoad, { bidi: "A", timestamp: 9, document: page.document!.id })
        event(`browsingContext.navigation${first === "start" ? "Started" : "Committed"}`, "other", 10)
        assert.isUndefined(page.staleLoad)
        event("browsingContext.navigationStarted", "A", 11)
        assert.isUndefined(state.navigations.get("A")!.staleLoad)
      }))
  }

  for (
    const competition of ["same-URL command", "page request", "fresh load", "other context", "no request"] as const
  ) {
    it.effect(`preserves supersession after a stale load with ${competition}`, () =>
      Effect.gen(function*() {
        const { facts, page, state } = yield* withPage()
        const url = "http://example.test/fixture"
        const handlers = Network.register(Navigation.register(Kit.handlers<State.Event>()))
        const event = (method: string, params: unknown) => handlers.apply(method, params, { state })
        const info = (navigation: string, timestamp: number) => ({ context: "C1", navigation, url, timestamp })
        const reserved = Kit.expect(state.ids, page.expected, url)
        event("browsingContext.navigationStarted", info("A", 10))
        const request = (navigation: string, id: string) => ({
          ...info(navigation, 11),
          redirectCount: 0,
          isBlocked: false,
          request: { request: id, url, method: "GET", headers: [], destination: "document", bodySize: 0 }
        })
        if (competition !== "no request") event("network.beforeRequestSent", request("A", "first"))
        event("browsingContext.load", {
          ...info("A", competition === "fresh load" ? 11 : 9),
          context: competition === "other context" ? "other" : "C1",
          url: "about:blank"
        })
        const second = competition === "same-URL command" ? Kit.expect(state.ids, page.expected, url) : undefined
        event("browsingContext.navigationStarted", info("B", 12))
        if (competition === "page request") event("network.beforeRequestSent", request("B", "second"))
        event("browsingContext.navigationCommitted", info("B", 13))
        event("browsingContext.navigationFailed", info("A", 14))
        yield* state.buffer.flush
        const ended = facts.filter((fact) => fact._tag === "NavigationEnded").filter((fact) =>
          fact.navigation === reserved
        )
        assert.lengthOf(ended, 1)
        assert.strictEqual(ended[0]!.outcome._tag, "Superseded")
        if (second !== undefined && ended[0]!.outcome._tag === "Superseded") {
          assert.strictEqual(ended[0]!.outcome.by, second)
        }
        assert.isEmpty(page.navigations)
        assert.isEmpty(state.navigations)
      }))
  }

  it.effect("ignores a delayed start older than the active navigation and clears its stale-load evidence", () =>
    Effect.gen(function*() {
      const { facts, page, state } = yield* withPage()
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      const event = (method: string, navigation: string, timestamp: number) =>
        handlers.apply(method, { context: "C1", navigation, url: "http://example.test/", timestamp }, { state })
      event("browsingContext.navigationStarted", "current", 20)
      const current = state.navigations.get("current")!
      event("browsingContext.navigationStarted", "old", 10)
      assert.isFalse(current.ended)
      assert.isFalse(state.navigations.has("old"))
      event("browsingContext.navigationCommitted", "current", 30)
      event("browsingContext.navigationStarted", "old", 10)
      yield* state.buffer.flush
      assert.lengthOf(facts.filter((fact) => fact._tag === "NavigationStarted"), 1)
      assert.isEmpty(state.navigations)
      assert.isEmpty(current.starts)
      assert.isUndefined(current.staleLoad)
      assert.isEmpty(page.navigations)
    }))

  it.effect("releases navigation identity evidence when its context is removed", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage()
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      handlers.apply("browsingContext.navigationStarted", {
        context: "C1",
        navigation: "active",
        url: "http://example.test/",
        timestamp: 10
      }, { state })
      const navigation = state.navigations.get("active")!
      handlers.apply("browsingContext.load", {
        context: "C1",
        navigation: "active",
        url: "about:blank",
        timestamp: 9
      }, { state })
      Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
      assert.isEmpty(navigation.starts)
      assert.isUndefined(navigation.staleLoad)
      assert.isEmpty(state.navigations)
    }))

  for (const status of [204, 205, 500]) {
    for (const completion of ["reply", "rejected", "interrupted"] as const) {
      it.effect(`keeps request identity and ${status === 500 ? "fetch failure" : status} completion observable before command ${completion}`, () =>
        Effect.gen(function*() {
          const url = "http://example.com/next"
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const { facts, page, state } = yield* withPage({
            "browsingContext.navigate": Effect.gen(function*() {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              if (completion === "rejected") {
                return yield* Effect.fail(
                  new Protocol.ProtocolError({
                    reason: new Protocol.Rejected({
                      method: "browsingContext.navigate",
                      reason: "Unrecognized",
                      code: "unknown error",
                      description: "failed"
                    })
                  })
                )
              }
              return { navigation: "next", url }
            })
          })
          const handlers = Network.register(Navigation.register(Kit.handlers<State.Event>()))
          const event = (method: string, params: unknown) => handlers.apply(method, params, { state })
          const running = yield* Effect.forkChild(Navigation.navigate(state, page.id, url, { referrer: Option.none() }))
          yield* Deferred.await(entered)
          const reserved = page.expected.list[0]!.id
          // An unrelated unidentified terminal event must not hold this start or its network consumers.
          event("browsingContext.navigationFailed", {
            context: "C1",
            navigation: "old",
            url: "http://old.example/",
            timestamp: 1
          })
          event("browsingContext.navigationStarted", { context: "C1", navigation: "next", url, timestamp: 2 })
          const params = {
            context: "C1",
            navigation: "next",
            timestamp: 3,
            redirectCount: 0,
            isBlocked: false,
            request: { request: "request", url, method: "GET", headers: [], destination: "document", bodySize: 0 }
          }
          event("network.beforeRequestSent", params)
          const request = state.requests.get("request")!
          assert.strictEqual(request.navigation?.id, reserved)
          event("network.responseStarted", {
            ...params,
            response: { url, status, statusText: "", protocol: "HTTP/1.1", headers: [], fromCache: false }
          })
          event("network.fetchError", {
            ...params,
            errorText: status === 500 ? "connection refused" : "NS_BINDING_ABORTED"
          })
          // Duplicate terminal events cannot add another outcome, before or after the reply.
          event("browsingContext.navigationFailed", { context: "C1", navigation: "next", url, timestamp: 4 })
          if (completion === "interrupted") yield* Fiber.interrupt(running)
          else {
            yield* Deferred.succeed(release, undefined)
            assert.strictEqual(yield* Fiber.join(running), reserved)
          }
          event("browsingContext.navigationAborted", { context: "C1", navigation: "next", url, timestamp: 5 })
          yield* state.buffer.flush
          const ended = facts.filter((fact) => fact._tag === "NavigationEnded").filter((fact) =>
            fact.navigation === reserved
          )
          assert.lengthOf(ended, 1)
          assert.strictEqual(ended[0]!.outcome._tag, status === 500 ? "Failed" : "NoContent")
          if (ended[0]!.outcome._tag === "NoContent") {
            assert.strictEqual(ended[0]!.outcome.status, status)
            assert.deepStrictEqual(ended[0]!.outcome.response, Option.some(request.hop))
          }
          const sent = facts.find((fact) => fact._tag === "RequestSent")!
          assert.strictEqual(sent._tag, "RequestSent")
          if (sent._tag === "RequestSent") {
            assert.deepStrictEqual(sent.request.initiator, {
              _tag: "Document",
              navigable: page.id,
              navigation: Option.some(reserved)
            })
          }
          assert.strictEqual(page.document!.url, "about:blank")
          assert.isEmpty(page.pendingTerminals)
          assert.isEmpty(page.expected.list)
          assert.isEmpty(page.commandNavigations)
          assert.isEmpty(page.navigationCommands)
          assert.isEmpty(state.navigations)
        }))
    }
  }

  for (const association of [false, true]) {
    for (const frame of [false, true]) {
      it.effect(`folds late ${association ? "association" : "outcome"} without changing the newer ${frame ? "frame" : "page"} document or readiness`, () =>
        Effect.scoped(Effect.gen(function*() {
          const first = "http://first.example/"
          const second = "http://second.example/"
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          let calls = 0
          const { facts, page, state, realm } = yield* withPage({
            "browsingContext.navigate": Effect.suspend(() => {
              calls++
              if (association && calls === 1) {
                return Effect.fail(
                  new Protocol.ProtocolError({
                    reason: new Protocol.Rejected({
                      method: "browsingContext.navigate",
                      reason: "Unrecognized",
                      code: "unknown error",
                      description: "refused"
                    })
                  })
                )
              }
              if (calls === (association ? 2 : 1)) {
                return Effect.gen(function*() {
                  yield* Deferred.succeed(entered, undefined)
                  yield* Deferred.await(release)
                  return { navigation: association ? "other" : "error", url: first }
                })
              }
              return Effect.succeed({ navigation: "newer", url: second })
            })
          })
          const target = frame
            ? Tree.addNavigable(state, {
              context: "F1" as BrowsingContext.BrowsingContext,
              parent: "C1" as BrowsingContext.BrowsingContext,
              userContext: "default",
              originalOpener: null,
              url: "about:blank"
            }, false)!
            : page
          const fold = yield* Fold.make({ release: () => Effect.void })
          let cursor = 0
          const pump = Effect.fnUntraced(function*() {
            yield* state.buffer.flush
            while (cursor < facts.length) yield* fold.sink(facts[cursor++]!)
          })
          yield* pump()
          const modelPage = Option.getOrThrow(fold.page(page.id))
          const handlers = Obligations.register(Navigation.register(Kit.handlers<State.Event>()))
          const event = (method: string, navigation: string, url: string) =>
            handlers.apply(method, { context: target.bidi, navigation, url, timestamp: 1 }, { state })
          const prior = association
            ? yield* Navigation.navigate(state, target.id, first, { referrer: Option.none() })
            : undefined
          const running = yield* Effect.forkChild(
            Navigation.navigate(state, target.id, first, { referrer: Option.none() })
          )
          yield* Deferred.await(entered)
          const reserved = target.expected.list[0]!.id
          const errorUrl = "about:neterror?e=dnsNotFound&u=" + encodeURIComponent(first)
          event("browsingContext.navigationCommitted", "error", errorUrl)
          yield* pump()
          const oldId = target.document!.id
          const oldDocument = Option.getOrThrow(fold.document(oldId))
          assert.strictEqual((yield* oldDocument.state.get).url, errorUrl)
          assert.strictEqual(Option.getOrThrow(yield* fold.documentOf(target.id)), oldId)
          yield* Navigation.navigate(state, target.id, second, { referrer: Option.none() })
          event("browsingContext.navigationStarted", "newer", second)
          event("browsingContext.navigationCommitted", "newer", second)
          event("browsingContext.load", "newer", second)
          handlers.apply("browsingContext.userPromptOpened", {
            context: "C1",
            type: "alert",
            message: "still open",
            defaultValue: ""
          }, { state })
          yield* pump()
          const current = target.document!.id
          const modelDocument = Option.getOrThrow(fold.document(current))
          const pageBefore = yield* modelPage.state.get
          assert.strictEqual(pageBefore.status._tag, "Open")
          if (pageBefore.status._tag === "Open") assert.isTrue(Option.isSome(pageBefore.status.prompt))
          const documentBefore = yield* modelDocument.state.get
          assert.strictEqual(documentBefore.readiness, "complete")
          assert.isTrue(yield* Deferred.isDone(oldDocument.ended))
          const realmsBefore = facts.filter((fact) =>
            fact._tag === "RealmAdded" || fact._tag === "RealmDocumentAdded"
          ).length
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(running)
          yield* pump()
          assert.deepStrictEqual(yield* modelPage.state.get, pageBefore)
          assert.deepStrictEqual(yield* modelDocument.state.get, documentBefore)
          assert.strictEqual(Option.getOrThrow(yield* fold.documentOf(target.id)), current)
          assert.isTrue(yield* Deferred.isDone(oldDocument.ended))
          assert.isFalse(realm.ended)
          assert.lengthOf(
            facts.filter((fact) => fact._tag === "RealmAdded" || fact._tag === "RealmDocumentAdded"),
            realmsBefore
          )
          const observed = facts.find((fact) => fact._tag === "DocumentCommitted" && fact.document === oldId)!
          assert.strictEqual(
            observed._tag === "DocumentCommitted" && errorNavigation(facts, observed),
            association ? prior : reserved
          )
          if (association) {
            const outcome = yield* Deferred.await((yield* fold.navigation(prior!)).outcome)
            assert.strictEqual(outcome._tag, "Failed")
            if (outcome._tag === "Failed") assert.isTrue(Option.isNone(outcome.errorDocument))
          } else {
            const outcome = yield* Deferred.await((yield* fold.navigation(reserved)).outcome)
            assert.strictEqual(outcome._tag, "Failed")
            if (outcome._tag === "Failed") assert.deepStrictEqual(outcome.errorDocument, Option.some(oldId))
          }
          assert.isEmpty(target.pendingTerminals)
          Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
          yield* pump()
        })))
    }
  }

  it.effect("does not consume an overlapping same-URL reservation when a fragment already has reply identity", () =>
    Effect.gen(function*() {
      const url = "about:blank#same"
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let calls = 0
      const { facts, page, state } = yield* withPage({
        "browsingContext.navigate": Effect.suspend(() =>
          ++calls === 1
            ? Effect.gen(function*() {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              return { navigation: "first", url }
            })
            : Effect.succeed({ navigation: "second", url })
        )
      })
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      const event = (method: string, navigation: string) =>
        handlers.apply(method, { context: "C1", navigation, url, timestamp: 1 }, { state })
      const running = yield* Effect.forkChild(Navigation.navigate(state, page.id, url, { referrer: Option.none() }))
      yield* Deferred.await(entered)
      const first = page.expected.list[0]!.id
      const second = yield* Navigation.navigate(state, page.id, url, { referrer: Option.none() })
      event("browsingContext.fragmentNavigated", "second")
      yield* Deferred.succeed(release, undefined)
      assert.strictEqual(yield* Fiber.join(running), first)
      event("browsingContext.fragmentNavigated", "first")
      yield* state.buffer.flush
      const outcomes = (id: PageNavigation.Id) =>
        facts.flatMap((fact) => fact._tag === "NavigationEnded" && fact.navigation === id ? [fact.outcome._tag] : [])
      assert.deepStrictEqual(outcomes(second), ["SameDocument"])
      assert.deepStrictEqual(outcomes(first), ["SameDocument"])
      assert.isEmpty(page.expected.list)
      assert.isEmpty(page.commandNavigations)
      assert.isEmpty(page.navigationCommands)
    }))

  for (const source of ["live", "history", "interrupted"] as const) {
    it.effect(`claims one same-document identity with ${source} correlation and overlapping URL reservations`, () =>
      Effect.gen(function*() {
        const url = "about:blank#same"
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        let calls = 0
        const { facts, page, state } = yield* withPage({
          "browsingContext.navigate": Effect.suspend(() => {
            calls++
            const held = source === "live" ? calls === 2 : calls === 1
            return held ?
              Effect.gen(function*() {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
                return { navigation: source === "live" ? "second" : "first", url }
              }) :
              Effect.succeed({ navigation: source === "live" ? "first" : "second", url })
          })
        })
        const handlers = Navigation.register(Kit.handlers<State.Event>())
        const event = (method: string, navigation: string | null) =>
          handlers.apply(method, {
            context: "C1",
            navigation,
            url,
            timestamp: 1
          }, { state })
        const live = source === "live"
          ? yield* Navigation.navigate(state, page.id, url, { referrer: Option.none() }) :
          undefined
        if (source === "live") event("browsingContext.navigationStarted", "first")
        const running = yield* Effect.forkChild(Navigation.navigate(state, page.id, url, { referrer: Option.none() }))
        yield* Deferred.await(entered)
        const held = page.expected.list[0]!.id
        const bound = source === "live" ?
          undefined
          : yield* Navigation.navigate(state, page.id, url, { referrer: Option.none() })
        if (source === "history") {
          // History carries no protocol navigation identity: it can claim one matching expectation,
          // while the exact reply binding for the other command remains its own.
          event("browsingContext.historyUpdated", null)
          event("browsingContext.fragmentNavigated", "second")
        } else {
          event("browsingContext.fragmentNavigated", source === "live" ? "first" : "second")
          assert.deepStrictEqual(page.expected.list.map((expected) => expected.id), [held])
        }
        if (source === "interrupted") yield* Fiber.interrupt(running)
        else {
          yield* Deferred.succeed(release, undefined)
          assert.strictEqual(yield* Fiber.join(running), held)
          if (source === "live") event("browsingContext.fragmentNavigated", "second")
        }
        yield* state.buffer.flush
        const outcomes = (id: PageNavigation.Id) =>
          facts.flatMap((fact) => fact._tag === "NavigationEnded" && fact.navigation === id ? [fact.outcome] : [])
        const heldOutcomes = outcomes(held)
        assert.lengthOf(heldOutcomes, source === "interrupted" ? 0 : 1)
        if (source !== "interrupted") {
          assert.deepStrictEqual(heldOutcomes[0], {
            _tag: "SameDocument",
            document: page.document!.id,
            via: source === "history" ? "historyApi" : "fragment"
          })
        }
        const other = outcomes((live ?? bound)!)
        assert.lengthOf(other, 1)
        assert.deepStrictEqual(other[0], { _tag: "SameDocument", document: page.document!.id, via: "fragment" })
        assert.strictEqual(page.document!.url, url)
        assert.isEmpty(page.expected.list)
        assert.isEmpty(page.commandNavigations)
        assert.isEmpty(page.navigationCommands)
        assert.isEmpty(page.pendingTerminals)
        assert.isEmpty(page.navigations)
        assert.isEmpty(state.navigations)
      }))
  }

  it.effect("keeps a late failed-navigation commit from taking the next navigation id", () =>
    Effect.gen(function*() {
      const facts: Array<Adapter.Fact> = []
      const buffer = yield* Kit.makeFactBuffer((fact) => Effect.sync(() => void facts.push(fact)))
      buffer.connect(control)
      const state = State.make({
        cleanupScope: yield* Effect.scope,
        connect: { sink: () => Effect.void, ownership: "launched" },
        ids: Kit.makeIds(),
        buffer,
        control,
        root: () => ({ drainObserved: Effect.void }) as ProtocolClient.Session
      })
      const page = Tree.addNavigable(state, {
        context: "C1" as BrowsingContext.BrowsingContext,
        userContext: "default",
        originalOpener: null,
        url: "about:blank"
      }, false)!
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      const refusedUrl = "http://127.0.0.1:9/refused"
      const refused = Kit.expect(state.ids, page.expected, refusedUrl)
      // The command has rejected; no navigation event has arrived yet.
      yield* Kit.neverStarted(buffer, {
        drained: Effect.void,
        expectations: page.expected,
        navigable: page.id,
        navigation: refused,
        url: refusedUrl,
        error: "browsingContext.navigate rejected: Unrecognized (Error: deniedPortAccess)",
        evidence: "bidi:browsingContext.navigate"
      })
      const nextUrl = "http://127.0.0.1:12345/hello"
      const next = Kit.expect(state.ids, page.expected, nextUrl)
      // Synthesized ordering inferred from the live failure, not captured protocol traffic.
      // A late error-page commit arrives after the next command reserved its id.
      handlers.apply("browsingContext.navigationCommitted", {
        context: "C1",
        navigation: "browser-refused",
        timestamp: 1,
        url: "about:neterror?e=deniedPortAccess&u=http%3A//127.0.0.1%3A9/refused"
      }, { state })
      handlers.apply("browsingContext.navigationStarted", {
        context: "C1",
        navigation: "browser-hello",
        timestamp: 2,
        url: nextUrl
      }, { state })
      handlers.apply("browsingContext.navigationCommitted", {
        context: "C1",
        navigation: "browser-hello",
        timestamp: 3,
        url: nextUrl
      }, { state })
      yield* buffer.flush
      const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
      const nextEnded = ended.find((fact) => fact.navigation === next)
      assert.isDefined(nextEnded)
      assert.strictEqual(nextEnded!.outcome._tag, "Committed")
    }))

  it.effect("keeps a late failed-navigation commit from taking the id of a retry to the same URL", () =>
    Effect.gen(function*() {
      const facts: Array<Adapter.Fact> = []
      const buffer = yield* Kit.makeFactBuffer((fact) => Effect.sync(() => void facts.push(fact)))
      buffer.connect(control)
      const state = State.make({
        cleanupScope: yield* Effect.scope,
        connect: { sink: () => Effect.void, ownership: "launched" },
        ids: Kit.makeIds(),
        buffer,
        control,
        root: () => ({ drainObserved: Effect.void }) as ProtocolClient.Session
      })
      const page = Tree.addNavigable(state, {
        context: "C1" as BrowsingContext.BrowsingContext,
        userContext: "default",
        originalOpener: null,
        url: "about:blank"
      }, false)!
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      const refusedUrl = "http://127.0.0.1:9/refused"
      const refused = Kit.expect(state.ids, page.expected, refusedUrl)
      // The command has rejected; no navigation event has arrived yet.
      yield* Kit.neverStarted(buffer, {
        drained: Effect.void,
        expectations: page.expected,
        navigable: page.id,
        navigation: refused,
        url: refusedUrl,
        error: "browsingContext.navigate rejected: Unrecognized (Error: deniedPortAccess)",
        evidence: "bidi:browsingContext.navigate"
      })
      // The retry goes to the same URL, which the server now accepts.
      const nextUrl = refusedUrl
      const next = Kit.expect(state.ids, page.expected, nextUrl)
      // Synthesized ordering inferred from the live failure, not captured protocol traffic.
      // A late error-page commit arrives after the next command reserved its id.
      handlers.apply("browsingContext.navigationCommitted", {
        context: "C1",
        navigation: "browser-refused",
        timestamp: 1,
        url: "about:neterror?e=deniedPortAccess&u=http%3A//127.0.0.1%3A9/refused"
      }, { state })
      handlers.apply("browsingContext.navigationStarted", {
        context: "C1",
        navigation: "browser-retry",
        timestamp: 2,
        url: nextUrl
      }, { state })
      handlers.apply("browsingContext.navigationCommitted", {
        context: "C1",
        navigation: "browser-retry",
        timestamp: 3,
        url: nextUrl
      }, { state })
      yield* buffer.flush
      const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
      const nextEnded = ended.find((fact) => fact.navigation === next)
      assert.isDefined(nextEnded)
      assert.strictEqual(nextEnded!.outcome._tag, "Committed")
    }))

  for (
    const scenario of [
      { name: "matches an ordinary error-page commit to its command reply id", started: false, matches: true },
      { name: "keeps a started navigation correlated through a redirected error page", started: true, matches: false },
      { name: "keeps redirect URL fallback on navigationStarted", started: true, matches: true }
    ]
  ) {
    it.effect(scenario.name, () =>
      Effect.gen(function*() {
        const { facts, page, state } = yield* withPage({
          "browsingContext.navigate": { navigation: "N1", url: "http://example.com/" }
        })
        const handlers = Navigation.register(Kit.handlers<State.Event>())
        const url = "http://example.com/"
        const reserved = scenario.started
          ? Kit.expect(state.ids, page.expected, url)
          : yield* Navigation.navigate(state, page.id, url, { referrer: Option.none() })
        const next = Kit.expect(state.ids, page.expected, "http://next.example/")
        const errorUrl = "about:neterror?e=dnsNotFound&u=" +
          encodeURIComponent(scenario.matches ? url : "http://redirect.example/")
        if (scenario.started) {
          handlers.apply("browsingContext.navigationStarted", {
            context: "C1",
            navigation: "N1",
            timestamp: 1,
            url: "http://redirect.example/"
          }, { state })
          assert.strictEqual(state.navigations.get("N1")?.id, reserved)
        }
        handlers.apply("browsingContext.navigationCommitted", {
          context: "C1",
          navigation: "N1",
          timestamp: 2,
          url: errorUrl
        }, { state })
        const document = page.document!
        assert.strictEqual(document.url, errorUrl)
        assert.deepStrictEqual(page.expected.list.map((entry) => entry.id), [next])
        // The error document belongs to the reserved navigation even without a start event.
        yield* state.buffer.flush
        const ended = facts.find((fact) => fact._tag === "NavigationEnded" && fact.navigation === reserved)
        assert.isDefined(ended)
        assert.strictEqual(ended!._tag === "NavigationEnded" && ended!.outcome._tag, "Failed")
        const committed = facts.find((fact) => fact._tag === "DocumentCommitted" && fact.document === document.id)
        assert.isDefined(committed)
        assert.deepStrictEqual(committed!._tag === "DocumentCommitted" && committed!.createdBy, {
          _tag: "ErrorPage",
          navigation: reserved
        })
      }))
  }

  for (const beforeReply of [true, false]) {
    for (const late of [true, false]) {
      it.effect(`correlates ${late ? "a same-URL retry" : "an ordinary error page"} with events ${beforeReply ? "before" : "after"} its reply`, () =>
        Effect.gen(function*() {
          const url = "http://example.com/"
          const errorUrl = "about:neterror?e=dnsNotFound&u=" + encodeURIComponent(url)
          let deliver = () => {}
          let reject = late
          const { facts, page, state } = yield* withPage({
            "browsingContext.navigate": Effect.suspend(() => {
              if (reject) {
                reject = false
                return Effect.fail(
                  new Protocol.ProtocolError({
                    reason: new Protocol.Rejected({
                      method: "browsingContext.navigate",
                      reason: "Unrecognized",
                      code: "unknown error",
                      description: "connection refused"
                    })
                  })
                )
              }
              if (beforeReply) deliver()
              return Effect.succeed({ navigation: "own", url })
            })
          })
          const handlers = Navigation.register(Kit.handlers<State.Event>())
          const event = (method: string, navigation: string, url: string) =>
            handlers.apply(method, { context: "C1", navigation, url, timestamp: 1 }, { state })
          deliver = () => {
            if (late) event("browsingContext.navigationCommitted", "old", errorUrl)
            if (late) event("browsingContext.navigationStarted", "own", url)
            event("browsingContext.navigationCommitted", "own", late ? url : errorUrl)
          }
          const refused = late
            ? yield* Navigation.navigate(state, page.id, url, { referrer: Option.none() })
            : undefined
          const reserved = yield* Navigation.navigate(state, page.id, url, { referrer: Option.none() })
          if (!beforeReply) deliver()
          yield* state.buffer.flush
          const ended = facts.filter((fact) => fact._tag === "NavigationEnded").filter((fact) =>
            fact.navigation === reserved
          )
          assert.lengthOf(ended, 1)
          assert.strictEqual(ended[0]!.outcome._tag, late ? "Committed" : "Failed")
          assert.strictEqual(page.document!.url, late ? url : errorUrl)
          if (late) {
            assert.deepStrictEqual(
              facts.filter((fact) => fact._tag === "NavigationStarted").map((fact) => fact.navigation),
              [refused, reserved]
            )
            const errorDocument = facts.find((fact) =>
              fact._tag === "DocumentCommitted" &&
              (fact.createdBy._tag === "ErrorPage" || fact.createdBy._tag === "UnattributedErrorPage")
            )
            assert.isDefined(errorDocument)
            assert.strictEqual(
              errorDocument!._tag === "DocumentCommitted" && errorNavigation(facts, errorDocument!),
              refused!
            )
          }
          assert.isEmpty(page.expected.list)
          assert.isEmpty(page.commandNavigations)
          assert.isEmpty(page.navigationCommands)
          assert.isEmpty(page.pendingTerminals)
          assert.isUndefined(page.failedNavigation)
        }))
    }
  }

  it.effect("ends a download navigation whose start waits behind a late failure of the download before it", () =>
    Effect.gen(function*() {
      const noContent = "http://example.com/first-download"
      const download = "http://example.com/download"
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let calls = 0
      const { facts, page, state } = yield* withPage({
        "browsingContext.navigate": Effect.suspend(() =>
          ++calls === 1
            ? Effect.succeed({ navigation: "n1", url: noContent })
            : Effect.andThen(
              Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
              Effect.succeed({ navigation: "n2", url: download })
            )
        )
      })
      const handlers = Contexts.register(Navigation.register(Kit.handlers<State.Event>()))
      const event = (method: string, params: Record<string, unknown>) =>
        handlers.apply(method, { context: "C1", timestamp: 1, ...params }, { state })
      // Synthesized ordering, not captured protocol traffic.
      // The first navigation becomes a download, which ends it before the next command is sent.
      const first = yield* Navigation.navigate(state, page.id, noContent, { referrer: Option.none() })
      event("browsingContext.navigationStarted", { navigation: "n1", url: noContent })
      event("browsingContext.downloadWillBegin", {
        navigation: "n1",
        url: noContent,
        download: "D0",
        suggestedFilename: "first.bin"
      })
      // The next command's reply is held. A late terminal event for the ended first navigation arrives,
      // then the download navigation starts, and its download begins.
      const running = yield* Effect.forkChild(
        Navigation.navigate(state, page.id, download, { referrer: Option.none() })
      )
      yield* Deferred.await(entered)
      event("browsingContext.navigationFailed", { navigation: "n1", url: noContent })
      event("browsingContext.navigationStarted", { navigation: "n2", url: download })
      event("browsingContext.downloadWillBegin", {
        navigation: "n2",
        url: download,
        download: "D1",
        suggestedFilename: "file.bin"
      })
      yield* Deferred.succeed(release, undefined)
      const reserved = yield* Fiber.join(running)
      yield* state.buffer.flush
      const outcomes = (id: unknown) =>
        facts.flatMap((fact) => fact._tag === "NavigationEnded" && fact.navigation === id ? [fact.outcome._tag] : [])
      assert.deepStrictEqual(outcomes(first), ["Download"])
      assert.deepStrictEqual(outcomes(reserved), ["Download"])
      handlers.apply("browsingContext.downloadEnd", {
        context: "C1",
        download: "D1",
        status: "complete",
        filepath: "/tmp/download"
      }, { state })
      yield* state.buffer.flush
      // Navigation and download completion are separate observations; neither may be lost behind correlation.
      assert.isTrue(facts.some((fact) => fact._tag === "DownloadEnded" && fact.outcome._tag === "Completed"))
      assert.isEmpty(page.pendingTerminals)
      assert.isEmpty(page.expected.list)
      assert.isEmpty(page.commandNavigations)
      assert.isEmpty(page.navigationCommands)
    }))

  it.effect("keeps a navigation whose commit waits behind a held error page from being superseded by a later start", () =>
    Effect.gen(function*() {
      const refusedUrl = "http://127.0.0.1:9/refused"
      const first = "http://first.example/"
      const second = "http://second.example/"
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let calls = 0
      const { facts, page, state } = yield* withPage({
        "browsingContext.navigate": Effect.suspend(() => {
          calls++
          if (calls === 1) {
            return Effect.fail(
              new Protocol.ProtocolError({
                reason: new Protocol.Rejected({
                  method: "browsingContext.navigate",
                  reason: "Unrecognized",
                  code: "unknown error",
                  description: "connection refused"
                })
              })
            )
          }
          return calls === 2
            ? Effect.andThen(
              Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
              Effect.succeed({ navigation: "na", url: first })
            )
            : Effect.succeed({ navigation: "nb", url: second })
        })
      })
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      const event = (method: string, navigation: string, url: string) =>
        handlers.apply(method, { context: "C1", navigation, url, timestamp: 1 }, { state })
      yield* Navigation.navigate(state, page.id, refusedUrl, { referrer: Option.none() })
      // Synthesized ordering, not captured protocol traffic.
      // The first command's reply is held. Its navigation starts, the refused navigation's late error page
      // arrives and is held, and the first navigation commits behind it.
      const running = yield* Effect.forkChild(Navigation.navigate(state, page.id, first, { referrer: Option.none() }))
      yield* Deferred.await(entered)
      event("browsingContext.navigationStarted", "na", first)
      event(
        "browsingContext.navigationCommitted",
        "browser-refused",
        "about:neterror?e=connectionFailure&u=" + encodeURIComponent(refusedUrl)
      )
      event("browsingContext.navigationCommitted", "na", first)
      // On the wire the first navigation has committed when the second starts.
      const reserved = yield* Navigation.navigate(state, page.id, second, { referrer: Option.none() })
      event("browsingContext.navigationStarted", "nb", second)
      yield* Deferred.succeed(release, undefined)
      const firstId = yield* Fiber.join(running)
      event("browsingContext.navigationCommitted", "nb", second)
      yield* state.buffer.flush
      const outcomes = (id: unknown) =>
        facts.flatMap((fact) => fact._tag === "NavigationEnded" && fact.navigation === id ? [fact.outcome._tag] : [])
      assert.deepStrictEqual(outcomes(firstId), ["Committed"])
      assert.deepStrictEqual(outcomes(reserved), ["Committed"])
      assert.strictEqual(page.document!.url, second)
    }))

  for (const commitFirst of [true, false]) {
    for (const completion of ["reply", "rejected", "interrupted"] as const) {
      it.effect(`orders a queued start after ${commitFirst ? "a commit" : "an in-flight navigation"} when its command is ${completion}`, () =>
        Effect.gen(function*() {
          const refusedUrl = "http://refused.example/"
          const first = "http://first.example/"
          const second = "http://second.example/"
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const secondEntered = yield* Deferred.make<void>()
          const secondRelease = yield* Deferred.make<void>()
          let calls = 0
          let secondReserved: PageNavigation.Id | undefined
          let startSecond = () => {}
          const rejected = () =>
            new Protocol.ProtocolError({
              reason: new Protocol.Rejected({
                method: "browsingContext.navigate",
                reason: "Unrecognized",
                code: "unknown error",
                description: "refused"
              })
            })
          const { facts, page, state } = yield* withPage({
            "browsingContext.navigate": Effect.suspend(() => {
              const call = calls++
              if (call === 0) return Effect.fail(rejected())
              if (call === 1) {
                return Effect.gen(function*() {
                  yield* Deferred.succeed(entered, undefined)
                  yield* Deferred.await(release)
                  return { navigation: "na", url: first }
                })
              }
              return Effect.gen(function*() {
                secondReserved = page.expected.list.find((entry) => entry.url === second)!.id
                startSecond()
                yield* Deferred.succeed(secondEntered, undefined)
                yield* Deferred.await(secondRelease)
                if (completion === "rejected") return yield* Effect.fail(rejected())
                return { navigation: "nb", url: second }
              })
            })
          })
          const handlers = Navigation.register(Kit.handlers<State.Event>())
          const event = (method: string, navigation: string, url: string) =>
            handlers.apply(method, { context: "C1", navigation, url, timestamp: 1 }, { state })
          startSecond = () => event("browsingContext.navigationStarted", "nb", second)
          const refused = yield* Navigation.navigate(state, page.id, refusedUrl, { referrer: Option.none() })
          const running = yield* Effect.forkChild(
            Navigation.navigate(state, page.id, first, { referrer: Option.none() })
          )
          yield* Deferred.await(entered)
          const firstReserved = page.expected.list.find((entry) => entry.url === first)!.id
          event("browsingContext.navigationStarted", "na", first)
          const errorUrl = "about:neterror?e=connectionFailure&u=" + encodeURIComponent(refusedUrl)
          event("browsingContext.navigationCommitted", "browser-refused", errorUrl)
          if (commitFirst) event("browsingContext.navigationCommitted", "na", first)
          const secondRunning = yield* Effect.forkChild(
            Navigation.navigate(state, page.id, second, { referrer: Option.none() })
          )
          yield* Deferred.await(secondEntered)
          if (!commitFirst) event("browsingContext.navigationCommitted", "na", first)
          if (completion === "interrupted") yield* Fiber.interrupt(secondRunning)
          else {
            yield* Deferred.succeed(secondRelease, undefined)
            assert.strictEqual(yield* Fiber.join(secondRunning), secondReserved)
          }
          yield* Deferred.succeed(release, undefined)
          assert.strictEqual(yield* Fiber.join(running), firstReserved)
          event("browsingContext.navigationCommitted", "nb", second)
          yield* state.buffer.flush
          const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
          assert.deepStrictEqual(
            ended.filter((fact) => fact.navigation === firstReserved).map((fact) => fact.outcome._tag),
            [commitFirst ? "Committed" : "Superseded"]
          )
          assert.deepStrictEqual(
            ended.filter((fact) => fact.navigation === secondReserved).map((fact) => fact.outcome._tag),
            ["Committed"]
          )
          assert.deepStrictEqual(
            facts.filter((fact) => fact._tag === "NavigationStarted").map((fact) => fact.navigation),
            [refused, firstReserved, secondReserved!]
          )
          const documents = facts.filter((fact) => fact._tag === "DocumentCommitted")
          assert.deepStrictEqual(documents.find((fact) => fact.url === first)!.createdBy, {
            _tag: "Navigation",
            navigation: firstReserved
          })
          assert.strictEqual(errorNavigation(facts, documents.find((fact) => fact.url === errorUrl)!), refused)
          assert.deepStrictEqual(documents.at(-1)!.createdBy, { _tag: "Navigation", navigation: secondReserved! })
          assert.strictEqual(page.document!.url, second)
          assert.isEmpty(page.expected.list)
          assert.isEmpty(page.commandNavigations)
          assert.isEmpty(page.navigationCommands)
          assert.isEmpty(page.pendingTerminals)
          assert.isEmpty(page.navigations)
          assert.isEmpty(state.navigations)
        }))
    }
  }

  it.effect("clears queued starts and their retained command identities when the page closes", () =>
    Effect.gen(function*() {
      const first = "http://first.example/"
      const second = "http://second.example/"
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let calls = 0
      const { facts, page, state } = yield* withPage({
        "browsingContext.navigate": Effect.suspend(() =>
          ++calls === 1
            ? Effect.gen(function*() {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(release)
              return { navigation: "na", url: first }
            })
            : Effect.succeed({ navigation: "nb", url: second })
        )
      })
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      const event = (method: string, navigation: string, url: string) =>
        handlers.apply(method, { context: "C1", navigation, url, timestamp: 1 }, { state })
      const running = yield* Effect.forkChild(Navigation.navigate(state, page.id, first, { referrer: Option.none() }))
      yield* Deferred.await(entered)
      const firstReserved = page.expected.list[0]!.id
      event("browsingContext.navigationStarted", "na", first)
      event("browsingContext.navigationCommitted", "older", "about:neterror?e=dnsNotFound&u=http://older.example/")
      const secondReserved = yield* Navigation.navigate(state, page.id, second, { referrer: Option.none() })
      event("browsingContext.navigationStarted", "nb", second)
      assert.strictEqual(state.navigations.get("nb")?.id, secondReserved)
      assert.isNotEmpty(page.pendingTerminals)
      const firstEntry = state.navigations.get("nb")!
      Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
      assert.isTrue(firstEntry.ended)
      yield* Deferred.succeed(release, undefined)
      assert.strictEqual(yield* Fiber.join(running), firstReserved)
      yield* state.buffer.flush
      assert.deepStrictEqual(facts.filter((fact) => fact._tag === "NavigationStarted").map((fact) => fact.navigation), [
        firstReserved,
        secondReserved
      ])
      assert.lengthOf(facts.filter((fact) => fact._tag === "DocumentCommitted"), 2)
      assert.isEmpty(page.expected.list)
      assert.isEmpty(page.commandNavigations)
      assert.isEmpty(page.navigationCommands)
      assert.isEmpty(page.pendingTerminals)
      assert.isEmpty(page.navigations)
      assert.isEmpty(state.navigations)
    }))

  it.effect("keeps an overlapping command's early error commit for that command when another navigation starts", () =>
    Effect.gen(function*() {
      const first = "http://first.example/"
      const second = "http://second.example/"
      const errorUrl = "about:neterror?e=dnsNotFound&u=" + encodeURIComponent(first)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let calls = 0
      const { facts, page, state } = yield* withPage({
        "browsingContext.navigate": Effect.suspend(() =>
          ++calls === 1
            ? Effect.andThen(
              Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
              Effect.succeed({ navigation: "na", url: first })
            )
            : Effect.succeed({ navigation: "nb", url: second })
        )
      })
      const handlers = Navigation.register(Kit.handlers<State.Event>())
      const event = (method: string, navigation: string, url: string) =>
        handlers.apply(method, { context: "C1", navigation, url, timestamp: 1 }, { state })
      // Synthesized ordering, not captured protocol traffic.
      // The first command's error page commits, unannounced, before the first command's reply.
      const running = yield* Effect.forkChild(Navigation.navigate(state, page.id, first, { referrer: Option.none() }))
      yield* Deferred.await(entered)
      event("browsingContext.navigationCommitted", "na", errorUrl)
      // A second command overlaps it; its navigation starts before the first command's reply.
      const reserved = yield* Navigation.navigate(state, page.id, second, { referrer: Option.none() })
      event("browsingContext.navigationStarted", "nb", second)
      yield* Deferred.succeed(release, undefined)
      const refused = yield* Fiber.join(running)
      event("browsingContext.navigationCommitted", "nb", second)
      yield* state.buffer.flush
      const ended = (id: unknown) => facts.filter((fact) => fact._tag === "NavigationEnded" && fact.navigation === id)
      assert.lengthOf(ended(reserved), 1)
      // The first command's error page belongs to it: its navigation ends Failed, with that error document.
      assert.lengthOf(ended(refused), 1)
      const outcome = ended(refused)[0]!
      assert.strictEqual(outcome._tag === "NavigationEnded" && outcome.outcome._tag, "Failed")
      assert.isEmpty(page.commandNavigations)
    }))

  for (const kind of ["commit", "failure", "abort"] as const) {
    for (const completion of ["reply", "rejected", "interrupted"] as const) {
      for (const newerCommitsFirst of [false, true]) {
        it.effect(`retains an overlapping ${kind} until ${completion}, newer commit ${newerCommitsFirst ? "before" : "after"} completion`, () =>
          Effect.gen(function*() {
            const first = "http://first.example/"
            const second = "http://second.example/"
            const errorUrl = "about:neterror?e=dnsNotFound&u=" + encodeURIComponent(first)
            const entered = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            let calls = 0
            const { facts, page, state } = yield* withPage({
              "browsingContext.navigate": Effect.suspend(() =>
                ++calls === 1
                  ? Effect.gen(function*() {
                    yield* Deferred.succeed(entered, undefined)
                    yield* Deferred.await(release)
                    if (completion === "rejected") {
                      return yield* Effect.fail(
                        new Protocol.ProtocolError({
                          reason: new Protocol.Rejected({
                            method: "browsingContext.navigate",
                            reason: "Unrecognized",
                            code: "unknown error",
                            description: "refused"
                          })
                        })
                      )
                    }
                    return { navigation: "na", url: first }
                  })
                  : Effect.succeed({ navigation: "nb", url: second })
              )
            })
            const handlers = Navigation.register(Kit.handlers<State.Event>())
            const event = (method: string, navigation: string, url: string) =>
              handlers.apply(method, { context: "C1", navigation, url, timestamp: 1 }, { state })
            const running = yield* Effect.forkChild(
              Navigation.navigate(state, page.id, first, { referrer: Option.none() })
            )
            yield* Deferred.await(entered)
            const firstReserved = page.expected.list[0]!.id
            if (kind !== "commit") {
              event(
                kind === "failure" ? "browsingContext.navigationFailed" : "browsingContext.navigationAborted",
                "na",
                first
              )
            }
            event("browsingContext.navigationCommitted", "na", errorUrl)
            const secondReserved = yield* Navigation.navigate(state, page.id, second, { referrer: Option.none() })
            event("browsingContext.navigationStarted", "nb", second)
            assert.isNotEmpty(page.pendingTerminals)
            if (newerCommitsFirst) {
              event("browsingContext.navigationCommitted", "nb", second)
              event("browsingContext.load", "nb", second)
              event("browsingContext.fragmentNavigated", "fragment", second + "#new")
            }
            if (completion === "interrupted") yield* Fiber.interrupt(running)
            else {
              yield* Deferred.succeed(release, undefined)
              assert.strictEqual(yield* Fiber.join(running), firstReserved)
            }
            if (!newerCommitsFirst) {
              event("browsingContext.navigationCommitted", "nb", second)
              event("browsingContext.load", "nb", second)
              event("browsingContext.fragmentNavigated", "fragment", second + "#new")
            }
            yield* state.buffer.flush
            const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
            const firstEnded = ended.filter((fact) => fact.navigation === firstReserved)
            if (completion === "interrupted") assert.isEmpty(firstEnded)
            else {
              assert.lengthOf(firstEnded, 1)
              assert.strictEqual(firstEnded[0]!.outcome._tag, "Failed")
            }
            const secondEnded = ended.filter((fact) => fact.navigation === secondReserved)
            assert.lengthOf(secondEnded, 1)
            assert.strictEqual(secondEnded[0]!.outcome._tag, "Committed")
            const documents = facts.filter((fact) => fact._tag === "DocumentCommitted")
            const errorDocument = documents.find((fact) => fact.url === errorUrl)!
            assert.isDefined(errorDocument)
            if (completion === "interrupted") assert.isUndefined(errorNavigation(facts, errorDocument))
            else assert.strictEqual(errorNavigation(facts, errorDocument), firstReserved)
            assert.strictEqual(documents.at(-1)!.url, second)
            assert.strictEqual(page.document!.url, second + "#new")
            assert.isTrue(page.document!.complete)
            assert.deepStrictEqual(documents.at(-1)!.createdBy, { _tag: "Navigation", navigation: secondReserved })
            assert.isEmpty(page.expected.list)
            assert.isEmpty(page.commandNavigations)
            assert.isEmpty(page.navigationCommands)
            assert.isEmpty(page.pendingTerminals)
            assert.isUndefined(page.failedNavigation)
          }))
      }
    }
  }

  for (const mode of ["rejected", "unsupported", "interrupted", "removed"] as const) {
    it.effect(`cleans up navigation correlation when the command is ${mode}`, () =>
      Effect.gen(function*() {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        let deliver = () => {}
        const url = "http://example.com/"
        const { facts, page, state } = yield* withPage({
          "browsingContext.navigate": Effect.gen(function*() {
            deliver()
            yield* Deferred.succeed(entered, undefined)
            if (mode === "interrupted" || mode === "removed") yield* Deferred.await(release)
            if (mode === "rejected") {
              return yield* Effect.fail(
                new Protocol.ProtocolError({
                  reason: new Protocol.Rejected({
                    method: "browsingContext.navigate",
                    reason: "Unrecognized",
                    code: "unknown error",
                    description: "refused"
                  })
                })
              )
            }
            if (mode === "unsupported") {
              return yield* Effect.fail(
                new Protocol.ProtocolError({
                  reason: new Protocol.Unsupported({ method: "browsingContext.navigate" })
                })
              )
            }
            return { navigation: "own", url }
          })
        })
        const handlers = Navigation.register(Kit.handlers<State.Event>())
        deliver = () =>
          handlers.apply("browsingContext.navigationCommitted", {
            context: "C1",
            navigation: "own",
            timestamp: 1,
            url: "about:neterror?e=dnsNotFound&u=" + encodeURIComponent(url)
          }, { state })
        const running = yield* Effect.forkChild(Effect.exit(
          Navigation.navigate(state, page.id, url, { referrer: Option.none() })
        ))
        yield* Deferred.await(entered)
        if (mode === "interrupted") yield* Fiber.interrupt(running)
        else {
          if (mode === "removed") {
            Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
            yield* Deferred.succeed(release, undefined)
          }
          const exit = yield* Fiber.join(running)
          assert.strictEqual(exit._tag, mode === "unsupported" ? "Failure" : "Success")
        }
        yield* state.buffer.flush
        assert.isEmpty(page.expected.list)
        assert.isEmpty(page.navigationCommands)
        assert.isEmpty(page.commandNavigations)
        assert.isEmpty(page.pendingTerminals)
        assert.isUndefined(page.failedNavigation)
        if (mode === "rejected") {
          const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
          assert.lengthOf(ended, 1)
          assert.strictEqual(ended[0]!.outcome._tag, "Failed")
          const errorDocument = facts.find((fact) =>
            fact._tag === "DocumentCommitted" &&
            (fact.createdBy._tag === "ErrorPage" || fact.createdBy._tag === "UnattributedErrorPage")
          )
          assert.isDefined(errorDocument)
          assert.strictEqual(
            errorDocument!._tag === "DocumentCommitted" && errorNavigation(facts, errorDocument!),
            ended[0]!.navigation
          )
        }
      }))
  }

  for (const beforeReply of [true, false]) {
    it.effect(`keeps a failed navigation's late document with events ${beforeReply ? "before" : "after"} its reply`, () =>
      Effect.gen(function*() {
        let deliver = () => {}
        const url = "http://example.com/"
        const { facts, page, state } = yield* withPage({
          "browsingContext.navigate": Effect.sync(() => {
            if (beforeReply) deliver()
            return { navigation: "own", url }
          })
        })
        const handlers = Navigation.register(Kit.handlers<State.Event>())
        const event = (method: string, url: string) =>
          handlers.apply(method, { context: "C1", navigation: "own", timestamp: 1, url }, { state })
        deliver = () => {
          event("browsingContext.navigationFailed", url)
          event("browsingContext.navigationCommitted", "about:neterror?e=dnsNotFound&u=" + encodeURIComponent(url))
        }
        const reserved = yield* Navigation.navigate(state, page.id, url, { referrer: Option.none() })
        if (!beforeReply) deliver()
        yield* state.buffer.flush
        const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
        assert.lengthOf(ended, 1)
        assert.strictEqual(ended[0]!.navigation, reserved)
        assert.strictEqual(ended[0]!.outcome._tag, "Failed")
        const document = facts.filter((fact) => fact._tag === "DocumentCommitted").at(-1)!
        assert.strictEqual(errorNavigation(facts, document), reserved)
        assert.isEmpty(page.commandNavigations)
        assert.isEmpty(page.pendingTerminals)
        assert.isUndefined(page.failedNavigation)
      }))
  }

  for (const beforeReply of [true, false]) {
    it.effect(`correlates a reload's unannounced error commit ${beforeReply ? "before" : "after"} its reply`, () =>
      Effect.gen(function*() {
        let deliver = () => {}
        const url = "http://example.com/"
        const { facts, page, state } = yield* withPage({
          "browsingContext.reload": Effect.sync(() => {
            if (beforeReply) deliver()
            return { navigation: "reload", url }
          })
        })
        page.document!.url = url
        const handlers = Navigation.register(Kit.handlers<State.Event>())
        deliver = () =>
          handlers.apply("browsingContext.navigationCommitted", {
            context: "C1",
            navigation: "reload",
            timestamp: 1,
            url: "about:neterror?e=dnsNotFound&u=" + encodeURIComponent(url)
          }, { state })
        const reserved = yield* Navigation.reload(state, page.id, { ignoreCache: false })
        if (!beforeReply) deliver()
        yield* state.buffer.flush
        const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
        assert.lengthOf(ended, 1)
        assert.strictEqual(ended[0]!.navigation, reserved)
        assert.strictEqual(ended[0]!.outcome._tag, "Failed")
        const started = facts.filter((fact) => fact._tag === "NavigationStarted")
        assert.lengthOf(started, 1)
        assert.strictEqual(started[0]!.initiatedAs, "reload")
        assert.isEmpty(page.expected.list)
        assert.isEmpty(page.commandNavigations)
        assert.isEmpty(page.pendingTerminals)
      }))
  }

  it.effect("drops a reply binding when its page closes before the event", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage({
        "browsingContext.navigate": { navigation: "own", url: "http://example.com/" }
      })
      yield* Navigation.navigate(state, page.id, "http://example.com/", { referrer: Option.none() })
      assert.strictEqual(page.commandNavigations.size, 1)
      Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
      assert.isEmpty(page.commandNavigations)
      assert.isEmpty(page.expected.list)
    }))

  it.effect("fails an operation on a page that ended as Gone, with why it ended", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage()
      Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
      const error = yield* State.navigableById(state, page.id).pipe(Effect.flip)
      assert.deepStrictEqual(error.reason, {
        _tag: "Gone",
        target: { _tag: "Page", id: page.id },
        reason: new Target.PageClosed({ by: "command" })
      })
      const foreign = yield* State.navigableById(state, Kit.makeIds().navigable()).pipe(Effect.flip)
      assert.strictEqual(foreign.reason._tag, "Foreign")
    }))

  it.effect("fails the realm of a document that ended as Gone, and a realm that ended", () =>
    Effect.gen(function*() {
      const { document, page, realm, state } = yield* withPage()
      Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
      const replaced = yield* Evaluation.realm(state, document.id, { _tag: "Main" }).pipe(Effect.flip)
      assert.deepStrictEqual(replaced.reason, {
        _tag: "Gone",
        target: { _tag: "Document", id: document.id },
        reason: new Target.DocumentReplaced({})
      })
      const ended = yield* Evaluation.evaluate(state, realm.id, {
        functionDeclaration: "() => 1",
        arguments: [],
        awaitPromise: false,
        result: "value",
        userActivation: false
      }).pipe(Effect.flip)
      assert.strictEqual(ended.reason._tag, "Gone")
    }))

  it.effect("drops the pending realms of a page that is removed, reporting none of them", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage()
      const pending: State.RealmEntry = {
        id: state.ids.realm(),
        bidi: "R2" as Script.Realm,
        navigable: page,
        world: { _tag: "Main" },
        origin: "null",
        ended: false,
        pending: true,
        held: []
      }
      state.realms.set(pending.bidi, pending)
      state.realmsById.set(pending.id, pending)
      page.pendingRealms.push(pending)
      Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
      assert.isTrue(pending.ended)
      assert.isFalse(state.realms.has(pending.bidi))
      assert.isFalse(state.realmsById.has(pending.id))
      assert.strictEqual(page.pendingRealms.length, 0)
    }))

  it.effect("skips late handle release when the reply omits its required realm", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, BidiWire.wire)
      const fiber = yield* client.root.send(Script.evaluate({
        expression: "({})",
        target: { realm: "REQUEST" as Script.Realm },
        awaitPromise: false,
        resultOwnership: "root"
      })).pipe(Effect.forkChild)
      const sent = yield* browser.next
      yield* Fiber.interrupt(fiber)
      yield* browser.receive({
        type: "success",
        id: sent.id,
        result: { type: "success", result: { type: "object", handle: "H" } }
      })
      yield* browser.delivered
      assert.isTrue(Option.isNone(yield* browser.next.pipe(BrowserClock.timeoutOn(BrowserClock.live, 100))))
    }))

  for (const mode of ["consumed", "custom"] as const) {
    it.effect(`keeps BiDi ${mode} results under their caller's control`, () =>
      Effect.gen(function*() {
        const browser = yield* makeBrowser
        const client = yield* ProtocolClient.make(browser.transport, BidiWire.wire)
        const late = yield* Deferred.make<Protocol.LateReply>()
        const fiber = yield* client.root.send(Script.evaluate({
          expression: "({})",
          target: { realm: "REQUEST" as Script.Realm },
          awaitPromise: false,
          resultOwnership: "root"
        })).pipe(
          Protocol.withLateReplyHandler((reply) => Deferred.succeed(late, reply).pipe(Effect.asVoid)),
          Effect.forkChild
        )
        const sent = yield* browser.next
        if (mode === "custom") yield* Fiber.interrupt(fiber)
        const result = { type: "success", realm: "REPLY", result: { type: "object", handle: "H" } }
        yield* browser.receive({ type: "success", id: sent.id, result })
        yield* browser.delivered
        if (mode === "consumed") assert.deepStrictEqual<unknown>(yield* Fiber.join(fiber), result)
        const cleanup = yield* browser.next.pipe(BrowserClock.timeoutOn(BrowserClock.live, 100))
        assert.isTrue(Option.isNone(cleanup))
        if (mode === "custom") {
          const reply = yield* Deferred.await(late)
          assert.deepStrictEqual(reply.result, result)
          const release = yield* reply.release.pipe(Effect.forkChild)
          const command = yield* browser.next
          assert.strictEqual(command.method, "script.disown")
          assert.deepStrictEqual(command.params, { handles: ["H"], target: { realm: "REPLY" } })
          yield* browser.receive({ type: "success", id: command.id, result: {} })
          yield* Fiber.join(release)
        }
      }))
  }

  for (const method of ["callFunction", "evaluate"] as const) {
    for (const kind of ["success", "exception"] as const) {
      for (const ending of ["interrupt", "timeout"] as const) {
        for (const ownership of ["root", "none"] as const) {
          it.effect(`late ${method} ${kind} after ${ending} with ${ownership} ownership`, () =>
            Effect.gen(function*() {
              const browser = yield* makeBrowser
              const client = yield* ProtocolClient.make(browser.transport, BidiWire.wire)
              const common = {
                target: { realm: "REQUEST" as Script.Realm },
                awaitPromise: false,
                resultOwnership: ownership
              }
              const send = method === "evaluate"
                ? client.root.send(Script.evaluate({ ...common, expression: "({})" }))
                : client.root.send(Script.callFunction({ ...common, functionDeclaration: "() => ({})" }))
              const fiber = yield* send.pipe(
                Protocol.withCommandTimeout(ending === "timeout" ? "20 millis" : "30 seconds"),
                Effect.forkChild
              )
              const sent = yield* browser.next
              if (ending === "interrupt") yield* Fiber.interrupt(fiber)
              else yield* Fiber.await(fiber)
              const value = ownership === "root" ? { type: "object", handle: "LATE" } : { type: "undefined" }
              yield* browser.receive({
                type: "success",
                id: sent.id,
                result: kind === "success"
                  ? { type: kind, realm: "REPLY", result: value }
                  : {
                    type: kind,
                    realm: "REPLY",
                    exceptionDetails: {
                      exception: value,
                      text: "boom",
                      lineNumber: 0,
                      columnNumber: 0,
                      stackTrace: { callFrames: [] }
                    }
                  }
              })
              yield* browser.delivered
              const cleanup = yield* browser.next.pipe(BrowserClock.timeoutOn(BrowserClock.live, 100))
              if (ownership === "none") assert.isTrue(Option.isNone(cleanup))
              else {
                assert(Option.isSome(cleanup), "late root handle must be disowned")
                assert.strictEqual(cleanup.value.method, "script.disown")
                assert.deepStrictEqual(cleanup.value.params, { handles: ["LATE"], target: { realm: "REPLY" } })
                yield* browser.receive({ type: "success", id: cleanup.value.id, result: {} })
              }
            }))
        }
      }
    }
  }

  for (const ending of ["realm", "document", "page", "cancel", "reply"] as const) {
    it.effect(`settles a pending evaluation on ${ending} and cleans up late replies`, () =>
      Effect.gen(function*() {
        const browser = yield* makeBrowser
        const client = yield* ProtocolClient.make(browser.transport, BidiWire.wire)
        const { page, realm, state } = yield* withPage({}, {}, client.root)
        const handlers = Evaluation.register(Kit.handlers<State.Event>())
        const running = yield* Evaluation.evaluate(state, realm.id, {
          functionDeclaration: "() => new Promise(() => {})",
          arguments: [],
          awaitPromise: true,
          result: "handle",
          userActivation: false
        }).pipe(Effect.result, Effect.forkChild)
        const sent = yield* browser.next
        // Another realm's event must neither end this call nor send it again.
        handlers.apply("script.realmDestroyed", { realm: "UNRELATED" }, { state })
        yield* state.buffer.flush
        assert.isUndefined(running.pollUnsafe())
        if (ending === "cancel") yield* Fiber.interrupt(running)
        else if (ending !== "reply") {
          if (ending === "realm") handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
          else if (ending === "document") {
            Tree.commit(
              state,
              page,
              "http://next.example/",
              "http://next.example",
              { _tag: "InitialBlank" },
              undefined,
              "test"
            )
            // A commit alone can preserve the initial blank document's realm.
            yield* state.buffer.flush
            assert.isUndefined(running.pollUnsafe())
            handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
          } else Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
          yield* state.buffer.flush
          const settled = yield* Fiber.join(running).pipe(BrowserClock.timeoutOn(BrowserClock.live, 1000))
          assert(Option.isSome(settled), "realm loss must end a call even without a protocol reply")
          assert.strictEqual(settled.value._tag, "Failure")
          if (settled.value._tag === "Failure") assert.strictEqual(settled.value.failure.reason._tag, "Gone")
        }
        yield* browser.receive({
          type: "success",
          id: sent.id,
          result: { type: "success", realm: realm.bidi, result: { type: "object", handle: "LATE" } }
        })
        yield* browser.delivered
        if (ending === "reply") {
          const result = yield* Fiber.join(running)
          assert.strictEqual(result._tag, "Success")
          assert.strictEqual(state.handles.size, 1)
          handlers.apply("script.realmDestroyed", { realm: realm.bidi }, { state })
          yield* state.buffer.flush
        } else {
          assert.strictEqual(state.handles.size, 0)
          const cleanup = yield* browser.next.pipe(BrowserClock.timeoutOn(BrowserClock.live, 1000))
          assert(Option.isSome(cleanup), "abandoned root handles must use protocol late-reply cleanup")
          assert.strictEqual(cleanup.value.method, "script.disown")
          yield* browser.receive({ type: "success", id: cleanup.value.id, result: {} })
        }
      }))
  }

  it.effect("disowns a root-owned handle returned after evaluation was interrupted", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, BidiWire.wire)
      const { realm, state } = yield* withPage({}, {}, client.root)
      const evaluation = yield* Evaluation.evaluate(state, realm.id, {
        functionDeclaration: "() => ({})",
        arguments: [],
        awaitPromise: false,
        result: "handle",
        userActivation: false
      }).pipe(Effect.forkChild)
      const sent = yield* browser.next
      assert.strictEqual(sent.method, "script.callFunction")
      assert.strictEqual(sent.params?.resultOwnership, "root")
      yield* Fiber.interrupt(evaluation)
      yield* browser.receive({
        type: "success",
        id: sent.id,
        result: { type: "success", realm: realm.bidi, result: { type: "object", handle: "H1" } }
      })
      yield* browser.delivered
      // The caller has no handle to release; cleanup must use the late reply's remote handle and realm.
      assert.strictEqual(state.handles.size, 0)
      const cleanup = yield* browser.next.pipe(BrowserClock.timeoutOn(BrowserClock.live, 1000))
      assert(Option.isSome(cleanup), "the abandoned root-owned handle must be disowned while its realm is live")
      assert.strictEqual(cleanup.value.method, "script.disown")
      assert.deepStrictEqual(cleanup.value.params, { handles: ["H1"], target: { realm: realm.bidi } })
      yield* browser.receive({ type: "success", id: cleanup.value.id, result: {} })
    }))

  it.effect("disowns the root-owned exception of a call whose reply it consumed", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, BidiWire.wire)
      const { realm, state } = yield* withPage({}, {}, client.root)
      const evaluation = yield* Evaluation.evaluate(state, realm.id, {
        functionDeclaration: "() => { throw new Error('boom') }",
        arguments: [],
        awaitPromise: false,
        result: "handle",
        userActivation: false
      }).pipe(Effect.forkChild)
      const sent = yield* browser.next
      assert.strictEqual(sent.params?.resultOwnership, "root")
      yield* browser.receive({
        type: "success",
        id: sent.id,
        result: {
          type: "exception",
          realm: realm.bidi,
          exceptionDetails: {
            exception: { type: "error", handle: "E1" },
            text: "Error: boom",
            lineNumber: 0,
            columnNumber: 0,
            stackTrace: { callFrames: [] }
          }
        }
      })
      yield* browser.delivered
      const result = yield* Fiber.join(evaluation)
      assert.strictEqual(result._tag, "Exception")
      // The caller gets no handle for the exception, so nothing else can ever release it.
      assert.deepStrictEqual(result._tag === "Exception" ? result.exception : undefined, {
        type: "error",
        handle: undefined
      })
      const cleanup = yield* browser.next.pipe(BrowserClock.timeoutOn(BrowserClock.live, 200))
      assert(Option.isSome(cleanup), "a root-owned exception nobody can reach must be disowned")
      assert.strictEqual(cleanup.value.method, "script.disown")
      assert.deepStrictEqual(cleanup.value.params, { handles: ["E1"], target: { realm: realm.bidi } })
      yield* browser.receive({ type: "success", id: cleanup.value.id, result: {} })
    }))

  it.effect("keeps the connection when a hand-written release's parameters overlap", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, BidiWire.wire)
      const make = Protocol.command("probe.make", undefined, Schema.Unknown, {
        status: "stable",
        createsResource: true,
        release: [{
          method: "probe.free",
          param: "id",
          from: "/id",
          paramsFrom: { "/target": "/realm", "/target/realm": "/realm" }
        }]
      })
      const fiber = yield* client.root.send(make()).pipe(Effect.forkChild)
      const sent = yield* browser.next
      yield* Fiber.interrupt(fiber)
      yield* browser.receive({ type: "success", id: sent.id, result: { id: "I", realm: "R" } })
      yield* browser.delivered
      const after = yield* client.root.send(
        Protocol.command("probe.after", undefined, Schema.Unknown, {
          status: "stable"
        })()
      ).pipe(Effect.forkChild)
      const next = yield* browser.next
      const command = next.method === "probe.free" ? yield* browser.next : next
      assert.strictEqual(command.method, "probe.after")
      yield* browser.receive({ type: "success", id: command.id, result: {} })
      yield* Fiber.join(after)
    }))
  for (const kind of ["success", "none", "handleless", "release", "failure", "interruption"] as const) {
    it.effect(`preserves evaluation ownership with ${kind} cleanup`, () =>
      Effect.gen(function*() {
        const entered = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        yield* Effect.scoped(
          Effect.gen(function*() {
            const cleanup = Effect.gen(function*() {
              assert.deepStrictEqual(yield* Effect.service(Deadline.CurrentDeadline), Option.none())
              yield* Deferred.succeed(entered, undefined)
              if (kind === "interruption") {
                return yield* Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)))
              }
            })
            const { realm, sent, state, commands } = yield* withPage(
              {
                "script.callFunction": kind === "success"
                  ? { type: "success", realm: "R2", result: { type: "object", handle: "H1" } }
                  : {
                    type: "exception",
                    realm: "R2",
                    exceptionDetails: {
                      text: "Error: boom",
                      exception: kind === "handleless" ? { type: "error" } : { type: "error", handle: "E1" }
                    }
                  },
                "script.disown": cleanup
              },
              kind === "failure"
                ? {
                  "script.disown": () =>
                    new Protocol.ProtocolError({ reason: new Protocol.SessionEnded({ why: "targetDestroyed" }) })
                }
                : {}
            )
            const result = yield* Evaluation.evaluate(state, realm.id, {
              functionDeclaration: "() => { throw new Error('boom') }",
              arguments: [],
              awaitPromise: false,
              result: kind === "none" ? "value" : "handle",
              userActivation: false
            })
            if (kind === "success") {
              assert.strictEqual(result._tag, "Value")
              assert.strictEqual(state.handles.size, 1)
              assert.strictEqual([...state.handles.values()][0]?.handle, "H1")
            } else {
              assert.deepStrictEqual(result, {
                _tag: "Exception",
                text: "Error: boom",
                exception: { type: "error", handle: undefined },
                stack: Option.none()
              })
              assert.strictEqual(state.handles.size, 0)
            }
            if (kind === "interruption") yield* Deferred.await(entered)
            yield* Effect.yieldNow
            if (kind === "release" || kind === "failure" || kind === "interruption") {
              assert.deepStrictEqual(commands[1]?.params, { handles: ["E1"], target: { realm: "R2" } })
            }
            assert.deepStrictEqual(
              sent,
              kind === "release" || kind === "failure" || kind === "interruption"
                ? ["script.callFunction", "script.disown"]
                : ["script.callFunction"]
            )
          }).pipe(Effect.provideService(
            Deadline.CurrentDeadline,
            Option.some(0 as MonotonicInstant.MonotonicInstant)
          ))
        )
        if (kind === "interruption") yield* Deferred.await(interrupted)
      }))
  }

  it.effect("fails a handle it doesn't hold as Gone, and sends nothing", () =>
    Effect.gen(function*() {
      const { realm, sent, state } = yield* withPage()
      const call = (handle: Adapter.HandleId) =>
        Evaluation.evaluate(state, realm.id, {
          functionDeclaration: "(object) => typeof object",
          arguments: [{ _tag: "Handle", handle }],
          awaitPromise: false,
          result: "value",
          userActivation: false
        }).pipe(Effect.flip)
      const released = yield* call(state.ids.handle())
      assert.deepStrictEqual(released.reason, {
        _tag: "Gone",
        target: { _tag: "Realm", id: realm.id },
        reason: new Target.RealmDestroyed({})
      })
      const foreign = yield* call(Kit.makeIds().handle())
      assert.strictEqual(foreign.reason._tag, "Foreign")
      assert.deepStrictEqual(sent, [])
    }))

  it.effect("fails a call cut short when its page closes as Gone, and any other failure as the protocol's", () =>
    Effect.gen(function*() {
      const call = {
        functionDeclaration: "() => 1",
        arguments: [],
        awaitPromise: false,
        result: "value",
        userActivation: false
      } as const
      const refused = () =>
        new Protocol.ProtocolError({ reason: new Protocol.Unsupported({ method: "script.callFunction" }) })
      // The realm ends while the call is in flight, and the browser answers it with an error
      let ending: State.RealmEntry | undefined
      const cut = yield* withPage({}, {
        "script.callFunction": () => {
          if (ending !== undefined) ending.ended = true
          return refused()
        }
      })
      ending = cut.realm
      const ended = yield* Evaluation.evaluate(cut.state, cut.realm.id, call).pipe(Effect.flip)
      assert.deepStrictEqual(ended.reason, {
        _tag: "Gone",
        target: { _tag: "Realm", id: cut.realm.id },
        reason: new Target.RealmDestroyed({})
      })
      // The session ending is the page's closing, too
      const closed = yield* withPage({}, {
        "script.callFunction": () =>
          new Protocol.ProtocolError({ reason: new Protocol.SessionEnded({ why: "targetDestroyed" }) })
      })
      const sessionEnded = yield* Evaluation.evaluate(closed.state, closed.realm.id, call).pipe(Effect.flip)
      assert.strictEqual(sessionEnded.reason._tag, "Gone")
      // A refusal from a realm that is still there is the protocol's own error
      const live = yield* withPage({}, { "script.callFunction": refused })
      const unsupported = yield* Evaluation.evaluate(live.state, live.realm.id, call).pipe(Effect.flip)
      assert.strictEqual(unsupported.reason._tag, "Unsupported")
    }))

  it.effect("fails a screenshot whose base64 doesn't decode, rather than giving empty bytes", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage({ "browsingContext.captureScreenshot": { data: "not base64!" } })
      const error = yield* Capture.screenshot(state, page.id, {
        format: "png",
        quality: Option.none(),
        clip: Option.none(),
        fullPage: false,
        scale: "device",
        omitBackground: false
      }).pipe(Effect.flip)
      assert.strictEqual(error.reason._tag, "Protocol")
    }))
})

it.effect("removes a context's proxy auth interceptor and attempts, retaining only the browser-cache binding", () =>
  Effect.gen(function*() {
    const { state, commands } = yield* withPage({
      "browser.createUserContext": { userContext: "proxy-context" },
      "network.addIntercept": { intercept: "proxy-intercept" }
    })
    const id = yield* Contexts.createUserContext(state, {
      proxy: Option.some({
        server: "proxy.test:8080",
        bypass: [],
        credentials: { username: "user", password: Redacted.make("fixture-password") }
      }),
      acceptInsecureCerts: false
    })
    const entry = state.contexts.get(id)!
    entry.proxyAttempts!.add("request")
    yield* Contexts.removeUserContext(state, id)
    assert.strictEqual(entry.proxyAttempts?.size, 0)
    assert.isUndefined(entry.proxyIntercept)
    assert.isUndefined(entry.proxy)
    assert.isTrue(
      commands.some((command) =>
        command.method === "network.removeIntercept" &&
        (command.params as { intercept: string }).intercept === "proxy-intercept"
      )
    )
    assert.isTrue(state.proxyBindings.has("proxy.test:8080"))
    State.releaseProxy(state)
    assert.strictEqual(state.proxyBindings.size, 0)
  }))

it.effect("releases a Firefox proxy credential binding when its context is never created", () =>
  Effect.gen(function*() {
    // The browser refuses the first creation, so no context ever authenticated with these credentials
    // and Firefox's proxy authentication cache holds nothing for the endpoint.
    let refuse = true
    const { state } = yield* withPage({
      "browser.createUserContext": Effect.suspend(() =>
        refuse
          ? Effect.fail(
            new Protocol.ProtocolError({ reason: new Protocol.Unsupported({ method: "browser.createUserContext" }) })
          )
          : Effect.succeed({ userContext: "proxy-context" })
      ),
      "network.addIntercept": { intercept: "proxy-intercept" }
    })
    const create = (password: string) =>
      Contexts.createUserContext(state, {
        proxy: Option.some({
          server: "proxy.test:8080",
          bypass: [],
          credentials: { username: "user", password: Redacted.make(password) }
        }),
        acceptInsecureCerts: false
      })
    yield* create("mistyped-password").pipe(Effect.flip)
    refuse = false
    // Correcting the password must not be refused as a conflict with a binding nothing used.
    yield* create("corrected-password")
  }))

it("recovers only the first website challenge, including escaped realms", () => {
  assert.deepStrictEqual(
    Obligations.websiteChallenge("Basic realm=\"site\\\"realm\", charset=\"UTF-8\", Digest realm=\"other\""),
    { scheme: "Basic", realm: "site\"realm" }
  )
  assert.deepStrictEqual(Obligations.websiteChallenge("Negotiate token==, Basic realm=\"other\""), {
    scheme: "Negotiate",
    realm: ""
  })
  assert.isUndefined(Obligations.websiteChallenge(""))
})

for (const configured of [true, false]) {
  it.effect(`keeps website auth routes separate with proxy credentials ${configured ? "configured" : "omitted"}`, () =>
    Effect.gen(function*() {
      const { state, page, commands, facts } = yield* withPage()
      if (configured) {
        page.context.proxy = {
          server: "proxy.test:8080",
          bypass: [],
          credentials: { username: "proxy-user", password: Redacted.make("proxy-password") }
        }
      }
      const registration = state.ids.registration()
      state.intercepts.set(registration, {
        registration,
        bidi: "website-auth" as State.InterceptEntry["bidi"],
        scope: { _tag: "Browser" },
        globs: [],
        phases: ["auth"]
      })
      const handlers = Obligations.register(Network.register(Kit.handlers<State.Event>()))
      const params = {
        context: "C1",
        userContext: "default",
        navigation: null,
        timestamp: 1,
        redirectCount: 0,
        isBlocked: false,
        request: {
          request: "ambiguous",
          url: "http://site.test/",
          method: "GET",
          headers: [],
          destination: "document",
          bodySize: 0
        }
      }
      handlers.apply("network.beforeRequestSent", params, { state })
      handlers.apply("network.authRequired", {
        ...params,
        isBlocked: true,
        intercepts: ["website-auth"],
        response: {
          status: 407,
          headers: [
            { name: "Proxy-Authenticate", value: { type: "string", value: "Basic realm=\"spoofed\"" } },
            { name: "WWW-Authenticate", value: { type: "string", value: "Basic realm=\"website\"" } }
          ],
          authChallenges: configured ? [{ scheme: "Basic", realm: "spoofed" }] : undefined
        }
      }, { state })
      yield* state.buffer.flush
      assert.isFalse(commands.some((command) => command.method === "network.continueWithAuth"))
      const fact = facts.find((fact) => fact._tag === "ObligationOpened" && fact.subject._tag === "PausedRequest")
      assert.isDefined(fact)
      if (fact?._tag === "ObligationOpened" && fact.subject._tag === "PausedRequest") {
        assert.isUndefined(fact.subject.authSource, "conflicting 407 headers cannot identify a website")
        assert.deepStrictEqual(
          fact.subject.challenge,
          configured ? Option.some({ origin: "http://site.test", scheme: "Basic", realm: "website" }) : Option.none()
        )
      }
      assert.isUndefined(page.context.proxyAttempts)
    }))
}

for (
  const sample of [
    {
      name: "a website 401 with only a proxy header",
      status: 401,
      proxy: true,
      website: false,
      attempted: false,
      source: undefined
    },
    {
      name: "a proxy 407 with conflicting headers",
      status: 407,
      proxy: true,
      website: true,
      attempted: true,
      source: undefined
    },
    {
      name: "an unconfirmed 407 with only a website header",
      status: 407,
      proxy: false,
      website: true,
      attempted: false,
      source: undefined
    },
    {
      name: "a website 401 with an extra proxy header",
      status: 401,
      proxy: true,
      website: true,
      attempted: false,
      source: "server"
    },
    {
      name: "a stale 407 after this request's proxy authentication",
      status: 407,
      proxy: false,
      website: true,
      attempted: true,
      source: "server"
    }
  ] as const
) {
  it.effect(`classifies conservatively: ${sample.name}`, () =>
    Effect.gen(function*() {
      const { state, page, commands, facts } = yield* withPage()
      page.context.proxy = {
        server: "proxy.test:8080",
        bypass: [],
        credentials: { username: "proxy-user", password: Redacted.make("proxy-secret") }
      }
      if (sample.attempted) page.context.proxyAttempts = new Set(["challenge"])
      const registration = state.ids.registration()
      state.intercepts.set(registration, {
        registration,
        bidi: "auth" as State.InterceptEntry["bidi"],
        scope: { _tag: "Browser" },
        globs: [],
        phases: ["auth"]
      })
      const handlers = Obligations.register(Network.register(Kit.handlers<State.Event>()))
      const params = {
        context: "C1",
        userContext: "default",
        navigation: null,
        timestamp: 1,
        redirectCount: 0,
        isBlocked: false,
        request: {
          request: "challenge",
          url: "http://site.test/",
          method: "GET",
          headers: [],
          destination: "document",
          bodySize: 0
        }
      }
      handlers.apply("network.beforeRequestSent", params, { state })
      handlers.apply("network.authRequired", {
        ...params,
        isBlocked: true,
        intercepts: ["auth"],
        response: {
          status: sample.status,
          headers: [
            ...(sample.proxy
              ? [{ name: "Proxy-Authenticate", value: { type: "string", value: "Basic realm=\"proxy\"" } }]
              : []),
            ...(sample.website
              ? [{ name: "WWW-Authenticate", value: { type: "string", value: "Basic realm=\"website\"" } }]
              : [])
          ],
          authChallenges: sample.proxy ? [{ scheme: "Basic", realm: "proxy" }] : []
        }
      }, { state })
      yield* state.buffer.flush
      assert.isFalse(commands.some((command) =>
        command.method === "network.continueWithAuth" &&
        (command.params as { action?: string }).action === "provideCredentials"
      ))
      const fact = facts.find((fact) => fact._tag === "ObligationOpened" && fact.subject._tag === "PausedRequest")
      assert.isDefined(fact)
      if (fact?._tag === "ObligationOpened" && fact.subject._tag === "PausedRequest") {
        assert.strictEqual(fact.subject.authSource, sample.source)
      }
    }))
}

describe("Firefox proxy reservation lifetime", () => {
  const options = (password: string): Adapter.UserContextOptions => ({
    proxy: Option.some({
      server: "proxy.test:8080",
      bypass: [],
      credentials: { username: "user", password: Redacted.make(password) }
    }),
    acceptInsecureCerts: false
  })
  const refused = () =>
    new Protocol.ProtocolError({ reason: new Protocol.Unsupported({ method: "browser.createUserContext" }) })
  const uncertain = () =>
    new Protocol.ProtocolError({
      reason: new Protocol.NoReply({ method: "browser.createUserContext", timeout: Duration.seconds(1) })
    })

  for (const otherSucceeds of [true, false]) {
    it.effect(`releases only its own concurrent reservation when the other creation ${otherSucceeds ? "succeeds" : "fails"}`, () =>
      Effect.gen(function*() {
        const first = yield* Deferred.make<void>()
        const firstEntered = yield* Deferred.make<void>()
        const second = yield* Deferred.make<void>()
        const entered = yield* Deferred.make<void>()
        let calls = 0
        const { state } = yield* withPage({
          "browser.createUserContext": Effect.suspend(() => {
            const call = ++calls
            if (call === 1) {
              return Deferred.succeed(firstEntered, undefined).pipe(
                Effect.andThen(Deferred.await(first)),
                Effect.andThen(Effect.fail(refused()))
              )
            }
            if (call === 2) {
              return Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(second)),
                Effect.andThen(otherSucceeds ? Effect.succeed({ userContext: "second" }) : Effect.fail(refused()))
              )
            }
            return Effect.succeed({ userContext: "corrected" })
          }),
          "network.addIntercept": { intercept: "auth" }
        })
        const a = yield* Effect.forkChild(Contexts.createUserContext(state, options("same")).pipe(Effect.exit))
        yield* Deferred.await(firstEntered)
        const b = yield* Effect.forkChild(Contexts.createUserContext(state, options("same")).pipe(Effect.exit))
        yield* Deferred.await(entered)
        yield* Deferred.succeed(first, undefined)
        yield* Fiber.join(a)
        const conflict = yield* Contexts.createUserContext(state, options("different")).pipe(Effect.flip)
        assert.strictEqual(conflict.reason._tag, "Unsupported")
        assert.strictEqual(calls, 2)
        yield* Deferred.succeed(second, undefined)
        yield* Fiber.join(b)
        if (otherSucceeds) {
          const retained = yield* Contexts.createUserContext(state, options("different")).pipe(Effect.flip)
          assert.strictEqual(retained.reason._tag, "Unsupported")
        } else yield* Contexts.createUserContext(state, options("different"))
      }))
  }

  it.effect("retains an earlier successful binding after another creation is rejected", () =>
    Effect.gen(function*() {
      let reject = false
      const { state } = yield* withPage({
        "browser.createUserContext": Effect.suspend(() =>
          reject ? Effect.fail(refused()) : Effect.succeed({ userContext: "created" })
        ),
        "network.addIntercept": { intercept: "auth" }
      })
      yield* Contexts.createUserContext(state, options("same"))
      reject = true
      yield* Contexts.createUserContext(state, options("same")).pipe(Effect.flip)
      const conflict = yield* Contexts.createUserContext(state, options("different")).pipe(Effect.flip)
      assert.strictEqual(conflict.reason._tag, "Unsupported")
    }))

  for (const outcome of ["confirmed unused", "uncertain removal", "used"] as const) {
    it.effect(`handles setup rollback with ${outcome} outcome`, () =>
      Effect.gen(function*() {
        let failSetup = true
        const { state } = yield* withPage({
          "browser.createUserContext": { userContext: "created" },
          "network.addIntercept": Effect.suspend(() => {
            if (!failSetup) return Effect.succeed({ intercept: "auth" })
            if (outcome === "used") {
              Tree.addNavigable(state, {
                context: "during-setup" as BrowsingContext.BrowsingContext,
                userContext: "created",
                originalOpener: null,
                url: "http://proxy.test/"
              }, false)
            }
            return Effect.fail(refused())
          }),
          "browser.removeUserContext": outcome === "uncertain removal" ? Effect.fail(uncertain()) : {}
        })
        yield* Contexts.createUserContext(state, options("mistyped")).pipe(Effect.flip)
        failSetup = false
        if (outcome === "confirmed unused") yield* Contexts.createUserContext(state, options("corrected"))
        else {
          const conflict = yield* Contexts.createUserContext(state, options("corrected")).pipe(Effect.flip)
          assert.strictEqual(conflict.reason._tag, "Unsupported")
        }
      }))
  }

  for (const interrupted of [true, false]) {
    it.effect(`retains a binding when creation ${interrupted ? "is interrupted" : "has no reply"}`, () =>
      Effect.gen(function*() {
        const { state } = yield* withPage({
          "browser.createUserContext": interrupted ? Effect.interrupt : Effect.fail(uncertain())
        })
        yield* Contexts.createUserContext(state, options("original")).pipe(Effect.exit)
        const conflict = yield* Contexts.createUserContext(state, options("different")).pipe(Effect.flip)
        assert.strictEqual(conflict.reason._tag, "Unsupported")
      }))
  }

  it.effect("uses the supported global proxy auth intercept parameters", () =>
    Effect.gen(function*() {
      const { state, commands } = yield* withPage({
        "browser.createUserContext": { userContext: "proxy-context" },
        "network.addIntercept": { intercept: "auth" }
      })
      yield* Contexts.createUserContext(state, options("secret"))
      const intercept = commands.find((command) => command.method === "network.addIntercept")
      assert.deepStrictEqual(intercept?.params, { phases: ["authRequired"] })
    }))
})

for (const kind of ["InvalidArgument", "Encode", "Decode", "Unrecognized"] as const) {
  it.effect(`handles a proxy creation ${kind} without mistaking uncertainty for rejection`, () =>
    Effect.gen(function*() {
      let failing = true
      const method = "browser.createUserContext"
      const reason = kind === "Encode" ?
        new Protocol.Encode({ method, issue: "fixture" })
        : kind === "Decode" ?
        new Protocol.Decode({ method, issue: "fixture" })
        : new Protocol.Rejected({
          method,
          reason: kind,
          code: kind === "InvalidArgument" ? "invalid argument" : "unknown error",
          description: "fixture"
        })
      const { state } = yield* withPage({
        [method]: Effect.suspend(() =>
          failing ? Effect.fail(new Protocol.ProtocolError({ reason })) : Effect.succeed({ userContext: "created" })
        ),
        "network.addIntercept": { intercept: "auth" }
      })
      const create = (password: string) =>
        Contexts.createUserContext(state, {
          proxy: Option.some({
            server: "proxy.test:8080",
            bypass: [],
            credentials: { username: "user", password: Redacted.make(password) }
          }),
          acceptInsecureCerts: false
        })
      yield* create("original").pipe(Effect.flip)
      failing = false
      if (kind === "Encode" || kind === "InvalidArgument") yield* create("corrected")
      else {
        const conflict = yield* create("corrected").pipe(Effect.flip)
        assert.strictEqual(conflict.reason._tag, "Unsupported")
      }
    }))
}

describe("BiDi request body identity", () => {
  it.effect("refuses a redirect during getData and does not read ambiguous later-hop data", () =>
    Effect.gen(function*() {
      const called = yield* Deferred.make<void>()
      const reply = yield* Deferred.make<{ bytes: { type: string; value: string } }>()
      const { page, state, sent } = yield* withPage({
        "network.getData": Deferred.succeed(called, undefined).pipe(Effect.andThen(Deferred.await(reply)))
      })
      state.registry.add({ _tag: "Page", page: page.id }, {
        _tag: "BodyCollection",
        bodies: ["request"],
        maxBytes: 100
      }, state.ids.registration())
      const handlers = Network.register(Kit.handlers<State.Event>())
      const params = {
        context: "C1",
        userContext: "default",
        navigation: null,
        timestamp: 1,
        redirectCount: 0,
        isBlocked: false,
        request: {
          request: "body",
          url: "http://site.test/send",
          method: "POST",
          headers: [],
          destination: "",
          bodySize: 3
        }
      }
      handlers.apply("network.beforeRequestSent", params, { state })
      const entry = [...state.requests.values()][0]!
      const snapshot = new Request.NetworkRequest({
        hop: entry.hop,
        method: "POST",
        url: "http://site.test/send" as Request.NetworkRequest["url"],
        headers: Headers.empty,
        resourceType: "fetch",
        initiator: { _tag: "Unattributed" },
        at: 0 as Request.NetworkRequest["at"]
      })
      const reading = yield* Network.captureRequestBody(state, snapshot, 100).pipe(Effect.forkChild)
      yield* Deferred.await(called)
      handlers.apply("network.beforeRequestSent", { ...params, redirectCount: 1 }, { state })
      yield* Deferred.succeed(reply, { bytes: { type: "base64", value: "bmV3" } })
      assert.deepStrictEqual(yield* Fiber.join(reading), { _tag: "Unavailable", why: "redirect" })
      const later = new Request.NetworkRequest({ ...snapshot, hop: entry.hop })
      assert.deepStrictEqual(yield* Network.captureRequestBody(state, later, 100), {
        _tag: "Unavailable",
        why: "redirect"
      })
      assert.deepStrictEqual(sent, ["network.getData"])
    }))
})

describe("BiDi request collector limits", () => {
  it.effect("preserves legacy encoded limits while reserving native encoding overhead only for decoded subscriptions", () =>
    Effect.gen(function*() {
      for (const decoded of [false, true]) {
        const { state, page, commands } = yield* withPage({
          "network.addDataCollector": { collector: "body-collector" }
        })
        yield* Declare.declare(state, { _tag: "Page", page: page.id }, {
          _tag: "BodyCollection",
          bodies: ["request"],
          maxBytes: 4,
          ...(decoded ? { decodedRequestBytes: true } : {})
        })
        const command = commands.find((command) => command.method === "network.addDataCollector")!
        assert.deepInclude(command.params, { maxEncodedDataSize: decoded ? 8 : 4 })
      }
    }))
})

const preload = (source: string): Adapter.Declaration => ({
  _tag: "InitScript",
  source,
  world: { _tag: "Main" },
  phase: "user",
  workers: false,
  timing: "beforeAuthorScript",
  after: []
})

it.effect("serializes overlapping preload addition and removal against the latest registry", () =>
  Effect.gen(function*() {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const native = new Map<string, string>()
    let serial = 0
    let hold = false
    const root = {
      send: Effect.fnUntraced(function*(command: Protocol.Command<string, unknown, unknown>) {
        if (command.method === "script.addPreloadScript") {
          const script = `P${++serial}`
          native.set(script, (command.params as { functionDeclaration: string }).functionDeclaration)
          if (hold) {
            hold = false
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
          }
          return { script }
        }
        if (command.method === "script.removePreloadScript") {
          native.delete((command.params as { script: string }).script)
        }
        return {}
      })
    } as unknown as ProtocolClient.Session
    const { state } = yield* withPage({}, {}, root)
    const firstScope = yield* Scope.fork(yield* Effect.scope)
    const nextScope = yield* Scope.fork(yield* Effect.scope)
    yield* Declare.declare(state, { _tag: "Browser" }, preload("first")).pipe(Scope.provide(firstScope))
    hold = true
    const adding = yield* Declare.declare(state, { _tag: "Browser" }, preload("next")).pipe(
      Scope.provide(nextScope),
      Effect.forkChild
    )
    yield* Deferred.await(entered)
    const removing = yield* Scope.close(firstScope, Exit.void).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(adding)
    yield* Fiber.join(removing)
    assert.strictEqual(native.size, 1)
    assert([...native.values()].every((body) => body.includes("next") && !body.includes("first")))
    yield* Scope.close(nextScope, Exit.void)
    assert.strictEqual(native.size, 0)
  }))

it.effect("rolls back every staged preload after a partial replacement fails", () =>
  Effect.gen(function*() {
    const native = new Map<string, string>()
    let serial = 0
    let failNext = false
    const root = {
      send: (command: Protocol.Command<string, unknown, unknown>) =>
        Effect.suspend(() => {
          if (command.method === "script.addPreloadScript") {
            if (
              failNext && (command.params as { functionDeclaration: string }).functionDeclaration.includes("second")
            ) {
              return Effect.fail(
                new Protocol.ProtocolError({ reason: new Protocol.Unsupported({ method: command.method }) })
              )
            }
            const script = `P${++serial}`
            native.set(script, (command.params as { functionDeclaration: string }).functionDeclaration)
            return Effect.succeed({ script })
          }
          if (command.method === "script.removePreloadScript") {
            native.delete((command.params as { script: string }).script)
          }
          return Effect.succeed({})
        })
    } as unknown as ProtocolClient.Session
    const { state } = yield* withPage({}, {}, root)
    const firstScope = yield* Scope.fork(yield* Effect.scope)
    const secondScope = yield* Scope.fork(yield* Effect.scope)
    yield* Declare.declare(state, { _tag: "Browser" }, preload("first")).pipe(Scope.provide(firstScope))
    const previous = [...native.keys()]
    failNext = true
    const result = yield* Declare.declare(state, { _tag: "Browser" }, preload("second")).pipe(
      Scope.provide(secondScope),
      Effect.exit
    )
    assert(Exit.isFailure(result))
    assert.deepStrictEqual([...native.keys()], previous)
    failNext = false
    yield* Scope.close(secondScope, Exit.void)
    yield* Scope.close(firstScope, Exit.void)
    assert.strictEqual(native.size, 0)
  }))

it.effect("retires a Firefox missing realm without a handler error and reclaims every route lease", () =>
  Effect.gen(function*() {
    const errors: Array<unknown> = []
    const ready = yield* Deferred.make<void>()
    const trigger = yield* Deferred.make<void>()
    const replaced = yield* Deferred.make<void>()
    const tail = yield* Deferred.make<void>()
    let rejected = 0
    const root = {
      send: (command: Protocol.Command<string, unknown, unknown>) =>
        Effect.suspend(() => {
          const params = command.params as { functionDeclaration: string; target: { realm: string } }
          if (params.target.realm === "R1" && params.functionDeclaration.includes("\"type\":\"send\"")) {
            return Effect.fail(
              new Protocol.ProtocolError({
                reason: new Protocol.Rejected({
                  method: command.method,
                  reason: "NoSuchFrame",
                  code: "no such frame",
                  description: "Realm with id R1 not found"
                })
              })
            )
          }
          if (params.functionDeclaration.includes("\"reason\":\"constructor admission\"")) rejected++
          return Effect.succeed({ type: "success", realm: params.target.realm, result: { type: "undefined" } })
        })
    } as unknown as ProtocolClient.Session
    const { state, realm, facts } = yield* withPage({}, {}, root)
    const replacement: State.RealmEntry = { ...realm, id: state.ids.realm(), bidi: "R2" as Script.Realm, held: [] }
    state.realms.set(replacement.bidi, replacement)
    state.realmsById.set(replacement.id, replacement)
    yield* webSocketHarness((getBridge) =>
      Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const old: Array<WebSocketRoute.Connection> = []
        const next: Array<WebSocketRoute.Connection> = []
        const registration = yield* context.routeWebSocket(
          "**",
          Effect.fnUntraced(function*(socket) {
            yield* socket.open({})
            if (socket.realm === realm.id) {
              old.push(socket)
              if (old.length === 14) yield* Deferred.succeed(ready, undefined)
              if (socket.id.endsWith(":1")) {
                yield* Deferred.await(trigger)
                yield* socket.page.send({ _tag: "Text", data: "after realm destruction" })
              }
            } else {
              next.push(socket)
              if (next.length === 14) yield* Deferred.succeed(replaced, undefined)
            }
          }),
          { implementation: "script" }
        )
        const bridge = getBridge()
        const create = (target: State.RealmEntry, id: number) =>
          bridge.receive(
            target.id,
            Effect.succeed(
              JSON.stringify({
                token: bridge.token,
                type: "create",
                id: String(id),
                url: "ws://example.com/",
                protocols: []
              })
            ),
            { _tag: "Worker", realm: target.id },
            { isAlive: () => !target.ended }
          )
        for (let id = 1; id <= 14; id++) assert.isTrue(create(realm, id))
        yield* Deferred.await(ready)
        yield* Deferred.succeed(trigger, undefined)
        yield* old[0]!.status.changes.pipe(Stream.filter((status) => status === "closed"), Stream.runHead)
        assert.deepStrictEqual(errors, [], "ordinary realm loss is not a failed user handler")
        assert.isTrue(realm.ended)
        assert.isFalse(state.realmsById.has(realm.id))
        assert.strictEqual(facts.filter((fact) => fact._tag === "RealmRemoved" && fact.realm === realm.id).length, 1)
        for (const socket of old) {
          yield* socket.status.changes.pipe(Stream.filter((status) => status === "closed"), Stream.runHead)
        }
        bridge.ended(realm.id)
        bridge.ended(realm.id)
        for (let id = 1; id <= 15; id++) {
          assert.isTrue(create(replacement, id))
        }
        assert.isTrue(
          bridge.receive(
            replacement.id,
            Effect.yieldNow.pipe(
              Effect.andThen(Deferred.succeed(tail, undefined)),
              Effect.as(JSON.stringify({ token: "ignored", type: "ready", id: "" }))
            ),
            { _tag: "Worker", realm: replacement.id },
            { isAlive: () => !replacement.ended }
          )
        )
        yield* Deferred.await(replaced)
        yield* Deferred.await(tail)
        assert.strictEqual(next.length, 14, "all fourteen reservations must be usable again")
        assert.strictEqual(rejected, 1, "duplicate death must not grant a fifteenth reservation")
        assert.isFalse(replacement.ended)
        yield* registration.remove
      }), (id, call) => Evaluation.evaluate(state, id, call)).pipe(
        Effect.provideService(
          Logger.CurrentLoggers,
          new Set([Logger.make((entry) => {
            if (entry.logLevel === "Error") errors.push(entry.message)
          })])
        )
      )
  }))

it.effect("removes an obsolete preload even when reinstalling its survivor fails", () =>
  Effect.gen(function*() {
    const native = new Map<string, string>()
    let serial = 0
    let failing = false
    const root = {
      send: (command: Protocol.Command<string, unknown, unknown>) =>
        Effect.suspend(() => {
          if (command.method === "script.addPreloadScript") {
            if (failing) {
              return Effect.fail(
                new Protocol.ProtocolError({ reason: new Protocol.Unsupported({ method: command.method }) })
              )
            }
            const script = `P${++serial}`
            native.set(script, (command.params as { functionDeclaration: string }).functionDeclaration)
            return Effect.succeed({ script })
          }
          if (command.method === "script.removePreloadScript") {
            native.delete((command.params as { script: string }).script)
          }
          return Effect.succeed({})
        })
    } as unknown as ProtocolClient.Session
    const { state } = yield* withPage({}, {}, root)
    const first = yield* Scope.fork(yield* Effect.scope)
    const survivor = yield* Scope.fork(yield* Effect.scope)
    yield* Declare.declare(state, { _tag: "Browser" }, preload("removed")).pipe(Scope.provide(first))
    yield* Declare.declare(state, { _tag: "Browser" }, preload("survivor")).pipe(Scope.provide(survivor))
    failing = true
    yield* Scope.close(first, Exit.void)
    assert.strictEqual(native.size, 1)
    assert([...native.values()].every((body) => body.includes("survivor") && !body.includes("removed")))
    failing = false
    yield* Scope.close(survivor, Exit.void)
    assert.strictEqual(native.size, 0)
  }))

it.effect("bounds the whole preload-removal loop once, not once per preload", () =>
  Effect.gen(function*() {
    const clock = yield* Clock.clockWith(Effect.succeed)
    let stalled = false
    const root = {
      send: (command: Protocol.Command<string, unknown, unknown>) =>
        Effect.suspend(() => {
          if (command.method === "script.addPreloadScript") return Effect.succeed({ script: `P${Math.random()}` })
          if (command.method === "script.removePreloadScript" && stalled) return Effect.never
          return Effect.succeed({})
        })
    } as unknown as ProtocolClient.Session
    yield* Effect.gen(function*() {
      const { state } = yield* withPage({}, {}, root)
      const scopes = yield* Effect.forEach(["a", "b", "c"], () => Scope.fork(Scope.makeUnsafe()))
      for (const [index, scope] of scopes.entries()) {
        yield* Declare.declare(state, { _tag: "Browser" }, preload(`s${index}`)).pipe(Scope.provide(scope))
      }
      stalled = true
      const closing = yield* Scope.close(scopes[0]!, Exit.void).pipe(Effect.forkChild)
      yield* TestClock.adjust(Duration.millis(5001))
      for (let index = 0; index < 20; index++) yield* Effect.yieldNow
      assert.isDefined(closing.pollUnsafe(), "three stalled removals must share one five-second budget")
    }).pipe(Effect.provideService(BrowserClock.CurrentClock, BrowserClock.fromClock(clock)))
  }))

describe("BiDi response body completion", () => {
  for (const successor of ["none", "waiting", "reading"] as const) {
    it.effect(`keeps terminal completion and body identity with successor ${successor}`, () =>
      Effect.gen(function*() {
        const called = yield* Deferred.make<void>()
        const reply = yield* Deferred.make<{ bytes: { type: string; value: string } }>()
        const { state, page, sent } = yield* withPage({
          "network.getData": Deferred.succeed(called, undefined).pipe(Effect.andThen(Deferred.await(reply)))
        })
        const retired: Array<string> = []
        const tracked = {
          ...state,
          retire: (key: string) => {
            retired.push(key)
            state.retire(key)
          }
        }
        const handlers = Network.register(Kit.handlers<State.Event>())
        const params = {
          context: "C1",
          userContext: "default",
          navigation: null,
          timestamp: 1,
          redirectCount: 0,
          isBlocked: false,
          request: {
            request: "response-body",
            url: "http://site.test/",
            method: "GET",
            headers: [],
            destination: "",
            bodySize: 0
          }
        }
        const apply = (method: string, extra: object = {}) =>
          handlers.apply(method, { ...params, ...extra }, { state: tracked })
        const complete = () =>
          apply("network.responseCompleted", {
            response: { status: 200, bytesReceived: 8, headers: [] }
          })
        apply("network.beforeRequestSent")
        page.context.proxyAttempts = new Set(["response-body"])
        const entry = state.requests.get("response-body")!
        const hop = entry.hop
        const reading = yield* Network.responseBody(state, hop).pipe(Effect.result, Effect.forkChild)
        yield* Effect.yieldNow
        if (successor === "waiting") apply("network.beforeRequestSent", { redirectCount: 1 })
        complete()
        // Isolate the in-flight identity check even on an adapter whose completion latch is broken.
        if (successor === "reading") Deferred.doneUnsafe(entry.finished, Effect.void)
        assert.isTrue(Deferred.isDoneUnsafe(entry.finished), "completed responses release body reads")
        if (successor !== "waiting") {
          yield* Deferred.await(called)
          if (successor === "reading") apply("network.beforeRequestSent", { redirectCount: 1 })
        }
        yield* Deferred.succeed(reply, { bytes: { type: "string", value: "terminal" } })
        const result = yield* Fiber.join(reading)
        if (successor === "none") {
          assert.strictEqual(result._tag, "Success")
          if (result._tag === "Success") assert.strictEqual(new TextDecoder().decode(result.success), "terminal")
        } else {
          assert.strictEqual(result._tag, "Failure")
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason._tag, "Unsupported")
            if (result.failure.reason._tag === "Unsupported") {
              assert.strictEqual(result.failure.reason.capability, "body.redirect")
            }
          }
        }
        assert.deepStrictEqual(sent, successor === "waiting" ? [] : ["network.getData"])
        assert.isFalse(page.context.proxyAttempts.has("response-body"))
        assert.deepStrictEqual(retired, ["response-body"])
      }))
  }
})

it.effect("retires terminal BiDi responses without evicting an active redirect successor", () =>
  Effect.gen(function*() {
    const { state } = yield* withPage({ "network.getData": { bytes: { type: "string", value: "final" } } })
    const handlers = Network.register(Kit.handlers<State.Event>())
    const apply = (method: string, key: string, redirectCount = 0) =>
      handlers.apply(method, {
        context: "C1",
        userContext: "default",
        navigation: null,
        timestamp: 1,
        redirectCount,
        isBlocked: false,
        request: { request: key, url: "http://site.test/", method: "GET", headers: [], destination: "", bodySize: 0 },
        response: { status: redirectCount === 1 ? 200 : 302, bytesReceived: 5, headers: [] }
      }, { state })
    apply("network.beforeRequestSent", "active")
    apply("network.responseCompleted", "active")
    const active = state.requests.get("active")!
    const first = active.hop
    apply("network.beforeRequestSent", "active", 1)
    assert.isFalse(Deferred.isDoneUnsafe(active.finished), "each successor waits for its own completion")
    for (let i = 0; i < 1001; i++) {
      apply("network.beforeRequestSent", `terminal-${i}`)
      apply("network.responseCompleted", `terminal-${i}`)
    }
    assert.strictEqual(state.requests.get("active"), active)
    assert.isFalse(state.requests.has("terminal-0"))
    assert.strictEqual(state.requests.size, 1001)
    apply("network.responseCompleted", "active", 1)
    assert.strictEqual(new TextDecoder().decode(yield* Network.responseBody(state, active.hop)), "final")
    for (let i = 0; i < 1000; i++) {
      apply("network.beforeRequestSent", `later-${i}`)
      apply("network.responseCompleted", `later-${i}`)
    }
    assert.isFalse(state.requests.has("active"))
    assert.isFalse(state.hops.has(first))
    assert.isFalse(state.hops.has(active.hop))
    assert.strictEqual(state.requests.size, 1000)
  }))

describe("BiDi terminal redirect body refusal", () => {
  for (
    const sample of [
      { status: 299, headers: [], refused: false },
      { status: 300, headers: [], refused: false },
      { status: 301, headers: [], refused: true },
      { status: 302, headers: [], refused: true },
      { status: 303, headers: [], refused: true },
      { status: 304, headers: [], refused: false },
      { status: 306, headers: [], refused: false },
      { status: 307, headers: [], refused: true },
      { status: 308, headers: [], refused: true },
      { status: 309, headers: [], refused: false },
      { status: 399, headers: [], refused: false },
      { status: 400, headers: [], refused: false },
      { status: 302, headers: [{ name: "lOcAtIoN", value: { type: "string", value: "/next" } }], refused: false },
      { status: 302, headers: [{ name: "Location", value: { type: "string", value: "" } }], refused: false }
    ]
  ) {
    it.effect(`bounds refusal to status ${sample.status} with ${sample.headers.length} Location headers (${sample.headers[0]?.value.value ?? "absent"})`, () =>
      Effect.gen(function*() {
        const { state, sent } = yield* withPage({ "network.getData": { bytes: { type: "string", value: "body" } } })
        const handlers = Network.register(Kit.handlers<State.Event>())
        const params = {
          context: "C1",
          userContext: "default",
          navigation: null,
          timestamp: 1,
          redirectCount: 0,
          isBlocked: false,
          request: {
            request: "terminal",
            url: "http://site.test/",
            method: "GET",
            headers: [],
            destination: "",
            bodySize: 0
          },
          response: {
            url: "http://site.test/",
            status: sample.status,
            statusText: "",
            protocol: "HTTP/1.1",
            headers: sample.headers,
            fromCache: false,
            bytesReceived: 4
          }
        }
        handlers.apply("network.beforeRequestSent", params, { state })
        handlers.apply("network.responseStarted", params, { state })
        const entry = state.requests.get("terminal")!
        if (sample.refused) {
          // No completion event is needed to identify this unsupported native read.
          const reading = yield* Network.responseBody(state, entry.hop).pipe(Effect.result, Effect.forkChild)
          yield* Effect.yieldNow
          assert.isDefined(reading.pollUnsafe(), "refusal must not wait for response completion")
          const result = yield* Fiber.join(reading)
          assert.strictEqual(result._tag, "Failure")
          if (result._tag === "Failure") {
            assert.deepStrictEqual(result.failure.reason, {
              _tag: "Unsupported",
              capability: "network.responseBody.terminalRedirect",
              hint:
                "Firefox does not answer network.getData for a terminal response with status 301, 302, 303, 307, or 308 without a Location header"
            })
          }
          assert.deepStrictEqual(sent, [])
          // A followed successor must clear the refusal and wait for its own completion.
          const next = { ...params, redirectCount: 1, response: { ...params.response, status: 200 } }
          handlers.apply("network.beforeRequestSent", next, { state })
          handlers.apply("network.responseStarted", next, { state })
          assert.isFalse(Deferred.isDoneUnsafe(entry.finished))
          handlers.apply("network.responseCompleted", next, { state })
          assert.strictEqual(new TextDecoder().decode(yield* Network.responseBody(state, entry.hop)), "body")
        } else {
          handlers.apply("network.responseCompleted", params, { state })
          assert.strictEqual(new TextDecoder().decode(yield* Network.responseBody(state, entry.hop)), "body")
        }
      }))
  }
})

it.effect("refuses a terminal BiDi response learned while a body read waits", () =>
  Effect.gen(function*() {
    const { state, sent } = yield* withPage({ "network.getData": { bytes: { type: "string", value: "wrong" } } })
    const handlers = Network.register(Kit.handlers<State.Event>())
    const params = {
      context: "C1",
      userContext: "default",
      navigation: null,
      timestamp: 1,
      redirectCount: 0,
      isBlocked: false,
      request: {
        request: "late-response",
        url: "http://site.test/",
        method: "GET",
        headers: [],
        destination: "",
        bodySize: 0
      },
      response: {
        url: "http://site.test/",
        status: 302,
        statusText: "",
        protocol: "HTTP/1.1",
        headers: [],
        fromCache: false,
        bytesReceived: 4
      }
    }
    handlers.apply("network.beforeRequestSent", params, { state })
    const entry = state.requests.get("late-response")!
    const reading = yield* Network.responseBody(state, entry.hop).pipe(Effect.result, Effect.forkChild)
    yield* Effect.yieldNow
    handlers.apply("network.responseStarted", params, { state })
    handlers.apply("network.responseCompleted", params, { state })
    const result = yield* Fiber.join(reading)
    assert.strictEqual(result._tag, "Failure")
    if (result._tag === "Failure") {
      assert.deepInclude(result.failure.reason, {
        _tag: "Unsupported",
        capability: "network.responseBody.terminalRedirect"
      })
    }
    assert.deepStrictEqual(sent, [])
  }))

it.effect("rejects a sandbox realm created in a replacement document while acquisition is pending", () =>
  Effect.gen(function*() {
    let create: Effect.Effect<unknown> = Effect.void
    const { document, page, state } = yield* withPage({
      "script.evaluate": Effect.suspend(() => create)
    })
    const handlers = Evaluation.register(Kit.handlers<State.Event>())
    create = Effect.sync(() => {
      Tree.commit(state, page, "https://example.test/", "https://example.test", { _tag: "Adopted" }, undefined, "test")
      handlers.apply("script.realmCreated", {
        realm: "replacement-utility",
        type: "window",
        context: "C1",
        origin: "https://example.test",
        sandbox: "utility"
      }, { state })
      return { type: "success", realm: "replacement-utility", result: { type: "number", value: 0 } }
    })
    const result = yield* Evaluation.realm(state, document.id, { _tag: "Isolated", name: "utility" }).pipe(Effect.exit)
    assert(
      Exit.isFailure(result),
      "realm acquisition must refuse the ended document instead of returning its replacement's realm"
    )
    if (Exit.isFailure(result)) {
      const error = yield* Effect.failCause(result.cause).pipe(Effect.flip)
      assert.strictEqual(error.reason._tag, "Gone")
      if (error.reason._tag === "Gone") {
        assert.deepStrictEqual(error.reason.target, { _tag: "Document", id: document.id })
      }
    }
  }).pipe(Effect.scoped))
