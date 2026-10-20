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
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as CdpAdapter from "../../../src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import * as Launch from "../../../src/internal/launch.ts"
import { assertPinned, chromium } from "../browsers.ts"
import { makeRecorder, site } from "./harness.ts"

const executable = chromium.executable
const timeout = 60_000

describe("Chromium launcher", () => {
  layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    it.effect("fails with ExecutableNotFound, naming what it searched, without looking anywhere else", () =>
      Effect.gen(function*() {
        const error = yield* ChromiumLauncher.launch({ executablePath: "/nowhere/chrome" }).pipe(Effect.flip)
        assert(error.reason._tag === "ExecutableNotFound")
        assert.deepStrictEqual(error.reason.searched, ["/nowhere/chrome"])
        const none = yield* ChromiumLauncher.launch({}).pipe(Effect.flip)
        assert(none.reason._tag === "ExecutableNotFound")
        assert.deepStrictEqual(none.reason.searched, [])
        assert.include(none.reason.hint, "executablePath")
      }))

    it.effect("knows where each channel installs itself", () =>
      Effect.sync(() => {
        assert.deepStrictEqual(ChromiumLauncher.channelCandidates("linux", "beta", {}), [
          "/opt/google/chrome-beta/chrome",
          "/usr/bin/google-chrome-beta"
        ])
        assert.deepStrictEqual(ChromiumLauncher.channelCandidates("darwin", "canary", {}), [
          "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
        ])
        assert.deepStrictEqual(ChromiumLauncher.channelCandidates("win32", "stable", { LOCALAPPDATA: "C:\\L" }), [
          "C:\\L\\Google\\Chrome\\Application\\chrome.exe"
        ])
      }))

    it.effect("passes the profile's arguments, then the caller's, then its own", () =>
      Effect.sync(() => {
        const args = ChromiumLauncher.argsFor({ profile: "concurrent", args: ["--lang=de"] }, "/profile", "pipe")
        assert.include(args, "--disable-renderer-backgrounding")
        assert.isBelow(args.indexOf("--no-first-run"), args.indexOf("--lang=de"))
        assert.deepStrictEqual(args.slice(-3), ["--remote-debugging-pipe", "--user-data-dir=/profile", "about:blank"])
        assert.notInclude(
          ChromiumLauncher.argsFor({ profile: "stock", headless: false }, "/p", "pipe"),
          "--no-first-run"
        )
      }))

    it.effect("reports a browser that exits before it is ready, with its exit code and stderr", () =>
      Effect.gen(function*() {
        const failing = "/bin/sh"
        const launched = yield* Launch.spawn(failing, ["-c", "echo broken profile >&2; exit 3"], "/tmp", {})
        yield* launched.handle.exitCode.pipe(Effect.ignore)
        const error = yield* Launch.notReady(launched, "connecting").pipe(Effect.flip)
        assert(error.reason._tag === "ProcessExited")
        assert.deepStrictEqual(error.reason.code, Option.some(3))
        assert.include(error.reason.stderrTail, "broken profile")
      }))
  })
})

describe.skipIf(executable === undefined)("Chromium adapter, CDP only", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect(
        "ends a crashed page with PageCrashed; a second client on the same browser crashes it",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const facts = makeRecorder()
            const { launched, transport } = yield* ChromiumLauncher.launchWithPort({ executablePath: executable! })
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
            yield* Page.crash().pipe(Protocol.on(yield* other.session(sessionId)), Effect.ignore)
            const removed = yield* facts.when("NavigableRemoved", (fact) => fact.navigable === page)
            assert.deepStrictEqual(removed.reason, { _tag: "PageCrashed" })
          }),
        timeout
      )

      it.effect(
        "attaches to a browser it doesn't own: adopts its tabs, pauses none of them",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const facts = makeRecorder()
            const { transport } = yield* ChromiumLauncher.launchWithPort({ executablePath: executable! })
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
    }
  )
})
