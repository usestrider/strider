/**
 * Temporary: launches the pinned Chromium over the pipe normally, with the crash database's `settings.dat` held
 * under an exclusive flock, and with its Crashpad handler stopped, and records what each launch does.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { describe, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ChildProcess, execFile, spawn as spawnChild } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import type { Readable } from "node:stream"
import { chromium } from "../browsers.ts"

const backend = Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer))

const directory = path.resolve(import.meta.dirname, "../../../../../.data/macos-crash-reports")
const record = (value: object) => {
  mkdirSync(directory, { recursive: true })
  appendFileSync(
    path.join(directory, "crashpad-probe.ndjson"),
    JSON.stringify({ timestamp: new Date().toISOString(), ...value }) + "\n"
  )
}
const database = process.env["STRIDER_MACOS_CRASH_DATABASE"] ?? ""
const settingsFile = path.join(database, "settings.dat")
const round = (value: number) => Math.round(value)

interface Launch {
  pid: number | undefined
  spawnedAt: number
  stderrBytes30s: number
  stderrBytes: number
  firstReplyMs?: number
  exitMs?: number
  exitCode?: number | null
  exitSignal?: string | null
}
let current: Launch | undefined
const prototype = ChildProcess.prototype as ChildProcess & { spawn(options: { args?: Array<string> }): unknown }
const spawn = prototype.spawn
prototype.spawn = function(this: ChildProcess, options: { args?: Array<string> }) {
  const result = spawn.call(this, options)
  if (options.args?.includes("--remote-debugging-pipe")) {
    const launch: Launch = { pid: this.pid, spawnedAt: performance.now(), stderrBytes30s: 0, stderrBytes: 0 }
    current = launch
    const output = this.stdio[4] as Readable | null
    if (output !== null && output !== undefined) {
      const emit = output.emit
      output.emit = function(event: string, ...values: Array<unknown>) {
        if (event === "data" && launch.firstReplyMs === undefined) {
          launch.firstReplyMs = round(performance.now() - launch.spawnedAt)
        }
        return emit.call(this, event, ...values)
      }
    }
    if (this.stderr !== null) {
      const emit = this.stderr.emit
      this.stderr.emit = function(event: string, ...values: Array<unknown>) {
        if (event === "data") {
          const chunk = values[0]
          const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk) : (chunk as Uint8Array).length
          launch.stderrBytes += bytes
          if (performance.now() - launch.spawnedAt <= 30_000) launch.stderrBytes30s += bytes
        }
        return emit.call(this, event, ...values)
      }
    }
    this.once("exit", (code, signal) => {
      launch.exitMs = round(performance.now() - launch.spawnedAt)
      launch.exitCode = code
      launch.exitSignal = signal
    })
  }
  return result
}

const run = (command: string, args: Array<string>, timeout: number) =>
  new Promise<string>((resolve) => {
    execFile(command, args, { timeout, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve(String(stdout) + String(stderr) + (error === null ? "" : `\n[${String(error)}]`)))
  })
const table = () => run("/bin/ps", ["-axo", "pid,ppid,pgid,stat,etime,time,command"], 5_000)
const handlers = (text: string) =>
  text.split("\n").filter((line) => line.includes("chrome_crashpad_handler") && line.includes(`--database=${database}`))
const pidOf = (line: string) => Number(line.trim().split(/\s+/)[0])

// The handlers this launch started, their ps rows and a sample of each, while the launch waits.
const captureHandlers = async (label: string, before: Set<number>, extra: object) => {
  const rows = handlers(await table()).filter((line) => !before.has(pidOf(line)))
  const samples = await Promise.all(rows.map(async (line) => ({
    pid: pidOf(line),
    output: await run("/usr/bin/sample", [String(pidOf(line)), "1"], 15_000)
  })))
  writeFileSync(
    path.join(directory, `crashpad-probe-${label}-handlers.json`),
    JSON.stringify({ label, ...extra, rows, samples }, null, 2)
  )
}

const launch = Effect.fnUntraced(function*(label: string) {
  const began = performance.now()
  const outcome = yield* Effect.scoped(Effect.map(Browser.Browser, (browser) => browser.info.version)).pipe(
    Effect.provide(backend),
    Effect.result
  )
  const done = current
  const result = {
    kind: "launch",
    label,
    pid: done?.pid,
    totalMs: round(performance.now() - began),
    firstReplyMs: done?.firstReplyMs ?? null,
    stderrBytes30s: done?.stderrBytes30s ?? null,
    stderrBytes: done?.stderrBytes ?? null,
    exitMs: done?.exitMs ?? null,
    exitCode: done?.exitCode ?? null,
    exitSignal: done?.exitSignal ?? null,
    outcome: outcome._tag === "Success" ? { version: outcome.success } : { failure: String(outcome.failure) },
    settingsExists: existsSync(settingsFile)
  }
  record(result)
  return result
})

// Launches while `watch` observes from just before the spawn, and records what it saw.
const whileLaunching = Effect.fnUntraced(function*(label: string, watch: (before: Set<number>) => Promise<object>) {
  const before = new Set(handlers(yield* Effect.promise(table)).map(pidOf))
  const watching = watch(before)
  const result = yield* launch(label)
  const observed = yield* Effect.promise(() => watching)
  record({ kind: "observed", label, observed })
  return result
})

describe("Chromium Crashpad probe", () => {
  it.live("a: a normal launch", () =>
    Effect.gen(function*() {
      record({
        kind: "start",
        database,
        settingsExists: existsSync(settingsFile),
        entries: database === "" ? [] : readdirSync(database)
      })
      yield* launch("a-baseline")
      record({ kind: "after-a", settingsExists: existsSync(settingsFile) })
    }), { timeout: 120_000 })

  it.live("b: a launch while settings.dat is held under an exclusive flock", () =>
    Effect.gen(function*() {
      const locker = spawnChild("/usr/bin/python3", [
        "-c",
        "import fcntl,sys,time\nf=open(sys.argv[1],'r+b')\nfcntl.flock(f,fcntl.LOCK_EX)\nprint('locked',flush=True)\ntime.sleep(40)\n",
        settingsFile
      ], { stdio: ["ignore", "pipe", "pipe"] })
      let lockerErr = ""
      locker.stderr.on("data", (chunk) => lockerErr += String(chunk))
      const locked = yield* Effect.promise(() =>
        new Promise<string>((resolve) => {
          locker.stdout.once("data", (chunk) => resolve(String(chunk).trim()))
          locker.once("exit", (code) => resolve(`exited ${code}: ${lockerErr}`))
        })
      )
      const lockedAt = performance.now()
      record({ kind: "lock", locked })
      yield* whileLaunching("b-locked-settings", async (before) => {
        await new Promise((resolve) => setTimeout(resolve, 12_000))
        await captureHandlers("b-locked-settings", before, { afterLaunchMs: 12_000 })
        return { lockHeldMs: round(performance.now() - lockedAt) }
      })
      yield* Effect.promise(() =>
        new Promise<void>((resolve) => {
          if (locker.exitCode !== null) return resolve()
          locker.once("exit", () => resolve())
        })
      )
      record({ kind: "lock-released", afterMs: round(performance.now() - lockedAt), lockerErr })
    }), { timeout: 150_000 })

  it.live("c: a launch whose Crashpad handler is stopped as soon as it appears", () =>
    Effect.gen(function*() {
      yield* whileLaunching("c-stopped-handler", async (before) => {
        const started = performance.now()
        let stopped: { pid: number; row: string; afterMs: number } | undefined
        while (stopped === undefined && performance.now() - started < 20_000) {
          const found = handlers(await table()).filter((line) => !before.has(pidOf(line)))
          if (found.length > 0) {
            const row = found[0]!
            try {
              process.kill(pidOf(row), "SIGSTOP")
              stopped = { pid: pidOf(row), row, afterMs: round(performance.now() - started) }
            } catch (error) {
              return { stopError: String(error), row }
            }
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        if (stopped === undefined) return { stopped: null }
        await new Promise((resolve) => setTimeout(resolve, 12_000 - stopped.afterMs))
        await captureHandlers("c-stopped-handler", before, { stopped })
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, 40_000 - (performance.now() - started))))
        try {
          process.kill(stopped.pid, "SIGCONT")
        } catch {}
        return { stopped, continuedAfterMs: round(performance.now() - started) }
      })
    }), { timeout: 150_000 })

  it.live("d: a normal launch afterwards", () =>
    Effect.gen(function*() {
      yield* launch("d-baseline-after")
    }), { timeout: 120_000 })
})
