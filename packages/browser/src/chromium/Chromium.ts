/**
 * The Chromium backend: Chromium, Chrome, and Edge, over the Chrome DevTools Protocol.
 *
 * A launch runs the executable you name, and nothing is looked up or downloaded; `strider browsers` lists the
 * browsers it can find. A protocol failure's `BackendFailure` carries the CDP error as its `cause`: the
 * `ProtocolError`, with the browser's own code and message.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import type * as Layer from "effect/Layer"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Socket from "effect/socket/Socket"
import type * as Browser from "../Browser.ts"
import * as Adapter from "../internal/adapter.ts"
import * as BrowserImpl from "../internal/browser.ts"
import * as CdpAdapter from "../internal/cdpAdapter.ts"
import * as ChromiumIdentity from "../internal/chromiumIdentity.ts"
import * as ChromiumLauncher from "../internal/chromiumLauncher.ts"
import * as Connect from "../internal/connect.ts"
import * as LaunchOptions from "../internal/launchOptions.ts"
import * as CdpConnection from "../protocol/CdpConnection.ts"
import * as Protocol from "../protocol/Protocol.ts"
import type * as Url from "../Url.ts"

/**
 * Launches the Chromium, Chrome, or Edge executable at `executablePath` and provides it as `Browser`.
 *
 * **Details**
 *
 * The browser gets a temporary profile, created before it starts and deleted after it exits, unless
 * `userDataDir` names one you own. It exits when the layer's scope closes. The layer starts it with the platform's
 * `ChildProcessSpawner` and `FileSystem`, which `NodeServices.layer` from `@effect/platform-node` provides.
 *
 * The browser starts with core dumps off, so a renderer that crashes exits at once and the page is reported as
 * crashed without waiting for the host to write a core. `coreDumps: true` leaves the limit as the host sets it.
 *
 * **Example** (Keeping core dumps to debug a crash)
 *
 * ```ts import.meta.vitest
 * import { NodeServices } from "@effect/platform-node"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { Layer } from "effect"
 *
 * const ChromiumLive = Chromium.layer({
 *   executablePath: "/usr/bin/chromium",
 *   coreDumps: true
 * }).pipe(
 *   Layer.provide(NodeServices.layer)
 * )
 * ```
 *
 * **Example** (Launching headless Chromium)
 *
 * ```ts import.meta.vitest
 * import { NodeServices } from "@effect/platform-node"
 * import { Browser } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { Effect, Layer } from "effect"
 *
 * const ChromiumLive = Chromium.layer({ executablePath: "/usr/bin/chromium" }).pipe(
 *   Layer.provide(NodeServices.layer)
 * )
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(ChromiumLive))
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
 * Launches Chromium, Chrome, or Edge as `layer` does, with options read from configuration, such as the
 * executable path from each machine's environment.
 *
 * **Example** (Reading the executable's path from the environment)
 *
 * ```ts import.meta.vitest
 * import { NodeServices } from "@effect/platform-node"
 * import { Browser } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { Config, Effect, Layer } from "effect"
 *
 * const ChromiumLive = Chromium.layerConfig({
 *   executablePath: Config.String("CHROMIUM_PATH")
 * }).pipe(Layer.provide(NodeServices.layer))
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(ChromiumLive))
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
 * Connects to a running Chromium, Chrome, or Edge at `endpoint` and provides it as `Browser`.
 *
 * **Details**
 *
 * `endpoint` is the browser's WebSocket (`ws://127.0.0.1:9222/devtools/browser/…`), or its HTTP endpoint
 * (`http://127.0.0.1:9222`), whose `/json/version` names the WebSocket. The pages that were open are observed:
 * `browser.pages` lists them, and `inspect` and `control` give access to one for a scope. `options.headers` go with
 * the handshake and the lookup. Pages and contexts that were already open stay open after the layer's scope closes.
 * The connection needs a `WebSocketConstructor`, such as `NodeSocket.layerWebSocketConstructor` from
 * `@effect/platform-node`.
 *
 * **Example** (Inspecting a tab of a browser started with `--remote-debugging-port=9222`)
 *
 * ```ts import.meta.vitest
 * import { NodeSocket } from "@effect/platform-node"
 * import { Browser } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { Effect, Layer } from "effect"
 *
 * const Attached = Chromium.layerConnect("http://127.0.0.1:9222").pipe(
 *   Layer.provide(NodeSocket.layerWebSocketConstructor)
 * )
 *
 * const firstHeading = Effect.scoped(Effect.gen(function*() {
 *   const [first] = yield* (yield* Browser.Browser).pages
 *   const page = yield* first!.inspect
 *   return yield* page.getByRole("heading").readText
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
      const url = yield* Connect.chromiumWebSocket(endpoint, options).pipe(Effect.provide(FetchHttpClient.layer))
      const transport = yield* Connect.webSocket(url, options)
      const sockets = yield* Socket.WebSocketConstructor
      const claimClient = Connect.webSocket(url, options).pipe(
        Effect.flatMap(CdpConnection.make),
        Effect.provideService(Socket.WebSocketConstructor, sockets),
        Effect.mapError((error) =>
          Adapter.protocolError(
            new Protocol.ProtocolError({
              reason: new Protocol.Rejected({
                method: "claims.connect",
                reason: "Unrecognized",
                code: "connection",
                description: error.message
              })
            })
          )
        )
      )
      return yield* CdpAdapter.connect(transport, {
        claimClient,
        sink,
        ownership: "attached",
        browserIdentity: ChromiumIdentity.fromWebSocket(url)
      })
    })
  )
