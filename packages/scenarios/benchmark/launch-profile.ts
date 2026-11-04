// Diagnostic instrumentation only; launch-profile-hooks.mjs adds phase boundaries without changing behavior.
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import * as assert from "node:assert/strict"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import { type Browser as PlaywrightBrowser, type BrowserContext as PlaywrightContext, chromium } from "playwright-core"
import type * as Transport from "../../browser/src/protocol/Transport.ts"
import pins from "../../browser/test/integration/browsers.json" with { type: "json" }

const executablePath = process.env["STRIDER_CHROMIUM"]
assert.equal(process.env["STRIDER_ENVIRONMENT"], "nix-integration")
assert.ok(executablePath)
const output = path.resolve(process.argv[2] ?? ".data/benchmarks/launch-profile.json")
const runs = Number(process.argv[3] ?? 20)
const persistent = process.argv[4] === "persistent"
assert.ok(Number.isSafeInteger(runs) && runs > 0)
const root = path.resolve(import.meta.dirname, "../../..")
const require = createRequire(import.meta.url)
const playwrightRoot = path.dirname(require.resolve("playwright-core/package.json"))
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex")
const source = createHash("sha256")
for (const directory of ["packages/browser/src", "packages/scenarios/src"]) {
  for (const file of fs.readdirSync(path.join(root, directory), { recursive: true, encoding: "utf8" }).sort()) {
    if (file.endsWith(".ts")) {
      source.update(`${directory}/${file}\0`).update(fs.readFileSync(path.join(root, directory, file)))
    }
  }
}
source.update(fs.readFileSync(path.join(root, "pnpm-lock.yaml")))
type Event = { at: number; kind: string; name: string; data?: unknown }
type Sample = { library: string; index: number; events: Array<Event>; ms?: number; resources?: unknown }
const samples: Array<Sample> = []
let active: Sample | undefined
let started = 0
let gateDone: (() => void) | undefined
const event = (kind: string, name: string, data?: unknown) => {
  active?.events.push({ at: performance.now() - started, kind, name, ...(data === undefined ? {} : { data }) })
}
const trace = {
  mark: (name: string, data?: unknown) => {
    event("mark", name, data)
    if (name === "target.gate.end") gateDone?.()
  },
  waitForGate: () =>
    new Promise<void>((resolve, reject) => {
      if (active?.events.some((entry) => entry.name === "target.gate.end")) return resolve()
      const timer = setTimeout(() => {
        gateDone = undefined
        reject(new Error("Initial target gate did not finish"))
      }, 10_000)
      gateDone = () => {
        clearTimeout(timer)
        gateDone = undefined
        resolve()
      }
    }),
  wire: (direction: string, message: unknown) => event("wire", direction, message),
  transport: (transport: Transport.Transport): Transport.Transport => ({
    closed: transport.closed,
    send: (message) =>
      Effect.suspend(() => {
        trace.wire("send", JSON.parse(message))
        return transport.send(message)
      }),
    messages: transport.messages.pipe(Stream.map((message) => {
      trace.wire("receive", JSON.parse(message))
      return message
    }))
  })
}
;(globalThis as typeof globalThis & { __launchTrace: typeof trace }).__launchTrace = trace
const report = {
  kind: "instrumented-launch-diagnostic",
  startedAt: new Date().toISOString(),
  sourceHash: source.digest("hex"),
  instrumentationHash: hash(fs.readFileSync(import.meta.filename)),
  hookHash: hash(fs.readFileSync(path.join(import.meta.dirname, "launch-profile-hooks.mjs"))),
  playwrightBundleHash: hash(fs.readFileSync(path.join(playwrightRoot, "lib/coreBundle.js"))),
  environment: {
    node: process.version,
    playwright: require("playwright-core/package.json").version,
    chromium: pins.chromium.version,
    executablePath,
    cpu: os.cpus()[0]?.model,
    load: os.loadavg()
  },
  runs,
  persistent,
  warmup: 3,
  samples,
  status: "running",
  error: null as string | null
}
const save = () => {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n")
}
const makeRuntime = () =>
  ManagedRuntime.make(
    Chromium.layer({ executablePath, headless: true }).pipe(Layer.provideMerge(NodeServices.layer))
  )
try {
  for (let i = -3; i < runs; i++) {
    const right = persistent ? "playwright-persistent" : "playwright"
    const order = i % 2 === 0 ? ["strider", right] : [right, "strider"]
    for (const library of order) {
      active = { library, index: i, events: [] }
      started = performance.now()
      trace.mark("launch.start")
      if (library === "strider") {
        const runtime: ReturnType<typeof makeRuntime> = makeRuntime()
        // As in the uninstrumented runner, constructing ManagedRuntime is outside launch timing.
        started = performance.now()
        active.events = []
        trace.mark("launch.start")
        try {
          const browser: Browser.Browser = await runtime.runPromise(Browser.Browser)
          active.ms = performance.now() - started
          trace.mark("launch.available")
          assert.ok(browser.info.product.includes(pins.chromium.version))
          active.resources = { visiblePages: (await runtime.runPromise(browser.pages)).length }
          await trace.waitForGate()
          trace.mark("initial.gate.observed")
        } finally {
          await runtime.dispose()
        }
      } else {
        const context: PlaywrightContext | undefined = persistent
          ? await chromium.launchPersistentContext("", {
            executablePath,
            headless: true,
            timeout: 30_000,
            viewport: null
          })
          : undefined
        const browser: PlaywrightBrowser = context === undefined
          ? await chromium.launch({ executablePath, headless: true, timeout: 30_000 })
          : context.browser()!
        assert.ok(browser)
        active.ms = performance.now() - started
        trace.mark("launch.available")
        try {
          assert.equal(browser.version(), pins.chromium.version)
          const session = await browser.newBrowserCDPSession()
          const targets = await session.send("Target.getTargets")
          active.resources = { contexts: browser.contexts().length, targets: targets.targetInfos }
          await session.detach()
        } finally {
          await browser.close()
        }
      }
      assert.ok(active.events.some((entry) => entry.name === "spawn.args"), "Spawn hook did not execute")
      assert.ok(
        active.events.some((entry) => entry.name === (library === "strider" ? "browser.make.end" : "pw.adapter.start")),
        "Readiness hook did not execute"
      )
      samples.push(active)
      process.stdout.write(`${i} ${library}: ${active.ms!.toFixed(2)} ms\n`)
      active = undefined
      save()
    }
  }
  report.status = "completed"
} catch (error) {
  report.status = "error"
  if (active !== undefined) samples.push(active)
  report.error = error instanceof Error ? error.stack ?? error.message : String(error)
  throw error
} finally {
  save()
}
