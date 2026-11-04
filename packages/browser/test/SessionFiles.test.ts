import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { spawn, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import * as Client from "../src/internal/cli/client.ts"
import * as Session from "../src/internal/cli/session.ts"

const bin = new URL("../src/bin/strider.ts", import.meta.url).pathname

/** The real command, with its environment replaced; a real child process on the real filesystem. */
const strider = (env: Readonly<Record<string, string>>, ...args: ReadonlyArray<string>) => {
  const { XDG_RUNTIME_DIR: _, ...inherited } = process.env
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...inherited, NO_COLOR: "1", ...env }
  })
}

describe("session files", () => {
  it("rejects aliases beneath writable parents and aliases to unsafe ancestry", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      const parent = path.join(temporary, "parent")
      const target = path.join(temporary, "target")
      fs.mkdirSync(parent, { mode: 0o700 })
      fs.mkdirSync(target, { mode: 0o700 })
      fs.symlinkSync(target, path.join(parent, "alias"))
      fs.chmodSync(parent, 0o777)
      assert.isTrue(
        Exit.isFailure(await Effect.runPromiseExit(Session.validateRoot(path.join(parent, "alias", "strider"))))
      )
      fs.chmodSync(parent, 0o700)
      fs.chmodSync(target, 0o777)
      assert.isTrue(
        Exit.isFailure(await Effect.runPromiseExit(Session.validateRoot(path.join(parent, "alias", "strider"))))
      )
      assert.isFalse(fs.existsSync(path.join(target, "strider")))
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("checks alias target components before parent traversal", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      fs.mkdirSync(path.join(temporary, "unsafe"))
      fs.chmodSync(path.join(temporary, "unsafe"), 0o777)
      fs.mkdirSync(path.join(temporary, "target"), { mode: 0o700 })
      // Preserve .. in the link text so every traversed component must be checked.
      fs.symlinkSync(temporary + "/unsafe/../target", path.join(temporary, "alias"))
      assert.isTrue(
        Exit.isFailure(await Effect.runPromiseExit(Session.validateRoot(path.join(temporary, "alias", "strider"))))
      )
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("creates missing parents privately after validating their ancestors", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      const root = path.join(temporary, "new", "runtime", "strider")
      assert.isTrue(Exit.isSuccess(await Effect.runPromiseExit(Session.validateRoot(root, true))))
      assert.strictEqual(fs.statSync(root).mode & 0o777, 0o700)
      assert.strictEqual(fs.statSync(path.dirname(root)).mode & 0o777, 0o700)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("rejects traversal from flag, environment, fork and MCP name sources without stdout", () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      const cases = [
        { args: ["-s", "../outside", "pages"], env: {} },
        { args: ["pages"], env: { STRIDER_SESSION: "../outside" } },
        { args: ["mcp", "-s", "../outside"], env: {} },
        { args: ["mcp"], env: { STRIDER_SESSION: "../outside" } },
        { args: ["start", "--name", "../outside"], env: {} },
        { args: ["start", "--fork", "../outside"], env: {} },
        { args: ["mcp", "--start", "--name", "../outside"], env: {} }
      ]
      for (const test of cases) {
        const result = strider({ XDG_RUNTIME_DIR: temporary, XDG_STATE_HOME: temporary, ...test.env }, ...test.args)
        assert.notStrictEqual(result.status, 0)
        assert.strictEqual(result.stdout, "", result.stdout)
        assert.match(result.stderr, /session name|a name is/)
      }
      assert.deepEqual(fs.readdirSync(temporary), [])
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("still lists the running sessions when the named session has no directory", () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      fs.mkdirSync(path.join(temporary, "strider", "other"), { recursive: true, mode: 0o700 })
      fs.chmodSync(path.join(temporary, "strider"), 0o700)
      fs.writeFileSync(path.join(temporary, "strider", "other", "daemon.sock"), "")
      const result = strider({ XDG_RUNTIME_DIR: temporary, XDG_STATE_HOME: temporary }, "-s", "nope", "pages")
      assert.strictEqual(result.status, 20)
      assert.include(result.stderr, "running: other")
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("prunes a session without killing a process of another whose name starts the same", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    // A real process whose command line names the other session's profile, as a browser's does
    const other = path.join(temporary, "strider", "ab", "profile")
    const browser = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)", other], { stdio: "ignore" })
    const exited = new Promise<NodeJS.Signals | null>((resolve) => browser.once("exit", (_, signal) => resolve(signal)))
    try {
      await new Promise((resolve) => browser.once("spawn", resolve))
      fs.mkdirSync(path.join(temporary, "strider", "a"), { recursive: true, mode: 0o700 })
      fs.chmodSync(path.join(temporary, "strider"), 0o700)
      strider({ XDG_RUNTIME_DIR: temporary, XDG_STATE_HOME: temporary }, "prune", "a")
      assert.isFalse(fs.existsSync(path.join(temporary, "strider", "a")))
      const killed = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve("alive"), 500))])
      assert.strictEqual(killed, "alive")
    } finally {
      browser.kill("SIGKILL")
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("keeps MCP filesystem failures off stdout", () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      fs.mkdirSync(path.join(temporary, "strider"), { mode: 0o777 })
      fs.chmodSync(path.join(temporary, "strider"), 0o777)
      const result = strider({ XDG_RUNTIME_DIR: temporary }, "mcp", "-s", "example")
      assert.notStrictEqual(result.status, 0)
      assert.strictEqual(result.stdout, "")
      assert.include(result.stderr, "Unsafe session directory")
      assert.notMatch(result.stderr, /ERROR \(#\d+\)|\n\s+at /)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("rejects session directory symlinks before connecting", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      const root = path.join(temporary, "strider")
      fs.mkdirSync(root, { mode: 0o700 })
      fs.mkdirSync(path.join(temporary, "target"), { mode: 0o700 })
      fs.symlinkSync(path.join(temporary, "target"), path.join(root, "example"))
      const result = await Effect.runPromiseExit(Effect.scoped(Client.session(root, "example")))
      assert.isTrue(Exit.isFailure(result))
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("rejects wrong-owner metadata (mock; no second user)", () => {
    assert.isFalse(
      Session.trustedAlias({ uid: 42, mode: 0o777, isDirectory: () => false, isSymbolicLink: () => true }, 43)
    )
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

  it("does not reach a socket planted in a root that was missing when the client was made", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    const planted = net.createServer((socket) => {
      connected = true
      socket.destroy()
    })
    let connected = false
    try {
      const root = path.join(temporary, "strider")
      await Effect.runPromiseExit(
        Effect.scoped(Effect.gen(function*() {
          const client = yield* Client.session(root, "example")
          // What another user could do in a shared /tmp once the check has found nothing: the mode stands in for
          // the owner, as the test runs as one user
          fs.mkdirSync(path.join(root, "example"), { recursive: true })
          fs.chmodSync(root, 0o777)
          fs.chmodSync(path.join(root, "example"), 0o777)
          yield* Effect.promise(() =>
            new Promise<void>((resolve) => planted.listen(path.join(root, "example", "daemon.sock"), resolve))
          )
          yield* client.Info()
        })).pipe(Effect.timeout("2 seconds"))
      )
      assert.isFalse(connected, "the client connected to a socket in a root it never validated")
    } finally {
      planted.close()
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("accepts an OS temporary directory reached through its owner's symlink, as macOS's /var and /tmp are", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      fs.mkdirSync(path.join(temporary, "real"), { mode: 0o700 })
      fs.symlinkSync("real", path.join(temporary, "alias"))
      const result = strider({ TMPDIR: path.join(temporary, "alias"), XDG_STATE_HOME: temporary }, "sessions")
      assert.strictEqual(result.status, 0, result.stderr)
      assert.include(result.stdout, "No sessions")
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("refuses a prune name that leaves the session root", () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      fs.mkdirSync(path.join(temporary, "strider"), { mode: 0o700 })
      fs.mkdirSync(path.join(temporary, "outside"), { mode: 0o700 })
      fs.writeFileSync(path.join(temporary, "outside", "keep"), "keep")
      const result = strider({ XDG_RUNTIME_DIR: temporary, XDG_STATE_HOME: temporary }, "prune", "../outside")
      assert.isTrue(fs.existsSync(path.join(temporary, "outside", "keep")), result.stdout + result.stderr)
      assert.notStrictEqual(result.status, 0)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("explains an unsafe root without a defect's log line and stack", () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "strider-files-"))
    try {
      fs.mkdirSync(path.join(temporary, "strider"))
      fs.chmodSync(path.join(temporary, "strider"), 0o777)
      const result = strider({ XDG_RUNTIME_DIR: temporary, XDG_STATE_HOME: temporary }, "sessions")
      assert.notStrictEqual(result.status, 0)
      assert.include(result.stderr, path.join(temporary, "strider"))
      assert.notMatch(result.stderr, /ERROR \(#\d+\)|\n\s+at /)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })
})
