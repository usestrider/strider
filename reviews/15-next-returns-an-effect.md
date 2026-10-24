# Design review: `next` returns an Effect

*2026-10-23. Review of commit `c39db13` (every event module built, after review 14) on what an event module's `next` hands back. Prompted by the maintainer, reversing revision 5.23's decision: "I think I'm reversing my opinion on deferred. I guess there's no reason to use that module over a simple effect since the consumer will never do anything other than await." This commit records the review only.*

Since revision 5.23, `next` hands back a `ReadonlyDeferred`: the read side of Effect's `Deferred`, declared by this package's `Deferred` module (`await`, `poll`, `isDone`) and proposed upstream (upstream/effect-readonly-deferred.md). Review 13 made it Effect's own `Deferred` at run time, carrying this package's TypeId.

Every call site awaits it, and nothing else: `yield* Deferred.await(popups)`. Polling or checking a wait for an event isn't something the call sites, the scenarios or the tests do, and a caller who wants to know whether it has arrived without blocking can race the wait against nothing. The type buys a module, a name that shadows Effect's own `Deferred`, an upstream proposal, and a second step at every call site.

API.md already names the alternative: "If upstream declines the type, `next` returns the awaiting `Effect` instead, with the same timing."

## Candidates

### 1. `next` returns the wait, an `Effect`

**Where:** every event module's `next`; `src/internal/events.ts`; API.md, State and events and the call sites; CONCEPTS.md §9.

**What changes.** `next(target, filter?, where?)` returns `Effect<Effect<A, E | TargetGone | Timeout>, SubscriptionError, Scope | PR>`: running it subscribes, as now, and its value is the wait. Running the wait gives the first match.

- **The timing is the same.** The subscription and the deadline start at `next`, so code order is still subscription order, and the time between `next` and the wait counts against the deadline.
- **It is latched.** Running the wait again gives the same result, success or failure, because underneath it is Effect's `Deferred.await` on the deferred the library completes. Effect has the same shape in `Effect.cached`, an effect whose value is an effect.
- **Interrupting a wait** interrupts that wait only; the subscription lasts until its scope closes. The scope closing before a match interrupts the wait, as it interrupts the deferred now.
- **Call sites lose a step:** `const popup = yield* popups`, and call site 13 becomes `Effect.all([checkout, order])`.

**Recommendation.** Adopt.

### 2. The `Deferred` module goes, and the upstream proposal is withdrawn

**Where:** `src/Deferred.ts`, `src/internal/readonlyDeferred.ts`, the barrel, `typetest/access.tst.ts`, upstream/effect-readonly-deferred.md, the README and the agent instructions.

**What changes.**

- `Deferred.ReadonlyDeferred`, `Deferred.await`, `Deferred.poll` and `Deferred.isDone` are removed, and with them the shadowing of Effect's `Deferred` that the module's gotcha warned about.
- The type test that a caller can't complete a `ReadonlyDeferred` goes with the type; the wait is an `Effect`, which nothing can complete.
- The upstream draft is marked withdrawn, not posted, and kept as a record.
- Principle 17 ("no writable `Deferred`s or `Ref`s") stands: the library still latches results in `Deferred`s internally, and hands out only an `Effect` that reads one.

**Recommendation.** Adopt.

## Considered and not adopted

- **Keeping `ReadonlyDeferred` for `poll` and `isDone`.** No call site uses them, and a race with `Effect.void` answers "has it arrived?" for the rare caller who asks.
- **Returning a `Fiber`.** It would be a public fiber, which principle 17 rules out, and joining it is no simpler than running an effect.

## Decision

Adopted, 2026-10-23, at the maintainer's direction. The revision follows this commit.
