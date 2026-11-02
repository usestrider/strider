// Test-only preload: preserve socket bytes without changing messages or production code.
import { appendFileSync } from "node:fs"
import { Socket } from "node:net"
const directory = process.env.STRIDER_VIEWPORT_DIAGNOSTIC
if (directory) {
  const record = (socket, direction, chunk) => {
    if (typeof chunk !== "string" && !ArrayBuffer.isView(chunk)) return
    appendFileSync(
      `${directory}/wire-${process.pid}.ndjson`,
      JSON.stringify({
        time: Date.now(),
        direction,
        local: socket.localPort,
        remote: socket.remotePort,
        bytes: Buffer.from(chunk).toString("base64")
      }) + "\n"
    )
  }
  const write = Socket.prototype.write
  Socket.prototype.write = function(chunk, ...args) {
    record(this, "send", chunk)
    return write.call(this, chunk, ...args)
  }
  const emit = Socket.prototype.emit
  Socket.prototype.emit = function(event, ...args) {
    if (event === "data") record(this, "receive", args[0])
    return emit.call(this, event, ...args)
  }
}
