/**
 * The slices against Firefox, through the public layer: the pinned Firefox (`browsers.ts`), in the Nix
 * environment `pnpm test:integration` enters.
 */
// TEMPORARY PROBE: counts BiDi traffic by method, printed every 10th page and when a storage read fails. Revert.
{
  const Native = globalThis.WebSocket
  const counts: Record<string, number> = {}
  let creates = 0
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1 }
  const keep = /^(cmd:(script\.(add|remove)PreloadScript|session\.(un)?subscribe|network\.(add|remove)Intercept|browsingContext\.(create|close)|browser\.(create|remove)UserContext|script\.disown)|ev:(script\.realm(Created|Destroyed)|browsingContext\.context(Created|Destroyed)))$/
  const dump = (why: string) =>
    console.log("R475COUNTS", why, JSON.stringify(Object.fromEntries(Object.entries(counts).filter(([k]) => keep.test(k)).sort())))
  ;(globalThis as Record<string, unknown>)["__r475dump"] = dump
  class Probed extends Native {
    constructor(url: string | URL, protocols?: string | Array<string>) {
      super(url, protocols as never)
      this.addEventListener("message", (event) => {
        try { const m = JSON.parse(String(event.data)); if (m.type === "event") bump("ev:" + m.method) } catch {}
      })
    }
    override send(data: never) {
      try {
        const m = JSON.parse(String(data)); bump("cmd:" + m.method)
        if (m.method === "browsingContext.create") { creates++; if (creates % 10 === 0) dump("page " + creates) }
      } catch {}
      return super.send(data)
    }
  }
  ;(globalThis as { WebSocket: unknown }).WebSocket = Probed
}
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { Firefox } from "@usestrider/browser/firefox"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { assertPinned, firefox } from "../browsers.ts"
import { attaching, firefoxAttachable } from "./attaching.ts"
import { contents } from "./contents.ts"
import { deadlines } from "./deadlines.ts"
import { declarations } from "./declarations.ts"
import { events } from "./events.ts"
import { interaction } from "./interaction.ts"
import { modules } from "./modules.ts"
import { recordings } from "./recordings.ts"
import { requestBodies } from "./requestBodies.ts"
import { requestSizes } from "./requestSizes.ts"
import { requestTiming } from "./requestTiming.ts"
import { slice } from "./slice.ts"
import { storageReplacement } from "./storageReplacement.ts"
import { tooling } from "./tooling.ts"
import { toolkit } from "./toolkit.ts"
import { webauthn } from "./webauthn.ts"

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
deadlines("Firefox", backend)
attaching("Firefox", backend, Option.some(firefoxAttachable((endpoint) => Firefox.layerConnect(endpoint))))

webauthn("Firefox", backend)

requestBodies("Firefox", backend)
requestTiming("Firefox", backend)

storageReplacement("Firefox", backend)
requestSizes("Firefox", backend)
