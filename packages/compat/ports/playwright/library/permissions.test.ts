/**
 * Playwright's `tests/library/permissions.spec.ts`: permissions granted to a context, cleared, and read back with
 * `navigator.permissions.query`, for geolocation, notifications, the clipboard, per-origin grants, media capture, and
 * permission change events.
 *
 * What the port changes:
 * - `context.grantPermissions(names, { origin })` is `page.context.grant(names, { origin })`, and a grant lasts while its
 *   registration does. `context.clearPermissions()` is the removal of the registrations that granted them: `remove`
 *   resets the context and grants what is left, so for these tests, where one grant is in force or the grants are
 *   cleared together, it is the same as clearing. PE-008 and PE-011 to PE-013 and PE-023 say so where they clear.
 * - A grant without `origin` is for every origin. Stock WebKit refuses every grant as `Unsupported` (its adapter has
 *   no `permissions`), and Firefox refuses an every-origin grant (`permissions.anyOrigin`), so each of those tests
 *   fails on that browser and the ledger says why. The ledger also names `Browser.newContext({ permissions })`
 *   (PE-010), which takes the same every-origin grant.
 * - `getPermission` and the media helper run `navigator.permissions.query` and `getUserMedia` in the page's main world,
 *   with `page.evaluateInMainWorld`, as the original's `page.evaluate` does. A permission change listener is registered
 *   the same way, and its events read the same way.
 * - Playwright's `.catch(e => e)` is `Effect.result`, and PE-003 asserts Strider's typed `InvalidInput` for the
 *   unknown name, naming it in the hint, rather than Playwright's wording.
 * - Playwright's `page.evaluate` on Chromium runs as a user gesture, so the clipboard calls in PE-014 and PE-015 run
 *   with `Page.withUserGesture`, and so does the `readText` of the clipboard test in PE-014.
 * - PE-014's `isHeadlessShell` branch is not ported: Strider's Chromium is the full browser in its `--headless` mode,
 *   where the original's branch doesn't run.
 * - PE-015 launches two browsers, as the original does: each is built with `Layer.buildWithScope` on a scope the test
 *   closes, as `download.test.ts` does for its own browser.
 * - PE-016 (storage access) reads a cross-origin frame's permission and calls its `requestStorageAccess`, which needs
 *   the frame's main world. Strider has no such evaluation in a frame, so it isn't ported; the ledger names it.
 * - PE-017 makes its context with `acceptInsecureCerts`, which Chromium refuses, so it fails there.
 * - PE-018 fulfills the public origin it navigates to (`demo.playwright.dev`) with a route, as PE-019 does for
 *   `example.com`, so the test doesn't need the network. Its request events come from `NetworkRequest.stream`,
 *   subscribed after the navigation, as the original's `page.on('request')` is.
 * - PE-019 fulfills `example.com` through a route, as the original does.
 * - PE-020 to PE-023 are the original's WebKit-only mock capture device tests. PE-021 needs no grant and runs on WebKit;
 *   PE-020, PE-022, and PE-023 grant, which WebKit can't.
 * - `it.fixme` for Windows WebKit, and every `isFrozenWebkit` skip, are Playwright's builds, not stock WebKit, so they
 *   aren't ported.
 */
import { assert } from "@effect/vitest"
import { Browser, Declaration, NetworkRequest, Page, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { HttpServerResponse } from "effect/http"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { backend } from "../../harness/browsers.ts"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** `navigator.permissions.query({ name })`'s state, read in the page's main world, as the original's `page.evaluate` does. */
const getPermission = (page: Page.Page, name: string) =>
  page.evaluateInMainWorld(
    (name) => navigator.permissions.query({ name: name as PermissionName }).then((result) => result.state),
    name
  )

/** The page's `events` global, which the permission change listener of PE-012 fills. */
const eventsOf = (page: Page.Page) =>
  page.evaluateInMainWorld(() => (window as unknown as { events: Array<string> }).events)

type MediaResult =
  | { readonly tracks: ReadonlyArray<{ readonly kind: string; readonly live: boolean }> }
  | { readonly error: string }

/** The original's `getUserMedia` helper: the tracks a capture yields, sorted by kind, or the error's name. */
const getUserMedia = (page: Page.Page, constraints: MediaStreamConstraints): Effect.Effect<MediaResult, unknown> =>
  page.evaluateInMainWorld(async (constraints): Promise<MediaResult> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      const tracks = stream.getTracks().map((track) => ({ kind: track.kind, live: track.readyState === "live" }))
      stream.getTracks().forEach((track) => track.stop())
      tracks.sort((a, b) => a.kind.localeCompare(b.kind))
      return { tracks }
    } catch (error) {
      return { error: (error as Error).name }
    }
  }, constraints)

upstream(import.meta.filename, {}, (test) => {
  test("PE-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* getPermission(page, "geolocation"), "prompt")
    }))

  test("PE-002", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.grant([], { origin: server.EMPTY_PAGE })
      if (browserName === "webkit") {
        assert.strictEqual(yield* getPermission(page, "geolocation"), "prompt")
        // WebKit reports the permission's actual value only once the API has been accessed
        yield* page.evaluateInMainWorld(() => navigator.geolocation.getCurrentPosition(() => {}))
        assert.strictEqual(yield* getPermission(page, "geolocation"), "denied")
      } else if (browserName === "firefox") {
        assert.strictEqual(yield* getPermission(page, "geolocation"), "prompt")
      } else {
        assert.strictEqual(yield* getPermission(page, "geolocation"), "denied")
      }
    }))

  test("PE-003", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const failure = yield* failureOf(
        page.context.grant(["foo"], { origin: server.EMPTY_PAGE }),
        "granting an unknown permission"
      )
      // Playwright's wording is "Unknown permission: foo", or BiDi's protocol error. Strider's typed reason says the
      // name is the caller's to fix, and the hint names it.
      assert(failure instanceof Declaration.DeclarationError, `${browserName} failed another way: ${String(failure)}`)
      const reason = failure.reason
      assert(reason._tag === "InvalidInput", `failed for another reason on ${browserName}: ${reason._tag}`)
      assert.include(reason.hint, "foo")
    }))

  test("PE-004", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.grant(["geolocation"], { origin: server.EMPTY_PAGE })
      assert.strictEqual(yield* getPermission(page, "geolocation"), "granted")
    }))

  test("PE-005", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.grant(["geolocation"], { origin: server.EMPTY_PAGE })
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      assert.strictEqual(yield* getPermission(page, "geolocation"), "prompt")
    }))

  test("PE-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.grant(["notifications"], { origin: server.EMPTY_PAGE })
      assert.strictEqual(yield* getPermission(page, "notifications"), "granted")
    }))

  test("PE-007", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.grant(["geolocation"])
      yield* page.context.grant(["notifications"])
      assert.strictEqual(yield* getPermission(page, "geolocation"), "granted")
      assert.strictEqual(yield* getPermission(page, "notifications"), "granted")
    }))

  test("PE-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const geolocation = yield* page.context.grant(["geolocation"])
      // `clearPermissions`: the grant's registration removed, which resets the context
      yield* geolocation.remove
      yield* page.context.grant(["notifications"])
      assert.notStrictEqual(yield* getPermission(page, "geolocation"), "granted")
      assert.strictEqual(yield* getPermission(page, "notifications"), "granted")
    }))

  test("PE-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.grant(["geolocation"])
      assert.strictEqual(yield* getPermission(page, "geolocation"), "granted")
    }))

  test("PE-010", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const context = yield* Browser.newContext({ permissions: ["geolocation"] }).pipe(Scope.provide(scope))
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* getPermission(page, "geolocation"), "granted")
      yield* Scope.close(scope, Exit.void)
    }))

  test("PE-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const geolocation = yield* page.context.grant(["geolocation"], { origin: server.EMPTY_PAGE })
      assert.strictEqual(yield* getPermission(page, "geolocation"), "granted")
      // `clearPermissions`, as in PE-008
      yield* geolocation.remove
      assert.strictEqual(yield* getPermission(page, "geolocation"), "prompt")
    }))

  test("PE-012", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The page's listener is registered in its main world, as the original's `page.evaluate` registers it. The
      // events global is the test's own, as the original's `window['events']` is.
      yield* page.evaluateInMainWorld(() => {
        const events: Array<string> = []
        Reflect.set(window, "events", events)
        return navigator.permissions.query({ name: "geolocation" }).then((result) => {
          events.push(result.state)
          result.onchange = () => {
            events.push(result.state)
          }
        })
      })
      const expectedEvents = ["prompt"]
      assert.deepStrictEqual(yield* eventsOf(page), expectedEvents)
      const denied = yield* page.context.grant([], { origin: server.EMPTY_PAGE })
      if (browserName !== "firefox") expectedEvents.push("denied")
      assert.deepStrictEqual(yield* eventsOf(page), expectedEvents)
      const geolocation = yield* page.context.grant(["geolocation"], { origin: server.EMPTY_PAGE })
      expectedEvents.push("granted")
      assert.deepStrictEqual(yield* eventsOf(page), expectedEvents)
      // `clearPermissions`: both grants removed, as their registrations are
      yield* geolocation.remove
      yield* denied.remove
      expectedEvents.push("prompt")
      assert.deepStrictEqual(yield* eventsOf(page), expectedEvents)
    }))

  test("PE-013", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const context = yield* Browser.newContext().pipe(Scope.provide(scope))
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const otherScope = yield* Scope.make()
      const otherContext = yield* Browser.newContext().pipe(Scope.provide(otherScope))
      const otherPage = yield* otherContext.newPage
      yield* otherPage.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* getPermission(page, "geolocation"), "prompt")
      assert.strictEqual(yield* getPermission(otherPage, "geolocation"), "prompt")

      const denied = yield* page.context.grant([], { origin: server.EMPTY_PAGE })
      yield* otherPage.context.grant(["geolocation"], { origin: server.EMPTY_PAGE })
      if (browserName === "webkit") {
        assert.strictEqual(yield* getPermission(page, "geolocation"), "prompt")
        // WebKit reports the permission's actual value only once the API has been accessed
        yield* page.evaluateInMainWorld(() => navigator.geolocation.getCurrentPosition(() => {}))
        assert.strictEqual(yield* getPermission(page, "geolocation"), "denied")
      } else if (browserName === "firefox") {
        assert.strictEqual(yield* getPermission(page, "geolocation"), "prompt")
      } else {
        assert.strictEqual(yield* getPermission(page, "geolocation"), "denied")
      }
      assert.strictEqual(yield* getPermission(otherPage, "geolocation"), "granted")

      // `clearPermissions` on the first context: its only grant is removed
      yield* denied.remove
      if (browserName === "webkit") {
        // WebKit returns the cached permission value once the geolocation API has been accessed
        assert.strictEqual(yield* getPermission(page, "geolocation"), "denied")

        // The geolocation API in a new page of the same context hasn't been accessed yet, so it is prompt
        const page2Scope = yield* Scope.make()
        const page2 = yield* context.newPage.pipe(Scope.provide(page2Scope))
        yield* page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        assert.strictEqual(yield* getPermission(page2, "geolocation"), "prompt")
        yield* Scope.close(page2Scope, Exit.void)
      } else {
        assert.strictEqual(yield* getPermission(page, "geolocation"), "prompt")
      }
      assert.strictEqual(yield* getPermission(otherPage, "geolocation"), "granted")
      yield* Scope.close(otherScope, Exit.void)
      yield* Scope.close(scope, Exit.void)
    }))

  test("PE-014", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // There is no 'clipboard-read' permission in WebKit's Web API
      if (browserName !== "webkit") {
        assert.strictEqual(yield* getPermission(page, "clipboard-read"), "prompt")
      }
      yield* page.context.grant(["clipboard-read"])
      if (browserName !== "webkit") {
        assert.strictEqual(yield* getPermission(page, "clipboard-read"), "granted")
      }
      // There is no 'clipboard-write' permission in WebKit's Web API
      if (browserName === "chromium") {
        yield* page.context.grant(["clipboard-write"])
      }
      // The clipboard needs a user gesture, which Playwright's `page.evaluate` has on Chromium
      yield* page.evaluateInMainWorld(() => navigator.clipboard.writeText("test content")).pipe(Page.withUserGesture)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => navigator.clipboard.readText()).pipe(Page.withUserGesture),
        "test content"
      )
    }))

  test("PE-015", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      // Each browser is its own launch, built on a scope this test closes, as the original's two `browserType.launch`
      const scope1 = yield* Scope.make()
      const scope2 = yield* Scope.make()
      const services1 = yield* Layer.buildWithScope(backend(browserName, undefined), scope1)
      const services2 = yield* Layer.buildWithScope(backend(browserName, undefined), scope2)
      // A new context and its page in one browser, which lives while its scope does
      const newPage = Effect.gen(function*() {
        const context = yield* Browser.newContext()
        return yield* context.newPage
      })
      const page1 = yield* newPage.pipe(Effect.provideContext(services1), Scope.provide(scope1))
      const page2 = yield* newPage.pipe(Effect.provideContext(services2), Scope.provide(scope2))
      // There is no 'clipboard-write' permission in WebKit's Web API, and no clipboard permission at all in Firefox
      if (browserName === "chromium") {
        yield* page1.context.grant(["clipboard-read", "clipboard-write"])
        yield* page2.context.grant(["clipboard-read", "clipboard-write"])
      } else if (browserName === "webkit") {
        yield* page1.context.grant(["clipboard-read"])
        yield* page2.context.grant(["clipboard-read"])
      }
      yield* page1.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })

      yield* page1.evaluateInMainWorld(() => navigator.clipboard.writeText("first")).pipe(Page.withUserGesture)
      assert.strictEqual(
        yield* page1.evaluateInMainWorld(() => navigator.clipboard.readText()).pipe(Page.withUserGesture),
        "first"
      )

      yield* page2.evaluateInMainWorld(() => navigator.clipboard.writeText("second")).pipe(Page.withUserGesture)
      assert.strictEqual(
        yield* page2.evaluateInMainWorld(() => navigator.clipboard.readText()).pipe(Page.withUserGesture),
        "second"
      )

      assert.strictEqual(
        yield* page1.evaluateInMainWorld(() => navigator.clipboard.readText()).pipe(Page.withUserGesture),
        "first"
      )

      yield* Scope.close(scope1, Exit.void)
      yield* Scope.close(scope2, Exit.void)
    }))

  test("PE-017", { page: false, browsers: ["chromium"] }, ({ server }) =>
    Effect.gen(function*() {
      // Secure context: the context accepts the fixture's self-signed certificate, which Chromium refuses per context
      const scope = yield* Scope.make()
      const context = yield* Browser.newContext({ acceptInsecureCerts: true }).pipe(Scope.provide(scope))
      const page = yield* context.newPage
      yield* page.goto(server.https.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* getPermission(page, "local-fonts"), "prompt")
      yield* page.context.grant(["local-fonts"])
      assert.strictEqual(yield* getPermission(page, "local-fonts"), "granted")
      assert.isTrue(
        yield* page.evaluateInMainWorld(
          async () => ((await (window as unknown as { queryLocalFonts: () => Promise<Array<unknown>> })
            .queryLocalFonts())
            .length > 0)
        )
      )
      yield* Scope.close(scope, Exit.void)
    }))

  test("PE-018", { browsers: ["chromium", "firefox"] }, ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.grant(["local-network-access"])
      const serverRequests: Array<string> = []
      server.setRoute("/cors", (req, res) => {
        serverRequests.push(`${req.method} ${req.url}`)
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
            "Access-Control-Allow-Headers": "*"
          })
          res.end()
          return
        }
        res.writeHead(200, { "Content-type": "text/plain", "Access-Control-Allow-Origin": "*" })
        res.end("Hello there!")
      })
      // The public origin the original navigates to, served from a route: the page is a public origin, and the test
      // needs nothing else from it
      yield* page.route(
        "https://demo.playwright.dev/**",
        () =>
          Route.fulfill(HttpServerResponse.text("<!doctype html><title>todomvc</title>", { contentType: "text/html" }))
      )
      yield* page.goto("https://demo.playwright.dev/todomvc/", { waitUntil: "load" })
      const clientRequests: Array<string> = []
      const requests = yield* NetworkRequest.stream(page)
      yield* Effect.forkScoped(requests.pipe(Stream.runForEach((request) =>
        Effect.sync(() => {
          clientRequests.push(`${request.method} ${String(request.url)}`)
        })
      )))
      const response = yield* page.evaluateInMainWorld(async (url) => {
        const response = await fetch(url, {
          method: "POST",
          body: "",
          headers: {
            "Content-Type": "application/json",
            "X-Custom-Header": "test-value"
          }
        })
        return await response.text()
      }, server.CROSS_PROCESS_PREFIX + "/cors")
      assert.strictEqual(response, "Hello there!")
      assert.deepStrictEqual(serverRequests, ["OPTIONS /cors", "POST /cors"])
      assert.deepStrictEqual(clientRequests, [`POST ${server.CROSS_PROCESS_PREFIX}/cors`])
    }))

  test("PE-019", ({ page }) =>
    Effect.gen(function*() {
      yield* page.context.grant(["screen-wake-lock"])
      yield* page.route("**/*", () =>
        Route.fulfill(HttpServerResponse.text("<div>Hello there!</div>", { contentType: "text/html" })))
      yield* page.goto("https://example.com", { waitUntil: "load" })
      // The request's sentinel isn't serializable, so the page returns nothing, as the original's result is unused
      yield* page.evaluateInMainWorld(async () => {
        await navigator.wakeLock.request("screen")
      })
    }))

  test("PE-020", { browsers: ["webkit"] }, ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.grant(["camera", "microphone"], { origin: server.PREFIX })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(yield* getUserMedia(page, { video: true, audio: true }), {
        tracks: [
          { kind: "audio", live: true },
          { kind: "video", live: true }
        ]
      })
    }))

  test("PE-021", { browsers: ["webkit"] }, ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(yield* getUserMedia(page, { video: true, audio: true }), { error: "NotAllowedError" })
    }))

  test("PE-022", { browsers: ["webkit"] }, ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.grant(["camera"], { origin: server.PREFIX })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Camera-only request is allowed.
      assert.deepStrictEqual(yield* getUserMedia(page, { video: true }), { tracks: [{ kind: "video", live: true }] })
      // Microphone request is rejected because it was not granted.
      assert.deepStrictEqual(yield* getUserMedia(page, { audio: true }), { error: "NotAllowedError" })
    }))

  test("PE-023", { browsers: ["webkit"] }, ({ page, server }) =>
    Effect.gen(function*() {
      const camera = yield* page.context.grant(["camera"], { origin: server.PREFIX })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(yield* getUserMedia(page, { video: true }), { tracks: [{ kind: "video", live: true }] })
      // `clearPermissions`, as in PE-008
      yield* camera.remove
      assert.deepStrictEqual(yield* getUserMedia(page, { video: true }), { error: "NotAllowedError" })
    }))
})
