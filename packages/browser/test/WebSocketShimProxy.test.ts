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

describe("WebSocket shim proxy lifecycle", () => {
  it("delivers a server's last message to the page before the server's close", async () => {
    // A native socket dispatches every message it received before its close event. In proxy mode the shim sends
    // server messages through the host, which forwards them back with a "send" command; the page must still see
    // them before the close the native socket reported after them.
    const host: Array<{ type: string; message?: { _tag: string; data: string } }> = []
    let delivered: (() => void) | undefined
    const context = vm.createContext({
      URL,
      EventTarget,
      Event,
      MessageEvent,
      CloseEvent: Closed,
      Uint8Array,
      ArrayBuffer,
      Blob,
      TextEncoder,
      DOMException,
      String,
      btoa,
      atob,
      queueMicrotask,
      WebSocket: class Native {
        constructor() {
          ;(globalThis as any).native = this
        }
      },
      location: { href: "http://example.com/" },
      console: {
        debug: (object: { payload: string }) => {
          host.push(JSON.parse(object.payload))
          delivered?.()
        }
      }
    })
    vm.runInContext(`(${install.toString()})("bridge", "token", "ws://example.com/socket", "console")`, context)
    vm.runInContext(
      `globalThis.seen = []; globalThis.ws = new WebSocket("ws://example.com/socket");
       ws.onmessage = (event) => seen.push("message:" + event.data);
       ws.onclose = (event) => seen.push("close:" + event.code)`,
      context
    )
    const dispatch = (command: object): Promise<void> =>
      vm.runInContext(
        `globalThis[Symbol.for("@usestrider/browser/webSocketRouting")].dispatch("token", ${
          JSON.stringify({ id: "1", ...command })
        })`,
        context
      )
    const until = (predicate: () => boolean) =>
      new Promise<void>((resolve) => {
        delivered = () => predicate() && resolve()
        delivered()
      })
    await dispatch({ type: "grant", direction: "page", bytes: 64 })
    await dispatch({ type: "grant", direction: "server", bytes: 64 })
    await dispatch({ type: "connect" })
    const native = (globalThis as any).native ?? vm.runInContext("globalThis.native", context)
    native.protocol = ""
    native.onopen()
    native.onmessage({ data: "bye" })
    native.onclose({ code: 1000, reason: "done", wasClean: true })
    // A host round trip (CDP binding, BiDi channel or WebKit console) takes longer than the page's microtasks, so
    // by the time automatic forwarding sends the message back, the native close has also reached the shim.
    await until(() => host.some((envelope) => envelope.type === "closed"))
    await dispatch({ type: "send", direction: "page", message: { _tag: "Text", data: "bye" } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepStrictEqual(vm.runInContext("seen", context), ["message:bye", "close:1000"])
  })
})
