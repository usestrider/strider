# effect-browser (working name)

*Design stage, revision 5 (2026-10-18). No implementation yet.*

An Effect-native browser automation library that speaks browser protocols directly (CDP first, then WebDriver BiDi, then the WebKit inspector protocol) instead of wrapping Playwright. Its priorities, in order:

1. **Ergonomics.** Call sites read like the task; mistakes are hard to write; errors explain themselves.
2. **Correctness under concurrency and interruption.** Scoped lifetimes, typed end reasons, no hangs, no silent replays.
3. **Breadth.** Several backends behind one model, with capabilities stated per instance.
4. **Performance and stealth.** Features are enabled on demand, and stealth is an architectural option.

## Documents

Each layer document has the same shape: purpose, top data models, interface sketch, key contracts, open questions. They aim for similar depth, and none contains implementation detail. The reasoning behind each contract lives in `reviews/` and in draft 4 of the native model (commit `6cc0bc1`); these documents keep the decisions, not the debate.

| Layer | Document | What it covers |
|---|---|---|
| — | [README.md](README.md) | goals, principles, cross-cutting decisions, guarantees |
| L2 | [API.md](API.md) | the public API: entry points, pages, locators, actions, expectations, observation, network, clock, agents, testing, errors, call sites |
| L1 | [CONCEPTS.md](CONCEPTS.md) | the native browser model: identities, data models, lifetimes, contracts |
| L0 | [PROTOCOL.md](PROTOCOL.md) | transports, protocol clients, code generation, ingestion, backend adapters, capabilities |
| — | [PROBES.md](PROBES.md) | conformance probes, hazard coverage, deterministic model tests |
| — | [research/](research/) | prior-art notes (historical evidence) |
| — | [reviews/](reviews/) | design reviews, one per draft |

```
L2  API       Browser · BrowserContext · Page · Locator · Expect · Watchable · Observation · Route · Clock · Trace · Har · Toolkit · BrowserTest
L1  Model     ids · navigables · documents · realms · navigations · requests · obligations · declarations · readiness
L0  Protocol  transports · sessions · generated commands and events · ingestion · backend adapters · capabilities
```

Each layer uses only the one below it. L2 never sees protocol ids; L1 never sees call-site conveniences; L0 never decides policy.

## Principles

1. **Spec identity, not protocol identity.** The public model is keyed by navigable, document, realm, navigation and request, with ids minted by the library. Protocol ids (CDP targets, sessions, execution contexts) change on process swaps and stay inside the adapters.
2. **Lifetimes are scopes with typed end reasons.** Three separate decisions govern every remote resource: how much we may do to it (access), whether we may destroy it (release policy), and which scope cleans it up (cleanup group). Anything with a lifecycle is acquired into a `Scope`.
3. **Interruption stops waiting; it never pretends to cancel.** No protocol can cancel an in-flight command. Interrupting abandons the reply and runs compensations (release held input, resolve paused requests). Whether a mutation reached the browser is recorded as evidence.
4. **State is folded before it is published.** Events update the model in order before anyone observes them. Losing integrity (overload, an undecodable lifecycle event) is an explicit failure, never a silent drop.
5. **Subscribe before trigger, structurally.** Every "wait for X caused by Y" subscribes before Y runs, and no API makes users order these themselves.
6. **Obligations get exactly one decision.** Paused requests, dialogs and file choosers get one locally selected decision, a default when handlers fail, and tracked remote acknowledgement.
7. **Capabilities belong to instances.** A missing capability is a typed `Unsupported` reason or a missing method, never a silent no-op.
8. **Protocol features are demand-driven.** Domains and subscriptions are reference-counted, so a stealth configuration that never enables `Runtime` remains possible.
9. **Declarations are acknowledged, timed and composed by fixed rules.** Init scripts, routes, overrides and clocks state the timing they need and fail rather than degrade. One precedence rule orders settings and handlers, and an ordered bundle orders scripts.
10. **Small error channels, rich evidence.** An ordinary call fails with `TargetGone`, `Timeout` or its own domain error. Detail lives in `reason` fields and a shared diagnostic envelope.
11. **Secrets are protected in diagnostics, and export is explicit.** `Redacted` goes in, classified fields come out wrapped, and secret-bearing exports are deliberate operations.
12. **If it doesn't have to be a function, it's a value.** Operations without arguments are `Effect`s (`locator.click`, `browser.newPage`), and pure derivations are properties (`locator.first`). A member whose parameters are all optional is a default value plus `xWith(options)`. Cross-cutting settings such as timeouts are dual combinators, not option fields. Anything with a lifecycle requires `Scope`.
13. **Immutable by default; mutable state lives in a `Ref` and is read through an `Effect`.** Entities are immutable identity plus one `SubscriptionRef` of state. Snapshots, events and errors are immutable. Nothing that can change is exposed as a plain field, so every read happens at the moment its effect runs. A plain field on a live handle or entity is a claim that it never changes, so it carries a one-line justification.
14. **Brand liberally.** Ids and meaningful strings and numbers are branded types with validating schemas (`Url`, `UrlPattern`, `HttpStatus`, `LocalPath`/`RemotePath`, `CssPixels`, …). Outputs are always branded. Tokens are accepted back only in branded or opaque form, and are checked against their origin when used. These are produced values that only mean something relative to where they came from: ids, snapshot refs, registration handles. Other inputs require the brand where meanings could be confused, and otherwise parse plain strings at the boundary.
15. **Unions of valid models; `Option` for what's truly optional.** Fields that only make sense together form a tagged union of valid shapes, so impossible states can't be built. Genuinely optional values are `Option`, never `?:`, `undefined` or `null`. Input option bags keep `?:` for "use the default", and their mutually exclusive alternatives are unions.
16. **State is watchable; events are observed.** A `Watchable` reads now, streams changes (conflated, starting from the current value) and waits level-triggered. An `Observation` is subscribed eagerly and comes in three forms: around a trigger, `.pending` (arm now, await later) and `.stream` (every match). Watching shows the present; to see events from the beginning, subscribe before their cause.
17. **No public fibers, no writable `Deferred`s or `Ref`s.** Callers own concurrency (`Effect.forkScoped`). The library exposes only read-only views of what it latches and stores.
18. **Names encode behavior.** Verbs act, `read*`/`is*`/nouns read once, `Expect.to*` retries, `events.*` observes, `on*` registers a handler, `new*` creates, `*With` configures a member, `with*` configures any effect (grammar in API.md).
19. **Every scoped acquisition returns a handle.** Never `void`: registrations have `remove` and, where useful, state such as `hits`.
20. **Every effect ends.** Waits run under the operation deadline, open-ended things are `Stream`s, and lifetime signals (`closed`) are the only exception.
21. **Every error reason carries a hint.** The rendered message says what to do next.
22. **One way to do each thing.** No aliases or parallel mechanisms. A convenience is allowed only at the dominant call site, and is documented as its expansion.
23. **Explicit over implicit.** Nothing hidden may change behavior or add waiting: no magic delays, grace periods or heuristic windows by default. Such behavior is asked for in code (an `Expect`, a `waitFor`, an observation, a named option). Helpers that make explicit behavior simpler are welcome, but they stay opt-in. Actionability waiting is the documented, adjustable contract of each action, not a heuristic.

## Cross-cutting decisions

### Access, ownership and cleanup

| Resource | Access | Release policy | Cleanup group |
|---|---|---|---|
| Launched browser | control | close the process | the `Browser` layer |
| Context or page created by the library | control | close / remove | the `Scope` it was acquired in |
| Popup of an owned page | control | close | the `Scope` that observed it; otherwise the opener's |
| Attached browser | — | disconnect only | the `Browser` layer |
| Discovered page or the default context | observe; upgrade with `inspect` or `control` (scoped) | leave open | none; the access upgrade is released with its `Scope` |
| Popup of a leave-open page | observe | leave open | none |

- **Access is typed.** `ObservedPage` exposes state and events only. `ReadonlyPage` adds isolated-world reads, locators, snapshots and screenshots. `Page` adds input, navigation, main-world evaluation and declarations. Calling a control method on an inspected page is a compile error.
- **Wider effects need wider access.** A declaration whose physical effect is wider than its target, such as a browser-global intercept on BiDi, needs explicit wider access. Without it the call fails with `NotPermitted`.

### One deadline per operation

Each user-visible operation has one monotonic deadline covering everything it does: queueing for input, setting up observation, resolving the locator, actionability, dispatch and the postcondition. Nested calls inherit the remaining budget and can only shorten it. Cleanup gets its own bounded budget. Library deadlines run on a live clock even inside `TestClock` tests. Defaults come from a `Context.Reference`, and every option accepts `Duration.Input`.

### Errors

| Family | Tag | Meaning |
|---|---|---|
| Lifetime | `TargetGone{target, reason}` | Something the operation needed ended. `reason` is a `CloseReason`: page closed, frame detached, document replaced, connection lost, and so on |
| Deadline | `Timeout{operation, phase}` | `phase` is `resolving \| waitingForCondition \| dispatchedUnconfirmed \| postcondition` |
| Domain | one per verb family: `ActionError`, `NavigationError`, `EvaluationError`, `ResponseError`, `ExpectationFailed`, `RouteError`, `DeclarationError`, … | `reason` covers invalid input, `StrictViolation`, `NotPermitted{required}`, `Unsupported{capability}` and `BackendFailure` |

- **Evidence.** Every failure carries the same diagnostic envelope: operation id, dispatch state (`NotSent | MayHaveBeenSent | Acknowledged`), per-step progress, the last observation and cleanup notes. A caller asking "did my click happen?" reads the evidence. Nothing is retried automatically once a mutation may have reached the page.
- **Two different "can't" reasons.** `NotPermitted` means "you haven't granted the access this needs", and the fix is a different call. `Unsupported` means "this backend cannot do it", and the fix is a different backend. Both are reasons inside the verb's own error, so they never add tags. `BrowserError.isUnsupported(e)` and `isNotPermitted(e)` work across verb families.
- **Defects are bugs only.** Defects are reserved for programming and invariant failures. External backend failures stay typed, and caller-supplied error and requirement types pass through every combinator unchanged.

### Diagnostics and secrets

- **Redaction.** Secret inputs accept `Redacted`. Credential, cookie and typed-text fields are classified as sensitive even when passed as plain strings. Classified fields are never rendered in spans, logs, errors or snapshots.
- **Presets.** Diagnostics come in two presets, set through a `Context.Reference`:
  - `local`: paths and titles included; query, fragment, userinfo and classified fields stripped.
  - `strict`: origins only and no titles, for production, exported traces and agents.

  `strict` is the default, and `BrowserTest` layers select `local`.
- **Raw content.** Bodies, console output, DOM snapshots and screenshots can contain secrets the page echoed. They need an explicit capture policy before leaving the process. There is no claim of taint tracking.

### Observability

- **Spans.** Every public operation is an `Effect.fn` span. Attempts, readiness observations and automatically resolved dialogs become span events, which is Playwright's call log as structured data. Protocol commands are debug-level child spans.
- **Wording.** "No matching event observed" is never reported as "the action had no effect".

## Guarantees at a glance

| Area | Guaranteed | Given a capability | Best-effort | Unknown until probed |
|---|---|---|---|---|
| Identity | Library ids stable within a connection across process swaps; explicit refs never silently rebind | — | Correlating a restored back/forward-cache document with its earlier epoch | Backend id continuity (probes 2, 3) |
| Lifetimes | Typed end reason for every lifetime; destruction only of owned resources; interruption stays interruption | Prompt notice of remote ends | — | Detach events for orphaned frames (probe 8) |
| Access | Typed access levels; wider physical effects need wider access | Scoped pause-on-start (PROTOCOL.md) | — | Pause granularity per backend (probe 22) |
| Navigation | Outcomes only with evidence, otherwise `Timeout{phase: postcondition}` | Back/forward-cache `Restored`, prerender `Activated` | Detecting browsing-context-group switches | Missing terminal events (probe 4) |
| Declarations | Acknowledged or failed; requested timing met or `Unsupported`; fixed composition rules | Before-author-script timing | Restoring external state | Popup inheritance (probe 18) |
| Obligations | One decision; fallback only while pending; no contradictory second decision | Acknowledged remote resolution | — | Behavior on connection loss (probe 19) |
| Input | Serialized per page; bounded release of held input on interruption | Trusted input; evaluation with user activation | Release after transport loss | — |
| Readiness | Every predicate yields `Ready` or `NotReady{reason}` within the deadline | Rendering-based predicates | Network-idle attribution | Stable-frame cadence (probe 10) |
| Errors | Small typed families with evidence; caller `E`/`R` preserved | — | — | — |
| Secrets | Wrapped and classified fields never rendered; explicit export | — | Capture-policy sanitization | — |

## Status

- **Revision 5.18** settled testing:
  - Vitest ships first, with runner specifics behind one per-test service (`TestRun`), so that moving to Sebastian Lorenz's `@effect/test` later is a new adapter;
  - traces open in Playwright's trace viewer, and HAR recording and replay are explicit, with `update` removed;
  - `Expect` re-checks on change signals plus a fixed interval, with no backoff;
  - launch profiles and focus emulation are visible values;
  - parallelism defaults to a browser per file and a fresh context per test.
- **Revision 5.17** adopted declarative error matchers:
  - a per-backend table, cited to evidence (probe 24), classifies every error reply into L0's fixed set of tags;
  - `Rejected` gains a normalized `RejectReason`, so L1 never matches message text;
  - unmatched replies are `Rejected{Unrecognized}`, and the drift test catches reworded errors.
- **Revision 5.16** settled the codegen route, after Alchemy's distilled and Effect's OpenAPI generator:
  - our own emitter over a committed, name-keyed protocol model;
  - corrections are JSON patches that cite evidence, fail when stale and are audited on each browser roll; our own annotations live in a separate overlay;
  - a coverage report, hand-emitted interfaces with cast codecs, and sensitive members as `Redacted`.
- **Revision 5.15** settled protocol questions:
  - the pipe transport uses Effect's `ChildProcess`, with an explicit WebSocket fallback;
  - the validation policy is uniform, with explicit `trust` and AOT;
  - we ship our own fail-fast socket now and propose the fixes upstream.
- **Revision 5.14** closed the native-model questions:
  - `inspect` may create isolated worlds but never scrolls, focuses or dispatches input;
  - stable-frame counts are per-backend defaults, shown in spans and errors and overridable per call;
  - `PartitionKey` is a union with an opaque vendor part;
  - context clocks use ordered broadcast with no cross-page synchronization.
- **Revision 5.13** closed the API open questions: the fake browser is internal first, with a narrow public subpath later and no DOM emulation; there is no runner plugin. Testing will be discussed further.
- **Revision 5.12** settled snapshots:
  - a structured `Snapshot` tree with a Playwright-style text rendering;
  - `ariaSnapshot` (pure accessibility tree) vs `snapshot`, which adds inferred interactivity and names for inaccessible sites, every inference tagged with its evidence;
  - same node, same ref;
  - explicit diffs and explicit size limits.
- **Revision 5.11** adopted rule 23, explicit over implicit:
  - ambiguity fails immediately, with a visibility hint, and has no retry window;
  - the dialog policy is an explicit context option that decides with no grace period.
- **Revision 5.10** settled module layout:
  - one package `effect-browser` with subpath exports and a single version;
  - backends are imports (`effect-browser/chromium`, `/firefox`, `/webkit`, `/bidi`) that provide the `Browser` service;
  - plus `/test`, `/ai` and raw `/cdp`.
- **Revision 5.9** settled the details of the access types:
  - popups of inspected or observed pages are `ObservedPage`s;
  - contexts have two levels (`ObservedContext`, `BrowserContext`), and reading storage needs control;
  - there are no type guards for narrowing access;
  - events are typed per access level.
- **Revision 5.8** adopted rules 18–22. Registrations now return handles (`Registration`, `RouteRegistration` with `hits`, `HandlerRegistration`), error reasons carry hints, and the API has a naming grammar.
- **Revision 5.7** split state from events:
  - `Watchable` for state: page status, URL, frames, download progress, page lists, capabilities.
  - `Observation` under `page.events.*` for events, in three forms: around a trigger, `.pending` and `.stream`.
  - This replaces the free-floating `Observe.*` combinators, which never said what they observed, and the lazily subscribed `page.events` streams, which could race their cause.
  - It also adds the no-public-fibers and no-writable-`Deferred` rules, informed by RxJS's hot/cold and subject lessons.
  - The names `Watchable` and `Observation` are settled.
- **Revision 5.6** replaced optional fields with unions of valid models:
  - `Ownership` (left open, or owned with a release and a scope);
  - `PageModel | FrameModel` (only frames have parents);
  - `WindowRealmModel | WorkerRealmModel` (only window realms belong to a tab);
  - a document's `createdBy`;
  - a request's `initiator`;
  - obligation and operation states that carry their data;
  - public `Navigation`, `Dialog` (each kind offers only its valid decisions) and `ActionReport.dom`.

  Route bodies and screenshot areas became input unions.
- **Revision 5.5** made branding a rule: per-kind id brands, value brands for URLs, patterns, statuses, headers, paths, pixels, locales and agent refs. File inputs are now `File.local`/`File.remote`/`File.bytes`, so local and remote paths can't be confused.
- **Revision 5.4** required plain fields to be fixed and to say why. Auditing with that rule moved three identity fields into state: a document's and a window realm's navigable (prerender activation), `isInitialAboutBlank` (`document.open()`), and a navigation's kind, now `initiatedAs`, with interception visible in the outcome. It also added `PrerenderActivated` as a close reason.
- **Revision 5.3** made immutability the default: model entities are identity plus one `SubscriptionRef` of state, and mutable values (`url`, `title`, `capabilities`, page lists, held access) are read through `Effect`s. An upgraded handle whose scope has closed fails with `AccessReleased`.
- **Revision 5.2** adopted the API conventions: anything that doesn't have to be a function is a value (an `Effect`, or a plain property for pure derivations). A member whose parameters are all optional becomes a default value plus `xWith(options)`. Timeouts and diagnostics move out of option bags into dual combinators (`Browser.withTimeout`).
- **Revision 5.1** settled two decisions: every acquisition with a lifecycle requires `Scope` (contexts, pages, access upgrades, popups, downloads, handles, capability handles, declarations), which removed `withPage`/`withContext`; and `BrowserContext` is the context's name.
- **Revision 5** restructured the design into balanced layers and folded in [review 4](reviews/04-draft-4.md):
  - finding 1, pause-on-start granularity: PROTOCOL.md, probe 22;
  - finding 2, `Inspect` access: this file, API.md, CONCEPTS.md;
  - finding 3, `NotPermitted` vs `Unsupported` as reasons: Errors above;
  - finding 4, page time as one timeline per scope: CONCEPTS.md, API.md;
  - finding 5, dependencies only on equal-or-broader scope: CONCEPTS.md;
  - finding 6, stable ambiguity fails early: API.md (superseded in 5.11: ambiguity fails immediately);
  - finding 7, dual `Observe` combinators that return both values: API.md;
  - finding 8, diagnostic presets: Diagnostics above;
  - the smaller items: CONCEPTS.md.
- **Next:** a consistency review (draft 5) of revisions 5.1–5.18, then L0: the codegen pipeline, the transports and the conformance probes (PROBES.md) against Chrome and Firefox. Compiling the API sketches against stub types is an optional cheap check of the error-channel and `E`/`R` claims.
