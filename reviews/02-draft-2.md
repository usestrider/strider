# Design review — draft 2

*2026-10-18. Review of commit `60b51e9` ([CONCEPTS.md](../CONCEPTS.md) draft 2). The text below preserves the review delivered in the project conversation; local file links are relative to this folder. Section references describe draft 2. Findings already raised in [review 1](01-draft-1.md) were not repeated.*

The revision fixed most of the first review's points, but it introduced a few contradictions and left the experience at ordinary call sites undefined. The findings are ordered by severity, with what to add afterwards.

## Conflicts

**1. Where navigation ids come from contradicts subscribe-before-trigger.**
- §2.8 says a navigation started by a command gets its id *before* the command is sent.
- §1.2 says the id comes from the backend where one exists. For CDP that's the `loaderId`, which only exists *after* `Page.navigate` returns.
- §1.2 also opens with "all model ids are minted by L1" but then lists `UserContextId` and `RequestId` as backend ids.

Fix: L1 mints every public id, and backend ids are only correlation evidence. `DocumentId` and `RealmId` already work this way, and it's the only rule that survives process swaps and reconnects.

**2. Emulating context-scoped intercepts touches tabs we don't own.**
- §2.12 emulates a user-context-scoped BiDi intercept with a global one that immediately continues other contexts' requests.
- In an attached browser, that pauses traffic in the user's own tabs, which §3.1 and §8 promise to leave alone.
- It can also leave those tabs stuck. The research notes the BiDi spec saying a closed WebSocket doesn't end the session, so if our process dies, the intercept may keep blocking them.

Fix: declarations must never take effect on resources we don't own. Where emulation would, require explicit opt-in, or return `Unsupported` in attached mode. Add a probe: what happens to intercepts and paused requests when the client connection drops, on CDP and on BiDi?

**3. Precedence follows a different rule for each declaration kind.**
- Overrides: most specific scope, then newest (§2.15).
- Obligation handlers: priority, then most recent, with no scope term (§2.11.2).
- Preload scripts: order is unspecified.

Use one order everywhere: scope specificity, then priority, then recency. Users learn it once.

**4. Smaller inconsistencies.**
- §1.1 says a document epoch is stable across a back/forward cache restore. §2.5 says it is stable only when continuity can be shown, and otherwise gets a new id.
- §2.3 models a crash as `PageClosed{by: Crash}`, while §3.1 has a separate `PageCrashed`.
- §2.5 and §2.8 rely on a "content generation" or "loading generation" that is never defined. `document.open()` makes it a real identity, so it belongs in the §1.2 table.

## Holes

**5. The error channel of an ordinary call is undefined, and the vocabulary would make it huge.**
- `CloseReason` has 15 top-level tags, §6 adds about 20 domain tags, and §5.2 splits deadline failures three ways.
- If `goto` can fail with 20 tags, `catchTag` stops being useful.

Fix: use the pattern §6 already uses for protocol errors, one tag per family with a `reason` field:
- `TargetGone{object, reason}` for every lifetime end.
- `Timeout{operation, phase: "resolving" | "waitingForCondition" | "dispatchedUnconfirmed" | "postcondition"}`. `OutcomeUnknown` belongs here as the `dispatchedUnconfirmed` phase.
- One domain error per verb.

Budget roughly three tags per ordinary verb, and let `catchReason` handle precision.

**6. Which navigation outcomes count as success is undefined.**
The ten-way outcome union is right for L1, but `goto` needs a projection:
- **Success:** `Committed | SameDocument | Restored | Activated`.
- **Failure:** `NavigationError{reason}`.
- `Download` and `NoContent` count as failures for `goto` by default, since you asked for a page. Downloads are handled by their own combinator.

**7. How event streams end is unspecified.**
When a page closes, does `page.requests` end or fail? The right default:
- A normal close (by command, by script, or by context removal) ends the stream, so `runForEach` finishes.
- A crash, connection loss or `ModelUnavailable` fails it with the reason.

**8. The default dialog policy conflicts with fail-fast `PromptBlocking`.**
- The default dismisses a dialog "after a bounded grace period" (§2.11).
- Meanwhile any operation confirmed blocked by the dialog fails immediately with `PromptBlocking`.
- So the action right after one that triggers an `alert()` fails, even though it would have worked a moment later.

Fix: make `PromptBlocking` something waits can sit on while a handler or the default is pending. It becomes terminal only when nothing will ever resolve the dialog.

Also report dialogs that were resolved automatically. Attach something like "`confirm('Delete account?')` auto-dismissed" to the operation's span and to any later failure message. Playwright's silent auto-dismiss is a classic way bugs get hidden.

**9. "Where supported" with no defined fallback.**
- Many of the revision's guarantees are conditional: before-author-script timing (P9), preload inheritance into popups, native file-chooser cancel.
- None of them says what the caller sees when the backend can't deliver.
- For declarations, timing is exactly where silent degradation turns into flakiness: an init script that installs a fake clock or an auth token "usually" runs first.

Fix: each declaration states the guarantee it needs (`timing: "beforeAuthorScript" | "bestEffort"`), and acquisition fails with `Unsupported` if the backend can't meet it.

**10. Ownership doesn't follow openers, and doesn't survive reconnects.**
- **Popups.** Take scenario 7 (attach, create a temporary page, release). If the temporary page lives in the default context and opens a popup, §3.1 makes the popup `ObserveOnly`, so it leaks after release. Rule: popups opened by an owned page are owned, unless explicitly released.
- **Reconnects.** A dropped connection to a remote browser ends the model but leaves owned contexts alive remotely, and a reconnecting client sees them only as adopted. Server-first deployments will hit this. Consider tagging owned resources remotely so a later connection can reclaim and clean them up. Reconnect itself can wait, but the design shouldn't make reclaiming impossible.

**11. Single-event waiters can overflow on unrelated traffic.**
`waitForResponse(pattern)` is a lossless subscriber whose buffer fails with `EventOverflow` when full (§4). Under heavy traffic, unrelated requests fill that buffer. Evaluate the filter in the publisher so only matching events are buffered; every combinator then gets overflow safety for free.

## Concepts that fit

- **Redacted values.** Tracing is on by default (§7), and spans record arguments. Without redaction, `fill(password)`, `ProvideCredentials`, cookie values in `StorageState` and `Authorization` headers all end up in traces. Effect 4.0.5 ships `Redacted` (checked). Accept `Redacted<string>` wherever secrets go in, return it where they come out, and have the tracer never render it. It also covers the placeholder-secrets pattern browser-use and Stagehand use for agents.
- **Evaluation with user activation.** All three protocols support it natively: CDP `Runtime.evaluate{userGesture}`, BiDi `script.evaluate{userActivation}` and WebKit `emulateUserGesture`. It lets activation-gated APIs (fullscreen, clipboard, popups) run without synthetic clicks. It belongs in §2.6/§2.10 next to `requiresActivation`, and the activation estimate then becomes diagnostic only.
- **Page time.** Browser-side time (`Date`, timers, `requestAnimationFrame`) is missing from the §2.15 settings. Modes: real time, fixed or offset time, CDP virtual time (`Emulation.setVirtualTimePolicy`), or injected fake timers (Playwright's BSD-licensed clock). It's a declaration that requires before-author-script timing (item 9), plus a capability per backend. The "two clocks" idea from the testing research needs this in L1.
- **Long-lived connections.** §2.12 excludes WebSocket and EventSource from network-idle accounting but never models them. CDP exposes WebSocket frames natively; BiDi doesn't, and mocking them needs injected code. A `Connection{kind, url, frames: Stream}` concept with capability flags is enough for now.
- **Value-style identity.** Make every model object `Equal`/`Hash` by its id, so pages and frames work as HashMap keys, with `groupByKey` and in assertions. A small change users will notice.

## The document itself

Draft 2 is more correct but much harder to use as a contract. "Where supported", "evidence" and "best-effort" run through all 13,600 words. A one-page "Guarantees at a glance" table would let DESIGN.md build on it without re-reading every hedge, and would make regressions visible. Per concept, it would show:
- what is guaranteed;
- what is guaranteed given a named capability;
- what is best-effort;
- what is unknown until probed.

**Next step:** most of items 1–11 are local edits to CONCEPTS.md. Items 5–7 are really call-site decisions, to be confirmed while writing the seven acceptance scenarios in DESIGN.md.
