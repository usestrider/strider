/**
 * The slices against Playwright's WebKit, through the public layer: the pinned build (`browsers.ts`), in the
 * Nix environment `pnpm test:integration` enters. The launcher refuses another build by its `protocol.json`.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { WebKit } from "@usestrider/browser/webkit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { webkit } from "../browsers.ts"
import { attaching } from "./attaching.ts"
import { contents } from "./contents.ts"
import { declarations } from "./declarations.ts"
import { events } from "./events.ts"
import { interaction } from "./interaction.ts"
import { modules } from "./modules.ts"
import { slice } from "./slice.ts"

const backend = WebKit.layer({ executablePath: webkit.executable }).pipe(Layer.provide(NodeServices.layer))

slice("WebKit", backend, () => {})
events("WebKit", backend)
modules("WebKit", backend)
interaction("WebKit", backend)
declarations("WebKit", backend)
contents("WebKit", backend)
attaching("WebKit", backend, Option.none())
