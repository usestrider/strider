/**
 * The flags and preferences a browser is launched with, as values you can inspect.
 *
 * A profile is never a hidden flag: it's a value whose `args` and `prefs` you can read, and a launch's span records
 * which profile it used. `args` are Chromium's switches and `prefs` Firefox's preferences; WebKit takes neither. No
 * profile turns off the back/forward cache, third-party storage partitioning, or popup blocking, because Strider
 * handles each of those itself.
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
 * The default settings for browser automation.
 *
 * **Details**
 *
 * - Chromium enables CDPScreenshotNewSurface to request a repaint on a new surface for captures. Capturing can
 *   drive rendering and is not guaranteed to be unobservable to the page.
 * - Chromium hides infobars. Chrome for Testing otherwise adds one to each new window shortly after it opens, which
 *   shrinks the page area.
 * - Firefox's JSON viewer is off, which a page can tell: a JSON response's document is the JSON as served, as in
 *   Chromium and WebKit, not the viewer's page.
 * - Firefox opens popups as windows, so the page that opened one keeps rendering behind it.
 *
 * **Example** (Launching Chromium with the default profile named)
 *
 * ```ts import.meta.vitest
 * import { NodeServices } from "@effect/platform-node"
 * import { LaunchProfile } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { Layer } from "effect"
 *
 * const browser = Chromium.layer({
 *   executablePath: "/usr/bin/chromium",
 *   profile: LaunchProfile.automation
 * }).pipe(Layer.provide(NodeServices.layer))
 * ```
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
 * Pages can observe the difference, such as in timer cadence.
 *
 * **Example** (Launching Chromium for many pages at once)
 *
 * ```ts import.meta.vitest
 * import { NodeServices } from "@effect/platform-node"
 * import { LaunchProfile } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { Layer } from "effect"
 *
 * const browser = Chromium.layer({
 *   executablePath: "/usr/bin/chromium",
 *   profile: LaunchProfile.concurrent
 * }).pipe(Layer.provide(NodeServices.layer))
 * ```
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
