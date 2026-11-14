/**
 * `pnpm compat:ledger <command>`: the ledger's tools. None of them runs a browser, and none runs anything from an
 * upstream checkout: they read its files.
 */
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseArgs } from "node:util"
import {
  type BrowserName,
  browserNames,
  check,
  compare,
  expectationFor,
  readExpectations,
  report,
  type Run,
  scanPorts
} from "./ledger.ts"
import { plan, updateTimings } from "./shards.ts"
import { indexCheckout, readIndex, readSources, root, source, writeIndex } from "./upstream.ts"

const help = `Usage: pnpm compat:ledger <command>

  index <source> <checkout>        Regenerate ledger/<source>.json from a checkout at the pinned revision
  vendor <source> <checkout> <asset>...
                                   Copy assets (paths under the source's asset directory) into sources/<source>/assets
  check                            Check the ledger: expectations, ports, and index agree
  status                           Count each source's tests: ported, expected, not ported
  todo <source> [<file glob>]      The tests not yet ported or classified, by file
  show <source> <key>              One upstream test: where it is, its annotations, its expectation, and its port
  report <run>... [--name N] [--fail-on-unexpected]
                                   Merge runs (directories or run.json files) and print their report
  shards [--browsers a,b] [--target S] [--max N] [--files glob]...
                                   Plan CI shards as a GitHub matrix (JSON)
  timings <run>...                 Record port files' times from runs in ledger/timings.json
`

const sha = (content: Buffer) => createHash("sha256").update(content).digest("hex")

const readRun = (location: string): Run => {
  const file = fs.statSync(location).isDirectory() ? path.join(location, "run.json") : location
  return JSON.parse(fs.readFileSync(file, "utf8")) as Run
}

const merge = (runs: ReadonlyArray<Run>, name?: string): Run => ({
  name: name ?? runs[0]?.name ?? "merged",
  date: runs.map((run) => run.date).sort().at(-1) ?? new Date().toISOString(),
  ...(runs[0]?.revision === undefined ? {} : { revision: runs[0].revision }),
  browsers: browserNames.filter((browser) => runs.some((run) => run.browsers.includes(browser))),
  results: runs.flatMap((run) => run.results),
  files: runs.flatMap((run) => run.files)
})

const [command, ...rest] = process.argv.slice(2)

switch (command) {
  case "index": {
    const [name, checkout] = rest
    if (name === undefined || checkout === undefined) throw new Error(help)
    const before = fs.existsSync(path.join(root, "ledger", `${name}.json`)) ? readIndex(name) : undefined
    const index = indexCheckout(name, path.resolve(checkout))
    writeIndex(index)
    const old = new Map(before?.tests.map((test) => [test.key, test]) ?? [])
    const ported = new Set(scanPorts().flatMap((port) => port.keys))
    const added = index.tests.filter((test) => !old.has(test.key))
    const changed = index.tests.filter((test) => old.has(test.key) && old.get(test.key)!.hash !== test.hash)
    const removed = [...old.keys()].filter((key) => !index.tests.some((test) => test.key === key))
    console.log(`${name}: ${index.tests.length} tests at ${index.revision}`)
    console.log(`  ${added.length} added, ${changed.length} changed, ${removed.length} removed`)
    for (const test of changed.filter((each) => ported.has(each.key))) {
      console.log(`  ported and changed upstream: ${test.key} (${test.file}:${test.line})`)
    }
    for (const key of removed.filter((each) => ported.has(each))) console.log(`  ported and removed upstream: ${key}`)
    break
  }
  case "vendor": {
    const [name, checkout, ...assets] = rest
    if (name === undefined || checkout === undefined || assets.length === 0) throw new Error(help)
    const pinned = source(name)
    if (pinned.assets === undefined) throw new Error(`${name} has no asset directory`)
    const directory = path.join(root, "sources", name)
    const manifestPath = path.join(directory, "assets.json")
    // Porters vendor at the same time: the manifest is read and rewritten under a lock, a directory made atomically
    const lock = path.join(directory, ".assets.lock")
    const started = Date.now()
    for (;;) {
      try {
        fs.mkdirSync(lock)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        if (Date.now() - started > 60_000) {
          throw new Error(`${lock} has been held for a minute: remove it if no vendor is running`)
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      }
    }
    process.on("exit", () => fs.rmSync(lock, { recursive: true, force: true }))
    const manifest: Record<string, string> = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      : {}
    for (const asset of assets) {
      const relative = path.posix.normalize(asset).replace(/^\/+/, "")
      if (relative.startsWith("..")) throw new Error(`${asset} is outside the asset directory`)
      const content = fs.readFileSync(path.join(checkout, pinned.assets, relative))
      const target = path.join(directory, "assets", relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content)
      manifest[relative] = sha(content)
      console.log(`vendored ${relative}`)
    }
    const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
    fs.writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + "\n")
    break
  }
  case "check": {
    const problems = check()
    for (const problem of problems) console.log(problem)
    console.log(problems.length === 0 ? "The ledger holds together." : `${problems.length} problems`)
    process.exitCode = problems.length === 0 ? 0 : 1
    break
  }
  case "status": {
    const expectations = readExpectations()
    const ports = scanPorts()
    for (const each of readSources().filter((candidate) => candidate.status === "indexed")) {
      const ported = new Set(ports.filter((port) => port.source === each.name).flatMap((port) => port.keys))
      const counts: Record<string, number> = { ported: 0, notPorted: 0 }
      for (const test of readIndex(each.name).tests) {
        const expectation = expectations.find((candidate) =>
          candidate.source === each.name && candidate.browsers === undefined &&
          candidate.status !== "fails" && expectationFor([candidate], each.name, test, "chromium") !== undefined
        )
        const key = ported.has(test.key) ? "ported" : expectation?.status ?? "notPorted"
        counts[key] = (counts[key] ?? 0) + 1
      }
      console.log(`${each.name}: ${Object.entries(counts).map(([key, count]) => `${count} ${key}`).join(", ")}`)
    }
    for (const planned of readSources().filter((candidate) => candidate.status === "planned")) {
      console.log(`${planned.name}: planned (${planned.repository})`)
    }
    break
  }
  case "todo": {
    const [name, glob] = rest
    if (name === undefined) throw new Error(help)
    const expectations = readExpectations()
    const ported = new Set(scanPorts().filter((port) => port.source === name).flatMap((port) => port.keys))
    const byFile = new Map<string, number>()
    for (const test of readIndex(name).tests) {
      if (glob !== undefined && !path.matchesGlob(test.file, glob)) continue
      if (ported.has(test.key)) continue
      const classified = expectations.some((candidate) =>
        candidate.source === name && candidate.browsers === undefined && candidate.status !== "fails" &&
        expectationFor([candidate], name, test, "chromium") !== undefined
      )
      if (!classified) byFile.set(test.file, (byFile.get(test.file) ?? 0) + 1)
    }
    for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`${count}\t${file}`)
    break
  }
  case "show": {
    const [name, key] = rest
    if (name === undefined || key === undefined) throw new Error(help)
    const test = readIndex(name).tests.find((candidate) => candidate.key === key)
    if (test === undefined) throw new Error(`${name} has no test ${key}`)
    console.log(JSON.stringify(test, null, 2))
    const fileAnnotations = readIndex(name).files[test.file]
    if (fileAnnotations !== undefined) console.log("file:", fileAnnotations.join("\n      "))
    for (const browser of browserNames) {
      const expectation = expectationFor(readExpectations(), name, test, browser)
      if (expectation !== undefined) console.log(`${browser}: ${expectation.status} (${expectation.reason})`)
    }
    const port = scanPorts().find((candidate) => candidate.source === name && candidate.keys.includes(key))
    console.log(port === undefined ? "not ported" : `ported in ${port.path}`)
    break
  }
  case "report": {
    const { positionals, values } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { name: { type: "string" }, "fail-on-unexpected": { type: "boolean" } }
    })
    const run = merge(positionals.map(readRun), values.name)
    const findings = compare(run)
    process.stdout.write(report(run, findings))
    const unexpected = findings.some((finding) =>
      finding.outcome === "failedUnexpectedly" || finding.outcome === "passedUnexpectedly"
    )
    if (values["fail-on-unexpected"] === true && unexpected) process.exitCode = 1
    break
  }
  case "shards": {
    const { values } = parseArgs({
      args: rest,
      options: {
        browsers: { type: "string", default: browserNames.join(",") },
        target: { type: "string", default: "900" },
        max: { type: "string", default: "8" },
        files: { type: "string", multiple: true }
      }
    })
    const browsers = values.browsers.split(",").map((each) => each.trim()).filter((each) => each !== "")
    for (const browser of browsers) {
      if (!browserNames.some((known) => known === browser)) throw new Error(`Unknown browser ${browser}`)
    }
    const include = plan({
      browsers: browsers as Array<BrowserName>,
      target: Number(values.target),
      maxPerBrowser: Number(values.max),
      filter: values.files
    })
    process.stdout.write(JSON.stringify({ include }) + "\n")
    break
  }
  case "timings": {
    if (rest.length === 0) throw new Error(help)
    updateTimings(rest.map(readRun))
    break
  }
  default:
    process.stdout.write(help)
    process.exitCode = command === undefined || command === "help" ? 0 : 1
}
