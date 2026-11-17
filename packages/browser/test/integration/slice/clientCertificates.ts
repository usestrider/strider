/** Client certificates and per-context certificate acceptance, through every backend's public API. */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as fs from "node:fs"
import * as https from "node:https"
import type * as net from "node:net"
import * as path from "node:path"
import type * as tls from "node:tls"
import { supports } from "./capabilities.ts"

const fixture = (name: string) =>
  fs.readFileSync(path.join(import.meta.dirname, "../../fixtures/client-certificates", name))
const cert = new Uint8Array(fixture("client.pem"))
const key = Redacted.make(new Uint8Array(fixture("client-key.pem")))

/** An HTTPS site signed by a test CA no browser or Node trusts; its page shows the client certificate's name. */
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
      response.writeHead(200, { "content-type": "text/html" })
      response.end(`<title>${peer.subject?.CN ?? "none"}</title>`)
    })
    server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
  }),
  (server) =>
    Effect.callback<void>((resume) => {
      server.closeAllConnections()
      server.close(() => resume(Effect.void))
    })
).pipe(Effect.map((server) => (server.address() as net.AddressInfo).port))

const certificateTitle = (context: UserContext.UserContext, url: string) =>
  Effect.gen(function*() {
    const page = yield* context.newPage
    const loaded = yield* page.goto(url).pipe(Effect.exit)
    if (Exit.isFailure(loaded)) return undefined
    return yield* page.evaluateInMainWorld(() => document.title)
  })

export const clientCertificates = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} client certificates`, () => {
    layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
      it.effect("presents the certificate to its origin alone", () =>
        Effect.gen(function*() {
          if (!(yield* supports("clientCertificates"))) return
          const port = yield* site
          const context = yield* Browser.newContext({
            acceptInsecureCerts: true,
            clientCertificates: [{ origin: `https://127.0.0.1:${port}`, cert, key }]
          })
          assert.strictEqual(yield* certificateTitle(context, `https://127.0.0.1:${port}/`), "Strider test client")
          assert.strictEqual(yield* certificateTitle(context, `https://localhost:${port}/`), "none")
        }).pipe(Effect.scoped))

      it.effect("fails a site Node doesn't trust unless certificate errors are accepted", () =>
        Effect.gen(function*() {
          if (!(yield* supports("clientCertificates"))) return
          const port = yield* site
          const context = yield* Browser.newContext({
            clientCertificates: [{ origin: `https://127.0.0.1:${port}`, cert, key }]
          })
          assert.isUndefined(yield* certificateTitle(context, `https://127.0.0.1:${port}/`))
        }).pipe(Effect.scoped))

      it.effect("leaves a sibling context without certificates or accepted certificate errors", () =>
        Effect.gen(function*() {
          if (!(yield* supports("clientCertificates"))) return
          const port = yield* site
          yield* Browser.newContext({
            acceptInsecureCerts: true,
            clientCertificates: [{ origin: `https://127.0.0.1:${port}`, cert, key }]
          })
          const accepting = yield* Browser.newContext({ acceptInsecureCerts: true })
          const sibling = yield* Browser.newContext()
          assert.strictEqual(yield* certificateTitle(accepting, `https://127.0.0.1:${port}/`), "none")
          assert.isUndefined(yield* certificateTitle(sibling, `https://127.0.0.1:${port}/`))
        }).pipe(Effect.scoped))

      it.effect("refuses certificates it can't load, without echoing the secret, or a backend without support", () =>
        Effect.gen(function*() {
          const wrong = yield* Browser.newContext({
            clientCertificates: [{
              origin: "https://127.0.0.1",
              pfx: Redacted.make(new Uint8Array(fixture("client.pfx"))),
              passphrase: Redacted.make("not-the-passphrase")
            }]
          }).pipe(Effect.flip)
          const supported = yield* supports("clientCertificates")
          assert(wrong._tag === "UserContextError")
          assert.strictEqual(wrong.reason._tag, "InvalidInput")
          assert.notInclude(JSON.stringify(wrong), "not-the-passphrase")
          if (supported) return
          const refused = yield* Browser.newContext({
            clientCertificates: [{ origin: "https://127.0.0.1", cert, key }]
          }).pipe(Effect.flip)
          assert(refused._tag === "UserContextError")
          assert.strictEqual(refused.reason._tag, "Unsupported")
        }).pipe(Effect.scoped))
    })
  })
