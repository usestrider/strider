/**
 * The Firefox backend (`@usestrider/browser/firefox`): Firefox over WebDriver BiDi.
 *
 * Protocol failures carry the BiDi error under `metadata.bidi`.
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
  // WebDriver BiDi detail for a BackendFailure
  interface BackendMetadata {
    readonly bidi?: { readonly error: string; readonly message: string; readonly stacktrace: string | null } | null
  }
}

/**
 * Launches Firefox and provides it as `Browser`.
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
 * })).pipe(Effect.provide(Firefox.layer({ headless: true })))
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
 * Launches Firefox with options read from configuration, such as the executable path from CI's
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
 * Connects to a running browser at `endpoint` and provides it as `Browser`. Pages and contexts that were
 * already open stay open after the layer's scope closes.
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export declare const layerConnect: (
  endpoint: Url.Url | string,
  options?: Browser.ConnectOptions | undefined
) => Layer.Layer<Browser.Browser, Browser.BrowserError, Socket.WebSocketConstructor>
