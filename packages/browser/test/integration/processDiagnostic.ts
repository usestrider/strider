/** Test-only, bounded process evidence captured before browser scope finalizers. */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("./processSnapshot.mjs", import.meta.url))

export const snapshot = (pid: number, previous: ReadonlyArray<{ pid: number; startTime?: string | undefined }>) =>
  Effect.callback<unknown>((resume) => {
    let finished = false
    const finish = (value: unknown) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resume(Effect.succeed(value))
    }
    const child = execFile(process.execPath, [script, String(pid), JSON.stringify(previous)], {
      timeout: 1500,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) return finish({ error: String(error), stderr, stdout })
      try {
        finish(JSON.parse(stdout))
      } catch (error) {
        finish({ error: String(error), stdout, stderr })
      }
    })
    const stop = () => {
      child.kill("SIGKILL")
      child.unref()
      child.stdout?.destroy()
      child.stderr?.destroy()
    }
    // Independent of execFile's completion callback, including a child blocked in a kernel read.
    const timer = setTimeout(() => {
      stop()
      finish({ error: "process snapshot exceeded 2000ms", pid })
    }, 2000)
    return Effect.sync(() => {
      clearTimeout(timer)
      stop()
    })
  })

export const observeProcesses = Effect.fnUntraced(function*(
  note: (source: string, value: unknown) => void,
  pid: number,
  target: string,
  capture: typeof snapshot = snapshot
) {
  let previous: Array<{ pid: number; startTime?: string | undefined }> = []
  const take = (phase: string) =>
    capture(pid, previous).pipe(
      Effect.matchCause({
        onFailure: (cause) => note("process snapshot error", { phase, cause }),
        onSuccess: (value) => {
          note("process snapshot", { phase, target, value })
          const records = (value as { processes?: typeof previous } | undefined)?.processes
          if (Array.isArray(records)) previous = records.map(({ pid, startTime }) => ({ pid, startTime }))
        }
      })
    )
  // Registered after connections/subscriptions: runs before they and the browser are released.
  yield* Effect.addFinalizer((exit) =>
    Exit.isFailure(exit)
      ? take("failure before browser teardown")
      : Effect.sync(() => note("process snapshot skipped", { reason: "test succeeded", target }))
  )
  yield* take("before Page.crash")
})
