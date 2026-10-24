/**
 * The slices against Chromium, through the public layer: the pinned Chromium (`browsers.ts`), in the Nix
 * environment `pnpm test:integration` enters.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Chromium } from "@usestrider/browser/chromium"
import * as Layer from "effect/Layer"
import { assertPinned, chromium } from "../browsers.ts"
import { events } from "./events.ts"
import { modules } from "./modules.ts"
import { slice } from "./slice.ts"

const backend = Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer))

slice("Chromium", backend, (info) => assertPinned("Chromium", info.version, chromium.version))
events("Chromium", backend)
modules("Chromium", backend)
