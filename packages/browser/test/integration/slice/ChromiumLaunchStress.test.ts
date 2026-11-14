/**
 * Temporary: launches the pinned Chromium over the pipe back to back, as the slice suites do, until a launch fails
 * or 40 minutes pass, recording each launch's spawn-to-first-reply time and the load average every 50 launches.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ChildProcess, execFile, execFileSync } from "node:child_process"
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Readable, Writable } from "node:stream"
import { site } from "../adapter/harness.ts"
import { assertPinned, chromium } from "../browsers.ts"

const backend = Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer))

const directory = path.resolve(import.meta.dirname, "../../../../../.data/macos-crash-reports")
const file = path.join(directory, "stress.ndjson")
const record = (value: object) => {
  mkdirSync(directory, { recursive: true })
  appendFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), ...value }) + "\n")
}

interface Launch {
  pid: number | undefined
  spawnedAt: number
  firstReplyMs?: number
  closeSentAt?: number
  pipeClosedAt?: number
  exitedAt?: number
  exitCode?: number | null
  exitSignal?: string | null
  signalsSent: Array<{ signal: string; atMs: number }>
}
let current: Launch | undefined
let lastExitAt: number | undefined
let slowCaptures = 0
const round = (value: number) => Math.round(value * 10) / 10

const run = (command: string, args: Array<string>, timeout: number) =>
  new Promise<string>((resolve) => {
    execFile(command, args, { timeout, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve(String(stdout) + String(stderr) + (error === null ? "" : `\n[${String(error)}]`)))
  })
const processTable = (timeout: number) =>
  run("/bin/ps", ["-axo", "pid,ppid,pgid,stat,etime,time,rss,wchan,command"], timeout)
const descendants = (root: number, table: string) => {
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

// While the browser is still alive 3 s after Browser.close: its tree and a sample of it and each child.
const captureSlowClose = async (launch: Launch, n: number) => {
  const pid = launch.pid!
  const table = await processTable(5_000)
  const found = descendants(pid, table)
  const keep = new Set([pid, ...found])
  const lines = table.split("\n")
  const tree = [lines[0], ...lines.slice(1).filter((line) => keep.has(Number(line.trim().split(/\s+/)[0])))].join("\n")
  const samples = await Promise.all([pid, ...found].map(async (target) => ({
    pid: target,
    output: await run("/usr/bin/sample", [String(target), "1"], 10_000)
  })))
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, `slow-close-${n}-${pid}.json`),
    JSON.stringify({ n, pid, afterCloseSentMs: round(performance.now() - launch.closeSentAt!), tree, samples }, null, 2)
  )
}

const prototype = ChildProcess.prototype as ChildProcess & { spawn(options: { args?: Array<string> }): unknown }
const spawn = prototype.spawn
prototype.spawn = function(this: ChildProcess, options: { args?: Array<string> }) {
  const result = spawn.call(this, options)
  if (options.args?.includes("--remote-debugging-pipe")) {
    const child = this
    const launch: Launch = { pid: this.pid, spawnedAt: performance.now(), signalsSent: [] }
    current = launch
    const input = this.stdio[3] as Writable | null
    if (input !== null && input !== undefined) {
      const write = input.write
      input.write = function(this: Writable, ...args: Parameters<typeof write>) {
        const chunk = args[0]
        if (
          launch.closeSentAt === undefined &&
          (typeof chunk === "string" || chunk instanceof Uint8Array) &&
          Buffer.from(chunk).includes("\"Browser.close\"")
        ) {
          launch.closeSentAt = performance.now()
          const n = launchCount + 1
          setTimeout(() => {
            if (launch.exitedAt !== undefined || child.exitCode !== null || child.signalCode !== null) return
            if (slowCaptures >= 3) return
            slowCaptures++
            void captureSlowClose(launch, n)
          }, 3_000).unref()
        }
        return write.apply(this, args)
      } as typeof write
    }
    const output = this.stdio[4] as Readable | null
    if (output !== null && output !== undefined) {
      const emit = output.emit
      output.emit = function(event: string, ...values: Array<unknown>) {
        if (event === "data" && launch.firstReplyMs === undefined) {
          launch.firstReplyMs = round(performance.now() - launch.spawnedAt)
        }
        if ((event === "end" || event === "close") && launch.pipeClosedAt === undefined) {
          launch.pipeClosedAt = performance.now()
        }
        return emit.call(this, event, ...values)
      }
    }
    const kill = this.kill
    this.kill = function(this: ChildProcess, signal?: NodeJS.Signals | number) {
      launch.signalsSent.push({
        signal: String(signal ?? "SIGTERM"),
        atMs: round(performance.now() - (launch.closeSentAt ?? launch.spawnedAt))
      })
      return kill.call(this, signal)
    }
    this.once("exit", (code, signal) => {
      launch.exitedAt = performance.now()
      launch.exitCode = code
      launch.exitSignal = signal
      lastExitAt = launch.exitedAt
    })
  }
  return result
}

const census = (n: number, elapsedSeconds: number) => {
  let table = ""
  try {
    table = execFileSync("/bin/ps", ["-axo", "pid,ppid,stat,etime,command"], {
      timeout: 5_000,
      maxBuffer: 8 * 1024 * 1024
    })
      .toString()
  } catch (error) {
    table = `[${String(error)}]`
  }
  const rows = table.split("\n").slice(1).filter((line) => line.trim() !== "")
  const chrome = rows.filter((line) => /Chrome for Testing|chrome_crashpad_handler/.test(line))
  let profiles: number | string
  try {
    profiles = readdirSync(os.tmpdir()).filter((name) => name.startsWith("strider-chromium-")).length
  } catch (error) {
    profiles = String(error)
  }
  record({
    kind: "load",
    n,
    elapsedSeconds,
    loadavg: os.loadavg(),
    freeMemory: os.freemem(),
    processes: rows.length,
    chromeProcesses: chrome.length,
    chrome: chrome.slice(0, 40),
    profileDirectories: profiles,
    tmpdir: os.tmpdir()
  })
}
let launchCount = 0

const budgetMs = 40 * 60_000

describe("Chromium launch stress", () => {
  it.live("launches, navigates and closes back to back until one fails", () =>
    Effect.scoped(Effect.gen(function*() {
      const { origin } = yield* site
      const start = performance.now()
      record({ kind: "start", uptimeSeconds: os.uptime(), loadavg: os.loadavg(), cpus: os.cpus().length })
      census(0, 0)
      let launches = 0
      while (performance.now() - start < budgetMs) {
        const gapMs = lastExitAt === undefined ? undefined : Math.round((performance.now() - lastExitAt) * 10) / 10
        launchCount = launches
        const began = performance.now()
        const outcome = yield* Effect.scoped(Effect.gen(function*() {
          const info = (yield* Browser.Browser).info
          assertPinned("Chromium", info.version, chromium.version)
          const page = yield* Browser.newPage()
          yield* page.goto(`${origin}/hello`)
        })).pipe(Effect.provide(backend), Effect.result)
        launches++
        const launch = current
        const failed = outcome._tag === "Failure"
        record({
          kind: "launch",
          n: launches,
          pid: launch?.pid,
          gapAfterPreviousExitMs: gapMs,
          firstReplyMs: launch?.firstReplyMs ?? null,
          totalMs: Math.round(performance.now() - began),
          close: launch === undefined || launch.closeSentAt === undefined ? null : {
            sentAfterSpawnMs: round(launch.closeSentAt - launch.spawnedAt),
            pipeClosedMs: launch.pipeClosedAt === undefined ? null : round(launch.pipeClosedAt - launch.closeSentAt),
            exitedMs: launch.exitedAt === undefined ? null : round(launch.exitedAt - launch.closeSentAt),
            code: launch.exitCode ?? null,
            signal: launch.exitSignal ?? null,
            signalsSent: launch.signalsSent
          },
          ...(failed ? { failure: String(outcome.failure) } : {})
        })
        if (launches % 50 === 0 || failed) {
          census(launches, Math.round((performance.now() - start) / 1000))
        }
        if (failed) {
          // Leave the stall probe's commands time to finish writing before the case ends.
          yield* Effect.sleep("20 seconds")
          assert.fail(`Launch ${launches} failed: ${String(outcome.failure)}`)
        }
      }
      record({ kind: "end", launches, elapsedSeconds: Math.round((performance.now() - start) / 1000) })
    })), { timeout: budgetMs + 5 * 60_000 })
})
