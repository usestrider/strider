/**
 * Playwright's `tests/library/chromium/launcher.spec.ts`: the browser's launch arguments and the targets it creates.
 * Chromium only, as the original's directory is.
 *
 * What the port changes:
 * - CR-034 launches Chromium with `--remote-debugging-port=0`, the flag the original passes, by providing the harness's
 *   Chromium backend with those arguments to its body, as session.test.ts does. The original's `launchServer` is
 *   Playwright's server mode, which Strider doesn't have, so the test asserts only that the launch succeeds and closes.
 * - CR-035 needs a browser-level CDP connection, which Strider reaches through the browser's debugging port
 *   (`withConnectedBrowser`, as session.test.ts does). `browserSession.on("Target.targetCreated")` is
 *   `cdp.browser.subscribe(Target.targetCreated)`, subscribed before discovery starts, and `browserSession.send` is
 *   `Protocol.on(cdp.browser)`.
 * - CR-035 passes `--no-startup-window`, which Playwright passes on every launch that isn't persistent. Strider keeps
 *   Chromium's startup window by default (the decision "Retain Chromium's startup window by default"), and
 *   `Target.setDiscoverTargets` reports an existing window as created, so without the flag the window would be counted
 *   as a page the context made.
 * - The original counts targets after `browser.close()`. Here the context closes with its scope, and a page opened last
 *   is the marker: the stream is read up to that page's creation, so the count can't be taken before an event arrives,
 *   and the marker is the one target reported. The marker's window reports `browser_ui` targets, which the count leaves
 *   out.
 * - CR-033 is `notApplicable` (see the ledger): Playwright refuses its own transport flag in `launchServer`, and Strider
 *   has no server mode to refuse it in.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { Target } from "@usestrider/browser/cdp"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { backend } from "../../../harness/browsers.ts"
import { upstream } from "../../../harness/upstream.ts"

/** The debugging port the browser listens on for the test's connection. */
const debuggingPort = 9443

/** Runs `body` on a Chromium launched with `args` and a debugging port, over a connection of the test's own. */
const withConnectedBrowser = <A, E, R>(
  args: ReadonlyArray<string>,
  body: (cdp: CdpConnection.CdpConnection) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(Effect.gen(function*() {
    const json = yield* Effect.promise(() =>
      fetch(`http://127.0.0.1:${debuggingPort}/json/version`).then((response) => response.json() as Promise<unknown>)
    )
    const { webSocketDebuggerUrl } = Schema.decodeUnknownSync(Schema.Struct({ webSocketDebuggerUrl: Schema.String }))(
      json
    )
    const transport = yield* Transport.webSocket(webSocketDebuggerUrl)
    const cdp = yield* CdpConnection.make(transport)
    return yield* body(cdp)
  })).pipe(
    Effect.provide(Layer.mergeAll(
      NodeSocket.layerWebSocketConstructor,
      backend("chromium", {
        chromium: { args: [`--remote-debugging-port=${debuggingPort}`, ...args] }
      })
    ))
  )

upstream(import.meta.filename, { browsers: ["chromium"] }, (test) => {
  test("CR-034", { page: false }, () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      assert.isDefined(browser)
    }).pipe(
      Effect.provide(backend("chromium", { chromium: { args: ["--remote-debugging-port=0"] } }))
    ))

  test("CR-035", { page: false }, () =>
    withConnectedBrowser(["--no-startup-window"], (cdp) =>
      Effect.gen(function*() {
        const created = yield* cdp.browser.subscribe(Target.targetCreated)
        yield* Target.setDiscoverTargets({ discover: true }).pipe(Protocol.on(cdp.browser))
        yield* Effect.scoped(Browser.newContext())
        // The original counts after `browser.close()`. Here a page opened last is the marker: the browser reports targets
        // in order, so once the stream has reached the marker's creation, it has delivered whatever the context's
        // creation made, and a count taken sooner could pass because an event was still on its way.
        const { targetId } = yield* Target.createTarget({ url: "about:blank" }).pipe(Protocol.on(cdp.browser))
        const reported = yield* created.pipe(
          // The marker's own window brings its `browser_ui` targets, which are neither pages nor the context's
          Stream.filter((event) => event.targetInfo.type !== "browser" && event.targetInfo.type !== "browser_ui"),
          Stream.takeUntil((event) => event.targetInfo.targetId === targetId),
          Stream.runCollect
        )
        assert.deepEqual(reported.map((event) => event.targetInfo.targetId), [targetId])
      })))
})
