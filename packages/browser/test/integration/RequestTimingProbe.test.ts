/** Live wire evidence for redirect origins and streamed response completion. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import * as http from "node:http"
import * as FirefoxLauncher from "../../src/internal/firefoxLauncher.ts"
import { assertPinned, firefox } from "./browsers.ts"

describe("Request timing wire evidence", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect("Firefox reports distinct redirect-hop origins and a streamed body end", () =>
        Effect.gen(function*() {
          let finish: (() => void) | undefined
          const server = http.createServer((request, response) => {
            const url = request.url ?? "/"
            if (url === "/a" || url === "/b") {
              response.writeHead(302, { location: url === "/a" ? "/b" : "/stream" })
              response.end()
            } else if (url === "/stream") {
              response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" })
              response.write("first chunk\n")
              finish = () => response.end("last chunk\n")
            } else {
              response.end("<title>timing probe</title>")
            }
          })
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              server.closeAllConnections()
              server.close()
            })
          )
          yield* Effect.promise(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)))
          const address = server.address()
          assert(address !== null && typeof address !== "string")
          const origin = `http://127.0.0.1:${address.port}`
          const { transport } = yield* FirefoxLauncher.launch({ executablePath: firefox.executable })
          const replies = new Map<number, Deferred.Deferred<any>>()
          const events: Array<any> = []
          const waiters: Array<{ predicate: (event: any) => boolean; done: Deferred.Deferred<any> }> = []
          yield* transport.messages.pipe(
            Stream.runForEach((text) =>
              Effect.sync(() => {
                const message = JSON.parse(text)
                const reply = replies.get(message.id)
                if (reply !== undefined) Deferred.doneUnsafe(reply, Effect.succeed(message))
                if (message.type === "event") {
                  events.push(message)
                  for (const waiter of waiters) {
                    if (waiter.predicate(message)) {
                      Deferred.doneUnsafe(waiter.done, Effect.succeed(message))
                    }
                  }
                }
              })
            ),
            Effect.forkScoped
          )
          let nextId = 1
          const call = Effect.fnUntraced(function*(method: string, params: object) {
            const id = nextId++
            const done = yield* Deferred.make<any>()
            replies.set(id, done)
            yield* transport.send(JSON.stringify({ id, method, params }))
            const reply = yield* Deferred.await(done)
            assert.strictEqual(reply.type, "success", JSON.stringify(reply))
            return reply.result
          })
          const event = Effect.fnUntraced(function*(predicate: (event: any) => boolean) {
            const found = events.find(predicate)
            if (found !== undefined) return found
            const done = yield* Deferred.make<any>()
            waiters.push({ predicate, done })
            return yield* Deferred.await(done)
          })
          const session = yield* call("session.new", { capabilities: {} })
          assertPinned("Firefox", session.capabilities.browserVersion, firefox.version)
          yield* call("session.subscribe", { events: ["network"] })
          const { context } = yield* call("browsingContext.create", { type: "tab" })
          yield* call("browsingContext.navigate", { context, url: origin, wait: "complete" })
          yield* call("script.evaluate", {
            expression: "void fetch('/a').then(r => r.text()).then(t => globalThis.probeBody = t)",
            target: { context },
            awaitPromise: false
          })
          const headers = yield* event((e) =>
            e.method === "network.responseStarted" && e.params.request.url === `${origin}/stream`
          )
          assert(finish !== undefined)
          const starts = events.filter((e) =>
            e.method === "network.beforeRequestSent" &&
            ["/a", "/b", "/stream"].some((path) => e.params.request.url === origin + path)
          )
          assert.strictEqual(starts.length, 3)
          assert.strictEqual(new Set(starts.map((e) => e.params.request.timings.requestTime)).size, 3)
          assert.isAbove(starts[2].params.request.timings.requestTime, starts[1].params.request.timings.requestTime)
          const beforeRelease = events.filter((e) => e.params?.request?.url === `${origin}/stream`)
          assert.isFalse(beforeRelease.some((e) => e.method === "network.responseCompleted"))
          finish()
          const completed = yield* event((e) =>
            e.method === "network.responseCompleted" && e.params.request.url === `${origin}/stream`
          )
          const evidence = events.filter((e) =>
            ["/a", "/b", "/stream"].some((path) => e.params?.request?.url === origin + path)
          )
          fs.mkdirSync(".data/request-timing-probe", { recursive: true })
          fs.writeFileSync(
            ".data/request-timing-probe/firefox.ndjson",
            evidence.map((e) => JSON.stringify(e)).join("\n") + "\n"
          )
          assert.isAbove(
            completed.params.request.timings.responseEnd,
            headers.params.request.timings.responseEnd,
            "streamed body end must advance beyond the response-header snapshot"
          )
        }).pipe(Effect.scoped), 60_000)
    }
  )
})
