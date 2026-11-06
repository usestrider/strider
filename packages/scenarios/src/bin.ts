/**
 * `pnpm scenarios`: Strider and Playwright side by side on the integration environment's Chromium, writing
 * `packages/scenarios/RESULTS.md`.
 *
 *   pnpm scenarios                 every scenario and measurement, 10 timed runs each
 *   pnpm scenarios --runs 3        fewer runs
 *   pnpm scenarios --only login    one scenario, and no measurements, printed: RESULTS.md keeps the full run
 *   pnpm scenarios --record        visit the public demo sites once, live, and record them for replay
 *
 * Nothing but `--record` sends a request beyond this machine: the demo sites are replayed from their recordings,
 * in `.data/scenarios/`, and a run without them fails, saying to record them. A Strider program visits its site as
 * a reader would, and the runner answers its requests from the recording (`replay.ts`); a Playwright twin routes
 * its own.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { Browser, Expect, Route } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import { chromium } from "playwright-core"
import type * as Playwright from "playwright-core"
import { browserArgs, descendants, rendererCpu, type Stats, stats } from "./measure.ts"
import { replaying } from "./replay.ts"
import { type Measurements, report } from "./report.ts"
import { publish, runScenarios } from "./runner.ts"
import { type Files, recordings, scenarios, type StriderNeeds } from "./scenarios.ts"
import { start } from "./site.ts"

const argv = process.argv.slice(2)
const option = (name: string) => {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}
const runs = Number(option("--runs") ?? "10")
const only = option("--only")

if (process.env["STRIDER_ENVIRONMENT"] !== "nix-integration" || process.env["STRIDER_CHROMIUM"] === undefined) {
  process.stderr.write("Run the scenarios with `pnpm scenarios`, which enters the integration environment.\n")
  process.exit(1)
}
const executablePath = process.env["STRIDER_CHROMIUM"]
const root = path.resolve(import.meta.dirname, "../../..")
const recordingsDirectory = path.join(root, ".data/scenarios")
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-scenarios-"))
const files: Files = {
  temporary: (name) => path.join(temporary, name),
  recording: (name) => path.join(recordingsDirectory, `${name}.har`)
}

const layer = Chromium.layer({ executablePath }).pipe(Layer.provideMerge(NodeServices.layer))
const browserPids = () =>
  new Set(
    descendants().filter((proc) =>
      proc.args.some((arg) => arg.includes("chromium")) && !proc.args.join(" ").includes("--type=")
    )
      .map((proc) => proc.pid)
  )

const elapsed = async (run: () => Promise<unknown>) => {
  const started = performance.now()
  await run()
  return performance.now() - started
}

const log = (line: string) => process.stdout.write(`${line}\n`)

// ── Recording the demo sites ──────────────────────────────────────────────────

if (argv.includes("--record")) {
  fs.mkdirSync(recordingsDirectory, { recursive: true })
  const runtime = ManagedRuntime.make(layer)
  for (const [name, record] of Object.entries(recordings)) {
    log(`recording ${name}, live`)
    await runtime.runPromise(Effect.scoped(record(files.recording(name))))
  }
  await runtime.dispose()
  log(`recorded into ${path.relative(root, recordingsDirectory)}`)
  process.exit(0)
}

const chosen = scenarios.filter((scenario) => only === undefined || scenario.name === only)
const missing = chosen.flatMap((scenario) =>
  scenario.recording !== undefined && !fs.existsSync(files.recording(scenario.recording)) ? [scenario.recording] : []
)
if (missing.length > 0) {
  process.stderr.write(
    `No recording of ${missing.join(" and ")}: run \`pnpm scenarios --record\` once, which visits them live.\n`
  )
  process.exit(1)
}

const site = await start()
const origin = site.origin

// ── Launch ────────────────────────────────────────────────────────────────────

log("launch")
const launch = { strider: [] as Array<number>, playwright: [] as Array<number> }
for (let i = 0; i < Math.min(runs, 5); i++) {
  const runtime = ManagedRuntime.make(layer)
  launch.strider.push(
    await elapsed(() =>
      runtime.runPromise(Effect.scoped(Effect.flatMap(Browser.newPage(), (page) => page.goto(`${origin}/`))))
    )
  )
  await runtime.dispose()
  let browser: Playwright.Browser | undefined
  launch.playwright.push(
    await elapsed(async () => {
      browser = await chromium.launch({ executablePath })
      const page = await browser.newPage()
      await page.goto(`${origin}/`)
      await page.close()
    })
  )
  await browser?.close()
}

// One browser each from here on
const before = browserPids()
const runtime = ManagedRuntime.make(layer)
const info = await runtime.runPromise(Effect.gen(function*() {
  return (yield* Browser.Browser).info
}))
const striderArgs = browserArgs()
const striderPids = browserPids()
const browser = await chromium.launch({ executablePath })
const playwrightPid = [...browserPids()].find((pid) => !striderPids.has(pid) && !before.has(pid))
const playwrightArgs = descendants().find((proc) => proc.pid === playwrightPid)?.args ?? []
// A scenario that runs on Firefox, such as its video, gets the environment's Firefox, launched once it's needed
let firefoxRuntime: ManagedRuntime.ManagedRuntime<Browser.Browser | NodeServices.NodeServices, unknown> | undefined
const firefox = () =>
  firefoxRuntime ??= ManagedRuntime.make(
    Firefox.layer({ executablePath: process.env["STRIDER_FIREFOX"] ?? "" }).pipe(
      Layer.provide(NodeSocket.layerWebSocketConstructor),
      Layer.provideMerge(NodeServices.layer)
    )
  )
const strider = <A>(effect: Effect.Effect<A, unknown, StriderNeeds>, on?: "firefox", recording?: string) =>
  (on === "firefox" ? firefox() : runtime).runPromise(
    Effect.scoped(recording === undefined ? effect : replaying(effect, files.recording(recording)))
  )

// ── The scenarios ─────────────────────────────────────────────────────────────

// A program writes its files beside it, as a reader's would, which here is into `.data/scenarios/`
process.chdir(recordingsDirectory)

const results = await runScenarios(chosen, runs, (scenario) => ({
  strider: () => strider(scenario.strider(origin), scenario.browser, scenario.recording),
  playwright: scenario.playwright === undefined
    ? undefined
    : () => scenario.playwright!(browser, origin, files)
}), log)

// ── Q82: what an expectation waiting costs the page ──────────────────────────

const measured = only === undefined
const waitMs = 3000
// The renderers' CPU time per second of wall time, while `run` runs
const cpuWhile = async (run: () => Promise<unknown>) => {
  const cpu = rendererCpu()
  const time = await elapsed(run)
  return ((rendererCpu() - cpu) / time) * 1000
}
const q82: Array<Measurements["q82"][number]> = []
if (measured) {
  log("Q82")
  const heavy = `${origin}/heavy?after=${waitMs}`
  const samples = Math.max(3, Math.min(runs, 5))
  const striderCase = Effect.fnUntraced(function*(wait: boolean) {
    const page = yield* Browser.newPage()
    yield* page.goto(heavy, { waitUntil: "load" })
    const cpu = rendererCpu()
    const started = performance.now()
    yield* wait ? page.locator("#ready").pipe(Expect.toBeVisible) : Effect.sleep(`${waitMs} millis`)
    return ((rendererCpu() - cpu) / (performance.now() - started)) * 1000
  })
  const playwrightCase = async (wait: boolean) => {
    const page = await browser.newPage()
    try {
      await page.goto(heavy)
      return await cpuWhile(() => (wait ? page.locator("#ready").waitFor() : page.waitForTimeout(waitMs)))
    } finally {
      await page.close()
    }
  }
  for (
    const [label, run] of [
      ["Strider, idle", () => strider(striderCase(false))],
      ["Strider, `Expect.toBeVisible` waiting", () => strider(striderCase(true))],
      ["Playwright, idle", () => playwrightCase(false)],
      ["Playwright, `locator.waitFor()` waiting", () => playwrightCase(true)]
    ] as const
  ) {
    const values: Array<number> = []
    for (let i = 0; i < samples; i++) values.push(await run())
    q82.push({ label, cpu: stats(values) })
  }
}

// ── Q103: what an interceptor installed costs a page's load ──────────────────

const q103: Array<Measurements["q103"][number]> = []
if (measured) {
  log("Q103")
  const many = `${origin}/many?n=300`
  const never = `${origin}/never/**`
  const striderLoad = Effect.fnUntraced(function*(route: boolean) {
    const page = yield* Browser.newPage()
    if (route) yield* page.route(never, () => Route.abort())
    const started = performance.now()
    yield* page.goto(many, { waitUntil: "load" })
    return performance.now() - started
  })
  const playwrightLoad = async (route: boolean) => {
    const page = await browser.newPage()
    try {
      if (route) await page.route(never, (intercepted) => intercepted.abort())
      const started = performance.now()
      await page.goto(many, { waitUntil: "load" })
      return performance.now() - started
    } finally {
      await page.close()
    }
  }
  for (
    const [label, run] of [
      ["Strider, no route (its interceptor is always installed, Q103)", () => strider(striderLoad(false))],
      ["Strider, a route matching nothing on the page", () => strider(striderLoad(true))],
      ["Playwright, no route", () => playwrightLoad(false)],
      ["Playwright, a route matching nothing on the page", () => playwrightLoad(true)]
    ] as const
  ) {
    await run()
    const values: Array<number> = []
    for (let i = 0; i < runs; i++) values.push(await run())
    q103.push({ label, load: stats(values) })
  }
}

// ── What each leaves for a page to see ────────────────────────────────────────

let tells: Measurements["tells"] = { strider: {}, playwright: {} }
if (measured) {
  log("tells")
  type Tells = Record<string, unknown>
  const striderTells = await strider(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    yield* page.goto(`${origin}/tells`, { waitUntil: "load" })
    return yield* page.evaluateInMainWorld(() => (window as unknown as { tells: Promise<Tells> }).tells)
  }))
  const page = await browser.newPage()
  await page.goto(`${origin}/tells`)
  const playwrightTells = await page.evaluate(() => (window as unknown as { tells: Promise<Tells> }).tells)
  await page.close()
  tells = { strider: striderTells, playwright: playwrightTells }
}

await browser.close()
await runtime.dispose()
await firefoxRuntime?.dispose()
await site.close()
fs.rmSync(temporary, { recursive: true, force: true })

// ── The report ────────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url)
// Read from .git, since the integration environment has no git. In a worktree, .git is a file naming the worktree's
// own directory, which holds HEAD, while branches are in the repository's, which its commondir names
const dotGit = path.join(root, ".git")
const gitDir = fs.statSync(dotGit).isFile()
  ? path.resolve(root, fs.readFileSync(dotGit, "utf8").replace(/^gitdir: /, "").trim())
  : dotGit
const commonDir = fs.existsSync(path.join(gitDir, "commondir"))
  ? path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim())
  : gitDir
const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim()
const commit = head.startsWith("ref: ")
  ? (() => {
    const ref = head.slice(5)
    const loose = [gitDir, commonDir].map((dir) => path.join(dir, ref)).find((file) => fs.existsSync(file))
    if (loose !== undefined) return fs.readFileSync(loose, "utf8").trim()
    const packed = fs.readFileSync(path.join(commonDir, "packed-refs"), "utf8")
    return packed.split("\n").find((line) => line.endsWith(` ${ref}`))?.split(" ")[0] ?? "unknown"
  })()
  : head
const launchStats: { strider: Stats; playwright: Stats } = {
  strider: stats(launch.strider),
  playwright: stats(launch.playwright)
}
const written = report({
  date: new Date().toISOString().slice(0, 10),
  machine: `${os.cpus()[0]?.model ?? "unknown CPU"}, ${os.cpus().length} threads, ${
    Math.round(os.totalmem() / 2 ** 30)
  } GiB, Linux ${os.release()}, load ${os.loadavg().map((load) => load.toFixed(1)).join(" ")} at the end`,
  node: process.version,
  browser: info.product,
  striderCommit: commit.slice(0, 7),
  playwright: (require("playwright-core/package.json") as { version: string }).version,
  runs,
  launch: launchStats,
  scenarios: results,
  q82,
  q82WaitMs: waitMs,
  q103,
  tells,
  flags: { strider: striderArgs.slice(1), playwright: playwrightArgs.slice(1) },
  source: fs.readFileSync(path.join(import.meta.dirname, "scenarios.ts"), "utf8")
})
// One scenario is a check, printed; RESULTS.md is the full run's record
process.exitCode = publish(results, () => {
  if (only === undefined) {
    const out = path.join(import.meta.dirname, "../RESULTS.md")
    fs.writeFileSync(out, written)
    log(`wrote ${path.relative(root, out)}`)
  } else {
    process.stdout.write(written)
  }
})
