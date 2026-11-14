/**
 * Playwright's `tests/library/browsercontext-service-worker-policy.spec.ts`: a page's service worker is registered by
 * default, and a navigation the worker answers stays answered while the context is offline.
 *
 * What the port changes:
 * - WO-027's `expect(page.evaluate(() => window.registrationPromise)).resolves.toBeTruthy()` awaits the registration
 *   inside the page, where the registration doesn't cross by value, and checks the awaited value's truthiness there.
 * - WO-028 runs in the harness page's context. `context.setOffline(true)` is `page.context.emulate({ network:
 *   "offline" })`, whose registration lasts for its scope; `context.setOffline(false)` closes that scope.
 * - `page.goto` waits for `load`, as the original's default does. `response.status()` and `response.fromServiceWorker()`
 *   are the committed navigation's response: `status` and `servedBy === "serviceWorker"`. `page.locator("h1")` is
 *   `Expect.toHaveText`, and `navigator.onLine` and `fetch` run in the main world.
 * - `expect(page.locator('h1')).toHaveText` runs within Playwright's default expectation timeout, 5 seconds.
 * - The original's `networkRequests` counter is the fixture server's route counting what reaches it, as before.
 * - WO-028 runs once per mode, each a `variant`. Playwright's `preload-fallback` enables navigation preload in the
 *   worker. The original's `it.fixme` for Firefox doesn't apply, since Firefox isn't among the browsers this port runs
 *   on, and upstream's own skips aren't ours.
 * - WO-029 to WO-031 run under `serviceWorkers: 'block'`, which Strider has no option for, so the ledger holds them.
 */
import { assert } from "@effect/vitest"
import { Condition, Deadline, Expect, NetworkResponse, PageNavigation } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import { upstream } from "../../harness/upstream.ts"

/** The response a committed navigation carries. */
const responseOf = (navigation: PageNavigation.PageNavigation): NetworkResponse.NetworkResponse => {
  const response = navigation._tag === "Committed" || navigation._tag === "NoContent"
    ? navigation.response
    : Option.none()
  assert.isTrue(Option.isSome(response), "the navigation has no response")
  return Option.getOrThrow(response)
}

/** Whether the page's service worker controls it, which `page.waitForFunction` waits for in the original. */
const controlled = Condition.make("the page is controlled", (isControlled: boolean) => isControlled)

/** Playwright's default expectation timeout, which `expect(locator).toHaveText` has in the original. */
const expectDeadline = Deadline.within("5 seconds")

/** The service worker's answer to a navigation, per mode: the original's `workerResponse` strings. */
const modes: Record<string, string> = {
  "literal": `new Response('<h1>offline</h1>', { headers: { 'Content-Type': 'text/html' } })`,
  "cache-only": `caches.match('/offline.html')`,
  "network-fallback": `fetch(event.request).catch(() => caches.match('/offline.html'))`,
  "preload-fallback": `(async () => {
    try {
      return await event.preloadResponse || await fetch(event.request);
    } catch {
      return caches.match('/offline.html');
    }
  })()`
}

upstream(import.meta.filename, {}, (test) => {
  test("WO-027", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html", { waitUntil: "load" })
      // The registration doesn't cross by value, so the page awaits it and checks it is truthy there
      const truthy = yield* page.evaluateInMainWorld(async () => !!(await (window as any).registrationPromise))
      assert.isTrue(truthy)
    }))

  for (const mode of Object.keys(modes)) {
    test("WO-028", { variant: mode }, ({ page, server }) =>
      Effect.gen(function*() {
        let networkRequests = 0
        server.setRoute("/target.html", (_request, response) => {
          ++networkRequests
          response.setHeader("Cache-Control", "no-store")
          response.end("online")
        })
        server.setRoute("/offline.html", (_request, response) => {
          response.setHeader("Content-Type", "text/html")
          response.end("<h1>offline</h1>")
        })
        server.setRoute("/sw.js", (_request, response) => {
          response.setHeader("Content-Type", "application/javascript")
          response.end(`
        self.addEventListener('install', event => event.waitUntil((async () => {
          const cache = await caches.open('offline');
          await cache.add('/offline.html');
          await self.skipWaiting();
        })()));
        self.addEventListener('activate', event => event.waitUntil((async () => {
          ${mode === "preload-fallback" ? "await self.registration.navigationPreload.enable();" : ""}
          await self.clients.claim();
        })()));
        self.addEventListener('fetch', event => {
          if (event.request.mode === 'navigate')
            event.respondWith(${modes[mode]});
        });
      `)
        })

        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* page.evaluateInMainWorld(async () => {
          await navigator.serviceWorker.register("/sw.js")
          await navigator.serviceWorker.ready
        })
        yield* Expect.that(
          page.evaluateInMainWorld(() => !!navigator.serviceWorker.controller),
          controlled
        )

        // `context.setOffline(true)` holds for the scope the emulation was registered in, which is closed to go online
        const offline = yield* Scope.make()
        yield* page.context.emulate({ network: "offline" }).pipe(Scope.provide(offline))

        const response = yield* page.goto(server.PREFIX + "/target.html", { waitUntil: "load" }).pipe(
          Effect.map(responseOf)
        )
        assert.strictEqual(response.status, 200)
        assert.strictEqual(response.servedBy, "serviceWorker")
        yield* Expect.toHaveText(page.locator("h1"), "offline").pipe(expectDeadline)
        assert.isFalse(yield* page.evaluateInMainWorld(() => navigator.onLine))
        assert.strictEqual(networkRequests, 0)

        const newPage = yield* page.context.newPage
        const newResponse = yield* newPage.goto(server.PREFIX + "/target.html", { waitUntil: "load" }).pipe(
          Effect.map(responseOf)
        )
        assert.strictEqual(newResponse.status, 200)
        assert.strictEqual(newResponse.servedBy, "serviceWorker")
        yield* Expect.toHaveText(newPage.locator("h1"), "offline").pipe(expectDeadline)
        assert.isFalse(yield* newPage.evaluateInMainWorld(() => navigator.onLine))
        assert.strictEqual(networkRequests, 0)

        yield* Scope.close(offline, Exit.void)
        const text = yield* page.evaluateInMainWorld(() => fetch("/target.html").then((response) => response.text()))
        assert.strictEqual(text, "online")
        assert.strictEqual(networkRequests, 1)
      }))
  }
})
