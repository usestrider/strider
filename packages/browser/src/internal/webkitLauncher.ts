/**
 * Launches Playwright's WebKit build for the WebKit adapter: the build's executable, named by path or found in
 * Playwright's browser cache, a profile that lives as long as the browser, and the pipe.
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
import * as Hex from "effect/encoding/Hex"
import * as FileSystem from "effect/FileSystem"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import type * as Scope from "effect/Scope"
import * as Browser from "../Browser.ts"
import * as Transport from "../protocol/Transport.ts"
import * as Launch from "./launch.ts"

/** The Playwright WebKit build the adapter was generated from, and the SHA-256 of its `protocol.json`. */
export const build = {
  revision: "2359",
  protocolSha256: "5962bc790bde7750ce127029962a6c1bd93aed884cbcf832da8393c2a12c106c"
} as const

/**
 * Where Playwright installs the build, per platform: `PLAYWRIGHT_BROWSERS_PATH` if set, otherwise
 * Playwright's own cache directory.
 */
export const cacheCandidates = (
  platform: string,
  env: Readonly<Record<string, string | undefined>>
): ReadonlyArray<string> => {
  const folder = `webkit-${build.revision}`
  const executable = platform === "win32" ? `${folder}\\Playwright.exe` : `${folder}/pw_run.sh`
  const separator = platform === "win32" ? "\\" : "/"
  const roots = env["PLAYWRIGHT_BROWSERS_PATH"] !== undefined
    ? [env["PLAYWRIGHT_BROWSERS_PATH"]]
    : platform === "darwin"
    ? [env["HOME"] && `${env["HOME"]}/Library/Caches/ms-playwright`]
    : platform === "win32"
    ? [env["LOCALAPPDATA"] && `${env["LOCALAPPDATA"]}\\ms-playwright`]
    : [env["XDG_CACHE_HOME"] ?? (env["HOME"] && `${env["HOME"]}/.cache`)].map((cache) =>
      cache && `${cache}/ms-playwright`
    )
  return roots.filter((root): root is string => typeof root === "string" && root !== "").map((root) =>
    `${root}${separator}${executable}`
  )
}

/** Settings for a launch. */
export interface Options {
  /** The build's executable (`pw_run.sh`, or `Playwright.exe` on Windows); otherwise Playwright's cache's. */
  readonly executablePath?: string | undefined
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

/** The arguments a launch passes. */
export const argsFor = (options: Options, userDataDir: string): ReadonlyArray<string> => [
  "--inspector-pipe",
  ...(options.headless ?? true ? ["--headless"] : []),
  `--user-data-dir=${userDataDir}`,
  ...(options.args ?? [])
]

// The platform and environment, where the runtime has them; the package doesn't assume Node.
const host = (globalThis as {
  readonly process?: { readonly platform: string; readonly env: Readonly<Record<string, string | undefined>> }
}).process

const executable = (options: Options) =>
  options.executablePath !== undefined
    ? Launch.findExecutable([options.executablePath], "The executablePath given doesn't exist")
    : Launch.findExecutable(
      cacheCandidates(host?.platform ?? "linux", host?.env ?? {}),
      `Playwright's WebKit ${build.revision} isn't in Playwright's browser cache; install it with \`npx playwright install webkit\` from Playwright 1.63, or pass executablePath`
    )

const sha256 = (bytes: Uint8Array) =>
  Effect.promise(() => globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)).pipe(
    Effect.map((digest) => Hex.encode(new Uint8Array(digest)))
  )

/** Fails unless the build beside `executable` ships the `protocol.json` the adapter was generated from. */
export const checkRevision = Effect.fnUntraced(function*(executable: string) {
  const fs = yield* FileSystem.FileSystem
  const directory = executable.slice(0, Math.max(executable.lastIndexOf("/"), executable.lastIndexOf("\\")))
  const file = `${directory}/protocol.json`
  const bytes = yield* fs.readFile(file).pipe(Effect.option)
  if (bytes._tag === "None") {
    return yield* Launch.fail(
      new Browser.IncompatibleRevision({
        revision: "unknown",
        hint:
          `There is no protocol.json beside ${executable}, as every Playwright WebKit build ships one, so this isn't one`
      }),
      "check the revision"
    )
  }
  const digest = yield* sha256(bytes.value)
  if (digest !== build.protocolSha256) {
    return yield* Launch.fail(
      new Browser.IncompatibleRevision({
        revision: `protocol.json ${digest.slice(0, 12)}`,
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
  const path = yield* executable(options)
  if (options.checkRevision ?? true) yield* checkRevision(path)
  const userDataDir = yield* Launch.profileDirectory(options.userDataDir, "strider-webkit-")
  const launched = yield* Launch.spawn(path, argsFor(options, userDataDir), userDataDir, {
    additionalFds: Transport.pipeFds
  })
  const transport = yield* Transport.pipe(launched.handle)
  return { launched, transport }
})
