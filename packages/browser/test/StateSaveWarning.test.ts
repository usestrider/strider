import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Daemon from "../src/internal/cli/daemon.ts"

describe("state save Git warning", () => {
  for (const kind of ["unignored", "ignored", "tracked", "outside", "nested", "worktree", "symlink"] as const) {
    it.effect(kind, () => Effect.gen(function*() {
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
        assert.strictEqual(yield* (Daemon.stateFileCouldBeCommitted?.(destination) ?? Effect.succeed(false)), kind !== "ignored" && kind !== "outside")
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    }).pipe(Effect.provide(NodeServices.layer)))
  }
})
