import { execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, it } from "vitest"

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "trace-child-probe-"))
const child = path.join(directory, "child.mjs")
fs.writeFileSync(child, `
const connection = (label) => globalThis[Symbol.for("strider.integration.failureTrace")]?.connection(label) ?? (() => {})
import { spawn } from 'node:child_process'
const trace = connection('child-probe')
trace('receive', process.argv[2])
if (process.argv[2] === 'CHILD_FAIL') {
  const daemon = spawn(process.execPath, [...process.execArgv, import.meta.filename, 'DAEMON_FAIL'], { detached: true, stdio: 'ignore' })
  daemon.unref()
} else if (process.argv[2] === 'DAEMON_FAIL') {
  trace('send', 'DAEMON_ORDER_ONE')
  trace('receive', 'DAEMON_ORDER_TWO')
} else if (process.argv[2] === 'FLOOD') {
  for (let i = 0; i < 2000; i++) trace('receive', 'x'.repeat(40000))
  trace('receive', 'FLOOD_TAIL')
}
`)
it("discards a passing child's records", () => {
  execFileSync(process.execPath, [child, "CHILD_PASS"])
})
it("captures detached descendants under their originating test", async () => {
  const processChild = spawn(process.execPath, [child, "CHILD_FAIL"])
  await once(processChild, "exit")
  const probe = spawn(process.execPath, [child, "FLOOD"])
  await once(probe, "exit")
  expect.fail("deliberate child recorder failure")
})
