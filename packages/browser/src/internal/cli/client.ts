/**
 * The `strider` client (CLI.md): it forwards a command to its session's daemon over the session's Unix socket, as
 * `protocol.ts`'s `Command` call, and prints what the daemon answers. Ctrl-C interrupts the call, which interrupts
 * the command, never the session. `start` starts a daemon, detached, and prints its spec once it serves.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as ChildProcess from "effect/process/ChildProcess"
import * as RpcClient from "effect/rpc/RpcClient"
import type * as RpcClientError from "effect/rpc/RpcClientError"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Runtime from "effect/Runtime"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Socket from "effect/socket/Socket"
import * as Stream from "effect/Stream"
import * as Node from "./node.ts"
import * as Protocol from "./protocol.ts"
import * as Session from "./session.ts"

/**
 * The exit code a command ends the `strider` process with, once it has printed why: `NodeRuntime.runMain` exits
 * with it, and reports nothing more.
 */
export class Exit extends Data.TaggedError("Exit")<{ readonly code: number }> {
  override get [Runtime.errorExitCode](): number {
    return this.code
  }
  override get [Runtime.errorReported](): boolean {
    return false
  }
}

/** The directory every session's directory is in, from this process's environment. */
export const sessionRoot = Effect.map(
  Effect.promise(() => Node.os()),
  (os) => Session.root(Node.process.env, os.tmpdir())
)

/** The sessions whose sockets exist. */
export const running = Effect.fnUntraced(function*(rootDir: string) {
  const fs = yield* FileSystem.FileSystem
  const names = yield* fs.readDirectory(rootDir).pipe(Effect.orElseSucceed(() => []))
  return (yield* Effect.filter(
    names,
    (name) => fs.exists(Session.paths(rootDir, name).socket).pipe(Effect.orElseSucceed(() => false))
  )).sort()
})

/** A client of the daemon serving a socket, for the scope. It connects as its first call is made. */
export const connect = Effect.fnUntraced(function*(socket: string) {
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide([Layer.effect(Socket.Socket)(NodeSocket.makeNet({ path: socket })), RpcSerialization.layerNdjson])
    )
  )
  return yield* RpcClient.make(Protocol.Rpcs, { disableTracing: true }).pipe(Effect.provideContext(protocol))
})

export type Client = Effect.Success<ReturnType<typeof connect>>

/** A session's client, for the scope. */
export const session = (rootDir: string, name: string): Effect.Effect<Client, never, Scope.Scope> =>
  connect(Session.paths(rootDir, name).socket)

/** Whether a call failed because no daemon serves the socket: it's gone, or it never started. */
export const unreachable = (error: RpcClientError.RpcClientError): boolean => error.reason._tag === "SocketOpenError"

/** Forwards the command to its session's daemon, which parses it; the exit code is the command's. */
export const forward = Effect.fnUntraced(function*(argv: ReadonlyArray<string>) {
  const rootDir = yield* sessionRoot
  const named = Session.scan(argv).session
  const name = named ?? Node.process.env.STRIDER_SESSION
  if (name === undefined || name === "") {
    const sessions = yield* running(rootDir)
    yield* Console.error(
      `Every command names its session, with -s or STRIDER_SESSION. ${
        sessions.length === 0 ? "No session is running; strider start starts one." : `Running: ${sessions.join(", ")}.`
      }`
    )
    return yield* new Exit({ code: Session.exitCodes.NoSession! })
  }
  // The environment's session is the shared flag when no explicit one was given
  const args = named === undefined ? ["-s", name, ...argv] : [...argv]
  yield* Effect.scoped(Effect.gen(function*() {
    const client = yield* session(rootDir, name)
    yield* client.Command({ argv: args, cwd: Node.process.cwd() }).pipe(
      Stream.runForEach((line) => line._tag === "Out" ? Console.log(line.text) : Console.error(line.text)),
      Effect.catchTag("CommandExit", ({ code }) => Effect.fail(new Exit({ code })))
    )
  })).pipe(
    Effect.catchTag("RpcClientError", (error) =>
      Effect.gen(function*() {
        if (!unreachable(error)) {
          yield* Console.error(`The session ${name} didn't answer: ${error.message}`)
          return yield* new Exit({ code: 1 })
        }
        const sessions = yield* running(rootDir)
        yield* Console.error(
          `No session named ${name} is running${
            sessions.length === 0 ? "" : `; running: ${sessions.join(", ")}`
          }. strider sessions lists them, with any a crash left behind.`
        )
        return yield* new Exit({ code: Session.exitCodes.NoSession! })
      })),
    // Ctrl-C interrupts the call, and so the command, alone
    Effect.onInterrupt(() => Console.error("interrupted; the session goes on"))
  )
})

/**
 * `strider start`: starts the session's daemon, detached, with this command's arguments, and prints what it
 * answers once it serves, or why it couldn't start. `say` prints the spec: on standard output, unless that is
 * someone else's, as `strider mcp`'s is.
 *
 * The daemon answers over a socket this process listens on for the start alone, whose path is its first argument,
 * not over a pipe: a pipe it kept open would keep this process waiting for as long as the session runs. It has no
 * standard input or output of its own.
 */
export const start = Effect.fnUntraced(function*(
  argv: ReadonlyArray<string>,
  bin: string,
  say: (text: string) => Effect.Effect<void> = Console.log
) {
  const process = Node.process
  const fs = yield* FileSystem.FileSystem
  const rootDir = yield* sessionRoot
  yield* Effect.scoped(Effect.gen(function*() {
    yield* fs.makeDirectory(rootDir, { recursive: true, mode: 0o700 }).pipe(Effect.orDie)
    const path = `${rootDir}/.start-${process.pid}.sock`
    yield* fs.remove(path).pipe(Effect.ignore)
    const server = yield* NodeSocketServer.make({ path }).pipe(Effect.orDie)
    const said = yield* Deferred.make<string>()
    yield* server.run((socket) =>
      Socket.toStream(socket).pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runHead,
        Effect.flatMap((line) => Deferred.succeed(said, Option.getOrElse(line, () => ""))),
        Effect.ignore
      )
    ).pipe(Effect.forkScoped)
    const daemon = yield* ChildProcess.make(
      process.execPath,
      [...process.execArgv, bin, "__daemon", path, ...argv],
      { detached: true, cwd: process.cwd(), stdin: "ignore", stdout: "ignore", stderr: "ignore" }
    )
    const answer = yield* Effect.raceFirst(
      Effect.map(Deferred.await(said), Option.some),
      Effect.as(Effect.ignore(daemon.exitCode), Option.none<string>())
    )
    if (Option.isNone(answer)) {
      const code = yield* daemon.exitCode.pipe(Effect.orElseSucceed(() => 1))
      yield* Console.error(`The session's daemon exited before it served${code === 0 ? "" : ` (${code})`}`)
      return yield* new Exit({ code: code === 0 ? 1 : code })
    }
    const started = yield* Schema.decodeEffect(Protocol.StartedJson)(answer.value).pipe(
      Effect.catchTag("SchemaError", (error) =>
        Effect.succeed<Protocol.Started>({
          _tag: "Failed",
          text: `The session's daemon answered what isn't a start: ${error.message}`,
          code: 1
        }))
    )
    if (started._tag === "Failed") {
      yield* Console.error(started.text)
      return yield* new Exit({ code: started.code })
    }
    // It serves: it runs on after this process ends
    yield* Effect.asVoid(daemon.unref)
    yield* say(started.text)
  }))
})
