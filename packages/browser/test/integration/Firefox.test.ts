/**
 * L0 against a real Firefox over WebDriver BiDi: the launcher, the raw connection, the error table, and the
 * corrections the BiDi model carries.
 *
 * Set `STRIDER_FIREFOX` to the executable, or put `firefox` on `PATH`. Without one, the suite is skipped and
 * Vitest reports it as skipped.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as BrowsingContext from "@usestrider/browser/bidi-protocol/BrowsingContext"
import * as Script from "@usestrider/browser/bidi-protocol/Script"
import * as Session from "@usestrider/browser/bidi-protocol/Session"
import { BidiConnection, Protocol } from "@usestrider/browser/protocol"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { existsSync } from "node:fs"
import * as path from "node:path"
import * as BidiWire from "../../src/internal/bidiWire.ts"
import * as FirefoxLauncher from "../../src/internal/firefoxLauncher.ts"
import * as ProtocolClient from "../../src/internal/protocolClient.ts"
import { fixtures, record } from "./record.ts"

const findFirefox = (): string | undefined => {
  const configured = process.env["STRIDER_FIREFOX"]
  if (configured !== undefined && configured !== "") return configured
  for (const directory of (process.env["PATH"] ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, "firefox")
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const executable = findFirefox()
const timeout = 60_000

describe("Firefox launcher", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect("fails with ExecutableNotFound without looking anywhere it wasn't told", () =>
        Effect.gen(function*() {
          const error = yield* FirefoxLauncher.launch({}).pipe(Effect.flip)
          assert(error.reason._tag === "ExecutableNotFound")
          assert.deepStrictEqual(error.reason.searched, [])
        }))

      it.effect("writes the profile's preferences, and knows where each channel installs itself", () =>
        Effect.sync(() => {
          assert.include(
            FirefoxLauncher.userJs(FirefoxLauncher.profilePrefs.automation),
            `user_pref("app.update.disabledForTesting", true);`
          )
          assert.strictEqual(FirefoxLauncher.userJs(FirefoxLauncher.profilePrefs.stock), "")
          assert.include(FirefoxLauncher.argsFor({}, "/p"), "--headless")
          assert.deepStrictEqual(FirefoxLauncher.channelCandidates("darwin", "canary", {}), [
            "/Applications/Firefox Nightly.app/Contents/MacOS/firefox"
          ])
        }))
    }
  )
})

describe.skipIf(executable === undefined)("Firefox over WebDriver BiDi", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect("drives a tab through the generated commands", () =>
        Effect.gen(function*() {
          const { transport: launched } = yield* FirefoxLauncher.launch({ executablePath: executable! })
          const transport = record(launched, BidiWire.wire, fixtures.bidi)
          const bidi = yield* BidiConnection.make(transport)
          const on = Protocol.on(bidi.session)
          const session = yield* Session.new_({ capabilities: {} }).pipe(on)
          assert.strictEqual(session.capabilities.browserName, "firefox")
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

      it.effect("classifies Firefox's error replies with every row of BiDi's table", () =>
        Effect.gen(function*() {
          const { transport: launched } = yield* FirefoxLauncher.launch({ executablePath: executable! })
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
          const { transport: launched } = yield* FirefoxLauncher.launch({ executablePath: executable! })
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
