/**
 * The `strider` command (CLI.md), run as a person or an agent runs it: as processes, with a
 * session's daemon in between. A session started on the pinned Chromium is driven by page name and target,
 * waits across commands, declares routes and dialog decisions, runs a segment, saves its state, exports a test
 * and stops; a second session forks the first's state; a daemon killed outright is listed and pruned; and the
 * mistakes a command can make fail at once, with an exit code of their own.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import { WebKit } from "@usestrider/browser/webkit"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import { execFile, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as http from "node:http"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import * as Daemon from "../../src/internal/cli/daemon.ts"
import * as WebKitStockTransport from "../../src/internal/webkitStockTransport.ts"
import { site } from "./adapter/harness.ts"
import { chromium, firefox, webkitgtk } from "./browsers.ts"
import { chromiumAttachable, firefoxAttachable } from "./slice/attaching.ts"
import { startMiniBrowser, useXvfb } from "./stockWebKit.ts"

/** Browser-reported target identities, independent of whether its HTTP server still answers. */
const inspectorTargetIds = (endpoint: string, backend: "Chromium" | "stock WebKit") =>
  Effect.promise(async () => {
    const response = await fetch(new URL(backend === "Chromium" ? "/json/list" : "/", endpoint))
    assert.strictEqual(response.status, 200)
    return backend === "Chromium"
      ? ((await response.json()) as ReadonlyArray<{ readonly id: string }>).map((target) => target.id)
      : [...WebKitStockTransport.pagesOf(await response.text())]
  })

const timeout = 120_000
const bin = new URL("../../src/bin/strider.ts", import.meta.url).pathname
const fixtures = new URL("../fixtures/segments/", import.meta.url).pathname

const segmentImports = `
import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))}
import * as Schema from ${JSON.stringify(import.meta.resolve("effect/Schema"))}
import { CurrentSession, Segment } from ${JSON.stringify(new URL("../../src/cli/index.ts", import.meta.url).href)}
`

/** A run of `strider`, with the environment given: its exit code and output. */
const strider = (env: Record<string, string>, ...args: ReadonlyArray<string>) =>
  Effect.callback<{ readonly code: number; readonly out: string; readonly err: string }>((resume) => {
    execFile(
      process.execPath,
      [bin, ...args],
      { env: { ...process.env, ...env }, timeout: 90_000 },
      (error, out, err) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1
        if (env["STRIDER_VIEWPORT_DIAGNOSTIC"]) {
          fs.appendFileSync(
            path.join(env["STRIDER_VIEWPORT_DIAGNOSTIC"], "children.ndjson"),
            JSON.stringify({ args, code, out: String(out), err: String(err) }) + "\n"
          )
        }
        resume(Effect.succeed({ code, out: String(out), err: String(err) }))
      }
    )
  })

/**
 * `strider mcp` as a client runs it: messages written to its standard input, answers read until every request up to
 * the last id has one, in whatever order the server answers them.
 */
const mcp = (env: Record<string, string>, args: ReadonlyArray<string>, messages: ReadonlyArray<object>, last: number) =>
  Effect.callback<ReadonlyArray<any>>((resume) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    })
    const pending = new Set(
      messages.flatMap((message: any) => typeof message.id === "number" && message.id <= last ? [message.id] : [])
    )
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
        pending.delete(answer.id)
        if (pending.size === 0) {
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

/** Tool calls through one `strider mcp`, which may run them at once: each call's answer, in the calls' order. */
const mcpTools = (
  env: Record<string, string>,
  args: ReadonlyArray<string>,
  calls: ReadonlyArray<{ readonly name: string; readonly arguments: object }>
) =>
  mcp(env, args, [
    ...handshake,
    ...calls.map((params, index) => ({ jsonrpc: "2.0", id: index + 2, method: "tools/call", params }))
  ], calls.length + 1).pipe(
    Effect.map((answers) => calls.map((_, index) => answers.find((answer) => answer.id === index + 2)))
  )

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
  it.live(
    "reports a failed call's digest through MCP and only once with JSON",
    () =>
      Effect.scoped(Effect.gen(function*() {
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, "-s", "failure-digest", ...args)
        const started = yield* strider(env, "start", "--name", "failure-digest", "--chromium", chromium.executable)
        assert.strictEqual(started.code, 0, started.err)
        try {
          assert.strictEqual((yield* run("page", "new", "--name", "main", "about:blank")).code, 0)
          const emit = () => run("-p", "main", "eval", "console.error('pending failure event')")
          assert.strictEqual((yield* emit()).code, 0)
          const [answer] = yield* mcpTools(env, ["-s", "failure-digest", "mcp"], [{
            name: "goto",
            arguments: { page: "missing", url: "https://example.test/%typo%" }
          }])
          assert.isTrue(answer.result.isError)
          const failure = JSON.parse(answer.result.content[0].text)
          assert.strictEqual(failure.error, "PageNotFound")
          assert.include(failure.message, "%typo% names no secret")
          assert.deepStrictEqual(failure.sinceLast, ["console error on main: pending failure event"])
          assert.notInclude((yield* run("pages")).out, "pending failure event")
          assert.strictEqual((yield* emit()).code, 0)
          const json = yield* run("-p", "missing", "--json", "goto", "https://example.test/%typo%")
          assert.strictEqual(json.code, 16, json.err)
          const outcome = JSON.parse(json.out).outcome
          assert.strictEqual(outcome.error, "PageNotFound")
          assert.include(outcome.message, "%typo% names no secret")
          assert.deepStrictEqual(outcome.sinceLast, ["console error on main: pending failure event"])
          assert.notInclude((yield* run("pages")).out, "pending failure event")
          assert.notInclude(json.err, "pending failure event")
        } finally {
          yield* run("stop")
        }
      })),
    timeout
  )

  it.live("evaluates browser expressions and function files", () =>
    Effect.scoped(Effect.gen(function*() {
      const env = environment()
      const run = (...args: ReadonlyArray<string>) => strider(env, "-s", "evaluation", ...args)
      const started = yield* strider(env, "start", "--name", "evaluation", "--chromium", chromium.executable)
      assert.strictEqual(started.code, 0, started.err)
      try {
        assert.strictEqual((yield* run("page", "new", "--name", "main", "about:blank")).code, 0)
        const evaluate = (...args: ReadonlyArray<string>) => run("-p", "main", "--json", "eval", ...args)
        const result = yield* evaluate("Promise.resolve({answer: 42})")
        assert.strictEqual(result.code, 0, result.err)
        assert.deepStrictEqual(JSON.parse(result.out).value, { answer: 42 })
        assert.notInclude(result.out, "Promise.resolve")
        for (const args of [[], ["--file", "/missing-eval.js"], ["1", "--file", "/missing-eval.js"]]) {
          assert.notStrictEqual((yield* evaluate(...args)).code, 0)
        }
        const file = path.join(env.XDG_RUNTIME_DIR, "fn.js")
        fs.writeFileSync(file, "async () => { document.title = 'changed'; return 7n }")
        const fromFile = yield* evaluate("--file", file)
        assert.strictEqual(fromFile.code, 0, fromFile.err)
        assert.deepStrictEqual(JSON.parse(fromFile.out).value, { type: "bigint", value: "7" })
        assert.strictEqual(JSON.parse((yield* evaluate("document.title")).out).value, "changed")
        fs.writeFileSync(file, "() => typeof process")
        const relative = yield* evaluate("--file", path.relative(process.cwd(), file))
        assert.strictEqual(relative.code, 0, relative.err)
        assert.strictEqual(JSON.parse(relative.out).value, "undefined")
        for (
          const [source, expected] of [
            ["undefined", { type: "undefined" }],
            ["NaN", { type: "number", value: "NaN" }],
            ["[true, null, 'value']", [true, null, "value"]]
          ] as const
        ) {
          const value = yield* evaluate(source)
          assert.strictEqual(value.code, 0, value.err)
          assert.deepStrictEqual(JSON.parse(value.out).value, expected)
        }
        for (const source of ["import x from 'node:fs'", "export default () => 1", "not valid javascript", "42"]) {
          fs.writeFileSync(file, source)
          assert.notStrictEqual((yield* evaluate("--file", file)).code, 0)
        }
        assert.notStrictEqual((yield* run("-p", "missing", "eval", "1")).code, 0)
        assert.notStrictEqual((yield* run("--json", "eval", "1")).code, 0)
        assert.notStrictEqual((yield* evaluate("(() => { throw Error('broken') })()")).code, 0)
        assert.strictEqual((yield* evaluate("--main-world", "globalThis.onlyMain = 9")).code, 0)
        assert.deepStrictEqual(JSON.parse((yield* evaluate("typeof globalThis.onlyMain")).out).value, "undefined")
        const exported = path.join(env.XDG_RUNTIME_DIR, "export.ts")
        assert.strictEqual((yield* run("export", "test", exported)).code, 0)
        assert.include(fs.readFileSync(exported, "utf8"), "TODO strider eval")
        assert.notInclude(fs.readFileSync(exported, "utf8"), "onlyMain")
      } finally {
        yield* run("stop")
      }
    })), timeout)

  it.live(
    "eval accepts function files ending in a semicolon, after load-phase input errors",
    () =>
      Effect.scoped(Effect.gen(function*() {
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, "-s", "eval-phases", ...args)
        const started = yield* strider(env, "start", "--name", "eval-phases", "--chromium", chromium.executable)
        assert.strictEqual(started.code, 0, started.err)
        try {
          assert.strictEqual((yield* run("page", "new", "--name", "main", "about:blank")).code, 0)
          const evaluate = (...args: ReadonlyArray<string>) => run("-p", "main", "--json", "eval", ...args)
          const missing = yield* evaluate("--file", path.join(env.XDG_RUNTIME_DIR, "missing.js"))
          assert.notStrictEqual(missing.code, 0)
          const inputError = JSON.parse(missing.err)
          assert.deepStrictEqual(Object.keys(inputError).sort(), ["durationMs", "error", "file", "message", "phase"])
          assert.strictEqual(inputError.file, "eval")
          assert.strictEqual(inputError.error, "InvalidInput")
          assert.strictEqual(inputError.phase, "load")
          assert.isString(inputError.message)
          assert.isAtLeast(inputError.durationMs, 0)
          const neither = yield* evaluate()
          assert.notStrictEqual(neither.code, 0)
          assert.strictEqual(JSON.parse(neither.err).error, "InvalidInput")
          assert.strictEqual(JSON.parse(neither.err).phase, "load")
          const both = yield* evaluate("1", "--file", "unused.js")
          assert.strictEqual(JSON.parse(both.err).error, "InvalidInput")
          assert.strictEqual(JSON.parse(both.err).phase, "load")
          const file = path.join(env.XDG_RUNTIME_DIR, "formatted.js")
          // A formatter ends a function expression statement with a semicolon.
          fs.writeFileSync(file, "async () => {\n  return document.title\n};\n")
          const formatted = yield* evaluate("--file", file)
          assert.strictEqual(formatted.code, 0, formatted.err)
          const result = JSON.parse(formatted.out)
          assert.deepStrictEqual(Object.keys(result).sort(), ["durationMs", "file", "handles", "value"])
          assert.strictEqual(result.file, "eval")
          assert.strictEqual(result.value, "")
          assert.deepStrictEqual(result.handles, {})
          assert.isAtLeast(result.durationMs, 0)
          for (
            const [source, expected] of [
              ["Promise.resolve(42);  \n", 42],
              ["'inside;string';", "inside;string"],
              ["(() => { /* preserve; comment */ return 'value;' })();", "value;"],
              ["(() => { // preserve; line comment\n return 'line;' })();", "line;"],
              [
                "(() => { /* preserve; comment */ return 'value;' }).toString();",
                "() => { /* preserve; comment */ return 'value;' }"
              ],
              ["globalThis.evalCount = (globalThis.evalCount ?? 0) + 1;", 1],
              ["globalThis.evalCount", 1]
            ] as const
          ) {
            const evaluated = yield* evaluate(source)
            assert.strictEqual(evaluated.code, 0, evaluated.err)
            assert.strictEqual(JSON.parse(evaluated.out).value, expected)
          }
          fs.writeFileSync(file, "() => { /* preserve; comment */ return 'file;string' };\n")
          const strings = yield* evaluate("--file", file)
          assert.strictEqual(strings.code, 0, strings.err)
          assert.strictEqual(JSON.parse(strings.out).value, "file;string")
          assert.notStrictEqual((yield* evaluate("globalThis.evalCount = 99; 42;")).code, 0)
          assert.strictEqual(JSON.parse((yield* evaluate("globalThis.evalCount")).out).value, 1)
          assert.notStrictEqual((yield* evaluate("42;;")).code, 0)
        } finally {
          yield* run("stop")
        }
      })),
    timeout
  )

  for (const capture of ["local", "strict"]) {
    it.live(`captures eval successes and failures with ${capture} capture`, () =>
      Effect.scoped(Effect.gen(function*() {
        const env = { ...environment(), EVAL_SECRET: "eval-private" }
        const run = (...args: ReadonlyArray<string>) => strider(env, "-s", "eval-capture", ...args)
        const started = yield* strider(
          env,
          "start",
          "--name",
          "eval-capture",
          "--chromium",
          chromium.executable,
          "--capture",
          capture,
          "--secret",
          "token=EVAL_SECRET"
        )
        assert.strictEqual(started.code, 0, started.err)
        try {
          yield* run("page", "new", "--name", "main", "about:blank")
          const evaluate = (...args: ReadonlyArray<string>) => run("-p", "main", "--json", "eval", ...args)
          const value = yield* evaluate("'eval-private'")
          assert.strictEqual(value.code, 0, value.err)
          assert.strictEqual(JSON.parse(value.out).value, capture === "local" ? "%token%" : "•••")
          const failure = yield* evaluate("(() => { document.title = 'acted'; throw Error('eval-private') })()")
          assert.notStrictEqual(failure.code, 0)
          assert.notInclude(failure.err, "eval-private")
          const detail = JSON.parse(failure.err)
          assert.strictEqual(detail.file, "eval")
          assert.strictEqual(detail.phase, "execute")
          if (capture === "strict") assert.include(detail.message, "masked")
          const cycle = yield* evaluate("(() => { const x = {}; x.x = x; return x })()")
          assert.notStrictEqual(cycle.code, 0)
          assert.notInclude(cycle.err, "const x")
          const cycleError = JSON.parse(cycle.err)
          assert.strictEqual(cycleError.error, "PageError")
          assert.strictEqual(cycleError.reason, "NotSerializable")
          assert.strictEqual(cycleError.phase, "execute")
          const exported = path.join(env.XDG_RUNTIME_DIR, "eval-export.ts")
          yield* run("export", "test", exported)
          const text = fs.readFileSync(exported, "utf8")
          assert.strictEqual(text.split("TODO strider eval").length - 1, 3)
          assert.notInclude(text, "eval-private")
          assert.notInclude(text, "document.title")
        } finally {
          yield* run("stop")
        }
      })), timeout)
  }
  for (const capture of ["local", "strict"]) {
    it.live(
      `prints segment values and validates typed arguments with ${capture} capture`,
      () =>
        Effect.scoped(Effect.gen(function*() {
          const env = { ...environment(), SEGMENT_SECRET: "return-secret" }
          const run = (...args: ReadonlyArray<string>) => strider(env, "-s", "segments", ...args)
          const file = path.join(env.XDG_RUNTIME_DIR, "segment.ts")
          const write = (body: string) => fs.writeFileSync(file, segmentImports + body)
          const started = yield* strider(
            env,
            "start",
            "--name",
            "segments",
            "--chromium",
            chromium.executable,
            "--capture",
            capture,
            "--secret",
            "token=SEGMENT_SECRET"
          )
          assert.strictEqual(started.code, 0, started.err)
          try {
            write(
              "export default Segment.make(Schema.Record(Schema.String, Schema.Never), () => Effect.succeed({status:200, body:\"return-secret\"}))"
            )
            const plain = yield* run("run", file)
            assert.strictEqual(plain.code, 0, plain.err)
            assert.include(plain.out, capture === "local" ? "→ {\"status\":200,\"body\":\"%token%\"}" : "→ \"•••\"")
            const printed = yield* run("--json", "run", file)
            assert.strictEqual(printed.code, 0, printed.err)
            const result = JSON.parse(printed.out)
            assert.deepStrictEqual(result.value, capture === "local" ? { status: 200, body: "%token%" } : "•••")
            assert.deepStrictEqual(result.handles, {})
            assert.strictEqual(result.file, file)
            assert.isAtLeast(result.durationMs, 0)
            assert.notInclude(printed.out, "return-secret")
            const unexpected = yield* run("run", file, "--arg", "unexpected=yes", "--json")
            assert.strictEqual(unexpected.code, 15, unexpected.err)

            yield* run("page", "new", "--name", "main", "about:blank")
            write(
              `export default Segment.make(Schema.Record(Schema.String, Schema.Never), Effect.fnUntraced(function*() {
            const session = yield* CurrentSession.CurrentSession
            return yield* session.page("main")
          }))`
            )
            const handle = yield* run("run", file, "--json")
            assert.strictEqual(handle.code, 0, handle.err)
            assert.strictEqual(JSON.parse(handle.out).value, "main")
            assert.strictEqual(JSON.parse(handle.out).handles.main.type, "page")
            assert.include((yield* run("run", file)).out, "→ main")

            write(`export default Segment.make(Schema.Struct({
            tag: Schema.String, count: Schema.NumberFromString.check(Schema.isInt()), payload: Schema.Struct({ id: Schema.Number })
          }), Effect.fnUntraced(function*(args) {
            const session = yield* CurrentSession.CurrentSession
            const page = yield* session.page("main")
            yield* page.goto("data:text/html,<title>callback ran</title>")
            return args
          }))`)
            const payload = path.join(env.XDG_RUNTIME_DIR, "payload.json")
            fs.writeFileSync(payload, "{\"id\":42}")
            fs.writeFileSync(`${payload}.invalid`, "{broken")
            for (
              const args of [
                [],
                ["--arg", "tag=update", "--arg", "count=bad", "--arg", `payload=@${payload}`],
                ["--arg", "count=1", "--arg", "count=2"],
                ["--arg", "bad"],
                ["--arg", `payload=@${payload}.invalid`],
                [
                  "--arg",
                  `payload=@${payload}.missing`
                ],
                ["--arg", "tag=update", "--arg", "count=2", "--arg", `payload=@${payload}`, "--arg", "typo=yes"]
              ]
            ) {
              const invalid = yield* run("run", file, "--json", ...args)
              assert.strictEqual(invalid.code, 15, JSON.stringify({ args, ...invalid }))
              assert.strictEqual(JSON.parse(invalid.err).phase, "arguments")
            }
            assert.include((yield* run("pages")).out, "about:blank")
            const args = yield* run(
              "run",
              file,
              "--arg",
              "tag=@@update=Unit",
              "--arg",
              "count=2",
              "--arg",
              `payload=@${path.relative(process.cwd(), payload)}`,
              "--json"
            )
            assert.strictEqual(args.code, 0, args.err)
            assert.deepStrictEqual(
              JSON.parse(args.out).value,
              capture === "local" ? { tag: "@update=Unit", count: 2, payload: { id: 42 } } : "•••"
            )

            write(
              `export default Segment.make(Schema.Record(Schema.String, Schema.Never), Effect.fnUntraced(function*() {
            const session = yield* CurrentSession.CurrentSession
            const page = yield* session.page("main")
            yield* page.goto("data:text/html,<title>earlier step</title>")
            return yield* page.getByText("missing").readText
          }))`
            )
            const failed = yield* run("run", file, "--json")
            assert.strictEqual(failed.code, 10, failed.err)
            const failure = JSON.parse(failed.err)
            assert.strictEqual(failure.error, "LocatorError")
            assert.strictEqual(failure.reason, "NoMatch")
            assert.strictEqual(failure.phase, "execute")
            assert.include(failure.step, "readText")
            assert.isString(failure.hint)
            assert.include((yield* run("pages")).out, "earlier")

            write(
              "export default Segment.make(Schema.Record(Schema.String, Schema.Never), () => Effect.sync(() => { const value = {}; value.self = value; return value }))"
            )
            const cycle = yield* run("run", file, "--json")
            assert.strictEqual(cycle.code, 1, cycle.err)
            assert.strictEqual(JSON.parse(cycle.err).error, "NotSerializable")
            assert.strictEqual(JSON.parse(cycle.err).phase, "serialize")

            write(
              "export default Segment.make(Schema.Record(Schema.String, Schema.Never), () => Effect.die(new Error(\"return-secret\")))"
            )
            const defect = yield* run("run", file, "--json")
            assert.strictEqual(defect.code, 1)
            assert.strictEqual(JSON.parse(defect.err).phase, "execute")
            assert.notInclude(defect.err, "return-secret")

            write("export default Effect.void")
            const legacy = yield* run("run", file, "--json")
            assert.strictEqual(legacy.code, 15)
            assert.strictEqual(JSON.parse(legacy.err).phase, "load")
            if (capture === "local") assert.include(legacy.err, "Segment.make")

            write(
              "export default Segment.make(Schema.Record(Schema.String, Schema.Never), () => Effect.succeed(\"x\".repeat(5000)))"
            )
            const large = yield* run("run", file)
            assert.strictEqual(large.code, 0, large.err)
            if (capture === "local") assert.include(large.out, "truncated")
            const full = yield* run("run", file, "--json")
            assert.strictEqual(full.code, 0, full.err)
            assert.strictEqual(JSON.parse(full.out).value, capture === "local" ? "x".repeat(5000) : "•••")
          } finally {
            yield* run("stop")
          }
        })).pipe(Effect.provide(NodeServices.layer)),
      timeout
    )
  }
  it.live(
    "refuses viewport sizing on inspector-only stock WebKit without replacing prior scope",
    () =>
      Effect.scoped(
        Effect.gen(function*() {
          const served = yield* site
          const launched = yield* startMiniBrowser(served.origin)
          const services = yield* Layer.build(
            WebKit.layerAttach(launched.endpoint).pipe(
              Layer.provide(NodeSocket.layerWebSocketConstructor)
            )
          )
          const browser = yield* Browser.Browser.pipe(Effect.provideContext(services))
          const page = yield* (yield* browser.pages)[0]!.control
          const before = yield* page.evaluateInMainWorld(() => [innerWidth, innerHeight])
          const previous = yield* Scope.make()
          let closed = false
          yield* Scope.addFinalizer(
            previous,
            Effect.sync(() => {
              closed = true
            })
          )
          const owner = { scope: yield* Effect.scope, viewports: new Map([[page.id, previous]]) }
          yield* Scope.addFinalizer(owner.scope, Scope.close(previous, Exit.void))
          const error = yield* Daemon.setViewport(owner, page, { width: 800, height: 600 }).pipe(Effect.flip)
          assert.strictEqual(error._tag, "DeclarationError")
          if (error._tag !== "DeclarationError") return assert.fail("Expected a capability refusal")
          assert.strictEqual(error.reason._tag, "Unsupported")
          if (error.reason._tag === "Unsupported") assert.strictEqual(error.reason.capability, "emulation.viewport")
          assert.strictEqual(owner.viewports.get(page.id), previous)
          assert.isFalse(closed)
          assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => [innerWidth, innerHeight]), before)
        }).pipe(Effect.provide(NodeServices.layer))
      ),
    timeout
  )

  for (
    const [backend, executable] of [["chromium", chromium.executable], ["firefox", firefox.executable], [
      "webkit",
      webkitgtk.executable
    ]] as const
  ) {
    for (const capture of ["local", "strict"]) {
      it.live(
        `${backend} discovers password controls with ${capture} capture`,
        () =>
          Effect.scoped(
            Effect.gen(function*() {
              if (backend === "webkit") yield* useXvfb("1920x1200x24")
              const server = http.createServer((_, response) => {
                response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
                response.end(
                  `<input type="password" value="private-unlabeled"><label>Account password<input type="password" value="private-labeled"></label><label>Code<input id="code" type="password" role="textbox" value="private-explicit"></label><button aria-labelledby="code">Show</button>`
                )
              })
              yield* Effect.acquireRelease(
                Effect.callback<void>((resume) => void server.listen(0, "127.0.0.1", () => resume(Effect.void))),
                () => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())))
              )
              const { port } = server.address() as { readonly port: number }
              const env = environment()
              const run = (...args: ReadonlyArray<string>) => strider(env, "-s", "passwords", ...args)
              const started = yield* strider(
                env,
                "start",
                "--name",
                "passwords",
                "--capture",
                capture,
                `--${backend}`,
                executable
              )
              assert.strictEqual(started.code, 0, started.err)
              try {
                const opened = yield* run("page", "new", "--name", "form", `http://127.0.0.1:${port}/form`)
                assert.strictEqual(opened.code, 0, opened.err)
                const page = (...args: ReadonlyArray<string>) => run("-p", "form", ...args)
                const snapshot = yield* page("snapshot")
                const all = yield* page("--json", "find", "")
                const found = yield* page("--json", "find", "Password")
                const labeled = yield* page("--json", "find", "Account password")
                for (const result of [snapshot, all, found, labeled]) {
                  assert.strictEqual(result.code, 0, result.err)
                  assert.notInclude(result.out, "private-unlabeled")
                  assert.notInclude(result.out, "private-labeled")
                  assert.notInclude(result.out, "private-explicit")
                }
                for (
                  const [query, extra, expected] of [
                    ["password", ["--exact"], 2],
                    ["Password", ["--exact"], 0],
                    ["Account password", ["--exact"], 1],
                    ["password", ["--role", "textbox"], 0],
                    ["password", ["--role", "editable"], 2],
                    ["private-unlabeled", [], 0],
                    ["private-labeled", [], 0],
                    ["private-explicit", [], 0]
                  ] as const
                ) {
                  const result = yield* page("--json", "find", query, ...extra)
                  assert.strictEqual(result.code, 0, result.err)
                  assert.lengthOf(JSON.parse(result.out).outcome.value, expected, result.out)
                }
                const matches = JSON.parse(found.out).outcome.value as ReadonlyArray<unknown>
                assert.strictEqual(
                  matches.length,
                  2,
                  JSON.stringify({ snapshot: snapshot.out, all: all.out, found: found.out, labeled: labeled.out })
                )
              } finally {
                yield* run("stop")
              }
            }).pipe(Effect.provide(NodeServices.layer))
          ),
        timeout
      )
    }

    it.live(`${backend} preserves startup and repeated page viewports`, () =>
      Effect.scoped(
        Effect.gen(function*() {
          if (backend === "webkit") yield* useXvfb("1920x1200x24")
          const diagnostic = backend === "webkit" ? process.env["STRIDER_RECORD"] : undefined
          const env = {
            ...environment(),
            ...(diagnostic === undefined ? {} : {
              STRIDER_VIEWPORT_DIAGNOSTIC: diagnostic,
              NODE_OPTIONS: `--import=${new URL("../fixtures/segments/viewport-wire.mjs", import.meta.url).pathname}`
            })
          }
          const run = (...args: ReadonlyArray<string>) => strider(env, "-s", "sized", ...args)
          const started = yield* strider(
            env,
            "start",
            "--name",
            "sized",
            `--${backend}`,
            executable,
            "--viewport",
            "1440x1000"
          )
          assert.strictEqual(started.code, 0, started.err)
          let browserPids: Array<number> = []
          try {
            const ledger = path.join(env.XDG_STATE_HOME, "strider", "ledger")
            const records = fs.readdirSync(ledger).map((file) =>
              JSON.parse(fs.readFileSync(path.join(ledger, file), "utf8"))
            )
            const owned = records.flatMap((record) => record.items).filter((item) => item._tag === "Browser")
            // Stock WebKit owns the initial browser and the context's automation process.
            assert.isAtLeast(owned.length, 1)
            browserPids = owned.map((item) => item.pid)
            assert.include(started.out, "requested viewport default 1440x1000")
            const served = yield* site
            const html =
              `<p id="size"></p><script>function size() { document.querySelector('#size').textContent = innerWidth + 'x' + innerHeight }; onresize = size; size()</script>`
            const url = `${served.origin}/fixture?html=${encodeURIComponent(html)}`
            for (const name of ["first", "second"]) {
              assert.strictEqual((yield* run("page", "new", "--name", name, url)).code, 0)
              const checked = yield* run("-p", name, "expect", "css=#size", "visible", "--text", "1440x1000")
              if (diagnostic !== undefined) {
                const measured = yield* run("run", path.join(fixtures, "viewport-dimensions.ts"))
                fs.appendFileSync(
                  path.join(diagnostic, "measurements.ndjson"),
                  JSON.stringify({ name, measured, listing: yield* run("pages") }) + "\n"
                )
              }
              assert.strictEqual(checked.code, 0, JSON.stringify({ name, ...checked }))
            }
            for (const size of ["800x600", "1200x900", "640x480"]) {
              const resized = yield* run("-p", "first", "page", "viewport", size)
              assert.strictEqual(resized.code, 0, resized.err)
              assert.strictEqual((yield* run("-p", "first", "expect", "css=#size", "visible", "--text", size)).code, 0)
            }
            for (const size of ["0x600", "-1x600", "1.5x600", "800X600", "9007199254740992x600"]) {
              assert.notStrictEqual((yield* run("-p", "first", "page", "viewport", size)).code, 0)
            }
            assert.strictEqual(
              (yield* run("-p", "first", "expect", "css=#size", "visible", "--text", "640x480")).code,
              0
            )
            assert.strictEqual(
              (yield* run("-p", "second", "expect", "css=#size", "visible", "--text", "1440x1000")).code,
              0
            )
            const file = path.join(env.XDG_RUNTIME_DIR, "sized.test.ts")
            assert.strictEqual((yield* run("export", "test", file)).code, 0)
            const exported = fs.readFileSync(file, "utf8")
            assert.include(exported, "emulation: { viewport: { width: 1440, height: 1000 } }")
            assert.include(exported, "width: 640, height: 480")
            assert.notInclude(exported, "9007199254740992")
          } finally {
            if (diagnostic !== undefined) {
              fs.cpSync(env.XDG_RUNTIME_DIR, path.join(diagnostic, "runtime"), {
                recursive: true,
                filter: (file) => !fs.lstatSync(file).isSocket()
              })
              fs.cpSync(env.XDG_STATE_HOME, path.join(diagnostic, "state"), { recursive: true })
            }
            const stopped = yield* run("stop")
            if (diagnostic !== undefined) {
              fs.writeFileSync(
                path.join(diagnostic, "cleanup.json"),
                JSON.stringify({
                  stopped,
                  browserPids,
                  alive: browserPids.filter((pid) => {
                    try {
                      process.kill(pid, 0)
                      return true
                    } catch {
                      return false
                    }
                  })
                })
              )
            }
            assert.strictEqual(stopped.code, 0, stopped.err)
          }
          const deadline = Date.now() + 5000
          const alive = (browserPid: number) => {
            try {
              process.kill(browserPid, 0)
              return true
            } catch {
              return false
            }
          }
          while (browserPids.some(alive) && Date.now() < deadline) yield* Effect.sleep("10 millis")
          for (const browserPid of browserPids) {
            assert.isFalse(alive(browserPid), `owned ${backend} process ${browserPid} survived stop`)
          }
          assert.notInclude((yield* strider(env, "sessions")).out, "sized")
          const invalid = yield* strider(
            env,
            "start",
            "--name",
            "invalid",
            `--${backend}`,
            executable,
            "--viewport",
            "0x600"
          )
          assert.notStrictEqual(invalid.code, 0)
          assert.include(invalid.err, "positive integer CSS pixels")
          assert.isFalse(fs.existsSync(path.join(env.XDG_RUNTIME_DIR, "strider", "invalid")))
        }).pipe(Effect.provide(NodeServices.layer))
      ), timeout)
  }

  it.live("starts a stock WebKit session, drives a page, refuses download waits, and stops", () =>
    Effect.scoped(
      Effect.gen(function*() {
        yield* useXvfb()
        const served = yield* site
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
        const session = (...args: ReadonlyArray<string>) => run("-s", "webkit", ...args)
        const removed = yield* Deferred.make<void>()
        const directory = path.join(env.XDG_RUNTIME_DIR, "strider", "webkit")
        try {
          const started = yield* run("start", "--name", "webkit", "--webkit", webkitgtk.executable)
          assert.strictEqual(started.code, 0, started.err)
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              fs.watch(path.dirname(directory), () => {
                if (!fs.existsSync(directory)) Deferred.doneUnsafe(removed, Exit.void)
              })
            ),
            (watcher) => Effect.sync(() => watcher.close())
          )
          assert.include(started.out, "focus system")
          const url = `${served.origin}/fixture?html=${
            encodeURIComponent(`<button onclick="this.textContent = 'Done'">Go</button>`)
          }`
          const opened = yield* session("page", "new", "--name", "home", url)
          assert.strictEqual(opened.code, 0, opened.err)
          const isolated = yield* session("-p", "home", "--json", "eval", "1")
          assert.notStrictEqual(isolated.code, 0)
          assert.strictEqual(JSON.parse(isolated.err).reason, "Unsupported")
          const evaluated = yield* session("-p", "home", "--json", "eval", "--main-world", "Promise.resolve(42)")
          assert.strictEqual(evaluated.code, 0, evaluated.err)
          assert.strictEqual(JSON.parse(evaluated.out).value, 42)
          const clicked = yield* session("-p", "home", "click", "role=button[name=\"Go\"]")
          assert.strictEqual(clicked.code, 0, clicked.err)
          const checked = yield* session("-p", "home", "expect", "css=button", "visible", "--text", "Done")
          assert.strictEqual(checked.code, 0, checked.err)
          const download = yield* session("-p", "home", "next", "download")
          assert.notStrictEqual(download.code, 0, download.out)
          assert.include(download.err, "SubscriptionError")
          assert.include(download.err, "downloads is unsupported")
        } finally {
          yield* session("stop")
        }
        // Stop acknowledges the request before the daemon finishes releasing its resources.
        yield* Deferred.await(removed).pipe(Effect.timeout("10 seconds"))
        assert.isFalse(fs.existsSync(directory))
        assert.strictEqual((yield* session("pages")).code, 20)
      }).pipe(Effect.provide(NodeServices.layer))
    ), timeout)
  for (const idle of ["15 minutes", "90.125 seconds", "Infinity"]) {
    it.live(`accepts the idle duration printed by start and sessions (${idle})`, () =>
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
          idle
        )
        assert.strictEqual(started.code, 0, started.err)
        try {
          const listed = yield* run("sessions")
          assert.strictEqual(listed.code, 0, listed.err)
          const fromStart = /idle timeout (.+)$/m.exec(started.out)?.[1]
          const fromSessions = /idle .+ of (.+)$/m.exec(listed.out)?.[1]
          assert.isDefined(fromStart, started.out)
          assert.isDefined(fromSessions, listed.out)
          assert.strictEqual(fromStart, idle)
          assert.strictEqual(fromSessions, idle)
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
  }

  for (const position of ["before", "after"] as const) {
    it.live(`stops a session with -s ${position} the subcommand`, () =>
      Effect.gen(function*() {
        const env = { ...environment(), STRIDER_SESSION: "" }
        const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
        const started = yield* run("start", "--name", "checkout", "--chromium", chromium.executable)
        assert.strictEqual(started.code, 0, started.err)
        try {
          // A different environment default must never override an explicit routing flag.
          for (const flags of [["-s", "checkout"], ["--session", "checkout"], ["--session=checkout"]]) {
            for (const args of [[...flags, "pages"], ["pages", ...flags]]) {
              const listed = yield* strider({ ...env, STRIDER_SESSION: "wrong-session" }, ...args)
              assert.strictEqual(listed.code, 0, listed.err)
            }
          }
          const stopped = yield* run(
            ...(position === "before" ? ["-s", "checkout", "stop"] : ["stop", "-s", "checkout"])
          )
          // The stop reply precedes the daemon closing its browser and deleting its directory.
          yield* Effect.sleep("1 second")
          const remaining = yield* run("sessions")
          assert.strictEqual(stopped.code, 0, `${stopped.err}Sessions after stop: ${remaining.out}`)
          assert.include(stopped.out, "stopping checkout")
          assert.strictEqual(remaining.code, 0, remaining.err)
          assert.notInclude(remaining.out, "checkout")
          assert.isFalse(fs.existsSync(path.join(env.XDG_RUNTIME_DIR, "strider", "checkout")))
        } finally {
          yield* run("-s", "checkout", "stop")
          yield* Effect.sleep("1 second")
          fs.rmSync(env.XDG_RUNTIME_DIR, { recursive: true, force: true })
          fs.rmSync(env.XDG_STATE_HOME, { recursive: true, force: true })
        }
      }), timeout)
  }

  it.live("prints an idle duration given with a newline on one line that can be reused", () =>
    Effect.gen(function*() {
      const env = environment()
      const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
      // The duration parser accepts any whitespace between the number and the unit
      const started = yield* run(
        "start",
        "--name",
        "newline",
        "--chromium",
        chromium.executable,
        "--idle",
        "15\nminutes"
      )
      assert.strictEqual(started.code, 0, started.err)
      try {
        const listed = yield* run("sessions")
        assert.strictEqual(listed.code, 0, listed.err)
        const fromStart = /idle timeout (.+)$/m.exec(started.out)?.[1]
        const fromSessions = /idle .+ of (.+)$/m.exec(listed.out)?.[1]
        const results = []
        for (const [name, idle] of [["from-start", fromStart], ["from-sessions", fromSessions]]) {
          const reused = yield* run("start", "--name", name!, "--chromium", chromium.executable, "--idle", idle ?? "")
          results.push({ source: name, idle, code: reused.code, err: reused.err })
        }
        assert.deepStrictEqual(results.map(({ code }) => code), [0, 0], JSON.stringify(results))
      } finally {
        for (const name of ["newline", "from-start", "from-sessions"]) {
          yield* run("-s", name, "stop")
        }
      }
    }), timeout)

  it.live("rejects an invalid idle duration with an example", () =>
    Effect.gen(function*() {
      const result = yield* strider(
        environment(),
        "start",
        "--name",
        "invalid-idle",
        "--chromium",
        chromium.executable,
        "--idle",
        "15m"
      )
      assert.strictEqual(result.code, 15)
      assert.strictEqual(result.err, "InvalidInput: --idle 15m isn't a duration, such as \"30 minutes\"\n")
    }), timeout)

  for (const navigation of ["page new", "goto"] as const) {
    it.live(
      `does not repeat ${navigation}'s own navigation in the next snapshot`,
      () =>
        Effect.scoped(Effect.gen(function*() {
          const served = yield* site
          const url = `${served.origin}/fixture?html=${
            encodeURIComponent("<title>digest boundary</title><p>ready</p>")
          }`
          const env = environment()
          const run = (...args: ReadonlyArray<string>) => strider(env, "-s", "digest", "-p", "main", ...args)
          const started = yield* strider(env, "start", "--name", "digest", "--chromium", chromium.executable)
          assert.strictEqual(started.code, 0, started.err)
          try {
            if (navigation === "goto") {
              const opened = yield* run("page", "new", "--name", "main", "about:blank")
              assert.strictEqual(opened.code, 0, opened.err)
              assert.strictEqual((yield* run("snapshot")).code, 0)
            }
            const navigated = navigation === "page new"
              ? yield* run("page", "new", "--name", "main", url)
              : yield* run("goto", url)
            assert.strictEqual(navigated.code, 0, navigated.err)
            assert.include(navigated.out, `at ${url}`)
            const snapshot = yield* run("snapshot")
            assert.strictEqual(snapshot.code, 0, snapshot.err)
            assert.include(snapshot.out, "document \"digest boundary\"")
            assert.notInclude(snapshot.out, `main navigated to ${url}`)
          } finally {
            yield* run("stop")
          }
        })),
      timeout
    )
  }

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
      assert.match(started.out, /^session shop · .* at .* · focus emulated · idle timeout 1 hour/)
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
        assert.match(segment.out, /^ran .*open-popup\.ts → \{"popup":"p\d+"\}/, segment.err)
        const returned = /"popup":"(p\d+)"/.exec(segment.out)![1]!
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
        assert.notInclude(checked.out, "names no secret")
        // page new puts a secret into its URL as goto does, and prints the URL with its name
        const vault = yield* run("-s", "shop", "page", "new", "--name", "vault", html(`<p id="pw">`, "</p>"))
        assert.strictEqual(vault.code, 0, vault.err)
        assert.include(vault.out, "%password%")
        assert.notInclude(vault.out, "hunter2")
        const unlocked = yield* run("-s", "shop", "-p", "vault", "expect", "css=#pw", "visible", "--text", "%password%")
        assert.strictEqual(unlocked.code, 0, unlocked.err)
        // A navigation that fails doesn't print the secret either
        const unsafe = "http://127.0.0.1:9/?pw=%password%&typo=%pasword%"
        const refused = yield* run("-s", "shop", "page", "new", "--name", "refused", unsafe)
        assert.strictEqual(refused.code, 11, refused.err)
        assert.notInclude(refused.err, "hunter2")
        assert.include(refused.err, "%pasword% names no secret")
        assert.include(refused.err, "Did you mean %password%?")
        assert.notInclude(refused.err, "was sent")
        const plainFailure = yield* shop("--json", "goto", "http://127.0.0.1:9/?pw=%password%")
        const typoFailure = yield* shop("--json", "goto", unsafe)
        assert.strictEqual(plainFailure.code, 11, plainFailure.err)
        assert.strictEqual(typoFailure.code, plainFailure.code, typoFailure.err)
        const originalError = JSON.parse(plainFailure.out).outcome
        const hintedError = JSON.parse(typoFailure.out).outcome
        assert.strictEqual(hintedError._tag, "Failed")
        assert.strictEqual(hintedError.error, originalError.error)
        assert.strictEqual(hintedError.reason, originalError.reason)
        assert.isString(hintedError.reason)
        assert.include(hintedError.message, "%pasword% names no secret")
        assert.include(typoFailure.err, "%pasword% names no secret")
        assert.notInclude(typoFailure.out + typoFailure.err, "hunter2")
        assert.notInclude(hintedError.message, "was sent")
        // It names the URL it was going to, with the secret's name back in
        assert.include(refused.err, "Navigation to http://127.0.0.1:9/?pw=%password%&typo=%pasword% failed")
        // Its page is closed again, so the session holds no page the exported test leaves out
        const held = names(yield* run("-s", "shop", "pages"))
        assert.notInclude(held, "refused")
        // A name that's taken fails before a page opens
        const twice = yield* run("-s", "shop", "page", "new", "--name", "shop", `${url}&typo=%pasword%`)
        assert.strictEqual(twice.code, 15, twice.err)
        assert.include(twice.err, "A page is already named shop")
        assert.include(twice.err, "%pasword% names no secret")
        assert.notInclude(twice.err, "was sent")
        assert.deepStrictEqual(names(yield* run("-s", "shop", "pages")), held)
        // A URL's percent-escapes name no secret, so the URL is sent as written
        const cafe = `${served.origin}/fixture?html=${encodeURIComponent(`<p id="word">café</p>`)}`
        assert.include(cafe, "caf%C3%A9")
        const visited = yield* shop("goto", cafe)
        assert.strictEqual(visited.code, 0, visited.err)
        assert.notInclude(visited.out, "names no secret")
        const escaped = yield* shop("goto", `${cafe}&escaped=%ACtext%20`)
        assert.strictEqual(escaped.code, 0, escaped.err)
        assert.notInclude(escaped.out, "names no secret")
        const warned = yield* shop("goto", `${cafe}&typo=%pasword%`)
        assert.strictEqual(warned.code, 0, warned.err)
        assert.include(warned.out, "%pasword% names no secret")
        assert.include(warned.out, "Did you mean %password%?")
        assert.notInclude(warned.out, "hunter2")
        const warnedJson = yield* shop("--json", "goto", `${cafe}&typo=%pasword%`)
        assert.strictEqual(warnedJson.code, 0, warnedJson.err)
        assert.include(JSON.parse(warnedJson.out).sinceLast.join("\n"), "%pasword% names no secret")
        assert.strictEqual((yield* shop("expect", "css=#word", "visible", "--text", "café")).code, 0)
        // A failed command reports the events since the last one, and the next command doesn't repeat them
        const noisy = `<button onclick="setTimeout(() => console.error('late boom'), 200)">Go</button>`
        assert.strictEqual((yield* shop("goto", `${served.origin}/fixture?html=${encodeURIComponent(noisy)}`)).code, 0)
        assert.strictEqual((yield* shop("click", "css=button")).code, 0)
        const missed = yield* shop("expect", "css=#absent", "visible")
        assert.strictEqual(missed.code, 14, missed.err)
        assert.include(missed.err, "ExpectationFailed")
        assert.include(missed.err, "since last: console error on shop: late boom")
        const after = yield* shop("find", "Go", "--role", "button")
        assert.strictEqual(after.code, 0, after.err)
        assert.notInclude(after.out, "late boom")
        assert.strictEqual((yield* shop("click", "css=button")).code, 0)
        const missedJson = yield* shop("--json", "expect", "css=#absent", "visible")
        assert.strictEqual(missedJson.code, 14, missedJson.err)
        const failed = JSON.parse(missedJson.out)
        assert.strictEqual(failed.outcome._tag, "Failed")
        assert.include(failed.outcome.sinceLast.join("\n"), "console error on shop: late boom")
        // State for a program, and a test of what ran, into directories that don't exist yet
        const state = path.join(env.XDG_RUNTIME_DIR, "auth", "shop.state")
        assert.strictEqual((yield* run("-s", "shop", "state", "save", state)).code, 0)
        assert.strictEqual(fs.statSync(state).mode & 0o777, 0o600)
        // The client resolves relative paths from its cwd, independently of the daemon's startup cwd.
        const repo = path.join(env.XDG_RUNTIME_DIR, "repo")
        fs.mkdirSync(repo)
        yield* Effect.promise(() =>
          new Promise<void>((resolve, reject) => {
            execFile("git", ["init", repo], (error) => error ? reject(error) : resolve())
          })
        )
        const saved = yield* Effect.promise(() =>
          new Promise<{ out: string; err: string }>((resolve, reject) => {
            execFile(process.execPath, [bin, "-s", "shop", "state", "save", "new/auth.state"], {
              cwd: repo,
              env: { ...process.env, ...env }
            }, (error, out, err) => error ? reject(error) : resolve({ out, err }))
          })
        )
        assert.include(saved.out, `to ${path.join(repo, "new/auth.state")}, readable by you alone`)
        assert.include(saved.err, "plaintext credentials")
        assert.include(saved.err, "Git")

        const test = path.join(env.XDG_RUNTIME_DIR, "tests", "shop.test.ts")
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
        assert.include(exported, `const r1 = yield* shop.route("**/api/status", () => Route.fulfill(`)
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
        assert.include(exported, "// %pasword% names no secret")
        assert.notInclude(exported, "%C3% names no secret")
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
    "keeps existing redaction when adding a page creation failure hint",
    () =>
      Effect.scoped(Effect.gen(function*() {
        const env = { ...environment(), SECRET_PW: "password" }
        const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
        const started = yield* run(
          "start",
          "--name",
          "once",
          "--chromium",
          chromium.executable,
          "--secret",
          "password=SECRET_PW"
        )
        assert.strictEqual(started.code, 0, started.err)
        try {
          const failure = yield* run("-s", "once", "page", "new", "http://127.0.0.1:9/?pw=%password%&typo=%pasword%")
          assert.strictEqual(failure.code, 11, failure.err)
          assert.include(failure.err, "Navigation to http://127.0.0.1:9/?pw=%password%&typo=%pasword% failed")
          assert.include(failure.err, "%pasword% names no secret")
          assert.notInclude(failure.err, "pw=password")
          assert.notInclude(failure.err, "was sent")
        } finally {
          yield* run("-s", "once", "stop")
          fs.rmSync(env.XDG_RUNTIME_DIR, { recursive: true, force: true })
        }
      })),
    timeout
  )

  it.live("finishes stop cleanup while keeping the session directory", () =>
    Effect.gen(function*() {
      const env = environment()
      const started = yield* strider(env, "start", "--name", "kept", "--chromium", chromium.executable)
      assert.strictEqual(started.code, 0, started.err)
      const directory = path.join(env.XDG_RUNTIME_DIR, "strider", "kept")
      fs.writeFileSync(path.join(directory, "artifacts", "wanted.txt"), "kept")
      const stopped = yield* strider(env, "-s", "kept", "stop", "--keep")
      assert.strictEqual(stopped.code, 0, stopped.err)
      assert.strictEqual(fs.readFileSync(path.join(directory, "artifacts", "wanted.txt"), "utf8"), "kept")
      assert.isFalse(fs.existsSync(path.join(directory, "sock")))
      assert.isFalse(fs.existsSync(path.join(directory, "lock")))
      assert.deepStrictEqual(fs.readdirSync(path.join(env.XDG_STATE_HOME, "strider", "ledger")), [])
    }), timeout)

  it.live(
    "keeps a same-name replacement's socket when the stopped daemon closes its server",
    () =>
      Effect.promise(async () => {
        const env = environment()
        const barrier = path.join(env.XDG_RUNTIME_DIR, "close")
        const directory = path.join(env.XDG_RUNTIME_DIR, "strider", "restart")
        const socket = path.join(directory, "sock")
        const lock = path.join(directory, "lock")
        const appears = (file: string) =>
          new Promise<void>((resolve, reject) => {
            const signal = AbortSignal.timeout(30_000)
            const watcher = fs.watch(env.XDG_RUNTIME_DIR, check)
            function check() {
              if (fs.existsSync(file)) {
                watcher.close()
                signal.removeEventListener("abort", expired)
                resolve()
              }
            }
            function expired() {
              watcher.close()
              reject(new Error(`${file} did not appear`))
            }
            signal.addEventListener("abort", expired, { once: true })
            check()
          })
        const held = {
          ...env,
          STRIDER_CLOSE_BARRIER: barrier,
          NODE_OPTIONS: `--import=${path.join(fixtures, "stop-close-barrier.mjs")}`
        }
        const run = (environment: Record<string, string>, ...args: ReadonlyArray<string>) =>
          Effect.runPromise(strider(environment, ...args))
        let original: number | undefined
        let replacement: number | undefined
        let stopped: ReturnType<typeof run> | undefined
        try {
          const started = await run(held, "start", "--name", "restart", "--chromium", chromium.executable)
          assert.strictEqual(started.code, 0, started.err)
          original = JSON.parse(fs.readFileSync(lock, "utf8")).pid
          stopped = run(held, "-s", "restart", "stop")
          await appears(`${barrier}.closing`)
          // The listener must give up its unlink action before the session name is released.
          assert.isTrue(fs.existsSync(directory))
          fs.writeFileSync(`${barrier}.release`, "")
          const result = await stopped
          assert.strictEqual(result.code, 0, result.err)
          await appears(`${barrier}.closed`)
          await appears(`${barrier}.finalizing`)
          const restarted = await run(env, "start", "--name", "restart", "--chromium", chromium.executable)
          if (fs.existsSync(lock)) replacement = JSON.parse(fs.readFileSync(lock, "utf8")).pid
          assert.strictEqual(restarted.code, 0, restarted.err)
          assert.isTrue(fs.existsSync(socket))
          fs.writeFileSync(`${barrier}.finish`, "")
          await appears(`${barrier}.finished`)
          // The old server's eventual finalizer must leave the replacement reachable.
          assert.isTrue(fs.existsSync(socket))
          const pages = await run(env, "-s", "restart", "pages")
          assert.strictEqual(pages.code, 0, pages.err)
          assert.strictEqual((await run(env, "-s", "restart", "stop")).code, 0)
        } finally {
          // Release both synchronous holds even when an earlier assertion fails.
          fs.writeFileSync(`${barrier}.release`, "")
          fs.writeFileSync(`${barrier}.finish`, "")
          if (stopped) await stopped.catch(() => {})
          // A broken socket makes graceful stop impossible. Both daemons and their ledger resources
          // still belong to this fixture, including when starting the replacement failed.
          if (replacement === undefined && fs.existsSync(lock)) {
            const owner = JSON.parse(fs.readFileSync(lock, "utf8")).pid
            if (owner !== original) replacement = owner
          }
          for (const pid of [original, replacement]) {
            if (pid === undefined) continue
            try {
              process.kill(pid, "SIGKILL")
            } catch {}
          }
          await run(env, "prune", "--yes")
        }
      }),
    timeout
  )

  it.live("reports failed ledger cleanup instead of stop success", () =>
    Effect.gen(function*() {
      const env = {
        ...environment(),
        STRIDER_STOP_FAILURE: "1",
        NODE_OPTIONS: `--import=${path.join(fixtures, "stop-cleanup-barrier.mjs")}`
      }
      const started = yield* strider(env, "start", "--name", "failure", "--chromium", chromium.executable)
      assert.strictEqual(started.code, 0, started.err)
      const stopped = yield* strider(env, "-s", "failure", "stop")
      assert.notStrictEqual(stopped.code, 0)
      assert.include(stopped.err, "ledger record could not be removed")
    }), timeout)

  for (const concurrent of [false, true]) {
    it.live(
      `returns stop success only after the ledger finalizer finishes${
        concurrent ? " with concurrent and disconnected callers" : ""
      }`,
      () =>
        Effect.promise(async () => {
          const env = environment()
          const barrierPath = path.join(env.XDG_RUNTIME_DIR, "cleanup.sock")
          const events = path.join(env.XDG_RUNTIME_DIR, "cleanup.ndjson")
          const observed: Array<string> = []
          const sockets = new Set<net.Socket>()
          let another: Promise<{ code: number; err: string; out: string }> | undefined
          let abandoned: net.Socket | undefined
          let callers = 0
          let released!: () => void
          const removed = new Promise<void>((resolve, reject) => {
            const signal = AbortSignal.timeout(30_000)
            const expired = () => reject(new Error("Ledger finalizer did not finish"))
            signal.addEventListener("abort", expired, { once: true })
            released = () => {
              signal.removeEventListener("abort", expired)
              resolve()
            }
          })
          void removed.catch(() => {})
          const server = net.createServer((socket) => {
            sockets.add(socket)
            socket.once("close", () => sockets.delete(socket))
            socket.once("end", released)
            let pending = ""
            socket.on("data", (chunk) => {
              const lines = (pending + chunk.toString()).split("\n")
              pending = lines.pop()!
              for (const line of lines) {
                observed.push(line)
                // The finalizer cannot remove the ledger until the test explicitly releases it.
                if (line === "entered") {
                  if (!concurrent) socket.write("release\n")
                  else {
                    another = run("-s", "barrier", "stop", "--keep")
                    abandoned = net.connect(path.join(env.XDG_RUNTIME_DIR, "strider", "barrier", "sock"))
                    abandoned.on("error", () => {})
                    abandoned.once("connect", () =>
                      abandoned!.write(
                        JSON.stringify({
                          _tag: "Request",
                          id: "999",
                          tag: "Command",
                          payload: { argv: ["stop"], cwd: process.cwd() },
                          headers: []
                        }) + "\n"
                      ))
                  }
                }
                if (line === "caller" && ++callers === 2) {
                  abandoned!.destroy()
                  socket.write("release\n")
                }
                if (line === "removed") socket.write("observed\n")
              }
            })
          })
          await new Promise<void>((resolve) => server.listen(barrierPath, resolve))
          const run = (...args: ReadonlyArray<string>) =>
            Effect.runPromise(strider({
              ...env,
              STRIDER_STOP_BARRIER: barrierPath,
              STRIDER_STOP_EVENTS: events,
              NODE_OPTIONS: `--import=${path.join(fixtures, "stop-cleanup-barrier.mjs")}`
            }, ...args))
          try {
            const started = await run("start", "--name", "barrier", "--chromium", chromium.executable)
            assert.strictEqual(started.code, 0, started.err)
            const stopped = await run("-s", "barrier", "stop")
            assert.strictEqual(stopped.code, 0, stopped.err)
            if (another) {
              const result = await another
              assert.strictEqual(result.code, 0, result.err)
              assert.notInclude(result.out, "directory stays")
            }
            const pruned = await run("prune")
            await removed
            assert.deepStrictEqual(observed.filter((line) => line !== "caller"), ["entered", "removed"])
            const order = fs.readFileSync(events, "utf8").trim().split("\n").map((line) => JSON.parse(line))
            assert.deepStrictEqual(
              order.map((entry) => entry.event).filter((event, index, all) =>
                event !== "stop-response" || all.indexOf(event) === index
              ),
              [
                "ledger-finalizer-entered",
                "ledger-removed",
                "stop-response"
              ]
            )
            assert.isTrue(order[0].exists)
            assert.isFalse(order[1].exists)
            assert.strictEqual(order[2].exit._tag, "Success")
            assert.deepStrictEqual(fs.readdirSync(path.join(env.XDG_STATE_HOME, "strider", "ledger")), [])
            assert.isFalse(fs.existsSync(path.join(env.XDG_RUNTIME_DIR, "strider", "barrier")))
            assert.isFalse(order[2].sessionExists)
            assert.strictEqual(pruned.code, 0, pruned.err)
            assert.strictEqual(pruned.out.trim(), "Nothing is left behind by a program that ended")
          } finally {
            for (const socket of sockets) socket.destroy()
            await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
          }
        }),
      timeout
    )
  }

  it.live(
    "refuses fork snapshot export for profiles and sessions loaded from a state file",
    () =>
      Effect.scoped(Effect.gen(function*() {
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
        const state = path.join(env.XDG_RUNTIME_DIR, "initial.json")
        fs.writeFileSync(state, JSON.stringify({ cookies: [], origins: [] }))
        for (const mode of ["profile", "state"] as const) {
          const flags = mode === "profile"
            ? ["--user-data-dir", path.join(env.XDG_RUNTIME_DIR, "profile")]
            : ["--state", state]
          const started = yield* run("start", "--name", mode, "--chromium", chromium.executable, ...flags)
          assert.strictEqual(started.code, 0, started.err)
          try {
            const test = path.join(env.XDG_RUNTIME_DIR, mode + ".test.ts")
            const destination = path.join(env.XDG_RUNTIME_DIR, mode + ".json")
            const refused = yield* run("-s", mode, "export", "test", test, "--state", destination)
            assert.strictEqual(refused.code, 15, refused.err)
            assert.include(refused.err, "--fork")
            assert.isFalse(fs.existsSync(destination))
            assert.isFalse(fs.existsSync(test))
            const normal = yield* run("-s", mode, "export", "test", test)
            assert.strictEqual(normal.code, 0, normal.err)
            const text = fs.readFileSync(test, "utf8")
            if (mode === "profile") assert.include(text, "profile replay is unsupported")
            else assert.include(text, JSON.stringify(state))
          } finally {
            yield* run("-s", mode, "stop")
          }
        }
      })),
    timeout
  )

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
            const repo = path.join(env.XDG_RUNTIME_DIR, "export-repo")
            fs.mkdirSync(repo)
            yield* Effect.promise(() =>
              new Promise<void>((resolve, reject) => {
                execFile("git", ["init", repo], (error) => error ? reject(error) : resolve())
              })
            )
            const saved = path.join(repo, "fork-state.json")
            fs.writeFileSync(saved, "old", { mode: 0o644 })
            const changed = yield* run(
              "-s",
              "second",
              "-p",
              "home",
              "eval",
              "document.cookie = 'flavor=changed; path=/'"
            )
            assert.strictEqual(changed.code, 0, changed.err)
            const live = path.join(env.XDG_RUNTIME_DIR, "live-state.json")
            assert.strictEqual((yield* run("-s", "second", "state", "save", live)).code, 0)
            assert.strictEqual(
              JSON.parse(fs.readFileSync(live, "utf8")).cookies.find((cookie: { name: string }) =>
                cookie.name === "flavor"
              ).value,
              "changed"
            )
            const result = yield* run("-s", "second", "export", "test", test, "--state", saved)
            assert.strictEqual(result.code, 0, result.err)
            assert.include(result.err, "plaintext credentials")
            assert.notInclude(result.out, "plaintext credentials")
            assert.strictEqual(fs.statSync(saved).mode & 0o777, 0o600)
            const snapshot = JSON.parse(fs.readFileSync(saved, "utf8"))
            assert.strictEqual(
              snapshot.cookies.find((cookie: { name: string }) => cookie.name === "flavor").value,
              "oat"
            )
            assert.include(fs.readFileSync(test, "utf8"), JSON.stringify(saved))
            assert.notInclude(fs.readFileSync(test, "utf8"), "context starts empty")
            const collision = yield* run("-s", "second", "export", "test", saved, "--state", saved)
            assert.notStrictEqual(collision.code, 0)
            assert.include(collision.err, "different")
            assert.strictEqual(JSON.parse(fs.readFileSync(saved, "utf8")).cookies[0].value, "oat")
            for (const kind of ["symlink", "hardlink"] as const) {
              const alias = path.join(repo, kind)
              if (kind === "symlink") fs.symlinkSync(saved, alias)
              else fs.linkSync(saved, alias)
              const aliased = yield* run("-s", "second", "export", "test", alias, "--state", saved)
              assert.notStrictEqual(aliased.code, 0)
              assert.include(aliased.err, "different")
            }
            const missing = path.join(repo, "missing")
            const dangling = path.join(repo, "dangling")
            fs.symlinkSync(missing, dangling)
            const aliased = yield* run("-s", "second", "export", "test", missing, "--state", dangling)
            assert.notStrictEqual(aliased.code, 0)
            assert.include(aliased.err, "different")
            assert.isFalse(fs.existsSync(missing))
            fs.writeFileSync(path.join(repo, ".gitignore"), "private/")
            const privateState = path.join(repo, "private", "initial.json")
            const ignored = yield* run("-s", "second", "export", "test", test, "--state", privateState)
            assert.strictEqual(ignored.code, 0, ignored.err)
            assert.notInclude(ignored.err, "plaintext credentials")
            assert.strictEqual(fs.statSync(privateState).mode & 0o777, 0o600)
            const unsupported = yield* run("-s", "first", "export", "test", test, "--state", saved)
            assert.notStrictEqual(unsupported.code, 0)
            assert.include(unsupported.err, "--fork")
          } finally {
            const stopped = yield* run("-s", "second", "stop")
            assert.strictEqual(stopped.code, 0, stopped.err)
            const records = fs.readdirSync(path.join(env.XDG_STATE_HOME, "strider", "ledger")).map((file) =>
              JSON.parse(fs.readFileSync(path.join(env.XDG_STATE_HOME, "strider", "ledger", file), "utf8"))
            )
            const first = JSON.parse(fs.readFileSync(lock, "utf8"))
            assert.deepStrictEqual(records.map((record) => record.owner.pid), [first.pid])
            assert.strictEqual(
              (yield* run("prune", "--yes")).out.trim(),
              "Nothing is left behind by a program that ended"
            )
          }
        } finally {
          // A daemon killed outright leaves its directory, listed until pruned
          // Its lock names it by its process id and when it started
          process.kill(JSON.parse(fs.readFileSync(lock, "utf8")).pid, "SIGKILL")
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
        assert.include(listed.out, path.join(env.XDG_RUNTIME_DIR, "strider", "first", "profile"))
        assert.notInclude(listed.out, chromium.executable)
        assert.notInclude(listed.out, path.join(env.XDG_RUNTIME_DIR, "strider", "second", "profile"))
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
            { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "pages", arguments: {} } },
            { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "screenshot", arguments: { page: "shop" } } }
          ], 4)
          const listedTools = answers.find((answer) => answer.id === 2)?.result?.tools?.map((tool: any) => tool.name)
          assert.includeMembers(listedTools ?? [], ["click", "find", "control"])
          // A screenshot crosses once, as an image: its structured result leaves the bytes out, as its schema does
          const shotSchema = answers.find((answer) => answer.id === 2)?.result?.tools?.find((tool: any) =>
            tool.name === "screenshot"
          )?.outputSchema
          assert.notProperty(shotSchema?.properties?.outcome?.properties ?? {}, "data")
          const shot = answers.find((answer) => answer.id === 4)?.result
          assert.strictEqual(shot?.content?.[0]?.type, "image")
          assert.deepStrictEqual(shot?.structuredContent?.outcome, { mediaType: "image/png" })
          const pages = JSON.stringify(answers.find((answer) => answer.id === 3)?.result)
          assert.include(pages, "shop")
          assert.include(pages, "kept")
        } finally {
          yield* tools("stop")
        }
      })),
    timeout
  )

  it.live(
    "enforces strict capture through CLI commands and MCP tools",
    () =>
      Effect.scoped(Effect.gen(function*() {
        const served = yield* site
        const secret = "strict-private-field"
        const consoleText = "strict-private-console"
        const url = `${served.origin}/fixture?html=${
          encodeURIComponent(
            `<div id="note" role="textbox" aria-label="Note" contenteditable="true"></div><button onclick="console.error('${consoleText}')">Log</button>`
          )
        }`
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, "-s", "strict", ...args)
        const page = (...args: ReadonlyArray<string>) => run("-p", "form", ...args)
        const started = yield* strider(
          env,
          "start",
          "--name",
          "strict",
          "--capture",
          "strict",
          "--chromium",
          chromium.executable
        )
        assert.strictEqual(started.code, 0, started.err)
        try {
          const opened = yield* run("page", "new", "--name", "form", url)
          assert.strictEqual(opened.code, 0, opened.err)
          const filled = yield* page("fill", "css=#note", secret)
          assert.strictEqual(filled.code, 0, filled.err)
          const logged = yield* page("click", "role=button[name=\"Log\"]")
          assert.strictEqual(logged.code, 0, logged.err)

          const snapshot = yield* page("snapshot")
          assert.strictEqual(snapshot.code, 0, snapshot.err)
          assert.include(snapshot.out, "textbox \"Note\"")
          assert.include(snapshot.out, "text: \"•••\"")
          assert.notInclude(snapshot.out, secret)
          const artifacts = path.join(env.XDG_RUNTIME_DIR, "strider", "strict", "artifacts")
          const before = fs.readdirSync(artifacts)
          const screenshot = yield* page("screenshot")
          assert.strictEqual(screenshot.code, 17, screenshot.err)
          assert.include(screenshot.err, "The capture policy sends no screenshots")
          assert.deepStrictEqual(fs.readdirSync(artifacts), before)

          let history = yield* page("history", "console", "--level", "error")
          for (let attempt = 0; attempt < 50 && !history.out.includes("console error (text not sent)"); attempt++) {
            yield* Effect.sleep("100 millis")
            history = yield* page("history", "console", "--level", "error")
          }
          assert.strictEqual(history.code, 0, history.err)
          assert.include(history.out, "console error (text not sent)")
          assert.notInclude(history.out, consoleText)
          // The digest of events since the last command also leaves console text out, whichever command carries it
          for (const result of [logged, snapshot, screenshot]) {
            assert.notInclude(result.out + result.err, consoleText)
          }

          // Call separately: the MCP helper sends each batch concurrently, so no call depends on another here.
          for (
            const [name, args] of [
              ["snapshot", { page: "form" }],
              ["screenshot", { page: "form" }],
              ["history", { page: "form", kind: "console", level: "error" }]
            ] as const
          ) {
            const answers = yield* mcp(env, ["-s", "strict", "mcp"], [
              ...handshake,
              { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }
            ], 2)
            const answer = answers.find((answer) => answer.id === 2)
            assert.isUndefined(answer?.error, JSON.stringify(answer))
            const result = answer?.result
            assert.isDefined(result, JSON.stringify(answers))
            const output = JSON.stringify(result)
            assert.notInclude(output, consoleText)
            if (name === "snapshot") {
              assert.isNotTrue(result.isError, output)
              assert.include(output, "Note")
              assert.include(output, "•••")
              assert.notInclude(output, secret)
            } else if (name === "screenshot") {
              assert.isTrue(result.isError, output)
              assert.include(output, "NotPermitted")
              assert.include(output, "The capture policy sends no screenshots")
              assert.isFalse(result.content.some((content: any) => content.type === "image"))
            } else {
              assert.isNotTrue(result.isError, output)
              assert.include(output, "console error (text not sent)")
            }
          }
        } finally {
          const stopped = yield* run("stop")
          assert.strictEqual(stopped.code, 0, stopped.err)
        }
      })),
    timeout
  )

  for (const backend of ["chromium", "firefox", "webkit"] as const) {
    for (const capture of ["strict", "local"]) {
      it.live(
        `masks all of an editable field's content with ${capture} capture on ${backend}`,
        () =>
          Effect.scoped(Effect.gen(function*() {
            if (backend === "webkit") yield* useXvfb()
            const server = http.createServer((_, response) => {
              response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
              response.end(
                `<div role="textbox" aria-label="Rich" contenteditable="true"><h1>rich-heading<a href="#x">rich-link</a></h1><button onclick="document.getElementById('status').textContent = 'clicked'">rich-button</button><img alt="rich-image" src="data:,"></div><div contenteditable="true">roleless-field</div><div role="textbox" contenteditable="true" aria-label="Labeled">labeled-private</div><article contenteditable="true" aria-label="Article">article-private</article><h2 contenteditable="true">heading-private</h2><p contenteditable="plaintext-only">paragraph-private</p><input aria-label="Native" value="native-private"><button onclick="const error = new Error('exception-private'); error.name = 'exception-name-private'; error.stack = 'exception-stack-private'; throw error">Throw</button><p id="status">ready</p>`
              )
            })
            yield* Effect.acquireRelease(
              Effect.callback<void>((resume) => void server.listen(0, "127.0.0.1", () => resume(Effect.void))),
              () => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())))
            )
            const { port } = server.address() as { readonly port: number }
            const url = `http://127.0.0.1:${port}/form`
            const env = environment()
            const run = (...args: ReadonlyArray<string>) => strider(env, "-s", capture, ...args)
            const page = (...args: ReadonlyArray<string>) => run("-p", "form", ...args)
            const started = yield* strider(
              env,
              "start",
              "--name",
              capture,
              "--capture",
              capture,
              `--${backend}`,
              backend === "chromium"
                ? chromium.executable
                : backend === "firefox"
                ? firefox.executable
                : webkitgtk.executable
            )
            assert.strictEqual(started.code, 0, started.err)
            try {
              const opened = yield* run("page", "new", "--name", "form", url)
              assert.strictEqual(opened.code, 0, opened.err)
              const snapshot = yield* page("snapshot")
              assert.strictEqual(snapshot.code, 0, snapshot.err)
              assert.include(snapshot.out, "textbox \"Rich\"")
              const found = yield* page("--json", "find", "")
              assert.strictEqual(found.code, 0, found.err)
              const contents = [
                "rich-heading",
                "rich-link",
                "rich-button",
                "rich-image",
                "roleless-field",
                "labeled-private",
                "article-private",
                "paragraph-private",
                "heading-private"
              ]
              const check = (output: string, find = false) => {
                if (capture === "strict") {
                  assert.deepStrictEqual(contents.filter((content) => output.includes(content)), [], output)
                  assert.include(output, "•••")
                } else {
                  for (
                    const content of find
                      ? contents.filter((content) =>
                        !["labeled-private", "article-private", "paragraph-private"].includes(content)
                      )
                      : contents
                  ) assert.include(output, content)
                }
              }
              check(snapshot.out)
              check(found.out, true)
              const guesses = ["rich-heading", "article-private", "paragraph-private", "heading-private"]
              for (const query of guesses) {
                const guessed = yield* page("--json", "find", query)
                assert.strictEqual(guessed.code, 0, guessed.err)
                assert.strictEqual(JSON.parse(guessed.out).outcome.value.length > 0, capture === "local", guessed.out)
              }
              const guessAnswers = yield* mcpTools(
                env,
                ["-s", capture, "mcp"],
                guesses.map((query) => ({ name: "find", arguments: { page: "form", query } }))
              )
              for (const answer of guessAnswers) {
                assert.isNotTrue(answer?.result?.isError, JSON.stringify(answer))
                assert.strictEqual(answer.result.structuredContent.outcome.length > 0, capture === "local")
              }
              const labeled = yield* page("--json", "find", "Article", "--role", "article")
              assert.strictEqual(JSON.parse(labeled.out).outcome.value.length, 1, labeled.out)
              const thrown = yield* page("click", "role=button[name=\"Throw\"]")
              assert.strictEqual(thrown.code, 0, thrown.err)
              const exceptions = yield* page("--json", "history", "exception")
              assert.strictEqual(exceptions.code, 0, exceptions.err)
              if (capture === "strict") {
                for (const text of ["exception-private", "exception-name-private", "exception-stack-private"]) {
                  assert.notInclude(thrown.out + exceptions.out, text)
                }
                assert.match(exceptions.out, /uncaught.*at [0-9]/)
              } else assert.include(exceptions.out, "exception-private")
              const clickedAnswers = yield* mcp(env, ["-s", capture, "mcp"], [...handshake, {
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: { name: "click", arguments: { page: "form", target: "role=button[name=\"Throw\"]" } }
              }], 2)
              const clickedResult = clickedAnswers.find((answer) => answer.id === 2)?.result
              assert.isNotTrue(clickedResult?.isError, JSON.stringify(clickedAnswers))
              if (capture === "strict") {
                for (const text of ["exception-private", "exception-name-private", "exception-stack-private"]) {
                  assert.notInclude(JSON.stringify(clickedResult), text)
                }
              }
              const historyAnswers = yield* mcp(env, ["-s", capture, "mcp"], [...handshake, {
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: { name: "history", arguments: { page: "form", kind: "exception" } }
              }], 2)
              const historyResult = JSON.stringify(historyAnswers.find((answer) => answer.id === 2)?.result)
              if (capture === "strict") {
                for (const text of ["exception-private", "exception-name-private", "exception-stack-private"]) {
                  assert.notInclude(historyResult, text)
                }
                assert.match(historyResult, /uncaught.*at [0-9]/)
              } else assert.include(historyResult, "exception-private")
              const matches = JSON.parse(found.out).outcome.value as Array<
                { ref: string; role: string; name: string; path: string }
              >
              assert.includeMembers(matches.map((match) => match.name), ["Rich", "Labeled"])
              const link = matches.find((match) => match.role === "link")!
              assert.isDefined(link)
              assert.include(link.path, capture === "strict" ? "heading \"•••\"" : "rich-heading")
              const button = matches.find((match) => match.role === "button")!
              assert.match(button.ref, /^e\d+$/)
              const clicked = yield* page("click", button.ref)
              assert.strictEqual(clicked.code, 0, clicked.err)
              const checked = yield* page("expect", "css=#status", "visible", "--text", "clicked")
              assert.strictEqual(checked.code, 0, checked.err)

              const reads = ["snapshot", "find"] as const
              const readAnswers = yield* mcpTools(
                env,
                ["-s", capture, "mcp"],
                reads.map((name) => ({ name, arguments: { page: "form", ...(name === "find" ? { query: "" } : {}) } }))
              )
              for (const [index, name] of reads.entries()) {
                const answer = readAnswers[index]
                assert.isUndefined(answer?.error, JSON.stringify(answer))
                assert.isDefined(answer?.result, JSON.stringify(answer))
                assert.isNotTrue(answer.result.isError, JSON.stringify(answer))
                const output = JSON.stringify(answer.result)
                check(output, name === "find")
                assert.include(output, "Rich")
                assert.include(output, "Labeled")
                if (name === "find") {
                  const matches = answer.result.structuredContent.outcome
                  const link = matches.find((match: any) => match.role === "link")
                  assert.include(link.path, capture === "strict" ? "heading \"•••\"" : "rich-heading")
                  assert.match(link.ref, /^e\d+$/)
                }
              }
            } finally {
              const stopped = yield* run("stop")
              assert.strictEqual(stopped.code, 0, stopped.err)
            }
          })).pipe(Effect.provide(NodeServices.layer)),
        timeout
      )
    }
  }

  for (const backend of ["chromium", "firefox", "webkit"] as const) {
    for (const capture of ["strict", "local"]) {
      it.live(
        `keeps editable content out of other nodes' names with ${capture} capture on ${backend}`,
        () =>
          Effect.scoped(Effect.gen(function*() {
            if (backend === "webkit") yield* useXvfb()
            const pixel = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
            // Each private string reaches the name of a node other than the field itself: an ancestor named from
            // its content, a clickable element, an empty field named from the field before it, an image's alt.
            const html = `<title>probe</title>
<h2><span contenteditable="true">heading-descendant-private</span></h2>
<a href="#x"><span contenteditable="plaintext-only">link-descendant-private</span></a>
<table><tr><td><input aria-label="Card" value="cell-value-private"></td></tr></table>
<input id="referenced" aria-label="Referenced" value="reference-value-private"><button aria-labelledby="referenced"></button>
<div onclick="void 0"><span contenteditable="true">clickable-descendant-private</span></div>
<p contenteditable="true">nearby-private</p><div contenteditable="true"></div>
<div contenteditable="true"><img alt="image-alt-private" src="${pixel}"></div>
<select aria-label="Plan"><option id="chosen-option" selected>option-private</option></select><button aria-labelledby="chosen-option"></button>
<div role="textbox" aria-label="Rich"><span id="inside-aria">aria-descendant-private</span></div><button aria-labelledby="inside-aria"></button>
<div onclick="void 0"><div role="textbox" aria-label="Inner"><img alt="aria-image-private" src="${pixel}"></div></div>
<h4><span contenteditable="true"><b aria-label="descendant-label-private">x</b></span></h4>
<h5><span contenteditable="true"><b title="descendant-title-private"></b></span></h5>
<h6><span contenteditable="true" aria-label="public-field-label">field-root-private</span></h6>
<h3>public-heading</h3>
<div>public-nearby</div><div contenteditable="true"></div>`
            const server = http.createServer((_, response) => {
              response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
              response.end(html)
            })
            yield* Effect.acquireRelease(
              Effect.callback<void>((resume) => void server.listen(0, "127.0.0.1", () => resume(Effect.void))),
              () => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())))
            )
            const { port } = server.address() as { readonly port: number }
            const env = environment()
            const run = (...args: ReadonlyArray<string>) => strider(env, "-s", capture, ...args)
            const page = (...args: ReadonlyArray<string>) => run("-p", "form", ...args)
            const started = yield* strider(
              env,
              "start",
              "--name",
              capture,
              "--capture",
              capture,
              `--${backend}`,
              backend === "chromium"
                ? chromium.executable
                : backend === "firefox"
                ? firefox.executable
                : webkitgtk.executable
            )
            assert.strictEqual(started.code, 0, started.err)
            try {
              const opened = yield* run("page", "new", "--name", "form", `http://127.0.0.1:${port}/form`)
              assert.strictEqual(opened.code, 0, opened.err)
              const snapshot = yield* page("snapshot")
              assert.strictEqual(snapshot.code, 0, snapshot.err)
              const shown: Array<string> = []
              const matched: Array<string> = []
              const contents = [
                "heading-descendant-private",
                "link-descendant-private",
                "cell-value-private",
                "reference-value-private",
                "clickable-descendant-private",
                "nearby-private",
                "image-alt-private",
                "option-private",
                "aria-descendant-private",
                "aria-image-private",
                "descendant-label-private",
                "descendant-title-private",
                "field-root-private"
              ]
              for (const content of [...contents, "public-field-label", "public-heading", "public-nearby"]) {
                if (snapshot.out.includes(content)) shown.push(content)
                const found = yield* page("--json", "find", content)
                assert.strictEqual(found.code, 0, found.err)
                if (JSON.parse(found.out).outcome.value.length > 0) matched.push(content)
              }
              const expected = capture === "strict"
                ? ["public-field-label", "public-heading", "public-nearby"]
                : [...contents, "public-field-label", "public-heading", "public-nearby"]
              const queries = [...contents, "public-field-label", "public-heading", "public-nearby"]
              const [snapshotAnswer, ...findAnswers] = yield* mcpTools(env, ["-s", capture, "mcp"], [
                { name: "snapshot", arguments: { page: "form" } },
                ...queries.map((query) => ({ name: "find", arguments: { page: "form", query } }))
              ])
              const mcpSnapshot = snapshotAnswer?.result
              assert.isNotTrue(mcpSnapshot?.isError, JSON.stringify(snapshotAnswer))
              const mcpShown = queries.filter((query) => JSON.stringify(mcpSnapshot).includes(query))
              const mcpMatched = queries.filter((_, index) => {
                const result = findAnswers[index]?.result
                assert.isNotTrue(result?.isError, JSON.stringify(findAnswers[index]))
                return result.structuredContent.outcome.length > 0
              })
              assert.deepStrictEqual(
                { shown, matched, mcpShown, mcpMatched },
                { shown: expected, matched: expected, mcpShown: expected, mcpMatched: expected },
                snapshot.out
              )
            } finally {
              const stopped = yield* run("stop")
              assert.strictEqual(stopped.code, 0, stopped.err)
            }
          })).pipe(Effect.provide(NodeServices.layer)),
        timeout
      )
    }
  }

  it.live("exits 0 when its MCP client closes standard input", () =>
    Effect.callback<number | null>((resume) => {
      const child = spawn(process.execPath, [bin, "-s", "nobody", "mcp"], {
        env: { ...process.env, ...environment() },
        stdio: ["pipe", "pipe", "pipe"]
      })
      const timer = setTimeout(() => child.kill(), 30_000)
      child.on("close", (code) => {
        clearTimeout(timer)
        resume(Effect.succeed(code))
      })
      for (const message of handshake) child.stdin.write(`${JSON.stringify(message)}\n`)
      child.stdin.end()
    }).pipe(Effect.map((code) => assert.strictEqual(code, 0))), timeout)

  for (const backend of ["Chromium", "stock WebKit"] as const) {
    it.live(`attaches to ${backend} by an HTTP endpoint`, () =>
      Effect.scoped(
        Effect.gen(function*() {
          const served = yield* site
          const env = environment()
          const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
          const tab = `${served.origin}/fixture?html=${encodeURIComponent("<title>remote</title>")}`
          const { endpoint } = backend === "Chromium"
            ? yield* chromiumAttachable(Chromium.layerConnect).start(tab, tab)
            : yield* startMiniBrowser(tab)
          const before = yield* inspectorTargetIds(endpoint, backend)
          assert.isNotEmpty(before, "the external browser has tabs before attachment")
          try {
            const started = yield* run("start", "--name", "remote", "--attach", endpoint)
            assert.strictEqual(started.code, 0, started.err)
            const sessions = yield* run("sessions")
            assert.include(sessions.out, `attached ${backend === "Chromium" ? "chromium" : "webkit"}`)
            const tabs = yield* run("-s", "remote", "tabs")
            assert.strictEqual(tabs.code, 0, tabs.err)
            assert.include(tabs.out, tab)
          } finally {
            yield* run("-s", "remote", "stop")
            const response = yield* Effect.promise(() => fetch(new URL("/", endpoint)))
            assert.strictEqual(response.status, 200, "attached browser survives stop")
            assert.includeMembers(
              yield* inspectorTargetIds(endpoint, backend),
              before,
              "the original tabs survive stop"
            )
          }
        }).pipe(Effect.provide(NodeServices.layer))
      ), timeout)
  }

  // An endpoint that is neither backend fails the start, with the reason
  it.live("refuses an HTTP endpoint that is neither Chromium nor stock WebKit", () =>
    Effect.gen(function*() {
      const server = http.createServer((_, response) => {
        response.writeHead(404)
        response.end("<title>WebKitInspectorHTTPServer</title>")
      })
      yield* Effect.callback<void>((resume) => void server.listen(0, "127.0.0.1", () => resume(Effect.void)))
      const { port } = server.address() as { readonly port: number }
      const started = yield* strider(environment(), "start", "--name", "remote", "--attach", `http://127.0.0.1:${port}`)
      server.close()
      assert.notStrictEqual(started.code, 0)
      assert.include(started.err, "Cannot detect attachment backend")
      assert.include(started.err, "WebKitInspectorHTTPServer Server token")
    }).pipe(Effect.provide(NodeServices.layer)), timeout)

  // An inspector's tab, taken with control, stays listed and works until it is released
  it.live("controls and releases a tab of an attached stock WebKit", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const served = yield* site
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
        const tab = `${served.origin}/fixture?html=${encodeURIComponent("<title>remote</title>")}`
        const { endpoint } = yield* startMiniBrowser(tab)
        const before = yield* inspectorTargetIds(endpoint, "stock WebKit")
        assert.isNotEmpty(before)
        try {
          assert.strictEqual((yield* run("start", "--name", "remote", "--attach", endpoint)).code, 0)
          const tabs = yield* run("-s", "remote", "tabs")
          const id = tabs.out.split("\n")[0]!.split("  ")[0]!
          const taken = yield* run("-s", "remote", "control", id, "--name", "own")
          assert.strictEqual(taken.code, 0, taken.err)
          assert.include((yield* run("-s", "remote", "pages")).out, "own")
          assert.strictEqual((yield* run("-s", "remote", "-p", "own", "snapshot")).code, 0)
          assert.strictEqual((yield* run("-s", "remote", "release", "-p", "own")).code, 0)
          assert.include((yield* run("-s", "remote", "tabs")).out, tab)
          assert.includeMembers(
            yield* inspectorTargetIds(endpoint, "stock WebKit"),
            before,
            "release keeps the original tab"
          )
        } finally {
          yield* run("-s", "remote", "stop")
          assert.includeMembers(
            yield* inspectorTargetIds(endpoint, "stock WebKit"),
            before,
            "stop keeps the original tab"
          )
        }
      }).pipe(Effect.provide(NodeServices.layer))
    ), timeout)

  // A tab closed outside the session leaves it, on a real browser's control grant
  it.live("retires a controlled tab closed outside the session", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const served = yield* site
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
        const closes = `${served.origin}/fixture?html=${encodeURIComponent("<title>closes</title>")}`
        const stays = `${served.origin}/fixture?html=${encodeURIComponent("<title>stays</title>")}`
        const { endpoint } = yield* chromiumAttachable(Chromium.layerConnect).start(closes, stays)
        try {
          assert.strictEqual((yield* run("start", "--name", "remote", "--attach", endpoint)).code, 0)
          assert.include((yield* run("-s", "remote", "pages")).out, "no pages")
          const lines = (yield* run("-s", "remote", "tabs")).out.split("\n")
          const idOf = (url: string) => lines.find((line) => line.includes(url))!.split("  ")[0]!
          assert.strictEqual((yield* run("-s", "remote", "control", idOf(closes), "--name", "own")).code, 0)
          const listed = (yield* run("-s", "remote", "pages")).out
          assert.include(listed, "own")
          assert.include(listed, closes)
          assert.notInclude(listed, stays)
          assert.strictEqual((yield* run("-s", "remote", "-p", "own", "snapshot")).code, 0)
          const targets = yield* Effect.promise(() =>
            fetch(new URL("/json/list", endpoint)).then((response) =>
              response.json() as Promise<ReadonlyArray<{ readonly id: string; readonly url: string }>>
            )
          )
          const target = targets.find((each) => each.url === closes)!
          const closing = yield* Effect.promise(() => fetch(new URL(`/json/close/${target.id}`, endpoint)))
          assert.strictEqual(closing.status, 200)
          let code = 0
          for (let attempt = 0; attempt < 50 && code === 0; attempt++) {
            yield* Effect.sleep("100 millis")
            code = (yield* run("-s", "remote", "-p", "own", "snapshot")).code
          }
          assert.strictEqual(code, 16, "a closed tab has no name")
          assert.include((yield* run("-s", "remote", "pages")).out, "no pages")
          const taken = yield* run("-s", "remote", "control", idOf(stays), "--name", "own")
          assert.strictEqual(taken.code, 0, taken.err)
          assert.include((yield* run("-s", "remote", "pages")).out, "own")
          assert.strictEqual((yield* run("-s", "remote", "-p", "own", "snapshot")).code, 0)
          assert.strictEqual((yield* run("-s", "remote", "release", "-p", "own")).code, 0)
          assert.include((yield* run("-s", "remote", "pages")).out, "no pages")
          assert.include((yield* run("-s", "remote", "tabs")).out, stays)
        } finally {
          assert.strictEqual((yield* run("-s", "remote", "stop")).code, 0)
        }
      }).pipe(Effect.provide(NodeServices.layer))
    ), timeout)

  it.live("lists a held tab and saves only its state from the browser, widening when asked", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const served = yield* site
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, "-s", "remote", ...args)
        const signingIn = (name: string) =>
          `/fixture?html=${
            encodeURIComponent(
              `<title>${name}</title><script>document.cookie = "${name}=abc; path=/"; localStorage.setItem("${name}", "v")</script>`
            )
          }`
        const app = `${served.origin}${signingIn("app")}`
        const elsewhere = `${served.crossSite}${signingIn("elsewhere")}`
        const { endpoint } = yield* chromiumAttachable(Chromium.layerConnect).start(app, elsewhere)
        const state = path.join(env.XDG_RUNTIME_DIR, "held.state")
        const saved = () => fs.readFileSync(state, "utf8")
        try {
          const started = yield* strider(env, "start", "--name", "remote", "--attach", endpoint)
          assert.strictEqual(started.code, 0, started.err)
          const empty = yield* run("state", "save", state)
          assert.notStrictEqual(empty.code, 0, "an attached session holding nothing writes no empty file")
          assert.include(empty.err, "strider control")
          assert.isFalse(fs.existsSync(state))
          const tabs = yield* run("tabs")
          const tab = tabs.out.split("\n").find((line) => line.includes(app))!.split("  ")[0]!
          assert.strictEqual((yield* run("control", tab, "--name", "app")).code, 0)
          assert.include((yield* run("pages")).out, `app  ${app}`)
          assert.include((yield* strider(env, "sessions")).out, "app")
          // The held tab's state, not the browser's other tab's
          const held = yield* run("state", "save", state)
          assert.strictEqual(held.code, 0, held.err)
          assert.include(held.out, "saved 1 cookie and 1 origin for 127.0.0.1 to ")
          assert.include(saved(), `"app"`)
          assert.notInclude(saved(), "elsewhere")
          // The read's control ends with it: the tab is still the session's
          assert.strictEqual((yield* run("-p", "app", "snapshot")).code, 0)
          // Widening is asked for, and says what it found
          const added = yield* run("state", "save", state, "--site", "localhost")
          assert.strictEqual(added.code, 0, added.err)
          assert.include(saved(), "elsewhere")
          assert.include(added.out, "127.0.0.1, localhost")
          const nothing = yield* run("state", "save", state, "--site", "okta.com")
          assert.include(nothing.out, "nothing for okta.com")
          assert.notInclude(saved(), "elsewhere")
          const whole = yield* run("state", "save", state, "--all")
          assert.strictEqual(whole.code, 0, whole.err)
          assert.include(saved(), "elsewhere")
          assert.notStrictEqual((yield* run("state", "save", state, "--all", "--site", "okta.com")).code, 0)
          // A page of the session's own context is a second state to choose from, saved whole
          assert.strictEqual((yield* run("page", "new", "--name", "own", `${served.origin}/fixture`)).code, 0)
          const ambiguous = yield* run("state", "save", state)
          assert.notStrictEqual(ambiguous.code, 0)
          assert.include(ambiguous.err, "-p")
          assert.strictEqual((yield* run("-p", "own", "state", "save", state)).code, 0)
          assert.notInclude(saved(), `"app"`)
          assert.notStrictEqual((yield* run("-p", "own", "state", "save", state, "--all")).code, 0)
          assert.strictEqual((yield* run("-p", "app", "state", "save", state)).code, 0)
          assert.include(saved(), `"app"`)
        } finally {
          assert.strictEqual((yield* run("stop")).code, 0)
        }
      }).pipe(Effect.provide(NodeServices.layer))
    ), timeout)

  // The browser WebSocket's id dies with that browser; the endpoint given outlives it
  it.live("exports a Chromium HTTP attachment by the endpoint it was given", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const served = yield* site
        const env = environment()
        const run = (...args: ReadonlyArray<string>) => strider(env, ...args)
        const tab = `${served.origin}/fixture?html=${encodeURIComponent("<title>remote</title>")}`
        const { endpoint } = yield* chromiumAttachable(Chromium.layerConnect).start(tab, tab)
        const file = path.join(env.XDG_STATE_HOME, "attached.test.ts")
        try {
          assert.strictEqual((yield* run("start", "--name", "remote", "--attach", endpoint)).code, 0)
          assert.strictEqual((yield* run("-s", "remote", "export", "test", file)).code, 0)
          assert.include(fs.readFileSync(file, "utf8"), `Chromium.layerConnect(${JSON.stringify(endpoint)})`)
        } finally {
          yield* run("-s", "remote", "stop")
        }
      }).pipe(Effect.provide(NodeServices.layer))
    ), timeout)

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

  it.live("shows what a daemon wrote to standard error when it dies before it serves", () =>
    Effect.gen(function*() {
      const env = environment()
      // A module the daemon, and only the daemon, fails to load, as one that fails at import time does
      const preload = path.join(env.XDG_RUNTIME_DIR, "boom.mjs")
      fs.writeFileSync(
        preload,
        `if (process.argv.includes("__daemon")) { console.error("boom at import"); process.exit(3) }\n`
      )
      const started = yield* strider(
        { ...env, NODE_OPTIONS: `--import=${preload}` },
        "start",
        "--name",
        "doomed",
        "--chromium",
        chromium.executable
      )
      assert.strictEqual(started.code, 3)
      assert.include(started.err, "exited before it served (3)")
      assert.include(started.err, "boom at import")
      // Nothing is left beside the sessions
      assert.deepStrictEqual(fs.readdirSync(env.XDG_RUNTIME_DIR).filter((name) => name.startsWith(".start-")), [])
    }), timeout)

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
