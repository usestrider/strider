/** Test-only, bounded process evidence captured before browser scope finalizers. */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("./processSnapshot.mjs", import.meta.url))

interface KnownProcess {
  readonly pid: number
  readonly startTime?: string | undefined
  readonly role?: string | undefined
}

export const snapshot = (pid: number, previous: ReadonlyArray<KnownProcess>, collector = script) =>
  Effect.callback<unknown>((resume) => {
    let finished = false
    let output = ""
    let errors = ""
    const finish = (error: unknown, metadata: unknown) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      const processes = new Map<number, Record<string, unknown>>()
      const value: Record<string, any> = { root: pid, host: {}, complete: false, exit: metadata }
      let malformed = 0
      for (const line of output.split("\n").filter(Boolean)) {
        try {
          const record = JSON.parse(line)
          if (record.kind === "header" || record.kind === "complete") Object.assign(value, record)
          if (record.kind === "complete") value.complete = true
          if (record.kind === "host") value.host[record.path] = record.value
          if (record.kind === "process") {
            processes.set(record.process.pid, { ...processes.get(record.process.pid), ...record.process })
          }
          if (record.kind === "output-truncated") value.outputTruncated = true
          if (record.kind === "collector-error") value.collectorError = record.error
        } catch {
          malformed++
        }
      }
      value.processes = [...processes.values()]
      value.partial = !value.complete
      value.malformedRecords = malformed
      value.stderr = errors.slice(-65536)
      if (error) value.error = String(error)
      resume(Effect.succeed(value))
    }
    const child = execFile(
      process.execPath,
      [collector, String(pid), JSON.stringify(previous)],
      {
        timeout: 1500,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024
      },
      (error) =>
        finish(error, {
          code: error ? error.code ?? null : 0,
          signal: error?.signal ?? null,
          killed: error?.killed ?? false
        })
    )
    child.stdout?.on("data", (chunk) => {
      output = (output + String(chunk)).slice(0, 1024 * 1024)
    })
    child.stderr?.on("data", (chunk) => {
      errors = (errors + String(chunk)).slice(-65536)
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
      finish("process snapshot exceeded 2000ms", {
        code: null,
        signal: null,
        killed: child.killed,
        requestedSignal: "SIGKILL",
        parentDeadline: true
      })
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
  let previous: Array<KnownProcess> = []
  const take = (phase: string) =>
    capture(pid, previous).pipe(
      Effect.matchCause({
        onFailure: (cause) => note("process snapshot error", { phase, cause }),
        onSuccess: (value) => {
          note("process snapshot", { phase, target, value })
          const records = (value as { processes?: typeof previous } | undefined)?.processes
          if (Array.isArray(records)) previous = records.map(({ pid, startTime, role }) => ({ pid, startTime, role }))
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
