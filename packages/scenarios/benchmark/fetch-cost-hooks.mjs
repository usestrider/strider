// Opt-in diagnostic configurations, never a production option or activation implementation.
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { registerHooks } from "node:module"
const sources = {}
const observations = []
const arms = ["disabled", "document-auth", "current", "route", "document-no-auth", "unmatched"]
const outputIndex = process.argv.indexOf("--output")
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
if (!output?.endsWith(".json")) throw new Error("Fetch diagnostic requires an explicit --output JSON path")
const only = process.argv[process.argv.indexOf("--only") + 1]
if (only !== "resources") throw new Error("Fetch split diagnostic supports only resources")
const wireOutput = process.env.STRIDER_FETCH_CONFIG_WIRE
let active = { arm: "startup", pair: null }
globalThis.__fetchArm = "current"
globalThis.__fetchVerified = (value, hits = null) => {
  if (value !== 100) throw new Error(`Expected exactly 100 loaded uncached images, got ${value}`)
  if (globalThis.__fetchArm === "route" && (hits === null || hits < 101)) {
    throw new Error(`The real route must continue the document and all 100 images: ${hits}`)
  }
  globalThis.__fetchLastResult = { value, hits }
}
globalThis.__fetchRecordWire = (message, library = "strider") => {
  const decoded = typeof message === "string" ? JSON.parse(message) : message
  if (["Fetch.enable", "Fetch.disable", "Network.setCacheDisabled"].includes(decoded.method)) {
    fs.appendFileSync(wireOutput, JSON.stringify({ ...active, library, message: decoded }) + "\n")
  }
  return message
}
globalThis.__fetchRecordServer = (url, headers) => {
  fs.appendFileSync(wireOutput, JSON.stringify({ ...active, library: "server", url, headers }) + "\n")
}
globalThis.__fetchExperiment = async (name, run, runs, warmup) => {
  if (!wireOutput && (runs < 20 || warmup < 3)) throw new Error("Timings require 20 runs and 3 warmups")
  const samples = { strider: [], playwright: [] }
  for (let pair = -warmup; pair < runs; pair++) {
    const offset = ((pair % arms.length) + arms.length) % arms.length
    const rotated = [...arms.slice(offset), ...arms.slice(0, offset)]
    const order = rotated.flatMap((arm) => [arm, `pw-${arm}`])
    if (pair % 2 !== 0) order.reverse()
    for (const arm of order) {
      active = { arm, pair }
      globalThis.__fetchArm = arm.startsWith("pw-") ? "playwright" : arm
      globalThis.__fetchLastResult = undefined
      const ms = await run[arm.startsWith("pw-") ? "playwright" : "strider"]()
      if (!Number.isFinite(ms) || ms <= 0 || globalThis.__fetchLastResult?.value !== 100) {
        throw new Error("Invalid timing or missing exact result verification")
      }
      observations.push({ name, pair, arm, order, ms, ...globalThis.__fetchLastResult })
      if (pair >= 0 && arm === "current") samples.strider.push(ms)
      if (pair >= 0 && arm === "pw-current") samples.playwright.push(ms)
    }
  }
  return samples
}
const rules = [
  ["/internal/cdpAdapter/declare.ts", [[
    `  yield* Fetch.enable({
    patterns: effective,
    handleAuthRequests: intercepts.auth.length > 0 || challenges || proxyAuth
  }).pipe(on)`,
    `  const diagnosticArm = globalThis.__fetchArm
  if (proxyAuth || intercepts.auth.length || intercepts.response.length || (intercepts.request.length && diagnosticArm !== 'route')) throw new Error('Fetch diagnostic refuses unexpected consumers')
  if (diagnosticArm === 'disabled') {
    yield* Fetch.disable().pipe(on)
  } else {
    const documentPattern = [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }]
    const diagnosticPatterns = diagnosticArm === 'document-auth' || diagnosticArm === 'document-no-auth'
      ? documentPattern
      : diagnosticArm === 'unmatched' ? [{ urlPattern: nothing, requestStage: 'Request' }] : effective
    yield* Fetch.enable({
      patterns: diagnosticPatterns,
      handleAuthRequests: diagnosticArm === 'document-no-auth' || diagnosticArm === 'unmatched' ? false : intercepts.auth.length > 0 || challenges || proxyAuth
    }).pipe(on)
  }`
  ]]],
  ["/src/benchmarks/bin.ts", [
    ["import { Browser, Deadline, LaunchProfile }", "import { Browser, Deadline, LaunchProfile, Route }"],
    [
      "const samples = await measure(run, config.runs, config.warmup)",
      "const samples = await globalThis.__fetchExperiment(name, run, config.runs, config.warmup)"
    ],
    [
      "const page = yield* Browser.newPage(pageOptions)\n                  yield* page.goto",
      "const page = yield* Browser.newPage(pageOptions)\n                  const diagnosticRoute = globalThis.__fetchArm === 'route' ? yield* page.route(`${site.origin}/**`, () => Route.continue) : undefined\n                  yield* page.goto"
    ],
    [
      "entry.verify(value)",
      "entry.verify(value)\n                  globalThis.__fetchVerified(value, diagnosticRoute ? yield* diagnosticRoute.hits : null)"
    ],
    [
      "entry.verify(sample.value)",
      "entry.verify(sample.value)\n                  globalThis.__fetchVerified(sample.value)"
    ]
  ]]
]
// Actual encoded commands, only in a separate diagnostic run. No wire observer is loaded for timings.
if (wireOutput) {
  rules.push(["/internal/protocolClient.ts", [[
    "write: transport.send(wire.encode(entry.id, method, encoded, state.key)).pipe(",
    "write: transport.send(globalThis.__fetchRecordWire(wire.encode(entry.id, method, encoded, state.key))).pipe("
  ]]])
  rules.push(["/src/site.ts", [[
    "response.writeHead(200, { \"content-type\": \"image/png\", \"cache-control\": \"no-store\" })",
    "globalThis.__fetchRecordServer(url.pathname, { \"content-type\": \"image/png\", \"cache-control\": \"no-store\" }); response.writeHead(200, { \"content-type\": \"image/png\", \"cache-control\": \"no-store\" })"
  ]]])
  rules.push(["/playwright-core/lib/coreBundle.js", [[
    "      _rawSend(sessionId, method2, params2) {",
    "      _rawSend(sessionId, method2, params2) { globalThis.__fetchRecordWire({ sessionId, method: method2, params: params2 }, 'playwright');"
  ]]])
}
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    const rule = rules.find(([suffix]) => url.endsWith(suffix))
    if (!rule) return result
    let source = String(result.source)
    sources[url] = createHash("sha256").update(source).digest("hex")
    for (const [before, after] of rule[1]) {
      if (source.split(before).length !== 2) throw new Error(`Expected one transform site: ${url}: ${before}`)
      source = source.replace(before, after)
    }
    return { ...result, source }
  }
})
process.on("exit", () => {
  fs.writeFileSync(
    output.replace(/\.json$/, ".arms.json"),
    JSON.stringify(
      {
        mode: wireOutput ? "wire-diagnostic" : "timing",
        loaderHash: createHash("sha256").update(fs.readFileSync(new URL(import.meta.url))).digest("hex"),
        sources,
        arms,
        observations
      },
      null,
      2
    )
  )
  if (Object.keys(sources).length !== rules.length) process.exitCode = 1
})
