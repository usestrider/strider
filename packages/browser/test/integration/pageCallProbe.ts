/**
 * Test-only capture of the runner while a call into a Firefox page goes unanswered: `ps` of every process, `sample`
 * of Firefox's parent and content processes, the runner's load and memory. It observes only; nothing waits on it.
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
  /** What went unanswered: an engine round (`call` is `run`, `element` or `other`) or a `contentWindow` read. */
  readonly call: unknown
  readonly unansweredMs: number
  readonly processes: Command
  /** The Firefox parents found, with their descendants; the first `limits.sampled` of them all are sampled. */
  readonly firefox: ReadonlyArray<{ readonly pid: number; readonly descendants: ReadonlyArray<number> }>
  readonly samples: ReadonlyArray<Command & { readonly pid: number }>
  readonly omittedSamples: number
  readonly uptime: Command
  readonly vmStat: Command
  readonly artifact?: string
  readonly artifactError?: string
}

export const limits = {
  /** Commands' output kept in the artifact, each. */
  outputBytes: 128 * 1024,
  /** A command's head kept in the trace event, each. */
  traceOutputBytes: 2 * 1024,
  /** Processes sampled, Firefox parents first, then their descendants. */
  sampled: 8,
  /** Seconds each `sample` runs. */
  sampleSeconds: 1,
  /** Captures each test process starts, across its cases. */
  capturesPerProcess: 24,
  /** Probe files in `.data/macos-crash-reports/`, across the run's processes, each one at most `artifactBytes`. */
  artifacts: 64,
  artifactBytes: 512 * 1024
}

interface Settings {
  enabled: boolean
  thresholdMs: number
  captures: number
  /** The cases already captured, by the recorder's scope: one capture each. */
  captured: Set<string>
  /** True while a capture runs: a second waits for none, and isn't taken. */
  busy: boolean
  onCapture?: ((capture: Capture) => void) | undefined
}
const key = Symbol.for("strider.integration.pageCallProbe")
export const settings: Settings = ((globalThis as typeof globalThis & { [key]?: Settings })[key] ??= {
  enabled: nativeEnabled,
  thresholdMs: 50,
  captures: 0,
  captured: new Set(),
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

/** Firefox's parent runs `Contents/MacOS/firefox`; its content processes are its descendants (`plugin-container`). */
const firefoxOf = (table: string) => {
  const rows = table.split("\n").slice(1).map((line) => {
    const [pid, ppid, ...rest] = line.trim().split(/\s+/)
    return { pid: Number(pid), ppid: Number(ppid), command: rest.join(" ") }
  }).filter((row) => Number.isInteger(row.pid) && Number.isInteger(row.ppid))
  const children = new Map<number, Array<number>>()
  for (const row of rows) children.set(row.ppid, [...children.get(row.ppid) ?? [], row.pid])
  const parents = rows.filter((row) => /\/Contents\/MacOS\/firefox(\s|$)/.test(row.command))
  return parents.map(({ pid }) => {
    const descendants: Array<number> = []
    const queue = [...children.get(pid) ?? []]
    while (queue.length > 0) {
      const next = queue.shift()!
      if (descendants.includes(next)) continue
      descendants.push(next)
      queue.push(...children.get(next) ?? [])
    }
    return { pid, descendants }
  })
}

const capture = async (call: unknown, unansweredMs: number): Promise<Capture> => {
  const started = new Date().toISOString()
  const uptime = run("/usr/bin/uptime", [], 5_000)
  const vmStat = run("/usr/bin/vm_stat", [], 5_000)
  // The state and CPU columns come before the command, which is last so its spaces don't split the others.
  const processes = await run("/bin/ps", ["-axo", "pid,ppid,stat,%cpu,time,rss,etime,wchan,command"], 5_000)
  const firefox = firefoxOf(processes.output)
  const order = [...firefox.map((parent) => parent.pid), ...firefox.flatMap((parent) => parent.descendants)]
  const chosen = order.slice(0, limits.sampled)
  const samples = await Promise.all(
    chosen.map((pid) =>
      run("/usr/bin/sample", [String(pid), String(limits.sampleSeconds)], 10_000).then((result) => ({ ...result, pid }))
    )
  )
  return {
    started,
    call,
    unansweredMs,
    processes,
    firefox,
    samples,
    omittedSamples: order.length - chosen.length,
    uptime: await uptime,
    vmStat: await vmStat
  }
}

const commands = (result: Capture, f: <A extends Command>(command: A) => A): Capture => ({
  ...result,
  processes: f(result.processes),
  samples: result.samples.map(f)
})

const save = (result: Capture): Capture => {
  try {
    mkdirSync(directory, { recursive: true })
    const existing = readdirSync(directory).filter((name) => name.startsWith("page-call-probe-")).length
    if (existing >= limits.artifacts) throw new Error(`Page call probe file limit (${limits.artifacts}) reached`)
    const name = `page-call-probe-${process.pid}-${settings.captures}.json`
    let text = JSON.stringify({ ...result, artifact: name }, null, 2) + "\n"
    if (Buffer.byteLength(text) > limits.artifactBytes) {
      // Samples and the process table are the largest parts; shorten them evenly.
      const each = Math.floor(limits.artifactBytes / (2 * (result.samples.length + 2)))
      const shorten = <A extends Command>(command: A): A => ({
        ...command,
        output: command.output.slice(0, each),
        truncatedBytes: (command.truncatedBytes ?? 0) + Math.max(0, Buffer.byteLength(command.output) - each)
      })
      text = JSON.stringify({ ...commands(result, shorten), artifact: name }, null, 2) + "\n"
    }
    writeFileSync(path.join(directory, name), text)
    return { ...result, artifact: name }
  } catch (error) {
    return { ...result, artifactError: String(error) }
  }
}

/** The trace's copy: the whole capture but for each command's head; the artifact has the rest. */
const summary = (result: Capture) =>
  commands(result, (command) => ({
    ...command,
    output: command.output.slice(0, limits.traceOutputBytes),
    retainedInTrace: Math.min(command.output.length, limits.traceOutputBytes)
  }))

/**
 * Watches one call into a Firefox page: once it has gone `settings.thresholdMs` without a reply, captures the runner
 * once for the case `scope` names, unless that case was captured, a capture is running, or the process's captures
 * are used up. The reply disarms it; a capture already started runs on, apart from the call.
 */
export const watch = (
  backend: unknown,
  scope: string | undefined,
  call: unknown,
  trace: (kind: string, payload: unknown) => void
) => {
  if (!settings.enabled || !/firefox/i.test(String(backend))) return () => {}
  const sentAt = performance.now()
  const timer = setTimeout(() => {
    const id = scope ?? "outside a case"
    if (settings.busy || settings.captured.has(id) || settings.captures >= limits.capturesPerProcess) return
    settings.busy = true
    settings.captured.add(id)
    settings.captures++
    const unansweredMs = Math.round(performance.now() - sentAt)
    trace("page-call-probe-start", { call, unansweredMs, thresholdMs: settings.thresholdMs })
    capture(call, unansweredMs).then(save).then(
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
