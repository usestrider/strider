/**
 * Identities observed by a second browser client. Prerender uses tab-level auto-attach;
 * the other transitions use direct page attachment. Other attachment setups are tested separately.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Browser from "@usestrider/browser/cdp/Browser"
import * as Inspector from "@usestrider/browser/cdp/Inspector"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Preload from "@usestrider/browser/cdp/Preload"
import * as Runtime from "@usestrider/browser/cdp/Runtime"
import * as Target from "@usestrider/browser/cdp/Target"
import * as Tracing from "@usestrider/browser/cdp/Tracing"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Socket from "effect/socket/Socket"
import * as Stream from "effect/Stream"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { assertPinned, chromium } from "../browsers.ts"
import { diagnostic } from "../diagnostic.ts"

const serve = Effect.acquireRelease(
  Effect.promise(async () => {
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html")
      if (request.url === "/coop") response.setHeader("Cross-Origin-Opener-Policy", "same-origin")
      response.end(`<title>${request.url}</title><script>
        window.token = crypto.randomUUID(); window.restored = false;
        addEventListener('pageshow', e => window.restored = e.persisted);
      </script>`)
    })
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve))
    const address = server.address()
    assert(address && typeof address !== "string")
    return { server, origin: `http://localhost:${address.port}`, crossSite: `http://127.0.0.1:${address.port}` }
  }),
  ({ server }) =>
    Effect.promise(() =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
    )
)

const evaluate = (session: Protocol.ProtocolSession, expression: string) =>
  Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true, userGesture: true }).pipe(
    Protocol.on(session),
    Effect.map((reply) => {
      assert.isUndefined(reply.exceptionDetails, JSON.stringify(reply.exceptionDetails))
      return reply.result.value
    })
  )

// Poll a browser fact, with an explicit bound; no fixed delay is taken as proof of a transition.
const until = Effect.fnUntraced(
  function*<A>(read: Effect.Effect<A, Protocol.ProtocolError>, ready: (value: A) => boolean) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const value = yield* read
      if (ready(value)) return value
      yield* Effect.sleep("50 millis")
    }
    assert.fail("browser fact did not arrive within 10 seconds")
  }
)

const cases = ["cross-site", "COOP", "prerender", "BFCache", "crash"] as const

describe("Chromium reconnect identity probes", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      for (const transition of cases) {
        const attachment = transition === "prerender" ? "tab-level auto-attach" : "direct page attachment"
        it.effect(`${transition} (${attachment})`, () =>
          Effect.gen(function*() {
            const diagnosticTrace = yield* diagnostic(`ChromiumIdentity ${transition}`)
            const { origin, crossSite } = yield* serve
            const { launched, transport } = yield* ChromiumLauncher.launchWithPort({
              executablePath: chromium.executable,
              args: ["--site-per-process"]
            }).pipe(Effect.provideService(Socket.WebSocketConstructor, diagnosticTrace.socketConstructor("driver")))
            diagnosticTrace.note("launcher", { args: launched.args, pid: Number(launched.handle.pid) })
            yield* Effect.addFinalizer(() =>
              Effect.gen(function*() {
                diagnosticTrace.note("launcher stderr before cleanup", yield* launched.stderrTail)
              })
            )
            const driver = yield* CdpConnection.make(diagnosticTrace.transport("driver", transport))
            const version = yield* Browser.getVersion().pipe(Protocol.on(driver.browser))
            assertPinned("Chromium", version.product.split("/")[1]!, chromium.version)
            const [port] = (yield* Effect.promise(() => readFile(`${launched.userDataDir}/DevToolsActivePort`, "utf8")))
              .split("\n")
            const endpoint = () =>
              Effect.promise(async () => {
                const response = await fetch(`http://127.0.0.1:${port}/json/version`)
                const json = await response.json() as { webSocketDebuggerUrl: string }
                return json.webSocketDebuggerUrl
              })
            const browserUrl = yield* endpoint()
            const observer = yield* CdpConnection.make(
              diagnosticTrace.transport(
                "observer",
                yield* Transport.webSocket(browserUrl).pipe(
                  Effect.provideService(Socket.WebSocketConstructor, diagnosticTrace.socketConstructor("observer"))
                )
              )
            )
            const targets = Target.getTargets({ filter: [{ exclude: false }] }).pipe(
              Protocol.on(observer.browser),
              Effect.map((reply) => reply.targetInfos)
            )
            const attach = Effect.fnUntraced(function*(targetId: Target.TargetID) {
              const { sessionId } = yield* Target.attachToTarget({ targetId, flatten: true }).pipe(
                Protocol.on(driver.browser)
              )
              return yield* driver.session(sessionId)
            })
            const { targetId } = yield* Target.createTarget({ url: `${origin}/start` }).pipe(
              Protocol.on(driver.browser)
            )
            let session: Protocol.ProtocolSession
            if (transition === "prerender") {
              // A direct page-target attachment disables prerender in Chromium. A tab client
              // opts into following its page replacements through auto-attach instead.
              const listed = yield* until(
                targets,
                (infos) => infos.some((info) => info.type === "tab" && info.url === `${origin}/start`)
              )
              const tab = yield* attach(
                listed.find((info) => info.type === "tab" && info.url === `${origin}/start`)!.targetId
              )
              const attached = yield* tab.subscribe(Target.attachedToTarget)
              const next = yield* Stream.runHead(attached).pipe(Effect.forkChild)
              yield* Target.setAutoAttach({
                autoAttach: true,
                waitForDebuggerOnStart: false,
                flatten: true,
                filter: [{ exclude: false }]
              }).pipe(Protocol.on(tab))
              const event = yield* Fiber.join(next)
              assert(event._tag === "Some")
              session = yield* driver.session(event.value.sessionId)
            } else {
              session = yield* attach(targetId)
            }
            yield* until(
              evaluate(session, "location.href + ' ' + document.readyState"),
              (value) => value === `${origin}/start complete`
            )
            const navigate = Effect.fnUntraced(function*(url: string) {
              yield* Page.navigate({ url }).pipe(Protocol.on(session))
              yield* until(
                evaluate(session, "location.href + ' ' + document.readyState"),
                (value) => value === `${url} complete`
              )
            })
            let opener: Protocol.ProtocolSession | undefined
            if (transition === "COOP") {
              opener = session
              yield* evaluate(opener, `void (window.child = window.open('${origin}/child'))`)
              const found = yield* until(
                targets,
                (infos) => infos.some((info) => info.type === "page" && info.url === `${origin}/child`)
              )
              session = yield* attach(
                found.find((info) => info.type === "page" && info.url === `${origin}/child`)!.targetId
              )
              assert.isTrue(yield* evaluate(session, "opener !== null"))
              assert.isFalse(yield* evaluate(opener, "child.closed"))
            }
            const initial = yield* targets
            const subject = initial.find((info) =>
              info.type === "page" && info.url === `${origin}/${transition === "COOP" ? "child" : "start"}`
            )!
            assert.isDefined(subject)
            const subjectTab = initial.find((info) => info.type === "tab" && info.url === subject.url)!
            assert.isDefined(subjectTab)
            assert.isString(subject.browserContextId)
            assert.isNotEmpty(subject.browserContextId)
            assert.isString(subjectTab.browserContextId)
            assert.isNotEmpty(subjectTab.browserContextId)
            assert.strictEqual(subjectTab.browserContextId, subject.browserContextId)
            const beforeUrl = yield* endpoint()
            const trace: Array<Readonly<Record<string, unknown>>> = []
            const traceEvents = yield* driver.browser.subscribe(Tracing.dataCollected)
            yield* Stream.runForEach(traceEvents, (event) =>
              Effect.sync(() => {
                trace.push(...event.value)
              })).pipe(Effect.forkChild)
            if (transition === "cross-site") {
              yield* Tracing.start({
                traceConfig: {
                  includedCategories: [
                    "blink.user_timing"
                  ]
                }
              }).pipe(Protocol.on(driver.browser))
            }
            if (transition === "cross-site") yield* evaluate(session, "performance.mark('identity-before'); undefined")
            let evidence: unknown
            if (transition === "cross-site") {
              yield* navigate(`${crossSite}/cross-site`)
              evidence = yield* evaluate(session, "location.href")
            } else if (transition === "COOP") {
              yield* navigate(`${origin}/coop`)
              assert.isTrue(yield* evaluate(session, "opener === null"))
              assert.isTrue(yield* evaluate(opener!, "child.closed"))
              evidence = { openerNull: true, oldWindowProxyClosed: true }
            } else if (transition === "prerender") {
              const prerenderStatuses: Array<Preload.PrerenderStatusUpdatedParams> = []
              const statuses = yield* session.subscribe(Preload.prerenderStatusUpdated)
              yield* Stream.runForEach(
                statuses,
                (status) =>
                  Effect.sync(() => {
                    prerenderStatuses.push(status)
                    console.log("identity preload", JSON.stringify(status))
                  })
              ).pipe(Effect.forkChild)
              yield* Preload.enable().pipe(Protocol.on(session))
              yield* evaluate(
                session,
                `(() => { const s = document.createElement('script'); s.type = 'speculationrules'; s.textContent = JSON.stringify({prerender:[{source:'list',urls:['${origin}/prerendered']}]}); document.head.append(s); })()`
              )
              yield* until(
                Effect.sync(() => prerenderStatuses),
                (statuses) => statuses.some((status) => status.status === "Ready")
              )
              const pending = yield* targets
              console.log("identity prerender pending", JSON.stringify(pending))
              // Do not attach to the prerender: that can change its eligibility for activation.
              yield* evaluate(session, `location.href = '${origin}/prerendered'`)
              const activated = yield* until(
                targets,
                (infos) =>
                  infos.some((info) =>
                    info.type === "page" && info.url === `${origin}/prerendered` && info.subtype !== "prerender"
                  )
              )
              session = yield* attach(
                activated.find((info) =>
                  info.type === "page" && info.url === `${origin}/prerendered` && info.subtype !== "prerender"
                )!.targetId
              )
              const activationStart = yield* until(
                evaluate(session, "performance.getEntriesByType('navigation')[0].activationStart"),
                (value) => typeof value === "number" && value > 0
              )
              evidence = { activationStart, prerendering: yield* evaluate(session, "document.prerendering") }
              assert.isFalse(yield* evaluate(session, "document.prerendering"))
            } else if (transition === "BFCache") {
              const token = yield* evaluate(session, "window.token")
              yield* navigate(`${origin}/away`)
              yield* evaluate(session, "history.back()")
              yield* until(evaluate(session, "window.restored"), (value) => value === true)
              assert.strictEqual(yield* evaluate(session, "window.token"), token)
              evidence = { persisted: true, token }
            } else {
              const oldToken = yield* evaluate(session, "window.token")
              assert.isString(oldToken, "pre-crash document must have a token")
              assert.isNotEmpty(oldToken)
              const crashes = yield* session.subscribe(Inspector.targetCrashed)
              const crashed = yield* Stream.runHead(crashes).pipe(Effect.forkChild)
              yield* Page.crash().pipe(
                Protocol.on(session),
                Effect.onExit((exit) => Effect.sync(() => diagnosticTrace.note("Page.crash outcome", exit))),
                Effect.forkChild
              )
              yield* Fiber.join(crashed)
              const during = yield* targets
              console.log("identity crashed", JSON.stringify(during))
              const crashedPage = during.find((info) => info.type === "page" && info.targetId === subject.targetId)
              const crashedTab = during.find((info) => info.type === "tab" && info.targetId === subjectTab.targetId)
              assert.isDefined(crashedPage)
              assert.isDefined(crashedTab)
              assert.strictEqual(crashedPage.url, subject.url)
              assert.strictEqual(crashedTab.url, subject.url)
              assert.strictEqual(crashedPage.browserContextId, subject.browserContextId)
              assert.strictEqual(crashedTab.browserContextId, subject.browserContextId)
              session = yield* attach(subject.targetId)
              yield* Page.reload().pipe(Protocol.on(session))
              yield* until(evaluate(session, "document.readyState"), (value) => value === "complete")
              const newToken = yield* evaluate(session, "window.token")
              assert.isString(newToken, "reloaded document must have a token")
              assert.isNotEmpty(newToken)
              assert.notStrictEqual(newToken, oldToken)
              const reloaded = yield* evaluate(session, "location.href")
              assert.strictEqual(reloaded, `${origin}/start`)
              evidence = { targetCrashed: true, reloaded, oldToken, newToken }
            }
            if (transition === "cross-site") yield* evaluate(session, "performance.mark('identity-after'); undefined")
            if (transition === "cross-site") {
              const complete = yield* driver.browser.subscribe(Tracing.tracingComplete)
              const completed = yield* Stream.runHead(complete).pipe(Effect.forkChild)
              yield* Tracing.end().pipe(Protocol.on(driver.browser))
              yield* Fiber.join(completed)
            }
            const after = yield* targets
            const afterUrl = yield* endpoint()
            assert.strictEqual(browserUrl, beforeUrl)
            assert.strictEqual(beforeUrl, afterUrl)
            const commits = trace.filter((event) => event.name === "identity-before" || event.name === "identity-after")
            if (transition === "cross-site") {
              assert.strictEqual(commits.length, 2)
              assert.notStrictEqual(commits[0]!.pid, commits[1]!.pid, "navigation must swap renderer processes")
            }
            const originalPageFound = after.some((info) => info.targetId === subject.targetId)
            assert.strictEqual(originalPageFound, transition !== "prerender")
            const currentUrl = yield* evaluate(session, "location.href")
            const expectedUrl = transition === "cross-site" ?
              `${crossSite}/cross-site`
              : transition === "COOP" ?
              `${origin}/coop`
              : transition === "prerender" ?
              `${origin}/prerendered`
              : `${origin}/start`
            assert.strictEqual(currentUrl, expectedUrl)
            const currentPage = after.find((info) => info.type === "page" && info.url === currentUrl)!
            const currentTab = after.find((info) => info.type === "tab" && info.url === currentUrl)!
            assert.isDefined(currentPage)
            assert.isDefined(currentTab)
            if (transition === "prerender") {
              // This replacement is specific to the tab-level auto-attach setup above.
              assert.notStrictEqual(currentPage.targetId, subject.targetId)
            } else {
              assert.strictEqual(currentPage.targetId, subject.targetId)
            }
            assert.strictEqual(currentTab.targetId, subjectTab.targetId)
            assert.isString(currentPage.browserContextId)
            assert.isNotEmpty(currentPage.browserContextId)
            assert.isString(currentTab.browserContextId)
            assert.isNotEmpty(currentTab.browserContextId)
            assert.strictEqual(currentPage.browserContextId, subject.browserContextId)
            assert.strictEqual(currentTab.browserContextId, subjectTab.browserContextId)
            console.log(
              "identity",
              JSON.stringify({
                transition,
                before: initial,
                after,
                beforeUrl,
                afterUrl,
                evidence,
                commits,
                originalPageFound
              })
            )
          }), 60_000)
      }
    }
  )
})
