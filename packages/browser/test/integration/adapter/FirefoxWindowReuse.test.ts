/**
 * Firefox keeps a closed page's window for its user context's next page, by a blank tab of the adapter's own. These
 * cases read the browser's own tree, over the same connection, to see windows and tabs the model never holds.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import type * as Adapter from "../../../src/internal/adapter.ts"
import * as BidiAdapter from "../../../src/internal/bidiAdapter.ts"
import * as FirefoxLauncher from "../../../src/internal/firefoxLauncher.ts"
import type * as Transport from "../../../src/protocol/Transport.ts"
import type * as Target from "../../../src/Target.ts"
import { firefox } from "../browsers.ts"
import { makeRecorder, site } from "./harness.ts"

const timeout = 60_000

interface Top {
  readonly context: string
  readonly userContext: string
  readonly clientWindow: string
}

/** The transport, with commands of the test's own whose replies the adapter never sees. */
const tapped = (transport: Transport.Transport) => {
  const waiting = new Map<number, (result: unknown) => void>()
  let next = 1_000_000_000
  const wrapped: Transport.Transport = {
    ...transport,
    messages: transport.messages.pipe(Stream.filter((message) => {
      if (!message.startsWith("{\"type\":\"success\"") && !message.includes("\"id\":1000000")) return true
      const parsed = JSON.parse(message) as { readonly id?: number; readonly result?: unknown }
      const resume = parsed.id === undefined ? undefined : waiting.get(parsed.id)
      if (resume === undefined) return true
      waiting.delete(parsed.id!)
      resume(parsed.result)
      return false
    }))
  }
  const send = (method: string, params: object) =>
    Effect.callback<unknown>((resume) => {
      const id = next++
      waiting.set(id, (result) => resume(Effect.succeed(result)))
      Effect.runFork(Effect.ignore(transport.send(JSON.stringify({ id, method, params }))))
    })
  const tops = Effect.map(
    send("browsingContext.getTree", { maxDepth: 0 }),
    (result) => (result as { readonly contexts: ReadonlyArray<Top> }).contexts
  )
  return { transport: wrapped, tops }
}

const open = Effect.gen(function*() {
  const facts = makeRecorder()
  const { transport } = yield* FirefoxLauncher.launch({ executablePath: firefox.executable })
  const tap = tapped(transport)
  const adapter = yield* BidiAdapter.connect(tap.transport, { sink: facts.sink, ownership: "launched" })
  const context = () => adapter.createUserContext({ proxy: Option.none(), acceptInsecureCerts: false })
  // Firefox's own first tab, there before any case's page
  const initial = new Set(facts.facts.flatMap((fact) => fact._tag === "PageAdded" ? [fact.page] : []))
  const added = () =>
    facts.facts.flatMap((fact) => fact._tag === "PageAdded" && !initial.has(fact.page) ? [fact.page] : [])
  return { adapter, facts, tops: tap.tops, context, added }
})

type World = Effect.Success<typeof open>

const realmOf = (world: World, page: Target.NavigableId) =>
  Effect.gen(function*() {
    const served = yield* site
    const navigation = yield* world.adapter.navigate(page, `${served.origin}/hello`, { referrer: Option.none() })
    const ended = yield* world.facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
    assert(ended.outcome._tag === "Committed")
    return yield* world.adapter.realm(ended.outcome.document, { _tag: "Main" })
  })

const evaluate = (adapter: Adapter.AdapterConnection, realm: Target.RealmId, functionDeclaration: string, activate = false) =>
  Effect.map(
    adapter.evaluate(realm, {
      functionDeclaration,
      arguments: [],
      awaitPromise: true,
      result: "value",
      userActivation: activate
    }),
    (result) => result._tag === "Value" ? (result.value as { readonly value?: unknown }).value : undefined
  )

const closed = (world: World, page: Target.NavigableId) =>
  Effect.andThen(
    world.adapter.closePage(page, { runBeforeUnload: false }),
    world.facts.when("NavigableRemoved", (fact) => fact.navigable === page)
  )

/** The browser's top-level contexts in a user context, once there are `count` of them, or what there were at 5 s. */
const settled = (world: World, userContext: string, count: number) =>
  Effect.gen(function*() {
    for (let attempt = 0; attempt < 50; attempt++) {
      const tops = (yield* world.tops).filter((top) => top.userContext === userContext)
      if (tops.length === count) return tops
      yield* Effect.sleep("100 millis")
    }
    return (yield* world.tops).filter((top) => top.userContext === userContext)
  })

describe("Firefox window reuse", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect("keeps a closed page's window for its own context's next page, and hides the tab that keeps it", () =>
        Effect.gen(function*() {
          const world = yield* open
          const a = yield* world.context()
          const b = yield* world.context()
          const first = yield* world.adapter.createPage(a)
          const [firstTop] = (yield* world.tops).filter((top) => top.userContext !== "default")
          yield* closed(world, first)
          // The window stays, with one tab the model never saw
          const kept = yield* settled(world, firstTop!.userContext, 1)
          assert.strictEqual(kept.length, 1)
          assert.strictEqual(kept[0]!.clientWindow, firstTop!.clientWindow)
          const other = yield* world.adapter.createPage(b)
          const otherTop = (yield* world.tops).find((top) =>
            top.userContext !== firstTop!.userContext && top.userContext !== "default"
          )!
          assert.notStrictEqual(otherTop.clientWindow, firstTop!.clientWindow, "another context's page reused it")
          const second = yield* world.adapter.createPage(a)
          const inA = (yield* world.tops).filter((top) => top.userContext === firstTop!.userContext)
          assert.strictEqual(inA.length, 2)
          assert.isTrue(inA.every((top) => top.clientWindow === firstTop!.clientWindow), "the next page reused it")
          assert.sameMembers(world.added(), [first, other, second])
          // It renders as a window's only page does
          const realm = yield* realmOf(world, second)
          const seen = yield* evaluate(
            world.adapter,
            realm,
            "() => new Promise((resolve) => { let frames = 0; const start = performance.now(); const tick = () => { frames++; if (performance.now() - start < 500) requestAnimationFrame(tick); else resolve(document.visibilityState + ' ' + frames) }; requestAnimationFrame(tick) })"
          )
          const [visibility, frames] = String(seen).split(" ")
          assert.strictEqual(visibility, "visible")
          assert.isAbove(Number(frames), 20, "a reused window's page renders at full rate")
        }), timeout)

      it.effect("closes a context's third idle window, and its idle windows with it", () =>
        Effect.gen(function*() {
          const world = yield* open
          const a = yield* world.context()
          const pages = [yield* world.adapter.createPage(a), yield* world.adapter.createPage(a), yield* world.adapter.createPage(a)]
          const userContext = (yield* world.tops).find((top) => top.userContext !== "default")!.userContext
          for (const page of pages) yield* closed(world, page)
          const idle = yield* settled(world, userContext, 2)
          assert.strictEqual(idle.length, 2)
          assert.strictEqual(new Set(idle.map((top) => top.clientWindow)).size, 2)
          yield* world.adapter.removeUserContext(a)
          assert.deepStrictEqual(yield* settled(world, userContext, 0), [])
          assert.sameMembers(world.added(), pages)
        }), timeout)

      it.effect("reports a page created while a closing page's blank tab is being created", () =>
        Effect.gen(function*() {
          const world = yield* open
          const a = yield* world.context()
          const first = yield* world.adapter.createPage(a)
          yield* world.adapter.closePage(first, { runBeforeUnload: false })
          const next = yield* world.adapter.createPage(a)
          yield* world.facts.when("NavigableRemoved", (fact) => fact.navigable === first)
          assert.isTrue(world.facts.facts.some((fact) => fact._tag === "PageAdded" && fact.page === next))
        }), timeout)

      it.effect("takes back the blank tab a refused close added, leaving the page alone in its window", () =>
        Effect.gen(function*() {
          const world = yield* open
          const served = yield* site
          const a = yield* world.context()
          const page = yield* world.adapter.createPage(a)
          const navigation = yield* world.adapter.navigate(page, `${served.origin}/beforeunload`, {
            referrer: Option.none()
          })
          const ended = yield* world.facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
          assert(ended.outcome._tag === "Committed")
          const realm = yield* world.adapter.realm(ended.outcome.document, { _tag: "Main" })
          yield* evaluate(world.adapter, realm, "() => document.title", true)
          const userContext = (yield* world.tops).find((top) => top.userContext !== "default")!.userContext
          yield* world.adapter.closePage(page, { runBeforeUnload: true })
          const opened = yield* world.facts.when("ObligationOpened", (fact) => fact.subject._tag === "Prompt")
          yield* world.adapter.resolve(opened.obligation, { _tag: "Dismiss" })
          yield* world.facts.when("PromptClosed")
          const left = yield* settled(world, userContext, 1)
          assert.strictEqual(left.length, 1, "the refused close's blank tab stayed")
        }), timeout)
    }
  )
})
