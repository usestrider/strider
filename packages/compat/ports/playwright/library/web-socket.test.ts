/**
 * Playwright's `tests/library/web-socket.spec.ts`: a page's WebSockets, what they send and receive, how they close, the
 * handshake's headers, and WebSockets opened in a worker.
 *
 * What the port changes:
 * - `page.on('websocket')` and `page.waitForEvent('websocket')` are `NetworkConnection.next` and `NetworkConnection.stream`
 *   on the page. A connection is reported when the browser opens it, before its handshake completes.
 * - A socket's `framesent` and `framereceived` events are its `frames` stream, which sees only the frames from the
 *   moment it is subscribed. Where the original relies on a frame that crosses at once (the page sends on open, the server
 *   answers on connect), `connectHeld` holds the server's upgrade until the frames are subscribed, then accepts it. Playwright
 *   attaches its listeners the same way, before the page's socket can open.
 * - A frames stream ends when its connection closes, so a test that logs `close` joins the stream first, then reads the
 *   connection's `closed`. A stream that ends with its page or connection ends normally, where Playwright's
 *   `waitForEvent` rejects with "Socket closed" or the target-closed message. WS-009 and WS-010 therefore assert that the
 *   wait ends with no frame, which is the release they check for.
 * - `ws.isClosed()` is `connection.closed`, which gives the close reason; the port asserts `NetworkConnectionClosed`.
 * - Playwright's `page.evaluate` runs in the main world, so it's `page.evaluateInMainWorld`. A test's page globals are
 *   set on `window` by the test's own script, not by the page's.
 * - Playwright's `server.HOST` is `localhost:<port>`, the host of `server.PREFIX`.
 * - `page.setExtraHTTPHeaders` is `page.emulate({ extraHTTPHeaders })`, and `context.setOffline(true)` is
 *   `page.context.emulate({ network: "offline" })`; both last until the test ends, as the original's do.
 * - WS-012 is an `it.fixme` upstream, and the body runs anyway. Its `ws` package server is replaced by the fixture server
 *   (`server.waitForWebSocket`), whose socket the page's own socket connects to.
 * - WS-013 and WS-014 are an `it.fixme` for Chromium before 151. The pinned Chromium is 155, so the condition is false and
 *   the tests run.
 * - WS-005 (the close event's argument is the socket), WS-007, and WS-008 (`socketerror`) aren't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import { NetworkConnection, type Page } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { startWaiting } from "../../harness/playwright.ts"
import type { ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

/** `server.HOST` in Playwright: the host and port of the fixture server, which the page's URLs name. */
const hostOf = (server: ServerShape) => new URL(server.PREFIX).host

/** A frame's text as the original logs it, and `<binary>` for a binary frame. */
const describeFrame = (frame: NetworkConnection.Frame) =>
  `${frame.direction === "sent" ? "sent" : "received"}<${
    frame.payload._tag === "Text" ? frame.payload.text : "<binary>"
  }>`

/** The frames of one direction, from a frames stream: the stream's own filter. */
const sentOnly = (frame: NetworkConnection.Frame) => frame.direction === "sent"
const receivedOnly = (frame: NetworkConnection.Frame) => frame.direction === "received"

/**
 * A WebSocket the page opens with `open`, reported before the server accepts it. The server's upgrade is held until the
 * caller calls `doUpgrade`, so the caller subscribes the connection's frames first; the frames it then sees are all the
 * frames from the handshake's accept on.
 */
const connectHeld = Effect.fnUntraced(function*<E, R>(
  page: Page.Page,
  server: ServerShape,
  open: Effect.Effect<void, E, R>
) {
  const connected = yield* NetworkConnection.next(page, { kind: "webSocket" })
  const upgrade = yield* server.waitForUpgrade
  yield* open
  const held = yield* upgrade
  const connection = yield* connected
  return { connection, doUpgrade: held.doUpgrade }
})

upstream(import.meta.filename, {}, (test) => {
  test("WS-001", ({ page, server }) =>
    Effect.gen(function*() {
      server.sendOnWebSocketConnection("incoming")
      const value = yield* page.evaluateInMainWorld((host: string) => {
        let cb: (value: unknown) => void = () => {}
        const result = new Promise((f) => cb = f)
        const ws = new WebSocket("ws://" + host + "/ws")
        ws.addEventListener("message", (data) => {
          ws.close()
          cb(data.data)
        })
        return result
      }, hostOf(server))
      assert.strictEqual(value, "incoming")
    }))

  test("WS-002", ({ page, server }) =>
    Effect.gen(function*() {
      const connected = yield* NetworkConnection.next(page, { kind: "webSocket" })
      yield* page.evaluateInMainWorld((host: string) => {
        const ws = new WebSocket("ws://" + host + "/ws")
        ws.addEventListener("open", () => ws.close())
      }, hostOf(server))
      const socket = yield* connected
      const log = [`open<${socket.url}>`]
      // `ws.isClosed()` after the close: the connection's close reason is what it says
      const reason = yield* socket.closed
      log.push("close")
      assert.strictEqual(log.join(":"), `open<ws://${hostOf(server)}/ws>:close`)
      assert.strictEqual(reason._tag, "NetworkConnectionClosed")
    }))

  test("WS-003", ({ page, server }) =>
    Effect.gen(function*() {
      server.onceWebSocketConnection((ws) => {
        ws.onMessage(() => ws.send("incoming"))
      })
      const log: Array<string> = ["open"]
      const { connection, doUpgrade } = yield* connectHeld(
        page,
        server,
        page.evaluateInMainWorld((host: string) => {
          const ws = new WebSocket("ws://" + host + "/ws")
          ws.addEventListener("open", () => ws.send("outgoing"))
          ws.addEventListener("message", () => ws.close())
          ;(window as any).ws = ws
        }, hostOf(server))
      )
      const frames = yield* connection.frames
      const seen = yield* Effect.forkChild(
        frames.pipe(Stream.runForEach((frame) => Effect.sync(() => log.push(describeFrame(frame))))),
        { startImmediately: true }
      )
      doUpgrade()
      yield* Fiber.join(seen)
      yield* connection.closed
      log.push("close")
      assert.deepStrictEqual(log, ["open", "sent<outgoing>", "received<incoming>", "close"])
    }))

  test("WS-004", ({ page, server }) =>
    Effect.gen(function*() {
      server.onceWebSocketConnection((ws) => {
        ws.send("incoming")
        ws.onMessage(() => ws.close(1003, "closed by Playwright test-server"))
      })
      const log: Array<string> = ["open"]
      const { connection, doUpgrade } = yield* connectHeld(
        page,
        server,
        page.evaluateInMainWorld((host: string) => {
          const ws = new WebSocket("ws://" + host + "/ws")
          ws.addEventListener("message", () => ws.send("outgoing"))
          ;(window as any).ws = ws
        }, hostOf(server))
      )
      const frames = yield* connection.frames
      const seen = yield* Effect.forkChild(
        frames.pipe(Stream.runForEach((frame) => Effect.sync(() => log.push(describeFrame(frame))))),
        { startImmediately: true }
      )
      doUpgrade()
      yield* Fiber.join(seen)
      yield* connection.closed
      log.push("close")
      assert.deepStrictEqual(log, ["open", "received<incoming>", "sent<outgoing>", "close"])
    }))

  test("WS-006", ({ page, server }) =>
    Effect.gen(function*() {
      const { connection, doUpgrade } = yield* connectHeld(
        page,
        server,
        page.evaluateInMainWorld((host: string) => {
          const ws = new WebSocket("ws://" + host + "/ws")
          ws.addEventListener("open", () => {
            const binary = new Uint8Array(5)
            for (let i = 0; i < 5; ++i) binary[i] = i
            ws.send("text")
            ws.send(binary)
            ws.close()
          })
        }, hostOf(server))
      )
      const frames = yield* connection.frames
      const sent: Array<NetworkConnection.Frame> = []
      const seen = yield* Effect.forkChild(
        frames.pipe(
          Stream.filter(sentOnly),
          Stream.runForEach((frame) => Effect.sync(() => sent.push(frame)))
        ),
        { startImmediately: true }
      )
      doUpgrade()
      yield* Fiber.join(seen)
      // The page closed the socket after its two sends, so the frames end with it
      assert.deepStrictEqual(sent.map((frame) => frame.payload), [
        { _tag: "Text", text: "text" },
        { _tag: "Binary", bytes: new Uint8Array([0, 1, 2, 3, 4]) }
      ])
    }))

  test("WS-009", ({ page, server }) =>
    Effect.gen(function*() {
      server.sendOnWebSocketConnection("incoming")
      const { connection, doUpgrade } = yield* connectHeld(
        page,
        server,
        page.evaluateInMainWorld((host: string) => {
          ;(window as any).ws = new WebSocket("ws://" + host + "/ws")
        }, hostOf(server))
      )
      const received = yield* connection.frames
      const sent = yield* connection.frames
      const incoming = yield* startWaiting(received.pipe(Stream.filter(receivedOnly), Stream.runHead))
      doUpgrade()
      const frame = yield* Fiber.join(incoming.fiber)
      assert.isTrue(Option.isSome(frame))
      // The wait for a sent frame is still open when the page closes the socket. Strider's frames stream ends with the
      // connection, so the wait ends with no frame, where Playwright's rejects.
      const error = yield* startWaiting(sent.pipe(Stream.filter(sentOnly), Stream.runHead))
      yield* page.evaluateInMainWorld(() => (window as any).ws.close())
      assert.isTrue(Option.isNone(yield* Fiber.join(error.fiber)))
    }))

  test("WS-010", ({ page, server }) =>
    Effect.gen(function*() {
      server.sendOnWebSocketConnection("incoming")
      const { connection, doUpgrade } = yield* connectHeld(
        page,
        server,
        page.evaluateInMainWorld((host: string) => {
          ;(window as any).ws = new WebSocket("ws://" + host + "/ws")
        }, hostOf(server))
      )
      const received = yield* connection.frames
      const sent = yield* connection.frames
      const incoming = yield* startWaiting(received.pipe(Stream.filter(receivedOnly), Stream.runHead))
      doUpgrade()
      assert.isTrue(Option.isSome(yield* Fiber.join(incoming.fiber)))
      const error = yield* startWaiting(sent.pipe(Stream.filter(sentOnly), Stream.runHead))
      yield* page.close()
      // The page closed with the socket in it: the frames end with the page, and the wait ends with no frame, where
      // Playwright's rejects with its target-closed message.
      assert.isTrue(Option.isNone(yield* Fiber.join(error.fiber)))
    }))

  test("WS-011", ({ page, server }) =>
    Effect.gen(function*() {
      server.sendOnWebSocketConnection("incoming")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const received = yield* page.evaluateInMainWorld((host: string) => {
        const code = `
      const ws = new WebSocket(${JSON.stringify("ws://" + host + "/ws")});
      ws.addEventListener('message', event => self.postMessage(event.data));
    `
        const worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })))
        return new Promise((resolve) => worker.addEventListener("message", (event) => resolve(event.data)))
      }, hostOf(server))
      assert.strictEqual(received, "incoming")
      // Opening a WebSocket inside a worker must not tear down the page session.
      assert.strictEqual(yield* page.evaluateInMainWorld(() => 1 + 1), 2)
    }))

  test("WS-012", ({ page, server }) =>
    Effect.gen(function*() {
      // The original is `it.fixme()`: upstream runs its body, and so does the port.
      const connected = yield* server.waitForWebSocket
      yield* page.evaluateInMainWorld(async (host: string) => {
        ;(window as any).ws = new WebSocket(`ws://${host}/ws`)
        await new Promise((x) => (window as any).ws.onopen = x)
      }, hostOf(server))
      const socket = yield* connected
      const failure = yield* Deferred.make<string>()
      socket.onMessage((data) => Deferred.doneUnsafe(failure, Effect.succeed(data.toString())))
      const closed = yield* startWaiting(page.evaluateInMainWorld(async () => {
        const ws = (window as any).ws as WebSocket
        if (ws.readyState !== WebSocket.CLOSED) await new Promise((x) => ws.onclose = x)
        return "successfully closed"
      }))
      yield* page.context.emulate({ network: "offline" })
      yield* page.evaluateInMainWorld(() => (window as any).ws.send("if this arrives it failed"))
      // Neither outcome can be left to the test's outer bound: the page's socket closes, or the server's message arrives.
      const result = yield* Effect.race(Deferred.await(failure), Fiber.join(closed.fiber)).pipe(
        Effect.timeoutOrElse({
          duration: "3 seconds",
          orElse: () =>
            Effect.die(
              new Error(
                "the page's WebSocket neither closed nor delivered its message within 3 seconds of going offline"
              )
            )
        })
      )
      assert.strictEqual(result, "successfully closed")
    }))

  test("WS-013", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's fixme applies to Chromium before 151; the pinned Chromium is 155, so it runs.
      yield* page.emulate({ extraHTTPHeaders: { foo: "bar" } })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* server.waitForWebSocket
      yield* page.evaluateInMainWorld((host: string) => {
        new WebSocket(`ws://${host}/ws`)
      }, hostOf(server))
      const peer = yield* request
      assert.strictEqual(peer.request.headers["foo"], "bar")
    }))

  test("WS-014", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's fixme applies to Chromium before 151; the pinned Chromium is 155, so it runs.
      yield* page.emulate({ extraHTTPHeaders: { foo: "bar" } })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const request = yield* server.waitForWebSocket
      yield* page.evaluateInMainWorld((host: string) => {
        const code = `new WebSocket(${JSON.stringify("ws://" + host + "/ws")});`
        new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })))
      }, hostOf(server))
      const peer = yield* request
      assert.strictEqual(peer.request.headers["foo"], "bar")
    }))
})
