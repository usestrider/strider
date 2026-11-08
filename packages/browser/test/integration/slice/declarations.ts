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
  Route,
  UncaughtException
} from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Headers from "effect/http/Headers"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as fs from "node:fs"
import * as http from "node:http"
import type * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { site } from "../adapter/harness.ts"
import { responseRouteInFlight, status, supports } from "./capabilities.ts"

const timeout = 60_000

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

const json = (value: unknown) => HttpServerResponse.jsonUnsafe(value)

export const declarations = (
  name: "Chromium" | "Firefox" | "WebKit",
  backend: Layer.Layer<Browser.Browser, unknown>
) =>
  describe(`${name} declarations`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      // ── Routes ──

      it.effect("applies and releases a route immediately before navigation on a live page", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(`${origin}/hello`)
          for (let n = 0; n < 10; n++) {
            yield* Effect.scoped(Effect.gen(function*() {
              const route = yield* page.route(`${origin}/hello*`, () =>
                Route.fulfill(HttpServerResponse.html("<title>routed</title>")))
              yield* page.goto(`${origin}/hello?route=${n}`)
              assert.strictEqual(yield* page.title, "routed")
              assert.strictEqual(yield* route.hits, 1)
            }))
            yield* page.goto(`${origin}/hello?released=${n}`)
            assert.notStrictEqual(yield* page.title, "routed")
          }
        }), timeout)

      it.effect("continues a paused request when its last route is removed", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
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
              const page = yield* Browser.newPage()
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
              yield* page.goto(`${origin}/after`)
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
            const page = yield* Browser.newPage()
            const blocked = yield* page.route(`${origin}/analytics/**`, () => Route.abort())
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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

      it.effect("matches a URLPattern route, pausing only the URLs under its fixed prefix", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.route(`${origin}/:name(json)`, () =>
              Route.fulfill(json({ routed: true })))
            const result = yield* run(page, origin, `return fetch('/json').then((r) => r.json())`)
            assert.deepStrictEqual(result, { routed: true })
          }))
        }), timeout)

      it.effect("answers an authentication challenge where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const registered = page.route(`${origin}/auth`, () =>
              Route.provideCredentials({ username: "strider", password: Redacted.make("secret") }), {
              phase: "auth"
            })
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
            const page = yield* Browser.newPage()
            yield* page.route(`${origin}/auth`, () =>
              Route.continue, { phase: "auth" })
            yield* page.goto(`${origin}/auth`)
            yield* page.getByText("who are you?").pipe(Expect.toBeVisible)
          }))
        }), timeout)

      it.effect("gives the page the server's response to a challenge with no auth route, where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const challenges = yield* status("network.challenges")
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
            const error = yield* Effect.flip(
              page.route("https://example.com/:id(", () =>
                Route.continue)
            )
            assert(Route.isRouteError(error) && error.reason._tag === "InvalidInput", String(error))
          }))
        }), timeout)

      // ── Init scripts ──

      for (const timing of [undefined, "beforeAuthorScript"] as const) {
        it.effect(`runs launched context init scripts before author scripts with ${timing ?? "default"} timing`, () =>
          Effect.gen(function*() {
            const { origin } = yield* site
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
              `await new Promise((resolve) => setTimeout(resolve, 500)); return [window.order, window.frames.length, ...window.messages]`,
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
            const page = yield* Browser.newPage()
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

      it.effect("runs a script in the isolated world, apart from the page's, where the backend can", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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
            const page = yield* Browser.newPage()
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

      it.effect("freezes, shifts and resumes time, and says what's wrong", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
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
            const first = yield* Browser.newPage()
            yield* first.context.clock.install({ mode: "controlled", at: "2026-03-03T03:03:03Z" })
            const second = yield* first.context.newPage
            yield* first.context.clock.adjust("1 hour")
            const read = "return new Date().toISOString()"
            assert.strictEqual(yield* run(first, origin, read), "2026-03-03T04:03:03.000Z")
            assert.strictEqual(yield* run(second, origin, read), "2026-03-03T04:03:03.000Z")
          }))
        }), timeout)
    })
  })
