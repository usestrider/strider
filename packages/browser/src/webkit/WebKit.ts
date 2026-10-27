/**
 * The WebKit backend (`@usestrider/browser/webkit`): stock WebKit, launched in automation mode or attached through
 * its inspector (reviews 22 and 23).
 *
 * A launch runs the executable it names, and nothing is looked up or downloaded. WebKitGTK's or WPE's MiniBrowser is
 * launched in automation mode and driven through its inspector server's socket, with WebKit's Automation protocol
 * and its inspector protocol, both generated from WebKitGTK's source (`@usestrider/browser/webkit-automation-protocol`,
 * `/webkit-stock-protocol`). An attach reaches an inspector server over HTTP. Protocol failures carry the inspector
 * error under `metadata.webkit`.
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
 * Launches stock WebKit and provides it as `Browser`: WebKitGTK's or WPE's MiniBrowser, in automation mode
 * (review 23). Another executable fails with `InvalidInput`.
 *
 * **Details**
 *
 * The MiniBrowser runs in automation mode, with its inspector server on a free port the program's
 * `SocketConnector` reaches (`@usestrider/browser/protocol`). Each context is a browser process of its own, with an
 * ephemeral profile, and the default context's process is the browser's first tab's. The window opens where
 * `DISPLAY` or `WAYLAND_DISPLAY` says. The browser exits when the layer's scope closes.
 *
 * **Gotchas**
 *
 * - WebKitGTK has no headless mode: `headless: true` fails with `InvalidInput`. Give it a display, such as Xvfb's.
 * - Stock WebKit has no isolated worlds: `evaluate` fails with `Unsupported`, and the engine and init scripts run
 *   in the page's own world, with `evaluateInMainWorld`.
 * - A dialog is `Dialog.Unknown`, with its message: stock WebKit doesn't say which kind it is.
 * - A page another page opens has no opener, so `Popup.next` fails with `Unsupported`; the page is in the context's
 *   `pages`.
 * - A context's cookie list is the cookies its open pages are sent, and a host's cookie is set as its domain's.
 * - A context costs a browser process, about 0.6 seconds to start.
 * - History traversal, the locale, time zone and user agent, a mobile viewport, touch, keyboard layouts,
 *   permissions, downloads, file choosers (`setInputFiles` works), screencasts and PDFs fail with `Unsupported`.
 *   `Browser.capabilities` lists what it offers.
 * - Stock WebKit with an automation mode is Linux's: WebKitGTK and WPE.
 * - A MiniBrowser from Nix needs `glib-networking`'s modules on `GIO_EXTRA_MODULES` for HTTPS, which otherwise
 *   fails with "TLS support is not available"; other distributions install them where GIO looks.
 *
 * **Example** (A MiniBrowser for a program, with its platform's sockets)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer } from "effect"
 * import { Browser } from "@usestrider/browser"
 * import type { SocketConnector } from "@usestrider/browser/protocol"
 * import { WebKit } from "@usestrider/browser/webkit"
 *
 * // Such as SocketConnector.layer((endpoint) => NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port }))
 * declare const sockets: Layer.Layer<SocketConnector.SocketConnector>
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(
 *   WebKit.layer({ executablePath: "/usr/libexec/webkitgtk-6.0/MiniBrowser" }).pipe(Layer.provide(sockets))
 * ))
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
    // A browser process per context (review 23)
    Effect.flatMap(
      WebKitAutomation.start(LaunchOptions.settings(options)),
      (group) => WebKitAdapter.connect(group.transport, { sink, ownership: "launched", automation: group })
    )
  )

/**
 * Launches the WebKit it names with options read from configuration, such as the
 * executable path from each machine's environment.
 *
 * **Example** (The executable from each machine's environment)
 *
 * ```ts import.meta.vitest
 * import { Config, Effect } from "effect"
 * import { Browser } from "@usestrider/browser"
 * import { WebKit } from "@usestrider/browser/webkit"
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(WebKit.layerConfig({ executablePath: Config.String("WEBKIT_PATH") })))
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
 * Attaches to stock WebKit, a WebKitGTK or WPE browser started with `WEBKIT_INSPECTOR_HTTP_SERVER`, through its
 * remote inspector, and provides it as `Browser`. The pages stay open after the layer's scope closes.
 *
 * **Details**
 *
 * `endpoint` is the inspector server's HTTP endpoint (`http://127.0.0.1:9333`), whose list names a WebSocket for
 * each page; the list is read again every 250 ms for pages that arrive. `options.headers` go with the requests and
 * the handshakes. The pages are observed in one default context: `browser.pages` lists them, and `inspect` and
 * `control` gain access to one for a scope.
 *
 * **Gotchas**
 *
 * - Stock WebKit's inspector is for looking, not driving: it has no input, prompts, emulation, isolated worlds or
 *   browser session, so `newContext`, `newPage`, clicks, typing and dialogs fail with `Unsupported`, and
 *   `evaluate` too: `evaluateInMainWorld` runs in the page's world. `Browser.capabilities` lists what it offers.
 * - The locator engine and init scripts run in the page's own world, where its scripts can see them.
 * - `goto` navigates by script, `location.href`, and refuses a fragment of the document shown: stock WebKit
 *   reports no same-document navigation, so `page.url` doesn't follow `history.pushState` either.
 * - After a failed load the browser shows its error page, `about:blank`, as the failed navigation's document.
 * - `screenshot` takes PNG only.
 * - An `alert` the page opens stops its scripts, unreported, until a person dismisses it.
 * - Safari's own inspector, and proxies to it such as ios-webkit-debug-proxy, list their pages another way, which
 *   isn't read.
 *
 * **Example** (Inspecting a page of a browser started with `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9333`)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Browser } from "@usestrider/browser"
 * import { WebKit } from "@usestrider/browser/webkit"
 *
 * const firstHeading = Effect.scoped(Effect.gen(function*() {
 *   const [first] = yield* (yield* Browser.Browser).pages
 *   const page = yield* first!.inspect
 *   return yield* page.getByRole("heading").readText
 * })).pipe(Effect.provide(WebKit.layerAttach("http://127.0.0.1:9333")))
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
      Connect.webkitInspector(endpoint, options),
      (transport) => WebKitAdapter.connect(transport, { sink, ownership: "attached" })
    )
  )
