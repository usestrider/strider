import * as Effect from "effect/Effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, it } from "vitest"
import { firefoxPrefs } from "../src/internal/profiles.ts"
import * as Ledger from "../src/Ledger.ts"
import * as Reports from "./integration/firefoxCrashReports.ts"

const crashVariables = () => Object.keys(Reports.environment).filter((name) => process.env[name] !== undefined)
const crashPrefs = () =>
  Object.values(firefoxPrefs).flatMap((profile) => Object.keys(Reports.prefs).filter((name) => name in profile))

it("leaves a file that doesn't opt in with no crash variables, the launch prefs unchanged and the ledger unwrapped", () => {
  const unchanged = JSON.stringify(firefoxPrefs)
  const ledger = Effect.runSync(Effect.gen(function*() {
    return yield* Ledger.CurrentLedger
  }))
  const { remove } = ledger
  expect(crashVariables()).toEqual([])
  expect(crashPrefs()).toEqual([])

  const restore = Reports.optIn()
  expect(crashVariables()).toEqual(Object.keys(Reports.environment))
  expect(firefoxPrefs.automation).toMatchObject(Reports.prefs)
  expect(ledger.remove).not.toBe(remove)
  restore()

  // What a later file in the same worker sees
  expect(crashVariables()).toEqual([])
  expect(JSON.stringify(firefoxPrefs)).toBe(unchanged)
  expect(ledger.remove).toBe(remove)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "strider-opted-out-"))
  fs.mkdirSync(path.join(profile, "minidumps"))
  fs.writeFileSync(path.join(profile, "minidumps", "kept.extra"), "{}")
  try {
    Effect.runSync(ledger.remove({ _tag: "Browser", pid: process.pid, executable: "/pinned/firefox", profile }))
    expect(fs.existsSync(path.join(profile, "minidumps", "kept.extra"))).toBe(true)
  } finally {
    fs.rmSync(profile, { recursive: true, force: true })
  }
})
