import * as Effect from "effect/Effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, it } from "vitest"
import * as Ledger from "../../../src/Ledger.ts"
import { connection } from "../../integration/failureTrace.ts"
import * as Reports from "../../integration/firefoxCrashReports.ts"

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "strider-report-runner-"))
const item: Ledger.Item = { _tag: "Browser", pid: process.pid, executable: "/pinned/firefox", profile }
Reports.install()
const ledger = Effect.runSync(Ledger.CurrentLedger)
beforeAll(() => {
  fs.mkdirSync(path.join(profile, "minidumps"))
  Effect.runSync(ledger.add(item))
})
afterAll(() => {
  Effect.runSync(ledger.remove(item))
  fs.rmSync(profile, { recursive: true, force: true })
  fs.rmSync(Reports.outbox, { recursive: true, force: true })
})

for (const failed of [false, true]) {
  it(failed ? "failed Firefox print" : "passing Firefox print", () => {
    const id = failed ? "failed-report" : "passing-report"
    const trace = connection("Firefox print")
    trace(
      "stderr",
      [
        "IPDL protocol error: Handler returned error code!",
        "PWindowGlobal::Msg_PDocAccessibleConstructor Processing error: message was deserialized, but the handler returned false",
        "process 4242 exited on signal 15"
      ].join("\n")
    )
    trace(
      "receive",
      JSON.stringify({
        type: "error",
        id: 11,
        error: "unknown error",
        message: "[Exception... \"Unexpected error\" nsresult: \"0x8000ffff (NS_ERROR_UNEXPECTED)\" ...]"
      })
    )
    fs.writeFileSync(
      path.join(profile, "minidumps", `${id}.extra`),
      JSON.stringify({
        ProcessType: "tab",
        ipc_channel_error: "PWindowGlobal::Msg_PDocAccessibleConstructor"
      })
    )
    fs.writeFileSync(path.join(profile, "minidumps", `${id}.dmp`), "dump")
    if (failed) throw new Error("recorded print failure")
  })
}
