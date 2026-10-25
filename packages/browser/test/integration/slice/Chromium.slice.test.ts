/**
 * The slices against Chromium, through the public layer: the pinned Chromium (`browsers.ts`), in the Nix
 * environment `pnpm test:integration` enters.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Chromium } from "@usestrider/browser/chromium"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { assertPinned, chromium } from "../browsers.ts"
import { attaching, chromiumAttachable } from "./attaching.ts"
import { contents } from "./contents.ts"
import { declarations } from "./declarations.ts"
import { events } from "./events.ts"
import { interaction } from "./interaction.ts"
import { modules } from "./modules.ts"
import { recordings } from "./recordings.ts"
import { slice } from "./slice.ts"
import { tooling } from "./tooling.ts"

const backend = Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer))

slice("Chromium", backend, (info) => assertPinned("Chromium", info.version, chromium.version))
events("Chromium", backend)
modules("Chromium", backend)
interaction("Chromium", backend)
declarations("Chromium", backend)
contents("Chromium", backend)
tooling("Chromium", backend)
recordings("Chromium", backend)
attaching("Chromium", backend, Option.some(chromiumAttachable((endpoint) => Chromium.layerConnect(endpoint))))
