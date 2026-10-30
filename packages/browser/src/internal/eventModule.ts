/**
 * The wiring every event module repeats: `next`, `stream` and `history` over one channel of `events.ts`.
 *
 * A module says what differs: how a target and a filter become a channel, the entries that match and how an
 * entry is delivered. `make` gives it the three operations, named as the module names them (`"Popup.next"`).
 * The public module keeps each operation's signature, overloads and documentation, and delegates to these.
 */
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "../Deadline.ts"
import type * as Subscription from "../Subscription.ts"
import type * as Target from "../Target.ts"
import * as Events from "./events.ts"
import * as Operation from "./operation.ts"
import type * as Spans from "./spans.ts"

/** What a module resolves from a target and a filter, before it subscribes or reads. */
export interface Prepared<A, B, DE = never> {
  readonly channel: Events.Channel<A>
  /** The entries `stream` and `history` take, and `next` waits for unless `waitsFor` is given. */
  readonly accepts: (entry: Events.Entry<A>) => boolean
  /** The entries `next` waits for, when they are not the ones the others take. */
  readonly waitsFor?: ((entry: Events.Entry<A>) => boolean) | undefined
  /** The event a caller sees, made as it is delivered, and as `history` reads it. */
  readonly deliver: (value: A) => B
  /** Delivery that takes an effect, for `next` alone. */
  readonly delivery?: Events.Delivery<A, B, DE> | undefined
}

/** What differs between event modules. */
export interface Spec<T, F, A, B, DE = never> {
  /** The module's name, as its operations are: `"Popup"`. */
  readonly name: string
  /** What one event is called in a hint: `"a popup"`. */
  readonly noun: string
  /**
   * Resolves the target, checks what the backend must support, and compiles the filter, failing with
   * `SubscriptionError` for either. `operation` is the operation being run: `"Popup.next"`.
   */
  readonly prepare: (
    target: T,
    filter: F | undefined,
    operation: string
  ) => Effect.Effect<Prepared<A, B, DE>, Subscription.SubscriptionError>
  /** Span attributes of `next`, from its filter. */
  readonly attributes?: ((filter: F | undefined) => Spans.Options["attributes"]) | undefined
}

/** The three operations of an event module. */
export interface EventModule<T, F, B, DE = never> {
  readonly next: <PE = never, PR = never>(
    target: T,
    filter?: F | undefined,
    where?: Subscription.Where<B, PE, PR> | undefined
  ) => Effect.Effect<
    Effect.Effect<B, PE | DE | Target.TargetGone | Deadline.Timeout>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
  readonly stream: <PE = never, PR = never>(
    target: T,
    filter?: F | undefined,
    where?: Subscription.Where<B, PE, PR> | undefined
  ) => Effect.Effect<
    Stream.Stream<B, PE | Subscription.EventOverflow | Target.TargetGone>,
    Subscription.SubscriptionError,
    Scope.Scope | PR
  >
  readonly history: (
    target: T,
    filter?: F | undefined
  ) => Effect.Effect<Subscription.History<B>, Subscription.SubscriptionError>
}

/** Makes the `next`, `stream` and `history` of an event module. */
export const make = <T, F, A, B, DE = never>(spec: Spec<T, F, A, B, DE>): EventModule<T, F, B, DE> => {
  const prepare = (target: T, filter: F | undefined, operation: string) =>
    Effect.suspend(() => spec.prepare(target, filter, operation)).pipe(
      Effect.map((prepared) => ({
        prepared,
        kind: { operation, noun: spec.noun, deliver: prepared.deliver } satisfies Events.Kind<A, B>
      }))
    )
  return {
    next: (target, filter, where) => {
      const operation = `${spec.name}.next`
      return Effect.flatMap(
        prepare(target, filter, operation),
        ({ kind, prepared }) =>
          Events.next(kind, prepared.channel, prepared.waitsFor ?? prepared.accepts, where, prepared.delivery)
      ).pipe(Operation.named(operation, { attributes: spec.attributes?.(filter) }))
    },
    stream: (target, filter, where) =>
      Effect.flatMap(
        prepare(target, filter, `${spec.name}.stream`),
        ({ kind, prepared }) => Events.stream(kind, prepared.channel, prepared.accepts, where)
      ),
    history: (target, filter) =>
      Effect.flatMap(
        prepare(target, filter, `${spec.name}.history`),
        ({ kind, prepared }) => Events.history(kind, prepared.channel, prepared.accepts)
      )
  }
}
