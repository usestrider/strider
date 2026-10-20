/**
 * Launch profiles: a browser's flags and preferences, as values you can inspect.
 *
 * A profile is never a hidden flag (rule 23). The arguments and preferences a launch actually used are
 * recorded in its span and trace. No profile turns off the back/forward cache, third-party storage
 * partitioning or popup blocking, because the model handles those explicitly.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

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
export declare const stock: LaunchProfile

/**
 * First-run, sync and update prompts off; nothing a page can observe. The default.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export declare const automation: LaunchProfile

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
export declare const concurrent: LaunchProfile
