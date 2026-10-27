/**
 * Finds the browsers on a machine, for `strider browsers` (review 11): on `PATH` under the command names their
 * packages install, where vendors' installers put them, and where WebKitGTK's and WPE's packages put their
 * MiniBrowser (review 23). It reports what it finds and how, with the version each prints; only the command calls
 * it, and a launch never looks anything up.
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

/** The backend that launches a browser: `Chromium.layer`, `Firefox.layer` or `WebKit.layer`. */
export const Backend = Schema.Literals(["chromium", "firefox", "webkit"])
export type Backend = typeof Backend.Type

/** How a browser was found. */
export const Source = Schema.Literals(["PATH", "installer"])
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
  /** What the executable printed for `--version`; a MiniBrowser's, from the path it leads to, where that says. */
  version: Schema.OptionFromNullOr(Schema.String)
})
export type Found = typeof Found.Type

/**
 * The command names each backend's browsers install on `PATH`: Chromium, Chrome and Edge for the CDP backend,
 * Firefox's for BiDi. WebKit's MiniBrowser is never on `PATH`.
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

/**
 * Where WebKitGTK's and WPE's packages put their MiniBrowser, which `WebKit.layer` launches in automation mode: under
 * each API version's directory, in the system's library or libexec directory, or a Nix profile's. Linux only, where
 * stock WebKit has an automation mode.
 */
export const webkitCandidates = (
  platform: string,
  env: Readonly<Record<string, string | undefined>>
): ReadonlyArray<Candidate> => {
  if (platform !== "linux") return []
  const home = env["HOME"]
  const user = env["USER"]
  const prefixes = [
    "/usr/libexec",
    "/usr/lib",
    "/usr/lib64",
    "/usr/lib/x86_64-linux-gnu",
    "/usr/lib/aarch64-linux-gnu",
    "/usr/local/libexec",
    "/run/current-system/sw/libexec",
    ...(user === undefined ? [] : [`/etc/profiles/per-user/${user}/libexec`]),
    ...(home === undefined ? [] : [`${home}/.nix-profile/libexec`])
  ]
  const apis = [
    "webkitgtk-6.0",
    "webkit2gtk-4.1",
    "webkit2gtk-4.0",
    "wpe-webkit-2.0",
    "wpe-webkit-1.1",
    "wpe-webkit-1.0"
  ]
  return prefixes.flatMap((prefix) =>
    apis.map((api) => ({
      backend: "webkit" as const,
      path: `${prefix}/${api}/MiniBrowser`,
      foundBy: "installer" as const
    }))
  )
}

/**
 * A MiniBrowser's version, from the path it leads to, as a Nix store path names it; never by running it, which
 * opens a window before it reads its options (QUIRKS.md, Q234).
 */
const webkitVersionOf = (resolved: string): Option.Option<string> =>
  Option.map(
    Option.fromNullishOr(/[/-](webkitgtk|wpewebkit)-(\d+(?:\.\d+)+)/.exec(resolved)),
    (match) => `${match[1] === "webkitgtk" ? "WebKitGTK" : "WPE WebKit"} ${match[2]}`
  )

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
 * to, then vendors' install locations, then WebKit's packages'. A path that leads where an earlier one did, for
 * the same backend, is left out.
 */
export const find = Effect.fnUntraced(function*(
  platform: string,
  env: Readonly<Record<string, string | undefined>>
) {
  const fs = yield* FileSystem.FileSystem
  const candidates = [
    ...pathCandidates(platform, env),
    ...installerCandidates(platform, env),
    ...webkitCandidates(platform, env)
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
      const version = candidate.backend === "webkit"
        ? webkitVersionOf(resolved)
        : yield* versionOf(platform, candidate.path)
      return {
        backend: candidate.backend,
        path: candidate.path,
        resolved: resolved === candidate.path ? Option.none() : Option.some(resolved),
        foundBy: candidate.foundBy,
        version
      } satisfies Found
    }), { concurrency: 4 })
})
