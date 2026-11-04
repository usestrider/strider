/** Failure evidence must run before teardown and must not replace the test's failure. */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { observeProcesses, snapshot } from "./integration/processDiagnostic.ts"

describe("crash process diagnostics", () => {
  for (const exit of [Exit.fail("original failure"), Exit.interrupt()] as const) {
    it.effect(`snapshots before teardown for ${String(exit)}`, () =>
      Effect.gen(function*() {
        const scope = yield* Scope.make()
        const order: Array<string> = []
        let alive = true
        const read = () =>
          Effect.sync(() => {
            assert.isTrue(alive)
            order.push("snapshot")
            return { processes: [{ pid: 123, startTime: "456" }] }
          })
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            alive = false
            order.push("browser teardown")
          })
        ).pipe(Scope.provide(scope))
        yield* observeProcesses(
          (source, value) => {
            if (source === "process snapshot") order.push((value as { phase: string }).phase)
          },
          123,
          "target",
          read
        ).pipe(Scope.provide(scope))
        yield* Scope.close(scope, exit)
        assert.deepStrictEqual(order, [
          "snapshot",
          "before Page.crash",
          "snapshot",
          "failure before browser teardown",
          "browser teardown"
        ])
      }))
  }

  it.effect("preserves the original defect when diagnostic collection fails", () =>
    Effect.gen(function*() {
      const original = new Error("original test failure")
      const notes: Array<string> = []
      const result = yield* Effect.scoped(Effect.gen(function*() {
        yield* observeProcesses((source) => notes.push(source), 123, "target", () => Effect.die("read denied"))
        return yield* Effect.die(original)
      })).pipe(Effect.exit)
      assert.deepStrictEqual(result, Exit.die(original))
      assert.deepStrictEqual(notes, ["process snapshot error", "process snapshot error"])
    }))

  it.effect("reads actual limits and reports disappeared processes without failing", () =>
    Effect.gen(function*() {
      const value = yield* snapshot(process.pid, [{ pid: 2147483647, startTime: "gone" }])
      const result = value as {
        processes: Array<{ pid: number; limits?: { text: string }; notObservedInProcScan?: boolean }>
      }
      assert.include(result.processes.find((item) => item.pid === process.pid)!.limits!.text, "Max core file size")
      assert.isTrue(result.processes.find((item) => item.pid === 2147483647)!.notObservedInProcScan)
    }))
})
