import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const directory = resolve(process.argv[2] ?? ".data/benchmarks/caller-capture")
const data = JSON.parse(readFileSync(`${directory}/raw.json`, "utf8"))
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (q) => sorted[Math.ceil(q * sorted.length) - 1]
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return {
    n: values.length,
    median: (sorted[Math.floor((values.length - 1) / 2)] + sorted[Math.floor(values.length / 2)]) / 2,
    p95: quantile(0.95),
    mean,
    sd: Math.sqrt(values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (values.length - 1)),
    min: sorted[0],
    max: sorted.at(-1)
  }
}
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length
// Deterministic percentile bootstrap of whole paired batches, never individual correlated calls.
let seed = 283
const interval = (values) => {
  const estimates = []
  for (let i = 0; i < 10000; i++) {
    const sample = values.map(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return values[Math.floor(seed / 4294967296 * values.length)]
    })
    estimates.push(stats(sample).median)
  }
  estimates.sort((a, b) => a - b)
  return [estimates[249], estimates[9749]]
}
const summary = []
// Older current/control runs have neither explicit comparisons nor reference fields.
const comparisons = data.comparisons ?? [["on", "named-off"], ["on", "off"]]
for (const action of ["url", "fn-url", "title", "count", "click"]) {
  for (const [reference, control] of comparisons) {
    const rows = data.raw.filter((row) =>
      row.action === action && (row.reference ?? "on") === reference && row.control === control
    )
    if (rows.length === 0) continue
    const on = rows.filter((row) => row.mode === reference)
    const off = rows.filter((row) => row.mode === control)
    const paired = on.map((row) => {
      const other = off.find((candidate) => candidate.pair === row.pair)
      const a = mean(row.timings)
      const b = mean(other.timings)
      return { pair: row.pair, ms: a - b, percent: 100 * (a - b) / b, sharePercent: 100 * (a - b) / a }
    })
    summary.push({
      action,
      reference,
      control,
      onMs: stats(on.flatMap((row) => row.timings)),
      controlMs: stats(off.flatMap((row) => row.timings)),
      medianPairedMsBootstrap95: interval(paired.map((pair) => pair.ms)),
      medianPairedPercentBootstrap95: interval(paired.map((pair) => pair.percent)),
      pairedMsByOrder: {
        onFirst: stats(paired.filter((pair) => pair.pair % 2 === 0).map((pair) => pair.ms)),
        controlFirst: stats(paired.filter((pair) => pair.pair % 2 !== 0).map((pair) => pair.ms))
      },
      pairedMs: stats(paired.map((pair) => pair.ms)),
      pairedPercent: stats(paired.map((pair) => pair.percent)),
      pairedSharePercent: stats(paired.map((pair) => pair.sharePercent)),
      paired
    })
  }
}
writeFileSync(`${directory}/summary.json`, JSON.stringify(summary, null, 2) + "\n")
for (const row of summary) {
  console.log(
    `${row.action} ${row.reference}/${row.control}: on median/p95 ${row.onMs.median.toFixed(6)}/${
      row.onMs.p95.toFixed(6)
    } ms; control ${row.controlMs.median.toFixed(6)}/${row.controlMs.p95.toFixed(6)} ms; paired median ${
      row.pairedMs.median.toFixed(6)
    } ms (${row.pairedPercent.median.toFixed(2)}%), SD ${row.pairedMs.sd.toFixed(6)} ms`
  )
}
