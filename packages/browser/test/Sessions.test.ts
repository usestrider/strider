/**
 * The CLI sessions, without a browser: the ledger a program keeps, `strider mcp`'s arguments, and what an exported
 * test keeps of its session: a statement for every tool but the reads; a tab the session took with control, marked;
 * a page strider mcp opened; a renamed page; a removed declaration; secrets wherever the session put them in, but
 * not in a check's text, and a `%…%` that names none as text; a fork or profile, said; a wait's deadline; a dialog's
 * answer; and a page no command opened, declared where a step names it, from what the session recorded of it.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import { Ledger } from "@usestrider/browser"
import * as McpSchema from "effect/ai/McpSchema"
import * as Tool from "effect/ai/Tool"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as ExportTest from "../src/internal/cli/exportTest.ts"
import * as Mcp from "../src/internal/cli/mcp.ts"
import * as Recorder from "../src/internal/cli/recorder.ts"
import * as Session from "../src/internal/cli/session.ts"
import * as Tools from "../src/internal/tools.ts"

describe("Session.scan", () => {
  it("reads the session before stop", () => {
    assert.deepStrictEqual(Session.scan(["-s", "checkout", "stop"]), { session: "checkout", command: "stop" })
  })

  it("reads the session after stop", () => {
    assert.deepStrictEqual(Session.scan(["stop", "-s", "checkout"]), { session: "checkout", command: "stop" })
  })
  it("reads long session flags on either side of the command", () => {
    for (const flags of [["--session", "checkout"], ["--session=checkout"], ["-s=checkout"]]) {
      for (const argv of [[...flags, "stop"], ["stop", ...flags]]) {
        assert.deepStrictEqual(Session.scan(argv), { session: "checkout", command: "stop" })
      }
    }
  })

  it("preserves inline command data and stops at the literal boundary", () => {
    for (
      const data of [
        ["fill", "css=input", "text containing --session=other"],
        ["expect", "css=p", "visible", "--text=--session=other"],
        ["fill", "css=input", "--", "-s", "other"],
        ["run", "file.ts", "--", "--session=other"]
      ]
    ) {
      const argv = ["-s", "checkout", ...data]
      assert.deepStrictEqual(Session.scan(argv), { session: "checkout", command: data[0] })
      assert.deepStrictEqual(Session.withoutSession(argv), data)
    }
    assert.deepStrictEqual(Session.scan(["--", "-s", "other"]), { session: undefined, command: undefined })
    assert.deepStrictEqual(Session.scan(["stop", "--", "--session=other"]), { session: undefined, command: "stop" })
    assert.deepStrictEqual(Session.scan(["-p", "stop", "pages", "--session=checkout"]), {
      session: "checkout",
      command: "pages"
    })
    assert.deepStrictEqual(Session.scan(["stop", "-p", "--", "-s", "other"]), {
      session: undefined,
      command: "stop"
    })
  })

  it("removes only session options before the literal boundary", () => {
    for (const flags of [["-s", "checkout"], ["--session", "checkout"], ["--session=checkout"]]) {
      const data = ["--page=stop", "fill", "css=input", "--", "--session=other", "-s", "literal"]
      const argv = [...data.slice(0, 2), ...flags, ...data.slice(2)]
      assert.deepStrictEqual(Session.scan(argv), { session: "checkout", command: "fill" })
      assert.deepStrictEqual(Session.withoutSession(argv), data)
    }
  })
})

describe("Ledger", () => {
  it.effect("records what a program owns while it owns it, and forgets it as the program ends", () =>
    Effect.gen(function*() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-ledger-"))
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Layer.build(Ledger.layer(directory))
        const ledger = yield* Ledger.CurrentLedger.pipe(Effect.provideContext(context))
        yield* ledger.add({ _tag: "Directory", path: "/tmp/strider-downloads-a" })
        yield* ledger.add({
          _tag: "Browser",
          pid: 4242,
          executable: "/usr/bin/chromium",
          profile: "/tmp/strider-chromium-b"
        })
        yield* ledger.remove({ _tag: "Directory", path: "/tmp/strider-downloads-a" })
        const records = yield* Ledger.read(directory)
        assert.strictEqual(records.length, 1)
        assert.strictEqual(records[0]!.record.owner.pid, process.pid)
        assert.deepStrictEqual(records[0]!.record.items, [
          { _tag: "Browser", pid: 4242, executable: "/usr/bin/chromium", profile: "/tmp/strider-chromium-b" }
        ])
      }))
      // A program that ends cleanly leaves no record
      assert.deepStrictEqual(yield* Ledger.read(directory), [])
      yield* (yield* FileSystem.FileSystem).remove(directory, { recursive: true })
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("records nothing unless a program provides it", () =>
    Effect.gen(function*() {
      const ledger = yield* Ledger.CurrentLedger
      yield* ledger.add({ _tag: "Directory", path: "/tmp/nowhere" })
    }))
})

describe("strider mcp", () => {
  it("tells a client which tools only read and which act on a page as a person would", () => {
    const hints = (name: Tools.ToolName) => {
      const annotations = Tools.toolkit.tools[name].annotations
      return [Context.get(annotations, Tool.Readonly), Context.get(annotations, Tool.Destructive)]
    }
    for (const name of ["pages", "tabs", "snapshot", "find", "screenshot", "history", "expect"] as const) {
      assert.deepStrictEqual(hints(name), [true, false], name)
    }
    for (const name of ["newPage", "next", "await", "route", "dialog", "control", "release", "scroll"] as const) {
      assert.deepStrictEqual(hints(name), [false, false], name)
    }
    for (const name of ["goto", "back", "click", "fill", "press", "select"] as const) {
      assert.deepStrictEqual(hints(name), [false, true], name)
    }
  })

  it("gives a client a screenshot as an image, with the digest as text", () => {
    const structuredContent = { outcome: { mediaType: "image/png", data: "iVBORw0K" }, sinceLast: ["navigated"] }
    const answered = new McpSchema.CallToolResult({
      structuredContent,
      content: [{ type: "text", text: JSON.stringify(structuredContent) }]
    })
    const shown = Mcp.asImage(answered)
    assert.instanceOf(shown, McpSchema.CallToolResult)
    const [image, text] = (shown as McpSchema.CallToolResult).content
    assert.deepStrictEqual(image, {
      type: "image",
      mimeType: "image/png",
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
    })
    assert.deepStrictEqual(text, { type: "text", text: JSON.stringify({ sinceLast: ["navigated"] }) })
    // The bytes cross once, as the image
    assert.deepStrictEqual((shown as McpSchema.CallToolResult).structuredContent, {
      outcome: { mediaType: "image/png" },
      sinceLast: ["navigated"]
    })
    // A failure is as it was
    const failed = new McpSchema.CallToolResult({ isError: true, content: [{ type: "text", text: "{}" }] })
    assert.strictEqual(Mcp.asImage(failed), failed)
  })

  const parse = (argv: ReadonlyArray<string>, env: Readonly<Record<string, string>>) =>
    Mcp.parse(argv, 7, env).pipe(Effect.provide(NodeServices.layer))

  it.effect("uses explicit session flags before environment defaults, and takes nothing after --", () =>
    Effect.gen(function*() {
      for (const flag of [["-s", "shop"], ["--session", "shop"], ["--session=shop"]]) {
        for (const argv of [[...flag, "mcp"], ["mcp", ...flag]]) {
          assert.deepStrictEqual(yield* parse(argv, { STRIDER_SESSION: "env" }), { _tag: "Serve", session: "shop" })
        }
        assert.deepStrictEqual(yield* parse(["mcp", ...flag, "--start"], {}), {
          _tag: "Start",
          session: "shop",
          start: ["start", "--name", "shop", "--owner-pid", "7"]
        })
      }
      // What follows -- is an operand, which mcp takes none of, never a session flag
      const literal = yield* Effect.exit(parse(["mcp", "--", "--session=other"], { STRIDER_SESSION: "env" }))
      assert.isTrue(literal._tag === "Failure")
    }))

  it.effect("serves a session it is named, or one it starts, which ends with it unless kept", () =>
    Effect.gen(function*() {
      assert.deepStrictEqual(yield* parse(["mcp", "-s", "shop"], {}), { _tag: "Serve", session: "shop" })
      assert.deepStrictEqual(yield* parse(["-s", "shop", "mcp"], {}), { _tag: "Serve", session: "shop" })
      assert.deepStrictEqual(yield* parse(["mcp"], { STRIDER_SESSION: "env" }), { _tag: "Serve", session: "env" })
      assert.strictEqual((yield* parse(["mcp"], {}))?._tag, "Invalid")
      assert.deepStrictEqual(yield* parse(["mcp", "--start", "--chromium", "/bin/chromium"], {}), {
        _tag: "Start",
        session: "mcp-7",
        start: ["start", "--name", "mcp-7", "--chromium", "/bin/chromium", "--owner-pid", "7"]
      })
      assert.deepStrictEqual(
        yield* parse(["mcp", "--start", "--keep", "--name", "kept", "--firefox", "/bin/firefox"], {}),
        {
          _tag: "Start",
          session: "kept",
          start: ["start", "--name", "kept", "--firefox", "/bin/firefox"]
        }
      )
      assert.deepStrictEqual(
        yield* parse(
          [
            "mcp",
            "--start",
            "--chromium",
            "/bin/chromium",
            "--idle",
            "5 minutes",
            "--capture",
            "strict",
            "--secret",
            "pw=PW"
          ],
          {}
        ),
        {
          _tag: "Start",
          session: "mcp-7",
          start: [
            "start",
            "--name",
            "mcp-7",
            "--chromium",
            "/bin/chromium",
            "--idle",
            "5 minutes",
            "--capture",
            "strict",
            "--secret",
            "pw=PW",
            "--owner-pid",
            "7"
          ]
        }
      )
    }))
})

describe("strider export test", () => {
  const launched = { _tag: "Launch", backend: "chromium", executablePath: "/usr/bin/chromium" } as const
  const tool = <K extends Tools.ToolName>(name: K, params: Tools.Params<K>, result?: string): ExportTest.Step => {
    const call: Tools.Call = Tools.call(name, params)
    return { _tag: "Tool", ...call, target: undefined, result }
  }

  it("marks a tab the session took with control, until its release, which a test takes itself", () => {
    const { placeholders, text } = ExportTest.render({
      name: "attached",
      browser: { _tag: "Attach", backend: "chromium", endpoint: "http://127.0.0.1:9222" },
      secrets: {},
      state: undefined,
      steps: [
        tool("control", { tab: "N7", name: "mail" }, "mail"),
        tool("goto", { page: "mail", url: "https://mail.example.com/inbox" }),
        tool("release", { page: "mail" }, "released mail; the tab stays open")
      ]
    })
    assert.deepStrictEqual(placeholders, [
      "strider control N7, a tab of the browser's own",
      "strider release -p mail, which gives back a tab the test takes by hand"
    ])
    assert.include(
      text,
      "// TODO strider control N7: a tab of the browser's own; take it with page.control in the test, as mail\n"
    )
    assert.include(text, `yield* mail.goto("https://mail.example.com/inbox")\n`)
    assert.include(text, "// TODO strider release -p mail: the session gave the tab back here")
  })

  it("opens a page that newPage opened through strider mcp, under the name it printed", () => {
    const { text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: {},
      state: undefined,
      steps: [
        tool("newPage", { name: "shop", url: "https://shop.example.com" }, "shop"),
        tool("newPage", {}, "p2"),
        tool("goto", { page: "p2", url: "https://shop.example.com/cart" })
      ]
    })
    assert.include(
      text,
      [
        `        const shop = yield* context.newPage`,
        `        yield* shop.goto("https://shop.example.com")`,
        `        const p2 = yield* context.newPage`,
        `        yield* p2.goto("https://shop.example.com/cart")`,
        ``
      ].join("\n")
    )
  })

  it("writes a statement for every tool the session records, from the CLI or strider mcp, but the reads", () => {
    const reads = ["find", "history", "pages", "screenshot", "snapshot", "tabs"]
    const params = {
      page: "main",
      target: "css=#field",
      url: "https://shop.example.com",
      value: "Ada",
      key: "Enter",
      values: ["Blue"],
      event: "navigation",
      wait: "w1",
      state: "visible",
      pattern: "**/api/**",
      action: "abort",
      decision: "accept",
      tab: "N1"
    }
    const exported = (steps: ReadonlyArray<ExportTest.Step>) =>
      ExportTest.render({ name: "shop", browser: launched, secrets: {}, state: undefined, steps }).text
    const opened: ExportTest.Step = { _tag: "NewPage", page: "main", url: undefined }
    for (const name of Tools.ToolName.literals) {
      // One set of parameters that every tool's statement finds what it needs in
      const step: ExportTest.Step = {
        _tag: "Tool",
        ...Tools.call(name, params as Tools.Params<typeof name> & typeof params),
        target: `locator("#field")`,
        result: "w1"
      }
      const text = exported([opened, step])
      if (reads.includes(name)) assert.strictEqual(text, exported([opened]), `${name} is a read`)
      else assert.notStrictEqual(text, exported([opened]), `${name} has no statement`)
    }
  })

  it("keeps a wait's deadline, as Deadline.within around its next", () => {
    const { text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: {},
      state: undefined,
      steps: [
        { _tag: "NewPage", page: "main", url: "https://shop.example.com/orders" },
        tool("next", { page: "main", event: "download", within: "2 minutes" }, "w1"),
        tool("next", { page: "main", event: "response", url: "**/api/orders", within: "30  seconds" }, "w2"),
        tool("next", { page: "main", event: "navigation" }, "w3")
      ]
    })
    assert.include(
      text,
      `import { Browser, Deadline, Download, NetworkResponse, PageNavigation } from "@usestrider/browser"`
    )
    assert.include(text, `const w1 = yield* Download.next(main).pipe(Deadline.within("2 minutes"))`)
    // Written as Duration.Input's type takes it, with one space before the unit
    assert.include(
      text,
      `const w2 = yield* NetworkResponse.next(main, { url: "**/api/orders" }).pipe(Deadline.within("30 seconds"))`
    )
    // A wait without one takes the default budget, as it did in the session
    assert.include(text, `const w3 = yield* PageNavigation.next(main)\n`)
  })

  it("imports Deadline only for a wait that had a deadline", () => {
    const { text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: {},
      state: undefined,
      steps: [
        { _tag: "NewPage", page: "main", url: undefined },
        tool("next", { page: "main", event: "popup" }, "w1")
      ]
    })
    assert.include(text, `import { Browser, Popup } from "@usestrider/browser"`)
    assert.notInclude(text, "Deadline")
  })

  it("ends a route or dialog handler where the session removed it, with its handle's remove", () => {
    const { text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: {},
      state: undefined,
      steps: [
        { _tag: "NewPage", page: "main", url: undefined },
        tool("route", { page: "main", pattern: "**/analytics/**", action: "abort" }, "r1"),
        tool("dialog", { page: "main", decision: "dismiss" }, "r2"),
        tool("route", { page: "main", pattern: "**/ads/**", action: "abort" }, "r3"),
        { _tag: "Remove", registration: "r1" },
        { _tag: "Remove", registration: "r2" }
      ]
    })
    assert.include(
      text,
      `const r1 = yield* main.route("**/analytics/**", () => Effect.succeed(Route.abort()))\n`
    )
    assert.include(text, `const r2 = yield* Dialog.handle(main, Dialog.dismissAll)\n`)
    // One the session kept on ends with the test's scope, so it needs no name
    assert.include(text, `        yield* main.route("**/ads/**", () => Effect.succeed(Route.abort()))\n`)
    assert.include(text, `        yield* r1.remove\n        yield* r2.remove\n`)
  })

  it("gives a page the session renamed a variable of its new name, which later steps use", () => {
    const { text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: {},
      state: undefined,
      steps: [
        { _tag: "NewPage", page: "main", url: undefined },
        tool("next", { page: "main", event: "popup" }, "w1"),
        {
          _tag: "Tool",
          tool: "click",
          params: { page: "main", target: `role=button[name="Open"]` },
          target: `getByRole("button", { name: "Open", exact: true })`,
          result: undefined
        },
        tool("await", { wait: "w1" }, "popup p2, at about:blank so far"),
        { _tag: "Rename", from: "p2", to: "consent-form" },
        {
          _tag: "Tool",
          tool: "click",
          params: { page: "consent-form", target: "e3" },
          target: `getByRole("button", { name: "Accept", exact: true })`,
          result: undefined
        },
        // A name a page gave up is a new page's, with a variable of its own
        { _tag: "Rename", from: "main", to: "shop" },
        { _tag: "NewPage", page: "main", url: undefined },
        tool("goto", { page: "main", url: "https://shop.example.com/help" }),
        tool("goto", { page: "shop", url: "https://shop.example.com/cart" })
      ]
    })
    assert.include(text, `const p2 = yield* w1\n        const consentForm = p2\n`)
    assert.include(text, `yield* consentForm.getByRole("button", { name: "Accept", exact: true }).click()`)
    assert.include(text, `const shop = main\n        const main_2 = yield* context.newPage\n`)
    assert.include(text, `yield* main_2.goto("https://shop.example.com/help")\n`)
    assert.include(text, `yield* shop.goto("https://shop.example.com/cart")\n`)
  })

  it("builds a secret into a fill's value or a URL wherever the session put it in", () => {
    const fill = (target: string, value: string): ExportTest.Step => ({
      _tag: "Tool",
      tool: "fill",
      params: { page: "main", target: "label=…", value },
      target,
      result: undefined
    })
    const { text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: { password: "APP_PASSWORD", token: "API_TOKEN" },
      state: undefined,
      steps: [
        { _tag: "NewPage", page: "main", url: undefined },
        fill(`getByLabel("Password")`, "%password%"),
        fill(`getByLabel("Login")`, "ada:%password%"),
        // Template-literal syntax in the text is text
        fill(`getByLabel("Note")`, "%token%`${x}`\\"),
        fill(`getByLabel("Name")`, "100% Ada"),
        tool("goto", { page: "main", url: "https://shop.example.com/login?token=%token%&next=/cart" }),
        tool("goto", { page: "main", url: "%token%" }),
        tool("newPage", { name: "admin", url: "https://%token%@admin.example.com" }, "admin")
      ]
    })
    assert.include(text, `import { Config, Effect, Layer, Redacted } from "effect"`)
    const token = `\${Redacted.value(yield* Config.Redacted("API_TOKEN"))}`
    assert.include(text, `yield* main.getByLabel("Password").fill(yield* Config.Redacted("APP_PASSWORD"))\n`)
    // Filled redacted, as the session filled a value with a secret in it
    assert.include(
      text,
      `yield* main.getByLabel("Login").fill(Redacted.make(\`ada:\${Redacted.value(yield* Config.Redacted("APP_PASSWORD"))}\`))\n`
    )
    assert.include(text, `yield* main.getByLabel("Note").fill(Redacted.make(\`${token}\\\`\\\${x}\\\`\\\\\`))\n`)
    assert.include(text, `yield* main.getByLabel("Name").fill("100% Ada")\n`)
    assert.include(text, `yield* main.goto(\`https://shop.example.com/login?token=${token}&next=/cart\`)\n`)
    assert.include(text, `yield* main.goto(Redacted.value(yield* Config.Redacted("API_TOKEN")))\n`)
    assert.include(text, `yield* admin.goto(\`https://${token}@admin.example.com\`)\n`)
  })

  it("builds a secret into the URL page new opened a page at, as into goto's", () => {
    const { text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: { token: "API_TOKEN" },
      state: undefined,
      steps: [
        { _tag: "NewPage", page: "account", url: "https://shop.example.com/account?token=%token%" },
        { _tag: "NewPage", page: "help", url: "https://shop.example.com/help" }
      ]
    })
    assert.include(
      text,
      [
        `        const account = yield* context.newPage`,
        `        yield* account.goto(\`https://shop.example.com/account?token=\${Redacted.value(yield* Config.Redacted("API_TOKEN"))}\`)`,
        `        const help = yield* context.newPage`,
        `        yield* help.goto("https://shop.example.com/help")`,
        ``
      ].join("\n")
    )
    assert.include(text, `import { Config, Effect, Layer, Redacted } from "effect"`)
  })

  it("keeps a %…% that names no secret as the text the session sent, such as a URL's percent-escapes", () => {
    const { text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: { token: "API_TOKEN" },
      state: undefined,
      steps: [
        { _tag: "NewPage", page: "main", url: undefined },
        tool("goto", { page: "main", url: "https://shop.example.com/caf%C3%A9" }),
        tool("goto", { page: "main", url: "https://shop.example.com/caf%C3%A9?token=%token%" }),
        // A mistyped name is text too, as the session filled it
        {
          _tag: "Tool",
          tool: "fill",
          params: { page: "main", target: "label=Token", value: "%tokn%" },
          target: `getByLabel("Token")`,
          result: undefined
        },
        {
          _tag: "Tool",
          tool: "expect",
          params: { page: "main", target: "css=#sale", state: "visible", text: "50%off%" },
          target: `locator("#sale")`,
          result: undefined
        }
      ]
    })
    assert.include(text, `yield* main.goto("https://shop.example.com/caf%C3%A9")\n`)
    assert.include(
      text,
      `yield* main.goto(\`https://shop.example.com/caf%C3%A9?token=\${Redacted.value(yield* Config.Redacted("API_TOKEN"))}\`)\n`
    )
    assert.include(text, `yield* main.getByLabel("Token").fill("%tokn%")\n`)
    assert.include(text, `yield* main.locator("#sale").pipe(Expect.toContainText("50%off%"))\n`)
  })

  it("leaves out a check of a text with a secret in it, which a failure would print, and says so", () => {
    const expect = (text: string): ExportTest.Step => ({
      _tag: "Tool",
      tool: "expect",
      params: { page: "main", target: "css=#out", state: "visible", text },
      target: `locator("#out")`,
      result: undefined
    })
    const { text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: { password: "APP_PASSWORD", user: "APP_USER" },
      state: undefined,
      steps: [
        { _tag: "NewPage", page: "main", url: undefined },
        expect("%password%"),
        expect("Welcome, %user%"),
        expect("Saved")
      ]
    })
    assert.include(
      text,
      [
        `        yield* main.locator("#out").pipe(Expect.toBeVisible)`,
        `        // Left out: the session's check that this contains "%password%", which has a secret in it, since a failed check prints the text it expected`,
        `        yield* main.locator("#out").pipe(Expect.toBeVisible)`,
        `        // Left out: the session's check that this contains "Welcome, %user%", which has a secret in it, since a failed check prints the text it expected`,
        `        yield* main.locator("#out").pipe(Expect.toBeVisible)`,
        `        yield* main.locator("#out").pipe(Expect.toContainText("Saved"))`,
        ``
      ].join("\n")
    )
    assert.notInclude(text, "Config")
  })

  it("says when the session started from a fork or a profile, which the test starts without", () => {
    const exported = (origin: { readonly fork?: string; readonly userDataDir?: string }) =>
      ExportTest.render({
        name: "twin",
        browser: launched,
        secrets: {},
        state: undefined,
        ...origin,
        steps: [{ _tag: "NewPage", page: "main", url: "https://shop.example.com" }]
      }).text
    const context = `        const context = yield* Browser.newContext({ focus: "emulated" })\n`
    assert.include(
      exported({ fork: "login" }),
      `      Effect.scoped(Effect.gen(function*() {\n        // The session started from session login's state (start --fork), which no file holds: this test's context starts empty\n${context}`
    )
    assert.include(
      exported({ userDataDir: "/home/ada/profiles/shop" }),
      `        // The session's browser ran on the profile at /home/ada/profiles/shop (start --user-data-dir), which that browser keeps locked: this test's starts with an empty one\n${context}`
    )
    const both = exported({ fork: "login", userDataDir: "/home/ada/profiles/shop" })
    assert.match(both, /\(start --fork\).*\n.*\(start --user-data-dir\).*\n.*Browser\.newContext/)
    assert.notInclude(exported({}), "// The session")
  })

  it("answers a dialog of unknown kind with the text, as the session did", () => {
    const { text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: {},
      state: undefined,
      steps: [
        { _tag: "NewPage", page: "main", url: undefined },
        tool("dialog", { page: "main", decision: "accept", text: "Ada" })
      ]
    })
    assert.include(
      text,
      `dialog._tag === "Prompt" || dialog._tag === "Unknown" ? dialog.respond("Ada") : dialog._tag === "BeforeUnload" ? dialog.leave : dialog.accept`
    )
  })

  const open = (page: string, popups?: ReadonlyArray<ExportTest.Opened>): ExportTest.Step => ({
    _tag: "Tool",
    tool: "click",
    params: { page, target: `role=button[name="Open"]` },
    target: `getByRole("button", { name: "Open", exact: true })`,
    result: undefined,
    ...(popups === undefined ? {} : { popups })
  })

  it("waits for a popup the session never waited for from just before the command that opened it", () => {
    const { placeholders, text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: {},
      state: undefined,
      steps: [
        // Its first document opened one
        {
          _tag: "NewPage",
          page: "shop",
          url: "https://shop.example.com",
          popups: [{ page: "p1", opener: "shop" }]
        },
        // A click opened three, the last of which no step names
        open("shop", [{ page: "p2", opener: "shop" }, { page: "p3", opener: "shop" }, { page: "p4", opener: "shop" }]),
        { _tag: "Rename", from: "p2", to: "help" },
        tool("goto", { page: "help", url: "https://shop.example.com/help/faq" }),
        tool("goto", { page: "p1", url: "https://shop.example.com/offers" }),
        tool("goto", { page: "p3", url: "https://shop.example.com/chat" })
      ]
    })
    assert.include(
      text,
      [
        `        const shop = yield* context.newPage`,
        `        const shopPopups = yield* Popup.next(shop)`,
        `        yield* shop.goto("https://shop.example.com")`,
        `        const p1 = yield* shopPopups`,
        `        const shopPopups_2 = yield* Popup.next(shop)`,
        `        yield* shop.getByRole("button", { name: "Open", exact: true }).click()`,
        `        const p2 = yield* shopPopups_2`,
        // Popup.next gives an opener's first popup alone
        `        // TODO page p3: one of several popups the command above opened, which Popup.next can't single out; declare it here, as p3`,
        `        const help = p2`,
        `        yield* help.goto("https://shop.example.com/help/faq")`,
        `        yield* p1.goto("https://shop.example.com/offers")`,
        `        yield* p3.goto("https://shop.example.com/chat")`,
        ``
      ].join("\n")
    )
    assert.include(text, `import { Browser, Popup } from "@usestrider/browser"`)
    assert.notInclude(text, "p4")
    assert.deepStrictEqual(placeholders, ["page p3, a popup that Popup.next can't single out"])
  })

  it("declares a popup from the wait the session started where a step first names it, and a listed page by its place", () => {
    const { text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: {},
      state: undefined,
      steps: [
        { _tag: "NewPage", page: "main", url: undefined },
        tool("next", { page: "main", event: "popup" }, "w1"),
        open("main"),
        { _tag: "Popup", page: "p1", wait: "w1" },
        tool("goto", { page: "p1", url: "https://shop.example.com/help" }),
        // Collected after a step named it, so declared already
        tool("await", { wait: "w1" }, "popup p1, at https://shop.example.com/help so far"),
        // Found among the context's pages with no event that said what opened it, as on stock WebKit
        { _tag: "Listed", page: "p2", index: 2 },
        tool("goto", { page: "p2", url: "https://shop.example.com/chat" }),
        { _tag: "Listed", page: "p3", index: 3 }
      ]
    })
    assert.include(
      text,
      [
        `        yield* main.getByRole("button", { name: "Open", exact: true }).click()`,
        `        const p1 = yield* w1`,
        `        yield* p1.goto("https://shop.example.com/help")`,
        `        yield* w1`,
        `        const p2 = (yield* context.pages.waitFor((pages) => pages.length >= 3))[2]!`,
        `        yield* p2.goto("https://shop.example.com/chat")`,
        ``
      ].join("\n")
    )
    assert.notInclude(text, "p3")
  })

  it("declares a segment's pages in its placeholder, and marks a page no command it repeats opened", () => {
    const { placeholders, text } = ExportTest.render({
      name: "shop",
      browser: launched,
      secrets: {},
      state: undefined,
      steps: [
        { _tag: "NewPage", page: "main", url: undefined },
        { _tag: "Segment", file: "pay.ts", pages: ["receipt", "p2"] },
        tool("goto", { page: "receipt", url: "https://shop.example.com/receipt" }),
        // Such as one a command opened before it failed
        tool("goto", { page: "lost", url: "https://shop.example.com/lost" }),
        tool("goto", { page: "lost", url: "https://shop.example.com/found" })
      ]
    })
    assert.include(
      text,
      [
        `        // TODO strider run pay.ts: a segment runs only in a session; put its steps here, declaring receipt`,
        `        yield* receipt.goto("https://shop.example.com/receipt")`,
        `        // TODO page lost: the session had it, but no command the test repeats opened it; declare it here, as lost`,
        `        yield* lost.goto("https://shop.example.com/lost")`,
        `        yield* lost.goto("https://shop.example.com/found")`,
        ``
      ].join("\n")
    )
    assert.deepStrictEqual(placeholders, [
      "strider run pay.ts, which runs only in a session, declaring receipt",
      "page lost, which no command the test repeats opened"
    ])
  })
})

describe("strider export test's recorder", () => {
  const click: ExportTest.Step = {
    _tag: "Tool",
    tool: "click",
    params: { page: "shop", target: "css=#open" },
    target: `locator("#open")`,
    result: undefined
  }

  it("gives a popup to the command that opened it, as it ran or after it, under its opener's name then", () => {
    const recorder = Recorder.make()
    const opening = recorder.begin("action")
    // The page it opens, as the toolkit opens it
    opening.pages.add("A")
    recorder.record({ _tag: "NewPage", page: "shop", url: "https://shop.example.com" }, opening)
    recorder.declared("A")
    // Opened by its first document, as page new ran
    recorder.popup({ id: "B", name: "p1", opener: "A", openerName: "shop" })
    recorder.end(opening)
    const clicking = recorder.begin("action", ["A"])
    recorder.record(click, clicking)
    recorder.end(clicking)
    // Seen once the click was over, its opener renamed since
    recorder.record({ _tag: "Rename", from: "shop", to: "store" })
    recorder.popup({ id: "C", name: "p2", opener: "A", openerName: "store" })
    // Known already: told again, it's nothing new
    recorder.popup({ id: "B", name: "p1", opener: "A", openerName: "store" })
    assert.deepStrictEqual(recorder.steps, [
      { _tag: "NewPage", page: "shop", url: "https://shop.example.com", popups: [{ page: "p1", opener: "shop" }] },
      { ...click, popups: [{ page: "p2", opener: "shop" }] },
      { _tag: "Rename", from: "shop", to: "store" }
    ])
  })

  it("gives a popup to the wait pending on its opener, and none to a command that failed", () => {
    const recorder = Recorder.make()
    recorder.declared("A")
    recorder.waiting("w1", "A")
    const clicking = recorder.begin("action", ["A"])
    // The wait gives the first popup after it started, and the click opened the next
    recorder.popup({ id: "B", name: "p1", opener: "A", openerName: "shop" })
    recorder.popup({ id: "C", name: "p2", opener: "A", openerName: "shop" })
    recorder.record(click, clicking)
    recorder.end(clicking)
    // A click that failed isn't repeated, so its popup is left to a placeholder, even seen after it
    const failing = recorder.begin("action", ["A"])
    recorder.popup({ id: "D", name: "p3", opener: "A", openerName: "shop" })
    recorder.end(failing)
    recorder.popup({ id: "E", name: "p4", opener: "A", openerName: "shop" })
    // A page found among the context's pages, and one known already
    recorder.listed({ id: "F", name: "p5", index: 3 })
    recorder.listed({ id: "B", name: "p1", index: 1 })
    assert.deepStrictEqual(recorder.steps, [
      { _tag: "Popup", page: "p1", wait: "w1" },
      { ...click, popups: [{ page: "p2", opener: "shop" }] },
      { _tag: "Listed", page: "p5", index: 3 }
    ])
    assert.isTrue(recorder.declares("D"))
  })

  it("gives a popup to the command acting on its opener, of two at once, and to none when both act on it", () => {
    const recorder = Recorder.make()
    recorder.declared("A")
    recorder.declared("B")
    const toCart: ExportTest.Step = { ...click, params: { page: "cart", target: "css=#open" } }
    const onShop = recorder.begin("action", ["A"])
    const onCart = recorder.begin("action", ["B"])
    // Shop's popup, as the click on cart, which started later, still runs
    recorder.popup({ id: "C", name: "p1", opener: "A", openerName: "shop" })
    recorder.record(toCart, onCart)
    recorder.end(onCart)
    recorder.record(click, onShop)
    recorder.end(onShop)
    // After both: a popup of the popup is the command's that opened the popup, and cart's is cart's command's
    recorder.popup({ id: "D", name: "p2", opener: "C", openerName: "p1" })
    recorder.popup({ id: "E", name: "p3", opener: "B", openerName: "cart" })
    // Two commands at once on one page, which the session can't tell apart: a placeholder
    const first = recorder.begin("action", ["A"])
    const second = recorder.begin("action", ["A"])
    recorder.popup({ id: "F", name: "p4", opener: "A", openerName: "shop" })
    recorder.record(click, first)
    recorder.end(first)
    recorder.record(click, second)
    recorder.end(second)
    assert.deepStrictEqual(recorder.steps, [
      { ...toCart, popups: [{ page: "p3", opener: "cart" }] },
      { ...click, popups: [{ page: "p1", opener: "shop" }, { page: "p2", opener: "p1" }] },
      click,
      click
    ])
    assert.isTrue(recorder.declares("F"))
  })

  it("leaves the pages a segment opened to its placeholder, and a popup seen after it", () => {
    const recorder = Recorder.make()
    const running = recorder.begin("segment")
    recorder.listed({ id: "B", name: "p1", index: 1 })
    recorder.popup({ id: "C", name: "p2", opener: "A", openerName: "shop" })
    // The daemon finds what's new after it
    recorder.record({ _tag: "Segment", file: "pay.ts", pages: ["p1", "p2"] }, running)
    recorder.end(running)
    recorder.popup({ id: "D", name: "p3", opener: "A", openerName: "shop" })
    assert.deepStrictEqual(recorder.steps, [{ _tag: "Segment", file: "pay.ts", pages: ["p1", "p2", "p3"] }])
  })
})
