/**
 * What the `strider` client and its daemons share (CLI.md): where a session lives, the names it may have, the lock
 * that says which process holds it, and how a command's arguments name its session. What they exchange over its
 * socket is `protocol.ts`'s.
 *
 * ```
 * $XDG_RUNTIME_DIR/strider/   else <OS temporary directory>/strider-<uid>/
 *   <name>/                   one per session
 *     lock  sock  daemon.log
 *     profile/  downloads/  artifacts/
 * ```
 */
import * as Data from "effect/Data"
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
  env.XDG_RUNTIME_DIR !== undefined && env.XDG_RUNTIME_DIR !== ""
    ? env.XDG_RUNTIME_DIR + "/strider"
    : tmpdir + "/strider-" + uid()

/** A refused session path or name, reported without a defect log. */
export class SessionError extends Data.TaggedError("SessionError")<{
  readonly reason: "Missing" | "Unsafe" | "InvalidName"
  readonly message: string
}> {}

const uid = (): number => {
  if (Node.process.getuid === undefined) {
    throw new SessionError({ reason: "Unsafe", message: "CLI session isolation requires Unix ownership metadata" })
  }
  return Node.process.getuid()
}

export const failure = (error: unknown): SessionError =>
  error instanceof SessionError ?
    error :
    new SessionError({ reason: "Unsafe", message: error instanceof Error ? error.message : String(error) })

/** Validates names before any path construction or process cleanup. */
export const validateName = (name: string): Effect.Effect<void, SessionError> =>
  nameRule.test(name) ? Effect.void : Effect.fail(
    new SessionError({
      reason: "InvalidName",
      message: JSON.stringify(name) + ": a session name is lowercase letters, digits and dashes, at most 32"
    })
  )

/** Checks private directory metadata; ownership tests can supply metadata without changing real owners. */
export const privateDirectory = (stat: Node.Stat, owner: number): boolean =>
  stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === owner && (stat.mode & 0o077) === 0

/** Link ownership matters in sticky parents, where only the link owner or parent owner may replace it. */
export const trustedAlias = (stat: Node.Stat, owner: number): boolean => stat.uid === 0 || stat.uid === owner

/**
 * Resolves trusted ancestor aliases after checking their parents, owners and resolved ancestry. Roots themselves
 * must be real private directories. Readers leave missing paths absent; socket consumers require them to exist.
 */
export const validateRoot = (directory: string, create = false, required = false) =>
  Effect.tryPromise({
    try: async () => {
      const owner = uid()
      const fs = await Node.files()
      const path = await Node.path()
      let links = 0
      const unsafe = (at: string): never => {
        throw new SessionError({
          reason: "Unsafe",
          message: "Unsafe session directory: " + at + "; requires trusted ownership, permissions and non-symlink roots"
        })
      }
      const walk = async (input: string, privateLeaf: boolean): Promise<string | undefined> => {
        if (!input.startsWith("/")) return unsafe(input)
        const parts = input.split("/").filter(Boolean)
        let current = "/"
        for (let index = 0; index < parts.length; index++) {
          const parent = current
          current = current === "/" ? current + parts[index] : current + "/" + parts[index]
          const last = index === parts.length - 1
          let stat: Node.Stat
          try {
            stat = await fs.lstat(current)
          } catch (error) {
            if ((error as { code?: string }).code !== "ENOENT") throw error
            if (!create) {
              if (required) throw new SessionError({ reason: "Missing", message: "No session directory at " + current })
              return undefined
            }
            try {
              await fs.mkdir(current, { mode: 0o700 })
            } catch (error) {
              if ((error as { code?: string }).code !== "EEXIST") throw error
            }
            stat = await fs.lstat(current)
          }
          if (stat.isSymbolicLink()) {
            if ((last && privateLeaf) || !trustedAlias(stat, owner) || ++links > 40) return unsafe(current)
            const target = await fs.readlink(current)
            // Do not normalize .. before checking components it traverses.
            const resolved = await walk(target.startsWith("/") ? target : parent + "/" + target, false)
            if (resolved === undefined) return undefined
            current = resolved
            continue
          }
          const safe = last && privateLeaf ?
            privateDirectory(stat, owner) :
            stat.isDirectory() && (stat.uid === 0 || stat.uid === owner) &&
            ((stat.mode & 0o022) === 0 || (stat.uid === 0 && (stat.mode & 0o1000) !== 0))
          if (!safe) return unsafe(current)
        }
        return path.resolve(current)
      }
      const checked = await walk(directory, true)
      // Keep the trusted spelling for AF_UNIX: canonical aliases can exceed the platform's socket limit.
      return checked === undefined ? undefined : directory
    },
    catch: failure
  })

/** Allocates an unpredictable private directory for startup files. */
export const startupDirectory = (directory: string) =>
  Effect.tryPromise({
    try: async () => (await Node.files()).mkdtemp(directory + "/.start-"),
    catch: failure
  })

/** A session's directory, its socket, its lock and its log. */
export const paths = (rootDir: string, name: string) => {
  const dir = `${rootDir}/${name}`
  return {
    dir,
    socket: `${dir}/sock`,
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
