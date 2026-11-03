/** Chromium claims discover active page identity through tab attachment, never URL matching. */
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

const dialogKind = (value: string): import("../../Page.ts").Prompt["kind"] =>
  value === "alert" || value === "confirm" || value === "prompt" || value === "beforeunload" ? value : "unknown"

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
            const active = yield* Fiber.join(next)
            if (Option.isNone(active)) {
              return yield* Effect.fail(
                new Protocol.ProtocolError({ reason: new Protocol.SessionEnded({ why: "modelUnavailable" }) })
              )
            }
            return active.value.targetInfo
          }),
        ({ sessionId }) => Target.detachFromTarget({ sessionId }).pipe(Protocol.on(identity.browser), Effect.ignore)
      )
    },
    Effect.scoped,
    Effect.mapError((error) => error._tag === "ProtocolError" ? Kit.protocolError(error) : error)
  )
  return {
    browser,
    dismiss: Effect.fnUntraced(function*(id, prompt) {
      const page = yield* pageOf(state, id)
      const pending = Array.from(state.obligations.values()).find((entry) =>
        entry._tag === "Prompt" && entry.prompt === prompt && entry.target.page === page
      )
      if (pending === undefined) return false
      yield* Kit.protocol(Page.handleJavaScriptDialog({ accept: false }).pipe(Protocol.on(pending.target.session)))
      yield* pending.target.session.drainObserved
      yield* state.buffer.run(() => {})
      return true
    }),
    dialogs: Effect.fnUntraced(
      function*(id) {
        const page = yield* pageOf(state, id)
        const identity = yield* client
        const { sessionId } = yield* Target.attachToTarget({
          targetId: page.targetId as Target.TargetID,
          flatten: true
        }).pipe(Protocol.on(identity.browser))
        const session = yield* identity.session(sessionId)
        const found: Array<{ readonly kind: import("../../Page.ts").Prompt["kind"]; readonly message: string }> = []
        const opened = yield* session.subscribe(Page.javascriptDialogOpening)
        yield* Stream.runForEach(opened, (event) =>
          Effect.sync(() => {
            found.push({
              kind: dialogKind(event.type),
              message: event.message
            })
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
      const candidates = targetInfos.filter((target) =>
        target.type === "tab" && target.browserContextId === info.browserContextId
      )
      if (candidates.length === 0) {
        return yield* Effect.fail(
          Kit.unsupported("claims.tabIdentity", "Chromium did not report any tab in the page's context")
        )
      }
      // Only a match can win. A sibling with no active child must not block discovery of this page.
      // A sibling that vanished is irrelevant; other protocol failures keep their normal error contract.
      const probes = candidates.map((candidate) =>
        childOf(candidate).pipe(
          Effect.flatMap((child) => child?.targetId === page.targetId ? Effect.succeed(candidate) : Effect.never),
          Effect.catch((error) => {
            const reason = error.reason
            const gone = reason._tag === "Gone" || (reason._tag === "Protocol" && (
              (reason.error.reason._tag === "Rejected" && reason.error.reason.reason === "NoSuchTarget") ||
              (reason.error.reason._tag === "SessionEnded" &&
                ["detached", "targetDestroyed", "swapped"].includes(reason.error.reason.why))
            ))
            return gone ? Effect.never : Effect.fail(error)
          })
        )
      )
      const tab = yield* probes.slice(1).reduce((first, next) => Effect.raceFirst(first, next), probes[0]!)
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
      // The native target may precede its PageAdded fact on the other connection. Flush already queued
      // facts, then use the adapter's gap-free waiter for later ones. A live tab is not evidence of Gone.
      yield* state.buffer.run(() => {})
      const page = yield* state.buffer.waitFor(() =>
        Array.from(state.pages.values()).find((page) => page.targetId === info.targetId && !page.ended)
      )
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
