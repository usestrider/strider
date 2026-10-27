/**
 * Opens scoped socket connections to endpoints known only at run time, such as the inspector server of a
 * MiniBrowser that `WebKit.layer` launched.
 *
 * **Details**
 *
 * Provisional: it has the shape of Effect's proposed `effect/socket/SocketConnector` (Effect-TS/effect#8735), which
 * replaces it once Effect releases it. Provide it from your platform's sockets with `layer`, such as
 * `@effect/platform-node`'s `NodeSocket.makeNet`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import type * as Socket from "effect/socket/Socket"

/**
 * Where a connection goes: a host and port, with TLS when asked.
 *
 * **Details**
 *
 * Strider sets `host` and `port` alone, to reach a local inspector server. The other fields follow Effect's
 * proposed `SocketConnector`, for a connector that passes them on to its platform; one that maps an endpoint to
 * `NodeSocket.makeNet({ host, port })` leaves them out.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Endpoint {
  /**
   * The host to connect to.
   */
  readonly host: string
  /**
   * The port to connect to.
   */
  readonly port: number
  /**
   * A path, for a platform whose sockets take one, such as a Unix socket's.
   *
   * @default none
   */
  readonly path?: string | undefined
  /**
   * Whether to connect with TLS, and with what settings.
   *
   * @default false
   */
  readonly tls?: boolean | TlsOptions | undefined
  /**
   * How long connecting may take.
   *
   * @default the platform's
   */
  readonly connectTimeout?: Duration.Input | undefined
}

/**
 * TLS settings for a connection.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type TlsOptions = Socket.TlsUpgradeOptions

/**
 * One connection: its reader and writer, and `close`, which ends it.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Connection extends Socket.Reader, Socket.Writer {
  /**
   * Ends the connection before its scope closes.
   *
   * **Example** (Closing a connection once its answer is read)
   *
   * ```ts import.meta.vitest
   * import { SocketConnector } from "@usestrider/browser/protocol"
   * import { Effect } from "effect"
   *
   * const ask = Effect.fn("ask")(function*(port: number) {
   *   const connector = yield* SocketConnector.SocketConnector
   *   const connection = yield* connector.connect({ host: "127.0.0.1", port })
   *   yield* connection.write("GET /json HTTP/1.0\r\n\r\n")
   *   const answer = yield* connection.pull
   *   yield* connection.close
   *   return answer
   * })
   * ```
   */
  readonly close: Effect.Effect<void>
}

/**
 * The service that opens connections, each for the scope it's opened in.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SocketConnector {
  /**
   * Opens a connection to `endpoint`, which closes when the scope does.
   *
   * **Example** (Checking whether a port accepts connections)
   *
   * ```ts import.meta.vitest
   * import { SocketConnector } from "@usestrider/browser/protocol"
   * import { Effect } from "effect"
   *
   * const accepts = Effect.fn("accepts")(function*(port: number) {
   *   const connector = yield* SocketConnector.SocketConnector
   *   return yield* connector.connect({ host: "127.0.0.1", port }).pipe(
   *     Effect.scoped,
   *     Effect.as(true),
   *     Effect.catch(() => Effect.succeed(false))
   *   )
   * })
   * ```
   */
  readonly connect: (endpoint: Endpoint) => Effect.Effect<Connection, Socket.SocketError, Scope.Scope>
}

/**
 * The `SocketConnector` service.
 *
 * @stability experimental
 * @category services
 * @since 0.1.0
 */
export const SocketConnector: Context.Service<SocketConnector, SocketConnector> = Context.Service<SocketConnector>(
  "@usestrider/browser/protocol/SocketConnector"
)

/**
 * Connects a socket that hasn't connected yet and makes a `Connection` of it.
 *
 * **Details**
 *
 * Its reader and writer are held until `close` or the end of the scope.
 *
 * **Example** (Sending a request over a socket)
 *
 * ```ts import.meta.vitest
 * import { SocketConnector } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 * import type * as Socket from "effect/socket/Socket"
 *
 * const request = Effect.fn("request")(function*(socket: Socket.Socket) {
 *   const connection = yield* SocketConnector.fromSocket(socket)
 *   yield* connection.write("GET /json HTTP/1.0\r\n\r\n")
 *   return yield* connection.pull
 * })
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const fromSocket: (socket: Socket.Socket) => Effect.Effect<Connection, Socket.SocketError, Scope.Scope> = Effect
  .fnUntraced(function*(socket: Socket.Socket) {
    const scope = yield* Scope.fork(yield* Effect.scope)
    const reader = yield* Scope.provide(socket.reader, scope).pipe(
      Effect.onError(() => Scope.close(scope, Exit.void))
    )
    const writer = yield* Scope.provide(socket.writer, scope)
    return {
      pull: reader.pull,
      upgrade: reader.upgrade,
      write: writer.write,
      writeAll: writer.writeAll,
      close: Scope.close(scope, Exit.void)
    } satisfies Connection
  })

/**
 * Provides `SocketConnector` from a platform's way to make a socket for an endpoint.
 *
 * **Example** (Providing sockets such as `@effect/platform-node`'s `NodeSocket.makeNet`)
 *
 * ```ts import.meta.vitest
 * import { SocketConnector } from "@usestrider/browser/protocol"
 * import type { Effect } from "effect"
 * import type * as Socket from "effect/socket/Socket"
 *
 * declare const makeNet: (
 *   options: { readonly host: string; readonly port: number }
 * ) => Effect.Effect<Socket.Socket>
 *
 * const sockets = SocketConnector.layer((endpoint) =>
 *   makeNet({ host: endpoint.host, port: endpoint.port })
 * )
 * ```
 *
 * @stability experimental
 * @category layers
 * @since 0.1.0
 */
export const layer = (
  make: (endpoint: Endpoint) => Effect.Effect<Socket.Socket>
): Layer.Layer<SocketConnector> =>
  Layer.succeed(SocketConnector)({
    connect: (endpoint) => Effect.flatMap(make(endpoint), fromSocket)
  })
