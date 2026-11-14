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
  const exercise = async (error: boolean, drop: boolean, remove: boolean, multiple = false) => {
    // A native socket dispatches every message it received before its close event. In proxy mode the shim sends
    // server messages through the host, which forwards them back with a "send" command; the page must still see
    // them before the close the native socket reported after them.
    const host: Array<{ type: string; message?: { _tag: string; data: string } }> = []
    let delivered: (() => void) | undefined
    let native: any
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
          native = this
        }
        close() {}
      },
      location: { href: "http://example.com/" },
      console: {
        debug: (object: { payload: string }) => {
          host.push(JSON.parse(object.payload))
          delivered?.()
        }
      }
    })
    const holder = vm.runInContext(`(${install.toString()})()`, context)
    holder.add("bridge", "token", "ws://example.com/socket", "console")
    vm.runInContext(
      `globalThis.seen = []; globalThis.ws = new WebSocket("ws://example.com/socket");
       ws.onmessage = (event) => seen.push("message:" + event.data);
       ws.onerror = () => seen.push("error");
       ws.onclose = (event) => { seen.push("close:" + event.code); globalThis.closed = {code:event.code,reason:event.reason,wasClean:event.wasClean}; }`,
      context
    )
    const dispatch = (command: object): Promise<void> => holder.dispatch("token", { id: "1", ...command })
    const until = (predicate: () => boolean) =>
      new Promise<void>((resolve) => {
        delivered = () => predicate() && resolve()
        delivered()
      })
    await dispatch({ type: "grant", direction: "page", bytes: 64 })
    await dispatch({ type: "grant", direction: "server", bytes: 64 })
    await dispatch({ type: "connect" })
    native.protocol = ""
    native.onopen()
    native.onmessage({ data: "bye" })
    if (multiple) native.onmessage({ data: "deliberately dropped" })
    if (error) native.onerror()
    native.onclose({ code: error ? 1006 : 1000, reason: error ? "" : "done", wasClean: !error })
    // The host owns delivery until it explicitly acknowledges handler completion, even for a deliberate drop.
    await until(() => host.filter((envelope) => envelope.type === "message").length === (multiple ? 2 : 1))
    assert.deepStrictEqual(vm.runInContext("seen", context), [])
    if (remove) {
      await dispatch({ type: "remove" })
      await dispatch({ type: "ack", direction: "server", sequence: 1 })
      assert.deepStrictEqual(vm.runInContext("seen", context), ["close:1000"])
      return
    }
    if (!drop) await dispatch({ type: "send", direction: "page", message: { _tag: "Text", data: "bye" } })
    assert.deepStrictEqual(vm.runInContext("seen", context), drop ? [] : ["message:bye"])
    if (multiple) {
      await dispatch({ type: "ack", direction: "server", sequence: 2 })
      await dispatch({ type: "ack", direction: "server", sequence: 2 })
      assert.deepStrictEqual(vm.runInContext("seen", context), ["message:bye"])
    }
    await dispatch({ type: "ack", direction: "server", sequence: 1 })
    await until(() => host.some((envelope) => envelope.type === "closed"))
    if (!error && !drop) {
      assert.deepStrictEqual(vm.runInContext("seen", context), ["message:bye", "close:1000"])
    } else {
      assert.deepStrictEqual(vm.runInContext("seen", context), [
        ...drop ? [] : ["message:bye"],
        ...error ? ["error"] : [],
        `close:${error ? 1006 : 1000}`
      ])
    }
    assert.deepStrictEqual(vm.runInContext("closed", context), {
      code: error ? 1006 : 1000,
      reason: error ? "" : "done",
      wasClean: !error
    })
  }
  it("delivers a server's last message to the page before the server's close", () => exercise(false, false, false))
  it("delivers preceding server messages before native error and abnormal close", () => exercise(true, false, false))
  it("waits for a deliberately dropped server message before error and close", () => exercise(true, true, false))
  it("cancels pending native notifications when removal drains without a host acknowledgement", () =>
    exercise(true, false, true))
  it("waits for every preceding completion, including drops acknowledged out of order", () =>
    exercise(false, false, false, true))
})
