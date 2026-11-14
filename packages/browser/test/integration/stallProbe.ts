/**
 * Test-only capture of a `--remote-debugging-pipe` child that has not answered its first pipe command: its process
 * tree, `sample` stacks, fds 0–4, profile listing and the runner's load. It observes only; nothing waits on it.
 */
import { execFile } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { lstat, readdir } from "node:fs/promises"
import * as path from "node:path"
import { enabled as nativeEnabled } from "./nativeCrash.ts"

export interface Command {
  readonly command: string
  readonly ok: boolean
  readonly milliseconds: number
  readonly output: string
  readonly truncatedBytes?: number
  readonly error?: string
}
export interface Capture {
  readonly browserPid: number
  readonly started: string
  readonly afterFirstSendMs: number
  readonly tree: Command
  readonly descendants: ReadonlyArray<number>
  readonly omittedDescendants: number
  readonly samples: ReadonlyArray<Command & { readonly pid: number }>
  readonly fds: Command
  readonly profile: { readonly directory?: string; readonly entries: ReadonlyArray<string>; readonly omitted: number }
  readonly uptime: Command
  readonly vmStat: Command
  readonly artifact?: string
  readonly artifactError?: string
}

export const limits = {
  /** Commands' output kept in the artifact, each. */
  outputBytes: 128 * 1024,
  /** A sample's head kept in the trace event, each. */
  traceSampleBytes: 4 * 1024,
  /** Descendants sampled besides the browser. */
  sampledDescendants: 6,
  profileEntries: 256,
  /** Probe files in `.data/macos-crash-reports/`, across the run's processes, each one at most `artifactBytes`. */
  artifacts: 8,
  artifactBytes: 1024 * 1024
}

interface Settings {
  enabled: boolean
  thresholdMs: number
  /** Set while the probe starts its own commands, so the spawn tracing passes them by. */
  spawning: boolean
  onCapture?: ((capture: Capture) => void) | undefined
}
const key = Symbol.for("strider.integration.stallProbe")
// One state across module instances: the runner and a test file can load this module separately.
export const settings: Settings = ((globalThis as typeof globalThis & { [key]?: Settings })[key] ??= {
  enabled: nativeEnabled,
  thresholdMs: 10_000,
  spawning: false
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
    settings.spawning = true
    try {
      execFile(command, args, { timeout, killSignal: "SIGKILL", maxBuffer: 4 * limits.outputBytes }, done)
    } catch (error) {
      done(error as Error, "", "")
    } finally {
      settings.spawning = false
    }
  })

const descendantsOf = (root: number, table: string) => {
  const children = new Map<number, Array<number>>()
  for (const line of table.split("\n").slice(1)) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
    children.set(ppid!, [...children.get(ppid!) ?? [], pid!])
  }
  const found: Array<number> = []
  const queue = [...children.get(root) ?? []]
  while (queue.length > 0) {
    const pid = queue.shift()!
    if (found.includes(pid)) continue
    found.push(pid)
    queue.push(...children.get(pid) ?? [])
  }
  return found
}

const listProfile = async (root: string | undefined) => {
  const entries: Array<string> = []
  let omitted = 0
  if (root === undefined) return { entries, omitted }
  const visit = async (dir: string, depth: number) => {
    let names: Array<string>
    try {
      names = (await readdir(dir)).sort()
    } catch (error) {
      entries.push(`${path.relative(root, dir) || "."}: ${String(error)}`)
      return
    }
    for (const name of names) {
      if (entries.length >= limits.profileEntries) {
        omitted++
        continue
      }
      const file = path.join(dir, name)
      try {
        const info = await lstat(file)
        const kind = info.isDirectory() ? "d" : info.isSymbolicLink() ? "l" : "f"
        entries.push(`${kind} ${info.size} ${info.mtime.toISOString()} ${path.relative(root, file)}`)
        if (info.isDirectory() && depth < 2) await visit(file, depth + 1)
      } catch (error) {
        entries.push(`${path.relative(root, file)}: ${String(error)}`)
      }
    }
  }
  await visit(root, 1)
  return { directory: root, entries, omitted }
}

const capture = async (pid: number, args: ReadonlyArray<string>, afterFirstSendMs: number): Promise<Capture> => {
  const started = new Date().toISOString()
  const profileDirectory = args.find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length)
  const fds = run("/usr/sbin/lsof", ["-nP", "-a", "-p", String(pid), "-d", "0-4"], 10_000)
  const uptime = run("/usr/bin/uptime", [], 5_000)
  const vmStat = run("/usr/bin/vm_stat", [], 5_000)
  const profile = listProfile(profileDirectory)
  const browserSample = run("/usr/bin/sample", [String(pid), "2"], 15_000)
  const all = await run("/bin/ps", ["-axo", "pid,ppid,pgid,stat,etime,time,rss,wchan,command"], 5_000)
  const found = descendantsOf(pid, all.output)
  const sampled = found.slice(0, limits.sampledDescendants)
  const keep = new Set([pid, ...found])
  const lines = all.output.split("\n")
  const tree: Command = {
    ...all,
    output: [lines[0], ...lines.slice(1).filter((line) => keep.has(Number(line.trim().split(/\s+/)[0])))].join("\n")
  }
  const samples = await Promise.all([
    browserSample.then((result) => ({ ...result, pid })),
    ...sampled.map((child) =>
      run("/usr/bin/sample", [String(child), "2"], 15_000).then((result) => ({ ...result, pid: child }))
    )
  ])
  return {
    browserPid: pid,
    started,
    afterFirstSendMs,
    tree,
    descendants: found,
    omittedDescendants: found.length - sampled.length,
    samples,
    fds: await fds,
    profile: await profile,
    uptime: await uptime,
    vmStat: await vmStat
  }
}

const save = (result: Capture): Capture => {
  try {
    mkdirSync(directory, { recursive: true })
    const existing = readdirSync(directory).filter((name) => name.startsWith("stall-probe-")).length
    if (existing >= limits.artifacts) throw new Error(`Stall probe file limit (${limits.artifacts}) reached`)
    const name = `stall-probe-${process.pid}-${result.browserPid}.json`
    let text = JSON.stringify({ ...result, artifact: name }, null, 2) + "\n"
    if (Buffer.byteLength(text) > limits.artifactBytes) {
      // Samples are the largest part; shorten them evenly rather than drop the smaller records.
      const each = Math.floor(limits.artifactBytes / (2 * (result.samples.length + 1)))
      text = JSON.stringify(
        {
          ...result,
          artifact: name,
          samples: result.samples.map((sample) => ({
            ...sample,
            output: sample.output.slice(0, each),
            truncatedBytes: (sample.truncatedBytes ?? 0) + Math.max(0, Buffer.byteLength(sample.output) - each)
          }))
        },
        null,
        2
      ) + "\n"
    }
    writeFileSync(path.join(directory, name), text)
    return { ...result, artifact: name }
  } catch (error) {
    return { ...result, artifactError: String(error) }
  }
}

/** The trace's copy: the whole capture but for each sample's head. */
const summary = (result: Capture) => ({
  ...result,
  samples: result.samples.map(({ output, ...sample }) => ({
    ...sample,
    output: output.slice(0, limits.traceSampleBytes),
    retainedInTrace: Math.min(output.length, limits.traceSampleBytes)
  }))
})

/**
 * Watches one pipe child: once its first pipe write has gone unanswered for `settings.thresholdMs` while the
 * process runs, captures it once. The first byte received or the exit disarms it.
 */
export const watch = (
  child: ChildProcess,
  args: ReadonlyArray<string>,
  trace: (kind: string, payload: unknown) => void
) => {
  let state: "idle" | "armed" | "done" = "idle"
  let timer: ReturnType<typeof setTimeout> | undefined
  const disarm = () => {
    state = "done"
    if (timer !== undefined) clearTimeout(timer)
  }
  return {
    sent: () => {
      if (state !== "idle") return
      state = "armed"
      const sentAt = performance.now()
      timer = setTimeout(() => {
        if (state !== "armed") return
        state = "done"
        const pid = child.pid
        if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
        trace("stall-probe-start", { pid, thresholdMs: settings.thresholdMs })
        capture(pid, args, Math.round(performance.now() - sentAt)).then(save).then(
          (result) => {
            trace("stall-probe", summary(result))
            settings.onCapture?.(result)
          },
          (error) => trace("stall-probe-error", String(error))
        )
      }, settings.thresholdMs)
      timer.unref()
    },
    received: disarm,
    exited: disarm
  }
}
