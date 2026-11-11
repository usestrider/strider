import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as PlatformError from "effect/PlatformError"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Daemon from "../src/internal/cli/daemon.ts"

describe("state save Git warning", () => {
  it.effect("keeps Git spawn failures advisory", () =>
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const failed = PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" })
      const result = yield* Daemon.stateFileCouldBeCommitted(import.meta.filename).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, {
          ...spawner,
          spawn: () => Effect.fail(failed)
        })
      )
      assert.isFalse(result)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("keeps filesystem inspection failures advisory", () =>
    Effect.gen(function*() {
      assert.isFalse(yield* Daemon.stateFileCouldBeCommitted(path.join(os.tmpdir(), "missing-strider-state", "state")))
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("bounds an unresponsive Git inspection to five seconds and releases it", () =>
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const spawned = yield* Deferred.make<void>()
      let released = 0
      const hung = ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      })
      const fiber = yield* Daemon.stateFileCouldBeCommitted(import.meta.filename).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, {
          ...spawner,
          spawn: () =>
            Effect.acquireRelease(
              Deferred.succeed(spawned, undefined).pipe(Effect.as(hung)),
              () => Effect.sync(() => released++)
            )
        }),
        Effect.forkChild
      )
      yield* Deferred.await(spawned)
      yield* TestClock.adjust("4999 millis")
      assert.isUndefined(fiber.pollUnsafe(), "the inspection gives up before its five-second budget")
      yield* TestClock.adjust("1 millis")
      // Bounded by the live clock, so a missing timeout fails here instead of hanging the suite.
      const result = yield* TestClock.withLive(Effect.timeoutOption(Fiber.join(fiber), "1 second"))
      if (Option.isNone(result)) yield* Fiber.interrupt(fiber)
      assert.deepStrictEqual(result, Option.some(false))
      assert.strictEqual(released, 1)
    }).pipe(Effect.provide(NodeServices.layer)))

  for (const kind of ["GIT_DIR", "GIT_INDEX_FILE"] as const) {
    it.effect(`ignores an inherited ${kind}`, () =>
      Effect.gen(function*() {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "strider-state-git-env-"))
        const previous = process.env[kind]
        try {
          const repo = path.join(root, "repo")
          fs.mkdirSync(repo)
          const git = (...args: Array<string>) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" })
          git("init")
          fs.writeFileSync(path.join(repo, ".gitignore"), "*.state\n")
          let destination: string
          let expected: boolean
          if (kind === "GIT_DIR") {
            // Outside every work tree, but an inherited GIT_DIR makes Git treat the directory as one.
            destination = path.join(root, "outside", "auth.json")
            expected = false
            process.env.GIT_DIR = path.join(repo, ".git")
          } else {
            // Tracked despite the ignore rule, but an empty inherited index hides that it is tracked.
            destination = path.join(repo, "auth.state")
            fs.writeFileSync(destination, "{}")
            git("add", "--force", "auth.state")
            expected = true
            process.env.GIT_INDEX_FILE = path.join(root, "missing-index")
          }
          fs.mkdirSync(path.dirname(destination), { recursive: true })
          fs.writeFileSync(destination, "{}")
          assert.strictEqual(yield* Daemon.stateFileCouldBeCommitted(destination), expected)
        } finally {
          if (previous === undefined) delete process.env[kind]
          else process.env[kind] = previous
          fs.rmSync(root, { recursive: true, force: true })
        }
      }).pipe(Effect.provide(NodeServices.layer)))
  }

  for (const configuration of ["HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_COUNT"] as const) {
    it.effect(`preserves global ignore rules from ${configuration}`, () =>
      Effect.gen(function*() {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "strider-state-global-ignore-"))
        const keys = [
          "HOME",
          "XDG_CONFIG_HOME",
          "GIT_CONFIG_GLOBAL",
          "GIT_CONFIG_NOSYSTEM",
          "GIT_CONFIG_COUNT",
          "GIT_CONFIG_KEY_0",
          "GIT_CONFIG_VALUE_0"
        ]
        const previous = new Map(keys.map((key) => [key, process.env[key]]))
        try {
          const repo = path.join(root, "repo")
          fs.mkdirSync(repo)
          execFileSync("git", ["init", repo], { stdio: "ignore" })
          process.env.HOME = path.join(root, "home")
          process.env.XDG_CONFIG_HOME = path.join(root, "xdg")
          delete process.env.GIT_CONFIG_GLOBAL
          process.env.GIT_CONFIG_NOSYSTEM = "1"
          process.env.GIT_CONFIG_COUNT = "0"
          fs.mkdirSync(process.env.HOME, { recursive: true })
          fs.mkdirSync(path.join(process.env.XDG_CONFIG_HOME, "git"), { recursive: true })
          const excludes = path.join(root, "global-ignore")
          fs.writeFileSync(excludes, "*.state\n")
          if (configuration === "HOME") {
            fs.writeFileSync(path.join(process.env.HOME, ".gitconfig"), `[core]\nexcludesFile = ${excludes}\n`)
          } else if (configuration === "XDG_CONFIG_HOME") {
            fs.writeFileSync(path.join(process.env.XDG_CONFIG_HOME, "git", "ignore"), "*.state\n")
          } else {
            process.env.GIT_CONFIG_COUNT = "1"
            process.env.GIT_CONFIG_KEY_0 = "core.excludesFile"
            process.env.GIT_CONFIG_VALUE_0 = excludes
          }
          const ignored = path.join(repo, "auth.state")
          const unignored = path.join(repo, "auth.json")
          fs.writeFileSync(ignored, "{}")
          fs.writeFileSync(unignored, "{}")
          assert.isFalse(yield* Daemon.stateFileCouldBeCommitted(ignored))
          assert.isTrue(yield* Daemon.stateFileCouldBeCommitted(unignored))
        } finally {
          for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
          }
          fs.rmSync(root, { recursive: true, force: true })
        }
      }).pipe(Effect.provide(NodeServices.layer)))
  }

  for (const kind of ["unignored", "ignored", "tracked", "outside", "nested", "worktree", "symlink"] as const) {
    it.effect(kind, () =>
      Effect.gen(function*() {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "strider-state-git-"))
        try {
          const repo = path.join(root, "repo")
          fs.mkdirSync(repo)
          const git = (...args: Array<string>) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" })
          git("init")
          fs.writeFileSync(path.join(repo, ".gitignore"), "*.state\n")
          let destination = path.join(repo, "auth.state")
          if (kind === "unignored" || kind === "nested") {
            destination = path.join(repo, kind === "nested" ? "new/deep/auth.json" : "auth.json")
          }
          if (kind === "outside") destination = path.join(root, "auth.state")
          if (kind === "worktree") {
            git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "init")
            git("worktree", "add", "--detach", path.join(root, "linked"))
            destination = path.join(root, "linked", "auth.state")
          }
          if (kind === "symlink") {
            fs.symlinkSync(repo, path.join(root, "alias"))
            destination = path.join(root, "alias", "auth.json")
          }
          fs.mkdirSync(path.dirname(destination), { recursive: true })
          fs.writeFileSync(destination, "{}")
          if (kind === "tracked") git("add", "--force", "auth.state")
          assert.strictEqual(
            yield* Daemon.stateFileCouldBeCommitted(destination),
            kind !== "ignored" && kind !== "outside"
          )
        } finally {
          fs.rmSync(root, { recursive: true, force: true })
        }
      }).pipe(Effect.provide(NodeServices.layer)))
  }
})
