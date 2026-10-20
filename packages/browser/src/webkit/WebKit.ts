/**
 * The WebKit backend (`@usestrider/browser/webkit`): Playwright-patched WebKit builds, launched, and stock WebKit
 * targets, attached.
 *
 * Protocol failures carry the inspector error under `metadata.webkit`.
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
 * Launches a Playwright-patched WebKit build and provides it as `Browser`.
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
 * })).pipe(Effect.provide(WebKit.layer({ headless: true })))
 * ```
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export declare const layer: (
  options?: Browser.LaunchOptions | undefined
) => Layer.Layer<Browser.Browser, Browser.BrowserError, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem>

/**
 * Launches a Playwright-patched WebKit build with options read from configuration, such as the executable path from CI's
 * environment.
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
