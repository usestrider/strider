/**
 * Playwright's `tests/library/route-web-socket.spec.ts`: a page's WebSockets, mocked, passed through, or changed by a
 * route, and what the page, the route, and the server each see.
 *
 * What the port changes:
 * - Strider routes WebSockets on a browser context (`page.context.routeWebSocket`); it has no page-level route. Each
 *   test here has one page in a context of its own, so the routes are registered on `page.context`. WS-032 asks which
 *   of a page's routes and its context's wins, which needs the page-level route, so it isn't ported (see the ledger).
 * - Routes take a glob or a `URLPattern`, not a RegExp: `/.*\/ws$/` is `"**\/ws"`, `/zzz/` is `"**zzz**"`, and `/.*\/`
 *   is `"**"`.
 * - Strider's script routing asks for consent (`implementation: "script"`), and WebKit takes `bestEffort` timing
 *   only, so every route passes both (`routing`).
 * - A route decides explicitly: a mock calls `connection.open`, a pass-through `connection.connectToServer`. A route
 *   that decides nothing makes the page's socket fail, which WS-034 exposes. Playwright's `connectToServer()` returns
 *   at once, where Strider's returns once the server has accepted the connection; a test that needs the connection
 *   waits for that through a `Deferred`.
 * - `route.send`, `route.close`, `route.onMessage`, and `route.onClose` are `connection.page` (the page's side) and
 *   the `fromPage` and `fromServer` handlers, and `route.status` for closes. Messages are Strider's `Message` values,
 *   so a string is `text(...)`.
 * - Playwright's `page.evaluate` is `page.evaluateInMainWorld`. A frame has no `evaluate` in Strider, so a frame's
 *   script runs in the page's main world through the iframe's `contentWindow`, which is same-origin here. `frame.goto`
 *   is the iframe's `src` set and its load awaited; `detachFrame` removes the element in the main world.
 * - The server side is the fixture server's `WebSocketPeer`. Playwright's `server.HOST` is `hostOf(server)`.
 * - `expect.poll` is `Expect.that`; `expect(x).toEqual(y)` is `assert.deepStrictEqual`; `expect.stringMatching` is
 *   `assert.match`. `withResolvers` is a `Deferred`, and a listener Playwright attaches with `once` is a fiber started
 *   before the page sends.
 * - The original's skips for Firefox (WS-019) and WebKit (WS-018) aren't Strider's, so those tests run everywhere.
 * - WS-040 reads the requested subprotocols on the server's side from the upgrade request the server received.
 *   Strider's `Server` reports the protocol the server chose, not the requested list.
 */
import { assert } from "@effect/vitest"
import { Condition, Expect, type Page, WebSocketRoute } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { attachFrame, failureOf, startWaiting } from "../../harness/playwright.ts"
import type { ServerShape, WebSocketPeer } from "../../harness/server.ts"
import { type Fixtures, upstream } from "../../harness/upstream.ts"
import { routing, text, textOf } from "../../harness/webSocketRouting.ts"

/** The globals the original's tests set up in the page, read in the main world of the page or of one of its frames. */
interface Shared {
  ws: WebSocket
  ws1: WebSocket
  ws2: WebSocket
  wsNone: WebSocket
  wsString: WebSocket
  wsArray: WebSocket
  wsOpened: Promise<void>
  log: Array<string>
  // The frame's own constructors: a frame's sockets and blobs are its realm's, not the page's
  WebSocket: typeof WebSocket
  Blob: typeof Blob
}

type Variant = "no-mock" | "no-match" | "pass-through"
const variants: ReadonlyArray<Variant> = ["no-mock", "no-match", "pass-through"]

/** `server.HOST` in Playwright: the host and port of the fixture server, which the page's URLs and messages name. */
const hostOf = (server: ServerShape) => new URL(server.PREFIX).host

/** Playwright's `expect.poll(…).toEqual(value)`: a read that holds the expected value, compared in its JSON form. */
const equals = (expected: unknown) =>
  Condition.make(
    `equal ${JSON.stringify(expected)}`,
    (value: unknown) => JSON.stringify(value) === JSON.stringify(expected)
  )

/** `window.ws.readyState` in the page, or in the frame named `frameId` (`null` for the page). */
const readyState = (page: Page.Page, frameId: string | null) =>
  page.evaluateInMainWorld((frameId: string | null) => {
    const win = (frameId === null
      ? window
      : (document.getElementById(frameId) as HTMLIFrameElement).contentWindow) as unknown as Shared
    return win.ws.readyState
  }, frameId)

/** The page's (or the frame's) log of socket events, as the original's `window.log`. */
const logOf = (page: Page.Page, frameId: string | null) =>
  page.evaluateInMainWorld((frameId: string | null) => {
    const win = (frameId === null
      ? window
      : (document.getElementById(frameId) as HTMLIFrameElement).contentWindow) as unknown as Shared
    return [...win.log]
  }, frameId)

/** Playwright's `frame.goto(url)`: the iframe navigates to `url` and the call waits for its load. */
const navigateFrame = (page: Page.Page, frameId: string, url: string) =>
  page.evaluateInMainWorld(
    async (frameId: string, url: string) => {
      const frame = document.getElementById(frameId) as HTMLIFrameElement
      const loaded = new Promise<void>((resolve) => frame.onload = () => resolve())
      frame.src = url
      await loaded
    },
    frameId,
    url
  )

interface SetupOptions {
  readonly protocols?: string | Array<string> | undefined
  readonly relativeURL?: boolean | undefined
  readonly frameId?: string | undefined
}

/**
 * Playwright's `setupWS`: loads the empty page (or the frame's), then builds the page's WebSocket in its main world,
 * with the listeners the original's log records.
 */
const setupWS = Effect.fnUntraced(function*(
  page: Page.Page,
  server: ServerShape,
  binaryType: "blob" | "arraybuffer",
  options: SetupOptions = {}
) {
  if (options.frameId === undefined) yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
  else yield* navigateFrame(page, options.frameId, server.EMPTY_PAGE)
  const wsUrl = options.relativeURL === true ? "/ws" : `ws://${hostOf(server)}/ws`
  yield* page.evaluateInMainWorld(
    (
      wsUrl: string,
      binaryType: "blob" | "arraybuffer",
      protocols: string | Array<string> | null,
      frameId: string | null
    ) => {
      const win = (frameId === null
        ? window
        : (document.getElementById(frameId) as HTMLIFrameElement).contentWindow) as unknown as Shared
      win.log = []
      win.ws = protocols === null ? new win.WebSocket(wsUrl) : new win.WebSocket(wsUrl, protocols)
      win.ws.binaryType = binaryType
      win.ws.addEventListener("open", () => win.log.push("open"))
      win.ws.addEventListener(
        "close",
        (event) => win.log.push(`close code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`)
      )
      win.ws.addEventListener("error", () => win.log.push("error"))
      win.ws.addEventListener("message", async (event) => {
        let data: string
        if (typeof event.data === "string") data = event.data
        else if (event.data instanceof win.Blob) data = "blob:" + await event.data.text()
        else data = "arraybuffer:" + await new win.Blob([event.data]).text()
        win.log.push(`message: data=${data} origin=${event.origin} lastEventId=${event.lastEventId}`)
      })
      win.wsOpened = new Promise<void>((resolve) => win.ws.addEventListener("open", () => resolve()))
    },
    wsUrl,
    binaryType,
    options.protocols ?? null,
    options.frameId ?? null
  )
})

/** Playwright's `page.routeWebSocket(…)` for one of the three modes the original runs every test in. */
const setupMock = Effect.fnUntraced(function*(
  page: Page.Page,
  variant: Variant,
  browserName: Fixtures["browserName"]
) {
  if (variant === "no-mock") return
  if (variant === "no-match") {
    // Playwright's `/zzz/` matches no URL these tests open
    yield* page.context.routeWebSocket("**zzz**", () => Effect.void, routing(browserName))
  } else {
    yield* page.context.routeWebSocket(
      "**",
      (connection) => connection.connectToServer({}).pipe(Effect.asVoid),
      routing(browserName)
    )
  }
})

/**
 * A route that connects to the server and hands the connection to the test. Playwright's `connectToServer()` returns
 * at once; Strider's returns once the server accepts, so the test receives the connection then.
 */
const connectAndRecord =
  (routed: Deferred.Deferred<WebSocketRoute.Connection>) => (connection: WebSocketRoute.Connection) =>
    connection.connectToServer({}).pipe(Effect.andThen(Deferred.succeed(routed, connection)), Effect.asVoid)

/** The next message the peer gets, as Playwright's `new Promise(f => ws.once('message', …))`. */
const nextMessage = (peer: WebSocketPeer) =>
  Effect.callback<string>((resume) => {
    peer.onMessage((data) => resume(Effect.succeed(data.toString())))
  })

/** The close the peer sees, as Playwright's `ws.once('close', …)`. */
const closeOf = (peer: WebSocketPeer) =>
  Effect.callback<{ readonly code: number; readonly reason: string }>((resume) => {
    peer.onClose((code, reason) => resume(Effect.succeed({ code, reason })))
  })

const messageLine = (server: ServerShape, data: string, kind = "") =>
  `message: data=${kind}${data} origin=ws://${hostOf(server)} lastEventId=`

upstream(import.meta.filename, {}, (test) => {
  for (const variant of variants) {
    test(
      "WS-015",
      { variant },
      ({ page, server, browserName }) =>
        Effect.gen(function*() {
          yield* setupMock(page, variant, browserName)
          const wsPromise = yield* server.waitForWebSocket
          const upgradePromise = yield* server.waitForUpgrade
          yield* setupWS(page, server, "blob")
          assert.strictEqual(yield* readyState(page, null), 0)
          const { doUpgrade } = yield* upgradePromise
          assert.strictEqual(yield* readyState(page, null), 0)
          assert.deepStrictEqual(yield* logOf(page, null), [])
          doUpgrade()
          yield* Expect.that(readyState(page, null), equals(1))
          assert.deepStrictEqual(yield* logOf(page, null), ["open"])
          const ws = yield* wsPromise
          ws.send("hello")
          yield* Expect.that(
            logOf(page, null),
            equals(["open", messageLine(server, "hello")])
          )
          assert.strictEqual(yield* readyState(page, null), 1)
          const reply = yield* startWaiting(nextMessage(ws))
          yield* page.evaluateInMainWorld(() => (window as unknown as Shared).ws.send("hi"))
          assert.strictEqual(yield* Fiber.join(reply.fiber), "hi")
          ws.close(1008, "oops")
          yield* Expect.that(readyState(page, null), equals(3))
          assert.deepStrictEqual(yield* logOf(page, null), [
            "open",
            messageLine(server, "hello"),
            "close code=1008 reason=oops wasClean=true"
          ])
        })
    )

    test(
      "WS-016",
      { variant },
      ({ page, server, browserName }) =>
        Effect.gen(function*() {
          yield* setupMock(page, variant, browserName)
          const wsPromise = yield* server.waitForWebSocket
          yield* setupWS(page, server, "blob")
          const ws = yield* wsPromise
          ws.send(Buffer.from("hi"))
          yield* Expect.that(
            logOf(page, null),
            equals(["open", messageLine(server, "hi", "blob:")])
          )
          const reply = yield* startWaiting(nextMessage(ws))
          yield* page.evaluateInMainWorld(() =>
            (window as unknown as Shared).ws.send(new Blob([new Uint8Array(["h".charCodeAt(0), "i".charCodeAt(0)])]))
          )
          assert.strictEqual(yield* Fiber.join(reply.fiber), "hi")
        })
    )

    test(
      "WS-017",
      { variant },
      ({ page, server, browserName }) =>
        Effect.gen(function*() {
          yield* setupMock(page, variant, browserName)
          const wsPromise = yield* server.waitForWebSocket
          yield* setupWS(page, server, "arraybuffer")
          const ws = yield* wsPromise
          ws.send(Buffer.from("hi"))
          yield* Expect.that(
            logOf(page, null),
            equals(["open", messageLine(server, "hi", "arraybuffer:")])
          )
          const reply = yield* startWaiting(nextMessage(ws))
          yield* page.evaluateInMainWorld(() =>
            (window as unknown as Shared).ws.send(new Uint8Array(["h".charCodeAt(0), "i".charCodeAt(0)]).buffer)
          )
          assert.strictEqual(yield* Fiber.join(reply.fiber), "hi")
        })
    )

    test(
      "WS-018",
      { variant },
      ({ page, server, browserName }) =>
        Effect.gen(function*() {
          yield* setupMock(page, variant, browserName)
          const upgradePromise = yield* server.waitForUpgrade
          yield* setupWS(page, server, "blob")
          const { socket } = yield* upgradePromise
          assert.strictEqual(yield* readyState(page, null), 0)
          assert.deepStrictEqual(yield* logOf(page, null), [])
          socket.destroy()
          yield* Expect.that(readyState(page, null), equals(3))
          const log = yield* logOf(page, null)
          assert.strictEqual(log.length, 2)
          assert.strictEqual(log[0], "error")
          assert.match(log[1]!, /^close code=\d+ reason= wasClean=false$/)
        })
    )

    test(
      "WS-019",
      { variant },
      ({ page, server, browserName }) =>
        Effect.gen(function*() {
          yield* setupMock(page, variant, browserName)
          const upgradePromise = yield* server.waitForUpgrade
          yield* setupWS(page, server, "blob")
          const { socket, doUpgrade } = yield* upgradePromise
          doUpgrade()
          yield* Expect.that(readyState(page, null), equals(1))
          assert.deepStrictEqual(yield* logOf(page, null), ["open"])
          socket.write("garbage")
          yield* Expect.that(readyState(page, null), equals(3))
          const log = yield* logOf(page, null)
          assert.strictEqual(log.length, 3)
          assert.deepStrictEqual(log.slice(0, 2), ["open", "error"])
          assert.match(log[2]!, /^close code=\d+ reason= wasClean=false$/)
        })
    )

    test(
      "WS-020",
      { variant },
      ({ page, server, browserName }) =>
        Effect.gen(function*() {
          yield* setupMock(page, variant, browserName)
          const wsPromise = yield* server.waitForWebSocket
          const upgradePromise = yield* server.waitForUpgrade
          yield* setupWS(page, server, "blob")
          assert.strictEqual(yield* readyState(page, null), 0)
          const { doUpgrade } = yield* upgradePromise
          assert.strictEqual(yield* readyState(page, null), 0)
          assert.deepStrictEqual(yield* logOf(page, null), [])
          doUpgrade()
          yield* Expect.that(readyState(page, null), equals(1))
          assert.deepStrictEqual(yield* logOf(page, null), ["open"])
          const ws = yield* wsPromise
          const closed = yield* startWaiting(closeOf(ws))
          const state = yield* page.evaluateInMainWorld(() => {
            const globals = window as unknown as Shared
            globals.ws.close(3002, "oops")
            return globals.ws.readyState
          })
          assert.strictEqual(state, 2)
          yield* Expect.that(readyState(page, null), equals(3))
          assert.deepStrictEqual(yield* logOf(page, null), ["open", "close code=3002 reason=oops wasClean=true"])
          assert.deepStrictEqual(yield* Fiber.join(closed.fiber), { code: 3002, reason: "oops" })
        })
    )

    test(
      "WS-021",
      { variant },
      ({ page, server, browserName }) =>
        Effect.gen(function*() {
          yield* setupMock(page, variant, browserName)
          yield* setupWS(page, server, "blob", { protocols: "my-custom-protocol" })
          yield* page.evaluateInMainWorld(() => (window as unknown as Shared).wsOpened)
          const protocol = yield* page.evaluateInMainWorld(() => (window as unknown as Shared).ws.protocol)
          assert.strictEqual(protocol, "my-custom-protocol")
        })
    )

    test(
      "WS-022",
      { variant },
      ({ page, server, browserName }) =>
        Effect.gen(function*() {
          yield* setupMock(page, variant, browserName)
          const wsPromise = yield* server.waitForWebSocket
          yield* setupWS(page, server, "blob", { relativeURL: true })
          const ws = yield* wsPromise
          ws.send(Buffer.from("hi"))
          yield* Expect.that(
            logOf(page, null),
            equals(["open", messageLine(server, "hi", "blob:")])
          )
          const reply = yield* startWaiting(nextMessage(ws))
          yield* page.evaluateInMainWorld(() =>
            (window as unknown as Shared).ws.send(new Blob([new Uint8Array(["h".charCodeAt(0), "i".charCodeAt(0)])]))
          )
          assert.strictEqual(yield* Fiber.join(reply.fiber), "hi")
        })
    )
  }

  test("WS-023", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const routed = yield* Deferred.make<WebSocketRoute.Connection>()
      yield* page.context.routeWebSocket("**", connectAndRecord(routed), routing(browserName))
      const wsPromise = yield* server.waitForWebSocket
      yield* setupWS(page, server, "blob")
      const ws = yield* wsPromise
      const route = yield* Deferred.await(routed)
      yield* route.page.send(text("hello"))
      yield* Expect.that(
        logOf(page, null),
        equals(["open", messageLine(server, "hello")])
      )
      const closed = yield* startWaiting(closeOf(ws))
      yield* route.page.close({ code: 3009, reason: "oops" })
      yield* Expect.that(
        logOf(page, null),
        equals(["open", messageLine(server, "hello"), "close code=3009 reason=oops wasClean=true"])
      )
      assert.deepStrictEqual(yield* Fiber.join(closed.fiber), { code: 3009, reason: "oops" })
    }))

  test("WS-024", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      // Playwright's `serverRoute.onClose` is the server side's `Closed` event; the page's close is the route's
      const serverCloses: Array<{ readonly code: number; readonly reason: string }> = []
      let routeHandlerInvoked = 0
      yield* page.context.routeWebSocket("**", (connection) =>
        Effect.gen(function*() {
          routeHandlerInvoked++
          const events = yield* connection.events
          yield* events.pipe(
            Stream.runForEach((event) => {
              if (event._tag !== "Closed" || event.direction !== "server") return Effect.void
              serverCloses.push({ code: event.code, reason: event.reason })
              return connection.page.close().pipe(Effect.ignore)
            }),
            Effect.forkScoped
          )
          yield* connection.connectToServer({})
        }), routing(browserName))
      const upgradePromise = yield* server.waitForUpgrade
      yield* setupWS(page, server, "blob")
      const { socket } = yield* upgradePromise
      socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
      socket.destroy()
      // Server-side route handler observes the close caused by the rejected handshake.
      yield* Expect.that(Effect.sync(() => serverCloses.length), equals(1))
      assert.isAtLeast(serverCloses[0]!.code, 1000)
      // Once the route closes the page-side socket, the page sees the close.
      yield* Expect.that(readyState(page, null), equals(3))
      assert.strictEqual(routeHandlerInvoked, 1)
    }))

  test("WS-025", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      let routedConnections = 0
      yield* page.context.routeWebSocket("**", (connection) =>
        Effect.gen(function*() {
          routedConnections++
          // Both directions forward by default, as the original's explicit `onMessage` handlers do.
          yield* connection.connectToServer({})
        }), routing(browserName))

      // Echo all incoming messages on whichever connection arrives; re-register after each.
      const handleConnection = (peer: WebSocketPeer): void => {
        peer.onMessage((data) => peer.send(`echo-${data.toString()}`))
        server.onceWebSocketConnection(handleConnection)
      }
      server.onceWebSocketConnection(handleConnection)

      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const results = yield* page.evaluateInMainWorld((host: string) => {
        const collect = (tag: string) =>
          new Promise<string>((resolve) => {
            const ws = new WebSocket(`ws://${host}/ws`)
            ws.addEventListener("open", () => ws.send(`hi-${tag}`))
            ws.addEventListener("message", (event) => {
              resolve(event.data)
              ws.close()
            })
          })
        return Promise.all([collect("a"), collect("b")])
      }, hostOf(server))

      assert.deepStrictEqual([...results].sort(), ["echo-hi-a", "echo-hi-b"])
      assert.strictEqual(routedConnections, 2)
    }))

  test("WS-026", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      // Playwright's `/.*\/ws$/`
      yield* page.context.routeWebSocket(
        "**/ws",
        (connection) => connection.connectToServer({}).pipe(Effect.asVoid),
        routing(browserName)
      )
      yield* page.context.routeWebSocket("**/mock-ws", (connection) =>
        connection.open({
          fromPage: (_message, reply) => reply.send(text("mock-response"))
        }), routing(browserName))

      const wsPromise = yield* server.waitForWebSocket

      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld((host: string) => {
        const globals = window as unknown as Shared
        globals.log = []
        globals.ws1 = new WebSocket("ws://" + host + "/ws")
        globals.ws1.addEventListener("message", (event) => globals.log.push(`ws1:${event.data}`))
        globals.ws2 = new WebSocket("ws://" + host + "/something/something/mock-ws")
        globals.ws2.addEventListener("message", (event) => globals.log.push(`ws2:${event.data}`))
        return Promise.all([
          new Promise<void>((resolve) => globals.ws1.addEventListener("open", () => resolve())),
          new Promise<void>((resolve) => globals.ws2.addEventListener("open", () => resolve()))
        ])
      }, hostOf(server))

      const ws = yield* wsPromise
      ws.onMessage(() => ws.send("response"))

      yield* page.evaluateInMainWorld(() => (window as unknown as Shared).ws1.send("request"))
      yield* Expect.that(logOf(page, null), equals(["ws1:response"]))

      yield* page.evaluateInMainWorld(() => (window as unknown as Shared).ws2.send("request"))
      yield* Expect.that(logOf(page, null), equals(["ws1:response", "ws2:mock-response"]))
    }))

  test("WS-027", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const routed = yield* Deferred.make<WebSocketRoute.Connection>()
      yield* page.context.routeWebSocket("**", (connection) =>
        Effect.gen(function*() {
          const serverRoute = yield* connection.connectToServer({
            fromPage: (message, endpoints) => {
              switch (textOf(message)) {
                case "to-respond":
                  return endpoints.page.send(text("response"))
                case "to-block":
                  return Effect.void
                case "to-modify":
                  return endpoints.server.send(text("modified"))
                default:
                  return endpoints.server.send(message)
              }
            },
            fromServer: (message, endpoints) => {
              switch (textOf(message)) {
                case "to-block":
                  return Effect.void
                case "to-modify":
                  return endpoints.page.send(text("modified"))
                default:
                  return endpoints.page.send(message)
              }
            }
          })
          yield* serverRoute.send(text("fake"))
          yield* Deferred.succeed(routed, connection)
        }), routing(browserName))

      const wsPromise = yield* server.waitForWebSocket
      const log: Array<string> = []
      server.onceWebSocketConnection((peer) => {
        peer.onMessage((data) => log.push(`message: ${data.toString()}`))
        peer.onClose((code, reason) => log.push(`close: code=${code} reason=${reason}`))
      })

      yield* setupWS(page, server, "blob")
      const ws = yield* wsPromise
      yield* Expect.that(Effect.sync(() => log), equals(["message: fake"]))

      ws.send("to-modify")
      ws.send("to-block")
      ws.send("pass-server")
      yield* Expect.that(
        logOf(page, null),
        equals([
          "open",
          messageLine(server, "modified"),
          messageLine(server, "pass-server")
        ])
      )

      yield* page.evaluateInMainWorld(() => {
        const globals = window as unknown as Shared
        globals.ws.send("to-respond")
        globals.ws.send("to-modify")
        globals.ws.send("to-block")
        globals.ws.send("pass-client")
      })
      yield* Expect.that(Effect.sync(() => log), equals(["message: fake", "message: modified", "message: pass-client"]))
      yield* Expect.that(
        logOf(page, null),
        equals([
          "open",
          messageLine(server, "modified"),
          messageLine(server, "pass-server"),
          messageLine(server, "response")
        ])
      )

      const route = yield* Deferred.await(routed)
      yield* route.page.send(text("another"))
      yield* Expect.that(
        logOf(page, null),
        equals([
          "open",
          messageLine(server, "modified"),
          messageLine(server, "pass-server"),
          messageLine(server, "response"),
          messageLine(server, "another")
        ])
      )

      yield* page.evaluateInMainWorld(() => (window as unknown as Shared).ws.send("pass-client-2"))
      yield* Expect.that(
        Effect.sync(() => log),
        equals(["message: fake", "message: modified", "message: pass-client", "message: pass-client-2"])
      )

      yield* page.evaluateInMainWorld(() => (window as unknown as Shared).ws.close(3009, "problem"))
      yield* Expect.that(
        Effect.sync(() => log),
        equals([
          "message: fake",
          "message: modified",
          "message: pass-client",
          "message: pass-client-2",
          "close: code=3009 reason=problem"
        ])
      )
    }))

  test("WS-028", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const routed = yield* Deferred.make<WebSocketRoute.Connection>()
      yield* page.context.routeWebSocket("**", (connection) =>
        Effect.gen(function*() {
          yield* connection.open({
            fromPage: (message, reply) => textOf(message) === "to-respond" ? reply.send(text("response")) : Effect.void
          })
          yield* Deferred.succeed(routed, connection)
        }), routing(browserName))

      yield* setupWS(page, server, "blob")
      yield* page.evaluateInMainWorld(async () => {
        const globals = window as unknown as Shared
        await globals.wsOpened
        globals.ws.send("to-respond")
        globals.ws.send("to-block")
        globals.ws.send("to-respond")
      })
      yield* Expect.that(
        logOf(page, null),
        equals(["open", messageLine(server, "response"), messageLine(server, "response")])
      )

      const route = yield* Deferred.await(routed)
      yield* route.page.send(text("another"))
      yield* route.page.close({ code: 3008, reason: "oops" })

      yield* Expect.that(
        logOf(page, null),
        equals([
          "open",
          messageLine(server, "response"),
          messageLine(server, "response"),
          messageLine(server, "another"),
          "close code=3008 reason=oops wasClean=true"
        ])
      )
    }))

  test("WS-029", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      yield* page.context.routeWebSocket("**", (connection) =>
        connection.open({
          fromPage: (message, reply) => reply.send(text("mock-" + textOf(message)))
        }), routing(browserName))

      for (const frameId of [null, "frame1"]) {
        yield* page.evaluateInMainWorld(
          (host: string, frameId: string | null) => {
            const win = (frameId === null
              ? window
              : (document.getElementById(frameId) as HTMLIFrameElement).contentWindow) as unknown as Shared
            win.log = []
            win.ws = new win.WebSocket("ws://" + host + "/ws")
            win.ws.addEventListener("message", (event) => win.log.push(event.data))
            win.ws.addEventListener("close", () => win.log.push("close"))
            win.ws.addEventListener("open", () => win.ws.send("hi"))
          },
          hostOf(server),
          frameId
        )
        yield* Expect.that(logOf(page, frameId), equals(["mock-hi"]))
      }
    }))

  test("WS-030", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const routed = yield* Deferred.make<WebSocketRoute.Connection>()
      yield* page.context.routeWebSocket("**", connectAndRecord(routed), routing(browserName))
      yield* setupWS(page, server, "blob")

      const route = yield* Deferred.await(routed)
      yield* route.page.send(text("hello"))

      yield* Expect.that(
        logOf(page, null),
        equals(["open", messageLine(server, "hello")])
      )

      const closed = yield* startWaiting(route.status.waitFor((status) => status === "closed"))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* Fiber.join(closed.fiber)
    }))

  test("WS-031", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const routed = yield* Deferred.make<WebSocketRoute.Connection>()
      yield* page.context.routeWebSocket("**", connectAndRecord(routed), routing(browserName))

      // The frame's script runs through its parent's main world, which is same-origin only on the fixture origin.
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      yield* setupWS(page, server, "blob", { frameId: "frame1" })

      const route = yield* Deferred.await(routed)
      yield* route.page.send(text("hello"))

      yield* Expect.that(
        logOf(page, "frame1"),
        equals(["open", messageLine(server, "hello")])
      )

      const closed = yield* startWaiting(route.status.waitFor((status) => status === "closed"))
      // Playwright's `detachFrame`
      yield* page.evaluateInMainWorld((frameId: string) => {
        document.getElementById(frameId)!.remove()
      }, "frame1")
      yield* Fiber.join(closed.fiber)
    }))

  test("WS-033", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const routed = yield* Deferred.make<WebSocketRoute.Connection>()
      yield* page.context.routeWebSocket("**", connectAndRecord(routed), routing(browserName))
      yield* setupWS(page, server, "blob")

      const route = yield* Deferred.await(routed)
      yield* Effect.all([page.close(), route.page.send(text("hello"))], { concurrency: "unbounded" })
    }))

  test("WS-034", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      // A route that decides nothing: Strider makes the page's socket fail with an error and a 1006 close, where
      // Playwright's empty handler leaves it open with no server behind it.
      yield* page.context.routeWebSocket("**", () => Effect.void, routing(browserName))
      yield* setupWS(page, server, "blob")
      yield* Expect.that(logOf(page, null), equals(["open"]))
      yield* page.evaluateInMainWorld(() => (window as unknown as Shared).ws.send("hi"))
      yield* page.evaluateInMainWorld(() => (window as unknown as Shared).ws.send("hi2"))
      yield* Expect.that(logOf(page, null), equals(["open"]))
    }))

  test("WS-035", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const failed = yield* Deferred.make<unknown>()
      yield* page.context.routeWebSocket("**", (connection) =>
        Effect.gen(function*() {
          yield* connection.connectToServer({})
          const failure = yield* failureOf(connection.connectToServer({}), "a second connectToServer")
          yield* Deferred.succeed(failed, failure)
        }), routing(browserName))
      yield* setupWS(page, server, "blob")
      const error = yield* Deferred.await(failed)
      assert(WebSocketRoute.isWebSocketRouteError(error), `expected a WebSocketRouteError, got ${String(error)}`)
      // Playwright's "Already connected to the server" is Strider's InvalidState, whose message says the connection
      // is already opened.
      assert.strictEqual(error.reason._tag, "InvalidState")
      assert.include(error.message, "already opened")
    }))

  test("WS-036", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const handled: Array<string> = []
      // No trailing slash!
      yield* page.context.routeWebSocket("ws://" + hostOf(server), (connection) =>
        connection.open({
          fromPage: (message, reply) =>
            Effect.sync(() => {
              handled.push(textOf(message))
            }).pipe(Effect.andThen(reply.send(text("response"))))
        }), routing(browserName))

      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld((host: string) => {
        const globals = window as unknown as Shared
        globals.log = []
        // No trailing slash!
        globals.ws = new WebSocket("ws://" + host)
        globals.ws.addEventListener("message", (event) => globals.log.push(event.data))
      }, hostOf(server))

      yield* Expect.that(readyState(page, null), equals(1))
      yield* page.evaluateInMainWorld(() => (window as unknown as Shared).ws.send("query"))
      yield* Expect.that(Effect.sync(() => handled), equals(["query"]))
      assert.deepStrictEqual(yield* logOf(page, null), ["response"])
    }))

  test("WS-039", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const routes: Array<WebSocketRoute.Connection> = []
      yield* page.context.routeWebSocket("**", (connection) =>
        Effect.sync(() => {
          routes.push(connection)
        }), routing(browserName))

      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld((host: string) => {
        const globals = window as unknown as Shared
        globals.wsNone = new WebSocket("ws://" + host + "/ws-none")
        globals.wsString = new WebSocket("ws://" + host + "/ws-string", "chat.v1")
        globals.wsArray = new WebSocket("ws://" + host + "/ws-array", ["chat.v2", "chat.v1"])
      }, hostOf(server))

      yield* Expect.that(Effect.sync(() => routes.length), equals(3))

      const byPath = new Map(routes.map((route) => [new URL(route.url).pathname, route] as const))
      assert.deepStrictEqual([...byPath.get("/ws-none")!.protocols], [])
      assert.deepStrictEqual([...byPath.get("/ws-string")!.protocols], ["chat.v1"])
      assert.deepStrictEqual([...byPath.get("/ws-array")!.protocols], ["chat.v2", "chat.v1"])
    }))

  test("WS-040", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      const routed = yield* Deferred.make<{
        readonly page: WebSocketRoute.Connection
        readonly server: WebSocketRoute.Server
      }>()
      yield* page.context.routeWebSocket("**", (connection) =>
        connection.connectToServer({}).pipe(
          Effect.flatMap((serverRoute) => Deferred.succeed(routed, { page: connection, server: serverRoute })),
          Effect.asVoid
        ), routing(browserName))

      // Listen before the page connects, so the server's side of the connection is recorded
      const serverPeer = yield* server.waitForWebSocket
      yield* setupWS(page, server, "blob", { protocols: ["chat.v2", "chat.v1"] })

      const { page: pageRoute, server: serverRoute } = yield* Deferred.await(routed)
      assert.deepStrictEqual([...pageRoute.protocols], ["chat.v2", "chat.v1"])
      // The server's side: the subprotocols its upgrade request asked for. Strider's `Server` reports the one the
      // server chose, which the fixture server takes from the request as `ws` does: the first.
      const peer = yield* serverPeer
      const requested = String(peer.request.headers["sec-websocket-protocol"] ?? "")
      assert.deepStrictEqual(requested.split(",").map((protocol) => protocol.trim()), ["chat.v2", "chat.v1"])
      assert.strictEqual(serverRoute.protocol, "chat.v2")
    }))
})
