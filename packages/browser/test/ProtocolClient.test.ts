/**
 * The ingestion pipeline under a fold (PROTOCOL.md, Ingestion pipeline): fold before publish, integrity,
 * resynchronization and overload. The fold here stands in for an adapter's model.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Target from "@usestrider/browser/cdp/Target"
import { Protocol } from "@usestrider/browser/protocol"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import * as BidiWire from "../src/internal/bidiWire.ts"
import * as CdpWire from "../src/internal/cdpWire.ts"
import * as Ingestion from "../src/internal/ingestion.ts"
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

describe("ProtocolClient", () => {
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
