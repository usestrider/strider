import { parseArgs } from "node:util"
import { chromiumArgs } from "../../../browser/src/internal/profiles.ts"

export const options = (args: Array<string>) => {
  const { values } = parseArgs({
    args,
    options: {
      runs: { type: "string", default: "20" },
      warmup: { type: "string", default: "3" },
      only: { type: "string" },
      "strider-profile": { type: "string", default: "automation" },
      "screenshot-surface": { type: "string", default: "default" },
      "strider-arg": { type: "string", multiple: true, default: [] },
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
  if (!["default", "off", "on"].includes(values["screenshot-surface"])) {
    throw new Error("--screenshot-surface must be default, off or on")
  }
  // A second disable-features switch replaces the profile's list in Chromium. Keep those defaults
  // fixed across off/on variants; only the selected screenshot feature may differ.
  if (!["automation", "concurrent"].includes(values["strider-profile"])) {
    throw new Error("--strider-profile must be automation or concurrent")
  }
  const striderProfile = values["strider-profile"] as "automation" | "concurrent"
  const disabled = chromiumArgs[striderProfile].filter((arg) => arg.startsWith("--disable-features="))
    .map((arg) => arg.slice("--disable-features=".length)).join(",")
  const surfaceArgs = values["screenshot-surface"] === "default" ? [] : [
    values["screenshot-surface"] === "on" ?
      "--enable-features=CDPScreenshotNewSurface" :
      `--disable-features=${disabled ? `${disabled},` : ""}CDPScreenshotNewSurface`
  ]
  return { ...values, runs, warmup, maxRatio, striderProfile, striderArgs: [...surfaceArgs, ...values["strider-arg"]] }
}

export const summarize = (samples: ReadonlyArray<number>) => {
  if (samples.length === 0 || samples.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new Error("Timing samples must be nonempty, finite and positive")
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
  return { median, p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!, min: sorted[0]! }
}

export const compare = (strider: ReadonlyArray<number>, playwright: ReadonlyArray<number>, maxRatio: number) => {
  if (strider.length !== playwright.length) throw new Error("Both libraries must have the same number of samples")
  const left = summarize(strider)
  const right = summarize(playwright)
  const ratio = left.median / right.median
  return { strider: left, playwright: right, ratio, passed: ratio <= maxRatio }
}

/** Alternating paired samples, never concurrent; warmups are checked but not retained. */
export const measure = async (
  run: { readonly strider: () => Promise<number>; readonly playwright: () => Promise<number> },
  runs: number,
  warmup: number
) => {
  type Library = "strider" | "playwright"
  const samples = {
    strider: [] as Array<number>,
    playwright: [] as Array<number>,
    observations: [] as Array<{
      pairIndex: number
      sequenceIndex: number
      library: Library
      position: number
      pairOrder: ReadonlyArray<Library>
      previousLibrary: Library | null
      previousPosition: number | null
      previousPairIndex: number | null
      ms: number
    }>
  }
  let previous: { library: Library; position: number; pairIndex: number } | undefined
  let sequenceIndex = 0
  for (let i = -warmup; i < runs; i++) {
    const order = i % 2 === 0 ? (["strider", "playwright"] as const) : (["playwright", "strider"] as const)
    for (const [position, library] of order.entries()) {
      const ms = await run[library]()
      if (!Number.isFinite(ms) || ms <= 0) throw new Error(`${library} returned an invalid timing: ${ms}`)
      if (i >= 0) {
        samples[library].push(ms)
        samples.observations.push({
          pairIndex: i,
          sequenceIndex,
          library,
          position,
          pairOrder: order,
          previousLibrary: previous?.library ?? null,
          previousPosition: previous?.position ?? null,
          previousPairIndex: previous?.pairIndex ?? null,
          ms
        })
      }
      previous = { library, position, pairIndex: i }
      sequenceIndex++
    }
  }
  return samples
}

export const elapsed = async <A>(run: () => Promise<A>) => {
  const start = performance.now()
  const value = await run()
  return { ms: performance.now() - start, value }
}
