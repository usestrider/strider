/**
 * The Firefox backend: Firefox, over WebDriver BiDi.
 *
 * A launch runs the executable you name, and nothing is looked up or downloaded; `strider browsers` lists the
 * browsers it can find. A protocol failure's `BackendFailure` carries the WebDriver BiDi error as its `cause`: the
 * `ProtocolError`, with the browser's own code and message.
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

/**
 * Launches the Firefox executable at `executablePath` and provides it as `Browser`.
 *
 * **Details**
 *
 * The browser gets a temporary profile, created before it starts and deleted after it exits, unless
 * `userDataDir` names one you own. It exits when the layer's scope closes. The layer starts it with the platform's
 * `ChildProcessSpawner` and `FileSystem`, which `NodeServices.layer` from `@effect/platform-node` provides, and
 * reaches it with a `WebSocketConstructor`, such as `NodeSocket.layerWebSocketConstructor`.
 *
 * **Example** (Launching headless Firefox)
 *
 * ```ts import.meta.vitest
 * import { NodeServices, NodeSocket } from "@effect/platform-node"
 * import { Browser } from "@usestrider/browser"
 * import { Firefox } from "@usestrider/browser/firefox"
 * import { Effect, Layer } from "effect"
 *
 * const FirefoxLive = Firefox.layer({ executablePath: "/usr/bin/firefox" }).pipe(
 *   Layer.provide([NodeServices.layer, NodeSocket.layerWebSocketConstructor])
 * )
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(FirefoxLive))
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
 * Launches Firefox as `layer` does, with options read from configuration, such as the executable path from each
 * machine's environment.
 *
 * **Example** (Reading the executable's path from the environment)
 *
 * ```ts import.meta.vitest
 * import { NodeServices, NodeSocket } from "@effect/platform-node"
 * import { Browser } from "@usestrider/browser"
 * import { Firefox } from "@usestrider/browser/firefox"
 * import { Config, Effect, Layer } from "effect"
 *
 * const FirefoxLive = Firefox.layerConfig({
 *   executablePath: Config.String("FIREFOX_PATH")
 * }).pipe(Layer.provide([NodeServices.layer, NodeSocket.layerWebSocketConstructor]))
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(FirefoxLive))
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
 * Connects to a running Firefox at `endpoint` and provides it as `Browser`.
 *
 * **Details**
 *
 * `endpoint` is Firefox's remote agent, as `--remote-debugging-port` starts it (`ws://127.0.0.1:9222`); `/session`
 * is added when the URL has no path. The connection starts a WebDriver BiDi session and ends it when the layer's
 * scope closes. Pages and contexts that were already open stay open. The connection needs a `WebSocketConstructor`,
 * such as `NodeSocket.layerWebSocketConstructor` from `@effect/platform-node`.
 *
 * **Gotchas**
 *
 * - Firefox allows one session at a time, and keeps a session after its connection closes until something ends
 *   it: a connect while another client holds one fails with `ConnectionFailed`.
 * - An attached session leaves file choosers to the browser, because a session's prompt settings apply to the
 *   whole browser.
 *
 * **Example** (Driving a Firefox started with `--remote-debugging-port=9222`)
 *
 * ```ts import.meta.vitest
 * import { NodeSocket } from "@effect/platform-node"
 * import { Browser } from "@usestrider/browser"
 * import { Firefox } from "@usestrider/browser/firefox"
 * import { Effect, Layer } from "effect"
 *
 * const Attached = Firefox.layerConnect("ws://127.0.0.1:9222").pipe(
 *   Layer.provide(NodeSocket.layerWebSocketConstructor)
 * )
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://shop.example.com")
 *   return yield* page.title
 * })).pipe(Effect.provide(Attached))
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
      const url = yield* Connect.firefoxWebSocket(endpoint)
      const transport = yield* Connect.webSocket(url, options)
      return yield* BidiAdapter.connect(transport, { sink, ownership: "attached" })
    })
  )
