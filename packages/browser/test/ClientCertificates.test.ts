import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as fs from "node:fs"
import * as http from "node:http"
import * as https from "node:https"
import * as net from "node:net"
import * as path from "node:path"
import * as tls from "node:tls"
import * as ClientCertificates from "../src/internal/clientCertificates.ts"

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures/client-certificates", name))
const cert = fixture("client.pem")
const key = Redacted.make(new Uint8Array(fixture("client-key.pem")))
const pfx = Redacted.make(new Uint8Array(fixture("client.pfx")))

/** An HTTPS site, signed by a CA Node doesn't trust, that answers with the client certificate's name. */
const site = Effect.acquireRelease(
  Effect.callback<https.Server>((resume) => {
    const server = https.createServer({
      key: fixture("server-key.pem"),
      cert: fixture("server.pem"),
      ca: fixture("ca.pem"),
      requestCert: true,
      rejectUnauthorized: false
    }, (request, response) => {
      const peer = (request.socket as tls.TLSSocket).getPeerCertificate()
      response.end(peer.subject?.CN ?? "none")
    })
    server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
  }),
  (server) => Effect.callback<void>((resume) => void server.close(() => resume(Effect.void)))
).pipe(Effect.map((server) => (server.address() as net.AddressInfo).port))

/** Fetches `https://host:port/` through the proxy, as a browser would; undefined when the tunnel closes. */
const fetchThrough = (proxy: number, authority: string) =>
  Effect.promise(() =>
    new Promise<string | undefined>((resolve) => {
      const socket = net.connect(proxy, "127.0.0.1", () => socket.write(`CONNECT ${authority} HTTP/1.1\r\n\r\n`))
      socket.once("data", () => {
        const secure = tls.connect({ socket, rejectUnauthorized: false, servername: "localhost" }, () =>
          secure.write(`GET / HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`))
        let body = ""
        secure.on("data", (chunk) =>
          body += chunk)
        secure.on("error", () => resolve(undefined))
        secure.on("close", () => resolve(body === "" ? undefined : body.split("\r\n\r\n")[1]))
      })
      socket.on("error", () => resolve(undefined))
    })
  )

const prepared = (inputs: ReadonlyArray<ClientCertificates.Input>) => {
  const result = ClientCertificates.prepare(inputs)
  if (result instanceof ClientCertificates.Invalid) throw new Error(result.hint)
  return result
}

describe("ClientCertificates", () => {
  describe("prepare", () => {
    it("accepts a PEM certificate with its key, or a PFX with its passphrase", () => {
      const pem = prepared([{ origin: "https://example.com:443", cert, key }])
      assert.deepStrictEqual([...pem.byOrigin.keys()], ["https://example.com"])
      const archive = prepared([{
        origin: "https://localhost:8443",
        pfx,
        passphrase: Redacted.make("fixture-passphrase")
      }])
      assert.deepStrictEqual([...archive.byOrigin.keys()], ["https://localhost:8443"])
    })

    it("refuses a non-HTTPS origin, a missing key, a bare secret and a wrong passphrase, never echoing it", () => {
      const refused = (inputs: ReadonlyArray<ClientCertificates.Input>) => {
        const result = ClientCertificates.prepare(inputs)
        assert.instanceOf(result, ClientCertificates.Invalid)
        return result as ClientCertificates.Invalid
      }
      refused([{ origin: "http://example.com", cert, key }])
      refused([{ origin: "https://example.com/path", cert, key }])
      refused([{ origin: "https://example.com", cert }])
      refused([{ origin: "https://example.com", cert, key: fixture("client-key.pem") as any }])
      refused([{ origin: "https://example.com", cert, key, pfx }])
      const wrong = refused([{ origin: "https://example.com", pfx, passphrase: Redacted.make("not-the-passphrase") }])
      assert.notInclude(`${wrong.expected} ${wrong.hint}`, "not-the-passphrase")
    })
  })

  describe("serve", () => {
    it.effect("presents the certificate to its origin alone", () =>
      Effect.gen(function*() {
        const port = yield* site
        const proxy = yield* ClientCertificates.serve(
          prepared([{ origin: `https://127.0.0.1:${port}`, cert, key }]),
          { acceptInsecureCerts: true }
        )
        assert.strictEqual(yield* fetchThrough(proxy.port, `127.0.0.1:${port}`), "Strider test client")
        assert.strictEqual(yield* fetchThrough(proxy.port, `localhost:${port}`), "none")
      }).pipe(Effect.scoped))

    it.effect("closes the tunnel to a site Node doesn't trust unless certificate errors are accepted", () =>
      Effect.gen(function*() {
        const port = yield* site
        const proxy = yield* ClientCertificates.serve(
          prepared([{ origin: `https://127.0.0.1:${port}`, cert, key }]),
          { acceptInsecureCerts: false }
        )
        assert.isUndefined(yield* fetchThrough(proxy.port, `127.0.0.1:${port}`))
      }).pipe(Effect.scoped))

    it.effect("passes a tunnel that isn't TLS through, and forwards plain HTTP", () =>
      Effect.gen(function*() {
        const plain = yield* Effect.acquireRelease(
          Effect.callback<http.Server>((resume) => {
            const server = http.createServer((_, response) => response.end("plain"))
            server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
          }),
          (server) => Effect.callback<void>((resume) => void server.close(() => resume(Effect.void)))
        )
        const port = (plain.address() as net.AddressInfo).port
        const proxy = yield* ClientCertificates.serve(prepared([]), { acceptInsecureCerts: false })
        const tunneled = yield* Effect.promise(() =>
          new Promise<string>((resolve) => {
            const socket = net.connect(
              proxy.port,
              "127.0.0.1",
              () => socket.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\n\r\n`)
            )
            let text = ""
            socket.once("data", () => {
              socket.on("data", (chunk) => text += chunk)
              socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`)
            })
            socket.on("close", () => resolve(text))
          })
        )
        assert.match(tunneled, /plain$/)
        const forwarded = yield* Effect.promise(() =>
          new Promise<string>((resolve) => {
            http.get({ host: "127.0.0.1", port: proxy.port, path: `http://127.0.0.1:${port}/` }, (response) => {
              let text = ""
              response.on("data", (chunk) => text += chunk)
              response.on("end", () => resolve(text))
            })
          })
        )
        assert.strictEqual(forwarded, "plain")
      }).pipe(Effect.scoped))
  })
})
