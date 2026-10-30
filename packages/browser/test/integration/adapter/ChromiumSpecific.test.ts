/**
 * What only the CDP adapter and the Chromium launcher do: crashes, attaching to a browser someone else owns,
 * and the launcher's failures.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Target from "@usestrider/browser/cdp/Target"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Adapter from "../../../src/internal/adapter.ts"
import * as CdpAdapter from "../../../src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import * as L1Target from "../../../src/Target.ts"
import { assertPinned, chromium } from "../browsers.ts"
import { makeRecorder, site } from "./harness.ts"

const executable = chromium.executable
const timeout = 60_000

describe("Chromium adapter, CDP only", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect(
        "ends a crashed page with PageCrashed; a second client on the same browser crashes it",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const facts = makeRecorder()
            const { launched, transport } = yield* ChromiumLauncher.launchWithPort({ executablePath: executable })
            const adapter = yield* CdpAdapter.connect(transport, { sink: facts.sink, ownership: "launched" })
            assertPinned("Chromium", adapter.info.version, chromium.version)
            const page = yield* adapter.createPage(adapter.defaultContext)
            const url = `${served.origin}/crash-me`
            const navigation = yield* adapter.navigate(page, url, { referrer: Option.none() })
            yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
            // Probe 25: CDP takes several clients at once
            const active = yield* Effect.promise(() =>
              import("node:fs/promises").then((fs) => fs.readFile(`${launched.userDataDir}/DevToolsActivePort`, "utf8"))
            )
            const [port, browserPath] = active.split("\n")
            const other = yield* CdpConnection.make(yield* Transport.webSocket(`ws://127.0.0.1:${port}${browserPath}`))
            const { targetInfos } = yield* Target.getTargets({}).pipe(Protocol.on(other.browser))
            const target = targetInfos.find((info) => info.url === url)
            assert.isDefined(target)
            const { sessionId } = yield* Target.attachToTarget({ targetId: target.targetId, flatten: true }).pipe(
              Protocol.on(other.browser)
            )
            // The browser never answers `Page.crash` (recorded), so it is sent without waiting for a reply
            yield* Page.crash().pipe(Protocol.on(yield* other.session(sessionId)), Effect.ignore, Effect.forkChild)
            const removed = yield* facts.when("NavigableRemoved", (fact) => fact.navigable === page)
            assert.deepStrictEqual(removed.reason, new L1Target.PageCrashed({}))
          }),
        timeout
      )

      it.effect(
        "attaches to a browser it doesn't own: adopts its tabs, pauses none of them",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const facts = makeRecorder()
            const { transport } = yield* ChromiumLauncher.launchWithPort({ executablePath: executable })
            const adapter = yield* CdpAdapter.connect(transport, { sink: facts.sink, ownership: "attached" })
            assertPinned("Chromium", adapter.info.version, chromium.version)
            assert.strictEqual(adapter.pauseScope, "related")
            const adopted = yield* facts.when("PageAdded")
            assert.deepStrictEqual(adopted.origin, { _tag: "Adopted", opener: Option.none() })
            const capabilities = yield* SubscriptionRef.get(adapter.capabilities)
            assert.isFalse(capabilities.has("pauseOnStart.popups"))
            const page = yield* adapter.createPage(adapter.defaultContext)
            const navigation = yield* adapter.navigate(page, `${served.origin}/hello`, { referrer: Option.none() })
            const ended = yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
            assert.strictEqual(ended.outcome._tag, "Committed")
          }),
        timeout
      )

      it.effect(
        "fails what names a page, realm or handle of its own that ended as Gone: never Foreign, nor sent empty",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const facts = makeRecorder()
            const { transport } = yield* ChromiumLauncher.launchWithPort({ executablePath: executable })
            const adapter = yield* CdpAdapter.connect(transport, { sink: facts.sink, ownership: "launched" })
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
            // A released handle isn't sent as an empty reference, which the page would read as `undefined`
            const held = yield* call("() => ({ answer: 42 })")
            assert(held._tag === "Value" && held.value.type === "object" && held.value.handle !== undefined)
            yield* adapter.releaseHandles([held.value.handle])
            const released = yield* call("(object) => typeof object", [{ _tag: "Handle", handle: held.value.handle }])
              .pipe(Effect.flip)
            assert.strictEqual(released.reason._tag, "Gone")
            // A call the page's close cuts short ends with its realm, not as the browser's refusal
            const pending = yield* Effect.forkChild(
              call("() => { console.log('waiting'); return new Promise(() => {}) }")
            )
            yield* facts.when("ConsoleMessage", (fact) => fact.message.text === "waiting")
            yield* adapter.closePage(page, { runBeforeUnload: false })
            const cut = yield* Fiber.join(pending).pipe(Effect.flip)
            assert.strictEqual(cut.reason._tag, "Gone")
            yield* facts.when("NavigableRemoved", (fact) => fact.navigable === page)
            // The page and its document ended: naming them is a race L1 handles, not a bug
            const closed = yield* adapter.activatePage(page).pipe(Effect.flip)
            assert.deepStrictEqual(closed.reason, {
              _tag: "Gone",
              target: { _tag: "Page", id: page },
              reason: new L1Target.PageClosed({ by: "command" })
            })
            const replaced = yield* adapter.realm(document, { _tag: "Main" }).pipe(Effect.flip)
            assert.strictEqual(replaced.reason._tag, "Gone")
          }),
        timeout
      )
    }
  )
})
