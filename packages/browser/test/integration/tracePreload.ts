/** Loaded only by the integration runner's Node children; execArgv carries it into detached daemons. */
import * as fs from "node:fs"
import { registerHooks } from "node:module"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { install, TraceBuffer } from "./failureTrace.ts"
import { instrument } from "./tracePlugin.ts"
import { stderrText } from "./traceStderr.ts"
import { prefixBytes, processSlots, segmentBytes, transferVariable } from "./traceTransfer.ts"

const directory = process.env[transferVariable]
if (directory !== undefined) {
  let slot: number | undefined
  for (let candidate = 0; candidate < processSlots; candidate++) {
    try {
      fs.unlinkSync(path.join(directory, `${candidate}.claim`))
      slot = candidate
      break
    } catch { /* Another process owns this slot, or the originating test has finished. */ }
  }
  if (slot === undefined) {
    try {
      const fd = fs.openSync(path.join(directory, "overflow"), "r+")
      try {
        fs.writeSync(fd, "Child process slot budget exhausted")
      } finally {
        fs.closeSync(fd)
      }
    } catch { /* Closed or already marked. */ }
  }
  if (slot !== undefined) {
    let sequence = 0
    let connectionId = 0
    let segment = 0
    let bytes = 0
    let startupBytes = 0
    let startupComplete = false
    let stopped = false
    const write = (connection: string, kind: string, value: unknown) => {
      if (stopped) return
      const trace = new TraceBuffer(segmentBytes / 2, 8 * 1024)
      trace.record(
        connection,
        kind,
        typeof value === "string" ?
          value :
          JSON.stringify(value, (_, v) => typeof v === "bigint" ? `${v}n` : v) ?? String(value)
      )
      const entry = trace.entries().at(-1)!
      const startup = !startupComplete
      let line =
        JSON.stringify({ ...entry, sequence: ++sequence, pid: process.pid, ...(startup ? { startup: true } : {}) }) +
        "\n"
      if (startup && startupBytes + Buffer.byteLength(line) > prefixBytes) {
        startupComplete = true
        line = JSON.stringify({ ...entry, sequence, pid: process.pid }) + "\n"
      }
      try {
        if (startupComplete && bytes + Buffer.byteLength(line) > segmentBytes) {
          segment = 1 - segment
          bytes = 0
        }
        const fd = fs.openSync(path.join(directory, `${slot}-${startupComplete ? segment : 2}`), "r+")
        try {
          if (startupComplete && bytes === 0) fs.ftruncateSync(fd, 0)
          fs.writeSync(fd, line, startupComplete ? bytes : startupBytes, "utf8")
        } finally {
          fs.closeSync(fd)
        }
        if (startupComplete) bytes += Buffer.byteLength(line)
        else startupBytes += Buffer.byteLength(line)
      } catch {
        stopped = true
      }
    }
    install({
      connection(label) {
        const id = `${process.pid}:${++connectionId}:${label}`
        write(id, "connection", { label, pid: process.pid, parentPid: process.ppid })
        return (kind, value) => write(id, kind, value)
      }
    })
    const lifecycle = `${process.pid}:lifecycle`
    write(lifecycle, "node-start", { args: process.argv, pid: process.pid, parentPid: process.ppid })
    // Observe the daemon's own writes too: its stderr is redirected to a startup file by the shell.
    const stderrWrite = process.stderr.write
    process.stderr.write = function(this: typeof process.stderr, ...args: Parameters<typeof stderrWrite>) {
      write(lifecycle, "node-stderr", stderrText(args[0]))
      return stderrWrite.apply(this, args)
    } as typeof stderrWrite
    process.on("exit", (code) => write(lifecycle, "node-exit", { code }))
    registerHooks({
      load(url, context, nextLoad) {
        const loaded = nextLoad(url, context)
        if (!url.startsWith("file:") || loaded.source === null || loaded.source === undefined) return loaded
        const output = instrument(String(loaded.source), fileURLToPath(url))
        return output === undefined ? loaded : { ...loaded, source: output.code }
      }
    })
    await import("./traceProcesses.ts")
  }
}
