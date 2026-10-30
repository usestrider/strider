/**
 * The `strider` command's entry (CLI.md): help, and the commands that need no session, run here; `start` starts a
 * session's daemon and `mcp` serves one; any other command is a session's, forwarded to its daemon, which parses
 * it. A forwarded command, the one agents run most, loads only the client; the rest is loaded when it's asked for.
 */
import * as Command from "effect/cli/Command"
import * as Effect from "effect/Effect"
import * as Client from "./client.ts"
import * as Session from "./session.ts"

/** The commands this process runs itself, without a session's daemon. */
const local = new Set(["browsers", "sessions", "prune"])

/** Runs the `strider` command with its arguments; `bin` is the script a daemon is started with. */
export const run = Effect.fnUntraced(function*(argv: ReadonlyArray<string>, bin: string) {
  const { command } = Session.scan(argv)
  // Only flags before the argument terminator ask for help
  const help = Session.helpRequested(argv) || command === undefined
  if (!help) {
    if (command === "start") return yield* Client.start(argv, bin)
    if (command === "mcp") {
      const [Mcp, NodeStdio] = yield* Effect.promise(() =>
        Promise.all([import("./mcp.ts"), import("@effect/platform-node/NodeStdio")])
      )
      return yield* Mcp.run(argv, bin, NodeStdio.layer)
    }
    if (!local.has(command)) return yield* Client.forward(argv)
  }
  const [Cli, version] = yield* Effect.all([Effect.promise(() => import("../cli.ts")), Session.version])
  return yield* Command.runWith(help ? yield* Cli.help : Cli.strider, { version })(argv)
})
