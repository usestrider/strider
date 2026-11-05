/**
 * What only the CDP adapter and the Chromium launcher do: crashes, attaching to a browser someone else owns,
 * and the launcher's failures.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Deadline, Expect } from "@usestrider/browser"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Target from "@usestrider/browser/cdp/Target"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Adapter from "../../../src/internal/adapter.ts"
import * as BrowserImpl from "../../../src/internal/browser.ts"
import * as CdpAdapter from "../../../src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { LocatorImpl } from "../../../src/internal/locator.ts"
import * as L1Target from "../../../src/Target.ts"
import { assertPinned, chromium } from "../browsers.ts"
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
            const { transport } = yield* ChromiumLauncher.launch({ executablePath: executable })
            const cdp = yield* CdpConnection.make(transport)
            const { targetInfos } = yield* Target.getTargets({}).pipe(Protocol.on(cdp.browser))
            assert.deepStrictEqual(targetInfos.filter((target) => target.type === "page"), [])
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
            const page = yield* adapter.createPage(adapter.defaultContext)
            const url = `${served.origin}/crash-me`
            const navigation = yield* adapter.navigate(page, url, { referrer: Option.none() })
            yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
            // Probe 25: CDP takes several clients at once
            const active = yield* Effect.promise(() =>
              import("node:fs/promises").then((fs) => fs.readFile(`${launched.userDataDir}/DevToolsActivePort`, "utf8"))
            )
            const [port, browserPath] = active.split("\n")
            const other = yield* CdpConnection.make(yield* Transport.webSocket(`ws://127.0.0.1:${port}${browserPath}`))
            const { targetInfos } = yield* Target.getTargets({}).pipe(Protocol.on(other.browser))
            const target = targetInfos.find((info) => info.url === url)
            assert.isDefined(target)
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
