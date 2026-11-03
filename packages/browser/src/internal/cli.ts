/**
 * The `strider` commands that need no session (CLI.md): `browsers`, which lists the browsers it can find, so a person
 * or an agent can copy a path into `executablePath`; `sessions`; `prune`; and `agent`. A session's
 * own commands are its daemon's (`cli/daemon.ts`).
 */
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"

import * as Schema from "effect/Schema"
import * as Ledger from "../Ledger.ts"
import * as Browsers from "./browsers.ts"
import * as Agent from "./cli/agent.ts"
import * as Client from "./cli/client.ts"
import * as Node from "./cli/node.ts"
import type * as Protocol from "./cli/protocol.ts"
import * as Session from "./cli/session.ts"

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
  installer: "where its installer or package puts it"
}

/** The text `strider browsers` prints. */
export const render = (found: ReadonlyArray<Browsers.Found>): string => {
  const lines = ["Browsers found on this machine. Pass one as executablePath to its backend's layer.", ""]
  for (const backend of Browsers.Backend.literals) {
    lines.push(layers[backend])
    const ofBackend = found.filter((browser) => browser.backend === backend)
    if (ofBackend.length === 0) {
      lines.push(
        backend === "webkit"
          ? "  none found; WebKitGTK's and WPE's packages put a MiniBrowser under their library directory, on Linux"
          : "  none found"
      )
    }
    for (const browser of ofBackend) {
      const facts = [
        Option.getOrElse(browser.version, () => "version not reported"),
        sources[browser.foundBy],
        ...Option.toArray(Option.map(browser.resolved, (resolved) => `leads to ${resolved}`))
      ]
      lines.push(`  ${browser.path}`, `    ${facts.join(" · ")}`)
    }
    lines.push("")
  }
  lines.push(
    `Searched PATH for ${
      [...Browsers.commandNames.chromium, ...Browsers.commandNames.firefox].join(", ")
    }; the locations Chrome's, Edge's and Firefox's installers use; and, on Linux, where WebKitGTK's and WPE's packages put their MiniBrowser.`,
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
        : render(found)
    )
  })
).pipe(
  Command.withDescription(
    "List the browsers on this machine, with their versions, for a launch's executablePath. Nothing is launched but --version, and nothing is installed."
  )
)

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

/** A session `strider sessions` lists: one running, as it describes itself, or one a crash left behind. */
type Listed =
  | Protocol.SessionInfo & { readonly running: true }
  | { readonly name: string; readonly running: false; readonly dir: string; readonly size: number }

/** `strider sessions`: every session, running or left behind by a crash. */
export const sessions = Command.make(
  "sessions",
  { json },
  Effect.fnUntraced(function*({ json }) {
    const fs = yield* FileSystem.FileSystem
    const rootDir = yield* Client.sessionRoot
    const names = (yield* fs.readDirectory(rootDir).pipe(Effect.orElseSucceed(() => []))).filter((name) =>
      Session.nameRule.test(name)
    ).sort()
    const found: Array<Listed> = []
    for (const name of names) {
      const paths = Session.paths(rootDir, name)
      yield* Session.validateRoot(paths.dir)
      const info = Option.isSome(yield* Session.holder(fs, paths.dir))
        ? yield* Effect.scoped(Effect.flatMap(Client.session(rootDir, name), (client) => client.Info())).pipe(
          Effect.option
        )
        : Option.none()
      found.push(
        Option.isSome(info)
          ? { ...info.value, running: true }
          : { name, running: false, dir: paths.dir, size: yield* sizeOf(fs, paths.dir) }
      )
    }
    if (json) return yield* Console.log(JSON.stringify(found, null, 2))
    if (found.length === 0) return yield* Console.log("No sessions. strider start starts one.")
    for (const session of found) {
      yield* Console.log(
        session.running
          ? `${session.name}  ${session.browser} · pages ${
            session.pages.join(", ") || "none"
          } · idle ${session.idle} s of ${session.idleTimeout}${
            session.owner === null ? "" : ` · ends with process ${session.owner}`
          }`
          : `${session.name}  left behind by a session that didn't end cleanly · ${
            megabytes(session.size)
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

/** `strider prune` with no name: what the ledger's ended programs left, reclaimed with `--yes`. */
const pruneLedger = Effect.fnUntraced(function*(yes: boolean) {
  const fs = yield* FileSystem.FileSystem
  const os = yield* Effect.promise(() => Node.os())
  const directory = Session.ledgerRoot(Node.process.env, os.homedir())
  const records = yield* Ledger.read(directory)
  let found = 0
  for (const { file, record } of records) {
    if (yield* Session.stillRunning(fs, record.owner)) continue
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
    const rootDir = yield* Client.sessionRoot
    const paths = Session.paths(rootDir, name)
    yield* Session.validateRoot(paths.dir)
    if (!(yield* fs.exists(paths.dir).pipe(Effect.orElseSucceed(() => false)))) {
      return yield* Console.log(`No session named ${name} is left behind`)
    }
    if (Option.isSome(yield* Session.holder(fs, paths.dir))) {
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

/** Reuses a command's parser and help metadata, with no executable session handlers. */
const forHelp = (command: Command.Command.Any): Command.Command<any, any> =>
  (command as Command.Command<any, any, any, any, any>).pipe(
    Command.withHandler(() => Effect.void),
    Command.withSubcommands(command.subcommands.flatMap((group) => group.commands.map(forHelp)))
  )

/**
 * The complete command tree, for local help: the daemon's, loaded only for help, since a forwarded command needs
 * none of it. Session handlers never run here.
 */
export const help = Effect.map(
  Effect.promise(() => Promise.all([import("./cli/daemon.ts"), import("./cli/mcp.ts")])),
  ([Daemon, Mcp]) => {
    const sessionCommands = Daemon.commands(() => {
      throw new Error("Help must not access a session")
    })
    return Command.make("strider").pipe(
      Command.withSharedFlags(Daemon.selectors),
      Command.withSubcommands([
        forHelp(Daemon.start),
        forHelp(Mcp.command(() => Effect.void)),
        forHelp(browsers),
        forHelp(sessions),
        forHelp(prune),
        forHelp(Agent.command),
        ...sessionCommands.subcommands
          .flatMap((group) =>
            group.commands.map((command) => forHelp(command).pipe(Command.withSharedFlags(Daemon.output)))
          )
      ]),
      Command.withDescription(
        "Strider: Effect-native browser automation. strider start --name <name> --chromium <path> starts a session; strider -s <name> -p <page> <command> drives it."
      )
    )
  }
)

/** The commands that execute locally without a session. */
export const strider = Command.make("strider").pipe(
  Command.withSubcommands([browsers, sessions, prune, Agent.command])
)
