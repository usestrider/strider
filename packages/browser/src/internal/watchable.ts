/**
 * Builds `Watchable`s over an entity's state ref (CONCEPTS.md §9, State). Effect 4 has no public way to
 * subclass `Effect`, so a watchable is an effect value, the read, with its members attached.
 */
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import type * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Target from "../Target.ts"
import * as Watchable from "../Watchable.ts"
import * as Operation from "./operation.ts"

/** How to read a watchable from an entity's state. */
export interface Source<S, A> {
  readonly ref: SubscriptionRef.SubscriptionRef<S>
  /** The value, or `None` while there is none to show yet. */
  readonly project: (state: S) => Option.Option<A>
  /** Why the entity ended, once it has: the terminal state. */
  readonly ended: (state: S) => Option.Option<Target.CloseReason>
  /**
   * A state no other follows, though the entity lives on, such as a download that completed: changes end after
   * it, and a wait it doesn't satisfy fails at once, since nothing else will.
   */
  readonly final?: ((state: S) => boolean) | undefined
  /** The entity, for `TargetGone`. */
  readonly target: Target.Description
  /** The operation a wait reports, such as `Page.status.waitFor`. */
  readonly operation: string
}

/** The states from now on: the current one first, ending after the terminal or final one. */
const states = <S, A>(source: Source<S, A>) =>
  SubscriptionRef.changes(source.ref).pipe(
    Stream.takeUntil((state) => Option.isSome(source.ended(state)) || source.final?.(state) === true)
  )

/** A watchable over `source`. */
export const make = <S, A>(source: Source<S, A>): Watchable.Watchable<A> => {
  const read = Effect.flatMap(
    states(source).pipe(Stream.filterMap(Filter.fromPredicateOption(source.project)), Stream.runHead),
    Option.match({
      // Ended before it ever had a value: its last value is gone with it
      onNone: () => Effect.die(new Error(`${source.operation}: ended before it had a value`)),
      onSome: Effect.succeed
    })
  )
  // Conflated (README, principle 16): the newest value replaces one the consumer hasn't taken yet, so a slow consumer
  // sees the present, not every value since. Repeats are dropped after, against what the consumer last took
  const changes = states(source).pipe(
    Stream.filterMap(Filter.fromPredicateOption(source.project)),
    Stream.buffer({ capacity: 1, strategy: "sliding" }),
    Stream.changesWith(Equal.equals)
  )
  const waitFor = Effect.fnUntraced(function*(predicate: Predicate.Predicate<A>) {
    const record = yield* Operation.start(source.operation)
    const hint = () => Option.some("The value never satisfied the predicate; history lists what it was")
    return yield* states(source).pipe(
      Stream.mapEffect((state): Effect.Effect<Option.Option<A>, Target.TargetGone | Watchable.Ended> => {
        const value = source.project(state)
        if (Option.isSome(value)) {
          record.observe(value.value)
          if (predicate(value.value)) return Effect.succeed(Option.some(value.value))
        }
        const ended = source.ended(state)
        if (Option.isSome(ended)) {
          return Effect.fail(
            new Target.TargetGone({ target: source.target, reason: ended.value, diagnostics: record.diagnostics() })
          )
        }
        return source.final?.(state) === true
          ? Effect.fail(
            new Watchable.Ended({
              operation: source.operation,
              value: Option.getOrUndefined(value),
              diagnostics: record.diagnostics()
            })
          )
          : Effect.succeed(Option.none<A>())
      }),
      Stream.filterMap(Filter.fromPredicateOption((found: Option.Option<A>) => found)),
      Stream.runHead,
      (waiting) => record.bound(waiting, hint, "waitingForCondition"),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(record.timeout(hint(), "waitingForCondition")),
        onSome: Effect.succeed
      })),
      Operation.asStep(record)
    )
  })
  return Object.assign(Effect.suspend(() => read), {
    "~@usestrider/browser/Watchable": "~@usestrider/browser/Watchable" as const,
    changes,
    waitFor,
    map: <B>(f: (a: A) => B) => make({ ...source, project: (state: S) => Option.map(source.project(state), f) })
  }) as unknown as Watchable.Watchable<A>
}
