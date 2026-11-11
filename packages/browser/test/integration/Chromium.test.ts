/**
 * L0 against a real Chromium: both transports, the session lifecycle, and CDP's error table.
 *
 * It runs against the pinned Chromium (`browsers.ts`), in the Nix environment `pnpm test:integration` enters;
 * another version fails it.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Browser from "@usestrider/browser/cdp/Browser"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Runtime from "@usestrider/browser/cdp/Runtime"
import * as Target from "@usestrider/browser/cdp/Target"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as ChildProcess from "effect/process/ChildProcess"
import * as Stream from "effect/Stream"
import * as CdpWire from "../../src/internal/cdpWire.ts"
import * as DevToolsActivePort from "../../src/internal/devToolsActivePort.ts"
import * as ProtocolClient from "../../src/internal/protocolClient.ts"
import { assertPinned, chromium } from "./browsers.ts"
import { fixtures, record } from "./record.ts"

const executable = chromium.executable

// Launching a browser takes a second or two; a test gets thirty.
const timeout = 30_000

/** Launches a headless Chromium with its own profile, removed after the browser exits. */
const launch = Effect.fnUntraced(function*(debugging: "pipe" | "port") {
  const fs = yield* FileSystem.FileSystem
  const userDataDir = yield* fs.makeTempDirectoryScoped({ prefix: "strider-test-" })
  const handle = yield* ChildProcess.make(executable, [
    "--headless",
    "--no-first-run",
    "--no-default-browser-check",
    debugging === "pipe" ? "--remote-debugging-pipe" : "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], {
    additionalFds: debugging === "pipe" ? Transport.pipeFds : {},
    stdout: "ignore",
    stderr: "ignore",
    forceKillAfter: "5 seconds"
  })
  return { handle, userDataDir }
})

const connect = Effect.fnUntraced(function*() {
  const { handle } = yield* launch("pipe")
  const cdp = yield* CdpConnection.make(record(yield* Transport.pipe(handle), CdpWire.wire, fixtures.cdp))
  return { handle, cdp }
})

const openPage = Effect.fnUntraced(function*(cdp: CdpConnection.CdpConnection) {
  const { targetId } = yield* Target.createTarget({ url: "about:blank" }).pipe(Protocol.on(cdp.browser))
  const { sessionId } = yield* Target.attachToTarget({ targetId, flatten: true }).pipe(Protocol.on(cdp.browser))
  return { targetId, sessionId, page: yield* cdp.session(sessionId) }
})

const reasonOf = <A>(exit: Exit.Exit<A, Protocol.ProtocolError>) => {
  assert(Exit.isFailure(exit))
  const error = Cause.findErrorOption(exit.cause)
  assert(error._tag === "Some")
  return error.value.reason
}

describe("Chromium over CDP", () => {
  // The real clock: these tests wait on a real browser.
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect("drives a page over the pipe", () =>
        Effect.gen(function*() {
          const { cdp } = yield* connect()
          const version = yield* Browser.getVersion().pipe(Protocol.on(cdp.browser))
          assert.match(version.product, /Chrome\//)
          assertPinned("Chromium", version.product.split("/")[1] ?? version.product, chromium.version)
          const { page } = yield* openPage(cdp)
          const url = "data:text/html,<title>Strider</title><p>hello</p>"
          const navigated = yield* page.subscribe(Page.frameNavigated)
          const loaded = yield* page.subscribe(Page.loadEventFired)
          yield* Page.enable().pipe(Protocol.on(page))
          yield* Page.navigate({ url }).pipe(Protocol.on(page))
          const frame = yield* navigated.pipe(Stream.filter((event) => event.frame.url === url), Stream.runHead)
          assert(frame._tag === "Some")
          yield* Stream.runHead(loaded)
          const title = yield* Runtime.evaluate({ expression: "document.title", returnByValue: true }).pipe(
            Protocol.on(page)
          )
          assert.strictEqual(title.result.value, "Strider")
        }), timeout)

      it.effect("connects over a WebSocket", () =>
        Effect.gen(function*() {
          const { userDataDir } = yield* launch("port")
          // Chromium writes the port and path it chose once it listens.
          const { port, browserPath } = yield* DevToolsActivePort.read(userDataDir, { timeout: "5 seconds" })
          const closed = yield* Deferred.make<Transport.ConnectionLost>()
          yield* Effect.scoped(Effect.gen(function*() {
            const transport = yield* Transport.webSocket(`ws://127.0.0.1:${port}${browserPath}`)
            const cdp = yield* CdpConnection.make(transport)
            const version = yield* Browser.getVersion().pipe(Protocol.on(cdp.browser))
            assert.match(version.product, /Chrome\//)
            assertPinned("Chromium", version.product.split("/")[1] ?? version.product, chromium.version)
            yield* transport.closed.pipe(Effect.flatMap((lost) => Deferred.succeed(closed, lost)), Effect.forkDetach)
          }))
          assert.strictEqual((yield* Deferred.await(closed)).initiator, "local")
        }), timeout)

      it.effect("fails to connect to an endpoint that isn't listening", () =>
        Effect.gen(function*() {
          const exit = yield* Transport.webSocket("ws://127.0.0.1:9/devtools/browser/none").pipe(Effect.exit)
          assert(Exit.isFailure(exit))
          const error = Cause.findErrorOption(exit.cause)
          assert(error._tag === "Some")
          assert.strictEqual(error.value.reason._tag, "ConnectFailed")
        }), timeout)

      it.effect("ends a target's session when the target closes", () =>
        Effect.gen(function*() {
          const { cdp } = yield* connect()
          const { page, targetId } = yield* openPage(cdp)
          const loaded = yield* page.subscribe(Page.loadEventFired)
          yield* Target.closeTarget({ targetId }).pipe(Protocol.on(cdp.browser))
          assert.strictEqual((yield* page.ended).why, "detached")
          assert.deepInclude(reasonOf(yield* loaded.pipe(Stream.runDrain, Effect.exit)), { _tag: "SessionEnded" })
          assert.strictEqual(reasonOf(yield* Page.enable().pipe(Protocol.on(page), Effect.exit))._tag, "SessionEnded")
        }), timeout)

      it.effect("ends every session when the browser dies", () =>
        Effect.gen(function*() {
          const { cdp, handle } = yield* connect()
          const { page } = yield* openPage(cdp)
          yield* handle.kill({ killSignal: "SIGKILL" })
          const lost = yield* cdp.closed
          assert.strictEqual(lost.initiator, "remote")
          assert.strictEqual((yield* page.ended).why, "connectionLost")
          const late = yield* Browser.getVersion().pipe(Protocol.on(cdp.browser), Effect.exit)
          assert.deepInclude(reasonOf(late), { _tag: "SessionEnded", why: "connectionLost" })
        }), timeout)

      it.effect("lets the browser exit cleanly when the pipe's scope closes", () =>
        Effect.gen(function*() {
          const { handle } = yield* launch("pipe")
          yield* Effect.scoped(Effect.gen(function*() {
            const cdp = yield* CdpConnection.make(record(yield* Transport.pipe(handle), CdpWire.wire, fixtures.cdp))
            yield* Browser.getVersion().pipe(Protocol.on(cdp.browser))
          }))
          assert.strictEqual(yield* handle.exitCode, 0)
        }), timeout)

      it.effect("classifies Chromium's error replies with every row of CDP's table", () =>
        Effect.gen(function*() {
          // Raw replies, read straight off the transport, so the browser answers even what the session would
          // refuse to send.
          const { handle } = yield* launch("pipe")
          const transport = record(yield* Transport.pipe(handle), CdpWire.wire, fixtures.cdp)
          const replies = new Map<number, Deferred.Deferred<Record<string, any>>>()
          yield* transport.messages.pipe(
            Stream.runForEach((text) => {
              const message = JSON.parse(text)
              const reply = replies.get(message.id)
              return reply === undefined ? Effect.void : Deferred.succeed(reply, message)
            }),
            Effect.forkScoped
          )
          let nextId = 1
          const call = Effect.fnUntraced(function*(method: string, params: object, sessionId?: string) {
            const id = nextId++
            const reply = yield* Deferred.make<Record<string, any>>()
            replies.set(id, reply)
            yield* transport.send(JSON.stringify({ id, method, params, sessionId }))
            return yield* Deferred.await(reply)
          })
          const { result: { targetId } } = yield* call("Target.createTarget", { url: "about:blank" })
          const { result: { sessionId } } = yield* call("Target.attachToTarget", { targetId, flatten: true })
          const cases: ReadonlyArray<readonly [string, object, string | undefined]> = [
            ["Nope.nothing", {}, undefined],
            ["Target.createTarget", {}, undefined],
            ["Target.attachToTarget", { targetId: "0".repeat(32), flatten: true }, undefined],
            ["Page.createIsolatedWorld", { frameId: "0".repeat(32) }, sessionId],
            ["DOM.describeNode", { nodeId: 987654 }, sessionId],
            ["Runtime.evaluate", { expression: "1" }, "F".repeat(32)]
          ]
          const rows: Array<ProtocolClient.ErrorMatcher | undefined> = []
          for (const [method, params, session] of cases) {
            const reply = yield* call(method, params, session)
            assert.isDefined(reply["error"], `${method} should fail`)
            rows.push(ProtocolClient.match(CdpWire.errors, reply["error"]))
          }
          // Each case matches its own row, in table order, so every row is still produced by this browser.
          assert.deepStrictEqual(rows, [...CdpWire.errors])
        }), timeout)
    }
  )
})
