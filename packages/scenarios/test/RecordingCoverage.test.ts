import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, expect, it } from "vitest"
import * as Replay from "../src/replay.ts"
import { scenarios } from "../src/scenarios.ts"

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-recordings-"))
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

it("rejects a login-only recording before replaying dynamic controls", () => {
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, "the-internet.har")
  fs.writeFileSync(file, JSON.stringify({
    log: { entries: [{ request: { method: "GET", url: "https://the-internet.herokuapp.com/login" } }] }
  }))
  const controls = scenarios.filter((scenario) => scenario.name === "controls")
  expect(Replay.recordingProblems(controls, () => file)).toEqual([
    `Recording ${file} is missing required page URLs: https://the-internet.herokuapp.com/dynamic_controls`
  ])
  expect(Replay.recordingProblems(scenarios.filter((scenario) => scenario.name === "readme"), () => file)).toEqual([])
})
