import { parseArgs } from "node:util"

export const options = (args: Array<string>) => {
  const { values } = parseArgs({
    args,
    options: {
      runs: { type: "string", default: "20" },
      warmup: { type: "string", default: "3" },
      only: { type: "string" },
      output: { type: "string", default: ".data/benchmarks/latest.json" },
      "max-ratio": { type: "string", default: "1.10" },
      check: { type: "boolean", default: false },
      help: { type: "boolean", default: false }
    }
  })
  const runs = Number(values.runs)
  const warmup = Number(values.warmup)
  const maxRatio = Number(values["max-ratio"])
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer")
  if (!Number.isSafeInteger(warmup) || warmup < 0) throw new Error("--warmup must be a nonnegative integer")
  if (!Number.isFinite(maxRatio) || maxRatio <= 0) throw new Error("--max-ratio must be positive and finite")
  if (values.check && (runs < 20 || warmup < 3)) {
    throw new Error("--check requires at least 20 runs and 3 warmups; smaller runs are smoke checks only")
  }
  return { ...values, runs, warmup, maxRatio }
}

export const summarize = (samples: ReadonlyArray<number>) => {
  if (samples.length === 0 || samples.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new Error("Timing samples must be nonempty, finite and positive")
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
  const sd = samples.length < 2 ? 0 : Math.sqrt(
    samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (samples.length - 1)
  )
  return { median, mean, sd, p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!, min: sorted[0]! }
}

export const compare = (strider: ReadonlyArray<number>, playwright: ReadonlyArray<number>, maxRatio: number) => {
  if (strider.length !== playwright.length) throw new Error("Both libraries must have the same number of samples")
  const left = summarize(strider)
  const right = summarize(playwright)
  const ratio = left.median / right.median
  const differences = strider.map((value, i) => value - playwright[i]!)
  const mean = differences.reduce((sum, value) => sum + value, 0) / differences.length
  const sorted = [...differences].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const paired = {
    differences,
    median: sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!,
    mean,
    sd: differences.length < 2 ? 0 : Math.sqrt(
      differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (differences.length - 1)
    ),
    min: sorted[0]!,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    max: sorted[sorted.length - 1]!
  }
  return { strider: left, playwright: right, paired, ratio, passed: ratio <= maxRatio }
}

/** Alternating paired samples, never concurrent; warmups are checked but not retained. */
export const measure = async (
  run: { readonly strider: () => Promise<number>; readonly playwright: () => Promise<number> },
  runs: number,
  warmup: number
) => {
  const samples = { strider: [] as Array<number>, playwright: [] as Array<number> }
  for (let i = -warmup; i < runs; i++) {
    const order = i % 2 === 0 ? (["strider", "playwright"] as const) : (["playwright", "strider"] as const)
    for (const library of order) {
      const ms = await run[library]()
      if (!Number.isFinite(ms) || ms <= 0) throw new Error(`${library} returned an invalid timing: ${ms}`)
      if (i >= 0) samples[library].push(ms)
    }
  }
  return samples
}

export const elapsed = async <A>(run: () => Promise<A>) => {
  const start = performance.now()
  const value = await run()
  return { ms: performance.now() - start, value }
}
