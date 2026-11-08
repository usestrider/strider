/** A prerender whose declarations can't be set up is cancelled, never run undeclared or promoted over its tab. */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import type * as Adapter from "../src/internal/adapter.ts"
import * as CdpAdapter from "../src/internal/cdpAdapter.ts"
import { makeBrowser, type Sent } from "./utils/FakeBrowser.ts"

const targetOf: Record<string, string> = { S1: "T1", S2: "T2" }

interface Faults {
  /** The tab's viewport measurement fails, so no baseline is recorded for it. */
  readonly measurement?: boolean
  /** A declaration command already written to the prerender's session is rejected. */
  readonly rejectOnPrerender?: string
}

const setup = Effect.fnUntraced(function*(faults: Faults) {
  const browser = yield* makeBrowser
  const commands: Array<Sent> = []
  const facts: Array<Adapter.Fact> = []
  yield* Effect.gen(function*() {
    while (true) {
      const command = yield* browser.next
      commands.push(command)
      const reply = (result: object) => browser.receive({ id: command.id, sessionId: command.sessionId, result })
      const fail = () =>
        browser.receive({ id: command.id, sessionId: command.sessionId, error: { code: -32000, message: "rejected" } })
      if (command.sessionId === "S2" && command.method === faults.rejectOnPrerender) {
        yield* fail()
      } else if (command.method === "Runtime.evaluate" && faults.measurement === true) {
        yield* fail()
      } else if (command.method === "Browser.getVersion") {
        yield* reply({
          protocolVersion: "1.3",
          product: "Chrome/155.0.8059.79",
          revision: "test",
          userAgent: "HeadlessChrome",
          jsVersion: "test"
        })
      } else if (command.method === "Target.getBrowserContexts") {
        yield* reply({ browserContextIds: [] })
      } else if (command.method === "Page.getFrameTree") {
        const id = targetOf[command.sessionId ?? ""] ?? "T1"
        yield* reply({
          frameTree: {
            frame: { id, loaderId: `L-${id}`, url: "about:blank", securityOrigin: "://", mimeType: "text/html" }
          }
        })
      } else if (command.method === "Page.createIsolatedWorld") {
        yield* reply({ executionContextId: 7 })
      } else if (command.method === "Page.addScriptToEvaluateOnNewDocument") {
        yield* reply({ identifier: "1" })
      } else if (command.method === "Runtime.evaluate") {
        yield* reply({ result: { type: "object", value: [800, 600] } })
      } else {
        yield* reply({})
      }
    }
  }).pipe(Effect.forkScoped)
  const adapter = yield* CdpAdapter.connect(browser.transport, {
    ownership: "launched",
    prerender: true,
    sink: (fact) => Effect.sync(() => facts.push(fact))
  })
  const settle = Effect.gen(function*() {
    for (let i = 0; i < 200; i++) {
      yield* browser.delivered
      yield* Effect.yieldNow
    }
  })
  const pageOf = (kind: string) =>
    facts.find((fact): fact is Extract<Adapter.Fact, { _tag: "PageAdded" }> =>
      fact._tag === "PageAdded" && fact.kind === kind
    )?.page
  yield* browser.receive({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "ST",
      targetInfo: { targetId: "TAB", type: "tab", title: "", url: "about:blank", attached: true },
      waitingForDebugger: true
    }
  })
  yield* browser.receive({
    method: "Target.attachedToTarget",
    sessionId: "ST",
    params: {
      sessionId: "S1",
      targetInfo: { targetId: "T1", type: "page", title: "", url: "about:blank", attached: true },
      waitingForDebugger: true
    }
  })
  yield* settle
  const tab = pageOf("tab")
  assert.isDefined(tab, "the tab's page was added")
  assert.isTrue(facts.some((fact) => fact._tag === "PageReady" && fact.page === tab), "the tab's page is ready")
  const attachPrerender = Effect.gen(function*() {
    yield* browser.receive({
      method: "Target.attachedToTarget",
      sessionId: "ST",
      params: {
        sessionId: "S2",
        targetInfo: {
          targetId: "T2",
          type: "page",
          subtype: "prerender",
          title: "",
          url: "http://localhost/prerendered",
          attached: true
        },
        waitingForDebugger: true
      }
    })
    yield* settle
  })
  // The browser's promotion notice: the known speculative child under the same tab loses its subtype.
  const promote = Effect.gen(function*() {
    yield* browser.receive({
      method: "Target.targetInfoChanged",
      sessionId: "ST",
      params: {
        targetInfo: { targetId: "T2", type: "page", title: "", url: "http://localhost/prerendered", attached: true }
      }
    })
    yield* settle
  })
  return { adapter, commands, facts, tab: tab!, pageOf, attachPrerender, promote, settle }
})

const removed = (facts: ReadonlyArray<Adapter.Fact>, page: string) =>
  facts.some((fact) => fact._tag === "NavigableRemoved" && JSON.stringify(fact).includes(JSON.stringify(page)))

const sentTo = (commands: ReadonlyArray<Sent>, sessionId: string, method: string) =>
  commands.findIndex((command) => command.sessionId === sessionId && command.method === method)

const cancelled = (commands: ReadonlyArray<Sent>) =>
  commands.findIndex((command) => command.method === "Target.closeTarget" && command.params?.targetId === "T2")

describe("CDP prerender declaration gate failure", () => {
  it.effect("cancels the prerender without resuming it when the viewport baseline is missing before resume", () =>
    Effect.gen(function*() {
      const run = yield* setup({ measurement: true })
      const context = { _tag: "UserContext", context: run.adapter.defaultContext } as const
      yield* run.adapter.declare(context, {
        _tag: "Override",
        override: { _tag: "Viewport", width: 400, height: 300, deviceScaleFactor: 1, mobile: false }
      }).pipe(Effect.forkIn(yield* Scope.make()))
      yield* run.settle
      yield* run.attachPrerender
      const speculative = run.pageOf("prerender")
      assert.isDefined(speculative, "the prerender's page was added")
      assert.isTrue(
        run.facts.some((fact) => fact._tag === "PageInitializationFailed" && fact.page === speculative),
        "the speculative page's waiters settle with its failure"
      )
      assert.strictEqual(
        sentTo(run.commands, "S2", "Runtime.runIfWaitingForDebugger"),
        -1,
        "a prerender whose declarations failed before resume must stay paused, not run undeclared"
      )
      assert.notStrictEqual(cancelled(run.commands), -1, "the failed prerender is cancelled with Target.closeTarget")
      yield* run.promote
      assert.isFalse(removed(run.facts, run.tab), "a promotion notice for the failed prerender must not close the tab")
    }).pipe(Effect.scoped))

  it.effect("cancels the prerender and keeps the tab when a declaration written before resume is rejected", () =>
    Effect.gen(function*() {
      const run = yield* setup({ rejectOnPrerender: "Network.enable" })
      yield* run.attachPrerender
      const speculative = run.pageOf("prerender")
      assert.isDefined(speculative, "the prerender's page was added")
      assert.isTrue(
        run.facts.some((fact) => fact._tag === "PageInitializationFailed" && fact.page === speculative),
        "the speculative page's waiters settle with its failure"
      )
      // The gate writes resume with the declarations, before any reply, so the renderer may already have run:
      // only cancelling the speculation keeps its document out of the tab.
      assert.notStrictEqual(sentTo(run.commands, "S2", "Runtime.runIfWaitingForDebugger"), -1)
      assert.notStrictEqual(cancelled(run.commands), -1, "the failed prerender is cancelled with Target.closeTarget")
      yield* run.promote
      assert.isFalse(removed(run.facts, run.tab), "a promotion notice for the failed prerender must not close the tab")
    }).pipe(Effect.scoped))
})
