/**
 * What the `strider` client and its daemons share (CLI.md): where a session lives, the names it may have, the lock
 * that says which process holds it, and how a command's arguments name its session. What they exchange over its
 * socket is `protocol.ts`'s.
 *
 * ```
 * $XDG_RUNTIME_DIR/strider/   the OS temporary directory's strider/ where there is no runtime directory
 *   <name>/                   one per session
 *     lock  daemon.sock  daemon.log
 *     profile/  downloads/  artifacts/
 * ```
 */
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Node from "./node.ts"

/** A session's name: lowercase letters, digits and dashes, short enough for a Unix socket's path. */
export const nameRule = /^[a-z0-9][a-z0-9-]{0,31}$/

/** The directory every session's directory is in. */
export const root = (env: Readonly<Record<string, string | undefined>>, tmpdir: string): string =>
  `${env.XDG_RUNTIME_DIR !== undefined && env.XDG_RUNTIME_DIR !== "" ? env.XDG_RUNTIME_DIR : tmpdir}/strider`

/** A session's directory, its socket, its lock and its log. */
export const paths = (rootDir: string, name: string) => {
  const dir = `${rootDir}/${name}`
  return {
    dir,
    socket: `${dir}/daemon.sock`,
    lock: `${dir}/lock`,
    log: `${dir}/daemon.log`,
    profile: `${dir}/profile`,
    downloads: `${dir}/downloads`,
    artifacts: `${dir}/artifacts`
  }
}

/**
 * Where the CLI keeps its ledger (`Ledger`): `$XDG_STATE_HOME/strider/ledger`, else
 * `~/.local/state/strider/ledger`. It outlives a session's directory, which is in the runtime directory.
 */
export const ledgerRoot = (env: Readonly<Record<string, string | undefined>>, home: string): string =>
  `${
    env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME !== "" ? env.XDG_STATE_HOME : `${home}/.local/state`
  }/strider/ledger`

/** The shared flags that take a separate value. */
const valued = new Set(["-s", "--session", "-p", "--page"])

/** Reads routing flags without treating inline values or operands after `--` as options. */
const routing = (argv: ReadonlyArray<string>) => {
  let session: string | undefined
  let command: string | undefined
  const rest: Array<string> = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg === "--") {
      rest.push(...argv.slice(index))
      break
    }
    const isSession = arg === "-s" || arg === "--session"
    if (isSession || valued.has(arg)) {
      const value = argv[index + 1]
      // Effect's parser only takes a following value token, never another option or the delimiter.
      if (value !== undefined && !value.startsWith("-")) {
        if (isSession) session = value
        else rest.push(arg, value)
        index++
      } else if (!isSession) rest.push(arg)
      continue
    }
    if (arg.startsWith("--session=") || arg.startsWith("-s=")) {
      session = arg.slice(arg.indexOf("=") + 1)
      continue
    }
    if (!arg.startsWith("-") && command === undefined) command = arg
    rest.push(arg)
  }
  return { session, command, rest }
}

/** The session and the command an argument list names, read without parsing the rest. */
export const scan = (
  argv: ReadonlyArray<string>
): { readonly session: string | undefined; readonly command: string | undefined } => {
  const { session, command } = routing(argv)
  return { session, command }
}

/** Removes routing flags, preserving command data and the `--` boundary. */
export const withoutSession = (argv: ReadonlyArray<string>): ReadonlyArray<string> => routing(argv).rest

/** Whether a help flag appears before the argument terminator. */
export const helpRequested = (argv: ReadonlyArray<string>): boolean => {
  for (const arg of argv) {
    if (arg === "--") return false
    if (arg === "--help" || arg === "-h") return true
  }
  return false
}

/** Exit codes: per module error, so a script can branch on what failed. */
export const exitCodes: Readonly<Record<string, number>> = {
  CliError: 2,
  LocatorError: 10,
  PageError: 11,
  Timeout: 12,
  TargetGone: 13,
  ExpectationFailed: 14,
  InvalidInput: 15,
  PageNotFound: 16,
  NotPermitted: 17,
  NoSession: 20
}

/** The package's `package.json`, as far as the command reads it. */
const Manifest = Schema.fromJsonString(Schema.Struct({ version: Schema.String }))

/** The package's version, from its `package.json`: what `--version` prints, and the MCP server reports. */
export const version = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  // This module is three directories below the package's root, in src/ and in dist/ alike
  const manifest = yield* path.fromFileUrl(new URL("../../../package.json", import.meta.url))
  return (yield* Schema.decodeEffect(Manifest)(yield* fs.readFileString(manifest))).version
}).pipe(Effect.orDie)

/** A process, by its id and when it started, in milliseconds since the epoch, as the ledger names its owner. */
export const Owner = Schema.Struct({ pid: Schema.Number, startedAt: Schema.Number })
export type Owner = typeof Owner.Type

/** A session's lock: the daemon that holds it, by its id and when it started, so a reused id isn't taken for it. */
export const Lock = Schema.fromJsonString(Owner)

/** This process, as its lock names it: started when its clock's origin was, as the ledger has it. */
export const self = (): Owner => ({ pid: Node.process.pid, startedAt: Math.round(performance.timeOrigin) })

/** When a process started, in milliseconds since the epoch, where `/proc` says (Linux); `None` elsewhere. */
export const startedAt = Effect.fnUntraced(
  function*(fs: FileSystem.FileSystem, pid: number) {
    const boot = (yield* fs.readFileString("/proc/stat")).match(/^btime (\d+)$/m)?.[1]
    // The fields after the command's name, which is in parentheses and may hold spaces
    const stat = (yield* fs.readFileString(`/proc/${pid}/stat`)).split(") ")[1]?.split(" ")
    const ticks = stat?.[19]
    if (boot === undefined || ticks === undefined) return Option.none<number>()
    // Clock ticks since boot, a hundred a second on Linux
    return Option.some((Number(boot) + Number(ticks) / 100) * 1000)
  },
  Effect.orElseSucceed(() => Option.none<number>())
)

/**
 * Whether a program still runs, as a ledger's record or a session's lock names it: its process id is alive and, where `/proc` says when it started, it is
 * the same process. When that can't be told, it counts as running, so nothing of a live program is reclaimed.
 */
export const stillRunning = Effect.fnUntraced(function*(fs: FileSystem.FileSystem, owner: Owner) {
  if (!Node.alive(owner.pid)) return false
  const started = yield* startedAt(fs, owner.pid)
  return Option.isNone(started) || Math.abs(started.value - owner.startedAt) < 3000
})

/** The daemon that holds a session's lock, by its process id, while it runs. */
export const holder = Effect.fnUntraced(function*(fs: FileSystem.FileSystem, dir: string) {
  const text = yield* fs.readFileString(`${dir}/lock`).pipe(Effect.option)
  if (Option.isNone(text)) return Option.none<number>()
  const owner = Schema.decodeUnknownOption(Lock)(text.value)
  if (Option.isNone(owner)) return Option.none<number>()
  return (yield* stillRunning(fs, owner.value)) ? Option.some(owner.value.pid) : Option.none<number>()
})
