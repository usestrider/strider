import { assert, describe, it } from "@effect/vitest"
import { Protocol } from "@usestrider/browser/protocol"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Deadline from "../src/Deadline.ts"
import * as Adapter from "../src/internal/adapter.ts"
import * as BoundedAdapter from "../src/internal/boundedAdapter.ts"
import * as Events from "../src/internal/events.ts"
import * as Operation from "../src/internal/operation.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import type * as NetworkRequest from "../src/NetworkRequest.ts"

const kind: Events.Kind<string, string> = { operation: "Event.next", noun: "an event", deliver: (value) => value }
const hop = "hop" as NetworkRequest.HopId

describe("event delivery operation context", () => {
  it.live("keeps the registration record and command budget in delivery and predicates, then records consumption as a step", () =>
    Effect.scoped(Effect.gen(function*() {
      const events = Events.make<string>({ _tag: "Browser" }, () => 0)
      const seen: Array<Operation.Record> = []
      const commands: Array<Option.Option<number>> = []
      const adapter = BoundedAdapter.make({
        responseBody: Effect.fnUntraced(function*() {
          seen.push(yield* Operation.record)
          commands.push(yield* Effect.service(ProtocolClient.CommandDeadline))
          return new Uint8Array([42])
        })
      } as unknown as Adapter.AdapterConnection)
      const registered = yield* Effect.gen(function*() {
        const record = yield* Operation.record
        const wait = yield* Events.next(kind, events, () => true, () =>
          Effect.gen(function*() {
            seen.push(yield* Operation.record)
            assert.deepStrictEqual(yield* Effect.service(Deadline.CurrentDeadline), Option.some(record.budget.at))
            return true
          }), { deliver: (value) => Effect.as(adapter.responseBody(hop), value), unfinished: () => "body" })
        return { record, wait }
      }).pipe(Operation.named("Register.next"), Deadline.within("1 second"))
      Events.publish(events, "first")
      yield* Effect.gen(function*() {
        const consumer = yield* Operation.record
        assert.strictEqual(yield* registered.wait, "first")
        assert.deepStrictEqual(consumer.progress.map(({ step, state }) => ({ step, state })), [{
          step: "Event.next",
          state: "ok"
        }])
      }).pipe(Operation.named("Consume.wait"), Deadline.within("5 seconds"))
      assert.deepStrictEqual(seen, [registered.record, registered.record])
      assert.deepStrictEqual(commands, [Option.some(registered.record.budget.at)])
    })))

  it.live("preserves an adapter NoReply timeout phase, diagnostic record and original budget through asStep", () =>
    Effect.scoped(Effect.gen(function*() {
      const events = Events.make<string>({ _tag: "Browser" }, () => 0)
      const noReply = new Adapter.AdapterError({
        reason: {
          _tag: "Protocol",
          error: new Protocol.ProtocolError({
            reason: new Protocol.NoReply({ method: "Network.getResponseBody", timeout: Duration.zero })
          })
        }
      })
      const adapter = BoundedAdapter.make(
        { responseBody: () => Effect.fail(noReply) } as unknown as Adapter.AdapterConnection
      )
      const registered = yield* Effect.gen(function*() {
        const record = yield* Operation.record
        const wait = yield* Events.next<string, string, never, never, Deadline.Timeout | Adapter.AdapterError>(
          kind,
          events,
          () => true,
          undefined,
          { deliver: (value) => Effect.as(adapter.responseBody(hop), value), unfinished: () => "body" }
        )
        return { record, wait }
      }).pipe(Operation.named("Register.next"), Deadline.within("1 second"))
      Events.publish(events, "first")
      const timeout = yield* registered.wait.pipe(Effect.flip)
      assert(Deadline.isTimeout(timeout))
      assert.strictEqual(timeout.operation, "Register.next")
      assert.strictEqual(timeout.phase, "resolving")
      assert.strictEqual(timeout.diagnostics.operationId, registered.record.id)
      assert.deepStrictEqual(timeout.budget, registered.record.budget.budget)
      assert.deepStrictEqual(
        timeout.hint,
        Option.some("The browser didn't answer the response body before the deadline")
      )
      const adopted = yield* registered.wait.pipe(Operation.named("Consume.wait"), Effect.flip)
      assert(Deadline.isTimeout(adopted))
      assert.strictEqual(adopted.operation, "Consume.wait")
      assert.strictEqual(adopted.phase, "resolving")
      assert.deepStrictEqual(adopted.diagnostics.progress.map(({ step, state }) => ({ step, state })), [{
        step: "Event.next",
        state: "unsent"
      }])
    })))
})
