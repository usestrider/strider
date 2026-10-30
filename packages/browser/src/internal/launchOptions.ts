/**
 * The public launch options, as each launcher takes them (`Browser.LaunchOptions`).
 */
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Browser from "../Browser.ts"

/** What every launcher takes from `Browser.LaunchOptions`. */
export const settings = (options: Browser.LaunchOptions) => ({
  executablePath: options.executablePath,
  headless: options.headless,
  args: options.args,
  profile: options.profile?.name,
  profileArgs: options.profile?.args,
  profilePrefs: options.profile?.prefs,
  userDataDir: options.userDataDir,
  coreDumps: options.coreDumps
})

/** A backend's `layerConfig`: its `layer`, with the options read from configuration. */
export const fromConfig = <E, R>(
  options: Config.Wrap<Browser.LaunchOptions>,
  layer: (options: Browser.LaunchOptions) => Layer.Layer<Browser.Browser, E, R>
): Layer.Layer<Browser.Browser, E | Config.ConfigError, R> => Layer.unwrap(Effect.map(Config.unwrap(options), layer))
