/**
 * The Chromium backend (`@usestrider/browser/chromium`): Chromium, Chrome and Edge over the Chrome DevTools
 * Protocol.
 *
 * A launch runs the executable it names, and nothing is looked up or downloaded: `strider browsers` lists the
 * browsers it can find. Protocol failures carry the CDP error under `metadata.cdp`.
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
import * as BrowserImpl from "../internal/browser.ts"
import * as CdpAdapter from "../internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../internal/chromiumLauncher.ts"
import * as Connect from "../internal/connect.ts"
import * as LaunchOptions from "../internal/launchOptions.ts"
import type * as Url from "../Url.ts"

declare module "../Reason.ts" {
  // CDP detail for a BackendFailure
  interface BackendMetadata {
    readonly cdp?: { readonly code: number; readonly message: string; readonly data: string | null } | null
  }
}

/**
 * Launches the Chromium, Chrome or Edge executable it names and provides it as `Browser`.
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
 * import { Chromium } from "@usestrider/browser/chromium"
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(Chromium.layer({ executablePath: "/usr/bin/chromium" })))
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
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  BrowserImpl.layer((sink) =>
    Effect.flatMap(
      ChromiumLauncher.launch(LaunchOptions.settings(options)),
      ({ transport }) => CdpAdapter.connect(transport, { sink, ownership: "launched" })
    )
  )

/**
 * Launches the Chromium, Chrome or Edge executable it names with options read from configuration, such as the
 * executable path from each machine's environment.
 *
 * **Example** (The executable from each machine's environment)
 *
 * ```ts import.meta.vitest
 * import { Config, Effect } from "effect"
 * import { Browser } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(Chromium.layerConfig({ executablePath: Config.String("CHROMIUM_PATH") })))
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
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> => LaunchOptions.fromConfig(options, layer)

/**
 * Connects to a running Chromium, Chrome or Edge at `endpoint` and provides it as `Browser`. Pages and contexts that
 * were already open stay open after the layer's scope closes.
 *
 * **Details**
 *
 * `endpoint` is the browser's WebSocket (`ws://127.0.0.1:9222/devtools/browser/…`), or its HTTP endpoint
 * (`http://127.0.0.1:9222`), whose `/json/version` names the WebSocket. The pages that were open are observed:
 * `browser.pages` lists them, and `inspect` and `control` gain access to one for a scope. `options.headers` go with
 * the handshake and the lookup.
 *
 * **Example** (Inspecting a tab of a browser started with `--remote-debugging-port=9222`)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Browser } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 *
 * const firstHeading = Effect.scoped(Effect.gen(function*() {
 *   const [first] = yield* (yield* Browser.Browser).pages
 *   const page = yield* first!.inspect
 *   return yield* page.getByRole("heading").readText
 * })).pipe(Effect.provide(Chromium.layerConnect("http://127.0.0.1:9222")))
 * ```
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
      const url = yield* Connect.chromiumWebSocket(endpoint, options)
      const transport = yield* Connect.webSocket(url, options)
      return yield* CdpAdapter.connect(transport, { sink, ownership: "attached" })
    })
  )
