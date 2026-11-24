/**
 * A context's declarations on the workers that have no page, a service worker and a shared worker, through every
 * backend: its routes, network emulation, extra headers and user agent apply to their requests, and its network
 * events report them, a service worker's script load included.
 */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, NetworkRequest, type Page, Route, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as http from "node:http"
import type * as net from "node:net"
import { fullySupports, status, supports } from "./capabilities.ts"

const timeout = 60_000

/**
 * The service worker's script: it imports `/imported.js`, takes control at once, and answers a message on its port
 * with the outcome of a `fetch` it makes itself.
 */
const serviceWorker = `importScripts('/imported.js');
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  const { path, init } = event.data;
  fetch(path, init).then((r) => r.text()).then((text) => 'ok:' + text, (error) => 'failed:' + error.message)
    .then((outcome) => event.ports[0].postMessage(outcome));
});`

const sharedWorker = `self.onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = (message) => fetch(message.data).then((r) => r.text()).then((text) => 'ok:' + text,
    (error) => 'failed:' + error.message).then((outcome) => port.postMessage(outcome));
};`

const handler: http.RequestListener = (request, response) => {
  const send = (type: string, body: string) => {
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" })
    response.end(body)
  }
  if (request.url === "/sw.js") send("text/javascript", serviceWorker)
  else if (request.url === "/imported.js") send("text/javascript", "self.imported = true;")
  else if (request.url === "/shared.js") send("text/javascript", sharedWorker)
  else if (request.url === "/data") send("text/plain", "network")
  else if (request.url === "/headers") send("application/json", JSON.stringify(request.headers))
  else send("text/html", "<title>service workers</title>")
}

/** A server of its own on 127.0.0.1, so each case's worker scripts and requests are this file's; its origin. */
const serve = Effect.acquireRelease(
  Effect.callback<http.Server>((resume) => {
    const server = http.createServer(handler)
    server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
  }),
  (server) =>
    Effect.callback<void>((resume) => {
      server.closeAllConnections()
      server.close(() => resume(Effect.void))
    })
).pipe(Effect.map((server) => `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`))

/** Registers `/sw.js` from the page and waits until it is active. */
const register = (page: Page.Page) =>
  page.evaluateInMainWorld(async () => {
    await navigator.serviceWorker.register("/sw.js")
    await navigator.serviceWorker.ready
  })

/** The outcome of a `fetch` the page's active service worker makes: `ok:` and the body, or `failed:` and why. */
const fromServiceWorker = (page: Page.Page, path: string, init?: { method: string; body: string }) =>
  page.evaluateInMainWorld(async (input) => {
    const registration = await navigator.serviceWorker.ready
    const channel = new MessageChannel()
    const reply = new Promise<string>((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data)
    })
    registration.active!.postMessage({ path: input.path, init: input.init }, [channel.port2])
    return await reply
  }, { path, init: init ?? null })

/** A fresh context with the options given, a page of it, and a server of the case's own. */
const open = Effect.fnUntraced(function*(options?: UserContext.Options) {
  const origin = yield* serve
  const context = yield* Browser.newContext(options)
  const page = yield* context.newPage
  return { origin, context, page }
})

/**
 * Whether a context's declarations and network events reach its service and shared workers. Where they don't, a
 * case checks that the worker's request went past them, to the network, as the capability table says.
 */
const reachesWorkers = Effect.map(status("network.serviceWorkers"), (found) => found !== "unsupported")

export const serviceWorkers = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} service and shared workers`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect("fulfills a service worker's fetch by its context's route", () =>
        Effect.gen(function*() {
          const { context, origin, page } = yield* open()
          yield* page.goto(`${origin}/`)
          yield* register(page)
          yield* context.route(`${origin}/data`, () => Route.fulfill(HttpServerResponse.text("routed")))
          assert.strictEqual(
            yield* fromServiceWorker(page, "/data"),
            (yield* reachesWorkers) ? "ok:routed" : "ok:network"
          )
        }), timeout)

      it.effect("fails a service worker's fetch while its context is offline", () =>
        Effect.gen(function*() {
          const { context, origin, page } = yield* open()
          yield* page.goto(`${origin}/`)
          yield* register(page)
          if (!(yield* supports("emulation.network.offline"))) {
            const error = yield* Effect.flip(context.emulate({ network: "offline" }))
            assert.strictEqual(error._tag, "DeclarationError", String(error))
            return
          }
          yield* context.emulate({ network: "offline" })
          assert.match(yield* fromServiceWorker(page, "/data"), (yield* reachesWorkers) ? /^failed:/ : /^ok:network$/)
        }), timeout)

      it.effect(
        "sends its context's extra headers and user agent on a service worker's fetch",
        () =>
          Effect.gen(function*() {
            const userAgent = yield* supports("emulation.userAgent")
            const { origin, page } = yield* open({
              emulation: {
                extraHTTPHeaders: { "x-strider-worker": "context" },
                ...(userAgent ? { userAgent: "Strider-ServiceWorker/1" } : {})
              }
            })
            yield* page.goto(`${origin}/`)
            yield* register(page)
            const reply = yield* fromServiceWorker(page, "/headers")
            const headers = JSON.parse(reply.replace(/^ok:/, "")) as Record<string, string>
            if (!(yield* reachesWorkers)) return assert.isUndefined(headers["x-strider-worker"])
            assert.strictEqual(headers["x-strider-worker"], "context")
            if (userAgent) assert.strictEqual(headers["user-agent"], "Strider-ServiceWorker/1")
          }),
        timeout
      )

      it.effect(
        "reports a service worker's script load and its imports in its context's network events",
        () =>
          Effect.gen(function*() {
            const { context, origin, page } = yield* open()
            yield* page.goto(`${origin}/`)
            if (!(yield* reachesWorkers)) return yield* register(page)
            // Chromium's support is partial for the script load alone, which it fetches before the worker starts
            const scriptReported = yield* fullySupports("network.serviceWorkers")
            const script = yield* NetworkRequest.next(context, { url: `${origin}/sw.js` })
            const imported = yield* NetworkRequest.next(context, { url: `${origin}/imported.js` })
            yield* register(page)
            assert.strictEqual((yield* imported).url, `${origin}/imported.js`)
            if (scriptReported) assert.strictEqual((yield* script).url, `${origin}/sw.js`)
          }),
        timeout
      )

      it.effect("reads a service worker's POST body through a body decoder", () =>
        Effect.gen(function*() {
          const { context, origin, page } = yield* open()
          yield* page.goto(`${origin}/`)
          yield* register(page)
          // Unreported, the POST has no body to read
          if (!(yield* reachesWorkers)) {
            const sent = yield* fromServiceWorker(page, "/data", { method: "POST", body: "from the worker" })
            return assert.strictEqual(sent, "ok:network")
          }
          const posted = yield* NetworkRequest.next(context, {
            url: `${origin}/data`,
            body: (message) => message.text
          })
          yield* fromServiceWorker(page, "/data", { method: "POST", body: "from the worker" })
          assert.deepStrictEqual((yield* posted).body, Option.some("from the worker"))
        }), timeout)

      it.effect("fulfills a shared worker's fetch by its context's route", () =>
        Effect.gen(function*() {
          const { context, origin, page } = yield* open()
          yield* context.route(`${origin}/data`, () => Route.fulfill(HttpServerResponse.text("routed")))
          yield* page.goto(`${origin}/`)
          const reply = yield* page.evaluateInMainWorld(() =>
            new Promise<string>((resolve) => {
              const worker = new SharedWorker("/shared.js")
              worker.port.onmessage = (event) => resolve(event.data)
              worker.port.postMessage("/data")
            })
          )
          assert.strictEqual(reply, (yield* reachesWorkers) ? "ok:routed" : "ok:network")
        }), timeout)
    })
  })
