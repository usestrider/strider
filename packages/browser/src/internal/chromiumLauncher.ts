/**
 * Launches Chromium, Chrome or Edge for the CDP adapter: the executable named by its absolute path, a profile
 * that lives as long as the browser, the launch profile's arguments, and a transport.
 *
 * The pipe is the transport unless a runtime can't pass extra file descriptors (probe 12), in which case the
 * caller asks for the port: the browser picks one and writes it to `DevToolsActivePort` in its profile.
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import type * as Scope from "effect/Scope"
import * as Browser from "../Browser.ts"
import * as Transport from "../protocol/Transport.ts"
import * as BrowserClock from "./browserClock.ts"
import * as DevToolsActivePort from "./devToolsActivePort.ts"
import * as Launch from "./launch.ts"
import * as Profiles from "./profiles.ts"

/** A launch profile's name; its arguments are Chromium's own. */
export type Profile = Profiles.Profile

/** Each profile's arguments (`internal/profiles.ts`). */
export const profileArgs = Profiles.chromiumArgs

/** Settings for a launch, beside the executable it names. */
export interface Settings {
  /** @default true */
  readonly headless?: boolean | undefined
  /** @default "automation" */
  readonly profile?: Profile | undefined
  /** The profile's arguments, when a `LaunchProfile` value gives them; otherwise the named profile's. */
  readonly profileArgs?: ReadonlyArray<string> | undefined
  /** Added after the profile's. */
  readonly args?: ReadonlyArray<string> | undefined
  /** A profile directory the caller owns, never deleted; otherwise a temporary one. */
  readonly userDataDir?: string | undefined
  /** @default false */
  readonly coreDumps?: boolean | undefined
}

/** A launch: the executable it names, as an absolute path, and its settings. */
export interface Options extends Settings {
  readonly executablePath: string
}

/** The arguments a launch passes, in order: the profile's, the caller's, then ours. */
export const argsFor = (options: Settings, userDataDir: string, debugging: "pipe" | "port"): ReadonlyArray<string> => [
  ...(options.profileArgs ?? profileArgs[options.profile ?? "automation"]),
  ...(options.headless ?? true ? ["--headless"] : []),
  ...(options.args ?? []),
  ...(false ? ["--no-sandbox"] : []),
  ...(true ? ["--no-startup-window"] : []),
  debugging === "pipe" ? "--remote-debugging-pipe" : "--remote-debugging-port=0",
  `--user-data-dir=${userDataDir}`,
  ...(true ? [] : ["about:blank"])
]

/** Launches over the pipe. */
export const launch: (
  options: Options
) => Effect.Effect<
  { readonly launched: Launch.Launched; readonly transport: Transport.Transport },
  Browser.BrowserError,
  Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> = Effect.fnUntraced(function*(options: Options) {
  const path = yield* Launch.executable(options.executablePath)
  const userDataDir = yield* Launch.profileDirectory(options.userDataDir, "strider-chromium-")
  const launched = yield* Launch.spawn(path, argsFor(options, userDataDir, "pipe"), userDataDir, {
    additionalFds: Transport.pipeFds,
    coreDumps: options.coreDumps
  })
  const transport = yield* Transport.pipe(launched.handle)
  return { launched, transport }
}, (effect, options) => Launch.span("Chromium.launch", options)(effect))

/**
 * Launches with a debugging port and connects over a WebSocket, for runtimes that can't pass extra file
 * descriptors. Endpoint readiness and final stderr collection share the `timeout` budget.
 */
export const launchWithPort = Effect.fnUntraced(function*(
  options: Options & { readonly timeout?: Duration.Input | undefined }
) {
  const path = yield* Launch.executable(options.executablePath)
  const userDataDir = yield* Launch.profileDirectory(options.userDataDir, "strider-chromium-")
  const launched = yield* Launch.spawn(path, argsFor(options, userDataDir, "port"), userDataDir, {
    coreDumps: options.coreDumps
  })
  const timeout = options.timeout ?? "30 seconds"
  const deadline = Launch.readinessDeadline(timeout)
  const active = yield* DevToolsActivePort.read(userDataDir, {
    timeout: BrowserClock.millisLeft(BrowserClock.live, deadline),
    until: () => launched.handle.isRunning.pipe(Effect.map((running) => !running), Effect.orElseSucceed(() => true))
  }).pipe(Effect.asSome, Effect.catch(() => Effect.succeedNone))
  if (active._tag === "None") {
    return yield* Launch.notReady(
      launched,
      `It didn't write DevToolsActivePort within ${Duration.format(Duration.fromInputUnsafe(timeout))}`,
      deadline
    )
  }
  const { port, browserPath } = active.value
  const transport = yield* Transport.webSocket(`ws://127.0.0.1:${port}${browserPath}`).pipe(
    Effect.catch((error) =>
      Launch.fail(new Browser.ConnectionFailed({ stage: "refused", hint: error.message }), "connect")
    )
  )
  return { launched, transport }
}, (effect, options) => Launch.span("Chromium.launch", options)(effect))
