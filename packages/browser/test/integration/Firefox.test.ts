/**
 * L0 against a real Firefox over WebDriver BiDi: the launcher, the raw connection, the error table, and the
 * corrections the BiDi model carries.
 *
 * It runs against the pinned Firefox (`browsers.ts`), in the Nix environment `pnpm test:integration` enters;
 * another version fails it.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Browser from "@usestrider/browser/bidi-protocol/Browser"
import * as BrowsingContext from "@usestrider/browser/bidi-protocol/BrowsingContext"
import * as Script from "@usestrider/browser/bidi-protocol/Script"
import * as Session from "@usestrider/browser/bidi-protocol/Session"
import { BidiConnection, Protocol } from "@usestrider/browser/protocol"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as BidiWire from "../../src/internal/bidiWire.ts"
import * as FirefoxLauncher from "../../src/internal/firefoxLauncher.ts"
import * as ProtocolClient from "../../src/internal/protocolClient.ts"
import { assertPinned, firefox } from "./browsers.ts"
import { fixtures, record } from "./record.ts"

const executable = firefox.executable
const timeout = 60_000

describe("Firefox over WebDriver BiDi", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect("drives a tab through the generated commands", () =>
        Effect.gen(function*() {
          const { transport: launched } = yield* FirefoxLauncher.launch({ executablePath: executable })
          const transport = record(launched, BidiWire.wire, fixtures.bidi)
          const bidi = yield* BidiConnection.make(transport)
          const on = Protocol.on(bidi.session)
          const session = yield* Session.new_({ capabilities: {} }).pipe(on)
          assert.strictEqual(session.capabilities.browserName, "firefox")
          assertPinned("Firefox", String(session.capabilities.browserVersion), firefox.version)
          yield* Session.subscribe({ events: ["browsingContext"] }).pipe(on)
          // The first correction: Firefox's contextCreated has no hasPlannedNavigation
          const created = yield* bidi.session.subscribe(BrowsingContext.contextCreated)
          const { context } = yield* BrowsingContext.create({ type: "tab" }).pipe(on)
          const event = yield* Stream.runHead(created)
          assert(event._tag === "Some")
          assert.strictEqual(event.value.context, context)
          yield* BrowsingContext.navigate({ context, url: "data:text/html,<title>Strider</title>", wait: "complete" })
            .pipe(on)
          const title = yield* Script.evaluate({
            expression: "document.title",
            target: { context },
            awaitPromise: false
          }).pipe(on)
          assert(title.type === "success")
          assert.deepStrictEqual(title.result, { type: "string", value: "Strider" })
        }), timeout)

      it.effect(
        "renders a window's page at full rate after another tab opens in the same window",
        () =>
          Effect.gen(function*() {
            const { transport } = yield* FirefoxLauncher.launch({ executablePath: executable })
            const bidi = yield* BidiConnection.make(transport)
            const on = Protocol.on(bidi.session)
            yield* Session.new_({ capabilities: {} }).pipe(on)
            const { userContext } = yield* Browser.createUserContext({}).pipe(on)
            // The page Strider makes: a window of a user context of its own
            const { context } = yield* BrowsingContext.create({ type: "window", userContext }).pipe(on)
            yield* BrowsingContext.navigate({ context, url: "data:text/html,<title>page</title>", wait: "complete" })
              .pipe(on)
            // A second tab in the page's window, as the macOS runs show Firefox adding (about:newtab, unrequested)
            yield* BrowsingContext.create({ type: "tab", referenceContext: context, background: false }).pipe(on)
            const frames = yield* Script.evaluate({
              expression: `new Promise((resolve) => {
              let frames = 0
              const end = performance.now() + 2000
              const tick = () => performance.now() < end ? (frames++, requestAnimationFrame(tick)) : resolve(
                document.visibilityState + ":" + frames
              )
              requestAnimationFrame(tick)
            })`,
              target: { context },
              awaitPromise: true
            }).pipe(on)
            assert(frames.type === "success")
            const [visibility, count] = String((frames.result as { value: unknown }).value).split(":")
            // A tab behind another renders about once a second (QUIRKS.md, Q71): 2 frames in 2 s, not about 120
            assert.strictEqual(visibility, "visible")
            assert.isAbove(Number(count), 30)
          }),
        timeout
      )

      it.effect("keeps the preferences a profile directory of the caller's sets", () =>
        Effect.gen(function*() {
          const fs = yield* FileSystem.FileSystem
          const profile = yield* fs.makeTempDirectoryScoped({ prefix: "strider-firefox-own-" })
          const mine = `user_pref("browser.startup.homepage", "https://example.com");\n`
          yield* fs.writeFileString(`${profile}/user.js`, mine)
          const { transport } = yield* FirefoxLauncher.launch({ executablePath: executable, userDataDir: profile })
          const bidi = yield* BidiConnection.make(transport)
          yield* Session.new_({ capabilities: {} }).pipe(Protocol.on(bidi.session))
          const written = yield* fs.readFileString(`${profile}/user.js`)
          assert.isTrue(written.startsWith(mine), written)
          assert.include(written, `user_pref("app.update.disabledForTesting", true);`)
        }).pipe(Effect.scoped), timeout)

      it.effect("classifies Firefox's error replies with every row of BiDi's table", () =>
        Effect.gen(function*() {
          const { transport: launched } = yield* FirefoxLauncher.launch({ executablePath: executable })
          const transport = record(launched, BidiWire.wire, fixtures.bidi)
          const replies = new Map<number, Deferred.Deferred<Record<string, any>>>()
          yield* transport.messages.pipe(
            Stream.runForEach((text) => {
              const message = JSON.parse(text)
              const reply = replies.get(message.id)
              return reply === undefined ? Effect.void : Deferred.succeed(reply, message)
            }),
            Effect.forkScoped
          )
          let nextId = 1
          const call = Effect.fnUntraced(function*(method: string, params: object) {
            const id = nextId++
            const reply = yield* Deferred.make<Record<string, any>>()
            replies.set(id, reply)
            yield* transport.send(JSON.stringify({ id, method, params }))
            return yield* Deferred.await(reply)
          })
          yield* call("session.new", { capabilities: {} })
          const tree = yield* call("browsingContext.getTree", {})
          const context = tree["result"].contexts[0].context
          const cases: ReadonlyArray<readonly [string, object]> = [
            ["Nope.nothing", {}],
            ["browsingContext.reload", { context, ignoreCache: true }],
            ["browsingContext.navigate", { context }],
            ["browsingContext.navigate", { context: "nope", url: "about:blank" }],
            ["script.callFunction", {
              functionDeclaration: "(x) => x",
              target: { context },
              awaitPromise: false,
              arguments: [{ sharedId: "nope" }]
            }]
          ]
          const rows: Array<ProtocolClient.ErrorMatcher | undefined> = []
          for (const [method, params] of cases) {
            const reply = yield* call(method, params)
            assert.strictEqual(reply["type"], "error", `${method} should fail`)
            rows.push(ProtocolClient.match(BidiWire.errors, { code: reply["error"], message: reply["message"] }))
          }
          // Each case matches its own row, in table order, so every row is still produced by this browser
          assert.deepStrictEqual(rows, [...BidiWire.errors])
        }), timeout)

      it.effect("decodes a navigationStarted without a url (the second correction)", () =>
        Effect.gen(function*() {
          const fs = yield* FileSystem.FileSystem
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-test-" })
          yield* fs.writeFileString(
            `${directory}/page.html`,
            `<title>leave</title><script>addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = "" })</script>`
          )
          const { transport: launched } = yield* FirefoxLauncher.launch({ executablePath: executable })
          const transport = record(launched, BidiWire.wire, fixtures.bidi)
          const bidi = yield* BidiConnection.make(transport)
          const on = Protocol.on(bidi.session)
          yield* Session.new_({ capabilities: { alwaysMatch: { unhandledPromptBehavior: { default: "ignore" } } } })
            .pipe(on)
          yield* Session.subscribe({ events: ["browsingContext"] }).pipe(on)
          const { context } = yield* BrowsingContext.create({ type: "tab" }).pipe(on)
          yield* BrowsingContext.navigate({ context, url: `file://${directory}/page.html`, wait: "complete" }).pipe(on)
          yield* Script.evaluate({ expression: "1", target: { context }, awaitPromise: false, userActivation: true })
            .pipe(on)
          const started = yield* bidi.session.subscribe(BrowsingContext.navigationStarted)
          const opened = yield* bidi.session.subscribe(BrowsingContext.userPromptOpened)
          yield* BrowsingContext.close({ context, promptUnload: true }).pipe(on, Effect.forkScoped)
          const prompt = yield* Stream.runHead(opened)
          if (prompt._tag === "None") return
          yield* BrowsingContext.handleUserPrompt({ context, accept: false }).pipe(on)
          // Whether or not it carries a url, it decodes
          const event = yield* started.pipe(Stream.take(1), Stream.runCollect, Effect.timeoutOption("2 seconds"))
          if (event._tag === "Some") assert.strictEqual(event.value[0]?.context, context)
        }), timeout)
    }
  )
})
