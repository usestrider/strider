/** Document retention must finish before Automation can discard the previous document's resources. */
import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import { TestClock } from "effect/testing"
import * as Deadline from "../src/Deadline.ts"
import * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as BoundedAdapter from "../src/internal/boundedAdapter.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Declarations from "../src/internal/declarations.ts"
import * as Operation from "../src/internal/operation.ts"
import * as Automation from "../src/internal/webkitAdapter/automation.ts"
import * as Declare from "../src/internal/webkitAdapter/declare.ts"
import * as Navigation from "../src/internal/webkitAdapter/navigation.ts"
import * as Network from "../src/internal/webkitAdapter/network.ts"
import * as State from "../src/internal/webkitAdapter/state.ts"
import * as Targets from "../src/internal/webkitAdapter/targets.ts"
import * as Protocol from "../src/protocol/Protocol.ts"

const fixture = Effect.fnUntraced(function*(collect: boolean, via: "automation" | "reload" | "script" = "automation") {
  const ids = Kit.makeIds()
  const bodyReply = yield* Deferred.make<{ body: string; base64Encoded: boolean }, Protocol.ProtocolError>()
  const bodyStarted = yield* Deferred.make<void>()
  const sent: Array<string> = []
  const buffer = yield* Kit.makeFactBuffer(() => Effect.void)
  buffer.connect({ run: (effect: Effect.Effect<void>) => effect } as never)
  const context = { id: ids.userContext(), browserContextId: "context" } as State.ContextEntry
  const page = {
    id: ids.navigable(),
    context,
    ready: Deferred.makeUnsafe<void>(),
    ended: false,
    retaining: new Set()
  } as unknown as State.PageEntry
  Deferred.doneUnsafe(page.ready, Effect.void)
  const frame = {
    id: page.id,
    page,
    parent: undefined,
    removed: false,
    expected: Kit.makeExpectations(),
    document: { url: "https://example.test/first", loaderId: "first" }
  } as unknown as State.FrameEntry
  const session = {
    key: "inspector:page-17",
    send: Effect.fnUntraced(function*(command: Protocol.Command<string, unknown, unknown>) {
      sent.push(command.method)
      if (command.method !== "Network.getResponseBody") return {}
      yield* Deferred.succeed(bodyStarted, undefined)
      return yield* Deferred.await(bodyReply)
    })
  } as unknown as State.RequestEntry["session"]
  const request = {
    id: ids.request(),
    session,
    requestId: "0.12",
    redirects: 0,
    frame,
    loaderId: frame.document!.loaderId,
    resourceType: "document",
    finished: Deferred.makeUnsafe<void, string>(),
    kept: undefined,
    url: "https://example.test/first"
  } as State.RequestEntry
  request.hop = ids.hop(request.id, 0)
  request.responded = request.hop
  const state = {
    ids,
    buffer,
    pairing: Semaphore.makeUnsafe(1),
    navigables: new Map([[frame.id, frame]]),
    pages: new Map([[page.id, page]]),
    endedPages: new Map(),
    pageHandles: new Map([[page, "handle"]]),
    requests: new Map([[State.requestKey(session, request.requestId), request]]),
    hops: new Map([[request.hop, request]]),
    registry: Declarations.make(),
    retire: () => {},
    automation: {
      process: () => ({
        automation: {
          send: (command: Protocol.Command<string, unknown, unknown>) =>
            Effect.sync(() => {
              sent.push(command.method)
              return {}
            })
        }
      })
    }
  } as unknown as State.State
  const collection = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(collection, Exit.void))
  if (collect) {
    yield* Declare.declare(state, { _tag: "Page", page: page.id }, {
      _tag: "BodyCollection",
      bodies: ["response"],
      maxBytes: 1024
    }).pipe(Effect.provideService(Scope.Scope, collection))
  }
  const target = { page, session, ended: false } as State.TargetEntry
  Object.assign(page, { target, main: frame })
  Object.assign(state, {
    workers: new Map(),
    targets: new Map([[session, target]]),
    pausedRequests: new Map(),
    realms: new Map()
  })
  const endTarget = buffer.run(() => Targets.ended(state, session, { why: "targetClosed" } as never))
  const otherPage = buffer.run(() => {
    Object.assign(request, { frame: { ...frame, page: {} as State.PageEntry } })
  })
  const handlers = Network.register(Kit.handlers<State.Event>())
  const finish = buffer.run(() =>
    handlers.apply("Network.loadingFinished", { requestId: "0.12" }, {
      state,
      session
    } as State.Event)
  )
  const adapter = BoundedAdapter.make({
    navigate: (id, url, options) =>
      via === "reload"
        ? Navigation.reload(state, id, { ignoreCache: false })
        : via === "script" ?
        Navigation.navigateByScript(state, id, url, options)
        : Automation.navigateLaunched(state, id, url, options)
  } as Adapter.AdapterConnection)
  const navigate = adapter.navigate(page.id, "https://example.test/second", { referrer: Option.none() }).pipe(
    Operation.named("Page.goto")
  )
  const fail = buffer.run(() =>
    handlers.apply("Network.loadingFailed", {
      requestId: "0.12",
      errorText: "Canceled",
      canceled: true
    }, { state, session } as State.Event)
  )
  const release = Scope.close(collection, Exit.void)
  return { navigate, finish, fail, release, endTarget, otherPage, sent, request, bodyStarted, bodyReply, state }
})

describe("WebKit document body retention before navigation", () => {
  it.effect("waits before loadingFinished and through the body reply when collection is enabled", () =>
    Effect.gen(function*() {
      const f = yield* fixture(true)
      const navigation = yield* f.navigate.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      assert.deepStrictEqual(f.sent, [], "the next navigation must not precede loadingFinished")
      assert.isUndefined(f.request.kept)
      yield* f.finish
      yield* Deferred.await(f.bodyStarted)
      assert.deepStrictEqual(f.sent, ["Network.getResponseBody"], "dispatch must also await the body reply")
      yield* Deferred.succeed(f.bodyReply, { body: "<title>cookie</title>", base64Encoded: false })
      yield* Fiber.join(navigation)
      assert.deepStrictEqual(f.sent, ["Network.getResponseBody", "Automation.navigateBrowsingContext"])
      assert.strictEqual(new TextDecoder().decode(yield* Deferred.await(f.request.kept!)), "<title>cookie</title>")
    }).pipe(Effect.scoped))

  it.effect("does not wait for a document request that never received a response", () =>
    Effect.gen(function*() {
      const f = yield* fixture(true)
      yield* f.finish
      yield* Deferred.await(f.bodyStarted)
      yield* Deferred.succeed(f.bodyReply, { body: "cookie", base64Encoded: false })
      // A navigation to a server that never answers: no response, so no body to retain, and the next
      // navigation is what cancels it
      const pending = {
        ...f.request,
        requestId: "0.13",
        responded: undefined,
        finished: Deferred.makeUnsafe<void, string>(),
        kept: undefined,
        url: "https://example.test/hung"
      } as State.RequestEntry
      f.state.requests.set(State.requestKey(pending.session, pending.requestId), pending)
      const navigation = yield* f.navigate.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      assert.deepStrictEqual(
        f.sent,
        ["Network.getResponseBody", "Automation.navigateBrowsingContext"],
        "a load with no response must not hold the next navigation until its deadline"
      )
      yield* Fiber.interrupt(navigation)
    }).pipe(Effect.scoped))

  for (const via of ["automation", "reload", "script"] as const) {
    for (
      const kind of [
        "unresponded provisional",
        "responded uncommitted",
        "unfinished iframe",
        "previous-hop response"
      ] as const
    ) {
      it.effect(`does not hold ${via} for an ${kind} load`, () =>
        Effect.gen(function*() {
          const f = yield* fixture(true, via)
          yield* f.finish
          yield* Deferred.await(f.bodyStarted)
          yield* Deferred.succeed(f.bodyReply, { body: "cookie", base64Encoded: false })
          yield* Deferred.await(f.request.kept!)
          const hop = f.state.ids.hop(f.state.ids.request(), 0)
          const main = f.request.frame!
          const pending = {
            ...f.request,
            requestId: "pending",
            hop,
            responded: kind === "unresponded provisional"
              ? undefined
              : kind === "previous-hop response"
              ? f.request.hop
              : hop,
            // Deliberately the same URL: committed loader identity, not URL equality, selects the document.
            loaderId: kind === "previous-hop response" ? main.document!.loaderId : "different-loader",
            frame: kind === "unfinished iframe" ? { ...main, parent: main, id: f.state.ids.navigable() } : main,
            finished: Deferred.makeUnsafe<void, string>(),
            kept: undefined
          } as State.RequestEntry
          f.state.requests.set(State.requestKey(pending.session, pending.requestId), pending)
          const navigation = yield* f.navigate.pipe(Effect.forkChild)
          yield* Effect.yieldNow
          const command = via === "automation"
            ? "Automation.navigateBrowsingContext"
            : via === "reload"
            ? "Page.reload"
            : "Runtime.evaluate"
          assert.deepStrictEqual(f.sent, ["Network.getResponseBody", command])
          yield* Fiber.join(navigation)
        }).pipe(Effect.scoped))
    }
  }

  for (const kind of ["iframe", "uncommitted"] as const) {
    it.effect(`still waits for an already-started ${kind} document body read`, () =>
      Effect.gen(function*() {
        const f = yield* fixture(true)
        if (kind === "iframe") Object.assign(f.request, { frame: { ...f.request.frame!, parent: f.request.frame } })
        else Object.assign(f.request, { loaderId: "uncommitted-loader" })
        yield* f.finish
        yield* Deferred.await(f.bodyStarted)
        const navigation = yield* f.navigate.pipe(Effect.forkChild)
        yield* Effect.yieldNow
        assert.deepStrictEqual(f.sent, ["Network.getResponseBody"])
        yield* Deferred.succeed(f.bodyReply, { body: "cookie", base64Encoded: false })
        yield* Fiber.join(navigation)
        assert.deepStrictEqual(f.sent, ["Network.getResponseBody", "Automation.navigateBrowsingContext"])
      }).pipe(Effect.scoped))
  }

  for (const via of ["automation", "reload", "script"] as const) {
    it.effect(`bypasses retention wait machinery for ${via} without collection`, () =>
      Effect.gen(function*() {
        const f = yield* fixture(false, via)
        assert.isUndefined(
          Network.beforeNavigation(f.state, f.request.frame!.page),
          "collection off must select no Effect to yield"
        )
        const waitFor = f.state.buffer.waitFor
        let calls = 0
        Object.assign(f.state.buffer, {
          waitFor: <A>(check: () => A | undefined) => {
            calls++
            return waitFor(check)
          }
        })
        yield* f.navigate
        assert.strictEqual(calls, 0)
        assert.strictEqual(f.sent.length, 1)
      }).pipe(Effect.scoped))
  }

  for (const via of ["automation", "reload", "script"] as const) {
    it.effect(`checks collection at ${via} execution before selecting any retention Effect`, () =>
      Effect.gen(function*() {
        const f = yield* fixture(true, via)
        const waitFor = f.state.buffer.waitFor
        let calls = 0
        Object.assign(f.state.buffer, {
          waitFor: <A>(check: () => A | undefined) => {
            calls++
            return waitFor(check)
          }
        })
        yield* f.release
        yield* f.navigate
        assert.strictEqual(calls, 0)
        yield* Declare.declare(f.state, { _tag: "Page", page: f.request.frame!.page.id }, {
          _tag: "BodyCollection",
          bodies: ["response"],
          maxBytes: 1024
        })
        const waiting = yield* f.navigate.pipe(Effect.forkChild)
        yield* Effect.yieldNow
        assert.strictEqual(calls, 1)
        assert.isUndefined(waiting.pollUnsafe())
        yield* Fiber.interrupt(waiting)
      }).pipe(Effect.scoped))
  }

  it.effect("dispatches without waiting for loadingFinished when collection is disabled", () =>
    Effect.gen(function*() {
      const f = yield* fixture(false)
      yield* f.navigate
      assert.deepStrictEqual(f.sent, ["Automation.navigateBrowsingContext"])
      yield* f.finish
      assert.isUndefined(f.request.kept)
      assert.deepStrictEqual(f.sent, ["Automation.navigateBrowsingContext"])
    }).pipe(Effect.scoped))

  it.effect("retains the document body and dispatches once retention is already complete", () =>
    Effect.gen(function*() {
      const f = yield* fixture(true)
      yield* f.finish
      yield* Deferred.await(f.bodyStarted)
      yield* Deferred.succeed(f.bodyReply, { body: "cookie", base64Encoded: false })
      assert.strictEqual(new TextDecoder().decode(yield* Deferred.await(f.request.kept!)), "cookie")
      yield* f.navigate
      assert.deepStrictEqual(f.sent, ["Network.getResponseBody", "Automation.navigateBrowsingContext"])
    }).pipe(Effect.scoped))

  for (const via of ["reload", "script"] as const) {
    it.effect(`coordinates inspector ${via} with document retention`, () =>
      Effect.gen(function*() {
        const f = yield* fixture(true, via)
        const navigation = yield* f.navigate.pipe(Effect.forkChild)
        yield* Effect.yieldNow
        assert.deepStrictEqual(f.sent, [])
        yield* f.finish
        yield* Deferred.await(f.bodyStarted)
        assert.deepStrictEqual(f.sent, ["Network.getResponseBody"])
        yield* Deferred.succeed(f.bodyReply, { body: "cookie", base64Encoded: false })
        yield* Fiber.join(navigation)
        assert.deepStrictEqual(f.sent, [
          "Network.getResponseBody",
          via === "reload" ? "Page.reload" : "Runtime.evaluate"
        ])
      }).pipe(Effect.scoped))
  }

  it.effect("keeps waiting when bounded request history forgets an active body read", () =>
    Effect.gen(function*() {
      const f = yield* fixture(true)
      yield* f.finish
      yield* Deferred.await(f.bodyStarted)
      f.state.requests.clear()
      const navigation = yield* f.navigate.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      assert.deepStrictEqual(f.sent, ["Network.getResponseBody"])
      yield* Deferred.succeed(f.bodyReply, { body: "cookie", base64Encoded: false })
      yield* Fiber.join(navigation)
      assert.deepStrictEqual(f.sent, ["Network.getResponseBody", "Automation.navigateBrowsingContext"])
    }).pipe(Effect.scoped))

  it.effect("dispatches after the document target ends", () =>
    Effect.gen(function*() {
      const f = yield* fixture(true)
      const navigation = yield* f.navigate.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      assert.deepStrictEqual(f.sent, [])
      yield* f.endTarget
      yield* Fiber.join(navigation)
      assert.deepStrictEqual(f.sent, ["Automation.navigateBrowsingContext"])
    }).pipe(Effect.scoped))

  it.effect("does not wait for another page's document", () =>
    Effect.gen(function*() {
      const f = yield* fixture(true)
      yield* f.otherPage
      yield* f.navigate
      assert.deepStrictEqual(f.sent, ["Automation.navigateBrowsingContext"])
    }).pipe(Effect.scoped))

  it.effect("dispatches after a failed document load", () =>
    Effect.gen(function*() {
      const f = yield* fixture(true)
      const navigation = yield* f.navigate.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      assert.deepStrictEqual(f.sent, [])
      yield* f.fail
      yield* Fiber.join(navigation)
      assert.deepStrictEqual(f.sent, ["Automation.navigateBrowsingContext"])
    }).pipe(Effect.scoped))

  it.effect("dispatches after a failed body read", () =>
    Effect.gen(function*() {
      const f = yield* fixture(true)
      yield* f.finish
      yield* Deferred.await(f.bodyStarted)
      const navigation = yield* f.navigate.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Deferred.fail(
        f.bodyReply,
        new Protocol.ProtocolError({
          reason: new Protocol.Rejected({
            method: "Network.getResponseBody",
            reason: "Unrecognized",
            code: -32000,
            description: "Missing resource for given requestId"
          })
        })
      )
      yield* Fiber.join(navigation)
      assert.deepStrictEqual(f.sent, ["Network.getResponseBody", "Automation.navigateBrowsingContext"])
    }).pipe(Effect.scoped))

  for (const phase of ["before loadingFinished", "during body read"]) {
    it.effect(`dispatches when collection is released ${phase}`, () =>
      Effect.gen(function*() {
        const f = yield* fixture(true)
        if (phase === "during body read") {
          yield* f.finish
          yield* Deferred.await(f.bodyStarted)
        }
        const navigation = yield* f.navigate.pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* f.release
        yield* Fiber.join(navigation)
        assert.strictEqual(f.sent.at(-1), "Automation.navigateBrowsingContext")
        yield* Deferred.succeed(f.bodyReply, { body: "cookie", base64Encoded: false })
      }).pipe(Effect.scoped))
  }

  for (const via of ["automation", "reload", "script"] as const) {
    for (const phase of ["before loadingFinished", "during body read"]) {
      it.effect(`${via}: interrupts the collection wait ${phase} without dispatching a late navigation`, () =>
        Effect.gen(function*() {
          const f = yield* fixture(true, via)
          if (phase === "during body read") {
            yield* f.finish
            yield* Deferred.await(f.bodyStarted)
          }
          const navigation = yield* f.navigate.pipe(Effect.forkChild)
          yield* Effect.yieldNow
          yield* Fiber.interrupt(navigation)
          const exit = yield* Fiber.await(navigation)
          assert.isTrue(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause))
          if (phase === "before loadingFinished") yield* f.finish
          yield* Deferred.await(f.bodyStarted)
          yield* Deferred.succeed(f.bodyReply, { body: "cookie", base64Encoded: false })
          yield* Effect.yieldNow
          assert.deepStrictEqual(f.sent, ["Network.getResponseBody"])
        }).pipe(Effect.scoped))

      it.effect(`${via}: ends the committed streaming document collection wait ${phase} at the navigation deadline with no grace or late dispatch`, () =>
        Effect.gen(function*() {
          const clock = BrowserClock.fromClock(yield* Clock.Clock)
          const f = yield* fixture(true, via)
          if (phase === "during body read") {
            yield* f.finish
            yield* Deferred.await(f.bodyStarted)
          }
          const navigation = yield* f.navigate.pipe(
            Deadline.within("100 millis"),
            Effect.provideService(BrowserClock.CurrentClock, clock),
            Effect.forkChild
          )
          yield* TestClock.adjust("100 millis")
          assert.isDefined(navigation.pollUnsafe(), "the deadline must end the wait without extra grace")
          const exit = yield* Fiber.await(navigation)
          assert.isTrue(Exit.isFailure(exit))
          if (Exit.isFailure(exit)) assert.isTrue(Deadline.isTimeout(Option.getOrThrow(Exit.findErrorOption(exit))))
          if (phase === "before loadingFinished") yield* f.finish
          yield* Deferred.await(f.bodyStarted)
          yield* Deferred.succeed(f.bodyReply, { body: "cookie", base64Encoded: false })
          yield* Effect.yieldNow
          assert.deepStrictEqual(f.sent, ["Network.getResponseBody"])
        }).pipe(Effect.scoped))
    }
  }
})
