/**
 * The BiDi adapter's state, without a browser: an operation that names a page, document or realm of its own that
 * ended gets `Gone`, never `Foreign`; a handle it doesn't hold fails as `Gone` rather than being sent empty; and
 * base64 the browser sent that doesn't decode fails rather than giving empty bytes.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import type * as BrowsingContext from "../src/bidi-protocol/BrowsingContext.ts"
import type * as Script from "../src/bidi-protocol/Script.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Capture from "../src/internal/bidiAdapter/capture.ts"
import * as Contexts from "../src/internal/bidiAdapter/contexts.ts"
import * as Evaluation from "../src/internal/bidiAdapter/evaluation.ts"
import * as Navigation from "../src/internal/bidiAdapter/navigation.ts"
import * as State from "../src/internal/bidiAdapter/state.ts"
import * as Tree from "../src/internal/bidiAdapter/tree.ts"
import type * as ProtocolClient from "../src/internal/protocolClient.ts"
import type * as PageNavigation from "../src/PageNavigation.ts"
import * as Protocol from "../src/protocol/Protocol.ts"
import * as Target from "../src/Target.ts"

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
  const root = {
    key: undefined,
    send: (command: Protocol.Command<string, unknown, unknown>) =>
      Effect.suspend(() => {
        sent.push(command.method)
        const failure = failures[command.method]
        const reply = replies[command.method]
        return failure === undefined
          ? Effect.isEffect(reply) ? reply : Effect.succeed(reply)
          : Effect.fail(failure())
      }),
    drainObserved: Effect.void
  } as unknown as ProtocolClient.Session
  return { root, sent }
}

/** A state with one page in the default context, its document, and the document's main realm. */
const withPage = Effect.fnUntraced(function*(
  replies: Readonly<Record<string, unknown>> = {},
  failures: Readonly<Record<string, () => Protocol.ProtocolError>> = {}
) {
  const facts: Array<Adapter.Fact> = []
  const buffer = yield* Kit.makeFactBuffer((fact) => Effect.sync(() => void facts.push(fact)))
  buffer.connect(control)
  const { root, sent } = session(replies, failures)
  const state = State.make({
    connect: { sink: () => Effect.void, ownership: "launched" },
    ids: Kit.makeIds(),
    buffer,
    control,
    root: () => root
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
  return { state, page, document, realm, sent, facts }
})

describe("BidiAdapter state", () => {
  it.effect("keeps a late failed-navigation commit from taking the next navigation id", () =>
    Effect.gen(function*() {
      const facts: Array<Adapter.Fact> = []
      const buffer = yield* Kit.makeFactBuffer((fact) => Effect.sync(() => void facts.push(fact)))
      buffer.connect(control)
      const state = State.make({
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
      // ROOK-130: synthesized ordering inferred from the live failure, not captured protocol traffic.
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
      // ROOK-130: synthesized ordering inferred from the live failure, not captured protocol traffic.
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
              fact._tag === "DocumentCommitted" && fact.createdBy._tag === "ErrorPage"
            )
            assert.isDefined(errorDocument)
            assert.deepStrictEqual(errorDocument!._tag === "DocumentCommitted" && errorDocument!.createdBy, {
              _tag: "ErrorPage",
              navigation: refused!
            })
          }
          assert.isEmpty(page.expected.list)
          assert.isEmpty(page.commandNavigations)
          assert.isEmpty(page.navigationCommands)
          assert.isEmpty(page.pendingNavigationEvents)
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
      // ROOK-130: synthesized ordering, not captured protocol traffic.
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
      // ROOK-130: synthesized ordering, not captured protocol traffic.
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
          assert.deepStrictEqual(documents.find((fact) => fact.url === errorUrl)!.createdBy, {
            _tag: "ErrorPage",
            navigation: refused
          })
          assert.deepStrictEqual(documents.at(-1)!.createdBy, { _tag: "Navigation", navigation: secondReserved! })
          assert.strictEqual(page.document!.url, second)
          assert.isEmpty(page.expected.list)
          assert.isEmpty(page.commandNavigations)
          assert.isEmpty(page.navigationCommands)
          assert.isEmpty(page.pendingNavigationEvents)
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
      assert.strictEqual(page.commandNavigations.get("nb")?.id, secondReserved)
      assert.isTrue(page.pendingNavigationEvents.some((event) => event.kind === "start"))
      const firstEntry = state.navigations.get("na")!
      Tree.removeNavigable(state, page, new Target.PageClosed({ by: "command" }), "test")
      assert.isTrue(firstEntry.ended)
      yield* Deferred.succeed(release, undefined)
      assert.strictEqual(yield* Fiber.join(running), firstReserved)
      yield* state.buffer.flush
      assert.deepStrictEqual(facts.filter((fact) => fact._tag === "NavigationStarted").map((fact) => fact.navigation), [
        firstReserved
      ])
      assert.lengthOf(facts.filter((fact) => fact._tag === "DocumentCommitted"), 1)
      assert.isEmpty(page.expected.list)
      assert.isEmpty(page.commandNavigations)
      assert.isEmpty(page.navigationCommands)
      assert.isEmpty(page.pendingNavigationEvents)
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
      // ROOK-130: synthesized ordering, not captured protocol traffic.
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
            assert.isNotEmpty(page.pendingNavigationEvents)
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
            assert.strictEqual(errorDocument.createdBy._tag, "ErrorPage")
            if (errorDocument.createdBy._tag === "ErrorPage") {
              if (completion === "interrupted") {
                assert.notStrictEqual(errorDocument.createdBy.navigation, secondReserved)
              } else assert.strictEqual(errorDocument.createdBy.navigation, firstReserved)
            }
            assert.strictEqual(documents.at(-1)!.url, second)
            assert.strictEqual(page.document!.url, second + "#new")
            assert.isTrue(page.document!.complete)
            assert.deepStrictEqual(documents.at(-1)!.createdBy, { _tag: "Navigation", navigation: secondReserved })
            assert.isEmpty(page.expected.list)
            assert.isEmpty(page.commandNavigations)
            assert.isEmpty(page.navigationCommands)
            assert.isEmpty(page.pendingNavigationEvents)
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
        assert.isEmpty(page.pendingNavigationEvents)
        assert.isUndefined(page.failedNavigation)
        if (mode === "rejected") {
          const ended = facts.filter((fact) => fact._tag === "NavigationEnded")
          assert.lengthOf(ended, 1)
          assert.strictEqual(ended[0]!.outcome._tag, "Failed")
          const errorDocument = facts.find((fact) =>
            fact._tag === "DocumentCommitted" && fact.createdBy._tag === "ErrorPage"
          )
          assert.isDefined(errorDocument)
          assert.deepStrictEqual(errorDocument!._tag === "DocumentCommitted" && errorDocument!.createdBy, {
            _tag: "ErrorPage",
            navigation: ended[0]!.navigation
          })
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
        assert.deepStrictEqual(document.createdBy, { _tag: "ErrorPage", navigation: reserved })
        assert.isEmpty(page.commandNavigations)
        assert.isEmpty(page.pendingNavigationEvents)
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
        assert.isEmpty(page.pendingNavigationEvents)
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
