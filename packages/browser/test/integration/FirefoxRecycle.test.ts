/** The shared-suite restart against Firefox's real startup page, which the in-memory backend does not create. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, layer } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { Firefox } from "@usestrider/browser/firefox"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { assertPinned, firefox } from "./browsers.ts"
import { Recycler, recycling } from "./slice/recycledBrowser.ts"
import * as SharedContext from "./slice/sharedContext.ts"

// One page exercises the boundary without opening 100 windows; the exact threshold has unit coverage.
const backend = recycling(
  Firefox.layer({ executablePath: firefox.executable }).pipe(
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))
  ),
  1
)

layer(Layer.merge(SharedContext.layer(backend), backend), { excludeTestServices: true })((it) => {
  it.effect("recycles a shared Firefox suite after its case pages close", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      assertPinned("Firefox", browser.info.version, firefox.version)
      const shared = yield* SharedContext.Shared
      const recycler = yield* Recycler
      for (let launch = 1; launch <= 3; launch++) {
        const context = yield* shared.current
        yield* Effect.scoped(Effect.gen(function*() {
          yield* context.newPage
          assert.isFalse(yield* recycler.run, "a case page must not be treated as a startup page")
        }))
        assert.deepStrictEqual(yield* shared.settle, [])
        const open = yield* browser.pages.waitFor(() => true)
        const urls = yield* Effect.forEach(open, (page) => page.url)
        assert.strictEqual((yield* recycler.stats).launches, launch + 1, `pages after boundary: ${urls.join(", ")}`)
      }
    }), 30_000)
})
