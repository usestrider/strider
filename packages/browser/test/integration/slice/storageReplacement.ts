/** Existing-context storage replacement, including closed origins and pre-mutation refusals. */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Capability, Expect, Route, StorageState, Url, type UserContext } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { vi } from "vitest"
import * as Handles from "../../../src/internal/handles.ts"
import { clearOrigin } from "../../../src/internal/storageState.ts"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"

const empty = new StorageState.StorageState({ cookies: [], origins: [] })
const replace = (context: UserContext.UserContext, state: StorageState.StorageState) => context.setStorageState(state)
const tracked = () => Browser.newContext({ storageStateTracking: true })

export const storageReplacement = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} storage replacement`, () => {
    layer(backend, { excludeTestServices: true, timeout: 60000 })((it) => {
      it.effect(
        "replaces closed origins, partitions and database schemas while preserving live pages",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin, crossSite } = yield* site
            const context = yield* tracked()
            const page = yield* context.newPage
            const widget = `${crossSite}/fixture?html=${
              encodeURIComponent("<pre>seeded</pre><script>localStorage.setItem(\"old-frame\", \"1\")</script>")
            }`
            yield* page.goto(`${origin}/fixture?html=${encodeURIComponent(`<iframe src="${widget}"></iframe>`)}`)
            yield* page.evaluateInMainWorld(async () => {
              document.cookie = "old=1; path=/"
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
            yield* page.frame(page.locator("iframe")).getByText("seeded").pipe(Expect.toBeVisible)
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
                  stores: [{
                    name: "new-store",
                    keyPath: Option.none(),
                    autoIncrement: false,
                    indexes: [],
                    records: []
                  }]
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
            const before = yield* live.url
            yield* replace(context, target)
            assert.equal(yield* live.url, before)
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
            assert.lengthOf(yield* context.cookies.list, 0)
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
            yield* live.frame(live.locator("iframe")).locator("#out").pipe(Expect.toHaveText("empty"))
            yield* replace(context, empty)
            assert.lengthOf(yield* context.pages, 1)
          })),
        60000
      )
      it.effect(
        "clears nested cross-site ancestor history before restoring first-party aliases",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin, crossSite } = yield* site
            const fixture = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`
            const context = yield* tracked()
            const page = yield* context.newPage
            const nested = (write: boolean) =>
              fixture(
                origin,
                `<pre id="value"></pre><script>${
                  write ? "localStorage.setItem(\"nested-only\", \"old\");" : ""
                }document.querySelector("#value").textContent = localStorage.getItem("nested-only") ?? "empty"</script>`
              )
            const top = (write: boolean) =>
              fixture(
                origin,
                `<iframe id="outer" src="${
                  fixture(crossSite, `<iframe id="inner" src="${nested(write)}"></iframe>`)
                }"></iframe>`
              )
            yield* page.goto(top(true))
            const outer = page.frame(page.locator("#outer"))
            yield* outer.frame(outer.locator("#inner")).locator("#value").pipe(Expect.toHaveText("old"))
            yield* page.goto(origin)
            yield* context.setStorageState(
              new StorageState.StorageState({
                cookies: [],
                origins: [{
                  origin: Url.Origin.make(origin),
                  partition: { _tag: "Unpartitioned" },
                  localStorage: [["restored", Redacted.make("yes")]],
                  indexedDb: []
                }]
              })
            )
            assert.equal(yield* page.evaluateInMainWorld(() => localStorage.getItem("restored")), "yes")
            yield* page.goto(top(false))
            yield* outer.frame(outer.locator("#inner")).locator("#value").pipe(Expect.toHaveText("empty"))
          })),
        60000
      )
      it.effect(
        "refuses unreproducible incoming partitions without clearing cookies",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const context = yield* tracked()
            const { runtime } = Handles.target(context).behind
            const clear = vi.spyOn(runtime.model.adapter, "clearCookies")
            yield* Effect.addFinalizer(() => Effect.sync(() => clear.mockRestore()))
            const error = yield* context.setStorageState(
              new StorageState.StorageState({
                cookies: [],
                origins: [{
                  origin: Url.Origin.make("http://example.com"),
                  partition: {
                    _tag: "Partitioned",
                    topLevelSite: Url.Site.make("http://localhost"),
                    crossSiteAncestor: Option.some(false)
                  },
                  localStorage: [],
                  indexedDb: []
                }]
              })
            ).pipe(Effect.flip)
            if (error._tag !== "UserContextError") return yield* Effect.die(error)
            assert.equal(error.reason._tag, "Unsupported")
            assert.equal(clear.mock.calls.length, 0)
            const nonHttp = yield* context.setStorageState(
              new StorageState.StorageState({
                cookies: [],
                origins: [{
                  origin: Url.Origin.make("ftp://example.com"),
                  partition: { _tag: "Unpartitioned" },
                  localStorage: [],
                  indexedDb: []
                }]
              })
            ).pipe(Effect.flip)
            if (nonHttp._tag !== "UserContextError") return yield* Effect.die(nonHttp)
            assert.equal(nonHttp.reason._tag, "Unsupported")
            const ambiguous = yield* context.setStorageState(
              new StorageState.StorageState({
                cookies: [],
                origins: [{
                  origin: Url.Origin.make("http://example.com"),
                  partition: {
                    _tag: "Partitioned",
                    topLevelSite: Url.Site.make("http://example.com"),
                    crossSiteAncestor: Option.some(true)
                  },
                  localStorage: [],
                  indexedDb: []
                }]
              })
            ).pipe(Effect.exit)
            assert.isTrue(
              Exit.isFailure(ambiguous),
              "An incoming same-site partition cannot recreate an unrepresented cross-site ancestor"
            )
            const mismatched = yield* context.setStorageState(
              new StorageState.StorageState({
                cookies: [],
                origins: [{
                  origin: Url.Origin.make("http://other.invalid"),
                  topLevelOrigin: Url.Origin.make("http://example.com"),
                  partition: {
                    _tag: "Partitioned",
                    topLevelSite: Url.Site.make("http://localhost"),
                    crossSiteAncestor: Option.some(true)
                  },
                  localStorage: [],
                  indexedDb: []
                }]
              })
            ).pipe(Effect.exit)
            assert.isTrue(Exit.isFailure(mismatched))
            assert.equal(clear.mock.calls.length, 0)
            assert.lengthOf(yield* context.pages, 0)
          })),
        60000
      )
      it.effect(
        "refuses history whose storage partition has an opaque ancestor",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const context = yield* tracked()
            const page = yield* context.newPage
            yield* page.route(
              "http://example.com/opaque-child",
              () => Route.fulfill(HttpServerResponse.text("<p>loaded</p>", { contentType: "text/html" }))
            )
            yield* page.goto(
              `data:text/html,${encodeURIComponent("<iframe src=\"http://example.com/opaque-child\"></iframe>")}`
            )
            yield* page.frame(page.locator("iframe")).getByText("loaded").pipe(Expect.toBeVisible)
            const { runtime } = Handles.page(page)
            const clear = vi.spyOn(runtime.model.adapter, "clearCookies")
            yield* Effect.addFinalizer(() => Effect.sync(() => clear.mockRestore()))
            const error = yield* context.setStorageState(empty).pipe(Effect.flip)
            if (error._tag !== "UserContextError") return yield* Effect.die(error)
            assert.equal(error.reason._tag, "Unsupported")
            assert.equal(clear.mock.calls.length, 0)
          })),
        60000
      )
      it.effect(
        "clears initial imported state without changing an untracked sibling context",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const sibling = yield* Browser.newContext()
            const page = yield* sibling.newPage
            yield* page.goto(origin)
            yield* page.evaluateInMainWorld(() => {
              localStorage.setItem("initial", "kept")
              document.cookie = "initial=kept; path=/"
            })
            const state = yield* sibling.exportStorageState
            const imported = yield* Browser.newContext({ storageStateTracking: true, storageState: state })
            yield* imported.cookies.set({
              name: "hidden",
              value: "secret",
              scope: { domain: "unvisited.example", path: "/private" },
              httpOnly: true
            })
            yield* imported.setStorageState(empty)
            const live = yield* imported.newPage
            yield* live.goto(origin)
            assert.isNull(yield* live.evaluateInMainWorld(() => localStorage.getItem("initial")))
            assert.lengthOf(yield* imported.cookies.list, 0)
            yield* live.route("http://unvisited.example/private/**", () =>
              Route.fulfill(HttpServerResponse.text("<!DOCTYPE html>", { contentType: "text/html" })))
            yield* live.goto("http://unvisited.example/private/check", { waitUntil: "load" })
            assert.lengthOf(yield* imported.cookies.list, 0)
            assert.equal(
              yield* page.evaluateInMainWorld(() =>
                localStorage.getItem("initial")
              ),
              "kept"
            )
            assert.lengthOf(yield* sibling.cookies.list, 1)
          })),
        60000
      )
      it.effect(
        "refuses untracked contexts and held authenticators before mutation",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const browser = yield* Browser.Browser
            const defaults = yield* browser.defaultContext.pages
            const borrowed = yield* defaults[0]!.control
            const denied = yield* borrowed.context.setStorageState(empty).pipe(Effect.flip)
            if (denied._tag !== "UserContextError") return yield* Effect.die(denied)
            assert.equal(denied.reason._tag, "NotPermitted")
            const untracked = yield* Browser.newContext()
            const page = yield* untracked.newPage
            yield* page.goto(origin)
            yield* page.evaluateInMainWorld(() => localStorage.setItem("kept", "1"))
            const failure = yield* replace(untracked, empty).pipe(Effect.flip)
            assert.equal(failure._tag, "UserContextError")
            if (failure._tag !== "UserContextError") return yield* Effect.die(failure)
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
              if (error._tag !== "UserContextError") return yield* Effect.die(error)
              assert.equal(error.reason._tag, "NotPermitted")
              assert.equal(yield* live.evaluateInMainWorld(() => localStorage.getItem("held")), "1")
            }))
            yield* replace(context, empty)
            assert.isNull(yield* live.evaluateInMainWorld(() => localStorage.getItem("held")))
          })),
        60000
      )
      it.effect(
        "cleans temporary pages and routes after interruption and releases the replacement reservation",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const context = yield* tracked()
            const page = yield* context.newPage
            yield* page.goto(origin)
            const { runtime, entry } = Handles.page(page)
            const adapter = runtime.model.adapter
            const original = adapter.evaluate
            const entered = yield* Deferred.make<void>()
            const hook = vi.spyOn(adapter, "evaluate").mockImplementation((realm, options) =>
              options.functionDeclaration === clearOrigin.toString()
                ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
                : original(realm, options)
            )
            yield* Effect.addFinalizer(() => Effect.sync(() => hook.mockRestore()))
            const pending = yield* context.setStorageState(empty).pipe(Effect.forkChild)
            yield* Deferred.await(entered)
            const busy = yield* context.setStorageState(empty).pipe(Effect.flip)
            if (busy._tag !== "UserContextError") return yield* Effect.die(busy)
            assert.equal(busy.reason._tag, "NotPermitted")
            if (yield* supports("capability.virtualAuthenticator")) {
              const acquired = yield* Effect.scoped(page.capability(Capability.VirtualAuthenticator)).pipe(Effect.flip)
              if (acquired._tag !== "CapabilityError") return yield* Effect.die(acquired)
              assert.equal(acquired.reason._tag, "NotPermitted")
            }
            yield* Fiber.interrupt(pending)
            assert.lengthOf(yield* context.pages, 1)
            assert.lengthOf((yield* entry.contextEntry.state.get).routes, 0)
            hook.mockRestore()
            yield* context.setStorageState(empty)
            assert.lengthOf(yield* context.pages, 1)
          })),
        60000
      )
      it.effect(
        "reports blocked database deletion as partial failure and cleans up temporary resources",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* site
            const context = yield* tracked()
            const page = yield* context.newPage
            yield* page.goto(origin)
            yield* page.evaluateInMainWorld(() => {
              document.cookie = "blocker=kept; path=/"
              localStorage.setItem("blocker", "kept")
            })
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
            if (error._tag !== "UserContextError") return yield* Effect.die(error)
            assert.equal(error.reason._tag, "PartiallyApplied")
            if (error.reason._tag !== "PartiallyApplied") return yield* Effect.die(error)
            assert.include(error.reason.message, "partial")
            assert.lengthOf(yield* context.pages, 1)
            const surviving = yield* page.evaluateInMainWorld(() => ({
              cookie: document.cookie,
              localStorage: localStorage.getItem("blocker")
            }))
            // Close the blocker before asserting so a failing regression still releases the live handle.
            yield* page.evaluateInMainWorld(() => (globalThis as any).held.close())
            assert.deepEqual(surviving, { cookie: "blocker=kept", localStorage: "kept" })
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
            assert.lengthOf(yield* context.pages, 1)
          })),
        60000
      )
    })
  })
