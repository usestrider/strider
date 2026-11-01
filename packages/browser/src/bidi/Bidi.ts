/**
 * The generic WebDriver BiDi backend: connects to any BiDi endpoint, such as Safari Technology Preview or a remote
 * grid.
 *
 * A protocol failure's `BackendFailure` carries the WebDriver BiDi error as its `cause`: the `ProtocolError`, with
 * the browser's own code and message.
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

/**
 * Connects to a WebDriver BiDi endpoint and provides it as `Browser`.
 *
 * **Details**
 *
 * `endpoint` is taken as given, such as a grid's session URL. The connection starts a session and ends it when the
 * layer's scope closes; the pages that were open are observed, as an attached browser's are. The connection needs a
 * `WebSocketConstructor`, such as `NodeSocket.layerWebSocketConstructor` from `@effect/platform-node`.
 *
 * **Example** (Connecting to a remote grid)
 *
 * ```ts import.meta.vitest
 * import { NodeSocket } from "@effect/platform-node"
 * import { Browser } from "@usestrider/browser"
 * import { Bidi } from "@usestrider/browser/bidi"
 * import { Config, Effect, Layer } from "effect"
 *
 * const program = Effect.gen(function*() {
 *   const token = yield* Config.Redacted("GRID_TOKEN")
 *   const grid = Bidi.layerConnect("wss://grid.example.com/session", {
 *     headers: { authorization: token }
 *   }).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor))
 *   return yield* Effect.scoped(Effect.gen(function*() {
 *     const page = yield* Browser.newPage()
 *     yield* page.goto("https://shop.example.com")
 *     return yield* page.title
 *   })).pipe(Effect.provide(grid))
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
