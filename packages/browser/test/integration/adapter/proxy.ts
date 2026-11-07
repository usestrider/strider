/** A local HTTP/CONNECT proxy. Credentials are checked but never kept in its request log. */
import * as Effect from "effect/Effect"
import * as http from "node:http"
import * as net from "node:net"

export const proxy = (credentials?: { readonly username: string; readonly password: string }) =>
  Effect.acquireRelease(
    Effect.callback<{
      readonly server: http.Server
      readonly sockets: Set<net.Socket>
      readonly address: string
      readonly requests: Array<{ readonly method: string; readonly url: string; readonly authenticated: boolean }>
    }>((resume) => {
      const sockets = new Set<net.Socket>()
      const requests: Array<{ method: string; url: string; authenticated: boolean }> = []
      const authorized = (request: http.IncomingMessage) => {
        const authenticated = credentials === undefined || request.headers["proxy-authorization"] ===
            `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`
        requests.push({ method: request.method ?? "GET", url: request.url ?? "", authenticated })
        return authenticated
      }
      const track = (socket: net.Socket) => {
        sockets.add(socket)
        socket.on("close", () => sockets.delete(socket))
        socket.on("error", () => socket.destroy())
      }
      const server = http.createServer((request, response) => {
        if (!authorized(request)) {
          response.writeHead(407, { "proxy-authenticate": "Basic realm=\"local-proxy\"" })
          response.end()
          return
        }
        const url = new URL(request.url!)
        if (url.hostname !== "proxy.test") {
          response.writeHead(502)
          response.end()
          return
        }
        url.hostname = "127.0.0.1"
        const headers = { ...request.headers }
        delete headers["proxy-authorization"]
        delete headers["proxy-connection"]
        const upstream = http.request(url, { method: request.method, headers }, (reply) => {
          response.writeHead(reply.statusCode!, reply.headers)
          reply.pipe(response)
        })
        upstream.on("socket", track)
        upstream.on("error", () => {
          response.writeHead(502)
          response.end()
        })
        request.pipe(upstream)
      })
      server.on("connection", track)
      server.on("connect", (request, socket, head) => {
        if (!authorized(request)) {
          socket.end(
            "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"local-proxy\"\r\nContent-Length: 0\r\n\r\n"
          )
          return
        }
        const url = new URL(`http://${request.url}`)
        const upstream = net.connect(
          Number(url.port),
          url.hostname === "proxy.test" ? "127.0.0.1" : url.hostname,
          () => {
            socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
            upstream.write(head)
            socket.pipe(upstream).pipe(socket)
          }
        )
        track(upstream)
        socket.on("close", () => upstream.destroy())
        upstream.on("close", () => socket.destroy())
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
