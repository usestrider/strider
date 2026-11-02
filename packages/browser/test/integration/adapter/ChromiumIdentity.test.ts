/** ROOK-93: the browser identities reconnect claims depend on, observed by another CDP client. */
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
import * as Stream from "effect/Stream"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { assertPinned, chromium } from "../browsers.ts"

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

describe("Chromium reconnect identity probes (ROOK-93)", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      for (const transition of cases) {
        it.effect(transition, () =>
          Effect.gen(function*() {
            const { origin, crossSite } = yield* serve
            const { launched, transport } = yield* ChromiumLauncher.launchWithPort({
              executablePath: chromium.executable,
              args: ["--site-per-process"]
            })
            const driver = yield* CdpConnection.make(transport)
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
            const observer = yield* CdpConnection.make(yield* Transport.webSocket(browserUrl))
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
              const listed = yield* until(targets, (infos) =>
                infos.some((info) => info.type === "tab" && info.url === `${origin}/start`))
              const tab = yield* attach(
                listed.find((info) =>
                  info.type === "tab" && info.url === `${origin}/start`
                )!.targetId
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
            yield* until(evaluate(session, "location.href + ' ' + document.readyState"), (value) =>
              value === `${origin}/start complete`)
            const navigate = Effect.fnUntraced(function*(url: string) {
              yield* Page.navigate({ url }).pipe(Protocol.on(session))
              yield* until(
                evaluate(session, "location.href + ' ' + document.readyState"),
                (value) =>
                  value === `${url} complete`
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
            if (transition === "cross-site") yield* evaluate(session, "performance.mark('ROOK-93-before'); undefined")
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
                    console.log("ROOK-93 preload", JSON.stringify(status))
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
              console.log("ROOK-93 prerender pending", JSON.stringify(pending))
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
              const crashes = yield* session.subscribe(Inspector.targetCrashed)
              const crashed = yield* Stream.runHead(crashes).pipe(Effect.forkChild)
              yield* Page.crash().pipe(Protocol.on(session), Effect.ignore, Effect.forkChild)
              yield* Fiber.join(crashed)
              const during = yield* targets
              console.log("ROOK-93 crashed", JSON.stringify(during))
              session = yield* attach(subject.targetId)
              yield* Page.reload().pipe(Protocol.on(session))
              yield* until(evaluate(session, "document.readyState"), (value) => value === "complete")
              assert.notStrictEqual(yield* evaluate(session, "window.token"), oldToken)
              evidence = { targetCrashed: true, reloaded: yield* evaluate(session, "location.href") }
            }
            if (transition === "cross-site") yield* evaluate(session, "performance.mark('ROOK-93-after'); undefined")
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
            const commits = trace.filter((event) => event.name === "ROOK-93-before" || event.name === "ROOK-93-after")
            if (transition === "cross-site") {
              assert.strictEqual(commits.length, 2)
              assert.notStrictEqual(commits[0]!.pid, commits[1]!.pid, "navigation must swap renderer processes")
            }
            const originalPageFound = after.some((info) => info.targetId === subject.targetId)
            assert.strictEqual(originalPageFound, transition !== "prerender")
            const currentUrl = yield* evaluate(session, "location.href")
            const currentPage = after.find((info) => info.type === "page" && info.url === currentUrl)!
            const currentTab = after.find((info) => info.type === "tab" && info.url === currentUrl)!
            assert.isDefined(currentPage)
            assert.isDefined(currentTab)
            assert.strictEqual(currentTab.targetId, subjectTab.targetId)
            assert.strictEqual(currentPage.browserContextId, subject.browserContextId)
            assert.strictEqual(currentTab.browserContextId, subjectTab.browserContextId)
            console.log(
              "ROOK-93",
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
