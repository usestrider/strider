/**
 * The Firefox backend (`@usestrider/browser/firefox`): Firefox over WebDriver BiDi.
 *
 * A launch runs the executable it names, and nothing is looked up or downloaded: `strider browsers` lists the
 * browsers it can find. Protocol failures carry the BiDi error under `metadata.bidi`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import type * as Layer from "effect/Layer"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import type * as Socket from "effect/socket/Socket"
import type * as Browser from "../Browser.ts"
import * as BidiAdapter from "../internal/bidiAdapter.ts"
import * as BrowserImpl from "../internal/browser.ts"
import * as Connect from "../internal/connect.ts"
import * as FirefoxLauncher from "../internal/firefoxLauncher.ts"
import * as LaunchOptions from "../internal/launchOptions.ts"
import type * as Url from "../Url.ts"

declare module "../Reason.ts" {
  // WebDriver BiDi detail for a BackendFailure
  interface BackendMetadata {
    readonly bidi?: { readonly error: string; readonly message: string; readonly stacktrace: string | null } | null
  }
}

/**
 * Launches the Firefox executable it names and provides it as `Browser`.
 *
 * **Details**
 *
 * The browser gets a temporary profile, created before it starts and deleted after it exits, unless
 * `userDataDir` names one you own. It exits when the layer's scope closes.
 *
 * **Example** (A headless browser for a program)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Browser } from "@usestrider/browser"
 * import { Firefox } from "@usestrider/browser/firefox"
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(Firefox.layer({ executablePath: "/usr/bin/firefox" })))
 * ```
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layer = (
  options: Browser.LaunchOptions
): Layer.Layer<
  Browser.Browser,
  Browser.BrowserError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Socket.WebSocketConstructor
> =>
  BrowserImpl.layer((sink) =>
    Effect.flatMap(
      FirefoxLauncher.launch(LaunchOptions.settings(options)),
      ({ transport }) => BidiAdapter.connect(transport, { sink, ownership: "launched" })
    )
  )

/**
 * Launches the Firefox executable it names with options read from configuration, such as the executable path
 * from each machine's environment.
 *
 * **Example** (The executable from each machine's environment)
 *
 * ```ts import.meta.vitest
 * import { Config, Effect } from "effect"
 * import { Browser } from "@usestrider/browser"
 * import { Firefox } from "@usestrider/browser/firefox"
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(Firefox.layerConfig({ executablePath: Config.String("FIREFOX_PATH") })))
 * ```
 *
 * @see {@link layer}
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layerConfig = (
  options: Config.Wrap<Browser.LaunchOptions>
): Layer.Layer<
  Browser.Browser,
  Browser.BrowserError | Config.ConfigError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Socket.WebSocketConstructor
> => LaunchOptions.fromConfig(options, layer)

/**
 * Connects to a running Firefox at `endpoint` and provides it as `Browser`. Pages and contexts that were already
 * open stay open after the layer's scope closes.
 *
 * **Details**
 *
 * `endpoint` is Firefox's remote agent, as `--remote-debugging-port` starts it (`ws://127.0.0.1:9222`); `/session`
 * is added when the URL has no path. The connection starts a WebDriver BiDi session and ends it when the layer's
 * scope closes.
 *
 * **Gotchas**
 *
 * Firefox allows one session at a time, and keeps a session after its connection closes until something ends it:
 * a connect while another client holds it fails with `ConnectionFailed`. An attached session leaves file choosers
 * to the browser, since its prompt settings are the whole browser's.
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layerConnect = (
  endpoint: Url.Url | string,
  options?: Browser.ConnectOptions | undefined
): Layer.Layer<Browser.Browser, Browser.BrowserError, Socket.WebSocketConstructor> =>
  BrowserImpl.layer((sink) =>
    Effect.gen(function*() {
      const url = yield* Connect.firefoxWebSocket(endpoint)
      const transport = yield* Connect.webSocket(url, options)
      return yield* BidiAdapter.connect(transport, { sink, ownership: "attached" })
    })
  )
