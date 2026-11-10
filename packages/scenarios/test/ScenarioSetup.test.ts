import * as fs from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import * as vm from "node:vm"
import { expect, it } from "vitest"
import { recordingProblems } from "../src/replay.ts"
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
