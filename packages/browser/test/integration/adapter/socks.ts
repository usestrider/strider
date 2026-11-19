/**
 * A local SOCKS5, SOCKS4 and SOCKS4a proxy. It forwards `proxy.test`, its subdomains, `control.test` and loopback names to loopback
 * at the requested port, and refuses other hosts, so whether a name was resolved by the proxy or the browser is
 * observable without external sites. Each connection records the protocol, the destination as the browser sent it,
 * the authentication methods offered, and the first line of what each side sent through the tunnel.
 * Credentials never enter its log.
 */
import * as Effect from "effect/Effect"
import * as net from "node:net"

export interface SocksRequest {
  readonly version: "socks5" | "socks4" | "socks4a"
  /** The SOCKS5 authentication methods the client offered: 0 none, 2 username and password. */
  readonly methods: ReadonlyArray<number>
  /** Whether the destination arrived as a name, which the proxy resolves, rather than an address. */
  readonly remoteDns: boolean
  readonly host: string
  readonly port: number
  authenticated: boolean
  forwarded: boolean
  /** The first line the browser sent through the tunnel, or `tls` for a TLS handshake. */
  sent?: string
  /** The first line the destination sent back. */
  received?: string
}

const forwarded = (host: string) =>
  host === "proxy.test" || host.endsWith(".proxy.test") || host === "control.test" || host === "127.0.0.1" ||
  host === "localhost"

const firstLine = (chunk: Buffer) => chunk[0] === 0x16 ? "tls" : chunk.toString("latin1").split("\r\n")[0]!

export const socks = (credentials?: { readonly username: string; readonly password: string }) =>
  Effect.acquireRelease(
    Effect.callback<{
      readonly server: net.Server
      readonly sockets: Set<net.Socket>
      readonly address: string
      readonly requests: Array<SocksRequest>
    }>((resume) => {
      const sockets = new Set<net.Socket>()
      const requests: Array<SocksRequest> = []
      const track = (socket: net.Socket) => {
        sockets.add(socket)
        socket.on("close", () => sockets.delete(socket))
        socket.on("error", () => socket.destroy())
      }
      const handle = async (socket: net.Socket) => {
        let buffer = Buffer.alloc(0)
        let wake: (() => void) | undefined
        let closed = false
        socket.on("data", (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk])
          wake?.()
        })
        socket.on("close", () => {
          closed = true
          wake?.()
        })
        const take = async (length: number) => {
          while (buffer.length < length) {
            if (closed) throw new Error("closed")
            await new Promise<void>((resolve) => wake = resolve)
          }
          const out = buffer.subarray(0, length)
          buffer = buffer.subarray(length)
          return out
        }
        const byte = async () => (await take(1))[0]!
        const terminated = async () => {
          const bytes: Array<number> = []
          for (let next = await byte(); next !== 0; next = await byte()) bytes.push(next)
          return Buffer.from(bytes).toString("latin1")
        }
        const version = await byte()
        let request: SocksRequest
        let reply: (ok: boolean) => Buffer
        if (version === 5) {
          const methods = [...await take(await byte())]
          const method = credentials === undefined ? 0 : 2
          if (!methods.includes(method)) {
            requests.push({
              version: "socks5",
              methods,
              remoteDns: false,
              host: "",
              port: 0,
              authenticated: false,
              forwarded: false
            })
            socket.end(Buffer.from([5, 0xff]))
            return
          }
          socket.write(Buffer.from([5, method]))
          let authenticated = true
          if (credentials !== undefined) {
            await take(1)
            const username = (await take(await byte())).toString("utf8")
            const password = (await take(await byte())).toString("utf8")
            authenticated = username === credentials.username && password === credentials.password
            socket.write(Buffer.from([1, authenticated ? 0 : 1]))
          }
          const type = (await take(4))[3]
          const host = type === 1
            ? [...await take(4)].join(".")
            : type === 3
            ? (await take(await byte())).toString("latin1")
            : net.SocketAddress.parse(`[${(await take(16)).toString("hex").replace(/(.{4})(?!$)/g, "$1:")}]`)
              ?.address ?? ""
          request = {
            version: "socks5",
            methods,
            remoteDns: type === 3,
            host,
            port: (await take(2)).readUInt16BE(),
            authenticated,
            forwarded: false
          }
          if (!authenticated) {
            requests.push(request)
            socket.destroy()
            return
          }
          reply = (ok) => Buffer.from([5, ok ? 0 : 4, 0, 1, 0, 0, 0, 0, 0, 0])
        } else if (version === 4) {
          const header = await take(7)
          const port = header.readUInt16BE(1)
          const address = [...header.subarray(3, 7)]
          await terminated()
          const named = address[0] === 0 && address[1] === 0 && address[2] === 0 && address[3] !== 0
          request = {
            version: named ? "socks4a" : "socks4",
            methods: [],
            remoteDns: named,
            host: named ? await terminated() : address.join("."),
            port,
            authenticated: true,
            forwarded: false
          }
          reply = (ok) => Buffer.from([0, ok ? 0x5a : 0x5b, 0, 0, 0, 0, 0, 0])
        } else {
          socket.destroy()
          return
        }
        requests.push(request)
        if (!forwarded(request.host)) {
          socket.end(reply(false))
          return
        }
        const upstream = net.connect(request.port, "127.0.0.1", () => {
          request.forwarded = true
          socket.write(reply(true))
          socket.removeAllListeners("data")
          const sniff = (chunk: Buffer) => {
            request.sent ??= firstLine(chunk)
            upstream.write(chunk)
          }
          if (buffer.length > 0) sniff(buffer)
          socket.on("data", sniff)
          upstream.on("data", (chunk: Buffer) => {
            request.received ??= firstLine(chunk)
            socket.write(chunk)
          })
        })
        track(upstream)
        upstream.on("error", () => socket.end(reply(false)))
        socket.on("close", () => upstream.destroy())
        upstream.on("close", () => socket.destroy())
      }
      const server = net.createServer((socket) => {
        track(socket)
        handle(socket).catch(() => socket.destroy())
      })
      server.listen(0, "127.0.0.1", () =>
        resume(Effect.succeed({
          server,
          sockets,
          requests,
          address: `127.0.0.1:${(server.address() as net.AddressInfo).port}`
        })))
    }),
    ({ server, sockets }) =>
      Effect.callback<void>((resume) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resume(Effect.void))
      })
  )
