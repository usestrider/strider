# Proposal for Effect: a read-only side for `Deferred`

*Draft, 2026-10-19, for the maintainer to post. Not posted. Written against Effect `main` at `93abf0208`.*

> **Withdrawn, 2026-10-23** ([review 15](../reviews/15-next-returns-an-effect.md)). Strider's `next` now hands out `Deferred.await(deferred)`, an `Effect`: every caller only ever awaited the result, so the read side bought nothing it needed. Kept as a record; not to be posted.

## Problem

A library that latches a result for its caller (the first matching event, a completed handshake, a resource that becomes ready) has two options today:

- **Return the `Deferred`.** Then the caller can complete it too (`Deferred.succeed`, `fail`, `complete`, `interrupt`), and the library's single-writer guarantee depends on the caller's good manners.
- **Return `Deferred.await(deferred)`.** Then the caller loses `poll` and `isDone`, and the value is an anonymous `Effect` rather than something with a name in the type.

`Deferred<in out A, in out E>` is also invariant, so a `Deferred<Download, Timeout>` can't be passed where a `Deferred<unknown, unknown>` is expected, even by code that only reads it.

## Proposal

Split `Deferred` the way v4 already splits `Queue` into `Enqueue` and `Dequeue`:

```ts
export interface ReadonlyDeferred<out A, out E = never> extends Pipeable {
  readonly [ReadonlyTypeId]: ReadonlyDeferred.Variance<A, E>   // covariant
}
export interface Deferred<in out A, in out E = never> extends ReadonlyDeferred<A, E> { … }   // unchanged otherwise

export const asReadonly: <A, E>(self: Deferred<A, E>) => ReadonlyDeferred<A, E> = identity
export const isReadonlyDeferred: (u: unknown) => u is ReadonlyDeferred<unknown, unknown>
```

- **Read functions widen their parameter** to `ReadonlyDeferred`: `await`, `poll`, `isDone`, `isDoneUnsafe`.
- **Write functions keep `Deferred`:** `succeed`, `sync`, `fail`, `failSync`, `failCause`, `failCauseSync`, `die`, `dieSync`, `interrupt`, `interruptWith`, `complete`, `completeWith`, `done`, `doneUnsafe`, `into`.
- **It's a view, as `Queue.asDequeue` is.** `asReadonly` is the identity at runtime, so it costs nothing. The guarantee is at the type level, like `ReadonlyArray`. Most code never calls it: a function returning `ReadonlyDeferred<A, E>` upcasts a `Deferred<A, E>` implicitly.
- **It isn't breaking.** Every existing `Deferred` is a `ReadonlyDeferred`, and widening the read functions' parameters accepts everything they accepted before.

## Open points for the maintainers

1. **Should `ReadonlyDeferred` be yieldable,** so `yield* deferred` awaits it? That would read better at call sites. It's independent of the split, and `Deferred` itself isn't yieldable in v4, so it may be a deliberate choice.
2. **Name.** `ReadonlyDeferred` follows `ReadonlyArray` and `AtomRef.ReadonlyRef`. `Queue`'s split names its two sides by operation (`Enqueue`/`Dequeue`), which has no natural equivalent here.

## Motivation from Strider

`Download.next(page)` subscribes to downloads and hands back the first match when it arrives. The library completes the deferred: with the match, with `TargetGone` when the page ends, or with a typed `Timeout` when the wait's deadline passes. The caller only awaits or polls. Today the library has to define its own read-only wrapper type for this.

## A possible follow-up: `Deadline`

Effect has no deadline that nested calls inherit. `Effect.timeout` interrupts from outside, so an operation can't fail with its own evidence of how far it got. Strider, an Effect-native browser automation library, defines:

```ts
Deadline.within: Dual<Duration.Input>          // provides min(outer, now + duration), as an absolute instant on the live clock
Deadline.withDefaultBudget: Dual<Duration.Input>
Deadline.remaining: Effect<Option<Duration>>
Deadline.CurrentDeadline: Context.Reference<Option<MonotonicInstant>>
Deadline.DefaultBudget: Context.Reference<Duration>
```

Operations read `Deadline.CurrentDeadline` and fail with their own typed error when it passes. If this shape works for Strider, it may be worth proposing separately, so that HTTP clients, SQL and other libraries could honor the same budget.
