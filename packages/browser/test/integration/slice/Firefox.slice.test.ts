/**
 * The slices against Firefox, through the public layer: the pinned Firefox (`browsers.ts`), in the Nix
 * environment `pnpm test:integration` enters.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { Firefox } from "@usestrider/browser/firefox"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { assertPinned, firefox } from "../browsers.ts"
import { attaching, firefoxAttachable } from "./attaching.ts"
import { contents } from "./contents.ts"
import { declarations } from "./declarations.ts"
import { events } from "./events.ts"
import { interaction } from "./interaction.ts"
import { modules } from "./modules.ts"
import { recordings } from "./recordings.ts"
import { slice } from "./slice.ts"
import { tooling } from "./tooling.ts"
import { toolkit } from "./toolkit.ts"

const backend = Firefox.layer({ executablePath: firefox.executable }).pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))
)

slice("Firefox", backend, (info) => assertPinned("Firefox", info.version, firefox.version))
events("Firefox", backend)
modules("Firefox", backend)
interaction("Firefox", backend)
declarations("Firefox", backend)
contents("Firefox", backend)
tooling("Firefox", backend)
recordings("Firefox", backend)
toolkit("Firefox", backend)
attaching("Firefox", backend, Option.some(firefoxAttachable((endpoint) => Firefox.layerConnect(endpoint))))
