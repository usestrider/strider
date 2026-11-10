/**
 * `pnpm scenarios`: Strider and Playwright side by side on the integration environment's Chromium, printing
 * a single-run report. `pnpm scenarios:report` regenerates the combined `packages/scenarios/RESULTS.md`.
 *
 *   pnpm scenarios                 every scenario and measurement, 10 timed runs each
 *   pnpm scenarios --runs 3        fewer runs
 *   pnpm scenarios --only login    one scenario, and no measurements, printed: RESULTS.md keeps the full run
 *   pnpm scenarios --upload        upload the existing recordings and pin them, visiting no site
 *   pnpm scenarios --record        visit the public demo sites once, live, and record them for replay
 *
 * Nothing but `--record` sends a request beyond this machine: the demo sites are replayed from their recordings,
 * in `.data/scenarios/`, and a run without them fails, saying to record them. A Strider program visits its site as
 * a reader would, and the runner answers its requests from the recording (`replay.ts`); a Playwright twin routes
 * its own.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { Browser, Expect, Route, VideoWriter } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import { chromium, firefox as playwrightFirefox } from "playwright-core"
import { browserArgs, descendants, rendererCpu, type Stats, stats } from "./measure.ts"
import * as Recordings from "./recordings.ts"
import { recordingProblems, replaying } from "./replay.ts"
import { type Measurements, writeRunReport } from "./report.ts"
import { publish, runScenarios } from "./runner.ts"
import { type Files, recordings, scenarios, type StriderNeeds } from "./scenarios.ts"
import { start } from "./site.ts"

const argv = process.argv.slice(2)
const option = (name: string) => {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}
const runs = Number(option("--runs") ?? "10")
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer")
const engine = option("--browser") ?? "chromium"
if (engine !== "chromium" && engine !== "firefox") throw new Error("--browser must be chromium or firefox")
const output = option("--output")
const patchedFirefox = option("--playwright-firefox")
if (engine === "firefox" && patchedFirefox === undefined) {
  throw new Error("Firefox requires --playwright-firefox pointing to the provisioned patched executable")
}
const only = option("--only")

// The focused Q82 path uses the same fixture and profiler without requiring demo recordings.
if (argv.includes("--q82")) {
  const output = option("--output")
  if (output === undefined || !path.isAbsolute(output)) throw new Error("--q82 requires absolute --output")
  process.argv = [
    process.argv[0]!,
    process.argv[1]!,
    output,
    option("--mode") ?? "heavy-control",
    option("--workload") ?? "visibility",
    option("--order") ?? "forward"
  ]
  await import("../benchmark/observation-profile.ts")
  process.exit(0)
}

if (process.env["STRIDER_ENVIRONMENT"] !== "nix-integration" || process.env["STRIDER_CHROMIUM"] === undefined) {
  process.stderr.write("Run the scenarios with `pnpm scenarios`, which enters the integration environment.\n")
  process.exit(1)
}
const executablePath = process.env[engine === "firefox" ? "STRIDER_FIREFOX" : "STRIDER_CHROMIUM"]!
const playwrightType = engine === "firefox" ? playwrightFirefox : chromium
const playwrightOptions = { executablePath: engine === "firefox" ? patchedFirefox! : executablePath, headless: true }
const root = path.resolve(import.meta.dirname, "../../..")
const recordingsDirectory = path.join(root, ".data/scenarios")
fs.mkdirSync(recordingsDirectory, { recursive: true })
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-scenarios-"))
const files: Files = {
  temporary: (name) => path.join(temporary, name),
  recording: (name) => path.join(recordingsDirectory, `${name}.har`)
}

const ffmpeg = fs.realpathSync(process.env["STRIDER_FFMPEG"]!)
if (output !== undefined) {
  if (!path.isAbsolute(output) || output === root || output.startsWith(`${root}/`)) {
    throw new Error("--output must be absolute and outside the worktree")
  }
  fs.mkdirSync(output, { recursive: false })
  fs.writeFileSync(
    path.join(output, "start.json"),
    JSON.stringify(
      {
        started: new Date().toISOString(),
        argv,
        cwd: root,
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        release: os.release(),
        cpus: os.cpus(),
        memory: os.totalmem(),
        load: os.loadavg(),
        environment: Object.fromEntries(
          // By name, and never a credential: the output directory is retained, and the bucket's keys are STRIDER_ variables
          Object.entries(process.env).filter(([key]) =>
            /^(STRIDER_|FONTCONFIG_|ALSA_|LANG$|LC_|TZ$)/.test(key) &&
            !key.startsWith("STRIDER_RECORDINGS_") &&
            !/SECRET|TOKEN|PASSWORD|CREDENTIAL|KEY|AUTH/i.test(key)
          )
        )
      },
      null,
      2
    )
  )
  for (const file of ["bin.ts", "runner.ts", "report.ts", "scenarios.ts", "site.ts", "replay.ts", "measure.ts"]) {
    fs.copyFileSync(path.join(import.meta.dirname, file), path.join(output, file))
  }
  for (const file of ["flake.nix", "flake.lock", "pnpm-lock.yaml"]) {
    fs.copyFileSync(path.join(root, file), path.join(output, file))
  }
}
const selectedLayer = engine === "firefox"
  ? Firefox.layer({ executablePath }).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor))
  : Chromium.layer({ executablePath })
const layer = selectedLayer.pipe(
  Layer.provide(VideoWriter.layerFfmpeg({ path: ffmpeg })),
  Layer.provideMerge(NodeServices.layer)
)
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
const onAttempt = (scenario: string, sample: Measurements["scenarios"][number]["samples"][number]) => {
  if (output !== undefined) {
    fs.appendFileSync(path.join(output, "attempts.jsonl"), `${JSON.stringify({ scenario, ...sample })}\n`)
  }
}

// ── Recording the demo sites ──────────────────────────────────────────────────

// Pins the recordings already in .data/scenarios/, as measured, without visiting any site
if (argv.includes("--upload")) {
  const store = Recordings.storeFromEnvironment()
  if (store === undefined) {
    process.stderr.write(`--upload needs ${Recordings.credentialNames.join(", ")} (write access).\n`)
    process.exit(1)
  }
  try {
    Recordings.writeManifest(
      await Recordings.upload(Object.keys(recordings), {
        manifest: Recordings.readManifest(),
        file: files.recording,
        store
      })
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
  log("uploaded the existing recordings and updated packages/scenarios/recordings.json")
  process.exit(0)
}

if (argv.includes("--record")) {
  const runtime = ManagedRuntime.make(layer)
  for (const [name, record] of Object.entries(recordings)) {
    log(`recording ${name}, live`)
    await runtime.runPromise(Effect.scoped(record(files.recording(name))))
  }
  await runtime.dispose()
  const store = Recordings.storeFromEnvironment()
  if (store === undefined) {
    process.stderr.write(
      `Recorded, but not uploaded: set ${
        Recordings.credentialNames.join(", ")
      } (write access) to upload and update recordings.json.\n`
    )
    process.exit(1)
  }
  Recordings.writeManifest(
    await Recordings.upload(Object.keys(recordings), {
      manifest: Recordings.readManifest(),
      file: files.recording,
      store
    })
  )
  log("uploaded the recordings and updated packages/scenarios/recordings.json")
  log(`recorded into ${path.relative(root, recordingsDirectory)}`)
  process.exit(0)
}

const unsupported: Array<string> = engine === "firefox"
  ? [
    "video and video-firefox: no equivalent Playwright video twin; Chromium screencast and Firefox native capture perform different work",
    "Q82 renderer CPU, Q103 Fetch interception, and automation tells: Chromium-only diagnostics"
  ]
  : []
const selected = scenarios.filter((scenario) =>
  (only === undefined || scenario.name === only) &&
  (engine === "chromium" || (scenario.playwright !== undefined && scenario.browser === undefined))
)
if (selected.length === 0) throw new Error("No supported scenarios selected")
// Fetch what the manifest pins and the recordings directory lacks; the real-site scenarios whose recording can't be
// had are skipped, and say why
const ensured = await Recordings.ensure(
  [...new Set(selected.flatMap((scenario) => scenario.recording === undefined ? [] : [scenario.recording]))],
  { manifest: Recordings.readManifest(), file: files.recording, store: Recordings.storeFromEnvironment() }
).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
const chosen = selected.filter((scenario) =>
  scenario.recording === undefined || !ensured.unavailable.has(scenario.recording)
)
for (const scenario of selected) {
  const reason = scenario.recording === undefined ? undefined : ensured.unavailable.get(scenario.recording)
  if (reason !== undefined) {
    unsupported.push(`${scenario.name} skipped: ${reason}`)
    log(`skipped ${scenario.name}: ${reason}`)
  }
}
if (chosen.length === 0) throw new Error("Every selected scenario was skipped; see above")
if (process.env["STRIDER_PAIRED"] === "1" && chosen.some((scenario) => scenario.playwright === undefined)) {
  throw new Error("Paired scenario comparisons require a Playwright twin for every selected case")
}
const problems = recordingProblems(chosen, files.recording)
if (output !== undefined) {
  fs.writeFileSync(path.join(output, "recording-validation.json"), JSON.stringify({ problems }, null, 2))
}
if (problems.length > 0) {
  process.stderr.write(
    `${
      problems.join("\n")
    }\nPreserve and checksum the old recordings, then run \`pnpm scenarios --record\` to refresh them explicitly from the live sites (see packages/scenarios/README.md). Replay never falls back to the network.\n`
  )
  process.exit(1)
}

const site = await start()
const origin = site.origin

// ── Launch ────────────────────────────────────────────────────────────────────

const launchScenario = {
  name: "launch",
  title: "Launch, first page, and shutdown",
  description:
    "Launches a fresh browser, creates one page, loads and reads the local fixture, then closes the page/context and browser. Includes shutdown equally on both sides.",
  expected: "0"
} as typeof scenarios[number]
const launchResults = await runScenarios(
  [launchScenario],
  runs,
  () => ({
    strider: async () => {
      const runtime = ManagedRuntime.make(layer)
      try {
        return await runtime.runPromise(Effect.scoped(Effect.gen(function*() {
          const page = yield* Browser.newPage()
          yield* page.goto(`${origin}/benchmark`)
          return yield* page.locator("#count").readText
        })))
      } finally {
        await runtime.dispose()
      }
    },
    playwright: async () => {
      const browser = await playwrightType.launch(playwrightOptions)
      try {
        const page = await browser.newPage()
        try {
          await page.goto(`${origin}/benchmark`)
          return (await page.locator("#count").textContent()) ?? ""
        } finally {
          await page.close()
        }
      } finally {
        await browser.close()
      }
    }
  }),
  log,
  onAttempt
)
if (output !== undefined) fs.writeFileSync(path.join(output, "launch.json"), JSON.stringify(launchResults, null, 2))

// One browser each from here on
const before = browserPids()
const runtime = ManagedRuntime.make(layer)
const info = await runtime.runPromise(Effect.gen(function*() {
  return (yield* Browser.Browser).info
}))
const striderArgs = engine === "chromium"
  ? browserArgs()
  : descendants().find((proc) => proc.args.some((arg) => arg.startsWith("--remote-debugging-port")))?.args ?? []
const striderPids = browserPids()
const browser = await playwrightType.launch(playwrightOptions).catch(async (error: unknown) => {
  await runtime.dispose()
  await site.close()
  throw error
})
const playwrightProcesses = descendants().filter((proc) => !striderPids.has(proc.pid) && !before.has(proc.pid))
const playwrightArgs = engine === "chromium"
  ? playwrightProcesses.find((proc) => proc.args.includes("--remote-debugging-pipe"))?.args ?? []
  : playwrightProcesses.find((proc) => proc.args.includes("-juggler-pipe"))?.args ?? []
const pins = JSON.parse(fs.readFileSync(path.join(root, "packages/browser/test/integration/browsers.json"), "utf8"))
if (info.version !== pins[engine].version) {
  await browser.close()
  await runtime.dispose()
  await site.close()
  throw new Error(`Unexpected stock browser: ${info.product} ${info.version}`)
}
const playwrightPins = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(createRequire(import.meta.url).resolve("playwright-core/package.json")), "browsers.json"),
    "utf8"
  )
)
const playwrightPin = playwrightPins.browsers.find((entry: { name: string }) => entry.name === engine)
if (engine === "firefox" && browser.version() !== playwrightPin.browserVersion) {
  await browser.close()
  await runtime.dispose()
  await site.close()
  throw new Error(`Unexpected patched Firefox: ${browser.version()}`)
}
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

const results = await runScenarios(
  chosen,
  runs,
  (scenario) => ({
    strider: () => strider(scenario.strider(origin), scenario.browser, scenario.recording),
    playwright: scenario.playwright === undefined
      ? undefined
      : () => scenario.playwright!(browser, origin, files)
  }),
  log,
  onAttempt
)

// ── Q82: what an expectation waiting costs the page ──────────────────────────

const measured = only === undefined && engine === "chromium"
const waitMs = 3000
// The renderers' CPU time per second of wall time, while `run` runs
const cpuWhile = async (run: () => Promise<unknown>) => {
  const cpu = rendererCpu()
  const time = await elapsed(run)
  return ((rendererCpu() - cpu) / time) * 1000
}
const diagnosticFailures: Array<{ section: string; error: string }> = []
const diagnosticFailure = (section: string, error: unknown) => {
  const failure = { section, error: String(error) }
  diagnosticFailures.push(failure)
  log(`diagnostic ${section} failed: ${failure.error}`)
  if (output !== undefined) {
    fs.appendFileSync(path.join(output, "diagnostic-failures.jsonl"), `${JSON.stringify(failure)}\n`)
  }
}
const q82: Array<Measurements["q82"][number]> = []
if (measured) {
  try {
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
      for (let i = 0; i < samples; i++) {
        const value = await run()
        values.push(value)
        if (output !== undefined) {
          fs.appendFileSync(
            path.join(output, "diagnostics.jsonl"),
            `${JSON.stringify({ section: "Q82", label, repetition: i + 1, rendererCpuMsPerSecond: value })}\n`
          )
        }
      }
      q82.push({ label, cpu: stats(values) })
    }
  } catch (error) {
    diagnosticFailure("Q82", error)
  }
}

// ── Q103: what an interceptor installed costs a page's load ──────────────────

const q103: Array<Measurements["q103"][number]> = []
if (measured) {
  try {
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
        ["Strider, no user route (document challenge interception retained)", () => strider(striderLoad(false))],
        ["Strider, a route matching nothing on the page", () => strider(striderLoad(true))],
        ["Playwright, no route", () => playwrightLoad(false)],
        ["Playwright, a route matching nothing on the page", () => playwrightLoad(true)]
      ] as const
    ) {
      await run()
      const values: Array<number> = []
      for (let i = 0; i < runs; i++) {
        const value = await run()
        values.push(value)
        if (output !== undefined) {
          fs.appendFileSync(
            path.join(output, "diagnostics.jsonl"),
            `${JSON.stringify({ section: "Q103", label, repetition: i + 1, ms: value })}\n`
          )
        }
      }
      q103.push({ label, load: stats(values) })
    }
  } catch (error) {
    diagnosticFailure("Q103", error)
  }
}

// ── What each leaves for a page to see ────────────────────────────────────────

let tells: Measurements["tells"] = { strider: {}, playwright: {} }
if (measured) {
  try {
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
  } catch (error) {
    diagnosticFailure("tells", error)
  }
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
  strider: launchResults[0]!.times.strider,
  playwright: launchResults[0]!.times.playwright
}
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex")
const metadata = {
  diagnosticFailures,
  engine,
  stockExecutable: executablePath,
  playwrightOptions,
  launchArguments: { strider: striderArgs, playwright: playwrightArgs },
  stockInfo: info,
  executableHashes: {
    strider: hash(fs.realpathSync(executablePath)),
    playwright: hash(fs.realpathSync(playwrightOptions.executablePath))
  },
  patchedFirefoxBuild:
    engine === "firefox" && fs.existsSync(path.join(path.dirname(playwrightOptions.executablePath), "application.ini"))
      ? fs.readFileSync(path.join(path.dirname(playwrightOptions.executablePath), "application.ini"), "utf8")
      : undefined,
  stockVersion: info.version,
  playwrightVersion: browser.version(),
  playwrightBrowserPin: engine === "firefox"
    ? JSON.parse(
      fs.readFileSync(path.join(path.dirname(require.resolve("playwright-core/package.json")), "browsers.json"), "utf8")
    ).browsers.find((entry: { name: string }) => entry.name === "firefox")
    : undefined,
  sourceCommit: commit,
  sourceHashes: Object.fromEntries(
    ["bin.ts", "runner.ts", "report.ts", "scenarios.ts", "site.ts", "replay.ts", "measure.ts"].map((
      file
    ) => [file, hash(path.join(import.meta.dirname, file))])
  ),
  lockHash: hash(path.join(root, "pnpm-lock.yaml")),
  flakeHash: hash(path.join(root, "flake.lock")),
  recordings: Object.fromEntries(
    [...new Set(chosen.flatMap((scenario) => scenario.recording === undefined ? [] : [scenario.recording]))].map((
      name
    ) => [name, hash(files.recording(name))])
  ),
  environment: Object.fromEntries(
    ["STRIDER_ENVIRONMENT", "FONTCONFIG_FILE", "LANG", "LC_ALL", "TZ", "ALSA_CONFIG_PATH"].map((
      key
    ) => [key, process.env[key]])
  ),
  fairness: engine === "firefox"
    ? "Stock Firefox over BiDi versus Playwright-patched Firefox over Juggler: different versions and patches, not an isolated library comparison."
    : "Same pinned stock executable; each library retains its default launch arguments.",
  launchBoundary:
    "Fresh browser through verified first page and shutdown, one warmup then alternating pairs; no filesystem cache reset."
}
const measurements: Measurements = {
  metadata,
  unsupported,
  date: new Date().toISOString().slice(0, 10),
  machine: `${os.cpus()[0]?.model ?? "unknown CPU"}, ${os.cpus().length} threads, ${
    Math.round(os.totalmem() / 2 ** 30)
  } GiB, Linux ${os.release()}, load ${os.loadavg().map((load) => load.toFixed(1)).join(" ")} at the end`,
  node: process.version,
  browser: `${info.product} ${info.version}`,
  striderCommit: commit.slice(0, 7),
  playwright: (require("playwright-core/package.json") as { version: string }).version,
  runs,
  launch: launchStats,
  scenarios: [...launchResults, ...results],
  q82,
  q82WaitMs: waitMs,
  q103,
  tells,
  flags: { strider: striderArgs.slice(1), playwright: playwrightArgs.slice(1) },
  source: fs.readFileSync(path.join(import.meta.dirname, "scenarios.ts"), "utf8")
}
// A single browser run prints its report and can save an explicitly selected artifact directory.
// Only scenarios:report writes the checked-in combined report.
process.exitCode = publish([...launchResults, ...results], () => writeRunReport(measurements, output))

if (diagnosticFailures.length > 0) process.exitCode = 1
