/** Existing-context storage replacement, including closed origins and pre-mutation refusals. */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Capability, StorageState, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"

const empty = new StorageState.StorageState({ cookies: [], origins: [] })
// This contract is tested before the API exists.
const replace = (context: UserContext.UserContext, state: StorageState.StorageState) =>
  (context as UserContext.UserContext & {
    setStorageState: (state: StorageState.StorageState) => Effect.Effect<void, any>
  })
    .setStorageState(state)
const tracked = () => Browser.newContext({ ...{ storageStateTracking: true }, downloads: "none" })

export const storageReplacement = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} storage replacement`, () => {
    layer(backend, { excludeTestServices: true, timeout: 60000 })((it) => {
      it.effect("replaces closed origins, partitions and database schemas while preserving live pages", () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin, crossSite } = yield* site
          const context = yield* tracked()
          const page = yield* context.newPage
          const widget = `${crossSite}/fixture?html=${
            encodeURIComponent("<script>localStorage.setItem(\"old-frame\", \"1\")</script>")
          }`
          yield* page.goto(`${origin}/fixture?html=${encodeURIComponent(`<iframe src="${widget}"></iframe>`)}`)
          yield* page.evaluateInMainWorld(async () => {
            localStorage.setItem("old", "1")
            const request = indexedDB.open("app", 4)
            request.onupgradeneeded = () => request.result.createObjectStore("old-store")
            await new Promise<void>((resolve, reject) => {
              request.onsuccess = () => {
                request.result.close()
                resolve()
              }
              request.onerror = () => reject(request.error)
            })
          })
          const saved = yield* context.exportStorageState
          assert.isTrue(saved.origins.some((entry) => entry.partition._tag === "Partitioned"))
          const target = new StorageState.StorageState({
            cookies: [],
            origins: saved.origins.filter((entry) => entry.origin === origin).map((entry) => ({
              ...entry,
              localStorage: [["new", Redacted.make("2")]],
              indexedDb: [{
                name: "app",
                version: 1,
                stores: [{ name: "new-store", keyPath: Option.none(), autoIncrement: false, indexes: [], records: [] }]
              }]
            }))
          })
          yield* page.close()
          const live = yield* context.newPage
          yield* live.goto(origin)
          yield* live.evaluateInMainWorld(() => {
            sessionStorage.setItem("session", "kept")
            ;(globalThis as any).sentinel = 42
          })
          const before = yield* live.url.get
          yield* replace(context, target)
          assert.equal(yield* live.url.get, before)
          assert.deepEqual(
            yield* live.evaluateInMainWorld(
              () => [
                localStorage.getItem("old"),
                localStorage.getItem("new"),
                sessionStorage.getItem("session"),
                (globalThis as any).sentinel
              ]
            ),
            [null, "2", "kept", 42]
          )
          const after = yield* context.exportStorageState
          assert.deepEqual(
            after.origins[0]!.indexedDb.map((db) => [db.name, db.version, db.stores.map((s) => s.name)]),
            [["app", 1, ["new-store"]]]
          )
          const frameRead = `${crossSite}/fixture?html=${
            encodeURIComponent(
              "<pre id=\"out\"></pre><script>document.querySelector(\"#out\").textContent = localStorage.getItem(\"old-frame\") ?? \"empty\"</script>"
            )
          }`
          yield* live.goto(`${origin}/fixture?html=${encodeURIComponent(`<iframe src="${frameRead}"></iframe>`)}`)
          assert.equal(yield* live.frame(live.locator("iframe")).locator("#out").textContent, "empty")
          yield* replace(context, empty)
          assert.lengthOf(yield* context.pages.get, 1)
        })))
      it.effect("refuses untracked contexts and held authenticators before mutation", () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* site
          const untracked = yield* Browser.newContext()
          const page = yield* untracked.newPage
          yield* page.goto(origin)
          yield* page.evaluateInMainWorld(() => localStorage.setItem("kept", "1"))
          const failure = yield* replace(untracked, empty).pipe(Effect.flip)
          assert.equal(failure._tag, "UserContextError")
          assert.equal(failure.reason._tag, "NotPermitted")
          assert.equal(yield* page.evaluateInMainWorld(() => localStorage.getItem("kept")), "1")
          if (!(yield* supports("capability.virtualAuthenticator"))) return
          const context = yield* tracked()
          const live = yield* context.newPage
          yield* live.goto(origin)
          yield* live.evaluateInMainWorld(() => localStorage.setItem("held", "1"))
          yield* Effect.scoped(Effect.gen(function*() {
            yield* live.capability(Capability.VirtualAuthenticator)
            const error = yield* replace(context, empty).pipe(Effect.flip)
            assert.equal(error.reason._tag, "NotPermitted")
            assert.equal(yield* live.evaluateInMainWorld(() => localStorage.getItem("held")), "1")
          }))
          yield* replace(context, empty)
          assert.isNull(yield* live.evaluateInMainWorld(() => localStorage.getItem("held")))
        })))
      it.effect("reports blocked database deletion as partial failure and cleans up temporary resources", () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* site
          const context = yield* tracked()
          const page = yield* context.newPage
          yield* page.goto(origin)
          yield* page.evaluateInMainWorld(async () => {
            const open = indexedDB.open("held", 1)
            await new Promise<void>((resolve, reject) => {
              open.onsuccess = () => {
                ;(globalThis as any).held = open.result
                resolve()
              }
              open.onerror = () => reject(open.error)
            })
          })
          const error = yield* replace(context, empty).pipe(Effect.flip)
          assert.equal(error._tag, "UserContextError")
          assert.equal(error.reason._tag, "BackendFailure")
          assert.include(error.reason.hint, "partial")
          assert.lengthOf(yield* context.pages.get, 1)
          yield* page.evaluateInMainWorld(() => (globalThis as any).held.close())
          // A subsequent request is ordered after the possibly still-pending deletion.
          const version = yield* page.evaluateInMainWorld(() =>
            new Promise<number>((resolve, reject) => {
              const open = indexedDB.open("held")
              let old = -1
              open.onupgradeneeded = (event) => {
                old = event.oldVersion
              }
              open.onsuccess = () => {
                open.result.close()
                resolve(old)
              }
              open.onerror = () => reject(open.error)
            })
          )
          assert.include([-1, 0], version)
          yield* replace(context, empty)
          assert.lengthOf(yield* context.pages.get, 1)
        })))
    })
  })
