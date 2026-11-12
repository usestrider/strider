/** Diagnostic tooling only: disjoint marks around the existing callback operations. */
import * as assert from "node:assert/strict"

export const expectedPhases = [
  "context",
  ...Array.from({ length: 20 }, (_, i) => [`create:${i}`, `navigate:${i}`, `click:${i}`]).flat(),
  ...Array.from({ length: 20 }, (_, i) => `read:${i}`),
  "release"
]
export type Phase = { name: string; start: number; end: number }
export const reconcile = (phases: ReadonlyArray<Phase>, start: number, end: number) => {
  assert.deepEqual(phases.map((phase) => phase.name), expectedPhases, "Missing or reordered phases")
  let previous = start
  let sum = 0
  for (const phase of phases) {
    assert.ok(Number.isFinite(phase.start) && Number.isFinite(phase.end))
    assert.ok(phase.start >= previous && phase.end >= phase.start && phase.end <= end, "Overlapping phase")
    sum += phase.end - phase.start
    previous = phase.end
  }
  const total = end - start
  assert.ok(Number.isFinite(total) && total >= sum)
  return { total, sum, residual: total - sum }
}

export const instrument = (source: string, library: "strider" | "playwright") => {
  const start = source.indexOf(`// #region many-pages/${library}`)
  const end = source.indexOf("// #endregion", start)
  assert.ok(start >= 0 && end > start)
  let body = source.slice(start, end)
  const replace = (before: string, after: string) => {
    assert.equal(body.split(before).length, 2, `Diagnostic source boundary: ${before}`)
    body = body.replace(before, after)
  }
  const awaited = library === "strider" ? "yield*" : "await"
  const operations = library === "strider"
    ? [
      "Browser.newContext()",
      "context.newPage",
      "page.goto(`${origin}/benchmark`)",
      "page.getByRole(\"button\", { name: \"Increment\" }).click()"
    ]
    : [
      "browser.newContext()",
      "context.newPage()",
      "page.goto(`${origin}/benchmark`)",
      "page.getByRole(\"button\", { name: \"Increment\" }).click()"
    ]
  for (const [i, op] of operations.entries()) {
    const name = i === 0 ? "\"context\"" : `\`${["", "create", "navigate", "click"][i]}:\${i}\``
    const statement = i === 0
      ? `const context = ${awaited} ${op}`
      : i === 1
      ? `const page = ${awaited} ${op}`
      : `${awaited} ${op}`
    replace(statement, `phaseStart(${name}); ${statement}; phaseEnd()`)
  }
  const read = library === "strider"
    ? "yield* page.locator(\"#count\").readText"
    : "await page.locator(\"#count\").textContent()"
  replace(
    `for (const page of pages) values.push(${read})`,
    `for (const [i, page] of pages.entries()) { phaseStart(\`read:\${i}\`); values.push(${read}); phaseEnd() }`
  )
  if (library === "strider") replace("return values.join(\",\")", "phaseStart(\"release\"); return values.join(\",\")")
  else replace("await context.close()", "phaseStart(\"release\"); await context.close()")
  return source.slice(0, start) + body + source.slice(end)
}

let current: { start: number; phases: Array<Phase>; active?: { name: string; start: number } } | undefined
export const begin = () => {
  current = { start: performance.now(), phases: [] }
}
export const phaseStart = (name: string) => {
  if (current) current.active = { name, start: performance.now() }
}
export const phaseEnd = () => {
  if (current?.active) {
    current.phases.push({ ...current.active, end: performance.now() })
    delete current.active
  }
}
export const finish = (failed: boolean) => {
  if (!current) throw new Error("Missing callback start")
  if (current.active?.name === "release") phaseEnd()
  const end = performance.now()
  const record = { ...current, end, failed }
  const reconciliation = failed ? null : reconcile(record.phases, record.start, end)
  current = undefined
  return { ...record, reconciliation }
}

export const instrumentRunner = (source: string) => {
  const header = `import * as phaseFs from "node:fs"
import { begin, finish } from "./benchmarks/many-pages-phases.ts"
let phaseEnabled = false
const phaseRecords: Array<unknown> = []
const flushPhases = () => {
  for (const record of phaseRecords.splice(0)) phaseFs.appendFileSync(process.env.STRIDER_PHASE_OUTPUT!, JSON.stringify(record) + "\\n")
}
const phaseRun = async (run: () => Promise<string>) => {
  if (!phaseEnabled) return run()
  begin()
  let failed = true
  try { const value = await run(); failed = false; return value }
  finally {
    try { phaseRecords.push(finish(failed)) }
    catch (error) { phaseRecords.push({ ...finish(true), instrumentationError: String(error) }); throw error }
  }
}
`
  return header +
    source.replace(
      "log(`scenario ${scenario.name}`)",
      "phaseEnabled = scenario.name === \"many-pages\"; log(`scenario ${scenario.name}`)"
    ).replace("normalize(await run())", "normalize(await phaseRun(run))")
      .replace("    for (const library of libraries) {", "    flushPhases()\n    for (const library of libraries) {")
      .replaceAll(
        "const ms = performance.now() - started",
        "const ms = performance.now() - started\n        flushPhases()"
      )
}
