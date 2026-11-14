import * as Effect from "effect/Effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, it } from "vitest"
import * as Ledger from "../src/Ledger.ts"
import * as Reports from "./integration/firefoxCrashReports.ts"

Reports.install()
const ledger = Effect.runSync(Ledger.CurrentLedger)

it("leaves another browser's minidumps in its profile", () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "strider-chromium-reports-"))
  const item: Ledger.Item = { _tag: "Browser", pid: process.pid, executable: "/pinned/chromium", profile }
  const extra = path.join(profile, "minidumps", "chromium-report.dmp")
  fs.mkdirSync(path.dirname(extra))
  fs.writeFileSync(extra, "other browser evidence")
  try {
    Effect.runSync(ledger.add(item))
    Effect.runSync(ledger.remove(item))
    expect(fs.existsSync(extra)).toBe(true)
  } finally {
    fs.rmSync(profile, { recursive: true, force: true })
    fs.rmSync(Reports.outbox, { recursive: true, force: true })
  }
})

it("keeps the final annotations when a shared Firefox still has its report open", () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "strider-live-reports-"))
  const item: Ledger.Item = { _tag: "Browser", pid: process.pid, executable: "/pinned/firefox", profile }
  const extra = path.join(profile, "minidumps", "live-report.extra")
  fs.mkdirSync(path.dirname(extra))
  const fd = fs.openSync(extra, "w")
  fs.writeSync(fd, "{\"ProductID\":\"firefox\",")
  Effect.runSync(ledger.add(item))
  try {
    // A shared browser remains alive after a test ends, and its writer still owns this descriptor: nothing is taken
    // until the browser is forgotten.
    expect(fs.existsSync(path.join(Reports.outbox, "live-report.extra"))).toBe(false)
    fs.writeSync(fd, "\"ProcessType\":\"tab\",\"ipc_channel_error\":\"PWindowGlobal::Msg_PDocAccessibleConstructor\"}")
    fs.closeSync(fd)
    Effect.runSync(ledger.remove(item))
    expect(fs.readFileSync(path.join(Reports.outbox, "live-report.extra"), "utf8"))
      .toContain("\"ipc_channel_error\"")
  } finally {
    try {
      fs.closeSync(fd)
    } catch { /* Already closed. */ }
    Effect.runSync(ledger.remove(item))
    fs.rmSync(profile, { recursive: true, force: true })
    fs.rmSync(Reports.outbox, { recursive: true, force: true })
  }
})

it("collects a Firefox launched under a suite's custom ledger", () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "strider-custom-ledger-"))
  const item: Ledger.Item = { _tag: "Browser", pid: process.pid, executable: "/pinned/firefox", profile }
  const extra = path.join(profile, "minidumps", "custom-report.extra")
  fs.mkdirSync(path.dirname(extra))
  fs.writeFileSync(extra, "{\"ipc_channel_error\":\"PWindowGlobal::Msg_PDocAccessibleConstructor\"}")
  const custom = Reports.wrap({ add: () => Effect.void, remove: () => Effect.void })
  try {
    Effect.runSync(
      Effect.flatMap(Ledger.CurrentLedger, (current) => Effect.andThen(current.add(item), current.remove(item))).pipe(
        Effect.provideService(Ledger.CurrentLedger, custom)
      )
    )
    expect(fs.existsSync(path.join(Reports.outbox, "custom-report.extra"))).toBe(true)
  } finally {
    fs.rmSync(profile, { recursive: true, force: true })
    fs.rmSync(Reports.outbox, { recursive: true, force: true })
  }
})
