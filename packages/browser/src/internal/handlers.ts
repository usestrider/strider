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
import * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Deadline from "../Deadline.ts"
import * as Declaration from "../Declaration.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
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
  /** Adds the registration to the page for the scope, as a command the model's fold applies (`Model.handlePrompts`). */
  readonly add: (handler: Model.Handler<S>) => Effect.Effect<void, never, Scope.Scope>
  readonly handler: (pending: P) => Effect.Effect<D, E, R>
  /** What the handler is given for an obligation. */
  readonly pending: (subject: S) => P
  /** The adapter's decision for what the handler returned about an obligation, or why it isn't one. */
  readonly decision: (chosen: D, subject: S) => Effect.Effect<Adapter.Decision | Staged, unknown, Scope.Scope>
  /**
   * Own a temporary scope for internal preparation through staged application.
   * @default false
   */
  readonly scopedDecision?: boolean | undefined
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

/** The bounded work's outcome; reporting stays in the resolving fiber's context. */
type Outcome =
  | { readonly _tag: "Failed"; readonly phase: "handler" | "decision"; readonly cause: Cause.Cause<unknown> }
  | { readonly _tag: "Expired" }
  | { readonly _tag: "Decided"; readonly decision: Adapter.Decision }

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
          diagnostics: Operation.diagnosticsNow()
        })
      )
  })

export const register = <S, P, D, E, R>(
  options: Options<S, P, D, E, R>
): Effect.Effect<Declaration.HandlerRegistration, never, Scope.Scope | R> =>
  Effect.gen(function*() {
    const context = yield* Effect.context<R>()
    const registrationScope = yield* Effect.scope
    const budget = yield* Effect.service(Deadline.DefaultBudget)
    const clock = yield* Effect.service(BrowserClock.CurrentClock)
    // The handler's fibers end with its scope, which leaves an undecided obligation to the policy
    const fibers = yield* FiberSet.make<Outcome>()
    const handled = yield* SubscriptionRef.make(0)
    const id = options.page.id
    const registration: Model.Handler<S> = {
      decide: Effect.fnUntraced(function*(subject: S) {
        // The user handler, preparation and application share one deadline and one scope-owned fiber.
        const at = (clock.now() + Duration.toMillis(budget) * 1e6) as MonotonicInstant.MonotonicInstant
        const described = `${options.name}: the handler of ${id} didn't decide the ${options.noun(subject)}`
        const expired = () => BrowserClock.millisLeft(clock, at) === 0
        const timedOut = report(
          `${described} within ${Duration.format(budget)}, so ${options.fallback} decides`,
          Cause.empty
        )
        const fiber = yield* FiberSet.run(
          fibers,
          Effect.provideContext(
            Effect.gen(function*() {
              const chosen = yield* options.handler(options.pending(subject)).pipe(Effect.exit)
              if (Exit.isFailure(chosen)) return { _tag: "Failed", phase: "handler", cause: chosen.cause } as const
              if (expired()) return { _tag: "Expired" } as const
              // Internal preparation owns resources through staged application; the user handler keeps its registration scope.
              const deciding = Effect.gen(function*() {
                const decision = yield* options.decision(chosen.value, subject).pipe(Effect.exit)
                if (Exit.isFailure(decision)) {
                  return { _tag: "Failed", phase: "decision", cause: decision.cause } as const
                }
                // A read may finish after its deadline even if its service masks interruption.
                if (expired()) return { _tag: "Expired" } as const
                yield* SubscriptionRef.update(handled, (count) => count + 1)
                if (decision.value._tag !== "Staged") return { _tag: "Decided", decision: decision.value } as const
                const applied = yield* decision.value.apply.pipe(Effect.exit)
                return Exit.isFailure(applied)
                  ? { _tag: "Failed", phase: "decision", cause: applied.cause } as const
                  : { _tag: "Decided", decision: applied.value } as const
              })
              return yield* (options.scopedDecision
                ? Effect.scoped(deciding)
                : Scope.provide(deciding, registrationScope))
            }).pipe(
              (self) => Operation.under(self, at),
              Operation.apart(options.name, budget)
            ),
            context
          )
        )
        const exit = yield* Fiber.await(fiber).pipe(BrowserClock.timeoutOn(clock, BrowserClock.millisLeft(clock, at)))
        if (Option.isNone(exit)) {
          yield* Fiber.interrupt(fiber)
          yield* timedOut
          return Option.none()
        }
        if (Exit.isFailure(exit.value)) {
          yield* report(`${described}: it failed, so ${options.fallback} decides`, exit.value.cause)
          return Option.none()
        }
        const outcome = exit.value.value
        if (outcome._tag === "Expired") {
          yield* timedOut
          return Option.none()
        }
        if (outcome._tag === "Failed") {
          yield* report(
            outcome.phase === "handler"
              ? `${described}: it failed, so ${options.fallback} decides`
              : `${described}: its decision couldn't be made, so ${options.fallback} decides`,
            outcome.cause
          )
          return Option.none()
        }
        return Option.some(outcome.decision)
      })
    }
    // In force once this returns: an obligation folded after it is this handler's to decide
    const scope = yield* Scope.fork(yield* Effect.scope)
    yield* options.add(registration).pipe(Scope.provide(scope))
    const remove = Scope.close(scope, Exit.void)
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
