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
import { retainNativeTrace } from "./native-launch-trace.ts"

const executablePath = process.env["STRIDER_CHROMIUM"]
assert.equal(process.env["STRIDER_ENVIRONMENT"], "nix-integration")
assert.ok(executablePath)
const output = path.resolve(process.argv[2] ?? ".data/benchmarks/launch-profile.json")
const runs = Number(process.argv[3] ?? 20)
assert.ok(process.argv[4] === undefined || process.argv[4] === "persistent", "Mode must be 'persistent' when provided")
assert.ok(process.argv.length <= 5, "Unexpected launch diagnostic arguments")
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
type Sample = {
  library: string
  index: number
  events: Array<Event>
  ms?: number
  resources?: unknown
  native?: Awaited<ReturnType<typeof retainNativeTrace>>
}
const native = process.env["STRIDER_LAUNCH_NATIVE"] === "1"
const control = process.env["STRIDER_LAUNCH_CONTROL"] === "1"
const nativeFile = () => path.join(path.dirname(output), "native", `${active!.library}-${active!.index}.json`)
const diagnosticArgs = (strider: boolean) => [
  ...(control && strider ? ["--disable-extensions"] : []),
  ...(native
    ? [
      "--trace-startup",
      "--trace-startup-format=json",
      "--trace-startup-duration=1",
      `--trace-startup-file=${nativeFile()}`
    ]
    : [])
]
const retain = async () => {
  if (!native || active === undefined || active.native !== undefined) return
  active.native = await retainNativeTrace(nativeFile(), active.events)
  save()
}
const requireNative = () => {
  if (native) assert.equal(active?.native?.status, "complete", active?.native?.error ?? "Missing native trace")
}
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
  timing:
    "Launch ends at Browser availability. Strider has an initial observed page whose setup may continue afterward; the diagnostic observes gate completion outside the launch timer. Playwright nonpersistent launch has no initial targets; persistent launch waits for default-context/page initialization. Cleanup is outside timing.",
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
  native,
  control: control
    ? "strider adds only --disable-extensions; diagnostic hypothesis: extension-system initialization contributes to startup"
    : null,
  warmup: 3,
  samples,
  status: "running",
  error: null as string | null
}
const save = () => {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(
    output,
    JSON.stringify(
      { ...report, samples: active === undefined || samples.includes(active) ? samples : [...samples, active] },
      null,
      2
    ) + "\n"
  )
}
const validateSample = (sample: Sample) => {
  const strider = sample.library === "strider"
  const phases = strider
    ? [
      "model.start",
      "model.sink.ready",
      "executable.start",
      "executable.end",
      "profile.start",
      "profile.end",
      "spawn.start",
      "spawn.end",
      "launcher.bookkeeping.end",
      "transport.start",
      "transport.end",
      "adapter.start",
      "client.ready",
      "version.ready",
      "contexts.start",
      "contexts.end",
      "downloads.start",
      "downloads.end",
      "autoattach.start",
      "autoattach.ack",
      "targets.drained",
      "adapter.end",
      "model.attach.start",
      "model.attach.end",
      "browser.make.start",
      "browser.make.end",
      "target.snapshot.start",
      "target.snapshot.end",
      "target.gate.end",
      "initial.gate.observed"
    ]
    : [
      "pw.profile.start",
      "pw.profile.end",
      "pw.spawn.start",
      "pw.spawn.end",
      "pw.transport.ready",
      "pw.adapter.start",
      sample.library === "playwright-persistent" ? "pw.persistent.ready" : "pw.adapter.end"
    ]
  const phase = (name: string) => {
    const entry = sample.events.find((entry) => entry.kind === "mark" && entry.name === name)
    assert.ok(entry !== undefined, `${sample.library}: missing phase mark ${name}`)
    assert.ok(Number.isFinite(entry.at) && entry.at >= 0, `${sample.library}: invalid phase mark ${name}`)
    return entry.at
  }
  for (const name of ["launch.start", "spawn.args", "launch.available", ...phases]) phase(name)
  assert.ok(sample.ms !== undefined && Number.isFinite(sample.ms) && sample.ms > 0, "Missing launch duration")
  const available = phase("launch.available")
  const wires = sample.events.filter((entry) => entry.kind === "wire").map((entry) => {
    assert.ok(typeof entry.data === "object" && entry.data !== null, "Invalid wire observation")
    return { ...entry, message: entry.data as Record<string, unknown> }
  })
  const roundTrip = (method: string, rootSession: boolean, through: number) => {
    const sent = wires.find((entry) =>
      entry.name === "send" && entry.at <= through &&
      entry.message["method"] === method && (entry.message["sessionId"] === undefined) === rootSession
    )
    assert.ok(sent !== undefined, `${sample.library}: missing protocol send ${method}`)
    assert.ok(typeof sent.message["id"] === "number", `${sample.library}: missing protocol id ${method}`)
    assert.ok(
      wires.some((entry) =>
        entry.name === "receive" && entry.at >= sent.at && entry.at <= through &&
        entry.message["id"] === sent.message["id"] && entry.message["sessionId"] === sent.message["sessionId"]
      ),
      `${sample.library}: missing protocol reply ${method}`
    )
  }
  for (const method of ["Browser.getVersion", "Target.setAutoAttach"]) roundTrip(method, true, available)
  if (strider) {
    for (const method of ["Target.getBrowserContexts", "Browser.setDownloadBehavior"]) {
      roundTrip(method, true, available)
    }
    const gate = phase("target.gate.end")
    for (
      const method of [
        "Page.enable",
        "Page.setLifecycleEventsEnabled",
        "Network.enable",
        "Page.getFrameTree",
        "Runtime.enable",
        "Target.setAutoAttach"
      ]
    ) {
      roundTrip(method, false, gate)
    }
  } else if (sample.library === "playwright-persistent") {
    roundTrip("Browser.setDownloadBehavior", true, available)
    // Playwright sends utility-world setup before availability but need not have its reply yet.
    assert.ok(
      wires.some((entry) =>
        entry.name === "send" && entry.at <= available &&
        entry.message["method"] === "Page.createIsolatedWorld" && entry.message["sessionId"] !== undefined
      ),
      `${sample.library}: missing protocol send Page.createIsolatedWorld`
    )
    for (const method of ["Page.enable", "Page.getFrameTree", "Runtime.enable"]) {
      roundTrip(method, false, available)
    }
  }
}

const makeRuntime = () =>
  ManagedRuntime.make(
    Chromium.layer({ executablePath, headless: true, args: diagnosticArgs(true) }).pipe(
      Layer.provideMerge(NodeServices.layer)
    )
  )
try {
  for (let i = -3; i < runs; i++) {
    const right = persistent ? "playwright-persistent" : "playwright"
    const order = i % 2 === 0 ? ["strider", right] : [right, "strider"]
    for (const library of order) {
      active = { library, index: i, events: [] }
      if (native) fs.mkdirSync(path.dirname(nativeFile()), { recursive: true })
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
          await retain()
          const pages = await runtime.runPromise(browser.pages)
          assert.equal(pages.length, 1)
          assert.equal(
            await runtime.runPromise(
              Effect.scoped(pages[0]!.inspect.pipe(Effect.flatMap((page) => page.evaluate(() => document.URL))))
            ),
            "about:blank"
          )
          trace.mark("diagnostic.initialPage.alive")
        } finally {
          try {
            await retain()
          } finally {
            await runtime.dispose()
          }
        }
      } else {
        const context: PlaywrightContext | undefined = persistent
          ? await chromium.launchPersistentContext("", {
            executablePath,
            headless: true,
            timeout: 30_000,
            args: diagnosticArgs(false),
            viewport: null
          })
          : undefined
        let browser: PlaywrightBrowser | undefined
        try {
          browser = context === undefined
            ? await chromium.launch({ executablePath, headless: true, timeout: 30_000, args: diagnosticArgs(false) })
            : context.browser() ?? undefined
          assert.ok(browser)
          active.ms = performance.now() - started
          trace.mark("launch.available")
          assert.equal(browser.version(), pins.chromium.version)
          const session = await browser.newBrowserCDPSession()
          const targets = await session.send("Target.getTargets")
          active.resources = { contexts: browser.contexts().length, targets: targets.targetInfos }
          await session.detach()
        } finally {
          try {
            await retain()
          } finally {
            if (context !== undefined) await context.close()
            else await browser?.close()
          }
        }
      }
      requireNative()
      validateSample(active)
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
