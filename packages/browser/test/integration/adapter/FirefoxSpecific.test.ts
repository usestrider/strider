/**
 * What only the BiDi adapter does, against the pinned Firefox: what names a page, realm or handle of its own that
 * ended.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as Adapter from "../../../src/internal/adapter.ts"
import * as BidiAdapter from "../../../src/internal/bidiAdapter.ts"
import * as FirefoxLauncher from "../../../src/internal/firefoxLauncher.ts"
import { assertPinned, firefox } from "../browsers.ts"
import { makeRecorder, site } from "./harness.ts"

const executable = firefox.executable
const timeout = 60_000

describe("Firefox adapter, BiDi only", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect(
        "fails what names a page, realm or handle of its own that ended as Gone: never Foreign, nor sent empty",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const facts = makeRecorder()
            const { transport } = yield* FirefoxLauncher.launch({ executablePath: executable })
            const adapter = yield* BidiAdapter.connect(transport, { sink: facts.sink, ownership: "launched" })
            assertPinned("Firefox", adapter.info.version, firefox.version)
            const page = yield* adapter.createPage(adapter.defaultContext)
            const navigation = yield* adapter.navigate(page, `${served.origin}/hello`, { referrer: Option.none() })
            const ended = yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
            assert(ended.outcome._tag === "Committed")
            const document = ended.outcome.document
            const realm = yield* adapter.realm(document, { _tag: "Main" })
            const call = (functionDeclaration: string, args: ReadonlyArray<Adapter.LocalValue> = []) =>
              adapter.evaluate(realm, {
                functionDeclaration,
                arguments: args,
                awaitPromise: true,
                result: "handle",
                userActivation: false
              })
            // A released handle isn't sent as an empty reference
            const held = yield* call("() => ({ answer: 42 })")
            assert(held._tag === "Value" && held.value.type === "object" && held.value.handle !== undefined)
            yield* adapter.releaseHandles([held.value.handle])
            const released = yield* call("(object) => typeof object", [{ _tag: "Handle", handle: held.value.handle }])
              .pipe(Effect.flip)
            assert.strictEqual(released.reason._tag, "Gone")
            yield* adapter.closePage(page, { runBeforeUnload: false })
            yield* facts.when("NavigableRemoved", (fact) => fact.navigable === page)
            // The page and its document ended: naming them is a race L1 handles, not a bug
            const closed = yield* adapter.activatePage(page).pipe(Effect.flip)
            assert.deepStrictEqual(closed.reason, {
              _tag: "Gone",
              target: { _tag: "Page", id: page },
              reason: { _tag: "PageClosed", by: "command" }
            })
            const replaced = yield* adapter.realm(document, { _tag: "Main" }).pipe(Effect.flip)
            assert.strictEqual(replaced.reason._tag, "Gone")
            const gone = yield* call("() => 1").pipe(Effect.flip)
            assert.strictEqual(gone.reason._tag, "Gone")
          }),
        timeout
      )
    }
  )
})
