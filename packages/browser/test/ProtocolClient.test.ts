/**
 * The ingestion pipeline under a fold (PROTOCOL.md, Ingestion pipeline): fold before publish, integrity,
 * resynchronization and overload. The fold here stands in for an adapter's model.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Input from "@usestrider/browser/cdp/Input"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Target from "@usestrider/browser/cdp/Target"
import { Protocol, Transport } from "@usestrider/browser/protocol"
import * as Cause from "effect/Cause"
import type * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Condition from "../src/Condition.ts"
import * as Deadline from "../src/Deadline.ts"
import * as Expect from "../src/Expect.ts"
import * as Adapter from "../src/internal/adapter.ts"
import * as BidiWire from "../src/internal/bidiWire.ts"
import * as BoundedAdapter from "../src/internal/boundedAdapter.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as CdpWire from "../src/internal/cdpWire.ts"
import * as Ingestion from "../src/internal/ingestion.ts"
import * as Operation from "../src/internal/operation.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as WebKitWire from "../src/internal/webkitWire.ts"
import { type FakeBrowser, makeBrowser } from "./utils/FakeBrowser.ts"

interface Recorder {
  readonly folded: Array<string>
  readonly lost: Array<ProtocolClient.IntegrityFailure>
  readonly ended: Array<string>
}

/**
 * A fold of `Page.loadEventFired` that records what it sees. It syncs each attached session with an empty
 * snapshot, and resyncs a lost one with `resync`, which fails unless scripted.
 */
const makeFold = (options?: {
  readonly resync?: (session: ProtocolClient.Session) => Effect.Effect<number, unknown>
  readonly apply?: (params: Page.LoadEventFiredParams) => Effect.Effect<void>
}) => {
  const recorder: Recorder = { folded: [], lost: [], ended: [] }
  const fold = (control: ProtocolClient.FoldControl): ProtocolClient.Fold => ({
    events: new Map<string, Protocol.EventDef<string, any>>([
      [Page.loadEventFired.method, Page.loadEventFired],
      [Target.attachedToTarget.method, Target.attachedToTarget]
    ]),
    apply: (_session, method, params) => {
      if (method === Target.attachedToTarget.method) {
        const session = control.session(
          (params as Target.AttachedToTargetParams).sessionId as string as Protocol.SessionKey
        )
        if (session !== undefined) control.sync(session, Effect.succeed({ through: 0, apply: Effect.void }))
        return Effect.void
      }
      return Effect.andThen(
        Effect.sync(() => recorder.folded.push(String((params as Page.LoadEventFiredParams).timestamp))),
        options?.apply?.(params as Page.LoadEventFiredParams) ?? Effect.void
      )
    },
    lost: (session, failure) =>
      Effect.sync(() => {
        recorder.lost.push(failure)
        control.sync(
          session,
          (options?.resync ?? (() => Effect.fail("no snapshot")))(session).pipe(
            Effect.map((through) => ({ through, apply: Effect.void }))
          )
        )
      }),
    ended: (session, reason) => Effect.sync(() => recorder.ended.push(`${session.key ?? "browser"} ${reason.why}`))
  })
  return { fold, recorder }
}

const attach = Effect.fnUntraced(function*(browser: FakeBrowser, client: ProtocolClient.Client, sessionId: string) {
  yield* browser.receive({
    method: "Target.attachedToTarget",
    params: {
      sessionId,
      targetInfo: { targetId: `T-${sessionId}`, type: "page", title: "", url: "about:blank", attached: true },
      waitingForDebugger: false
    }
  })
  yield* browser.delivered
  const session = client.session(sessionId as Protocol.SessionKey)
  assert.isDefined(session)
  return session
})

const load = (browser: FakeBrowser, timestamp: unknown) =>
  browser.receive({ method: "Page.loadEventFired", params: { timestamp }, sessionId: "S1" })

const reasonOf = <A>(exit: Exit.Exit<A, Protocol.ProtocolError>) => {
  assert(Exit.isFailure(exit))
  const error = Cause.findErrorOption(exit.cause)
  assert(error._tag === "Some")
  return error.value.reason
}

/** Only the reply timer advances time; operation-bound timers stay pending so they cannot hide an early reply. */
const earlyReplyClock = () => {
  let nanos = 1_000_000_000n
  let sleeps = 0
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => Number(nanos) / 1e6,
    currentTimeMillis: Effect.sync(() => Number(nanos) / 1e6),
    currentTimeNanosUnsafe: () => nanos,
    currentTimeNanos: Effect.sync(() => nanos),
    monotonicTimeNanosUnsafe: () => nanos,
    monotonicTimeNanos: Effect.sync(() => nanos),
    sleep: (duration) =>
      Effect.sync(() => {
        const asked = Duration.toNanos(duration)
        assert(asked._tag === "Some")
        nanos += sleeps++ === 0 ? asked.value - 400_000n : asked.value
      })
  }
  const reply = BrowserClock.fromClock(clock)
  return {
    clock,
    reply,
    operation: { now: reply.now, sleep: () => Effect.never } satisfies BrowserClock.BrowserClock,
    sleeps: () => sleeps
  }
}

describe("ProtocolClient reply deadlines", () => {
  it.effect("does not report NoReply when its timer fires before the command deadline", () =>
    Effect.gen(function*() {
      const timer = earlyReplyClock()
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, { replyClock: timer.clock })
      const at = timer.reply.now() + 250 * 1e6
      const error = yield* client.root.send(Page.enable()).pipe(
        Effect.provideService(Protocol.CommandTimeout, Duration.millis(250)),
        Effect.flip
      )
      assert.strictEqual(error.reason._tag, "NoReply")
      assert.isAtLeast(timer.reply.now(), at, "NoReply must wait for the monotonic deadline")
      assert.isAbove(timer.sleeps(), 1)
    }))

  for (const shorter of [false, true]) {
    it.effect(
      shorter
        ? "preserves a shorter explicit subject deadline after an early reply timer"
        : "turns an inherited deadline into ExpectationFailed after an early reply timer",
      () =>
        Effect.gen(function*() {
          const timer = earlyReplyClock()
          const browser = yield* makeBrowser
          const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, { replyClock: timer.clock })
          const noReplyAt: Array<number> = []
          const adapter = BoundedAdapter.make({
            cookies: () =>
              client.root.send(Page.enable()).pipe(
                Effect.mapError((error) => {
                  if (error.reason._tag === "NoReply") noReplyAt.push(timer.reply.now())
                  return new Adapter.AdapterError({ reason: { _tag: "Protocol", error } })
                })
              )
          } as unknown as Adapter.AdapterConnection)
          const started = timer.reply.now()
          const subject = adapter.cookies("context" as never).pipe(Operation.named("subject"))
          const error = yield* Expect.that(
            shorter ? subject.pipe(Deadline.within("100 millis")) : subject,
            Condition.make("never", () => false)
          ).pipe(
            Deadline.within("250 millis"),
            Effect.provideService(BrowserClock.CurrentClock, timer.operation),
            Effect.flip
          )
          if (shorter) {
            assert(Deadline.isTimeout(error), String(error))
            assert.strictEqual(error.phase, "resolving")
            assert.strictEqual(error.operation, "Expect.that")
          } else {
            assert(Expect.isExpectationFailed(error), String(error))
            assert.deepStrictEqual(error.history.map((entry) => entry.value), [
              { error: "a check was still running at the deadline" }
            ])
          }
          assert.deepStrictEqual(noReplyAt, [started + (shorter ? 100 : 250) * 1e6])
          assert.isAbove(timer.sleeps(), 1, "the protocol timer must re-check its clock")
        })
    )
  }
})

describe("ProtocolClient", () => {
  const click = () =>
    ["mouseMoved", "mousePressed", "mouseReleased"].map((type) =>
      Input.dispatchMouseEvent({ type: type as "mouseMoved" | "mousePressed" | "mouseReleased", x: 10, y: 20 })
    )

  for (const terminal of ["success", "failure", "sessionEnded"] as const) {
    it.effect(`reports an abandoned resource command's ${terminal} exactly once`, () =>
      Effect.gen(function*() {
        const browser = yield* makeBrowser
        const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire)
        const session = yield* attach(browser, client, "S1")
        const outcomes: Array<string> = []
        const waiting = yield* Effect.forkScoped(
          session.send(Page.startScreencast()).pipe(
            Effect.provideService(ProtocolClient.ReplyOutcome, (outcome) => {
              outcomes.push(outcome)
            }),
            Protocol.withLateReplyHandler(() => Effect.void)
          )
        )
        const command = yield* browser.next
        yield* Fiber.interrupt(waiting)
        assert.deepStrictEqual(outcomes, [])
        if (terminal === "sessionEnded") {
          yield* browser.receive({ method: "Target.detachedFromTarget", params: { sessionId: "S1", targetId: "T-S1" } })
        } else {
          yield* browser.receive(
            terminal === "success"
              ? { id: command.id, sessionId: "S1", result: {} }
              : { id: command.id, sessionId: "S1", error: { code: -32000, message: "rejected" } }
          )
        }
        yield* browser.delivered
        assert.deepStrictEqual(outcomes, [terminal])
        yield* browser.receive({ id: command.id, sessionId: "S1", result: {} })
        yield* browser.receive({ method: "Target.detachedFromTarget", params: { sessionId: "S1", targetId: "T-S1" } })
        yield* browser.delivered
        assert.deepStrictEqual(outcomes, [terminal])
      }))
  }

  it.effect("does not overwrite a reply outcome when its transport write fails afterward", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const written = yield* Deferred.make<void, Transport.TransportError>()
      const client = yield* ProtocolClient.make({
        ...browser.transport,
        send: (message) => browser.transport.send(message).pipe(Effect.andThen(Deferred.await(written)))
      }, CdpWire.wire)
      const outcomes: Array<string> = []
      const waiting = yield* Effect.forkScoped(Effect.exit(
        client.root.send(Page.startScreencast()).pipe(
          Effect.provideService(ProtocolClient.ReplyOutcome, (outcome) => {
            outcomes.push(outcome)
          })
        )
      ))
      const command = yield* browser.next
      yield* browser.receive({ id: command.id, result: {} })
      yield* browser.delivered
      yield* Deferred.fail(
        written,
        new Transport.TransportError({
          reason: new Transport.ConnectionLost({ initiator: "remote", description: "write failed after reply" })
        })
      )
      assert(Exit.isFailure(yield* Fiber.join(waiting)))
      assert.deepStrictEqual(outcomes, ["success"])
    }))

  it.effect("records a successful command outcome before its waiter consumes the result", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire)
      const outcomes: Array<string> = []
      const waiting = yield* Effect.forkScoped(
        client.root.send(Page.startScreencast()).pipe(
          Effect.provideService(ProtocolClient.ReplyOutcome, (outcome) => {
            outcomes.push(outcome)
          }),
          Effect.tap(() => Effect.sync(() => assert.deepStrictEqual(outcomes, ["success"])))
        )
      )
      const command = yield* browser.next
      yield* browser.receive({ id: command.id, result: {} })
      yield* Fiber.join(waiting)
    }))

  it.effect("reports success and error reply receipt sequences only to the requesting hook", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire)
      const receipts: Array<number> = []
      const observe = (received: number) => {
        receipts.push(received)
      }
      yield* browser.receive({ method: "Page.loadEventFired", params: { timestamp: 0 } })
      yield* browser.delivered
      const success = yield* Effect.forkScoped(
        client.root.sendSequenced(Page.enable()).pipe(
          Effect.provideService(ProtocolClient.ReplyReceived, observe)
        )
      )
      const command = yield* browser.next
      yield* browser.receive({ id: command.id, result: {} })
      assert.strictEqual((yield* Fiber.join(success)).received, 2)
      assert.deepStrictEqual(receipts, [2])
      const without = yield* Effect.forkScoped(client.root.sendSequenced(Page.enable()))
      yield* browser.receive({ id: (yield* browser.next).id, result: {} })
      assert.strictEqual((yield* Fiber.join(without)).received, 3)
      assert.deepStrictEqual(receipts, [2])
      const failure = yield* Effect.forkScoped(
        client.root.send(Page.enable()).pipe(
          Effect.provideService(ProtocolClient.ReplyReceived, observe),
          Effect.exit
        )
      )
      yield* browser.receive({ id: (yield* browser.next).id, error: { code: -32000, message: "native failure" } })
      assert.strictEqual(reasonOf(yield* Fiber.join(failure))._tag, "Rejected")
      assert.deepStrictEqual(receipts, [2, 4])
    }))

  it.effect("folds only declared live decisions during sync and never replays them", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const sync = yield* Deferred.make<ProtocolClient.Synced>()
      const live = yield* Deferred.make<void>()
      const lastLive = yield* Deferred.make<void>()
      const replayed = yield* Deferred.make<void>()
      const seen: Array<string> = []
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, {
        fold: (control) => ({
          events: new Map<string, Protocol.EventDef<string, any>>([
            [Target.attachedToTarget.method, Target.attachedToTarget],
            [Page.loadEventFired.method, Page.loadEventFired],
            [Page.domContentEventFired.method, Page.domContentEventFired]
          ]),
          apply: Effect.fnUntraced(function*(_, method, params) {
            if (method === Target.attachedToTarget.method) {
              const session = control.session(
                (params as Target.AttachedToTargetParams).sessionId as string as Protocol.SessionKey
              )!
              control.sync(session, Deferred.await(sync), (method) => method === Page.loadEventFired.method)
              return
            }
            const timestamp = (params as Page.LoadEventFiredParams).timestamp
            seen.push(`${method}:${timestamp}`)
            if (method === Page.loadEventFired.method) yield* Deferred.succeed(live, undefined)
            if (timestamp === 4) yield* Deferred.succeed(lastLive, undefined)
            if (timestamp === 3) yield* Deferred.succeed(replayed, undefined)
          }),
          lost: () => Effect.void,
          ended: () => Effect.void
        })
      })
      const session = yield* attach(browser, client, "S1")
      yield* load(browser, 1)
      yield* Deferred.await(live)
      yield* browser.receive({ method: Page.domContentEventFired.method, params: { timestamp: 2 }, sessionId: "S1" })
      yield* browser.receive({ method: Page.domContentEventFired.method, params: { timestamp: 3 }, sessionId: "S1" })
      yield* load(browser, 4)
      yield* Deferred.await(lastLive)
      assert.deepStrictEqual(seen, ["Page.loadEventFired:1", "Page.loadEventFired:4"])
      yield* Deferred.succeed(sync, {
        through: 3,
        apply: Effect.sync(() => {
          seen.push("snapshot")
        })
      })
      yield* Deferred.await(replayed)
      yield* session.drainObserved
      assert.deepStrictEqual(seen, [
        "Page.loadEventFired:1",
        "Page.loadEventFired:4",
        "snapshot",
        "Page.domContentEventFired:3"
      ])
    }).pipe(Effect.scoped))

  it.effect("abandons a staged resource reply when its scope closes before it is awaited", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire)
      const late = yield* Deferred.make<Protocol.LateReply>()
      const scope = yield* Scope.make()
      const pending = yield* client.root.start(Target.createTarget({ url: "about:blank" }), scope).pipe(
        Protocol.withLateReplyHandler((reply) => Deferred.succeed(late, reply).pipe(Effect.asVoid))
      )
      assert.isDefined(pending)
      const command = yield* browser.next
      yield* Scope.close(scope, Exit.void)
      yield* browser.receive({ id: command.id, result: { targetId: "late-target" } })
      assert.strictEqual((yield* Deferred.await(late)).method, "Target.createTarget")
    }).pipe(Effect.scoped))

  it.effect("writes staged commands before awaiting replies and keeps their receive sequences", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire)
      const scope = yield* Effect.scope
      const first = yield* client.root.start(Page.enable(), scope)
      const second = yield* client.root.start(Page.setLifecycleEventsEnabled({ enabled: true }), scope)
      const sent = [yield* browser.next, yield* browser.next]
      assert.deepStrictEqual(sent.map((command) => command.method), ["Page.enable", "Page.setLifecycleEventsEnabled"])
      yield* browser.receive({ id: sent[1]!.id, result: {} })
      yield* browser.receive({ id: sent[0]!.id, result: {} })
      assert.strictEqual((yield* first).received, 2)
      assert.strictEqual((yield* second).received, 1)
    }).pipe(Effect.scoped))

  it.effect("orders transport sends even when one suspends, and waits for every out-of-order reply", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const entered = yield* Deferred.make<void>()
      const proceed = yield* Deferred.make<void>()
      const attempts: Array<string> = []
      const written = yield* Deferred.make<void>()
      let notified = false
      const client = yield* ProtocolClient.make({
        ...browser.transport,
        send: Effect.fnUntraced(function*(message: string) {
          const type = JSON.parse(message).params.type
          attempts.push(type)
          if (type === "mouseMoved") {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(proceed)
          }
          yield* browser.transport.send(message)
        })
      }, CdpWire.wire)
      const fiber = yield* client.root.sendOrdered(click(), () => {
        notified = true
        Deferred.doneUnsafe(written, Effect.void)
      }).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* Effect.yieldNow
      assert.deepStrictEqual(attempts, ["mouseMoved"])
      assert.isFalse(notified)
      yield* Deferred.succeed(proceed, undefined)
      const sent = [yield* browser.next, yield* browser.next, yield* browser.next]
      assert.deepStrictEqual(sent.map((message) => message.params?.type), [
        "mouseMoved",
        "mousePressed",
        "mouseReleased"
      ])
      yield* Deferred.await(written)
      assert.isTrue(notified)
      for (const message of sent.slice(1).reverse()) yield* browser.receive({ id: message.id, result: {} })
      yield* browser.delivered
      assert.isUndefined(fiber.pollUnsafe())
      yield* browser.receive({ id: sent[0]!.id, result: {} })
      yield* Fiber.join(fiber)
    }))

  it.effect("a rejected reply still lets every send finish, so a press never goes without its release", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const entered = yield* Deferred.make<void>()
      const proceed = yield* Deferred.make<void>()
      const attempts: Array<string> = []
      const client = yield* ProtocolClient.make({
        ...browser.transport,
        send: Effect.fnUntraced(function*(message: string) {
          const type = JSON.parse(message).params.type
          attempts.push(type)
          if (type === "mousePressed") {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(proceed)
          }
          yield* browser.transport.send(message)
        })
      }, CdpWire.wire)
      const fiber = yield* client.root.sendOrdered(click()).pipe(Effect.forkChild)
      const first = yield* browser.next
      yield* Deferred.await(entered)
      yield* browser.receive({ id: first.id, error: { code: -32000, message: "rejected" } })
      yield* browser.delivered
      assert.isUndefined(fiber.pollUnsafe())
      yield* Deferred.succeed(proceed, undefined)
      assert.strictEqual(reasonOf(yield* Fiber.await(fiber))._tag, "Rejected")
      assert.deepStrictEqual(attempts, ["mouseMoved", "mousePressed", "mouseReleased"])
    }))

  it.effect("a partial transport failure stops unsent commands and abandons earlier replies", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const attempts: Array<string> = []
      let notified = false
      const client = yield* ProtocolClient.make({
        ...browser.transport,
        send: Effect.fnUntraced(function*(message: string) {
          const type = JSON.parse(message).params.type
          attempts.push(type)
          if (type === "mousePressed") {
            return yield* Effect.fail(
              new Transport.TransportError({
                reason: new Transport.ConnectionLost({ initiator: "remote", description: "send failed" })
              })
            )
          }
          yield* browser.transport.send(message)
        })
      }, CdpWire.wire)
      const fiber = yield* client.root.sendOrdered(click(), () => {
        notified = true
      }).pipe(Effect.forkChild)
      const first = yield* browser.next
      assert.strictEqual(reasonOf(yield* Fiber.await(fiber))._tag, "SessionEnded")
      assert.isFalse(notified)
      assert.deepStrictEqual(attempts, ["mouseMoved", "mousePressed"])
      yield* browser.receive({ id: first.id, result: {} })
      yield* browser.delivered
      assert.strictEqual(yield* browser.pending, 0)
    }))

  it.effect("interruption during a suspended send finishes every send, then stops waiting", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const entered = yield* Deferred.make<void>()
      const proceed = yield* Deferred.make<void>()
      const attempts: Array<string> = []
      const client = yield* ProtocolClient.make({
        ...browser.transport,
        send: Effect.fnUntraced(function*(message: string) {
          const type = JSON.parse(message).params.type
          attempts.push(type)
          if (type === "mousePressed") {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(proceed)
          }
          yield* browser.transport.send(message)
        })
      }, CdpWire.wire)
      const fiber = yield* client.root.sendOrdered(click(), () => {
        attempts.push("written")
      }).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const interrupted = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      assert.isUndefined(interrupted.pollUnsafe())
      assert.deepStrictEqual(attempts, ["mouseMoved", "mousePressed"])
      yield* Deferred.succeed(proceed, undefined)
      yield* Fiber.join(interrupted)
      assert.deepStrictEqual(attempts, ["mouseMoved", "mousePressed", "mouseReleased", "written"])
    }))

  it.effect("interruption while waiting for replies abandons them all without poisoning the next command", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire)
      const fiber = yield* client.root.sendOrdered(click()).pipe(Effect.forkChild)
      const sent = [yield* browser.next, yield* browser.next, yield* browser.next]
      yield* Fiber.interrupt(fiber)
      for (const message of sent) yield* browser.receive({ id: message.id, result: {} })
      const next = yield* client.root.send(Page.enable()).pipe(Effect.forkChild)
      const command = yield* browser.next
      yield* browser.receive({ id: command.id, result: {} })
      yield* Fiber.join(next)
    }))

  it.effect("an ordered batch timeout abandons all replies without poisoning the next command", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire)
      const fiber = yield* client.root.sendOrdered(click()).pipe(
        Protocol.withCommandTimeout("200 millis"),
        Effect.forkChild
      )
      const sent = [yield* browser.next, yield* browser.next, yield* browser.next]
      assert.strictEqual(reasonOf(yield* Fiber.await(fiber))._tag, "NoReply")
      for (const message of sent) yield* browser.receive({ id: message.id, result: {} })
      const next = yield* client.root.send(Page.enable()).pipe(Effect.forkChild)
      const command = yield* browser.next
      yield* browser.receive({ id: command.id, result: {} })
      yield* Fiber.join(next)
      assert.strictEqual(yield* browser.pending, 0)
    }))

  it.effect("folds an event before publishing it", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const { fold, recorder } = makeFold()
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, { fold })
      const page = yield* attach(browser, client, "S1")
      const loaded = yield* page.subscribe(Page.loadEventFired)
      yield* load(browser, 1)
      yield* load(browser, 2)
      // Whether the fold had seen each event by the time it was published
      const seen = yield* loaded.pipe(
        Stream.take(2),
        Stream.map((event) => recorder.folded.includes(String(event.timestamp))),
        Stream.runCollect
      )
      assert.deepStrictEqual(seen, [true, true])
      assert.deepStrictEqual(recorder.folded, ["1", "2"])
    }))

  it.effect("holds a new session's events until the fold syncs it, then folds those after the snapshot", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const snapshot = yield* Deferred.make<number>()
      const folded: Array<string> = []
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, {
        fold: (control) => ({
          events: new Map<string, Protocol.EventDef<string, any>>([
            [Page.loadEventFired.method, Page.loadEventFired],
            [Target.attachedToTarget.method, Target.attachedToTarget]
          ]),
          apply: (_session, method, params) =>
            Effect.sync(() => {
              if (method === Target.attachedToTarget.method) {
                const session = control.session("S1" as Protocol.SessionKey)!
                control.sync(
                  session,
                  Deferred.await(snapshot).pipe(
                    Effect.map((through) => ({ through, apply: Effect.sync(() => folded.push("snapshot")) }))
                  )
                )
              } else folded.push(String((params as Page.LoadEventFiredParams).timestamp))
            }),
          lost: () => Effect.void,
          ended: () => Effect.void
        })
      })
      const page = yield* attach(browser, client, "S1")
      const loaded = yield* page.subscribe(Page.loadEventFired)
      yield* load(browser, 1) // message 2: covered by the snapshot
      yield* load(browser, 2) // message 3: after it
      const published = yield* loaded.pipe(Stream.take(2), Stream.map((event) => event.timestamp), Stream.runCollect)
      assert.deepStrictEqual(published, [1, 2])
      assert.deepStrictEqual(folded, [])
      yield* Deferred.succeed(snapshot, 2)
      yield* page.drainObserved
      assert.deepStrictEqual(folded, ["snapshot", "2"])
    }))

  it.effect("waits in drainObserved until the fold has processed what was received", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const gate = yield* Deferred.make<void>()
      const { fold, recorder } = makeFold({ apply: () => Deferred.await(gate) })
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, { fold })
      const page = yield* attach(browser, client, "S1")
      yield* load(browser, 1)
      yield* browser.delivered
      const drained = yield* page.drainObserved.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      assert.isUndefined(drained.pollUnsafe())
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(drained)
      assert.deepStrictEqual(recorder.folded, ["1"])
    }))

  it.effect("returns the receive sequence of a reply from sendSequenced", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire)
      const page = yield* attach(browser, client, "S1")
      const fiber = yield* page.sendSequenced(Page.enable()).pipe(Effect.forkChild)
      const sent = yield* browser.next
      yield* load(browser, 1)
      yield* browser.receive({ id: sent.id, result: {}, sessionId: "S1" })
      // Message 1 attached S1, message 2 was the event, message 3 the reply
      assert.strictEqual((yield* Fiber.join(fiber)).received, 3)
    }))

  it.effect("on an event that won't decode, resyncs and folds what arrived since the snapshot", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const snapshot = yield* Deferred.make<number>()
      const { fold, recorder } = makeFold({ resync: () => Deferred.await(snapshot) })
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, { fold })
      const page = yield* attach(browser, client, "S1")
      const loaded = yield* page.subscribe(Page.loadEventFired, { buffer: { lossless: 10 } })
      yield* load(browser, "soon") // message 2: undecodable
      yield* load(browser, 3) //      message 3: covered by the snapshot
      yield* load(browser, 4) //      message 4: after it
      yield* browser.delivered
      assert.strictEqual(recorder.lost.length, 1)
      assert.deepInclude(recorder.lost[0], { _tag: "Undecodable", method: "Page.loadEventFired" })
      // Published while the model is unavailable, but not folded
      const published = yield* loaded.pipe(Stream.take(1), Stream.runCollect, Effect.exit)
      assert.strictEqual(reasonOf(published)._tag, "Decode")
      assert.deepStrictEqual(recorder.folded, [])
      yield* Deferred.succeed(snapshot, 3)
      yield* page.drainObserved
      assert.deepStrictEqual(recorder.folded, ["4"])
    }))

  it.effect("ends the session with modelUnavailable when it can't resync", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const { fold, recorder } = makeFold()
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, { fold })
      const page = yield* attach(browser, client, "S1")
      yield* load(browser, "soon")
      assert.strictEqual((yield* page.ended).why, "modelUnavailable")
      assert.deepStrictEqual(recorder.ended, ["S1 modelUnavailable"])
      assert.strictEqual(reasonOf(yield* page.send(Page.enable()).pipe(Effect.exit))._tag, "SessionEnded")
    }))

  it.effect("discards a session's queued events when it falls too far behind, and resyncs", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const started = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const { fold, recorder } = makeFold({
        apply: (params) =>
          params.timestamp === 1
            ? Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(gate))
            : Effect.void,
        resync: () => Effect.succeed(5)
      })
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, {
        fold,
        limits: { events: 2, bytes: 1024 * 1024 }
      })
      const page = yield* attach(browser, client, "S1")
      const lossless = yield* page.subscribe(Page.loadEventFired)
      const sliding = yield* page.subscribe(Page.loadEventFired, { buffer: { sliding: 10 } })
      // The fold is stuck on 1 (message 2) while 2, 3 and 4 queue up behind it; the third is one too many
      yield* load(browser, 1)
      yield* Deferred.await(started)
      for (const timestamp of [2, 3, 4]) yield* load(browser, timestamp)
      yield* browser.delivered
      yield* load(browser, 6) // message 6, after the snapshot
      yield* browser.delivered
      yield* Deferred.succeed(gate, undefined)
      yield* page.drainObserved
      assert.strictEqual(recorder.lost.length, 1)
      assert.deepInclude(recorder.lost[0], { _tag: "Overloaded", events: 3 })
      assert.deepStrictEqual(recorder.folded, ["1", "6"])
      const kept = yield* sliding.pipe(
        Stream.take(3),
        Stream.map((event) => Protocol.isGap(event) ? `${event.dropped} dropped` : event.timestamp),
        Stream.runCollect
      )
      assert.deepStrictEqual(kept, [1, "3 dropped", 6])
      const first = yield* Stream.runHead(lossless)
      assert(first._tag === "Some" && first.value.timestamp === 1)
      assert.strictEqual(reasonOf(yield* lossless.pipe(Stream.runDrain, Effect.exit))._tag, "EventOverflow")
    }))

  it.effect("ends the connection when the fold fails", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const { fold } = makeFold({ apply: () => Effect.die("a bug in the fold") })
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, { fold })
      const page = yield* attach(browser, client, "S1")
      yield* load(browser, 1)
      const closed = yield* client.closed
      assert.strictEqual(closed.initiator, "local")
      assert.include(closed.description, "a bug in the fold")
      assert.strictEqual((yield* page.ended).why, "connectionLost")
      assert.strictEqual(
        reasonOf(yield* client.root.send(Page.enable()).pipe(Effect.exit))._tag,
        "SessionEnded"
      )
    }))

  it.effect("tells the fold of every session's end, in order, when the connection is lost", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const { fold, recorder } = makeFold()
      const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, { fold })
      const page = yield* attach(browser, client, "S1")
      yield* load(browser, 1)
      yield* browser.delivered
      yield* browser.lose("The browser exited with code 0")
      yield* page.ended
      yield* client.root.ended
      assert.deepStrictEqual(recorder.folded, ["1"])
      assert.sameMembers(recorder.ended, ["browser connectionLost", "S1 connectionLost"])
    }))

  it.effect("checks only what needs no transformation under trust", () =>
    Effect.sync(() => {
      assert.isTrue(ProtocolClient.checksOnly(Page.LoadEventFiredParams.ast))
      assert.isTrue(ProtocolClient.checksOnly(Page.FrameNavigatedParams.ast))
      assert.isFalse(ProtocolClient.checksOnly(Protocol.Gap.ast))
    }))

  it.effect("finds every value a release pointer names", () =>
    Effect.sync(() => {
      const result = { result: [{ value: { objectId: "A" } }, { get: { objectId: "B" } }, {}] }
      assert.deepStrictEqual(ProtocolClient.valuesAt(result, "/result/*/value/objectId"), ["A"])
      assert.deepStrictEqual(ProtocolClient.valuesAt(result, "/result/*/get/objectId"), ["B"])
      assert.deepStrictEqual(ProtocolClient.valuesAt({ targetId: "T" }, "/targetId"), ["T"])
      assert.deepStrictEqual(ProtocolClient.valuesAt({}, "/exceptionDetails/exception/objectId"), [])
      // Code generation validates pointers with their JSON-pointer escapes decoded, so they must be followed the same way
      assert.deepStrictEqual(ProtocolClient.valuesAt({ "a/b": { "c~d": "E" } }, "/a~1b/c~0d"), ["E"])
      assert.strictEqual(Ingestion.utf8Length("aé😀"), 1 + 2 + 4)
    }))
})

describe("Wire.decode", () => {
  const wires = { cdp: CdpWire.wire, bidi: BidiWire.wire, webkit: WebKitWire.wire }
  const fromTarget = (message: string) =>
    JSON.stringify({ pageProxyId: "5", method: "Target.dispatchMessageFromTarget", params: { targetId: "t", message } })

  it("fails, without throwing, on a message that isn't a JSON object, on every wire", () => {
    for (const [name, wire] of Object.entries(wires)) {
      for (const message of ["{", "[]", "1", "null"]) {
        assert(Result.isFailure(wire.decode(message)), `${name} decodes ${message}`)
      }
    }
  })

  it("fails on an envelope that is neither a reply nor an event, saying why", () => {
    assert.deepStrictEqual(
      CdpWire.wire.decode("{\"id\":1,\"error\":\"nope\"}"),
      Result.fail("reply 1 has a malformed error")
    )
    assert.deepStrictEqual(BidiWire.wire.decode("{\"type\":\"other\"}"), Result.fail("an envelope of type other"))
    assert(Result.isFailure(WebKitWire.wire.decode(fromTarget("{"))))
  })

  it("unwraps a WebKit target's event to its session", () => {
    const decoded = WebKitWire.wire.decode(
      fromTarget(JSON.stringify({ method: "Page.loadEventFired", params: { timestamp: 1 } }))
    )
    assert.deepStrictEqual(
      decoded,
      Result.succeed<ProtocolClient.Incoming>({
        _tag: "Event",
        key: WebKitWire.targetKey("5", "t"),
        method: "Page.loadEventFired",
        params: { timestamp: 1 }
      })
    )
  })
})

it.effect("publishes scoped-out events to explicit protocol subscribers without folding them", () =>
  Effect.gen(function*() {
    const browser = yield* makeBrowser
    const model = makeFold()
    const client = yield* ProtocolClient.make(browser.transport, CdpWire.wire, {
      fold: (control) => ({
        ...model.fold(control),
        eventScopes: new Map([[Page.loadEventFired.method, () => false]])
      })
    })
    const page = yield* attach(browser, client, "S1")
    const loaded = yield* page.subscribe(Page.loadEventFired)
    yield* load(browser, 7)
    const event = yield* Stream.runHead(loaded)
    assert(event._tag === "Some")
    assert.strictEqual(event.value.timestamp, 7)
    assert.deepStrictEqual(model.recorder.folded, [])
    assert.deepStrictEqual(model.recorder.lost, [])
  }).pipe(Effect.scoped))
