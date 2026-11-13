import { assert, describe, it } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as FirefoxCrashReports from "./integration/firefoxCrashReports.ts"

// The failure as recorded on macOS: Firefox's parent rejects a message, kills the content process, and the print fails
const stderr = [
  "IPDL protocol error: Handler returned error code!",
  "PWindowGlobal::Msg_PDocAccessibleConstructor Processing error: message was deserialized, but the handler returned false",
  "process 4242 exited on signal 15"
].join("\n")
const printError = JSON.stringify({
  type: "error",
  id: 11,
  error: "unknown error",
  message: "[Exception... \"Unexpected error\"  nsresult: \"0x8000ffff (NS_ERROR_UNEXPECTED)\" ...]"
})

const scratch = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "strider-crash-reports-"))
  const home = path.join(root, "home")
  const pending = FirefoxCrashReports.pendingDirectory(home)
  fs.mkdirSync(pending, { recursive: true })
  return { root, pending, destination: path.join(root, "kept") }
}

const write = (pending: string, id: string, dump: number) => {
  fs.writeFileSync(
    path.join(pending, `${id}.extra`),
    `ProcessType=tab\nipc_channel_error=PWindowGlobal::Msg_PDocAccessibleConstructor\nStderr=${
      JSON.stringify(stderr)
    }\nPrint=${printError}\n`
  )
  fs.writeFileSync(path.join(pending, `${id}.dmp`), Buffer.alloc(dump))
  fs.writeFileSync(path.join(pending, `${id}-browser.dmp`), Buffer.alloc(dump))
}

describe("FirefoxCrashReports", () => {
  it("enables the reports a killed content process writes", () => {
    assert.strictEqual(FirefoxCrashReports.environment["MOZ_CRASHREPORTER"], "1")
    assert.isUndefined(FirefoxCrashReports.environment["MOZ_CRASHREPORTER_NO_REPORT"])
    assert.strictEqual(FirefoxCrashReports.prefs["dom.ipc.tabs.createKillHardCrashReports"], true)
  })

  it("keeps a failed test's annotations and minidumps, and removes them from the pending directory", () => {
    const { pending, destination } = scratch()
    write(pending, "0a1b", 1024)
    const kept = FirefoxCrashReports.keep(pending, destination, Date.now() - 60_000, true)
    assert.strictEqual(kept, destination)
    assert.include(fs.readFileSync(path.join(destination, "0a1b.extra"), "utf8"), "ipc_channel_error=")
    assert.deepStrictEqual(fs.readdirSync(destination).sort(), ["0a1b-browser.dmp", "0a1b.dmp", "0a1b.extra"])
    assert.deepStrictEqual(fs.readdirSync(pending), [])
  })

  it("keeps nothing for a passing test", () => {
    const { pending, destination } = scratch()
    write(pending, "0a1b", 1024)
    assert.isUndefined(FirefoxCrashReports.keep(pending, destination, Date.now() - 60_000, false))
    assert.isFalse(fs.existsSync(destination))
    assert.deepStrictEqual(fs.readdirSync(pending), [])
  })

  it("keeps nothing when no report was written, or only before the test began", () => {
    const { pending, destination } = scratch()
    assert.isUndefined(FirefoxCrashReports.keep(pending, destination, Date.now() - 60_000, true))
    write(pending, "0a1b", 16)
    assert.isUndefined(FirefoxCrashReports.keep(pending, destination, Date.now() + 60_000, true))
    assert.isFalse(fs.existsSync(destination))
    assert.isUndefined(FirefoxCrashReports.keep(path.join(pending, "absent"), destination, 0, true))
  })

  it("keeps the annotations but not a minidump over the size bound", () => {
    const { pending, destination } = scratch()
    write(pending, "0a1b", FirefoxCrashReports.maxDumpBytes + 1)
    FirefoxCrashReports.keep(pending, destination, Date.now() - 60_000, true)
    assert.deepStrictEqual(fs.readdirSync(destination).sort(), ["0a1b.extra", "omitted.txt"])
    assert.include(fs.readFileSync(path.join(destination, "omitted.txt"), "utf8"), "0a1b.dmp")
  })

  it("looks where Firefox writes on each platform", () => {
    assert.strictEqual(
      FirefoxCrashReports.pendingDirectory("/h", "linux"),
      "/h/.config/mozilla/firefox/Crash Reports/pending"
    )
    assert.strictEqual(
      FirefoxCrashReports.pendingDirectory("/h", "linux", "/x"),
      "/x/mozilla/firefox/Crash Reports/pending"
    )
    assert.strictEqual(
      FirefoxCrashReports.pendingDirectory("/h", "darwin"),
      "/h/Library/Application Support/Firefox/Crash Reports/pending"
    )
  })
})
