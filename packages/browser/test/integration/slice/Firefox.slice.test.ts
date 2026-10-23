/**
 * The slices against Firefox, through the public layer: the pinned Firefox (`browsers.ts`), in the Nix
 * environment `pnpm test:integration` enters.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { Firefox } from "@usestrider/browser/firefox"
import * as Layer from "effect/Layer"
import { assertPinned, firefox } from "../browsers.ts"
import { events } from "./events.ts"
import { slice } from "./slice.ts"

const backend = Firefox.layer({ executablePath: firefox.executable }).pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))
)

slice("Firefox", backend, (info) => assertPinned("Firefox", info.version, firefox.version))
events("Firefox", backend)
