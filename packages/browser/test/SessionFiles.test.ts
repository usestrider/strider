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
  it("rejects wrong-owner metadata (mock; no second user)", () => {
    assert.isFalse(
      Session.privateDirectory({ uid: 42, mode: 0o700, isDirectory: () => true, isSymbolicLink: () => false }, 43)
    )
  })

  it("accepts a private root and leaves a missing root absent", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      const root = path.join(temporary, "strider")
      assert.deepEqual(await Effect.runPromise(Client.running(root).pipe(Effect.provide(NodeServices.layer))), [])
      assert.isFalse(fs.existsSync(root))
      fs.mkdirSync(root, { mode: 0o700 })
      assert.deepEqual(await Effect.runPromise(Client.running(root).pipe(Effect.provide(NodeServices.layer))), [])
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("rejects unsafe ancestors before creating a missing root", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      fs.chmodSync(temporary, 0o777)
      const root = path.join(temporary, "strider")
      assert.isTrue(Exit.isFailure(await Effect.runPromiseExit(Session.validateRoot(root, true))))
      assert.isFalse(fs.existsSync(root))
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("rejects an unsafe root before connecting", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      fs.chmodSync(temporary, 0o777)
      const result = await Effect.runPromiseExit(Effect.scoped(Client.session(temporary, "example")))
      assert.isTrue(Exit.isFailure(result))
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("uses the current user identity in the fallback", () => {
    assert.strictEqual(Session.root({}, "/tmp"), `/tmp/strider-${process.getuid!()}`)
  })

  it("rejects a symlink root before listing", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      fs.mkdirSync(path.join(temporary, "actual"), { mode: 0o700 })
      const root = path.join(temporary, "strider")
      fs.symlinkSync(path.join(temporary, "actual"), root)
      const result = await Effect.runPromiseExit(Client.running(root).pipe(Effect.provide(NodeServices.layer)))
      assert.isTrue(Exit.isFailure(result))
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

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
      fs.chmodSync(root, 0o700)
      const target = path.join(temporary, "target")
      fs.writeFileSync(target, "original\n")
      fs.symlinkSync(target, path.join(root, `.start-${process.pid}.log`))
      const plantedSocket = path.join(root, `.start-${process.pid}.sock`)
      fs.writeFileSync(plantedSocket, "leave untouched")
      const daemon = path.join(temporary, "daemon.cjs")
      const marker = path.join(temporary, "executed")
      fs.writeFileSync(
        daemon,
        "require('node:fs').writeFileSync(" + JSON.stringify(marker) +
          ", 'yes'); process.stderr.write('startup-marker\\n'); process.exitCode = 1\n"
      )
      await Effect.runPromiseExit(Client.start([], daemon).pipe(Effect.provide(NodeServices.layer)))
      assert.strictEqual(fs.readFileSync(target, "utf8"), "original\n")
      assert.strictEqual(fs.readFileSync(marker, "utf8"), "yes")
      assert.strictEqual(fs.readFileSync(plantedSocket, "utf8"), "leave untouched")
    } finally {
      if (previous === undefined) delete process.env.XDG_RUNTIME_DIR
      else process.env.XDG_RUNTIME_DIR = previous
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })
})
