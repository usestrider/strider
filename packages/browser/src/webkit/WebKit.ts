/**
 * The WebKit backend (`@usestrider/browser/webkit`): Playwright-patched WebKit builds, launched, and stock WebKit
 * targets, attached.
 *
 * A launch runs the build's executable it names, and nothing is looked up or downloaded: `strider browsers` lists
 * the builds it can find, in Playwright's browser cache among other places. The build must be the one the adapter
 * is generated from, which the launch checks by its `protocol.json`. Protocol failures carry the inspector error
 * under `metadata.webkit`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Config from "effect/Config"
import type * as FileSystem from "effect/FileSystem"
import type * as Layer from "effect/Layer"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import type * as Socket from "effect/socket/Socket"
import type * as Browser from "../Browser.ts"
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
export declare const layer: (
  options: Browser.LaunchOptions
) => Layer.Layer<Browser.Browser, Browser.BrowserError, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem>

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
export declare const layerConfig: (
  options: Config.Wrap<Browser.LaunchOptions>
) => Layer.Layer<
  Browser.Browser,
  Browser.BrowserError | Config.ConfigError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
>

/**
 * Attaches to a stock WebKit target, such as Safari on iOS or a WKWebView, through its remote inspector.
 *
 * **Gotchas**
 *
 * Stock WebKit exposes less than a patched build, so more operations fail with `Unsupported`.
 * `Browser.capabilities` lists what this one offers.
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export declare const layerAttach: (
  endpoint: Url.Url | string,
  options?: Browser.ConnectOptions | undefined
) => Layer.Layer<Browser.Browser, Browser.BrowserError, Socket.WebSocketConstructor>
