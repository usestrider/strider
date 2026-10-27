/**
 * The flags and preferences a browser is launched with, as values you can inspect.
 *
 * A profile is never a hidden flag: it's a value whose `args` and `prefs` you can read, and a launch's span records
 * which profile it used. `args` are Chromium's switches and `prefs` Firefox's preferences; Playwright's WebKit takes
 * neither. No profile turns off the back/forward cache, third-party storage partitioning or popup blocking, because
 * Strider handles each of those itself.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Profiles from "./internal/profiles.ts"

/**
 * A named set of browser arguments and preferences.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class LaunchProfile extends Schema.Class<LaunchProfile>("@usestrider/browser/LaunchProfile")({
  name: Schema.Literals(["stock", "automation", "concurrent"]),
  args: Schema.Array(Schema.String),
  prefs: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))
}) {}

/**
 * The browser's own defaults; nothing added.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const stock: LaunchProfile = new LaunchProfile({
  name: "stock",
  args: Profiles.chromiumArgs.stock,
  prefs: Profiles.firefoxPrefs.stock
})

/**
 * First-run, sync and update prompts off; nothing a page can observe. The default.
 *
 * **Details**
 *
 * Firefox's JSON viewer is off too, so a JSON response's document is the JSON as served, as in Chromium and
 * WebKit, rather than the viewer's page; and Firefox opens a page's popups as windows, so the page keeps
 * rendering behind them.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const automation: LaunchProfile = new LaunchProfile({
  name: "automation",
  args: Profiles.chromiumArgs.automation,
  prefs: Profiles.firefoxPrefs.automation
})

/**
 * `automation`, plus background-timer and renderer throttling off, for many pages at once.
 *
 * **Gotchas**
 *
 * Pages can observe the difference, such as in timer cadence, so it is opt-in.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const concurrent: LaunchProfile = new LaunchProfile({
  name: "concurrent",
  args: Profiles.chromiumArgs.concurrent,
  prefs: Profiles.firefoxPrefs.concurrent
})
