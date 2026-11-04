import { assert, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { spawn } from "node:child_process"
import { connection } from "../../integration/failureTrace.ts"
let wire: ReturnType<typeof connection>
const backend = Layer.effectDiscard(Effect.gen(function*() {
  wire = connection("shared-lifecycle")
  wire("process-start", "SHARED_SETUP")
  const child = spawn(process.execPath, [
    "-e",
    "process.stdin.resume(); process.stdin.on(\"end\", () => process.stderr.write(\"REAL_SHARED_CLEANUP_STDERR\")); process.stderr.write(\"REAL_SHARED_READY\")"
  ])
  child.stderr.on("data", () => {})
  yield* Effect.addFinalizer(() =>
    Effect.promise(() =>
      new Promise<void>((resolve) => {
        child.once("close", () => resolve())
        child.stdin.end()
      })
    )
  )
  yield* Effect.promise(() => new Promise<void>((resolve) => child.stderr.once("data", () => resolve())))
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      wire("stderr", "SHARED_CLEANUP_STDERR")
      wire("process-exit", "SHARED_EXIT")
    })
  )
}))
layer(backend, { excludeTestServices: true })((it) => {
  it.effect("first shared test fails", () =>
    Effect.sync(() => {
      wire("send", "FIRST_FAIL_ONLY")
      assert.fail("deliberate first failure")
    }))
  it.effect("later shared test fails", () =>
    Effect.sync(() => {
      wire("send", "SECOND_FAIL_SEND")
      wire("receive", "SECOND_FAIL_RECEIVE")
      assert.fail("deliberate later failure")
    }))
})
