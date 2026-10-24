# Strider

*Design stage, revision 5 (2026-10-18). The protocol layer is built for the CDP, BiDi and WebKit backends, and the slices run through all three layers on each: launch, open a page, navigate, click and expect; every event module, through one mechanism; every action, read and expectation, with the keyboard and the mouse; and every declaration: routes, init scripts, emulation, grants and the page clock (Status).*

The package is `@usestrider/browser` (the `usestrider` org on npm and GitHub), and the command-line tool is `strider`.

An Effect-native browser automation library that speaks browser protocols directly (CDP first, then WebDriver BiDi, then the WebKit inspector protocol). It is not a better Playwright. The aim is better browser automation, written in better TypeScript with Effect, and better for agents. Prior art, Playwright included, is evidence of what works and what breaks, never a reason on its own. Its priorities, in order:

1. **Ergonomics, for people and for agents.** Call sites read like the task; mistakes are hard to write; errors explain themselves.
2. **Correctness under concurrency and interruption.** Scoped lifetimes, typed end reasons, no hangs, no silent replays.
3. **Breadth.** Several backends behind one model, with capabilities stated per instance.
4. **Performance and stealth.** Features are enabled on demand, and stealth is an architectural option.

## Documents

Each layer document has the same shape: purpose, top data models, interface sketch, key contracts, open questions. They aim for similar depth, and none contains implementation detail. The reasoning behind each contract lives in `reviews/` and in draft 4 of the native model (commit `6cc0bc1`); these documents keep the decisions, not the debate.

| Layer | Document | What it covers |
|---|---|---|
| — | [README.md](README.md) | goals, principles, cross-cutting decisions, guarantees |
| L2 | [API.md](API.md) | the public API: entry points, pages, locators, actions, expectations, state and events, network, clock, agents, testing, errors, call sites |
| L1 | [CONCEPTS.md](CONCEPTS.md) | the native browser model: identities, data models, lifetimes, contracts |
| — | [packages/browser/](packages/browser/) | the package: the whole public API as declarations (the sketch), 48 modules plus subpaths, Effect's JSDoc contract on every declaration, type tests, runtime tests, type-checked examples and acceptance scenarios; [INDEX.md](packages/browser/INDEX.md) lists every declaration (`pnpm all`) |
| — | [packages/tools/](packages/tools/) | private tools: the vendored JSDoc checker, the example check, the API reference dataset, barrel codegen |
| — | [.agents/AGENTS.md](.agents/AGENTS.md) | instructions for agents working in this repository: layout, checks, conventions |
| — | [CLI.md](CLI.md) | the command line: named sessions, commands, files, storage and forks, export |
| L0 | [PROTOCOL.md](PROTOCOL.md) | transports, protocol clients, code generation, ingestion, backend adapters, capabilities |
| — | [PROBES.md](PROBES.md) | conformance probes, hazard coverage, deterministic model tests |
| — | [QUIRKS.md](QUIRKS.md) | weird behaviors found while building, browsers' and our own, to reconsider when the library is built |
| — | [research/](research/) | prior-art notes (historical evidence) |
| — | [reviews/](reviews/) | design reviews, one per draft |
| — | [upstream/](upstream/) | drafts of proposals for upstream projects, for the maintainer to post |

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
8. **Protocol features are demand-driven.** Domains and subscriptions are reference-counted (an `RcMap`), so a stealth configuration that never enables `Runtime` remains possible.
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

Each user-visible operation has one monotonic deadline covering everything it does: queueing for input, setting up observation, resolving the locator, actionability, dispatch and the postcondition. An explicit `Deadline.within` encloses everything inside it, and nested calls can only shorten it; an operation with no enclosing deadline gets the default budget (30 seconds, `Deadline.withDefaultBudget`). Cleanup gets its own bounded budget. Deadlines run on a live clock even inside `TestClock` tests, and every option accepts `Duration.Input`.

### Errors

| Family | Tag | Meaning |
|---|---|---|
| Lifetime | `TargetGone{target, reason}` | Something the operation needed ended. `reason` is a `CloseReason`: page closed, frame detached, document replaced, connection lost, and so on |
| Deadline | `Timeout{operation, phase}` | `phase` is `resolving \| waitingForCondition \| dispatchedUnconfirmed \| postcondition` |
| Module | one per module: `LocatorError`, `PageError`, `DownloadError`, `DeclarationError`, `SubscriptionError`, `ResponseError`, `ExpectationFailed`, … | `reason` is a class: the module's own (`StrictViolation`, `NavigationFailed`) or one shared from `Reason` (`InvalidInput`, `NotPermitted{required}`, `Unsupported{capability}`, `BackendFailure`) |

- **Evidence.** Every failure carries the same diagnostic envelope: operation id, dispatch state (`NotSent | MayHaveBeenSent | Acknowledged`), per-step progress, the last observation and cleanup notes. A caller asking "did my click happen?" reads the evidence. Nothing is retried automatically once a mutation may have reached the page.
- **Two different "can't" reasons.** `NotPermitted` means "you haven't granted the access this needs", and the fix is a different call. `Unsupported` means "this backend cannot do it", and the fix is a different backend. Both are `Reason` classes that every module's error can carry, so they never add tags, and one check works across modules: `Effect.catchReason(tag, "Unsupported", …)` for any module's tag.
- **Defects are bugs only.** Defects are reserved for programming and invariant failures. External backend failures stay typed, and caller-supplied error and requirement types pass through every combinator unchanged.

### Diagnostics and secrets

- **Redaction.** Secret inputs accept `Redacted`, and sketches read them with `Config.Redacted`. Credential, cookie and typed-text fields are classified as sensitive even when passed as plain strings. Classified fields are never rendered in spans, logs, errors or snapshots. Values whose detail depends on the preset implement Effect's `Redactable`, so Effect's own logging and tracing apply the preset, in user code too.
- **Presets.** Diagnostics come in two presets, set through a `Context.Reference`:
  - `local`: paths and titles included; query, fragment, userinfo and classified fields stripped.
  - `strict`: origins only and no titles, for production, exported traces and agents.

  `strict` is the default everywhere, tests included; `Diagnostics.withPreset("local")` selects the other.
- **Raw content.** Bodies, console output, DOM snapshots and screenshots can contain secrets the page echoed. They need an explicit capture policy before leaving the process. There is no claim of taint tracking.

### Observability

- **Spans.** Every user-visible operation opens one span, as Effect's `HttpClient` opens one per request, named like `Locator.click` with attributes in OpenTelemetry's style (`browser.operation`, `browser.page.id`, a redacted `url.full`, `error.type`). Attempts, readiness observations and automatically resolved dialogs become span events, so each operation carries its step-by-step log as structured data. Everything beneath an operation is `Effect.fnUntraced`, and protocol commands get child spans only when `Browser.TraceProtocolCommands` is on, because they are a hot path. `Browser.SpanNameGenerator` and `Browser.TracerDisabledWhen` rename or suppress spans. `effect/observability` exports them over OTLP, and `effect/devtools` shows them live.
- **Metrics.** `Metric`s count operations by verb and outcome, actionability attempts per action, `Timeout`s by phase, `EventOverflow`s, protocol commands by method and latency, and obligations decided by policy. They export through `effect/observability` (OTLP or Prometheus).
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
| Readiness | Every predicate yields `Ready` or `NotReady{reason}` within the deadline | Rendering-based predicates | — | Stable-frame cadence (probe 10) |
| Errors | Small typed families with evidence; caller `E`/`R` preserved | — | — | — |
| Secrets | Wrapped and classified fields never rendered; explicit export | — | Capture-policy sanitization | — |

## Status

- **A page's contents** (2026-10-24, [review 18](reviews/18-evaluation-frames-captures.md)). Evaluation, frames, snapshots, captures and storage now run on Chromium, Firefox and WebKit, as do call site 1, to the end, and call site 16. Functions run in an isolated world of the caller's unless the main world is asked for, with handles the scope releases. A frame is entered by its iframe on every attempt, cross-site ones included, and actions in it take the page's coordinates through each iframe on the way. A snapshot is the same accessibility tree `getByRole` matches, with interactivity inferred and tagged, refs that act until their node is gone and never rebind, a diff, and each frame's tree under its iframe; `toMatchAria` matches it, and an expectation that matched nothing now says what was nearest and which names were close. A saved storage state has the cookies, `localStorage` and IndexedDB of every origin the context had open, a cross-site frame's in its partition, and a new context starts from it signed in. Probing found that Firefox doesn't deliver page coordinates into a cross-site frame, so its input goes to the frame's own context; that only Chromium reports a cookie's partition; and that WebKit calls an unspecified `SameSite` `Lax`. Building it found that Chromium renders nothing in a cross-site frame outside the viewport, so an action scrolls each iframe into view first, and that Firefox's isolated world sees a page's IndexedDB records behind wrappers that can't be iterated, which it now reads around.
- **Declarations** (2026-10-23, [review 17](reviews/17-declarations.md)). Routes, init scripts, emulation, permission grants and the page clock now run on Chromium, Firefox and WebKit, as do call sites 6, 10 and 11. A route handles a request at one phase: before it is sent, when its response starts, or at an authentication challenge. The phase types what the handler is given and what it may decide, and a request no route decides continues, reported. Init scripts run in one order on every backend, and `after` makes one wait for another to run without throwing. An `emulate` call is one registration, and each field is a capability: Chromium can emulate everything, while Firefox lacks media, touch, JavaScript and more, and fails naming them. No backend has an application clock, so the page clock is a script of the library's, one timeline across a page's documents and frames. Probing the browsers found that only Chromium shows a route the CORS preflight; only CDP can read a response before the page sees it; Firefox's default answer to a challenge is a prompt that waits forever, headless; and WebKit's touch emulation changes nothing. Building it traced Chromium's old interception flake to the moment its interceptor is installed: a route declared on a live page could miss the page's next request. Chromium now keeps the interceptor from each page's start, and 160 runs under load missed nothing. It also found that every read after a second `goto` failed on WebKit, since its engine world is reported a moment after the document commits.
- **Interacting and asserting** (2026-10-23, [review 16](reviews/16-interaction-and-assertions.md)). Every action now runs on Chromium, Firefox and WebKit: filling every kind of field, typing and pressing keys, choosing options, checking boxes, setting files, double-clicking, hovering, tapping and dragging; so do the one-shot reads, every expectation but `toMatchAria`, and the page's keyboard and mouse. Call site 1 runs up to its storage state. Three mechanisms came with them. Each page's input state is the library's own, so a drag holds its button on every backend and a failed step never leaves Shift held down. A click's first event must land on the element the checks passed: if a toast covered it in between, the page never sees the click, and the action checks again. And an expectation waits in the page, re-checking on each change the page makes rather than on a timer. Probing all three browsers first decided the design in several places: a Chromium page in the background of its context renders nothing, so each page is now a window of its own; Firefox sent Enter as the numpad's; WebKit's pointer events ignore modifiers, and only Chromium can finish an HTML drag, which are capabilities now. Building it found that a navigation was published after `goto` returned, so a wait for the next navigation caught `goto`'s own; that a background Firefox page renders about once a second, too seldom to act on without `page.activate`; and that Chromium starts a drag only when each move names the button held.
- **`next` hands out an `Effect`** (2026-10-23, [review 15](reviews/15-next-returns-an-effect.md)). An event wait used to hand back a `ReadonlyDeferred`, the read side of Effect's `Deferred`, proposed upstream; every caller only ever awaited it. Now running `next` subscribes and its value is the wait itself, an `Effect` latched on the first match: `const popup = yield* popups`. The package's `Deferred` module is gone, and the upstream proposal is withdrawn.
- **Every event module** (2026-10-23, [review 14](reviews/14-event-modules.md)). Downloads, file choosers, console messages, uncaught exceptions, navigations, requests and responses, workers and WebSockets now run on Chromium, Firefox and WebKit, through the mechanism popups and dialogs use, as do call sites 2, 4 + 9, 5 and 8. Probing all three browsers first decided the design in several places. Left to themselves, one browser cancels downloads and two save them into the user's home, so every context the library creates now gets its own download directory, deleted with it. Firefox left a canceled file chooser open, blocking every later upload on the page, so it is now told to dismiss them. The browsers disagree on what they can see: Firefox can't tell a rejection from a throw, or say whose a service worker is, and reports a WebSocket only as its handshake; WebKit reports no shared or service workers. A filter that needs what a backend can't report now fails with `Unsupported`, and `history` checks its filter as `next` does, rather than answering an empty history. Building it found that Firefox's back navigation could go unreported under load, and that a navigation Firefox refuses at once was reported with its error page's URL.
- **Events, through popups and dialogs** (2026-10-23, [review 13](reviews/13-events-slice.md)). Call site 3 runs on Chromium, Firefox and WebKit: subscribe to the next popup, click, take the popup's `Page`, register a dialog handler in it, and click the button that asks. Every event module's `next`, `stream` and `history` now share one mechanism: the model's fold logs each event and offers it to each subscription's own buffer, so a subscription sees everything after it subscribed and nothing before, a stream that falls too far behind fails rather than losing events, and a late `next` says which event it missed. A dialog event is now data, and a handler gets the decisions; the page's latest handler decides, and the context's policy is the fallback, reported as an `AutoResolution`. Probing found that Chromium and WebKit block every evaluation while a dialog is open, so an operation on a page whose dialog nothing will decide now fails at once with `PromptBlocking`; and that the opener of a popup goes to the background, where headless Chromium renders nothing, so an action on it needs `page.activate`, which its timeout now says. Building it found that a popup's URL, arriving after it, reached subscriptions made later.
- **The first slice, through all three layers** (2026-10-22, [review 12](reviews/12-l1-first-slice.md)). The README's program runs on Chromium, Firefox and WebKit: each backend's layer launches the browser, and `Browser.newPage`, `goto`, `getByRole(…).click()` and `Expect.toBeVisible` run through L1's model, a fold of the adapter's facts. Locators resolve through one engine of ours, in each document's utility world, so a query means the same in every browser: text is text content, not `innerText`, and roles and names follow HTML-AAM and accname 1.2. A click checks at each animation frame, in the page, takes the page's input permit, checks again and dispatches once, and a timeout says what stood in the way: "Another element covers the element's action point: div.toast "Saved"". The members not built yet fail as `NotBuilt`, naming themselves (PROTOCOL.md lists what is built). The slice found that Chromium's error pages were reported as navigations of their own, which superseded the next `goto`, and that the package's root entry point didn't load in Node.
- **A launch takes an executable path, and `strider browsers` finds them** (2026-10-20, [review 11](reviews/11-executable-paths.md)). Channels were fixed tables of install paths, which NixOS, Snap, Flatpak and the open-source Chromium never match, and in which Firefox's beta shared stable's paths. They are gone: a launch takes an absolute `executablePath`, and nothing else. Finding one is now something a person or an agent asks for: `strider browsers`, the first CLI command built, lists the browsers on the machine with their versions and where each path leads, and checks Playwright's WebKit builds against the adapter's.
- **A launch names its browser** (2026-10-20, [review 10](reviews/10-named-browsers.md)). The library never downloads or installs a browser, so Chrome for Testing is no longer a default to be fetched, and there is no default: a launch takes exactly one of `executablePath` and `channel`, and the type rejects naming neither or both. Each backend states its channels: Chrome's and Firefox's `stable`, `beta` and `canary`, and WebKit's `playwright`, Playwright's browser cache, which the launcher no longer searches unless it is named.
- **Pinned test browsers, on a fixed machine** (2026-10-20). The browser integration tests run only in a Nix environment (`pnpm test:integration`, `flake.nix`) that fixes what they see: Chromium 155.0.8059.79, Firefox 158.0 and Playwright's WebKit 2359 from a locked nixpkgs that asserts those versions, fixed fonts, UTC, `C.UTF-8`, an empty home and nothing of the host's environment. Anywhere else they fail and say how to run them, and a browser of another version fails them. The standard tests and checks run anywhere (PROTOCOL.md, Tests and pinned browsers).
- **Who served a response** (2026-10-20, [review 09](reviews/09-served-by.md)). `servedBy` moved from the request to the response, because every browser says what answered a request with its response: `network`, `cache`, `serviceWorker`, `route`, or `cacheOrServiceWorker` where Firefox can't tell a cache from a worker, which a capability says. Building it found that no service worker had ever started under the CDP adapter (attached twice, and waited for before it could answer), that WebKit's intercepts don't see the requests of a page a service worker controls, and that a request WebKit answers from its memory cache was dropped.
- **The protocol layer, finished** (2026-10-20) for CDP, BiDi and patched WebKit, with what remains listed in PROTOCOL.md (Backend adapters, Not built). The drift test is whole: traffic recorded from each browser is committed and replayed through the generated codecs and the error tables without a browser, and its first replay found deprecated events Chromium still sends. A correction audit lists the corrections a rolled spec has absorbed. A new conformance test of reloads and history failed on two backends at first: Chromium and Firefox restore pages from the back/forward cache, Chromium under the restored document's old loader id and Firefox with no commit at all, and both are now reported as restores.
- **The WebKit backend** (2026-10-20), for Playwright's WebKit build, the third engine at L0 (PROTOCOL.md, Code generation and Backend adapters). Its `protocol.json` is CDP's format, so CDP's parser reads it in WebKit's dialect, and 33 modules are emitted at `@usestrider/browser/webkit-protocol`. A page there is a page proxy whose process a cross-site navigation replaces with a new target and a new frame id; the adapter follows it as one navigable, pauses every new target until its declarations are in, and evaluates through a helper in each realm because WebKit serializes only JSON. It passes the conformance suite, as the CDP and BiDi adapters do, and the launcher refuses a build whose protocol isn't the one generated from. Probing found two commands that abort the browser instead of failing, which the adapter never sends, languages that reach only new processes, and a viewport that is a resize with nothing to clear. The attach-only stock profile isn't built: it needs stock WebKit's own protocol and an endpoint to record against.
- **The BiDi backend** (2026-10-20), for Firefox and any WebDriver BiDi endpoint (PROTOCOL.md, Code generation and Backend adapters). The spec's CDDL, and the Permissions spec's, are parsed into the same protocol model as CDP's and emitted at `@usestrider/browser/bidi-protocol`; Firefox 158 needed two corrections, each citing the recorded event. The BiDi adapter needs no pausing, because BiDi scopes declarations natively, and passes the same conformance suite as the CDP adapter. What Firefox lacks fails as `Unsupported`, never silently. Probing it found realms created before their commit, orphaned frames reported, and user activation that lasts only for the call.
- **The CDP backend adapter** (2026-10-20), after [review 08](reviews/08-l0-adapters.md) (PROTOCOL.md, Backend adapters). Probes against Chromium 155 settled what the specs leave open (PROBES.md, Results): popups can be paused before their scripts only browser-wide, and a paused popup blocks its opener; a realm is created after its document commits, and the initial `about:blank` realm lives on into the first same-origin document; orphaned frames get no detach. The adapter folds CDP into protocol-neutral facts in L1's ids, configures every target while it is paused, and carries out every operation L1 needs. A conformance suite written once against the adapter contract passes against Chromium, and will run against every backend.
- **The rest of the protocol client** (2026-10-20), for every backend (PROTOCOL.md, Protocol client and Ingestion pipeline). Commands wait at most `Protocol.CommandTimeout` (30 seconds unless set) and then fail with `NoReply`. A late reply to a command that creates a resource goes to a handler, which by default releases it with the command the overlay names (`closeTarget`, `releaseObject`, `IO.close`, …). `"trust"` validation skips codecs that only check and keeps those that transform, so a secret never arrives unwrapped. Events now go through one worker that folds them into an adapter's model before publishing, into bounded subscriber buffers: lossless ones fail with `EventOverflow`, sliding ones mark drops with a `Gap`, and declarative prefilters run first. A session whose events can't be followed resyncs from a snapshot or ends with `modelUnavailable`, and `drainObserved` waits for what has been received so far.
- **Transports and the CDP client** (2026-10-19), the second L0 piece (PROTOCOL.md, Transports and Protocol client). `Transport.pipe` and `Transport.webSocket` fail fast and never reconnect. `CdpConnection` runs one reader that routes replies to their commands and events to their sessions, and a session ends with its target, its parent or the connection, failing whatever waits on it. Generated commands now run against a real browser: `yield* Page.navigate({ url }).pipe(Protocol.on(page))`. Error replies are classified by a six-row table recorded against Chromium 155, which an integration test re-checks against the browser. Probing found that Node's built-in WebSocket closes on messages over 128 MiB, and that a message too long for a JavaScript string killed the reader and left its command waiting; it now loses the connection and says why. We won't ship a `ws` constructor of our own; the 128 MiB limit stands until Effect's Node constructor passes `ws` options through, which we'll propose upstream.
- **CDP code generation** (2026-10-19), the first L0 piece (PROTOCOL.md, Code generation): the vendored Chrome 155 protocol is parsed into a committed, name-keyed model, annotated by an overlay (id brands, sensitive members, sessions, compensation, resources) and emitted as 56 modules at `@usestrider/browser/cdp`, with a coverage report. They target the hand-written `Protocol` module at `@usestrider/browser/protocol`. Tests cover the generator once and decode real payloads through the generated codecs.
- **A workspace** (2026-10-19). The sketch became the package, `packages/browser`, in a pnpm workspace set up as Effect's is: TypeScript 7 patched with Effect's language service, oxlint and dprint, Vitest with `@effect/vitest`, Tstyche, changesets, and private tools in `packages/tools` (Effect's JSDoc checker, vendored; the reference generators; barrel codegen). Agent instructions live in `.agents/AGENTS.md`, and the package ships its own `AGENTS.md` and `INDEX.md` for agents in users' projects. The first runtime test caught that Effect's default JSON encoding writes a `Redacted` as `"<redacted>"`, so `StorageState.Json` is now built with `Schema.toCodecJson`.
- **Named Strider** (2026-10-19). `effect-browser` was a working name, and its npm name belongs to another project. The package is `@usestrider/browser`, TypeIds and brand keys start `~@usestrider/browser/`, and the CLI command `eb` became `strider` (`STRIDER_SESSION`). `reviews/` and `research/` keep the old name, as records of their time.
- **Revision 5.25** adopted the Effect core team's own conventions ([review 7](reviews/07-effect-conventions.md)), so the library reads as if they wrote it, and generates its API reference as effect.website does:
  - modules are namespaces from a generated barrel (`Page.Page`, `Download.Download`), with short names inside (`UserContext.Options`, `CookieJar.Input`); brands are Schemas in the modules that own them;
  - settings are a trailing `options?`, so actions are calls (`button.click()`), and `*With` takes a function. This reverses 5.2's `xWith(options)`. Principle 22 then removed two duplicates the change exposed: `ariaSnapshot` is `snapshot({ sources: "aria" })`, and a snapshot's `root` option is `locator.snapshot()`;
  - layers are named `layer…` (`Chromium.layer()`, `layerConfig`, `layerConnect`, `WebKit.layerAttach`); `Browser.newPage()` and `newContext()` are accessors, which replace `BrowserTest.page` (reversing 5.18 and 5.21); the fake browser is public, as `Browser.layerTest(timeline)` (experimental);
  - data that crosses a boundary is Schema: data events, states, cookies, snapshot trees, diagnostics, errors, and storage state, whose `Json` codec replaces `StorageState.import`;
  - one error per module, with `Schema.Error` reason classes and the shared ones in `Reason`, replaces principle 10's verb families; `Target.TargetGone` and `Deadline.Timeout` cross every module; backends add error detail by augmentation;
  - one span per operation with internals untraced, string TypeIds with kind guards, `Pipeable` and `Inspectable` handles, and `?: T | undefined`;
  - Effect's JSDoc contract on all 536 declarations, enforced by `effect-jsdocs --check` run from an Effect checkout; 48 examples type-checked, ready for `@effect/doctest`; Tstyche type tests replace `@ts-expect-error`; `Effect.fn` call sites, enforced by the language service as Effect enforces them;
  - `npm run api-reference` writes TypeDoc JSON per module with a manifest, the dataset effect.website renders Effect's reference from, for any site to render.
- **Revision 5.24** folded in the type-checked sketch (now [packages/browser/](packages/browser/)), which is now the source of truth for signatures; API.md keeps the contracts:
  - type-checking changed two designs: an event predicate (`where`) is a trailing argument, so it is typed from the filter's body decoder, and body decoders take Effect's decoders as they are;
  - existing decisions corrected: viewport, locale and timezone moved into `Emulation` (one type for creation options and `emulate`); `ReadonlyFrame` became `FrameLocator`, because it is lazy; `selectOption` states `value`, `label` or `index`; event streams fail with `TargetGone` too; Effect's date input is `DateTime.DateTime.Input`;
  - newly designed: `Keyboard` and `Mouse` with scoped `hold`; frame locators; `JSHandle`; `Emulation`; `PdfOptions`; cookies (`CookieJar`, values `Redacted`) and origin storage (read with inspect, write with control); `readHtml`, `isEnabled`, `isChecked`, element `evaluate`, `tap`, `scrollIntoView`; `BrowserWorker` and `NetworkConnection` event modules; `Download.cancel`; `Route.provideCredentials`; `grant`; `Condition.make`;
  - the sketch's scenarios assert requirement channels and pin nine access rules with `@ts-expect-error`.
- **Revision 5.23** moved the cross-cutting settings off `Browser` and onto Effect's own shapes:
  - `next` hands out a `ReadonlyDeferred`, the read side of Effect's `Deferred`, proposed upstream ([upstream/effect-readonly-deferred.md](upstream/effect-readonly-deferred.md)); its deadline is set at `next`, and `Pending` is gone;
  - a `Deadline` module (`within`, `withDefaultBudget`, `remaining`, and the `Current` and `DefaultBudget` references) replaces `Browser.withTimeout` and `withDefaultTimeout`; an explicit deadline wins over the default budget;
  - `Diagnostics.withPreset` replaces `Browser.withDiagnostics`, so `Browser` is only the service;
  - `Expect` re-checks through `Reactivity`.
- **Revision 5.22** applied [review 6](reviews/06-draft-5-effect.md), which checked the design against Effect's own modules, unstable and in-flight ones included:
  - routes use `effect/http`: `Route.fulfill(HttpServerResponse)` and `continueWith` with an `HttpClientRequest` transform, replacing `ResponseBody` and `RequestOverrides`; a captured response is an `HttpIncomingMessage`, so `Body` gave way to Effect's decoders;
  - preset-dependent values implement `Redactable`, so Effect's own logs and spans apply the diagnostics preset;
  - names avoid Effect's: `EventHistory`, `HttpStatusCode`; Effect's `HttpMethod` and `DateTime.Input` are used directly;
  - secrets come from `Config.Redacted`, and backends gain `launchConfig`;
  - traces and HAR attachments are written with the in-flight `effect/encoding` `Zip`, spans go to `effect/observability` or `effect/devtools`, and `Metric`s are added;
  - tools return failures to the model (`failureMode: "return"`); the CLI is built from `effect/cli`, `effect/rpc` and `effect/socket`; internal mechanisms name their Effect primitives (CONCEPTS.md §9);
  - kept, because Effect lacks them: `Watchable`, `Pending`, inherited deadlines and failing subscriber buffers. The first three are upstream candidates.
- **Revision 5.21** applied [review 5](reviews/05-draft-5.md), which checked every feature shared with Playwright against our own principles:
  - the agent toolkit follows the CLI: every page tool names its page, waiting is `next`/`await`/`expect`, and a digest between calls replaces `ActionReport.observed` and its settling window;
  - a snapshot's refs carry its page's access, `evaluate` always means the isolated world (the main world is `evaluateWith({ world: "main" })`), and results are typed `Serialized<A>`;
  - names follow the naming rule: `UserContext` (the spec's term, replacing `BrowserContext`), `PageClock`, `FileInput`, `Condition`, and Effect's own `Headers`;
  - the page clock uses Effect's `adjust`/`setTime`; `Expect.soft` and `Expect.poll` are gone; `toMatchAria` takes a typed pattern whose child matching is always stated;
  - navigations resolve at commit unless `waitUntil` asks for more, and the network-idle and DOM-quiet predicates are removed;
  - HAR replay is deferred, the testing helpers change no defaults, and traces are spans with Playwright's zip as one export;
  - every default is stated where it is declared and recorded in its span.
- **Revision 5.20** added the CLI (CLI.md), for agents and people driving a live session from a shell:
  - sessions and pages are named, and every command names its session (`--session` or `STRIDER_SESSION`) and page (`-p`), with no fallback and no current page;
  - one daemon and one browser per session, in a session directory at a predictable path that is deleted at `stop`; hard kills are reported and pruned explicitly;
  - forks copy storage state into a new session, from a running session or a file saved with `state save`;
  - commands are the toolkit's tools and drive the live session, while the library runs self-contained programs;
  - segments bring code into a live session: a file's default export, an `Effect` requiring `CurrentSession` (CLI-only, provided by `strider run`), finds its pages by name, and the project's own `tsc` checks it;
  - `snapshot.ref(id)` now returns a lazy `Locator`, which removed a double `yield*`;
  - launches use a temporary profile by default (`FileSystem.makeTempDirectoryScoped`), and `userDataDir` names a directory you own.
- **Revision 5.19** replaced `page.events.*` with a module per event type:
  - `PageNavigation`, `Popup`, `NetworkRequest`, `NetworkResponse`, `ConsoleMessage`, `UncaughtException`, `Dialog`, `FileChooser`, `Download` and `AutoResolution`, each with the most specific accurate name and a prefix only where a bare name would clash;
  - three verbs each: `next` and `stream` subscribe from now on; `history` reads a bounded event log and never waits. There is no `last`, because its only distinctive use, reading what an action just caused, races;
  - the trigger form is gone, and principle 5 becomes "waits look forward; reads look back". The old wording claimed no API made users order subscriptions, which `.pending` already contradicted. A late subscription times out with a hint naming the match it missed;
  - events report and handlers decide: `Dialog.handle` and `FileChooser.handle` replace `onDialog` and the deciding observations;
  - seeing an event acquires nothing: a popup belongs to its opener's scope and a download's file to its context;
  - `Navigation`, `RequestSnapshot` and `ResponseSnapshot` became `PageNavigation`, `NetworkRequest` and `NetworkResponse` at L2.
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
  - one package `@usestrider/browser` with subpath exports and a single version;
  - backends are imports (`@usestrider/browser/chromium`, `/firefox`, `/webkit`, `/bidi`) that provide the `Browser` service;
  - plus `/test`, `/ai` and raw `/cdp`.
- **Revision 5.9** settled the details of the access types:
  - popups of inspected or observed pages are `ObservedPage`s;
  - contexts have two levels (`ObservedContext`, `BrowserContext`), and reading storage needs control;
  - there are no type guards for narrowing access;
  - events are typed per access level.
- **Revision 5.8** adopted rules 18–22. Registrations now return handles (`Registration`, `RouteRegistration` with `hits`, `HandlerRegistration`), error reasons carry hints, and the API has a naming grammar.
- **Revision 5.7** split state from events:
  - `Watchable` for state: page status, URL, frames, download progress, page lists, capabilities.
  - `Observation` under `page.events.*` for events, in three forms: around a trigger, `.pending` and `.stream` (superseded in 5.19 by event modules).
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
  - finding 7, dual `Observe` combinators that return both values: API.md (superseded in 5.19: event modules);
  - finding 8, diagnostic presets: Diagnostics above;
  - the smaller items: CONCEPTS.md.
- **Next:** continue bottom-up at L0. All three layers are designed (API.md, CONCEPTS.md, PROTOCOL.md); CDP code generation, the transports and the CDP client are built. Next come the conformance probes (PROBES.md) against Chrome and Firefox, whose results settle questions the upper layers depend on and extend the error table, then the ingestion pipeline and the Chromium adapter. The implementation replaces the sketch's declarations module by module and keeps their JSDoc, so the checks (`pnpm all`) keep holding the API to its design as it is built.
