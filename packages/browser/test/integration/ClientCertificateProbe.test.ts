/**
 * Feasibility probes for per-context client certificates: whether Chromium's certificate-error override, sent to
 * one context's page, leaves a sibling context's pages enforcing, and whether loopback HTTPS reaches a proxy set on
 * one context in each browser.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as net from "node:net"
import * as ChromiumLauncher from "../../src/internal/chromiumLauncher.ts"
import * as FirefoxLauncher from "../../src/internal/firefoxLauncher.ts"
import { tlsSite } from "./adapter/harness.ts"
import { chromium, firefox } from "./browsers.ts"

const connectProxy = Effect.acquireRelease(
  Effect.callback<{ server: net.Server; port: number; connects: Array<string> }>((resume) => {
    const connects: Array<string> = []
    const server = net.createServer((socket) => {
      socket.on("error", () => socket.destroy())
      socket.once("data", (chunk) => {
        const line = chunk.toString("latin1").split("\r\n")[0]!
        const [method, target] = line.split(" ")
        connects.push(line.startsWith("\u0016") ? "raw TLS ClientHello" : `${method} ${target}`)
        if (method !== "CONNECT") return socket.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n")
        const url = new URL(`http://${target}`)
        const upstream = net.connect(Number(url.port), url.hostname === "localhost" || url.hostname === "proxy.test" ? "127.0.0.1" : url.hostname)
        upstream.on("error", () => socket.destroy())
        upstream.on("connect", () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
          socket.pipe(upstream).pipe(socket)
        })
      })
    })
    server.listen(0, "127.0.0.1", () =>
      resume(Effect.succeed({ server, port: (server.address() as net.AddressInfo).port, connects })))
  }),
  ({ server }) => Effect.callback<void>((resume) => void server.close(() => resume(Effect.void)))
)

const rpc = (transport: { send: (s: string) => Effect.Effect<void, any>; messages: Stream.Stream<string, any> }) =>
  Effect.gen(function*() {
    let id = 0
    const replies = new Map<number, Deferred.Deferred<any>>()
    yield* transport.messages.pipe(
      Stream.runForEach((text) => {
        const message = JSON.parse(text)
        const reply = message.id === undefined ? undefined : replies.get(message.id)
        return reply ? Deferred.succeed(reply, message) : Effect.void
      }),
      Effect.forkScoped
    )
    return Effect.fnUntraced(function*(method: string, params: object, sessionId?: string) {
      const next = ++id
      const reply = yield* Deferred.make<any>()
      replies.set(next, reply)
      yield* transport.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }))
      return yield* Deferred.await(reply)
    })
  })

const log = (label: string, value: unknown) => Effect.sync(() => console.log(`[probe] ${label}: ${JSON.stringify(value)}`))

describe("client certificate probes", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect("chromium: per-page certificate override and loopback through a context proxy", () =>
        Effect.gen(function*() {
          const secure = yield* tlsSite
          const local = yield* connectProxy
          const { transport } = yield* ChromiumLauncher.launch({ executablePath: chromium.executable })
          const call = yield* rpc(transport)
          const version = yield* call("Browser.getVersion", {})
          yield* log("version", version.result.product)
          const page = Effect.fnUntraced(function*(context: object) {
            const { result } = yield* call("Target.createBrowserContext", context)
            const target = yield* call("Target.createTarget", {
              url: "about:blank",
              browserContextId: result.browserContextId
            })
            const attached = yield* call("Target.attachToTarget", { targetId: target.result.targetId, flatten: true })
            return attached.result.sessionId as string
          })
          const visit = Effect.fnUntraced(function*(session: string, url: string) {
            const navigated = yield* call("Page.navigate", { url }, session)
            yield* Effect.sleep("1 second")
            const title = yield* call("Runtime.evaluate", { expression: "document.title" }, session)
            return { errorText: navigated.result?.errorText, title: title.result?.result?.value }
          })
          const proxied = yield* page({
            proxyServer: `https=127.0.0.1:${local.port}`,
            proxyBypassList: "<-loopback>"
          })
          const sibling = yield* page({})
          const override = yield* call("Security.setIgnoreCertificateErrors", { ignore: true }, proxied)
          yield* log("override reply", override)
          const proxiedVisit = yield* visit(proxied, secure.origin)
          const siblingVisit = yield* visit(sibling, secure.origin)
          const laterSibling = yield* page({})
          const laterSiblingVisit = yield* visit(laterSibling, secure.origin)
          const localhostVisit = yield* visit(proxied, secure.origin.replace("127.0.0.1", "localhost"))
          const plainVisit = yield* visit(proxied, "http://127.0.0.1:9/")
          yield* log("proxied", proxiedVisit)
          yield* log("sibling", siblingVisit)
          yield* log("later sibling", laterSiblingVisit)
          yield* log("proxied localhost", localhostVisit)
          yield* log("proxied plain http", plainVisit)
          yield* log("connects", local.connects)
          assert.strictEqual(proxiedVisit.title, "secure")
          assert.isDefined(siblingVisit.errorText)
          assert.isDefined(laterSiblingVisit.errorText)
          assert.isTrue(local.connects.some((c) => c.startsWith("CONNECT 127.0.0.1:")))
        }).pipe(Effect.scoped), 60_000)

      for (const hijack of [false, true]) {
        it.effect(`firefox: loopback through a context's sslProxy, allow_hijacking_localhost ${hijack}`, () =>
          Effect.gen(function*() {
            const secure = yield* tlsSite
            const local = yield* connectProxy
            const { transport } = yield* FirefoxLauncher.launch({
              executablePath: firefox.executable,
              ...(hijack
                ? { profilePrefs: { ...FirefoxLauncher.prefsFor({}), "network.proxy.allow_hijacking_localhost": true } }
                : {})
            })
            const call = yield* rpc(transport)
            const session = yield* call("session.new", { capabilities: {} })
            yield* log("version", session.result.capabilities.browserVersion)
            const tab = Effect.fnUntraced(function*(context: object) {
              const created = yield* call("browser.createUserContext", context)
              const tab = yield* call("browsingContext.create", { type: "tab", userContext: created.result.userContext })
              return tab.result.context as string
            })
            const visit = Effect.fnUntraced(function*(context: string, url: string) {
              const navigated = yield* call("browsingContext.navigate", { context, url, wait: "complete" })
              const title = yield* call("script.evaluate", {
                expression: "document.title",
                target: { context },
                awaitPromise: false
              })
              return { error: navigated.message, title: title.result?.result?.value }
            })
            const proxied = yield* tab({
              acceptInsecureCerts: true,
              proxy: { proxyType: "manual", sslProxy: `127.0.0.1:${local.port}`, noProxy: [] }
            })
            const both = yield* tab({
              acceptInsecureCerts: true,
              proxy: {
                proxyType: "manual",
                httpProxy: `127.0.0.1:${local.port}`,
                sslProxy: `127.0.0.1:${local.port}`,
                noProxy: []
              }
            })
            const bypassing = yield* tab({
              acceptInsecureCerts: true,
              proxy: {
                proxyType: "manual",
                httpProxy: `127.0.0.1:${local.port}`,
                sslProxy: `127.0.0.1:${local.port}`,
                noProxy: ["127.0.0.1", "localhost"]
              }
            })
            const sibling = yield* tab({})
            const before = local.connects.length
            const bothVisit = yield* visit(both, secure.origin)
            yield* log("httpProxy+sslProxy 127.0.0.1", { ...bothVisit, connects: local.connects.slice(before) })
            const between = local.connects.length
            const bypassVisit = yield* visit(bypassing, secure.origin)
            yield* log("noProxy loopback", { ...bypassVisit, connects: local.connects.slice(between) })
            local.connects.length = 0
            const proxiedVisit = yield* visit(proxied, secure.origin)
            const localhostVisit = yield* visit(proxied, secure.origin.replace("127.0.0.1", "localhost"))
            const siblingVisit = yield* visit(sibling, secure.origin)
            const namedVisit = yield* visit(proxied, secure.origin.replace("127.0.0.1", "proxy.test"))
            yield* log("proxied proxy.test", namedVisit)
            yield* log("proxied", proxiedVisit)
            yield* log("proxied localhost", localhostVisit)
            yield* log("sibling", siblingVisit)
            yield* log("connects", local.connects)
          }).pipe(Effect.scoped), 60_000)
      }
    }
  )
})
