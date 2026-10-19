# Design review — draft 1

*2026-10-18. Review of baseline commit `212a2be`. The text below preserves the review delivered in the project conversation; local file links have been made repository-relative. Section references describe draft 1.*

I reviewed [CONCEPTS.md](../CONCEPTS.md) as the current design. The strongest parts are stable identities across process swaps, eager subscriptions, scoped interception, and diagnostic readiness checks. I would keep those.

**The main concern is that the document locks in guarantees before establishing how callers will experience their limits.** Several would produce misleading errors, unexpected cleanup, or unsafe retries. I’d resolve these before treating L1 as settled.

1. **Interruption, lifetime failure, and uncertain execution need separate semantics.**  
   [§3.1](../CONCEPTS.md), [§5](../CONCEPTS.md)

   Closing a scope with `Exit.fail(PageClosed)` does not make its fibers fail with `PageClosed`. I checked this against the local Effect 4.0.5 package: the child exits with an interruption cause. The proposed `within` abstraction must explicitly deliver the lifetime failure and coordinate cleanup.

   Similarly, ordinary fiber cancellation cannot reliably return a catchable `OutcomeUnknown` to the canceled caller. Uncertainty also occurs when a connection disappears or a command times out after dispatch—not only on interruption.

   I’d preserve normal Effect interruption and maintain an internal operation record containing dispatch state, observed outcome, and cleanup status. An explicit inspection API could expose it when needed. Also reconcile “drop late replies” with resource creation: a late `newPage` reply must still reach cleanup.

2. **The navigation model sometimes turns missing evidence into a fact.**  
   [§2.8](../CONCEPTS.md), [§4](../CONCEPTS.md)

   No document change during a quiet interval cannot distinguish cancellation from a slow server, pending handler, or delayed navigation. Likewise, `historyUpdated` after a navigation starts need not belong to that navigation.

   The flush guarantee is also too strong. A round trip cannot prove that every event *caused* by an action has occurred; the action may schedule subsequent work. Even already-received events can remain queued in the per-session fold when the reply resolves. CDP documents `Page.enable` as enabling notifications, without the proposed causal guarantee. [CDP definition](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl)

   Define a local processing barrier precisely, and use explicit observations for navigation completion. A deadline should report that completion was not observed, with evidence, rather than manufacture `Canceled`.

   There is another direct conflict: navigation completes at commit, but its terminal union includes `Aborted` **after** commit. Put post-commit loading failures on the document or a separate completion stage.

3. **Resetting the default realm on navigation start can strand a usable page.**  
   [§2.6](../CONCEPTS.md)

   Consider a navigation that becomes a download, returns 204, or is canceled by `beforeunload`. The old document and realm survive, but the reset deferred may never receive a replacement context event. The rule refusing evaluations while navigation is pending makes this worse.

   Keep the active realm available while tracking a prospective replacement separately. Invalidate it on evidence of destruction or replacement. This also permits useful reads of the existing page while a slow navigation is pending.

4. **Observation ownership and destruction ownership are conflated.**  
   [§2.1](../CONCEPTS.md), [§3.1](../CONCEPTS.md)

   Attached browsers promise disconnect-only cleanup, yet adopted pages enter a scope tree whose finalizers close pages and remove contexts. Following that tree literally could close the user’s existing tabs before disconnecting.

   Every remotely observed resource needs an explicit release policy: stop observing, close, or remove. Being a child in the model must not imply permission to destroy it.

   Also distinguish **requesting a close** from **ending a lifetime**. If `beforeunload` cancels a close request, the page must remain usable; its scope cannot already have ended.

5. **Configuration failures currently become successful-looking pages.**  
   [§3.2](../CONCEPTS.md)

   Setup uses `allSettled`, logs failures, and always resumes. That conflicts with the promise that declarations are applied before page code runs. A failed interception or preload installation can materially change the automation’s behavior.

   Initialization needs dependencies and an explicit result: required setup failures prevent successful publication; optional unavailable features remain visible as such. Resuming during cleanup is reasonable, but must not imply successful initialization.

   The guarantee also needs a temporal boundary: declarations installed after attaching cannot precede scripts that already ran. Specify current-document application separately from future-document guarantees.

6. **“Exactly once” needs a smaller, implementable contract.**  
   [§2.11](../CONCEPTS.md), [§2.12](../CONCEPTS.md)

   The driver can select one winning decision locally. It cannot guarantee acknowledged remote resolution after a connection loss.

   Several cases remain unspecified: a handler that never completes, competing handlers, a handler returning without deciding, and a default racing an explicit decision. Auth interception also needs phase-specific decisions and defaults; generic `Continue` is insufficient.

   Model pending, decision-selected, acknowledged, and uncertain resolution separately. Add bounded handler ownership and deterministic precedence. Prompt handlers must be installed and runnable before the trigger, since the triggering command may itself wait for the prompt to close.

7. **Override stacks break under ordinary concurrent Effect code.**  
   [§2.15](../CONCEPTS.md)

   Fiber A sets dark mode; B sets light mode; A finishes first. A literal pop removes B’s override. Restoring A’s remembered previous value also overwrites B.

   Use individually identified registrations: release removes that registration and recomputes the effective value. Define context/page/frame precedence and serialize application of changes.

   Even then, two fibers cannot independently own different values of the same physical browser setting. Where isolation is impossible, require an exclusive lease or reject the overlap.

8. **Document identity cannot establish complete node liveness.**  
   [§1.2–1.3](../CONCEPTS.md)

   An unchanged document can remove, reinsert, or adopt a node. Its document id permits some local invalidation, but does not prove connectivity. WebDriver’s stale definition explicitly depends on both the active document and current connectivity. [WebDriver specification](https://w3c.github.io/webdriver/#dfn-is-stale)

   Separate known invalidity from last-observed validity, and validate during the operation. Clarify whether reinsertion can revive a reference.

   Likewise, restoring a document from bfcache does not by itself prove that a protocol handle remains usable. Document restoration and handle restoration need separate evidence. On-demand realm tracking also needs an explicit account of which lifetime guarantees it can retain without destruction events.

9. **The ingestion design needs a failure policy for its own state tracker.**  
   [§4](../CONCEPTS.md)

   Isolating decode errors to consumers is appropriate for optional telemetry. If the consumer is the frame/document tracker, a failed decode can invalidate every subsequent identity decision.

   Specify which failures require resynchronization or termination of the affected session. Continuing with silently incomplete state contradicts lossless ingestion.

   There is also no overload policy. An unbounded queue risks exhausting memory; blocking the shared reader can prevent replies needed to drain it. Keep user streams and asynchronous enrichment off the critical state-processing path, with explicit limits and observable overflow behavior.

10. **Retryability depends on the operation and its progress, not just the error tag.**  
    [§6](../CONCEPTS.md)

    A stale reference is recoverable when resolving a locator before input. The same error after a mouse-down handler submitted a form does not authorize repeating the click.

    Centralize retry policy, but give it the operation phase, target semantics, and dispatch evidence. Distinguish retrying observation, re-resolving a locator, and repeating an action. This is essential to making auto-waiting feel trustworthy.

**For ergonomics, I would make these decisions early:**

- **One deadline per user operation.** It should include queueing, locator resolution, actionability, dispatch, and postconditions. Nested calls consume the remaining budget. Cleanup gets a separate bounded allowance. The research notes already propose this; it belongs in the core contract.
- **Capabilities should belong to the browser or page instance.** An ambient `AxTree` service does not establish that the particular page being used supports it, especially with multiple browsers. Prefer instance-bound capability access or refinement, while keeping common methods free of growing environment requirements.
- **Body capture should follow expressed intent automatically.** A caller waiting for a response body should not have to know that BiDi requires a collector before the request begins. The wait combinator should acquire that machinery before its trigger and retain the result long enough to consume it.
- **Separate readiness observations from action policy.** `Visible`, `ReceivesPointer`, and “appropriate to click” are different decisions. Likewise, “currently blocked” does not necessarily mean “cannot become ready.” Precise diagnostics are valuable; fixed policy should remain replaceable.
- **Define evaluation call sites before locking mandatory schemas.** Schema decoding is excellent for extraction and external data boundaries. Requiring an explicit schema for every simple typed evaluation could become substantial ceremony.
- **Make storage snapshots portable across fresh contexts.** Clarify whether their `userContext` field records provenance or restricts restoration. Saving login state and restoring it into a new isolated context should be a straightforward supported workflow.

Two additional concepts fit naturally: an internal **operation record** for dispatch and uncertainty, and an **observation window** that installs subscriptions, collectors, and handlers before running an action. Both reduce caller ceremony while making the guarantees more honest.

One factual correction: §2.10 says CDP has no click count, but `Input.dispatchMouseEvent` explicitly accepts `clickCount`. [CDP definition](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Input.pdl)

**I would write the ergonomic examples before locking the remaining L1 decisions.** Login, click-and-wait, popup handling, response-body inspection, download saving, and concurrent pages will expose the important seams quickly. The native model should be revised wherever those examples require callers to manage protocol mechanics themselves.

This was a design review with source checks and a small Effect semantics probe; browser-dependent behavior remains unmeasured.

