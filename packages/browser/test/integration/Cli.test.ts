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

/** What an MCP client sends first: its initialization, as id 1. */
const handshake = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }
  },
  { jsonrpc: "2.0", method: "notifications/initialized" }
]

/** The page names `strider pages` lists, one a line before its URL. */
const names = (listing: { readonly out: string }) =>
  listing.out.split("\n").filter((line) => line.includes("  ")).map((line) => line.split("  ")[0]!)

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
<button onclick="setTimeout(() => window.open('/child'), 1500)">Later</button>
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
  it.live("accepts the idle duration printed by start and sessions", () =>
    Effect.gen(function*() {
      const env = environment()
      const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
      const started = yield* run(
        "start",
        "--name",
        "original",
        "--chromium",
        chromium.executable,
        "--idle",
        "15 minutes"
      )
      assert.strictEqual(started.code, 0, started.err)
      try {
        const listed = yield* run("sessions")
        assert.strictEqual(listed.code, 0, listed.err)
        const fromStart = /idle timeout (.+)$/m.exec(started.out)?.[1]
        const fromSessions = /idle .+ of (.+)$/m.exec(listed.out)?.[1]
        assert.isDefined(fromStart, started.out)
        assert.isDefined(fromSessions, listed.out)
        const results = []
        for (const [name, idle] of [["from-start", fromStart!], ["from-sessions", fromSessions!]]) {
          const reused = yield* run("start", "--name", name!, "--chromium", chromium.executable, "--idle", idle!)
          results.push({ source: name, idle, code: reused.code, err: reused.err })
        }
        assert.deepStrictEqual(results.map(({ code }) => code), [0, 0], JSON.stringify(results))
      } finally {
        for (const name of ["original", "from-start", "from-sessions"]) {
          yield* run("-s", name, "stop")
        }
      }
    }), timeout)

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
        const awaited = yield* run("-s", "shop", "await", "w1")
        assert.match(awaited.out, /popup p\d+/)
        // A popup named after it opened, whose steps then name it so
        const popup = /popup (p\d+)/.exec(awaited.out)![1]!
        assert.strictEqual((yield* run("-s", "shop", "-p", popup, "page", "name", "child")).code, 0)
        assert.strictEqual((yield* run("-s", "shop", "-p", "child", "expect", "css=p", "visible")).code, 0)
        // A popup the session never waited for, found among the pages it lists, and renamed
        const before = names(yield* run("-s", "shop", "pages"))
        assert.strictEqual((yield* shop("click", `role=button[name="Open"]`)).code, 0)
        let unwaited: string | undefined
        for (let attempt = 0; attempt < 50 && unwaited === undefined; attempt++) {
          unwaited = names(yield* run("-s", "shop", "pages")).find((name) => !before.includes(name))
          if (unwaited === undefined) yield* Effect.sleep("100 millis")
        }
        assert.isDefined(unwaited, "the popup is listed")
        assert.strictEqual((yield* run("-s", "shop", "-p", unwaited!, "page", "name", "help")).code, 0)
        assert.strictEqual((yield* run("-s", "shop", "-p", "help", "expect", "css=p", "visible")).code, 0)
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
        const returned = /popup is (p\d+)/.exec(segment.out)![1]!
        assert.strictEqual((yield* run("-s", "shop", "-p", returned, "expect", "css=p", "visible")).code, 0)
        const missing = yield* run("-s", "shop", "run", path.join(fixtures, "missing-page.ts"))
        assert.notStrictEqual(missing.code, 0)
        assert.include(missing.err, "PageNotFound")
        // A page an MCP client opens is the session's, and the test's too
        const opened = yield* mcp(env, ["-s", "shop", "mcp"], [
          ...handshake,
          { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "newPage", arguments: { name: "side", url } } }
        ], 2)
        assert.include(JSON.stringify(opened.find((answer) => answer.id === 2)?.result), "side")
        // A secret in a URL, put in as the command runs
        const html = (before: string, after: string) =>
          `${served.origin}/fixture?html=${encodeURIComponent(before)}%password%${encodeURIComponent(after)}`
        assert.strictEqual((yield* shop("goto", html(`<p id="pw">`, "</p>"))).code, 0)
        const checked = yield* shop("expect", "css=#pw", "visible", "--text", "%password%")
        assert.strictEqual(checked.code, 0, checked.err)
        assert.notInclude(checked.out, "hunter2")
        // page new puts a secret into its URL as goto does, and prints the URL with its name
        const vault = yield* run("-s", "shop", "page", "new", "--name", "vault", html(`<p id="pw">`, "</p>"))
        assert.strictEqual(vault.code, 0, vault.err)
        assert.include(vault.out, "%password%")
        assert.notInclude(vault.out, "hunter2")
        const unlocked = yield* run("-s", "shop", "-p", "vault", "expect", "css=#pw", "visible", "--text", "%password%")
        assert.strictEqual(unlocked.code, 0, unlocked.err)
        // A navigation that fails doesn't print the secret either
        const unsafe = "http://127.0.0.1:9/?pw=%password%"
        const refused = yield* run("-s", "shop", "page", "new", "--name", "refused", unsafe)
        assert.strictEqual(refused.code, 11, refused.err)
        assert.notInclude(refused.err, "hunter2")
        // It names the URL it was going to, with the secret's name back in
        assert.include(refused.err, "Navigation to http://127.0.0.1:9/?pw=%password% failed")
        // Its page is closed again, so the session holds no page the exported test leaves out
        const held = names(yield* run("-s", "shop", "pages"))
        assert.notInclude(held, "refused")
        // A name that's taken fails before a page opens
        const twice = yield* run("-s", "shop", "page", "new", "--name", "shop", url)
        assert.strictEqual(twice.code, 15, twice.err)
        assert.deepStrictEqual(names(yield* run("-s", "shop", "pages")), held)
        // A URL's percent-escapes name no secret, so the URL is sent as written
        const cafe = `${served.origin}/fixture?html=${encodeURIComponent(`<p id="word">café</p>`)}`
        assert.include(cafe, "caf%C3%A9")
        const visited = yield* shop("goto", cafe)
        assert.strictEqual(visited.code, 0, visited.err)
        assert.strictEqual((yield* shop("expect", "css=#word", "visible", "--text", "café")).code, 0)
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
        // The popup the session named is a variable of that name from then on
        assert.include(exported, `const ${popup} = yield* w1\n`)
        assert.include(exported, `const child = ${popup}\n`)
        assert.include(exported, `yield* child.locator("p").pipe(Expect.toBeVisible)\n`)
        // The popup it never waited for is waited for from just before the click that opened it
        assert.include(
          exported,
          [
            `        const shopPopups = yield* Popup.next(shop)`,
            `        yield* shop.getByRole("button", { name: "Open", exact: true }).click()`,
            `        const ${unwaited} = yield* shopPopups`,
            `        const help = ${unwaited}`,
            `        yield* help.locator("p").pipe(Expect.toBeVisible)`,
            ``
          ].join("\n")
        )
        // The route the session removed ends where it did, through its handle; the dialog handler it kept doesn't
        assert.include(exported, `const r1 = yield* shop.route("**/api/status", () => Effect.succeed(Route.fulfill(`)
        assert.include(exported, `yield* r1.remove\n`)
        assert.include(exported, `        yield* Dialog.handle(shop, Dialog.dismissAll)\n`)
        // The page the segment returned is its placeholder's to declare
        assert.include(
          exported,
          `// TODO strider run ${
            path.join(fixtures, "open-popup.ts")
          }: a segment runs only in a session; put its steps here, declaring ${returned}\n`
        )
        assert.include(exported, `yield* ${returned}.locator("p").pipe(Expect.toBeVisible)\n`)
        assert.include(
          exported,
          `const side = yield* context.newPage\n        yield* side.goto(${JSON.stringify(url)})\n`
        )
        // The URL's secret is built in from its config, where the session put it
        const password = `\${Redacted.value(yield* Config.Redacted("SECRET_PW"))}`
        assert.include(
          exported,
          `yield* shop.goto(\`${html(`<p id="pw">`, "</p>").replace("%password%", () => password)}\`)\n`
        )
        assert.include(
          exported,
          `const vault = yield* context.newPage\n        yield* vault.goto(\`${
            html(`<p id="pw">`, "</p>").replace("%password%", () => password)
          }\`)\n`
        )
        // The check of the secret's text is left out, since a failure would print it
        assert.include(
          exported,
          `yield* shop.locator("#pw").pipe(Expect.toBeVisible)\n        // Left out: the session's check that this contains "%password%"`
        )
        assert.notInclude(exported, `Expect.toContainText("%password%")`)
        // A percent-escaped URL is the text the session sent
        assert.include(exported, `yield* shop.goto(${JSON.stringify(cafe)})\n`)
        // The page's own script holds the password it checks, so the statement is what is checked
        assert.notInclude(exported, `.fill("hunter2")`)
        assert.match((yield* run("sessions")).out, /^shop  chromium · pages shop, child, help, p\d+/)
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
            // A fork's state is in no file, so its test starts empty, and says so
            const test = path.join(env.XDG_RUNTIME_DIR, "second.test.ts")
            assert.strictEqual((yield* run("-s", "second", "export", "test", test)).code, 0)
            assert.include(
              fs.readFileSync(test, "utf8"),
              `// The session started from session first's state (start --fork), which no file holds: this test's context starts empty\n        const context = yield* Browser.newContext({ focus: "emulated" })\n`
            )
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
          // A popup a click's timer opens while a later click on another page waits for its button is the first
          // click's, which acted on its opener
          const late = `${served.origin}/fixture?html=${
            encodeURIComponent(
              `<button id="late" disabled>Late</button><script>setTimeout(() => { document.getElementById("late").disabled = false }, 3000)</script>`
            )
          }`
          assert.strictEqual((yield* tools("page", "new", "--name", "aside", late)).code, 0)
          const before = names(yield* tools("pages"))
          assert.strictEqual((yield* tools("-p", "shop", "click", `role=button[name="Later"]`)).code, 0)
          const waited = yield* tools("-p", "aside", "click", "css=#late")
          assert.strictEqual(waited.code, 0, waited.err)
          const later = names(yield* tools("pages")).find((name) => !before.includes(name))
          assert.isDefined(later, "the click's popup opened as aside's click waited")
          assert.strictEqual((yield* tools("-p", later!, "expect", "css=p", "visible")).code, 0)
          // The test leaves it to the segment's placeholder to declare
          const test = path.join(env.XDG_RUNTIME_DIR, "tools.test.ts")
          assert.strictEqual((yield* tools("export", "test", test)).code, 0)
          const exported = fs.readFileSync(test, "utf8")
          assert.match(
            exported,
            new RegExp(
              `const (shopPopups\\w*) = yield\\* Popup\\.next\\(shop\\)\\n\\s+yield\\* shop\\.getByRole\\("button", \\{ name: "Later", exact: true \\}\\)\\.click\\(\\)\\n\\s+const ${later} = yield\\* \\1\\n`
            )
          )
          assert.include(exported, `: a segment runs only in a session; put its steps here, declaring kept\n`)
          assert.include(exported, `yield* kept.goto(${JSON.stringify(url)})\n`)
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
            ...handshake,
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
