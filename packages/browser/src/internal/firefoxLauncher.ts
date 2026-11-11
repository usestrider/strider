/**
 * Launches Firefox for the BiDi adapter: the executable named by its absolute path, a profile that lives as
 * long as the browser, with the launch profile's preferences in its `user.js`, and a WebSocket to the WebDriver BiDi
 * endpoint Firefox reports on stderr.
 *
 * Firefox's remote agent also applies its own recommended preferences for automation
 * (`remote.prefs.recommended`); the profiles here only state, visibly, the ones a run depends on.
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Browser from "../Browser.ts"
import * as Transport from "../protocol/Transport.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Launch from "./launch.ts"
import * as Profiles from "./profiles.ts"

/** A launch profile's name; its preferences are Firefox's own. */
export type Profile = Profiles.Profile

type Prefs = Profiles.Prefs

/** Each profile's preferences (`internal/profiles.ts`). */
export const profilePrefs = Profiles.firefoxPrefs

/** Settings for a launch, beside the executable it names. */
export interface Settings {
  /** @default true */
  readonly headless?: boolean | undefined
  /** @default "automation" */
  readonly profile?: Profile | undefined
  /** The profile's preferences, when a `LaunchProfile` value gives them; otherwise the named profile's. */
  readonly profilePrefs?: Prefs | undefined
  /** Added after ours. */
  readonly args?: ReadonlyArray<string> | undefined
  /** A profile directory the caller owns, never deleted; otherwise a temporary one. */
  readonly userDataDir?: string | undefined
  /** @default false */
  readonly coreDumps?: boolean | undefined
  /**
   * How long to wait for Firefox to report its WebDriver BiDi endpoint.
   *
   * @default "30 seconds"
   */
  readonly timeout?: Duration.Input | undefined
}

/** A launch: the executable it names, as an absolute path, and its settings. */
export interface Options extends Settings {
  readonly executablePath: string
}

/** The arguments a launch passes. */
export const argsFor = (options: Settings, profile: string): ReadonlyArray<string> => [
  ...(options.headless ?? true ? ["--headless"] : []),
  "--remote-debugging-port=0",
  "--no-remote",
  "--profile",
  profile,
  ...(options.args ?? []),
  "about:blank"
]

/** A `user.js` that sets preferences. */
export const userJs = (prefs: Prefs): string =>
  Object.entries(prefs).map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`)
    .join("")

const blockStart = "// Strider's launch profile, written at each launch: edit outside this block"
const blockEnd = "// End of Strider's launch profile"

/**
 * A profile's `user.js` with the launch profile's preferences in a block of their own, after the lines it had: a
 * profile directory you own keeps its preferences, and a later launch replaces the block instead of adding another.
 */
export const profileUserJs = (existing: string, prefs: Prefs): string => {
  const lines = existing.split("\n")
  const start = lines.indexOf(blockStart)
  const end = lines.indexOf(blockEnd, start)
  const kept = (start === -1 || end === -1 ? lines : [...lines.slice(0, start), ...lines.slice(end + 1)])
    .join("\n")
    .replace(/\n+$/, "")
  const block = userJs(prefs)
  if (block === "") return kept === "" ? "" : `${kept}\n`
  return `${kept === "" ? "" : `${kept}\n`}${blockStart}\n${block}${blockEnd}\n`
}

/** Launches Firefox and connects to its WebDriver BiDi endpoint. */
export const launch = Effect.fnUntraced(function*(options: Options) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Launch.executable(options.executablePath)
  const profile = yield* Launch.profileDirectory(options.userDataDir, "strider-firefox-")
  // A profile directory of the caller's keeps the preferences its user.js already sets
  const existing = options.userDataDir === undefined
    ? ""
    : yield* fs.readFileString(`${profile}/user.js`).pipe(Effect.orElseSucceed(() => ""))
  yield* fs.writeFileString(
    `${profile}/user.js`,
    profileUserJs(existing, options.profilePrefs ?? profilePrefs[options.profile ?? "automation"])
  ).pipe(
    Effect.catch((error) =>
      Launch.fail(
        new Browser.ConnectionFailed({ stage: "refused", hint: `Couldn't write the profile: ${error.message}` }),
        "write the profile"
      )
    )
  )
  const launched = yield* Launch.spawn(path, argsFor(options, profile), profile, { coreDumps: options.coreDumps })
  const timeout = options.timeout ?? "30 seconds"
  const deadline = Launch.readinessDeadline(timeout)
  const listening = yield* launched.stderrLine(/WebDriver BiDi listening on (ws:\/\/\S+)/).pipe(
    BrowserClock.timeoutOn(BrowserClock.live, BrowserClock.millisLeft(BrowserClock.live, deadline)),
    Effect.map(Option.flatten),
    // The browser starts in real time, whatever clock the program's fiber has (QUIRKS.md, Q235)
    BrowserClock.onLive
  )
  if (Option.isNone(listening)) {
    return yield* Launch.notReady(
      launched,
      `It didn't report a WebDriver BiDi endpoint within ${Duration.format(Duration.fromInputUnsafe(timeout))}`,
      deadline
    )
  }
  const transport = yield* Transport.webSocket(`${listening.value[1]}/session`).pipe(
    Effect.catch((error) =>
      Launch.fail(new Browser.ConnectionFailed({ stage: "refused", hint: error.message }), "connect")
    )
  )
  return { launched, transport }
}, (effect, options) => Launch.span("Firefox.launch", options)(effect))
