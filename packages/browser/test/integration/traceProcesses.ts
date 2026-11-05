/** Observe Node's owned children without adding a reader, changing stdio, or waiting for exit. */
import { ChildProcess } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import { connection } from "./failureTrace.ts"
import { pipeObserver } from "./tracePipe.ts"

const patched = Symbol.for("strider.integration.processObserver")
type SpawnOptions = { readonly file: string; readonly args?: ReadonlyArray<string> }
// Node's spawn, execFile and fork all reach this method; it is absent from @types/node's public surface.
const prototype = ChildProcess.prototype as ChildProcess & {
  [patched]?: boolean
  spawn(options: SpawnOptions): unknown
}
if (!prototype[patched]) {
  prototype[patched] = true
  const spawn = prototype.spawn
  prototype.spawn = function(this: ChildProcess, options: SpawnOptions) {
    const trace = connection(`process:${options.file}`)
    const result = spawn.call(this, options)
    trace("process-start", { command: options.file, args: options.args, pid: this.pid })
    // Observing emit leaves the existing pipe consumer in charge of flow and draining.
    if (this.stderr !== null) {
      trace("stderr-open", "Observing the existing stderr consumer")
      let observedBytes = 0
      const emit = this.stderr.emit
      this.stderr.emit = function(event: string, ...values: Array<unknown>) {
        if (event === "data") {
          const text = String(values[0])
          observedBytes += Buffer.byteLength(text)
          trace("stderr", text)
        }
        if (event === "end") trace("stderr-end", { observedBytes })
        return emit.call(this, event, ...values)
      }
    } else trace("stderr-unavailable", "Process stdio configuration provides no readable stderr pipe")
    // Playwright's integration baselines use the same Chromium pipe, outside Strider's transports.
    if (options.args?.includes("--remote-debugging-pipe")) {
      const input = this.stdio[3] as Writable | null
      const output = this.stdio[4] as Readable | null
      if (input !== null && input !== undefined) {
        const observe = pipeObserver(trace, "pipe-send")
        const write = input.write
        input.write = function(this: Writable, ...args: Parameters<typeof write>) {
          const chunk = args[0]
          if (typeof chunk === "string" || chunk instanceof Uint8Array) observe(chunk)
          return write.apply(this, args)
        } as typeof write
      }
      if (output !== null && output !== undefined) {
        const observe = pipeObserver(trace, "pipe-receive")
        const emit = output.emit
        output.emit = function(event: string, ...values: Array<unknown>) {
          const chunk = values[0]
          if (event === "data" && (typeof chunk === "string" || chunk instanceof Uint8Array)) observe(chunk)
          return emit.call(this, event, ...values)
        }
      }
    }
    const emit = this.emit
    this.emit = function(event: string, ...values: Array<unknown>) {
      if (event === "exit") trace("process-exit", { code: values[0], signal: values[1] })
      if (event === "error") trace("process-error", String(values[0]))
      return emit.call(this, event, ...values)
    }
    return result
  }
}
