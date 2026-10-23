# Design review: events, for a second slice

*2026-10-23. Review of commit `a93ddec` (revision 5.25 with the first slice built, after review 12) on how events reach callers: the subscription mechanism and event logs (CONCEPTS.md §9, API.md State and events), and the first two modules built on them, `Popup` and `Dialog`, with `AutoResolution`, which reports what a policy decided. Prompted by the maintainer: "Okay, let's do that", after agreeing to build L2 a feature at a time, building each shared L1 mechanism once and in full the first time a feature needs it. This commit records the review only.*

The first slice built state: `Watchable`s over the model's refs. Nothing delivers events yet. Every event module (`Popup`, `Dialog`, `Download`, `NetworkRequest`, `ConsoleMessage`, …) declares the same three verbs over one mechanism, so that mechanism is built once here, against two modules that use it differently. A popup is an event that reveals a resource someone owns; a dialog is an event that someone must decide. If both run on the mechanism unchanged, the remaining modules are mostly mapping facts onto it.

The slice is call site 3 of API.md, run against a local site on Chromium, Firefox and WebKit:

```ts
const program = Effect.scoped(Effect.gen(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto(site)
  const popups = yield* Popup.next(page)
  yield* page.getByText("Connect account").click()
  const popup = yield* Deferred.await(popups)           // a Page, owned by the scope that acquired `page`
  yield* Dialog.handle(popup, Dialog.acceptAll)         // registered before the click that opens the dialog
  yield* popup.getByRole("button", { name: "Allow" }).click()
  yield* popup.getByText("Connected").pipe(Expect.toBeVisible)
}))
```

## What the browsers do

Three questions decide parts of the design, so they were probed on all three backends against the pinned builds (a throwaway test against the adapters, not kept):

| Probe | Chromium 155 | Firefox 158 | WebKit 2359 |
|---|---|---|---|
| **P1.** The URL a popup opened with `window.open("/child")` is reported with | `""` at `PageAdded`, then its initial document, `PageReady`, and a navigation to `/child` | `about:blank`, then the same | `about:blank`, then the same |
| **P2.** Evaluation, in the main world and an isolated one, while an `alert` is open | blocks until the alert is decided | answers | blocks |
| **P3.** A click that opens an `alert` | doesn't return until the alert is decided | the same | the same |
| The opener after `window.open` | `visibilityState` is `hidden`, and it renders no frames until activated | `hidden`, but still renders | `visible` |

## Candidates

### 1. One subscription mechanism in L1, fed by the fold

**Where:** CONCEPTS.md §9 (Subscriptions, Event logs); a new `src/internal/events.ts`; the model.

**What changes.** CONCEPTS.md states the contract (subscribed when `next` or `stream` returns, filters before buffering, `where` in the subscriber, lossless up to a bound, a revision boundary) but not the mechanism, and several of its parts meet only here.

- **The fold produces the events.** It turns a fact into an event of a kind (`Popup`, `Dialog`, `AutoResolution`) addressed to its targets: the page, and for modules that take a context, the page's context too. It runs in receive order and is the only writer, as for state.
- **Each target keeps, per kind, a bounded log and a set of live subscriptions.** The fold appends the event to the log and offers it to every subscription whose declarative filter matches. Offering never blocks the fold: each subscription has its own bounded buffer, and one that is full fails that subscription with `EventOverflow{bound}` and no other.
- **The revision boundary is registration.** `next` and `stream` add their subscription to the target's set before they return. Because the fold is the only writer and runs one fact at a time, every event folded after that is offered to it, and none folded before.
- **`next`** starts a worker in the caller's scope that takes from the buffer, runs `where` with the requirements captured at `next`, and completes the deferred with the first match, or fails it with `where`'s error. The deadline in force at `next` starts its timer, which fails the deferred with `Timeout` in a fifth phase, `waitingForEvent`: the four there are (`resolving`, `waitingForCondition`, `dispatchedUnconfirmed`, `postcondition`) describe an operation, and none says that no matching event came. The end of the target fails it with `TargetGone`. Closing the scope before a match removes the subscription and interrupts the deferred, because closing the scope is the caller cancelling.
- **A late subscription is diagnosed.** When `next` times out, the log is searched for an event that matched its filter and arrived before it subscribed; the `Timeout`'s hint names it and how long before, and says to call `next` before the action that causes the event.
- **`stream`** is a `Stream` over the buffer, with `where` applied in the stream. It ends when the target ends normally (closed by a command, by its script, or with its context) or when the scope closes, and fails with `TargetGone` on any other end and with `EventOverflow` when its buffer overflows.
- **`history`** reads the log: the retained events that match the filter, oldest first, and `dropped`. It never subscribes or waits.
- **The bound** is stated: `Subscription.Capacity`, a `Context.Reference` read when a subscription starts, default 1,000 events, with `Subscription.withCapacity`, as `Expect.CheckInterval` is. The log's cap stays `UserContext.Options.eventLog`, default 100 per kind and target.

Effect's `PubSub` doesn't fit: it offers every message to every subscriber, so a declarative filter would run after buffering, and its bounded strategies either suspend the publisher, which would stall the fold, or drop messages silently. A set of bounded queues that the fold offers to is the mechanism, and `Queue` gives each one its end and failure.

**Recommendation.** Adopt.

### 2. `dropped` counts every event the log discarded

**Where:** `Subscription.History`'s JSDoc; API.md, State and events.

**What changes.** `dropped` is documented as the "matches the cap discarded", but `history` takes its filter when it is called, after the log has discarded entries, and which of them that filter would have matched is unknowable without keeping them. So `dropped` counts every event of the kind the log discarded for that target. It is an upper bound on the matches lost, and `0` still proves the entries are complete, which is what it is for.

**Recommendation.** Adopt.

### 3. A `ReadonlyDeferred` is Effect's `Deferred`, typed read-only

**Where:** `Deferred.ts`.

**What changes.** `next` returns an Effect `Deferred` that also carries this package's `ReadonlyDeferred` TypeId, and `Deferred.await`, `poll` and `isDone` are Effect's own on it. Nothing new is built to latch a match, the types still hand out only the read side, and if upstream adopts the proposal (upstream/effect-readonly-deferred.md), the values already are what its `ReadonlyDeferred` would read. `Deferred.await` stops being `NotBuilt`.

**Recommendation.** Adopt.

### 4. A popup is reported when it appears, and is matched by the URL it was opened for

**Where:** `Popup`; API.md, State and events; CONCEPTS.md §3 (Seeing an event acquires nothing); the model.

**What changes.**

- **When.** P1 shows every backend reports a popup before its URL is known, and the URL it was opened for arrives with its first navigation. The event is delivered when the popup is added, with its `Page`, so a handler or a route can be registered before that navigation commits. An unfiltered `Popup.next(page)` latches then.
- **`url`** matches the URL of the popup's first navigation: a filtered subscription is offered the popup when that navigation starts, and the log entry records it. A popup that never navigates (`window.open()`, then `document.write`) matches no `url` filter. Matching the initial `about:blank` (or Chromium's `""`) would make the filter useless, and waiting for the first commit would let the popup's first document run before a handler could be registered.
- **Which pages.** A popup is reported to its opener's subscriptions when the adapter names the opener (`origin: Opened{opener: Some}`). One whose opener the backend didn't report reaches no page's `Popup` subscriptions, and is still in its context's `pages`.
- **One handle per page.** `Popup.next`, `Popup.history` and the context's `pages` return the same `Page` for a popup, from a registry of the connection's page handles. Today a context's `pages` shows only the pages created through `newPage`, and silently leaves out popups.
- **Ownership.** A popup of an owned page is `Owned` by the scope that acquired its opener (CONCEPTS.md §3): the model records each owned page's scope, and adds the popup's release (close, without `beforeunload`) to it when the popup is added. If that scope has already closed, the popup is closed at once. Subscribing acquires nothing.
- **The opener in the background.** After `window.open`, Chromium and Firefox report the opener `hidden`, and headless Chromium renders no frames for it, so an action on the opener waits for frames that never come and fails with `NotReady{NoRenderingOpportunity}`. That is the browser's behaviour, and the library doesn't hide it by activating pages behind the caller's back (rule 23). The hint names the fix: `page.activate`.

**Recommendation.** Adopt.

### 5. A dialog event is data; a handler's argument adds the decisions

**Where:** `Dialog`; API.md, Dialogs; CONCEPTS.md §5.

**What changes.** `Dialog.next`, `stream` and `history` emit the same `Dialog` that a handler receives, with `accept`, `dismiss` and `respond` on it. An observer can't decide (events report, handlers decide), so it holds decisions that do nothing. The event also lacks the prompt's id, which `Page.Status` shows as `prompt.id`, so an observer can't tell which open prompt an event was. And a function member (`respond`) can't be encoded, so a dialog's history can't be exported as other data events' can.

- **`Dialog.Dialog` becomes data, a Schema union:** `Alert{id, message}`, `Confirm{id, message}`, `Prompt{id, message, defaultValue}` and `BeforeUnload{id}`, where `id` is the `PromptId` that `Page.Status` shows.
- **A handler receives `Dialog.Pending`:** each shape with the decisions valid for it, as `Dialog` was, so a handler still can't dismiss an alert. `acceptAll` and `dismissAll` take a `Pending`. Call sites are unchanged.

**Recommendation.** Adopt.

### 6. A handler decides, and the context's policy is the fallback

**Where:** `Dialog.handle`; CONCEPTS.md §5 (Prompts, Obligation lifecycle); the model.

**What changes.** CONCEPTS.md describes the obligation lifecycle in general. For a dialog:

- **Which handler.** A page's handlers are ordered by recency: the latest registered that is still in its scope decides. `Dialog` has no `fallthrough` (unlike `Route`) or priority, so one handler is asked. It is chosen when the dialog opens.
- **How long.** The handler runs in a fiber of its registration's scope, with the requirements captured at `handle`, and has `Deadline.DefaultBudget`, as read at `handle`, from when the dialog opens.
- **Falling back.** If the handler fails, is interrupted (its scope closed or its registration removed) or runs out of time, the context's policy decides, and the failure is logged at `References.UnhandledLogLevel`, as a route handler's failure is (`Route.Handler`).
- **One decision.** The decision is delivered by a resolver in the model's scope, independent of the handler fiber, and a per-dialog latch lets only the first decision through, so a late handler can't contradict the fallback.
- **`handled`** counts the dialogs that registration decided, as a `Watchable`.
- **Reported.** Every decision the policy makes, with no handler or as the fallback, is an `AutoResolution` event on the page and its context: `subject: Dialog{kind, message}`, `decision` (`"accept"`, `"dismiss"`, or for a `beforeunload` under `"dismiss"`, `"accept"`), and `policy` naming the option and its value (`UserContext.Options.dialogs: "dismiss"`). The default context, which has no policy until attaching is built, decides nothing on its own.

**Recommendation.** Adopt.

### 7. An operation blocked by a dialog nothing will decide fails at once

**Where:** a new shared reason, `Reason.PromptBlocking`, in `LocatorError` and `PageError`; `runtime.ts`; the action path.

**What changes.** API.md says an operation blocked by a dialog that a handler or the policy is resolving waits within its deadline, and under `"leaveOpen"` fails at once with a hint naming the dialog, but no reason carries that failure. P2 and P3 show what blocks: on Chromium and WebKit every evaluation, so every query and check, and on every backend the input that opened the dialog.

- **`PromptBlocking{prompt, hint}`** joins the shared reasons, in `LocatorError` and `PageError`. `prompt` is `Page.Prompt`; the hint says the context's policy is `"leaveOpen"` and no handler is registered, and names `Dialog.handle`. It is CONCEPTS.md §8's `PromptBlocking{resolution: None}`; `resolution: Pending` stays a wait.
- **When.** An operation on a page with an open prompt that has no handler and a `"leaveOpen"` policy fails at once, and so does one in flight when such a prompt opens: the engine's requests and the input dispatch race the page's prompt. On every backend, though Firefox could answer a read during a dialog, so that one rule holds everywhere.
- **The click that opened it** fails too, with `dispatch: MayHaveBeenSent`, since the dialog opening shows the input arrived; the hint says so.

**Recommendation.** Adopt.

### 8. One test of the slice, on every backend

**Where:** `test/integration/slice/`.

**What changes.** The program above, and around it:

- a popup matched by URL among two;
- `Popup.history`;
- a late `next`, whose `Timeout` names the event it missed;
- a popup closed with its opener's scope;
- a dialog the policy decides, seen by `Dialog.next` and reported as an `AutoResolution`;
- a handler that fails, so the policy decides;
- the latest handler deciding, and the earlier one again once the later is removed;
- a `stream` that ends when its page closes;
- a dialog's history encoded as data;
- `PromptBlocking` under `"leaveOpen"`;
- `EventOverflow` at a small `Subscription.Capacity`.

**Recommendation.** Adopt.

## Considered and not adopted

- **Effect's `PubSub` for delivery.** It can't filter before buffering, and its bounded strategies stall the publisher or drop silently (candidate 1).
- **Reporting a popup at its first commit.** Its document would run before a handler could be registered (candidate 4).
- **Activating the opener's page when a popup opens, or before an action on a hidden page.** It would change what the page observes without the caller asking (rule 23); `page.activate` is explicit.
- **Decisions as module-level values, as `Route.continue` is.** A handler could then return a decision its dialog doesn't offer, such as dismissing an alert.
- **Letting reads through during a dialog on Firefox.** It would make the same program fail on two backends and pass on one.
- **`Download` in this slice.** It brings a download directory owned by each context, `saveAs` and byte streams; it is the next module on this mechanism, and should need nothing new from it.

## Decision

Adopted, 2026-10-23, under the maintainer's direction to build this slice. The revision follows this commit, and the build records where it differs.
