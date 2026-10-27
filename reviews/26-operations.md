# Design review: operations

*2026-10-26. Review of commit `5b208c2` (review 23 complete) on how an operation keeps its deadline and its evidence. Prompted by the maintainer, reading how `Deadline.within` differs from `Effect.timeout` and how a click learns the phase it timed out in: "that seems pretty verbose and fragile, idk. how many functions follow this approach?"; then "If we add an Operation module, the user should be able to use it too"; of the shape proposed, "I'm open to Operation.fn"; and, asked whether a deadline should follow `TestClock`, "Deadline should run on the browser clock, yes". Written beside reviews 24 and 25, from the same commit, and numbered after them. This commit records the review only.*

The deadline's contract stands: one deadline per operation, inherited by nested calls and only ever shortened, which an operation reads and fails by with evidence instead of being interrupted (review 1's first concern; review 6, where Effect has no such deadline). What this review changes is how operations keep it, and which clock it runs on.

CONCEPTS.md §2 designs an `OperationRecord`: a `Ref` of the dispatch state, per-step progress, the observation and cleanup, "internal; inspected through an Effect". §9 says each user operation has one, linked to its span, and review 1 proposed it as one of two concepts that "reduce caller ceremony while making the guarantees more honest". Review 12 built `src/internal/operation.ts` instead: helpers for an operation's id, its budget, the time left and its `Timeout`, which each operation calls by hand. Every slice since has copied the pattern. No record was built, and no review decided against one.

## What the code does

Counted in `packages/browser/src` at `5b208c2`, and probed with a throwaway test against `Browser.layerTest` (not kept).

| | Finding |
|---|---|
| **C1.** Operations that read the deadline themselves, `Operation.budget` | 33 sites in 17 files |
| **C2.** `Timeout`s built by hand, each choosing its phase, `Operation.timeout({ … })` | 24 sites in 12 files, each writing its phase as a literal or working it out where it fails, as `act` does from what it saw |
| **C3.** The internal deadline failure mapped by its tag, `_tag === "Deadline"` | 14 sites in 7 files |
| **C4.** Waits bounded by `Effect.timeoutOption(Operation.millisLeft(at))` | 22 sites in 17 files |
| **C5.** `Diagnostics.progress` filled | 1 site, `internal/launch.ts`. Every other error carries `[]`, and `cleanup` is always `NotNeeded`, though the README (Errors, Evidence) promises per-step progress and cleanup notes on every failure |
| **P1.** `Popup.next(page).pipe(Deadline.within("200 millis"))` on `layerTest("")`, its wait forked and left for one second of real time | Under `it.live`, the wait has failed with `Timeout{waitingForEvent}`. Under `it.effect`, it hasn't; it fails once `TestClock.adjust("200 millis")` runs |

P1 contradicts CONCEPTS.md §9 and API.md (Testing): deadlines run on the live clock even under `TestClock`. The deadline is a live instant (`performance.now`), and the loops that compare against it are live, but C4's waits sleep on Effect's `Clock`, which `TestClock` replaces. By reading, an action whose element never becomes ready still times out, because each round's cap is a timer in the page; a wait for the input permit, a dispatch the browser never answers, an event, or a page with no document waits for the test clock instead.

C2 is where the pattern is fragile. The compiler makes each operation map C3's failure onto a public error, since the internal one is in no public type, but it can't check the phase chosen. `evaluate`, `setInputFiles` and the HTML `dragTo` write `dispatchedUnconfirmed` by hand; taking `sendFailure`'s default, `resolving`, would say nothing happened when the function may still be running.

## Candidates

### 1. The operation record, built

**Where:** `src/internal/operation.ts`; CONCEPTS.md §2 and §9.

**What changes.**

- **One record per operation, in the context.** Starting an operation reads the deadline once, mints its id, and provides its record: §2's `OperationRecord`, a `Ref` of the dispatch state, the de-duplicated history of what it observed, its steps and its cleanup.
- **Operations record facts, not phases.** An operation notes what happens: an observation (`NotReady{Covered}`), that its input or call may have reached the browser, that the browser confirmed it. When the deadline passes, the `Timeout` is built from the record, by the meanings `Deadline.Timeout` already documents:
  - sent and not confirmed: `dispatchedUnconfirmed`, with `dispatch: MayHaveBeenSent`;
  - sent and confirmed, and what it waits for afterwards missing: `postcondition`;
  - nothing sent, and nothing observed or only `NoMatch`: `resolving`;
  - nothing sent, and something else observed: `waitingForCondition`, its hint explaining the last observation;
  - an event wait says `waitingForEvent` itself, since what it waits for isn't the operation's own doing.
- **Steps.** An operation started inside another is a step of it. When it ends it adds `{ step, state, at }` to the enclosing record's progress, and the enclosing record's dispatch moves as far as the step's did. §2 defines progress per command; it becomes per step, a step being a command the operation sent or an operation nested in it. The states are §2's: a step that timed out before sending is `unsent`, after sending `uncertain`.
- **A deadline runs on the clock the browser runs on.**
  - **A real browser's is the live monotonic clock,** which `TestClock` never moves. The browser is another process, and nobody adjusts the test clock in a browser test, so a frozen deadline would never fire: a test whose button was renamed would hang until Vitest stopped it, with none of the evidence the deadline exists to give.
  - **`Browser.layerTest`'s is Effect's clock,** on which its timeline runs. Beside a timeline frozen under `TestClock`, a live deadline would pass or not by how fast the test runs.
  - **How.** The clock is an internal reference, live unless set. `layerTest` provides Effect's clock with `Browser`, and `within`, `remaining`, `bound` and every operation read it. A `Deadline.within` applied outside `Effect.provide(layerTest(…))` reads the default, live.
  - **P1 under this rule** is right for `layerTest`, by accident, and wrong for a real browser, whose C4 waits sleep on the same `Clock`.
- **Waits bounded in one place.** One internal `bound` replaces C4: it races the wait against a timer on that clock, and fails with the record's `Timeout`. P1 is fixed in one place.
- **Errors carry the record.** Every error an operation fails with, not only `Timeout`, carries the record's diagnostic envelope, so C5's promise holds.
- **Interruption** stays Effect interruption (principle 3). The record's `caller` becomes `interrupted`, and compensations run as now.

**Recommendation.** Adopt.

### 2. `Operation`, a public module, with `Operation.fn`

**Where:** `src/Operation.ts` (new); the barrel; API.md (Entry points and cross-cutting settings, Errors as users see them, Call sites); `scenarios/`; `typetest/`.

**What changes.** The record and its combinator are public, so a user's helper keeps the library's contract: one deadline, evidence of how far it got, and waits that end.

```ts
import { Deadline, Operation, Page } from "@usestrider/browser"

const checkout = Operation.fn("checkout")(function*(page: Page.Page, card: string) {
  yield* page.getByLabel("Card number").fill(card)
  yield* page.getByRole("button", { name: "Pay" }).click()
  return yield* Operation.bound(orders.awaitConfirmation(page))
}, Deadline.within("20 seconds"))
```

If the confirmation never comes, the caller gets a `Timeout` named `checkout`, in the phase `postcondition`: the click went out and was confirmed, and what `checkout` waited for afterwards didn't come. Its progress lists `Locator.fill` and `Locator.click` as `ok`.

- **`Operation.fn(name, options?)`** has `Effect.fn`'s shape: a body, generator or function, and pipeables, returning a function whose effect is the operation. Its options are a span's `attributes`.
- **Order.** `Effect.fn` applies the body, then the pipeables, then the span. `Operation.fn` starts the operation between the body and the pipeables, so a `Deadline.within` passed as a pipeable sets the deadline the operation reads, as `Deadline.within`'s own example expects.
- **Its span** is opened through `src/internal/spans.ts`, so `SpanNameGenerator`, `TracerDisabledWhen` and the diagnostics preset apply to a user's operation as to the library's, and a trace shows `checkout` around its steps. `Browser.Operation`, what `SpanNameGenerator` and `TracerDisabledWhen` are given, keeps its name: it names a span's operation, as `Diagnostics.OperationId` names a record.
- **What a body records,** through the record in the context, so helpers it calls can record too and nothing is passed:
  - `Operation.markSent: Effect<void, never, Operation.Current>`: from here, a side effect may have happened. Library operations mark it for themselves, and their steps carry it up; a body marks it before a side effect of its own, such as a call to the shop's API.
  - `Operation.observe(value): Effect<void, never, Operation.Current>`: why it isn't done yet, added to the history.
  - `Operation.bound(self): Effect<A, E | Deadline.Timeout, R | Operation.Current>`: waits for `self` no longer than the deadline, on the browser's clock.
- **Only inside an operation.** The three require `Operation.Current`, which only `Operation.fn` provides, so recording outside an operation doesn't compile (principle 23), and a helper that records says so in its requirements. The library reads the same reference optionally, since its operations also run outside any user's.
- **Errors.** `Operation.fn` adds nothing to the error channel: `bound` adds `Deadline.Timeout`, and steps add theirs. Candidate 3 keeps a `Timeout` a `Timeout`.
- **Stability** `unstable`, as everything is until 1.0.

**Recommendation.** Adopt.

### 3. What a caller gets when a step times out

**Where:** `src/internal/operation.ts`; `Deadline.Timeout`'s JSDoc; API.md (Errors as users see them).

**What changes.** When the click inside `checkout` runs out of time, the caller of `checkout` can get either:

- **(a) The step's `Timeout`, unchanged,** as today: `Locator.click timed out while resolving`. Nothing says the card number was filled in, or that `checkout` was what timed out.
- **(b) The operation's `Timeout`,** named `checkout`, built from its record:
  - **phase, history and hint are the step's,** which are true of `checkout` too: it stopped resolving the Pay button;
  - **`dispatch` is the furthest any step got,** so the fill that went out shows, apart from the phase, which says where it stopped;
  - **progress lists the steps:** `Locator.fill` `ok`, `Locator.click` `unsent`.

Under (b), inside the body a step's own `Timeout` is still what `yield*` fails with, so `Effect.catchTag("Timeout", …)` around the click catches the click's; only what leaves `checkout` is the operation's. The library's operations nest the same way (`goto` waits for a load), and their errors already name the operation the caller called; (b) makes that the rule.

**Recommendation.** (b) (question 1).

### 4. The library moved onto it

**Where:** C1's 33 sites; `src/internal/locator.ts` first; `src/internal/spans.ts`.

**What changes.**

- **`act` and `read` first,** through which most locator methods go, then each module's operations, file by file.
- **C2, C3 and C4 go.** A body records, and its failures come from the record. `sendFailure`'s phase parameter goes with them.
- **Every operation that opens a span is an `Operation.fn`:** 65 of them, 59 through `Spans.operation` and 6 through `Spans.fn`. Each then has a record, as §9 says. `Spans.fn` folds into `Operation.fn`, and `Spans.operation` stays as the span it opens.
- **Tests.** P1 kept, for an event wait and an action's input permit under `TestClock` against a real browser; a `layerTest` deadline that passes when `TestClock.adjust` reaches it and not before; each phase built from a record; a nested operation's progress and dispatch; recording outside an operation rejected (`typetest/`).

**Recommendation.** Adopt.

## Considered and not adopted

- **Keeping the helpers, with a check for C3's mapping:** the phases would still be chosen by hand, progress would stay empty, and P1 would need 22 fixes.
- **`Effect.timeout` around each operation:** review 1's first concern. It interrupts, and loses what the operation knew.
- **The record as a parameter,** `function*(op, page)`: the signature would differ from `Effect.fn`'s, and an operation inside a helper couldn't find the one enclosing it without being passed it.
- **`Deadline.fn`:** the record is more than a deadline: dispatch, history, steps and cleanup. `Deadline` keeps `within`, `withDefaultBudget`, `remaining` and `Timeout`.
- **Keeping the module internal:** "the user should be able to use it too."
- **A `step(name, effect)` combinator:** a step is an operation, and `Operation.fn` makes one.
- **New phases for users' operations:** the five say where any operation stops: never found, never ready, sent and unconfirmed, done with its outcome missing, no event. A user's stops in one of them too, and its steps say the rest.
- **Deadlines on `TestClock` for a real browser:** the test clock doesn't move in a browser test, so the deadline would never fire, and a broken test would hang instead of failing with its evidence.
- **Live deadlines for `layerTest` too,** as CONCEPTS.md §9 has it: its timeline is frozen under `TestClock`, so whether a live deadline passed first would depend on how fast the test runs.

## Questions for the maintainer

1. **A step that times out (candidate 3):** (b), the operation's `Timeout` with the step's phase and the steps so far, as recommended, or (a), the step's unchanged?
2. **Operations that are values,** such as `page.title` and `locator.count` (principle 12), need a pipeable form, `effect.pipe(Operation.named("Page.title"))`, as `Effect.withSpan` sits beside `Effect.fn`. Public too, or internal only, leaving users one way (principle 22)?

## Build

In three steps, each committed and pushed when `pnpm all` and the integration tests for the model, engine, locators and pages pass:

1. The record, the deadline's clock, `bound`, and `act` and `read` moved onto them, with P1's tests and P1 in QUIRKS.md, ours, Resolved (candidates 1 and 4).
2. Every other operation moved; C2, C3, C4 and `Spans.fn` gone (4).
3. `Operation` public: the module, its JSDoc, API.md, a call site and the type tests (2 and 3), with the README's Status, CONCEPTS.md §2 and §9, API.md (Testing), and the agent instructions.
