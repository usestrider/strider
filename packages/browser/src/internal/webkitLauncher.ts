/**
 * Launches Playwright's WebKit build for the WebKit adapter: the build's executable, named by its absolute path,
 * a profile that lives as long as the browser, and the pipe. Nothing is looked up or downloaded.
 *
 * The profile is always a persistent one (`--user-data-dir`), so the browser has a default context, as a
 * stock browser does, and opens one page in it. That page exists before the adapter attaches, so it isn't
 * paused; every later page is.
 *
 * The adapter is generated from, and tested against, one build's `protocol.json`, which the build ships
 * beside its executable. A launch compares the two, and fails with `IncompatibleRevision` if they differ,
 * unless `checkRevision` is off (PROTOCOL.md, Drift test).
 */
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import type * as Scope from "effect/Scope"
import * as Browser from "../Browser.ts"
import * as Transport from "../protocol/Transport.ts"
import * as Launch from "./launch.ts"
import { build, protocolDigest } from "./webkitBuild.ts"

export { build } from "./webkitBuild.ts"

/** Settings for a launch, beside the build it names. */
export interface Settings {
  /**
   * Headed runs need the GTK build on Linux, which `pw_run.sh` picks when `--headless` is absent.
   *
   * @default true
   */
  readonly headless?: boolean | undefined
  /** Added after ours. */
  readonly args?: ReadonlyArray<string> | undefined
  /** A profile directory the caller owns, never deleted; otherwise a temporary one. */
  readonly userDataDir?: string | undefined
  /**
   * Compare the build's `protocol.json` with the one the adapter was generated from.
   *
   * @default true
   */
  readonly checkRevision?: boolean | undefined
}

/**
 * A launch: the build it names, by its executable's absolute path (`pw_run.sh`, or `Playwright.exe` on Windows),
 * and its settings.
 */
export interface Options extends Settings {
  readonly executablePath: string
}

/** The arguments a launch passes. */
export const argsFor = (options: Settings, userDataDir: string): ReadonlyArray<string> => [
  "--inspector-pipe",
  ...(options.headless ?? true ? ["--headless"] : []),
  `--user-data-dir=${userDataDir}`,
  ...(options.args ?? [])
]

/** Fails unless the build beside `executable` ships the `protocol.json` the adapter was generated from. */
export const checkRevision = Effect.fnUntraced(function*(executable: string) {
  const digest = yield* protocolDigest(executable)
  if (digest._tag === "None") {
    return yield* Launch.fail(
      new Browser.IncompatibleRevision({
        revision: "unknown",
        hint:
          `There is no protocol.json beside ${executable}, as every Playwright WebKit build ships one, so this isn't one`
      }),
      "check the revision"
    )
  }
  if (digest.value !== build.protocolSha256) {
    return yield* Launch.fail(
      new Browser.IncompatibleRevision({
        revision: `protocol.json ${digest.value.slice(0, 12)}`,
        hint:
          `This build's protocol differs from build ${build.revision}'s, which the adapter is generated from and tested against. Use Playwright's WebKit ${build.revision}, or turn checkRevision off to try this one`
      }),
      "check the revision"
    )
  }
})

/** Launches over the pipe. */
export const launch: (
  options: Options
) => Effect.Effect<
  { readonly launched: Launch.Launched; readonly transport: Transport.Transport },
  Browser.BrowserError,
  Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> = Effect.fnUntraced(function*(options: Options) {
  const path = yield* Launch.executable(options.executablePath)
  if (options.checkRevision ?? true) yield* checkRevision(path)
  const userDataDir = yield* Launch.profileDirectory(options.userDataDir, "strider-webkit-")
  const launched = yield* Launch.spawn(path, argsFor(options, userDataDir), userDataDir, {
    additionalFds: Transport.pipeFds
  })
  const transport = yield* Transport.pipe(launched.handle)
  return { launched, transport }
})
