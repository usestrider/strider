/**
 * The browser's connection state on stock WebKit (`connectionState.ts`): the MiniBrowser launched in automation
 * mode, and one started with its inspector server and attached to.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { WebKit } from "@usestrider/browser/webkit"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { webkitgtk } from "../browsers.ts"
import { socketConnector } from "../sockets.ts"
import { startMiniBrowser, useXvfb } from "../stockWebKit.ts"
import { connectionState } from "./connectionState.ts"

const display = Layer.effectDiscard(useXvfb()).pipe(Layer.provide(NodeServices.layer))

connectionState(
  "WebKit",
  WebKit.layer({ executablePath: webkitgtk.executable }).pipe(
    Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector, display))
  ),
  {
    start: Effect.map(
      startMiniBrowser("data:text/html,<title>Attached</title>"),
      ({ endpoint, process }) => ({ endpoint, process })
    ),
    attach: (endpoint) => WebKit.layerAttach(endpoint)
  }
)
