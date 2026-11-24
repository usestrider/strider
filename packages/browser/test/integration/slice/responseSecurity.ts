/** A response's server address and TLS details, and the HAR fields that record them, through every backend. */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Har, NetworkResponse } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as fs from "node:fs"
import * as http from "node:http"
import * as https from "node:https"
import type * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { responseSecurity } from "./capabilities.ts"

const fixture = (name: string) =>
  fs.readFileSync(path.join(import.meta.dirname, "../../fixtures/client-certificates", name))

/** The test server certificate's validity, in seconds since the epoch. */
const validFrom = Date.parse("2026-11-17T06:30:46Z") / 1000
const validTo = Date.parse("2126-10-24T06:30:46Z") / 1000

const handler: http.RequestListener = (request, response) => {
  if (request.url === "/redirect") {
    response.writeHead(302, { location: "/final" })
    response.end()
  } else {
    response.writeHead(200, { "content-type": "text/html" })
    response.end("<title>served</title>")
  }
}

/** A server on 127.0.0.1, HTTPS with a certificate no browser trusts or plain HTTP; its origin. */
const serve = (secure: boolean) =>
  Effect.acquireRelease(
    Effect.callback<http.Server>((resume) => {
      const server = secure
        ? https.createServer({ key: fixture("server-key.pem"), cert: fixture("server.pem") }, handler)
        : http.createServer(handler)
      server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
    }),
    (server) =>
      Effect.callback<void>((resume) => {
        server.closeAllConnections()
        server.close(() => resume(Effect.void))
      })
  ).pipe(Effect.map((server) => {
    const port = (server.address() as net.AddressInfo).port
    return { port, origin: `${secure ? "https" : "http"}://127.0.0.1:${port}` }
  }))

interface HarEntry {
  readonly request: { readonly url: string }
  readonly serverIPAddress?: string
  readonly _serverPort?: number
  readonly _securityDetails?: Record<string, unknown>
}

export const responseSecurityCases = (
  name: "Chromium" | "Firefox" | "WebKit",
  backend: Layer.Layer<Browser.Browser, unknown>
) =>
  describe(`${name} response security`, () => {
    const reports = responseSecurity[name]
    layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
      it.effect("reports an HTTPS response's TLS details and server address", () =>
        Effect.gen(function*() {
          const served = yield* serve(true)
          const context = yield* Browser.newContext({ acceptInsecureCerts: true })
          const page = yield* context.newPage
          const response = yield* NetworkResponse.next(page, { url: `${served.origin}/` })
          yield* page.goto(`${served.origin}/`)
          const { securityDetails, serverAddress } = yield* response
          assert.deepStrictEqual(
            Option.map(serverAddress, ({ ip, port }) => ({ ip, port })),
            reports.addressWithResponse ? Option.some({ ip: "127.0.0.1", port: served.port }) : Option.none()
          )
          if (!reports.securityDetails.final) {
            assert.isTrue(Option.isNone(securityDetails))
            return
          }
          assert(Option.isSome(securityDetails))
          const details = securityDetails.value
          if (reports.protocolWithResponse) assert.match(Option.getOrThrow(details.protocol), /^TLS 1\.[23]$/)
          else assert.isTrue(Option.isNone(details.protocol))
          assert.deepStrictEqual(details.subjectName, Option.some("localhost"))
          assert.deepStrictEqual(details.issuer, reports.issuer ? Option.some("Strider test CA") : Option.none())
          assert.deepStrictEqual(details.validFrom, Option.some(validFrom))
          assert.deepStrictEqual(details.validTo, Option.some(validTo))
        }).pipe(Effect.scoped))

      it.effect("reports no TLS details for plain HTTP", () =>
        Effect.gen(function*() {
          const served = yield* serve(false)
          const page = yield* Browser.newPage()
          const response = yield* NetworkResponse.next(page, { url: `${served.origin}/` })
          yield* page.goto(`${served.origin}/`)
          const { securityDetails, serverAddress } = yield* response
          assert.isTrue(Option.isNone(securityDetails))
          assert.strictEqual(Option.isSome(serverAddress), reports.addressWithResponse)
        }).pipe(Effect.scoped))

      it.effect("records each redirect hop's server address and TLS details in a HAR", () =>
        Effect.gen(function*() {
          const served = yield* serve(true)
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-har-security-"))
          yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
          const out = path.join(directory, "security.har")
          yield* Effect.scoped(Effect.gen(function*() {
            const context = yield* Browser.newContext({ acceptInsecureCerts: true })
            const page = yield* context.newPage
            const har = yield* Har.record(page, { content: "omit", inFlightAtStop: "wait" })
            const redirect = yield* NetworkResponse.next(page, { url: `${served.origin}/redirect` })
            yield* page.goto(`${served.origin}/redirect`)
            const hop = yield* redirect
            assert.strictEqual(hop.status, 302)
            assert.strictEqual(Option.isSome(hop.securityDetails), reports.securityDetails.redirect)
            yield* har.entries.waitFor((count) => count >= 2)
            yield* har.exportHar(out)
          }))
          const entries: ReadonlyArray<HarEntry> = JSON.parse(fs.readFileSync(out, "utf8")).log.entries
          const final = entries.find((entry) => entry.request.url === `${served.origin}/final`)
          const first = entries.find((entry) => entry.request.url === `${served.origin}/redirect`)
          assert.isDefined(final, entries.map((entry) => entry.request.url).join(", "))
          assert.isDefined(first)
          for (const [entry, hop] of [[first, "redirect"], [final, "final"]] as const) {
            if (reports.addressInHar[hop]) {
              assert.strictEqual(entry.serverIPAddress, "127.0.0.1")
              assert.strictEqual(entry._serverPort, served.port)
            } else {
              assert.isUndefined(entry.serverIPAddress)
              assert.isUndefined(entry._serverPort)
            }
            if (!reports.securityDetails[hop]) {
              assert.isUndefined(entry._securityDetails, hop)
              continue
            }
            assert.isDefined(entry._securityDetails, hop)
            assert.include(entry._securityDetails, { subjectName: "localhost", validFrom, validTo })
            // WebKit's TLS version comes as the hop finishes, so the HAR has it on every backend that reports details
            assert.match(String(entry._securityDetails.protocol), /^TLS 1\.[23]$/)
            if (reports.issuer) assert.strictEqual(entry._securityDetails.issuer, "Strider test CA")
            else assert.notProperty(entry._securityDetails, "issuer")
          }
        }).pipe(Effect.scoped))
    })
  })
