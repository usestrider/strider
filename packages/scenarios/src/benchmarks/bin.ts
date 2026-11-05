import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, Deadline, LaunchProfile } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scope from "effect/Scope"
import * as assert from "node:assert/strict"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import { chromium } from "playwright-core"
import { start } from "../site.ts"
import { captureCases, cases as ordinaryCases, viewport } from "./cases.ts"
import { compare, elapsed, measure, options } from "./measure.ts"

const cases = [...ordinaryCases, ...captureCases]
const config = options(process.argv.slice(2))
const lifecycleNames = ["launch", "first-page", "shutdown", "page-lifecycle", "repeated-lifecycle"]
const networkNames = ["navigate", "resources", "response-body-small", "response-body-large"]
const names = ["network", "lifecycle", ...lifecycleNames, ...cases.map((entry) => entry.name)]
if (config.help) {
  process.stdout.write(`Usage: pnpm bench [options]
  --runs N          measured pairs per case (default 20)
  --warmup N        discarded pairs per case (default 3)
  --strider-profile NAME    Strider automation (default) or concurrent preset
  --screenshot-surface MODE  Strider-only experimental default/off/on feature override
  --strider-arg ARG          append a raw Strider launch argument (repeatable)
  --only NAME       one case: ${names.join(", ")}
  --output PATH     JSON report (default .data/benchmarks/latest.json); Markdown beside it
  --check           fail if any median exceeds the ratio limit (requires 20 runs / 3 warmups)
  --max-ratio N     Strider / Playwright median limit (default 1.10; 1 means parity)
`)
  process.exit(0)
}
if (config.only !== undefined && !names.includes(config.only)) throw new Error(`Unknown benchmark: ${config.only}`)
if (process.env["STRIDER_ENVIRONMENT"] !== "nix-integration" || !process.env["STRIDER_CHROMIUM"]) {
  throw new Error("Run `pnpm bench`, which enters the pinned Nix integration environment")
}
const executablePath = process.env["STRIDER_CHROMIUM"]
const root = path.resolve(import.meta.dirname, "../../../..")
const output = path.resolve(root, config.output)
if (!output.endsWith(".json")) throw new Error("--output must end in .json")
const require = createRequire(import.meta.url)
const pins = JSON.parse(
  fs.readFileSync(path.join(root, "packages/browser/test/integration/browsers.json"), "utf8")
) as {
  chromium: { version: string }
}

// Includes uncommitted source edits, and works in the integration shell without git.
const hash = createHash("sha256")
for (const directory of ["packages/browser/src", "packages/scenarios/src"]) {
  const absolute = path.join(root, directory)
  for (const file of fs.readdirSync(absolute, { recursive: true, encoding: "utf8" }).sort()) {
    if (!file.endsWith(".ts")) continue
    hash.update(`${directory}/${file}\0`).update(fs.readFileSync(path.join(absolute, file)))
  }
}
hash.update(fs.readFileSync(path.join(root, "pnpm-lock.yaml")))

const results: Array<{
  name: string
  description: string
  samples: Awaited<ReturnType<typeof measure>>
  comparison: ReturnType<typeof compare>
}> = []
const report = {
  schemaVersion: 2,
  launchArguments: [] as Array<
    { library: string; pid: number; argv: ReadonlyArray<string>; renderers: ReadonlyArray<ReadonlyArray<string>> }
  >,
  startedAt: new Date().toISOString(),
  sourceHash: hash.digest("hex"),
  environment: {
    node: process.version,
    playwright: (require("playwright-core/package.json") as { version: string }).version,
    chromium: pins.chromium.version,
    executablePath,
    platform: process.platform,
    arch: process.arch,
    kernel: os.release(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    loadAtStart: os.loadavg(),
    viewport
  },
  config,
  results,
  status: "running",
  error: null as string | null
}
const save = () => {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  const rows = results.map(({ name, comparison: c }) =>
    `| ${name} | ${c.strider.median.toFixed(2)} | ${c.playwright.median.toFixed(2)} | ${c.strider.p95.toFixed(2)} | ${
      c.playwright.p95.toFixed(2)
    } | ${c.ratio.toFixed(2)}× | ${c.passed ? "pass" : "over limit"} |`
  )
  fs.writeFileSync(
    output.replace(/\.json$/, ".md"),
    [
      "# Strider / Playwright benchmarks",
      "",
      `${report.startedAt}; status: ${report.status}. Chromium ${report.environment.chromium}; Playwright ${report.environment.playwright}; Node ${process.version}.`,
      "",
      `${config.runs} measured pairs after ${config.warmup} warmup pairs. Sequential, alternating order; milliseconds per sample. Median limit: ${config.maxRatio}×. Ratios below 1 favor Strider.`,
      "",
      "| Case | Strider median | Playwright median | Strider p95 | Playwright p95 | Ratio | Target |",
      "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
      ...rows,
      "",
      ...results.map((result) => `- **${result.name}:** ${result.description}.`),
      "",
      "Aggregate ratios describe these samples and may mix distinct modes; inspect observations by pair position and previous library before drawing an overhead conclusion.",
      "",
      "Operation cases use a fresh context and page for every sample; setup and cleanup are outside timing. Launch excludes shutdown; first-page excludes fresh launch and cleanup and can overlap setup of Strider’s initial page. Shutdown starts at Browser availability: Strider has an initial page whose setup can still be running, while Playwright nonpersistent launch has no targets. Strider disposes its scope and signals its process; Playwright uses browser.close(). These describe supported defaults with different resources, readiness and release paths. Page-lifecycle includes context/page creation and cleanup; repeated-lifecycle sums five cycles with page counts and context termination checked between timers. Default launch flags and actionability behavior belong to each library. Browser module imports are outside all timings. Raw samples and machine/source metadata are in the JSON report. These are wall-time comparisons, not statistical significance tests or measurements of CPU/memory use.",
      ...(report.error === null ? [] : ["", "```text", report.error, "```"]),
      ""
    ].join("\n")
  )
}

const chosen = (name: string) =>
  config.only === undefined || config.only === name || (config.only === "lifecycle" && lifecycleNames.includes(name)) ||
  (config.only === "network" && networkNames.includes(name))
const record = async (
  name: string,
  description: string,
  run: Parameters<typeof measure>[0]
) => {
  process.stdout.write(`${name} ... `)
  const samples = await measure(run, config.runs, config.warmup)
  const comparison = compare(samples.strider, samples.playwright, config.maxRatio)
  results.push({ name, description, samples, comparison })
  save()
  process.stdout.write(
    `${comparison.strider.median.toFixed(2)} / ${comparison.playwright.median.toFixed(2)} ms = ${
      comparison.ratio.toFixed(2)
    }×${comparison.passed ? "" : " (over limit)"}\n`
  )
}
// Linux /proc records actual browser arguments after launch, outside every operation timer.
// Keep generated profile paths: these are exact launch records, not reconstructed defaults.
const recordedPids = new Set<number>()
const captureArguments = (library: string) => {
  const processes: Array<{ pid: number; parent: number; argv: Array<string> }> = []
  const visit = (pid: number, parent: number) => {
    try {
      const argv = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean)
      if (path.basename(fs.readlinkSync(`/proc/${pid}/exe`)).includes("chromium")) processes.push({ pid, parent, argv })
      const children = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim()
      for (const child of children.split(/\s+/).filter(Boolean)) visit(Number(child), pid)
    } catch {
      // A child may have exited during this untimed snapshot.
    }
  }
  visit(process.pid, 0)
  const main = processes.filter((entry) =>
    entry.argv.includes("--remote-debugging-pipe") &&
    !entry.argv.some((arg) => arg.startsWith("--type=")) && !recordedPids.has(entry.pid)
  )
  assert.equal(main.length, 1, `Expected one newly launched ${library} browser`)
  const browser = main[0]!
  recordedPids.add(browser.pid)
  const descendants = new Set([browser.pid])
  for (const entry of processes) if (descendants.has(entry.parent)) descendants.add(entry.pid)
  report.launchArguments.push({
    library,
    pid: browser.pid,
    argv: browser.argv,
    renderers: processes.filter((entry) => descendants.has(entry.pid) && entry.argv.includes("--type=renderer")).map((
      entry
    ) => entry.argv)
  })
}
const makeRuntime = () =>
  ManagedRuntime.make(
    Chromium.layer({
      executablePath,
      headless: true,
      profile: LaunchProfile[config.striderProfile],
      args: config.striderArgs
    }).pipe(
      Layer.provideMerge(NodeServices.layer)
    )
  )
const launchPlaywright = () => chromium.launch({ executablePath, headless: true, timeout: 30_000 })
const pageOptions = { emulation: { viewport } }

try {
  if (chosen("launch")) {
    await record("launch", "Launch a browser and establish its automation connection, excluding shutdown", {
      strider: async () => {
        const runtime = makeRuntime()
        try {
          const sample = await elapsed(() => runtime.runPromise(Browser.Browser))
          assert.ok(sample.value.info.product.includes(pins.chromium.version))
          captureArguments("strider")
          return sample.ms
        } finally {
          await runtime.dispose()
        }
      },
      playwright: async () => {
        const sample = await elapsed(launchPlaywright)
        try {
          assert.equal(sample.value.version(), pins.chromium.version)
          captureArguments("playwright")
          return sample.ms
        } finally {
          await sample.value.close()
        }
      }
    })
  }
  for (const name of ["first-page", "shutdown"] as const) {
    if (!chosen(name)) continue
    await record(
      name,
      name === "first-page"
        ? "Acquire the first isolated context/page after Browser availability; launch and cleanup excluded; Strider initial-page setup may overlap"
        : "Shutdown after Browser availability; Strider signals its process with an initial page possibly still setting up; Playwright closes its browser with no targets; launch excluded",
      {
        strider: async () => {
          const runtime = makeRuntime()
          const scope = Scope.makeUnsafe()
          try {
            const browser = await runtime.runPromise(Browser.Browser)
            assert.ok(browser.info.product.includes(pins.chromium.version))
            if (name === "shutdown") return (await elapsed(() => runtime.dispose())).ms
            const sample = await elapsed(() =>
              runtime.runPromise(Browser.newPage(pageOptions).pipe(Scope.provide(scope)))
            )
            assert.equal(await runtime.runPromise(sample.value.evaluateInMainWorld(() => document.URL)), "about:blank")
            return sample.ms
          } finally {
            try {
              if (name !== "shutdown") await runtime.runPromise(Scope.close(scope, Exit.void))
            } finally {
              await runtime.dispose()
            }
          }
        },
        playwright: async () => {
          const browser = await launchPlaywright()
          try {
            assert.equal(browser.version(), pins.chromium.version)
            if (name === "shutdown") return (await elapsed(() => browser.close())).ms
            const sample = await elapsed(async () => {
              const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
              return context.newPage()
            })
            assert.equal(await sample.value.evaluate(() => document.URL), "about:blank")
            return sample.ms
          } finally {
            await browser.close()
          }
        }
      }
    )
  }
  if (config.only === undefined || !["launch", "first-page", "shutdown"].includes(config.only)) {
    const site = await start()
    try {
      const runtime = makeRuntime()
      try {
        const info = await runtime.runPromise(Browser.Browser)
        assert.ok(info.info.product.includes(pins.chromium.version))
        captureArguments("strider")
        const browser = await launchPlaywright()
        try {
          assert.equal(browser.version(), pins.chromium.version)
          captureArguments("playwright")
          if (chosen("page-lifecycle")) {
            await record("page-lifecycle", "Create and close an isolated context and page with a fixed viewport", {
              strider: async () => {
                const sample = await elapsed(() => runtime.runPromise(Effect.scoped(Browser.newPage(pageOptions))))
                return sample.ms
              },
              playwright: async () => {
                const sample = await elapsed(async () => {
                  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
                  try {
                    await context.newPage()
                  } finally {
                    await context.close()
                  }
                })
                return sample.ms
              }
            })
          }
          if (chosen("repeated-lifecycle")) {
            await record(
              "repeated-lifecycle",
              "Five sequential isolated context/page acquisitions and releases on a persistent browser; checks excluded",
              {
                strider: async () => {
                  const before = await runtime.runPromise(info.pages)
                  let ms = 0
                  for (let i = 0; i < 5; i++) {
                    const scope = Scope.makeUnsafe()
                    try {
                      const sample = await elapsed(() =>
                        runtime.runPromise(Browser.newPage(pageOptions).pipe(Scope.provide(scope)))
                      )
                      ms += sample.ms
                      assert.equal(
                        await runtime.runPromise(sample.value.evaluateInMainWorld(() => document.URL)),
                        "about:blank"
                      )
                      assert.equal((await runtime.runPromise(info.pages)).length, before.length + 1)
                      ms += (await elapsed(() => runtime.runPromise(Scope.close(scope, Exit.void)))).ms
                      await runtime.runPromise(sample.value.context.closed.pipe(Deadline.within("30 seconds")))
                      assert.equal((await runtime.runPromise(info.pages)).length, before.length)
                    } finally {
                      await runtime.runPromise(Scope.close(scope, Exit.void))
                    }
                  }
                  return ms
                },
                playwright: async () => {
                  const before = browser.contexts().length
                  let ms = 0
                  for (let i = 0; i < 5; i++) {
                    const sample = await elapsed(async () => {
                      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
                      try {
                        return { context, page: await context.newPage() }
                      } catch (error) {
                        await context.close()
                        throw error
                      }
                    })
                    ms += sample.ms
                    try {
                      assert.equal(await sample.value.page.evaluate(() => document.URL), "about:blank")
                      assert.equal(browser.contexts().length, before + 1)
                      assert.equal(sample.value.context.pages().length, 1)
                      ms += (await elapsed(() => sample.value.context.close())).ms
                      assert.equal(browser.contexts().length, before)
                      assert.equal(sample.value.context.pages().length, 0)
                    } finally {
                      await sample.value.context.close()
                    }
                  }
                  return ms
                }
              }
            )
          }
          for (const entry of cases.filter((entry) => chosen(entry.name))) {
            await record(entry.name, entry.description, {
              strider: () =>
                runtime.runPromise(Effect.scoped(Effect.gen(function*() {
                  const page = yield* Browser.newPage(pageOptions)
                  yield* page.goto(`${site.origin}${entry.fixture ?? "/benchmark"}`, { waitUntil: "load" })
                  if (entry.prepareStrider) yield* entry.prepareStrider(page)
                  const started = yield* Effect.sync(() => performance.now())
                  const value = yield* entry.strider(page, site.origin).pipe(Deadline.within("30 seconds"))
                  const ms = yield* Effect.sync(() => performance.now() - started)
                  entry.verify(value)
                  return ms
                }))),
              playwright: async () => {
                const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
                try {
                  context.setDefaultTimeout(30_000)
                  context.setDefaultNavigationTimeout(30_000)
                  const page = await context.newPage()
                  await page.goto(`${site.origin}${entry.fixture ?? "/benchmark"}`, { waitUntil: "load" })
                  if (entry.preparePlaywright) await entry.preparePlaywright(page)
                  const sample = await elapsed(() => entry.playwright(page, site.origin))
                  entry.verify(sample.value)
                  return sample.ms
                } finally {
                  await context.close()
                }
              }
            })
          }
        } finally {
          await browser.close()
        }
      } finally {
        await runtime.dispose()
      }
    } finally {
      await site.close()
    }
  }
  const overLimit = results.some((result) => !result.comparison.passed)
  report.status = overLimit ? "over-limit" : "passed"
  if (config.check && overLimit) process.exitCode = 1
} catch (error) {
  report.status = "error"
  report.error = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${report.error}\n`)
  process.exitCode = 1
} finally {
  save()
  process.stdout.write(`Reports: ${output} and ${output.replace(/\.json$/, ".md")}\n`)
}
