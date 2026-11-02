import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromiumArgs } from "../../../packages/browser/src/internal/profiles.ts"
import { bounded, clip, conditions, deadline, executable } from "./common.mjs"

class Connection {
  constructor(serial, record) {
    this.serial = serial
    this.record = record
    this.next = 0
    this.pending = new Map()
    this.listeners = new Set()
    this.buffer = Buffer.alloc(0)
    this.profile = mkdtempSync(join(tmpdir(), "rook13-raw-"))
    this.args = [
      ...chromiumArgs.automation,
      "--headless",
      "--remote-debugging-pipe",
      `--user-data-dir=${this.profile}`,
      "about:blank"
    ]
    this.child = spawn(executable, this.args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] })
    this.child.stderr.on("data", (data) => record.log("stderr", { connection: serial, text: data.toString() }))
    this.child.stdio[4].on("data", (data) => {
      this.buffer = Buffer.concat([this.buffer, data])
      let end
      while ((end = this.buffer.indexOf(0)) !== -1) {
        const message = JSON.parse(this.buffer.subarray(0, end).toString())
        this.buffer = this.buffer.subarray(end + 1)
        record.wire(serial, "in", message)
        const pending = this.pending.get(message.id)
        if (pending) {
          this.pending.delete(message.id)
          if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
          else pending.resolve(message.result)
        }
        for (const listener of this.listeners) listener(message)
      }
    })
  }
  send(method, params, sessionId) {
    const id = ++this.next
    const message = { id, method, ...(params === undefined ? {} : { params }), ...(sessionId ? { sessionId } : {}) }
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    // Both ordered calls write synchronously; callers need not await a first reply.
    this.record.wire(this.serial, "out", message)
    this.child.stdio[3].write(JSON.stringify(message) + "\0")
    return { id, promise }
  }
  async call(method, params, sessionId) {
    const sent = this.send(method, params, sessionId)
    const result = await bounded(sent.promise)
    if (result.status !== "success") throw new Error(`${method} ${JSON.stringify(result)}`)
    return result.value
  }
  event(method, session, timeout = deadline) {
    let listener
    const promise = new Promise((resolve) => {
      listener = (message) => {
        if (message.method === method && message.sessionId === session) resolve(message.params)
      }
      this.listeners.add(listener)
    })
    return bounded(promise, timeout).finally(() => this.listeners.delete(listener))
  }
  async close() {
    this.child.kill("SIGTERM")
    await new Promise((resolve) => this.child.once("exit", resolve))
    rmSync(this.profile, { recursive: true, force: true })
  }
}
export async function runRaw({ record, origin, stopAt, rounds = 3 }) {
  let serial = 0
  for (let round = 1; round <= rounds; round++) {
    for (const condition of conditions()) {
      if (Date.now() + 35_000 > stopAt) return
      const connection = new Connection(++serial, record)
      const begin = performance.now()
      const label = { implementation: "raw", round, ...condition, connection: serial }
      record.log("attempts", { ...label, event: "start", args: connection.args })
      try {
        const version = await connection.call("Browser.getVersion")
        if (version.product !== "Chrome/155.0.8059.79") throw new Error(`Unexpected browser ${version.product}`)
        const targets = await connection.call("Target.getTargets")
        const target = targets.targetInfos.find((target) => target.type === "page")
        const { sessionId } = await connection.call("Target.attachToTarget", {
          targetId: target.targetId,
          flatten: true
        })
        await connection.call("Page.enable", {}, sessionId)
        await connection.call("Runtime.enable", {}, sessionId)
        await connection.call("Page.setLifecycleEventsEnabled", { enabled: true }, sessionId)
        await connection.call("Emulation.setDeviceMetricsOverride", {
          width: 1440,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false
        }, sessionId)
        const loaded = connection.event("Page.loadEventFired", sessionId)
        await connection.call("Page.navigate", { url: `${origin}/a` }, sessionId)
        const load = await loaded
        if (load.status !== "success") throw new Error("Initial load did not finish")
        const visible = await connection.call("Runtime.evaluate", {
          expression:
            "JSON.stringify({rect:document.querySelector(\"main\").getBoundingClientRect().toJSON(),visible:getComputedStyle(document.querySelector(\"main\")).visibility})",
          returnByValue: true
        }, sessionId)
        if (condition.resize) {
          await connection.call("Emulation.setDeviceMetricsOverride", {
            width: 1100,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: false
          }, sessionId)
        }
        const captureParams = {
          format: "png",
          fromSurface: true,
          ...(condition.area === "clip" ? { clip, captureBeyondViewport: true } : {})
        }
        let screenshot, navigation
        if (condition.order === "navigation-capture") {
          navigation = connection.send("Page.navigate", { url: `${origin}/b` }, sessionId)
          screenshot = connection.send("Page.captureScreenshot", captureParams, sessionId)
        } else {
          screenshot = connection.send("Page.captureScreenshot", captureParams, sessionId)
          if (condition.order !== "no-navigation") {
            navigation = connection.send("Page.navigate", { url: `${origin}/b` }, sessionId)
          }
        }
        const [capture, nav] = await Promise.all([
          bounded(screenshot.promise),
          navigation ? bounded(navigation.promise) : Promise.resolve(null)
        ])
        // Do not copy image data into the attempt summary; wire receipt metadata is durable.
        if (capture.status === "success") capture.value = { base64Length: capture.value.data.length }
        record.log("attempts", {
          ...label,
          event: "capture-result",
          sessionId,
          captureId: screenshot.id,
          navigationId: navigation?.id,
          capture,
          navigation: nav,
          visible: visible.result.value
        })
        if (capture.status === "timeout") {
          // Post-deadline observation only: never used to retry or extend the capture.
          const frame = connection.event("Page.screencastFrame", sessionId, 2000)
          const start = await bounded(
            connection.send("Page.startScreencast", { format: "jpeg" }, sessionId).promise,
            2000
          )
          const receipt = await frame
          if (receipt.status === "success") {
            await connection.call("Page.screencastFrameAck", { sessionId: receipt.value.sessionId }, sessionId)
            receipt.value = {
              metadata: receipt.value.metadata,
              sessionId: receipt.value.sessionId,
              imageBase64Length: receipt.value.data.length
            }
          }
          const stop = await bounded(connection.send("Page.stopScreencast", {}, sessionId).promise, 2000)
          record.log("attempts", { ...label, event: "post-timeout-frame", start, receipt, stop })
        }
        record.log("attempts", { ...label, event: "end", elapsedMs: performance.now() - begin })
        console.log(JSON.stringify({ ...label, capture: capture.status, elapsedMs: capture.elapsedMs }))
      } catch (error) {
        record.log("attempts", {
          ...label,
          event: "setup-error",
          error: String(error),
          elapsedMs: performance.now() - begin
        })
      } finally {
        await connection.close()
      }
    }
  }
}
