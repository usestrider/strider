import { assert, describe, it } from "@effect/vitest"
import * as vm from "node:vm"
import { install } from "../src/internal/webSocketShim.ts"

class Closed extends Event {
  readonly code: number
  readonly reason: string
  readonly wasClean: boolean
  constructor(type: string, options: CloseEventInit) {
    super(type)
    this.code = options.code ?? 0
    this.reason = options.reason ?? ""
    this.wasClean = options.wasClean ?? false
  }
}

const setup = (BlobConstructor = Blob) => {
  const messages: Array<{ type: string; message?: { _tag: string; data: string }; reason?: string }> = []
  let delivered: (() => void) | undefined
  const context = vm.createContext({
    URL,
    EventTarget,
    Event,
    MessageEvent,
    CloseEvent: Closed,
    Uint8Array,
    ArrayBuffer,
    Blob: BlobConstructor,
    TextEncoder,
    DOMException,
    btoa,
    atob,
    queueMicrotask,
    WebSocket: class Native {},
    location: { href: "http://example.com/" },
    console: {
      debug: (object: { payload: string }) => {
        messages.push(JSON.parse(object.payload))
        delivered?.()
      }
    }
  })
  vm.runInContext(`(${install.toString()})("bridge", "token", "ws://example.com/socket", "console")`, context)
  vm.runInContext(`globalThis.ws = new WebSocket("ws://example.com/socket")`, context)
  const dispatch = (command: object): Promise<void> =>
    vm.runInContext(
      `globalThis[Symbol.for("@usestrider/browser/webSocketRouting")].dispatch("token", ${
        JSON.stringify({ id: "1", ...command })
      })`,
      context
    )
  const waitFor = (count: number) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (messages.filter((message) => message.type === "message").length === count) resolve()
      }
      delivered = check
      check()
    })
  return { context, dispatch, messages, waitFor }
}

describe("WebSocket shim admission and conversion", () => {
  it("snapshots views synchronously and orders them after a pending Blob", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    class SlowBlob extends Blob {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        await gate
        return super.arrayBuffer()
      }
    }
    const { context, dispatch, messages, waitFor } = setup(SlowBlob)
    await dispatch({ type: "grant", direction: "page", bytes: 8 })
    await dispatch({ type: "open" })
    vm.runInContext(
      `ws.send(new Blob([new Uint8Array([0,255,1])])); const bytes=new Uint8Array([99,2,3,88]);ws.send(bytes.subarray(1,3));bytes.fill(9);ws.send('x')`,
      context
    )
    assert.lengthOf(messages.filter((message) => message.type === "message"), 0)
    release()
    await waitFor(3)
    assert.deepStrictEqual(messages.filter((message) => message.type === "message").map((message) => message.message), [
      { _tag: "Binary", data: "AP8B" },
      { _tag: "Binary", data: "AgM=" },
      { _tag: "Text", data: "x" }
    ])
  })

  it("spends credit before Blob conversion and waits for its cancellation drain", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    class SlowBlob extends Blob {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        await gate
        return super.arrayBuffer()
      }
    }
    const { context, dispatch, messages } = setup(SlowBlob)
    await dispatch({ type: "grant", direction: "page", bytes: 4 })
    await dispatch({ type: "open" })
    vm.runInContext(`ws.send(new Blob([new Uint8Array(4)]));ws.send('x')`, context)
    assert.strictEqual(vm.runInContext("ws.readyState", context), 3)
    assert.isTrue(messages.some((message) => message.type === "fault" && message.reason === "routing overflow"))
    let drained = false
    const drain = dispatch({ type: "drain" }).then(() => {
      drained = true
    })
    await Promise.resolve()
    assert.isFalse(drained)
    assert.strictEqual(vm.runInContext("ws.readyState", context), 3)
    release()
    await drain
    assert.strictEqual(vm.runInContext("ws.readyState", context), 3)
    assert.lengthOf(messages.filter((message) => message.type === "message"), 0)
  })

  it("bounds pending constructor lookup entries before host admission", () => {
    const { context, messages } = setup()
    vm.runInContext(
      `globalThis.instances = Array.from({length:32},()=>new WebSocket('ws://example.com/socket'))`,
      context
    )
    assert.lengthOf(messages.filter((message) => message.type === "create"), 16)
    assert.strictEqual(vm.runInContext("instances.filter(ws=>ws.readyState===3).length", context), 17)
  })
})
