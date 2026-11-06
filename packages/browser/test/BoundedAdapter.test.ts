/**
 * The adapter as L1 calls it: inside an operation, a call ends at the operation's deadline with its `Timeout`, in
 * the phase what the call does to the browser gives it; a release is never cut short; a creation that finishes late
 * is closed; outside an operation, a call is the adapter's.
 */
import { assert, describe, it } from "@effect/vitest"
import { Deadline } from "@usestrider/browser"
import { Protocol } from "@usestrider/browser/protocol"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Adapter from "../src/internal/adapter.ts"
import * as BoundedAdapter from "../src/internal/boundedAdapter.ts"
import * as Input from "../src/internal/input.ts"
import * as Operation from "../src/internal/operation.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import type * as Target from "../src/Target.ts"
import type * as UserContext from "../src/UserContext.ts"

/** Waits `millis` of real time: the browser is another process, which `TestClock` doesn't move. */
const real = (millis: number) => Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, millis)))

const context = "context-1" as UserContext.Id
const page = "page-1" as Target.NavigableId

/** An adapter whose calls never answer, but for those a test makes answer. */
const stub = (overrides: Partial<Adapter.AdapterConnection>) =>
  BoundedAdapter.make({
    cookies: () => Effect.never,
    setCookies: () => Effect.never,
    clearCookies: () => Effect.never,
    ...overrides
  } as unknown as Adapter.AdapterConnection)

describe("BoundedAdapter", () => {
  it.effect("ends a read at the operation's deadline, as never found, with a hint naming it", () =>
    Effect.gen(function*() {
      const adapter = stub({})
      const started = performance.now()
      const timeout = yield* adapter.cookies(context).pipe(
        Operation.named("CookieJar.list"),
        Deadline.within("100 millis"),
        Effect.flip
      )
      assert(Deadline.isTimeout(timeout), String(timeout))
      assert.strictEqual(timeout.operation, "CookieJar.list")
      assert.strictEqual(timeout.phase, "resolving")
      assert.deepStrictEqual(timeout.diagnostics.dispatch, { _tag: "NotSent" })
      assert.deepStrictEqual(timeout.hint, Option.some("The browser didn't answer the cookie read before the deadline"))
      assert.isTrue(performance.now() - started < 5000)
    }))

  it.effect("marks a write sent before it goes, so its Timeout says it may have taken effect", () =>
    Effect.gen(function*() {
      const adapter = stub({})
      const timeout = yield* adapter.setCookies(context, []).pipe(
        Operation.named("CookieJar.set"),
        Deadline.within("100 millis"),
        Effect.flip
      )
      assert(Deadline.isTimeout(timeout), String(timeout))
      assert.strictEqual(timeout.phase, "dispatchedUnconfirmed")
      assert.deepStrictEqual(timeout.diagnostics.dispatch, { _tag: "MayHaveBeenSent" })
    }))

  it.effect("reports a confirmed write followed by a missing postcondition as acknowledged", () =>
    Effect.gen(function*() {
      const adapter = stub({ setCookies: () => Effect.void })
      const timeout = yield* Effect.gen(function*() {
        yield* adapter.setCookies(context, [])
        const record = yield* Operation.record
        return yield* Effect.fail(record.timeout(Option.none()))
      }).pipe(Operation.named("CookieJar.set"), Effect.flip)
      assert(Deadline.isTimeout(timeout), String(timeout))
      assert.deepStrictEqual(timeout.diagnostics.dispatch, { _tag: "Acknowledged", result: "ok" })
      assert.strictEqual(timeout.phase, "postcondition")
    }))

  it.effect("records a browser rejection as acknowledged without replacing the error", () =>
    Effect.gen(function*() {
      const rejected = new Adapter.AdapterError({
        reason: {
          _tag: "Protocol",
          error: new Protocol.ProtocolError({
            reason: new Protocol.Rejected({
              method: "Storage.setCookies",
              reason: "InvalidArgument",
              code: -32602,
              description: "Invalid cookie"
            })
          })
        }
      })
      const adapter = stub({ setCookies: () => Effect.fail(rejected) })
      yield* Effect.gen(function*() {
        const error = yield* adapter.setCookies(context, []).pipe(Effect.flip)
        assert.strictEqual(error, rejected)
        const record = yield* Operation.record
        assert.deepStrictEqual(Operation.diagnostics(record.id).dispatch, { _tag: "Acknowledged", result: "rejected" })
      }).pipe(Operation.named("CookieJar.set"))
    }))

  it.effect("does not claim acknowledgement for a local refusal or an unanswered write", () =>
    Effect.gen(function*() {
      const reasons: Array<Adapter.AdapterErrorReason> = [
        { _tag: "Unsupported", capability: "input", hint: "Unavailable" },
        {
          _tag: "Protocol",
          error: new Protocol.ProtocolError({
            reason: new Protocol.NoReply({
              method: "Storage.setCookies",
              timeout: Duration.zero
            })
          })
        }
      ]
      for (const reason of reasons) {
        const adapter = stub({ setCookies: () => Effect.fail(new Adapter.AdapterError({ reason })) })
        yield* Effect.gen(function*() {
          yield* adapter.setCookies(context, []).pipe(Effect.exit)
          const record = yield* Operation.record
          assert.notStrictEqual(Operation.diagnostics(record.id).dispatch._tag, "Acknowledged")
        }).pipe(Operation.named("CookieJar.set"))
      }
    }))

  it.effect("does not inherit confirmation when a later write goes unanswered", () =>
    Effect.gen(function*() {
      const adapter = stub({ setCookies: () => Effect.void })
      const timeout = yield* Effect.gen(function*() {
        yield* adapter.setCookies(context, [])
        yield* adapter.clearCookies(context)
      }).pipe(Operation.named("cookies"), Deadline.within("50 millis"), Effect.flip)
      assert(Deadline.isTimeout(timeout))
      assert.deepStrictEqual(timeout.diagnostics.dispatch, { _tag: "MayHaveBeenSent" })
    }))

  it.effect("does not inherit a completed step's confirmation in a later unanswered step", () =>
    Effect.gen(function*() {
      const adapter = stub({ setCookies: () => Effect.void })
      const timeout = yield* Effect.gen(function*() {
        yield* adapter.setCookies(context, []).pipe(Operation.named("first"))
        yield* adapter.clearCookies(context).pipe(Operation.named("second"))
      }).pipe(Operation.named("cookies"), Deadline.within("50 millis"), Effect.flip)
      assert(Deadline.isTimeout(timeout))
      assert.deepStrictEqual(timeout.diagnostics.dispatch, { _tag: "MayHaveBeenSent" })
      assert.deepStrictEqual(timeout.diagnostics.progress.map((step) => step.state), ["ok", "uncertain"])
    }))

  it.effect("does not let one write's reply confirm another still in flight", () =>
    Effect.gen(function*() {
      const adapter = stub({ setCookies: () => real(10) })
      const timeout = yield* Effect.all([adapter.clearCookies(context), adapter.setCookies(context, [])], {
        concurrency: "unbounded"
      }).pipe(Operation.named("cookies"), Deadline.within("100 millis"), Effect.flip)
      assert(Deadline.isTimeout(timeout))
      assert.deepStrictEqual(timeout.diagnostics.dispatch, { _tag: "MayHaveBeenSent" })
    }))

  it.effect("does not let a concurrent step's reply confirm another still in flight", () =>
    Effect.gen(function*() {
      const adapter = stub({ setCookies: () => real(10) })
      const timeout = yield* Effect.all([
        adapter.clearCookies(context).pipe(Operation.named("unanswered")),
        adapter.setCookies(context, []).pipe(Operation.named("answered"))
      ], { concurrency: "unbounded" }).pipe(Operation.named("cookies"), Deadline.within("100 millis"), Effect.flip)
      assert(Deadline.isTimeout(timeout))
      assert.deepStrictEqual(timeout.diagnostics.dispatch, { _tag: "MayHaveBeenSent" })
    }))

  for (const nested of [false, true]) {
    for (const outcome of ["ok", "rejected", "noReply", "interrupt"] as const) {
      it.effect(`preserves overlapping ${nested ? "step" : "direct"} evidence when the first call ends with ${outcome}`, () =>
        Effect.gen(function*() {
          const firstStarted = yield* Deferred.make<void>()
          const secondStarted = yield* Deferred.make<void>()
          const firstReply = yield* Deferred.make<void, Adapter.AdapterError>()
          const secondReply = yield* Deferred.make<void>()
          const adapter = stub({
            clearCookies: () =>
              Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(firstReply))),
            setCookies: () =>
              Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(secondReply)))
          })
          const wrap = <A, E>(effect: Effect.Effect<A, E>, name: string) =>
            nested ? effect.pipe(Operation.named(name)) : effect
          yield* Effect.gen(function*() {
            const record = yield* Operation.record
            const first = yield* Effect.forkChild(wrap(adapter.clearCookies(context), "first").pipe(Effect.exit))
            yield* Deferred.await(firstStarted)
            const second = yield* Effect.forkChild(wrap(adapter.setCookies(context, []), "second").pipe(Effect.exit))
            yield* Deferred.await(secondStarted)
            if (outcome === "interrupt") yield* Fiber.interrupt(first)
            else {
              if (outcome === "ok") yield* Deferred.succeed(firstReply, undefined)
              else {yield* Deferred.fail(
                  firstReply,
                  new Adapter.AdapterError({
                    reason: {
                      _tag: "Protocol",
                      error: new Protocol.ProtocolError({
                        reason: outcome === "rejected"
                          ? new Protocol.Rejected({
                            method: "clearCookies",
                            reason: "InvalidArgument",
                            code: -32602,
                            description: "refused"
                          })
                          : new Protocol.NoReply({ method: "clearCookies", timeout: Duration.zero })
                      })
                    }
                  })
                )}
              yield* Fiber.join(first)
            }
            // Finish both fibers before asserting so an expected pre-fix failure leaves no wait behind.
            const whileWaiting = record.diagnostics()
            yield* Deferred.succeed(secondReply, undefined)
            yield* Fiber.join(second)
            const afterReplies = record.diagnostics()
            assert.deepStrictEqual(whileWaiting.dispatch, { _tag: "MayHaveBeenSent" })
            assert.deepStrictEqual(
              afterReplies.dispatch,
              outcome === "ok" || outcome === "rejected"
                ? { _tag: "Acknowledged", result: outcome }
                : { _tag: "MayHaveBeenSent" }
            )
            // An independent subsequent write gets evidence of its own after the overlap has ended.
            yield* wrap(adapter.setCookies(context, []), "later")
            assert.deepStrictEqual(record.diagnostics().dispatch, { _tag: "Acknowledged", result: "ok" })
          }).pipe(Operation.named("overlapping writes"))
        }))
    }
  }

  it.effect("does not turn a handled unanswered reply into confirmation when its step succeeds", () =>
    Effect.gen(function*() {
      const adapter = stub({
        setCookies: () =>
          Effect.fail(
            new Adapter.AdapterError({
              reason: {
                _tag: "Protocol",
                error: new Protocol.ProtocolError({
                  reason: new Protocol.NoReply({
                    method: "setCookies",
                    timeout: Duration.zero
                  })
                })
              }
            })
          )
      })
      yield* Effect.gen(function*() {
        yield* adapter.setCookies(context, []).pipe(Effect.exit, Operation.named("handled no reply"))
        assert.deepStrictEqual((yield* Operation.record).diagnostics().dispatch, { _tag: "MayHaveBeenSent" })
      }).pipe(Operation.named("outer"))
    }))

  for (const mark of ["sent", "not sent", "rejected"] as const) {
    it.effect(`keeps a manual ${mark} mark after a confirmed write while a read-only step overlaps`, () =>
      Effect.gen(function*() {
        const adapter = stub({ setCookies: () => Effect.void })
        const dispatch = yield* Effect.gen(function*() {
          const record = yield* Operation.record
          const watch = yield* Effect.forkChild(Effect.never.pipe(Operation.named("watch")))
          yield* real(1)
          yield* adapter.setCookies(context, [])
          if (mark === "sent") record.markSent()
          else if (mark === "not sent") {
            record.markSent()
            record.markNotSent()
          } else record.markConfirmed("rejected")
          const dispatch = record.diagnostics().dispatch
          yield* Fiber.interrupt(watch)
          return dispatch
        }).pipe(Operation.named("cookies"))
        assert.deepStrictEqual(
          dispatch,
          mark === "sent"
            ? { _tag: "MayHaveBeenSent" }
            : mark === "not sent"
            ? { _tag: "NotSent" }
            : { _tag: "Acknowledged", result: "rejected" }
        )
      }))
  }

  for (const failed of [false, true]) {
    for (const recoverFirst of [false, true]) {
      it.effect(`summarizes ${failed ? "failed" : "completed"} recovery ${recoverFirst ? "before" : "after"} pending creation`, () =>
        Effect.gen(function*() {
          const made = yield* Deferred.make<Target.NavigableId>()
          const closed = yield* Deferred.make<void>()
          const adapter = stub({
            createPage: () => Deferred.await(made),
            closePage: () => Deferred.succeed(closed, undefined).pipe(Effect.asVoid)
          })
          const result = yield* Effect.gen(function*() {
            const state = Input.make()
            state.broken = Option.some({ description: "held input", release: [] })
            const recover = Input.recover(state, () => failed ? Effect.fail("release refused") : Effect.void)
            if (recoverFirst) yield* recover
            const timeout = yield* adapter.createPage(context).pipe(Effect.flip)
            assert(Deadline.isTimeout(timeout))
            if (!recoverFirst) yield* recover
            return { snapshot: timeout.diagnostics, current: (yield* Operation.record).diagnostics() }
          }).pipe(Operation.named("cleanup"), Deadline.within("50 millis"))
          yield* Deferred.succeed(made, page)
          yield* Deferred.await(closed)
          assert.strictEqual(result.current.cleanup._tag, failed ? "Failed" : "Pending")
          assert.strictEqual(result.snapshot.cleanup._tag, failed && recoverFirst ? "Failed" : "Pending")
        }))
    }
  }

  it.effect("records successful claims dismissal", () =>
    Effect.gen(function*() {
      const adapter = stub({ claims: { dismiss: () => Effect.succeed(true) } as unknown as Adapter.Claims })
      yield* Effect.gen(function*() {
        yield* adapter.claims!.dismiss(page, "prompt" as import("../src/Dialog.ts").PromptId)
        const record = yield* Operation.record
        assert.deepStrictEqual(record.diagnostics().dispatch, { _tag: "Acknowledged", result: "ok" })
      }).pipe(Operation.named("dismiss"))
    }))

  it.effect("reports pending cleanup while a late creation has not answered", () =>
    Effect.gen(function*() {
      const made = yield* Deferred.make<Target.NavigableId>()
      const closed = yield* Deferred.make<void>()
      const adapter = stub({
        createPage: () => Deferred.await(made),
        closePage: () => Deferred.succeed(closed, undefined).pipe(Effect.asVoid)
      })
      const timeout = yield* adapter.createPage(context).pipe(
        Operation.named("UserContext.newPage"),
        Deadline.within("50 millis"),
        Effect.flip
      )
      assert(Deadline.isTimeout(timeout), String(timeout))
      // Finish detached work even if the assertion below fails.
      yield* Deferred.succeed(made, page)
      yield* Deferred.await(closed)
      assert.deepStrictEqual(timeout.diagnostics.cleanup, { _tag: "Pending" })
    }))

  it.effect("does not let an abandoned creation confirm later input", () =>
    Effect.gen(function*() {
      const made = yield* Deferred.make<Target.NavigableId>()
      const closed = yield* Deferred.make<void>()
      const adapter = stub({
        createPage: () => Deferred.await(made),
        closePage: () => Deferred.succeed(closed, undefined).pipe(Effect.asVoid)
      })
      yield* Effect.gen(function*() {
        yield* adapter.createPage(context).pipe(Effect.exit)
        const record = yield* Operation.record
        record.markSent()
        yield* Deferred.succeed(made, page)
        yield* Deferred.await(closed)
        assert.deepStrictEqual(record.timeout(Option.none()).diagnostics.dispatch, { _tag: "MayHaveBeenSent" })
      }).pipe(Operation.named("creation then input"), Deadline.within("50 millis"))
    }))

  it.effect("never cuts a release short", () =>
    Effect.gen(function*() {
      const adapter = stub({ closePage: () => real(300) })
      const exit = yield* adapter.closePage(page, { runBeforeUnload: false }).pipe(
        Operation.named("Test.cleanup"),
        Deadline.within("50 millis"),
        Effect.exit
      )
      assert.isTrue(Exit.isSuccess(exit))
    }))

  it.effect("closes what a creation makes after the operation stopped waiting for it", () =>
    Effect.gen(function*() {
      const closed = yield* Deferred.make<Target.NavigableId>()
      const adapter = stub({
        createPage: () => Effect.as(real(300), page),
        closePage: (made) => Deferred.succeed(closed, made).pipe(Effect.asVoid)
      })
      const timeout = yield* adapter.createPage(context).pipe(
        Operation.named("UserContext.newPage"),
        Deadline.within("100 millis"),
        Effect.flip
      )
      assert(Deadline.isTimeout(timeout), String(timeout))
      assert.strictEqual(timeout.phase, "dispatchedUnconfirmed")
      assert.strictEqual(yield* Deferred.await(closed), page)
    }))

  it.effect("leaves a call outside an operation to the adapter", () =>
    Effect.gen(function*() {
      const adapter = stub({ cookies: () => Effect.as(real(200), []) })
      const cookies = yield* adapter.cookies(context).pipe(Deadline.within("50 millis"))
      assert.deepStrictEqual(cookies, [])
    }))

  it.effect("makes the operation's deadline its commands', in place of CommandTimeout", () =>
    Effect.gen(function*() {
      const seen: Array<Option.Option<number>> = []
      const adapter = stub({
        cookies: () =>
          Effect.map(Effect.service(ProtocolClient.CommandDeadline), (deadline) => (seen.push(deadline), []))
      })
      const at = yield* Effect.map(Operation.record, (record) => record.budget.at).pipe(
        Effect.tap(() => adapter.cookies(context)),
        Operation.named("CookieJar.list")
      )
      yield* adapter.cookies(context)
      assert.deepStrictEqual(seen, [Option.some(at), Option.none()])
    }))

  it.effect("makes a command that got no reply by the deadline the operation's Timeout", () =>
    Effect.gen(function*() {
      const noReply = new Adapter.AdapterError({
        reason: {
          _tag: "Protocol",
          error: new Protocol.ProtocolError({
            reason: new Protocol.NoReply({ method: "Storage.getCookies", timeout: Duration.zero })
          })
        }
      })
      const adapter = stub({ cookies: () => Effect.fail(noReply) })
      const timeout = yield* adapter.cookies(context).pipe(Operation.named("CookieJar.list"), Effect.flip)
      assert(Deadline.isTimeout(timeout), String(timeout))
      assert.strictEqual(timeout.operation, "CookieJar.list")
    }))
})
