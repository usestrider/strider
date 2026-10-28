/**
 * The CLI sessions, without a browser: the ledger a program keeps, `strider mcp`'s arguments, and what an exported
 * test keeps of its session: a statement for every tool but the reads; a tab the session took with control, marked;
 * a page strider mcp opened; a renamed page; a removed declaration; secrets wherever the session put them in, but
 * not in a check's text; a fork or profile, said; a wait's deadline; a dialog's answer.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import { Ledger } from "@usestrider/browser"
import { BrowserToolkit } from "@usestrider/browser/ai"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as ExportTest from "../src/internal/cli/exportTest.ts"
import * as Mcp from "../src/internal/cli/mcp.ts"

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
  it("serves a session it is named, or one it starts, which ends with it unless kept", () => {
    assert.deepStrictEqual(Mcp.parse(["mcp", "-s", "shop"], 7, {}), { _tag: "Serve", session: "shop" })
    assert.deepStrictEqual(Mcp.parse(["-s", "shop", "mcp"], 7, {}), { _tag: "Serve", session: "shop" })
    assert.deepStrictEqual(Mcp.parse(["mcp"], 7, { STRIDER_SESSION: "env" }), { _tag: "Serve", session: "env" })
    assert.strictEqual(Mcp.parse(["mcp"], 7, {})._tag, "Invalid")
    assert.deepStrictEqual(Mcp.parse(["mcp", "--start", "--chromium", "/bin/chromium"], 7, {}), {
      _tag: "Start",
      session: "mcp-7",
      start: ["start", "--name", "mcp-7", "--chromium", "/bin/chromium", "--owner-pid", "7"]
    })
    assert.deepStrictEqual(
      Mcp.parse(["mcp", "--start", "--keep", "--name", "kept", "--firefox", "/bin/firefox"], 7, {}),
      {
        _tag: "Start",
        session: "kept",
        start: ["start", "--name", "kept", "--firefox", "/bin/firefox"]
      }
    )
  })
})

describe("strider export test", () => {
  const launched = { _tag: "Launch", backend: "chromium", executablePath: "/usr/bin/chromium" } as const
  const tool = (name: string, params: Record<string, unknown>, result?: string): ExportTest.Step => ({
    _tag: "Tool",
    tool: name,
    params,
    target: undefined,
    result
  })

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
    for (const name of Object.keys(BrowserToolkit.toolkit.tools)) {
      const step: ExportTest.Step = { _tag: "Tool", tool: name, params, target: `locator("#field")`, result: "w1" }
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
})
