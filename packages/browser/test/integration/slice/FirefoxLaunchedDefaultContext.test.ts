/** A Firefox launch's `defaultContext` options (`launchedDefaultContext.ts`), from one launch. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { Firefox } from "@usestrider/browser/firefox"
import * as Layer from "effect/Layer"
import { firefox } from "../browsers.ts"
import { launchedDefaultContext } from "./launchedDefaultContext.ts"

launchedDefaultContext(
  "Firefox",
  (defaultContext) =>
    Firefox.layer({ executablePath: firefox.executable, defaultContext }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))
    ),
  ["interception.auth", "downloads", "acceptInsecureCerts"]
)
