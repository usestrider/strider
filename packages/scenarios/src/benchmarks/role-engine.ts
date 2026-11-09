/** Same-page role-engine diagnostics, run only by the hosted benchmark workflow. */
import * as assert from "node:assert/strict"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { chromium } from "playwright-core"
import { pairedInterval } from "./paired.ts"

const focusable = (disabled: boolean, hoisted: boolean) => `
  const DISABLABLE_TAGS = new Set(["button", "fieldset", "input", "optgroup", "option", "select", "textarea"]);
  const NATIVE_FOCUSABLE_TAGS = new Set(["button", "details", "select", "textarea"]);
  const focusable = (element) => {
    const tag = element.localName;
    if (${
  disabled ? "(DISABLABLE_TAGS.has(tag) || tag.includes(\"-\")) && " : ""
}element.matches(":disabled")) return false;
    const tabindex = element.getAttribute("tabindex");
    return (tabindex !== null && HTML_INTEGER_PREFIX.test(tabindex)) ||
      ((tag === "a" || tag === "area") && element.hasAttribute("href")) ||
      ${
  hoisted ? "NATIVE_FOCUSABLE_TAGS.has(tag)" : "[\"button\", \"details\", \"select\", \"textarea\"].includes(tag)"
} ||
      (element instanceof HTMLInputElement && element.type !== "hidden") ||
      (element instanceof HTMLElement && element.isContentEditable);
  };
  `

const replaceFocus = (source: string, disabled: boolean, hoisted: boolean) => {
  const start = source.indexOf("const focusable =")
  const end = source.indexOf("// ARIA 1.2 global", start)
  assert.ok(start > 0 && end > start, "Current engine focus predicate boundary changed")
  return source.slice(0, start) + focusable(disabled, hoisted) + source.slice(end)
}

const replaceAttributes = (source: string) => {
  const start = source.indexOf("const presentationConflict =")
  const end = source.indexOf("// Only required structural children", start)
  assert.ok(start > 0 && end > start, "Current engine conflict predicate boundary changed")
  return source.slice(0, start) + `
  const GLOBAL_ARIA_NAMES = new Set(GLOBAL_ARIA);
  const presentationConflict = (element, implicit) => {
    if (focusable(element)) return true;
    for (const attribute of element.getAttributeNames()) {
      if (GLOBAL_ARIA_NAMES.has(attribute)) return true;
      if ((attribute === "aria-label" || attribute === "aria-labelledby") && !NAME_PROHIBITED.has(implicit ?? "")) return true;
      if (attribute === "aria-roledescription" && implicit !== "generic") return true;
    }
    return false;
  };
  ` + source.slice(end)
}

export const roleDiagnostic = async (options: {
  roots: { base: string; head: string; driver: string }
  output: string
  runs: number
}) => {
  const { roots, output, runs } = options
  const sources = await Promise.all([roots.base, roots.head, roots.driver].map(async (root) => {
    const module = await import(pathToFileURL(path.join(root, "packages/browser/src/internal/engine.ts")).href)
    return String(module.engine)
  }))
  const current = sources[1]!
  const candidate = replaceAttributes(replaceFocus(current, true, true))
  const optimizedKind = sources[2] === current ? "candidate" : "driver"
  const engines = [
    { name: "old", source: sources[0]! },
    { name: "current", source: current },
    { name: "disabled-only", source: replaceFocus(current, true, false) },
    { name: "tags-only", source: replaceFocus(current, false, true) },
    { name: "attributes-only", source: replaceAttributes(current) },
    { name: "optimized", source: optimizedKind === "candidate" ? candidate : sources[2]! }
  ]
  const fixtures = [
    {
      name: "focusable",
      html: Array.from({ length: 100 }, () => "<h3 role=\"none\" tabindex=\"0.5\">Item</h3>").join(""),
      role: "heading",
      old: 100,
      correct: 100
    },
    {
      name: "non-focusable",
      html: Array.from({ length: 100 }, () => "<h3 role=\"none\">Item</h3>").join(""),
      role: "heading",
      old: 0,
      correct: 0
    },
    {
      name: "list",
      html: `<ul role="none">${"<li>Item</li>".repeat(100)}</ul>`,
      role: "listitem",
      old: 100,
      correct: 0
    },
    {
      name: "table",
      html: `<table role="none"><tbody>${"<tr><td>Item</td></tr>".repeat(100)}</tbody></table>`,
      role: "cell",
      old: 100,
      correct: 0
    }
  ]
  const iterations = 100
  const samples: Array<
    {
      fixture: string
      variant: string
      repetition: number
      warmup: boolean
      ms: number
      count: number
      position: number
    }
  > = []
  const report = {
    status: "running",
    optimizedKind,
    runs,
    iterations,
    caches: "engine.run clears tree/role caches on every query",
    fixtures,
    engines: engines.map(({ name, source }) => ({ name, sha256: createHash("sha256").update(source).digest("hex") })),
    comparisons: [] as Array<
      {
        fixture: string
        variant: string
        oldEquivalent: boolean
        against: string
        interval: ReturnType<typeof pairedInterval>
      }
    >
  }
  const save = () => fs.writeFileSync(path.join(output, "role-diagnostic.json"), JSON.stringify(report, null, 2))
  engines.forEach(({ name, source }) => fs.writeFileSync(path.join(output, `${name}-engine.js`), source))
  fs.copyFileSync(import.meta.filename, path.join(output, "role-engine.ts"))
  save()
  const browser = await chromium.launch({
    executablePath: process.env.STRIDER_CHROMIUM!,
    headless: true,
    args: ["--no-sandbox"]
  })
  try {
    const page = await browser.newPage()
    const handle = await page.evaluateHandle(
      (sources) =>
        sources.map((source) =>
          new Function(`return (${source})(() => "")`)() as { run: (request: string) => Promise<string> }
        ),
      engines.map((engine) => engine.source)
    )
    for (const fixture of fixtures) {
      await page.setContent(fixture.html)
      for (let repetition = -3; repetition < runs; repetition++) {
        const rotation = (repetition + 3) % engines.length
        const order = Array.from({ length: engines.length }, (_, index) => (rotation + index) % engines.length)
        if (Math.floor((repetition + 3) / engines.length) % 2) order.reverse()
        for (const [position, variant] of order.entries()) {
          const observed = await handle.evaluate(async (engines, { variant, iterations, role }) => {
            const request = JSON.stringify({
              op: "count",
              steps: [{ _tag: "Role", role, name: null, includeHidden: true }]
            })
            let count = -1
            const started = performance.now()
            for (let i = 0; i < iterations; i++) {
              const response = JSON.parse(await engines[variant]!.run(request))
              if (response._tag !== "Count" || (i !== 0 && response.count !== count)) {
                throw new Error("Unstable role count")
              }
              count = response.count
            }
            return { ms: performance.now() - started, count }
          }, { variant, iterations, role: fixture.role })
          const sample = {
            fixture: fixture.name,
            variant: engines[variant]!.name,
            repetition,
            warmup: repetition < 0,
            position,
            ...observed
          }
          samples.push(sample)
          fs.appendFileSync(path.join(output, "role-samples.ndjson"), `${JSON.stringify(sample)}\n`)
          assert.equal(
            observed.count,
            variant === 0 ? fixture.old : fixture.correct,
            `${fixture.name}/${sample.variant}`
          )
          assert.ok(observed.ms > 0 && Number.isFinite(observed.ms))
        }
      }
      const timings = (variant: string) =>
        samples.filter((sample) => sample.fixture === fixture.name && sample.variant === variant && !sample.warmup).map(
          (sample) => sample.ms
        )
      if (fixture.old === fixture.correct) {
        report.comparisons.push({
          fixture: fixture.name,
          variant: "current",
          against: "old",
          oldEquivalent: true,
          interval: pairedInterval(timings("current"), timings("old"))
        })
      }
      for (const variant of engines.slice(2)) {
        report.comparisons.push({
          fixture: fixture.name,
          variant: variant.name,
          oldEquivalent: fixture.old === fixture.correct,
          against: "current",
          interval: pairedInterval(timings(variant.name), timings("current"))
        })
      }
      save()
    }
    report.status = "complete"
  } finally {
    await browser.close()
    if (report.status !== "complete") report.status = "failed"
    save()
    fs.writeFileSync(
      path.join(output, "role-summary.md"),
      [
        `Role diagnostic status: **${report.status}**; optimized source: ${optimizedKind}.`,
        "One page; interleaved engines; each query resets caches. 100 queries per batch. Same-page pairing still permits JIT, GC, thermal, scheduling and order effects.",
        "Old/current/optimized outputs are recorded in raw samples. Old list/table counts are incorrect: their timings are not equivalent-output speed comparisons. Current/optimized outputs must agree for every fixture.",
        "",
        "| Fixture | Variant/current (95% CI) | Original outputs equivalent? |",
        "| --- | --- | --- |",
        ...report.comparisons.map((row) =>
          `| ${row.fixture}: ${row.variant}/${row.against} | ${row.interval.ratio.toFixed(3)} [${
            row.interval.low.toFixed(3)
          }, ${row.interval.high.toFixed(3)}] | ${row.oldEquivalent} |`
        ),
        ""
      ].join("\n")
    )
  }
}
