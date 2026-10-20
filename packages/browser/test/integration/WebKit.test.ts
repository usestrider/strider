/**
 * L0 against Playwright's WebKit build: the launcher, the raw connection, the error table, and what only the
 * WebKit adapter does.
 *
 * They run against the pinned build (`browsers.ts`), in the Nix environment `pnpm test:integration` enters; the
 * launcher refuses another build by its `protocol.json`.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Protocol, WebKitConnection } from "@usestrider/browser/protocol"
import * as Playwright from "@usestrider/browser/webkit-protocol/Playwright"
import * as Runtime from "@usestrider/browser/webkit-protocol/Runtime"
import * as Target from "@usestrider/browser/webkit-protocol/Target"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import type * as Adapter from "../../src/internal/adapter.ts"
import * as ProtocolClient from "../../src/internal/protocolClient.ts"
import * as WebKitAdapter from "../../src/internal/webkitAdapter.ts"
import * as WebKitLauncher from "../../src/internal/webkitLauncher.ts"
import * as WebKitWire from "../../src/internal/webkitWire.ts"
import type * as Transport from "../../src/protocol/Transport.ts"
import { makeRecorder, site } from "./adapter/harness.ts"
import { webkit } from "./browsers.ts"
import { fixtures, record } from "./record.ts"

const executable = webkit.executable
const timeout = 60_000

describe("WebKit over its inspector protocol", () => {
  layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    it.effect(
      "launches the pinned build, and drives a page through the generated commands",
      () =>
        Effect.gen(function*() {
          yield* WebKitLauncher.checkRevision(executable)
          const { transport } = yield* WebKitLauncher.launch({ executablePath: executable })
          const webkit = yield* WebKitConnection.make(record(transport, WebKitWire.wire, fixtures.webkit))
          yield* Playwright.enable().pipe(Protocol.on(webkit.browser))
          const { browserContextId } = yield* Playwright.createContext({}).pipe(Protocol.on(webkit.browser))
          const { pageProxyId } = yield* Playwright.createPage({ browserContextId }).pipe(Protocol.on(webkit.browser))
          // Announced before the reply, and paused
          const [targetId] = yield* webkit.targets(pageProxyId)
          assert.isDefined(targetId)
          const page = yield* webkit.pageProxy(pageProxyId)
          const target = yield* webkit.target(pageProxyId, targetId!)
          yield* Target.resume({ targetId: targetId! }).pipe(Protocol.on(page))
          const { result } = yield* Runtime.evaluate({ expression: "navigator.userAgent", returnByValue: true }).pipe(
            Protocol.on(target)
          )
          assert.include(String(result.value), "AppleWebKit")
          // A session that was never announced is ended, not waited for
          const missing = yield* webkit.target(pageProxyId, "page-0").pipe(Effect.flip)
          assert.strictEqual(missing.reason._tag, "SessionEnded")
        }),
      timeout
    )

    it.effect("classifies WebKit's error replies with every row of its table", () =>
      Effect.gen(function*() {
        const { transport: launched } = yield* WebKitLauncher.launch({ executablePath: executable })
        const transport = record(launched, WebKitWire.wire, fixtures.webkit)
        const replies = new Map<number, Deferred.Deferred<ProtocolClient.Incoming>>()
        const created = yield* Deferred.make<{ readonly pageProxyId: string; readonly targetId: string }>()
        yield* transport.messages.pipe(
          Stream.runForEach((text) =>
            Effect.suspend(() => {
              const incoming = WebKitWire.decode(text)
              if (incoming._tag === "Reply" || incoming._tag === "ErrorReply") {
                const reply = replies.get(incoming.id)
                return reply === undefined ? Effect.void : Deferred.succeed(reply, incoming)
              }
              if (
                incoming._tag === "Event" && incoming.method === "Target.targetCreated" && incoming.key !== undefined
              ) {
                const { targetInfo } = incoming.params as { readonly targetInfo: { readonly targetId: string } }
                const route = WebKitWire.route(incoming.key)
                return Deferred.succeed(created, { pageProxyId: route.pageProxyId, targetId: targetInfo.targetId })
              }
              return Effect.void
            })
          ),
          Effect.forkScoped
        )
        let nextId = 1
        const call = Effect.fnUntraced(function*(
          method: string,
          params: object,
          key?: Protocol.SessionKey | undefined
        ) {
          const id = nextId++
          const reply = yield* Deferred.make<ProtocolClient.Incoming>()
          replies.set(id, reply)
          yield* transport.send(WebKitWire.encode(id, method, params, key))
          return yield* Deferred.await(reply)
        })
        yield* call("Playwright.enable", {})
        const context = yield* call("Playwright.createContext", {})
        assert(context._tag === "Reply")
        yield* call("Playwright.createPage", { browserContextId: (context.result as any).browserContextId })
        const { pageProxyId, targetId } = yield* Deferred.await(created)
        const pageKey = WebKitWire.pageProxyKey(pageProxyId)
        const targetKey = WebKitWire.targetKey(pageProxyId, targetId)
        yield* call("Target.resume", { targetId }, pageKey)
        const cases: ReadonlyArray<readonly [string, object, Protocol.SessionKey | undefined]> = [
          ["Nope.nothing", {}, undefined],
          ["Runtime.evaluate", {}, targetKey],
          ["Dialog.enable", {}, WebKitWire.pageProxyKey("9999")],
          ["Playwright.navigate", { url: "about:blank", pageProxyId: "9999" }, undefined],
          ["Runtime.evaluate", { expression: "1" }, WebKitWire.targetKey(pageProxyId, "page-0")],
          ["Page.getResourceContent", { frameId: "nope", url: "about:blank" }, targetKey],
          ["DOM.resolveNode", { nodeId: 99999 }, targetKey],
          ["DOM.describeNode", { objectId: "nope" }, targetKey]
        ]
        const rows: Array<ProtocolClient.ErrorMatcher | undefined> = []
        for (const [method, params, key] of cases) {
          const reply = yield* call(method, params, key)
          assert(reply._tag === "ErrorReply", `${method} should fail`)
          rows.push(ProtocolClient.match(WebKitWire.errors, reply.error))
        }
        // Each case matches its own row, in table order, so every row is still produced by this build
        assert.deepStrictEqual(rows, [...WebKitWire.errors])
        // Unknown methods are unsupported at every level a command can go
        const atPageProxy = yield* call("Nope.nothing", {}, pageKey)
        const inTarget = yield* call("Nope.nothing", {}, targetKey)
        for (const reply of [atPageProxy, inTarget]) {
          assert(reply._tag === "ErrorReply")
          assert.deepStrictEqual(ProtocolClient.match(WebKitWire.errors, reply.error), WebKitWire.errors[0])
        }
      }), timeout)

    it.effect(
      "ends a crashed page with PageCrashed, and follows a page across a cross-site navigation",
      () =>
        Effect.gen(function*() {
          const served = yield* site
          const facts = makeRecorder()
          const { transport } = yield* WebKitLauncher.launch({ executablePath: executable })
          // A tap on the connection: the targets it announces, and a way to send what the adapter never would
          const targets: Array<{ readonly pageProxyId: string; readonly targetId: string }> = []
          const tapped: Transport.Transport = {
            ...transport,
            messages: transport.messages.pipe(Stream.tap((text) =>
              Effect.sync(() => {
                const incoming = WebKitWire.decode(text)
                if (
                  incoming._tag === "Event" && incoming.key !== undefined &&
                  (incoming.method === "Target.targetCreated" ||
                    incoming.method === "Target.didCommitProvisionalTarget")
                ) {
                  const params = incoming.params as {
                    readonly targetInfo?: { readonly targetId: string; readonly isProvisional?: boolean }
                    readonly newTargetId?: string
                  }
                  const targetId = params.newTargetId ??
                    (params.targetInfo?.isProvisional === true ? undefined : params.targetInfo?.targetId)
                  if (targetId !== undefined) {
                    targets.push({ pageProxyId: WebKitWire.route(incoming.key).pageProxyId, targetId })
                  }
                }
              })
            ))
          }
          const adapter = yield* WebKitAdapter.connect(tapped, { sink: facts.sink, ownership: "launched" })
          const context = yield* adapter.createUserContext({ proxy: Option.none(), acceptInsecureCerts: false })
          const page = yield* adapter.createPage(context)
          const go = Effect.fnUntraced(function*(url: string) {
            const navigation = yield* adapter.navigate(page, url, { referrer: Option.none() })
            return (yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)).outcome
          })
          const first = yield* go(`${served.origin}/hello`)
          assert(first._tag === "Committed")
          // Another site: another process, another target, the same page
          const second = yield* go(`${served.crossSite}/hello`)
          assert(second._tag === "Committed")
          const committed = yield* facts.when("DocumentCommitted", (fact) => fact.document === second.document)
          assert.strictEqual(committed.navigable, page)
          assert.deepStrictEqual(committed.replaced, Option.some(first.document))
          const realm = yield* facts.next((fact): fact is Extract<Adapter.Fact, { _tag: "RealmAdded" }> =>
            fact._tag === "RealmAdded" && fact.kind._tag === "Window" && fact.kind.document === second.document
          )
          const host = yield* adapter.evaluate(realm.realm, {
            functionDeclaration: "() => location.host",
            arguments: [],
            awaitPromise: false,
            result: "value",
            userActivation: false
          })
          assert.deepStrictEqual(host, {
            _tag: "Value",
            value: { type: "string", value: new URL(served.crossSite).host }
          })
          // document.open() shows only as a second load, which starts a new generation (probe 17)
          yield* adapter.evaluate(realm.realm, {
            functionDeclaration: "() => { document.open(); document.write('<title>w</title>'); document.close() }",
            arguments: [],
            awaitPromise: false,
            result: "value",
            userActivation: false
          })
          const opened = yield* facts.when("DocumentOpened", (fact) => fact.document === second.document)
          assert.strictEqual(opened.generation, 1)
          // Page.crash, sent behind the adapter's back with an id it never uses
          const current = targets.at(-1)!
          yield* transport.send(
            WebKitWire.encode(
              1_000_000_000,
              "Page.crash",
              {},
              WebKitWire.targetKey(current.pageProxyId, current.targetId)
            )
          )
          const removed = yield* facts.when("NavigableRemoved", (fact) => fact.navigable === page)
          assert.deepStrictEqual(removed.reason, { _tag: "PageCrashed" })
        }),
      timeout
    )
  })
})
