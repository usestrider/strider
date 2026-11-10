import { assert, describe, it } from "@effect/vitest"
import * as Browser from "@usestrider/browser/cdp/Browser"
import * as Emulation from "@usestrider/browser/cdp/Emulation"
import * as Input from "@usestrider/browser/cdp/Input"
import * as Network from "@usestrider/browser/cdp/Network"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Runtime from "@usestrider/browser/cdp/Runtime"
import * as Target from "@usestrider/browser/cdp/Target"
import * as WebAuthn from "@usestrider/browser/cdp/WebAuthn"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import { type FakeBrowser, makeBrowser } from "./utils/FakeBrowser.ts"

const version = {
  protocolVersion: "1.3",
  product: "Chrome/155.0.8059.79",
  revision: "@a49e2e3d",
  userAgent: "Mozilla/5.0",
  jsVersion: "15.5"
}

const attach = Effect.fnUntraced(function*(
  browser: FakeBrowser,
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

  it.effect("redacts WebAuthn private keys on replies and sends their clear encoding only on the wire", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const authenticatorId = "A1" as WebAuthn.AuthenticatorId
      const read = yield* WebAuthn.getCredentials({ authenticatorId }).pipe(Protocol.on(page), Effect.forkChild)
      const sent = yield* browser.next
      const credential = {
        credentialId: "AQ==",
        isResidentCredential: true,
        rpId: "localhost",
        privateKey: "test-secret-key",
        userHandle: "Ag==",
        signCount: 1
      }
      yield* browser.receive({ id: sent.id, result: { credentials: [credential] }, sessionId: "S1" })
      const result = yield* Fiber.join(read)
      assert.isTrue(Redacted.isRedacted(result.credentials[0]!.privateKey))
      assert.notInclude(JSON.stringify(result), "test-secret-key")
      const write = yield* WebAuthn.addCredential({ authenticatorId, credential: result.credentials[0]! }).pipe(
        Protocol.on(page),
        Effect.forkChild
      )
      const written = yield* browser.next
      assert.deepStrictEqual(written.params, { authenticatorId, credential })
      yield* browser.receive({ id: written.id, result: {}, sessionId: "S1" })
      yield* Fiber.join(write)
    }))

  it.effect("removes a native authenticator whose creation reply arrives after interruption", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const create = yield* WebAuthn.addVirtualAuthenticator({ options: { protocol: "ctap2", transport: "internal" } })
        .pipe(Protocol.on(page), Effect.forkChild)
      const sent = yield* browser.next
      yield* Fiber.interrupt(create)
      yield* browser.receive({ id: sent.id, result: { authenticatorId: "late-A" }, sessionId: "S1" })
      const cleanup = yield* browser.next
      assert.strictEqual(cleanup.method, "WebAuthn.removeVirtualAuthenticator")
      assert.strictEqual(cleanup.sessionId, "S1")
      assert.deepStrictEqual(cleanup.params, { authenticatorId: "late-A" })
      yield* browser.receive({ id: cleanup.id, result: {}, sessionId: "S1" })
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

  it.effect("keeps only the newest events in a sliding subscription, and marks where it dropped some", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const loaded = yield* page.subscribe(Page.loadEventFired, { buffer: { sliding: 2 } })
      for (const timestamp of [1, 2, 3, 4]) {
        yield* browser.receive({ method: "Page.loadEventFired", params: { timestamp }, sessionId: "S1" })
      }
      yield* browser.delivered
      yield* page.drainObserved
      const seen = yield* loaded.pipe(
        Stream.take(3),
        Stream.map((event) => Protocol.isGap(event) ? `${event.dropped} dropped` : event.timestamp),
        Stream.runCollect
      )
      assert.deepStrictEqual(seen, ["2 dropped", 3, 4])
    }))

  it.effect("fails a lossless subscription that falls behind with EventOverflow, after what it kept", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const loaded = yield* page.subscribe(Page.loadEventFired, { buffer: { lossless: 2 } })
      for (const timestamp of [1, 2, 3]) {
        yield* browser.receive({ method: "Page.loadEventFired", params: { timestamp }, sessionId: "S1" })
      }
      yield* browser.delivered
      yield* page.drainObserved
      const kept = yield* loaded.pipe(Stream.take(2), Stream.map((event) => event.timestamp), Stream.runCollect)
      assert.deepStrictEqual(kept, [1, 2])
      assert.deepInclude(reasonOf(yield* loaded.pipe(Stream.runDrain, Effect.exit)), {
        _tag: "EventOverflow",
        method: "Page.loadEventFired",
        capacity: 2
      })
    }))

  it.effect("filters with a prefilter before buffering, so excluded events take no space", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const lifecycle = yield* page.subscribe(Page.lifecycleEvent, {
        buffer: { lossless: 1 },
        prefilter: { frameId: "F2" as Page.FrameId }
      })
      for (const frameId of ["F1", "F1", "F2"]) {
        yield* browser.receive({
          method: "Page.lifecycleEvent",
          params: { frameId, loaderId: "L", name: "load", timestamp: 1 },
          sessionId: "S1"
        })
      }
      const event = yield* Stream.runHead(lifecycle)
      assert(event._tag === "Some")
      assert.strictEqual(event.value.frameId, "F2")
    }))

  it.effect("sees only events received after subscribe returns", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      yield* browser.receive({ method: "Page.loadEventFired", params: { timestamp: 1 }, sessionId: "S1" })
      yield* browser.delivered
      const loaded = yield* page.subscribe(Page.loadEventFired)
      yield* browser.receive({ method: "Page.loadEventFired", params: { timestamp: 2 }, sessionId: "S1" })
      const event = yield* Stream.runHead(loaded)
      assert(event._tag === "Some")
      assert.strictEqual(event.value.timestamp, 2)
    }))

  it.effect("delivers the events received before a session ended, then ends the subscription", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const loaded = yield* page.subscribe(Page.loadEventFired)
      yield* browser.receive({ method: "Page.loadEventFired", params: { timestamp: 1 }, sessionId: "S1" })
      yield* browser.receive({ method: "Target.detachedFromTarget", params: { sessionId: "S1" } })
      const first = yield* Stream.runHead(loaded)
      assert(first._tag === "Some")
      assert.strictEqual(first.value.timestamp, 1)
      assert.deepInclude(reasonOf(yield* loaded.pipe(Stream.runDrain, Effect.exit)), {
        _tag: "SessionEnded",
        why: "detached"
      })
    }))

  it.effect("under trust, skips codecs that only check, and still runs those that transform", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const loaded = yield* page.subscribe(Page.loadEventFired).pipe(Protocol.withValidation("trust"))
      yield* browser.receive({ method: "Page.loadEventFired", params: { timestamp: "soon" }, sessionId: "S1" })
      const event = yield* Stream.runHead(loaded)
      assert(event._tag === "Some")
      assert.strictEqual(event.value.timestamp as unknown, "soon")

      const cookies = yield* Network.getCookies().pipe(
        Protocol.on(page),
        Protocol.withValidation("trust"),
        Effect.forkChild
      )
      const sent = yield* browser.next
      const cookie = {
        name: "session",
        value: "hunter2",
        domain: "example.com",
        path: "/",
        expires: -1,
        size: 14,
        httpOnly: true,
        secure: true,
        session: true,
        priority: "Medium",
        sourceScheme: "Secure",
        sourcePort: 443
      }
      yield* browser.receive({ id: sent.id, result: { cookies: [cookie] }, sessionId: "S1" })
      const [received] = (yield* Fiber.join(cookies)).cookies
      assert(received !== undefined && Redacted.isRedacted(received.value))
      assert.strictEqual(Redacted.value(received.value), "hunter2")
    }))

  it.effect("fails a command with NoReply after CommandTimeout, and drops its late reply", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const fiber = yield* Browser.getVersion().pipe(
        Protocol.on(cdp.browser),
        Protocol.withCommandTimeout("200 millis"),
        Effect.forkChild
      )
      const sent = yield* browser.next
      assert.deepInclude(reasonOf(yield* Fiber.await(fiber)), { _tag: "NoReply", method: "Browser.getVersion" })
      yield* browser.receive({ id: sent.id, result: version })
      yield* browser.delivered
      assert.strictEqual(yield* browser.pending, 0)
    }))

  it.effect("waits 30 seconds by default, in real time even under TestClock", () =>
    Effect.gen(function*() {
      assert.isTrue(Duration.equals(yield* Protocol.CommandTimeout, Duration.seconds(30)))
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      // TestClock is in force and never moves: the browser is another process, whose replies come in real time
      const started = performance.now()
      const exit = yield* Browser.getVersion().pipe(
        Protocol.on(cdp.browser),
        Protocol.withCommandTimeout("200 millis"),
        Effect.exit
      )
      const elapsed = performance.now() - started
      assert.strictEqual(reasonOf(exit)._tag, "NoReply")
      assert.isTrue(elapsed >= 150 && elapsed < 5000, `${elapsed} ms`)
    }))

  it.effect("releases a resource whose reply arrives after its caller stopped waiting", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const fiber = yield* Target.createTarget({ url: "about:blank" }).pipe(Protocol.on(cdp.browser), Effect.forkChild)
      const sent = yield* browser.next
      yield* Fiber.interrupt(fiber)
      yield* browser.receive({ id: sent.id, result: { targetId: "T9" } })
      const release = yield* browser.next
      assert.deepInclude(release, { method: "Target.closeTarget", params: { targetId: "T9" } })
      assert.isUndefined(release.sessionId)
    }))

  it.effect("hands a late reply to the handler in the caller's context", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const cdp = yield* CdpConnection.make(browser.transport)
      const page = yield* attach(browser, cdp, "S1")
      const late = yield* Deferred.make<Protocol.LateReply>()
      const fiber = yield* Runtime.evaluate({ expression: "document.body" }).pipe(
        Protocol.on(page),
        Protocol.withLateReplyHandler((reply) => Deferred.succeed(late, reply).pipe(Effect.asVoid)),
        Protocol.withCommandTimeout("200 millis"),
        Effect.forkChild
      )
      const sent = yield* browser.next
      assert.strictEqual(reasonOf(yield* Fiber.await(fiber))._tag, "NoReply")
      const result = { result: { type: "object", subtype: "node", objectId: "O1" } }
      yield* browser.receive({ id: sent.id, result, sessionId: "S1" })
      const reply = yield* Deferred.await(late)
      assert.strictEqual(reply.method, "Runtime.evaluate")
      assert.deepStrictEqual(reply.result, result)
      assert.strictEqual(reply.session, page)
      assert.strictEqual(yield* browser.pending, 0)
      const released = yield* reply.release.pipe(Effect.forkChild)
      const release = yield* browser.next
      assert.deepInclude(release, { method: "Runtime.releaseObject", params: { objectId: "O1" }, sessionId: "S1" })
      yield* browser.receive({ id: release.id, result: {}, sessionId: "S1" })
      yield* Fiber.join(released)
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
