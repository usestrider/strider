import { assert, describe, it } from "@effect/vitest"
import { Transport } from "@usestrider/browser/protocol"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import * as Socket from "effect/socket/Socket"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"

type Listener = (event: Socket.WebSocketEvent) => void

/** A WebSocket the test plays the browser on, as WHATWG's behaves: a send once it's closing is dropped. */
class FakeWebSocket implements Socket.WebSocketLike {
  readyState = 0
  readonly sent: Array<string | Uint8Array> = []
  closedWith: number | undefined
  private readonly listeners = new Map<string, Set<Listener>>()
  constructor(readonly url: string, readonly options: Socket.WebSocketConstructorOptions | undefined) {}
  addEventListener(type: string, listener: Listener, options?: { readonly once?: boolean }) {
    let set = this.listeners.get(type)
    if (set === undefined) this.listeners.set(type, set = new Set())
    const once: Listener = (event) => {
      set.delete(once)
      listener(event)
    }
    set.add(options?.once === true ? once : listener)
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener)
  }
  close(code?: number) {
    this.closedWith = code
    this.readyState = 2
  }
  send(data: string | Uint8Array) {
    if (this.readyState === 1) this.sent.push(data)
  }
  private emit(type: string, event: Socket.WebSocketEvent) {
    for (const listener of Array.from(this.listeners.get(type) ?? [])) listener(event)
  }
  open() {
    this.readyState = 1
    this.emit("open", {})
  }
  message(data: string | ArrayBuffer) {
    this.emit("message", { data })
  }
  closing() {
    this.readyState = 2
  }
  remoteClose(code: number, reason?: string) {
    this.readyState = 3
    this.emit("close", reason === undefined ? { code } : { code, reason })
  }
}

const harness = Effect.sync(() => {
  const dialed: Array<FakeWebSocket> = []
  const constructor = (url: string, options?: Socket.WebSocketConstructorOptions) => {
    const ws = new FakeWebSocket(url, options)
    dialed.push(ws)
    return ws
  }
  return { dialed, constructor }
})

/** Opens a transport on a fake WebSocket the test opens. */
const connected = Effect.fnUntraced(function*(options?: Transport.WebSocketOptions) {
  const { dialed, constructor } = yield* harness
  const fiber = yield* Transport.webSocket("ws://browser", options).pipe(
    Effect.provideService(Socket.WebSocketConstructor, constructor),
    Effect.forkScoped
  )
  yield* Effect.yieldNow
  dialed[0]!.open()
  const transport = yield* Fiber.join(fiber)
  return { transport, ws: dialed[0]!, dialed }
})

const failureOf = <A>(exit: Exit.Exit<A, Transport.TransportError>) => {
  assert(Exit.isFailure(exit))
  const error = Cause.findErrorOption(exit.cause)
  assert(error._tag === "Some")
  return error.value.reason
}

describe("Transport.webSocket", () => {
  it.effect("dials once, with its headers in the clear, and delivers text and binary messages in order", () =>
    Effect.gen(function*() {
      const { transport, ws, dialed } = yield* connected({
        headers: { authorization: Redacted.make("Bearer secret"), "x-grid": "1" }
      })
      assert.deepStrictEqual(ws.options, { headers: { authorization: "Bearer secret", "x-grid": "1" } })
      ws.message("{\"a\":1}")
      ws.message(new TextEncoder().encode("{\"b\":\"é\"}").buffer)
      ws.message("{\"c\":3}")
      const messages = yield* transport.messages.pipe(Stream.take(3), Stream.runCollect)
      assert.deepStrictEqual(messages, ["{\"a\":1}", "{\"b\":\"é\"}", "{\"c\":3}"])
      yield* transport.send("{\"id\":1}")
      assert.deepStrictEqual(ws.sent, ["{\"id\":1}"])
      assert.strictEqual(dialed.length, 1)
    }))

  it.effect("delivers what arrived before the browser closed it, then fails with why, and fails sends at once", () =>
    Effect.gen(function*() {
      const { transport, ws } = yield* connected()
      ws.message("first")
      ws.message("second")
      ws.remoteClose(1001, "going away")
      const exit = yield* transport.messages.pipe(Stream.runCollect, Effect.exit)
      const reason = failureOf(exit)
      assert.deepInclude(reason, {
        initiator: "remote",
        description: "The WebSocket closed with code 1001: going away"
      })
      const lost = yield* transport.closed
      assert.strictEqual(lost, reason)
      const send = yield* transport.send("{}").pipe(Effect.exit)
      assert.strictEqual(failureOf(send), reason)
      assert.deepStrictEqual(ws.sent, [])
    }))

  it.effect("delivers every message received before the close", () =>
    Effect.gen(function*() {
      const { transport, ws } = yield* connected()
      ws.message("first")
      ws.message("second")
      ws.remoteClose(1006)
      const received: Array<string> = []
      const exit = yield* transport.messages.pipe(
        Stream.runForEach((message) => Effect.sync(() => received.push(message))),
        Effect.exit
      )
      assert.deepStrictEqual(received, ["first", "second"])
      assert.strictEqual(failureOf(exit)._tag, "ConnectionLost")
    }))

  it.effect("fails a send on a closing WebSocket rather than drop it", () =>
    Effect.gen(function*() {
      const { transport, ws } = yield* connected()
      ws.closing()
      const exit = yield* transport.send("{}").pipe(Effect.exit)
      assert.deepInclude(failureOf(exit), { _tag: "ConnectionLost", description: "The WebSocket is closing" })
      ws.remoteClose(1000)
      const lost = yield* transport.closed
      assert.strictEqual(lost.description, "The WebSocket closed with code 1000")
    }))

  it.effect("is lost locally when its scope closes, and closes the WebSocket with code 1000", () =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const { transport, ws } = yield* connected().pipe(Scope.provide(scope))
      yield* Scope.close(scope, Exit.void)
      const lost = yield* transport.closed
      assert.deepInclude(lost, { initiator: "local", description: "The connection was closed" })
      assert.strictEqual(ws.closedWith, 1000)
      assert.strictEqual(failureOf(yield* transport.send("{}").pipe(Effect.exit)), lost)
    }))

  it.effect("fails with ConnectFailed when it doesn't open within openTimeout, and closes the WebSocket with its scope", () =>
    Effect.gen(function*() {
      const { dialed, constructor } = yield* harness
      const fiber = yield* Transport.webSocket("ws://browser", { openTimeout: "2 seconds" }).pipe(
        Effect.provideService(Socket.WebSocketConstructor, constructor),
        Effect.scoped,
        Effect.forkChild
      )
      yield* TestClock.adjust("2 seconds")
      const reason = failureOf(yield* Fiber.await(fiber))
      assert.deepStrictEqual(reason._tag, "ConnectFailed")
      assert.strictEqual(reason.description, "The WebSocket didn't open within 2 seconds")
      assert.strictEqual(dialed[0]!.closedWith, 1000)
    }))

  it.effect("fails with ConnectFailed when it closes before opening, or can't be constructed", () =>
    Effect.gen(function*() {
      const { dialed, constructor } = yield* harness
      const fiber = yield* Transport.webSocket("ws://browser").pipe(
        Effect.provideService(Socket.WebSocketConstructor, constructor),
        Effect.forkChild
      )
      yield* Effect.yieldNow
      dialed[0]!.remoteClose(1006)
      const closed = failureOf(yield* Fiber.await(fiber))
      assert.deepInclude(closed, {
        _tag: "ConnectFailed",
        description: "The WebSocket closed with code 1006 before opening"
      })

      const thrown = yield* Transport.webSocket("not a url").pipe(
        Effect.provideService(Socket.WebSocketConstructor, () => {
          throw new SyntaxError("Invalid URL: not a url")
        }),
        Effect.scoped,
        Effect.exit
      )
      assert.deepInclude(failureOf(thrown), { _tag: "ConnectFailed", description: "Invalid URL: not a url" })
    }))
})
