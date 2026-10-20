/**
 * Finds the browsers on a machine, for `strider browsers` (review 11): on `PATH` under the command names their
 * packages install, where vendors' installers put them, and in Playwright's browser cache. It reports what it
 * finds and how, with the version each prints; only the command calls it, and a launch never looks anything up.
 *
 * The tables are search hints, not claims about what a browser is: two of Firefox's channels share an install
 * path, so nothing is labelled by channel, and the version the executable prints says what it is.
 */
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as ChildProcess from "effect/process/ChildProcess"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Schema from "effect/Schema"
import { isAbsolute } from "./launch.ts"
import { build, protocolDigest } from "./webkitBuild.ts"

/** The backend that launches a browser: `Chromium.layer`, `Firefox.layer` or `WebKit.layer`. */
export const Backend = Schema.Literals(["chromium", "firefox", "webkit"])
export type Backend = typeof Backend.Type

/** How a browser was found. */
export const Source = Schema.Literals(["PATH", "installer", "playwright"])
export type Source = typeof Source.Type

/** A path to look at, and where the hint came from. */
export interface Candidate {
  readonly backend: Backend
  readonly path: string
  readonly foundBy: Source
}

/** A browser found: the path to pass as `executablePath`, and what is known about it. */
export const Found = Schema.Struct({
  backend: Backend,
  /** As found; on NixOS a profile's link, which survives updates, rather than the store path it leads to. */
  path: Schema.String,
  /** Where `path` leads, when that differs. */
  resolved: Schema.OptionFromNullOr(Schema.String),
  foundBy: Source,
  /** What the executable printed for `--version`; a Playwright WebKit build's number. */
  version: Schema.OptionFromNullOr(Schema.String),
  /** For a Playwright WebKit build: whether its `protocol.json` is the one the adapter is generated from. */
  matchesAdapter: Schema.OptionFromNullOr(Schema.Boolean)
})
export type Found = typeof Found.Type

/**
 * The command names each backend's browsers install on `PATH`: Chromium, Chrome and Edge for the CDP backend,
 * Firefox's for BiDi. Playwright's WebKit is never on `PATH`.
 */
export const commandNames: { readonly [B in Exclude<Backend, "webkit">]: ReadonlyArray<string> } = {
  chromium: [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "google-chrome-beta",
    "google-chrome-unstable",
    "google-chrome-canary",
    "microsoft-edge",
    "microsoft-edge-stable",
    "microsoft-edge-beta",
    "microsoft-edge-dev",
    "chrome",
    "msedge"
  ],
  firefox: [
    "firefox",
    "firefox-esr",
    "firefox-beta",
    "firefox-devedition",
    "firefox-developer-edition",
    "firefox-nightly"
  ]
}

const separatorOf = (platform: string) => platform === "win32" ? "\\" : "/"

/** Each `PATH` directory, in order, joined with each command name. */
export const pathCandidates = (
  platform: string,
  env: Readonly<Record<string, string | undefined>>
): ReadonlyArray<Candidate> => {
  const directories = Array.from(
    new Set((env["PATH"] ?? "").split(platform === "win32" ? ";" : ":").filter((directory) => isAbsolute(directory)))
  )
  const suffix = platform === "win32" ? ".exe" : ""
  return directories.flatMap((directory) =>
    (["chromium", "firefox"] as const).flatMap((backend) =>
      commandNames[backend].map((name) => ({
        backend,
        path: `${directory}${separatorOf(platform)}${name}${suffix}`,
        foundBy: "PATH" as const
      }))
    )
  )
}

/**
 * Where vendors' installers put their browsers, per platform: Chrome's and Edge's from Playwright's own table
 * (Linux's Chrome Dev is `chrome-unstable`, and Canary `chrome-canary`), Firefox's where its installers and
 * tarballs go. On Linux the vendors' packages also put commands on `PATH`.
 */
export const installerCandidates = (
  platform: string,
  env: Readonly<Record<string, string | undefined>>
): ReadonlyArray<Candidate> => {
  const chromium = (path: string): Candidate => ({ backend: "chromium", path, foundBy: "installer" })
  const firefox = (path: string): Candidate => ({ backend: "firefox", path, foundBy: "installer" })
  switch (platform) {
    case "darwin": {
      const app = (name: string, executable = name) => `/Applications/${name}.app/Contents/MacOS/${executable}`
      return [
        ...["Google Chrome", "Google Chrome Beta", "Google Chrome Dev", "Google Chrome Canary", "Chromium"].map((
          name
        ) => chromium(app(name))),
        ...["Microsoft Edge", "Microsoft Edge Beta", "Microsoft Edge Dev", "Microsoft Edge Canary"].map((name) =>
          chromium(app(name))
        ),
        ...["Firefox", "Firefox Developer Edition", "Firefox Nightly"].map((name) => firefox(app(name, "firefox")))
      ]
    }
    case "win32": {
      const roots = [env["LOCALAPPDATA"], env["PROGRAMFILES"], env["PROGRAMFILES(X86)"]].filter(
        (root): root is string => root !== undefined && root !== ""
      )
      const under = (relative: string) => roots.map((root) => `${root}\\${relative}`)
      return [
        ...["Chrome", "Chrome Beta", "Chrome Dev", "Chrome SxS"].flatMap((folder) =>
          under(`Google\\${folder}\\Application\\chrome.exe`).map(chromium)
        ),
        ...["Edge", "Edge Beta", "Edge Dev", "Edge SxS"].flatMap((folder) =>
          under(`Microsoft\\${folder}\\Application\\msedge.exe`).map(chromium)
        ),
        ...["Mozilla Firefox", "Firefox Developer Edition", "Firefox Nightly"].flatMap((folder) =>
          under(`${folder}\\firefox.exe`).map(firefox)
        )
      ]
    }
    default:
      return [
        ...["chrome", "chrome-beta", "chrome-unstable", "chrome-canary"].map((folder) =>
          chromium(`/opt/google/${folder}/chrome`)
        ),
        ...["msedge", "msedge-beta", "msedge-dev"].map((folder) => chromium(`/opt/microsoft/${folder}/msedge`)),
        ...["firefox", "firefox-beta", "firefox-nightly"].map((folder) => firefox(`/opt/${folder}/firefox`))
      ]
  }
}

/** Playwright's browser cache: `PLAYWRIGHT_BROWSERS_PATH`, or the cache directory its installer uses. */
export const playwrightCache = (
  platform: string,
  env: Readonly<Record<string, string | undefined>>
): Option.Option<string> => {
  const set = env["PLAYWRIGHT_BROWSERS_PATH"]
  if (set !== undefined && set !== "" && set !== "0") return Option.some(set)
  const home = env["HOME"]
  switch (platform) {
    case "darwin":
      return home === undefined ? Option.none() : Option.some(`${home}/Library/Caches/ms-playwright`)
    case "win32": {
      const local = env["LOCALAPPDATA"]
      return local === undefined ? Option.none() : Option.some(`${local}\\ms-playwright`)
    }
    default: {
      const cache = env["XDG_CACHE_HOME"] ?? (home === undefined ? undefined : `${home}/.cache`)
      return cache === undefined ? Option.none() : Option.some(`${cache}/ms-playwright`)
    }
  }
}

/**
 * The executables inside one entry of Playwright's cache: its WebKit builds (`webkit-<build>`) and its Chromium
 * builds (`chromium-<build>`), in each layout Playwright has used per platform.
 */
export const playwrightCandidates = (platform: string, root: string, entry: string): ReadonlyArray<Candidate> => {
  const separator = separatorOf(platform)
  const at = (...parts: ReadonlyArray<string>) => [root, entry, ...parts].join(separator)
  if (/^webkit-\d+$/.test(entry)) {
    return [{
      backend: "webkit",
      path: at(platform === "win32" ? "Playwright.exe" : "pw_run.sh"),
      foundBy: "playwright"
    }]
  }
  if (/^chromium-\d+$/.test(entry)) {
    const testing = ["Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"]
    const layouts = platform === "darwin"
      ? [["chrome-mac-arm64", ...testing], ["chrome-mac-x64", ...testing], [
        "chrome-mac",
        "Chromium.app",
        "Contents",
        "MacOS",
        "Chromium"
      ]]
      : platform === "win32"
      ? [["chrome-win64", "chrome.exe"], ["chrome-win", "chrome.exe"]]
      : [["chrome-linux64", "chrome"], ["chrome-linux", "chrome"]]
    return layouts.map((parts) => ({ backend: "chromium", path: at(...parts), foundBy: "playwright" }))
  }
  return []
}

// What a browser prints for --version, if it prints anything within the time allowed. Chrome on Windows
// prints nothing, so Windows isn't asked.
const versionOf = (platform: string, path: string) =>
  platform === "win32" ? Effect.succeed(Option.none<string>()) : Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const output = yield* spawner.string(
      ChildProcess.make(path, ["--version"], { stdin: "ignore", stderr: "ignore", forceKillAfter: "1 second" })
    ).pipe(Effect.scoped, Effect.timeoutOption("10 seconds"), Effect.orElseSucceed(() => Option.none<string>()))
    return Option.flatMap(output, (text) => {
      const line = text.trim().split("\n")[0]?.trim() ?? ""
      return line === "" ? Option.none() : Option.some(line)
    })
  })

/**
 * Every browser found, in the order looked: `PATH` first, so a command's own path comes before what it leads
 * to, then vendors' install locations, then Playwright's cache. A path that leads where an earlier one did, for
 * the same backend, is left out.
 */
export const find = Effect.fnUntraced(function*(
  platform: string,
  env: Readonly<Record<string, string | undefined>>
) {
  const fs = yield* FileSystem.FileSystem
  const cache = playwrightCache(platform, env)
  const entries = Option.isNone(cache)
    ? []
    : (yield* fs.readDirectory(cache.value).pipe(Effect.orElseSucceed(() => []))).toSorted()
  const candidates = [
    ...pathCandidates(platform, env),
    ...installerCandidates(platform, env),
    ...(Option.isNone(cache) ? [] : entries.flatMap((entry) => playwrightCandidates(platform, cache.value, entry)))
  ]
  const kept: Array<{ readonly candidate: Candidate; readonly resolved: string }> = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const info = yield* fs.stat(candidate.path).pipe(Effect.option)
    if (Option.isNone(info) || info.value.type !== "File") continue
    const resolved = yield* fs.realPath(candidate.path).pipe(Effect.orElseSucceed(() => candidate.path))
    const key = `${candidate.backend} ${resolved}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push({ candidate, resolved })
  }
  return yield* Effect.forEach(kept, ({ candidate, resolved }) =>
    Effect.gen(function*() {
      const webkit = candidate.backend === "webkit"
      const version = webkit
        ? Option.some(`Playwright WebKit build ${/webkit-(\d+)/.exec(candidate.path)?.[1] ?? "unknown"}`)
        : yield* versionOf(platform, candidate.path)
      const matchesAdapter = webkit
        ? Option.some(Option.contains(yield* protocolDigest(candidate.path), build.protocolSha256))
        : Option.none<boolean>()
      return {
        backend: candidate.backend,
        path: candidate.path,
        resolved: resolved === candidate.path ? Option.none() : Option.some(resolved),
        foundBy: candidate.foundBy,
        version,
        matchesAdapter
      } satisfies Found
    }), { concurrency: 4 })
})
