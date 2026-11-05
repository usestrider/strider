/**
 * BiDi viewport declarations, without a browser: a scope's release restores every target it can reach, whichever
 * one rejects its command, and a user context whose setup fails doesn't stay behind.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import type * as BrowserBidi from "../src/bidi-protocol/Browser.ts"
import type * as BrowsingContext from "../src/bidi-protocol/BrowsingContext.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Contexts from "../src/internal/bidiAdapter/contexts.ts"
import * as Declare from "../src/internal/bidiAdapter/declare.ts"
import * as State from "../src/internal/bidiAdapter/state.ts"
import * as Tree from "../src/internal/bidiAdapter/tree.ts"
import type * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Protocol from "../src/protocol/Protocol.ts"

interface Sent {
  readonly method: string
  readonly params: {
    readonly context?: string
    readonly userContexts?: ReadonlyArray<string>
    readonly viewport?: { readonly width: number; readonly height: number } | null
  }
}

const control: ProtocolClient.FoldControl = {
  sync: () => {},
  session: () => undefined,
  run: (effect) => effect
}

const rejected = (method: string) =>
  new Protocol.ProtocolError({
    reason: new Protocol.Rejected({ method, reason: "NoSuchFrame", code: "no such frame", description: "gone" })
  })

/** A state whose session records each command, and rejects those `rejects` picks. */
const make = Effect.fnUntraced(function*() {
  const sent: Array<Sent> = []
  const session: { rejects: (entry: Sent) => boolean } = { rejects: () => false }
  let contexts = 0
  const root = {
    key: undefined,
    send: (command: Protocol.Command<string, unknown, unknown>) =>
      Effect.suspend(() => {
        const entry = { method: command.method, params: command.params } as Sent
        sent.push(entry)
        return session.rejects(entry)
          ? Effect.fail(rejected(command.method))
          : Effect.succeed(command.method === "browser.createUserContext" ? { userContext: `U${++contexts}` } : {})
      }),
    drainObserved: Effect.void
  } as unknown as ProtocolClient.Session
  const buffer = yield* Kit.makeFactBuffer(() => Effect.void)
  buffer.connect(control)
  const state = State.make({
    connect: { sink: () => Effect.void, ownership: "launched" },
    ids: Kit.makeIds(),
    buffer,
    control,
    root: () => root
  })
  const page = (context: string, userContext: BrowserBidi.UserContext | "default" = "default") =>
    Tree.addNavigable(state, {
      context: context as BrowsingContext.BrowsingContext,
      userContext,
      originalOpener: null,
      url: "about:blank"
    }, false)!
  return { state, sent, session, page }
})

const viewport = (width: number): Adapter.Declaration => ({
  _tag: "Override",
  override: { _tag: "Viewport", width, height: 600, deviceScaleFactor: 1, mobile: false }
})

const declare = (state: State.State, scope: Adapter.DeclarationScope, width: number, lifetime: Scope.Scope) =>
  Declare.declare(state, scope, viewport(width)).pipe(Effect.provideService(Scope.Scope, lifetime))

const options: Adapter.UserContextOptions = { proxy: Option.none(), acceptInsecureCerts: false, reclaimable: false }

const widthsFor = (sent: ReadonlyArray<Sent>, target: (params: Sent["params"]) => boolean) =>
  sent
    .filter((entry) => entry.method === "browsingContext.setViewport" && target(entry.params))
    .map((entry) => entry.params.viewport?.width ?? null)

describe("BidiAdapter viewports", () => {
  it.effect("restores a page override on release when another page rejects its command", () =>
    Effect.gen(function*() {
      const { page, sent, session, state } = yield* make()
      const rejecting = page("P1")
      const open = page("P2")
      const context = state.defaultContext
      const lifetime = yield* Scope.make()
      yield* declare(state, { _tag: "Page", page: rejecting.page.id }, 640, yield* Scope.make())
      yield* declare(state, { _tag: "Page", page: open.page.id }, 700, yield* Scope.make())
      yield* declare(state, { _tag: "UserContext", context }, 1000, lifetime)
      sent.length = 0
      session.rejects = (entry) => entry.params.context === "P1"
      yield* Scope.close(lifetime, Exit.void)
      assert.deepStrictEqual(widthsFor(sent, (params) => params.userContexts !== undefined), [null])
      assert.deepStrictEqual(widthsFor(sent, (params) => params.context === "P2"), [700])
    }))

  it.effect("restores the other user contexts on a browser release when one rejects its command", () =>
    Effect.gen(function*() {
      const { sent, session, state } = yield* make()
      yield* Contexts.createUserContext(state, options)
      yield* Contexts.createUserContext(state, options)
      const lifetime = yield* Scope.make()
      yield* declare(state, { _tag: "Browser" }, 1100, lifetime)
      sent.length = 0
      session.rejects = (entry) => entry.params.userContexts?.includes("U1") === true
      yield* Scope.close(lifetime, Exit.void)
      assert.deepStrictEqual(widthsFor(sent, (params) => params.userContexts?.includes("U2") === true), [null])
    }))

  it.effect("declares a context's viewport while another of its pages is closing", () =>
    Effect.gen(function*() {
      const { page, sent, session, state } = yield* make()
      const closing = page("P1")
      yield* declare(state, { _tag: "Page", page: closing.page.id }, 640, yield* Scope.make())
      yield* Contexts.closePage(state, closing.page.id, { runBeforeUnload: false })
      sent.length = 0
      session.rejects = (entry) => entry.params.context === "P1"
      const exit = yield* Effect.exit(
        declare(state, { _tag: "UserContext", context: state.defaultContext }, 1000, yield* Scope.make())
      )
      assert.isTrue(Exit.isSuccess(exit))
      assert.deepStrictEqual(widthsFor(sent, (params) => params.context === "P1"), [])
    }))

  it.effect("removes a user context whose viewport setup fails", () =>
    Effect.gen(function*() {
      const { sent, session, state } = yield* make()
      session.rejects = (entry) => entry.method === "browsingContext.setViewport"
      const exit = yield* Effect.exit(Contexts.createUserContext(state, options))
      assert.isTrue(Exit.isFailure(exit))
      assert.isTrue(sent.some((entry) => entry.method === "browser.removeUserContext"))
      assert.isFalse([...state.contexts.values()].some((context) => context.bidi === "U1"))
    }))
})
