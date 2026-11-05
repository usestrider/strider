/** Document retention must finish before Automation can discard the previous document's resources. */
import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Semaphore from "effect/Semaphore"
import { TestClock } from "effect/testing"
import * as Deadline from "../src/Deadline.ts"
import * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as BoundedAdapter from "../src/internal/boundedAdapter.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Operation from "../src/internal/operation.ts"
import * as Automation from "../src/internal/webkitAdapter/automation.ts"
import * as Network from "../src/internal/webkitAdapter/network.ts"
import * as State from "../src/internal/webkitAdapter/state.ts"
import * as Protocol from "../src/protocol/Protocol.ts"

const fixture = Effect.fnUntraced(function*(collect: boolean) {
  const ids = Kit.makeIds()
  const bodyReply = yield* Deferred.make<{ body: string; base64Encoded: boolean }>()
  const bodyStarted = yield* Deferred.make<void>()
  const sent: Array<string> = []
  const buffer = yield* Kit.makeFactBuffer(() => Effect.void)
  buffer.connect({ run: (effect: Effect.Effect<void>) => effect } as never)
  const context = { id: ids.userContext(), browserContextId: "context" } as State.ContextEntry
  const page = {
    id: ids.navigable(),
    context,
    ready: Deferred.makeUnsafe<void>(),
    ended: false
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
      assert.strictEqual(command.method, "Network.getResponseBody")
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
    resourceType: "document",
    finished: Deferred.makeUnsafe<void, string>(),
    kept: undefined,
    url: "https://example.test/first"
  } as State.RequestEntry
  request.hop = ids.hop(request.id, 0)
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
    registry: { bodyLimit: () => collect ? Option.some(1024) : Option.none() },
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
  const handlers = Network.register(Kit.handlers<State.Event>())
  const finish = buffer.run(() =>
    handlers.apply("Network.loadingFinished", { requestId: "0.12" }, {
      state,
      session
    } as State.Event)
  )
  const adapter = BoundedAdapter.make({
    navigate: (id, url, options) => Automation.navigateLaunched(state, id, url, options)
  } as Adapter.AdapterConnection)
  const navigate = adapter.navigate(page.id, "https://example.test/second", { referrer: Option.none() }).pipe(
    Operation.named("Page.goto")
  )
  return { navigate, finish, sent, request, bodyStarted, bodyReply }
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

  for (const phase of ["before loadingFinished", "during body read"]) {
    it.effect(`interrupts the collection wait ${phase} without dispatching a late navigation`, () =>
      Effect.gen(function*() {
        const f = yield* fixture(true)
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

    it.effect(`ends the collection wait ${phase} at the navigation deadline with no grace or late dispatch`, () =>
      Effect.gen(function*() {
        const clock = BrowserClock.fromClock(yield* Clock.Clock)
        const f = yield* fixture(true)
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
})
