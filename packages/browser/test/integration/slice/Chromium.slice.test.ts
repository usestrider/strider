/**
 * The first slice against Chromium, through the public layer: the pinned Chromium (`browsers.ts`), in the Nix
 * environment `pnpm test:integration` enters.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Chromium } from "@usestrider/browser/chromium"
import * as Layer from "effect/Layer"
import { assertPinned, chromium } from "../browsers.ts"
import { slice } from "./slice.ts"

slice(
  "Chromium",
  Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer)),
  (info) => assertPinned("Chromium", info.version, chromium.version)
)
