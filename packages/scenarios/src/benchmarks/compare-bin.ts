import { execFileSync, fork } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parseArgs } from "node:util"
import { comparisonDeadline, type Message, workerMessages } from "./lifecycle.ts"
import { pairedInterval, rotation } from "./paired.ts"

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    head: { type: "string" },
    output: { type: "string" },
    workload: { type: "string", default: "bench" },
    only: { type: "string" },
    browser: { type: "string", default: "chromium" },
    runs: { type: "string", default: "20" }
  }
})
const runs = Number(values.runs)
if (!Number.isSafeInteger(runs) || runs < 4 || runs > 1000 || runs % 4 !== 0) {
  throw new Error("--runs must be a multiple of 4 between 4 and 1000")
}
if (values.browser !== "chromium") throw new Error("Paired comparisons currently support only pinned stock Chromium")
if (!["bench", "scenarios"].includes(values.workload)) throw new Error("--workload must be bench or scenarios")
if (!values.base || !values.head || !values.output) {
  throw new Error("--base, --head and --output are required directories")
}
if (values.workload === "scenarios" && !values.only) throw new Error("Scenario comparisons require --only NAME")
const output = path.resolve(values.output)
fs.mkdirSync(output, { recursive: true })
const samples: Array<Message & { role: string; sequence: number }> = []
const comparisons: Array<
  { name: string; headBase: ReturnType<typeof pairedInterval>; headPlaywright: ReturnType<typeof pairedInterval> }
> = []
const report = {
  status: "running",
  error: null as string | null,
  config: values,
  provenance: {} as Record<string, unknown>,
  environment: {
    node: process.version,
    cpus: os.cpus(),
    memory: os.totalmem(),
    kernel: os.release(),
    browser: process.env["STRIDER_CHROMIUM"] ?? null,
    browserHash: null as string | null,
    browserRealPath: null as string | null,
    browserVersion: null as string | null,
    integrationEnvironment: process.env["STRIDER_ENVIRONMENT"] ?? null
  },
  comparisons
}
const save = () => fs.writeFileSync(path.join(output, "comparison.json"), JSON.stringify(report, null, 2))
const children: Array<ReturnType<typeof fork>> = []
const inboxes: Array<ReturnType<typeof workerMessages>> = []
const deadline = comparisonDeadline((error) => {
  report.status = "failed"
  report.error ??= String(error)
  save()
  for (const inbox of inboxes) inbox.fail(error)
  for (const child of children) child.kill("SIGKILL")
})
save()
try {
  fs.mkdirSync(path.join(output, "driver/benchmarks"), { recursive: true })
  for (const file of ["compare-bin.ts", "paired.ts", "lifecycle.ts"]) {
    fs.copyFileSync(path.join(import.meta.dirname, file), path.join(output, "driver/benchmarks", file))
  }
  const roots = {
    driver: path.resolve(import.meta.dirname, "../../../.."),
    base: path.resolve(values.base),
    head: path.resolve(values.head)
  }
  const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex")
  const provenance = Object.fromEntries(
    Object.entries(roots).map(([role, root]) => {
      const files = ["pnpm-lock.yaml", "flake.lock", "flake.nix", "packages/browser/test/integration/browsers.json"]
      fs.mkdirSync(path.join(output, role), { recursive: true })
      for (const file of files) fs.copyFileSync(path.join(root, file), path.join(output, role, path.basename(file)))
      const source = createHash("sha256")
      for (const directory of ["packages/browser/src", "packages/scenarios/src"]) {
        const absolute = path.join(root, directory)
        for (const file of fs.readdirSync(absolute, { recursive: true, encoding: "utf8" }).sort()) {
          if (file.endsWith(".ts")) {
            source.update(`${directory}/${file}\0`).update(fs.readFileSync(path.join(absolute, file)))
          }
        }
      }
      return [role, {
        root,
        originalSourceHash: source.digest("hex"),
        files: Object.fromEntries(files.map((file) => [file, hash(path.join(root, file))]))
      }]
    })
  )
  report.provenance = provenance
  for (const role of ["base", "head"] as const) {
    for (const file of ["flake.lock", "flake.nix", "packages/browser/test/integration/browsers.json"]) {
      if (hash(path.join(roots[role], file)) !== hash(path.join(roots.driver, file))) {
        throw new Error(`Environment pin mismatch: ${role} ${file} differs from driver`)
      }
    }
  }
  const executable = process.env["STRIDER_CHROMIUM"]
  if (!executable) throw new Error("STRIDER_CHROMIUM must name the pinned browser executable")
  report.environment.browserRealPath = fs.realpathSync(executable)
  report.environment.browserHash = hash(report.environment.browserRealPath)
  if (process.env["STRIDER_ENVIRONMENT"] !== "nix-integration") {
    throw new Error("Paired comparisons require the driver Nix integration environment")
  }
  const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 30_000 }).trim()
  report.environment.browserVersion = version
  const pins = JSON.parse(
    fs.readFileSync(path.join(roots.driver, "packages/browser/test/integration/browsers.json"), "utf8")
  )
  if (!version.split(/\s+/).includes(pins.chromium.version)) {
    throw new Error(`Browser version mismatch: expected Chromium ${pins.chromium.version}, got ${version}`)
  }
  save()
  const workers = Object.fromEntries(
    Object.entries({ base: roots.base, head: roots.head }).map(([role, root]) => {
      // Overlay only the measurement driver. Imports resolve to this ref's own source and dependencies.
      const source = path.resolve(import.meta.dirname, "..")
      const target = path.join(root, "packages/scenarios/src")
      const files = values.workload === "bench"
        ? ["benchmarks/bin.ts", "benchmarks/measure.ts", "benchmarks/remote.ts", "benchmarks/cases.ts", "site.ts"]
        : [
          "bin.ts",
          "runner.ts",
          "benchmarks/remote.ts",
          "measure.ts",
          "report.ts",
          "scenarios.ts",
          "site.ts",
          "replay.ts"
        ]
      for (const file of files) {
        const bytes = fs.readFileSync(path.join(source, file))
        fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true })
        fs.writeFileSync(path.join(target, file), bytes)
        fs.mkdirSync(path.dirname(path.join(output, "driver", file)), { recursive: true })
        fs.writeFileSync(path.join(output, "driver", file), bytes)
      }
      const entry = values.workload === "bench" ? "benchmarks/bin.ts" : "bin.ts"
      const args = [
        "--runs",
        String(runs),
        "--output",
        path.join(output, role, values.workload === "bench" ? "report.json" : "run")
      ]
      if (values.only) args.push("--only", values.only)
      const log = fs.openSync(path.join(output, role, "worker.log"), "w")
      const child = fork(path.join(target, entry), args, {
        cwd: root,
        env: { ...process.env, STRIDER_PAIRED: "1" },
        stdio: ["ignore", log, log, "ipc"]
      })
      fs.closeSync(log)
      children.push(child)
      const inbox = workerMessages(child, role)
      inboxes.push(inbox)
      return [role, { child, ...inbox }]
    })
  ) as Record<
    "base" | "head",
    { child: ReturnType<typeof fork>; next: () => Promise<Message>; fail: (error: Error) => void }
  >
  while (true) {
    const [base, head] = await Promise.all([workers.base.next(), workers.head.next()])
    if (base.type === "exit" && head.type === "exit") break
    if (base.type !== "ready" || head.type !== "ready" || base.name !== head.name) {
      throw new Error("Workers selected different cases or exited early")
    }
    const start = samples.length
    const warmups = values.workload === "bench" ? 3 : 0
    for (let i = -warmups; i < runs; i++) {
      for (const role of rotation(i < 0 ? i + warmups : i)) {
        const [ref, library] = role.split(":") as ["base" | "head", "strider" | "playwright"]
        workers[ref].child.send({ library, repetition: i + 1, warmup: i < 0 }, (error) => {
          if (error) workers[ref].fail(error)
        })
        const sample = await workers[ref].next()
        if (
          sample.type !== "sample" || sample.name !== base.name || sample.library !== library ||
          !Number.isFinite(sample.ms) || sample.ms! <= 0
        ) throw new Error("Invalid sample response")
        const raw = { ...sample, role, sequence: samples.length }
        samples.push(raw)
        fs.appendFileSync(path.join(output, "samples.ndjson"), `${JSON.stringify(raw)}\n`)
      }
    }
    const timings = (role: string) => samples.slice(start).filter((s) => s.role === role && !s.warmup).map((s) => s.ms!)
    comparisons.push({
      name: base.name,
      headBase: pairedInterval(timings("head:strider"), timings("base:strider")),
      headPlaywright: pairedInterval(timings("head:strider"), timings("head:playwright"))
    })
    save()
    workers.base.child.send({ done: true }, (error) => {
      if (error) workers.base.fail(error)
    })
    workers.head.child.send({ done: true }, (error) => {
      if (error) workers.head.fail(error)
    })
  }
  if (comparisons.length === 0) throw new Error("No comparisons completed")
  report.status = "complete"
} catch (error) {
  report.status = "failed"
  report.error ??= String(deadline.failure(error))
  process.exitCode = 1
} finally {
  deadline.close()
  for (const child of children) child.kill()
  save()
  const format = (c: ReturnType<typeof pairedInterval>) =>
    `${c.ratio.toFixed(3)} [${c.low.toFixed(3)}, ${c.high.toFixed(3)}]`
  fs.writeFileSync(
    path.join(output, "summary.md"),
    [
      `Comparison status: **${report.status}**`,
      "",
      ...(report.status === "complete" ?
        [
          "| Case | Head/base (95% CI) | Head/Playwright (95% CI) |",
          "| --- | --- | --- |",
          ...comparisons.map((c) => `| ${c.name} | ${format(c.headBase)} | ${format(c.headPlaywright)} |`)
        ] :
        [`No valid comparison. ${report.error}. Raw partial evidence is retained.`]),
      ""
    ].join("\n")
  )
}
