/**
 * The generic BiDi backend (`@usestrider/browser/bidi`): any WebDriver BiDi endpoint, such as Safari Technology
 * Preview or a remote grid.
 *
 * Protocol failures carry the BiDi error under `metadata.bidi`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type * as Socket from "effect/socket/Socket"
import type * as Browser from "../Browser.ts"
import * as BidiAdapter from "../internal/bidiAdapter.ts"
import * as BrowserImpl from "../internal/browser.ts"
import * as Connect from "../internal/connect.ts"
import type * as Url from "../Url.ts"

declare module "../Reason.ts" {
  // WebDriver BiDi detail for a BackendFailure
  interface BackendMetadata {
    readonly bidi?: { readonly error: string; readonly message: string; readonly stacktrace: string | null } | null
  }
}

/**
 * Connects to a WebDriver BiDi endpoint and provides it as `Browser`.
 *
 * **Details**
 *
 * `endpoint` is taken as given, such as a grid's session URL. The connection starts a session and ends it when the
 * layer's scope closes; the pages that were open are observed, as an attached browser's are.
 *
 * **Example** (A browser on a remote grid)
 *
 * ```ts import.meta.vitest
 * import { Config, Effect } from "effect"
 * import { Browser } from "@usestrider/browser"
 * import { Bidi } from "@usestrider/browser/bidi"
 *
 * const program = Effect.gen(function*() {
 *   const token = yield* Config.Redacted("GRID_TOKEN")
 *   const page = yield* Effect.scoped(Browser.newPage()).pipe(
 *     Effect.provide(Bidi.layerConnect("wss://grid.example.com/session", { headers: { authorization: token } }))
 *   )
 *   return page.id
 * })
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
      const url = yield* Connect.bidiWebSocket(endpoint)
      const transport = yield* Connect.webSocket(url, options)
      return yield* BidiAdapter.connect(transport, { sink, ownership: "attached" })
    })
  )
