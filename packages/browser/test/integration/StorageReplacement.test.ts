/** Origin-private file replacement and live-handle behavior on each pinned backend. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, StorageState } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import { WebKit } from "@usestrider/browser/webkit"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as http from "node:http"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { vi } from "vitest"
import * as Handles from "../../src/internal/handles.ts"
import { site, tlsSite } from "./adapter/harness.ts"
import { chromium, firefox, webkitgtk } from "./browsers.ts"
import { socketConnector } from "./sockets.ts"
import { useXvfb } from "./stockWebKit.ts"
const display = Layer.effectDiscard(useXvfb()).pipe(Layer.provide(NodeServices.layer))
const backends = [
  ["Chromium", Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer))],
  [
    "Firefox",
    Firefox.layer({ executablePath: firefox.executable }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))
    )
  ],
  [
    "WebKit",
    WebKit.layer({ executablePath: webkitgtk.executable }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector, display))
    )
  ]
] as const
for (const [name, backend] of backends) {
  describe(name, () => {
    layer(backend, { excludeTestServices: true, timeout: 60000 })((it) => {
      if (name === "WebKit") {
        it.effect("clears each WebKit cookie hostname once over HTTPS", () =>
          Effect.scoped(Effect.gen(function*() {
            const context = yield* Browser.newContext({ storageStateTracking: true })
            yield* context.cookies.set({ name: "plain", value: "1", scope: { domain: "example.com", path: "/" } })
            yield* context.cookies.set({
              name: "secure",
              value: "1",
              scope: { domain: "example.com", path: "/" },
              secure: true
            })
            yield* context.cookies.set({
              name: "uppercase",
              value: "1",
              scope: { domain: "EXAMPLE.COM", path: "/" }
            })
            const { runtime } = Handles.target(context).behind
            const navigate = vi.spyOn(runtime.model.adapter, "navigate")
            yield* Effect.addFinalizer(() => Effect.sync(() => navigate.mockRestore()))
            yield* context.setStorageState(new StorageState.StorageState({ cookies: [], origins: [] }))
            const visits = navigate.mock.calls.map((call) => new URL(call[1])).filter((url) =>
              url.pathname.includes("/cookies/")
            )
            assert.include(visits.map((url) => url.hostname), "example.com")
            assert.deepEqual({
              schemes: [...new Set(visits.map((url) => url.protocol))],
              count: visits.length
            }, { schemes: ["https:"], count: new Set(visits.map((url) => url.hostname)).size })
          })), 60000)
        it.effect(
          "clears cookies accepted from a WebSocket-only host",
          () =>
            Effect.scoped(Effect.gen(function*() {
              const handshakes: Array<{ path: string; cookie: string }> = []
              const sockets = new Set<net.Socket>()
              const server = yield* Effect.acquireRelease(
                Effect.sync(() => {
                  const server = http.createServer((_request, response) =>
                    response.end("<title>socket cookie probe</title>")
                  )
                  server.on("upgrade", (request, socket) => {
                    const connection = socket as net.Socket
                    sockets.add(connection)
                    connection.on("close", () => sockets.delete(connection))
                    const path = new URL(request.url ?? "/", `http://${request.headers.host}`).pathname
                    handshakes.push({ path, cookie: request.headers.cookie ?? "" })
                    const accept = createHash("sha1").update(
                      `${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`
                    ).digest("base64")
                    connection.write(
                      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${
                        path === "/seed" ? "Set-Cookie: socketOnly=accepted; Path=/; HttpOnly; SameSite=Lax\r\n" : ""
                      }\r\n`
                    )
                    connection.on("data", () => connection.end(Buffer.from([0x88, 0x00])))
                  })
                  // WebKit may tunnel WebSockets through CONNECT. Resolve the controlled same-site
                  // fixture names here, without consulting DNS or contacting any external address.
                  server.on("connect", (request, socket, head) => {
                    const target = new URL(`http://${request.url}`)
                    if (!target.hostname.endsWith(".socket.example.com")) {
                      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
                      return
                    }
                    const upstream = net.connect(port, "127.0.0.1", () => {
                      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
                      upstream.write(head)
                      socket.pipe(upstream).pipe(socket)
                    })
                    sockets.add(upstream)
                    upstream.on("close", () => sockets.delete(upstream))
                    upstream.on("error", () => socket.destroy())
                    socket.on("error", () => upstream.destroy())
                    socket.on("close", () => upstream.destroy())
                  })
                  server.on("connection", (socket) => {
                    sockets.add(socket)
                    socket.on("close", () => sockets.delete(socket))
                  })
                  return server
                }),
                (server) =>
                  Effect.sync(() => {
                    for (const socket of sockets) socket.destroy()
                    server.closeAllConnections()
                    server.close()
                  })
              )
              yield* Effect.promise(() => new Promise<void>((resolve) => server.listen(0, "::", resolve)))
              const port = (server.address() as net.AddressInfo).port
              const context = yield* Browser.newContext({
                storageStateTracking: true,
                proxy: { server: `http://127.0.0.1:${port}`, bypass: [] }
              })
              const page = yield* context.newPage
              yield* page.goto("http://a.socket.example.com")
              const connect = (path: string) =>
                page.evaluateInMainWorld(async (path: string) => {
                  await new Promise<void>((resolve, reject) => {
                    const socket = new WebSocket(`ws://b.socket.example.com${path}`)
                    socket.onopen = () => socket.close()
                    socket.onclose = () => resolve()
                    socket.onerror = () => reject(new Error("WebSocket handshake failed"))
                  })
                }, path)
              // Reading the Cookie header of another handshake never visits the socket host as a document,
              // nor writes it through CookieJar. All sockets close before replacement begins.
              yield* connect("/seed")
              yield* connect("/before")
              console.log("WebSocket cookie evidence before replacement", handshakes)
              assert.include(handshakes.find((entry) => entry.path === "/before")!.cookie, "socketOnly=accepted")
              yield* context.setStorageState(new StorageState.StorageState({ cookies: [], origins: [] }))
              yield* connect("/after")
              console.log("WebSocket cookie evidence after replacement", handshakes)
              assert.notInclude(handshakes.find((entry) => entry.path === "/after")!.cookie, "socketOnly=accepted")
            })),
          60000
        )
      }
      it.effect(
        "refuses retained file history before and after its last page closes",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const table = yield* (yield* Browser.Browser).capabilities
            const policy = table.entries.find((entry) => entry.name === "storageState.closedFileHistory")
            assert.isDefined(policy)
            const directory = yield* Effect.acquireRelease(
              Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "strider-file-history-"))),
              (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
            )
            const file = path.join(directory, "storage.html")
            fs.writeFileSync(file, "<!doctype html><title>file history</title>")
            const context = yield* Browser.newContext({ storageStateTracking: true })
            const page = yield* context.newPage
            yield* page.goto(pathToFileURL(file).href)
            yield* page.evaluateInMainWorld(() => localStorage.setItem("file-history", "kept"))
            const openError = yield* context.setStorageState(
              new StorageState.StorageState({ cookies: [], origins: [] })
            ).pipe(Effect.flip)
            assert(openError._tag === "UserContextError" && openError.reason._tag === "Unsupported")
            yield* page.close()
            const reopened = yield* context.newPage
            yield* reopened.goto(pathToFileURL(file).href)
            assert.equal(yield* reopened.evaluateInMainWorld(() => localStorage.getItem("file-history")), "kept")
            yield* reopened.close()
            if (policy!.status === "unsupported") {
              const closedError = yield* context.setStorageState(
                new StorageState.StorageState({ cookies: [], origins: [] })
              ).pipe(Effect.flip)
              assert(closedError._tag === "UserContextError" && closedError.reason._tag === "Unsupported")
            } else {
              yield* context.setStorageState(new StorageState.StorageState({ cookies: [], origins: [] }))
            }
          })),
        60000
      )
      it.effect(
        "clears available origin-private files and identifies locked storage handles",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const served = yield* (name === "Chromium" ? site : tlsSite)
            const context = yield* Browser.newContext({
              storageStateTracking: true,
              ...(name === "Chromium" ? {} : { acceptInsecureCerts: true })
            })
            const page = yield* context.newPage
            yield* page.goto(served.origin)
            const result = yield* page.evaluateInMainWorld(async () => {
              const open = indexedDB.open("held", 1)
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                open.onsuccess = () => resolve(open.result)
                open.onerror = () => reject(open.error)
              })
              ;(globalThis as any).held = db
              const blocked = await new Promise<string>((resolve, reject) => {
                const deletion = indexedDB.deleteDatabase("held")
                deletion.onblocked = () => resolve("blocked")
                deletion.onsuccess = () => resolve("deleted")
                deletion.onerror = () => reject(deletion.error)
              })
              db.close()
              const storage = navigator.storage as any
              let opfs = "absent"
              let heldFile = "absent"
              if (typeof storage?.getDirectory === "function") {
                try {
                  const root = await storage.getDirectory()
                  const file = await root.getFileHandle("probe", { create: true })
                  const writable = await file.createWritable()
                  try {
                    await root.removeEntry("probe")
                    heldFile = "removed"
                  } catch (error) {
                    heldFile = (error as DOMException).name
                  }
                  await writable.close()
                  for await (const key of root.keys()) await root.removeEntry(key, { recursive: true })
                  const keys = []
                  for await (const key of root.keys()) keys.push(key)
                  opfs = keys.length === 0 ? "created-and-cleared" : "not-cleared"
                } catch (error) {
                  opfs = String(error)
                }
              }
              const workerStorage = await new Promise<string>((resolve, reject) => {
                const url = URL.createObjectURL(
                  new Blob(["postMessage(typeof navigator.storage)"], { type: "text/javascript" })
                )
                const worker = new Worker(url)
                worker.onmessage = (event) => {
                  resolve(event.data)
                  worker.terminate()
                  URL.revokeObjectURL(url)
                }
                worker.onerror = (event) => {
                  reject(new Error(event.message))
                  worker.terminate()
                  URL.revokeObjectURL(url)
                }
              })
              return {
                blocked,
                opfs,
                heldFile,
                workerStorage,
                secure: isSecureContext,
                storage: typeof navigator.storage
              }
            })
            assert.equal(result.blocked, "blocked")
            assert.isTrue(result.secure)
            assert.equal(result.opfs, name === "WebKit" ? "absent" : "created-and-cleared")
            assert.equal(result.heldFile, name === "WebKit" ? "absent" : "NoModificationAllowedError")
            assert.equal(result.storage, name === "WebKit" ? "undefined" : "object")
            assert.equal(result.workerStorage, name === "WebKit" ? "undefined" : "object")
            yield* page.evaluateInMainWorld(async () => {
              if (navigator.storage?.getDirectory !== undefined) {
                const root = await navigator.storage.getDirectory()
                await root.getFileHandle("replace-me", { create: true })
              }
            })
            yield* context.setStorageState(new StorageState.StorageState({ cookies: [], origins: [] }))
            assert.equal(
              yield* page.evaluateInMainWorld(async () => {
                if (navigator.storage?.getDirectory === undefined) return "unavailable"
                const root = await navigator.storage.getDirectory()
                const keys = []
                for await (const key of (root as any).keys()) keys.push(key)
                return keys.length === 0 ? "empty" : "not-empty"
              }),
              name === "WebKit" ? "unavailable" : "empty"
            )
            yield* page.evaluateInMainWorld(() => localStorage.setItem("closed-origin", "retained"))
            yield* page.close()
            assert.deepEqual((yield* context.exportStorageState).origins, [])
            const reopened = yield* context.newPage
            yield* reopened.goto(served.origin)
            assert.equal(yield* reopened.evaluateInMainWorld(() => localStorage.getItem("closed-origin")), "retained")
            const other = yield* Browser.newContext(name === "Chromium" ? undefined : { acceptInsecureCerts: true })
            const isolated = yield* other.newPage
            yield* isolated.goto(served.origin)
            assert.isNull(yield* isolated.evaluateInMainWorld(() => localStorage.getItem("closed-origin")))
          })),
        60000
      )
    })
  })
}
