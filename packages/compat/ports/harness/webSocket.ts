/**
 * The fixture server's WebSocket end, as Playwright's test server has one: every upgrade is accepted, and a test
 * listens for the next connection to talk to it. RFC 6455's framing, enough for tests: text, binary, fragments,
 * ping, and the closing handshake. No extensions, so no compression.
 */
import { createHash } from "node:crypto"
import type * as http from "node:http"
import type * as stream from "node:stream"

/** The server's side of one WebSocket connection, as Playwright's tests use `ws`'s. */
export interface WebSocketPeer {
  /** The upgrade request, with its headers. */
  readonly request: http.IncomingMessage
  /** Sends a text frame for a string, a binary frame for bytes. */
  readonly send: (data: string | Uint8Array) => void
  /** Starts the closing handshake; `close` listeners run when it ends. */
  readonly close: (code?: number, reason?: string) => void
  /** Drops the connection without a closing handshake. */
  readonly terminate: () => void
  /** Each complete message from the page, as it arrives. */
  readonly onMessage: (listener: (data: Buffer, isBinary: boolean) => void) => void
  /** When the connection ends: the close code and reason the page sent, or 1006 when it ended without one. */
  readonly onClose: (listener: (code: number, reason: string) => void) => void
  /** Every message received so far. */
  readonly messages: ReadonlyArray<{ readonly data: Buffer; readonly isBinary: boolean }>
}

const frame = (opcode: number, payload: Buffer) => {
  const length = payload.length
  const header = length < 126
    ? Buffer.from([0x80 | opcode, length])
    : length < 0x10000
    ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
    : Buffer.concat([
      Buffer.from([0x80 | opcode, 127]),
      (() => {
        const size = Buffer.alloc(8)
        size.writeBigUInt64BE(BigInt(length))
        return size
      })()
    ])
  return Buffer.concat([header, payload])
}

const closePayload = (code: number | undefined, reason: string | undefined) => {
  if (code === undefined) return Buffer.alloc(0)
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16BE(code)
  return Buffer.concat([bytes, Buffer.from(reason ?? "")])
}

/** Accepts an upgrade and returns its peer. */
export const accept = (request: http.IncomingMessage, socket: stream.Duplex, head: Buffer): WebSocketPeer => {
  const key = request.headers["sec-websocket-key"]
  const answer = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64")
  // As `ws` does, the first subprotocol the page asks for is the one accepted
  const protocol = request.headers["sec-websocket-protocol"]?.split(",")[0]?.trim()
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${answer}\r\n` +
      (protocol === undefined || protocol === "" ? "" : `Sec-WebSocket-Protocol: ${protocol}\r\n`) +
      "\r\n"
  )
  const messageListeners: Array<(data: Buffer, isBinary: boolean) => void> = []
  const closeListeners: Array<(code: number, reason: string) => void> = []
  const messages: Array<{ data: Buffer; isBinary: boolean }> = []
  let buffered = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0)
  let fragments: Array<Buffer> = []
  let fragmentBinary = false
  let closeSent = false
  let closed: { code: number; reason: string } | undefined

  const end = (code: number, reason: string) => {
    if (closed !== undefined) return
    closed = { code, reason }
    for (const listener of closeListeners) listener(code, reason)
  }

  const write = (data: Buffer) => {
    if (!socket.destroyed && socket.writable) socket.write(data)
  }

  const deliver = (data: Buffer, isBinary: boolean) => {
    messages.push({ data, isBinary })
    for (const listener of messageListeners) listener(data, isBinary)
  }

  const read = () => {
    while (buffered.length >= 2) {
      const first = buffered[0]!
      const second = buffered[1]!
      const fin = (first & 0x80) !== 0
      const opcode = first & 0x0f
      const masked = (second & 0x80) !== 0
      let length = second & 0x7f
      let offset = 2
      if (length === 126) {
        if (buffered.length < 4) return
        length = buffered.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (buffered.length < 10) return
        length = Number(buffered.readBigUInt64BE(2))
        offset = 10
      }
      const maskOffset = offset
      if (masked) offset += 4
      if (buffered.length < offset + length) return
      const payload = Buffer.from(buffered.subarray(offset, offset + length))
      if (masked) {
        for (let i = 0; i < payload.length; i++) payload[i]! ^= buffered[maskOffset + (i % 4)]!
      }
      buffered = buffered.subarray(offset + length)
      switch (opcode) {
        case 0x0:
        case 0x1:
        case 0x2: {
          if (opcode !== 0x0) fragmentBinary = opcode === 0x2
          fragments.push(payload)
          if (fin) {
            const data = Buffer.concat(fragments)
            fragments = []
            deliver(data, fragmentBinary)
          }
          break
        }
        case 0x8: {
          const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005
          const reason = payload.length > 2 ? payload.subarray(2).toString("utf8") : ""
          // The closing handshake: answer the page's close with its own code and reason, as `ws` does, then end the
          // TCP connection
          if (!closeSent) {
            closeSent = true
            write(frame(0x8, payload))
          }
          socket.end()
          end(code, reason)
          return
        }
        case 0x9:
          write(frame(0xa, payload))
          break
        default:
          break
      }
    }
  }

  socket.on("data", (data: Buffer) => {
    buffered = Buffer.concat([buffered, data])
    read()
  })
  socket.on("close", () => end(1006, ""))
  socket.on("error", () => end(1006, ""))
  if (buffered.length > 0) queueMicrotask(read)

  return {
    request,
    send: (data) => write(frame(typeof data === "string" ? 0x1 : 0x2, Buffer.from(data))),
    close: (code, reason) => {
      if (closeSent) return
      closeSent = true
      write(frame(0x8, closePayload(code, reason)))
    },
    terminate: () => socket.destroy(),
    onMessage: (listener) => {
      messageListeners.push(listener)
    },
    onClose: (listener) => {
      if (closed !== undefined) listener(closed.code, closed.reason)
      else closeListeners.push(listener)
    },
    messages
  }
}
