# Design review — draft 4

*2026-10-18. Review of commit `6cc0bc1b79c1359090a0971f465562bca740675e` ([CONCEPTS.md](../CONCEPTS.md), draft 4). This review follows reviews [1](01-draft-1.md), [2](02-draft-2.md) and [3](03-draft-3.md); it does not repeat their findings. Section references describe draft 4. This commit records the review only; it does not revise the concepts.*

Draft 4 resolves review 3 carefully. Separating control scope, release policy and cleanup owner is the right model. Typed backend failures, response-hop identity and the terminal-marker rule for streams also close real holes.

This review has two parts. The first is about convergence: the document has grown with each review, and nothing has been written yet that would show whether the API is pleasant to use. The second lists the conflicts and holes I found in draft 4, ordered by severity. Most come from the new control-scope model meeting mechanisms that predate it.

## Convergence: stop growing the prose, start compiling call sites

Draft 1 had about 9,000 words. Draft 4 has 19,500, with twelve acceptance scenarios and still no code. Each review has made the contracts more honest, but it has also added hedges, and the cost lands on the reader of the API, who is the person ergonomics is for. Reviews 1 and 3 both recommended writing call sites before further L1 work. That advice has not been acted on, and it is now the main risk to the project.

**Recommendation:** treat draft 4 as the L1 baseline, and turn the §11.1 acceptance scenarios into *compiled* TypeScript before revising CONCEPTS.md again.

- **What to write:** stub interfaces for `Browser`, `Context`, `Page`, `Locator` and the §4.1 combinators, plus one `.ts` file per scenario, checked by `tsc` in CI.
- **What the compiler checks** that prose cannot:
  - whether the error channel of an ordinary verb really stays at about three tags (P11);
  - whether caller `E` and `R` survive `expectResponse` and friends (§4.1);
  - whether ordinary call sites stay free of `Scope` and platform services (§3.1 ownership defaults);
  - whether attach-mode code has to say "control" in an obvious place (finding 2).
- **What to do with the result:** any scenario that needs protocol knowledge or repeated ceremony is a defect to fix in L1. Anything the scenarios don't exercise should stay out of CONCEPTS.md until a scenario needs it.
- **Size:** move rationale and prior-art citations into the research notes or an appendix, so the contract itself becomes shorter rather than longer. A target of about half the current length seems achievable without losing a guarantee.

## Findings

### 1. High — Pause-on-start may not be available at the granularity the control model assumes

**Where:** P9; §3.1 control scope; §3.2 steps 1 and 3; probe 19.

Draft 4 says observation-only discovery "must not pause unrelated targets" and that declarations stay within the selected control scope. On CDP, the mechanism behind before-author-script setup is `Target.setAutoAttach{waitForDebuggerOnStart}` on the browser session. As far as I know, its `filter` selects by target *type*, not by browser context or opener. In attach mode, then, either:
- every new tab the user opens is paused until our client resumes it, which mutates observe-only targets and can freeze them if our process dies mid-setup; or
- nothing is paused, and popups of a *controlled* attached page cannot get `timing: "beforeAuthorScript"` declarations.

`Target.autoAttachRelated` covers related targets of one target (frames, workers), but whether it covers popups is unknown. Contexts we create are less of a problem, because no foreign tabs live in them.

**Recommendation:**
- Make **scoped pause-on-start** a capability with explicit granularity: per created context, per related target, per opener, or browser-wide only.
- When a declaration requests `beforeAuthorScript` for targets the available granularity can't isolate, fail with the existing timing `Unsupported` rather than pausing observe-only targets.
- Extend probe 19 to paused targets: what happens to a target paused for the debugger when the client connection drops?

**Acceptance case:** attach to a browser with an existing user tab, select one tab for control, and install a popup-inheriting preload. Then let the user open a new tab manually. The user's tab is never paused, and the preload request either succeeds with verified scoping or fails up front.

### 2. High — "Observe" forbids reading the page, so attach-mode inspection needs a middle level

**Where:** §3.1 control scope; §3.2 step 3; §2.11 policy.

Under draft 4, observation "permits protocol observation, not page-code injection". Locator reads, `isVisible`, text extraction, accessibility snapshots and readiness predicates all run injected code in the utility world (§2.6). So on an observe-only page, a user cannot even read a heading without claiming `Control`. `Control` also grants input, navigation, main-world evaluation and declarations. Common attach-mode workloads (an agent looking at the user's tab, a scraper reading an existing session, a monitor taking screenshots) would have to request far more power than they use.

**Recommendation:** add a level between the two. It isn't forced; the existing model already splits observation from mutation, and this is where reads belong.

| Level | Permits |
|---|---|
| `Observe` | protocol events only: lifecycle, network metadata, console where available |
| `Inspect` | isolated-world reads, locator resolution, readiness predicates, snapshots, screenshots/PDF, body reads for observed requests |
| `Control` | input, navigation, main-world evaluation, declarations, obligations (dialog and request decisions) |

Spell out which levels allow injecting the utility world, and whether stealth/OnDemand configurations (§2.6) change that. Whether creating an isolated world counts as "mutating" is itself a documented policy choice.

**Acceptance case:** attach, select a tab for `Inspect`, read text and take an accessibility snapshot. An attempted click fails immediately with a scope error naming the required level.

### 3. High — `Unsupported` carries two meanings and appears in two places

**Where:** P7, P9, §§2.6, 2.15, 3.1, 4.1, 6.

`Unsupported` currently means both "this backend cannot do it" (timing guarantees, user activation, clock coverage) and "you have not granted the scope" (`Unsupported{reason: ControlScope}`, §3.1). These need different fixes: one requires a different backend, the other a different call. An error message that can't tell them apart is exactly the kind of message users hate.

Placement is also inconsistent. §6 lists `Unsupported` as a standalone tag "only where the capability is not statically known". The §4.1 sketch folds unsupported collection into `ResponseError`. P9, §2.6 and §2.15 say acquisition "fails with `Unsupported`".

**Recommendation:**
- **Split scope from capability:** use `NotPermitted{required: Inspect | Control | BrowserWide, target}` for scope, with a message that says how to obtain it, and keep `Unsupported{capability, backend}` for backend limits.
- **Pick one placement rule:** both are *reasons inside the calling verb's domain error*. That keeps P11's three-tag channel intact. Provide `isUnsupported(e)` / `isNotPermitted(e)` refinements for programs that want to branch across verb families.
- If a standalone tag is kept for capability refinement APIs (P7), say so explicitly, and make it the only place where it appears.

### 4. High — Page time should be one timeline per scope, not one installation per document

**Where:** §2.15 page time; §2.7 preload ordering; probe 21; scenario 10.

Draft 4 makes the default coverage of an injected clock "the selected document's main world", requires child frames to be included explicitly, and gives each controlled installation a document lifetime. Three ergonomic problems follow:

- **Navigation resets time.** A test that installs a fixed or controlled clock, then navigates, can't tell from the contract whether the next document sees the same paused instant, a fresh installation, or real time. Playwright solves this as an *event-sourced* clock. Each operation (`install`, `pauseAt`, `fastForward`, `setFixedTime`) is applied to existing frames and appended to an init-script log, which new documents replay to catch up (`research/playwright-internals.md`, clock).
- **Frames disagree by default.** A same-origin iframe reading `Date.now()` sees real time while its parent sees fixed time. Prior art covers every frame.
- **Ordering against user preloads is unspecified.** If a user preload captures `setTimeout` before the clock installs, it keeps real timers.

**Recommendation:**
- Model application time as **one logical timeline per control scope** (page by default, optionally context): an ordered log of clock operations.
- Install it into every document and frame in scope, replaying the log so new documents join the same timeline.
- Run library environment shims (clock first) in a reserved **environment phase** before user preload bundles.
- Keep per-document teardown limits as stated. Workers remain explicit opt-in because coverage there differs by backend.

**Acceptance case:** install controlled time on a page, pause it, navigate twice and open a same-origin iframe. Every document and frame reports the same paused instant, and one explicit advance is observed everywhere.

### 5. Medium — Cross-scope preload dependencies create action at a distance

**Where:** §2.7 ordering and removal.

Draft 4 lets a context-level consumer depend on a page-level helper, and when the helper's scope exits it "deactivates dependent registrations ... and notifies their owners with a typed declaration failure". A `withPage` block ending can therefore break a context-wide registration owned by a different part of the program. That is a hard failure mode to explain, and the machinery (dependency ids, cycle detection, deactivation notices) adds weight to every preload, even though "common cases need only an ordered array".

**Recommendation:** a registration may depend only on registrations with an equal or broader scope, which by construction outlive it. A context consumer that needs a page helper is then a page-scoped registration, or the helper is promoted to context scope. Cross-owner deactivation disappears, and acquisition can reject invalid edges statically.

### 6. Medium — Ambiguous matches should fail fast when the ambiguity is stable

**Where:** §6 (strict-match ambiguity retried until the deadline).

Retrying ambiguity fixes Playwright #36045 (a leftover toast with the same label), where the ambiguity is transient. But a locator that genuinely matches two elements, such as two permanent "Submit" buttons, now waits the full operation deadline (often 30 s) before reporting the candidate list. That is the slowest possible feedback for the most common authoring mistake.

**Recommendation:** treat ambiguity like stability. If the *same* candidate set persists across the predicate's sampling window (a few rendering samples, or a short bounded interval such as one second), fail early with `StrictViolation{candidates, suggestedLocators}`. Retry only while the candidate set is changing. Report which of the two happened.

### 7. Medium — Observation combinators drop the trigger's value and read backwards

**Where:** §4.1 `expectResponse` sketch.

The sketch returns `CapturedResponse<A>` and discards the trigger's success value. When the trigger is `goto`, or a click that returns an outcome, the caller loses it and has to thread a `Ref`. The data-first shape `expectResponse(trigger, options)` also reads as "expect a response, given this click" rather than "click, expecting a response".

**Recommendation:** make observation combinators **dual** and return both values. For example, `page.goto(url).pipe(Observe.response({ match, body }))` gives `[Navigation, CapturedResponse<A>]`, with a data-first overload alongside. This follows the Effect idiom in `research/effect-building-blocks.md`: verbs are methods, decorators are dual combinators. The E/R-preservation contract stays exactly as written.

### 8. Medium — Default diagnostics may be too sanitized for the most common user

**Where:** §2.20 diagnostic rendering; §1.2 descriptions; §6 `TargetGone.object`.

Default descriptions now use "ids and sanitized URL origins, omitting userinfo, path, query and fragment", and omit titles. For agents and exported production traces that is right. For a developer whose local test just failed, "timeout waiting for button on `https://app.example.com`" without the path or title is a much worse error than Playwright's. Error-message quality is one of the strongest love/hate signals in `research/testing-models.md`.

There is also a small inconsistency. §3.1 and the §6 table store "last URL/title" on close reasons and `TargetGone.object`, while §2.20 says descriptions omit them. The intent is presumably "stored, sanitized on render"; say so.

**Recommendation:** provide two named diagnostic presets through a `Context.Reference`:
- `local`: path and title included; query, fragment, userinfo and classified fields still protected.
- `strict`: today's default, for agents, exported traces and production.

Document which preset applies by default. Test layers are a reasonable place to opt into `local`. Classified-field redaction never varies between presets.

## Smaller items

- **Envelope fields are listed twice.** §5.1 defines the shared diagnostic envelope, and the §6 table repeats `dispatch` and `operationId` on individual tags. List only the tag-specific fields in §6 and reference the envelope once.
- **The guarantees table lacks control-scope columns.** It is the contract DESIGN.md builds on, so the Declarations and Obligations rows should say which guarantees require `Control`, and the Readiness row should say which require `Inspect` (finding 2).
- **Default prompt policy on attached pages.** §2.11 makes observe-mode targets receive no automatic decisions. State what a *controlled* attached page gets by default. Auto-dismissing dialogs on a user's real tab is a behavior change they should opt into, distinct from owned pages.

## What not to add

Nothing new is needed beyond the `Inspect` level (finding 2), the environment phase for library shims (finding 4) and the diagnostic presets (finding 8), each of which resolves a concrete call-site problem. Everything else should wait for the compiled scenarios to show a need.

## Validation and limits

This review read draft 4 in full, the three earlier reviews and the relevant research notes. It confirmed in the local `effect@4.0.5` source that `Effect.catchReason`, `catchReasons` and `unwrapReason` exist, which the reason-based error recommendation relies on. Playwright's event-sourced clock comes from the research notes on Playwright internals, not from new source reading. The CDP auto-attach granularity in finding 1 is stated from protocol knowledge and is explicitly marked as needing a probe. No browser behavior was measured, and no concepts were changed as part of this review.
