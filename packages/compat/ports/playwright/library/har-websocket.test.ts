/**
 * Playwright's `tests/library/har-websocket.spec.ts`: the WebSocket entries a HAR records, their handshake, status and
 * sizes, their frames, and what a route does to them.
 *
 * What the port changes:
 * - Playwright's `recordHar` on a context is `Har.record(page.context, …)`, with `webSocketFrames: true`: Playwright
 *   records WebSocket frames by default, and Strider records them only when asked. Every recording here asks.
 *   `exportHar` writes the file while the page is still open, where Playwright's `getLog` closed the context first;
 *   the recording waits for requests in flight (`inFlightAtStop: "wait"`), as har.test's ports do.
 * - Strider writes a WebSocket's frames embedded on its handshake's entry (`_webSocketMessages`), whatever `content`
 *   says. Playwright's `content: "attach"` writes them to a `.jsonl` file beside the HAR instead, so HA-104 and HA-105
 *   aren't ported (see the ledger). HA-106 (`omit`) keeps the original's assertion that no body file is named; its
 *   frames stay embedded, which the original doesn't check.
 * - Strider's `request.resourceType` is its own `ResourceType` literal, `"webSocket"`, which `_resourceType` carries as
 *   written; the original's `"websocket"` is Playwright's spelling of the same class.
 * - `page.evaluate` runs in the main world, so it's `page.evaluateInMainWorld`. The original's `window.builtins.setTimeout`
 *   is Playwright's injected copy of `setTimeout`; the page here runs no script of its own, so the port calls
 *   `window.setTimeout`.
 * - `page.routeWebSocket` is `page.context.routeWebSocket` (Strider routes WebSockets on a context, as route-web-socket's
 *   ports do), with a glob pattern and the script consent Strider asks for. A mock calls `connection.open`, and a
 *   pass-through `connection.connectToServer`, whose handlers replace Playwright's `onMessage` listeners.
 * - `server.HOST` is the host of `server.PREFIX`. `server.onceWebSocketConnection` and `server.waitForUpgrade` are the
 *   fixture server's, and the sends the original's server makes between delays are forked after the connection, as
 *   the original's handler does.
 * - HA-107's closed port is `net.createServer()` on the loopback, as the original's, and `page.waitForEvent("websocket")`
 *   is `NetworkConnection.next(page, { kind: "webSocket" })`, subscribed before the connection.
 * - HA-110 also opens a socket no route matches, which the HAR must hold: the original's check that the mocked socket
 *   has no entry passes just as well when the recording holds no WebSocket at all.
 * - HA-102 asserts `headersSize`, which Strider doesn't write (it writes -1 for both headers), so that assertion fails.
 *   The port keeps it as written.
 * - The original's `channel === "webkit-wsl"` exemptions are for a Windows-hosted WSL channel that the harness doesn't
 *   run, so every check runs.
 * - HA-112 (`PLAYWRIGHT_HAR_NO_WEBSOCKET_FRAMES`) is `notApplicable` (see the ledger): Playwright's environment variable
 *   switches its HARs' frames off, and Strider's recording takes `webSocketFrames` per recording, default off.
 * - The waits the original holds across steps are `startWaiting`, and the waits of the port's own (the upgrade, a
 *   connection) are bounded with `Effect.timeoutOrElse` under the 30 seconds budget.
 */
import { assert } from "@effect/vitest"
import { Har, NetworkConnection, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as fs from "node:fs"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { startWaiting } from "../../harness/playwright.ts"
import type { ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"
import { routing, text, textOf } from "../../harness/webSocketRouting.ts"

// HAR 1.2 as Strider writes it: the fields these tests read, with Strider's extensions.
interface NameValue {
  readonly name: string
  readonly value: string
}
interface WebSocketMessage {
  readonly type: string
  readonly time: number
  readonly opcode: number
  readonly data: string
}
interface Entry {
  readonly startedDateTime: string
  readonly time: number
  readonly request: {
    readonly url: string
    readonly headersSize: number
    readonly headers: ReadonlyArray<NameValue>
  }
  readonly response: {
    readonly status: number
    readonly statusText: string
    readonly headersSize: number
    readonly headers: ReadonlyArray<NameValue>
    readonly content: { readonly _file?: string }
    readonly _transferSize?: number
    readonly _failureText?: string
  }
  readonly _resourceType?: string
  readonly _webSocketMessages?: ReadonlyArray<WebSocketMessage>
}
interface Log {
  readonly entries: ReadonlyArray<Entry>
}

/** The element at `index`, which the test asserts exists: a missing element fails the test where it's read. */
const nth = <A>(items: ReadonlyArray<A>, index: number): A => {
  const item = items[index]
  if (item === undefined) throw new Error(`no element ${index} of ${items.length}`)
  return item
}

/** The fixture server's host and port, which the page's WebSocket URLs and the HAR's entries name: Playwright's `server.HOST`. */
const hostOf = (server: ServerShape) => new URL(server.PREFIX).host

/** A bound on a wait of the port's own, which names what it waited for when it runs past the bound. */
const bounded = <A, E, R>(effect: Effect.Effect<A, E, R>, what: string) =>
  effect.pipe(Effect.timeoutOrElse({
    duration: "10 seconds",
    orElse: () => Effect.die(new Error(`${what} didn't happen within 10 seconds`))
  }))

/** A scratch directory for one test's exports, removed when the test's scope closes. */
const scratch = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "compat-har-websocket-"))),
  (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
)

/**
 * Records the page's context, with WebSocket frames, as Playwright's `recordHar` does by default. The export waits for
 * requests still in flight, as Playwright's `context.close()` does before it writes the file.
 */
const recording = (page: Page.Page, content: "embed" | "omit") =>
  Har.record(page.context, { content, webSocketFrames: true, inFlightAtStop: "wait" })

/** Exports a recording into the scratch directory and reads its log, as the original's `getLog` does. */
const exportLog = Effect.fnUntraced(function*(har: Har.Recording, directory: string) {
  const file = yield* har.exportHar(path.join(directory, "test.har"))
  return JSON.parse(fs.readFileSync(file, "utf8")).log as Log
})

/** The WebSocket URL of the fixture server's `path`. */
const wsUrlOf = (server: ServerShape, route: string) => `ws://${hostOf(server)}${route}`

/** The size of a header block as the original counts it. */
const headersSize = (headers: ReadonlyArray<NameValue>): number => {
  let result = 0
  for (const header of headers) result += header.name.length + ": ".length + header.value.length + "\r\n".length
  return result
}

const requestHeadersSize = (headers: ReadonlyArray<NameValue>) => "GET /ws HTTP/1.1\r\n".length + headersSize(headers)

const responseHeadersSize = (headers: ReadonlyArray<NameValue>) =>
  "HTTP/1.1 101 Switching Protocols\r\n".length + headersSize(headers) + "\r\n".length

// Browser-reported message times are derived from a wall-clock baseline plus monotonic timestamps in the browser
// process, so they can drift by a few milliseconds relative to Date.now() in the test process.
const clockSkewMs = 100

/** The bytes a frame takes on the wire: its header, and its payload. */
const messageSize = (message: string | ReadonlyArray<number>): number => {
  // The payload is short enough that they only need the minimum frame header size.
  if (message.length <= 125) return 6 + message.length
  // The payload is large enough that additional bytes are needed to represent the payload length.
  if (message.length < 2 ** 16) return 6 + 2 + message.length
  return 6 + 8 + message.length
}

/** The entries of one WebSocket URL, and the one the test expects. */
const entriesFor = (log: Log, url: string) => log.entries.filter((entry) => entry.request.url === url)

/**
 * Sends frames from the fixture server's side of the next connection, the original's `onceWebSocketConnection` handler:
 * the text frames first, then the binary ones, each after the original's 100 ms delay. The connection is awaited in a
 * fiber, so the sends start once the page has connected.
 */
const sendFrames = Effect.fnUntraced(function*(
  server: ServerShape,
  incomingText: ReadonlyArray<string>,
  incomingBinary: ReadonlyArray<ReadonlyArray<number>>
) {
  const connected = yield* server.waitForWebSocket
  yield* Effect.forkScoped(Effect.gen(function*() {
    const peer = yield* connected
    for (const message of incomingText) {
      peer.send(message)
      // The original's own delay between its sends
      yield* Effect.sleep("100 millis")
    }
    for (const message of incomingBinary) {
      yield* Effect.sleep("100 millis")
      peer.send(new Uint8Array(message))
    }
  }))
})

/**
 * Playwright's `testWebSocketMessages`, for the `embed` and `omit` contents: a page exchanges text and binary messages of
 * each size with the server, and the HAR's entry holds their frames, in order, and their sizes.
 */
const testWebSocketMessages = Effect.fnUntraced(function*(
  page: Page.Page,
  server: ServerShape,
  content: "embed" | "omit"
) {
  const directory = yield* scratch
  const incomingText = ["x".repeat(125), "x".repeat(126), "x".repeat(2 ** 16)]
  const incomingBinary = [
    Array.from({ length: 125 }, () => 0x01),
    Array.from({ length: 126 }, () => 0x01),
    Array.from({ length: 2 ** 16 }, () => 0x01)
  ]
  const outgoingText = ["y".repeat(125), "y".repeat(126), "y".repeat(2 ** 16)]
  const outgoingBinary = [
    Array.from({ length: 125 }, () => 0x02),
    Array.from({ length: 126 }, () => 0x02),
    Array.from({ length: 2 ** 16 }, () => 0x02)
  ]
  const incomingCount = incomingText.length + incomingBinary.length
  const delayMs = 100

  yield* sendFrames(server, incomingText, incomingBinary)

  const har = yield* recording(page, content)
  yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })

  const beforeMs = Date.now()
  const wsUrl = wsUrlOf(server, "/ws")
  yield* page.evaluateInMainWorld(
    ({ url, incomingCount, outgoingText, outgoingBinary, delayMs }) =>
      new Promise<void>((resolve) => {
        let count = 0
        const ws = new WebSocket(url)
        ws.addEventListener("message", async () => {
          if (++count < incomingCount) return
          for (const text of outgoingText) {
            ws.send(text)
            // The original's own delay, on the page's `builtins.setTimeout`
            await new Promise((done) => window.setTimeout(done, delayMs))
          }
          for (const binary of outgoingBinary) {
            await new Promise((done) => window.setTimeout(done, delayMs))
            ws.send(new Uint8Array(binary))
          }
          ws.close()
        })
        ws.addEventListener("close", () => resolve())
      }),
    { url: wsUrl, incomingCount, outgoingText, outgoingBinary, delayMs }
  )
  const afterMs = Date.now()

  const log = yield* exportLog(har, directory)
  const wsEntry = nth(entriesFor(log, wsUrl), 0)
  assert.strictEqual(
    wsEntry.response._transferSize,
    responseHeadersSize(wsEntry.response.headers) +
      [...incomingText, ...incomingBinary].reduce((accumulator, current) => accumulator + messageSize(current), 0)
  )
  assert.isAtMost(wsEntry.time, afterMs - beforeMs)

  if (content === "omit") {
    assert.isUndefined(wsEntry.response.content._file)
    return
  }

  const messages = wsEntry._webSocketMessages ?? []
  assert.deepStrictEqual(
    messages.map((m) => ({
      type: m.type,
      opcode: m.opcode,
      data: m.opcode === 1 ? m.data : [...Buffer.from(m.data, "base64")]
    })),
    [
      ...incomingText.map((m) => ({ type: "receive", opcode: 1, data: m })),
      ...incomingBinary.map((m) => ({ type: "receive", opcode: 2, data: m })),
      ...outgoingText.map((m) => ({ type: "send", opcode: 1, data: m })),
      ...outgoingBinary.map((m) => ({ type: "send", opcode: 2, data: m }))
    ]
  )
  for (const m of messages) {
    assert.isAtLeast(m.time, beforeMs - clockSkewMs)
    assert.isAtMost(m.time, afterMs + clockSkewMs)
  }
  assert.isAtMost(nth(messages, 0).time, nth(messages, 1).time)
  assert.isAtLeast(wsEntry.time, nth(messages, messages.length - 1).time - nth(messages, 0).time)
})

upstream(import.meta.filename, {}, (test) => {
  test("HA-101", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.onceWebSocketConnection((peer) => peer.onMessage(() => peer.close()))
      const har = yield* recording(page, "embed")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld((url: string) =>
        new Promise<void>((resolve) => {
          const ws = new WebSocket(url)
          ws.addEventListener("open", () => ws.send("ping"))
          ws.addEventListener("close", () => resolve())
        }), wsUrlOf(server, "/ws"))
      const log = yield* exportLog(har, directory)
      const wsEntries = log.entries.filter((entry) => entry.request.url.endsWith(`://${hostOf(server)}/ws`))
      assert.strictEqual(wsEntries.length, 1)
      // Strider's `ResourceType` names a WebSocket `webSocket`, where the original's `_resourceType` is `websocket`
      assert.strictEqual(nth(wsEntries, 0)._resourceType, "webSocket")
    }))

  test("HA-102", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.onceWebSocketConnection((peer) => peer.onMessage(() => peer.close()))
      const har = yield* recording(page, "embed")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })

      const beforeMs = Date.now()
      const wsUrl = wsUrlOf(server, "/ws")
      yield* page.evaluateInMainWorld((url: string) =>
        new Promise<void>((resolve) => {
          const ws = new WebSocket(url)
          ws.addEventListener("open", () => ws.send("ping"))
          ws.addEventListener("close", () => resolve())
        }), wsUrl)
      const log = yield* exportLog(har, directory)
      const afterMs = Date.now()

      const wsEntry = nth(entriesFor(log, wsUrl), 0)
      assert.strictEqual(wsEntry._resourceType, "webSocket")
      assert.strictEqual(wsEntry.request.headersSize, requestHeadersSize(wsEntry.request.headers))
      assert.strictEqual(wsEntry.response.status, 101)
      assert.strictEqual(wsEntry.response.statusText, "Switching Protocols")
      assert.strictEqual(wsEntry.response.headersSize, responseHeadersSize(wsEntry.response.headers))

      const wallTimeMs = new Date(wsEntry.startedDateTime).getTime()
      assert.isAtLeast(wallTimeMs, beforeMs - clockSkewMs)
      assert.isAtMost(wallTimeMs, afterMs + clockSkewMs)

      const requestHeaderNames = wsEntry.request.headers.map((h) => h.name.toLowerCase())
      assert.include(requestHeaderNames, "upgrade")
      assert.include(requestHeaderNames, "connection")
      assert.include(requestHeaderNames, "sec-websocket-key")
      assert.include(requestHeaderNames, "sec-websocket-version")
      const upgradeHeader = wsEntry.request.headers.find((h) => h.name.toLowerCase() === "upgrade")
      assert.strictEqual(upgradeHeader?.value.toLowerCase(), "websocket")

      const responseHeaderNames = wsEntry.response.headers.map((h) => h.name.toLowerCase())
      assert.include(responseHeaderNames, "upgrade")
      assert.include(responseHeaderNames, "connection")
      assert.include(responseHeaderNames, "sec-websocket-accept")
    }))

  test("HA-103", ({ page, server }) => testWebSocketMessages(page, server, "embed"))

  test("HA-106", ({ page, server }) => testWebSocketMessages(page, server, "omit"))

  test("HA-107", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      // Reserve a port and release it at once, so the WebSocket's connection attempt is refused.
      const port = yield* Effect.promise(() =>
        new Promise<number>((resolve) => {
          const reservation = net.createServer()
          reservation.listen(0, "127.0.0.1", () => {
            const { port } = reservation.address() as net.AddressInfo
            reservation.close(() => resolve(port))
          })
        })
      )
      const har = yield* recording(page, "embed")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })

      const wsUrl = `ws://127.0.0.1:${port}/ws-connect-fail`
      const connected = yield* NetworkConnection.next(page, { kind: "webSocket" })
      yield* page.evaluateInMainWorld((url: string) =>
        new Promise<void>((resolve) => {
          const ws = new WebSocket(url)
          ws.addEventListener("close", () => resolve())
          ws.addEventListener("error", () => resolve())
        }), wsUrl)
      yield* bounded(connected, "the refused WebSocket's connection being reported")
      const log = yield* exportLog(har, directory)

      const wsEntry = nth(entriesFor(log, wsUrl), 0)
      assert.strictEqual(wsEntry._resourceType, "webSocket")
      assert.isTrue(Boolean(wsEntry.response._failureText))
    }))

  test("HA-108", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recording(page, "embed")
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })

      const wsUrl = wsUrlOf(server, "/ws-handshake-fail")
      const upgradePromise = yield* server.waitForUpgrade
      const wsClose = yield* startWaiting(
        page.evaluateInMainWorld((url: string) =>
          new Promise<void>((resolve) => {
            const ws = new WebSocket(url)
            ws.addEventListener("close", () => resolve())
            ws.addEventListener("error", () => resolve())
          }), wsUrl)
      )
      const { socket } = yield* bounded(upgradePromise, "the page's WebSocket upgrade")
      socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
      socket.destroy()
      yield* Fiber.join(wsClose.fiber)
      const log = yield* exportLog(har, directory)

      const wsEntry = nth(entriesFor(log, wsUrl), 0)
      assert.strictEqual(wsEntry._resourceType, "webSocket")
      if (browserName !== "chromium") {
        // Chromium only reports an error instead of giving a status code and text.
        assert.strictEqual(wsEntry.response.status, 403)
        assert.strictEqual(wsEntry.response.statusText, "Forbidden")
      }
      assert.isTrue(Boolean(wsEntry.response._failureText))
    }))

  test("HA-109", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.onceWebSocketConnection((peer) => peer.onMessage(() => peer.send("incoming")))
      const har = yield* recording(page, "embed")
      let routeHandlerCalled = 0
      yield* page.context.routeWebSocket("**/ws", (connection) =>
        Effect.gen(function*() {
          routeHandlerCalled++
          // The pass-through forwards both directions unchanged, as the original's two `onMessage` handlers do.
          yield* connection.connectToServer({})
        }), routing(browserName))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })

      const wsUrl = wsUrlOf(server, "/ws")
      const messages = yield* page.evaluateInMainWorld((url: string) =>
        new Promise<Array<string>>((resolve) => {
          const seen: Array<string> = []
          const ws = new WebSocket(url)
          ws.addEventListener("open", () => ws.send("outgoing"))
          ws.addEventListener("message", (event) => {
            seen.push(event.data)
            ws.close()
          })
          ws.addEventListener("close", () => resolve(seen))
        }), wsUrl)
      assert.strictEqual(routeHandlerCalled, 1)
      assert.deepStrictEqual(messages, ["incoming"])
      const log = yield* exportLog(har, directory)

      const wsEntries = entriesFor(log, wsUrl)
      assert.strictEqual(wsEntries.length, 1)
      const [entry] = wsEntries
      assert.strictEqual(entry?._resourceType, "webSocket")
      assert.strictEqual(entry?.response.status, 101)
      assert.deepStrictEqual(
        (entry?._webSocketMessages ?? []).map((m) => ({ type: m.type, data: m.data })),
        [
          { type: "send", data: "outgoing" },
          { type: "receive", data: "incoming" }
        ]
      )
    }))

  test("HA-110", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recording(page, "embed")
      let routeHandlerCalled = 0
      yield* page.context.routeWebSocket("**/ws", (connection) =>
        Effect.gen(function*() {
          routeHandlerCalled++
          // A mock never connects to the server, so the page's socket is the route's own.
          yield* connection.open({
            fromPage: (message, reply) => textOf(message) === "ping" ? reply.send(text("pong")) : Effect.void
          })
        }), routing(browserName))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })

      const wsUrl = wsUrlOf(server, "/ws")
      const messages = yield* page.evaluateInMainWorld((url: string) =>
        new Promise<Array<string>>((resolve) => {
          const seen: Array<string> = []
          const ws = new WebSocket(url)
          ws.addEventListener("open", () => ws.send("ping"))
          ws.addEventListener("message", (event) => {
            seen.push(event.data)
            ws.close()
          })
          ws.addEventListener("close", () => resolve(seen))
        }), wsUrl)
      assert.strictEqual(routeHandlerCalled, 1)
      assert.deepStrictEqual(messages, ["pong"])
      server.onceWebSocketConnection((peer) => peer.onMessage(() => peer.close()))
      const controlUrl = wsUrlOf(server, "/ws-control")
      yield* page.evaluateInMainWorld((url: string) =>
        new Promise<void>((resolve) => {
          const ws = new WebSocket(url)
          ws.addEventListener("open", () => ws.send("ping"))
          ws.addEventListener("close", () => resolve())
        }), controlUrl)
      const log = yield* exportLog(har, directory)

      // Fully mocked routes never create a native WebSocket, so nothing should be recorded.
      assert.deepStrictEqual(entriesFor(log, wsUrl), [])
      // The control the original lacks: a socket no route matches is recorded in this same HAR, so the empty entry list
      // above means the mock was left out and not that the recording never holds a WebSocket.
      assert.strictEqual(entriesFor(log, controlUrl).length, 1)
    }))

  test("HA-111", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.onceWebSocketConnection((peer) => peer.onMessage((data) => peer.send(`server-saw-${data.toString()}`)))
      const har = yield* recording(page, "embed")
      let routeHandlerCalled = 0
      yield* page.context.routeWebSocket("**/ws", (connection) =>
        Effect.gen(function*() {
          routeHandlerCalled++
          yield* connection.connectToServer({
            fromPage: (message, endpoints) => endpoints.server.send(text(`modified-${textOf(message)}`)),
            fromServer: (message, endpoints) => endpoints.page.send(text(`page-got-${textOf(message)}`))
          })
        }), routing(browserName))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })

      const wsUrl = wsUrlOf(server, "/ws")
      const messages = yield* page.evaluateInMainWorld((url: string) =>
        new Promise<Array<string>>((resolve) => {
          const seen: Array<string> = []
          const ws = new WebSocket(url)
          ws.addEventListener("open", () => ws.send("hello"))
          ws.addEventListener("message", (event) => {
            seen.push(event.data)
            ws.close()
          })
          ws.addEventListener("close", () => resolve(seen))
        }), wsUrl)
      assert.strictEqual(routeHandlerCalled, 1)
      // The page sees the route-modified server response.
      assert.deepStrictEqual(messages, ["page-got-server-saw-modified-hello"])
      const log = yield* exportLog(har, directory)

      // HAR records actual wire traffic from the native WebSocket: outgoing messages are modified by the client-side
      // route handler before they hit the server, and incoming messages are recorded before the server-side route
      // handler modifies them.
      const wsEntries = entriesFor(log, wsUrl)
      assert.strictEqual(wsEntries.length, 1)
      assert.deepStrictEqual(
        (nth(wsEntries, 0)._webSocketMessages ?? []).map((m) => ({ type: m.type, data: m.data })),
        [
          { type: "send", data: "modified-hello" },
          { type: "receive", data: "server-saw-modified-hello" }
        ]
      )
    }))
})
