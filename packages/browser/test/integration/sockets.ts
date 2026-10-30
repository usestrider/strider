/**
 * The TCP sockets `WebKit.layer` opens to stock WebKit's inspector server, from Node's.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { SocketConnector } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { traceInspectorSocket } from "./record.ts"

export const socketConnector = Layer.succeed(SocketConnector.SocketConnector)({
  connect: (endpoint) =>
    NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port }).pipe(
      Effect.flatMap(SocketConnector.fromSocket),
      Effect.map(traceInspectorSocket)
    )
})
