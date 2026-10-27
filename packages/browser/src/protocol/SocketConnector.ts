/**
 * Opens scoped socket connections to endpoints chosen at run time, such as the inspector server of a stock WebKit
 * browser `WebKit.layer` launched.
 *
 * **Details**
 *
 * Provisional. It has the shape of Effect's own `effect/socket/SocketConnector` (Effect-TS/effect#8735), which
 * replaces it once Effect releases it: Effect's services make WebSockets, processes and files, and none yet opens
 * a TCP connection to a port only known at run time. A program provides it from its platform's sockets, as
 * `@effect/platform-node`'s `NodeSocket.makeNet` makes them.
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
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Endpoint {
  readonly host: string
  readonly port: number
  readonly path?: string | undefined
  readonly tls?: boolean | TlsOptions | undefined
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
 * A connection from a socket that hasn't connected yet: its reader, which connects it, and its writer, both held
 * until `close` or the scope ends.
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
 * **Example** (A platform's sockets, such as `@effect/platform-node`'s `NodeSocket.makeNet`)
 *
 * ```ts import.meta.vitest
 * import type { Effect } from "effect"
 * import type * as Socket from "effect/socket/Socket"
 * import { SocketConnector } from "@usestrider/browser/protocol"
 *
 * declare const makeNet: (options: { readonly host: string; readonly port: number }) => Effect.Effect<Socket.Socket>
 *
 * const sockets = SocketConnector.layer((endpoint) => makeNet({ host: endpoint.host, port: endpoint.port }))
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
