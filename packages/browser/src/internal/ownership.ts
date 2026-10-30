/**
 * Ownership (CONCEPTS.md §3): a page the library owns is released by the scope that owns it, its creator's or, for
 * a popup, its opener's, unless a transfer moved it. Who owns a page is its state, which the fold writes
 * (`Model.own`, `Model.transfer`); releasing it is a close the browser confirms, which happens here, apart from
 * the fold, once the model has its adapter.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"

export interface Ownership {
  /** The adapter, once the model has it: a release before then waits for it. */
  readonly connected: Deferred.Deferred<Adapter.AdapterConnection>
  readonly attach: (adapter: Adapter.AdapterConnection) => Effect.Effect<void>
  /**
   * Closes a page its owner's scope released, unless it already closed, and waits for the close under the
   * default budget: a page created right after must not meet a browser still closing this one (QUIRKS.md, Q119
   * and Q135). With `by`, only while `by` still owns it: a page transferred is its new owner's to release.
   */
  readonly release: (page: Model.PageEntry, by?: Scope.Scope) => Effect.Effect<void>
}

export const make = Effect.fnUntraced(function*() {
  const connected = yield* Deferred.make<Adapter.AdapterConnection>()
  const ownership: Ownership = {
    connected,
    attach: (adapter) => Effect.asVoid(Deferred.succeed(connected, adapter)),
    release: Effect.fnUntraced(function*(page: Model.PageEntry, by?: Scope.Scope) {
      const state = yield* page.state.get
      if (state.status._tag === "Closed") return
      if (by !== undefined && !Option.exists(state.owner, (owner) => owner === by)) return
      const adapter = yield* Deferred.await(connected)
      yield* Effect.ignore(adapter.closePage(page.id, { runBeforeUnload: false }))
      const budget = yield* Operation.budget
      yield* Deferred.await(page.closed).pipe(BrowserClock.until(budget.at))
    })
  }
  return ownership
})
