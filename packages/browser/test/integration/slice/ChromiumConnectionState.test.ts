/** The browser's connection state on Chromium (`connectionState.ts`): launched, and attached to a started browser. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Chromium } from "@usestrider/browser/chromium"
import * as Layer from "effect/Layer"
import { chromium } from "../browsers.ts"
import { chromiumStartable, connectionState } from "./connectionState.ts"

connectionState(
  "Chromium",
  Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer)),
  chromiumStartable((endpoint) => Chromium.layerConnect(endpoint))
)
