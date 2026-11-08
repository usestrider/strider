# Design

The layers, principles and cross-cutting decisions behind Strider, and what it guarantees. [API.md](../API.md),
[CONCEPTS.md](../CONCEPTS.md) and [PROTOCOL.md](../PROTOCOL.md) go through each layer; [decisions.md](decisions.md) says
why, with the alternatives rejected.

```
L2  API       Browser · UserContext · Page · Locator · Expect · Watchable · event modules · Route · PageClock · Trace · Har · BrowserToolkit · TestRun · CurrentSession
L1  Model     ids · navigables · documents · realms · navigations · requests · obligations · declarations · readiness
L0  Protocol  transports · sessions · generated commands and events · ingestion · backend adapters · capabilities
```

Each layer uses only the one below it. L2 never sees protocol ids; L1 never sees call-site conveniences; L0 never decides policy.

## Principles

1. **Spec identity, not protocol identity.** The public model is keyed by navigable, document, realm, navigation and request, with ids minted by the library. Protocol ids (CDP targets, sessions, execution contexts) change on process swaps and stay inside the adapters.
2. **Lifetimes are scopes with typed end reasons.** Three separate decisions govern every remote resource: how much we may do to it (access), whether we may destroy it (release policy), and which scope cleans it up (cleanup group). Anything with a lifecycle is acquired into a `Scope`.
3. **Interruption stops waiting; it never pretends to cancel.** No protocol can cancel an in-flight command. Interrupting abandons the reply and runs compensations (release held input, resolve paused requests). Whether a mutation reached the browser is recorded as evidence.
4. **State is folded before it is published.** Events update the model in order before anyone observes them. Losing integrity (overload, an undecodable lifecycle event) is an explicit failure, never a silent drop.
5. **Waits look forward; reads look back.** A wait sees only what happens after it starts, so to catch what an action causes, start waiting before the action. What already happened is a separate read of a bounded log, never mixed into a wait. A wait that started too late says so in its timeout.
6. **Obligations get exactly one decision.** Paused requests, dialogs and file choosers get one locally selected decision, a default when handlers fail, and tracked remote acknowledgement.
7. **Capabilities belong to instances.** A missing capability is a typed `Unsupported` reason or a missing method, never a silent no-op.
8. **Protocol features are demand-driven.** Domains and subscriptions are reference-counted (an `RcMap`), so a configuration that never enables `Runtime` remains possible.
9. **Declarations are acknowledged, timed and composed by fixed rules.** Init scripts, routes, overrides and clocks state the timing they need and fail rather than degrade. One precedence rule orders settings and handlers, and an ordered bundle orders scripts.
10. **Small error channels, rich evidence.** An ordinary call fails with `TargetGone`, `Timeout` or its module's error. Detail lives in a `reason`, a class with its own fields, and a shared diagnostic envelope.
11. **Secrets are protected in diagnostics, and export is explicit.** `Redacted` goes in, classified fields come out wrapped, and secret-bearing exports are deliberate operations.
12. **If it doesn't have to be a function, it's a value.** A member with nothing to configure is a value: an `Effect` for operations (`page.title`, `tab.inspect`, `context.newPage`) or a property for pure derivations (`locator.first`). Settings are a trailing `options` parameter, as in Effect's own modules, so actions are calls (`button.click()`, `button.click({ button: "right" })`). Cross-cutting settings such as deadlines are dual combinators, not option fields. Anything with a lifecycle requires `Scope`.
13. **Immutable by default; mutable state lives in a `Ref` and is read through an `Effect`.** Entities are immutable identity plus one `SubscriptionRef` of state. Snapshots, events and errors are immutable. Nothing that can change is exposed as a plain field, so every read happens at the moment its effect runs. A plain field on a live handle or entity is a claim that it never changes, so it carries a one-line justification.
14. **Brand liberally.** Ids and meaningful strings and numbers are branded types with validating schemas, each in the module that owns it (`Url.Url`, `Url.Pattern`, `NetworkResponse.StatusCode`, `FilePath.Local`/`FilePath.Remote`, `Pixels.Css`, `Download.Id`, …). Outputs are always branded. Tokens are accepted back only in branded or opaque form, and are checked against their origin when used. These are produced values that only mean something relative to where they came from: ids, snapshot refs, registration handles. Other inputs require the brand where meanings could be confused, and otherwise parse plain strings at the boundary.
15. **Unions of valid models; `Option` for what's truly optional.** Fields that only make sense together form a tagged union of valid shapes, so impossible states can't be built. Genuinely optional values are `Option`, never `?:`, `undefined` or `null`. Input option bags keep `?:` for "use the default", written `?: T | undefined` as Effect writes it, and their mutually exclusive alternatives are unions.
16. **State is watchable; each event type is a module.** A `Watchable` reads now, streams changes (conflated, starting from the current value) and waits level-triggered. An event module (`Popup`, `Download`, `NetworkResponse`, …) has three verbs: `next` (subscribe now, await the first match later) and `stream` (every match from now on) subscribe eagerly; `history` reads a bounded log and never waits. Events report and handlers decide, and seeing an event acquires nothing.
17. **No public fibers, no writable `Deferred`s or `Ref`s.** Callers own concurrency (`Effect.forkScoped`). The library exposes only read-only views of what it latches and stores.
18. **Names encode behavior.** Verbs act, `read*`/`is*`/nouns read once, `Expect.to*` retries, `next`/`stream` subscribe to events, `handle` registers a deciding handler, `new*` creates, `*With(f)` takes a function, `with*` configures any effect, `layer*` provides a service (grammar in API.md).
19. **Every scoped acquisition returns a handle.** Never `void`: registrations have `remove` and, where useful, state such as `hits`.
20. **Every effect ends.** Waits run under the operation deadline, open-ended things are `Stream`s, and lifetime signals (`closed`) are the only exception.
21. **Every error reason carries a hint.** The rendered message says what to do next.
22. **One way to do each thing.** No aliases or parallel mechanisms. A convenience is allowed only at the dominant call site, and is documented as its expansion.
23. **Explicit over implicit.** Nothing hidden may change behavior or add waiting: no magic delays, grace periods or heuristic windows by default. Such behavior is asked for in code (an `Expect`, a `waitFor`, a `next`, a named option). Helpers that make explicit behavior simpler are welcome, but they stay opt-in. Every default is stated where it is declared and recorded in the operation's span, and no helper changes a default on your behalf. Actionability waiting is the documented, adjustable contract of each action, not a heuristic.

## Cross-cutting decisions

### Access, ownership and cleanup

| Resource | Access | Release policy | Cleanup group |
|---|---|---|---|
| Launched browser | control | close the process, then delete its temporary profile | the `Browser` layer |
| Context or page created by the library | control | close / remove | the `Scope` it was acquired in |
| Popup of an owned page | control | close | the `Scope` that acquired its opener |
| Attached browser | — | disconnect only | the `Browser` layer |
| Discovered page or the default context | observe; upgrade with `inspect` or `control` (scoped) | leave open | none; the access upgrade is released with its `Scope` |
| Popup of a leave-open page | observe | leave open | none |

- **Access is typed.** `ObservedPage` exposes state and events only. `ReadonlyPage` adds isolated-world reads, locators, snapshots and screenshots. `Page` adds input, navigation, main-world evaluation and declarations. Calling a control method on an inspected page is a compile error.
- **Wider effects need wider access.** A declaration whose physical effect is wider than its target, such as a browser-global intercept on BiDi, needs explicit wider access. Without it the call fails with `NotPermitted`.

### One deadline per operation

Each user-visible operation has one monotonic deadline covering everything it does: queueing for input, setting up observation, resolving the locator, actionability, dispatch and the postcondition. Every command it sends the browser waits for its reply until that deadline, a cookie read or a declaration as much as a click. An explicit `Deadline.within` encloses everything inside it, and nested calls can only shorten it; an operation with no enclosing deadline gets the default budget (30 seconds, `Deadline.withDefaultBudget`). Cleanup gets its own bounded budget. Deadlines run on the clock the browser runs on: a real browser's live clock even inside `TestClock` tests, and Effect's clock for `Browser.layerTest`, whose timeline runs on it, and every option accepts `Duration.Input`.

An operation started inside another is a step of it, and a `Timeout` that leaves an operation is the operation's own,
in the phase of the step that ran out, with its steps as evidence. A program's own helpers are operations the same
way, through `Operation.fn` and `Operation.named`: one deadline for the helper, a span named for it, and a `Timeout`
that says how far it got.

### Errors

| Family | Tag | Meaning |
|---|---|---|
| Lifetime | `TargetGone{target, reason}` | Something the operation needed ended. `reason` is a `CloseReason`: page closed, frame detached, document replaced, connection lost, and so on |
| Deadline | `Timeout{operation, phase}` | `phase` is `resolving \| waitingForCondition \| dispatchedUnconfirmed \| postcondition \| waitingForEvent` |
| Module | one per module: `LocatorError`, `PageError`, `DownloadError`, `DeclarationError`, `SubscriptionError`, `ResponseError`, `ExpectationFailed`, … | `reason` is a class: the module's own (`StrictViolation`, `NavigationFailed`) or one shared from `Reason` (`InvalidInput`, `NotPermitted{required}`, `Unsupported{capability}`, `BackendFailure`) |

- **Evidence.** Every failure carries the same diagnostic envelope: operation id, dispatch state (`NotSent | MayHaveBeenSent | Acknowledged`), per-step progress, the last observation and cleanup notes. A caller asking "did my click happen?" reads the evidence. Nothing is retried automatically once a mutation may have reached the page.
- **Two different "can't" reasons.** `NotPermitted` means "you haven't granted the access this needs", and the fix is a different call. `Unsupported` means "this backend cannot do it", and the fix is a different backend. Both are `Reason` classes that every module's error can carry, so they never add tags, and one check works across modules: `Effect.catchReason(tag, "Unsupported", …)` for any module's tag.
- **Defects are bugs only.** Defects are reserved for programming and invariant failures. External backend failures stay typed, and caller-supplied error and requirement types pass through every combinator unchanged.

### Diagnostics and secrets

- **Redaction.** Secret inputs accept `Redacted`, and sketches read them with `Config.Redacted`. Credential, cookie and typed-text fields are classified as sensitive even when passed as plain strings. Classified fields are never rendered in spans, logs, errors or snapshots. A URL in a span attribute is rendered under the preset when the span opens, and requests and responses implement Effect's `Redactable`, so Effect's own logging and inspection show their URLs under the preset in the current fiber's context, in user code too; encoded as data, they keep them whole.
- **Presets.** Diagnostics come in two presets, set through a `Context.Reference`:
  - `local`: URLs whole, and titles; classified fields stripped.
  - `strict`: a URL's origin and path, each query value `REDACTED`, with no fragment or user info, and no titles; for production, exported traces and agents.

  `strict` is the default everywhere, tests included; `Diagnostics.withPreset("local")` selects the other.
- **Raw content.** Bodies, console output, DOM snapshots and screenshots can contain secrets the page echoed. They need an explicit capture policy before leaving the process. There is no claim of taint tracking.

### Observability

- **Spans.** Every user-visible operation opens one span, as Effect's `HttpClient` opens one per request, named like `Locator.click` with attributes in OpenTelemetry's style (`browser.operation`, `browser.page.id`, a redacted `url.full`, `error.type`). Attempts, readiness observations and automatically resolved dialogs become span events, so each operation carries its step-by-step log as structured data. Everything beneath an operation is `Effect.fnUntraced`, and protocol commands get child spans only when `Browser.TraceProtocolCommands` is on, because they are a hot path. `Browser.SpanNameGenerator` and `Browser.TracerDisabledWhen` rename or suppress spans. `effect/observability` exports them over OTLP, and `effect/devtools` shows them live.
- **Metrics.** `Metric`s count operations by verb and outcome, actionability attempts per action, `Timeout`s by phase, `EventOverflow`s, protocol commands by method and latency, and obligations decided by policy. They export through `effect/observability` (OTLP or Prometheus).
- **Wording.** "No matching event observed" is never reported as "the action had no effect".

## Guarantees at a glance

| Area | Guaranteed | Given a capability | Best-effort | Depends on the browser |
|---|---|---|---|---|
| Identity | Library ids stable within a connection across process swaps; explicit refs never silently rebind | — | Correlating a restored back/forward-cache document with its earlier epoch | Backend id continuity |
| Lifetimes | Typed end reason for every lifetime; destruction only of owned resources; interruption stays interruption | Prompt notice of remote ends | — | Detach events for orphaned frames |
| Access | Typed access levels; wider physical effects need wider access | Scoped pause-on-start (PROTOCOL.md) | — | Pause granularity per backend |
| Navigation | Outcomes only with evidence, otherwise `Timeout{phase: postcondition}` | Back/forward-cache `Restored`; prerender activation is not implemented | Detecting browsing-context-group switches | Missing terminal events |
| Declarations | Acknowledged or failed; requested timing met or `Unsupported`; fixed composition rules | Before-author-script timing | Restoring external state | Popup inheritance |
| Obligations | One decision; fallback only while pending; no contradictory second decision | Acknowledged remote resolution | — | Behavior on connection loss |
| Input | Serialized per page; bounded release of held input on interruption | Trusted input; evaluation with user activation | Release after transport loss | — |
| Readiness | Every predicate yields `Ready` or `NotReady{reason}` within the deadline | Rendering-based predicates | — | Stable-frame cadence |
| Errors | Small typed families with evidence; caller `E`/`R` preserved | — | — | — |
| Secrets | Wrapped and classified fields never rendered; explicit export | — | Capture-policy sanitization | — |

## Status

Built through all three layers on Chromium (CDP), Firefox (WebDriver BiDi) and stock WebKit (WebKitGTK and WPE, launched through their MiniBrowser or attached through their remote inspector). What a backend can't do is in its capability table; what isn't built is marked in the layer documents.

- **The packages:** `@usestrider/browser`, with the agent toolkit; `@usestrider/cli`, the `strider` command to install globally; and `@usestrider/vitest`. None is published yet. All are under the MIT license ([LICENSE](../LICENSE)); `@usestrider/browser`'s generated protocol modules and keyboard layouts also carry their sources' notices ([THIRD_PARTY_NOTICES.md](../packages/browser/THIRD_PARTY_NOTICES.md)). `pnpm pack-check` checks what would be published.
- **Tests:** `pnpm all` runs the checks that need no browser. `pnpm test:integration` runs the adapter conformance suite and the slices in the Nix environment (`flake.nix`), against Chromium 155.0.8059.79, Firefox 158.0 and WebKitGTK 2.54.1. CI runs `pnpm all`, the build and the package check on every pull request and every push to `main`, and the integration tests every night, or on demand.
- **Compared with Playwright:** `pnpm scenarios` runs the same scenarios with both libraries on the same stock Chromium and writes [packages/scenarios/RESULTS.md](../packages/scenarios/RESULTS.md). `pnpm bench` measures individual operations with warmups and raw samples; `pnpm bench --check` enforces a configurable per-case median ratio ([benchmark suite](../packages/scenarios/BENCHMARKS.md)).
