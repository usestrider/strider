import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Client from "../src/internal/cli/client.ts"
import * as Session from "../src/internal/cli/session.ts"

describe("session files", () => {
  it("refuses to list sessions in a pre-existing accessible root", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      const root = Session.root({ XDG_RUNTIME_DIR: temporary }, temporary)
      fs.mkdirSync(root)
      fs.chmodSync(root, 0o777)
      fs.mkdirSync(path.join(root, "example"))
      fs.writeFileSync(path.join(root, "example", "daemon.sock"), "")
      const result = await Effect.runPromiseExit(Client.running(root).pipe(Effect.provide(NodeServices.layer)))
      assert.isTrue(Exit.isFailure(result), `Expected rejection, got ${JSON.stringify(result)}`)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("does not append startup stderr through a pre-existing log symlink", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    const previous = process.env.XDG_RUNTIME_DIR
    try {
      process.env.XDG_RUNTIME_DIR = temporary
      const root = Session.root(process.env, temporary)
      fs.mkdirSync(root)
      fs.chmodSync(root, 0o777)
      const target = path.join(temporary, "target")
      fs.writeFileSync(target, "original\n")
      fs.symlinkSync(target, path.join(root, `.start-${process.pid}.log`))
      const daemon = path.join(temporary, "daemon.cjs")
      fs.writeFileSync(daemon, "process.stderr.write(\"startup-marker\\n\"); process.exitCode = 1\n")
      await Effect.runPromiseExit(Client.start([], daemon).pipe(Effect.provide(NodeServices.layer)))
      assert.strictEqual(fs.readFileSync(target, "utf8"), "original\n")
    } finally {
      if (previous === undefined) delete process.env.XDG_RUNTIME_DIR
      else process.env.XDG_RUNTIME_DIR = previous
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })
})
