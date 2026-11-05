import * as assert from "node:assert/strict"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import { TraceBuffer } from "./failureTrace.ts"
import { checkpoint } from "./snapshotTrace.ts"
import { pipeObserver } from "./tracePipe.ts"
const directory = "/home/jpowers/.local/share/clutch/artifacts/ROOK-212/slice-capture"
const file = `${directory}/offline-gesture.ndjson`
const trace = new TraceBuffer()
for (const [index, type] of ["mouseMoved", "mousePressed", "mouseReleased"].entries()) {
  trace.record(
    "pipe",
    "pipe-send",
    JSON.stringify({
      id: index + 1,
      method: "Input.dispatchMouseEvent",
      params: { type, x: 101.1484375, y: 35.5 },
      sessionId: "top"
    })
  )
  trace.record("pipe", "pipe-receive", JSON.stringify({ id: index + 1, result: {} }))
}
const frozen = checkpoint(file, trace, { phase: "offline pre-drain" })
const digest = (text: string) => crypto.createHash("sha256").update(text).digest("hex")
const hash = digest(frozen)
trace.clear()
const observe = pipeObserver(
  (kind, payload) => trace.record("pipe", kind, typeof payload === "string" ? payload : JSON.stringify(payload)),
  "pipe-receive"
)
const streamReply = Buffer.from(
  JSON.stringify({ id: 100, result: { data: "n".repeat(1024 * 1024), eof: false } }) + "\0"
)
for (let i = 0; i < 80; i++) {
  observe(streamReply.subarray(0, 173))
  observe(streamReply.subarray(173))
}
assert.equal(fs.readFileSync(file, "utf8"), frozen)
assert.equal(digest(fs.readFileSync(file, "utf8")), hash)
assert.equal(frozen.split("\n").filter((line) => line.includes("dispatchMouseEvent")).length, 3)
assert.equal(frozen.split("\n").filter((line) => line.includes("pipe-receive")).length, 3)
assert.ok(trace.entries().some((entry) => entry.kind === "overflow"))
assert.ok(trace.entries().some((entry) => entry.kind === "wire-truncation"))
checkpoint(`${directory}/offline-cleanup.ndjson`, trace, { phase: "offline stream drain" })
console.log(JSON.stringify({
  passed: true,
  frozenSHA256: hash,
  streamMessages: 80,
  streamBytes: streamReply.length * 80,
  cleanupOverflow: trace.entries().filter((entry) => entry.kind === "overflow"),
  cleanupWireTruncations: trace.entries().filter((entry) => entry.kind === "wire-truncation").length
}))
