/** Main-world constructor shim. This function is serialized; it must not close over host code. */
export const install = () => {
  const global = globalThis as any
  const Native = global.WebSocket
  const debug = global.console.debug.bind(global.console)
  const stringify = global.JSON.stringify.bind(global.JSON)
  const microtask = global.queueMicrotask.bind(global)
  const wellFormed = global.String.prototype.toWellFormed
  const blobBytes = global.Blob.prototype.arrayBuffer
  const routes: Array<
    {
      name: string
      token: string
      match: (url: string) => boolean
      transport: string
      binding?: ((payload: string) => void) | undefined
      failed?: boolean
    }
  > = []
  const sockets = new Map<string, Mock>()
  let next = 0
  let pendingConstructors = 0
  let active = true
  let sequence = 0
  const emit = (route: typeof routes[number], message: any) => {
    const envelope = { token: route.token, sequence: ++sequence, ...message }
    if (route.transport === "console") debug({ __striderWebSocket: route.token, payload: stringify(envelope) })
    else route.binding?.(stringify(envelope))
  }
  const add = (name: string, token: string, pattern: string, transport: string) => {
    if (routes.some((route) => route.token === token)) return
    let match: (url: string) => boolean
    if (pattern.includes("*")) {
      const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      const regex = new RegExp(
        `^${pattern.split("**").map((part) => part.split("*").map(escape).join("[^/]*")).join(".*")}$`
      )
      match = (url) => regex.test(url)
    } else if (/:[a-zA-Z_]/.test(pattern.replace(/^[a-z][a-z0-9+.-]*:/i, ""))) {
      const compiled = new global.URLPattern(pattern)
      match = (url) => compiled.test(url)
    } else match = (url) => url === pattern
    const route = { name, token, match, transport, binding: transport === "binding" ? global[name] : undefined }
    // The page must not see the binding once the shim holds it.
    if (route.binding !== undefined && Object.getOwnPropertyDescriptor(global, name)?.configurable) delete global[name]
    routes.push(route)
    emit(route, { type: "ready", id: "" })
  }
  const size = (value: any) => {
    if (typeof value === "string") {
      // Stop before allocating an encoded copy of a potentially unbounded string.
      let bytes = 0
      for (const c of value) {
        const n = c.codePointAt(0)!
        bytes += n <= 127 ? 1 : n <= 2047 ? 2 : n <= 65535 ? 3 : 4
        if (bytes > 1048576) break
      }
      return bytes
    }
    if (value instanceof global.Blob) return value.size
    if (global.ArrayBuffer.isView(value)) return value.byteLength
    if (value instanceof global.ArrayBuffer) return value.byteLength
    return size(String(value))
  }
  const encode = async (value: any) => {
    if (typeof value === "string") return { _tag: "Text", data: value }
    let bytes: Uint8Array
    if (value instanceof global.Blob) bytes = new Uint8Array(await blobBytes.call(value))
    else if (global.ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    else if (value instanceof global.ArrayBuffer) bytes = new Uint8Array(value)
    else return { _tag: "Text", data: String(value) }
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return { _tag: "Binary", data: global.btoa(binary) }
  }
  const decode = (message: any, binaryType: string) => {
    if (message._tag === "Text") return message.data
    const binary = global.atob(message.data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return binaryType === "arraybuffer" ? bytes.buffer : new global.Blob([bytes])
  }
  const validateClose = (code: number | undefined, reason: string) => {
    if (code !== undefined && (!Number.isInteger(code) || (code !== 1000 && (code < 3000 || code > 4999)))) {
      throw new global.DOMException("Close code must be 1000 or 3000–4999", "InvalidAccessError")
    }
    if (size(reason) > 123) {
      throw new global.DOMException("Close reason exceeds 123 bytes", "SyntaxError")
    }
  }
  const pool = () => ({
    credit: 0,
    grant: 0,
    bytes: 0,
    count: 0,
    sequence: 0,
    pending: new Map<number, number>(),
    chain: Promise.resolve()
  })
  // Socket internals live here, not on the page-visible object.
  const privateState = new global.WeakMap()
  const getState = global.WeakMap.prototype.get.bind(privateState)
  const setState = global.WeakMap.prototype.set.bind(privateState)
  const P = (socket: any): { route: typeof routes[number]; native: any; queues: { page: any; server: any } } =>
    getState(socket)
  class Mock extends global.EventTarget {
    // Native sockets of unrouted URLs and routed sockets are both instances of the page-visible constructor.
    static [Symbol.hasInstance](value: any) {
      return Native.prototype.isPrototypeOf(value) || Mock.prototype.isPrototypeOf(value)
    }
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3
    readonly id = `${++next}`
    readonly url!: string
    readonly protocols!: Array<string>
    _binaryType = "blob"
    get binaryType() {
      return this._binaryType
    }
    set binaryType(value: string) {
      if (value === "blob" || value === "arraybuffer") this._binaryType = value
    }
    bufferedAmount = 0
    extensions = ""
    protocol = ""
    readyState = 0
    onopen: any = null
    onmessage: any = null
    onerror: any = null
    onclose: any = null
    pending = true
    closeNotified = false
    nativeTerminals = Promise.resolve()
    nativeError = false
    nativeClosed = false
    terminalEnded = false
    terminalWait: (() => void) | undefined
    constructor(input: string | URL, protocols?: string | Array<string>) {
      super()
      setState(this, { route: undefined, native: undefined, queues: { page: pool(), server: pool() } })
      const url = new global.URL(String(input), global.location.href)
      if (url.protocol === "http:") url.protocol = "ws:"
      if (url.protocol === "https:") url.protocol = "wss:"
      if (!["ws:", "wss:"].includes(url.protocol) || url.hash) {
        throw new global.DOMException("Invalid WebSocket URL", "SyntaxError")
      }
      const route = [...routes].reverse().find((route) => route.match(url.href))
      if (route === undefined) return new Native(input, protocols)
      if (url.href.length > 8192) throw new global.DOMException("Routing URL exceeds 8192 characters", "SyntaxError")
      const offered: Array<string> = []
      for (const protocol of protocols === undefined ? [] : typeof protocols === "string" ? [protocols] : protocols) {
        if (offered.length >= 128) throw new global.DOMException("Routing protocol count exceeds 128", "SyntaxError")
        offered.push(String(protocol))
      }
      if (offered.reduce((n, protocol) => n + size(protocol), 0) > 8192) {
        throw new global.DOMException("Routing protocols exceed 8192 bytes", "SyntaxError")
      }
      if (
        new Set(offered).size !== offered.length ||
        offered.some((value) => !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value))
      ) {
        throw new global.DOMException("Invalid WebSocket protocols", "SyntaxError")
      }
      this.url = url.href
      this.protocols = offered
      P(this).route = route
      // Rejected constructors keep no entry in the shim's lookup table.
      if (route.failed || pendingConstructors >= 16) {
        this.pending = false
        this.readyState = 3
        microtask(() => {
          this.fire("error", new global.Event("error"))
          this.closed(1006, "constructor admission", false, false)
        })
        return
      }
      pendingConstructors++
      sockets.set(this.id, this)
      emit(route, { type: "create", id: this.id, url: this.url, protocols: offered })
    }
    fire(type: string, event: any) {
      this.dispatchEvent(event)
      const listener = (this as any)[`on${type}`]
      if (typeof listener === "function") {
        try {
          listener.call(this, event)
        } catch (error) {
          global.reportError?.(error)
        }
      }
    }
    opened(protocol: string) {
      if (this.readyState !== 0) return
      this.protocol = protocol
      this.readyState = 1
      if (this.pending) {
        pendingConstructors--
        this.pending = false
      }
      this.fire("open", new global.Event("open"))
    }
    endTerminals() {
      this.terminalEnded = true
      this.terminalWait?.()
    }
    terminal(notification: { type: "error" } | { type: "closed"; code: number; reason: string; wasClean: boolean }) {
      if (this.terminalEnded || (notification.type === "error" ? this.nativeError : this.nativeClosed)) return
      if (notification.type === "error") this.nativeError = true
      else this.nativeClosed = true
      const queue = P(this).queues.server
      const watermark = queue.sequence
      const encoded = queue.chain
      // Encoding is not delivery: the host acknowledges only after forwarding or deliberately dropping.
      // At most one native error and one close wait here; removal cancels independently of conversion chains.
      this.nativeTerminals = this.nativeTerminals.then(async () => {
        await encoded
        if (this.terminalEnded) return
        await new Promise<void>((resolve) => {
          this.terminalWait = () => {
            if (this.terminalEnded || ![...queue.pending.keys()].some((sequence) => sequence <= watermark)) {
              this.terminalWait = undefined
              resolve()
            }
          }
          this.terminalWait()
        })
        if (this.terminalEnded || this.closeNotified) return
        if (notification.type === "error") {
          emit(P(this).route, { type: "error", id: this.id })
          this.fire("error", new global.Event("error"))
        } else {
          emit(P(this).route, { ...notification, id: this.id, direction: "server", provenance: "native" })
          this.closed(notification.code, notification.reason, notification.wasClean, false)
        }
      }).catch(() => this.fail("native completion failed"))
    }
    closed(code: number, reason: string, clean: boolean, notify = true) {
      this.endTerminals()
      if (this.pending) {
        pendingConstructors--
        this.pending = false
      }
      this.readyState = 3
      if (this.closeNotified) return
      this.closeNotified = true
      this.fire("close", new global.CloseEvent("close", { code, reason, wasClean: clean }))
      if (notify) {
        emit(P(this).route, {
          type: "closed",
          id: this.id,
          code,
          reason,
          wasClean: clean,
          provenance: "synthetic",
          direction: "page"
        })
      }
    }
    fail(reason: string) {
      if (this.readyState === 3) return
      try {
        P(this).native?.close(4000, reason.slice(0, 80))
      } catch {}
      this.fire("error", new global.Event("error"))
      emit(P(this).route, { type: "fault", id: this.id, reason })
      this.closed(1006, reason, false)
    }
    enqueue(direction: "page" | "server", value: any) {
      if (
        typeof value !== "string" && !(value instanceof global.Blob) && !global.ArrayBuffer.isView(value) &&
        !(value instanceof global.ArrayBuffer)
      ) value = String(value)
      const queue = P(this).queues[direction]
      const bytes = size(value)
      if (bytes > 1048576 || queue.count >= 256 || queue.bytes + bytes > 4194304 || bytes > queue.credit) {
        this.fail("routing overflow")
        return
      }
      queue.credit -= bytes
      queue.bytes += bytes
      queue.count++
      const sequence = ++queue.sequence
      queue.pending.set(sequence, bytes)
      // Normalize browser strings and copy views only after credit is spent, before returning to the caller.
      const snapshot = typeof value === "string"
        ? wellFormed.call(value)
        : global.ArrayBuffer.isView(value)
        ? new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
        : value instanceof global.ArrayBuffer
        ? value.slice(0)
        : value
      queue.chain = queue.chain.then(async () => {
        const message = await encode(snapshot)
        if (this.readyState === 3 || this.closeNotified) return
        emit(P(this).route, { type: "message", id: this.id, direction, sequence, bytes, message })
      }).catch(() => this.fail("binary conversion failed"))
    }
    send(value: any) {
      if (this.readyState === 0) throw new global.DOMException("WebSocket is connecting", "InvalidStateError")
      if (this.readyState !== 1) return
      this.enqueue("page", value)
    }
    close(code?: number, reason = "") {
      validateClose(code, reason)
      if (this.readyState >= 2) return
      this.readyState = 2
      P(this).queues.page.chain = P(this).queues.page.chain.then(() => {
        emit(P(this).route, { type: "close", id: this.id, code, reason })
      })
    }
  }
  const dispatch = async (token: string, command: any) => {
    if (command.type === "remove") {
      const routeIndex = routes.findIndex((route) => route.token === token)
      if (routeIndex < 0) return
      const removed = routes.splice(routeIndex, 1)[0]!
      if (
        removed.binding !== undefined && global[removed.name] === removed.binding &&
        Object.getOwnPropertyDescriptor(global, removed.name)?.configurable
      ) delete global[removed.name]
      const owned = [...sockets.values()].filter((socket) => P(socket).route.token === token)
      for (const socket of owned) {
        socket.endTerminals()
        socket.readyState = 2
        P(socket).native?.close(1000, "route removed")
        await Promise.all([P(socket).queues.page.chain, P(socket).queues.server.chain])
        socket.closed(1000, "route removed", true, false)
        sockets.delete(socket.id)
      }
      if (routes.length === 0) {
        if (global.WebSocket === Mock) global.WebSocket = Native
        if (nativeConstructor !== undefined) {
          global.Object.defineProperty(Native.prototype, "constructor", nativeConstructor)
        }
        active = false
      }
      return
    }
    if (command.type === "faultRealm") {
      for (const route of routes) if (route.token === token) route.failed = true
      for (const socket of sockets.values()) if (P(socket).route.token === token) socket.fail("bridge overflow")
      return
    }
    const socket = sockets.get(command.id)
    if (socket === undefined || P(socket).route.token !== token) return
    if (command.type === "grant") {
      const queue = P(socket).queues[command.direction as "page" | "server"]
      const serial = command.serial ?? 1
      if (!Number.isSafeInteger(serial) || serial <= queue.grant) return
      if (
        serial !== queue.grant + 1 || !Number.isSafeInteger(command.bytes) || command.bytes < 0 ||
        command.bytes > 4194304
      ) {
        socket.fail("invalid grant")
        return
      }
      queue.grant = serial
      queue.credit += command.bytes
    } else if (command.type === "open") {
      socket.opened(command.protocol ?? "")
    } else if (command.type === "connect") {
      P(socket).native = new Native(socket.url, socket.protocols)
      P(socket).native.binaryType = "arraybuffer"
      P(socket).native.onopen = () => {
        emit(P(socket).route, { type: "opened", id: socket.id, protocol: P(socket).native.protocol })
        socket.opened(P(socket).native.protocol)
      }
      P(socket).native.onmessage = (event: any) => socket.enqueue("server", event.data)
      P(socket).native.onerror = () => socket.terminal({ type: "error" })
      P(socket).native.onclose = (event: any) =>
        socket.terminal({
          type: "closed",
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        })
    } else if (command.type === "send") {
      const value = decode(command.message, command.direction === "page" ? socket.binaryType : "arraybuffer")
      if (command.direction === "page") {
        if (socket.readyState === 1) {
          socket.fire(
            "message",
            new global.MessageEvent("message", { data: value, origin: new global.URL(socket.url).origin })
          )
        }
      } else P(socket).native?.send(value)
    } else if (command.type === "ack") {
      const queue = P(socket).queues[command.direction as "page" | "server"]
      const bytes = queue.pending.get(command.sequence)
      if (bytes === undefined) return
      queue.pending.delete(command.sequence)
      queue.bytes -= bytes
      queue.count--
      queue.credit += bytes
      if (command.direction === "server") socket.terminalWait?.()
    } else if (command.type === "close") {
      validateClose(command.code, command.reason ?? "")
      if (command.direction === "server") {
        if (command.code === undefined) {
          if (command.reason) P(socket).native?.close(1000, command.reason)
          else P(socket).native?.close()
        } else P(socket).native?.close(command.code, command.reason)
      } else socket.closed(command.code ?? 1005, command.reason ?? "", true)
    } else if (command.type === "fail") socket.fail(command.reason)
    else if (command.type === "drain") {
      socket.endTerminals()
      if (socket.readyState !== 3) socket.readyState = 2
      P(socket).native?.close(1000, "route removed")
      await Promise.all([P(socket).queues.page.chain, P(socket).queues.server.chain])
      socket.closed(1000, "route removed", true, false)
      sockets.delete(socket.id)
    }
  }
  const holder = {
    add: (...args: [string, string, string, string]) => {
      if (!active) {
        active = true
        global.WebSocket = Mock
        global.Object.defineProperty(Native.prototype, "constructor", {
          value: Mock,
          configurable: true,
          writable: true
        })
      }
      add(...args)
    },
    dispatch
  }
  Object.defineProperty(Mock, "name", { value: "WebSocket", configurable: true })
  // Native sockets of unrouted URLs report the page-visible constructor too. Removal puts it back.
  const nativeConstructor = global.Object.getOwnPropertyDescriptor(Native.prototype, "constructor")
  global.Object.defineProperty(Native.prototype, "constructor", { value: Mock, configurable: true, writable: true })
  global.WebSocket = Mock
  return Object.freeze(holder)
}

/** A bundle-local reference, never a property of the page global. */
export const holder = "__strider_webSocketRouting__"

export const source = (name: string, token: string, pattern: string, transport: "binding" | "console", bidi = false) =>
  `${holder} ??= (${install.toString()})();
  ${
    bidi ?
      `globalThis[${JSON.stringify(name)}](${holder});` :
      `console.debug(${JSON.stringify("__striderWebSocketCapture:" + token)}, ${holder});`
  }
  ${holder}.add(${JSON.stringify(name)},${JSON.stringify(token)},${JSON.stringify(pattern)},${
    JSON.stringify(transport)
  });`

export const command = (token: string, value: unknown) =>
  `(holder) => holder.dispatch(${JSON.stringify(token)},${JSON.stringify(value)})`
