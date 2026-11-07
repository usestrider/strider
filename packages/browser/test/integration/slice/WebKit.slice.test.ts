/**
 * The slices against stock WebKit, through the public layer: WebKitGTK's MiniBrowser (`browsers.ts`)
 * launched in automation mode, on an X server of the layer's own (`stockWebKit.ts`), with Node's sockets
 * (`sockets.ts`).
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert } from "@effect/vitest"
import { WebKit } from "@usestrider/browser/webkit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { webkitgtk } from "../browsers.ts"
import { socketConnector } from "../sockets.ts"
import { useXvfb } from "../stockWebKit.ts"
import { attaching } from "./attaching.ts"
import { contents } from "./contents.ts"
import { deadlines } from "./deadlines.ts"
import { declarations } from "./declarations.ts"
import { events } from "./events.ts"
import { interaction } from "./interaction.ts"
import { modules } from "./modules.ts"
import { recordings } from "./recordings.ts"
import { slice } from "./slice.ts"
import { tooling } from "./tooling.ts"
import { toolkit } from "./toolkit.ts"
import { webauthn } from "./webauthn.ts"

// The X server comes up before the browser, and goes after it
const display = Layer.effectDiscard(useXvfb()).pipe(Layer.provide(NodeServices.layer))

const backend = WebKit.layer({ executablePath: webkitgtk.executable }).pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector, display))
)

const name = "WebKit"

slice(name, backend, (info) => {
  assert.strictEqual(info.product, "MiniBrowser (stock WebKit)")
  assert.strictEqual(info.version, webkitgtk.version)
})
events(name, backend)
modules(name, backend)
interaction(name, backend)
declarations(name, backend)
contents(name, backend)
tooling(name, backend)
recordings(name, backend)
toolkit(name, backend)
deadlines(name, backend)
attaching(name, backend, Option.none())

webauthn("WebKit", backend)
