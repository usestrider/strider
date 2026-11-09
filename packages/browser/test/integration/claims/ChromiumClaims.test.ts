/** Claims acceptance tests against the pinned Chromium browser. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import {
  Browser,
  CookieJar,
  Deadline,
  Dialog,
  Download,
  FileChooser,
  PageNavigation,
  StorageState
} from "@usestrider/browser"
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
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { spawn } from "node:child_process"
import { createServer, type ServerResponse } from "node:http"
import { fileURLToPath } from "node:url"
import * as Kit from "../../../src/internal/adapterKit.ts"
import * as BrowserClock from "../../../src/internal/browserClock.ts"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import * as ClaimHooks from "../../../src/internal/claimHooks.ts"
import * as DevToolsActivePort from "../../../src/internal/devToolsActivePort.ts"
import { handoff } from "../../../src/internal/handoff.ts"
import * as Operation from "../../../src/internal/operation.ts"
import { assertPinned, chromium } from "../browsers.ts"

const serveWithDiscoveredGate = (gate?: Deferred.Deferred<ServerResponse>) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const server = createServer((request, response) => {
        if (gate && request.url === "/discovered") {
          Effect.runSync(Deferred.succeed(gate, response))
          return
        }
        if (request.url === "/claims-download") {
          response.setHeader("Content-Type", "application/octet-stream")
          response.setHeader("Content-Disposition", "attachment; filename=\"claims.txt\"")
          response.end("claims bytes")
          return
        }
        if (request.url === "/defaults") {
          response.setHeader("Content-Type", "text/html")
          response.end(
            `<title>defaults</title><input type="file" id="file"><button onclick="document.querySelector('#file').click()">Upload</button><a href="/claims-download" download>Export</a>`
          )
          return
        }
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

const serve = serveWithDiscoveredGate()

const launch = Effect.gen(function*() {
  const { launched, transport } = yield* ChromiumLauncher.launchWithPort({
    executablePath: chromium.executable,
    args: ["--site-per-process"]
  })
  const observer = yield* CdpConnection.make(transport)
  const version = yield* CdpBrowser.getVersion().pipe(Protocol.on(observer.browser))
  assertPinned("Chromium", version.product.split("/")[1]!, chromium.version)
  const { port } = yield* DevToolsActivePort.read(launched.userDataDir)
  const endpoint = `http://127.0.0.1:${port}`
  const targets = Target.getTargets({ filter: [{ exclude: false }] }).pipe(
    Protocol.on(observer.browser),
    Effect.map((reply) => reply.targetInfos)
  )
  const connect = Chromium.layerConnect(endpoint)
  return { endpoint, observer, targets, connect }
})

// Preserve target identity and lifetime while modeling the observer's lagging metadata.
const staleTargetMetadata = (browser: Effect.Success<typeof launch>) => ({
  ...browser,
  targets: browser.targets.pipe(
    Effect.map((infos) => infos.map((info) => ({ ...info, url: "", title: "about:blank" })))
  )
})

const until = Effect.fnUntraced(function*<A, E, R>(read: Effect.Effect<A, E, R>, ready: (value: A) => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = yield* read
    if (ready(value)) return value
    yield* Effect.sleep("50 millis")
  }
  return yield* Effect.die(new Error("browser fact did not arrive within 10 seconds"))
})

const newTarget = Effect.fnUntraced(
  function*(browser: Effect.Success<typeof launch>, before: ReadonlySet<string>, type = "page") {
    const created = (yield* browser.targets).filter((info) => info.type === type && !before.has(info.targetId))
    assert.lengthOf(created, 1, `exactly one new ${type} target`)
    return created[0]!
  }
)

const targetBaseline = (browser: Effect.Success<typeof launch>) =>
  browser.targets.pipe(Effect.map((infos) => new Set(infos.map((info) => info.targetId))))

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

const killedClient = Effect.fnUntraced(
  function*(browser: Effect.Success<typeof launch>, url: string, mode = "reclaimable") {
    const before = yield* targetBaseline(browser)
    const child = yield* Effect.acquireRelease(
      Effect.sync(() =>
        spawn(process.execPath, [fileURLToPath(new URL("./client.ts", import.meta.url)), browser.endpoint, url, mode], {
          stdio: ["ignore", "pipe", "pipe"]
        })
      ),
      (child) =>
        Effect.sync(() => {
          child.kill("SIGKILL")
        })
    )
    const saved = yield* Effect.promise(async () => {
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
      return saved
    })
    const target = yield* newTarget(browser, before)
    const tab = yield* newTarget(browser, before, "tab")
    assert.isDefined(target.browserContextId)
    const contexts = yield* Target.getBrowserContexts().pipe(Protocol.on(browser.observer.browser))
    assert.include(contexts.browserContextIds, target.browserContextId)
    yield* Effect.promise(() =>
      new Promise<void>((resolve) => {
        child.once("exit", (_code, signal) => {
          assert.strictEqual(signal, "SIGKILL")
          resolve()
        })
        child.kill("SIGKILL")
      })
    )
    return { ...saved, target, tab }
  }
)

// The successful reclaim scope must really own the tab, rather than merely control an adopted page.
const assertOwned = Effect.fnUntraced(
  function*(
    browser: Effect.Success<typeof launch>,
    claim: api.Page.Claim,
    url: string,
    target: Target.TargetInfo,
    tab: Target.TargetInfo
  ) {
    assert.isTrue((yield* browser.targets).some((info) => info.targetId === target.targetId))
    yield* Effect.scoped(
      Effect.gen(function*() {
        const { page, found } = yield* api.Browser.reclaim(claim)
        assert.deepStrictEqual(Schema.decodeUnknownSync(api.Browser.Found)(found), {
          _tag: "Observed",
          dialogs: []
        })
        assert.strictEqual(yield* page.url, url)
        yield* page.getByText("Control").click()
        assert.strictEqual(yield* page.title, "controlled")
        assert.isTrue((yield* browser.targets).some((info) => info.targetId === target.targetId))
      })
    ).pipe(Effect.provide(browser.connect))
    yield* until(
      browser.targets,
      (infos) => !infos.some((info) => info.targetId === target.targetId || info.targetId === tab.targetId)
    )
  }
)

describe("Chromium claims", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect(
        "reclaims a killed client's page, preserves session storage, and owns its cleanup",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
            const { origin } = yield* serve
            const saved = yield* killedClient(browser, `${origin}/killed`)
            yield* Effect.scoped(
              Effect.gen(function*() {
                const { page } = yield* api.Browser.reclaim(saved.pageClaim)
                assert.strictEqual(yield* page.evaluateInMainWorld(() => sessionStorage.getItem("survivor")), "saved")
                yield* page.getByText("Control").click()
                assert.isTrue((yield* browser.targets).some((info) => info.targetId === saved.target.targetId))
              })
            ).pipe(Effect.provide(browser.connect))
            yield* until(browser.targets, (infos) =>
              !infos.some((info) =>
                info.targetId === saved.target.targetId || info.targetId === saved.tab.targetId
              ))
          }),
        60_000
      )

      it.effect("reclaims the tab after a cross-site navigation", () =>
        Effect.gen(function*() {
          const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
          const { origin, crossSite } = yield* serve
          const baseline = yield* targetBaseline(browser)
          const old = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
          const services = yield* Layer.buildWithScope(browser.connect, old)
          const { claim, target, tab } = yield* Effect.gen(function*() {
            const context = yield* api.UserContext.create({ reclaimable: true })
            const page = yield* context.newPage
            const target = yield* newTarget(browser, baseline)
            const tab = yield* newTarget(browser, baseline, "tab")
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
              performance.mark("claims-before")
            })
            yield* page.goto(`${crossSite}/after`)
            yield* page.evaluateInMainWorld(() => {
              performance.mark("claims-after")
            })
            const complete = yield* browser.observer.browser.subscribe(Tracing.tracingComplete)
            const completed = yield* Stream.runHead(complete).pipe(Effect.forkChild)
            yield* Tracing.end().pipe(Protocol.on(browser.observer.browser))
            yield* Fiber.join(completed)
            const marks = trace.filter((event) => event.name === "claims-before" || event.name === "claims-after")
            assert.strictEqual(marks.length, 2)
            assert.notStrictEqual(marks[0]!.pid, marks[1]!.pid, "navigation must swap renderer processes")
            return { claim, target, tab }
          }).pipe(Scope.provide(old), Effect.provide(services))
          yield* handoff(old)
          yield* assertOwned(browser, claim, `${crossSite}/after`, target, tab)
        }), 60_000)

      it.effect("reclaims after proved prerender activation replaces the page target", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin } = yield* serve
          const baseline = yield* targetBaseline(browser)
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
          const original = yield* newTarget(staleTargetMetadata(browser), baseline)
          const tab = yield* newTarget(browser, baseline, "tab")
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
          yield* assertOwned(staleTargetMetadata(browser), claim, `${origin}/prerendered`, activated, tab)
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
          const first = yield* launch.pipe(Effect.map(staleTargetMetadata))
          const second = yield* launch
          const { origin } = yield* serve
          const saved = yield* killedClient(first, `${origin}/other-browser`)
          const exit = yield* Effect.scoped(api.Browser.reclaim(saved.pageClaim)).pipe(
            Effect.provide(second.connect),
            Effect.exit
          )
          assert.strictEqual(reason(exit), "OtherBrowser")
          assert.isTrue((yield* first.targets).some((info) => info.targetId === saved.target.targetId))
        }), 60_000)

      it.effect("keeps ordinary context and page cleanup unchanged", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin } = yield* serve
          // Target metadata can lag frame navigation on this separate observer connection.
          const targets = browser.targets.pipe(
            Effect.map((infos) => infos.map((info) => ({ ...info, url: "", title: "about:blank" })))
          )
          const targetId = yield* Effect.scoped(
            Effect.gen(function*() {
              const context = yield* Browser.newContext()
              const before = new Set((yield* targets).map((info) => info.targetId))
              const page = yield* context.newPage
              const created = (yield* targets).filter((info) => info.type === "page" && !before.has(info.targetId))
              assert.lengthOf(created, 1)
              const targetId = created[0]!.targetId
              yield* page.goto(`${origin}/ordinary`)
              assert.strictEqual(yield* page.url, `${origin}/ordinary`)
              assert.isTrue((yield* targets).some((info) => info.targetId === targetId))
              return targetId
            })
          ).pipe(Effect.provide(browser.connect))
          yield* until(targets, (infos) => !infos.some((info) => info.targetId === targetId))
        }), 60_000)

      it.effect("ordinary contexts still disappear when their client is killed", () =>
        Effect.gen(function*() {
          const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
          const { origin } = yield* serve
          const saved = yield* killedClient(browser, `${origin}/ordinary-killed`, "ordinary")
          yield* until(browser.targets, (infos) =>
            !infos.some((info) =>
              info.targetId === saved.target.targetId || info.browserContextId === saved.target.browserContextId
            ))
          const contexts = yield* Target.getBrowserContexts().pipe(Protocol.on(browser.observer.browser))
          assert.notInclude(contexts.browserContextIds, saved.target.browserContextId)
        }), 60_000)

      it.effect(
        "reclaims a killed client's context, reapplies settings, and owns context cleanup",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
            const { origin } = yield* serve
            const saved = yield* killedClient(browser, `${origin}/context`)
            const before = saved.target
            assert.isDefined(before)
            yield* Effect.scoped(
              Effect.gen(function*() {
                // Creation-only TLS settings must fail before ownership transfers, including explicit false.
                for (const acceptInsecureCerts of [true, false]) {
                  const options = { acceptInsecureCerts, eventLog: 0 }
                  const error = yield* api.UserContext.reclaim(saved.contextClaim, options).pipe(Effect.flip)
                  assert(error._tag === "UserContextError")
                  assert.strictEqual(error.reason._tag, "Unsupported")
                  if (error.reason._tag === "Unsupported") {
                    assert.strictEqual(error.reason.capability, "acceptInsecureCerts")
                  }
                }
                const recovered = yield* api.UserContext.reclaim(saved.contextClaim, { emulation: { locale: "fr-FR" } })
                const { context, found } = recovered
                assert.deepStrictEqual(found.pages.map((page) => page.found), [{ _tag: "Observed", dialogs: [] }])
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

      it.effect(
        "owns unknown state after handoff without dismissing, and explicitly closes while initialization is blocked",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
            const { origin } = yield* serve
            const baseline = yield* targetBaseline(browser)
            const old = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
            const services = yield* Layer.buildWithScope(browser.connect, old)
            const { claim, target } = yield* Effect.gen(function*() {
              const context = yield* api.UserContext.create({ reclaimable: true })
              const page = yield* context.newPage
              const target = yield* newTarget(browser, baseline)
              yield* page.goto(`${origin}/dialog`)
              return { claim: yield* api.Page.claim(page), target }
            }).pipe(Scope.provide(old), Effect.provide(services))
            const snapshots = yield* handoff(old)
            const lastKnown = snapshots.find((snapshot) => snapshot.claim === claim)!
            assert.deepStrictEqual(lastKnown.handoff, { _tag: "Complete", events: [] })
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
                const short = yield* api.Browser.reclaim(claim).pipe(Deadline.within("100 millis"), Effect.exit)
                assert.isTrue(Exit.isFailure(short))
                assert.strictEqual(Option.getOrThrow(Exit.findErrorOption(short))._tag, "Timeout")
                assert.isTrue((yield* browser.targets).some((info) => info.targetId === target.targetId))
                const pending = yield* api.Browser.reclaim(claim).pipe(Effect.forkChild)
                yield* BrowserClock.sleep(100)
                yield* Fiber.interrupt(pending)
                assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(pending)))
                assert.isTrue((yield* browser.targets).some((info) => info.targetId === target.targetId))
                const started = performance.now()
                const { page, found, handoff: historical } = yield* api.Browser.reclaim(claim, { lastKnown }).pipe(
                  Deadline.within("3 seconds")
                )
                assert.deepStrictEqual(
                  historical,
                  { _tag: "Complete", events: [] },
                  "historical completion cannot promise current observed state"
                )
                assert.deepStrictEqual(Schema.decodeUnknownSync(api.Browser.Found)(found), {
                  _tag: "Unknown"
                })
                assert.isAtLeast(performance.now() - started, 900)
                assert.isBelow(performance.now() - started, 2500)
                const actionAt = performance.now()
                const action = yield* page.evaluateInMainWorld(() => 42).pipe(
                  Deadline.within("150 millis"),
                  Effect.exit
                )
                assert.strictEqual(Option.getOrThrow(Exit.findErrorOption(action))._tag, "Timeout")
                assert.isBelow(performance.now() - actionAt, 1500)
                // The original observer can still see the pending dialog: reclaim did not dismiss it.
                const blocked = yield* Runtime.evaluate({ expression: "42" }).pipe(
                  Protocol.on(session),
                  BrowserClock.timeoutOption(100)
                )
                assert.isTrue(Option.isNone(blocked))
                yield* page.close()
                assert.isFalse((yield* browser.targets).some((info) => info.targetId === target.targetId))
              })
            ).pipe(Effect.provide(browser.connect))
          }),
        60_000
      )
      it.effect("refuses claims for discovered control handles and the default context", () =>
        Effect.gen(function*() {
          const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
          const requested = yield* Deferred.make<ServerResponse>()
          const { origin } = yield* serveWithDiscoveredGate(requested)
          const initialPages = (yield* browser.targets).filter((info) => info.type === "page")
          const { targetId } = yield* Target.createTarget({ url: `${origin}/discovered` }).pipe(
            Protocol.on(browser.observer.browser)
          )
          const response = yield* Deferred.await(requested)
          const destroyed = yield* browser.observer.browser.subscribe(Target.targetDestroyed)
          yield* Target.setDiscoverTargets({ discover: true, filter: [{ exclude: false }] }).pipe(
            Protocol.on(browser.observer.browser)
          )
          // Leave only the externally created target, so adoption needs no public-to-CDP ID mapping.
          const remaining = new Set(initialPages.map((page) => page.targetId))
          for (const page of initialPages) {
            yield* Target.closeTarget({ targetId: page.targetId }).pipe(Protocol.on(browser.observer.browser))
          }
          // Close acknowledgements can precede removal; the subscription buffers even early destruction events.
          if (remaining.size > 0) {
            yield* destroyed.pipe(
              Stream.takeUntil((event) => {
                remaining.delete(event.targetId)
                return remaining.size === 0
              }),
              Stream.runDrain
            )
          }
          assert.deepStrictEqual(
            (yield* browser.targets).filter((info) => info.type === "page").map((info) => info.targetId),
            [targetId]
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const connected = yield* Browser.Browser
            // The sole page was created before this connection adopted its existing targets.
            const matches = yield* connected.pages
            assert.lengthOf(matches, 1, "exactly one adopted page while its response is held")
            const observed = matches[0]!
            // A listed adopted page can still be Opening while its initial frame snapshot is installed.
            assert.strictEqual((yield* observed.status)._tag, "Open")
            // Register on the connected model before the response can replace the initial realm.
            const loaded = yield* PageNavigation.next(observed, { url: `${origin}/discovered`, waitUntil: "load" })
            response.setHeader("Content-Type", "text/html")
            response.end("<title>discovered</title>")
            assert.strictEqual((yield* loaded).url, `${origin}/discovered`)
            const controlled = yield* observed.control
            assert.strictEqual(yield* controlled.evaluateInMainWorld(() => location.href), `${origin}/discovered`)
            assert.strictEqual(reason(yield* api.Page.claim(controlled).pipe(Effect.exit)), "NotPermitted")
            const context = yield* connected.defaultContext.control
            assert.strictEqual(reason(yield* api.UserContext.claim(context).pipe(Effect.exit)), "NotPermitted")
          })).pipe(Effect.provide(browser.connect))
          assert.isTrue((yield* browser.targets).some((info) => info.targetId === targetId))
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

      it.effect("measures raw file-chooser release with an open dialog", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const CdpPage = yield* Effect.promise(() => import("@usestrider/browser/cdp/Page"))
          const { targetId } = yield* Target.createTarget({ url: "about:blank" }).pipe(
            Protocol.on(browser.observer.browser)
          )
          const { sessionId } = yield* Target.attachToTarget({ targetId, flatten: true }).pipe(
            Protocol.on(browser.observer.browser)
          )
          const session = yield* browser.observer.session(sessionId)
          yield* CdpPage.enable().pipe(Protocol.on(session))
          yield* CdpPage.setInterceptFileChooserDialog({ enabled: true }).pipe(Protocol.on(session))
          const beforeAt = performance.now()
          const before = yield* CdpPage.setInterceptFileChooserDialog({ enabled: false }).pipe(
            Protocol.on(session),
            BrowserClock.timeoutOption(1000)
          )
          assert.isTrue(Option.isSome(before), "release must work without a dialog")
          const baseline = performance.now() - beforeAt
          yield* CdpPage.setInterceptFileChooserDialog({ enabled: true }).pipe(Protocol.on(session))
          const events = yield* session.subscribe(CdpPage.javascriptDialogOpening)
          const opened = yield* Stream.runHead(events).pipe(Effect.forkChild)
          yield* Runtime.evaluate({ expression: "setTimeout(() => alert('raw release probe'), 0); undefined" }).pipe(
            Protocol.on(session)
          )
          assert.strictEqual(Option.getOrThrow(yield* Fiber.join(opened)).message, "raw release probe")
          const blockedAt = performance.now()
          const disabled = yield* CdpPage.setInterceptFileChooserDialog({ enabled: false }).pipe(
            Protocol.on(session),
            BrowserClock.timeoutOption(1000)
          )
          const blocked = performance.now() - blockedAt
          assert.isTrue(Option.isNone(disabled), "the tested open-dialog command path did not answer")
          const historyAt = performance.now()
          const history = yield* CdpPage.getNavigationHistory().pipe(
            Protocol.on(session),
            BrowserClock.timeoutOption(1000)
          )
          assert.isTrue(Option.isSome(history), "browser-handled commands still answer")
          const historyMillis = performance.now() - historyAt
          const evaluation = yield* Runtime.evaluate({ expression: "42" }).pipe(
            Protocol.on(session),
            BrowserClock.timeoutOption(200)
          )
          assert.isTrue(Option.isNone(evaluation), "the dialog was not dismissed by the release attempt")
          const closeAt = performance.now()
          yield* Target.closeTarget({ targetId }).pipe(Protocol.on(browser.observer.browser))
          yield* until(browser.targets, (infos) => !infos.some((info) => info.targetId === targetId))
          yield* Effect.logInfo({ baseline, blocked, historyMillis, closeMillis: performance.now() - closeAt })
        }), 10_000)

      it.effect("SIGKILL recovery never dismisses a proved-open dialog", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin } = yield* serve
          const saved = yield* killedClient(browser, `${origin}/crash-dialog`, "dialog")
          yield* Effect.scoped(Effect.gen(function*() {
            const { page, found, handoff: event } = yield* api.Browser.reclaim(saved.pageClaim)
            assert.deepStrictEqual(found, { _tag: "Unknown" })
            assert.isUndefined(event, "a killed client ran no handoff finalizer")
            const answer = yield* page.evaluateInMainWorld(() => sessionStorage.getItem("crash-answer")).pipe(
              Deadline.within("100 millis"),
              Effect.exit
            )
            assert.isTrue(Deadline.isTimeout(Option.getOrThrow(Exit.findErrorOption(answer))))
            yield* page.close()
          })).pipe(Effect.provide(browser.connect))
        }), 10_000)

      for (const mode of ["residual", "accept-policy", "handler", "handler-at-close"] as const) {
        it.effect(
          `planned handoff ${mode} honors caller handlers and never auto-accepts`,
          () =>
            Effect.gen(function*() {
              const browser = yield* launch
              const { origin } = yield* serve
              const old = yield* Scope.make()
              yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
              const services = yield* Layer.buildWithScope(browser.connect, old)
              const claim = yield* Effect.gen(function*() {
                const context = yield* api.UserContext.create({
                  reclaimable: true,
                  dialogs: mode === "accept-policy" ? "accept" : "leaveOpen"
                })
                const page = yield* context.newPage
                yield* page.goto(`${origin}/${mode}`)
                if (mode === "accept-policy") yield* Dialog.handle(page, () => Effect.never)
                const gate = yield* Deferred.make<void>()
                const handled = mode === "handler" || mode === "handler-at-close"
                  ? yield* Dialog.handle(page, (pending) =>
                    mode === "handler-at-close"
                      ? Effect.andThen(Deferred.await(gate), Dialog.acceptAll(pending))
                      : Dialog.acceptAll(pending))
                  : undefined
                const claim = yield* api.Page.claim(page)
                const opened = yield* Dialog.next(page)
                yield* page.evaluateInMainWorld(() => {
                  setTimeout(() => sessionStorage.setItem("answer", String(confirm("handoff confirm"))), 0)
                })
                yield* opened
                if (handled !== undefined && mode === "handler") {
                  yield* handled.handled.waitFor((n) => n === 1)
                  assert.strictEqual(yield* page.evaluateInMainWorld(() => sessionStorage.getItem("answer")), "true")
                }
                if (handled !== undefined && mode === "handler-at-close") {
                  yield* Effect.addFinalizer(() =>
                    Effect.andThen(Deferred.succeed(gate, undefined), handled.handled.waitFor((n) => n === 1)).pipe(
                      Effect.orDie,
                      Effect.asVoid
                    )
                  )
                }
                return claim
              }).pipe(Scope.provide(old), Effect.provide(services))
              const snapshots = yield* handoff(old)
              const snapshot = snapshots.find((entry) => entry.claim === claim)!
              assert.deepStrictEqual(snapshot.handoff, {
                _tag: "Complete",
                events: mode.startsWith("handler")
                  ? []
                  : [{ _tag: "DialogDismissed", kind: "confirm", message: "handoff confirm" }]
              })
              yield* Effect.scoped(Effect.gen(function*() {
                const result = yield* api.Browser.reclaim(claim, {
                  lastKnown: Schema.decodeUnknownSync(api.Browser.LastKnown)(
                    JSON.parse(JSON.stringify(Schema.encodeSync(api.Browser.LastKnown)(snapshot)))
                  )
                })
                assert.deepStrictEqual(result.handoff, snapshot.handoff)
                assert.deepStrictEqual(result.found, { _tag: "Observed", dialogs: [] })
                assert.strictEqual(
                  yield* result.page.evaluateInMainWorld(() => sessionStorage.getItem("answer")),
                  mode.startsWith("handler") ? "true" : "false"
                )
              })).pipe(Effect.provide(browser.connect))
            }),
          60_000
        )
      }

      for (const mode of ["failed", "timed-out"] as const) {
        it.effect(
          `planned handoff ${mode} dismissal returns Unknown and closes its scope`,
          () =>
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
                yield* page.goto(`${origin}/dismiss-${mode}`)
                const claim = yield* api.Page.claim(page)
                const claims = ClaimHooks.get(connected).runtime.model.adapter.claims!
                Object.assign(claims, {
                  dismiss: () =>
                    mode === "failed" ? Effect.fail(Kit.unsupported("test.dismiss", "injected refusal")) : Effect.never
                })
                const opened = yield* Dialog.next(page)
                yield* page.evaluateInMainWorld(() => {
                  setTimeout(() => confirm("unanswered"), 0)
                })
                yield* opened
                return claim
              }).pipe(Scope.provide(old), Effect.provide(services))
              const start = performance.now()
              const snapshots = yield* handoff(old)
              assert.isBelow(performance.now() - start, 3000)
              assert.strictEqual(old.state._tag, "Closed")
              const snapshot = snapshots.find((entry) => entry.claim === claim)!
              assert.deepStrictEqual(snapshot.handoff, {
                _tag: "Unknown",
                events: []
              })
              yield* Effect.scoped(Effect.gen(function*() {
                const { page, found } = yield* api.Browser.reclaim(claim, { lastKnown: snapshot })
                assert.deepStrictEqual(found, { _tag: "Unknown" })
                yield* page.close()
              })).pipe(Effect.provide(browser.connect))
            }),
          10_000
        )
      }

      it.effect(
        "planned handoff dismisses beforeunload and cancels navigation without closing the tab",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch
            const { origin } = yield* serve
            const old = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
            const services = yield* Layer.buildWithScope(browser.connect, old)
            const claim = yield* Effect.gen(function*() {
              const context = yield* api.UserContext.create({ reclaimable: true })
              const page = yield* context.newPage
              yield* page.goto(`${origin}/beforeunload-source`)
              yield* page.getByRole("button", { name: "Control" }).click()
              yield* page.evaluateInMainWorld(() => {
                sessionStorage.setItem("same-document", "yes")
                window.addEventListener("beforeunload", (event) => {
                  event.preventDefault()
                  event.returnValue = ""
                })
              })
              const claim = yield* api.Page.claim(page)
              yield* Dialog.handle(page, () => Effect.never)
              const opened = yield* Dialog.next(page)
              yield* page.goto(`${origin}/beforeunload-destination`).pipe(Effect.forkIn(old))
              assert.strictEqual((yield* opened)._tag, "BeforeUnload")
              return claim
            }).pipe(Scope.provide(old), Effect.provide(services))
            const snapshots = yield* handoff(old)
            const snapshot = snapshots.find((entry) => entry.claim === claim)!
            const report = snapshot.handoff!
            assert.strictEqual(report._tag, "Complete")
            assert.strictEqual(report.events[0]?.kind, "beforeunload")
            assert.strictEqual(typeof report.events[0]?.message, "string")
            yield* Effect.scoped(Effect.gen(function*() {
              const { page, found } = yield* api.Browser.reclaim(claim, { lastKnown: snapshot })
              assert.deepStrictEqual(found, { _tag: "Observed", dialogs: [] })
              assert.strictEqual(yield* page.url, `${origin}/beforeunload-source`)
              assert.strictEqual(yield* page.evaluateInMainWorld(() => sessionStorage.getItem("same-document")), "yes")
            })).pipe(Effect.provide(browser.connect))
          }),
        60_000
      )

      it.effect(
        "dismisses a pre-handoff dialog, reports the event and confirms declaration teardown",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
            const { origin } = yield* serve
            const cleanupWarnings: Array<unknown> = []
            const cleanupLogger = Logger.make((entry) => {
              if (entry.logLevel === "Warn") cleanupWarnings.push(entry.message)
            })
            const baseline = yield* targetBaseline(browser)
            const old = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
            const services = yield* Layer.buildWithScope(browser.connect, old)
            const { claim, target: before } = yield* Effect.gen(function*() {
              const context = yield* api.UserContext.create({ reclaimable: true, eventLog: 0, dialogs: "leaveOpen" })
              const page = yield* context.newPage
              const target = yield* newTarget(browser, baseline)
              yield* page.goto(`${origin}/before-handoff-dialog`)
              const claim = yield* api.Page.claim(page)
              const opened = yield* Dialog.next(page)
              yield* page.evaluateInMainWorld(() => {
                setTimeout(() => alert("before handoff"), 0)
              })
              yield* opened
              return { claim, target }
            }).pipe(
              Scope.provide(old),
              Effect.provide(services),
              Effect.provideService(Logger.CurrentLoggers, new Set([cleanupLogger]))
            )
            const snapshots = yield* handoff(old).pipe(
              Effect.provideService(Logger.CurrentLoggers, new Set([cleanupLogger]))
            )
            assert.deepStrictEqual(cleanupWarnings, [], "handoff must confirm declaration cleanup")
            const lastKnown = snapshots.find((entry) => entry.claim === claim)!
            assert.isDefined(lastKnown)
            yield* Effect.scoped(Effect.gen(function*() {
              const restoredSnapshot = Schema.decodeUnknownSync(api.Browser.LastKnown)(
                JSON.parse(JSON.stringify(Schema.encodeSync(api.Browser.LastKnown)(lastKnown)))
              )
              const recovered = yield* api.Browser.reclaim(claim, { lastKnown: restoredSnapshot })
              assert.deepStrictEqual(recovered.found, { _tag: "Observed", dialogs: [] })
              assert.deepStrictEqual({
                _tag: recovered.lastKnown?._tag,
                claim: recovered.lastKnown?.claim,
                dialogs: recovered.lastKnown?.dialogs
              }, {
                _tag: "LastKnown",
                claim,
                dialogs: [{ kind: "alert", message: "before handoff" }]
              })
            })).pipe(Effect.provide(browser.connect))
            yield* until(browser.targets, (infos) => !infos.some((info) => info.targetId === before.targetId))
          }),
        60_000
      )

      it.effect(
        "a failed context reclaim leaves the surviving context and its tabs open",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
            const { origin } = yield* serve
            const baseline = yield* targetBaseline(browser)
            const old = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
            const services = yield* Layer.buildWithScope(browser.connect, old)
            const url = `${origin}/survivor`
            const { claim, target } = yield* Effect.gen(function*() {
              const context = yield* api.UserContext.create({ reclaimable: true })
              const page = yield* context.newPage
              const target = yield* newTarget(browser, baseline)
              yield* page.goto(url)
              return { claim: yield* api.UserContext.claim(context), target }
            }).pipe(Scope.provide(old), Effect.provide(services))
            yield* handoff(old)
            const exit = yield* Effect.scoped(
              api.UserContext.reclaim(claim, { emulation: { locale: "not a locale" } })
            ).pipe(Effect.provide(browser.connect), Effect.exit)
            assert.isTrue(Exit.isFailure(exit), "expected the settings to be refused")
            assert.isTrue(
              (yield* browser.targets).some((info) =>
                info.targetId === target.targetId && info.browserContextId === target.browserContextId
              ),
              "the claimed context's tab was destroyed"
            )
          }),
        60_000
      )

      it.effect(
        "refuses claims on an ordinary context, which cannot survive",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch
            yield* Effect.scoped(Effect.gen(function*() {
              const context = yield* Browser.newContext()
              assert.isTrue(
                Exit.isFailure(yield* api.UserContext.claim(context).pipe(Effect.exit)),
                "context claim issued"
              )
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
      it.effect("refuses claims on an ordinary context's pages, which cannot survive", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          yield* Effect.scoped(Effect.gen(function*() {
            const context = yield* Browser.newContext()
            const page = yield* context.newPage
            assert.strictEqual(reason(yield* api.Page.claim(page).pipe(Effect.exit)), "NotPermitted")
          })).pipe(Effect.provide(browser.connect))
        }), 60_000)

      for (const failure of ["failed", "interrupted", "timed-out"] as const) {
        it.effect(
          `${failure} storageState reclaim unwinds registrations without destroying survivors`,
          () =>
            Effect.gen(function*() {
              const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
              const { origin } = yield* serve
              const baseline = yield* targetBaseline(browser)
              const old = yield* Scope.make()
              yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
              const services = yield* Layer.buildWithScope(browser.connect, old)
              const url = `${origin}/rollback-${failure}`
              const { claim, target } = yield* Effect.gen(function*() {
                const context = yield* api.UserContext.create({ reclaimable: true })
                const page = yield* context.newPage
                const target = yield* newTarget(browser, baseline)
                yield* page.goto(url)
                return { claim: yield* api.UserContext.claim(context), target }
              }).pipe(Scope.provide(old), Effect.provide(services))
              yield* handoff(old)
              yield* Effect.scoped(Effect.gen(function*() {
                const connected = yield* Browser.Browser
                const adapter = ClaimHooks.get(connected).runtime.model.adapter
                const declare = adapter.declare
                const setCookies = adapter.setCookies
                const entered = yield* Deferred.make<void>()
                let registrations = 0
                Object.assign(adapter, {
                  declare: Effect.fnUntraced(
                    function*(scope: Parameters<typeof declare>[0], declaration: Parameters<typeof declare>[1]) {
                      const id = yield* declare(scope, declaration)
                      registrations++
                      yield* Effect.addFinalizer(() =>
                        Effect.sync(() => {
                          registrations--
                        })
                      )
                      return id
                    }
                  ),
                  setCookies: Effect.fnUntraced(function*() {
                    yield* Deferred.succeed(entered, undefined)
                    if (failure === "timed-out") return yield* (yield* Operation.record).bound(Effect.never)
                    if (failure === "interrupted") return yield* Effect.never
                    return yield* Effect.fail(
                      Kit.unsupported("test.storageState", "injected after context declarations")
                    )
                  })
                })
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    Object.assign(adapter, { declare, setCookies })
                  })
                )
                const destination = yield* Scope.make()
                yield* Effect.addFinalizer(() => Scope.close(destination, Exit.void))
                const cookie = new CookieJar.Cookie({
                  name: CookieJar.Name.make("session"),
                  value: Redacted.make("saved"),
                  domain: CookieJar.Domain.make("localhost"),
                  path: "/",
                  expires: Option.none(),
                  httpOnly: false,
                  secure: false,
                  sameSite: Option.none(),
                  partitionKey: { _tag: "Unpartitioned" },
                  priority: Option.none()
                })
                const warnings: Array<unknown> = []
                const logger = Logger.make((entry) => {
                  if (entry.logLevel === "Warn") warnings.push(entry.message)
                })
                const restore = api.UserContext.reclaim(claim, {
                  emulation: { locale: "fr-FR" },
                  storageState: new StorageState.StorageState({ cookies: [cookie], origins: [] })
                }).pipe(Scope.provide(destination), Effect.provideService(Logger.CurrentLoggers, new Set([logger])))
                const setup = failure === "timed-out" ? restore.pipe(Deadline.within("1 second")) : restore
                if (failure === "interrupted") {
                  const fiber = yield* setup.pipe(Effect.forkChild)
                  yield* Deferred.await(entered)
                  yield* Fiber.interrupt(fiber)
                } else {
                  const exit = yield* setup.pipe(Effect.exit)
                  assert(Exit.isFailure(exit))
                  if (failure === "timed-out") {
                    assert.isTrue(yield* Deferred.isDone(entered), "must reach storage setup before the deadline")
                    assert.isTrue(Deadline.isTimeout(Option.getOrThrow(Exit.findErrorOption(exit))))
                  }
                }
                assert.deepStrictEqual(warnings, [], "rollback commands must complete with their own cleanup budget")
                assert.strictEqual(registrations, 0, "setup registrations must unwind before the caller's scope ends")
                yield* Scope.close(destination, Exit.void)
                assert.isTrue(
                  (yield* browser.targets).some((info) =>
                    info.targetId === target.targetId && info.browserContextId === target.browserContextId
                  ),
                  "surviving tab was destroyed"
                )
                // Read the survivor through its actual URL rather than assuming a public id survives reconnect.
                let checked = 0
                for (const page of yield* connected.pages) {
                  const control = yield* page.control
                  if ((yield* control.evaluateInMainWorld(() => location.href)) !== url) continue
                  checked++
                  assert.strictEqual(yield* control.evaluateInMainWorld(() => navigator.language), "en-US")
                }
                assert.strictEqual(checked, 1, "must check the surviving page locale")
              })).pipe(Effect.provide(browser.connect))
            }),
          60_000
        )
      }

      it.effect("rejects a page claim passed as a context claim", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          yield* Effect.scoped(Effect.gen(function*() {
            const context = yield* api.UserContext.create({ reclaimable: true })
            const page = yield* context.newPage
            const encoded = Schema.encodeSync(api.Page.Claim)(yield* api.Page.claim(page))
            const wrong = Schema.decodeUnknownSync(api.UserContext.Claim)(encoded)
            assert.strictEqual(
              reason(yield* Effect.scoped(api.UserContext.reclaim(wrong)).pipe(Effect.exit)),
              "InvalidInput"
            )
          })).pipe(Effect.provide(browser.connect))
        }), 60_000)

      it.effect("context-only handoff reports a dialog it dismissed", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin } = yield* serve
          const old = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
          const services = yield* Layer.buildWithScope(browser.connect, old)
          const claim = yield* Effect.gen(function*() {
            const context = yield* api.UserContext.create({ reclaimable: true, dialogs: "leaveOpen" })
            const page = yield* context.newPage
            yield* page.goto(`${origin}/context-only`)
            const claim = yield* api.UserContext.claim(context)
            const opened = yield* Dialog.next(page)
            yield* page.evaluateInMainWorld(() => {
              setTimeout(() => {
                sessionStorage.answer = String(confirm("dismissed unseen"))
              }, 0)
            })
            yield* opened
            return claim
          }).pipe(Scope.provide(old), Effect.provide(services))
          const snapshots = yield* handoff(old)
          const events = snapshots.flatMap((snapshot) => snapshot.handoff?.events ?? [])
          assert.deepStrictEqual(events.map((event) => event.message), ["dismissed unseen"])
          const saved = Schema.decodeUnknownSync(api.Browser.LastKnown)(
            JSON.parse(JSON.stringify(snapshots.find((snapshot) => snapshot.claim === claim)))
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const recovered = yield* api.UserContext.reclaim(claim, { lastKnown: saved })
            assert.deepStrictEqual(recovered.handoff, saved.handoff)
            const pages = yield* recovered.context.pages
            assert.strictEqual(yield* pages[0]!.evaluateInMainWorld(() => sessionStorage.answer), "false")
          })).pipe(Effect.provide(browser.connect))
        }), 60_000)

      it.effect("context reclaim with a blocked page returns it as Unknown", () =>
        Effect.gen(function*() {
          const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
          const { origin } = yield* serve
          const baseline = yield* targetBaseline(browser)
          const old = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
          const services = yield* Layer.buildWithScope(browser.connect, old)
          const url = `${origin}/context-blocked`
          const { claim, target } = yield* Effect.gen(function*() {
            const context = yield* api.UserContext.create({ reclaimable: true, dialogs: "leaveOpen" })
            const page = yield* context.newPage
            const target = yield* newTarget(browser, baseline)
            yield* page.goto(url)
            return { claim: yield* api.UserContext.claim(context), target }
          }).pipe(Scope.provide(old), Effect.provide(services))
          yield* handoff(old)
          const { sessionId } = yield* Target.attachToTarget({ targetId: target.targetId, flatten: true }).pipe(
            Protocol.on(browser.observer.browser)
          )
          const session = yield* browser.observer.session(sessionId)
          const CdpPage = yield* Effect.promise(() => import("@usestrider/browser/cdp/Page"))
          yield* CdpPage.enable().pipe(Protocol.on(session))
          const events = yield* session.subscribe(CdpPage.javascriptDialogOpening)
          const opened = yield* Stream.runHead(events).pipe(Effect.forkChild)
          yield* Runtime.evaluate({ expression: "setTimeout(() => confirm('blocked'), 0); undefined" }).pipe(
            Protocol.on(session)
          )
          assert.strictEqual(Option.getOrThrow(yield* Fiber.join(opened)).message, "blocked")
          const start = performance.now()
          const exit = yield* Effect.scoped(Effect.gen(function*() {
            const short = yield* api.UserContext.reclaim(claim).pipe(Deadline.within("100 millis"), Effect.exit)
            assert.strictEqual(Option.getOrThrow(Exit.findErrorOption(short))._tag, "Timeout")
            assert.isTrue((yield* browser.targets).some((info) => info.targetId === target.targetId))
            const settings = yield* api.UserContext.reclaim(claim, {
              emulation: { locale: "fr-FR" },
              observationTimeout: 100
            }).pipe(Effect.exit)
            assert.strictEqual(reason(settings), "BackendFailure")
            assert.strictEqual(
              (Option.getOrThrow(Exit.findErrorOption(settings)) as { operation: string }).operation,
              "UserContext.reclaim"
            )
            assert.isTrue(
              (yield* browser.targets).some((info) => info.targetId === target.targetId),
              "failed settings must preserve the tab"
            )
            const { context, found } = yield* api.UserContext.reclaim(claim)
            const page = (yield* context.pages)[0]!
            const action = yield* page.evaluateInMainWorld(() => 42).pipe(Deadline.within("150 millis"), Effect.exit)
            assert.strictEqual(Option.getOrThrow(Exit.findErrorOption(action))._tag, "Timeout")
            const blocked = yield* Runtime.evaluate({ expression: "42" }).pipe(
              Protocol.on(session),
              BrowserClock.timeoutOption(100)
            )
            assert.isTrue(Option.isNone(blocked), "context reclaim must not touch the dialog")
            return found.pages.map((page) => page.found._tag)
          })).pipe(Effect.provide(browser.connect), Effect.exit)
          console.log(`context reclaim blocked page: ${Math.round(performance.now() - start)} ms`)
          assert.isTrue(Exit.isSuccess(exit), `reclaim failed: ${String(exit)}`.slice(0, 300))
          assert(Exit.isSuccess(exit))
          assert.deepStrictEqual(exit.value, ["Unknown"])
        }), 90_000)

      it.effect("context SIGKILL recovery leaves a proved-open dialog untouched", () =>
        Effect.gen(function*() {
          const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
          const { origin } = yield* serve
          const saved = yield* killedClient(browser, `${origin}/context-crash-dialog`, "dialog")
          yield* Effect.scoped(Effect.gen(function*() {
            const { context, found, handoff: history } = yield* api.UserContext.reclaim(saved.contextClaim)
            assert.deepStrictEqual(found.pages.map((page) => page.found._tag), ["Unknown"])
            assert.isUndefined(history)
            const page = (yield* context.pages)[0]!
            const result = yield* page.evaluateInMainWorld(() => sessionStorage.getItem("crash-answer")).pipe(
              Deadline.within("150 millis"),
              Effect.exit
            )
            assert.strictEqual(Option.getOrThrow(Exit.findErrorOption(result))._tag, "Timeout")
          })).pipe(Effect.provide(browser.connect))
          yield* until(browser.targets, (infos) =>
            !infos.some((info) =>
              info.targetId === saved.target.targetId || info.browserContextId === saved.target.browserContextId
            ))
          const contexts = yield* Target.getBrowserContexts().pipe(Protocol.on(browser.observer.browser))
          assert.notInclude(contexts.browserContextIds, saved.target.browserContextId)
        }), 60_000)

      it.effect(
        "finishes page transfer and snapshot registration together when interrupted at commit",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch
            const old = yield* Scope.make()
            const next = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
            yield* Effect.addFinalizer(() => Scope.close(next, Exit.void))
            yield* Effect.gen(function*() {
              const claim = yield* Effect.gen(function*() {
                const context = yield* api.UserContext.create({ reclaimable: true })
                return yield* api.Page.claim(yield* context.newPage)
              }).pipe(Scope.provide(old))
              const model = ClaimHooks.get(yield* Browser.Browser).runtime.model
              const transfer = model.transfer
              const entered = yield* Deferred.make<void>()
              const resume = yield* Deferred.make<void>()
              Object.assign(model, {
                transfer: (...args: Parameters<typeof transfer>) =>
                  transfer(...args).pipe(
                    Effect.andThen(Deferred.succeed(entered, undefined)),
                    Effect.andThen(Deferred.await(resume))
                  )
              })
              const task = yield* api.Browser.reclaim(claim).pipe(Scope.provide(next), Effect.forkChild)
              yield* Deferred.await(entered)
              const interrupted = yield* Fiber.interrupt(task).pipe(Effect.forkChild)
              yield* Effect.yieldNow
              yield* Deferred.succeed(resume, undefined)
              yield* Fiber.join(interrupted)
              Object.assign(model, { transfer })
              assert.deepStrictEqual(yield* handoff(old), [])
              assert.deepStrictEqual((yield* handoff(next)).map((snapshot) => snapshot.claim), [claim])
            }).pipe(Effect.provide(browser.connect))
          }),
        60_000
      )

      it.effect(
        "finishes context transfer and snapshot registration together when interrupted at commit",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch
            const old = yield* Scope.make()
            const next = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
            yield* Effect.addFinalizer(() => Scope.close(next, Exit.void))
            yield* Effect.gen(function*() {
              const claim = yield* Effect.gen(function*() {
                const context = yield* api.UserContext.create({ reclaimable: true })
                yield* context.newPage
                return yield* api.UserContext.claim(context)
              }).pipe(Scope.provide(old))
              const model = ClaimHooks.get(yield* Browser.Browser).runtime.model
              const transfer = model.transfer
              const entered = yield* Deferred.make<void>()
              const resume = yield* Deferred.make<void>()
              Object.assign(model, {
                transfer: (...args: Parameters<typeof transfer>) =>
                  transfer(...args).pipe(
                    Effect.andThen(Deferred.succeed(entered, undefined)),
                    Effect.andThen(Deferred.await(resume))
                  )
              })
              const task = yield* api.UserContext.reclaim(claim).pipe(Scope.provide(next), Effect.forkChild)
              yield* Deferred.await(entered)
              const interrupted = yield* Fiber.interrupt(task).pipe(Effect.forkChild)
              yield* Effect.yieldNow
              yield* Deferred.succeed(resume, undefined)
              yield* Fiber.join(interrupted)
              Object.assign(model, { transfer })
              assert.deepStrictEqual(yield* handoff(old), [])
              assert.deepStrictEqual((yield* handoff(next)).map((snapshot) => snapshot.claim), [claim])
            }).pipe(Effect.provide(browser.connect))
          }),
        60_000
      )

      it.effect("moves a same-connection page snapshot away from its old scope", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const old = yield* Scope.make()
          const next = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
          yield* Effect.addFinalizer(() => Scope.close(next, Exit.void))
          yield* Effect.gen(function*() {
            const claim = yield* Effect.gen(function*() {
              const context = yield* api.UserContext.create({ reclaimable: true })
              const page = yield* context.newPage
              return yield* api.Page.claim(page)
            }).pipe(Scope.provide(old))
            yield* api.Browser.reclaim(claim).pipe(Scope.provide(next))
            assert.deepStrictEqual(yield* handoff(old), [], "the old scope must not retain the transferred claim")
            const snapshots = yield* handoff(next)
            assert.deepStrictEqual(snapshots.map((snapshot) => snapshot.claim), [claim])
          }).pipe(Effect.provide(browser.connect))
        }), 60_000)

      it.effect("failed dismissal in a reclaimable context still ends handoff promptly", () =>
        Effect.gen(function*() {
          const browser = yield* launch
          const { origin } = yield* serve
          const warnings: Array<string> = []
          const logger = Logger.make((entry) => {
            if (entry.logLevel === "Warn") warnings.push(String(entry.message))
          })
          const loggers = new Set([...(yield* Logger.CurrentLoggers), logger])
          const old = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
          const services = yield* Layer.buildWithScope(browser.connect, old)
          const claim = yield* Effect.gen(function*() {
            const connected = yield* Browser.Browser
            const context = yield* api.UserContext.create({ reclaimable: true, dialogs: "leaveOpen" })
            const page = yield* context.newPage
            yield* page.goto(`${origin}/context-dismiss-failed`)
            const claim = yield* api.Page.claim(page)
            const claims = ClaimHooks.get(connected).runtime.model.adapter.claims!
            Object.assign(claims, { dismiss: () => Effect.fail(Kit.unsupported("test.dismiss", "injected refusal")) })
            const opened = yield* Dialog.next(page)
            yield* page.evaluateInMainWorld(() => {
              setTimeout(() => confirm("unanswered"), 0)
            })
            yield* opened
            return claim
          }).pipe(Scope.provide(old), Effect.provide(services), Effect.provideService(Logger.CurrentLoggers, loggers))
          const start = performance.now()
          const snapshots = yield* handoff(old).pipe(Effect.provideService(Logger.CurrentLoggers, loggers))
          const elapsed = performance.now() - start
          console.log(`failed dismissal handoff: ${Math.round(elapsed)} ms`)
          assert.strictEqual(snapshots.find((entry) => entry.claim === claim)!.handoff?._tag, "Unknown")
          assert.isBelow(elapsed, 5000)
          assert.isTrue(
            warnings.some((message) => message.includes("could not confirm CDP declaration release")),
            "unconfirmed declaration release must remain visible"
          )
        }), 120_000)

      for (const initial of ["empty", "healthy"] as const) {
        it.effect(
          `no-settings ${initial} context recovery restores dialog, file chooser and download defaults`,
          () =>
            Effect.gen(function*() {
              const browser = yield* launch
              const { origin } = yield* serve
              const old = yield* Scope.make()
              yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
              const services = yield* Layer.buildWithScope(browser.connect, old)
              const claim = yield* Effect.gen(function*() {
                const context = yield* api.UserContext.create({ reclaimable: true })
                if (initial === "healthy") yield* (yield* context.newPage).goto(`${origin}/defaults`)
                return yield* api.UserContext.claim(context)
              }).pipe(Scope.provide(old), Effect.provide(services))
              yield* handoff(old)
              yield* Effect.scoped(Effect.gen(function*() {
                const adapter = ClaimHooks.get(yield* Browser.Browser).runtime.model.adapter
                const declarations: Array<Parameters<typeof adapter.declare>[1]> = []
                const declare = adapter.declare
                Object.assign(adapter, {
                  declare: (...args: Parameters<typeof declare>) => {
                    declarations.push(args[1])
                    return declare(...args)
                  }
                })
                const { context, found } = yield* api.UserContext.reclaim(claim)
                assert.isTrue(found.pages.every((page) => page.found._tag === "Observed"))
                assert.isTrue(declarations.some((d) => d._tag === "Challenges"))
                assert.isTrue(declarations.some((d) => d._tag === "FileChooser"))
                assert.isTrue(declarations.some((d) => d._tag === "Downloads" && d.behavior._tag === "Allow"))
                const page = yield* context.newPage
                yield* page.goto(`${origin}/defaults`)
                assert.strictEqual(
                  yield* page.evaluateInMainWorld(() => {
                    alert("dismiss by default")
                    return "answered"
                  }).pipe(Deadline.within("2 seconds")),
                  "answered"
                )
                const chooser = yield* FileChooser.next(page)
                yield* page.getByRole("button", { name: "Upload" }).click()
                assert.strictEqual((yield* chooser)._tag, "Single")
                const download = yield* Download.next(page)
                yield* page.getByText("Export", { exact: true }).click()
                const file = yield* download
                const bytes = yield* Stream.runCollect(file.stream)
                assert.strictEqual(Buffer.concat(Array.from(bytes)).toString("utf8"), "claims bytes")
                yield* file.finished
                assert.strictEqual((yield* file.status)._tag, "Completed")
                if (initial === "healthy") {
                  const existing = (yield* context.pages).find((candidate) => candidate.id !== page.id)!
                  assert.strictEqual(
                    yield* existing.evaluateInMainWorld(() => {
                      alert("old page default")
                      return "answered"
                    }).pipe(Deadline.within("2 seconds")),
                    "answered"
                  )
                }
              })).pipe(Effect.provide(browser.connect))
            }),
          60_000
        )
      }

      it.effect(
        "mixed Unknown context recovery omits defaults for healthy siblings and future pages",
        () =>
          Effect.gen(function*() {
            const browser = yield* launch.pipe(Effect.map(staleTargetMetadata))
            const { origin } = yield* serve
            const baseline = yield* targetBaseline(browser)
            const old = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
            const services = yield* Layer.buildWithScope(browser.connect, old)
            const { claim, target } = yield* Effect.gen(function*() {
              const context = yield* api.UserContext.create({ reclaimable: true, dialogs: "leaveOpen" })
              const page = yield* context.newPage
              const target = yield* newTarget(browser, baseline)
              yield* page.goto(`${origin}/mixed-blocked`)
              yield* (yield* context.newPage).goto(`${origin}/defaults`)
              return { claim: yield* api.UserContext.claim(context), target }
            }).pipe(Scope.provide(old), Effect.provide(services))
            yield* handoff(old)
            const { sessionId } = yield* Target.attachToTarget({ targetId: target.targetId, flatten: true }).pipe(
              Protocol.on(browser.observer.browser)
            )
            const session = yield* browser.observer.session(sessionId)
            const CdpPage = yield* Effect.promise(() => import("@usestrider/browser/cdp/Page"))
            yield* CdpPage.enable().pipe(Protocol.on(session))
            const opened = yield* Stream.runHead(yield* session.subscribe(CdpPage.javascriptDialogOpening)).pipe(
              Effect.forkChild
            )
            yield* Runtime.evaluate({ expression: "setTimeout(() => confirm('mixed blocked'), 0); undefined" }).pipe(
              Protocol.on(session)
            )
            assert.strictEqual(Option.getOrThrow(yield* Fiber.join(opened)).message, "mixed blocked")
            yield* Effect.scoped(Effect.gen(function*() {
              const adapter = ClaimHooks.get(yield* Browser.Browser).runtime.model.adapter
              const declarations: Array<Parameters<typeof adapter.declare>[1]> = []
              const declare = adapter.declare
              Object.assign(adapter, {
                declare: (...args: Parameters<typeof declare>) => {
                  declarations.push(args[1])
                  return declare(...args)
                }
              })
              for (
                const settings of [{ dialogs: "leaveOpen" as const }, { eventLog: 0 }, { downloads: "deny" as const }, {
                  emulation: { locale: "fr-FR" }
                }]
              ) {
                assert.strictEqual(
                  reason(
                    yield* api.UserContext.reclaim(claim, { ...settings, observationTimeout: 100 }).pipe(Effect.exit)
                  ),
                  "BackendFailure"
                )
                assert.isTrue((yield* browser.targets).some((info) => info.targetId === target.targetId))
              }
              assert.deepStrictEqual(declarations, [], "supplied settings must be refused before any declarations")
              const { context, found } = yield* api.UserContext.reclaim(claim, { observationTimeout: 100 })
              assert.deepStrictEqual(found.pages.map((page) => page.found._tag).sort(), ["Observed", "Unknown"])
              const healthy = (yield* context.pages).find((page) =>
                found.pages.some((report) => report.page === page.id && report.found._tag === "Observed")
              )!
              const future = yield* context.newPage
              yield* future.goto(`${origin}/defaults`)
              assert.deepStrictEqual(
                declarations,
                [],
                "fallback omits challenge, file chooser and download declarations for the entire context"
              )
              for (const page of [healthy, future]) {
                const next = yield* Dialog.next(page)
                yield* page.evaluateInMainWorld(() => {
                  setTimeout(() => confirm("no adopted policy"), 0)
                })
                yield* next
                const blocked = yield* page.evaluateInMainWorld(() => 42).pipe(
                  Deadline.within("150 millis"),
                  Effect.exit
                )
                assert.strictEqual(reason(blocked), "PromptBlocking")
              }
              assert.isTrue(
                Option.isNone(
                  yield* Runtime.evaluate({ expression: "42" }).pipe(
                    Protocol.on(session),
                    BrowserClock.timeoutOption(100)
                  )
                ),
                "recovery must leave the original dialog untouched"
              )
            })).pipe(Effect.provide(browser.connect))
            assert.isFalse((yield* browser.targets).some((info) => info.targetId === target.targetId))
          }),
        60_000
      )

      for (const mode of ["created", "reclaimed with no settings"] as const) {
        it.effect(
          `a context ${mode} answers an unrouted HTTP challenge with the server's response`,
          () =>
            Effect.gen(function*() {
              const browser = yield* launch
              const server = yield* Effect.acquireRelease(
                Effect.promise(async () => {
                  const server = createServer((_, response) => {
                    response.statusCode = 401
                    response.setHeader("WWW-Authenticate", "Basic realm=\"claims\"")
                    response.setHeader("Content-Type", "text/html")
                    response.end("<title>denied</title>")
                  })
                  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
                  return server
                }),
                (server) =>
                  Effect.promise(() =>
                    new Promise<void>((resolve) => {
                      server.closeAllConnections()
                      server.close(() => resolve())
                    })
                  )
              )
              const address = server.address()
              assert(address && typeof address !== "string")
              const old = yield* Scope.make()
              yield* Effect.addFinalizer(() => Scope.close(old, Exit.void))
              const services = yield* Layer.buildWithScope(browser.connect, old)
              const claim = yield* Effect.gen(function*() {
                const context = yield* api.UserContext.create({ reclaimable: true })
                return yield* api.UserContext.claim(context)
              }).pipe(Scope.provide(old), Effect.provide(services))
              yield* handoff(old)
              yield* Effect.scoped(Effect.gen(function*() {
                const context = mode === "created"
                  ? yield* api.UserContext.create({ reclaimable: true })
                  : (yield* api.UserContext.reclaim(claim)).context
                const page = yield* context.newPage
                const exit = yield* page.goto(`http://127.0.0.1:${address.port}/auth`).pipe(
                  Deadline.within("5 seconds"),
                  Effect.exit
                )
                assert.isTrue(Exit.isSuccess(exit), `goto: ${String(exit)}`.slice(0, 240))
              })).pipe(Effect.provide(browser.connect))
            }),
          60_000
        )
      }
    }
  )
})
