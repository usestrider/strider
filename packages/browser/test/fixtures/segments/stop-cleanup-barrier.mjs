// Test-only preload: hold the daemon's ledger finalizer until the test releases it.
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import { connect, Socket } from "node:net"
import path from "node:path"

if (process.argv.includes("__daemon")) {
  const events = process.env.STRIDER_STOP_EVENTS
  const record = (event) => fs.appendFileSync(events, JSON.stringify(event) + "\n")
  let cleanupBarrier
  const requests = new WeakMap()
  const incoming = new WeakMap()
  const emit = Socket.prototype.emit
  Socket.prototype.emit = function(event, ...args) {
    if (event === "data") {
      const lines = ((incoming.get(this) ?? "") + args[0].toString()).split("\n")
      incoming.set(this, lines.pop())
      for (const line of lines) {
        try {
          const message = JSON.parse(line)
          if (message._tag === "Request" && message.tag === "Command" && message.payload.argv.includes("stop")) {
            requests.set(this, String(message.id))
            cleanupBarrier?.write("caller\n")
          }
        } catch {}
      }
    }
    return emit.call(this, event, ...args)
  }
  const write = Socket.prototype.write
  Socket.prototype.write = function(chunk, ...args) {
    for (const line of chunk.toString().split("\n")) {
      try {
        const message = JSON.parse(line)
        if (message._tag === "Exit" && String(message.requestId) === requests.get(this)) {
          record({
            event: "stop-response",
            exit: message.exit,
            sessionExists: fs.existsSync(path.join(process.env.XDG_RUNTIME_DIR, "strider", "barrier"))
          })
        }
      } catch {}
    }
    return write.call(this, chunk, ...args)
  }
  const rm = fs.rm
  fs.rm = function(file, options, callback) {
    if (path.dirname(String(file)) !== path.join(process.env.XDG_STATE_HOME, "strider", "ledger")) {
      return rm.call(this, file, options, callback)
    }
    if (process.env.STRIDER_STOP_FAILURE) {
      return callback(Object.assign(new Error("denied ledger removal"), { code: "EACCES" }))
    }
    record({ event: "ledger-finalizer-entered", exists: fs.existsSync(file) })
    const barrier = connect(process.env.STRIDER_STOP_BARRIER)
    cleanupBarrier = barrier
    barrier.once("connect", () => barrier.write("entered\n"))
    barrier.once("data", () => {
      rm.call(this, file, options, (error) => {
        record({ event: "ledger-removed", exists: fs.existsSync(file), error: error?.message })
        barrier.once("data", () => {
          barrier.end()
          callback(error)
        })
        barrier.write("removed\n")
      })
    })
  }
  syncBuiltinESMExports()
}
