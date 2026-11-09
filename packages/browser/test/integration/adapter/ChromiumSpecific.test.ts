/**
 * What only the CDP adapter and the Chromium launcher do: crashes, attaching to a browser someone else owns,
 * and the launcher's failures.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Deadline, Expect, Ledger } from "@usestrider/browser"
import * as BrowserCdp from "@usestrider/browser/cdp/Browser"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Target from "@usestrider/browser/cdp/Target"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Adapter from "../../../src/internal/adapter.ts"
import * as BrowserImpl from "../../../src/internal/browser.ts"
import * as CdpAdapter from "../../../src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import * as DevToolsActivePort from "../../../src/internal/devToolsActivePort.ts"
import { LocatorImpl } from "../../../src/internal/locator.ts"
import * as L1Target from "../../../src/Target.ts"
import { assertPinned, chromium } from "../browsers.ts"
import { useXvfb } from "../stockWebKit.ts"
import { makeRecorder, site } from "./harness.ts"

const executable = chromium.executable
const timeout = 60_000

describe("Chromium adapter, CDP only", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect(
        "connects Chromium with no startup page",
        () =>
          Effect.gen(function*() {
            const { transport } = yield* ChromiumLauncher.launch({
              executablePath: executable,
              args: ["--no-startup-window"]
            })
            const cdp = yield* CdpConnection.make(transport)
            const { targetInfos } = yield* Target.getTargets({}).pipe(Protocol.on(cdp.browser))
            assert.deepStrictEqual(targetInfos.filter((target) => target.type === "page"), [])
          }),
        timeout
      )

      for (const debugging of ["pipe", "port"] as const) {
        for (const headless of [true, false]) {
          for (const createPage of [false, true]) {
            it.effect(
              `cleans up windowless ${debugging} Chromium ${headless ? "headless" : "headed"} ${
                createPage ? "after the last page" : "before any page"
              }`,
              () =>
                Effect.gen(function*() {
                  if (!headless && process.platform === "linux") yield* useXvfb()
                  const fs = yield* FileSystem.FileSystem
                  const items = new Set<string>()
                  const result = yield* Effect.scoped(
                    Effect.gen(function*() {
                      const launched =
                        yield* (debugging === "pipe" ? ChromiumLauncher.launch : ChromiumLauncher.launchWithPort)({
                          executablePath: executable,
                          headless,
                          args: ["--no-startup-window"]
                        })
                      const cdp = yield* CdpConnection.make(launched.transport)
                      const version = yield* BrowserCdp.getVersion().pipe(Protocol.on(cdp.browser))
                      assertPinned("Chromium", version.product.split("/")[1]!, chromium.version)
                      const targets = () =>
                        Target.getTargets({}).pipe(
                          Protocol.on(cdp.browser),
                          Effect.map((reply) => reply.targetInfos.filter((target) => target.type === "page"))
                        )
                      assert.deepStrictEqual(yield* targets(), [])
                      if (createPage) {
                        const { targetId } = yield* Target.createTarget({ url: "about:blank", newWindow: true }).pipe(
                          Protocol.on(cdp.browser)
                        )
                        assert.lengthOf(yield* targets(), 1)
                        yield* Target.setDiscoverTargets({ discover: true }).pipe(Protocol.on(cdp.browser))
                        const destroyed = yield* cdp.browser.subscribe(Target.targetDestroyed)
                        const ended = yield* destroyed.pipe(
                          Stream.filter((event) => event.targetId === targetId),
                          Stream.runHead,
                          Effect.forkChild
                        )
                        yield* Target.closeTarget({ targetId }).pipe(Protocol.on(cdp.browser))
                        yield* Fiber.join(ended)
                        assert.deepStrictEqual(yield* targets(), [])
                      }
                      assert.isTrue(yield* launched.launched.handle.isRunning)
                      assert.isTrue(yield* fs.exists(launched.launched.userDataDir))
                      assert.include(launched.launched.args, "--no-startup-window")
                      return launched
                    }).pipe(Effect.provideService(Ledger.CurrentLedger, {
                      add: (item) =>
                        Effect.sync(() => {
                          items.add(JSON.stringify(item))
                        }),
                      remove: (item) =>
                        Effect.sync(() => {
                          items.delete(JSON.stringify(item))
                        })
                    }))
                  )
                  assert.isFalse(yield* result.launched.handle.isRunning)
                  assert.isFalse(yield* fs.exists(result.launched.userDataDir))
                  yield* result.transport.closed
                  assert.strictEqual(items.size, 0)
                }),
              timeout
            )
          }
        }
      }

      for (const debugging of ["pipe", "port"] as const) {
        it.effect(
          `configures the first isolated page with a windowless ${debugging} browser`,
          () =>
            Effect.gen(function*() {
              const served = yield* site
              const backend = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
                const { transport } =
                  yield* (debugging === "pipe" ? ChromiumLauncher.launch : ChromiumLauncher.launchWithPort)({
                    executablePath: executable,
                    args: ["--no-startup-window"]
                  })
                return yield* CdpAdapter.connect(transport, { sink, ownership: "launched" })
              }))
              yield* Effect.gen(function*() {
                const browser = yield* Browser.Browser
                assert.deepStrictEqual(yield* browser.defaultContext.pages, [])
                assert.deepStrictEqual(yield* browser.pages, [])
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* Browser.newPage({ emulation: { viewport: { width: 640, height: 480 } } })
                  assert.deepStrictEqual(
                    yield* page.evaluateInMainWorld(() => [document.URL, innerWidth, innerHeight, devicePixelRatio]),
                    ["about:blank", 640, 480, 1]
                  )
                  assert.deepStrictEqual(yield* browser.defaultContext.pages, [])
                }))
                yield* Effect.scoped(Effect.gen(function*() {
                  const context = yield* browser.newContext()
                  yield* context.addInitScript(() => {
                    Object.defineProperty(globalThis, "fromInit", { value: "ready" })
                  })
                  const page = yield* context.newPage
                  yield* page.goto(`${served.origin}/init`)
                  assert.strictEqual(
                    yield* page.evaluateInMainWorld(() => Reflect.get(globalThis, "seenByAuthor")),
                    "string"
                  )
                }))
                assert.deepStrictEqual(yield* browser.pages, [])
              }).pipe(Effect.provide(backend))
            }),
          timeout
        )
      }

      for (const candidate of [false, true]) {
        it.effect(
          `reads persisted storage and preserves a supplied profile on ${candidate ? "windowless" : "ordinary"} launch`,
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const served = yield* site
              const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-persistent-test-" })
              yield* fs.writeFileString(`${directory}/caller-owned`, "keep")
              for (const round of [0, 1]) {
                let gracefulClose: Effect.Effect<unknown, unknown> = Effect.void
                let child: import("../../../src/internal/launch.ts").Launched | undefined
                const backend = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
                  const { launched, transport } =
                    yield* (round === 0 ? ChromiumLauncher.launchWithPort : ChromiumLauncher.launch)({
                      executablePath: executable,
                      args: candidate ? ["--no-startup-window"] : [],
                      userDataDir: directory
                    })
                  child = launched
                  if (round === 0) {
                    const { port, browserPath } = yield* DevToolsActivePort.read(directory)
                    const peer = yield* CdpConnection.make(
                      yield* Transport.webSocket(`ws://127.0.0.1:${port}${browserPath}`)
                    )
                    gracefulClose = BrowserCdp.close().pipe(Protocol.on(peer.browser), Effect.ignore)
                  }
                  return yield* CdpAdapter.connect(transport, { sink, ownership: "launched" })
                }))
                yield* Effect.scoped(
                  Effect.gen(function*() {
                    const browser = yield* Browser.Browser
                    assert.lengthOf(yield* browser.defaultContext.pages, candidate ? 0 : 1)
                    const context = yield* browser.defaultContext.control
                    const page = yield* context.newPage
                    yield* page.goto(`${served.origin}/hello`)
                    if (round === 0) {
                      yield* page.evaluateInMainWorld(() => localStorage.setItem("windowless", "kept"))
                      // Seed durable browser data with Chromium's graceful close. Scope shutdown is a signal,
                      // which does not guarantee flushing newly written localStorage on either launch mode.
                      yield* gracefulClose
                      yield* child!.handle.exitCode
                    } else {
                      assert.strictEqual(
                        yield* page.evaluateInMainWorld(() => localStorage.getItem("windowless")),
                        "kept"
                      )
                    }
                  }).pipe(Effect.provide(backend))
                )
                assert.isDefined(child)
                assert.isFalse(yield* child!.handle.isRunning)
                assert.strictEqual(yield* fs.readFileString(`${directory}/caller-owned`), "keep")
              }
            }),
          timeout
        )
      }

      it.effect(
        "keeps a supplied profile's session cookie when the default context's last opened page closes",
        () =>
          Effect.gen(function*() {
            const fs = yield* FileSystem.FileSystem
            const served = yield* site
            const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-session-cookie-test-" })
            const backend = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
              const { transport } = yield* ChromiumLauncher.launch({
                executablePath: executable,
                userDataDir: directory
              })
              return yield* CdpAdapter.connect(transport, { sink, ownership: "launched" })
            }))
            yield* Effect.scoped(
              Effect.gen(function*() {
                const browser = yield* Browser.Browser
                const context = yield* browser.defaultContext.control
                yield* context.cookies.set({
                  name: "session",
                  value: "1",
                  scope: { url: served.origin }
                })
                const opened = yield* context.newPage
                yield* opened.close()
                const page = yield* context.newPage
                yield* page.goto(`${served.origin}/hello`)
                assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "session=1")
              }).pipe(Effect.provide(backend))
            )
          }),
        timeout
      )

      it.effect(
        "attributes a route-fulfilled redirect to the route and its final response to the network",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const facts = makeRecorder()
            const { transport } = yield* ChromiumLauncher.launch({ executablePath: executable })
            const adapter = yield* CdpAdapter.connect(transport, { sink: facts.sink, ownership: "launched" })
            assertPinned("Chromium", adapter.info.version, chromium.version)
            const page = yield* adapter.createPage(adapter.defaultContext)
            const navigation = yield* adapter.navigate(page, `${served.origin}/hello`, { referrer: Option.none() })
            const ended = yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
            assert(ended.outcome._tag === "Committed")
            const realm = yield* adapter.realm(ended.outcome.document, { _tag: "Main" })
            const start = `${served.origin}/r-start`
            const end = `${served.origin}/json`
            yield* adapter.declare({ _tag: "UserContext", context: adapter.defaultContext }, {
              _tag: "Intercept",
              patterns: [start],
              phases: ["request"]
            })
            const fetched = yield* adapter.evaluate(realm, {
              functionDeclaration: "() => fetch('/r-start').then((response) => response.text())",
              arguments: [],
              awaitPromise: true,
              result: "value",
              userActivation: false
            }).pipe(Effect.forkChild)
            const paused = yield* facts.when("ObligationOpened", (fact) =>
              fact.subject._tag === "PausedRequest" && fact.subject.request.url === start)
            yield* adapter.resolve(paused.obligation, {
              _tag: "Fulfill",
              status: 302,
              headers: { location: end },
              body: new Uint8Array()
            })
            const redirected = yield* facts.when("ResponseReceived", (fact) =>
              fact.response.url === start)
            const landed = yield* facts.when("ResponseReceived", (fact) => fact.response.url === end)
            assert.deepStrictEqual(
              [redirected, landed].map(({ response }) => [response.url, response.status, response.servedBy]),
              [[start, 302, "route"], [end, 200, "network"]]
            )
            assert.notStrictEqual(redirected.response.hop, landed.response.hop)
            const result = yield* Fiber.join(fetched)
            assert(result._tag === "Value")
            assert.deepStrictEqual(result.value, { type: "string", value: "{\"hello\":\"world\"}" })
            assert.isFalse(served.served.some((request) => request.path === "/r-start"))
            assert.isTrue(served.served.some((request) => request.path === "/json"))
          }),
        timeout
      )

      it.effect(
        "click sends stay ordered across a suspended transport and do not wait for earlier acknowledgments",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const entered = yield* Deferred.make<void>()
            const proceed = yield* Deferred.make<void>()
            const allSent = yield* Deferred.make<void>()
            const sent: Array<string> = []
            const ids = new Set<number>()
            const backend = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
              const { transport } = yield* ChromiumLauncher.launch({ executablePath: executable })
              return yield* CdpAdapter.connect({
                ...transport,
                send: Effect.fnUntraced(function*(message: string) {
                  const wire = JSON.parse(message)
                  if (wire.method === "Input.dispatchMouseEvent") {
                    if (sent.length === 0) {
                      yield* Deferred.succeed(entered, undefined)
                      yield* Deferred.await(proceed)
                    }
                    ids.add(wire.id)
                    sent.push(wire.params.type)
                  }
                  yield* transport.send(message)
                  if (sent.length === 3) yield* Deferred.succeed(allSent, undefined)
                }),
                messages: transport.messages.pipe(Stream.mapEffect((message) =>
                  ids.has(JSON.parse(message).id)
                    ? Effect.as(Deferred.await(allSent), message)
                    : Effect.succeed(message)
                ))
              }, { sink, ownership: "launched" })
            }))
            yield* Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const html =
                `<button id="go">Go</button><script>window.log=[];for(const type of ['mousemove','mousedown','mouseup','click'])document.getElementById('go').addEventListener(type,e=>log.push([e.type,e.isTrusted,e.buttons]));</script>`
              yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`)
              const click = yield* page.locator("#go").click().pipe(Deadline.within("5 seconds"), Effect.forkChild)
              yield* Deferred.await(entered)
              assert.deepStrictEqual(sent, [])
              yield* Deferred.succeed(proceed, undefined)
              yield* Fiber.join(click)
              assert.deepStrictEqual(sent, ["mouseMoved", "mousePressed", "mouseReleased"])
              assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => (window as any).log), [
                ["mousemove", true, 0],
                ["mousedown", true, 1],
                ["mouseup", true, 0],
                ["click", true, 0]
              ])
            }).pipe(Effect.provide(backend))
          }),
        timeout
      )

      it.effect(
        "keeps click acknowledgments sequential after enabling HTML drag interception",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const pending = new Set<number>()
            let interceptionEnabled = false
            let check = false
            const backend = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
              const { transport } = yield* ChromiumLauncher.launch({ executablePath: executable })
              return yield* CdpAdapter.connect({
                ...transport,
                send: (message) =>
                  Effect.suspend(() => {
                    const wire = JSON.parse(message)
                    if (wire.method === "Input.setInterceptDrags") interceptionEnabled = wire.params.enabled
                    if (check && wire.method === "Input.dispatchMouseEvent") {
                      assert.strictEqual(pending.size, 0)
                      pending.add(wire.id)
                    }
                    return transport.send(message)
                  }),
                messages: transport.messages.pipe(Stream.map((message) => {
                  pending.delete(JSON.parse(message).id)
                  return message
                }))
              }, { sink, ownership: "launched" })
            }))
            yield* Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const html =
                `<button id="go" onclick="this.textContent='Clicked'">Go</button><div id="card" draggable="true" style="position:absolute;left:0;top:100px;width:40px;height:40px">Card</div><div id="bin" style="position:absolute;left:300px;top:100px;width:40px;height:40px" ondragover="event.preventDefault()" ondrop="event.preventDefault()">Bin</div>`
              yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`)
              yield* page.locator("#card").dragTo(page.locator("#bin"), { steps: 5 })
              assert.isTrue(interceptionEnabled)
              check = true
              yield* page.locator("#go").click()
              assert.strictEqual(yield* page.locator("#go").readText, "Clicked")
              assert.strictEqual(pending.size, 0)
            }).pipe(Effect.provide(backend))
          }),
        timeout
      )

      for (const crossSite of [false, true]) {
        it.effect(
          `keeps click acknowledgments sequential on a page with a ${crossSite ? "cross-site" : "same-site"} frame`,
          () =>
            Effect.gen(function*() {
              const served = yield* site
              const pending = new Set<number>()
              const sent: Array<string> = []
              const backend = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
                const { transport } = yield* ChromiumLauncher.launch({ executablePath: executable })
                return yield* CdpAdapter.connect({
                  ...transport,
                  send: (message) =>
                    Effect.suspend(() => {
                      const wire = JSON.parse(message)
                      if (wire.method === "Input.dispatchMouseEvent") {
                        assert.strictEqual(
                          pending.size,
                          0,
                          "the preceding input must be acknowledged before the next send"
                        )
                        pending.add(wire.id)
                        sent.push(wire.params.type)
                      }
                      return transport.send(message)
                    }),
                  messages: transport.messages.pipe(Stream.map((message) => {
                    pending.delete(JSON.parse(message).id)
                    return message
                  }))
                }, { sink, ownership: "launched" })
              }))
              yield* Effect.gen(function*() {
                const page = yield* Browser.newPage()
                const child =
                  `<body style="margin:0"><button style="width:100px;height:100px" onclick="this.textContent=String(Number(this.textContent)+1)">0</button><script>for(const type of ['mousemove','mousedown','mouseup','click'])document.addEventListener(type,e=>document.body.setAttribute('data-events',(document.body.getAttribute('data-events')||'')+e.type+','),true)</script>`
                const childUrl = `${crossSite ? served.crossSite : served.origin}/fixture?html=${
                  encodeURIComponent(child)
                }`
                const parent = `<body style="margin:0"><iframe style="border:0" src="${childUrl}"></iframe>`
                yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(parent)}`)
                const frame = page.frame(page.locator("iframe"))
                yield* frame.getByRole("button").pipe(Expect.toHaveText("0"))
                const snapshot = yield* page.snapshot()
                const button = [...snapshot.refs].find(([ref, node]) =>
                  ref.startsWith("f1") && node.role.role === "button"
                )!
                yield* snapshot.ref(button[0]).click()
                yield* frame.getByRole("button").pipe(Expect.toHaveText("1"))
                // Coordinate input has no frame argument: the page's frame tree must protect it too.
                yield* page.mouse.click({ x: 50, y: 50 })
                yield* frame.getByRole("button").pipe(Expect.toHaveText("2"))
                assert.strictEqual(
                  yield* frame.locator("body").evaluate((el) => el.getAttribute("data-events")),
                  "mousemove,mousedown,mouseup,click,mousemove,mousedown,mouseup,click,"
                )
                assert.deepStrictEqual(sent, [
                  "mouseMoved",
                  "mousePressed",
                  "mouseReleased",
                  "mouseMoved",
                  "mousePressed",
                  "mouseReleased"
                ])
                assert.strictEqual(pending.size, 0)
              }).pipe(Effect.provide(backend))
            }),
          timeout
        )
      }

      for (const stop of ["interrupted", "mouse interrupted", "rejected", "deadline"] as const) {
        it.effect(
          `a click ${stop} with its replies outstanding has sent its release, and the next gesture works`,
          () =>
            Effect.gen(function*() {
              const served = yield* site
              const released = yield* Deferred.make<void>()
              let pressId: number | undefined
              const sent: Array<string> = []
              const backend = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
                const { transport } = yield* ChromiumLauncher.launch({ executablePath: executable })
                return yield* CdpAdapter.connect({
                  ...transport,
                  send: Effect.fnUntraced(function*(message: string) {
                    const wire = JSON.parse(message)
                    if (wire.method === "Input.dispatchMouseEvent") {
                      if (wire.params.type === "mousePressed" && pressId === undefined) pressId = wire.id
                      sent.push(wire.params.type)
                    }
                    yield* transport.send(message)
                    if (wire.method === "Input.dispatchMouseEvent" && wire.params.type === "mouseReleased") {
                      yield* Deferred.succeed(released, undefined)
                    }
                  }),
                  // The first press's reply: rejected, or never answered, so its click can't finish on its own
                  messages: transport.messages.pipe(
                    Stream.filter((message) =>
                      stop === "rejected" || pressId === undefined || JSON.parse(message).id !== pressId
                    ),
                    Stream.map((message) => {
                      const wire = JSON.parse(message)
                      return wire.id === pressId && pressId !== undefined
                        ? JSON.stringify({
                          id: wire.id,
                          sessionId: wire.sessionId,
                          error: { code: -32000, message: "test rejection after press" }
                        })
                        : message
                    })
                  )
                }, { sink, ownership: "launched" })
              }))
              yield* Effect.gen(function*() {
                const page = yield* Browser.newPage()
                const html =
                  `<button id="go">Go</button><script>window.log=[];for(const type of ['mousedown','mouseup','click'])document.getElementById('go').addEventListener(type,e=>log.push(e.type));</script>`
                yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`, { waitUntil: "load" })
                // A click at a point has no checks of its own, and input before the page has rendered is lost,
                // though the browser answers it; the test's raw click starts after two rendering updates
                yield* page.evaluateInMainWorld(() =>
                  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                )
                const target = page.locator("#go")
                assert(target instanceof LocatorImpl)
                const click = yield* Effect.gen(function*() {
                  if (stop === "mouse interrupted") yield* page.mouse.click({ x: 20, y: 20 })
                  else yield* target.click()
                }).pipe(
                  Deadline.within(stop === "deadline" ? "2 seconds" : "10 seconds"),
                  Effect.forkChild
                )
                yield* Deferred.await(released)
                if (stop === "interrupted" || stop === "mouse interrupted") {
                  yield* Fiber.interrupt(click)
                } else {
                  const error = yield* Fiber.join(click).pipe(Effect.flip)
                  if (stop === "deadline") assert.isTrue(Deadline.isTimeout(error), String(error))
                  else assert.strictEqual(error._tag, "LocatorError")
                }
                assert.isTrue(Option.isNone(target.owner.page.inputState.broken))
                yield* target.click()
                assert.deepStrictEqual(sent, [
                  "mouseMoved",
                  "mousePressed",
                  "mouseReleased",
                  "mouseMoved",
                  "mousePressed",
                  "mouseReleased"
                ])
                assert.deepStrictEqual(yield* page.evaluateInMainWorld(() => (window as any).log), [
                  "mousedown",
                  "mouseup",
                  "click",
                  "mousedown",
                  "mouseup",
                  "click"
                ])
              }).pipe(Effect.provide(backend))
            }),
          timeout
        )
      }

      it.effect(
        "ends a crashed page with PageCrashed; a second client on the same browser crashes it",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const facts = makeRecorder()
            const { launched, transport } = yield* ChromiumLauncher.launchWithPort({ executablePath: executable })
            const adapter = yield* CdpAdapter.connect(transport, { sink: facts.sink, ownership: "launched" })
            assertPinned("Chromium", adapter.info.version, chromium.version)
            // Probe 25: CDP takes several clients at once. Capture creation identity before navigation.
            const { port, browserPath } = yield* DevToolsActivePort.read(launched.userDataDir)
            const other = yield* CdpConnection.make(yield* Transport.webSocket(`ws://127.0.0.1:${port}${browserPath}`))
            const targets = Target.getTargets({}).pipe(
              Protocol.on(other.browser),
              Effect.map(({ targetInfos }) => targetInfos.map((info) => ({ ...info, url: "", title: "about:blank" })))
            )
            const before = new Set((yield* targets).map((info) => info.targetId))
            const page = yield* adapter.createPage(adapter.defaultContext)
            const created = (yield* targets).filter((info) => info.type === "page" && !before.has(info.targetId))
            assert.lengthOf(created, 1)
            const target = created[0]!
            const url = `${served.origin}/crash-me`
            const navigation = yield* adapter.navigate(page, url, { referrer: Option.none() })
            yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
            assert.isTrue((yield* targets).some((info) => info.targetId === target.targetId))
            const { sessionId } = yield* Target.attachToTarget({ targetId: target.targetId, flatten: true }).pipe(
              Protocol.on(other.browser)
            )
            // Page.crash can remain pending until cleanup, so observe its outcome without waiting for a reply.
            yield* Page.crash().pipe(
              Protocol.on(yield* other.session(sessionId)),
              Effect.exit,
              Effect.flatMap((exit) => Effect.log("Page.crash outcome", exit)),
              Effect.forkChild
            )
            const removed = yield* facts.when("NavigableRemoved", (fact) => fact.navigable === page)
            assert.deepStrictEqual(removed.reason, new L1Target.PageCrashed({}))
          }),
        timeout
      )

      it.effect(
        "attaches to a browser it doesn't own: adopts its tabs, pauses none of them",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const facts = makeRecorder()
            const { transport } = yield* ChromiumLauncher.launchWithPort({ executablePath: executable })
            const adapter = yield* CdpAdapter.connect(transport, { sink: facts.sink, ownership: "attached" })
            assertPinned("Chromium", adapter.info.version, chromium.version)
            assert.strictEqual(adapter.pauseScope, "related")
            const adopted = yield* facts.when("PageAdded")
            assert.deepStrictEqual(adopted.origin, { _tag: "Adopted", opener: Option.none() })
            const capabilities = yield* SubscriptionRef.get(adapter.capabilities)
            assert.isFalse(capabilities.has("pauseOnStart.popups"))
            const page = yield* adapter.createPage(adapter.defaultContext)
            const navigation = yield* adapter.navigate(page, `${served.origin}/hello`, { referrer: Option.none() })
            const ended = yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
            assert.strictEqual(ended.outcome._tag, "Committed")
          }),
        timeout
      )

      it.effect(
        "fails what names a page, realm or handle of its own that ended as Gone: never Foreign, nor sent empty",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const facts = makeRecorder()
            const { transport } = yield* ChromiumLauncher.launchWithPort({ executablePath: executable })
            const adapter = yield* CdpAdapter.connect(transport, { sink: facts.sink, ownership: "launched" })
            const page = yield* adapter.createPage(adapter.defaultContext)
            const navigation = yield* adapter.navigate(page, `${served.origin}/hello`, { referrer: Option.none() })
            const ended = yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
            assert(ended.outcome._tag === "Committed")
            const document = ended.outcome.document
            const realm = yield* adapter.realm(document, { _tag: "Main" })
            const call = (functionDeclaration: string, args: ReadonlyArray<Adapter.LocalValue> = []) =>
              adapter.evaluate(realm, {
                functionDeclaration,
                arguments: args,
                awaitPromise: true,
                result: "handle",
                userActivation: false
              })
            // A released handle isn't sent as an empty reference, which the page would read as `undefined`
            const held = yield* call("() => ({ answer: 42 })")
            assert(held._tag === "Value" && held.value.type === "object" && held.value.handle !== undefined)
            yield* adapter.releaseHandles([held.value.handle])
            const released = yield* call("(object) => typeof object", [{ _tag: "Handle", handle: held.value.handle }])
              .pipe(Effect.flip)
            assert.strictEqual(released.reason._tag, "Gone")
            // A call the page's close cuts short ends with its realm, not as the browser's refusal
            const pending = yield* Effect.forkChild(
              call("() => { console.log('waiting'); return new Promise(() => {}) }")
            )
            yield* facts.when("ConsoleMessage", (fact) => fact.message.text === "waiting")
            yield* adapter.closePage(page, { runBeforeUnload: false })
            const cut = yield* Fiber.join(pending).pipe(Effect.flip)
            assert.strictEqual(cut.reason._tag, "Gone")
            yield* facts.when("NavigableRemoved", (fact) => fact.navigable === page)
            // The page and its document ended: naming them is a race L1 handles, not a bug
            const closed = yield* adapter.activatePage(page).pipe(Effect.flip)
            assert.deepStrictEqual(closed.reason, {
              _tag: "Gone",
              target: { _tag: "Page", id: page },
              reason: new L1Target.PageClosed({ by: "command" })
            })
            const replaced = yield* adapter.realm(document, { _tag: "Main" }).pipe(Effect.flip)
            assert.strictEqual(replaced.reason._tag, "Gone")
          }),
        timeout
      )
    }
  )
})
