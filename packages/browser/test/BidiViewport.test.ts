/**
 * BiDi viewport declarations, without a browser: a scope's release restores every target it can reach, whichever
 * one rejects its command, and a user context whose setup fails doesn't stay behind.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import { TestClock } from "effect/testing"
import type * as BrowserBidi from "../src/bidi-protocol/Browser.ts"
import type * as BrowsingContext from "../src/bidi-protocol/BrowsingContext.ts"
import * as Deadline from "../src/Deadline.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Contexts from "../src/internal/bidiAdapter/contexts.ts"
import * as Declare from "../src/internal/bidiAdapter/declare.ts"
import * as State from "../src/internal/bidiAdapter/state.ts"
import * as Tree from "../src/internal/bidiAdapter/tree.ts"
import * as Bounded from "../src/internal/boundedAdapter.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as DeclarationCleanup from "../src/internal/declarationCleanup.ts"
import * as Operation from "../src/internal/operation.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Protocol from "../src/protocol/Protocol.ts"

interface Sent {
  readonly method: string
  readonly params: {
    readonly context?: string
    readonly userContexts?: ReadonlyArray<string>
    readonly viewport?: { readonly width: number; readonly height: number } | null
  }
}

const control: ProtocolClient.FoldControl = {
  sync: () => {},
  session: () => undefined,
  run: (effect) => effect
}

const rejected = (method: string) =>
  new Protocol.ProtocolError({
    reason: new Protocol.Rejected({ method, reason: "NoSuchFrame", code: "no such frame", description: "gone" })
  })

/** A state whose session records each command, and rejects those `rejects` picks. */
const make = Effect.fnUntraced(function*() {
  const sent: Array<Sent> = []
  const facts: Array<Adapter.Fact> = []
  const session: {
    rejects: (entry: Sent) => boolean
    around: (
      entry: Sent,
      next: Effect.Effect<unknown, Protocol.ProtocolError>
    ) => Effect.Effect<unknown, Protocol.ProtocolError>
  } = { rejects: () => false, around: (_, next) => next }
  let contexts = 0
  const root = {
    key: undefined,
    send: (command: Protocol.Command<string, unknown, unknown>) =>
      Effect.suspend(() => {
        const entry = { method: command.method, params: command.params } as Sent
        sent.push(entry)
        const result = session.rejects(entry)
          ? Effect.fail(rejected(command.method))
          : Effect.succeed(command.method === "browser.createUserContext" ? { userContext: `U${++contexts}` } : {})
        return session.around(entry, result)
      }),
    drainObserved: Effect.void
  } as unknown as ProtocolClient.Session
  const buffer = yield* Kit.makeFactBuffer((fact) =>
    Effect.sync(() => {
      facts.push(fact)
    })
  )
  buffer.connect(control)
  const state = State.make({
    cleanupScope: yield* Effect.scope,
    connect: { sink: () => Effect.void, ownership: "launched" },
    ids: Kit.makeIds(),
    buffer,
    control,
    root: () => root
  })
  const page = (context: string, userContext: BrowserBidi.UserContext | "default" = "default") =>
    Tree.addNavigable(state, {
      context: context as BrowsingContext.BrowsingContext,
      userContext,
      originalOpener: null,
      url: "about:blank"
    }, false)!
  return { state, sent, session, page, facts }
})

const viewport = (width: number): Adapter.Declaration => ({
  _tag: "Override",
  override: { _tag: "Viewport", width, height: 600, deviceScaleFactor: 1, mobile: false }
})

const declare = (state: State.State, scope: Adapter.DeclarationScope, width: number, lifetime: Scope.Scope) =>
  Declare.declare(state, scope, viewport(width)).pipe(Effect.provideService(Scope.Scope, lifetime))

const options: Adapter.UserContextOptions = { proxy: Option.none(), acceptInsecureCerts: false, reclaimable: false }

const widthsFor = (sent: ReadonlyArray<Sent>, target: (params: Sent["params"]) => boolean) =>
  sent
    .filter((entry) => entry.method === "browsingContext.setViewport" && target(entry.params))
    .map((entry) => entry.params.viewport?.width ?? null)

describe("BidiAdapter viewports", () => {
  it.effect("restores a page override on release when another page rejects its command", () =>
    Effect.gen(function*() {
      const { page, sent, session, state } = yield* make()
      const rejecting = page("P1")
      const open = page("P2")
      const context = state.defaultContext
      const lifetime = yield* Scope.make()
      yield* declare(state, { _tag: "Page", page: rejecting.page.id }, 640, yield* Scope.make())
      yield* declare(state, { _tag: "Page", page: open.page.id }, 700, yield* Scope.make())
      yield* declare(state, { _tag: "UserContext", context }, 1000, lifetime)
      sent.length = 0
      session.rejects = (entry) => entry.params.context === "P1"
      yield* Scope.close(lifetime, Exit.void)
      assert.deepStrictEqual(widthsFor(sent, (params) => params.userContexts !== undefined), [null])
      assert.deepStrictEqual(widthsFor(sent, (params) => params.context === "P2"), [700])
    }))

  it.effect("restores the other user contexts on a browser release when one rejects its command", () =>
    Effect.gen(function*() {
      const { sent, session, state } = yield* make()
      yield* Contexts.createUserContext(state, options)
      yield* Contexts.createUserContext(state, options)
      const lifetime = yield* Scope.make()
      yield* declare(state, { _tag: "Browser" }, 1100, lifetime)
      sent.length = 0
      session.rejects = (entry) => entry.params.userContexts?.includes("U1") === true
      yield* Scope.close(lifetime, Exit.void)
      assert.deepStrictEqual(widthsFor(sent, (params) => params.userContexts?.includes("U2") === true), [null])
    }))

  it.effect("declares a context's viewport while another of its pages is closing", () =>
    Effect.gen(function*() {
      const { page, sent, session, state } = yield* make()
      const closing = page("P1")
      yield* declare(state, { _tag: "Page", page: closing.page.id }, 640, yield* Scope.make())
      yield* Contexts.closePage(state, closing.page.id, { runBeforeUnload: false })
      sent.length = 0
      session.rejects = (entry) => entry.params.context === "P1"
      const exit = yield* Effect.exit(
        declare(state, { _tag: "UserContext", context: state.defaultContext }, 1000, yield* Scope.make())
      )
      assert.isTrue(Exit.isSuccess(exit))
      assert.deepStrictEqual(widthsFor(sent, (params) => params.context === "P1"), [])
    }))

  it.effect("removes a user context whose viewport setup fails", () =>
    Effect.gen(function*() {
      const { sent, session, state } = yield* make()
      session.rejects = (entry) => entry.method === "browsingContext.setViewport"
      const exit = yield* Effect.exit(Contexts.createUserContext(state, options))
      assert.isTrue(Exit.isFailure(exit))
      assert.isTrue(sent.some((entry) => entry.method === "browser.removeUserContext"))
      assert.isFalse([...state.contexts.values()].some((context) => context.bidi === "U1"))
    }))

  it.effect("rolls back an interrupted viewport seed with detached cleanup and matching model facts", () =>
    Effect.gen(function*() {
      const { session, state, facts, page } = yield* make()
      const started = yield* Deferred.make<void>()
      let cleanupDetached = false
      session.around = (entry, next) => {
        if (entry.method === "browsingContext.setViewport") {
          page("P1", "U1" as BrowserBidi.UserContext)
          return Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
        }
        if (entry.method === "browser.removeUserContext") {
          return Effect.gen(function*() {
            cleanupDetached = Option.isNone(yield* Operation.current)
            return yield* next
          })
        }
        return next
      }
      const creating = yield* Contexts.createUserContext(state, options).pipe(
        Operation.named("Test.createContext"),
        Effect.forkChild
      )
      yield* Deferred.await(started)
      yield* Fiber.interrupt(creating)
      assert.isTrue(cleanupDetached)
      assert.isFalse(state.contextsByBidi.has("U1"))
      assert.isFalse(state.navigables.has("P1"))
      const added = facts.find((fact) => fact._tag === "UserContextAdded")!
      assert.deepStrictEqual(facts.filter((fact) => fact._tag === "UserContextRemoved"), [
        { _tag: "UserContextRemoved", context: added.context }
      ])
      const pageEnd = facts.findIndex((fact) => fact._tag === "NavigableRemoved")
      assert.isAtLeast(pageEnd, 0)
      assert.isBelow(pageEnd, facts.findIndex((fact) => fact._tag === "UserContextRemoved"))
    }))

  it.effect("rolls back a viewport command deadline under a fresh cleanup deadline", () =>
    Effect.gen(function*() {
      const { session, state, facts } = yield* make()
      const clock = BrowserClock.fromClock(yield* Clock.Clock)
      const started = yield* Deferred.make<void>()
      let seedDeadline = 0
      let cleanupDeadline = 0
      session.around = Effect.fnUntraced(function*(entry, next) {
        const deadline = yield* ProtocolClient.CommandDeadline
        if (entry.method === "browsingContext.setViewport") {
          assert.isTrue(Option.isSome(deadline))
          seedDeadline = Option.getOrThrow(deadline)
          yield* Deferred.succeed(started, undefined)
          yield* BrowserClock.until(Option.getOrThrow(deadline))(Effect.never)
          return yield* Effect.fail(
            new Protocol.ProtocolError({
              reason: new Protocol.NoReply({ method: entry.method, timeout: Duration.millis(10) })
            })
          )
        }
        if (entry.method === "browser.removeUserContext") cleanupDeadline = Option.getOrThrow(deadline)
        return yield* next
      })
      const adapter = Bounded.make({
        createUserContext: () => Contexts.createUserContext(state, options),
        removeUserContext: (id: import("../src/UserContext.ts").Id) => Contexts.removeUserContext(state, id)
      } as unknown as Adapter.AdapterConnection)
      yield* Effect.gen(function*() {
        const creating = yield* adapter.createUserContext(options).pipe(
          Operation.named("Test.createContext"),
          Deadline.within("10 millis"),
          Effect.exit,
          Effect.forkChild
        )
        yield* Deferred.await(started)
        yield* TestClock.adjust("10 millis")
        const result = yield* Fiber.join(creating)
        assert.isTrue(Exit.isFailure(result))
        if (Exit.isFailure(result)) assert.isTrue(Deadline.isTimeout(Option.getOrThrow(Exit.findErrorOption(result))))
        yield* state.buffer.waitFor(() => facts.some((fact) => fact._tag === "UserContextRemoved") ? true : undefined)
        assert.isAbove(cleanupDeadline, seedDeadline)
        assert.isFalse(state.contextsByBidi.has("U1"))
      }).pipe(Effect.provideService(BrowserClock.CurrentClock, clock))
    }))

  for (const failure of ["reject", "timeout"] as const) {
    it.effect(`preserves the seed error and known context when rollback ${failure}s`, () =>
      Effect.gen(function*() {
        const { session, state, facts } = yield* make()
        const clock = BrowserClock.fromClock(yield* Clock.Clock)
        const removing = yield* Deferred.make<void>()
        session.rejects = (entry) => entry.method === "browsingContext.setViewport"
        session.around = (entry, next) =>
          entry.method === "browser.removeUserContext"
            ? Deferred.succeed(removing, undefined).pipe(Effect.andThen(
              failure === "timeout" ? Effect.never : Effect.fail(rejected(entry.method))
            ))
            : next
        const creating = yield* Contexts.createUserContext(state, options).pipe(
          Effect.provideService(BrowserClock.CurrentClock, clock),
          Effect.exit,
          Effect.forkChild
        )
        yield* Effect.raceFirst(Deferred.await(removing), Fiber.await(creating).pipe(Effect.asVoid))
        assert.isTrue(yield* Deferred.isDone(removing))
        if (failure === "timeout") yield* TestClock.adjust("5 seconds")
        const result = yield* Fiber.join(creating)
        assert.isTrue(Exit.isFailure(result))
        if (Exit.isFailure(result)) {
          const error = Option.getOrThrow(Exit.findErrorOption(result)) as Adapter.AdapterError
          assert.strictEqual(error.reason._tag, "Protocol")
          if (error.reason._tag === "Protocol") {
            assert.strictEqual(error.reason.error.reason._tag, "Rejected")
            if (error.reason.error.reason._tag === "Rejected") {
              assert.strictEqual(error.reason.error.reason.method, "browsingContext.setViewport")
            }
          }
        }
        assert.isTrue(state.contextsByBidi.has("U1"))
        assert.isFalse(state.contextsByBidi.get("U1")!.removing)
        assert.lengthOf(facts.filter((fact) => fact._tag === "UserContextRemoved"), 0)
      }))
  }

  it.effect("skips removing contexts and their pages when applying a browser viewport", () =>
    Effect.gen(function*() {
      const { page, sent, session, state } = yield* make()
      const context = yield* Contexts.createUserContext(state, options)
      const closing = page("P1", "U1" as BrowserBidi.UserContext)
      yield* declare(state, { _tag: "Page", page: closing.id }, 640, yield* Scope.make())
      state.contexts.get(context)!.removing = true
      sent.length = 0
      session.rejects = (entry) => entry.params.context === "P1" || entry.params.userContexts?.includes("U1") === true
      yield* declare(state, { _tag: "Browser" }, 1000, yield* Scope.make())
      assert.deepStrictEqual(
        widthsFor(sent, (params) => params.context === "P1" || params.userContexts?.includes("U1") === true),
        []
      )
    }))

  it.effect("restores a context skipped during a removal the browser then rejects", () =>
    Effect.gen(function*() {
      const { sent, session, state } = yield* make()
      const context = yield* Contexts.createUserContext(state, options)
      const lifetime = yield* Scope.make()
      yield* declare(state, { _tag: "Browser" }, 1100, lifetime)
      const removing = yield* Deferred.make<void>()
      const answer = yield* Deferred.make<void>()
      session.rejects = (entry) => entry.method === "browser.removeUserContext"
      session.around = (entry, next) =>
        entry.method === "browser.removeUserContext"
          ? Deferred.succeed(removing, undefined).pipe(Effect.andThen(Deferred.await(answer)), Effect.andThen(next))
          : next
      const removal = yield* Contexts.removeUserContext(state, context).pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.await(removing)
      // Released while the context is being removed, so its write is skipped
      yield* Scope.close(lifetime, Exit.void)
      sent.length = 0
      yield* Deferred.succeed(answer, undefined)
      assert.isTrue(Exit.isFailure(yield* Fiber.join(removal)))
      // The context lives on, and must not keep the viewport nothing declares any more
      assert.deepStrictEqual(widthsFor(sent, (params) => params.userContexts?.includes("U1") === true), [null])
    }))

  it.effect("restores a page skipped during a close the browser then rejects", () =>
    Effect.gen(function*() {
      const { page, sent, session, state } = yield* make()
      const target = page("P1")
      const lifetime = yield* Scope.make()
      yield* declare(state, { _tag: "Page", page: target.id }, 640, lifetime)
      let command = Effect.void as Effect.Effect<unknown, unknown>
      Object.assign(state.buffer, { start: (effect: Effect.Effect<unknown, unknown>) => { command = effect } })
      session.rejects = (entry) => entry.method === "browsingContext.close"
      yield* Contexts.closePage(state, target.id, { runBeforeUnload: false })
      yield* Scope.close(lifetime, Exit.void)
      sent.length = 0
      const result = yield* Effect.exit(command)
      assert.isTrue(Exit.isFailure(result))
      assert.strictEqual(target.closing, undefined)
      assert.deepStrictEqual(widthsFor(sent, (params) => params.context === "P1"), [null])
    }))

  it.effect("restores a context after interrupted removal without replacing the interruption", () =>
    Effect.gen(function*() {
      const { sent, session, state } = yield* make()
      const context = yield* Contexts.createUserContext(state, options)
      const lifetime = yield* Scope.make()
      yield* declare(state, { _tag: "UserContext", context }, 1100, lifetime)
      const removing = yield* Deferred.make<void>()
      session.around = (entry, next) => entry.method === "browser.removeUserContext"
        ? Deferred.succeed(removing, undefined).pipe(Effect.andThen(Effect.never)) : next
      const removal = yield* Contexts.removeUserContext(state, context).pipe(Effect.forkChild)
      yield* Deferred.await(removing)
      yield* Scope.close(lifetime, Exit.void)
      sent.length = 0
      yield* Fiber.interrupt(removal)
      const result = yield* Fiber.await(removal)
      assert.isTrue(Exit.hasInterrupts(result))
      assert.isFalse(state.contexts.get(context)!.removing)
      assert.deepStrictEqual(widthsFor(sent, (params) => params.userContexts?.includes("U1") === true), [null])
    }))

  it.effect("preserves install errors on active contexts", () =>
    Effect.gen(function*() {
      const { session, state } = yield* make()
      session.rejects = (entry) => entry.method === "browsingContext.setViewport"
      const result = yield* Effect.exit(
        declare(state, { _tag: "UserContext", context: state.defaultContext }, 1000, yield* Scope.make())
      )
      assert.isTrue(Exit.isFailure(result))
    }))

  it.effect("bounds each release target and continues after a command never replies", () =>
    Effect.gen(function*() {
      const { page, sent, session, state } = yield* make()
      const clock = BrowserClock.fromClock(yield* Clock.Clock)
      const stuck = yield* Deferred.make<void>()
      let unconfirmed = 0
      yield* Effect.gen(function*() {
        const first = page("P1")
        const second = page("P2")
        yield* declare(state, { _tag: "Page", page: first.id }, 640, yield* Scope.make())
        yield* declare(state, { _tag: "Page", page: second.id }, 700, yield* Scope.make())
        const lifetime = yield* Scope.make()
        yield* declare(state, { _tag: "UserContext", context: state.defaultContext }, 1000, lifetime)
        sent.length = 0
        session.around = (entry, next) =>
          entry.method === "browsingContext.setViewport" && entry.params.context === "P1"
            ? Deferred.succeed(stuck, undefined).pipe(Effect.andThen(Effect.never))
            : next
        const closing = yield* Scope.close(lifetime, Exit.void).pipe(
          Effect.provideService(DeclarationCleanup.Unconfirmed, () => {
            unconfirmed++
          }),
          Effect.forkChild
        )
        yield* Deferred.await(stuck)
        yield* TestClock.adjust("5 seconds")
        yield* Fiber.join(closing)
        assert.deepStrictEqual(widthsFor(sent, (params) => params.context === "P2"), [700])
        assert.strictEqual(unconfirmed, 1)
      }).pipe(
        Effect.provideService(BrowserClock.CurrentClock, clock),
        Effect.provideService(DeclarationCleanup.Unconfirmed, () => {
          unconfirmed++
        })
      )
    }))

  it.effect("keeps an ended-session rollback quiet and preserves the install error", () =>
    Effect.gen(function*() {
      const { session, state } = yield* make()
      let unconfirmed = 0
      session.rejects = (entry) => entry.method === "browsingContext.setViewport"
      session.around = (entry, next) =>
        entry.method === "browser.removeUserContext"
          ? Effect.fail(new Protocol.ProtocolError({ reason: new Protocol.SessionEnded({ why: "connectionLost" }) }))
          : next
      const result = yield* Effect.exit(Contexts.createUserContext(state, options)).pipe(
        Effect.provideService(DeclarationCleanup.Unconfirmed, () => {
          unconfirmed++
        })
      )
      const error = Option.getOrThrow(Exit.findErrorOption(result))
      assert.strictEqual(error.reason._tag, "Protocol")
      if (error.reason._tag === "Protocol") assert.strictEqual(error.reason.error.reason._tag, "Rejected")
      assert.strictEqual(unconfirmed, 0)
    }))

  it.effect("returns an expired scoped declaration before its connection-owned cleanup finishes", () =>
    Effect.gen(function*() {
      const { page, session, state } = yield* make()
      const target = page("P1")
      const clock = BrowserClock.fromClock(yield* Clock.Clock)
      const installed = yield* Deferred.make<void>()
      const cleaning = yield* Deferred.make<void>()
      const order: Array<string> = []
      session.around = (entry, next) =>
        entry.method !== "browsingContext.setViewport" ?
          next
          : entry.params.viewport === null
          ? Deferred.succeed(cleaning, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Effect.sync(() => {
              order.push("cleanup")
            }))
          )
          : Deferred.succeed(installed, undefined).pipe(Effect.andThen(Effect.never))
      const adapter = Bounded.make({
        declare: (scope: Adapter.DeclarationScope, declaration: Adapter.Declaration) =>
          Declare.declare(state, scope, declaration)
      } as unknown as Adapter.AdapterConnection)
      yield* Effect.gen(function*() {
        const waiting = yield* Effect.scoped(adapter.declare({ _tag: "Page", page: target.id }, viewport(640))).pipe(
          Operation.named("Test.scopedViewport"),
          Deadline.within("10 millis"),
          Effect.onExit(() =>
            Effect.sync(() => {
              order.push("caller")
            })
          ),
          Effect.exit,
          Effect.forkChild
        )
        yield* Deferred.await(installed)
        yield* TestClock.adjust("10 millis")
        yield* Deferred.await(cleaning)
        yield* TestClock.adjust("5 seconds")
        const result = yield* Fiber.join(waiting)
        assert.isTrue(Deadline.isTimeout(Option.getOrThrow(Exit.findErrorOption(result))))
        assert.deepStrictEqual(order, ["caller", "cleanup"])
        assert.lengthOf(state.registry.all(), 0)
      }).pipe(Effect.provideService(BrowserClock.CurrentClock, clock))
    }))
})
