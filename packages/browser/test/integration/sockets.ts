/**
 * The TCP sockets `WebKit.layer` opens to stock WebKit's inspector server, from Node's.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { SocketConnector } from "@usestrider/browser/protocol"

export const socketConnector = SocketConnector.layer((endpoint) =>
  NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port })
)
