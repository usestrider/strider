/**
 * The `strider` command (CLI.md; review 20, candidate 6), run as a person or an agent runs it: as processes, with a
 * session's daemon in between. A session started on the pinned Chromium is driven by page name and target,
 * waits across commands, declares routes and dialog decisions, runs a segment, saves its state, exports a test
 * and stops; a second session forks the first's state; a daemon killed outright is listed and pruned; and the
 * mistakes a command can make fail at once, with an exit code of their own.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { execFile } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { site } from "./adapter/harness.ts"
import { chromium, firefox } from "./browsers.ts"

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

const environment = () => ({
  XDG_RUNTIME_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "strider-cli-")),
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
      assert.match(started.out, /^session shop · .* at .* · idle timeout 1h/)
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
        assert.include(exported, `const shop = yield* context.newPage`)
        assert.include(exported, `shop.getByRole("button", { name: "Sign in", exact: true }).click()`)
        assert.include(exported, `.fill(yield* Config.Redacted("SECRET_PW"))`)
        assert.include(exported, `const w1 = yield* Popup.next(shop)`)
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
        const pruned = yield* run("prune", "first")
        assert.match(pruned.out, /^removed .*first/)
        assert.isFalse(fs.existsSync(path.join(env.XDG_RUNTIME_DIR, "strider", "first")))
      })),
    timeout
  )

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
