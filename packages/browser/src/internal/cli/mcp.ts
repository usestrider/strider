/**
 * `strider mcp` (review 22, candidate 3a): an MCP server over standard input and output, for a client that runs no
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
  const rest = [...argv]
  const at = rest.indexOf("mcp")
  if (at >= 0) rest.splice(at, 1)
  let session = Session.scan(argv).session
  const take = (flag: string): string | undefined => {
    const index = rest.indexOf(flag)
    if (index < 0) return undefined
    const value = rest[index + 1]
    rest.splice(index, 2)
    return value
  }
  session = take("-s") ?? take("--session") ?? session
  const start = rest.indexOf("--start")
  if (start < 0) {
    const name = session ?? env.STRIDER_SESSION
    return name === undefined || name === ""
      ? { _tag: "Invalid", message: "strider mcp serves a session: name it with -s, or start one with --start" }
      : { _tag: "Serve", session: name }
  }
  rest.splice(start, 1)
  const keep = rest.indexOf("--keep")
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
const forward = (rootDir: string, session: string, name: keyof Tools.Tools) => (params: unknown) =>
  Effect.gen(function*() {
    const tool = Tools.toolkit.tools[name]
    const answer = yield* Effect.promise(() => Client.callTool(rootDir, session, name, params))
    if (answer._tag === "NoResult") {
      return yield* Effect.fail(new Tools.ToolFailure({ error: "NoSession", message: answer.message }))
    }
    if (answer.failure) {
      return yield* Effect.flatMap(
        Schema.decodeUnknownEffect(tool.failureSchema as typeof Tools.ToolFailure)(answer.value).pipe(Effect.orDie),
        Effect.fail
      )
    }
    return yield* Schema.decodeUnknownEffect(tool.successSchema as Schema.Top)(answer.value).pipe(Effect.orDie)
  })

/** Serves the session's tools over standard input and output, until the client goes. */
export const run = Effect.fnUntraced(
  function*(argv: ReadonlyArray<string>, bin: string, stdio: Layer.Layer<Stdio.Stdio>) {
    const process = Node.process
    const rootDir = Session.root(process.env, (yield* Effect.promise(() => Node.os())).tmpdir())
    const asked = parse(argv, process.pid, process.env)
    if (asked._tag === "Invalid") {
      process.stderr.write(`${asked.message}\n`)
      process.exitCode = Session.exitCodes.CliError!
      return
    }
    if (asked._tag === "Start") {
      const code = yield* Effect.promise(() =>
        Client.start(asked.start, bin, (text) => void process.stderr.write(`${text}\n`))
      )
      if (code !== 0) {
        process.exitCode = code
        return
      }
    }
    const handlers = Object.fromEntries(
      (Object.keys(Tools.toolkit.tools) as Array<keyof Tools.Tools>).map((name) => [
        name,
        forward(rootDir, asked.session, name)
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
  }
)
