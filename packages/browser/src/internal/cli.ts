/**
 * The `strider` commands that need no session (CLI.md): `browsers`, which lists the browsers it can find, so a person
 * or an agent can copy a path into `executablePath` (review 11); `sessions`; and `prune` (review 20). A session's
 * own commands are its daemon's (`cli/daemon.ts`).
 */
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Ledger from "../Ledger.ts"
import * as Browsers from "./browsers.ts"
import * as Client from "./cli/client.ts"
import * as Node from "./cli/node.ts"
import * as Session from "./cli/session.ts"
import { build } from "./webkitBuild.ts"

// The platform and environment, where the runtime has them; the package doesn't assume Node.
const host = (globalThis as {
  readonly process?: { readonly platform: string; readonly env: Readonly<Record<string, string | undefined>> }
}).process

const layers: { readonly [B in Browsers.Backend]: string } = {
  chromium: "Chromium.layer",
  firefox: "Firefox.layer",
  webkit: "WebKit.layer"
}

const sources: { readonly [S in Browsers.Source]: string } = {
  PATH: "on PATH",
  installer: "where its installer puts it",
  playwright: "in Playwright's cache"
}

/** The text `strider browsers` prints. */
export const render = (
  found: ReadonlyArray<Browsers.Found>,
  cache: Option.Option<string>
): string => {
  const lines = ["Browsers found on this machine. Pass one as executablePath to its backend's layer.", ""]
  for (const backend of Browsers.Backend.literals) {
    lines.push(layers[backend])
    const ofBackend = found.filter((browser) => browser.backend === backend)
    if (ofBackend.length === 0) {
      lines.push(
        backend === "webkit"
          ? `  none found; Playwright's installer puts its WebKit builds in its cache (build ${build.revision} is Playwright 1.63's)`
          : "  none found"
      )
    }
    for (const browser of ofBackend) {
      const facts = [
        Option.getOrElse(browser.version, () => "version not reported"),
        sources[browser.foundBy],
        ...Option.toArray(Option.map(browser.resolved, (resolved) => `leads to ${resolved}`)),
        ...Option.toArray(Option.map(browser.matchesAdapter, (matches) =>
          matches
            ? `the build the WebKit adapter needs`
            : `not build ${build.revision}, which the WebKit adapter needs, so WebKit.layer refuses it`))
      ]
      lines.push(`  ${browser.path}`, `    ${facts.join(" · ")}`)
    }
    lines.push("")
  }
  lines.push(
    `Searched PATH for ${
      [...Browsers.commandNames.chromium, ...Browsers.commandNames.firefox].join(", ")
    }; the locations Chrome's, Edge's and Firefox's installers use; and Playwright's cache${
      Option.match(cache, { onNone: () => "", onSome: (path) => ` at ${path}` })
    }.`,
    `For code that runs on several machines, read the path from each one's environment, as in Chromium.layerConfig({ executablePath: Config.string("CHROMIUM_PATH") }).`
  )
  return lines.join("\n")
}

const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the browsers found as JSON, for scripts and agents"),
  Flag.withDefault(false)
)

/** `strider browsers`: the browsers on this machine, with their versions and how each was found. */
export const browsers = Command.make(
  "browsers",
  { json },
  Effect.fnUntraced(function*({ json }) {
    const platform = host?.platform ?? "linux"
    const env = host?.env ?? {}
    const found = yield* Browsers.find(platform, env)
    yield* Console.log(
      json
        ? JSON.stringify(Schema.encodeSync(Schema.Array(Browsers.Found))(found), null, 2)
        : render(found, Browsers.playwrightCache(platform, env))
    )
  })
).pipe(
  Command.withDescription(
    "List the browsers on this machine, with their versions, for a launch's executablePath. Nothing is launched but --version, and nothing is installed."
  )
)

const sessionRoot = Effect.map(Effect.promise(() => Node.os()), (os) => Session.root(Node.process.env, os.tmpdir()))

/** The bytes a directory holds, its subdirectories included. */
const sizeOf = (fs: FileSystem.FileSystem, dir: string): Effect.Effect<number> =>
  Effect.flatMap(
    fs.readDirectory(dir, { recursive: true }).pipe(Effect.orElseSucceed(() => [])),
    (entries) =>
      Effect.map(
        Effect.forEach(entries, (entry) =>
          Effect.map(fs.stat(`${dir}/${entry}`).pipe(Effect.option), (info) =>
            Option.match(info, {
              onNone: () => 0,
              onSome: (info) => info.type === "File" ? Number(info.size) : 0
            }))),
        (sizes) =>
          sizes.reduce((total, size) => total + size, 0)
      )
  )

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** Whether a session's daemon holds its lock. */
const holder = (fs: FileSystem.FileSystem, dir: string) =>
  Effect.map(fs.readFileString(`${dir}/lock`).pipe(Effect.option), (lock) =>
    Option.flatMap(lock, (text) => {
      const pid = Number.parseInt(text, 10)
      return Number.isFinite(pid) && Node.alive(pid) ? Option.some(pid) : Option.none()
    }))

/** `strider sessions`: every session, running or left behind by a crash. */
export const sessions = Command.make(
  "sessions",
  { json },
  Effect.fnUntraced(function*({ json }) {
    const fs = yield* FileSystem.FileSystem
    const rootDir = yield* sessionRoot
    const names = (yield* fs.readDirectory(rootDir).pipe(Effect.orElseSucceed(() => []))).filter((name) =>
      Session.nameRule.test(name)
    ).sort()
    const found: Array<Record<string, unknown>> = []
    for (const name of names) {
      const paths = Session.paths(rootDir, name)
      const pid = yield* holder(fs, paths.dir)
      const answer = Option.isSome(pid)
        ? yield* Effect.promise(() => Client.ask(rootDir, name, ["info"]))
        : { code: 1, out: "" }
      if (answer.code === 0) found.push({ ...JSON.parse(answer.out) as Record<string, unknown>, running: true })
      else found.push({ name, running: false, dir: paths.dir, size: yield* sizeOf(fs, paths.dir) })
    }
    if (json) return yield* Console.log(JSON.stringify(found, null, 2))
    if (found.length === 0) return yield* Console.log("No sessions. strider start starts one.")
    for (const session of found) {
      yield* Console.log(
        session.running === true
          ? `${session.name}  ${session.browser} · pages ${
            (session.pages as ReadonlyArray<string>).join(", ") || "none"
          } · idle ${session.idle} s of ${session.idleTimeout}${
            session.owner === null ? "" : ` · ends with process ${session.owner}`
          }`
          : `${session.name}  left behind by a session that didn't end cleanly · ${
            megabytes(session.size as number)
          } at ${session.dir} · strider prune ${session.name} removes it`
      )
    }
  })
).pipe(Command.withDescription("List the sessions: the running ones, and any a crash left behind"))

/** The processes running from a directory, on Linux, by their command lines. */
const runningFrom = (fs: FileSystem.FileSystem, dir: string) =>
  Effect.flatMap(
    fs.readDirectory("/proc").pipe(Effect.orElseSucceed(() => [])),
    (entries) =>
      Effect.filter(entries.filter((entry) => /^\d+$/.test(entry)), (pid) =>
        Effect.map(
          fs.readFileString(`/proc/${pid}/cmdline`).pipe(Effect.orElseSucceed(() => "")),
          (cmdline) => cmdline.includes(dir)
        ))
  )

/** When a process started, in milliseconds since the epoch, where `/proc` says (Linux); `None` elsewhere. */
const startedAt = Effect.fnUntraced(
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
 * Whether a ledger's program still runs: its process id is alive and, where `/proc` says when it started, it is
 * the same process. When that can't be told, it counts as running, so nothing of a live program is reclaimed.
 */
const stillRunning = Effect.fnUntraced(function*(fs: FileSystem.FileSystem, owner: Ledger.Record["owner"]) {
  if (!Node.alive(owner.pid)) return false
  const started = yield* startedAt(fs, owner.pid)
  return Option.isNone(started) || Math.abs(started.value - owner.startedAt) < 3000
})

/** `strider prune` with no name: what the ledger's ended programs left, reclaimed with `--yes` (review 22). */
const pruneLedger = Effect.fnUntraced(function*(yes: boolean) {
  const fs = yield* FileSystem.FileSystem
  const os = yield* Effect.promise(() => Node.os())
  const directory = Session.ledgerRoot(Node.process.env, os.homedir())
  const records = yield* Ledger.read(directory)
  let found = 0
  for (const { file, record } of records) {
    if (yield* stillRunning(fs, record.owner)) continue
    found++
    yield* Console.log(
      `left by process ${record.owner.pid}, started ${new Date(record.owner.startedAt).toISOString()}, which has ended:`
    )
    for (const item of record.items) {
      if (item._tag === "Browser") {
        const running = yield* runningFrom(fs, item.profile)
        yield* Console.log(
          `  ${item.executable}, ${
            running.length === 0 ? "no longer running" : `running as ${running.join(", ")}`
          }, its profile ${item.profile}`
        )
        if (yes) {
          for (const pid of running) {
            try {
              Node.process.kill(Number(pid), "SIGKILL")
            } catch {
              // It exited meanwhile
            }
          }
        }
      } else {
        const exists = yield* fs.exists(item.path).pipe(Effect.orElseSucceed(() => false))
        yield* Console.log(
          `  ${item.path}${exists ? ` (${megabytes(yield* sizeOf(fs, item.path))})` : ", already gone"}`
        )
        if (yes && exists) yield* fs.remove(item.path, { recursive: true }).pipe(Effect.ignore)
      }
    }
    if (yes) yield* fs.remove(file).pipe(Effect.ignore)
  }
  if (found === 0) return yield* Console.log("Nothing is left behind by a program that ended")
  yield* Console.log(
    yes ? `reclaimed what ${found} ended program${found === 1 ? "" : "s"} left` : "strider prune --yes reclaims it"
  )
})

/**
 * `strider prune <name>`: removes what a session that didn't end cleanly left behind. With no name, what the
 * ledger's ended programs left, which `--yes` reclaims.
 */
export const prune = Command.make(
  "prune",
  {
    name: Argument.String("name").pipe(Argument.optional),
    yes: Flag.Boolean("yes").pipe(
      Flag.withDescription("With no name: reclaim what the ledger's ended programs left, not only list it"),
      Flag.withDefault(false)
    )
  },
  Effect.fnUntraced(function*({ name: given, yes }) {
    if (Option.isNone(given)) return yield* pruneLedger(yes)
    const name = given.value
    const fs = yield* FileSystem.FileSystem
    const rootDir = yield* sessionRoot
    const paths = Session.paths(rootDir, name)
    if (!(yield* fs.exists(paths.dir).pipe(Effect.orElseSucceed(() => false)))) {
      return yield* Console.log(`No session named ${name} is left behind`)
    }
    if (Option.isSome(yield* holder(fs, paths.dir))) {
      return yield* Console.error(`${name} is running; strider stop -s ${name} ends it`)
    }
    const browsers = yield* runningFrom(fs, paths.dir)
    for (const pid of browsers) {
      try {
        Node.process.kill(Number(pid), "SIGKILL")
      } catch {
        // It exited meanwhile
      }
    }
    yield* fs.remove(paths.dir, { recursive: true }).pipe(Effect.orDie)
    yield* Console.log(
      `removed ${paths.dir}${
        browsers.length === 0
          ? ""
          : ` and ended ${browsers.length} browser process${browsers.length === 1 ? "" : "es"} running from it`
      }`
    )
  })
).pipe(
  Command.withDescription(
    "Remove a session a crash left behind, and any browser still running from it; with no name, list what the ledger's ended programs left"
  )
)

/** `strider`: the commands that need no session. A session's commands go to its daemon. */
export const strider = Command.make("strider").pipe(
  Command.withDescription(
    "Strider: Effect-native browser automation. strider start --name <name> --chromium <path> starts a session; strider -s <name> -p <page> <command> drives it."
  ),
  Command.withSubcommands([browsers, sessions, prune])
)

/** Runs the commands that need no session, with the package's version. */
export const run = Effect.fnUntraced(function*(argv: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const manifest = yield* path.fromFileUrl(new URL("../../package.json", import.meta.url))
  const { version } = JSON.parse(yield* fs.readFileString(manifest)) as { readonly version: string }
  return yield* Command.runWith(strider, { version })(argv)
})
