/** Direct claims fail explicitly on backends without stable recovery identity. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Claims from "@usestrider/browser/experimental"
import { Firefox } from "@usestrider/browser/firefox"
import { WebKit } from "@usestrider/browser/webkit"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { firefox, webkitgtk } from "../browsers.ts"
import { socketConnector } from "../sockets.ts"
import { useXvfb } from "../stockWebKit.ts"

const display = Layer.effectDiscard(useXvfb()).pipe(Layer.provide(NodeServices.layer))
const backends = [
  [
    "Firefox",
    Firefox.layer({ executablePath: firefox.executable }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))
    )
  ],
  [
    "WebKit",
    WebKit.layer({ executablePath: webkitgtk.executable }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector, display))
    )
  ]
] as const

for (const [name, backend] of backends) {
  describe(`${name} claims`, () => {
    layer(backend, { excludeTestServices: true })((it) => {
      it.effect("refuses creation, issuance and reclaim with a named capability", () =>
        Effect.gen(function*() {
          const browser = yield* Browser.Browser
          const page = yield* Browser.newPage()
          const calls: Array<Effect.Effect<unknown, unknown, Browser.Browser | import("effect/Scope").Scope>> = [
            Claims.UserContext.create({ reclaimable: true }),
            Claims.Page.claim(page),
            Claims.UserContext.claim(page.context),
            Claims.Browser.reclaim(Claims.Page.Claim.make("opaque")),
            Claims.UserContext.reclaim(Claims.UserContext.Claim.make("opaque"))
          ]
          for (const call of calls) {
            const exit = yield* call.pipe(Effect.exit)
            assert(Exit.isFailure(exit))
            const failure = Option.getOrThrow(Exit.findErrorOption(exit))
            assert(failure instanceof Claims.Claim.ClaimError)
            assert.strictEqual(failure.reason._tag, "Unsupported")
            if (failure.reason._tag === "Unsupported") {
              assert.strictEqual(failure.reason.capability, "claims")
              assert.strictEqual(failure.reason.backend, browser.info.product)
            }
          }
        }), 60_000)
    })
  })
}
