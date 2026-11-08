// Diagnostic only: remove Fetch for route-free pages, including the default document-auth consumer.
// This deliberately changes auth handling and is not a production candidate.
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { registerHooks } from "node:module"
const sources = {}
const observations = []
const outputIndex = process.argv.indexOf("--output")
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
if (!output?.endsWith(".json")) throw new Error("Fetch diagnostic requires an explicit --output JSON path")
const only = process.argv[process.argv.indexOf("--only") + 1]
if (!["navigate", "resources"].includes(only)) throw new Error("Fetch diagnostic supports only navigate or resources")
globalThis.__fetchDisabled = false
globalThis.__fetchExperiment = async (name, run, runs, warmup) => {
  const samples = { strider: [], playwright: [] }
  for (let pair = -warmup; pair < runs; pair++) {
    const order = pair % 2 === 0
      ? ["current", "pw-current", "disabled", "pw-disabled"]
      : ["pw-disabled", "disabled", "pw-current", "current"]
    for (const arm of order) {
      globalThis.__fetchDisabled = arm === "disabled"
      const ms = await run[arm.startsWith("pw-") ? "playwright" : "strider"]()
      if (!Number.isFinite(ms) || ms <= 0) throw Error("invalid sample")
      observations.push({ name, pair, arm, order, ms })
      if (pair >= 0 && arm === "current") samples.strider.push(ms)
      if (pair >= 0 && arm === "pw-current") samples.playwright.push(ms)
    }
  }
  return samples
}
const rules = [
  [
    "/internal/cdpAdapter/declare.ts",
    "  yield* Fetch.enable({\n    patterns: effective,",
    `  if (globalThis.__fetchDisabled) {
    if (intercepts.request.length || intercepts.response.length || intercepts.auth.length || proxyAuth) throw new Error('diagnostic requires no user interception')
    yield* Fetch.disable().pipe(on)
  } else yield* Fetch.enable({
    patterns: effective,`
  ],
  [
    "/src/benchmarks/bin.ts",
    "const samples = await measure(run, config.runs, config.warmup)",
    "const samples = await globalThis.__fetchExperiment(name, run, config.runs, config.warmup)"
  ]
]
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    const rule = rules.find(([suffix]) => url.endsWith(suffix))
    if (!rule) return result
    const source = String(result.source)
    if (source.split(rule[1]).length !== 2) throw Error(`expected one transform site: ${url}`)
    sources[url] = createHash("sha256").update(source).digest("hex")
    return { ...result, source: source.replace(rule[1], rule[2]) }
  }
})
process.on("exit", () => {
  fs.writeFileSync(output.replace(/\.json$/, ".arms.json"), JSON.stringify({ sources, observations }, null, 2))
  if (Object.keys(sources).length !== 2) process.exitCode = 1
})
