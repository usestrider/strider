/**
 * The WebKit backend (`@usestrider/browser/webkit`): Playwright-patched WebKit builds, launched, and stock WebKit
 * targets, attached.
 *
 * A launch runs the build's executable it names, and nothing is looked up or downloaded: `strider browsers` lists
 * the builds it can find, in Playwright's browser cache among other places. The build must be the one the adapter
 * is generated from, which the launch checks by its `protocol.json`. An attach reaches WebKitGTK's or WPE's
 * inspector server, whose protocol is generated from WebKitGTK's own (`@usestrider/browser/webkit-stock-protocol`).
 * Protocol failures carry the inspector error under `metadata.webkit`.
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
import * as WebKitLauncher from "../internal/webkitLauncher.ts"
import type * as Url from "../Url.ts"

declare module "../Reason.ts" {
  // WebKit inspector detail for a BackendFailure
  interface BackendMetadata {
    readonly webkit?: { readonly code: number; readonly message: string } | null
  }
}

/**
 * Launches the Playwright-patched WebKit build whose executable it names (`pw_run.sh`, or `Playwright.exe` on
 * Windows) and provides it as `Browser`.
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
 * import { WebKit } from "@usestrider/browser/webkit"
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://example.com")
 * })).pipe(Effect.provide(WebKit.layer({ executablePath: "/home/me/.cache/ms-playwright/webkit-2359/pw_run.sh" })))
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
      WebKitLauncher.launch(LaunchOptions.settings(options)),
      ({ transport }) =>
        WebKitAdapter.connect(transport, { sink, ownership: "launched", revision: WebKitLauncher.build.revision })
    )
  )

/**
 * Launches the Playwright-patched WebKit build it names with options read from configuration, such as the
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
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
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
 * - After a failed load the browser shows its error page, `about:blank`, a navigation of its own.
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
      (transport) => WebKitAdapter.connect(transport, { sink, ownership: "attached", profile: "stock" })
    )
  )
