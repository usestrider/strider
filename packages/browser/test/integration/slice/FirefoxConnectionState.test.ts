/** The browser's connection state on Firefox (`connectionState.ts`): launched, and attached to a started browser. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { Firefox } from "@usestrider/browser/firefox"
import * as Layer from "effect/Layer"
import { firefox } from "../browsers.ts"
import { connectionState, firefoxStartable } from "./connectionState.ts"

connectionState(
  "Firefox",
  Firefox.layer({ executablePath: firefox.executable }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))),
  firefoxStartable((endpoint) => Firefox.layerConnect(endpoint))
)
