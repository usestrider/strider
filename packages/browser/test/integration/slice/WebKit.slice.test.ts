/**
 * The first slice against Playwright's WebKit, through the public layer: the pinned build (`browsers.ts`), in
 * the Nix environment `pnpm test:integration` enters. The launcher refuses another build by its `protocol.json`.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { WebKit } from "@usestrider/browser/webkit"
import * as Layer from "effect/Layer"
import { webkit } from "../browsers.ts"
import { slice } from "./slice.ts"

slice(
  "WebKit",
  WebKit.layer({ executablePath: webkit.executable }).pipe(Layer.provide(NodeServices.layer)),
  () => {}
)
