# Design review — draft 3

*2026-10-18. Review of commit `5436c0e587455b9c4aaa2ce44bd5b4826908abe3` ([CONCEPTS.md](../CONCEPTS.md), draft 3). This review follows [review 1](01-draft-1.md) and [review 2](02-draft-2.md). Section and line references describe that commit. This commit records the review only; it does not revise the concepts.*

Draft 3 improves navigation projection, error grouping, declaration timing, and stream termination. Stable model identity, eager observation windows, one operation deadline, and dispatch-aware recovery remain the right foundation.

The main remaining problem is that several new policies combine things that need different contracts: permission to operate versus responsibility to clean up, setting precedence versus script execution, safe diagnostic rendering versus data export, and ordinary event consumption versus waiting for a required result. Those distinctions matter at everyday call sites. I would resolve the high-priority items below before locking the public API or expanding the concept catalogue further.

## Findings

### 1. High — Cleanup ownership now controls whether an attached page is usable

**Where:** P9 and the guarantees table; §§2.15, 3.1, 3.2, 11.1. Reviewed lines 46–76, 348–363, 441–474.

The earlier separation between observing a resource and owning its destruction is useful. Draft 3 then says declarations never take effect on resources this client does not own. Existing attached tabs and the default context are `ObserveOnly`.

Consider attaching to a user's existing tab, installing a route or a preload for its next navigation, and disconnecting while leaving the tab open. Those are legitimate automation operations, but the current policy either rejects them or requires taking cleanup ownership of the tab. That makes “configure this page” risk meaning “close this page on release.” Utility-world/bootstrap setup in §3.2 also needs a clear status under this rule.

There is a related case even without controlling an existing tab: an owned temporary page can live in an observe-only default context. A context-level setting needed by that page cannot become permissible just because the page is owned, nor should the user have to claim destruction of the default context.

**Recommendation:** Keep remote cleanup policy separate from the allowed control scope. An explicitly selected attached page can be controlled while its release policy remains leave-open. Changes with wider physical scope require wider explicit opt-in or an unsupported-scope result. Register cleanup for the declarations the client installs without claiming destruction of their target. If `ObserveOnly` truly means no mutations, provide a separate controlled-but-not-owned mode and make that distinction visible in the attach API.

**Acceptance case:** Attach to one existing tab, install a page-scoped route, use it, and release. The route is removed, the tab stays open, and unrelated tabs are unaffected.

### 2. High — A small error channel must preserve runtime failure and execution evidence

**Where:** P11; §§3.1, 5.1–5.2, 6. Reviewed lines 52–53, 443–444, 521–580.

Grouping errors is helpful. Turning an unclassified protocol failure into a defect primarily to meet a three-tag target is a different decision. A backend response incompatible with the supported schema is an external compatibility failure a long-running automation service may need to report and isolate. It need not mean the calling program has violated an invariant. A schema supplied by a user for extraction also needs a typed decode failure distinct from an adapter-schema failure.

The document says expected protocol conditions are normalized, but the boundary is not complete enough to support the promise. An invalid selector, malformed action option, or backend refusal needs an immediate, documented domain failure rather than an accidental defect or a wait that runs until timeout. Reserve defects for actual programming/invariant failures; document a typed fallback for external backend failures, potentially as a reason inside each verb family's error. This keeps signatures compact without forcing ordinary recovery through `catchCause`.

The error evidence also needs strengthening. `dispatch: Acknowledged` includes both success and definitive rejection. For a multi-command gesture, successful mouse-down followed by rejected mouse-up has different consequences from a rejection before any input. §5.1 records this internally, but the prose says the caller can answer “did my click happen?” by reading `dispatch` alone. It cannot. Even successful dispatch acknowledgement does not establish the application's result.

**Recommendation:** Put a shared diagnostic envelope on all relevant failures, including domain/backend errors: operation id, dispatch progress, known rejection or partial completion, and the last observed result. Preserve uncertainty on a protocol/schema failure after dispatch, not only on `Timeout` and `TargetGone`. Describe this evidence as support for recovery, never as proof that the business action happened.

The small-error promise should cover library-owned failures. An observation combinator taking `Effect<A, E, R>` must still preserve the trigger's `E` and `R`, as §4.1 promises to preserve its failure. Write one generic signature to verify that arbitrary user errors are neither erased nor wrapped merely to meet the tag budget.

Effect distinguishes anticipated runtime failures from defects; reducing the number of tags does not change which category a condition belongs to. [Effect error model](https://effect.website/docs/v3/error-management/two-error-types)

**Acceptance cases:** Recover from an invalid selector without waiting; report a backend mismatch without losing other jobs; preserve a custom trigger error through a response waiter; retain partial-dispatch evidence when the next command fails.

### 3. High — Redaction needs separate diagnostic, wire, and persistence boundaries

**Where:** P12; §§1.2, 2.16, 2.20, 7. Reviewed lines 55–56, 112, 365–370, 411–419, 584–592.

There are two concrete holes.

First, outbound cookie values inside `StorageState` are `Redacted`, while the login acceptance scenario requires saving and restoring that state. Ordinary JSON serialization writes the redacted placeholder instead of the cookie. The document needs an intentional export/import boundary that preserves sensitive values without making diagnostic `toJSON` reveal them. Callers should not have to recursively unwrap every cookie and header themselves.

Second, the wrapper is not a label that follows a value through the browser. Dispatch must unwrap a password or token. If page code echoes it into console output, a response body, a URL, a prompt message, or DOM content, those observations arrive as plain data. The tracer cannot identify arbitrary transformed copies simply by checking for `Redacted`. Screenshots and other binary artifacts are another distinct surface. Returning a secret-bearing DOM snapshot to an agent also exceeds what wrapper-aware logging alone can prevent.

I verified the narrow behavior against the local Effect 4.0.5 package using a synthetic fixture: wrapped-cookie JSON becomes `<redacted>`; an unwrapped value passed through JSON remains the original plain string and no longer passes `Redacted.isRedacted`. Effect's source implements protected formatting and explicit value access, not browser-wide dataflow tracking. [Redacted implementation](https://raw.githubusercontent.com/Effect-TS/effect/main/packages/effect/src/Redacted.ts)

**Recommendation:**

- Guarantee that wrappers and explicitly classified fields are protected by library diagnostic serialization, including protocol-command traces and error formatting after dispatch values have been unwrapped.
- Provide deliberate sensitive-state export/import APIs or codecs. Keep those distinct from safe diagnostic rendering; make the destination and handling of the exported secret-bearing bytes explicit.
- Define capture policies for raw bodies, console values, URL parameters, DOM snapshots and screenshots. Narrow the end-to-end claim to what these policies actually enforce. Do not imply automatic taint tracking.
- Give model-object descriptions the same sanitization policy: an id plus an unfiltered URL/title is not necessarily safe diagnostic output.

**Acceptance cases:** Export, import and restore a login state without losing its cookies; log that same value safely; document what happens when the page echoes a dispatched secret through a different observation channel.

### 4. High — Publisher-side filters can reintroduce the user-code ingestion hazard

**Where:** §4 items 3, 5 and 7; §4.1. Reviewed lines 498–513.

Filtering before buffering is useful, but “synchronous and must not await” does not make a user predicate safe. It may throw, run expensive matching, or inspect data that requires a body fetch. If the publisher runs on the fold path, that user code contradicts the isolation rule. If it runs elsewhere, that queue and its overload behavior need to be defined instead.

The common desired response filter can also be asynchronous: read JSON and test a field. The current rule would either prohibit that ergonomic API or encourage callers to perform unsupported work inside the predicate.

**Recommendation:** Distinguish a declarative prefilter, evaluated by library code on bounded metadata, from a caller predicate evaluated in the subscriber's worker. Compile common URL/method/status filters into the first category; run body/schema predicates in the second with an explicit body-collection requirement and deadline. Errors in one predicate must terminate only that observation. An immediate single-match waiter can latch its match and stop buffering further matches.

This bounds the strong claim correctly: traffic excluded by the declarative prefilter cannot fill that subscriber's buffer. Arbitrary predicates do not receive unlimited capacity or a universal no-overflow guarantee. Total core traffic can still exceed the core queue limit already specified in §4.

**Acceptance cases:** One predicate throws or is slow while commands and dialogs on another page still progress; a body-based response predicate works without running on the state fold.

### 5. High — Preload scripts are not ordinary overridable settings

**Where:** P10; §§2.7, 2.15, 3.2. Reviewed lines 49–50, 226, 348–363, 464–474.

The common precedence ladder now makes higher-precedence preload scripts execute last, supposedly allowing them to override earlier effects. That only works for some last-write-wins assignments. A later script cannot generally undo an earlier listener, network request, captured reference, non-configurable property, or clock installation. A page-specific prerequisite can also need to execute *before* a context-level consumer, the reverse of the chosen order.

The lifecycle is incomplete as well: removing a preload registration can prevent execution in future documents, but cannot generally undo its effects in the current document. Recomputing effective declarations must not accidentally rerun surviving scripts and duplicate their listeners. Installing or removing a controlled clock has the same issue.

The proposed order additionally needs an adapter mechanism. Playwright explicitly does not guarantee ordering between multiple page/context init scripts; prior art therefore does not establish this stronger promise. That does not mean it is impossible to implement. It means this design must specify how it will own the order. [Playwright init-script ordering](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script)

**Recommendation:** Keep the shared registration bookkeeping, but distinguish setting selection from ordered script execution. Prefer an explicitly ordered bundle per world/document, with clear dependency/failure semantics, rather than promising that every script is an override. State that removal affects future execution unless an installation provides a separately supported disposer. Define how bundle revisions reach future documents without duplicates or gaps and how cleanup handles already-executed effects.

**Acceptance cases:** A page-specific helper runs before its context-level consumer; removing one script leaves existing listeners alone and does not replay the others; unsupported rollback is explicit.

### 6. High — Controlled page time can prevent ordinary auto-waiting from completing

**Where:** §§2.15, 2.17, 5.2; probe 21. Reviewed lines 356–363, 372–395, 546–552.

Keeping the driver's deadline clock live is necessary, but it only guarantees that a stalled action eventually times out. It does not tell us how that action can finish while page time is paused.

`Stable` waits for rendering samples. If its sampling uses a controlled `requestAnimationFrame`, pausing the page clock can stall even a click on an otherwise unchanged button. If the utility world samples with real time instead, that is a different policy and must be deliberate. Advancing application time automatically to satisfy a click may fire application timers or expire credentials, defeating the user's reason for pausing it.

`Fixed` and `Offset` are also underspecified: changing wall time is different from changing monotonic time, timer delivery, or animation scheduling. Playwright's fixed-time mode leaves timers progressing, while its installed clock can control timers and animation callbacks. These are materially different behaviors. [Playwright clock semantics](https://playwright.dev/docs/clock)

**Recommendation:** Define clock domains and their consumers: application wall time, application timers/animation, automation sampling, and driver deadlines. State which world and workers each mode affects. Keep the semantics of advancing application time explicit; do not quietly advance it as a workaround for actionability. Specify restoration and existing-timer behavior rather than treating installation like a reversible color-scheme setting. Probe 21 should test this policy, not choose it implicitly.

**Acceptance case:** Install and pause controlled time, click an already-stable button, advance one application timer explicitly, and assert the result. No incidental action advances other application timers, and failure explains a blocked clock dependency rather than generic invisibility.

### 7. Medium — Popup ownership still lacks a cleanup owner

**Where:** §3.1 and acceptance scenario 7. Reviewed lines 441–446, 745.

Draft 3 correctly marks popups of an owned page as `CloseOwned`. That determines whether they may be closed, but not which scope must close them.

`withPage(f)` narrows the opener's lifetime while the model tree places pages under the context. If the callback opens a popup, ending `withPage` can close only the opener and leave the owned popup alive until the context is released. The broad attach/release scenario passes while the narrow scoped form leaks resources for the remainder of a long-lived context.

**Recommendation:** Record a cleanup owner/scope separately from release policy and browser containment. Define whether client-owned popups inherit the operation's cleanup group, and how callers explicitly transfer them out. Do not make browser-side opener closure itself destroy popups: a popup can legitimately outlive an opener. This is about deterministic client cleanup, not changing browser lifetimes.

**Acceptance case:** Use `withPage` inside a long-lived context, open a popup, and exit with failure or interruption. Both temporary resources are cleaned up, except a popup explicitly transferred to a longer-lived owner.

### 8. Medium — Persisting an ownership ledger does not yet justify automatic reclamation

**Where:** §§1.2, 3.1. Reviewed lines 95–112, 442.

The ledger records model ids plus backend correlation ids, while public identity is scoped to a connection. The draft does not specify how a new connection verifies that the browser instance, remote resource, and ownership assignment still match the stored record. An endpoint can later refer to a restarted browser; ownership may have been transferred; two clients may attempt recovery simultaneously.

Without those checks, “recognize and clean up” is stronger than the ledger's evidence. The issue is not whether a particular backend happens to generate collision-resistant ids; it is the missing cross-connection identity and ownership contract.

**Recommendation:** Treat persisted entries as reclamation candidates. Require verified browser/session incarnation and resource correlation, ownership transfer/release records, and coordination between concurrent claimants before destructive cleanup. If a backend cannot supply sufficient identity evidence, expose explicit claiming or leave the candidate unresolved. Since reconnect is deferred, it is also reasonable to keep the ledger as diagnostics now and defer automatic reclaim semantics.

**Acceptance cases:** Reconnect to the same browser, reconnect to a replacement browser at the same endpoint, and attempt recovery from two clients. Only the positively matched current owner can clean up a resource.

### 9. Medium — Successful stream termination is not successful completion of a waiter

**Where:** §4 item 8; §4.1; §3.1. Reviewed lines 503–513, 444.

Ending a logging stream successfully on ordinary page close is a good default. A combinator waiting for one required response or popup has a different contract: the page closing before the match should fail promptly, not return an empty success or wait until its deadline because the stream ended normally.

The draft also leaves the ordering between a final buffered match, normal stream end and lifetime failure unspecified. That matters when a response arrives and the page immediately closes. Captured response bytes may still be a valid result; a returned popup expected to be usable may no longer be one.

**Recommendation:** Specify terminal behavior independently for streams and required-result waiters. A waiter that reaches normal end without a match translates that into an appropriate `TargetGone`/domain reason. Define whether already-published events drain before termination and which observed-result/lifetime transition wins. Preserve already-owned values when their lifetime no longer depends on the closed page. A wait for current state should use a snapshot-plus-subscription handoff with a revision boundary so it neither misses a transition nor treats replayed state as a fresh event.

**Acceptance cases:** A page closes before the expected response; a response is captured immediately before close; a new subscription starts while the owner is closing. Every case finishes deterministically without relying on the timeout as a fallback.

### 10. Medium — Response identity and event values need a redirect-hop contract

**Where:** §§1.2, 2.8, 2.12. Reviewed lines 104–112, 240–265, 320–335.

The model has a stable `RequestId` across redirects and mentions `redirectCount`, but `ResponseRef` has no defined identity or ownership contract. The fields of `Request` include URL, method and headers that can change across hops. New value equality by model id makes this distinction more important.

Consider waiting for a 302 response, holding its result, and then reading headers after the next hop completes. The held result must still describe the 302, not whatever response is currently stored against the shared request id. Matching a body or attributing a paused response to the correct hop needs the same identity.

**Recommendation:** Define a redirect-hop identity, such as `(RequestId, redirectCount)`, and bind response metadata, body access and pause phases to it. Events should carry immutable observations/snapshots; accessing live state should be an explicit operation. Request-chain identity can stay stable without making every hop equal. This is a small completion of the existing network model, not a separate request framework.

**Acceptance case:** Retain responses from every hop in a redirect chain and inspect them after completion. Each retains its original URL/status/headers and reports its own body availability.

## Smaller consistency and API decisions

- **The guarantees table is stronger than its detailed sections.** It guarantees held inputs are released, while §2.10 correctly promises only bounded attempts; it forbids declarations on non-owned resources without mentioning P9's opt-in; and it lists acknowledged remote obligation resolution as a capability when acknowledgement is actually a per-decision observation. Tighten the table after the contracts above are settled.
- **Node identity and generations need one rule.** The §1.2 NodeRef tuples include `generation`; §2.9 omits it. §1.3 permits detached-node reinsertion, while §1.2 binds refs to a content generation. State whether reinserting the same surviving node after `document.open()` revives an old ref or requires a new one. Also define Equal/Hash keys for composite refs and acquired handle leases; equal underlying identity must not imply interchangeable release ownership. Mutable descriptions/connectivity must not participate in hashing.
- **A waitable prompt is not guaranteed to finish inside the caller's budget.** §2.11 says a prompt never makes the next action fail during the grace period, but the remaining operation deadline may be shorter than that period. Promise no immediate rejection solely because a resolver is pending; keep deadline failure possible. Attribution of auto-resolution to “the operation” also needs to support multiple concurrent observers without asserting one caused the prompt.
- **Navigation projection still needs a few common policy examples.** Define `back()` at the beginning of history, HTTP 404/500 documents, same-document navigation to the current URL, and a slow post-commit load. None should require callers to reason about an ambiguous ten-case union just to distinguish no history entry from failed navigation. These are API decisions, not all browser-measurement questions.

## What to add, and what to defer

I would add only the distinctions needed above: control scope separate from cleanup ownership, explicit cleanup ownership for temporary groups, an intentional sensitive-state codec, and response-hop snapshots. They resolve concrete use cases. A new public framework for any of them is unnecessary unless call sites demonstrate its value.

The most useful next artifact is a small set of typed usage examples for the acceptance cases, particularly attach/configure/leave-open, response filtering with a body, paused-clock clicking, and scoped popup cleanup. Keep effects from the user generic in both `E` and `R`. These examples will show whether the smaller error vocabulary actually improves composition. More exhaustive L1 prose cannot settle that by itself.

## Validation and limits

This review read draft 3 and both preceding reviews, inspected the relevant local Effect source, and checked the primary documentation linked above. It ran the following narrow serialization probe against the local `effect@4.0.5` distribution with a synthetic value:

```ts
const secret = Redacted.make("synthetic-review-fixture")
const stored = JSON.parse(JSON.stringify({ cookie: secret }))
// stored.cookie === "<redacted>"; the original cookie cannot round-trip here.

const echoed = JSON.parse(JSON.stringify({ message: Redacted.value(secret) }))
// echoed.message is the original string; Redacted.isRedacted(echoed.message) is false.
```

The findings about browser interactions are contract contradictions, missing cases, or explicitly described failure scenarios, not claims from a newly run browser conformance suite. No browser behavior was measured and no concepts were changed as part of this review.
