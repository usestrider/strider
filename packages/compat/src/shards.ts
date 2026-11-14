/**
 * Shards for a run on CI: each browser's port files split into jobs of about `target` seconds, by the time each file
 * took last (`ledger/timings.json`), or an estimate from its case count where it hasn't run. Each job runs one
 * browser, so a file's launch is paid once per job, and the longest files are placed first, each in the least loaded
 * job (longest processing time first).
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { type BrowserName, type PortFile, type Run, scanPorts } from "./ledger.ts"
import { root } from "./upstream.ts"

export type Timings = Record<string, Partial<Record<BrowserName, number>>>

const timingsPath = path.join(root, "ledger/timings.json")

export const readTimings = (): Timings =>
  fs.existsSync(timingsPath) ? JSON.parse(fs.readFileSync(timingsPath, "utf8")) as Timings : {}

/** Seconds per case and per launch where a file has no recorded time: stock WebKit is the slowest. */
const estimate = { chromium: [1.5, 3], firefox: [2, 4], webkit: [3, 6] } as const

export const seconds = (timings: Timings, port: PortFile, browser: BrowserName) =>
  timings[port.path]?.[browser] ?? estimate[browser][1] + port.keys.length * estimate[browser][0]

export interface Shard {
  readonly browser: BrowserName
  readonly name: string
  readonly seconds: number
  /** Port files, separated by spaces, for the job's command line. */
  readonly files: string
}

export const plan = (options: {
  readonly browsers: ReadonlyArray<BrowserName>
  readonly target: number
  readonly maxPerBrowser: number
  readonly filter?: ReadonlyArray<string> | undefined
}): ReadonlyArray<Shard> => {
  const timings = readTimings()
  const ports = scanPorts().filter((port) =>
    options.filter === undefined || options.filter.length === 0 ||
    options.filter.some((glob) => path.matchesGlob(port.path, glob))
  )
  const shards: Array<Shard> = []
  for (const browser of options.browsers) {
    const files = ports.filter((port) => port.browsers.includes(browser))
      .map((port) => ({ path: port.path, seconds: seconds(timings, port, browser) }))
      .sort((a, b) => b.seconds - a.seconds || a.path.localeCompare(b.path))
    if (files.length === 0) continue
    const total = files.reduce((sum, file) => sum + file.seconds, 0)
    const count = Math.min(options.maxPerBrowser, files.length, Math.max(1, Math.ceil(total / options.target)))
    const bins = Array.from({ length: count }, () => ({ seconds: 0, files: [] as Array<string> }))
    for (const file of files) {
      const least = bins.reduce((best, bin) => bin.seconds < best.seconds ? bin : best)
      least.seconds += file.seconds
      least.files.push(file.path)
    }
    bins.forEach((bin, position) =>
      shards.push({
        browser,
        name: `${browser}-${position + 1}`,
        seconds: Math.round(bin.seconds),
        files: bin.files.sort().join(" ")
      })
    )
  }
  return shards
}

/** Record each file's time from runs, keeping earlier times for files the runs didn't include. */
export const updateTimings = (runs: ReadonlyArray<Run>) => {
  const timings = readTimings()
  for (const run of runs) {
    for (const file of run.files) {
      timings[file.portFile] = { ...timings[file.portFile], [file.browser]: Math.round(file.seconds * 10) / 10 }
    }
  }
  const sorted = Object.fromEntries(Object.entries(timings).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(timingsPath, JSON.stringify(sorted, null, 2) + "\n")
}
