/** Observe Node's owned children without adding a reader, changing stdio, or waiting for exit. */
import { ChildProcess } from "node:child_process"
import { connection } from "./failureTrace.ts"

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
      const emit = this.stderr.emit
      this.stderr.emit = function(event: string, ...values: Array<unknown>) {
        if (event === "data") trace("stderr", String(values[0]))
        return emit.call(this, event, ...values)
      }
    } else trace("stderr-unavailable", "Process stdio configuration provides no readable stderr pipe")
    const emit = this.emit
    this.emit = function(event: string, ...values: Array<unknown>) {
      if (event === "exit") trace("process-exit", { code: values[0], signal: values[1] })
      if (event === "error") trace("process-error", String(values[0]))
      return emit.call(this, event, ...values)
    }
    return result
  }
}
