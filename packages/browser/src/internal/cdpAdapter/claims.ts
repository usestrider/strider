/** Chromium claims use native tab parentage, never URL matching or a connection-local public id. */
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Page from "../../cdp/Page.ts"
import * as Target from "../../cdp/Target.ts"
import type * as CdpConnection from "../../protocol/CdpConnection.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import { contextOf, pageOf, type State } from "./state.ts"
import { contextFor } from "./tree.ts"

export const make = (
  state: State,
  browser: string,
  client: Effect.Effect<CdpConnection.CdpConnection, Adapter.AdapterError, Scope.Scope>
): Adapter.Claims => {
  const targets = () =>
    Kit.protocol(Target.getTargets({ filter: [{ exclude: false }] }).pipe(Protocol.on(state.root())))
  const childOf = Effect.fnUntraced(
    function*(tab: Target.TargetInfo) {
      const identity = yield* client
      return yield* Effect.acquireUseRelease(
        Kit.protocol(
          Target.attachToTarget({ targetId: tab.targetId, flatten: true }).pipe(Protocol.on(identity.browser))
        ),
        ({ sessionId }) =>
          Effect.gen(function*() {
            const session = yield* identity.session(sessionId)
            const attached = yield* session.subscribe(Target.attachedToTarget)
            const next = yield* attached.pipe(
              Stream.filter((event) => event.targetInfo.type === "page" && event.targetInfo.subtype !== "prerender"),
              Stream.runHead,
              Effect.forkChild
            )
            yield* Kit.protocol(
              Target.setAutoAttach({
                autoAttach: true,
                waitForDebuggerOnStart: false,
                flatten: true,
                filter: [{ type: "page" }, { exclude: true }]
              }).pipe(Protocol.on(session))
            )
            return Option.getOrUndefined(yield* Fiber.join(next))?.targetInfo
          }),
        ({ sessionId }) => Target.detachFromTarget({ sessionId }).pipe(Protocol.on(identity.browser), Effect.ignore)
      )
    },
    Effect.scoped,
    Effect.mapError((error) => error._tag === "ProtocolError" ? Kit.protocolError(error) : error)
  )
  return {
    browser,
    dialogs: Effect.fnUntraced(
      function*(id) {
        const page = yield* pageOf(state, id)
        const identity = yield* client
        const { sessionId } = yield* Target.attachToTarget({
          targetId: page.targetId as Target.TargetID,
          flatten: true
        }).pipe(Protocol.on(identity.browser))
        const session = yield* identity.session(sessionId)
        const found: Array<{ readonly kind: string; readonly message: string }> = []
        const opened = yield* session.subscribe(Page.javascriptDialogOpening)
        yield* Stream.runForEach(opened, (event) =>
          Effect.sync(() => {
            found.push({ kind: event.type, message: event.message })
          })).pipe(Effect.forkChild)
        yield* Page.enable().pipe(Protocol.on(session))
        yield* session.drainObserved
        return found
      },
      Effect.scoped,
      Effect.mapError((error) => error._tag === "ProtocolError" ? Kit.protocolError(error) : error)
    ),
    page: Effect.fnUntraced(function*(id) {
      const page = yield* pageOf(state, id)
      const { targetInfos } = yield* targets()
      const info = targetInfos.find((target) => target.targetId === page.targetId)
      if (info?.browserContextId === undefined) {
        return yield* Effect.fail(Kit.unsupported("claims.contextIdentity", "Chromium did not report the page context"))
      }
      let tab: Target.TargetInfo | undefined
      for (
        const candidate of targetInfos.filter((target) =>
          target.type === "tab" && target.browserContextId === info.browserContextId
        )
      ) {
        const child = yield* childOf(candidate)
        if (child?.targetId === page.targetId) {
          tab = candidate
          break
        }
      }
      if (tab === undefined) {
        return yield* Effect.fail(
          Kit.unsupported("claims.tabIdentity", "Chromium did not report a tab owning this page")
        )
      }
      return { browser, tab: tab.targetId, context: info.browserContextId }
    }),
    context: Effect.fnUntraced(function*(id) {
      const context = yield* contextOf(state, id)
      if (context.browserContextId === undefined) {
        return yield* Effect.fail(Kit.unsupported("claims.contextIdentity", "Chromium did not report the context id"))
      }
      return context.browserContextId
    }),
    findPage: Effect.fnUntraced(function*(identity) {
      const { targetInfos } = yield* targets()
      const tab = targetInfos.find((target) =>
        target.type === "tab" && target.targetId === identity.tab && target.browserContextId === identity.context
      )
      if (tab === undefined) return undefined
      const info = yield* childOf(tab)
      if (info === undefined) return undefined
      // An open dialog may hold the initialization gate. Reclaim reports it without waiting for a fresh document.
      const page = Array.from(state.pages.values()).find((page) => page.targetId === info.targetId && !page.ended)
      if (page === undefined) return undefined
      return page.id
    }),
    findContext: Effect.fnUntraced(function*(id) {
      const contexts = yield* Kit.protocol(Target.getBrowserContexts().pipe(Protocol.on(state.root())))
      if (!contexts.browserContextIds.some((context) => context === id)) return undefined
      const context = contextFor(state, id)
      yield* state.buffer.flush
      return context.isDefault ? undefined : context.id
    })
  }
}
