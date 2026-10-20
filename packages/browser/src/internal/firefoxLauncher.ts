/**
 * Launches Firefox for the BiDi adapter: the executable named by path or channel, a profile that lives as long
 * as the browser, with the launch profile's preferences in its `user.js`, and a WebSocket to the WebDriver BiDi
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
import * as Launch from "./launch.ts"

/** A launch profile's name; its preferences are Firefox's own. */
export type Profile = "stock" | "automation" | "concurrent"

type Prefs = Readonly<Record<string, string | number | boolean>>

const automation: Prefs = {
  "app.update.disabledForTesting": true,
  "browser.shell.checkDefaultBrowser": false,
  "browser.startup.homepage_override.mstone": "ignore",
  "browser.aboutwelcome.enabled": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false
}

/**
 * Each profile's preferences. `automation` turns off update, first-run and data-reporting prompts, nothing a
 * page can observe; `concurrent` adds background-timer throttling off, which pages can observe, so it is
 * opt-in.
 */
export const profilePrefs: Readonly<Record<Profile, Prefs>> = {
  stock: {},
  automation,
  concurrent: { ...automation, "dom.timeout.enable_budget_timer_throttling": false }
}

/** Where each channel installs itself, per platform. */
export const channelCandidates = (
  platform: string,
  channel: Channel,
  env: Readonly<Record<string, string | undefined>>
): ReadonlyArray<string> => {
  switch (platform) {
    case "darwin": {
      const app = { stable: "Firefox", beta: "Firefox", canary: "Firefox Nightly" }[channel]
      return [`/Applications/${app}.app/Contents/MacOS/firefox`]
    }
    case "win32": {
      const folder = { stable: "Mozilla Firefox", beta: "Mozilla Firefox", canary: "Firefox Nightly" }[channel]
      return [env["PROGRAMFILES"], env["PROGRAMFILES(X86)"]]
        .filter((root): root is string => root !== undefined)
        .map((root) => `${root}\\${folder}\\firefox.exe`)
    }
    default:
      return channel === "canary"
        ? ["/usr/bin/firefox-nightly", "/opt/firefox-nightly/firefox"]
        : ["/usr/bin/firefox", "/usr/lib/firefox/firefox", "/opt/firefox/firefox"]
  }
}

/** Firefox's release channels, each where its installer puts it; `canary` is Nightly. */
export type Channel = "stable" | "beta" | "canary"

/** Settings for a launch, beside the browser it names. */
export interface Settings {
  /** @default true */
  readonly headless?: boolean | undefined
  /** @default "automation" */
  readonly profile?: Profile | undefined
  /** Added after ours. */
  readonly args?: ReadonlyArray<string> | undefined
  /** A profile directory the caller owns, never deleted; otherwise a temporary one. */
  readonly userDataDir?: string | undefined
  /**
   * How long to wait for Firefox to report its WebDriver BiDi endpoint.
   *
   * @default "30 seconds"
   */
  readonly timeout?: Duration.Input | undefined
}

/** A launch: the browser it names, and its settings. */
export type Options = Settings & Launch.Named<Channel>

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

// The platform and environment, where the runtime has them; the package doesn't assume Node.
const host = (globalThis as {
  readonly process?: { readonly platform: string; readonly env: Readonly<Record<string, string | undefined>> }
}).process

const executable = (options: Options) =>
  Launch.namedExecutable(options, (channel: Channel) => ({
    candidates: channelCandidates(host?.platform ?? "linux", channel, host?.env ?? {}),
    hint: `Firefox's ${channel} channel isn't installed where its installer puts it`
  }))

/** Launches Firefox and connects to its WebDriver BiDi endpoint. */
export const launch = Effect.fnUntraced(function*(options: Options) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* executable(options)
  const profile = yield* Launch.profileDirectory(options.userDataDir, "strider-firefox-")
  yield* fs.writeFileString(`${profile}/user.js`, userJs(profilePrefs[options.profile ?? "automation"])).pipe(
    Effect.catch((error) =>
      Launch.fail(
        new Browser.ConnectionFailed({ stage: "refused", hint: `Couldn't write the profile: ${error.message}` }),
        "write the profile"
      )
    )
  )
  const launched = yield* Launch.spawn(path, argsFor(options, profile), profile, {})
  const timeout = options.timeout ?? "30 seconds"
  const listening = yield* launched.stderrLine(/WebDriver BiDi listening on (ws:\/\/\S+)/).pipe(
    Effect.timeoutOption(timeout),
    Effect.map(Option.flatten)
  )
  if (Option.isNone(listening)) {
    return yield* Launch.notReady(
      launched,
      `It didn't report a WebDriver BiDi endpoint within ${Duration.format(Duration.fromInputUnsafe(timeout))}`
    )
  }
  const transport = yield* Transport.webSocket(`${listening.value[1]}/session`).pipe(
    Effect.catch((error) =>
      Launch.fail(new Browser.ConnectionFailed({ stage: "refused", hint: error.message }), "connect")
    )
  )
  return { launched, transport }
})
