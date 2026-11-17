/**
 * Client certificates for one context. No browser protocol sets a client certificate per context, so a context
 * that asks for them gets a proxy of its own on loopback, which the context's HTTPS and WebSocket traffic goes
 * through. The proxy ends each tunnel's TLS with a self-signed certificate, which only that context accepts, and
 * opens its own TLS connection to the site, presenting the certificate whose origin matches. It closes with the
 * context's scope; a context without the option starts none of this.
 */
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import type * as Scope from "effect/Scope"
import * as crypto from "node:crypto"
import * as http from "node:http"
import * as net from "node:net"
import * as stream from "node:stream"
import * as tls from "node:tls"

/** One certificate as the caller gives it. */
export interface Input {
  readonly origin: string
  readonly cert?: Uint8Array | undefined
  readonly key?: Redacted.Redacted<Uint8Array> | undefined
  readonly pfx?: Redacted.Redacted<Uint8Array> | undefined
  readonly passphrase?: Redacted.Redacted<string> | undefined
}

/** Certificates checked and loaded, keyed by origin. */
export interface Prepared {
  readonly byOrigin: ReadonlyMap<string, tls.SecureContext>
}

/** Why certificates were refused; never names or echoes a secret. */
export class Invalid {
  readonly expected: string
  readonly hint: string
  constructor(expected: string, hint: string) {
    this.expected = expected
    this.hint = hint
  }
}

const bytes = (value: unknown): Buffer | undefined =>
  value instanceof Uint8Array ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : undefined

const secret = <A>(value: Redacted.Redacted<A> | undefined, check: (a: unknown) => boolean): A | undefined | null => {
  if (value === undefined) return undefined
  if (!Redacted.isRedacted(value)) return null
  const inner = Redacted.value(value) as A
  return check(inner) ? inner : null
}

/** Checks every entry and loads it into a TLS context, so a bad file or passphrase fails at creation. */
export const prepare = (inputs: ReadonlyArray<Input>): Prepared | Invalid => {
  if (!Array.isArray(inputs)) {
    return new Invalid("an array of client certificates", "Pass one entry per origin")
  }
  const byOrigin = new Map<string, tls.SecureContext>()
  for (const [index, input] of inputs.entries()) {
    const at = `clientCertificates[${index}]`
    const url = typeof input?.origin === "string" ? URL.parse(input.origin) : null
    if (
      url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      url.pathname !== "/" || url.search !== "" || url.hash !== ""
    ) {
      return new Invalid("an HTTPS origin", `${at}.origin must be an HTTPS origin, such as https://example.com`)
    }
    const cert = input.cert === undefined ? undefined : bytes(input.cert)
    const key = secret(input.key, (value) => value instanceof Uint8Array)
    const pfx = secret(input.pfx, (value) => value instanceof Uint8Array)
    const passphrase = secret<string>(input.passphrase, (value) => typeof value === "string")
    if ((input.cert !== undefined && cert === undefined) || key === null || pfx === null || passphrase === null) {
      return new Invalid(
        "cert as bytes, and key, pfx and passphrase as Redacted values",
        `${at} has a value of the wrong type`
      )
    }
    const pem = cert !== undefined && key !== undefined
    if (pem === (pfx !== undefined) || (cert === undefined) !== (key === undefined)) {
      return new Invalid("a PEM cert with its key, or a pfx", `${at} must give either cert and key, or pfx`)
    }
    let context: tls.SecureContext
    try {
      context = tls.createSecureContext(
        pem
          ? { cert, key: bytes(key)!, ...(passphrase === undefined ? {} : { passphrase }) }
          : { pfx: bytes(pfx)!, ...(passphrase === undefined ? {} : { passphrase }) }
      )
    } catch {
      return new Invalid(
        "a readable certificate and key",
        `${at} could not be loaded: check the files and the passphrase`
      )
    }
    byOrigin.set(url.origin, context)
  }
  return { byOrigin }
}

// ── The proxy's own certificate ────────────────────────────────────────────────────────────────────────────

const length = (n: number): Array<number> => n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]
const tlv = (tag: number, ...parts: ReadonlyArray<Uint8Array>): Buffer => {
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([tag, ...length(body.length)]), body])
}
const oid = (dotted: string): Buffer => {
  const [first, second, ...rest] = dotted.split(".").map(Number)
  const out = [first! * 40 + second!]
  for (const arc of rest) {
    const groups = [arc & 0x7f]
    for (let value = arc >> 7; value > 0; value >>= 7) groups.unshift((value & 0x7f) | 0x80)
    out.push(...groups)
  }
  return tlv(0x06, Buffer.from(out))
}
const utcTime = (date: Date) =>
  tlv(0x17, Buffer.from(date.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z", "latin1"))

let selfSigned: { readonly key: string; readonly cert: string } | undefined

/**
 * A self-signed P-256 certificate for the browser side of each tunnel, made once per process. Its names don't
 * matter: only the context that uses the proxy accepts it, as it accepts any certificate error.
 */
export const proxyCertificate = () => {
  if (selfSigned !== undefined) return selfSigned
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
  const algorithm = tlv(0x30, oid("1.2.840.10045.4.3.2"))
  const name = tlv(0x30, tlv(0x31, tlv(0x30, oid("2.5.4.3"), tlv(0x0c, Buffer.from("Strider client certificates")))))
  const serial = crypto.randomBytes(8)
  serial[0] = (serial[0]! & 0x7f) | 0x01
  const now = Date.now()
  const tbs = tlv(
    0x30,
    tlv(0xa0, tlv(0x02, Buffer.from([2]))),
    tlv(0x02, serial),
    algorithm,
    name,
    tlv(0x30, utcTime(new Date(now - 86_400_000)), utcTime(new Date(now + 365 * 86_400_000))),
    name,
    publicKey.export({ type: "spki", format: "der" })
  )
  const signature = crypto.sign("sha256", tbs, privateKey)
  const der = tlv(0x30, tbs, algorithm, tlv(0x03, Buffer.from([0]), signature))
  const cert = `-----BEGIN CERTIFICATE-----\n${
    der.toString("base64").replace(/.{64}/g, "$&\n")
  }\n-----END CERTIFICATE-----\n`
  return selfSigned = { key: privateKey.export({ type: "pkcs8", format: "pem" }) as string, cert }
}

// ── The proxy ──────────────────────────────────────────────────────────────────────────────────────────────

/** A running proxy: its loopback port. */
export interface Running {
  readonly port: number
}

const target = (authority: string) => {
  const url = URL.parse(`https://${authority}`)
  if (url === null || url.port === "" && !authority.endsWith(":443")) return undefined
  return { origin: url.origin, host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port || 443) }
}

/**
 * Starts the context's proxy on 127.0.0.1, closed with the scope. A tunnel whose first bytes are a TLS
 * ClientHello is re-encrypted toward the site; any other tunnel is passed through unchanged, and plain HTTP
 * requests are forwarded. The site is verified against Node's trusted certificates unless `acceptInsecureCerts`.
 * When the site can't be reached or verified, the browser's connection is closed, so the browser reports it.
 */
export const serve = (
  prepared: Prepared,
  options: { readonly acceptInsecureCerts: boolean }
): Effect.Effect<Running, Error, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.callback<{ readonly server: http.Server; readonly sockets: Set<net.Socket>; readonly port: number }, Error>(
      (resume) => {
        const own = proxyCertificate()
        const sockets = new Set<net.Socket>()
        const track = <S extends net.Socket>(socket: S): S => {
          sockets.add(socket)
          socket.on("close", () => sockets.delete(socket))
          socket.on("error", () => socket.destroy())
          return socket
        }
        const server = http.createServer((request, response) => {
          const url = URL.parse(request.url ?? "")
          if (url === null || url.protocol !== "http:") {
            response.writeHead(400).end()
            return
          }
          const headers = { ...request.headers }
          delete headers["proxy-connection"]
          const upstream = http.request(url, { method: request.method, headers }, (reply) => {
            response.writeHead(reply.statusCode!, reply.statusMessage, reply.headers)
            reply.pipe(response)
          })
          upstream.on("socket", track)
          upstream.on("error", () => response.destroy())
          request.pipe(upstream)
        })
        server.on("connection", track)
        server.on("connect", (request: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
          const destination = target(request.url ?? "")
          if (destination === undefined) {
            socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
            return
          }
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
          const start = (first: Buffer) => {
            if (first[0] !== 0x16) {
              const plain = track(net.connect(destination.port, destination.host))
              plain.on("close", () => socket.destroy())
              socket.on("close", () => plain.destroy())
              plain.write(first)
              socket.pipe(plain).pipe(socket)
              return
            }
            socket.pause()
            const context = prepared.byOrigin.get(destination.origin)
            const site = track(tls.connect({
              host: destination.host,
              port: destination.port,
              ...(net.isIP(destination.host) === 0 ? { servername: destination.host } : {}),
              ALPNProtocols: ["http/1.1"],
              rejectUnauthorized: !options.acceptInsecureCerts,
              ...(context === undefined ? {} : { secureContext: context })
            }))
            site.on("close", () => socket.destroy())
            socket.on("close", () => site.destroy())
            site.once("secureConnect", () => {
              // The ClientHello was read off the socket, so the TLS server reads it, and the rest, from a stream.
              const inbound = new stream.Duplex({
                read: () => void socket.resume(),
                write: (chunk, _, done) => void socket.write(chunk, done),
                final: (done) => {
                  socket.end()
                  done()
                }
              })
              socket.on("data", (chunk) => {
                if (!inbound.push(chunk)) socket.pause()
              })
              socket.on("end", () => inbound.push(null))
              inbound.push(first)
              const browser = new tls.TLSSocket(inbound, {
                isServer: true,
                key: own.key,
                cert: own.cert,
                ALPNProtocols: ["http/1.1"]
              })
              browser.on("error", () => socket.destroy())
              browser.on("close", () => site.destroy())
              site.on("close", () => browser.destroy())
              browser.pipe(site).pipe(browser)
            })
          }
          if (head.length > 0) start(head)
          else socket.once("data", start)
        })
        server.on("error", (error) => resume(Effect.fail(error)))
        server.listen(0, "127.0.0.1", () =>
          resume(Effect.succeed({ server, sockets, port: (server.address() as net.AddressInfo).port })))
      }
    ),
    ({ server, sockets }) =>
      Effect.callback<void>((resume) => {
        for (const socket of sockets) {
          socket.destroy()
        }
        server.close(() =>
          resume(Effect.void)
        )
      })
  ).pipe(Effect.map(({ port }) => ({ port })))
