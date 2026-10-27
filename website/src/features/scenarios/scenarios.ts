// The scenarios: complete programs, each run against a real browser by `pnpm scenarios`. Read from the code that
// runs, packages/scenarios/src/scenarios.ts: each program between its `#region <name>/strider` markers, and its
// title, description and result from the `scenarios` list. Nothing of the file runs here; a scenario without its
// program fails the build.
import { readFileSync } from "node:fs"

export interface Scenario {
  readonly name: string
  readonly title: string
  readonly description: string
  /** What the program returns when it passes */
  readonly expected: string
  /** The public demo site it drives, replayed from a recording; none for the local site */
  readonly recording: string | undefined
  /** The program, with the imports it needs */
  readonly code: string
  /** The modules' members it calls, each linked to the API reference */
  readonly uses: ReadonlyArray<{ readonly label: string; readonly href: string }>
}

/** The modules the programs import from `@usestrider/browser` */
const modules = [
  "Browser",
  "Dialog",
  "Expect",
  "FileInput",
  "Har",
  "NetworkResponse",
  "PageNavigation",
  "Popup",
  "Route"
]

/** A string property of one entry of the list: double-quoted, or a template without substitutions */
const property = (entry: string, key: string) => {
  const match = new RegExp(`\\b${key}:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|\`([^\`$]*)\`)`).exec(entry)
  if (match === null) return undefined
  return match[1] !== undefined ? JSON.parse(`"${match[1]}"`) as string : match[2]
}

// The program as it runs, named a scenario: in the source its name pairs it with its Playwright twin
const withImports = (code: string) => {
  const uses = (name: string) => new RegExp(`\\b${name}\\.`).test(code)
  const effect = ["Effect", "Schema"].filter(uses)
  const http = ["HttpIncomingMessage"].filter(uses)
  return [
    `import { ${modules.filter(uses).join(", ")} } from "@usestrider/browser"`,
    `import { ${effect.join(", ")} } from "effect"`,
    ...(http.length === 0 ? [] : [`import { ${http.join(", ")} } from "effect/http"`]),
    "",
    code.replace(/^const (\w+)Strider = /m, "const $1Scenario = ")
  ].join("\n")
}

const usesOf = (code: string) => {
  const seen = new Set<string>()
  for (const [, module, member] of code.matchAll(new RegExp(`\\b(${modules.join("|")})\\.(\\w+)`, "g"))) {
    seen.add(`${module}.${member}`)
  }
  return [...seen].map((label) => {
    const [module, member] = label.split(".") as [string, string]
    return { label, href: `/docs/api/browser/${module}#${member}` }
  })
}

let loaded: ReadonlyArray<Scenario> | undefined

export const scenarios = (): ReadonlyArray<Scenario> => {
  if (loaded !== undefined) return loaded
  const file = process.env["STRIDER_SCENARIOS_SOURCE"]
  if (file === undefined) throw new Error("STRIDER_SCENARIOS_SOURCE isn't set: astro.config.ts sets it")
  const source = readFileSync(file, "utf8")
  const programs = new Map(
    [...source.matchAll(/\/\/ #region ([\w-]+)\/strider\n([\s\S]*?)\n\/\/ #endregion/g)].map((
      [, name, code]
    ) => [name!, code!])
  )
  const list = source.slice(source.indexOf("export const scenarios"))
  const entries = [...list.slice(0, list.indexOf("\n]\n")).matchAll(/\n {2}\{\n([\s\S]*?)\n {2}\}/g)].map(([, e]) => e!)
  loaded = entries.map((entry) => {
    const name = property(entry, "name")
    const title = property(entry, "title")
    const description = property(entry, "description")
    const expected = property(entry, "expected")
    if (name === undefined || title === undefined || description === undefined || expected === undefined) {
      throw new Error(`A scenario in ${file} lacks a name, title, description or expected result:\n${entry}`)
    }
    const code = programs.get(name)
    if (code === undefined) {
      throw new Error(`The scenario ${name} has no program between #region ${name}/strider markers`)
    }
    return {
      name,
      title,
      description,
      expected,
      recording: property(entry, "recording"),
      code: withImports(code),
      uses: usesOf(code)
    }
  })
  if (loaded.length === 0) throw new Error(`No scenarios found in ${file}`)
  return loaded
}

export const scenarioRoute = (scenario: Scenario) => `/docs/scenarios/${scenario.name}`
