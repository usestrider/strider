/** Direct BiDi print diagnostic: no Strider imports or recovery queries. */
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
const firefoxPrefs = {
  "automation": {
    "devtools.jsonview.enabled": false,
    "browser.link.open_newwindow": 2,
    "app.update.disabledForTesting": true,
    "browser.shell.checkDefaultBrowser": false,
    "browser.startup.homepage_override.mstone": "ignore",
    "browser.aboutwelcome.enabled": false,
    "datareporting.policy.dataSubmissionEnabled": false,
    "toolkit.telemetry.reportingpolicy.firstRun": false
  }
}
const profile = await mkdtemp(tmpdir() + "/print-probe-")
await writeFile(
  profile + "/user.js",
  Object.entries(firefoxPrefs.automation).map(([k, v]) =>
    "user_pref(" + JSON.stringify(k) + "," + JSON.stringify(v) + ");"
  ).join("\n")
)
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" })
  res.end("{\"hello\":\"world\"}")
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const child = spawn(process.env.STRIDER_FIREFOX, [
  "--headless",
  "--remote-debugging-port=0",
  "--no-remote",
  "--profile",
  profile,
  "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] })
let timer
const deadline = new Promise((_, reject) => {
  timer = setTimeout(() => reject(Error("probe deadline (30 seconds)")), 30000)
})
const exited = once(child, "exit")
let ws
try {
  await Promise.race([
    deadline,
    (async () => {
      const endpoint = await new Promise((resolve, reject) => {
        let stderr = ""
        child.stderr.on("data", (chunk) => {
          process.stderr.write(chunk)
          stderr += chunk
          const m = stderr.match(/WebDriver BiDi listening on (ws:\/\/\S+)/)
          if (m) resolve(m[1])
        })
        child.once("error", reject)
        child.once("exit", () => reject(Error("browser exited")))
      })
      ws = new WebSocket(endpoint + "/session")
      await once(ws, "open")
      let id = 0
      const pending = new Map()
      ws.addEventListener("message", ({ data }) => {
        const msg = JSON.parse(data)
        const shown = structuredClone(msg)
        if (shown.result?.data) shown.result.data = "<base64 " + shown.result.data.length + " chars>"
        console.log(new Date().toISOString(), "receive", JSON.stringify(shown))
        if (pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id)
          pending.delete(msg.id)
          if (msg.type === "error") {
            reject(Error(JSON.stringify(msg)))
          } else {
            resolve(msg.result)
          }
        }
      })
      const send = (method, params) =>
        new Promise((resolve, reject) => {
          const msg = { id: ++id, method, params }
          pending.set(id, { resolve, reject })
          console.log(new Date().toISOString(), "send", JSON.stringify(msg))
          ws.send(JSON.stringify(msg))
        })
      const session = await send("session.new", { capabilities: { alwaysMatch: {} } })
      console.log("Firefox capabilities", JSON.stringify(session.capabilities))
      if (
        !process.env.STRIDER_EXPECTED_FIREFOX ||
        session.capabilities.browserVersion !== process.env.STRIDER_EXPECTED_FIREFOX
      ) throw Error("Firefox version does not match the verified macOS pin")
      await send("session.subscribe", { events: ["browsingContext", "script"] })
      const { userContext } = await send("browser.createUserContext", {})
      const { context } = await send("browsingContext.create", { type: "window", userContext })
      await send("browsingContext.navigate", {
        context,
        url: "http://127.0.0.1:" + server.address().port + "/json",
        wait: "complete"
      })
      if (process.argv.includes("--screenshot")) {
        await send("browsingContext.captureScreenshot", { context, origin: "viewport", format: { type: "image/png" } })
      }
      const pdf = await send("browsingContext.print", {
        context,
        background: false,
        margin: { bottom: 1.016, left: 1.016, right: 1.016, top: 1.016 },
        orientation: "portrait",
        page: { height: 27.94, width: 21.59 },
        scale: 1
      })
      const header = Buffer.from(pdf.data, "base64").subarray(0, 5).toString()
      console.log("PDF header", header)
      if (header !== "%PDF-") {
        throw Error("Print did not return a PDF")
      }
      await send("session.end", {})
    })()
  ])
  console.log("probe passed")
} finally {
  clearTimeout(timer)
  ws?.close()
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  await exited
  server.close()
  await rm(profile, { recursive: true, force: true })
}
