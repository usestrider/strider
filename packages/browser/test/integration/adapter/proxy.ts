/**
 * A local HTTP/CONNECT proxy. Only proxy.test is forwarded, to loopback at the requested port; other hosts fail.
 * This makes proxy-side DNS and bypass observable without external sites. Credentials never enter its request log.
 * With `tls`, the browser reaches the proxy itself over TLS (an `https://` proxy endpoint).
 */
import * as Effect from "effect/Effect"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as http from "node:http"
import * as https from "node:https"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { openssl } from "../browsers.ts"

/** A self-signed key pair for `127.0.0.1`, which no browser trusts. */
export const selfSigned = Effect.acquireRelease(
  Effect.sync(() => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-proxy-tls-"))
    const key = path.join(directory, "key.pem")
    const cert = path.join(directory, "cert.pem")
    execFileSync(openssl, [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1"
    ], { stdio: "ignore" })
    return { directory, key: fs.readFileSync(key), cert: fs.readFileSync(cert) }
  }),
  ({ directory }) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
)

export const proxy = (
  credentials?: { readonly username: string; readonly password: string },
  options?: {
    readonly websiteChallenge?: boolean | undefined
    readonly tls?: { readonly key: Buffer; readonly cert: Buffer } | undefined
  }
) =>
  Effect.acquireRelease(
    Effect.callback<{
      readonly server: http.Server | https.Server
      readonly sockets: Set<net.Socket>
      readonly address: string
      readonly requests: Array<{ readonly method: string; readonly url: string; readonly authenticated: boolean }>
      /** TLS handshakes begun, completed or not; always 0 without `tls`. */
      readonly handshakes: { count: number }
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
      const listener: http.RequestListener = (request, response) => {
        if (!authorized(request)) {
          response.writeHead(407, {
            "proxy-authenticate": "Basic realm=\"local-proxy\"",
            ...(options?.websiteChallenge === true ? { "www-authenticate": "Basic realm=\"local-proxy\"" } : {})
          })
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
      }
      const server = options?.tls === undefined
        ? http.createServer(listener)
        : https.createServer({ key: options.tls.key, cert: options.tls.cert }, listener)
      server.on("connection", track)
      const handshakes = { count: 0 }
      server.on("secureConnection", () => handshakes.count++)
      server.on("tlsClientError", () => handshakes.count++)
      server.on("connect", (request, socket, head) => {
        if (!authorized(request)) {
          socket.end(
            "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"local-proxy\"\r\n" +
              (options?.websiteChallenge === true ? "WWW-Authenticate: Basic realm=\"local-proxy\"\r\n" : "") +
              "Content-Length: 0\r\n\r\n"
          )
          return
        }
        const url = new URL(`http://${request.url}`)
        if (url.hostname !== "proxy.test") {
          socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
          return
        }
        const upstream = net.connect(
          Number(url.port),
          "127.0.0.1",
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
          handshakes,
          address: `127.0.0.1:${(server.address() as net.AddressInfo).port}`
        })))
    }),
    ({ server, sockets }) =>
      Effect.callback<void>((resume) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resume(Effect.void))
      })
  )
