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
import { ChildProcess } from "node:child_process"
import { appendFileSync, mkdirSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Readable } from "node:stream"
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
  exitedAt?: number
}
let current: Launch | undefined
let lastExitAt: number | undefined
const prototype = ChildProcess.prototype as ChildProcess & { spawn(options: { args?: Array<string> }): unknown }
const spawn = prototype.spawn
prototype.spawn = function(this: ChildProcess, options: { args?: Array<string> }) {
  const result = spawn.call(this, options)
  if (options.args?.includes("--remote-debugging-pipe")) {
    const launch: Launch = { pid: this.pid, spawnedAt: performance.now() }
    current = launch
    const output = this.stdio[4] as Readable | null
    if (output !== null && output !== undefined) {
      const emit = output.emit
      output.emit = function(event: string, ...values: Array<unknown>) {
        if (event === "data" && launch.firstReplyMs === undefined) {
          launch.firstReplyMs = Math.round((performance.now() - launch.spawnedAt) * 10) / 10
        }
        return emit.call(this, event, ...values)
      }
    }
    this.once("exit", () => {
      launch.exitedAt = performance.now()
      lastExitAt = launch.exitedAt
    })
  }
  return result
}

const budgetMs = 40 * 60_000

describe("Chromium launch stress", () => {
  it.live("launches, navigates and closes back to back until one fails", () =>
    Effect.scoped(Effect.gen(function*() {
      const { origin } = yield* site
      const start = performance.now()
      record({ kind: "start", uptimeSeconds: os.uptime(), loadavg: os.loadavg(), cpus: os.cpus().length })
      let launches = 0
      while (performance.now() - start < budgetMs) {
        const gapMs = lastExitAt === undefined ? undefined : Math.round((performance.now() - lastExitAt) * 10) / 10
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
          ...(failed ? { failure: String(outcome.failure) } : {})
        })
        if (launches % 50 === 0 || failed) {
          record({
            kind: "load",
            n: launches,
            elapsedSeconds: Math.round((performance.now() - start) / 1000),
            loadavg: os.loadavg(),
            freeMemory: os.freemem()
          })
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
