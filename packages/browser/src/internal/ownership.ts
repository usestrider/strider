/**
 * Ownership (CONCEPTS.md §3): a page the library owns is released by the scope that owns it, its creator's or, for
 * a popup, its opener's, unless a transfer moved it. Who owns a page is its state, which the fold writes
 * (`Model.own`, `Model.transfer`); releasing it is a close the browser confirms, which happens here, apart from
 * the fold, once the model has its adapter.
 *
 * A release is done when the page ends. Its close is sent in a fiber of the model's scope, and the release waits
 * once, for the page's end, not for the close's reply first: a browser that ends the page and answers the close
 * late, or never, keeps the release no longer than the page's end. The close runs to its own end, its reply bounded
 * by `Protocol.CommandTimeout`, however the release ends. The wait is the release's own, `Deadline.DefaultBudget`
 * from when it starts, whatever operation's deadline its scope's finalizer captured: a release is cleanup, which no
 * operation bounds. It stops early only when the close fails without ending the page, since then nothing will.
 * Halfway through its budget, a release still waiting logs a warning naming the page and what it waits on, and again
 * if it stops waiting with the page still open.
 */
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
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
   * Closes a page its owner's scope released, unless it already closed, and waits for the page's end under the
   * default budget: a page created right after must not meet a browser still closing this one (QUIRKS.md, Q119
   * and Q135). With `by`, only while `by` still owns it: a page transferred is its new owner's to release.
   */
  readonly release: (page: Model.PageEntry, by?: Scope.Scope) => Effect.Effect<void>
}

/** What a release still waiting is waiting on: the close's reply, or, once the close was answered, the page's end. */
const waitingOn = (close: Fiber.Fiber<void, Adapter.AdapterError>): string =>
  close.pollUnsafe() === undefined
    ? "the browser hasn't answered the command to close it"
    : "the browser answered the command to close it, and the page hasn't ended"

/** Whether a close failed for a reason other than the page being gone already, which its end reports. */
const refused = (exit: Exit.Exit<void, Adapter.AdapterError>): Option.Option<string> => {
  if (Exit.isSuccess(exit)) return Option.none()
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  return failure === undefined || failure.error.reason._tag === "Gone"
    ? Option.none()
    : Option.some(failure.error.message)
}

export const make = Effect.fnUntraced(function*() {
  const modelScope = yield* Effect.scope
  const connected = yield* Deferred.make<Adapter.AdapterConnection>()
  const ownership: Ownership = {
    connected,
    attach: (adapter) => Effect.asVoid(Deferred.succeed(connected, adapter)),
    release: Effect.fnUntraced(
      function*(page: Model.PageEntry, by?: Scope.Scope) {
        const state = yield* page.state.get
        if (state.status._tag === "Closed") return
        if (by !== undefined && !Option.exists(state.owner, (owner) => owner === by)) return
        const adapter = yield* Deferred.await(connected)
        const budget = yield* Operation.budget
        const half = Duration.divideUnsafe(budget.budget, 2)
        const halfway = yield* BrowserClock.after(Duration.toMillis(half))
        // In the model's scope, so it ends with the connection at the latest, and never with the release
        const close = yield* adapter.closePage(page.id, { runBeforeUnload: false }).pipe(Effect.forkIn(modelScope))
        // The page's end; or the close's failure, after which nothing will end it
        const ended = Effect.raceFirst(
          Deferred.await(page.closed),
          Effect.flatMap(Fiber.await(close), (exit) => Exit.isSuccess(exit) ? Effect.never : Effect.void)
        )
        const warn = (message: string) =>
          Effect.logWarning(`Page ${page.id} ${message}`).pipe(Effect.annotateLogs("browser.page.id", page.id))
        if (Option.isNone(yield* ended.pipe(BrowserClock.until(halfway)))) {
          yield* warn(
            `is still closing after ${Duration.format(half)}: ${waitingOn(close)}; ` +
              `its release waits up to ${Duration.format(budget.budget)} for the page to end`
          )
          if (Option.isNone(yield* ended.pipe(BrowserClock.until(budget.at)))) {
            return yield* warn(
              `didn't end within ${Duration.format(budget.budget)} of its release: ${waitingOn(close)}; ` +
                "its release stopped waiting"
            )
          }
        }
        if (Option.isSome(yield* Deferred.poll(page.closed))) return
        const failure = Option.flatMap(Option.fromUndefinedOr(close.pollUnsafe()), refused)
        if (Option.isSome(failure)) {
          yield* warn(`wasn't closed: the browser refused the command to close it (${failure.value})`)
        }
      },
      // Cleanup: its budget is its own, never the deadline of the operation whose scope it finalizes
      Operation.detached
    )
  }
  return ownership
})
