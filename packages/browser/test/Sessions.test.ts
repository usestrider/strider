/**
 * Review 22's CLI sessions, without a browser: the ledger a program keeps, `strider mcp`'s arguments, and how an
 * exported test marks a tab the session took with control.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import { Ledger } from "@usestrider/browser"
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
  it("marks a tab the session took with control, which a test takes itself", () => {
    const { placeholders, text } = ExportTest.render({
      name: "attached",
      browser: { _tag: "Attach", backend: "chromium", endpoint: "http://127.0.0.1:9222" },
      secrets: {},
      state: undefined,
      steps: [{
        _tag: "Tool",
        tool: "control",
        params: { tab: "N7", name: "mail" },
        target: undefined,
        result: undefined
      }]
    })
    assert.deepStrictEqual(placeholders, ["control N7"])
    assert.include(text, "// TODO strider control N7")
  })
})
