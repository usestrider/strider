/**
 * Ownership (CONCEPTS.md §3): a page the library owns is released by the scope that owns it, its creator's or, for
 * a popup, its opener's, unless a transfer moved it; a context the library creates is removed by the scope it was
 * created in. Who owns a page is its state, which the fold writes (`Model.own`, `Model.transfer`); releasing a page
 * or removing a context is a command the browser confirms by ending it, which happens here, apart from the fold,
 * once the model has its adapter.
 *
 * Both wait the same way (`awaitEnd`). The command is sent in a fiber of the model's scope, and the wait is once,
 * for the target's end as the fold reports it, not for the command's reply first: a browser that ends the target
 * and answers late, or never, keeps the wait no longer than the end. The command runs to its own end, its replies
 * bounded by `Protocol.CommandTimeout`, however the wait ends: stopping waiting never interrupts cleanup. The wait
 * is its own, `Deadline.DefaultBudget` from when it starts, whatever operation's deadline its scope's finalizer
 * captured: it is cleanup, which no operation bounds. It stops early when the command fails, since then either
 * nothing will end the target, or the target or the connection is gone already and the fold reports it. Halfway
 * through its budget, a wait still waiting logs a warning naming the target and what it waits on, and again if it
 * stops waiting with the target still open. A target that has ended already, as everything has once the connection
 * is lost, is never waited for.
 */
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Handoff from "./handoff.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"

export interface Ownership {
  /** The adapter, once the model has it: a release before then waits for it. */
  readonly connected: Deferred.Deferred<Adapter.AdapterConnection>
  readonly attach: (adapter: Adapter.AdapterConnection) => Effect.Effect<void>
  /**
   * Sends a page's close in a fiber of the model's scope, which runs to its own end however long its sender waits,
   * and returns the fiber: `Page.close` waits for the page's end, under its own deadline, rather than the reply.
   */
  readonly closeApart: (
    page: Target.NavigableId,
    options: { readonly runBeforeUnload: boolean }
  ) => Effect.Effect<Fiber.Fiber<void, Adapter.AdapterError>>
  /**
   * Closes a page its owner's scope released, unless it already closed, and waits for the page's end under the
   * default budget: a page created right after must not meet a browser still closing this one (QUIRKS.md, Q119
   * and Q135). With `by`, only while `by` still owns it: a page transferred is its new owner's to release.
   */
  readonly release: (page: Model.PageEntry, by?: Scope.Scope) => Effect.Effect<void>
  /**
   * Removes a context its creator's scope released, unless it already ended, and waits for its end, which follows
   * its pages', under the default budget.
   */
  readonly remove: (context: Model.ContextEntry) => Effect.Effect<void>
}

/** How a wait's warnings name its target and what the browser was asked to do to it. */
interface Words {
  /** The target, as a warning starts: `Page N1`. */
  readonly target: string
  /** The warning's log annotation: the target's id, under its span attribute's name. */
  readonly annotation: readonly [key: string, id: string]
  /** What the target is doing while the wait lasts: `is still closing`. */
  readonly doing: string
  /** The wait, as its warnings name it: `release`. */
  readonly wait: string
  /** What ends: `page`. */
  readonly what: string
  /** What the browser was asked to do: `close`. */
  readonly command: string
  /** That it wasn't done: `wasn't closed`. */
  readonly undone: string
  /** What the wait waits on once the command was answered: `the page hasn't ended`. */
  readonly remaining: () => string
}

/**
 * Whether a command failed for a reason other than its target or the connection being gone already, whose end the
 * fold reports.
 */
const refused = (exit: Exit.Exit<void, Adapter.AdapterError>): Option.Option<string> => {
  if (Exit.isSuccess(exit)) return Option.none()
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  if (failure === undefined) return Option.none()
  const reason = failure.error.reason
  return reason._tag === "Gone" || (reason._tag === "Protocol" && reason.error.reason._tag === "SessionEnded")
    ? Option.none()
    : Option.some(failure.error.message)
}

/** Pages' ids, as a sentence lists them: `N1`, `N1 and N2`, `N1, N2 and N3`. */
const listed = (pages: ReadonlyArray<Model.PageEntry>): string =>
  pages.length === 1
    ? pages[0]!.id
    : `${pages.slice(0, -1).map((page) => page.id).join(", ")} and ${pages.at(-1)!.id}`

/**
 * Sends `command` in a fiber of `scope`, which runs to its own end, and waits for `ended` under the default budget
 * from now; it warns halfway through and on giving up, and when the browser refused the command.
 */
const awaitEnd = Effect.fnUntraced(function*(
  scope: Scope.Scope,
  command: Effect.Effect<void, Adapter.AdapterError>,
  ended: Deferred.Deferred<Target.CloseReason>,
  words: Words
) {
  const budget = yield* Operation.budget
  const half = Duration.divideUnsafe(budget.budget, 2)
  const halfway = yield* BrowserClock.after(Duration.toMillis(half))
  // In the model's scope, so it ends with the connection at the latest, and never with the wait
  const sent = yield* Effect.forkIn(command, scope)
  // The target's end; or the command's failure, after which nothing will end it, or the fold reports what did
  const done = Effect.raceFirst(
    Deferred.await(ended),
    Effect.flatMap(Fiber.await(sent), (exit) => Exit.isSuccess(exit) ? Effect.never : Effect.void)
  )
  const waitingOn = () =>
    sent.pollUnsafe() === undefined
      ? `the browser hasn't answered the command to ${words.command} it`
      : `the browser answered the command to ${words.command} it, and ${words.remaining()}`
  const warn = (message: string) =>
    Effect.logWarning(`${words.target} ${message}`).pipe(Effect.annotateLogs(words.annotation[0], words.annotation[1]))
  if (Option.isNone(yield* done.pipe(BrowserClock.until(halfway)))) {
    yield* warn(
      `${words.doing} after ${Duration.format(half)}: ${waitingOn()}; ` +
        `its ${words.wait} waits up to ${Duration.format(budget.budget)} for the ${words.what} to end`
    )
    if (Option.isNone(yield* done.pipe(BrowserClock.until(budget.at)))) {
      return yield* warn(
        `didn't end within ${Duration.format(budget.budget)} of its ${words.wait}: ${waitingOn()}; ` +
          `its ${words.wait} stopped waiting`
      )
    }
  }
  if (Option.isSome(yield* Deferred.poll(ended))) return
  const failure = Option.flatMap(Option.fromUndefinedOr(sent.pollUnsafe()), refused)
  if (Option.isSome(failure)) {
    yield* warn(`${words.undone}: the browser refused the command to ${words.command} it (${failure.value})`)
  }
})

export const make = Effect.fnUntraced(function*() {
  const modelScope = yield* Effect.scope
  const connected = yield* Deferred.make<Adapter.AdapterConnection>()
  const ownership: Ownership = {
    connected,
    attach: (adapter) => Effect.asVoid(Deferred.succeed(connected, adapter)),
    closeApart: (page, options) =>
      Effect.flatMap(
        Deferred.await(connected),
        (adapter) => Effect.forkIn(adapter.closePage(page, options), modelScope)
      ),
    release: Effect.fnUntraced(
      function*(page: Model.PageEntry, by?: Scope.Scope) {
        const state = yield* page.state.get
        if (state.status._tag === "Closed") return
        if (by !== undefined && !Option.exists(state.owner, (owner) => owner === by)) return
        const adapter = yield* Deferred.await(connected)
        if (adapter.claims !== undefined && Option.exists(state.owner, Handoff.leavesOpen)) return
        yield* awaitEnd(modelScope, adapter.closePage(page.id, { runBeforeUnload: false }), page.closed, {
          target: `Page ${page.id}`,
          annotation: ["browser.page.id", page.id],
          doing: "is still closing",
          wait: "release",
          what: "page",
          command: "close",
          undone: "wasn't closed",
          remaining: () => "the page hasn't ended"
        })
      },
      // Cleanup: its budget is its own, never the deadline of the operation whose scope it finalizes
      Operation.detached
    ),
    remove: Effect.fnUntraced(
      function*(context: Model.ContextEntry) {
        if (Option.isSome(yield* Deferred.poll(context.closed))) return
        const adapter = yield* Deferred.await(connected)
        yield* awaitEnd(modelScope, adapter.removeUserContext(context.id), context.closed, {
          target: `Context ${context.id}`,
          annotation: ["browser.context.id", context.id],
          doing: "is still being removed",
          wait: "removal",
          what: "context",
          command: "remove",
          undone: "wasn't removed",
          remaining: () => {
            // Its pages end first, each as the browser reports it, and the context once they all have
            const open = context.state.getUnsafe().pages
            return open.length === 0
              ? "the context hasn't ended"
              : open.length === 1
              ? `its page ${listed(open)} hasn't ended`
              : `its pages ${listed(open)} haven't ended`
          }
        })
      },
      // Cleanup, as a release is
      Operation.detached
    )
  }
  return ownership
})
