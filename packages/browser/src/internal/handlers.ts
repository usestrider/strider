/**
 * Handlers that decide a page's obligations: `Dialog.handle`
 * and `FileChooser.handle` register the same way.
 *
 * The page's latest registration still in its scope decides, chosen when the obligation opens. It runs in a
 * fiber of its registration's scope, with the requirements captured at `handle` and `Deadline.DefaultBudget`
 * as read then. Failing, being interrupted or running out of time leaves the obligation to the policy, and
 * the failure is logged at Effect's `References.UnhandledLogLevel`, unless it was interrupted.
 */
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Option from "effect/Option"
import * as References from "effect/References"
import type * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Deadline from "../Deadline.ts"
import * as Declaration from "../Declaration.ts"
import * as Reason from "../Reason.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"
import * as Watchable from "./watchable.ts"

/** Logs a handler that didn't decide, at Effect's level for unhandled failures, unless it was interrupted. */
export const report = (message: string, cause: Cause.Cause<unknown>) =>
  Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.gen(function*() {
    const level = yield* References.UnhandledLogLevel
    if (level !== undefined) yield* Effect.logWithLevel(level)(message, cause)
  })

export interface Options<S, P, D, E, R> {
  readonly page: Model.PageEntry
  /** The page's registrations of this kind, oldest first. */
  readonly handlers: Array<Model.Handler<S>>
  readonly handler: (pending: P) => Effect.Effect<D, E, R>
  /** What the handler is given for an obligation. */
  readonly pending: (subject: S) => P
  /** The adapter's decision for what the handler returned about an obligation, or why it isn't one. */
  readonly decision: (chosen: D, subject: S) => Effect.Effect<Adapter.Decision | Staged, unknown>
  /** What it decides, for the log: `"confirm"`, `"file chooser"`. */
  readonly noun: (subject: S) => string
  /** What a wait on `handled` reports: `"Dialog.handle.handled.waitFor"`. */
  readonly operation: string
  /** The handler's module, for the log: `"Dialog.handle"`. */
  readonly name: string
  /** What decides when it doesn't: `"the context's policy"`. */
  readonly fallback: string
}

/**
 * A decision the library carries out itself before the adapter's part, such as made files the page sets on a
 * chooser's input. It is counted in `handled` when the handler decides, as every decision is, and carried out
 * after (QUIRKS.md, Q152).
 */
export interface Staged {
  readonly _tag: "Staged"
  readonly apply: Effect.Effect<Adapter.Decision, unknown>
}

/** Registers a handler for the scope; removing it, or closing its scope, leaves later obligations to the one before. */
/**
 * Fails a handler's registration when the backend reports what it handles as unsupported: a handler nothing would
 * ever ask, with the capability's limitations as the hint.
 */
export const requires = (
  runtime: Runtime.Runtime,
  declaration: string,
  capability: string
): Effect.Effect<void, Declaration.DeclarationError> =>
  Effect.flatMap(SubscriptionRef.get(runtime.model.adapter.capabilities), (capabilities) => {
    const entry = capabilities.entries.find((each) => each.name === capability)
    return entry === undefined || entry.status !== "unsupported"
      ? Effect.void
      : Effect.fail(
        new Declaration.DeclarationError({
          declaration,
          reason: new Reason.Unsupported({
            capability,
            backend: runtime.backend,
            hint: entry.limitations.length > 0 ? entry.limitations.join("; ") : `${runtime.backend} reports none`
          }),
          diagnostics: Operation.diagnostics(Operation.operationId())
        })
      )
  })

export const register = <S, P, D, E, R>(
  options: Options<S, P, D, E, R>
): Effect.Effect<Declaration.HandlerRegistration, never, Scope.Scope | R> =>
  Effect.gen(function*() {
    const context = yield* Effect.context<R>()
    const budget = yield* Effect.service(Deadline.DefaultBudget)
    const clock = yield* Effect.service(BrowserClock.CurrentClock)
    // The handler's fibers end with its scope, which leaves an undecided obligation to the policy
    const fibers = yield* FiberSet.make<D, E>()
    const handled = yield* SubscriptionRef.make(0)
    const id = options.page.id
    const registration: Model.Handler<S> = {
      decide: Effect.fnUntraced(function*(subject: S) {
        // Each decision has the handler's budget from when it starts, not the deadline in force at registration
        const fiber = yield* FiberSet.run(
          fibers,
          Effect.provideContext(options.handler(options.pending(subject)).pipe(Operation.deciding(budget)), context)
        )
        const exit = yield* Fiber.await(fiber).pipe(BrowserClock.timeoutOn(clock, Duration.toMillis(budget)))
        const described = `${options.name}: the handler of ${id} didn't decide the ${options.noun(subject)}`
        if (Option.isNone(exit)) {
          yield* Fiber.interrupt(fiber)
          yield* report(`${described} within ${Duration.format(budget)}, so ${options.fallback} decides`, Cause.empty)
          return Option.none()
        }
        if (Exit.isFailure(exit.value)) {
          yield* report(`${described}: it failed, so ${options.fallback} decides`, exit.value.cause)
          return Option.none()
        }
        const decision = yield* options.decision(exit.value.value, subject).pipe(Effect.exit)
        if (Exit.isFailure(decision)) {
          yield* report(`${described}: its decision couldn't be made, so ${options.fallback} decides`, decision.cause)
          return Option.none()
        }
        yield* SubscriptionRef.update(handled, (count) => count + 1)
        if (decision.value._tag !== "Staged") return Option.some(decision.value)
        const applied = yield* decision.value.apply.pipe(Effect.exit)
        if (Exit.isFailure(applied)) {
          yield* report(`${described}: its decision couldn't be made, so ${options.fallback} decides`, applied.cause)
          return Option.none()
        }
        return Option.some(applied.value)
      })
    }
    options.handlers.push(registration)
    const remove = Effect.sync(() => {
      const index = options.handlers.indexOf(registration)
      if (index >= 0) options.handlers.splice(index, 1)
    })
    yield* Effect.addFinalizer(() => remove)
    const registered: Declaration.HandlerRegistration = {
      remove,
      handled: Watchable.make({
        ref: handled,
        project: Option.some,
        ended: () => Option.none(),
        target: { _tag: "Page", id },
        operation: options.operation
      })
    }
    return registered
  })
