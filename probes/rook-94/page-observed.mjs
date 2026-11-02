// ROOK-94 review: what the old page itself can see after its client goes, which needs no access to the old session.
// The page polls the server for heartbeats and commands, so its survival, its paused fetch's fate, and whether the old
// intercept and preload still apply are all measured from outside the protocol.
import { execFileSync, fork, spawn } from "node:child_process"
import { appendFileSync, mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
const output = process.env.PROBE_OUTPUT
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (kind, data) => {
  if (output) appendFileSync(output, JSON.stringify({ pid: process.pid, kind, ...data }) + "\n")
}
async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((ok, fail) => {
    ws.onopen = ok
    ws.onerror = () => fail(Error(`refused: ${url}`))
  })
  const pending = new Map()
  const events = []
  let id = 0
  ws.onmessage = (e) => {
    const message = JSON.parse(e.data)
    if (message.id !== undefined) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    } else events.push(message)
  }
  return {
    events,
    close: () => ws.close(),
    send: (method, params = {}) =>
      new Promise((ok) => {
        pending.set(++id, ok)
        ws.send(JSON.stringify({ id, method, params }))
      })
  }
}
if (process.argv[2] === "client") {
  const c = await connect(process.argv[3])
  process.on("message", async ({ id, method, params }) => {
    if (method === "probe.events") return process.send({ id, reply: { type: "success", result: c.events } })
    if (method === "probe.close") {
      c.close()
      return process.send({ id, reply: { type: "success", result: {} } })
    }
    process.send({ id, reply: await c.send(method, params) })
  })
  process.send({ ready: true })
} else {
  if (process.env.STRIDER_ENVIRONMENT !== "nix-integration" || !output) {
    throw Error("Run in integration Nix shell with PROBE_OUTPUT")
  }
  log("platform", { version: execFileSync(process.env.STRIDER_FIREFOX, ["--version"], { encoding: "utf8" }) })
  const runs = [
    ["sigkill", [5000, 45000], 60000],
    ["sigkill", [5000, 45000], 60000],
    ["sigkill", [5000, 45000], 60000],
    ["ws-close", [5000, 10000], 15000],
    ["session-end", [5000, 10000], 15000]
  ]
  for (const [index, [ending, checks, watch]] of runs.entries()) {
    const run = index + 1
    log("run", { run, ending })
    const profile = mkdtempSync(`${tmpdir()}/rook-94-review-`)
    let ended = 0
    const since = () => ended === 0 ? null : Math.round(performance.now() - ended)
    let commands = []
    const hits = []
    const server = createServer((req, res) => {
      const path = req.url
      res.setHeader("Cache-Control", "no-store")
      if (path.startsWith("/hb")) {
        hits.push("/hb")
        log("heartbeat", { run, since: since() })
        return res.end(commands.shift() ?? "")
      }
      hits.push(path)
      log("http", { run, since: since(), path })
      if (path.startsWith("/preload-frame")) {
        return res.end(`<!doctype html><script>fetch("/beacon/preload" +
          "?phase=${path.split("=")[1]}&value=" + encodeURIComponent(String(globalThis.__rook94)))</script>`)
      }
      res.end("<!doctype html><title>ROOK-94</title><body>")
    })
    await new Promise((r) => server.listen(0, "127.0.0.1", r))
    const base = `http://127.0.0.1:${server.address().port}`
    const browser = spawn(process.env.STRIDER_FIREFOX, [
      "--headless",
      "--remote-debugging-port=0",
      "--no-remote",
      "--profile",
      profile,
      "about:blank"
    ], { stdio: ["ignore", "pipe", "pipe"] })
    let endpoint
    browser.stderr.on("data", (b) => {
      endpoint ??= String(b).match(/WebDriver BiDi listening on (ws:\/\/\S+)/)?.[1]
    })
    let child
    try {
      while (!endpoint) await sleep(10)
      child = fork(fileURLToPath(import.meta.url), ["client", `${endpoint}/session`], {
        stdio: ["ignore", "inherit", "inherit", "ipc"]
      })
      let ready = false
      let next = 0
      const calls = new Map()
      child.on("message", (m) => {
        if (m.ready) ready = true
        else {
          calls.get(m.id)?.(m.reply)
          calls.delete(m.id)
        }
      })
      while (!ready) await sleep(10)
      const send = (method, params = {}) =>
        new Promise((ok) => {
          const id = ++next
          calls.set(id, ok)
          child.send({ id, method, params })
        })
      const must = async (method, params) => {
        const reply = await send(method, params)
        if (reply.type !== "success") throw Error(JSON.stringify(reply))
        return reply.result
      }
      await must("session.new", { capabilities: {} })
      const user = await must("browser.createUserContext")
      const { context } = await must("browsingContext.create", { type: "tab", userContext: user.userContext })
      await must("session.subscribe", { events: ["network.beforeRequestSent"] })
      await must("script.addPreloadScript", { functionDeclaration: "() => { globalThis.__rook94 = 'old-preload'; }" })
      const { intercept } = await must("network.addIntercept", {
        phases: ["beforeRequestSent"],
        urlPatterns: ["held", "continued", "failed", ...checks.map((_, i) => `check${i}`)].map((name) => ({
          type: "string",
          pattern: `${base}/paused-${name}`
        }))
      })
      await must("browsingContext.navigate", { context, url: `${base}/initial`, wait: "complete" })
      await must("script.evaluate", {
        expression: `(() => {
          const beacon = (name) => fetch("/beacon/" + name)
          globalThis.watch = (name) => fetch("/paused-" + name).then(
            () => beacon(name + "-resolved"),
            (e) => beacon(name + "-rejected?" + encodeURIComponent(String(e)))
          )
          const frame = (phase) => {
            const f = document.createElement("iframe")
            f.src = "/preload-frame?phase=" + phase
            document.body.append(f)
          }
          let n = 0
          setInterval(async () => {
            const command = await (await fetch("/hb?n=" + n++)).text()
            if (command.startsWith("watch:")) watch(command.slice(6))
            if (command.startsWith("frame:")) frame(command.slice(6))
          }, 1000)
          frame("before")
          watch("held")
          watch("continued")
          watch("failed")
        })()`,
        target: { context },
        awaitPromise: false
      })
      await sleep(1500)
      // The controls: a paused fetch's outcome does reach the beacon, and the preload does reach the frame.
      const blocked = (await must("probe.events")).filter((e) => e.params.isBlocked)
      const paused = (name) => blocked.find((e) => e.params.request.url === `${base}/paused-${name}`)?.params.request
      if (!paused("held") || !paused("continued") || !paused("failed")) throw Error("A control was not paused")
      await must("network.continueRequest", { request: paused("continued").request })
      await must("network.failRequest", { request: paused("failed").request })
      await sleep(1000)
      log("controls-done", { run, intercept, hits: hits.filter((h) => h !== "/hb") })
      ended = performance.now()
      if (ending === "sigkill") {
        child.kill("SIGKILL")
        log("client-exit", {
          run,
          since: since(),
          signal: await new Promise((r) => child.once("exit", (_, signal) => r(signal))),
          browserAlive: browser.exitCode === null
        })
      } else if (ending === "ws-close") {
        await must("probe.close")
      } else {
        log("session-end", { run, since: since(), reply: await send("session.end") })
      }
      const steps = [
        ...[0, 1000, 10000, 30000].filter((at) => at < watch).map((at) => [at, "new"]),
        ...checks.flatMap((at, i) => [[at, "intercept", i], [at + 1000, "frame", i]])
      ].sort((a, b) => a[0] - b[0])
      for (const [at, step, i] of steps) {
        await sleep(Math.max(0, ended + at - performance.now()))
        if (step === "intercept") commands.push(`watch:check${i}`)
        if (step === "frame") commands.push(`frame:after${i}`)
        if (step === "new") {
          const c = await connect(`${endpoint}/session`)
          const reply = await c.send("session.new", { capabilities: {} })
          const row = { run, since: since(), type: reply.type, error: reply.error, message: reply.message }
          if (reply.type === "success") {
            const tree = await c.send("browsingContext.getTree")
            const users = await c.send("browser.getUserContexts")
            log("new-attempt", {
              ...row,
              oldContext: context,
              tree: tree.result.contexts.map((x) => ({ context: x.context, userContext: x.userContext, url: x.url })),
              oldContextListed: tree.result.contexts.some((x) => x.context === context),
              oldUserContextListed: users.result.userContexts.some((x) => x.userContext === user.userContext)
            })
            await c.send("session.end")
          } else log("new-attempt", row)
          c.close()
        }
      }
      await sleep(Math.max(0, ended + watch - performance.now()))
      const heartbeats = hits.filter((h) => h === "/hb").length
      log("run-end", { run, since: since(), heartbeats, hits: hits.filter((h) => h !== "/hb") })
    } finally {
      child?.kill("SIGKILL")
      browser.kill("SIGTERM")
      await new Promise((r) => {
        if (browser.exitCode !== null) r()
        else browser.once("exit", r)
      })
      server.closeAllConnections()
      server.close()
      rmSync(profile, { recursive: true, force: true })
    }
  }
  console.log("Runs complete")
}
