/**
 * The first slice against Firefox, through the public layer: the pinned Firefox (`browsers.ts`), in the Nix
 * environment `pnpm test:integration` enters.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { Firefox } from "@usestrider/browser/firefox"
import * as Layer from "effect/Layer"
import { assertPinned, firefox } from "../browsers.ts"
import { slice } from "./slice.ts"

slice(
  "Firefox",
  Firefox.layer({ executablePath: firefox.executable }).pipe(
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))
  ),
  (info) => assertPinned("Firefox", info.version, firefox.version)
)
