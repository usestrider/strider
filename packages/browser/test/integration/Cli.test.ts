/**
 * The `strider` command (CLI.md), run as a person or an agent runs it: as processes, with a
 * session's daemon in between. A session started on the pinned Chromium is driven by page name and target,
 * waits across commands, declares routes and dialog decisions, runs a segment, saves its state, exports a test
 * and stops; a second session forks the first's state; a daemon killed outright is listed and pruned; and the
 * mistakes a command can make fail at once, with an exit code of their own.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import { Firefox } from "@usestrider/browser/firefox"
import * as Effect from "effect/Effect"
import { execFile, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { site } from "./adapter/harness.ts"
import { chromium, firefox } from "./browsers.ts"
import { firefoxAttachable } from "./slice/attaching.ts"

const timeout = 120_000
const bin = new URL("../../src/bin/strider.ts", import.meta.url).pathname
const fixtures = new URL("../fixtures/segments/", import.meta.url).pathname

/** A run of `strider`, with the environment given: its exit code and output. */
const strider = (env: Record<string, string>, ...args: ReadonlyArray<string>) =>
  Effect.callback<{ readonly code: number; readonly out: string; readonly err: string }>((resume) => {
    execFile(
      process.execPath,
      [bin, ...args],
      { env: { ...process.env, ...env }, timeout: 90_000 },
      (error, out, err) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1
        resume(Effect.succeed({ code, out: String(out), err: String(err) }))
      }
    )
  })

/** `strider mcp` as a client runs it: messages written to its standard input, answers read until the last id. */
const mcp = (env: Record<string, string>, args: ReadonlyArray<string>, messages: ReadonlyArray<object>, last: number) =>
  Effect.callback<ReadonlyArray<any>>((resume) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    })
    const answers: Array<any> = []
    let buffered = ""
    let errors = ""
    const timer = setTimeout(() => {
      child.kill()
      resume(Effect.die(new Error(`strider mcp answered ${JSON.stringify(answers)}; stderr: ${errors}`)))
    }, 60_000)
    child.stderr.on("data", (data) => void (errors += String(data)))
    child.stdout.on("data", (data) => {
      buffered += String(data)
      let end: number
      while ((end = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, end)
        buffered = buffered.slice(end + 1)
        if (line.trim() === "") continue
        const answer = JSON.parse(line)
        answers.push(answer)
        if (answer.id === last) {
          clearTimeout(timer)
          child.stdin.end()
          child.kill()
          resume(Effect.succeed(answers))
        }
      }
    })
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`)
  })

const environment = () => ({
  XDG_RUNTIME_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "strider-cli-")),
  // The ledger's own, so a test sees only its sessions' records
  XDG_STATE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "strider-cli-state-")),
  SECRET_PW: "hunter2"
})

const app = `<title>shop</title>
<label>Password <input id="password" type="password"></label>
<button id="go">Sign in</button>
<p id="out">signed out</p>
<button onclick="window.open('/child')">Open</button>
<button onclick="document.getElementById('asked').textContent = String(confirm('Sure?'))">Ask</button>
<p id="asked">not asked</p>
<button onclick="fetch('/api/status').then((r) => r.text()).then((t) => { document.getElementById('api').textContent = t })">Status</button>
<p id="api">no status</p>
<p id="cookies"></p>
<script>
  document.getElementById("go").onclick = () => {
    document.getElementById("out").textContent = document.getElementById("password").value === "hunter2" ? "welcome" : "wrong"
    console.error("signed in")
  }
  document.getElementById("cookies").textContent = "cookies: " + document.cookie
</script>`

describe("strider", () => {
  it.live("starts a session, drives its pages by name, and ends it", () =>
    Effect.scoped(Effect.gen(function*() {
      const served = yield* site
      const url = `${served.origin}/fixture?html=${encodeURIComponent(app)}`
      const env = environment()
      const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
      const shop = (...args: ReadonlyArray<string>) => strider(env, "-s", "shop", "-p", "shop", ...args)
      const started = yield* run(
        "start",
        "--name",
        "shop",
        "--chromium",
        chromium.executable,
        "--secret",
        "password=SECRET_PW"
      )
      assert.strictEqual(started.code, 0, started.err)
      assert.match(started.out, /^session shop · .* at .* · focus emulated · idle timeout 1h/)
      try {
        assert.strictEqual((yield* run("-s", "shop", "page", "new", "--name", "shop", url)).code, 0)
        const snapshot = yield* shop("snapshot")
        assert.include(snapshot.out, `button "Sign in" [ref=`)
        const filled = yield* shop("fill", "label=Password", "%password%")
        assert.strictEqual(filled.code, 0, filled.err)
        assert.notInclude(filled.out, "hunter2")
        const ref = /button "Sign in" \[ref=(e\d+)\]/.exec(snapshot.out)![1]!
        const clicked = yield* shop("click", ref)
        assert.match(clicked.out, new RegExp(`^clicked ${ref} on shop · \\d+ ms`))
        assert.strictEqual((yield* shop("expect", "css=#out", "visible", "--text", "welcome")).code, 0)
        // A wait started by one command and collected by another
        assert.match((yield* shop("next", "popup", "--within", "20 seconds")).out, /^w1: waiting for the next popup/)
        assert.strictEqual((yield* shop("click", `role=button[name="Open"]`)).code, 0)
        assert.match((yield* run("-s", "shop", "await", "w1")).out, /popup p\d+/)
        // A route and a dialog decision, each a registration
        const routed = yield* shop("route", "**/api/status", "fulfill", "--body", "all good")
        assert.match(routed.out, /^r1: fulfill/)
        yield* shop("click", `role=button[name="Status"]`)
        assert.strictEqual((yield* shop("expect", "css=#api", "visible", "--text", "all good")).code, 0)
        assert.strictEqual((yield* shop("dialog", "handle", "dismiss")).code, 0)
        yield* shop("click", `text="Ask"`)
        assert.strictEqual((yield* shop("expect", "css=#asked", "visible", "--text", "false")).code, 0)
        assert.match((yield* run("-s", "shop", "remove", "r1")).out, /^removed r1/)
        // Files are written to the session's artifacts, and only their paths printed
        const shot = yield* shop("screenshot")
        const file = shot.out.split("\n").map((line) => line.trim()).find((line) => line.endsWith(".png"))!
        assert.deepStrictEqual([...fs.readFileSync(file).subarray(1, 4)], [0x50, 0x4e, 0x47])
        assert.include((yield* shop("history", "console")).out, "signed in")
        assert.include((yield* shop("--json", "pages")).out, `"page":"shop"`)
        // A segment: run in the session, its returned page named into it
        const segment = yield* run("-s", "shop", "run", path.join(fixtures, "open-popup.ts"))
        assert.match(segment.out, /^ran .*open-popup\.ts; popup is p\d+/, segment.err)
        const missing = yield* run("-s", "shop", "run", path.join(fixtures, "missing-page.ts"))
        assert.notStrictEqual(missing.code, 0)
        assert.include(missing.err, "PageNotFound")
        // State for a program, and a test of what ran
        const state = path.join(env.XDG_RUNTIME_DIR, "shop.state")
        assert.strictEqual((yield* run("-s", "shop", "state", "save", state)).code, 0)
        assert.strictEqual(fs.statSync(state).mode & 0o777, 0o600)
        const test = path.join(env.XDG_RUNTIME_DIR, "shop.test.ts")
        assert.strictEqual((yield* run("-s", "shop", "export", "test", test)).code, 0)
        const exported = fs.readFileSync(test, "utf8")
        // The test's context is made as the session's was, with every page rendering
        assert.include(exported, `const context = yield* Browser.newContext({ focus: "emulated" })`)
        assert.include(exported, `const shop = yield* context.newPage`)
        assert.include(exported, `shop.getByRole("button", { name: "Sign in", exact: true }).click()`)
        assert.include(exported, `.fill(yield* Config.Redacted("SECRET_PW"))`)
        assert.include(exported, `const w1 = yield* Popup.next(shop).pipe(Deadline.within("20 seconds"))`)
        // The route the session removed ends where it did, through its handle; the dialog handler it kept doesn't
        assert.include(exported, `const r1 = yield* shop.route("**/api/status", () => Effect.succeed(Route.fulfill(`)
        assert.include(exported, `yield* r1.remove\n`)
        assert.include(exported, `        yield* Dialog.handle(shop, Dialog.dismissAll)\n`)
        assert.include(exported, `// TODO strider run ${path.join(fixtures, "open-popup.ts")}`)
        // The page's own script holds the password it checks, so the statement is what is checked
        assert.notInclude(exported, `.fill("hunter2")`)
        assert.match((yield* run("sessions")).out, /^shop  chromium · pages shop, p\d+, p\d+/)
      } finally {
        yield* run("-s", "shop", "stop")
      }
      // The session's directory goes with it
      yield* Effect.sleep("1 second")
      assert.isFalse(fs.existsSync(path.join(env.XDG_RUNTIME_DIR, "strider", "shop")))
      assert.strictEqual((yield* run("-s", "shop", "pages")).code, 20)
    })), timeout)

  it.live(
    "forks a session's state, lists and prunes one a crash left behind",
    () =>
      Effect.scoped(Effect.gen(function*() {
        const served = yield* site
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
        assert.strictEqual((yield* run("start", "--name", "first", "--firefox", firefox.executable)).code, 0)
        const lock = path.join(env.XDG_RUNTIME_DIR, "strider", "first", "lock")
        try {
          yield* run("-s", "first", "page", "new", "--name", "home", `${served.origin}/cookie`)
          const forked = yield* run("start", "--name", "second", "--chromium", chromium.executable, "--fork", "first")
          assert.strictEqual(forked.code, 0, forked.err)
          assert.include(forked.out, "forked from first")
          try {
            yield* run(
              "-s",
              "second",
              "page",
              "new",
              "--name",
              "home",
              `${served.origin}/fixture?html=${encodeURIComponent(app)}`
            )
            const shown = yield* run(
              "-s",
              "second",
              "-p",
              "home",
              "expect",
              "css=#cookies",
              "visible",
              "--text",
              "flavor=oat"
            )
            assert.strictEqual(shown.code, 0, shown.err)
          } finally {
            yield* run("-s", "second", "stop")
          }
        } finally {
          // A daemon killed outright leaves its directory, listed until pruned
          process.kill(Number.parseInt(fs.readFileSync(lock, "utf8"), 10), "SIGKILL")
        }
        yield* Effect.sleep("500 millis")
        assert.match((yield* run("sessions")).out, /first  left behind by a session that didn't end cleanly/)
        const again = yield* run("start", "--name", "first", "--chromium", chromium.executable)
        assert.notStrictEqual(again.code, 0)
        assert.include(again.err, "strider prune first")
        // The ledger lists what the dead daemon launched, and --yes reclaims it
        const listed = yield* run("prune")
        assert.include(listed.out, "which has ended:")
        assert.include(listed.out, firefox.executable)
        assert.include(listed.out, "strider prune --yes reclaims it")
        assert.include((yield* run("prune", "--yes")).out, "reclaimed what 1 ended program left")
        assert.include((yield* run("prune")).out, "Nothing is left behind by a program that ended")
        const pruned = yield* run("prune", "first")
        assert.match(pruned.out, /^removed .*first/)
        assert.isFalse(fs.existsSync(path.join(env.XDG_RUNTIME_DIR, "strider", "first")))
      })),
    timeout
  )

  it.live(
    "takes the browser's own tab, finds and filters, keeps a segment's page, downloads into the session, and serves MCP",
    () =>
      Effect.scoped(Effect.gen(function*() {
        const served = yield* site
        const url = `${served.origin}/fixture?html=${encodeURIComponent(app)}`
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
        const tools = (...args: ReadonlyArray<string>) => strider(env, "-s", "tools", ...args)
        const started = yield* run("start", "--name", "tools", "--chromium", chromium.executable)
        assert.strictEqual(started.code, 0, started.err)
        try {
          // The launched browser's own first tab is outside the session's context: control takes it
          const tabs = yield* tools("tabs")
          const tab = tabs.out.split("\n")[0]!.split("  ")[0]!
          assert.match(tab, /\S/, tabs.out)
          const taken = yield* tools("control", tab, "--name", "own")
          assert.strictEqual(taken.code, 0, taken.err)
          assert.strictEqual((yield* tools("-p", "own", "goto", url)).code, 0)
          assert.strictEqual((yield* tools("release", "-p", "own")).code, 0)
          assert.strictEqual((yield* tools("-p", "own", "snapshot")).code, 16, "a released tab has no name")
          // find returns refs, and history narrows to a level or to failures
          assert.strictEqual((yield* tools("page", "new", "--name", "shop", url)).code, 0)
          const found = yield* tools("-p", "shop", "find", "Sign in", "--role", "button")
          assert.match(found.out, /^(e\d+) {2}button "Sign in"/, found.err)
          const ref = /^(e\d+)/.exec(found.out)![1]!
          assert.strictEqual((yield* tools("-p", "shop", "click", ref)).code, 0)
          // The site answers any path, so a route makes the status request fail
          assert.strictEqual(
            (yield* tools("-p", "shop", "route", "**/api/status", "fulfill", "--status", "500", "--body", "down")).code,
            0
          )
          assert.strictEqual((yield* tools("-p", "shop", "click", "role=button[name=\"Status\"]")).code, 0)
          let errors = ""
          let failures = ""
          for (let attempt = 0; attempt < 50 && (errors === "" || !failures.includes("500")); attempt++) {
            errors = (yield* tools("-p", "shop", "history", "console", "--level", "error")).out
            failures = (yield* tools("-p", "shop", "history", "network", "--failed")).out
            if (errors === "" || !failures.includes("500")) yield* Effect.sleep("100 millis")
          }
          assert.include(errors, "console error on shop: signed in")
          assert.match(failures, /500 .*\/api\/status/)
          // A segment keeps a page it opened, which outlives it
          const kept = yield* tools("run", path.join(fixtures, "keep-page.ts"))
          assert.strictEqual(kept.code, 0, kept.err)
          assert.include((yield* tools("pages")).out, "kept")
          assert.strictEqual((yield* tools("-p", "kept", "goto", url)).code, 0)
          // Downloads go to the session's own directory
          const downloads = path.join(env.XDG_RUNTIME_DIR, "strider", "tools", "downloads")
          yield* tools(
            "-p",
            "shop",
            "goto",
            `${served.origin}/fixture?html=${encodeURIComponent(`<a href="/download" download>Get</a>`)}`
          )
          yield* tools("-p", "shop", "click", "text=\"Get\"")
          for (let attempt = 0; attempt < 50 && fs.readdirSync(downloads).length === 0; attempt++) {
            yield* Effect.sleep("100 millis")
          }
          assert.isAbove(fs.readdirSync(downloads).length, 0)
          // strider mcp serves the session's tools to a client over standard input and output
          const answers = yield* mcp(env, ["-s", "tools", "mcp"], [
            {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }
            },
            { jsonrpc: "2.0", method: "notifications/initialized" },
            { jsonrpc: "2.0", id: 2, method: "tools/list" },
            { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "pages", arguments: {} } }
          ], 3)
          const listedTools = answers.find((answer) => answer.id === 2)?.result?.tools?.map((tool: any) => tool.name)
          assert.includeMembers(listedTools ?? [], ["click", "find", "control"])
          const pages = JSON.stringify(answers.find((answer) => answer.id === 3)?.result)
          assert.include(pages, "shop")
          assert.include(pages, "kept")
        } finally {
          yield* tools("stop")
        }
      })),
    timeout
  )

  it.live("attaches to Firefox's remote agent by an endpoint with no path", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const served = yield* site
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
        const tab = `${served.origin}/fixture?html=${encodeURIComponent("<title>remote</title>")}`
        const { endpoint } = yield* firefoxAttachable(Firefox.layerConnect).start(tab, tab)
        // Firefox answers at /session, which the endpoint it prints leaves out
        const started = yield* run("start", "--name", "remote", "--attach", endpoint)
        assert.strictEqual(started.code, 0, started.err)
        try {
          assert.include(started.out, `${endpoint}/session`)
          const tabs = yield* run("-s", "remote", "tabs")
          assert.strictEqual(tabs.code, 0, tabs.err)
        } finally {
          yield* run("-s", "remote", "stop")
        }
      }).pipe(Effect.provide(NodeServices.layer))
    ), timeout)

  it.live("fails at once on what a command can't mean, with exit codes of its own", () =>
    Effect.gen(function*() {
      const env = environment()
      const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
      const unnamed = yield* run("pages")
      assert.strictEqual(unnamed.code, 20)
      assert.include(unnamed.err, "Every command names its session")
      const two = yield* run("start", "--name", "x", "--chromium", chromium.executable, "--firefox", firefox.executable)
      assert.strictEqual(two.code, 15)
      assert.include(two.err, "exactly one of --chromium, --firefox or --webkit")
      const badName = yield* run("start", "--name", "Bad Name", "--chromium", chromium.executable)
      assert.strictEqual(badName.code, 15)
      assert.strictEqual(
        (yield* run("start", "--name", "idle", "--chromium", chromium.executable, "--idle", "2 seconds")).code,
        0
      )
      const noPage = yield* run("-s", "idle", "snapshot")
      assert.strictEqual(noPage.code, 15)
      assert.include(noPage.err, "names its page with -p")
      // The idle timeout ends the session by itself
      yield* Effect.sleep("4 seconds")
      assert.strictEqual((yield* run("-s", "idle", "pages")).code, 20)
    }), timeout)
})
