/** A Chromium launch's `defaultContext` options (`launchedDefaultContext.ts`), from one launch. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Chromium } from "@usestrider/browser/chromium"
import * as Layer from "effect/Layer"
import { chromium } from "../browsers.ts"
import { launchedDefaultContext } from "./launchedDefaultContext.ts"

launchedDefaultContext(
  "Chromium",
  (defaultContext) =>
    Chromium.layer({ executablePath: chromium.executable, defaultContext }).pipe(Layer.provide(NodeServices.layer)),
  ["bypassCSP", "interception.auth", "downloads", "acceptInsecureCerts"]
)
