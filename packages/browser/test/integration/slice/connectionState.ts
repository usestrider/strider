/**
 * The browser's connection state, through the public API: `closed` says why the connection ended, after the
 * browser's process is killed and after `close`; `isConnected` turns false with it; and `close` on a browser the
 * test started and attached to ends the browser itself, for every client. Where the capability table says the
 * backend can't close its browser (`browser.close`), the refusal is checked instead, and the browser stays connected.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, it } from "@effect/vitest"
import { Browser, Target } from "@usestrider/browser"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import type * as Scope from "effect/Scope"
import type * as Socket from "effect/socket/Socket"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import * as DevToolsActivePort from "../../../src/internal/devToolsActivePort.ts"
import * as FirefoxLauncher from "../../../src/internal/firefoxLauncher.ts"
import * as Launch from "../../../src/internal/launch.ts"
import { chromium, firefox } from "../browsers.ts"
import { supports } from "./capabilities.ts"

const timeout = 60_000

/** A browser the test started: the endpoint to attach to, and its process. */
export interface Started {
  readonly endpoint: string
  readonly process: ChildProcessSpawner.ChildProcessHandle
}

/** How a backend's browser is started for attaching, and the layer that attaches to it. */
export interface Startable {
  readonly start: Effect.Effect<
    Started,
    unknown,
    Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
  >
  readonly attach: (endpoint: string) => Layer.Layer<Browser.Browser, unknown, Socket.WebSocketConstructor>
}

/** Chromium with a debugging port, attached through its HTTP endpoint. */
export const chromiumStartable = (
  attach: (endpoint: string) => Layer.Layer<Browser.Browser, unknown, Socket.WebSocketConstructor>
): Startable => ({
  attach,
  start: Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "strider-connection-" })
    const launched = yield* Launch.spawn(chromium.executable, ChromiumLauncher.argsFor({}, dir, "port"), dir, {})
    const { port } = yield* DevToolsActivePort.read(dir, { timeout: "10 seconds" })
    return { endpoint: `http://127.0.0.1:${port}`, process: launched.handle }
  })
})

/** Firefox with its remote agent, attached through its BiDi WebSocket. */
export const firefoxStartable = (
  attach: (endpoint: string) => Layer.Layer<Browser.Browser, unknown, Socket.WebSocketConstructor>
): Startable => ({
  attach,
  start: Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "strider-connection-" })
    yield* fs.writeFileString(`${dir}/user.js`, FirefoxLauncher.userJs(FirefoxLauncher.profilePrefs.automation))
    const launched = yield* Launch.spawn(
      firefox.executable,
      ["--headless", "--remote-debugging-port=0", "--no-remote", "--profile", dir, "about:blank"],
      dir,
      {}
    )
    const listening = yield* launched.stderrLine(/WebDriver BiDi listening on (ws:\/\/\S+)/)
    return { endpoint: Option.getOrThrow(listening)[1]!, process: launched.handle }
  })
})

/** The reason a refused `close` gave, as a `BrowserError`'s. */
const refusal = <A, E>(exit: Exit.Exit<A, E>) => {
  const error = Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined
  return Browser.isBrowserError(error) ? error.reason : undefined
}

/** Whether the process has exited, within ten seconds. */
const exits = (process: ChildProcessSpawner.ChildProcessHandle) =>
  process.exitCode.pipe(Effect.timeoutOption("10 seconds"), Effect.map(Option.isSome))

export const connectionState = <E>(
  name: string,
  launched: Layer.Layer<Browser.Browser, E>,
  startable: Startable,
  provide: Layer.Layer<never, unknown> = Layer.empty
) => {
  const attached = (endpoint: string) =>
    startable.attach(endpoint).pipe(Layer.provide(Layer.mergeAll(NodeSocket.layerWebSocketConstructor, provide)))

  describe(`connection state (${name})`, () => {
    it.live("a browser whose process is killed reports the connection lost", () =>
      Effect.gen(function*() {
        const { endpoint, process } = yield* startable.start
        yield* Effect.gen(function*() {
          const browser = yield* Browser.Browser
          assert.isTrue(yield* browser.isConnected)
          if (!(yield* supports("browser.close"))) {
            // A browser the backend can't close is refused, and stays connected
            const reason = refusal(yield* Effect.exit(browser.close))
            assert.strictEqual(reason?._tag, "Unsupported")
            assert.strictEqual(reason?._tag === "Unsupported" ? reason.capability : undefined, "browser.close")
            assert.isTrue(yield* browser.isConnected)
          }
          yield* process.kill({ killSignal: "SIGKILL" })
          const reason = yield* browser.closed
          assert.deepStrictEqual(reason, new Target.ConnectionLost({}) satisfies Target.CloseReason)
          assert.isFalse(yield* browser.isConnected)
        }).pipe(Effect.provide(attached(endpoint)))
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)), timeout)

    it.live("close ends a launched browser and its pages", () =>
      Effect.gen(function*() {
        const browser = yield* Browser.Browser
        if (!(yield* supports("browser.close"))) {
          assert.strictEqual(refusal(yield* Effect.exit(browser.close))?._tag, "Unsupported")
          assert.isTrue(yield* browser.isConnected)
          return
        }
        const page = yield* browser.newPage()
        yield* browser.close
        assert.deepStrictEqual(yield* browser.closed, new Target.BrowserClosed({}) satisfies Target.CloseReason)
        assert.deepStrictEqual(yield* page.closed, new Target.BrowserClosed({}) satisfies Target.CloseReason)
        assert.isFalse(yield* browser.isConnected)
        // Closing again has nothing left to do
        yield* browser.close
      }).pipe(Effect.scoped, Effect.provide(launched)), timeout)

    it.live("close on an attached browser ends it for every client", () =>
      Effect.gen(function*() {
        const { endpoint, process } = yield* startable.start
        const first = yield* Layer.build(attached(endpoint))
        const browser = Context.get(first, Browser.Browser)
        if (!(yield* supports("browser.close").pipe(Effect.provideContext(first)))) return
        // Firefox takes one session at a time, so a second client is only possible where the browser allows it
        const second = name.startsWith("Chromium")
          ? Option.some(Context.get(yield* Layer.build(attached(endpoint)), Browser.Browser))
          : Option.none()
        yield* browser.close
        assert.deepStrictEqual(yield* browser.closed, new Target.BrowserClosed({}) satisfies Target.CloseReason)
        if (Option.isSome(second)) {
          assert.deepStrictEqual(yield* second.value.closed, new Target.ConnectionLost({}) satisfies Target.CloseReason)
          assert.isFalse(yield* second.value.isConnected)
        }
        assert.isTrue(yield* exits(process), "the browser's process exited")
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)), timeout)
  })
}
