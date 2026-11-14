import { assert, describe, it } from "@effect/vitest"
import * as Cache from "effect/Cache"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { TestClock } from "effect/testing"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Engine from "../src/internal/engine.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Evaluation from "../src/internal/webkitAdapter/evaluation.ts"
import type * as State from "../src/internal/webkitAdapter/state.ts"
import * as Envelope from "../src/internal/webkitEnvelope.ts"
import * as WebKitWire from "../src/internal/webkitWire.ts"
import * as Target from "../src/Target.ts"
import { makeBrowser } from "./utils/FakeBrowser.ts"

const fixture = Effect.fnUntraced(function*(stage = "call", retireInReply = false) {
  const buffer = yield* Kit.makeFactBuffer(() => Effect.void)
  const sent = yield* Deferred.make<void>()
  let calls = 0
  let interrupted = 0
  const ids = Kit.makeIds()
  const id = ids.realm()
  let state!: State.State
  const realm = {
    id,
    ended: false,
    pending: false,
    held: [],
    document: { id: ids.document() },
    session: {
      send: (command: { method: string }) =>
        Effect.suspend(() => {
          calls++
          const blocked = stage === "helper" || stage === "anchor" ?
            "Runtime.evaluate"
            : stage === "properties"
            ? "Runtime.getProperties"
            : "Runtime.callFunctionOn"
          if (command.method === blocked) {
            if (retireInReply) {
              realm.ended = true
              return Effect.succeed({
                result: { value: "{\"batch\":0,\"value\":{\"type\":\"number\",\"value\":1}}" }
              })
            }
            return Effect.andThen(Deferred.succeed(sent, undefined), Effect.never).pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted++
                })
              )
            )
          }
          return Effect.succeed({
            result: { objectId: "batch", value: "{\"batch\":1,\"value\":{\"type\":\"node\",\"nodeIndex\":0}}" }
          })
        })
    }
  } as unknown as State.RealmEntry
  const helpers = yield* Cache.make({
    capacity: 4,
    lookup: () =>
      stage === "helper"
        ? Evaluation.installHelper(state, id) :
        Effect.succeed("helper")
  })
  const anchors = yield* Cache.make({ capacity: 4, lookup: (key: string) => Evaluation.makeAnchor(state, key) })
  state = { buffer, ids, realms: new Map([[id, realm]]), helpers, anchors } as unknown as State.State
  const run = Evaluation.evaluate(state, id, {
    functionDeclaration: "() => 1",
    arguments: [],
    result: stage === "anchor" ? "handle" : "value",
    group: stage === "anchor" ? "group" : undefined,
    awaitPromise: true,
    userActivation: false
  })
  const retire = Effect.sync(() => {
    Kit.removeRealm(buffer, realm, new Target.RealmDestroyed({}), () => {})
  }).pipe(Effect.andThen(buffer.flush))
  return { run, retire, sent, realm, buffer, calls: () => calls, interrupted: () => interrupted }
})

describe("WebKit evaluation retirement", () => {
  for (const stage of ["call", "helper", "anchor", "properties"] as const) {
    it.live(`interrupts unanswered ${stage} work when its captured realm retires`, () =>
      Effect.gen(function*() {
        const f = yield* fixture(stage)
        const fiber = yield* Effect.forkChild(Effect.result(f.run))
        yield* Deferred.await(f.sent)
        yield* f.retire
        const result = yield* Fiber.join(fiber)
        assert.strictEqual(result._tag, "Failure")
        if (result._tag === "Failure") assert.strictEqual(result.failure.reason._tag, "Gone")
        assert.strictEqual(f.interrupted(), 1)
      }).pipe(Effect.scoped, Effect.timeout("1 second")))
  }

  it.live("rejects retirement ordered before a successful reply without a flush", () =>
    Effect.gen(function*() {
      const f = yield* fixture("call", true)
      const result = yield* Effect.result(f.run)
      assert.strictEqual(result._tag, "Failure")
      assert.strictEqual(f.calls(), 1)
    }).pipe(Effect.scoped))

  it.live("ends a pending caller evaluation on page closure without dispatching it again", () =>
    Effect.gen(function*() {
      const f = yield* fixture()
      const fiber = yield* Effect.forkChild(Effect.result(f.run))
      yield* Deferred.await(f.sent)
      Kit.removeRealm(f.buffer, f.realm, new Target.PageClosed({ by: "command" }), () => {})
      yield* f.buffer.flush
      const result = yield* Fiber.join(fiber)
      assert.strictEqual(result._tag, "Failure")
      if (result._tag === "Failure") assert.strictEqual(result.failure.reason._tag, "Gone")
      assert.strictEqual(f.calls(), 1)
      assert.strictEqual(f.interrupted(), 1)
    }).pipe(Effect.scoped, Effect.timeout("1 second")))

  it.live("does not retire on unrelated or same-document flushes and preserves interruption", () =>
    Effect.gen(function*() {
      const f = yield* fixture()
      const fiber = yield* Effect.forkChild(f.run)
      yield* Deferred.await(f.sent)
      Kit.removeRealm(
        f.buffer,
        { ...f.realm, id: "another-realm" as Target.RealmId },
        new Target.RealmDestroyed({}),
        () => {}
      )
      f.buffer.emit({
        _tag: "DocumentUrlChanged",
        document: f.realm.document!.id,
        url: "https://example.test/#fragment" as never,
        navigation: "navigation" as never,
        via: "fragment"
      })
      yield* f.buffer.flush
      assert.isFalse(f.realm.ended)
      assert.strictEqual(f.interrupted(), 0)
      yield* Fiber.interrupt(fiber)
      assert.strictEqual(f.interrupted(), 1)
    }).pipe(Effect.scoped))

  it.effect("keeps the caller's original timeout and interrupts its unanswered call", () =>
    Effect.gen(function*() {
      const f = yield* fixture()
      const fiber = yield* Effect.forkChild(Effect.result(f.run.pipe(Effect.timeout("100 millis"))))
      yield* Deferred.await(f.sent)
      yield* TestClock.adjust("99 millis")
      assert.strictEqual(f.interrupted(), 0)
      yield* f.buffer.flush
      yield* TestClock.adjust("1 millis")
      const result = yield* Fiber.join(fiber)
      assert.strictEqual(result._tag, "Failure")
      if (result._tag === "Failure") assert.strictEqual(result.failure._tag, "TimeoutError")
      assert.strictEqual(f.interrupted(), 1)
      assert.strictEqual(f.calls(), 1)
    }).pipe(Effect.scoped))

  for (const terminal of ["success", "failure", "sessionEnded"] as const) {
    it.effect(`preserves protocol abandonment and late ${terminal} cleanup after retirement`, () =>
      Effect.gen(function*() {
        const f = yield* fixture()
        const browser = yield* makeBrowser
        const client = yield* ProtocolClient.make(browser.transport, WebKitWire.wire)
        Object.assign(f.realm, { session: client.root })
        const outcomes: Array<string> = []
        const fiber = yield* Effect.forkChild(Effect.result(f.run.pipe(
          Effect.provideService(ProtocolClient.ReplyOutcome, (outcome) => {
            outcomes.push(outcome)
          })
        )))
        const command = yield* browser.next
        assert.strictEqual(command.method, "Runtime.callFunctionOn")
        yield* f.retire
        assert.strictEqual((yield* Fiber.join(fiber))._tag, "Failure")
        assert.deepStrictEqual(outcomes, [])
        if (terminal === "sessionEnded") {
          yield* browser.lose("closed")
          yield* client.closed
        } else {
          yield* browser.receive(
            terminal === "success"
              ? { id: command.id, result: { result: { type: "object", objectId: "late-object" } } }
              : { id: command.id, error: { code: -32000, message: "realm gone" } }
          )
          yield* browser.delivered
        }
        assert.deepStrictEqual(outcomes, [terminal])
        if (terminal === "success") {
          const release = yield* browser.next
          assert.strictEqual(release.method, "Runtime.releaseObject")
          assert.deepStrictEqual(release.params, { objectId: "late-object" })
          yield* browser.receive({ id: release.id, result: {} })
        }
        yield* browser.delivered
        assert.strictEqual(yield* browser.pending, 0)
      }).pipe(Effect.scoped))
  }

  it.live("rejects a realm already retired before dispatch", () =>
    Effect.gen(function*() {
      const f = yield* fixture()
      yield* f.retire
      const result = yield* Effect.result(f.run)
      assert.strictEqual(result._tag, "Failure")
      assert.strictEqual(f.interrupted(), 0)
      assert.strictEqual(f.calls(), 0)
    }).pipe(Effect.scoped, Effect.timeout("1 second")))
})

/**
 * A function's declaration crosses the attached inspector inside `Target.sendMessageToTarget`, JSON-encoded twice,
 * in one WebSocket message, and libsoup closes a socket whose incoming message is over 128 KiB.
 */
describe("WebKit evaluation packets", () => {
  const budget = 128 * 1024 - 2048

  const sendThroughWire = Effect.fnUntraced(function*(functionDeclaration: string) {
    const ids = Kit.makeIds()
    const id = ids.realm()
    const packets: Array<string> = []
    let next = 0
    const realm = {
      id,
      ended: false,
      pending: false,
      held: [],
      document: { id: ids.document() },
      session: {
        send: (command: { readonly method: string; readonly params: unknown }) =>
          Effect.sync(() => {
            // What the attached transport writes to the page's WebSocket
            const envelope = WebKitWire.encode(
              ++next,
              command.method,
              command.params,
              WebKitWire.targetKey("1-1", "page-8")
            )
            packets.push(Envelope.unwrap(envelope)!.message)
            return {
              result: { type: "string", value: "{\"batch\":0,\"value\":{\"type\":\"string\",\"value\":\"done\"}}" }
            }
          })
      }
    } as unknown as State.RealmEntry
    const state = {
      buffer: yield* Kit.makeFactBuffer(() => Effect.void),
      ids,
      realms: new Map([[id, realm]]),
      helpers: yield* Cache.make({ capacity: 4, lookup: () => Effect.succeed("helper") }),
      anchors: yield* Cache.make({ capacity: 4, lookup: () => Effect.succeed("anchor") })
    } as unknown as State.State
    const result = yield* Evaluation.evaluate(state, id, {
      functionDeclaration,
      arguments: [],
      result: "value",
      awaitPromise: true,
      userActivation: false
    })
    assert.deepStrictEqual(result, { _tag: "Value", value: { type: "string", value: "done" } })
    const sizes = packets.map((packet) => new TextEncoder().encode(packet).length)
    // The commands the page receives, and the text they carry, in order
    const commands = packets.map((packet) =>
      JSON.parse((JSON.parse(packet) as { readonly params: { readonly message: string } }).params.message) as {
        readonly params: {
          readonly functionDeclaration: string
          readonly arguments: ReadonlyArray<{ value?: unknown }>
        }
      }
    )
    const sent = commands.length === 1
      ? commands[0]!.params.functionDeclaration
      : commands.slice(0, -1).sort((a, b) =>
        Number(a.params.arguments[1]!.value) - Number(b.params.arguments[1]!.value)
      ).map((command) => command.params.arguments[2]!.value).join("")
    return { sizes, sent, commands }
  })

  it.effect("sends the engine's install in packets under the inspector's limit", () =>
    Effect.gen(function*() {
      const { sizes, sent } = yield* sendThroughWire(Engine.install)
      for (const size of sizes) assert.isBelow(size, budget)
      assert.include(sent, Engine.install)
    }).pipe(Effect.scoped))

  it.effect("sends a 1 MiB declaration of escaped and non-ASCII text in parts under the limit, whole", () =>
    Effect.gen(function*() {
      const unit = "\"\\\n\t\u0001é漢😀 '`"
      const body = unit.repeat(Math.ceil((1024 * 1024) / unit.length))
      const declaration = `function() { return ${JSON.stringify(body)}.length }`
      const { sizes, sent } = yield* sendThroughWire(declaration)
      assert.isAbove(sizes.length, 2)
      for (const size of sizes) assert.isBelow(size, budget)
      assert.strictEqual(sent, declaration)
    }).pipe(Effect.scoped))

  it.effect("sends a declaration that fits one message in one command, as before", () =>
    Effect.gen(function*() {
      const declaration = `() => { /*${"x".repeat(70_000)}*/ return 42 }`
      const { sizes, sent } = yield* sendThroughWire(declaration)
      assert.strictEqual(sizes.length, 1)
      assert.isBelow(sizes[0]!, budget)
      assert.include(sent, declaration)
    }).pipe(Effect.scoped))

  it.effect("sends a small declaration in one command, as it is", () =>
    Effect.gen(function*() {
      const { sizes, sent } = yield* sendThroughWire("() => 1")
      assert.strictEqual(sizes.length, 1)
      assert.include(sent, "(() => 1)")
    }).pipe(Effect.scoped))
})
