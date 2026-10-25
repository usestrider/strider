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

/** `strider prune <name>`: removes what a session that didn't end cleanly left behind. */
export const prune = Command.make(
  "prune",
  { name: Argument.String("name") },
  Effect.fnUntraced(function*({ name }) {
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
).pipe(Command.withDescription("Remove a session a crash left behind, and any browser still running from it"))

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
