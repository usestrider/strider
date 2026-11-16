/**
 * A clock's timeline, without a browser: operations that overlap on it each replace the init script the one before
 * them declared, so one script stays registered for later documents, never one per operation.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Clock from "../src/internal/clock.ts"
import type * as Runtime from "../src/internal/runtime.ts"

/** A timeline over no pages, on an adapter whose declarations take a turn of the scheduler to register. */
const timeline = () => {
  const registered = new Set<string>()
  let next = 0
  const adapter = {
    declare: Effect.fnUntraced(function*(_scope: Adapter.DeclarationScope, declaration: Adapter.Declaration) {
      yield* Effect.yieldNow
      const id = `script-${next++}`
      registered.add(id)
      yield* Effect.addFinalizer(() => Effect.sync(() => registered.delete(id)))
      assert.strictEqual(declaration._tag, "InitScript")
      return id
    })
  }
  const runtime = { model: { adapter }, timelines: Clock.makeTimelines() } as unknown as Runtime.Runtime
  const clock = Clock.make({
    runtime,
    scope: { _tag: "Browser" } as unknown as Adapter.DeclarationScope,
    pages: () => [],
    name: "Page.clock",
    conflicting: () => Option.none()
  }, {})
  return { clock, registered }
}

describe("PageClock timeline", () => {
  it.effect("keeps one init script registered after overlapping operations", () =>
    Effect.scoped(Effect.gen(function*() {
      const { clock, registered } = timeline()
      yield* clock.install({ mode: "controlled", at: "2026-01-01T00:00:00Z" })
      assert.strictEqual(registered.size, 1)
      for (let i = 0; i < 5; i++) {
        yield* Effect.all([
          clock.adjust("16 millis"),
          clock.setTime(Date.UTC(2026, 0, 1, 0, 0, i + 1))
        ], { concurrency: "unbounded", discard: true })
        assert.strictEqual(registered.size, 1)
      }
    })))
})
