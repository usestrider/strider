/**
 * What only the BiDi adapter does, against the pinned Firefox: what names a page, realm or handle of its own that
 * ended, and what a profile directory keeps when the layer closes.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { Firefox } from "@usestrider/browser/firefox"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { afterAll } from "vitest"
import type * as Adapter from "../../../src/internal/adapter.ts"
import * as BidiAdapter from "../../../src/internal/bidiAdapter.ts"
import * as FirefoxLauncher from "../../../src/internal/firefoxLauncher.ts"
import * as Target from "../../../src/Target.ts"
import { assertPinned, firefox } from "../browsers.ts"
import * as FirefoxCrashReports from "../firefoxCrashReports.ts"
import { makeRecorder, site } from "./harness.ts"

// This file's Firefox writes the crash reports of a content process it kills, kept when a test fails
// (`firefoxCrashReports.ts`); the file undoes it when it ends, so later files launch Firefox as usual
afterAll(FirefoxCrashReports.optIn())

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
              reason: new Target.PageClosed({ by: "command" })
            })
            const replaced = yield* adapter.realm(document, { _tag: "Main" }).pipe(Effect.flip)
            assert.strictEqual(replaced.reason._tag, "Gone")
            const gone = yield* call("() => 1").pipe(Effect.flip)
            assert.strictEqual(gone.reason._tag, "Gone")
          }),
        timeout
      )
      it.effect(
        "persists a cookie and a localStorage item in a supplied profile when the browser layer closes before the page scope",
        () =>
          Effect.gen(function*() {
            const fs = yield* FileSystem.FileSystem
            const served = yield* site
            const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-profile-storage-test-" })
            // Keep the page alive until the browser layer shuts down; closing it first can flush storage.
            for (const round of [0, 1]) {
              yield* Effect.scoped(
                Effect.gen(function*() {
                  const browser = yield* Browser.Browser
                  assertPinned("Firefox", browser.info.version, firefox.version)
                  const context = yield* browser.defaultContext.control
                  const page = yield* context.newPage
                  yield* page.goto(`${served.origin}/hello`, { waitUntil: "load" })
                  if (round === 0) {
                    yield* page.evaluateInMainWorld(() => {
                      document.cookie = "scope-shutdown=kept; expires=Fri, 31 Dec 9999 23:59:59 GMT; path=/"
                      localStorage.setItem("scope-shutdown", "kept")
                    })
                  } else {
                    assert.deepStrictEqual(
                      yield* page.evaluateInMainWorld(() => [document.cookie, localStorage.getItem("scope-shutdown")]),
                      ["scope-shutdown=kept", "kept"]
                    )
                  }
                }).pipe(Effect.provide(Firefox.layer({ executablePath: executable, userDataDir: directory })))
              )
              assert.isTrue(yield* fs.exists(directory))
            }
          }),
        timeout
      )
    }
  )
})
