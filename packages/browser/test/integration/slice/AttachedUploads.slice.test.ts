/** Caller-local transfer through a real attached Chromium connection. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { chromiumAttachable } from "./attaching.ts"
import { tooling } from "./tooling.ts"

const attached = Layer.unwrap(Effect.gen(function*() {
  const launched = yield* chromiumAttachable((endpoint) => Chromium.layerConnect(endpoint)).start(
    "about:blank",
    "about:blank"
  )
  return launched.layer
})).pipe(Layer.provide(NodeServices.layer))

tooling("Chromium attached", attached, true)
