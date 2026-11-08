/** Agent guide examples are parsed by the CLI's real command tree, with session handlers disabled. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it, layer } from "@effect/vitest"
import * as Command from "effect/cli/Command"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import { spawnSync } from "node:child_process"
import * as Cli from "../src/internal/cli.ts"
import { examples, shellCommand } from "../src/internal/cli/agent.ts"

describe("agent guide examples", () => {
  layer(NodeServices.layer)((it) => {
    for (const [name, lines] of Object.entries(examples)) {
      it.effect(`parses the ${name} examples without a browser or session`, () =>
        Effect.gen(function*() {
          const tree = yield* Cli.help
          for (const line of lines) {
            if (typeof line === "string") {
              assert.isTrue(line === "" || line.startsWith("#"), "Only comments and blank lines are raw shell text")
              continue
            }
            const prefix = line[0] === "pnpx" ? 2 : 1
            assert.isTrue(line[0] === "strider" || (line[0] === "pnpx" && line[1] === "@usestrider/cli"))
            const result = yield* Effect.result(
              Command.runWith(tree, { version: "test", renderErrors: false })(
                line.slice(prefix)
              )
            )
            assert.strictEqual(result._tag, "Success", shellCommand(line))
          }
        }))
    }

    it.effect("rejects missing arguments, unknown flags and invalid event kinds", () =>
      Effect.gen(function*() {
        const tree = yield* Cli.help
        const console = yield* Console.Console
        for (
          const args of [
            ["-s", "shop", "-p", "main", "fill", "label=Email"],
            ["start", "--unknown", "value"],
            ["-s", "shop", "-p", "main", "next", "not-an-event"]
          ]
        ) {
          const result = yield* Effect.result(
            Command.runWith(tree, { version: "test", renderErrors: false })(args).pipe(
              Effect.provideService(Console.Console, { ...console, log: () => {} })
            )
          )
          assert.strictEqual(result._tag, "Failure", args.join(" "))
        }
      }))
  })

  it.skipIf(process.platform === "win32")("expands the home directory in saved-state examples", () => {
    const result = spawnSync("sh", ["-c", shellCommand(["printf", "%s", "$HOME/.local/state/strider/shop.state"])], {
      encoding: "utf8",
      env: { ...process.env, HOME: "/home/example user" }
    })
    assert.strictEqual(result.status, 0, result.stderr)
    assert.strictEqual(result.stdout, "/home/example user/.local/state/strider/shop.state")
  })

  it.skipIf(process.platform === "win32")(
    "quotes shell examples without changing arguments or expanding their contents",
    () => {
      const args = ["", "two words", "a'b", "$(printf expanded)", "`printf expanded`", "line\nbreak", "; false", "*"]
      const result = spawnSync("sh", ["-c", shellCommand(["printf", "%s\\0", ...args])], {
        encoding: "utf8"
      })
      assert.strictEqual(result.status, 0, result.stderr)
      assert.deepStrictEqual(result.stdout.split("\0").slice(0, -1), args)
    }
  )
})
