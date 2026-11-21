/**
 * The fifth slice: declarations, through the public API on every backend's layer. Routes at each
 * phase, init scripts and their order, emulation, permission grants and the page clock, with call sites 6, 7,
 * 10 and 11, and `Unsupported` wherever a backend can't do something.
 */
import { assert, describe, layer } from "@effect/vitest"
import {
  AutoResolution,
  Browser,
  Condition,
  Deadline,
  Declaration,
  Expect,
  Page,
  PageClock,
  Popup,
  Route,
  UncaughtException,
  UserContext
} from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Headers from "effect/http/Headers"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import type * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import * as fs from "node:fs"
import * as http from "node:http"
import type * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { site, tlsSite } from "../adapter/harness.ts"
import { cachesFetches, responseRouteInFlight, status, supports, workerFetchesBypassCache } from "./capabilities.ts"
import * as SharedContext from "./sharedContext.ts"

const timeout = 60_000

/** The error `effect` failed with, or an assertion that names what succeeded. */
const failure = <A, E, R>(effect: Effect.Effect<A, E, R>, what: string) =>
  Effect.flatMap(Effect.exit(effect), (exit) => {
    if (Exit.isSuccess(exit)) return Effect.die(new Error(`${what} succeeded`))
    const error = Cause.findErrorOption(exit.cause)
    return Option.isSome(error) ? Effect.succeed(error.value) : Effect.die(Cause.squash(exit.cause))
  })

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

/**
 * Runs `code` in a page of the site, as its own script, and reads what it returned: `page.evaluate` isn't built,
 * so the page writes its answer where a locator reads it.
 */
const run = Effect.fnUntraced(function*(page: Page.Page, origin: string, code: string, before = "") {
  yield* page.goto(fixtureUrl(
    origin,
    `${before}<pre id="out">pending</pre><script>(async () => { ${code} })().then((value) => { document.getElementById('out').textContent = JSON.stringify(value) }, (error) => { document.getElementById('out').textContent = JSON.stringify('error: ' + error.message) })</script>`
  ))
  const out = page.locator("#out")
  yield* Expect.that(out.readText, Condition.make("finished", (text: string) => text !== "pending"))
  return JSON.parse(yield* out.readText) as unknown
})

// The child reports its size, title and tag as it parses, on load and on each resize, and the parent keeps the latest:
// an out-of-process iframe can parse before Chromium gives it its frame's geometry, when it measures 0 by 0
const frameBody =
  `<script>const report = () => parent.postMessage(JSON.stringify([innerWidth, innerHeight, document.title, window.__tag ?? null]), '*'); report(); addEventListener('load', report); addEventListener('resize', report)</script>`

const frameReport = (text: string): ReadonlyArray<unknown> | undefined => {
  if (text === "pending") return undefined
  const report = JSON.parse(text) as unknown
  return Array.isArray(report) ? report : undefined
}

/** The child's latest report gives its frame's size, 300 by 200. */
const framed = Condition.make("reports its frame's 300x200", (text: string) => {
  const report = frameReport(text)
  return report?.[0] === 300 && report[1] === 200
})

/** The child's latest report has the tag a declaration set. */
const tagged = (tag: string) =>
  Condition.make(`reports the tag ${tag}`, (text: string) => frameReport(text)?.[3] === tag)

/**
 * A page with a cross-site iframe 300 by 200 pixels. Chromium gives such a frame a target of its own, which declarations
 * reach too, so each kind is declared on the context and on the page, the page loaded, then released: the page's
 * declarations first, then the context's.
 */
const crossSiteFrame = Effect.fnUntraced(function*(
  declare: (target: Page.Page | UserContext.UserContext) => Effect.Effect<unknown, unknown, Scope.Scope>,
  expected: Condition.Condition<string>,
  frameSource = fixtureUrl
) {
  const { crossSite, origin } = yield* site
  yield* Effect.scoped(Effect.gen(function*() {
    const context = yield* Browser.newContext()
    yield* declare(context)
    const page = yield* context.newPage
    yield* Effect.scoped(Effect.gen(function*() {
      yield* declare(page)
      yield* page.goto(fixtureUrl(
        origin,
        `<title>parent</title><pre id="out">pending</pre><script>addEventListener('message', (e) => { document.getElementById('out').textContent = e.data })</script><iframe style="width:300px;height:200px;border:0" src="${
          frameSource(crossSite, frameBody)
        }"></iframe>`
      ))
      yield* Expect.that(page.locator("#out").readText, expected)
    }))
  }))
})

const json = (value: unknown) => HttpServerResponse.jsonUnsafe(value)

/**
 * A page that says whether its inline script ran and whether a script its policy allows could `eval`: under the
 * site's `/csp`, `blocked` and `refused` unless the policy is bypassed.
 */
const cspProbe =
  `<pre id="inline">blocked</pre><pre id="eval">pending</pre><script>document.getElementById('inline').textContent = 'ran'</script><script src="/eval.js"></script>`

const cspOutcome = (page: Page.Page) =>
  Effect.all([page.locator("#inline").readText, page.locator("#eval").readText]).pipe(
    Effect.map((texts) => texts.join(","))
  )

/**
 * Runs an effect with a logger that also keeps the messages of its warnings and errors, so a case can check that
 * a release logged none.
 */
const withWarnings = Effect.fnUntraced(function*<A, E, R>(effect: Effect.Effect<A, E, R>) {
  const warnings: Array<string> = []
  const loggers = yield* Logger.CurrentLoggers
  const logger = Logger.make((entry) => {
    if (entry.logLevel === "Warn" || entry.logLevel === "Error") {
      warnings.push(
        (Array.isArray(entry.message) ? entry.message : [entry.message]).map((part) =>
          typeof part === "string" ? part : String(part)
        ).join(" ")
      )
    }
    for (const existing of loggers) existing.log(entry)
  })
  const value = yield* effect.pipe(Effect.provideService(Logger.CurrentLoggers, new Set([logger])))
  return { value, warnings }
})

/** Opens a popup from a `target=_blank` link on the page, and returns it once it opens. */
const openPopup = Effect.fnUntraced(function*(page: Page.Page, origin: string) {
  yield* page.goto(
    fixtureUrl(origin, `<a target="_blank" href="${fixtureUrl(origin, "<h1>Popup</h1>")}">Open popup</a>`)
  )
  const opened = yield* Popup.next(page)
  yield* page.getByRole("link", { name: "Open popup" }).click()
  const popup = yield* opened
  yield* popup.getByRole("heading").pipe(Expect.toHaveText("Popup"))
  return popup
})

const size = (page: Page.Page) => page.evaluateInMainWorld(() => [innerWidth, innerHeight] as const)

export const declarations = (
  name: "Chromium" | "Firefox" | "WebKit",
  backend: Layer.Layer<Browser.Browser, unknown>
) =>
  describe(`${name} declarations`, () => {
    layer(SharedContext.layer(backend), { excludeTestServices: true, timeout })((suite) => {
      const it = SharedContext.guard(suite)
      it.effect("accepts untrusted HTTPS only in the opted-in context, or refuses without changing siblings", () =>
        Effect.gen(function*() {
          const { origin } = yield* tlsSite
          const sibling = yield* Browser.newPage()
          const rejected = yield* sibling.goto(origin).pipe(Effect.flip)
          assert(Page.isPageError(rejected) && rejected.reason._tag === "NavigationFailed")
          const options = { acceptInsecureCerts: true, eventLog: 0 }
          if (!(yield* supports("acceptInsecureCerts"))) {
            const error = yield* Browser.newContext(options).pipe(Effect.flip)
            assert(UserContext.isUserContextError(error) && error.reason._tag === "Unsupported")
            assert.strictEqual(error.reason.capability, "acceptInsecureCerts")
          } else {
            const context = yield* Browser.newContext(options)
            const page = yield* context.newPage
            yield* page.goto(origin, { waitUntil: "load" })
            assert.strictEqual(yield* page.title, "secure")
            // Browser.newPage must forward the same creation options.
            const shortcut = yield* Browser.newPage(options)
            yield* shortcut.goto(origin, { waitUntil: "load" })
            assert.strictEqual(yield* shortcut.title, "secure")
          }
          const stillRejected = yield* sibling.goto(`${origin}/after`).pipe(Effect.flip)
          assert(Page.isPageError(stillRejected) && stillRejected.reason._tag === "NavigationFailed")
          const explicit = yield* Browser.newPage({ ...options, acceptInsecureCerts: false })
          const explicitRejected = yield* explicit.goto(origin).pipe(Effect.flip)
          assert(Page.isPageError(explicitRejected) && explicitRejected.reason._tag === "NavigationFailed")
        }), timeout)

      it.effect("reads configured viewport precedence and releases without measuring the page", () =>
        Effect.scoped(Effect.gen(function*() {
          const browser = yield* Browser.Browser
          const context = yield* Browser.newContext()
          const page = yield* context.newPage
          const read: Page.ReadonlyPage = page
          assert.deepStrictEqual(yield* read.viewportSize, Option.none())
          // A real window has dimensions even when no viewport was declared.
          const measured = yield* page.evaluateInMainWorld(() =>
            [innerWidth, innerHeight] as const
          )
          assert.isAbove(measured[0]!, 0)
          assert.isAbove(measured[1]!, 0)
          if (!(yield* supports("emulation.viewport"))) {
            const error = yield* page.emulate({ viewport: { width: 640, height: 480 } }).pipe(Effect.flip)
            assert.strictEqual(error._tag, "DeclarationError")
            assert.deepStrictEqual(yield* read.viewportSize, Option.none())
          } else {
            const defaultContext = yield* browser.defaultContext.control
            const inherited = yield* defaultContext.emulate({ viewport: { width: 900, height: 700 } })
            // The default context declaration does not reach this page.
            assert.deepStrictEqual(yield* read.viewportSize, Option.none())
            yield* inherited.remove
            const base = yield* context.emulate({ viewport: { width: 640, height: 480 } })
            assert.deepStrictEqual(yield* read.viewportSize, Option.some({ width: 640, height: 480 }))
            const later = yield* context.newPage
            assert.deepStrictEqual(yield* later.viewportSize, Option.some({ width: 640, height: 480 }))
            yield* later.close()
            const first = yield* page.emulate({ viewport: { width: 400, height: 300 } })
            const latest = yield* page.emulate({ viewport: { width: 500, height: 400 } })
            if (yield* supports("emulation.extraHTTPHeaders")) {
              const headers = yield* page.emulate({ extraHTTPHeaders: { "x-viewport-check": "independent" } })
              assert.deepStrictEqual(yield* read.viewportSize, Option.some({ width: 500, height: 400 }))
              yield* headers.remove
              assert.deepStrictEqual(yield* read.viewportSize, Option.some({ width: 500, height: 400 }))
            }
            const contextLatest = yield* context.emulate({ viewport: { width: 800, height: 600 } })
            assert.deepStrictEqual(yield* read.viewportSize, Option.some({ width: 500, height: 400 }))
            yield* first.remove
            assert.deepStrictEqual(yield* read.viewportSize, Option.some({ width: 500, height: 400 }))
            yield* latest.remove
            assert.deepStrictEqual(yield* read.viewportSize, Option.some({ width: 800, height: 600 }))
            yield* contextLatest.remove
            assert.deepStrictEqual(yield* read.viewportSize, Option.some({ width: 640, height: 480 }))
            yield* base.remove
            assert.deepStrictEqual(yield* read.viewportSize, Option.none())
          }
          yield* page.close()
          const gone = yield* read.viewportSize.pipe(Effect.flip)
          assert.strictEqual(gone._tag, "TargetGone")
        })), timeout)

      // ── Viewport releases with a popup open ──

      it.effect("releases a page's own context's viewport promptly after it opened a popup", () =>
        Effect.gen(function*() {
          if (!(yield* supports("emulation.viewport")) || !(yield* supports("popups.opener"))) {
            return
          }
          const { origin } = yield* site
          const { warnings } = yield* withWarnings(Effect.gen(function*() {
            const released = yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
              const popup = yield* openPopup(page, origin)
              assert.deepStrictEqual(yield* size(popup), [1280, 720])
              return Date.now()
            }))
            const elapsed = Date.now() - released
            assert.isBelow(elapsed, 5_000, `the scope's release took ${elapsed} ms`)
          }))
          assert.deepStrictEqual(
            warnings.filter((warning) =>
              warning.includes("Failed to release")
            ),
            []
          )
        }), timeout)

      it.effect("releases a context's viewport while a popup is open, giving the popup its own size back", () =>
        Effect.gen(function*() {
          if (!(yield* supports("emulation.viewport")) || !(yield* supports("popups.opener"))) {
            return
          }
          const { origin } = yield* site
          const { warnings } = yield* withWarnings(Effect.scoped(Effect.gen(function*() {
            const context = yield* Browser.newContext()
            const page = yield* context.newPage
            const natural = yield* size(page)
            const declared = yield* context.emulate({ viewport: { width: 640, height: 480 } })
            const popup = yield* openPopup(page, origin)
            assert.deepStrictEqual(yield* size(popup), [640, 480])
            const started = Date.now()
            yield* declared.remove
            const elapsed = Date.now() - started
            assert.isBelow(elapsed, 5_000, `the viewport's release took ${elapsed} ms`)
            assert.deepStrictEqual(yield* popup.viewportSize, Option.none())
            assert.deepStrictEqual(yield* size(popup), natural)
            assert.deepStrictEqual(yield* size(page), natural)
          })))
          assert.deepStrictEqual(
            warnings.filter((warning) =>
              warning.includes("Failed to release")
            ),
            []
          )
        }), timeout)

      it.effect("releases a context's viewport while a popup in a window of its own is open", () =>
        Effect.gen(function*() {
          if (!(yield* supports("emulation.viewport")) || !(yield* supports("popups.opener"))) {
            return
          }
          const { origin } = yield* site
          const { warnings } = yield* withWarnings(Effect.scoped(Effect.gen(function*() {
            const context = yield* Browser.newContext()
            const page = yield* context.newPage
            const declared = yield* context.emulate({ viewport: { width: 640, height: 480 } })
            const target = fixtureUrl(origin, "<h1>Popup</h1>")
            yield* page.goto(fixtureUrl(
              origin,
              `<button onclick="window.open('${target}', '_blank', 'width=400,height=300')">Open popup</button>`
            ))
            const opened = yield* Popup.next(page)
            yield* page.getByRole("button", { name: "Open popup" }).click()
            const popup = yield* opened
            yield* popup.getByRole("heading").pipe(Expect.toHaveText("Popup"))
            assert.deepStrictEqual(yield* size(popup), [640, 480])
            const started = Date.now()
            yield* declared.remove
            const elapsed = Date.now() - started
            assert.isBelow(elapsed, 5_000, `the viewport's release took ${elapsed} ms`)
            assert.deepStrictEqual(yield* popup.viewportSize, Option.none())
          })))
          assert.deepStrictEqual(
            warnings.filter((warning) =>
              warning.includes("Failed to release")
            ),
            []
          )
          if (name === "Chromium") {
            // Nothing in the popup's window records its size, so its restore isn't confirmed
            assert.isTrue(warnings.some((warning) =>
              warning.includes("could not be verified")
            ))
          }
        }), timeout)

      it.effect("releases a context's viewport after a popup in its own window opens a tab", () =>
        Effect.gen(function*() {
          if (!(yield* supports("emulation.viewport")) || !(yield* supports("popups.opener"))) {
            return
          }
          const { origin } = yield* site
          const { warnings } = yield* withWarnings(Effect.scoped(Effect.gen(function*() {
            const context = yield* Browser.newContext()
            const page = yield* context.newPage
            const declared = yield* context.emulate({ viewport: { width: 640, height: 480 } })
            const target = fixtureUrl(origin, "<h1>Popup</h1>")
            yield* page.goto(fixtureUrl(
              origin,
              `<button onclick="window.open('${target}', '_blank', 'width=400,height=300')">Open popup</button>`
            ))
            const opened = yield* Popup.next(page)
            yield* page.getByRole("button", { name: "Open popup" }).click()
            const popup = yield* opened
            yield* popup.getByRole("heading").pipe(Expect.toHaveText("Popup"))
            assert.deepStrictEqual(yield* size(popup), [640, 480])
            const nested = yield* openPopup(popup, origin)
            assert.deepStrictEqual(yield* size(nested), [640, 480])
            const started = Date.now()
            yield* declared.remove
            const elapsed = Date.now() - started
            assert.isBelow(elapsed, 5_000, `the viewport's release took ${elapsed} ms`)
            assert.deepStrictEqual(yield* popup.viewportSize, Option.none())
            assert.deepStrictEqual(yield* nested.viewportSize, Option.none())
            assert.notDeepEqual(yield* size(nested), [640, 480])
          })))
          assert.deepStrictEqual(
            warnings.filter((warning) =>
              warning.includes("Failed to release")
            ),
            []
          )
          // The popup window's restore isn't confirmed; the tab takes the original page's size and confirms it
          assert.strictEqual(
            warnings.filter((warning) =>
              warning.includes("could not be verified")
            ).length,
            name === "Chromium" ? 1 : 0
          )
        }), timeout)

      it.effect("releases a context's viewport after a popup window opens a tab once the original page closed", () =>
        Effect.gen(function*() {
          if (!(yield* supports("emulation.viewport")) || !(yield* supports("popups.opener"))) {
            return
          }
          const { origin } = yield* site
          const { warnings } = yield* withWarnings(Effect.scoped(Effect.gen(function*() {
            const context = yield* Browser.newContext()
            const page = yield* context.newPage
            const declared = yield* context.emulate({ viewport: { width: 640, height: 480 } })
            const target = fixtureUrl(origin, "<h1>Popup</h1>")
            yield* page.goto(fixtureUrl(
              origin,
              `<button onclick="window.open('${target}', '_blank', 'width=400,height=300')">Open popup</button>`
            ))
            const opened = yield* Popup.next(page)
            yield* page.getByRole("button", { name: "Open popup" }).click()
            const popup = yield* opened
            yield* popup.getByRole("heading").pipe(Expect.toHaveText("Popup"))
            yield* page.close()
            yield* popup.activate
            // The tab can't join the popup's window, so it opens alone in a new one
            const tab = yield* openPopup(popup, origin)
            assert.deepStrictEqual(yield* size(tab), [640, 480])
            const started = Date.now()
            yield* declared.remove
            const elapsed = Date.now() - started
            assert.isBelow(elapsed, 5_000, `the viewport's release took ${elapsed} ms`)
            assert.deepStrictEqual(yield* tab.viewportSize, Option.none())
          })))
          assert.deepStrictEqual(
            warnings.filter((warning) =>
              warning.includes("Failed to release")
            ),
            []
          )
          if (name === "Chromium") {
            // The tab measured the size it inherited before its window laid it out, so its own size is unknown
            assert.isTrue(warnings.some((warning) =>
              warning.includes("could not be verified")
            ))
          }
        }), timeout)

      it.effect(
        "releases a context's viewport after a popup window opens a tab with mobile emulation once the original page closed",
        () =>
          Effect.gen(function*() {
            if (!(yield* supports("emulation.viewport.mobile")) || !(yield* supports("popups.opener"))) {
              return
            }
            const { origin } = yield* site
            const { warnings } = yield* withWarnings(Effect.scoped(Effect.gen(function*() {
              const context = yield* Browser.newContext()
              const page = yield* context.newPage
              const declared = yield* context.emulate({ viewport: { width: 640, height: 480, mobile: true } })
              const target = fixtureUrl(origin, "<h1>Popup</h1>")
              yield* page.goto(fixtureUrl(
                origin,
                `<button onclick="window.open('${target}', '_blank', 'width=400,height=300')">Open popup</button>`
              ))
              const opened = yield* Popup.next(page)
              yield* page.getByRole("button", { name: "Open popup" }).click()
              const popup = yield* opened
              yield* popup.getByRole("heading").pipe(Expect.toHaveText("Popup"))
              yield* page.close()
              yield* popup.activate
              // The tab can't join the popup's window, so it opens alone in a new one
              const tab = yield* openPopup(popup, origin)
              const started = Date.now()
              yield* declared.remove
              const elapsed = Date.now() - started
              assert.isBelow(elapsed, 5_000, `the viewport's release took ${elapsed} ms`)
              assert.deepStrictEqual(yield* tab.viewportSize, Option.none())
            })))
            assert.deepStrictEqual(
              warnings.filter((warning) =>
                warning.includes("Failed to release")
              ),
              []
            )
            if (name === "Chromium") {
              // The tab measured the size it inherited before its window laid it out, so its own size is unknown
              assert.isTrue(warnings.some((warning) =>
                warning.includes("could not be verified")
              ))
            }
          }),
        timeout
      )

      // ── Routes ──

      it.effect("applies and releases a route immediately before navigation on a live page", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* SharedContext.newPage
          yield* page.goto(`${origin}/hello`)
          for (let n = 0; n < 10; n++) {
            yield* Effect.scoped(Effect.gen(function*() {
              const route = yield* page.route(`${origin}/hello*`, () =>
                Route.fulfill(HttpServerResponse.html("<title>routed</title>")))
              yield* page.goto(`${origin}/hello?route=${n}`, { waitUntil: "load" })
              assert.strictEqual(yield* page.title, "routed")
              assert.strictEqual(yield* route.hits, 1)
            }))
            yield* page.goto(`${origin}/hello?released=${n}`, { waitUntil: "load" })
            assert.notStrictEqual(yield* page.title, "routed")
          }
        }), timeout)

      it.effect("continues a paused request when its last route is removed", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* SharedContext.newPage
          const entered = yield* Deferred.make<void>()
          const interrupted = yield* Deferred.make<void>()
          const route = yield* page.route(`${origin}/json*`, () =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(interrupted, undefined))
            ))
          const decided = yield* AutoResolution.next(page)
          const fetching = yield* run(page, origin, `return fetch('/json').then(r => r.json())`).pipe(Effect.forkChild)
          yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"))
          yield* route.remove
          yield* Deferred.await(interrupted).pipe(Effect.timeout("10 seconds"))
          assert.deepStrictEqual(yield* Fiber.join(fetching), { hello: "world" })
          assert.strictEqual((yield* decided).decision, "continue")
          yield* route.remove
          assert.deepStrictEqual(yield* run(page, origin, `return fetch('/json').then(r => r.json())`), {
            hello: "world"
          })
          assert.strictEqual(yield* route.hits, 1)
        }), timeout)

      for (const transition of ["install", "replace"] as const) {
        it.effect(
          `respects response interception capability after ${transition} while the server holds a response`,
          () =>
            Effect.gen(function*() {
              const page = yield* SharedContext.newPage
              let arrived!: () => void
              const arrival = new Promise<void>((resolve) => {
                arrived = resolve
              })
              let release!: () => void
              let hold = true
              const server = yield* Effect.acquireRelease(
                Effect.promise(() =>
                  new Promise<http.Server>((resolve, reject) => {
                    const server = http.createServer((request, response) => {
                      const send = () => {
                        response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" })
                        response.end("<title>network</title>")
                      }
                      if (request.url === "/held" && hold) {
                        hold = false
                        release = send
                        arrived()
                      } else send()
                    })
                    server.once("error", reject)
                    server.listen(0, "127.0.0.1", () =>
                      resolve(server))
                  })
                ),
                (server) =>
                  Effect.promise(() =>
                    new Promise<void>((resolve) => {
                      server.close(() =>
                        resolve()
                      )
                      server.closeAllConnections()
                    })
                  )
              )
              const origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
              const seen: Array<string> = []
              const previous = transition === "replace"
                ? yield* page.route(`${origin}/held`, () =>
                  Effect.sync(() => {
                    seen.push("previous")
                  }).pipe(Effect.andThen(Route.continue)), { phase: "response" })
                : undefined
              const navigation = yield* page.goto(`${origin}/held`).pipe(Effect.forkChild)
              yield* Effect.promise(() =>
                arrival
              ).pipe(Effect.timeout("10 seconds"))
              const current = yield* page.route(`${origin}/held`, () =>
                Effect.sync(() => {
                  seen.push("current")
                }).pipe(Effect.andThen(Route.continue)), { phase: "response" })
              if (previous) {
                yield* previous.remove
              }
              release()
              yield* Fiber.join(navigation)
              assert.strictEqual(yield* page.title, "network")
              const intercepted = transition === "replace" || responseRouteInFlight[name]
              assert.deepStrictEqual(seen, intercepted ? ["current"] : [])
              assert.strictEqual(yield* current.hits, intercepted ? 1 : 0)
              if (previous) {
                assert.strictEqual(yield* previous.hits, 0)
              }
              // Requests started after declaration returns must be routed on every backend.
              seen.length = 0
              yield* page.goto(`${origin}/held`)
              assert.deepStrictEqual(seen, ["current"])
              assert.strictEqual(yield* current.hits, intercepted ? 2 : 1)
              yield* current.remove
              yield* page.goto(`${origin}/after`, { waitUntil: "load" })
              assert.strictEqual(yield* page.title, "network")
              assert.deepStrictEqual(seen, ["current"])
            }),
          timeout
        )
      }

      it.effect("runs call site 7's route on a page of ours: blocked calls, counted", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const blocked = yield* page.route(`${origin}/analytics/**`, () =>
              Route.abort())
            const result = yield* run(
              page,
              origin,
              `return Promise.all([1, 2, 3].map((n) => fetch('/analytics/hit/' + n).then(() => 'sent', () => 'blocked')))`
            )
            assert.deepStrictEqual(result, ["blocked", "blocked", "blocked"])
            assert.strictEqual(yield* blocked.hits, 3)
          }))
        }), timeout)

      it.effect("fulfills, continues with changes, and falls through from a page's route to its context's", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.context.route(`${origin}/api/**`, () =>
              Route.fulfill(json({ from: "context" })))
            yield* page.route(
              `${origin}/api/user`,
              (intercepted) =>
                intercepted.request.method === "POST" ? Route.fulfill(json({ from: "page" })) : Route.fallthrough
            )
            yield* page.route(
              `${origin}/echo*`,
              () =>
                Route.continueWith((request) =>
                  request.pipe(HttpClientRequest.setHeader("x-test", "1"), HttpClientRequest.bodyText("changed"))
                )
            )
            const result = yield* run(
              page,
              origin,
              `const read = (url, init) => fetch(url, init).then((r) => r.json());
               const echo = await read('/echo', { method: 'POST', body: 'hello' });
               return [await read('/api/user'), await read('/api/user', { method: 'POST' }), await read('/api/other'), echo.headers['x-test'], echo.body]`
            )
            assert.deepStrictEqual(result, [{ from: "context" }, { from: "page" }, { from: "context" }, "1", "changed"])
          }))
        }), timeout)

      it.effect("reads a request's body, and none when it has none", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const bodies: Array<string> = []
            yield* page.route(`${origin}/echo*`, (intercepted) =>
              Effect.flatMap(intercepted.requestBody, (body) => {
                bodies.push(Option.match(body, {
                  onNone: () =>
                    "none",
                  onSome: (bytes) =>
                    new TextDecoder().decode(bytes)
                }))
                return Route.continue
              }))
            yield* run(
              page,
              origin,
              `await fetch('/echo', { method: 'POST', body: 'hello' }); await fetch('/echo'); return 'done'`
            )
            assert.deepStrictEqual(bodies, ["hello", "none"])
          }))
        }), timeout)

      it.effect("continues when a handler fails, and says so", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.goto(`${origin}/hello`)
            yield* page.route(`${origin}/json*`, () =>
              Effect.fail("no answer"))
            const decided = yield* AutoResolution.next(page)
            const result = yield* run(page, origin, `return fetch('/json').then((r) => r.json())`)
            assert.deepStrictEqual(result, { hello: "world" })
            const resolution = yield* decided
            assert.strictEqual(resolution.subject._tag, "PausedRequest")
            assert.strictEqual(resolution.decision, "continue")
          }))
        }), timeout)

      it.effect("sees a response at the response phase, and patches it where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const seen: Array<string> = []
            yield* page.route(`${origin}/json*`, (intercepted) =>
              Effect.gen(function*() {
                seen.push(`${intercepted.response.status} ${intercepted.response.headers["x-test"]}`)
                const body = yield* intercepted.responseBody
                const original = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>
                return yield* Route.fulfill(json({ ...original, patched: true }))
              }), { phase: "response" })
            const result = yield* run(page, origin, `return fetch('/json').then((r) => r.json())`)
            assert.deepStrictEqual(seen, ["200 yes"])
            // The body is CDP's alone: elsewhere the handler fails, and the response continues as it was
            assert.deepStrictEqual(result, name === "Chromium" ? { hello: "world", patched: true } : { hello: "world" })
          }))
        }), timeout)

      it.effect("continues a response with a new status and headers where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.route(
              `${origin}/json*`,
              ({ response }) =>
                Route.continueWith({ status: 203, headers: Headers.set(response.headers, "x-route", "1") }),
              { phase: "response" }
            )
            const result = yield* run(
              page,
              origin,
              `return fetch('/json').then(async (r) => [r.status, r.headers.get('x-route'), r.headers.get('x-test'), await r.text()])`
            )
            // WebKit can't send a paused response on changed (interception.responseHeaders): the default continues it
            assert.deepStrictEqual(
              result,
              name === "WebKit" ? [200, null, "yes", `{"hello":"world"}`] : [203, "1", "yes", `{"hello":"world"}`]
            )
          }))
        }), timeout)

      it.effect("routes an exact origin written without its trailing slash", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const route = yield* page.route(origin, () =>
              Route.fulfill(HttpServerResponse.html("<title>routed</title>")))
            yield* page.goto(`${origin}/`, { waitUntil: "load" })
            assert.strictEqual(yield* page.title, "routed")
            assert.strictEqual(yield* route.hits, 1)
          }))
        }), timeout)

      it.effect("matches a URLPattern route, pausing only the URLs under its fixed prefix", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.route(`${origin}/:name(json)`, () =>
              Route.fulfill(json({ routed: true })))
            const result = yield* run(page, origin, `return fetch('/json').then((r) => r.json())`)
            assert.deepStrictEqual(result, { routed: true })
          }))
        }), timeout)

      // A request a route continues goes to the server, a cacheable one too: the browser looks in its cache only
      // after the pause, so a cache hit would answer it there, and the server would never see it
      it.effect("sends each fetch of a cacheable URL a page's route continues to the server", () =>
        Effect.gen(function*() {
          const { origin, served } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const route = yield* page.route(`${origin}/cached.js*`, () =>
              Route.continue)
            const result = yield* run(
              page,
              origin,
              `const read = () => fetch('/cached.js?page').then((r) => r.status); return [await read(), await read()]`
            )
            assert.deepStrictEqual(result, [200, 200])
            const requested = served.filter((request) =>
              request.path === "/cached.js?page"
            )
            assert.deepStrictEqual({ routed: yield* route.hits, served: requested.length }, { routed: 2, served: 2 })
          }))
        }), timeout)

      it.effect(
        "sends each fetch of a cacheable URL a context's route continues to the server, on a page opened after it",
        () =>
          Effect.gen(function*() {
            const { origin, served } = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const context = yield* SharedContext.current
              const route = yield* context.route(`${origin}/cached.js*`, () =>
                Route.continue)
              const page = yield* SharedContext.newPage
              const result = yield* run(
                page,
                origin,
                `const read = () => fetch('/cached.js?context').then((r) => r.status); return [await read(), await read()]`
              )
              assert.deepStrictEqual(result, [200, 200])
              const requested = served.filter((request) =>
                request.path === "/cached.js?context"
              )
              assert.deepStrictEqual({ routed: yield* route.hits, served: requested.length }, { routed: 2, served: 2 })
            }))
          }),
        timeout
      )

      it.effect("sends each fetch of a cacheable URL from a new cross-site frame to the server", () =>
        Effect.gen(function*() {
          const { crossSite, origin, served } = yield* site
          const page = yield* SharedContext.newPage
          const route = yield* page.route(`${crossSite}/cached.js*`, () =>
            Route.continue)
          const child = fixtureUrl(
            crossSite,
            `<script>(async () => { const read = () => fetch('/cached.js?frame').then((r) => r.status); parent.postMessage([await read(), await read()], '*') })()</script>`
          )
          const result = yield* run(
            page,
            origin,
            `return new Promise((resolve) => { addEventListener('message', (event) => resolve(event.data), { once: true }); const frame = document.createElement('iframe'); frame.src = ${
              JSON.stringify(child)
            }; document.body.append(frame) })`
          )
          assert.deepStrictEqual(result, [200, 200])
          assert.deepStrictEqual({
            routed: yield* route.hits,
            served: served.filter((request) =>
              request.path === "/cached.js?frame"
            ).length
          }, { routed: 2, served: 2 })
        }), timeout)

      for (const scope of ["page", "context"] as const) {
        it.effect(
          `sends each fetch of a cacheable URL from a dedicated worker to the server while a ${scope} route is active`,
          () =>
            Effect.gen(function*() {
              const { origin, served } = yield* site
              const page = yield* SharedContext.newPage
              yield* (scope === "page" ? page : page.context).route(`${origin}/cached.js*`, () =>
                Route.continue)
              const script =
                `onmessage = async ({ data }) => { const read = () => fetch(data).then((r) => r.status); postMessage([await read(), await read()]) }`
              const result = yield* run(
                page,
                origin,
                `return new Promise((resolve, reject) => { const worker = new Worker(URL.createObjectURL(new Blob([${
                  JSON.stringify(script)
                }], { type: 'text/javascript' }))); worker.onmessage = ({ data }) => { worker.terminate(); resolve(data) }; worker.onerror = reject; worker.postMessage(location.origin + '/cached.js?worker-${scope}') })`
              )
              assert.deepStrictEqual(result, [200, 200])
              assert.strictEqual(
                served.filter((request) =>
                  request.path === `/cached.js?worker-${scope}`
                ).length,
                workerFetchesBypassCache[name] ? 2 : 1
              )
            }),
          timeout
        )
      }

      it.effect("answers a cacheable URL from the cache again once its page's last route is removed", () =>
        Effect.gen(function*() {
          const { origin, served } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const fetched = () =>
              served.filter((request) =>
                request.path === "/cached.js?released"
              ).length
            const read = `return fetch('/cached.js?released').then((r) => r.status)`
            yield* Effect.scoped(Effect.gen(function*() {
              yield* page.route(`${origin}/cached.js*`, () =>
                Route.continue)
              assert.strictEqual(yield* run(page, origin, read), 200)
            }))
            assert.strictEqual(yield* run(page, origin, read), 200)
            const before = fetched()
            assert.strictEqual(yield* run(page, origin, read), 200)
            assert.strictEqual(fetched(), cachesFetches[name] ? before : before + 1)
          }))
        }), timeout)

      it.effect(
        "sends each fetch of a cacheable URL to the server from a document whose navigation was held as its route was declared",
        () =>
          Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            let arrived!: () => void
            const arrival = new Promise<void>((resolve) => {
              arrived = resolve
            })
            let release!: () => void
            let served = 0
            const server = yield* Effect.acquireRelease(
              Effect.promise(() =>
                new Promise<http.Server>((resolve, reject) => {
                  const server = http.createServer((request, response) => {
                    if (request.url === "/cached.js") {
                      served++
                      response.writeHead(200, { "content-type": "text/javascript", "cache-control": "max-age=3600" })
                      response.end("// cached")
                      return
                    }
                    release = () => {
                      response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" })
                      response.end(
                        `<pre id="out">pending</pre><script>(async () => { const read = () => fetch('/cached.js').then((r) => r.status); return [await read(), await read()] })().then((value) => { document.getElementById('out').textContent = JSON.stringify(value) })</script>`
                      )
                    }
                    arrived()
                  })
                  server.once("error", reject)
                  server.listen(0, "127.0.0.1", () =>
                    resolve(server))
                })
              ),
              (server) =>
                Effect.promise(() =>
                  new Promise<void>((resolve) => {
                    server.close(() =>
                      resolve()
                    )
                    server.closeAllConnections()
                  })
                )
            )
            const origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
            const navigation = yield* page.goto(`${origin}/held`).pipe(Effect.forkChild)
            yield* Effect.promise(() => arrival).pipe(Effect.timeout("10 seconds"))
            const route = yield* page.route(`${origin}/cached.js`, () => Route.continue)
            release()
            yield* Fiber.join(navigation)
            const out = page.locator("#out")
            yield* Expect.that(out.readText, Condition.make("finished", (text: string) => text !== "pending"))
            assert.deepStrictEqual(JSON.parse(yield* out.readText), [200, 200])
            assert.deepStrictEqual({ routed: yield* route.hits, served }, { routed: 2, served: 2 })
          }),
        timeout
      )

      it.effect(
        "answers a cacheable URL from the cache in a context without routes while another context's route is in force",
        () =>
          Effect.gen(function*() {
            const { origin, served } = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const routed = yield* Browser.newContext()
              yield* routed.route(`${origin}/cached.js*`, () => Route.continue)
              const other = yield* Browser.newContext()
              const page = yield* other.newPage
              const result = yield* run(
                page,
                origin,
                `const read = () => fetch('/cached.js?other').then((r) => r.status); return [await read(), await read()]`
              )
              assert.deepStrictEqual(result, [200, 200])
              const requested = served.filter((request) => request.path === "/cached.js?other")
              assert.strictEqual(requested.length, cachesFetches[name] ? 1 : 2)
            }))
          }),
        timeout
      )

      it.effect("rejects an invalid HTTP credential origin without exposing credentials", () =>
        Effect.gen(function*() {
          const error = yield* Browser.newContext({
            httpCredentials: {
              origin: "https://user:do-not-print@example.com/path",
              username: "strider",
              password: Redacted.make("do-not-print")
            }
          }).pipe(Effect.flip)
          assert(UserContext.isUserContextError(error) && error.reason._tag === "InvalidInput", String(error))
          assert.notInclude(JSON.stringify(error), "do-not-print")
        }), timeout)

      it.effect(
        "uses context HTTP credentials for navigation and subresources with route precedence and isolation",
        () =>
          Effect.gen(function*() {
            const { origin } = yield* site
            const configured = Browser.newContext({
              httpCredentials: {
                origin,
                username: "strider",
                password: Redacted.make("secret")
              }
            })
            if (name === "WebKit") {
              const error = yield* Effect.flip(configured)
              assert(UserContext.isUserContextError(error) && error.reason._tag === "Unsupported", String(error))
              return
            }
            const context = yield* configured
            const page = yield* context.newPage
            assert.include(String(yield* run(page, origin, `return fetch('/auth').then(r => r.text())`)), "signed in")
            yield* page.goto(`${origin}/auth`)
            yield* page.getByText("signed in").pipe(Expect.toBeVisible)
            const canceled = yield* Browser.newPage({
              httpCredentials: {
                origin: origin.toUpperCase() + "/",
                username: "strider",
                password: Redacted.make("secret")
              }
            })
            yield* canceled.context.route("**", () => Route.fallthrough, { phase: "auth" })
            const cancel = yield* canceled.route("**", () => Route.continue, { phase: "auth" })
            yield* canceled.goto(`${origin}/auth`)
            yield* canceled.getByText("who are you?").pipe(Expect.toBeVisible)
            yield* cancel.remove
            yield* canceled.goto(`${origin}/auth`)
            yield* canceled.getByText("signed in").pipe(Expect.toBeVisible)
            const isolated = yield* Browser.newPage()
            yield* isolated.goto(`${origin}/auth`)
            yield* isolated.getByText("who are you?").pipe(Expect.toBeVisible)
            const refused = yield* Browser.newContext({
              httpCredentials: {
                origin,
                username: "strider",
                password: Redacted.make("wrong")
              }
            })
            const denied = yield* refused.newPage
            yield* denied.goto(`${origin}/auth`).pipe(Deadline.within("5 seconds"))
            yield* denied.getByText("who are you?").pipe(Expect.toBeVisible)
            const mismatch = yield* Browser.newContext({
              httpCredentials: {
                origin: "https://example.com",
                username: "strider",
                password: Redacted.make("secret")
              }
            })
            const unmatched = yield* mismatch.newPage
            yield* unmatched.goto(`${origin}/auth`)
            yield* unmatched.getByText("who are you?").pipe(Expect.toBeVisible)
            const overridden = yield* Browser.newContext({
              httpCredentials: {
                origin,
                username: "strider",
                password: Redacted.make("wrong")
              }
            })
            yield* overridden.route("**", () =>
              Route.provideCredentials({
                username: "strider",
                password: Redacted.make("secret")
              }), { phase: "auth" })
            const routed = yield* overridden.newPage
            yield* routed.goto(`${origin}/auth`)
            yield* routed.getByText("signed in").pipe(Expect.toBeVisible)
          }),
        timeout
      )

      it.effect("authenticates a dedicated worker request with context HTTP credentials", () =>
        Effect.gen(function*() {
          if (name === "WebKit") {
            return
          }
          const { origin } = yield* site
          const page = yield* Browser.newPage({
            httpCredentials: {
              origin,
              username: "strider",
              password: Redacted.make("secret")
            }
          })
          const result = yield* run(
            page,
            origin,
            `
            const source = URL.createObjectURL(new Blob([\`fetch('${origin}/auth', { signal: AbortSignal.timeout(5000) }).then(r => r.text()).then(postMessage, e => postMessage(e.message))\`], { type: 'text/javascript' }));
            return await new Promise((resolve) => {
              const worker = new Worker(source);
              worker.onmessage = (event) => { worker.terminate(); URL.revokeObjectURL(source); resolve(event.data) };
            });
          `
          ).pipe(Deadline.within("10 seconds"))
          assert.include(String(result), "signed in")
        }), timeout)

      it.effect("bounds automatic credentials across an authenticated redirect chain", () =>
        Effect.gen(function*() {
          if (name === "WebKit") {
            return
          }
          let origin = ""
          let first = 0
          let second = 0
          const server = yield* Effect.acquireRelease(
            Effect.promise(() =>
              new Promise<http.Server>((resolve, reject) => {
                const server = http.createServer((request, response) => {
                  const authorized =
                    request.headers.authorization === `Basic ${Buffer.from("strider:secret").toString("base64")}`
                  if (!authorized) {
                    response.writeHead(401, {
                      "www-authenticate": `Basic realm="${request.url}"`,
                      "content-type": "text/html"
                    })
                    response.end("<title>denied</title>")
                  } else if (request.url === "/first") {
                    first++
                    response.writeHead(302, { location: origin.replace("127.0.0.1", "localhost") + "/second" })
                    response.end()
                  } else {
                    second++
                    response.end("<title>signed in</title>")
                  }
                })
                server.once("error", reject)
                server.listen(0, "127.0.0.1", () => resolve(server))
              })
            ),
            (server) =>
              Effect.promise(() =>
                new Promise<void>((resolve) => {
                  server.close(() => resolve())
                  server.closeAllConnections()
                })
              )
          )
          origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
          const page = yield* Browser.newPage({
            httpCredentials: { username: "strider", password: Redacted.make("secret") }
          })
          yield* page.goto(`${origin}/first`, { waitUntil: "load" }).pipe(Deadline.within("5 seconds"))
          assert.strictEqual(yield* page.title, "denied")
          assert.strictEqual(first, 1)
          assert.strictEqual(second, 0)
        }), timeout)

      it.effect("answers an authentication challenge where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const registered = page.route(
              `${origin}/auth`,
              () => Route.provideCredentials({ username: "strider", password: Redacted.make("secret") }),
              {
                phase: "auth"
              }
            )
            if (name === "WebKit") {
              const error = yield* Effect.flip(registered)
              assert(Route.isRouteError(error) && error.reason._tag === "Unsupported", String(error))
              return
            }
            yield* registered
            yield* page.goto(`${origin}/auth`)
            yield* page.getByText("signed in").pipe(Expect.toBeVisible)
          }))
        }), timeout)

      it.effect("lets the page see the challenge when no route answers it", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          if (name === "WebKit") {
            return
          }
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.route(`${origin}/auth`, () => Route.continue, { phase: "auth" })
            yield* page.goto(`${origin}/auth`)
            yield* page.getByText("who are you?").pipe(Expect.toBeVisible)
          }))
        }), timeout)

      it.effect("gives the page the server's response to a challenge with no auth route, where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const challenges = yield* status("network.challenges")
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            if (challenges === "unsupported") {
              // The browser waits on its own answer, and the navigation never commits
              const waited = yield* Effect.flip(page.goto(`${origin}/auth`).pipe(Deadline.within("2 seconds")))
              assert(Deadline.isTimeout(waited), String(waited))
              return
            }
            // No route, no prompt: the 401 the server sent, as its page
            const navigation = yield* page.goto(`${origin}/auth`)
            assert(navigation._tag === "Committed" && Option.isSome(navigation.response), navigation._tag)
            assert.strictEqual(navigation.response.value.status, 401)
            yield* page.getByText("who are you?").pipe(Expect.toBeVisible)
            // A fetch's challenge too, where the backend pauses every challenge, not a document's alone
            if (challenges === "supported") {
              assert.deepStrictEqual(
                yield* run(page, origin, `return fetch('/auth').then(async (r) => [r.status, await r.text()])`),
                [401, `<title>auth</title><p>who are you?</p>`]
              )
            }
          }))
        }), timeout)

      it.effect("fails a navigation a route aborts, with a reason on CDP", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.route(`${origin}/blocked*`, () =>
              Route.abort())
            const failed = yield* Effect.flip(page.goto(`${origin}/blocked`))
            assert(Page.isPageError(failed) && failed.reason._tag === "NavigationFailed", String(failed))
            yield* page.route(`${origin}/timed-out*`, () =>
              Route.abort("timedOut"))
            if (name === "Chromium") {
              const timedOut = yield* Effect.flip(page.goto(`${origin}/timed-out`))
              assert(Page.isPageError(timedOut) && timedOut.reason._tag === "NavigationFailed", String(timedOut))
              assert.include(timedOut.reason.message, "ERR_TIMED_OUT")
            } else {
              // A reason the backend can't convey is a decision it can't apply: the default continues
              const decided = yield* AutoResolution.next(page)
              yield* page.goto(`${origin}/timed-out`)
              assert.strictEqual((yield* decided).decision, "continue")
            }
          }))
        }), timeout)

      it.effect("rejects a pattern that doesn't compile", () =>
        Effect.gen(function*() {
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const error = yield* Effect.flip(
              page.route("https://example.com/:id(", () =>
                Route.continue)
            )
            assert(Route.isRouteError(error) && error.reason._tag === "InvalidInput", String(error))
          }))
        }), timeout)

      // ── Declarations on a page with a cross-site iframe ──

      it.effect("applies a viewport to a page with a cross-site iframe, which follows its frame, and releases it", () =>
        Effect.gen(function*() {
          if (!(yield* supports("emulation.viewport"))) {
            return
          }
          yield* crossSiteFrame(
            (target) =>
              target.emulate({ viewport: { width: 640, height: 480 } }),
            framed
          )
        }), timeout)

      it.effect("applies and releases a viewport after a cross-site iframe has loaded", () =>
        Effect.gen(function*() {
          if (!(yield* supports("emulation.viewport"))) {
            return
          }
          const { crossSite, origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const context = yield* Browser.newContext()
            const page = yield* context.newPage
            yield* page.goto(
              fixtureUrl(
                origin,
                `<pre id="size"></pre><script>addEventListener('resize', () => { document.getElementById('size').textContent = innerWidth + 'x' + innerHeight })</script><pre id="out">pending</pre><script>addEventListener('message', e => { document.getElementById('out').textContent = e.data })</script><iframe style="width:300px;height:200px;border:0" src="${
                  fixtureUrl(crossSite, frameBody)
                }"></iframe>`
              ),
              { waitUntil: "load" }
            )
            yield* Expect.that(page.locator("#out").readText, framed)
            yield* Effect.scoped(Effect.gen(function*() {
              yield* page.emulate({ viewport: { width: 640, height: 480 } })
              yield* page.locator("#size").pipe(Expect.toHaveText("640x480"))
            }))
          }))
        }), timeout)

      it.effect("applies the other emulation overrides to a page with a cross-site iframe and releases them", () =>
        Effect.gen(function*() {
          const settings: Parameters<Page.Page["emulate"]>[0] = {
            ...((yield* supports("emulation.userAgent")) ? { userAgent: "strider-oopif/1" } : {}),
            ...((yield* supports("emulation.locale")) ? { locale: "de-DE" } : {}),
            ...((yield* supports("emulation.timezone")) ? { timezone: "Europe/Berlin" } : {}),
            ...((yield* supports("emulation.media")) ? { media: { colorScheme: "dark" as const } } : {}),
            ...((yield* supports("emulation.geolocation")) ? { geolocation: { latitude: 52, longitude: 13 } } : {}),
            ...((yield* supports("emulation.cpuSlowdown")) ? { cpuSlowdown: 2 } : {}),
            ...((yield* supports("emulation.network.throttling"))
              ? { network: { download: 1e6, upload: 1e6, latency: "10 millis" as const } }
              : {}),
            ...((yield* supports("emulation.touch")) ? { touch: true } : {}),
            ...((yield* supports("emulation.javaScript")) ? { javaScript: "enabled" as const } : {})
          }
          yield* crossSiteFrame(
            (target) =>
              target.emulate(settings),
            framed
          )
        }), timeout)

      it.effect("applies extra headers to a page with a cross-site iframe and releases them", () =>
        Effect.gen(function*() {
          if (!(yield* supports("emulation.extraHTTPHeaders"))) {
            return
          }
          yield* crossSiteFrame(
            (target) =>
              target.emulate({ extraHTTPHeaders: { "x-oopif": "1" } }),
            framed
          )
        }), timeout)

      // Each step loads the parent afresh and needs the frame's document and the frame's own fetch from the same
      // scope's route: on Chromium the document pauses on its parent's session, before the frame's target attaches, and
      // the fetch on the frame's own session. The context's route comes first alone, so it alone must reach the frame
      // of a new page; then the page's takes precedence, and each closed scope must stop answering.
      it.effect("routes a page with a cross-site iframe and releases the routes", () =>
        Effect.scoped(Effect.gen(function*() {
          const { crossSite, origin } = yield* site
          const fetched = "/fixture?html=server"
          // The frame's document, which names its scope and then the scope its fetch's answer came from
          const frameDocument = (scope: string) =>
            `${frameBody}<script>fetch('${fetched}', { cache: 'no-store' }).then((response) => response.text()).then((tag) => { window.__tag = '${scope}/' + tag; report() })</script>`
          const noStore = { "cache-control": "no-store" }
          const route = (target: Page.Page | UserContext.UserContext, scope: string) =>
            target.route(`${crossSite}/fixture*`, ({ request }) =>
              Route.fulfill(
                request.url === `${crossSite}${fetched}`
                  ? HttpServerResponse.text(scope, { headers: noStore })
                  : HttpServerResponse.text(frameDocument(scope), { contentType: "text/html", headers: noStore })
              ))
          // The server's own frame, at a URL the routes match
          const parent = fixtureUrl(
            origin,
            `<title>parent</title><pre id="out">pending</pre><script>addEventListener('message', (e) => { document.getElementById('out').textContent = e.data })</script><iframe style="width:300px;height:200px;border:0" src="${
              fixtureUrl(crossSite, frameDocument("server"))
            }"></iframe>`
          )
          const loads = Effect.fnUntraced(function*(page: Page.Page, tag: string) {
            yield* page.goto(parent)
            yield* Expect.that(page.locator("#out").readText, tagged(tag))
          })
          const context = yield* Browser.newContext()
          const contextRoute = yield* Effect.acquireRelease(Scope.make(), (scope, exit) =>
            Scope.close(scope, exit))
          yield* route(context, "context").pipe(Scope.provide(contextRoute))
          const page = yield* context.newPage
          yield* loads(page, "context/context")
          yield* Effect.scoped(Effect.gen(function*() {
            yield* route(page, "page")
            yield* loads(page, "page/page")
          }))
          yield* loads(page, "context/context")
          yield* Scope.close(contextRoute, Exit.void)
          yield* loads(page, "server/server")
        })), timeout)

      it.effect("runs init scripts in a page with a cross-site iframe and releases them", () =>
        crossSiteFrame(
          (target) =>
            target.addInitScript({ source: "window.__tag = 'init'" }),
          tagged("init")
        ), timeout)

      // ── Init scripts ──

      for (const timing of [undefined, "beforeAuthorScript"] as const) {
        it.effect(`runs launched context init scripts before author scripts with ${timing ?? "default"} timing`, () =>
          Effect.gen(function*() {
            const { origin } = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* SharedContext.newPage
              yield* page.context.addInitScript({ source: "window.__launchedTiming = 'before'" }, { timing })
              yield* page.goto(
                fixtureUrl(origin, "<h1><script>document.write(window.__launchedTiming ?? 'missing')</script></h1>")
              )
              yield* page.getByRole("heading").pipe(Expect.toHaveText("before"))
            }))
          }), timeout)
      }

      it.effect("runs call site 11: scripts in order, after their dependencies, in every frame", () =>
        Effect.gen(function*() {
          const { crossSite, origin } = yield* site
          const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "strider-init-")), "script.js")
          fs.writeFileSync(file, "(window.order = window.order || []).push('path')")
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const helper = yield* page.context.addInitScript(() => {
              ;(window as unknown as { order: Array<string> }).order = ["helper"]
            })
            yield* page.addInitScript({ source: "window.order.push('uses helper')" }, { after: [helper] })
            const broken = yield* page.addInitScript({ source: "throw new Error('init threw')" })
            yield* page.addInitScript({ source: "window.order.push('after broken')" }, { after: [broken] })
            yield* page.addInitScript({ path: file })
            const thrown = yield* UncaughtException.next(page)
            const child =
              `<script>parent.postMessage(location.origin + ' ' + JSON.stringify(window.order), '*')</script>`
            const result = yield* run(
              page,
              origin,
              `await new Promise((resolve) => { if (messages.length >= 2) return resolve(); addEventListener('message', () => messages.length >= 2 && resolve()) }); return [window.order, window.frames.length, ...window.messages]`,
              `<script>window.messages = []; addEventListener('message', (e) => messages.push(e.data))</script><iframe src="${
                fixtureUrl(origin, child)
              }"></iframe><iframe src="${fixtureUrl(crossSite, child)}"></iframe>`
            )
            const [order, , ...frames] = result as [Array<string>, number, ...Array<string>]
            assert.deepStrictEqual(order, ["helper", "uses helper", "path"])
            assert.sameMembers(frames, [
              `${origin} ["helper","uses helper","path"]`,
              `${crossSite} ["helper","uses helper","path"]`
            ])
            assert.strictEqual((yield* thrown).message, "init threw")
          }))
        }), timeout)

      it.effect("stops a dependent once its dependency is removed, and refuses one already gone", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const helper = yield* page.addInitScript({ source: "window.order = ['helper']" })
            yield* page.addInitScript({ source: "window.order.push('dependent')" }, { after: [helper] })
            assert.deepStrictEqual(yield* run(page, origin, "return window.order"), ["helper", "dependent"])
            yield* helper.remove
            assert.strictEqual(yield* run(page, origin, "return window.order ?? null"), null)
            const error = yield* Effect.flip(page.addInitScript({ source: "1" }, { after: [helper] }))
            assert(Declaration.isDeclarationError(error) && error.reason._tag === "DependencyReleased", String(error))
            // A context's script can't follow a page's, which it may outlive
            const pageScript = yield* page.addInitScript({ source: "1" })
            const narrower = yield* Effect.flip(page.context.addInitScript({ source: "1" }, { after: [pageScript] }))
            assert(
              Declaration.isDeclarationError(narrower) && narrower.reason._tag === "InvalidInput",
              String(narrower)
            )
          }))
        }), timeout)

      it.effect("leaves no script running after concurrent removals", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const first = yield* page.addInitScript({ source: "(window.ran ??= []).push('first')" })
            const second = yield* page.addInitScript({ source: "(window.ran ??= []).push('second')" })
            assert.deepStrictEqual(yield* run(page, origin, "return window.ran"), ["first", "second"])
            yield* Effect.all([first.remove, second.remove], { concurrency: "unbounded", discard: true })
            assert.strictEqual(yield* run(page, origin, "return window.ran ?? null"), null)
          }))
        }), timeout)

      it.effect("runs each of the init scripts declared at once exactly once in a new document", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const expected: Array<string> = []
            for (let i = 0; i < 10; i++) {
              expected.push(`a${i}`, `b${i}`)
              yield* Effect.all([
                page.addInitScript({ source: `(window.ran ??= []).push('a${i}')` }),
                page.addInitScript({ source: `(window.ran ??= []).push('b${i}')` })
              ], { concurrency: "unbounded", discard: true })
            }
            const ran = (yield* run(page, origin, "return window.ran")) as Array<string>
            assert.sameMembers(ran, expected)
            assert.strictEqual(ran.length, expected.length)
          }))
        }), timeout)

      it.effect("runs a script in the isolated world, apart from the page's, where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const added = page.addInitScript({ source: "window.isolatedRan = true" }, { world: "isolated" })
            if (name === "WebKit") {
              const error = yield* Effect.flip(added)
              assert(Declaration.isDeclarationError(error) && error.reason._tag === "Unsupported", String(error))
              return
            }
            yield* added
            // The page's world doesn't see what the isolated one set
            assert.strictEqual(yield* run(page, origin, "return window.isolatedRan ?? null"), null)
          }))
        }), timeout)

      // ── Emulation ──

      it.effect("applies extra request headers and restores scoped replacements", () =>
        Effect.gen(function*() {
          const { origin, served } = yield* site
          const page = yield* Browser.newPage({
            emulation: { extraHTTPHeaders: { "X-Strider": "context", "x-context": "yes" } }
          })
          const sibling = yield* page.context.newPage
          const isolated = yield* SharedContext.newPage
          const read = (target: Page.Page) =>
            target.evaluateInMainWorld(() =>
              fetch("/headers").then((r) =>
                r.json()
              ) as Promise<Record<string, string>>
            )
          yield* sibling.goto(`${origin}/hello`)
          assert.strictEqual((yield* read(sibling))["x-strider"], "context")
          yield* isolated.goto(`${origin}/hello`)
          assert.strictEqual((yield* read(isolated))["x-strider"], undefined)
          const temporary = yield* isolated.context.emulate({ extraHTTPHeaders: { "x-temporary": "yes" } })
          assert.strictEqual((yield* read(isolated))["x-temporary"], "yes")
          yield* temporary.remove
          assert.strictEqual((yield* read(isolated))["x-temporary"], undefined)
          const registration = yield* page.emulate({ extraHTTPHeaders: { "X-Strider": "outer" } })
          yield* page.goto(fixtureUrl(origin, "<img src=\"/hello?extra-header-resource\">"))
          assert.strictEqual(
            served.find((r) =>
              r.path.includes("extra-header-resource")
            )?.headers["x-strider"],
            "outer"
          )
          assert.strictEqual(
            served.find((r) =>
              r.path.startsWith("/fixture") && r.path.includes("extra-header-resource")
            )?.headers["x-strider"],
            "outer"
          )
          assert.strictEqual((yield* read(page))["x-context"], "yes")
          yield* Effect.scoped(Effect.gen(function*() {
            yield* page.emulate({ extraHTTPHeaders: { "x-strider": "inner" } })
            assert.strictEqual((yield* read(page))["x-strider"], "inner")
          }))
          assert.strictEqual((yield* read(page))["x-strider"], "outer")
          yield* Effect.scoped(Effect.gen(function*() {
            yield* page.emulate({ extraHTTPHeaders: {} })
            assert.strictEqual((yield* read(page))["x-strider"], "context")
          }))
          yield* Effect.scoped(Effect.gen(function*() {
            yield* page.route(`${origin}/headers`, () =>
              Route.continueWith((request) =>
                HttpClientRequest.setHeader(request, "x-strider", "route")
              ))
            assert.strictEqual((yield* read(page))["x-strider"], "route")
          }))
          assert.strictEqual((yield* read(sibling))["x-strider"], "context")
          yield* registration.remove
          assert.strictEqual((yield* read(page))["x-strider"], "context")
          const older = yield* page.emulate({ extraHTTPHeaders: { "x-strider": "older" } })
          const newer = yield* page.emulate({ extraHTTPHeaders: { "x-strider": "newer" } })
          yield* older.remove
          assert.strictEqual((yield* read(page))["x-strider"], "newer")
          yield* newer.remove
          assert.strictEqual((yield* read(page))["x-strider"], "context")
          const contextRegistration = yield* page.context.emulate({ extraHTTPHeaders: { "x-strider": "new-context" } })
          const later = yield* page.context.newPage
          yield* later.goto(`${origin}/hello`)
          assert.strictEqual((yield* read(later))["x-strider"], "new-context")
          yield* contextRegistration.remove
          assert.strictEqual((yield* read(later))["x-strider"], "context")
        }), timeout)

      it.effect("rejects invalid extra headers before applying any field", () =>
        Effect.gen(function*() {
          const page = yield* SharedContext.newPage
          const width = yield* page.evaluateInMainWorld(() =>
            innerWidth
          )
          const error = yield* Effect.flip(
            page.emulate({ viewport: { width: 640, height: 480 }, extraHTTPHeaders: { "bad name": "value" } })
          )
          assert(Declaration.isDeclarationError(error) && error.reason._tag === "InvalidInput")
          assert.strictEqual(
            yield* page.evaluateInMainWorld(() =>
              innerWidth
            ),
            width
          )
        }), timeout)

      it.effect("runs call site 6: a context created with a locale", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const created = Browser.newPage({ emulation: { locale: "de-DE", timezone: "Asia/Tokyo" } })
            if (!(yield* supports("emulation.locale")) || !(yield* supports("emulation.timezone"))) {
              const error = yield* Effect.flip(created)
              assert(Page.isPageError(error) && error.reason._tag === "Unsupported", String(error))
              return
            }
            const page = yield* created
            assert.deepStrictEqual(
              yield* run(page, origin, "return [navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone]"),
              ["de-DE", "Asia/Tokyo"]
            )
          }))
        }), timeout)

      it.effect("emulates each field, or fails naming what the backend can't", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(`${origin}/hello`)
            const attempt = Effect.fnUntraced(function*(settings: Parameters<Page.Page["emulate"]>[0], read: string) {
              const exit = yield* Effect.exit(Effect.scoped(Effect.gen(function*() {
                yield* page.emulate(settings)
                return yield* run(page, origin, read)
              })))
              if (exit._tag === "Success") {
                return exit.value
              }
              const error = exit.cause.reasons.find((reason) =>
                reason._tag === "Fail"
              )
              assert(error !== undefined && Declaration.isDeclarationError(error.error), String(exit.cause))
              assert.strictEqual(error.error.reason._tag, "Unsupported")
              return `unsupported ${(error.error.reason as { capability: string }).capability}`
            })
            const results = {
              viewport: yield* attempt({ viewport: { width: 640, height: 480 } }, "return innerWidth"),
              userAgent: yield* attempt({ userAgent: "Strider/1.0" }, "return navigator.userAgent"),
              timezone: yield* attempt(
                { timezone: "Asia/Tokyo" },
                "return Intl.DateTimeFormat().resolvedOptions().timeZone"
              ),
              media: yield* attempt(
                { media: { colorScheme: "dark" } },
                "return matchMedia('(prefers-color-scheme: dark)').matches"
              ),
              throttling: yield* attempt(
                { network: { download: 1e6, upload: 1e6, latency: "10 millis" } },
                "return 'applied'"
              ),
              cpu: yield* attempt({ cpuSlowdown: 2 }, "return 'applied'"),
              touch: yield* attempt({ touch: true }, "return navigator.maxTouchPoints"),
              mobile: yield* attempt({ viewport: { width: 400, height: 700, mobile: true } }, "return 'applied'")
            }
            // What each field's capability says: applied, or refused under its name
            const or = (capability: string, applied: unknown) =>
              Effect.map(status(capability), (found) =>
                found === "unsupported" ? `unsupported ${capability}` : applied)
            const expected = {
              viewport: yield* or("emulation.viewport", 640),
              userAgent: yield* or("emulation.userAgent", "Strider/1.0"),
              timezone: yield* or("emulation.timezone", "Asia/Tokyo"),
              media: yield* or("emulation.media", true),
              throttling: yield* or("emulation.network.throttling", "applied"),
              cpu: yield* or("emulation.cpuSlowdown", "applied"),
              touch: yield* or("emulation.touch", 5),
              mobile: yield* or("emulation.viewport.mobile", "applied")
            }
            assert.deepStrictEqual(results, expected)
            // Each call's scope closed, so the page is as it was
            assert.notStrictEqual(yield* run(page, origin, "return innerWidth"), 640)
            // Offline, a page can't be navigated to read it: it says what it sees when asked
            if (!(yield* supports("emulation.network.offline"))) {
              return
            }
            yield* page.goto(fixtureUrl(
              origin,
              `<button onclick="document.getElementById('online').textContent = String(navigator.onLine)">Check</button><p id="online"></p>`
            ))
            yield* Effect.scoped(Effect.gen(function*() {
              yield* page.emulate({ network: "offline" })
              yield* page.getByRole("button", { name: "Check" }).click()
              yield* page.locator("#online").pipe(Expect.toHaveText("false"))
            }))
          }))
        }), timeout)

      it.effect("emulates a position, with the permission granted to its origin", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            if (!(yield* supports("permissions"))) {
              const error = yield* Effect.flip(page.context.grant(["geolocation"], { origin }))
              assert(Declaration.isDeclarationError(error) && error.reason._tag === "Unsupported", String(error))
              return
            }
            yield* page.context.grant(["geolocation"], { origin })
            yield* page.context.emulate({ geolocation: { latitude: 51.5, longitude: -0.1, accuracy: 10 } })
            assert.deepStrictEqual(
              yield* run(
                page,
                origin,
                "return new Promise((resolve) => navigator.geolocation.getCurrentPosition((p) => resolve([p.coords.latitude, p.coords.longitude]), (e) => resolve('error ' + e.code)))"
              ),
              [51.5, -0.1]
            )
          }))
        }), timeout)

      // ── Permissions ──

      it.effect("grants a permission and takes it back, and to every origin where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const query = "return navigator.permissions.query({ name: 'notifications' }).then((p) => p.state)"
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            if (!(yield* supports("permissions"))) {
              const error = yield* Effect.flip(page.context.grant(["notifications"], { origin }))
              assert(Declaration.isDeclarationError(error) && error.reason._tag === "Unsupported", String(error))
              return
            }
            const granted = yield* page.context.grant(["notifications"], { origin })
            assert.strictEqual(yield* run(page, origin, query), "granted")
            yield* granted.remove
            assert.strictEqual(yield* run(page, origin, query), "prompt")
            const everywhere = page.context.grant(["notifications"])
            if (!(yield* supports("permissions.anyOrigin"))) {
              const error = yield* Effect.flip(everywhere)
              assert(Declaration.isDeclarationError(error) && error.reason._tag === "Unsupported", String(error))
            } else {
              yield* everywhere
              assert.strictEqual(yield* run(page, origin, query), "granted")
            }
          }))
        }), timeout)

      it.effect("denies a permission, which its change reports, and restores what was in force once removed", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const query = "return navigator.permissions.query({ name: 'notifications' }).then((p) => p.state)"
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            if (!(yield* supports("permissions"))) {
              const error = yield* Effect.flip(page.context.deny(["notifications"], { origin }))
              assert(Declaration.isDeclarationError(error) && error.reason._tag === "Unsupported", String(error))
              return
            }
            const browser = yield* Browser.Browser
            const tabs = yield* browser.pages
            const observed = (yield* tabs[0]!.control).context
            const refused = yield* Effect.flip(observed.deny(["notifications"], { origin }))
            assert(Declaration.isDeclarationError(refused) && refused.reason._tag === "NotPermitted", String(refused))
            // The page that's open hears the change
            yield* page.goto(fixtureUrl(
              origin,
              `<p id="state">pending</p><script>navigator.permissions.query({ name: 'notifications' }).then((status) => { document.getElementById('state').textContent = status.state; status.onchange = () => { document.getElementById('state').textContent = 'changed ' + status.state } })</script>`
            ))
            yield* page.locator("#state").pipe(Expect.toHaveText("prompt"))
            const denied = yield* page.context.deny(["notifications"], { origin })
            yield* page.locator("#state").pipe(Expect.toHaveText("changed denied"))
            assert.strictEqual(yield* run(page, origin, query), "denied")
            yield* denied.remove
            assert.strictEqual(yield* run(page, origin, query), "prompt")
            // A denial over a grant holds while it lives; once it goes, the grant is in force again
            yield* page.context.grant(["notifications"], { origin })
            const over = yield* page.context.deny(["notifications"], { origin })
            assert.strictEqual(yield* run(page, origin, query), "denied")
            yield* over.remove
            assert.strictEqual(yield* run(page, origin, query), "granted")
            const remaining = yield* page.context.deny(["notifications"], { origin })
            const newest = yield* page.context.grant(["notifications"], { origin })
            yield* newest.remove
            assert.strictEqual(yield* run(page, origin, query), "denied")
            const rejected = yield* Effect.flip(
              page.context.grant(["notifications", "not-a-permission"], { origin })
            )
            assert(
              Declaration.isDeclarationError(rejected) && rejected.reason._tag === "InvalidInput",
              String(rejected)
            )
            assert.strictEqual(yield* run(page, origin, query), "denied")
            yield* remaining.remove
            assert.strictEqual(yield* run(page, origin, query), "granted")
          }))
        }), timeout)

      it.effect("uses the latest permission declaration across explicit and every-origin settings", () =>
        Effect.gen(function*() {
          if (!(yield* supports("permissions.anyOrigin"))) {
            return
          }
          const { origin } = yield* site
          const query = "return navigator.permissions.query({ name: 'notifications' }).then((p) => p.state)"
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.context.grant(["notifications"], { origin })
            const denied = yield* page.context.deny(["notifications"])
            assert.strictEqual(yield* run(page, origin, query), "denied")
            yield* denied.remove
            assert.strictEqual(yield* run(page, origin, query), "granted")
          }))
        }), timeout)

      // ── Content Security Policy ──

      it.effect(
        "runs inline scripts and eval under a forbidding policy in a context that bypasses it, where the backend can",
        () =>
          Effect.gen(function*() {
            const { crossSite, origin } = yield* site
            if (!(yield* supports("bypassCSP"))) {
              const error = yield* Browser.newContext({ bypassCSP: true }).pipe(
                Deadline.within("1 second"),
                Effect.flip,
                Effect.scoped
              )
              assert(UserContext.isUserContextError(error) && error.reason._tag === "Unsupported", String(error))
              return
            }
            yield* Effect.scoped(Effect.gen(function*() {
              const bypassing = yield* Browser.newContext({ bypassCSP: true })
              const page = yield* bypassing.newPage
              yield* page.goto(`${origin}/csp?html=${encodeURIComponent(cspProbe)}`)
              assert.strictEqual(yield* cspOutcome(page), "ran,ran")
              // A cross-site navigation, and a cross-site iframe, each in a renderer of its own on Chromium
              yield* page.goto(`${crossSite}/csp?html=${encodeURIComponent(cspProbe)}`)
              assert.strictEqual(yield* cspOutcome(page), "ran,ran")
              yield* page.goto(fixtureUrl(
                origin,
                `<pre id="out">pending</pre><script>addEventListener('message', (e) => { document.getElementById('out').textContent = e.data })</script><iframe src="${crossSite}/csp?html=${
                  encodeURIComponent(cspProbe)
                }"></iframe>`
              ))
              yield* Expect.that(
                page.locator("#out").readText,
                Condition.make("reported", (text: string) =>
                  text !== "pending")
              )
              assert.strictEqual(yield* page.locator("#out").readText, "ran,ran")
              // A context in the same browser that doesn't ask keeps the policy
              const other = yield* Browser.newPage()
              yield* other.goto(`${origin}/csp?html=${encodeURIComponent(cspProbe)}`)
              assert.strictEqual(yield* cspOutcome(other), "blocked,refused")
            }))
          }),
        timeout
      )

      it.effect("creates a context with permissions and emulated focus, where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const created = Effect.exit(Browser.newPage({ permissions: ["notifications"], focus: "emulated" }))
            const exit = yield* created
            if (!(yield* supports("permissions.anyOrigin")) || !(yield* supports("emulation.focus"))) {
              // Every origin, and focus emulation, are what WebDriver BiDi and stock WebKit can't do
              assert(exit._tag === "Failure")
              const error = exit.cause.reasons.find((reason) =>
                reason._tag === "Fail"
              )
              assert(error !== undefined && Page.isPageError(error.error), String(exit.cause))
              assert.strictEqual(error.error.reason._tag, "Unsupported")
              return
            }
            assert(exit._tag === "Success", String(exit))
            assert.deepStrictEqual(
              yield* run(
                exit.value,
                origin,
                "return [await navigator.permissions.query({ name: 'notifications' }).then((p) => p.state), document.hasFocus()]"
              ),
              ["granted", true]
            )
          }))
        }), timeout)

      // ── The clock ──

      it.effect("runs init scripts and the clock in a page's dedicated workers where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const script = page.addInitScript({ source: "self.__marked = 'yes'" }, { workers: true })
            const clock = page.clock.install({ mode: "controlled", at: "2030-01-02T03:04:05Z" }, { workers: true })
            if (name === "Firefox") {
              // WebDriver BiDi's preload scripts run in documents only
              for (const declared of [script, clock]) {
                const error = yield* Effect.flip(declared)
                assert(Declaration.isDeclarationError(error), String(error))
                assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "initScripts.workers" })
              }
              return
            }
            yield* script
            yield* clock
            const start = Date.UTC(2030, 0, 2, 3, 4, 5)
            const first = yield* run(
              page,
              origin,
              `const worker = new Worker(URL.createObjectURL(new Blob(["onmessage = () => postMessage([self.__marked ?? 'none', Date.now()])"], { type: "text/javascript" })))
              window.ask = () => new Promise((resolve) => { worker.onmessage = (event) => resolve(event.data); worker.postMessage(0) })
              return await window.ask()`
            )
            assert.deepStrictEqual(first, ["yes", start])
            // An operation reaches the worker as it reaches the page's documents
            yield* page.clock.adjust("1 hour")
            const later = yield* page.evaluateInMainWorld(() =>
              (window as unknown as { ask: () => Promise<[string, number]> }).ask()
            )
            assert.deepStrictEqual(later, ["yes", start + 3_600_000])
            // A script in workers comes after only scripts that run there too
            const documentsOnly = yield* page.addInitScript({ source: "self.__other = 1" })
            const refused = yield* Effect.flip(
              page.addInitScript({ source: "self.__after = 1" }, { workers: true, after: [documentsOnly] })
            )
            assert(Declaration.isDeclarationError(refused), String(refused))
            assert.strictEqual(refused.reason._tag, "InvalidInput")
          }))
        }), timeout)

      it.effect("runs call site 10 on a controlled clock", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.clock.install({ mode: "controlled", at: "2026-01-01T09:00:00Z" })
            yield* page.goto(fixtureUrl(
              origin,
              `<p id="now"></p><button onclick="setTimeout(() => document.getElementById('state').textContent = 'Session expired', 5 * 60 * 1000); document.getElementById('state').textContent = 'Started'">Start</button><p id="state"></p><script>document.getElementById('now').textContent = new Date().toISOString()</script>`
            ))
            yield* page.locator("#now").pipe(Expect.toHaveText("2026-01-01T09:00:00.000Z"))
            yield* page.getByRole("button", { name: "Start" }).click()
            yield* page.locator("#state").pipe(Expect.toHaveText("Started"))
            yield* page.clock.adjust("4 minutes")
            yield* page.locator("#state").pipe(Expect.toHaveText("Started"))
            yield* page.clock.adjust("1 minute")
            yield* page.getByText("Session expired").pipe(Expect.toBeVisible)
            // The timeline carries over to the next document
            assert.strictEqual(yield* run(page, origin, "return new Date().toISOString()"), "2026-01-01T09:05:00.000Z")
          }))
        }), timeout)

      it.effect("applies overlapping adjustments and settings of a controlled clock, each one", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.clock.install({ mode: "controlled", at: "2026-01-01T00:00:00Z" })
            yield* page.setContent("<p>clock</p>")
            for (let i = 0; i < 20; i++) {
              yield* Effect.all([
                page.clock.adjust("16 millis"),
                page.clock.setTime(Date.UTC(2026, 0, 1, 0, 0, i + 1))
              ], { concurrency: "unbounded", discard: true })
            }
            // A new document starts at the timeline's last setting, which no earlier one overrides
            yield* page.clock.setTime(Date.UTC(2026, 0, 2))
            assert.strictEqual(yield* run(page, origin, "return new Date().toISOString()"), "2026-01-02T00:00:00.000Z")
          }))
        }), timeout)

      it.effect("freezes, shifts and resumes time, and says what's wrong", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const notInstalled = yield* Effect.flip(page.clock.adjust("1 second"))
            assert(PageClock.isPageClockError(notInstalled) && notInstalled.reason._tag === "NotInstalled")
            const fixed = yield* page.clock.install({ mode: "fixed", at: "2030-05-05T05:05:05Z" })
            assert.strictEqual(
              yield* run(
                page,
                origin,
                "await new Promise((resolve) => setTimeout(resolve, 100)); return new Date().toISOString()"
              ),
              "2030-05-05T05:05:05.000Z"
            )
            const wrongMode = yield* Effect.flip(page.clock.adjust("1 second"))
            assert(PageClock.isPageClockError(wrongMode) && wrongMode.reason._tag === "WrongMode")
            const conflict = yield* Effect.flip(
              page.context.clock.install({ mode: "fixed", at: "2030-01-01T00:00:00Z" })
            )
            assert(Declaration.isDeclarationError(conflict) && conflict.reason._tag === "Conflict")
            yield* page.clock.resume
            const resumed = yield* run(
              page,
              origin,
              "const before = Date.now(); await new Promise((resolve) => setTimeout(resolve, 200)); return [new Date(before).getUTCFullYear(), Date.now() - before >= 150]"
            )
            assert.deepStrictEqual(resumed, [2030, true])
            yield* fixed.remove
            const offset = yield* page.clock.install({ mode: "offset", by: "365 days" })
            const year = yield* run(page, origin, "return new Date().getUTCFullYear()")
            assert.strictEqual(year, new Date(Date.now() + 365 * 86_400_000).getUTCFullYear())
            yield* offset.remove
          }))
        }), timeout)

      it.effect("keeps one timeline for every page of a context", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const first = yield* SharedContext.newPage
            yield* first.context.clock.install({ mode: "controlled", at: "2026-03-03T03:03:03Z" })
            const second = yield* first.context.newPage
            yield* first.context.clock.adjust("1 hour")
            const read = "return new Date().toISOString()"
            assert.strictEqual(yield* run(first, origin, read), "2026-03-03T04:03:03.000Z")
            assert.strictEqual(yield* run(second, origin, read), "2026-03-03T04:03:03.000Z")
          }))
        }), timeout)

      // Playwright's controlled clock is the reference for the timeline's rules in these cases
    })

    // Cases that keep nothing in their context share one
    layer(SharedContext.layer(backend), { excludeTestServices: true, timeout })((suite) => {
      const it = SharedContext.guard(suite)

      it.effect("reports a fine pointer with hover to a page of a default context", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            // Strider drives the page with a mouse, so a desktop page sees one, headless or not
            assert.deepStrictEqual(
              yield* run(
                page,
                origin,
                "return ['(hover: hover)', '(any-hover: hover)', '(pointer: fine)', '(any-pointer: fine)'].map((query) => [query, matchMedia(query).matches])"
              ),
              [
                ["(hover: hover)", true],
                ["(any-hover: hover)", true],
                ["(pointer: fine)", true],
                ["(any-pointer: fine)", true]
              ]
            )
          }))
        }), timeout)

      it.effect("waits for every document when a timer throws a value without a string conversion", () =>
        Effect.scoped(Effect.gen(function*() {
          const first = yield* SharedContext.newPage
          yield* first.context.clock.install({ mode: "controlled", at: 1000 })
          const second = yield* SharedContext.newPage
          const { origin } = yield* site
          yield* second.goto(fixtureUrl(origin, "<p>second</p>"))
          yield* first.evaluateInMainWorld(() => {
            setTimeout(() => {
              throw Object.create(null)
            }, 1)
          })
          yield* second.evaluateInMainWorld(() => {
            let count = 0
            setInterval(() =>
              Reflect.set(window, "__count", ++count), 1)
          })
          const error = yield* failure(first.context.clock.adjust(1000), "adjust over a throwing value")
          assert.deepStrictEqual(
            yield* second.evaluateInMainWorld(() => [Date.now(), Reflect.get(window, "__count")]),
            [2000, 1000]
          )
          assert(PageClock.isPageClockError(error) && error.reason._tag === "EvaluationThrown", String(error))
        })), timeout)

      it.effect("runs a timer scheduled at the end of a long chain of messages", () =>
        Effect.scoped(Effect.gen(function*() {
          const page = yield* SharedContext.newPage
          yield* page.clock.install({ mode: "controlled", at: 1000 })
          yield* page.evaluateInMainWorld(() => {
            // Window messages and port messages, handed on one after another
            const channel = new MessageChannel()
            let messages = 0
            const next = () => {
              if (++messages === 200) {
                setTimeout(() =>
                  Reflect.set(window, "__done", true), 100)
              } else if (messages % 2 === 0) {
                channel.port2.postMessage(null)
              } else window.postMessage("clock-chain", "*")
            }
            channel.port1.onmessage = next
            addEventListener("message", (event) => {
              if (event.data === "clock-chain") {
                next()
              }
            })
            setTimeout(next, 100)
          })
          yield* page.clock.adjust(1000)
          assert.strictEqual(
            yield* page.evaluateInMainWorld(() =>
              Reflect.get(window, "__done") === true
            ),
            true
          )
        })), timeout)

      it.effect(
        "times out over a page that posts messages without end, after running its timers, and keeps its clock usable",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const { origin } = yield* site
            yield* page.clock.install({ mode: "controlled", at: 1000 })
            yield* page.goto(fixtureUrl(origin, `<p id="later">pending</p>`), { waitUntil: "load" })
            yield* page.evaluateInMainWorld(() => {
              const channel = new MessageChannel()
              channel.port1.onmessage = () => {
                if (Reflect.get(window, "__stop") !== true) {
                  channel.port2.postMessage(null)
                }
              }
              setTimeout(() =>
                channel.port2.postMessage(null), 100)
              setTimeout(() => {
                document.getElementById("later")!.textContent = "fired"
              }, 500)
            })
            const error = yield* failure(
              page.clock.adjust(1000).pipe(Deadline.within("1 second")),
              "adjust over endless messages"
            )
            assert(Deadline.isTimeout(error), String(error))
            // Past the deadline, the page stops waiting for its messages and runs the remaining timers
            yield* Expect.that(
              page.locator("#later").readText,
              Condition.make("fired", (text: string) =>
                text === "fired")
            )
            assert.strictEqual(
              yield* page.evaluateInMainWorld(() => {
                Reflect.set(window, "__stop", true)
                return Date.now()
              }),
              2000
            )
            // The clock is usable again: the next adjustment runs once the page stops posting
            yield* page.clock.adjust(1)
            assert.strictEqual(
              yield* page.evaluateInMainWorld(() =>
                Date.now()
              ),
              2001
            )
          })),
        timeout
      )

      it.effect("starts controlled performance time when replacing a fixed clock", () =>
        Effect.scoped(Effect.gen(function*() {
          const page = yield* SharedContext.newPage
          const fixed = yield* page.clock.install({ mode: "fixed", at: 500 })
          yield* fixed.remove
          yield* page.clock.install({ mode: "controlled", at: 1000 })
          yield* page.clock.adjust(100)
          assert.deepStrictEqual(
            yield* page.evaluateInMainWorld(() => [Date.now(), performance.now(), performance.timeOrigin]),
            [1100, 100, 1000]
          )
        })), timeout)

      it.effect("keeps resumed animation frame timestamps on the performance timeline", () =>
        Effect.scoped(Effect.gen(function*() {
          const page = yield* SharedContext.newPage
          const { origin } = yield* site
          yield* page.goto(fixtureUrl(origin, "<p>frame</p>"))
          yield* page.clock.install({ mode: "controlled", at: 1000 })
          yield* page.clock.adjust(1_000_000)
          yield* page.evaluateInMainWorld(() => {
            Reflect.set(
              window,
              "__frame",
              new Promise((resolve) => {
                requestAnimationFrame((at) =>
                  resolve([at, performance.now()])
                )
              })
            )
          })
          yield* page.clock.resume
          const pending = yield* page.evaluateInMainWorld(() =>
            Reflect.get(window, "__frame") as Promise<[number, number]>
          )
          const next = yield* page.evaluateInMainWorld(() =>
            new Promise<[number, number]>((resolve) => {
              requestAnimationFrame((at) =>
                resolve([at, performance.now()])
              )
            })
          )
          for (const [at, now] of [pending, next]) {
            assert(
              at !== undefined && now !== undefined && at >= 1_000_000 && at <= now,
              `frame ${at}, performance.now ${now}`
            )
          }
        })), timeout)

      it.effect("runs the page's tasks between the timers an adjustment fires", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.clock.install({ mode: "controlled", at: "2026-01-01T00:00:00Z" })
            yield* page.goto(fixtureUrl(origin, "<p>clock</p>"))
            // A timer hands off through a real task, which sets a timer due within the same adjustment
            yield* page.evaluateInMainWorld(() => {
              const channel = new MessageChannel()
              channel.port1.onmessage = () =>
                setTimeout(() =>
                  Reflect.set(window, "__done", true), 100)
              setTimeout(() =>
                channel.port2.postMessage(null), 100)
            })
            yield* page.clock.adjust("1 second")
            assert.strictEqual(
              yield* page.evaluateInMainWorld(() =>
                Reflect.get(window, "__done") === true
              ),
              true
            )
          }))
        }), timeout)

      it.effect("gives a 0 ms timer set inside a timer at least 1 ms", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.clock.install({ mode: "controlled", at: "2026-01-01T00:00:00Z" })
            yield* page.goto(fixtureUrl(origin, "<p>clock</p>"))
            yield* page.evaluateInMainWorld(() => {
              const log: Array<string> = []
              Reflect.set(window, "__log", log)
              setTimeout(() => {
                log.push("outer")
                setTimeout(() =>
                  log.push("inner"), 0)
              }, 1000)
            })
            const log = page.evaluateInMainWorld(() => [...(Reflect.get(window, "__log") as Array<string>)])
            yield* page.clock.adjust(1000)
            assert.deepStrictEqual(yield* log, ["outer"])
            yield* page.clock.adjust(1)
            assert.deepStrictEqual(yield* log, ["outer", "inner"])
          }))
        }), timeout)

      it.effect("fails an adjustment with a timer's error, after running the rest and reporting it", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.clock.install({ mode: "controlled", at: "2026-01-01T00:00:00Z" })
            // The page's own script: Chromium hides from the page the errors of functions an evaluation made
            yield* page.goto(
              fixtureUrl(
                origin,
                `<script>
                window.__reported = []
                addEventListener("error", (event) => window.__reported.push(String(event.error?.message)))
                setTimeout(() => { throw new Error("first") }, 100)
                setTimeout(() => { throw new Error("second") }, 200)
                setTimeout(() => { window.__after = true }, 300)
              </script>`
              ),
              { waitUntil: "load" }
            )
            const error = yield* failure(page.clock.adjust("1 second"), "adjust over a throwing timer")
            assert(PageClock.isPageClockError(error), String(error))
            assert(error.reason._tag === "EvaluationThrown", String(error))
            assert.strictEqual(error.reason.exception.message, "first")
            assert.deepStrictEqual(
              yield* page.evaluateInMainWorld(() => [
                Reflect.get(window, "__reported"),
                Reflect.get(window, "__after") === true,
                new Date().toISOString()
              ]),
              [["first", "second"], true, "2026-01-01T00:00:01.000Z"]
            )
          }))
        }), timeout)

      it.effect("rejects durations that aren't finite, and negative adjustments", () =>
        Effect.gen(function*() {
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            for (const by of [Number.NaN, Number.POSITIVE_INFINITY]) {
              const error = yield* failure(
                page.clock.install({ mode: "offset", by }),
                `install({ mode: "offset", by: ${by} })`
              )
              assert(Declaration.isDeclarationError(error), `offset ${by}: ${String(error)}`)
              assert.strictEqual(error.reason._tag, "InvalidInput", `offset ${by}`)
            }
            yield* page.clock.install({ mode: "controlled", at: "2026-01-01T00:00:00Z" })
            for (const by of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
              const error = yield* failure(page.clock.adjust(by), `adjust(${by})`)
              assert(PageClock.isPageClockError(error), `adjust ${by}: ${String(error)}`)
              assert.strictEqual(error.reason._tag, "InvalidInput", `adjust ${by}`)
            }
          }))
        }), timeout)

      it.effect("keeps Date.now() a whole millisecond after a fractional adjustment or offset", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            const controlled = yield* page.clock.install({ mode: "controlled", at: 1000 })
            yield* page.goto(fixtureUrl(origin, "<p>clock</p>"))
            yield* page.clock.adjust(0.5)
            // The adjustment rounds up to a whole millisecond
            assert.strictEqual(
              yield* page.evaluateInMainWorld(() =>
                Date.now()
              ),
              1001
            )
            yield* controlled.remove
            const offset = yield* page.clock.install({ mode: "offset", by: 0.5 })
            assert.deepStrictEqual(
              yield* run(page, origin, "return [Number.isInteger(Date.now()), Number.isInteger(new Date().getTime())]"),
              [true, true]
            )
            yield* offset.remove
          }))
        }), timeout)

      it.effect("counts performance.now() from 0 where the clock reaches a document, from its timeOrigin", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* SharedContext.newPage
            yield* page.clock.install({ mode: "controlled", at: 1000 })
            yield* page.goto(fixtureUrl(origin, "<p>clock</p>"))
            const read = page.evaluateInMainWorld(() => [performance.now(), performance.timeOrigin])
            assert.deepStrictEqual(yield* read, [0, 1000])
            yield* page.clock.adjust(1000)
            assert.deepStrictEqual(yield* read, [1000, 1000])
            // Setting the time back moves neither; forward, it passes time, as an adjustment does
            yield* page.clock.setTime(500)
            assert.deepStrictEqual(yield* read, [1000, 1000])
            yield* page.clock.setTime(3000)
            assert.deepStrictEqual(yield* read, [3500, 1000])
            // After resuming, it carries on in real time from there
            yield* page.clock.resume
            const [now, timeOrigin] = yield* read
            assert(now! >= 3500 && now! < 3500 + 60_000, String(now))
            assert.strictEqual(timeOrigin, 1000)
          }))
        }), timeout)
    })
  })
