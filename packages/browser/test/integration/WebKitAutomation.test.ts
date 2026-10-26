/**
 * WebKit's Automation protocol against stock WebKitGTK (review 23, its first step): the inspector server's socket
 * (`webkitInspectorSocket.ts`) and the generated Automation commands, before an adapter drives them. A session, a
 * page, trusted input, a screenshot, a dialog, and the page as an inspector target on the same socket.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import type * as Protocol from "@usestrider/browser/protocol/Protocol"
import * as Automation from "@usestrider/browser/webkit-automation-protocol/Automation"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as InspectorSocket from "../../src/internal/webkitInspectorSocket.ts"
import * as SocketConnector from "../../src/protocol/SocketConnector.ts"
import { site } from "./adapter/harness.ts"
import { webkitgtk } from "./browsers.ts"
import { startMiniBrowserForAutomation } from "./stockWebKit.ts"

const timeout = 60_000

const page = (origin: string) =>
  `${origin}/fixture?html=${
    encodeURIComponent(
      `<title>start</title><h1>Hello</h1><button style="position:absolute;left:20px;top:100px;width:120px;height:40px" onclick="document.querySelector('h1').textContent = 'clicked ' + event.isTrusted">Go</button><input id=i style="position:absolute;left:20px;top:200px">`
    )
  }`

/** A session over the socket: the Automation target's commands, and a page target's inspector. */
const open = Effect.fnUntraced(function*(port: number) {
  const connection = yield* InspectorSocket.connect(
    yield* SocketConnector.fromSocket(yield* NodeSocket.makeNet({ host: "127.0.0.1", port }))
  )
  const started = yield* Deferred.make<{ readonly browserName: string; readonly browserVersion: string }>()
  const targets = yield* SubscriptionRef.make<ReadonlyArray<InspectorSocket.Target>>([])
  let connectionId = 0n
  const replies = new Map<string, Deferred.Deferred<Record<string, any>>>()
  // A page target's inner target, and the replies of its inner commands
  const inner = new Map<bigint, Deferred.Deferred<string>>()
  const innerReplies = new Map<string, Deferred.Deferred<Record<string, any>>>()
  yield* connection.messages.pipe(
    Stream.runForEach((message) =>
      Effect.gen(function*() {
        if (message._tag === "DidStartAutomationSession") yield* Deferred.succeed(started, message)
        if (message._tag === "SetTargetList") {
          connectionId = message.connection
          yield* SubscriptionRef.set(targets, message.targets)
        }
        if (message._tag !== "SendMessageToFrontend") return
        const parsed = JSON.parse(message.message) as Record<string, any>
        const waiting = replies.get(`${message.target}:${parsed.id}`)
        if (parsed.id !== undefined && waiting !== undefined) return yield* Deferred.succeed(waiting, parsed)
        if (parsed.method === "Target.targetCreated") {
          const created = inner.get(message.target)
          if (created !== undefined) yield* Deferred.succeed(created, parsed.params.targetInfo.targetId)
        }
        if (parsed.method === "Target.dispatchMessageFromTarget") {
          const reply = JSON.parse(parsed.params.message) as Record<string, any>
          const waitingInner = innerReplies.get(`${message.target}:${reply.id}`)
          if (waitingInner !== undefined) yield* Deferred.succeed(waitingInner, reply)
        }
      })
    ),
    Effect.forkScoped
  )
  let id = 0
  const call = Effect.fnUntraced(function*(target: bigint, method: string, params: unknown) {
    const reply = yield* Deferred.make<Record<string, any>>()
    const n = ++id
    replies.set(`${target}:${n}`, reply)
    yield* connection.send({
      _tag: "SendMessageToBackend",
      connection: connectionId,
      target,
      message: JSON.stringify({ id: n, method, params })
    })
    return yield* Deferred.await(reply).pipe(Effect.timeout("10 seconds"))
  })

  /** The first listed target `predicate` accepts, once the server lists one. */
  const targetWhere = Effect.fnUntraced(function*(predicate: (target: InspectorSocket.Target) => boolean) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const found = (yield* SubscriptionRef.get(targets)).find(predicate)
      if (found !== undefined) return found
      yield* Effect.sleep("50 millis")
    }
    return yield* Effect.die(new Error("No such target was listed"))
  })

  yield* connection.send({ _tag: "StartAutomationSession", sessionId: crypto.randomUUID(), capabilities: [] })
  const browser = yield* Deferred.await(started).pipe(Effect.timeout("10 seconds"))
  const automation = (yield* targetWhere((target) => target.type === "Automation")).id
  yield* connection.send({ _tag: "Setup", connection: connectionId, target: automation })

  /** An Automation command, its parameters and result through the generated codecs. */
  const command = Effect.fnUntraced(
    function*<M extends string, P, A>(definition: Protocol.CommandDef<M, P, A>, params: P) {
      const encoded = definition.Params === undefined
        ? {}
        : yield* Schema.encodeUnknownEffect(definition.Params)(params).pipe(Effect.orDie)
      const reply = yield* call(automation, definition.method, encoded).pipe(Effect.orDie)
      if (reply.error !== undefined) return yield* Effect.die(new Error(`${definition.method}: ${reply.error.message}`))
      return definition.Result === undefined
        ? (undefined as A)
        : yield* Schema.decodeUnknownEffect(definition.Result)(reply.result).pipe(Effect.orDie)
    }
  )

  /** A page target's inspector, through `Target`-wrapped messages to its inner target. */
  const inspect = Effect.fnUntraced(function*(target: bigint) {
    const created = yield* Deferred.make<string>()
    inner.set(target, created)
    yield* connection.send({ _tag: "Setup", connection: connectionId, target })
    const innerTarget = yield* Deferred.await(created).pipe(Effect.timeout("10 seconds"))
    let innerId = 0
    return Effect.fnUntraced(function*(method: string, params: unknown) {
      const reply = yield* Deferred.make<Record<string, any>>()
      const n = ++innerId
      innerReplies.set(`${target}:${n}`, reply)
      yield* call(target, "Target.sendMessageToTarget", {
        targetId: innerTarget,
        message: JSON.stringify({ id: n, method, params })
      })
      return yield* Deferred.await(reply).pipe(Effect.timeout("10 seconds"))
    })
  })

  return { browser, targetWhere, command, inspect }
})

describe("WebKit's Automation protocol, over stock WebKitGTK's inspector socket", () => {
  layer(NodeServices.layer, { excludeTestServices: true, timeout })((it) => {
    it.effect(
      "drives a page with trusted input, a screenshot and a dialog, and inspects it on the same socket",
      () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const { port } = yield* startMiniBrowserForAutomation()
          const session = yield* open(port)
          // The browser says what it is, which pins its version
          assert.strictEqual(session.browser.browserName, "MiniBrowser")
          assert.strictEqual(session.browser.browserVersion, webkitgtk.version)
          const { handle } = yield* session.command(Automation.createBrowsingContext, {})
          // A new page is still loading its first document, and a navigation sent then returns when it ends (Q211)
          yield* session.command(Automation.waitForNavigationToComplete, {
            browsingContextHandle: handle,
            pageLoadStrategy: "Normal"
          })
          yield* session.command(Automation.navigateBrowsingContext, {
            handle,
            url: page(origin),
            pageLoadStrategy: "Normal"
          })
          const evaluate = (fn: string) =>
            Effect.map(
              session.command(Automation.evaluateJavaScriptFunction, {
                browsingContextHandle: handle,
                function: fn,
                arguments: []
              }),
              ({ result }) => JSON.parse(result) as unknown
            )
          // Automation mode says so to the page, as WebDriver requires
          assert.strictEqual(yield* evaluate("function() { return navigator.webdriver }"), true)
          yield* session.command(Automation.performMouseInteraction, {
            handle,
            position: { x: 80, y: 120 },
            button: "Left",
            interaction: "SingleClick",
            modifiers: []
          })
          assert.strictEqual(
            yield* evaluate("function() { return document.querySelector('h1').textContent }"),
            "clicked true"
          )
          yield* evaluate("function() { document.getElementById('i').focus() }")
          yield* session.command(Automation.performKeyboardInteractions, {
            handle,
            interactions: [{ type: "InsertByKey", text: "hé@" }]
          })
          assert.strictEqual(yield* evaluate("function() { return document.getElementById('i').value }"), "hé@")
          const { data } = yield* session.command(Automation.takeScreenshot, { handle })
          assert.strictEqual(atob(data).slice(1, 4), "PNG")
          // A dialog: open, its message, answered
          yield* evaluate("function() { setTimeout(() => { document.title = String(confirm('sure?')) }, 10) }")
          yield* Effect.sleep("300 millis")
          assert.isTrue(
            (yield* session.command(Automation.isShowingJavaScriptDialog, { browsingContextHandle: handle })).result
          )
          const { message } = yield* session.command(Automation.messageOfCurrentJavaScriptDialog, {
            browsingContextHandle: handle
          })
          assert.strictEqual(message, "sure?")
          yield* session.command(Automation.acceptCurrentJavaScriptDialog, { browsingContextHandle: handle })
          assert.strictEqual(yield* evaluate("function() { return document.title }"), "true")
          // The same page, as a target of the inspector
          const listed = yield* session.targetWhere((target) =>
            target.type === "WebPage" && target.url.includes("/fixture")
          )
          const inspector = yield* session.inspect(listed.id)
          const evaluated = yield* inspector("Runtime.evaluate", { expression: "document.title", returnByValue: true })
          assert.strictEqual(evaluated.result.result.value, "true")
        }).pipe(Effect.scoped),
      timeout
    )
  })
})
