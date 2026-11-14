import { assert, describe, it } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { vi } from "vitest"
import * as FirefoxCrashReports from "./integration/firefoxCrashReports.ts"

vi.mock("node:fs", { spy: true })

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
  const pending = path.join(root, "outbox")
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
    assert.strictEqual(FirefoxCrashReports.environment["MOZ_CRASHREPORTER_NO_REPORT"], "1")
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

  it("moves a profile's reports into the outbox, leaving the rest of the profile", () => {
    const { root, pending } = scratch()
    const profile = path.join(root, "profile")
    fs.mkdirSync(path.join(profile, "minidumps"), { recursive: true })
    write(path.join(profile, "minidumps"), "0a1b", 16)
    fs.writeFileSync(path.join(profile, "minidumps", "notes.txt"), "")
    FirefoxCrashReports.collect(profile, pending)
    assert.deepStrictEqual(fs.readdirSync(pending).sort(), ["0a1b-browser.dmp", "0a1b.dmp", "0a1b.extra"])
    assert.deepStrictEqual(fs.readdirSync(path.join(profile, "minidumps")), ["notes.txt"])
    FirefoxCrashReports.collect(path.join(root, "absent"), pending)
  })
})

describe("Firefox crash collection review regressions", () => {
  it("does not launch the crash reporter client after a parent-process crash", () => {
    // ShouldReport in Firefox's nsExceptionHandler.cpp launches the client unless reporting is disabled.
    assert.strictEqual(FirefoxCrashReports.environment["MOZ_CRASHREPORTER_NO_REPORT"], "1")
  })

  it("does not preselect submission from the tab-crashed page", () => {
    // Firefox's release default is true; restoring a crashed tab can submit the report with that selection.
    assert.strictEqual(FirefoxCrashReports.prefs["browser.tabs.crashReporting.sendReport"], false)
  })

  it("tolerates a temporary extra file disappearing while Firefox finalizes a content crash", async () => {
    const { root, pending, destination } = scratch()
    write(pending, "0a1b", 16)
    const { statSync: stat } = await vi.importActual<typeof fs>("node:fs")
    // TakeMinidumpForChild moves the temporary extra to pending, reads it, then removes it;
    // FinalizeCrashReport writes it again. Reproduce that removal between directory listing and stat.
    const intercepted = vi.spyOn(fs, "statSync").mockImplementation((...args) => {
      if (String(args[0]) === path.join(pending, "0a1b.extra")) {
        fs.rmSync(path.join(pending, "0a1b.extra"), { force: true })
      }
      return Reflect.apply(stat, fs, args)
    })
    try {
      assert.doesNotThrow(() => FirefoxCrashReports.keep(pending, destination, 0, true))
    } finally {
      intercepted.mockRestore()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("preserves the source annotations when the destination cannot be written", () => {
    const { root, pending, destination } = scratch()
    write(pending, "0a1b", 16)
    fs.writeFileSync(destination, "a file already occupies the destination")
    try {
      try {
        FirefoxCrashReports.keep(pending, destination, 0, true)
      } catch {
        // The caller can report the failure; it must still have the original evidence to recover.
      }
      assert.isTrue(fs.existsSync(path.join(pending, "0a1b.extra")))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
