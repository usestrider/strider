/**
 * Test-only snapshot of the runner's processes and load, `ps` and `uptime`, taken while a call into a Firefox page
 * goes unanswered and when a case fails. It observes only; nothing waits on it but the failed case's report.
 */
import { execFile } from "node:child_process"
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { enabled as nativeEnabled } from "./nativeCrash.ts"
import { settings as stallProbe } from "./stallProbe.ts"

export interface Command {
  readonly command: string
  readonly ok: boolean
  readonly milliseconds: number
  readonly output: string
  readonly truncatedBytes?: number
  readonly error?: string
}
export interface Capture {
  readonly started: string
  /** Why it was taken: a call into a Firefox page that went unanswered, or a case that failed. */
  readonly reason: "slow call" | "failed case"
  /** What went unanswered: an engine round (`call` is `run`, `element` or `other`) or a `contentWindow` read. */
  readonly call?: unknown
  readonly unansweredMs?: number
  /** The failed case's name. */
  readonly case?: string
  readonly processes: Command
  readonly uptime: Command
  readonly artifact?: string
  readonly artifactError?: string
}

export const limits = {
  /** Commands' output kept in the artifact, each. */
  outputBytes: 128 * 1024,
  /** A command's head kept in the trace event, each. */
  traceOutputBytes: 2 * 1024,
  /** The least time between two captures for slow calls, in each test process; a failed case's isn't held to it. */
  intervalMs: 20_000,
  /** Probe files in `.data/macos-crash-reports/`, across the run's processes, each one at most `outputBytes` a command. */
  artifacts: 256
}

interface Settings {
  enabled: boolean
  thresholdMs: number
  intervalMs: number
  /** When the last capture for a slow call started, on `performance.now()`. */
  last: number | undefined
  captures: number
  /** True while a capture for a slow call runs: a second waits for none, and isn't taken. */
  busy: boolean
  onCapture?: ((capture: Capture) => void) | undefined
}
const key = Symbol.for("strider.integration.pageCallProbe")
// One state across module instances: the runner and a test file can load this module separately.
export const settings: Settings = ((globalThis as typeof globalThis & { [key]?: Settings })[key] ??= {
  enabled: nativeEnabled,
  thresholdMs: 50,
  intervalMs: limits.intervalMs,
  last: undefined,
  captures: 0,
  busy: false
})
const directory = path.resolve(import.meta.dirname, "../../../../.data/macos-crash-reports")

const run = (command: string, args: ReadonlyArray<string>, timeout: number) =>
  new Promise<Command>((resolve) => {
    const start = performance.now()
    const text = [command, ...args].join(" ")
    const done = (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
      const output = Buffer.concat([Buffer.from(stdout), Buffer.from(stderr)])
      const kept = output.subarray(0, limits.outputBytes)
      resolve({
        command: text,
        ok: error === null,
        milliseconds: Math.round(performance.now() - start),
        output: kept.toString("utf8"),
        ...(output.length > kept.length ? { truncatedBytes: output.length - kept.length } : {}),
        ...(error === null ? {} : { error: String(error) })
      })
    }
    // The spawn tracing passes the probes' own commands by while this is set.
    stallProbe.spawning = true
    try {
      execFile(command, args, { timeout, killSignal: "SIGKILL", maxBuffer: 4 * limits.outputBytes }, done)
    } catch (error) {
      done(error as Error, "", "")
    } finally {
      stallProbe.spawning = false
    }
  })

const capture = async (
  details: Pick<Capture, "reason" | "call" | "unansweredMs" | "case">
): Promise<Capture> => {
  const started = new Date().toISOString()
  const uptime = run("/usr/bin/uptime", [], 5_000)
  // The state and CPU columns come before the command, which is last so its spaces don't split the others.
  const processes = await run("/bin/ps", ["-axo", "pid,ppid,stat,%cpu,time,rss,etime,wchan,command"], 5_000)
  return { started, ...details, processes, uptime: await uptime }
}

const save = (result: Capture): Capture => {
  try {
    mkdirSync(directory, { recursive: true })
    const existing = readdirSync(directory).filter((name) => name.startsWith("page-call-probe-")).length
    if (existing >= limits.artifacts) throw new Error(`Page call probe file limit (${limits.artifacts}) reached`)
    const name = `page-call-probe-${process.pid}-${++settings.captures}.json`
    writeFileSync(path.join(directory, name), JSON.stringify({ ...result, artifact: name }, null, 2) + "\n")
    return { ...result, artifact: name }
  } catch (error) {
    return { ...result, artifactError: String(error) }
  }
}

/** The trace's copy: the whole capture but for each command's head; the artifact has the rest. */
export const summary = (result: Capture) => {
  const head = (command: Command) => ({
    ...command,
    output: command.output.slice(0, limits.traceOutputBytes),
    retainedInTrace: Math.min(command.output.length, limits.traceOutputBytes)
  })
  return { ...result, processes: head(result.processes), uptime: head(result.uptime) }
}

/**
 * Watches one call into a Firefox page: once it has gone `settings.thresholdMs` without a reply, captures the runner,
 * unless a capture for a slow call is running or one started less than `settings.intervalMs` ago. The reply disarms
 * it; a capture already started runs on, apart from the call.
 */
export const watch = (backend: unknown, call: unknown, trace: (kind: string, payload: unknown) => void) => {
  if (!settings.enabled || !/firefox/i.test(String(backend))) return () => {}
  const sentAt = performance.now()
  const timer = setTimeout(() => {
    const now = performance.now()
    if (settings.busy || (settings.last !== undefined && now - settings.last < settings.intervalMs)) return
    settings.busy = true
    settings.last = now
    const unansweredMs = Math.round(now - sentAt)
    trace("page-call-probe-start", { call, unansweredMs, thresholdMs: settings.thresholdMs })
    capture({ reason: "slow call", call, unansweredMs }).then(save).then(
      (result) => {
        trace("page-call-probe", summary(result))
        settings.onCapture?.(result)
      },
      (error) => trace("page-call-probe-error", String(error))
    ).finally(() => {
      settings.busy = false
    })
  }, settings.thresholdMs)
  timer.unref()
  return () => clearTimeout(timer)
}

/** Captures the runner for a case that failed, whatever the backend, for its trace; `undefined` where it's off. */
export const failed = async (name: string): Promise<Capture | undefined> => {
  if (!settings.enabled) return undefined
  const result = save(await capture({ reason: "failed case", case: name }))
  settings.onCapture?.(result)
  return result
}
