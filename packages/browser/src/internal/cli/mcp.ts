/**
 * `strider mcp`: an MCP server over standard input and output, for a client that runs no
 * commands of its own, such as Claude Desktop, which launches it from its configuration. It is a front end to a
 * session, never a second way to hold a browser: each tool call goes to the session's daemon, so the client and
 * the CLI share pages, refs and waits.
 *
 * - `strider mcp -s shop` serves session `shop`, started with `strider start`.
 * - `strider mcp --start --chromium <path>` starts a session for the client, named `--name` or `mcp-<pid>`,
 *   which ends when this process does, unless `--keep`. Every other flag goes to `start`.
 *
 * Standard output is the client's, so what `start` reports goes to standard error.
 */
import * as McpProtocol from "effect/ai/McpProtocol"
import * as McpServer from "effect/ai/McpServer"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Schema from "effect/Schema"
import type * as Stdio from "effect/Stdio"
import * as Tools from "../tools.ts"
import * as Client from "./client.ts"
import * as Node from "./node.ts"
import * as Session from "./session.ts"

/** What `strider mcp`'s arguments ask for: the session to serve, and whether to start it. */
export const parse = (
  argv: ReadonlyArray<string>,
  pid: number,
  env: Readonly<Record<string, string | undefined>>
):
  | { readonly _tag: "Serve"; readonly session: string }
  | { readonly _tag: "Start"; readonly session: string; readonly start: ReadonlyArray<string> }
  | { readonly _tag: "Invalid"; readonly message: string } =>
{
  const rest = [...Session.withoutSession(argv)]
  const at = rest.indexOf("mcp")
  if (at >= 0) rest.splice(at, 1)
  const session = Session.scan(argv).session
  const option = (flag: string): number => {
    const index = rest.indexOf(flag)
    const boundary = rest.indexOf("--")
    return boundary >= 0 && index >= boundary ? -1 : index
  }
  const take = (flag: string): string | undefined => {
    const index = option(flag)
    if (index < 0) return undefined
    const value = rest[index + 1]
    rest.splice(index, 2)
    return value
  }
  const start = option("--start")
  if (start < 0) {
    const name = session ?? env.STRIDER_SESSION
    return name === undefined || name === ""
      ? { _tag: "Invalid", message: "strider mcp serves a session: name it with -s, or start one with --start" }
      : { _tag: "Serve", session: name }
  }
  rest.splice(start, 1)
  const keep = option("--keep")
  if (keep >= 0) rest.splice(keep, 1)
  const name = take("--name") ?? session ?? `mcp-${pid}`
  return {
    _tag: "Start",
    session: name,
    // The session ends with this process unless it is kept
    start: ["start", "--name", name, ...rest, ...(keep >= 0 ? [] : ["--owner-pid", String(pid)])]
  }
}

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

/** Serves the session's tools over standard input and output, until the client goes. */
export const run = Effect.fnUntraced(
  function*(argv: ReadonlyArray<string>, bin: string, stdio: Layer.Layer<Stdio.Stdio>) {
    const process = Node.process
    const rootDir = yield* Client.sessionRoot
    const asked = parse(argv, process.pid, process.env)
    if (asked._tag === "Invalid") {
      yield* Console.error(asked.message)
      return yield* new Client.Exit({ code: Session.exitCodes.CliError! })
    }
    // Standard output is the client's: what start reports goes to standard error
    if (asked._tag === "Start") yield* Client.start(asked.start, bin, Console.error)
    const client = yield* Client.session(rootDir, asked.session)
    const handlers = Object.fromEntries(
      (Object.keys(Tools.toolkit.tools) as Array<keyof Tools.Tools>).map((name) => [
        name,
        forward(client, asked.session, name)
      ])
    )
    const server = McpServer.toolkit(Tools.toolkit).pipe(
      Layer.provide(Tools.toolkit.toLayer(handlers as never)),
      Layer.provide(McpServer.layerStdio({
        name: "strider",
        version: "0.1.0",
        instructions:
          `Browser tools for the strider session ${asked.session}. Every page tool names its page; snapshot gives refs to target, and find searches it.`,
        protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26, McpProtocol.v2024_11_05]
      })),
      Layer.provide(stdio)
    )
    // Standard output is the client's: what the server logs goes to standard error
    return yield* Layer.launch(server).pipe(Effect.provideService(Logger.LogToStderr, true))
  },
  Effect.scoped
)
