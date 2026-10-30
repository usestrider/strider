/**
 * The BiDi adapter's state, without a browser: an operation that names a page, document or realm of its own that
 * ended gets `Gone`, never `Foreign`; a handle it doesn't hold fails as `Gone` rather than being sent empty; and
 * base64 the browser sent that doesn't decode fails rather than giving empty bytes.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as BrowsingContext from "../src/bidi-protocol/BrowsingContext.ts"
import type * as Script from "../src/bidi-protocol/Script.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Capture from "../src/internal/bidiAdapter/capture.ts"
import * as Evaluation from "../src/internal/bidiAdapter/evaluation.ts"
import * as State from "../src/internal/bidiAdapter/state.ts"
import * as Tree from "../src/internal/bidiAdapter/tree.ts"
import type * as ProtocolClient from "../src/internal/protocolClient.ts"
import type * as Protocol from "../src/protocol/Protocol.ts"

const control: ProtocolClient.FoldControl = {
  sync: () => {},
  session: () => undefined,
  run: (effect) => effect
}

/** A session that answers each command from `replies`, by method, and records what was sent. */
const session = (replies: Readonly<Record<string, unknown>>) => {
  const sent: Array<string> = []
  const root = {
    key: undefined,
    send: (command: Protocol.Command<string, unknown, unknown>) =>
      Effect.sync(() => {
        sent.push(command.method)
        return replies[command.method]
      }),
    drainObserved: Effect.void
  } as unknown as ProtocolClient.Session
  return { root, sent }
}

/** A state with one page in the default context, its document, and the document's main realm. */
const withPage = Effect.fnUntraced(function*(replies: Readonly<Record<string, unknown>> = {}) {
  const buffer = yield* Kit.makeFactBuffer(() => Effect.void)
  buffer.connect(control)
  const { root, sent } = session(replies)
  const state = State.make({
    connect: { sink: () => Effect.void, ownership: "launched" },
    ids: Kit.makeIds(),
    buffer,
    control,
    root: () => root
  })
  const page = Tree.addNavigable(state, {
    context: "C1" as BrowsingContext.BrowsingContext,
    userContext: "default",
    originalOpener: null,
    url: "about:blank"
  }, false)!
  const document = page.document!
  const realm: State.RealmEntry = {
    id: state.ids.realm(),
    bidi: "R1" as Script.Realm,
    navigable: page,
    world: { _tag: "Main" },
    origin: "null",
    ended: false,
    pending: false,
    held: []
  }
  state.realms.set(realm.bidi, realm)
  state.realmsById.set(realm.id, realm)
  Tree.addWindowRealm(state, realm, document)
  return { state, page, document, realm, sent }
})

describe("BidiAdapter state", () => {
  it.effect("fails an operation on a page that ended as Gone, with why it ended", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage()
      Tree.removeNavigable(state, page, { _tag: "PageClosed", by: "command" }, "test")
      const error = yield* State.navigableById(state, page.id).pipe(Effect.flip)
      assert.deepStrictEqual(error.reason, {
        _tag: "Gone",
        target: { _tag: "Page", id: page.id },
        reason: { _tag: "PageClosed", by: "command" }
      })
      const foreign = yield* State.navigableById(state, Kit.makeIds().navigable()).pipe(Effect.flip)
      assert.strictEqual(foreign.reason._tag, "Foreign")
    }))

  it.effect("fails the realm of a document that ended as Gone, and a realm that ended", () =>
    Effect.gen(function*() {
      const { document, page, realm, state } = yield* withPage()
      Tree.removeNavigable(state, page, { _tag: "PageClosed", by: "command" }, "test")
      const replaced = yield* Evaluation.realm(state, document.id, { _tag: "Main" }).pipe(Effect.flip)
      assert.deepStrictEqual(replaced.reason, {
        _tag: "Gone",
        target: { _tag: "Document", id: document.id },
        reason: { _tag: "DocumentReplaced" }
      })
      const ended = yield* Evaluation.evaluate(state, realm.id, {
        functionDeclaration: "() => 1",
        arguments: [],
        awaitPromise: false,
        result: "value",
        userActivation: false
      }).pipe(Effect.flip)
      assert.strictEqual(ended.reason._tag, "Gone")
    }))

  it.effect("fails a handle it doesn't hold as Gone, and sends nothing", () =>
    Effect.gen(function*() {
      const { realm, sent, state } = yield* withPage()
      const call = (handle: Adapter.HandleId) =>
        Evaluation.evaluate(state, realm.id, {
          functionDeclaration: "(object) => typeof object",
          arguments: [{ _tag: "Handle", handle }],
          awaitPromise: false,
          result: "value",
          userActivation: false
        }).pipe(Effect.flip)
      const released = yield* call(state.ids.handle())
      assert.deepStrictEqual(released.reason, {
        _tag: "Gone",
        target: { _tag: "Realm", id: realm.id },
        reason: { _tag: "RealmDestroyed" }
      })
      const foreign = yield* call(Kit.makeIds().handle())
      assert.strictEqual(foreign.reason._tag, "Foreign")
      assert.deepStrictEqual(sent, [])
    }))

  it.effect("fails a screenshot whose base64 doesn't decode, rather than giving empty bytes", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage({ "browsingContext.captureScreenshot": { data: "not base64!" } })
      const error = yield* Capture.screenshot(state, page.id, {
        format: "png",
        quality: Option.none(),
        clip: Option.none(),
        fullPage: false,
        scale: "device",
        omitBackground: false
      }).pipe(Effect.flip)
      assert.strictEqual(error.reason._tag, "Protocol")
    }))
})
