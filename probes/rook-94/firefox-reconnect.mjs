// ROOK-94: raw BiDi experiment; no Strider adapter or automatic session cleanup.
import { execFileSync, fork, spawn } from "node:child_process"
import { appendFileSync, mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
const origin = performance.now()
const output = process.env.PROBE_OUTPUT
function log(kind, data) {
  const row = { ms: performance.now() - origin, pid: process.pid, kind, ...data }
  if (output) appendFileSync(output, JSON.stringify(row) + "\n")
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(f, label, timeout = 10000) {
  const start = performance.now()
  while (!f()) {
    if (performance.now() - start > timeout) throw Error(`Timeout: ${label}`)
    await sleep(10)
  }
}
async function connect(url) {
  log("connect", { url })
  const ws = new WebSocket(url)
  await new Promise((ok, fail) => {
    ws.onopen = ok
    ws.onerror = fail
    setTimeout(() => fail(Error("connect timeout")), 5000).unref()
  })
  const pending = new Map()
  const events = []
  let id = 0
  ws.onmessage = (e) => {
    const message = JSON.parse(e.data)
    log("receive", { url, message })
    if (message.id !== undefined) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    } else events.push(message)
  }
  return {
    events,
    close: () => ws.close(),
    send(method, params = {}) {
      const message = { id: ++id, method, params }
      log("send", { url, message })
      return new Promise((ok, fail) => {
        const timer = setTimeout(() => {
          pending.delete(message.id)
          fail(Error(`Timeout: ${method}`))
        }, 10000)
        pending.set(message.id, (result) => {
          clearTimeout(timer)
          ok(result)
        })
        ws.send(JSON.stringify(message))
      })
    }
  }
}
function result(reply) {
  if (reply.type !== "success") throw Error(JSON.stringify(reply))
  return reply.result
}
if (process.argv[2] === "client") {
  const c = await connect(process.argv[3])
  process.on("message", async ({ id, method, params }) => {
    try {
      process.send({
        id,
        reply: method === "probe.events" ? { type: "success", result: c.events } : await c.send(method, params)
      })
    } catch (e) {
      process.send({ id, error: String(e) })
    }
  })
  process.send({ ready: true })
} else {
  if (process.env.STRIDER_ENVIRONMENT !== "nix-integration" || !output) {
    throw Error("Run in integration Nix shell with PROBE_OUTPUT")
  }
  log("platform", {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    firefox: process.env.STRIDER_FIREFOX,
    version: execFileSync(process.env.STRIDER_FIREFOX, ["--version"], { encoding: "utf8" }),
    environment: { LANG: process.env.LANG, TZ: process.env.TZ, DISPLAY: process.env.DISPLAY }
  })
  for (let trial = 1; trial <= 3; trial++) {
    log("trial", { trial })
    const profile = mkdtempSync(`${tmpdir()}/rook-94-`)
    const hits = []
    const server = createServer((req, res) => {
      hits.push(req.url)
      log("http", { trial, url: req.url })
      res.end("<!doctype html><title>ROOK-94</title>")
    })
    await new Promise((r) => server.listen(0, "127.0.0.1", r))
    const base = `http://127.0.0.1:${server.address().port}`
    let browser = spawn(process.env.STRIDER_FIREFOX, [
      "--headless",
      "--remote-debugging-port=0",
      "--no-remote",
      "--profile",
      profile,
      "about:blank"
    ], { stdio: ["ignore", "pipe", "pipe"] })
    let endpoint
    let child
    browser.stderr.on("data", (b) => {
      const text = String(b)
      log("firefox-stderr", { trial, text })
      endpoint ??= text.match(/WebDriver BiDi listening on (ws:\/\/\S+)/)?.[1]
    })
    browser.stdout.on("data", (b) => log("firefox-stdout", { trial, text: String(b) }))
    try {
      await waitFor(() => endpoint, "endpoint")
      child = fork(fileURLToPath(import.meta.url), ["client", `${endpoint}/session`], {
        stdio: ["ignore", "inherit", "inherit", "ipc"]
      })
      let ready = false
      let next = 0
      const calls = new Map()
      child.on("message", (m) => {
        if (m.ready) ready = true
        else {
          calls.get(m.id)?.(m)
          calls.delete(m.id)
        }
      })
      const send = async (method, params = {}) => {
        const id = ++next
        const m = await new Promise((r) => {
          calls.set(id, r)
          child.send({ id, method, params })
        })
        if (m.error) throw Error(m.error)
        return result(m.reply)
      }
      await waitFor(() => ready, "client")
      const session = await send("session.new", { capabilities: { alwaysMatch: { webSocketUrl: true } } })
      const oldUrl = session.capabilities.webSocketUrl ?? `${endpoint}/session/${session.sessionId}`
      const user = await send("browser.createUserContext")
      const context = await send("browsingContext.create", { type: "tab", userContext: user.userContext })
      const tree = await send("browsingContext.getTree")
      const subscription = await send("session.subscribe", {
        events: ["network.beforeRequestSent", "browsingContext.load"]
      })
      const preload = await send("script.addPreloadScript", {
        functionDeclaration: "() => { globalThis.__rook94 = \"old-session-preload\"; }"
      })
      const intercept = await send("network.addIntercept", {
        phases: ["beforeRequestSent"],
        urlPatterns: ["before", "after", "fresh"].map((name) => ({ type: "string", pattern: `${base}/paused-${name}` }))
      })
      log("known-state", {
        trial,
        browserPid: browser.pid,
        childPid: child.pid,
        oldUrl,
        session,
        user,
        context,
        tree,
        subscription,
        preload,
        intercept
      })
      await send("browsingContext.navigate", { context: context.context, url: `${base}/initial`, wait: "complete" })
      await send("script.evaluate", {
        expression: `fetch('${base}/paused-before').then(() => globalThis.__released = true)`,
        target: { context: context.context },
        awaitPromise: false
      })
      // Confirm both the blocked protocol event and absence at the HTTP server.
      await sleep(500)
      const events = await send("probe.events")
      const blocked = events.find((e) =>
        e.method === "network.beforeRequestSent" && e.params.request.url === `${base}/paused-before` &&
        e.params.isBlocked && e.params.intercepts.includes(intercept.intercept)
      )
      if (!blocked || hits.includes("/paused-before")) throw Error("Request was not proved paused")
      log("confirmed-paused", { trial, blocked })
      log("before-kill-http-absent", { trial, hits })
      const killed = performance.now()
      child.kill("SIGKILL")
      await new Promise((r) =>
        child.once("exit", (code, signal) => {
          log("client-exit", { trial, code, signal })
          r()
        })
      )
      log("kill", { trial, browserAlive: browser.exitCode === null })
      for (const offset of [0, 100, 500, 1000, 3000, 10000, 30000]) {
        await sleep(Math.max(0, killed + offset - performance.now()))
        const c = await connect(`${endpoint}/session`)
        const reply = await c.send("session.new", { capabilities: {} })
        log("new-attempt", {
          trial,
          sinceKillMs: performance.now() - killed,
          reply,
          pausedReachedServer: hits.includes("/paused-before")
        })
        c.close()
        if (reply.type === "success") throw Error("Unexpected new-session success: extend experiment for this outcome")
      }
      let c
      try {
        c = await connect(oldUrl)
      } catch (error) {
        log("saved-endpoint-refused", { trial, oldUrl, error: String(error) })
        c = await connect(`${endpoint}/session`)
      }
      const recoveredTree = await c.send("browsingContext.getTree")
      log("reattach-state", {
        trial,
        tree: recoveredTree,
        users: await c.send("browser.getUserContexts"),
        sinceKillMs: performance.now() - killed,
        hits
      })
      if (recoveredTree.type !== "success") {
        await c.send("session.status")
        await c.send("session.end")
        await c.send("session.new", { capabilities: {} })
        log("recovery-unavailable", { trial, hits, sinceKillMs: performance.now() - killed })
        c.close()
        browser.kill("SIGTERM")
        await new Promise((r) => browser.once("exit", r))
        endpoint = undefined
        browser = spawn(process.env.STRIDER_FIREFOX, [
          "--headless",
          "--remote-debugging-port=0",
          "--no-remote",
          "--profile",
          profile,
          "about:blank"
        ], { stdio: ["ignore", "pipe", "pipe"] })
        browser.stderr.on("data", (b) => {
          const text = String(b)
          log("restart-stderr", { trial, text })
          endpoint ??= text.match(/WebDriver BiDi listening on (ws:\/\/\S+)/)?.[1]
        })
        browser.stdout.on("data", (b) => log("restart-stdout", { trial, text: String(b) }))
        await waitFor(() => endpoint, "restart endpoint")
        const fresh = await connect(`${endpoint}/session`)
        const restartedSession = result(await fresh.send("session.new", { capabilities: {} }))
        log("restart-recovery", {
          trial,
          restartedSession,
          tree: await fresh.send("browsingContext.getTree"),
          users: await fresh.send("browser.getUserContexts")
        })
        await fresh.send("script.removePreloadScript", { script: preload.script })
        await fresh.send("network.removeIntercept", { intercept: intercept.intercept })
        await fresh.send("session.unsubscribe", { subscriptions: [subscription.subscription] })
        const tab = result(await fresh.send("browsingContext.create", { type: "tab" }))
        await fresh.send("browsingContext.navigate", {
          context: tab.context,
          url: `${base}/paused-fresh`,
          wait: "complete"
        })
        await fresh.send("script.evaluate", {
          expression: "globalThis.__rook94",
          target: { context: tab.context },
          awaitPromise: true
        })
        log("restart-events", { trial, events: fresh.events, hits })
        await fresh.send("session.end")
        fresh.close()
      } else {
        throw Error("Reattachment succeeded: extend cleanup experiment before drawing conclusions")
      }
      log("trial-complete", { trial })
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
  console.log(`Three trials complete: ${resolve(output)}`)
}
