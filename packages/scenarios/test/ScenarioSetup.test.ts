import * as fs from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import * as vm from "node:vm"
import { expect, it } from "vitest"
import { recordingProblems } from "../src/recordings.ts"
import { scenarios } from "../src/scenarios.ts"
import { selectScenarios, supportedOn } from "../src/selection.ts"

it("prepares a fresh scenario working directory before constructing browser layers", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-setup-"))
  try {
    // Execute the CLI's filesystem setup only, stopping before browser layers are constructed.
    // A fresh checkout has no ignored .data directory. No browser code runs in this regression.
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/bin.ts"), "utf8")
      .split("const selectedLayer =")[0]!
      .replace(/^import .*$/gm, "")
      .replaceAll("import.meta.dirname", JSON.stringify(path.join(root, "packages/scenarios/src")))
    const code = stripTypeScriptTypes(`${source}\nprocess.chdir(recordingsDirectory)`)
    const directory = path.join(root, ".data/scenarios")
    await vm.runInNewContext(`(async () => {${code}})()`, {
      fs,
      os: { ...os, tmpdir: () => root },
      path,
      chromium: {},
      process: {
        argv: ["node", "bin.ts", "--only", "login"],
        env: {
          STRIDER_ENVIRONMENT: "nix-integration",
          STRIDER_CHROMIUM: process.execPath,
          STRIDER_FFMPEG: process.execPath
        },
        chdir: (destination: string) => {
          expect(fs.statSync(destination).isDirectory()).toBe(true)
        }
      }
    })
    const recording = (name: string) => path.join(directory, `${name}.har`)
    expect(recordingProblems(scenarios.filter((scenario) => scenario.name === "login"), recording)).toEqual([])
    expect(recordingProblems(scenarios.filter((scenario) => scenario.name === "controls"), recording)).toEqual([
      `No recording at ${
        recording("the-internet")
      }; required page URLs: https://the-internet.herokuapp.com/dynamic_controls`
    ])
    expect(fs.readdirSync(directory)).toEqual([])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

it("excludes the Chromium-only emulated-focus scenario from a Firefox run", () => {
  // The runner's own selection, without launching either browser.
  const chosen = supportedOn(selectScenarios(scenarios, undefined, false), "firefox")
  expect(chosen.map((scenario) => scenario.name)).toContain("many-pages")
  expect(chosen.map((scenario) => scenario.name)).not.toContain("many-pages-emulated")
})

it("applies the Firefox exclusion in the scenario runner", () => {
  // Execute the runner's selection before recording fetch or browser startup. Calling the helper directly would
  // miss a runner that accidentally stopped using it.
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/bin.ts"), "utf8")
  const start = source.indexOf("const selected =")
  const end = source.indexOf("if (selected.length === 0)", start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  const chosen = vm.runInNewContext(`${stripTypeScriptTypes(source.slice(start, end))}\nselected`, {
    scenarios,
    selectScenarios,
    supportedOn,
    only: undefined,
    paired: false,
    engine: "firefox"
  }) as ReadonlyArray<{ readonly name: string }>
  expect(chosen.map((scenario) => scenario.name)).toContain("many-pages")
  expect(chosen.map((scenario) => scenario.name)).not.toContain("many-pages-emulated")
})

it("copies the scenario comparison driver into a benchmark checkout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-overlay-"))
  try {
    // Run the real overlay before it launches workers: no browser or benchmark timing is needed.
    const directory = path.resolve(import.meta.dirname, "../src/benchmarks")
    const source = fs.readFileSync(path.join(directory, "compare-bin.ts"), "utf8")
    const start = source.indexOf("const source = path.resolve(import.meta.dirname")
    const end = source.indexOf("const entry =", start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const code = source.slice(start, end).replaceAll("import.meta.dirname", JSON.stringify(directory))
    vm.runInNewContext(stripTypeScriptTypes(code), {
      fs,
      path,
      root,
      output: path.join(root, "evidence"),
      role: "base",
      values: { workload: "scenarios" },
      manyPagesMode: false
    })
    expect(fs.readFileSync(path.join(root, "packages/scenarios/src/bin.ts"), "utf8"))
      .toBe(fs.readFileSync(path.resolve(directory, "../bin.ts"), "utf8"))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
