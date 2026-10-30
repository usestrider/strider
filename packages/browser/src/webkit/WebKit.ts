/**
 * The WebKit backend: stock WebKitGTK and WPE, launched in automation mode or attached through their inspector.
 *
 * A launch runs the MiniBrowser you name, and nothing is looked up or downloaded; `strider browsers` lists the ones
 * it can find. Strider drives the MiniBrowser through its inspector server's socket, with WebKit's Automation
 * protocol and its inspector protocol, both generated from WebKitGTK's source
 * (`@usestrider/browser/webkit-automation-protocol` and `/webkit-stock-protocol`). An attach reaches a running
 * browser's inspector server over HTTP. A protocol failure's `BackendFailure` carries the `ProtocolError` as its
 * `cause`, with the browser's own code and message.
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
import type * as Socket from "effect/socket/Socket"
import type * as Browser from "../Browser.ts"
import * as BrowserImpl from "../internal/browser.ts"
import * as Connect from "../internal/connect.ts"
import * as LaunchOptions from "../internal/launchOptions.ts"
import * as WebKitAdapter from "../internal/webkitAdapter.ts"
import * as WebKitAutomation from "../internal/webkitAutomation.ts"
import type * as SocketConnector from "../protocol/SocketConnector.ts"
import type * as Url from "../Url.ts"

declare module "../Reason.ts" {
  // WebKit inspector detail for a BackendFailure
  interface BackendMetadata {
    readonly webkit?: { readonly code: number; readonly message: string } | null
  }
}

/**
 * Launches WebKitGTK's or WPE's MiniBrowser in automation mode and provides it as `Browser`.
 *
 * **Details**
 *
 * An executable not named `MiniBrowser` fails with `InvalidInput`. The layer starts it with the platform's
 * `ChildProcessSpawner` and `FileSystem`, which `NodeServices.layer` from `@effect/platform-node` provides. The
 * browser's inspector server listens on a free local port, which Strider reaches through the `SocketConnector` in
 * context: provide one with `SocketConnector.layer` (`@usestrider/browser/protocol`). Each context is a browser
 * process of its own, with an ephemeral profile; the default context's process holds the browser's first tab. The
 * window opens on the display that `DISPLAY` or `WAYLAND_DISPLAY` names. The browser exits when the layer's scope
 * closes.
 *
 * **Gotchas**
 *
 * - WebKitGTK has no headless mode: `headless: true` fails with `InvalidInput`. Give it a display, such as Xvfb's.
 * - Stock WebKit has no isolated worlds: `evaluate` fails with `Unsupported`, so use `evaluateInMainWorld`. The
 *   locator engine and init scripts run in the page's own world, where its scripts can see them.
 * - Every dialog is an `Unknown` one, with its message: stock WebKit doesn't say which kind it is.
 * - A page another page opens has no opener, so `Popup.next` fails with `Unsupported`; find the page in the
 *   context's `pages`.
 * - A context's cookie list is the cookies its open pages are sent, and a host-only cookie is set as a domain
 *   cookie.
 * - Each new context starts a browser process, which takes about 0.6 seconds.
 * - History traversal, the locale, time zone and user agent, a mobile viewport, touch, keyboard layouts,
 *   permissions, downloads, file choosers (`setInputFiles` works), screencasts, PDFs and JPEG screenshots fail
 *   with `Unsupported`. `Browser.capabilities` lists what it offers.
 * - Linux only: WebKitGTK and WPE are the stock WebKit ports with an automation mode.
 * - A MiniBrowser from Nix needs `glib-networking`'s modules on `GIO_EXTRA_MODULES` for HTTPS, which otherwise
 *   fails with "TLS support is not available"; other distributions install them where GIO looks.
 *
 * **Example** (Launching WebKitGTK's MiniBrowser)
 *
 * ```ts import.meta.vitest
 * import { NodeServices, NodeSocket } from "@effect/platform-node"
 * import { Browser } from "@usestrider/browser"
 * import { SocketConnector } from "@usestrider/browser/protocol"
 * import { WebKit } from "@usestrider/browser/webkit"
 * import { Effect, Layer } from "effect"
 *
 * const Sockets = SocketConnector.layer((endpoint) =>
 *   NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port })
 * )
 *
 * const WebKitLive = WebKit.layer({
 *   executablePath: "/usr/libexec/webkitgtk-6.0/MiniBrowser"
 * }).pipe(Layer.provide([NodeServices.layer, Sockets]))
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(WebKitLive))
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
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | SocketConnector.SocketConnector
> =>
  BrowserImpl.layer((sink) =>
    // A browser process per context
    Effect.flatMap(
      WebKitAutomation.start(LaunchOptions.settings(options)),
      (group) => WebKitAdapter.connect(group.transport, { sink, ownership: "launched", automation: group })
    )
  )

/**
 * Launches the MiniBrowser as `layer` does, with options read from configuration, such as the executable path from
 * each machine's environment.
 *
 * **Example** (Reading the executable's path from the environment)
 *
 * ```ts import.meta.vitest
 * import { NodeServices, NodeSocket } from "@effect/platform-node"
 * import { Browser } from "@usestrider/browser"
 * import { SocketConnector } from "@usestrider/browser/protocol"
 * import { WebKit } from "@usestrider/browser/webkit"
 * import { Config, Effect, Layer } from "effect"
 *
 * const Sockets = SocketConnector.layer((endpoint) =>
 *   NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port })
 * )
 *
 * const WebKitLive = WebKit.layerConfig({
 *   executablePath: Config.String("WEBKIT_PATH")
 * }).pipe(Layer.provide([NodeServices.layer, Sockets]))
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(WebKitLive))
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
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | SocketConnector.SocketConnector
> => LaunchOptions.fromConfig(options, layer)

/**
 * Attaches to a running WebKitGTK or WPE browser through its remote inspector and provides it as `Browser`.
 *
 * **Details**
 *
 * Start the browser with `WEBKIT_INSPECTOR_HTTP_SERVER=host:port`. `endpoint` is that server's HTTP endpoint
 * (`http://127.0.0.1:9333`), whose list names a WebSocket for each page; Strider reads the list again every 250 ms
 * for new pages. `options.headers` go with the HTTP requests and the WebSocket handshakes. The pages are observed in
 * one default context: `browser.pages` lists them, and `inspect` and `control` give access to one for a scope. They
 * stay open after the layer's scope closes. The connection needs a `WebSocketConstructor`, such as
 * `NodeSocket.layerWebSocketConstructor` from `@effect/platform-node`.
 *
 * **Gotchas**
 *
 * - The inspector can look but not drive: it has no input, dialogs, emulation, isolated worlds or browser session.
 *   `newContext`, `newPage`, clicks, typing, dialog handling and `evaluate` fail with `Unsupported`;
 *   `evaluateInMainWorld` runs in the page's world. `Browser.capabilities` lists what it offers.
 * - The locator engine and init scripts run in the page's own world, where its scripts can see them.
 * - `goto` navigates by setting `location.href`, and fails with `Unsupported` for a fragment of the current
 *   document. Stock WebKit reports no same-document navigation, so `page.url` doesn't follow `history.pushState`
 *   either.
 * - After a failed load, the failed navigation's document is the browser's error page, at `about:blank`.
 * - `screenshot` writes PNG only.
 * - An `alert` the page opens stops its scripts, unreported, until a person dismisses it.
 * - Safari's inspector, and proxies to it such as ios-webkit-debug-proxy, list their pages in a format Strider
 *   doesn't read.
 *
 * **Example** (Inspecting a page of a browser started with `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9333`)
 *
 * ```ts import.meta.vitest
 * import { NodeSocket } from "@effect/platform-node"
 * import { Browser } from "@usestrider/browser"
 * import { WebKit } from "@usestrider/browser/webkit"
 * import { Effect, Layer } from "effect"
 *
 * const Device = WebKit.layerAttach("http://127.0.0.1:9333").pipe(
 *   Layer.provide(NodeSocket.layerWebSocketConstructor)
 * )
 *
 * const firstHeading = Effect.scoped(Effect.gen(function*() {
 *   const [first] = yield* (yield* Browser.Browser).pages
 *   const page = yield* first!.inspect
 *   return yield* page.getByRole("heading").readText
 * })).pipe(Effect.provide(Device))
 * ```
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layerAttach = (
  endpoint: Url.Url | string,
  options?: Browser.ConnectOptions | undefined
): Layer.Layer<Browser.Browser, Browser.BrowserError, Socket.WebSocketConstructor> =>
  BrowserImpl.layer((sink) =>
    Effect.flatMap(
      Connect.webkitInspector(endpoint, options).pipe(Effect.provide(FetchHttpClient.layer)),
      (transport) => WebKitAdapter.connect(transport, { sink, ownership: "attached" })
    )
  )
