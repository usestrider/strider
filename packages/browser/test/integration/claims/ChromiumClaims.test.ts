/** ROOK-95 acceptance contract: real Chromium, no claims implementation in this commit. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Dialog } from "@usestrider/browser"
import * as CdpBrowser from "@usestrider/browser/cdp/Browser"
import * as Preload from "@usestrider/browser/cdp/Preload"
import * as Runtime from "@usestrider/browser/cdp/Runtime"
import * as Target from "@usestrider/browser/cdp/Target"
import * as Tracing from "@usestrider/browser/cdp/Tracing"
import { Chromium } from "@usestrider/browser/chromium"
import * as api from "@usestrider/browser/experimental"
import { CdpConnection, Protocol } from "@usestrider/browser/protocol"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { handoff } from "../../../src/internal/handoff.ts"
import { assertPinned, chromium } from "../browsers.ts"

const serve = Effect.acquireRelease(
  Effect.promise(async () => {
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html")
      response.end(
        request.url === "/start"
          ? `<script>window.activate = () => { location.href = '/prerendered' };</script>`
          : `<title>${request.url}</title><button onclick="document.title='controlled'">Control</button>`
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve))
    const address = server.address()
    assert(address && typeof address !== "string")
    return { origin: `http://localhost:${address.port}`, crossSite: `http://127.0.0.1:${address.port}`, server }
  }),
  ({ server }) =>
    Effect.promise(() =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
    )
)

const launch = Effect.gen(function*() {
  const { launched, transport } = yield* ChromiumLauncher.launchWithPort({
    executablePath: chromium.executable,
    args: ["--site-per-process"]
  })
  const observer = yield* CdpConnection.make(transport)
  const version = yield* CdpBrowser.getVersion().pipe(Protocol.on(observer.browser))
  assertPinned("Chromium", version.product.split("/")[1]!, chromium.version)
  const [port] = (yield* Effect.promise(() => readFile(`${launched.userDataDir}/DevToolsActivePort`, "utf8"))).split(
    "\n"
  )
  const endpoint = `http://127.0.0.1:${port}`
  const targets = Target.getTargets({ filter: [{ exclude: false }] }).pipe(
    Protocol.on(observer.browser),
    Effect.map((reply) => reply.targetInfos)
  )
  const connect = Chromium.layerConnect(endpoint)
  return { endpoint, observer, targets, connect }
})

const until = Effect.fnUntraced(function*<A, E, R>(read: Effect.Effect<A, E, R>, ready: (value: A) => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = yield* read
    if (ready(value)) return value
    yield* Effect.sleep("50 millis")
  }
  return yield* Effect.die(new Error("browser fact did not arrive within 10 seconds"))
})

const evaluate = (session: Protocol.ProtocolSession, expression: string) =>
  Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true }).pipe(
    Protocol.on(session),
    Effect.map((reply) => {
      assert.isUndefined(reply.exceptionDetails)
      return reply.result.value
    })
  )

const reason = <A, E>(exit: Exit.Exit<A, E>) => {
  assert(Exit.isFailure(exit), "expected reclaim to fail")
  const error = Option.getOrThrow(Exit.findErrorOption(exit)) as { readonly reason: { readonly _tag: string } }
  return error.reason._tag
}

const killedClient = (endpoint: string, url: string, mode = "reclaimable") =>
  Effect.acquireRelease(
    Effect.sync(() =>
      spawn(process.execPath, [fileURLToPath(new URL("./client.ts", import.meta.url)), endpoint, url, mode], {
        stdio: ["ignore", "pipe", "pipe"]
      })
    ),
    (child) =>
      Effect.sync(() => {
        child.kill("SIGKILL")
      })
  ).pipe(Effect.flatMap((child) =>
    Effect.promise(async () => {
      let output = ""
      let stderr = ""
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk)
      })
      const saved = await new Promise<
        { readonly pageClaim: api.Page.Claim; readonly contextClaim: api.UserContext.Claim }
      >(
        (resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`claim client did not become ready: ${stderr}`)), 15_000)
          child.once("exit", (code, signal) => {
            clearTimeout(timer)
            reject(new Error(`claim client exited (${code}, ${signal}): ${stderr}`))
          })
          child.stdout.on("data", (chunk) => {
            output += String(chunk)
            if (!output.includes("\n")) return
            clearTimeout(timer)
            try {
              const saved = JSON.parse(output.split("\n")[0]!) as { pageClaim?: unknown; contextClaim?: unknown }
              resolve(
                mode === "ordinary" ? { pageClaim: undefined!, contextClaim: undefined! } : {
                  pageClaim: Schema.decodeUnknownSync(api.Page.Claim)(saved.pageClaim),
                  contextClaim: Schema.decodeUnknownSync(api.UserContext.Claim)(saved.contextClaim)
                }
              )
            } catch (error) {
              reject(error)
            }
          })
        }
      )
      const exited = new Promise<void>((resolve) =>
        child.once("exit", (_code, signal) => {
          assert.strictEqual(signal, "SIGKILL")
          resolve()
        })
      )
      child.kill("SIGKILL")
      await exited
      return saved
    })
  ))

// The successful reclaim scope must really own the tab, rather than merely control an adopted page.
const assertOwned = Effect.fnUntraced(
  function*(browser: Effect.Success<typeof launch>, claim: api.Page.Claim, url: string) {
    yield* Effect.scoped(
      Effect.gen(function*() {
        const { page } = yield* api.Browser.reclaim(claim)
        assert.strictEqual(yield* page.url, url)
        yield* page.getByText("Control").click()
        assert.strictEqual(yield* page.title, "controlled")
      })
    ).pipe(Effect.provide(browser.connect))
    yield* until(browser.targets, (infos) => !infos.some((info) => info.type === "page" && info.url === url))
  }
)

describe("Chromium claims (ROOK-95)", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect(
        "reclaims a killed client's page, preserves session storage, and owns its cleanup",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch
            const { origin } = yield* serve
            const saved = yield* killedClient(browser.endpoint, `${origin}/killed`)
            yield* Effect.scoped(
              Effect.gen(function*() {
                const { page } = yield* api.Browser.reclaim(saved.pageClaim)
                assert.strictEqual(yield* page.evaluateInMainWorld(() => sessionStorage.getItem("survivor")), "saved")
                yield* page.getByText("Control").click()
              })
            ).pipe(Effect.provide(browser.connect))
            yield* until(browser.targets, (infos) => !infos.some((info) => info.url === `${origin}/killed`))
          }),
        60_000
      )

      it.effect("reclaims the tab after a cross-site navigation", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin, crossSite } = yield* serve
          const old = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
          const services = yield* Layer.buildWithScope(browser.connect, old)
          const claim = yield* Effect.gen(function*() {
            const context = yield* api.UserContext.create({ reclaimable: true })
            const page = yield* context.newPage
            yield* page.goto(`${origin}/before`)
            const claim = yield* api.Page.claim(page)
            const trace: Array<Readonly<Record<string, unknown>>> = []
            const events = yield* browser.observer.browser.subscribe(Tracing.dataCollected)
            yield* Stream.runForEach(events, (event) =>
              Effect.sync(() => {
                trace.push(...event.value)
              })).pipe(Effect.forkChild)
            yield* Tracing.start({ traceConfig: { includedCategories: ["blink.user_timing"] } }).pipe(
              Protocol.on(browser.observer.browser)
            )
            yield* page.evaluateInMainWorld(() => {
              performance.mark("ROOK-95-before")
            })
            yield* page.goto(`${crossSite}/after`)
            yield* page.evaluateInMainWorld(() => {
              performance.mark("ROOK-95-after")
            })
            const complete = yield* browser.observer.browser.subscribe(Tracing.tracingComplete)
            const completed = yield* Stream.runHead(complete).pipe(Effect.forkChild)
            yield* Tracing.end().pipe(Protocol.on(browser.observer.browser))
            yield* Fiber.join(completed)
            const marks = trace.filter((event) => event.name === "ROOK-95-before" || event.name === "ROOK-95-after")
            assert.strictEqual(marks.length, 2)
            assert.notStrictEqual(marks[0]!.pid, marks[1]!.pid, "navigation must swap renderer processes")
            return claim
          }).pipe(Scope.provide(old), Effect.provide(services))
          yield* handoff(old)
          yield* assertOwned(browser, claim, `${crossSite}/after`)
        }), 60_000)

      it.effect("reclaims after proved prerender activation replaces the page target", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin } = yield* serve
          const old = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
          const services = yield* Layer.buildWithScope(browser.connect, old)
          const claim = yield* Effect.gen(function*() {
            const browser = yield* Browser.Browser
            const context = yield* browser.defaultContext.control
            const page = yield* context.newPage
            yield* page.goto(`${origin}/start`)
            return yield* api.Page.claim(page)
          }).pipe(Scope.provide(old), Effect.provide(services))
          yield* handoff(old)
          // The Strider client is now detached: direct page auto-attachment would suppress prerender.
          const before = yield* browser.targets
          const original = before.find((info) => info.type === "page" && info.url === `${origin}/start`)!
          const tab = before.find((info) => info.type === "tab" && info.url === original.url)!
          assert.isDefined(tab)
          const { sessionId } = yield* Target.attachToTarget({ targetId: tab.targetId, flatten: true }).pipe(
            Protocol.on(browser.observer.browser)
          )
          const tabSession = yield* browser.observer.session(sessionId)
          const attached = yield* tabSession.subscribe(Target.attachedToTarget)
          const next = yield* Stream.runHead(attached).pipe(Effect.forkChild)
          yield* Target.setAutoAttach({
            autoAttach: true,
            waitForDebuggerOnStart: false,
            flatten: true,
            filter: [{ exclude: false }]
          }).pipe(Protocol.on(tabSession))
          const event = Option.getOrThrow(yield* Fiber.join(next))
          const session = yield* browser.observer.session(event.sessionId)
          const statuses: Array<Preload.PrerenderStatusUpdatedParams> = []
          const preload = yield* session.subscribe(Preload.prerenderStatusUpdated)
          yield* Stream.runForEach(preload, (status) =>
            Effect.sync(() => {
              statuses.push(status)
            })).pipe(Effect.forkChild)
          yield* Preload.enable().pipe(Protocol.on(session))
          yield* evaluate(
            session,
            `(() => { const s = document.createElement('script'); s.type = 'speculationrules'; s.textContent = JSON.stringify({prerender:[{source:'list',urls:['${origin}/prerendered']}]}); document.head.append(s); })()`
          )
          yield* until(Effect.sync(() => statuses), (values) => values.some((status) => status.status === "Ready"))
          yield* evaluate(session, "window.activate()")
          const after = yield* until(
            browser.targets,
            (infos) =>
              infos.some((info) =>
                info.type === "page" && info.url === `${origin}/prerendered` && info.subtype !== "prerender"
              )
          )
          const activated = after.find((info) =>
            info.type === "page" && info.url === `${origin}/prerendered` && info.subtype !== "prerender"
          )!
          assert.notStrictEqual(
            activated.targetId,
            original.targetId,
            "this case must exercise page-target replacement"
          )
          assert.isTrue(after.some((info) => info.type === "tab" && info.targetId === tab.targetId))
          const active = yield* Target.attachToTarget({ targetId: activated.targetId, flatten: true }).pipe(
            Protocol.on(browser.observer.browser)
          )
          const activeSession = yield* browser.observer.session(active.sessionId)
          yield* until(
            evaluate(activeSession, "performance.getEntriesByType('navigation')[0].activationStart"),
            (value) => typeof value === "number" && value > 0
          )
          assert.strictEqual(yield* evaluate(activeSession, "document.prerendering"), false)
          yield* assertOwned(browser, claim, `${origin}/prerendered`)
        }), 60_000)

      it.effect("returns Gone after the claimed tab closes", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const claim = yield* Effect.scoped(
            Effect.gen(function*() {
              const context = yield* api.UserContext.create({ reclaimable: true })
              const page = yield* context.newPage
              const claim = yield* api.Page.claim(page)
              yield* page.close()
              return claim
            })
          ).pipe(Effect.provide(browser.connect))
          const exit = yield* Effect.scoped(api.Browser.reclaim(claim)).pipe(
            Effect.provide(browser.connect),
            Effect.exit
          )
          assert.strictEqual(reason(exit), "Gone")
        }), 60_000)

      it.effect("returns OtherBrowser for a live claim from another browser", () =>
        Effect.gen(function*() {
          const first = yield* launch
          const second = yield* launch
          const { origin } = yield* serve
          const saved = yield* killedClient(first.endpoint, `${origin}/other-browser`)
          const exit = yield* Effect.scoped(api.Browser.reclaim(saved.pageClaim)).pipe(
            Effect.provide(second.connect),
            Effect.exit
          )
          assert.strictEqual(reason(exit), "OtherBrowser")
          assert.isTrue((yield* first.targets).some((info) => info.url === `${origin}/other-browser`))
        }), 60_000)

      it.effect("keeps ordinary context and page cleanup unchanged", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin } = yield* serve
          yield* Effect.scoped(
            Effect.gen(function*() {
              const context = yield* Browser.newContext()
              const page = yield* context.newPage
              yield* page.goto(`${origin}/ordinary`)
              assert.isTrue((yield* browser.targets).some((info) => info.url === `${origin}/ordinary`))
            })
          ).pipe(Effect.provide(browser.connect))
          yield* until(browser.targets, (infos) => !infos.some((info) => info.url === `${origin}/ordinary`))
        }), 60_000)

      it.effect("ordinary contexts still disappear when their client is killed", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin } = yield* serve
          yield* killedClient(browser.endpoint, `${origin}/ordinary-killed`, "ordinary")
          yield* until(browser.targets, (infos) => !infos.some((info) => info.url === `${origin}/ordinary-killed`))
        }), 60_000)

      it.effect(
        "reclaims a killed client's context, reapplies settings, and owns context cleanup",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch
            const { origin } = yield* serve
            const saved = yield* killedClient(browser.endpoint, `${origin}/context`)
            const before = (yield* browser.targets).find((info) =>
              info.url === `${origin}/context` && info.type === "page"
            )!
            assert.isDefined(before)
            yield* Effect.scoped(
              Effect.gen(function*() {
                const context = yield* api.UserContext.reclaim(saved.contextClaim, { emulation: { locale: "fr-FR" } })
                const { page } = yield* api.Browser.reclaim(saved.pageClaim)
                assert.strictEqual(page.context.id, context.id)
                assert.strictEqual(yield* page.evaluateInMainWorld(() => navigator.language), "fr-FR")
                assert.strictEqual(yield* page.evaluateInMainWorld(() => sessionStorage.getItem("survivor")), "saved")
                const fresh = yield* context.newPage
                yield* fresh.goto(`${origin}/new-context-page`)
                assert.strictEqual(yield* fresh.evaluateInMainWorld(() => navigator.language), "fr-FR")
              })
            ).pipe(Effect.provide(browser.connect))
            yield* until(
              browser.targets,
              (infos) => !infos.some((info) => info.browserContextId === before.browserContextId)
            )
            const contexts = yield* Target.getBrowserContexts().pipe(Protocol.on(browser.observer.browser))
            assert.notInclude(contexts.browserContextIds, before.browserContextId)
          }),
        60_000
      )

      it.effect("reports a dialog opened after internal handoff", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin } = yield* serve
          const old = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
          const services = yield* Layer.buildWithScope(browser.connect, old)
          const claim = yield* Effect.gen(function*() {
            const context = yield* api.UserContext.create({ reclaimable: true })
            const page = yield* context.newPage
            yield* page.goto(`${origin}/dialog`)
            return yield* api.Page.claim(page)
          }).pipe(Scope.provide(old), Effect.provide(services))
          yield* handoff(old)
          const target = (yield* browser.targets).find((info) =>
            info.type === "page" && info.url === `${origin}/dialog`
          )!
          const { sessionId } = yield* Target.attachToTarget({ targetId: target.targetId, flatten: true }).pipe(
            Protocol.on(browser.observer.browser)
          )
          const session = yield* browser.observer.session(sessionId)
          // Subscribe before opening the dialog; the command deliberately doesn't wait for alert to return.
          const CdpPage = yield* Effect.promise(() => import("@usestrider/browser/cdp/Page"))
          yield* CdpPage.enable().pipe(Protocol.on(session))
          const dialogs = yield* session.subscribe(CdpPage.javascriptDialogOpening)
          const opened = yield* Stream.runHead(dialogs).pipe(Effect.forkChild)
          yield* Runtime.evaluate({ expression: "setTimeout(() => alert('left open'), 0); undefined" }).pipe(
            Protocol.on(session)
          )
          assert.strictEqual(Option.getOrThrow(yield* Fiber.join(opened)).message, "left open")
          yield* Effect.scoped(
            Effect.gen(function*() {
              const { found } = yield* api.Browser.reclaim(claim)
              assert.deepStrictEqual(found.dialogs.map((dialog) => dialog.message), ["left open"])
              yield* CdpPage.handleJavaScriptDialog({ accept: false }).pipe(Protocol.on(session))
            })
          ).pipe(Effect.provide(browser.connect))
        }), 60_000)
      it.effect("refuses claims for discovered control handles and the default context", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin } = yield* serve
          yield* Target.createTarget({ url: `${origin}/discovered` }).pipe(Protocol.on(browser.observer.browser))
          yield* Effect.scoped(Effect.gen(function*() {
            const connected = yield* Browser.Browser
            const pages = yield* connected.pages.waitFor((pages) => pages.length > 1)
            const observed = pages.find((page) => page.id !== undefined)!
            const controlled = yield* observed.control
            assert.strictEqual(reason(yield* api.Page.claim(controlled).pipe(Effect.exit)), "NotPermitted")
            const context = yield* connected.defaultContext.control
            assert.strictEqual(reason(yield* api.UserContext.claim(context).pipe(Effect.exit)), "NotPermitted")
          })).pipe(Effect.provide(browser.connect))
          assert.isTrue((yield* browser.targets).some((info) => info.url === `${origin}/discovered`))
        }), 60_000)

      it.effect(
        "returns Gone and OtherBrowser for context claims and rejects malformed claims",
        () =>
          Effect.gen(function*() {
            const first = yield* launch
            const second = yield* launch
            const claim = yield* Effect.scoped(Effect.gen(function*() {
              const context = yield* api.UserContext.create({ reclaimable: true })
              return yield* api.UserContext.claim(context)
            })).pipe(Effect.provide(first.connect))
            assert.strictEqual(
              reason(
                yield* Effect.scoped(api.UserContext.reclaim(claim)).pipe(Effect.provide(first.connect), Effect.exit)
              ),
              "Gone"
            )
            assert.strictEqual(
              reason(
                yield* Effect.scoped(api.UserContext.reclaim(claim)).pipe(Effect.provide(second.connect), Effect.exit)
              ),
              "OtherBrowser"
            )
            const malformed = Schema.decodeUnknownSync(api.UserContext.Claim)("not-json")
            assert.strictEqual(
              reason(
                yield* Effect.scoped(api.UserContext.reclaim(malformed)).pipe(
                  Effect.provide(first.connect),
                  Effect.exit
                )
              ),
              "InvalidInput"
            )
          }),
        60_000
      )

      it.effect(
        "handoff settles a paused request and removes old routes and init scripts",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch
            const { origin } = yield* serve
            const old = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
            const services = yield* Layer.buildWithScope(browser.connect, old)
            const entered = yield* Deferred.make<void>()
            const claim = yield* Effect.gen(function*() {
              const context = yield* api.UserContext.create({ reclaimable: true })
              const page = yield* context.newPage
              yield* page.goto(`${origin}/cleanup`)
              yield* page.route(
                "**/held",
                () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
              )
              yield* page.addInitScript({ source: "window.oldRegistration = true" })
              yield* page.evaluateInMainWorld(() => {
                void fetch("/held").then(() => {
                  document.title = "settled"
                })
              })
              yield* Deferred.await(entered)
              return yield* api.Page.claim(page)
            }).pipe(Scope.provide(old), Effect.provide(services))
            yield* handoff(old)
            yield* Effect.scoped(Effect.gen(function*() {
              const { page } = yield* api.Browser.reclaim(claim)
              yield* until(page.title, (title) => title === "settled")
              yield* page.goto(`${origin}/after-cleanup`)
              assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.has(window, "oldRegistration")), false)
              assert.strictEqual(yield* page.evaluateInMainWorld(async () => (await fetch("/held")).status), 200)
            })).pipe(Effect.provide(browser.connect))
          }),
        60_000
      )

      it.effect("reports a dialog proved open before handoff", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin } = yield* serve
          const old = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
          const services = yield* Layer.buildWithScope(browser.connect, old)
          const claim = yield* Effect.gen(function*() {
            const connected = yield* Browser.Browser
            const context = yield* connected.defaultContext.control
            const page = yield* context.newPage
            yield* page.goto(`${origin}/before-handoff-dialog`)
            const claim = yield* api.Page.claim(page)
            const opened = yield* Dialog.next(page)
            yield* page.evaluateInMainWorld(() => {
              setTimeout(() => alert("before handoff"), 0)
            })
            yield* opened
            return claim
          }).pipe(Scope.provide(old), Effect.provide(services))
          yield* handoff(old)
          yield* Effect.scoped(Effect.gen(function*() {
            const { page, found } = yield* api.Browser.reclaim(claim)
            assert.deepStrictEqual(found.dialogs.map((dialog) => dialog.message), ["before handoff"])
            const target = (yield* browser.targets).find((info) =>
              info.type === "page" && info.url === `${origin}/before-handoff-dialog`
            )!
            const { sessionId } = yield* Target.attachToTarget({ targetId: target.targetId, flatten: true }).pipe(
              Protocol.on(browser.observer.browser)
            )
            const session = yield* browser.observer.session(sessionId)
            const CdpPage = yield* Effect.promise(() => import("@usestrider/browser/cdp/Page"))
            yield* CdpPage.handleJavaScriptDialog({ accept: false }).pipe(Protocol.on(session))
            void page
          })).pipe(Effect.provide(browser.connect))
        }), 60_000)

      it.effect(
        "a failed context reclaim leaves the surviving context and its tabs open",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch
            const { origin } = yield* serve
            const old = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
            const services = yield* Layer.buildWithScope(browser.connect, old)
            const url = `${origin}/survivor`
            const claim = yield* Effect.gen(function*() {
              const context = yield* api.UserContext.create({ reclaimable: true })
              const page = yield* context.newPage
              yield* page.goto(url)
              return yield* api.UserContext.claim(context)
            }).pipe(Scope.provide(old), Effect.provide(services))
            yield* handoff(old)
            const exit = yield* Effect.scoped(
              api.UserContext.reclaim(claim, { emulation: { locale: "not a locale" } })
            ).pipe(Effect.provide(browser.connect), Effect.exit)
            assert.isTrue(Exit.isFailure(exit), "expected the settings to be refused")
            assert.isTrue(
              (yield* browser.targets).some((info) => info.url === url),
              "the claimed context's tab was destroyed"
            )
          }),
        60_000
      )

      it.effect(
        "refuses claims on an ordinary context and its pages, which cannot survive",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch
            yield* Effect.scoped(Effect.gen(function*() {
              const context = yield* Browser.newContext()
              const page = yield* context.newPage
              assert.isTrue(
                Exit.isFailure(yield* api.UserContext.claim(context).pipe(Effect.exit)),
                "context claim issued"
              )
              assert.isTrue(Exit.isFailure(yield* api.Page.claim(page).pipe(Effect.exit)), "page claim issued")
            })).pipe(Effect.provide(browser.connect))
          }),
        60_000
      )

      it.effect("rejects a context claim passed as a page claim", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          yield* Effect.scoped(Effect.gen(function*() {
            const context = yield* api.UserContext.create({ reclaimable: true })
            const encoded = Schema.encodeSync(api.UserContext.Claim)(yield* api.UserContext.claim(context))
            const wrong = Schema.decodeUnknownSync(api.Page.Claim)(encoded)
            const exit = yield* Effect.scoped(api.Browser.reclaim(wrong)).pipe(Effect.exit)
            assert.strictEqual(reason(exit), "InvalidInput")
          })).pipe(Effect.provide(browser.connect))
        }), 60_000)
    }
  )
})
