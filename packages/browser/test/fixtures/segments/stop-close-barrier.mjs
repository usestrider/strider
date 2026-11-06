// Test-only preload: hold the daemon just before it closes its socket server, until the test releases it. The hold
// is synchronous, since the daemon may exit without waiting for the close to finish.
import fs from "node:fs"
import { Server } from "node:net"

if (process.argv.includes("__daemon") && process.env.STRIDER_CLOSE_BARRIER) {
  const barrier = process.env.STRIDER_CLOSE_BARRIER
  const closing = new WeakSet()
  const close = Server.prototype.close
  Server.prototype.close = function(callback) {
    const address = this.address()
    const first = !closing.has(this)
    if (first && (typeof address !== "string" || !address.endsWith("/sock"))) return close.call(this, callback)
    closing.add(this)
    fs.writeFileSync(`${barrier}.${first ? "closing" : "finalizing"}`, "")
    const wait = new Int32Array(new SharedArrayBuffer(4))
    while (!fs.existsSync(`${barrier}.${first ? "release" : "finish"}`)) Atomics.wait(wait, 0, 0, 10)
    const result = close.call(this, callback)
    fs.writeFileSync(`${barrier}.${first ? "closed" : "finished"}`, "")
    return result
  }
}
