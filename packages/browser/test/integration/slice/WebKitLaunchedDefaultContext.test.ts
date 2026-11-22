/** A stock WebKit launch's `defaultContext` options (`launchedDefaultContext.ts`), from one launch. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { WebKit } from "@usestrider/browser/webkit"
import * as Layer from "effect/Layer"
import { webkitgtk } from "../browsers.ts"
import { socketConnector } from "../sockets.ts"
import { useXvfb } from "../stockWebKit.ts"
import { launchedDefaultContext } from "./launchedDefaultContext.ts"

const display = Layer.effectDiscard(useXvfb()).pipe(Layer.provide(NodeServices.layer))

launchedDefaultContext(
  "WebKit",
  (defaultContext) =>
    WebKit.layer({ executablePath: webkitgtk.executable, defaultContext }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector, display))
    ),
  []
)
