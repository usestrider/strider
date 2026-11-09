/** Focused evidence for storage replacement: live handles and OPFS availability on the pinned browsers. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import { WebKit } from "@usestrider/browser/webkit"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
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
      it.effect("reports OPFS support and blocked database deletion", () =>
        Effect.scoped(Effect.gen(function*() {
          const served = yield* (name === "Chromium" ? site : tlsSite)
          const context = yield* Browser.newContext(name === "Chromium" ? undefined : { acceptInsecureCerts: true })
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
          console.log("STORAGE-PROBE", name, JSON.stringify(result))
          assert.equal(result.blocked, "blocked")
          assert.isTrue(result.secure)
          assert.equal(result.opfs, name === "WebKit" ? "absent" : "created-and-cleared")
          assert.equal(result.heldFile, name === "WebKit" ? "absent" : "NoModificationAllowedError")
          assert.equal(result.storage, name === "WebKit" ? "undefined" : "object")
          assert.equal(result.workerStorage, name === "WebKit" ? "undefined" : "object")
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
        })), 60000)
    })
  })
}
