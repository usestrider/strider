/** Controlled CDP ordering for races that need not rely on browser timing. */
import { assert, describe, it } from "@effect/vitest"
import { CdpConnection } from "@usestrider/browser/protocol"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Claims from "../src/internal/cdpAdapter/claims.ts"
import type { PageEntry, State } from "../src/internal/cdpAdapter/state.ts"
import type * as ProtocolClient from "../src/internal/protocolClient.ts"
import { makeBrowser } from "./utils/FakeBrowser.ts"

const harness = Effect.fnUntraced(function*(sibling?: "closing" | "empty") {
  const wire = yield* makeBrowser
  const client = yield* CdpConnection.make(wire.transport)
  const ids = Kit.makeIds()
  const id = ids.navigable()
  const page = { id, targetId: "subject-page", ended: false } as PageEntry
  const pages = new Map([[id, page]])
  const published = new Set<string>()
  const waiting = yield* Deferred.make<void>()
  const buffer = yield* Kit.makeFactBuffer((fact) =>
    Effect.sync(() => {
      if (fact._tag === "PageAdded") published.add(fact.page)
    })
  )
  buffer.connect({ run: (effect) => effect } as ProtocolClient.FoldControl)
  const waitFor = buffer.waitFor
  Object.assign(buffer, {
    waitFor: <A>(check: () => A | undefined) =>
      Deferred.succeed(waiting, undefined).pipe(Effect.andThen(waitFor(check)))
  })
  const state = { ids, pages, buffer, root: () => client.browser } as unknown as State
  const info = (targetId: string, type: string) => ({
    targetId,
    type,
    title: "",
    url: "https://same.example/",
    attached: false,
    browserContextId: "context"
  })
  yield* Effect.forever(Effect.gen(function*() {
    const command = yield* wire.next
    const reply = (result: object) =>
      wire.receive({
        id: command.id,
        result,
        ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId })
      })
    switch (command.method) {
      case "Target.getTargets":
        yield* reply({
          targetInfos: [
            ...(sibling === undefined ? [] : [info("sibling", "tab")]),
            info("subject", "tab"),
            info("subject-page", "page")
          ]
        })
        break
      case "Target.attachToTarget": {
        const target = String(command.params?.targetId)
        if (target === "sibling" && sibling === "closing") {
          yield* wire.receive({ id: command.id, error: { code: -32602, message: "No target with given id found" } })
          break
        }
        const sessionId = `tab-${target}`
        yield* wire.receive({
          method: "Target.attachedToTarget",
          params: { sessionId, targetInfo: info(target, "tab"), waitingForDebugger: false }
        })
        yield* reply({ sessionId })
        break
      }
      case "Target.setAutoAttach":
        if (command.sessionId === "tab-subject") {
          yield* wire.receive({
            sessionId: command.sessionId,
            method: "Target.attachedToTarget",
            params: { sessionId: "active-page", targetInfo: info("subject-page", "page"), waitingForDebugger: false }
          })
        }
        yield* reply({})
        break
      case "Target.detachFromTarget":
        yield* reply({})
        break
      default:
        return yield* Effect.die(new Error(`Unexpected ${command.method}`))
    }
  })).pipe(Effect.forkChild)
  return {
    state,
    id,
    page,
    pages,
    buffer,
    waiting,
    published,
    claims: Claims.make(state, "browser", Effect.succeed(client))
  }
})

describe("CDP claim discovery", () => {
  it.live("waits for a live active page to reach the model instead of returning Gone", () =>
    Effect.scoped(Effect.gen(function*() {
      const h = yield* harness()
      h.pages.clear()
      const result = yield* h.claims.findPage({ browser: "browser", context: "context", tab: "subject" }).pipe(
        Effect.forkChild
      )
      const observed = yield* Effect.raceFirst(
        Fiber.join(result).pipe(Effect.as("returned")),
        Deferred.await(h.waiting).pipe(Effect.as("waiting"))
      )
      assert.strictEqual(observed, "waiting", "a live native target is not Gone while the model catches up")
      yield* h.buffer.run(() => {
        h.pages.set(h.id, h.page)
        h.buffer.emit({
          _tag: "PageAdded",
          page: h.id,
          context: h.state.ids.userContext(),
          kind: "tab",
          origin: { _tag: "Created" },
          url: "https://same.example/" as never
        })
      })
      assert.strictEqual(yield* Fiber.join(result), h.id)
      assert.isTrue(h.published.has(h.id), "the page fact must reach L1 before lookup returns")
    })))

  for (const sibling of ["closing", "empty"] as const) {
    it.live(`claims its own tab despite a ${sibling} sibling`, () =>
      Effect.scoped(Effect.gen(function*() {
        const h = yield* harness(sibling)
        const identity = yield* h.claims.page(h.id).pipe(Effect.timeoutOption("1 second"))
        assert(Option.isSome(identity), "an unrelated tab must not consume the claim's deadline")
        assert.strictEqual(identity.value.tab, "subject")
      })))
  }
})
