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
import * as Option from "effect/Option"
import * as Adapter from "../src/internal/adapter.ts"
import * as BoundedAdapter from "../src/internal/boundedAdapter.ts"
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
