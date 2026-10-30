/**
 * What the `strider` client, `strider mcp` and a forking `strider start` ask a session's daemon (CLI.md): an
 * `effect/rpc` group, served as NDJSON over the session's Unix socket, and the line a daemon prints as it starts.
 *
 * - **Command** forwards a command's arguments, parsed in the daemon, and streams what it prints. A command that
 *   fails ends the stream with its exit code. Interrupting the call, as Ctrl-C does, interrupts the command alone.
 * - **Tool** calls one of the toolkit's tools as a model calls it, with its parameters encoded by the tool's
 *   Schema, which the toolkit decodes: its success encoded by the tool's Schema, or its `ToolFailure`.
 * - **Info** is the session, for `strider sessions`; **State** its storage state, for `--fork`.
 */
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as Schema from "effect/Schema"
import * as Tools from "../tools.ts"

/** A line a command prints, to standard output or standard error. */
export const Output = Schema.Union([
  Schema.TaggedStruct("Out", { text: Schema.String }),
  Schema.TaggedStruct("Err", { text: Schema.String })
])
export type Output = typeof Output.Type

/** A command that ended with an exit code other than 0; what it printed says why. */
export class CommandExit extends Schema.TaggedError<CommandExit>()("CommandExit", { code: Schema.Number }) {}

/** A running session, as `strider sessions` lists it. */
export const SessionInfo = Schema.Struct({
  name: Schema.String,
  /** Its backend, or `attached` and its protocol. */
  browser: Schema.String,
  pages: Schema.Array(Schema.String),
  /** Seconds since its last command. */
  idle: Schema.Number,
  idleTimeout: Schema.String,
  /** The process it ends with, if any. */
  owner: Schema.NullOr(Schema.Number),
  dir: Schema.String
})
export type SessionInfo = typeof SessionInfo.Type

export const Rpcs = RpcGroup.make(
  Rpc.make("Command", {
    payload: { argv: Schema.Array(Schema.String), cwd: Schema.String },
    success: Output,
    error: CommandExit,
    stream: true
  }),
  Rpc.make("Tool", {
    payload: {
      tool: Tools.ToolName,
      /** Encoded by the tool's parameters Schema, which the toolkit decodes. */
      params: Schema.Unknown
    },
    /** Encoded by the tool's success Schema. */
    success: Schema.Unknown,
    error: Tools.ToolFailure
  }),
  Rpc.make("Info", { success: SessionInfo }),
  /** The storage state, encoded by `StorageState.Json`, which writes each secret value in full. */
  Rpc.make("State", { success: Schema.String, error: Tools.ToolFailure })
)

/** What a daemon prints on its standard output as it starts: its spec, once it serves, or why it couldn't. */
export const Started = Schema.Union([
  Schema.TaggedStruct("Ready", { text: Schema.String }),
  Schema.TaggedStruct("Failed", { text: Schema.String, code: Schema.Number })
])
export type Started = typeof Started.Type

/** `Started` as the one JSON line a daemon prints. */
export const StartedJson = Schema.fromJsonString(Started)
