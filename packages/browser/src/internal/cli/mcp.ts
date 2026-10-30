/**
 * `strider mcp`: an MCP server over standard input and output, for a client that runs no
 * commands of its own, such as Claude Desktop, which launches it from its configuration. It is a front end to a
 * session, never a second way to hold a browser: each tool call goes to the session's daemon, so the client and
 * the CLI share pages, refs and waits.
 *
 * - `strider mcp -s shop` serves session `shop`, started with `strider start`.
 * - `strider mcp --start --chromium <path>` starts a session for the client, named `--name` or `mcp-<pid>`,
 *   which ends when this process does, unless `--keep`. `start`'s other flags go to `start`.
 *
 * Standard output is the client's, so what `start` reports goes to standard error.
 */
import * as McpProtocol from "effect/ai/McpProtocol"
import * as McpServer from "effect/ai/McpServer"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as Stdio from "effect/Stdio"
import * as Tools from "../tools.ts"
import * as Client from "./client.ts"
import * as Daemon from "./daemon.ts"
import * as Node from "./node.ts"
import * as Session from "./session.ts"

/** What `strider mcp` was asked for: the session to serve, and the `start` arguments that start it, if it does. */
export type Plan =
  | { readonly _tag: "Serve"; readonly session: string }
  | { readonly _tag: "Start"; readonly session: string; readonly start: ReadonlyArray<string> }
  | { readonly _tag: "Invalid"; readonly message: string }

/** `start`'s flags, with the name and idle timeout optional, and `mcp`'s own. */
const flags = {
  ...Daemon.startFlags,
  name: Flag.String("name").pipe(
    Flag.withDescription("Name the started session; defaults to -s or mcp-<pid>"),
    Flag.optional
  ),
  idle: Flag.String("idle").pipe(
    Flag.withDescription("Stop the started session after this duration without commands (default: 1 hour)"),
    Flag.optional
  ),
  start: Flag.Boolean("start").pipe(
    Flag.withDescription("Start a session with the launch options below; otherwise serve -s or STRIDER_SESSION"),
    Flag.withDefault(false)
  ),
  keep: Flag.Boolean("keep").pipe(
    Flag.withDescription("With --start, keep the session running after this MCP process exits"),
    Flag.withDefault(false)
  )
}

type Flags = Command.Command.Config.Infer<typeof flags>

/** `strider start`'s arguments for the flags given, which end the session with `pid` unless it's kept. */
const startArgs = (name: string, given: Flags, pid: number): ReadonlyArray<string> => {
  const option = (flag: string, value: Option.Option<string | number>) =>
    Option.match(value, { onNone: () => [], onSome: (value) => [`--${flag}`, String(value)] })
  return [
    "start",
    "--name",
    name,
    ...option("chromium", given.chromium),
    ...option("firefox", given.firefox),
    ...option("webkit", given.webkit),
    ...option("attach", given.attach),
    ...option("user-data-dir", given.userDataDir),
    ...option("state", given.state),
    ...option("fork", given.fork),
    ...option("idle", given.idle),
    ...Object.entries(given.secret).flatMap(([secret, variable]) => ["--secret", `${secret}=${variable}`]),
    // The session ends with this process unless it is kept
    ...option("owner-pid", Option.orElse(given.ownerPid, () => given.keep ? Option.none() : Option.some(pid)))
  ]
}

/** The session `-s` or `STRIDER_SESSION` names, which `strider mcp` serves, or starts with `--start`. */
const plan = (
  given: Flags,
  selected: Option.Option<string>,
  pid: number,
  env: Readonly<Record<string, string | undefined>>
): Plan => {
  if (given.start) {
    const name = Option.getOrElse(Option.orElse(given.name, () => selected), () => `mcp-${pid}`)
    return { _tag: "Start", session: name, start: startArgs(name, given, pid) }
  }
  const name = Option.getOrElse(selected, () => env.STRIDER_SESSION ?? "")
  return name === ""
    ? { _tag: "Invalid", message: "strider mcp serves a session: name it with -s, or start one with --start" }
    : { _tag: "Serve", session: name }
}

const root = Command.make("strider").pipe(Command.withSharedFlags(Daemon.selectors))

/** `strider mcp`, whose plan `serve` carries out. */
export const command = <E, R>(
  serve: (plan: Plan) => Effect.Effect<void, E, R>,
  pid: number = Node.process.pid,
  env: Readonly<Record<string, string | undefined>> = Node.process.env
) =>
  Command.make(
    "mcp",
    flags,
    (given) => Effect.flatMap(root, ({ session }) => serve(plan(given, session, pid, env)))
  ).pipe(Command.withDescription("Serve a session's tools over MCP on standard input and output"))

/** What `strider mcp`'s arguments ask for, as its command parses them. */
export const parse = Effect.fnUntraced(function*(
  argv: ReadonlyArray<string>,
  pid: number,
  env: Readonly<Record<string, string | undefined>>
) {
  let planned: Plan | undefined
  yield* Command.runWith(
    root.pipe(Command.withSubcommands([command((plan) => Effect.sync(() => void (planned = plan)), pid, env)])),
    { version: "" }
  )(argv)
  return planned
})

/** A tool call, forwarded to the session's daemon, and its result decoded by the tool's own Schemas. */
const forward = (client: Client.Client, session: string, name: keyof Tools.Tools) => (params: unknown) =>
  Effect.gen(function*() {
    const tool = Tools.toolkit.tools[name]
    const encoded = yield* Schema.encodeUnknownEffect(tool.parametersSchema)(params).pipe(Effect.orDie)
    const value = yield* client.Tool({ tool: name, params: encoded }).pipe(
      Effect.catchTag("RpcClientError", (error) =>
        Effect.fail(
          new Tools.ToolFailure({
            error: "NoSession",
            message: Client.unreachable(error)
              ? `The session ${session} isn't running: ${error.message}`
              : `The session ${session} didn't answer: ${error.message}`
          })
        ))
    )
    return yield* Schema.decodeUnknownEffect(tool.successSchema)(value).pipe(Effect.orDie)
  })

/** Serves a session's tools over standard input and output, starting it first if asked, until the client goes. */
const serve = Effect.fnUntraced(
  function*(plan: Plan, bin: string, stdio: Layer.Layer<Stdio.Stdio>) {
    if (plan._tag === "Invalid") {
      yield* Console.error(plan.message)
      return yield* new Client.Exit({ code: Session.exitCodes.CliError! })
    }
    // Standard output is the client's: what start reports goes to standard error
    if (plan._tag === "Start") yield* Client.start(plan.start, bin, Console.error)
    const rootDir = yield* Client.sessionRoot
    const client = yield* Client.session(rootDir, plan.session)
    const handlers = Object.fromEntries(
      (Object.keys(Tools.toolkit.tools) as Array<keyof Tools.Tools>).map((name) => [
        name,
        forward(client, plan.session, name)
      ])
    )
    const server = McpServer.toolkit(Tools.toolkit).pipe(
      Layer.provide(Tools.toolkit.toLayer(handlers as never)),
      Layer.provide(McpServer.layerStdio({
        name: "strider",
        version: yield* Session.version,
        instructions:
          `Browser tools for the strider session ${plan.session}. Every page tool names its page; snapshot gives refs to target, and find searches it.`,
        protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26, McpProtocol.v2024_11_05]
      })),
      Layer.provide(stdio)
    )
    // Standard output is the client's: what the server logs goes to standard error
    return yield* Layer.launch(server).pipe(Effect.provideService(Logger.LogToStderr, true))
  },
  Effect.scoped
)

/** Runs `strider mcp` with its arguments: `bin` starts a session's daemon, and `stdio` is the client's. */
export const run = Effect.fnUntraced(
  function*(argv: ReadonlyArray<string>, bin: string, stdio: Layer.Layer<Stdio.Stdio>) {
    return yield* Command.runWith(
      root.pipe(Command.withSubcommands([command((plan) => serve(plan, bin, stdio))])),
      { version: yield* Session.version }
    )(argv)
  }
)
