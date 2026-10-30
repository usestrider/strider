/**
 * The CDP adapter's state, without a browser: a page that ended takes its input state with it, and an operation
 * that names it after gets `Gone` with the page's reason, never `Foreign`.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Responses from "../src/internal/cdpAdapter/responses.ts"
import * as State from "../src/internal/cdpAdapter/state.ts"
import * as Tree from "../src/internal/cdpAdapter/tree.ts"
import type * as ProtocolClient from "../src/internal/protocolClient.ts"

const session = {} as ProtocolClient.Session

const control: ProtocolClient.FoldControl = {
  sync: () => {},
  session: () => undefined,
  run: (effect) => effect
}

/** A state with one page in the default context. */
const withPage = Effect.fnUntraced(function*() {
  const buffer = yield* Kit.makeFactBuffer(() => Effect.void)
  buffer.connect(control)
  const state = State.make({
    connect: { sink: () => Effect.void, ownership: "launched" },
    ids: Kit.makeIds(),
    buffer,
    control,
    root: () => session,
    release: Responses.release
  })
  const context: State.ContextEntry = {
    id: state.defaultContext,
    browserContextId: undefined,
    isDefault: true,
    removing: false
  }
  state.contexts.set(context.id, context)
  const target: State.TargetEntry = {
    kind: "page",
    targetId: "T1",
    session,
    page: undefined,
    frame: undefined,
    url: "about:blank",
    realm: undefined,
    intercepts: "",
    scripts: new Map(),
    ended: false
  }
  const page: State.PageEntry = {
    id: state.ids.navigable(),
    targetId: "T1",
    context,
    target,
    ready: Deferred.makeUnsafe(),
    closing: undefined,
    ended: false
  }
  state.pages.set(page.id, page)
  const main = Tree.newFrame({ frameId: "T1", id: page.id, page, parent: undefined, owner: target })
  state.frames.set("T1", main)
  state.navigables.set(page.id, main)
  return { state, page }
})

describe("CdpAdapter state", () => {
  it.effect("forgets a page's held buttons, drag and drag interception when the page ends", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage()
      state.heldButtons.set(page.id, 1)
      state.drags.set(page.id, { data: { items: [], dragOperationsMask: 1 }, entered: true, stale: false })
      state.interceptingDrags.add(page.id)
      Tree.endPage(state, page, { _tag: "PageClosed", by: "command" }, "test")
      assert.isFalse(state.heldButtons.has(page.id))
      assert.isFalse(state.drags.has(page.id))
      assert.isFalse(state.interceptingDrags.has(page.id))
    }))

  it.effect("fails an operation on a page that ended as Gone, with why it ended", () =>
    Effect.gen(function*() {
      const { page, state } = yield* withPage()
      Tree.endPage(state, page, { _tag: "PageCrashed" }, "test")
      const error = yield* State.pageOf(state, page.id).pipe(Effect.flip)
      assert.deepStrictEqual(error.reason, {
        _tag: "Gone",
        target: { _tag: "Page", id: page.id },
        reason: { _tag: "PageCrashed" }
      })
      const frame = yield* State.frameById(state, page.id).pipe(Effect.flip)
      assert.strictEqual(frame.reason._tag, "Gone")
      const foreign = yield* State.pageOf(state, Kit.makeIds().navigable()).pipe(Effect.flip)
      assert.strictEqual(foreign.reason._tag, "Foreign")
    }))

  it.effect("fails a document or realm that ended as Gone", () =>
    Effect.gen(function*() {
      const { state } = yield* withPage()
      const document = yield* State.documentOf(state, state.ids.document()).pipe(Effect.flip)
      assert.strictEqual(document.reason._tag, "Gone")
      const realm = yield* State.realmOf(state, state.ids.realm()).pipe(Effect.flip)
      assert.strictEqual(realm.reason._tag, "Gone")
    }))
})
