import { assert, describe, it } from "@effect/vitest"
import * as Cache from "effect/Cache"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Evaluation from "../src/internal/webkitAdapter/evaluation.ts"
import type * as State from "../src/internal/webkitAdapter/state.ts"

const fixture = Effect.gen(function*() {
  const buffer = yield* Kit.makeFactBuffer(() => Effect.void)
  const sent = yield* Deferred.make<void>()
  let calls = 0
  let interrupted = 0
  const ids = Kit.makeIds()
  const id = ids.realm()
  const realm = {
    id, ended: false,
    session: { send: () => Effect.andThen(Deferred.succeed(sent, undefined), Effect.never).pipe(
      Effect.onInterrupt(() => Effect.sync(() => { interrupted++ })),
      Effect.tap(() => Effect.sync(() => { calls++ }))
    ) }
  } as unknown as State.RealmEntry
  const helpers = yield* Cache.make({ capacity: 4, lookup: () => Effect.succeed("helper") })
  const state = { buffer, ids, realms: new Map([[id, realm]]), helpers } as unknown as State.State
  const run = Evaluation.evaluate(state, id, {
    functionDeclaration: "() => 1", arguments: [], result: "value", awaitPromise: true, userActivation: false
  })
  const retire = Effect.sync(() => { realm.ended = true }).pipe(Effect.andThen(buffer.flush))
  return { run, retire, sent, realm, buffer, calls: () => calls, interrupted: () => interrupted }
})

describe("WebKit evaluation retirement", () => {
  it.live("interrupts an unanswered call when its captured realm retires", () => Effect.gen(function*() {
    const f = yield* fixture
    const fiber = yield* Effect.forkChild(Effect.result(f.run))
    yield* Deferred.await(f.sent)
    yield* f.retire
    const result = yield* Fiber.join(fiber)
    assert.strictEqual(result._tag, "Failure")
    if (result._tag === "Failure") assert.strictEqual(result.failure.reason._tag, "Gone")
    assert.strictEqual(f.interrupted(), 1)
  }).pipe(Effect.scoped, Effect.timeout("1 second")))

  it.live("does not retire on unrelated or same-document flushes and preserves interruption", () => Effect.gen(function*() {
    const f = yield* fixture
    const fiber = yield* Effect.forkChild(f.run)
    yield* Deferred.await(f.sent)
    yield* f.buffer.flush
    assert.isFalse(f.realm.ended)
    assert.strictEqual(f.interrupted(), 0)
    yield* Fiber.interrupt(fiber)
    assert.strictEqual(f.interrupted(), 1)
  }).pipe(Effect.scoped))

  it.live("rejects a realm already retired before dispatch", () => Effect.gen(function*() {
    const f = yield* fixture
    yield* f.retire
    const result = yield* Effect.result(f.run)
    assert.strictEqual(result._tag, "Failure")
    assert.strictEqual(f.interrupted(), 0)
  }).pipe(Effect.scoped, Effect.timeout("1 second")))
})
