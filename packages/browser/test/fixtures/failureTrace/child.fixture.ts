import { spawn } from "node:child_process"
import { once } from "node:events"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, expect, it } from "vitest"

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "trace-child-probe-"))
const child = path.join(directory, "child.mjs")
fs.writeFileSync(
  child,
  `
const connection = (label) => globalThis[Symbol.for("strider.integration.failureTrace")]?.connection(label) ?? (() => {})
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
const directory = ${JSON.stringify(directory)}
const trace = connection('child-probe')
trace('receive', process.argv[2])
if (process.argv[2] === 'CHILD_FAIL') {
  const daemon = spawn(process.execPath, [...process.execArgv, import.meta.filename, 'DAEMON_FAIL'], { detached: true, stdio: 'ignore' })
  await new Promise(resolve => daemon.once('exit', resolve))
  daemon.unref()
} else if (process.argv[2] === 'DAEMON_FAIL') {
  console.error('DAEMON_OWN_STDERR')
  process.stderr.write(new TextEncoder().encode('BYTE_STDERR_é'))
  trace('send', 'DAEMON_ORDER_ONE')
  trace('receive', 'DAEMON_ORDER_TWO')
} else if (process.argv[2] === 'LATE_PASS') {
  const watch = fs.watch(directory, () => {
    if (fs.existsSync(directory + '/release')) {
      trace('receive', 'LATE_CHILD_PASS')
      watch.close()
      fs.writeFileSync(directory + '/done-tmp', String(fs.existsSync(process.env.STRIDER_TEST_TRACE_SPOOL ?? '/nonexistent')))
      fs.renameSync(directory + '/done-tmp', directory + '/done')
    }
  })
  process.stdout.write('ready')
} else if (process.argv[2] === 'FLOOD') {
  for (let i = 0; i < 2000; i++) trace('receive', 'x'.repeat(40000))
  trace('receive', 'FLOOD_TAIL')
  const spool = process.env.STRIDER_TEST_TRACE_SPOOL
  if (spool) {
    const files = fs.readdirSync(spool)
    if (files.length > 128 * 3 + 1 || files.some(name => fs.statSync(spool + '/' + name).size > 128 * 1024)) throw new Error('Spool exceeded its bound')
    process.stdout.write('SPOOL_BOUND_VERIFIED')
  }
}
`
)
it("discards a passing child's records", async () => {
  const passed = spawn(process.execPath, [child, "CHILD_PASS"])
  await once(passed, "exit")
  const late = spawn(process.execPath, [child, "LATE_PASS"], { detached: true, stdio: ["ignore", "pipe", "ignore"] })
  await once(late.stdout!, "data")
  late.stdout!.destroy()
  late.unref()
})
it("captures detached descendants under their originating test", async () => {
  const finished = new Promise<void>((resolve) => {
    const watcher = fs.watch(directory, () => {
      if (fs.existsSync(path.join(directory, "done"))) {
        watcher.close()
        resolve()
      }
    })
  })
  fs.writeFileSync(path.join(directory, "release"), "")
  await finished
  expect(fs.readFileSync(path.join(directory, "done"), "utf8")).toBe("false")
  const processChild = spawn(process.execPath, [child, "CHILD_FAIL"])
  await once(processChild, "exit")
  const probe = spawn(process.execPath, [child, "FLOOD"])
  let output = ""
  probe.stdout.on("data", (chunk) => {
    output += String(chunk)
  })
  await once(probe, "close")
  expect(output).toBe("SPOOL_BOUND_VERIFIED")
  expect.fail("deliberate child recorder failure")
})

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))
