/**
 * Launches Chromium, Chrome or Edge for the CDP adapter: the executable named by path or channel, a profile
 * that lives as long as the browser, the launch profile's arguments, and a transport.
 *
 * The pipe is the transport unless a runtime can't pass extra file descriptors (probe 12), in which case the
 * caller asks for the port: the browser picks one and writes it to `DevToolsActivePort` in its profile.
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Schedule from "effect/Schedule"
import type * as Scope from "effect/Scope"
import * as Browser from "../Browser.ts"
import * as Transport from "../protocol/Transport.ts"
import * as Launch from "./launch.ts"

/** A launch profile's name; its arguments are Chromium's own. */
export type Profile = "stock" | "automation" | "concurrent"

/*
 * Each profile's arguments.
 *
 * - `automation` turns off first-run, sync, update and crash-report prompts, the browser's own background
 *   traffic, and the component extensions that would otherwise attach as targets. Nothing a page can observe.
 * - `concurrent` adds the throttling switches for many pages at once. Pages can observe those (timer cadence,
 *   background rendering), so they are opt-in.
 */
const automation: ReadonlyArray<string> = [
  "--no-first-run",
  "--no-default-browser-check",
  "--no-service-autorun",
  "--disable-sync",
  "--disable-component-update",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-client-side-phishing-detection",
  "--disable-domain-reliability",
  "--disable-breakpad",
  "--disable-hang-monitor",
  "--disable-prompt-on-repost",
  "--disable-component-extensions-with-background-pages",
  "--disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,AutofillServerCommunication",
  "--metrics-recording-only",
  "--password-store=basic",
  "--use-mock-keychain"
]

export const profileArgs: Readonly<Record<Profile, ReadonlyArray<string>>> = {
  stock: [],
  automation,
  concurrent: [
    ...automation,
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding"
  ]
}

/** Where each channel installs itself, per platform. */
export const channelCandidates = (
  platform: string,
  channel: "stable" | "beta" | "canary",
  env: Readonly<Record<string, string | undefined>>
): ReadonlyArray<string> => {
  switch (platform) {
    case "darwin": {
      const app = { stable: "Google Chrome", beta: "Google Chrome Beta", canary: "Google Chrome Canary" }[channel]
      return [`/Applications/${app}.app/Contents/MacOS/${app}`]
    }
    case "win32": {
      const folder = { stable: "Chrome", beta: "Chrome Beta", canary: "Chrome SxS" }[channel]
      const roots = channel === "canary"
        ? [env["LOCALAPPDATA"]]
        : [env["PROGRAMFILES"], env["PROGRAMFILES(X86)"], env["LOCALAPPDATA"]]
      return roots.filter((root): root is string => root !== undefined).map((root) =>
        `${root}\\Google\\${folder}\\Application\\chrome.exe`
      )
    }
    default: {
      const suffix = { stable: "", beta: "-beta", canary: "-unstable" }[channel]
      return [
        `/opt/google/chrome${suffix}/chrome`,
        `/usr/bin/google-chrome${channel === "stable" ? "-stable" : suffix}`
      ]
    }
  }
}

/** Settings for a launch. */
export interface Options {
  /** The executable; otherwise `channel`'s. */
  readonly executablePath?: string | undefined
  readonly channel?: "stable" | "beta" | "canary" | undefined
  /** @default true */
  readonly headless?: boolean | undefined
  /** @default "automation" */
  readonly profile?: Profile | undefined
  /** Added after the profile's. */
  readonly args?: ReadonlyArray<string> | undefined
  /** A profile directory the caller owns, never deleted; otherwise a temporary one. */
  readonly userDataDir?: string | undefined
}

/** The arguments a launch passes, in order: the profile's, the caller's, then ours. */
export const argsFor = (options: Options, userDataDir: string, debugging: "pipe" | "port"): ReadonlyArray<string> => [
  ...profileArgs[options.profile ?? "automation"],
  ...(options.headless ?? true ? ["--headless"] : []),
  ...(options.args ?? []),
  debugging === "pipe" ? "--remote-debugging-pipe" : "--remote-debugging-port=0",
  `--user-data-dir=${userDataDir}`,
  "about:blank"
]

// The platform and environment, where the runtime has them; the package doesn't assume Node.
const host = (globalThis as {
  readonly process?: { readonly platform: string; readonly env: Readonly<Record<string, string | undefined>> }
}).process

const executable = (options: Options) => {
  if (options.executablePath !== undefined) {
    return Launch.findExecutable([options.executablePath], "The executablePath given doesn't exist")
  }
  if (options.channel !== undefined) {
    return Launch.findExecutable(
      channelCandidates(host?.platform ?? "linux", options.channel, host?.env ?? {}),
      `Chrome's ${options.channel} channel isn't installed where it installs itself`
    )
  }
  return Launch.findExecutable(
    [],
    "Pass executablePath or a channel. Downloading Chrome for Testing, the default, isn't built yet"
  )
}

/** Launches over the pipe. */
export const launch: (
  options: Options
) => Effect.Effect<
  { readonly launched: Launch.Launched; readonly transport: Transport.Transport },
  Browser.BrowserError,
  Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> = Effect.fnUntraced(function*(options: Options) {
  const path = yield* executable(options)
  const userDataDir = yield* Launch.profileDirectory(options.userDataDir, "strider-chromium-")
  const launched = yield* Launch.spawn(path, argsFor(options, userDataDir, "pipe"), userDataDir, {
    additionalFds: Transport.pipeFds
  })
  const transport = yield* Transport.pipe(launched.handle)
  return { launched, transport }
})

/**
 * Launches with a debugging port and connects over a WebSocket, for runtimes that can't pass extra file
 * descriptors. Waits up to `timeout` for the browser to write the port it picked.
 */
export const launchWithPort = Effect.fnUntraced(function*(
  options: Options & { readonly timeout?: Duration.Input | undefined }
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* executable(options)
  const userDataDir = yield* Launch.profileDirectory(options.userDataDir, "strider-chromium-")
  const launched = yield* Launch.spawn(path, argsFor(options, userDataDir, "port"), userDataDir, {})
  const timeout = options.timeout ?? "30 seconds"
  const active = yield* fs.readFileString(`${userDataDir}/DevToolsActivePort`).pipe(
    Effect.filterOrFail((text) => text.includes("\n")),
    Effect.retry({
      schedule: Schedule.spaced("50 millis"),
      until: () => launched.handle.isRunning.pipe(Effect.map((running) => !running), Effect.orElseSucceed(() => true))
    }),
    Effect.timeoutOption(timeout),
    Effect.catch(() => Effect.succeedNone)
  )
  if (active._tag === "None") {
    return yield* Launch.notReady(
      launched,
      `It didn't write DevToolsActivePort within ${Duration.format(Duration.fromInputUnsafe(timeout))}`
    )
  }
  const [port, browserPath] = active.value.split("\n")
  const transport = yield* Transport.webSocket(`ws://127.0.0.1:${port}${browserPath}`).pipe(
    Effect.catch((error) =>
      Launch.fail(new Browser.ConnectionFailed({ stage: "refused", hint: error.message }), "connect")
    )
  )
  return { launched, transport }
})
