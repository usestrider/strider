/** What a page target id does depends on who is attached, and a context can outlive its client or not. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Browser from "@usestrider/browser/cdp/Browser"
import * as Page from "@usestrider/browser/cdp/Page"
import * as Runtime from "@usestrider/browser/cdp/Runtime"
import * as Target from "@usestrider/browser/cdp/Target"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { assertPinned, chromium } from "../browsers.ts"

// The page prerenders and activates by itself, so no client needs to attach to drive it.
const serve = Effect.acquireRelease(
  Effect.promise(async () => {
    const server = createServer((request, response) => {
      const origin = `http://localhost:${(server.address() as { port: number }).port}`
      response.setHeader("Content-Type", "text/html")
      response.end(
        request.url === "/start"
          ? `<script>
              const s = document.createElement('script'); s.type = 'speculationrules';
              s.textContent = JSON.stringify({prerender:[{source:'list',urls:['${origin}/prerendered']}]});
              document.head.append(s);
              setTimeout(() => { location.href = '${origin}/prerendered' }, 1500);
            </script>`
          : "<title>prerendered</title>"
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve))
    return { server, origin: `http://localhost:${(server.address() as { port: number }).port}` }
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
  const driver = yield* CdpConnection.make(transport)
  const version = yield* Browser.getVersion().pipe(Protocol.on(driver.browser))
  assertPinned("Chromium", version.product.split("/")[1]!, chromium.version)
  const targets = Target.getTargets({ filter: [{ exclude: false }] }).pipe(
    Protocol.on(driver.browser),
    Effect.map((reply) => reply.targetInfos)
  )
  return { driver, targets, userDataDir: launched.userDataDir }
})

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

const selfPrerender = Effect.fnUntraced(function*({ driver, targets }: Effect.Success<typeof launch>, origin: string) {
  const { targetId } = yield* Target.createTarget({ url: `${origin}/start` }).pipe(Protocol.on(driver.browser))
  const before = yield* until(
    targets,
    (infos) => infos.some((info) => info.type === "tab" && info.url === `${origin}/start`)
  )
  const tab = before.find((info) => info.type === "tab" && info.url === `${origin}/start`)!
  const url = `${origin}/prerendered`
  const after = yield* until(targets, (infos) => infos.some((info) => info.type === "page" && info.url === url))
  const page = after.find((info) => info.type === "page" && info.url === url)!
  const { sessionId } = yield* Target.attachToTarget({ targetId: page.targetId, flatten: true }).pipe(
    Protocol.on(driver.browser)
  )
  const { result } = yield* Runtime.evaluate({
    expression: "performance.getEntriesByType('navigation')[0].activationStart",
    returnByValue: true
  }).pipe(Protocol.on(yield* driver.session(sessionId)))
  const activationStart = result.value as number
  assert.isNumber(activationStart)
  assert.isTrue(after.some((info) => info.type === "tab" && info.url === url && info.targetId === tab.targetId))
  return { targetId, page, activationStart }
})

describe("Chromium identity by attachment", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect(
        "a real prerender activation with no target client attached keeps the page target id",
        () =>
          Effect.gen(function*() {
            const { origin } = yield* serve
            const { activationStart, page, targetId } = yield* selfPrerender(yield* launch, origin)
            assert.isAbove(activationStart, 0, "the page must really have activated from a prerender")
            assert.strictEqual(page.targetId, targetId)
          }),
        60_000
      )

      it.effect(
        "Strider's browser-level page auto-attach keeps the page id on an ordinary navigation, not prerender activation",
        () =>
          Effect.gen(function*() {
            const { origin } = yield* serve
            const browser = yield* launch
            yield* Target.setAutoAttach({
              autoAttach: true,
              waitForDebuggerOnStart: false,
              flatten: true,
              filter: [{ type: "page" }, { type: "service_worker" }, { type: "shared_worker" }, { exclude: true }]
            }).pipe(Protocol.on(browser.driver.browser))
            const { activationStart, page, targetId } = yield* selfPrerender(browser, origin)
            assert.strictEqual(activationStart, 0, "the navigation must be ordinary, not an activation")
            assert.strictEqual(page.targetId, targetId)
          }),
        60_000
      )

      it.effect(
        "tab child attachment preserves an observed prerender realm and remote object",
        () =>
          Effect.gen(function*() {
            const { origin } = yield* serve
            const { driver, targets } = yield* launch
            const { targetId } = yield* Target.createTarget({ url: `${origin}/idle` }).pipe(Protocol.on(driver.browser))
            const listed = yield* until(
              targets,
              (infos) => infos.some((info) => info.type === "tab" && info.url === `${origin}/idle`)
            )
            const tabId = listed.find((info) => info.type === "tab" && info.url === `${origin}/idle`)!.targetId
            const { sessionId } = yield* Target.attachToTarget({ targetId: tabId, flatten: true }).pipe(
              Protocol.on(driver.browser)
            )
            const tab = yield* driver.session(sessionId)
            const children: Array<Target.AttachedToTargetParams> = []
            const attached = yield* tab.subscribe(Target.attachedToTarget)
            yield* Stream.runForEach(attached, (event) =>
              Effect.sync(() => {
                children.push(event)
              })).pipe(Effect.forkChild)
            yield* Target.setAutoAttach({
              autoAttach: true,
              waitForDebuggerOnStart: false,
              flatten: true,
              filter: [{ exclude: false }]
            }).pipe(Protocol.on(tab))
            yield* until(
              Effect.sync(() => children),
              (events) => events.some((event) => event.targetInfo.targetId === targetId)
            )
            const main = yield* driver.session(
              children.find((event) => event.targetInfo.targetId === targetId)!.sessionId
            )
            yield* until(
              Runtime.evaluate({ expression: "location.href + ' ' + document.readyState", returnByValue: true }).pipe(
                Protocol.on(main)
              ),
              (reply) => reply.result.value === `${origin}/idle complete`
            )
            yield* Runtime.evaluate({
              expression:
                `(() => { const s = document.createElement('script'); s.type = 'speculationrules'; s.textContent = JSON.stringify({prerender:[{source:'list',urls:['${origin}/prerendered']}]}); document.head.append(s); })()`
            }).pipe(Protocol.on(main))
            yield* until(
              Effect.sync(() => children),
              (events) => events.some((event) => event.targetInfo.subtype === "prerender")
            )
            const speculative = children.find((event) => event.targetInfo.subtype === "prerender")!
            const pre = yield* driver.session(speculative.sessionId)
            const contexts: Array<Runtime.ExecutionContextDescription> = []
            const created = yield* pre.subscribe(Runtime.executionContextCreated)
            yield* Stream.runForEach(created, (event) =>
              Effect.sync(() => {
                contexts.push(event.context)
              })).pipe(Effect.forkChild)
            yield* Runtime.enable().pipe(Protocol.on(pre))
            yield* until(
              Runtime.evaluate({ expression: "location.href + ' ' + document.readyState", returnByValue: true }).pipe(
                Protocol.on(pre)
              ),
              (reply) => reply.result.value === `${origin}/prerendered complete`
            )
            const before = yield* Page.getFrameTree().pipe(Protocol.on(pre))
            const { result: object } = yield* Runtime.evaluate({ expression: "window.marker = {}" }).pipe(
              Protocol.on(pre)
            )
            assert.isDefined(object.objectId)
            const contextIds = contexts.map((context) => context.uniqueId)
            assert.isNotEmpty(contextIds)
            yield* Runtime.evaluate({ expression: `location.href = '${origin}/prerendered'` }).pipe(Protocol.on(main))
            const activated = yield* until(
              Runtime.evaluate({
                expression: "performance.getEntriesByType('navigation')[0].activationStart",
                returnByValue: true
              }).pipe(Protocol.on(pre)),
              (reply) => typeof reply.result.value === "number" && reply.result.value > 0
            )
            assert.isAbove(activated.result.value as number, 0)
            const after = yield* Page.getFrameTree().pipe(Protocol.on(pre))
            assert.strictEqual(after.frameTree.frame.id, before.frameTree.frame.id)
            assert.strictEqual(after.frameTree.frame.loaderId, before.frameTree.frame.loaderId)
            assert.deepStrictEqual(contexts.map((context) => context.uniqueId), contextIds)
            const same = yield* Runtime.callFunctionOn({
              objectId: object.objectId!,
              functionDeclaration: "function() { return this === window.marker }",
              returnByValue: true
            }).pipe(Protocol.on(pre))
            assert.isTrue(same.result.value)
            const current = yield* targets
            assert.isTrue(current.some((info) => info.targetId === tabId && info.url === `${origin}/prerendered`))
            assert.isFalse(current.some((info) => info.targetId === targetId))
            assert.isTrue(
              current.some((info) => info.targetId === speculative.targetInfo.targetId && info.subtype === undefined)
            )
          }),
        60_000
      )

      for (const disposeOnDetach of [false, true]) {
        it.effect(
          `a tab after its context's client closes, disposeOnDetach ${disposeOnDetach}`,
          () =>
            Effect.gen(function*() {
              const { origin } = yield* serve
              const { targets, userDataDir } = yield* launch
              const [port] = (yield* Effect.promise(() => readFile(`${userDataDir}/DevToolsActivePort`, "utf8"))).split(
                "\n"
              )
              const url = yield* Effect.promise(async () => {
                const response = await fetch(`http://127.0.0.1:${port}/json/version`)
                return (await response.json() as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl
              })
              const { browserContextId, targetId } = yield* Effect.gen(function*() {
                const client = yield* CdpConnection.make(yield* Transport.webSocket(url))
                const { browserContextId } = yield* Target.createBrowserContext({ disposeOnDetach }).pipe(
                  Protocol.on(client.browser)
                )
                const { targetId } = yield* Target.createTarget({ url: `${origin}/idle`, browserContextId }).pipe(
                  Protocol.on(client.browser)
                )
                return { browserContextId, targetId }
              }).pipe(Effect.scoped)
              assert.isString(browserContextId)
              const listed = (infos: ReadonlyArray<Target.TargetInfo>) =>
                infos.some((info) => info.targetId === targetId)
              if (disposeOnDetach) {
                yield* until(targets, (infos) => !listed(infos))
              } else {
                // A bound, not proof by delay: the disposing case above answers well within it.
                yield* Effect.sleep("1 second")
                assert.isTrue(listed(yield* targets))
              }
            }),
          60_000
        )
      }
    }
  )
})
