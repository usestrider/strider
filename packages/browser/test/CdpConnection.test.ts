import { assert, describe, it } from "@effect/vitest"
import * as Browser from "@usestrider/browser/cdp/Browser"
import * as Emulation from "@usestrider/browser/cdp/Emulation"
import * as Input from "@usestrider/browser/cdp/Input"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Target from "@usestrider/browser/cdp/Target"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Queue from "effect/Queue"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"

interface Sent {
  readonly id: number
  readonly method: string
  readonly params?: Record<string, unknown>
  readonly sessionId?: string
}

/** A transport the test plays the browser on: it reads what was sent and writes what arrives. */
const makeBrowser = Effect.gen(function*() {
  const inbox = yield* Queue.unbounded<string, Transport.TransportError | Cause.Done>()
  const sent = yield* Queue.unbounded<Sent>()
  const lost = yield* Deferred.make<Transport.ConnectionLost>()
  let reason: Transport.ConnectionLost | undefined
  const transport: Transport.Transport = {
    send: (message) =>
      Effect.suspend(() =>
        reason === undefined
          ? Queue.offer(sent, JSON.parse(message)).pipe(Effect.asVoid)
          : Effect.fail(new Transport.TransportError({ reason }))
      ),
    messages: Stream.fromQueue(inbox),
    closed: Deferred.await(lost)
  }
  return {
    transport,
    next: Queue.take(sent),
    pending: Queue.size(sent),
    receive: (message: object) => Queue.offer(inbox, JSON.stringify(message)).pipe(Effect.asVoid),
    receiveRaw: (message: string) => Queue.offer(inbox, message).pipe(Effect.asVoid),
    lose: (description: string) =>
      Effect.sync(() => {
        reason = new Transport.ConnectionLost({ initiator: "remote", description })
        Queue.failCauseUnsafe(inbox, Cause.fail(new Transport.TransportError({ reason })))
        Deferred.doneUnsafe(lost, Effect.succeed(reason))
      })
  }
})

const version = {
  protocolVersion: "1.3",
  product: "Chrome/155.0.8059.79",
  revision: "@a49e2e3d",
  userAgent: "Mozilla/5.0",
  jsVersion: "15.5"
}

const attach = Effect.fnUntraced(function*(
  browser: Effect.Success<typeof makeBrowser>,
  cdp: CdpConnection.CdpConnection,
  sessionId: string,
  parent?: string
) {
  yield* browser.receive({
    method: "Target.attachedToTarget",
    params: { sessionId, targetInfo: {}, waitingForDebugger: false },
    ...(parent === undefined ? {} : { sessionId: parent })
  })
  return yield* Effect.yieldNow.pipe(Effect.andThen(cdp.session(sessionId as Target.SessionID)))
})

const reasonOf = <A>(exit: Exit.Exit<A, Protocol.ProtocolError>) => {
  assert(Exit.isFailure(exit))
  const error = Cause.findErrorOption(exit.cause)
  assert(error._tag === "Some")
  return error.value.reason
}

describe("CdpConnection", () => {
  it.effect("routes replies to their commands, in any order", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const first = yield* Browser.getVersion().pipe(Protocol.on(cdp.browser), Effect.forkChild)
      const second = yield* Target.createTarget({ url: "about:blank" }).pipe(Protocol.on(cdp.browser), Effect.forkChild)
      const a = yield* browser.next
      const b = yield* browser.next
      assert.strictEqual(a.method, "Browser.getVersion")
      assert.deepStrictEqual(b.params, { url: "about:blank" })
      yield* browser.receive({ id: b.id, result: { targetId: "T1" } })
      yield* browser.receive({ id: a.id, result: version })
      assert.strictEqual((yield* Fiber.join(first)).product, "Chrome/155.0.8059.79")
      assert.strictEqual((yield* Fiber.join(second)).targetId, "T1")
    }))

  it.effect("sends on a target session with its key, and Redacted parameters in the clear", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      assert.strictEqual(page.key, "S1")
      assert.isUndefined(cdp.browser.key)
      const typed = yield* Input.insertText({ text: Redacted.make("hunter2") }).pipe(
        Protocol.on(page),
        Effect.forkChild
      )
      const sent = yield* browser.next
      assert.deepStrictEqual(sent, {
        id: sent.id,
        method: "Input.insertText",
        params: { text: "hunter2" },
        sessionId: "S1"
      })
      yield* browser.receive({ id: sent.id, result: {}, sessionId: "S1" })
      assert.isUndefined(yield* Fiber.join(typed))
    }))

  it.effect("classifies error replies with CDP's table", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const reply = Effect.fnUntraced(function*(error: object) {
        const fiber = yield* Target.attachToTarget({ targetId: "T0" as Target.TargetID, flatten: true }).pipe(
          Protocol.on(cdp.browser),
          Effect.forkChild
        )
        const sent = yield* browser.next
        yield* browser.receive({ id: sent.id, error })
        return reasonOf(yield* Fiber.await(fiber))
      })
      assert.deepInclude(yield* reply({ code: -32601, message: "'Target.attachToTarget' wasn't found" }), {
        _tag: "Unsupported",
        method: "Target.attachToTarget"
      })
      assert.deepInclude(yield* reply({ code: -32602, message: "No target with given id found" }), {
        _tag: "Rejected",
        reason: "NoSuchTarget"
      })
      assert.deepInclude(yield* reply({ code: -32602, message: "Invalid parameters", data: "…" }), {
        _tag: "Rejected",
        reason: "InvalidArgument"
      })
      assert.deepInclude(yield* reply({ code: -32000, message: "Something new" }), {
        _tag: "Rejected",
        reason: "Unrecognized",
        code: -32000,
        description: "Something new"
      })
    }))

  it.effect("fails with Decode on a result that doesn't match its codec", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const fiber = yield* Browser.getVersion().pipe(Protocol.on(cdp.browser), Effect.forkChild)
      const sent = yield* browser.next
      yield* browser.receive({ id: sent.id, result: { product: 155 } })
      const reason = reasonOf(yield* Fiber.await(fiber))
      assert.strictEqual(reason._tag, "Decode")
    }))

  it.effect("fails with Encode, sending nothing, on parameters that don't match their codec", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const exit = yield* Emulation.setDeviceMetricsOverride({
        width: 800.5,
        height: 600,
        deviceScaleFactor: 1,
        mobile: false
      }).pipe(Protocol.on(cdp.browser), Effect.exit)
      assert.strictEqual(reasonOf(exit)._tag, "Encode")
      assert.strictEqual(yield* browser.pending, 0)
    }))

  it.effect("abandons the reply of an interrupted command", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const fiber = yield* Browser.getVersion().pipe(Protocol.on(cdp.browser), Effect.forkChild)
      const abandoned = yield* browser.next
      yield* Fiber.interrupt(fiber)
      yield* browser.receive({ id: abandoned.id, result: version })
      const next = yield* Browser.getVersion().pipe(Protocol.on(cdp.browser), Effect.forkChild)
      const sent = yield* browser.next
      assert.notStrictEqual(sent.id, abandoned.id)
      yield* browser.receive({ id: sent.id, result: { ...version, product: "second" } })
      assert.strictEqual((yield* Fiber.join(next)).product, "second")
    }))

  it.effect("delivers a session's events in order, decoded, to subscriptions live when subscribe returns", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const other = yield* attach(browser, cdp, "S2")
      const lifecycle = yield* page.subscribe(Page.lifecycleEvent)
      const elsewhere = yield* other.subscribe(Page.lifecycleEvent)
      for (const name of ["init", "DOMContentLoaded", "load"]) {
        yield* browser.receive({
          method: "Page.lifecycleEvent",
          params: { frameId: "F", loaderId: "L", name, timestamp: 1 },
          sessionId: "S1"
        })
      }
      const names = yield* lifecycle.pipe(Stream.take(3), Stream.map((event) => event.name), Stream.runCollect)
      assert.deepStrictEqual(names, ["init", "DOMContentLoaded", "load"])
      yield* browser.receive({
        method: "Page.lifecycleEvent",
        params: { frameId: "F", loaderId: "L", name: "S2", timestamp: 1 },
        sessionId: "S2"
      })
      assert.strictEqual(
        (yield* elsewhere.pipe(Stream.runHead)).pipe((option) => option._tag === "Some" ? option.value.name : ""),
        "S2"
      )
    }))

  it.effect("fails only the subscription whose event doesn't decode", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const navigated = yield* page.subscribe(Page.frameNavigated)
      const loaded = yield* page.subscribe(Page.loadEventFired)
      yield* browser.receive({ method: "Page.frameNavigated", params: { type: "Navigation" }, sessionId: "S1" })
      yield* browser.receive({ method: "Page.loadEventFired", params: { timestamp: 2 }, sessionId: "S1" })
      const failed = yield* navigated.pipe(Stream.runDrain, Effect.exit)
      assert.strictEqual(reasonOf(failed)._tag, "Decode")
      const event = yield* loaded.pipe(Stream.runHead)
      assert(event._tag === "Some")
      assert.strictEqual(event.value.timestamp, 2)
    }))

  it.effect("keeps only the newest events in a sliding subscription", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const loaded = yield* page.subscribe(Page.loadEventFired, { buffer: { sliding: 2 } })
      for (const timestamp of [1, 2, 3, 4]) {
        yield* browser.receive({ method: "Page.loadEventFired", params: { timestamp }, sessionId: "S1" })
      }
      yield* Effect.yieldNow
      const seen = yield* loaded.pipe(Stream.take(2), Stream.map((event) => event.timestamp), Stream.runCollect)
      assert.deepStrictEqual(seen, [3, 4])
    }))

  it.effect("ends a detached session and its children: pending commands and subscriptions fail", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const frame = yield* attach(browser, cdp, "S2", "S1")
      const loaded = yield* frame.subscribe(Page.loadEventFired)
      const pending = yield* Page.enable().pipe(Protocol.on(page), Effect.forkChild)
      yield* browser.next
      yield* browser.receive({ method: "Target.detachedFromTarget", params: { sessionId: "S1" } })
      assert.deepInclude(reasonOf(yield* Fiber.await(pending)), { _tag: "SessionEnded", why: "detached" })
      assert.deepInclude(reasonOf(yield* loaded.pipe(Stream.runDrain, Effect.exit)), { _tag: "SessionEnded" })
      assert.strictEqual((yield* frame.ended).why, "detached")
      const late = yield* Page.enable().pipe(Protocol.on(page), Effect.exit)
      assert.strictEqual(reasonOf(late)._tag, "SessionEnded")
      assert.strictEqual(yield* browser.pending, 0)
      assert.strictEqual(reasonOf(yield* cdp.session("S1" as Target.SessionID).pipe(Effect.exit))._tag, "SessionEnded")
    }))

  it.effect("ends every session when the transport is lost, and says why", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const pending = yield* Browser.getVersion().pipe(Protocol.on(cdp.browser), Effect.forkChild)
      yield* browser.next
      yield* browser.lose("The browser exited with code 0")
      assert.deepInclude(reasonOf(yield* Fiber.await(pending)), { _tag: "SessionEnded", why: "connectionLost" })
      assert.strictEqual((yield* page.ended).why, "connectionLost")
      assert.strictEqual((yield* cdp.closed).description, "The browser exited with code 0")
      const late = yield* Browser.getVersion().pipe(Protocol.on(cdp.browser), Effect.exit)
      assert.deepInclude(reasonOf(late), { _tag: "SessionEnded", why: "connectionLost" })
    }))

  it.effect("ends the connection on a malformed envelope", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      yield* browser.receiveRaw("{\"id\": 1, \"error\": \"nope\"}")
      const closed = yield* cdp.closed
      assert.strictEqual(closed.initiator, "remote")
      assert.include(closed.description, "malformed")
    }))
})

describe("Transport.pipe", () => {
  // Only the members the pipe transport reads.
  const handle = (chunks: ReadonlyArray<Uint8Array>) => ({
    getInputFd: () => undefined as never,
    getOutputFd: () => Stream.fromIterable(chunks),
    exitCode: Effect.never
  })

  it.effect("splits NUL-framed messages, across chunks and inside multibyte characters", () =>
    Effect.gen(function*() {
      const bytes = new TextEncoder().encode("{\"a\":\"é\"}\0{\"b\":2}\0{\"c\":")
      const split = bytes.indexOf(0xa9) // the second byte of "é"
      const transport = yield* Transport.pipe(
        handle([bytes.subarray(0, split), bytes.subarray(split, 13), bytes.subarray(13)]) as never
      )
      const messages = yield* transport.messages.pipe(Stream.take(2), Stream.runCollect)
      assert.deepStrictEqual(messages, ["{\"a\":\"é\"}", "{\"b\":2}"])
    }))

  it.effect("is lost when the browser closes its pipe, and then fails sends at once", () =>
    Effect.gen(function*() {
      const transport = yield* Transport.pipe(handle([]) as never)
      const lost = yield* transport.closed
      assert.deepInclude(lost, { initiator: "remote", description: "The browser closed its pipe" })
      const exit = yield* transport.send("{}").pipe(Effect.exit)
      assert(Exit.isFailure(exit))
    }))
})
