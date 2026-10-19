# CONCEPTS: the native browser model

*Status: draft 3, 2026-10-18, revised following [review 1](reviews/01-draft-1.md) and [review 2](reviews/02-draft-2.md). Sources: `research/*.md` (nine notes). Spec anchors use the conventions in `research/platform-concept-model.md`: `HTML#x` means `https://html.spec.whatwg.org/#x`, `BIDI#x` the WebDriver BiDi editor's draft, and so on.*

This document proposes **layer 1** of the library: a protocol-neutral, spec-grounded model of what a browser *is*, what a driver can observe, and what it can *do*. The ergonomic API belongs to layer 2 (the planned DESIGN.md), and its conveniences must be expressible here. The dependency works both ways: ordinary call sites must shape this model before its contracts are frozen. Browser facts, adapter observations and user-facing policies are distinguished throughout.

The nine research notes remain historical evidence, not implementation guarantees. This revision corrects the contracts identified in [reviews 1 and 2](reviews/); backend behavior still requires the conformance probes in §9. No browser measurements are claimed by this revision.

```
L2  Ergonomic API      locators, actions, expectations, agent toolkit, test fixtures   (DESIGN.md)
L1  Native model       identities, lifecycles, state, events, obligations, outcomes    (this document)
L0  Protocol adapters  CDP · WebDriver BiDi · WebKit Inspector (patched / stock)       (generated + adapters)
    Transports         pipe (fd3/fd4, NUL framing) · WebSocket                          (fail-fast, no reconnect)
```

---

## 0. Principles

These principles combine prior-art mechanisms with the corrections in [the reviews](reviews/). They are proposed contracts; §9 distinguishes assumptions that need measurement.

**P1. Spec identity is primary; protocol identity is adapter-internal.**
The public model is keyed by *navigable*, *document epoch*, *realm*, *navigation* and *request*, the concepts the HTML spec and BiDi use. CDP `targetId`, `sessionId`, `executionContextId` and `loaderId`, and WebKit `pageProxyId` and provisional target ids, never appear as primary identity. They change on events that leave spec identity untouched: out-of-process-iframe swaps, COOP process swaps, WebKit provisional pages and prerender activation (`platform-concept-model` §3.16; `webkit` §1.3; `playwright-internals` §2). Absorbing that churn in the adapter is the single largest ergonomic win available.

**P2. Lifetimes own scopes; observation does not imply destruction ownership.**
Each model resource has a lifetime signal with a typed reason and a cleanup `Scope`. `Scope.close(scope, Exit.fail(reason))` passes the reason to finalizers; it does **not** turn child-fiber interruption into that typed failure. `within(effect)` explicitly arbitrates operation completion against lifetime end (§3.1). A close request ends the lifetime only after confirmed closure; a canceled request leaves the resource usable. Adopted resources have an explicit release policy, independent of their place in the model tree.

**P3. Interruption stops waiting; remote execution may remain uncertain.**
There is no general per-command cancellation across the protocols. Caller interruption retains ordinary Effect interruption semantics. An internal **operation record** tracks whether dispatch was attempted, what was observed, and whether compensation succeeded (§5). Timeout, transport loss and process swaps can also leave a mutating operation uncertain. Late replies are detached from the caller but still routed when needed for reconciliation or resource cleanup. Compensation is bounded and best-effort, never proof that page side effects were undone.

**P4. Model state is folded before publication, with explicit failure on lost integrity.**
One reader routes each transport's messages; one ordered fold per session updates authoritative state before publishing its events. The reader never waits for user callbacks, enrichment or a full consumer queue. Internal events are not silently dropped. Overload or failure to decode a required state event makes the affected model unavailable until a verified resynchronization, or ends its session (§4). User streams have separate buffering policies.

**P5. Subscribe-before-trigger is structural.**
A subscription is live when the effect acquiring it returns. An **observation window** acquires subscriptions and any collectors or handlers before starting its trigger (§4.1). Handlers that must unblock the trigger run concurrently with it. Acquisition includes remote subscription acknowledgement where needed. Eager `PubSub.subscribe` avoids the lazy-subscription races recorded in `effect-building-blocks`; merely forking a stream is insufficient. Temporal correlation is reported as such, not asserted to prove causation.

**P6. Obligations select one decision locally and track remote acknowledgement.**
Paused requests, user prompts and intercepted file choosers have typed, phase-specific decisions. An atomic transition selects at most one terminal decision; competing handlers and defaults cannot both win. A decision sent without an acknowledgement has an uncertain outcome, not a guarantee of remote resolution. Handler failure, interruption, return without a decision and deadline expiry invoke a phase-specific fallback only while no decision has been selected (§2.11.2).

**P7. Capabilities belong to the instance being operated on.**
Backends differ widely (§8). Capabilities are bound to a browser, context or page and its configuration, with `Supported`, `Unsupported` or `Unknown` evidence. Instance refinement or a capability handle can make supported operations statically available. An unrelated ambient service cannot prove that a particular page supports an operation. Runtime absence is a typed `Unsupported`, never a silent no-op.

**P8. Protocol features are demand-driven and reference-counted.**
A protocol feature (CDP domain enable, BiDi module subscription, `Fetch` patterns, file-chooser interception) is acquired while a consumer needs it and released after. Core identity/lifetime tracking is itself a consumer for as long as the tracked objects are exposed; zero public listeners does not disable required state tracking. This keeps traffic down. It also makes a **stealth posture** expressible: no `Runtime.enable`, so realms are discovered on demand rather than tracked (`non-js-cdp-clients` §7). Stealth has to be an architectural option, because an eager-enable design cannot retrofit it.

**P9. Configuration is declarative, acknowledged and temporally scoped.**
Init scripts, emulation, headers, intercepts, download behavior and bindings are declarations scoped to a context or page. Each declares its application boundary: current targets where meaningful, future documents, or both. Each also states the **timing guarantee it requires**: `timing: "beforeAuthorScript" | "bestEffort"`. Acquisition returns only after required installation is acknowledged, and fails with `Unsupported` if the backend cannot meet the requested timing. A declaration never silently degrades from `beforeAuthorScript` to "usually first". Attaching to an already-running page cannot undo earlier script execution. CDP/WebKit use pause-configure-resume where available; BiDi uses native declaration scopes where supported and adapter reconciliation otherwise. Required setup failures fail initialization (§3.2). **Declarations never take effect on resources this client does not own** (§3.1). An adapter emulation that would touch observe-only resources, such as a browser-global intercept standing in for a context-scoped one, requires explicit opt-in or returns `Unsupported`.

**P10. Declarations are registrations ordered by one precedence ladder.**
Every declaration (override, obligation handler, intercept, preload script) is an identified scoped registration. All kinds are ordered the same way: **scope specificity first** (Frame over Page over UserContext over Browser), **then explicit priority, then recency** (newest first). Users learn this once. Releasing a registration removes it and recomputes the effective state, including when fibers finish out of order. Same-setting changes are serialized at the physical scope the backend supports. Nested overrides compose; conflicting concurrent exclusive use requires a lease or returns `OverrideConflict`. Restoration of external state is promised only when the previous value is known and ownership permits it (§2.15).

**P11. Ordinary operations have small, stable error channels.**
An ordinary verb fails with at most about three tags: the lifetime family `TargetGone{object, reason}`, the deadline family `Timeout{operation, phase, dispatch}`, and the verb's own domain error. Detail lives in `reason`, `phase` and evidence fields, recovered with `catchReason`, not in dozens of top-level tags. Dispatch uncertainty (§5.1) is a field on these errors, never a separate tag every caller must handle (§6).

**P12. Secrets stay redacted end to end.**
Values that are secrets on the way in (typed text, credentials, header and cookie values) are accepted as Effect `Redacted` and returned as `Redacted` on the way out. Tracing, error messages, operation records and agent tooling never render their contents (§2.20).

---

## Guarantees at a glance

This table is the contract DESIGN.md builds on. Each row summarizes the detailed section it cites. Anything not listed here as guaranteed should be treated as best-effort or unknown.

| Area | Guaranteed on every backend | Guaranteed given a named capability | Best-effort | Unknown until probed (§9) |
|---|---|---|---|---|
| **Identity** (§1) | Public ids are L1-minted and stable within a connection across protocol churn (process swaps, session changes). An explicit `NodeRef`/`HandleRef` never silently rebinds | — | Correlating a restored document with its earlier epoch (`restoredFrom`) | Backend id continuity across bfcache and initial-blank reuse (probes 2, 3) |
| **Lifetimes** (§3.1) | Every model lifetime ends with a typed reason. Destruction only of owned resources. Caller interruption stays ordinary Effect interruption | Prompt notice of remote ends (event-based tracking) | — | Detach events for orphaned children (probe 8) |
| **Navigation** (§2.8) | An outcome is reported only with affirmative evidence; otherwise the caller gets `Timeout{phase: "postcondition"}` | `Restored`, `Activated` outcomes | BCG-switch classification | Terminal events for canceled, intercepted and `javascript:` navigations (probe 4) |
| **Declarations** (P9, P10, §3.2) | Acknowledged installation, or acquisition fails. Never applied to non-owned resources. One precedence ladder | `timing: "beforeAuthorScript"` | — | Popup inheritance per backend (probe 18) |
| **Obligations** (§2.11.2) | At most one decision is selected. Fallback applies only while pending. No contradictory second decision | Acknowledged remote resolution | — | Behavior on connection loss (probe 19) |
| **Input** (§2.10) | Serialized per page. Owned held inputs are released (bounded) on interruption | Trusted input (`native` / `webdriver` fidelity); evaluation with user activation | Release after transport loss; activation estimate | — |
| **Readiness** (§2.17) | Each predicate returns `Ready`, `NotReady{reason}` or an observation error, bounded by the operation deadline | Rendering-based predicates (need a rendering opportunity) | Network-idle request attribution | Stable-frame cadence per backend (probe 10) |
| **Ingestion** (§4) | Ordered per-session fold before publication. Internal events are never silently dropped; overload is an integrity failure | — | Optional enrichment | — |
| **Bodies** (§2.12) | Expressed interest acquires collection before the trigger. Returned bodies outlive the observation window | Body access per backend | Eviction-dependent CDP buffers | — |
| **Deadlines** (§5.2) | One deadline per operation; nested calls never extend it. Cleanup has its own bounded budget | — | — | — |
| **Errors** (P11, §6) | Ordinary verbs fail with `TargetGone`, `Timeout` or their domain error; dispatch evidence travels as a field | — | — | — |
| **Secrets** (P12, §2.20) | `Redacted` values are never rendered in traces, errors or records | — | — | — |

---

## 1. Identity

### 1.1 Three spec layers

| Layer | Concept | Stable across | Changes on | What binds here |
|---|---|---|---|---|
| **Slot** | Navigable (top-level traversable = Page; child navigable = Frame) | every navigation, cross-site, COOP, process swap | never (until destroyed) | `Page`, `Frame`, input state, navigation history, prompts |
| **Epoch** | Document (+ its Window realm, usually) | same-document navigations, `document.open()` (which starts a new content generation), bfcache suspend/restore when continuity is evidenced (§2.5) | cross-document commit | `NodeRef`, document readiness, network-idle accounting |
| **Topology** | Browsing context, browsing context group (BCG), agent cluster, event loop | navigations within a BCG | BCG switch (COOP, prerender activation, fenced-frame embedder nav, UA choice) | opener links, `window.name`, BiDi `sharedId` map, event-loop sharing (prompts block siblings) |

(`platform-concept-model` §1, §3.2–3.5.) Realms sit between the epoch and slot layers. A Window realm normally lives and dies with its document epoch. The **one exception** is the initial `about:blank` Window, which is *reused* by the first same-origin-domain navigation (`HTML#initialise-the-document-object`). So `Realm` is modelled as a sibling of `Document` under the navigable, linked to the document epoch(s) it served, not as a strict child.

### 1.2 Model ids and their protocol mappings

**Every public model id is a branded opaque value minted by L1.** Backend ids are correlation evidence held only in adapter tables, even where they look stable. This is the only rule that survives process swaps, session changes and (later) reconnection, and it is what lets a command-started navigation have its id *before* the command is sent (P5, §2.8).

| Model id | Minted when | CDP evidence | BiDi evidence | WebKit (patched) evidence |
|---|---|---|---|---|
| `UserContextId` | context created or adopted | `browserContextId` | `userContext` | `browserContextId` |
| `NavigableId` (Page, Frame) | navigable first observed or created | `frameId` (survives OOPIF swap; main frame re-keyed on prerender swap) | `context` (= navigable id) | `pageProxyId` (page) / `frameId` |
| `DocumentId` | initial/adopted document observed, or cross-document commit | frame + loader evidence | commit/restore evidence; realm alone is insufficient | loader evidence |
| `DocumentGeneration` | document epoch created; incremented when its tree is reset (`document.open()`, or any adapter-detected document-node replacement) | tree-reset evidence to be established by probe 17 (for example a document-node change within the same loader) | tree-reset evidence, probe 17 | tree-reset evidence, probe 17 |
| `RealmId` | realm observed or acquired | `executionContextId` per session (keyed by `uniqueId`); world name | `realm` | `executionContextId` per target; `type: normal\|user` |
| `NavigationId` | **before dispatch** for command-started navigations; at the first signal for page-started ones | `loaderId` (cross-doc), correlated after `Page.navigate` returns | `navigation` (null for `historyUpdated`) | `loaderId` from `Playwright.navigate` |
| `RequestId` | first fact about the request | `Network` `requestId` and `Fetch` `requestId`/`networkId`, reconciled | `request` (stable across redirects; `redirectCount`) | `requestId` |
| `NodeRef` | composite | `{navigable, document, generation, backendNodeId}` | `{navigable, document, generation, sharedId}` | `{navigable, document, generation, objectId→nodeId}` |
| `HandleRef` | composite | `{realm, objectId, objectGroup}` | `{realm, handle}` | `{realm, objectId}` |
| `PromptId`, `DownloadId`, `InterceptId`, `SubscriptionId`, `OperationId` | on creation | — | — | — |

**Generations scope waits and results.** Loading results, readiness waits and `NodeRef` connectivity are bound to a `(DocumentId, DocumentGeneration)` pair. After `document.open()` the epoch survives, but waits started against the old generation fail or re-target according to their contract, and refs from the old tree fail connectivity checks.

**Model objects have value identity.** Every model object (`Page`, `Frame`, `Document`, `Realm`, `Request`, `NodeRef`, and so on) implements Effect `Equal` and `Hash` by its id, and its `toString`/`toJSON` render the id with a short description. Two handles to the same navigable are equal, so model objects work as `HashMap` keys, with `Stream.groupByKey` and in test assertions.

**`DocumentId` is always ours.** BiDi exposes no document id (`platform-concept-model` §3.5). CDP loader ids provide navigation evidence; whether they survive bfcache restore is a probe question (§9). Our document identity must not depend on assuming that continuity. Five independent tools key element identity by document plus node: Chrome DevTools MCP (`loaderId_backendNodeId`), agent-browser (session, frame, `loaderId`), Playwright (frame `seq` renumbered on commit), chromium-bidi (contexts destroyed on new `loaderId`) and Stagehand v4 (snapshot bound to URL). `NodeRef` therefore carries its `DocumentId`, allowing local rejection of known epoch mismatches. That does not prove current connectivity or backend-reference validity; those require operation-time validation.

### 1.3 Staleness

A `NodeRef` carries a document binding, a backend reference generation and the last validity observation. Distinguish:

- **Known invalid**: its document or navigable ended, its binding was invalidated, or it was observed adopted into another document. Operations through an explicit ref fail with `StaleRef{reason}` (§6); locators re-resolve instead.
- **Suspended**: its document is known to be inactive in bfcache. Explicit-ref operations fail fast with `StaleRef{reason: Suspended}`, with explicit waiting available; locator-based operations treat suspension as `NotReady`.
- **Last observed connected / disconnected / unknown**: a connectivity observation within a surviving document. It has a timestamp, not a perpetual validity guarantee.

The adapter checks document identity and connectivity as part of an operation, as close to its use as the protocol permits. Layout and DOM can still change after that check; actions need their own guards. Detaching and reinserting the same node into the same document can restore usability if the backend reference survives. An immutable ref does not silently rebind after cross-document adoption; obtain a new ref. A `StaleRef{reason: Detached}` failure is therefore an observation, not necessarily a permanent tombstone.

WebDriver's stale definition depends on the active document and current connectivity ([WebDriver](https://w3c.github.io/webdriver/#dfn-is-stale)). Under BiDi, BCG changes may invalidate the backend's shared-node map; invalidating that binding does not assert that the underlying node was destroyed. Restoration of document identity, node references and JS handles are separate capabilities (§2.5).

---

## 2. Concept catalogue

Each entry follows the same layout: **what it is**, **identity**, **lifetime** (start / end triggers, with protocol signals), **state** (observable as `SubscriptionRef`), **events** (`Stream`), **operations**, **invariants**, and **hazards** (H-numbers from `platform-concept-model` §4).

### 2.1 Browser

- **What.** One connected browser endpoint and its process, if we own the process.
- **Ownership.** `Launched{process}` or `Attached{endpoint}`. With `Launched`, release closes gracefully (`Browser.close` / `Playwright.close` id −9999 / `browser.close`) with a bounded timeout, then kills (SIGTERM, then `forceKillAfter`). With `Attached`, release cleans up resources explicitly created/owned by this connection and then disconnects; it never closes adopted tabs, removes the default context, or closes/kills the remote browser. The Browser release policy itself is disconnect-only (§3.1). iOS, the WebKit inspector HTTP server, BiDi-attached Safari and remote CDP endpoints (Browserbase and similar) are attach-only, and some of them cannot create contexts (`webkit` lesson 8).
- **Lifetime.** Ends on graceful close (`BrowserClosed`), process exit (`BrowserCrashed{exitCode, signal, stderrTail}`; include the exit status, as chromedp does) or transport loss (`ConnectionLost`).
- **State.** `userContexts`, `version`, `backend: BackendInfo`, `capabilities: CapabilitySet`.
- **Invariants.** There is exactly one reader fiber per transport. The transport fails fast after close. Writes after close fail with `ConnectionLost`. Effect's `Socket` writer *suspends* while disconnected, so we must not inherit that behavior (`effect-building-blocks`, verified t6). Single-client backends (the patched-WebKit WebSocket, `safaridriver`) are singletons guarded by a `Semaphore(1)` per (backend, profile).

### 2.2 UserContext

- **What.** A storage partition plus a scope for overrides (`BIDI#user-context`; CDP browser context; WebKit `WebsiteDataStore`).
- **Identity.** `UserContextId`. The `default` context always exists, cannot be removed, and is *adopted*, not created.
- **Lifetime.** Created by command, or adopted. Ends on `remove` (which closes its pages *without* beforeunload, `BIDI#remove-user-context`) or with the browser.
- **State.** `pages`; the active override registrations (§2.15); `promptPolicy` (default decisions, §2.11); `downloadPolicy`; intercepts and preload scripts declared at this scope.
- **Invariants.** No storage is shared across user contexts. A child navigable's user context equals its parent's. Popups inherit their opener's user context; the spec leaves this open, but every implementation does it.

### 2.3 Page (top-level traversable)

- **What.** A tab or window: a top-level traversable that owns session history, the traversal queue, visibility and system focus (`HTML#traversable-navigable`).
- **Kinds.** `tab`, `popup` (auxiliary; `opener` set; `is created by web content`), `prerender` (hidden traversable; scripting blocked until activation), `fenced` (a traversable with an unfenced parent; its own BCG). Prerender and fenced pages are modelled but capability-gated.
- **Identity.** `NavigableId`. `originalOpener: Option<NavigableId>` is kept even under `noopener`, where `window.open` returns `null` (`BIDI#original-opener`; H6).
- **Origin.** `Created` (by command), `Opened{opener}` (popup, `target=_blank`, `window.open`) or `Adopted` (already existed at attach). Pages born outside any user call are observed within their user context's lifetime (§3.3); origin and release policy are separate fields.
- **Lifetime.**
  - **Start:** CDP `Target.attachedToTarget{type: page}` (paused under auto-attach); BiDi `contextCreated` with no parent; WebKit `Playwright.pageProxyCreated`.
  - **Initial state:** a fresh page holds the *initial `about:blank`* with `hasPlannedNavigation`. Its readiness is measured independently; loading the initial blank document is not evidence that the planned destination has committed (H6, H13).
  - **End:** `PageClosed{by: Command | Script (window.close) | UserContextRemoved | Browser}` or `PageCrashed` (§3.1). Closing by command may run beforeunload (`promptUnload`), which can **cancel** the close if the prompt is dismissed (H15).
- **State.** `frameTree: SubscriptionRef<FrameTree>`; `url`; `title`; `visibility`; `hasSystemFocus`; `promptOpen: Option<UserPrompt>`; `inputState` (§2.10); `history: {length, canGoBack, canGoForward}` (derived, coarse).
- **Events.** `navigations`, `popups`, `prompts`, `downloads`, `console`, `pageErrors`, `requests`, `crashed`.
- **Operations.** navigate / reload / traverse(delta); close(promptUnload?); activate (bring to front, needed for rendering-dependent waits, H19); set viewport; capture (§2.18); evaluate in the main frame's realm (delegates to §2.6).
- **Invariants.** There is at most one ongoing navigation per navigable. "Any attempts to navigate a navigable that is currently traversing are ignored" (`HTML#navigate`).

### 2.4 Frame (child navigable)

- **What.** An iframe, frame, object or embed slot presented by a *navigable container* element (`HTML#child-navigable`).
- **Identity.** `NavigableId` (same id space as Page). The main frame of a page is the Page's own navigable. `Frame` and `Page` share a common `Navigable` interface.
- **Lifetime.**
  - **Start:** the frame is created *synchronously* during container insertion, with its own initial `about:blank`. Protocol notification arrives **later**, and the parent can script `contentWindow` before then (H5).
    - CDP: `Page.frameAttached` (same process) or `Target.attachedToTarget{type: iframe}` (OOPIF, frame id = target id).
    - BiDi: `contextCreated` with `parent`.
    - WebKit: `Page.frameAttached` (a Playwright addition).
  - **End:** container removal (*no unload events*, `HTML#destroy-a-child-navigable`) or the parent document being permanently destroyed/unloaded. Parent suspension retains the subtree where observable (§2.5). HTML never formally fires "navigable destroyed" for children orphaned by a parent navigation (`platform-concept-model` §3.2 spec gap). The adapter must close child Frame scopes itself whenever the parent's document epoch ends. chromium-bidi cleanup on loader changes is prior art (`puppeteer` 6b), but does not establish whether a particular subtree is destroyed or suspended on every backend.
- **Process swaps (implementation layer).** A cross-site navigation of an iframe moves it to another process. CDP shows this as `Page.frameDetached{reason: "swap"}` followed by a new iframe target and session. The Frame (spec identity) **persists**. Only its adapter session changes, held in a `SubscriptionRef<SessionBinding>`. In-flight commands on the old session fail with an adapter-internal `SessionSwapped`, which L1 retries only when the operation phase, document binding and dispatch evidence permit it (§6, H7). Playwright's handling of detach-before-attach races, a "safe roundtrip" then decide, is the reference (`playwright-internals` §2).
- **State.** `parent`, `children` (document order), `containerRef: NodeRef` (the iframe element in the parent document), `activeDocument`, `url`, `name`.
- **Invariants.** A frame's visible children belong to its *active document*. A suspended document may retain its own child subtree; suspension does not close it. When that epoch actually ends, its children end too.

### 2.5 Document (epoch)

- **What.** One occupant of a navigable: the Document plus its Window (usually), DOM, readiness and fetch group.
- **Identity.** `DocumentId`, minted when first observing an initial/adopted document or a cross-document commit. Fields: `url`, `origin`, `navigation: NavigationId | null` (the navigation that committed it; null for the initial `about:blank`), `isInitialAboutBlank`, `isErrorDocument` (H10), `restoredFrom?` (see below).
- **State machine.**

  ```
  Each document: Loading → Interactive → Complete
  Active ─(confirmed bfcache entry)─► Suspended ─(confirmed restore)─► Active
  Active | Suspended ─(destroyed / evicted / binding lost)─► Ended{reason}
  Cross-document commit creates a different DocumentId, even if the Window is reused.
  Initial about:blank is its own document; suspension preserves observed readiness.
  ```

  Readiness transitions come from protocol lifecycle events (CDP `Page.lifecycleEvent` DOMContentLoaded/load, BiDi `domContentLoaded`/`load`, WebKit equivalents). Only events whose loader/navigation id matches *this* epoch are accepted. Stale lifecycle events from the previous document must not leak, and `browsingContext.create` waits for the initial `about:blank` load for exactly this reason (`puppeteer` 6d).
- **Mutation without replacement.** `document.open()` keeps the epoch but replaces every node and erases listeners, and starts a new `DocumentGeneration` (§1.2). Refs into the removed tree fail connectivity checks; the epoch does not end (H1). Readiness may reset to Loading, so it is a current state rather than an ever-increasing rank. Outstanding waits retain the `(DocumentId, DocumentGeneration)` they target.
- **bfcache.** Known suspension makes explicit-ref operations on that document fail fast with `StaleRef{reason: Suspended}` (H3). Descendant frames and associated realms follow its suspension state without being closed solely because a different document becomes active. Reactivation can preserve our document identity only when adapter evidence correlates it. Protocol realm announcements and destruction notifications vary; §9 probes them rather than assuming a common sequence.
- **Reference restoration.** A restored document does not automatically revive a backend node reference or handle. The adapter must prove continuity of the specific reference binding. Otherwise old handles remain invalid and callers re-resolve locators or obtain new handles. If the adapter cannot establish document continuity, the old model epoch ends with `DocumentUnloaded` and the restored document gets a new id; `restoredFrom` is included only when correlation is supported by evidence. A confirmed realm destruction invalidates its handle bindings even if the document later returns.
- **Loading results.** `Document.loading` records pending, completed or failed/aborted loading for a content generation. Failure after commit is a loading result, never a revision of the navigation's already-terminal `Committed` outcome.
- **Invariants.** A navigable has at most one *active* document. Tasks for a non-fully-active document are not run: they wait rather than fail, which is why the driver must race explicitly (H2, H3).

### 2.6 Realm and World

- **What.** A JS global environment (ECMA-262 §9.3) where script runs and handles live.
- **Kinds.** `window{navigable, world}`, `dedicatedWorker{owner}`, `sharedWorker`, `serviceWorker{registration}`, `worklet{kind}`. The kind is an open union; ShadowRealm has no protocol type yet.
- **World.** For window realms, `world: "main" | Isolated{name}`. An isolated world is an automation concept with three implementations: BiDi `sandbox` (lazily created per Window and name), CDP isolated world (`Page.createIsolatedWorld` / `addScriptToEvaluateOnNewDocument{worldName}`), and WebKit `Page.createUserWorld` (patched only; stock WebKit has **no** isolated worlds). The library's own injected code (selector engines, readiness checks, snapshotters) runs in a **utility world** where available. Page scripts then cannot tamper with it, and our evaluations don't trip page monkey-patches (`playwright-internals` §2). Where isolated worlds are unavailable, a capability flag says so, and the fallback (snapshotting main-world globals) is explicit.
- **Identity.** `RealmId`, minted by L1. The adapter maps it to (session, `executionContextId`) for CDP and `realm` for BiDi. CDP `executionContextId`s are per process, so the adapter keys by `uniqueId`.
- **Discovery strategy** (P8; a per-user-context choice):
  - **Tracked.** Enable `Runtime` (or subscribe to BiDi `script.realm*`) and fold create/destroy events into `realms: SubscriptionRef<RealmSet>`. This gives event-driven information within the backend's advertised coverage, subject to initialization and integrity checks. Playwright, Puppeteer and chromium-bidi use this approach.
  - **OnDemand.** No `Runtime.enable`. Realms are obtained when needed: an isolated world via `Page.createIsolatedWorld`, a main-world handle via `Runtime.evaluate("globalThis")` without a context id, or `DOM.resolveNode`. Bindings are cached with a document/session generation and invalidated by known document replacement, session loss, or a normalized protocol invalid-context error. Main-world acquisition must identify the intended frame; evaluating without a context id is not sufficient to select an arbitrary same-process child frame. There is no promise of immediate realm-death notification without events: every command has a deadline, and operations validate bindings when used. The realm *set* is not observable here. A statically selected OnDemand instance lacks event-dependent operations; dynamically selected instances require capability refinement (§8). Avoiding Runtime events is a configuration choice, not a guarantee of undetectability.
- **Lifetime.**
  - **Start:** CDP `Runtime.executionContextCreated`, BiDi `script.realmCreated`, or on-demand acquisition.
  - **Active vs prospective binding:** keep the current realm while navigation is pending and track any candidate replacement separately. Navigation start alone never resets the active realm deferred. A canceled navigation, download or 204/205 leaves the old binding usable. Commit associates the new epoch with a validated realm, including initial-blank Window reuse; confirmed realm destruction invalidates the old binding immediately.
  - **End:** confirmed realm destruction, loss of its valid session binding, owner destruction or crash. Suspension is a separate state. Where events are unavailable, prompt end notification is not promised; binding validation and deadlines bound observation (§5).

- **Evaluation with user activation.** An evaluation may request `userActivation: true`. The script then runs as if initiated by a user gesture, so activation-gated APIs (fullscreen, clipboard, popups past the blocker, pickers) can be exercised without a synthetic click. All three protocol families support this natively: CDP `Runtime.evaluate`/`callFunctionOn{userGesture}`, BiDi `script.evaluate`/`callFunction{userActivation}`, WebKit `Runtime.callFunctionOn{emulateUserGesture}`. Support and exact semantics (transient only, or also sticky) are a per-backend capability (probe 20). Requesting it where unsupported fails with `Unsupported`; it never silently runs without activation.

- **Invariants.**
  - Every evaluation is bounded by the caller and realm lifetime through `within` (§3.1). Observed lifetime failure is delivered explicitly; caller cancellation remains interruption. Known prompt blocking (H14) and document suspension (H3) are observations available to wait policies.
  - A non-stalling evaluation checks known blocking conditions and uses the remaining operation deadline. A pending navigation alone is not a reason to refuse reads of the still-active document. Page-level reads may reacquire a current realm before dispatch; explicit realm/handle operations never silently retarget a replacement document.
  - Handles belong to exactly one realm and die with it.

### 2.7 Values, handles, channels and preload scripts

- **Value transfer is by value by default** (BiDi's model). Simple serializable evaluations may infer a TypeScript result type without a mandatory schema; this is not runtime validation. A schema-decoding variant is provided for validated extraction and external data boundaries. Unsupported or lossy wire values fail explicitly rather than being cast into the inferred type. The wire carries the protocol's deep serialization: BiDi `RemoteValue`, or CDP `deepSerializedValue` / `returnByValue`. **Handles are opt-in** and require `Scope`: `HandleRef{realm, ...}` is created with ownership `root` (BiDi) or in a caller-lifetime object group within that realm (CDP), and released in a batch by the finalizer (`script.disown` / `Runtime.releaseObjectGroup`), skipped if the realm already died.
- **Node values.** A node result becomes a `NodeRef` bound to the current document epoch. The BiDi `sharedId` works across main and sandbox realms, with a same-origin check. The CDP `backendNodeId` is resolved into a realm with `DOM.resolveNode`.
- **Channels** (page → driver messages). `Channel<A>` has a driver-chosen id and a `Schema<A>`, and is exposed as a `Stream<A>` filtered by channel id. BiDi passes it as a function argument (`script.message`). CDP uses `Runtime.addBinding` (string payload, JSON-encoded) or chromium-bidi's long-poll. Patched WebKit uses `Runtime.addBinding`, and stock WebKit a sync-XHR bridge (`webkit` §1.7). Channels are the transport for in-page observers: mutation invalidations, readiness probes, recorder events.
- **Preload scripts.** A `PreloadScript{source, world, scope: UserContext | Page, channels, timing}` declares future-document execution in its supported scope. With `timing: "beforeAuthorScript"` (the default for preload scripts), installation fails with `Unsupported` where the backend cannot guarantee that ordering; `"bestEffort"` accepts possible late execution explicitly (P9). When several preload scripts apply to one document, the highest-precedence script (P10) runs **last**, so it observes and can override the effects of more general ones. That makes execution order the reverse of the precedence ladder. Page-scoped inclusion of child frames and popups is explicit; popup inheritance must be implemented and verified, not inferred from native context scoping. Applying a script immediately to an existing document is a separate opt-in operation, not document-start execution (H4, H5). BiDi: `script.addPreloadScript`. CDP: `Page.addScriptToEvaluateOnNewDocument{worldName, runImmediately}` per target, during the paused setup. WebKit: `Page.setBootstrapScript`.

### 2.8 Navigation

- **What.** One attempt to change a navigable's active session history entry.
- **Identity.** `NavigationId`. Navigations started by commands are created *before* the command is sent, so the subscription precedes the trigger (P5). Navigations started by the page are adopted from the first protocol signal (CDP `Page.frameRequestedNavigation` / `frameStartedNavigating`, BiDi `navigationStarted`).
- **Kinds.** `crossDocument`, `fragment`, `historyApi` (`pushState`/`replaceState`, which BiDi reports as `historyUpdated` with **no** navigation id), `intercepted` (Navigation API: cross-document converted to same-document), `traversal` (back/forward; may restore from bfcache), `reload`, `javascriptUrl`, `download`, `prerenderActivation`.
- **Outcome**, a closed union. This is the center of the model:

  ```ts
  type NavigationOutcome =
    | { _tag: "Committed";    document: DocumentId; response: Option<ResponseRef> }
    | { _tag: "SameDocument"; document: DocumentId; via: "fragment" | "historyApi" | "intercepted"; url: string }
    | { _tag: "Restored";     document: DocumentId }                 // bfcache reactivation
    | { _tag: "Activated";    document: DocumentId }                 // prerender activation
    | { _tag: "Download";     download: DownloadId }                 // old document stays active (H11)
    | { _tag: "NoContent";    status: 204 | 205 }                    // old document stays active (H11)
    | { _tag: "Failed";       error: NetError; errorDocument: Option<DocumentId> } // error page may commit (H10)
    | { _tag: "Superseded";   by: NavigationId }                     // silently replaced (H9)
    | { _tag: "Canceled";     reason: "beforeunload" | "navigateEvent" | "sandbox" | "unloading" | "traversalInProgress" }
    | { _tag: "NoOp";         reason: "javascriptNonString" }
  ```

  This union is a conceptual sketch; all outcomes carry navigation/operation identity and evidence in their enclosing record. A Failed outcome may carry an error document only when that document is already correlated; later error-page discovery enriches the record without replacing a terminal result. A failure after a successful commit belongs to document loading.

  These outcomes describe observed terminal facts. Several cases have **no reliably observable terminal protocol event** (H9). Track `Pending | Observed{outcome, evidence} | Unresolved{lastObserved}` independently from a caller waiting for the result:
  1. Report `Superseded` only when the adapter can establish replacement of that navigation attempt, not from an unrelated later start alone.
  2. Correlate same-document transitions by protocol identity or backend-specific evidence. A `historyUpdated` event without navigation attribution updates history but does not by itself finish a pending navigation as `intercepted`.
  3. Silence or a quiet interval is not evidence of cancellation or a no-op. A waiting caller reaching its deadline receives `Timeout{phase: "postcondition", lastObserved}` (§6); the bounded operation record can retain later evidence (§5).
  4. Navigable destruction ends observation with its close reason. If a mutation may have executed, retain that uncertainty in the operation record.

  `Canceled` and `NoOp` require affirmative evidence of their stated reason; otherwise the outcome remains unresolved. The relevant prior art is chromium-bidi's tracker (`puppeteer` 6d) and HTML algorithm landmarks (`platform-concept-model` §3.6), not a universal protocol completion guarantee.

- **Default projection for navigate operations.** The full outcome union stays available, but ordinary `goto`/`reload`/`back` calls should not force every caller to match ten cases. The default projection is:
  - **Success:** `Committed`, `SameDocument`, `Restored`, `Activated`, returned as the resulting `Navigation` (document, response if any).
  - **Failure:** `NavigationError{reason: Failed | Superseded | Canceled | NoOp | Download | NoContent}`. `Download` and `NoContent` are failures by default because the caller asked for a page; a call can opt in to accepting them, and downloads have their own combinator.
  - **Unobserved:** `Timeout{phase: "postcondition"}` as above.

  L2 may add projections, but every projection must be expressible from the outcome record.

- **Readiness of a committed navigation.** Readiness is separate from the outcome. A successful cross-document navigation completes at *commit*; outcomes without a commit complete when their terminal evidence is observed. Readiness is a property of the resulting `Document` (`Loading | Interactive | Complete`). "Wait until load" follows the resulting document and loading generation, failing if that generation aborts or is replaced. It never switches silently to another document. Same-document outcomes retain their associated epoch. This is a separate wait from the navigation outcome. Network idle is a separate predicate (§2.17).
- **Navigations observed during actions.** An observation window (§4.1) is opened before input and collects matching navigation evidence for explicitly selected navigables. Synchronous signals may support backend-specific navigation association, but a round trip cannot prove that all consequences of input have happened. Delayed application work needs an explicit URL, navigation or other postcondition and a deadline. `drainObserved` (§4) only acknowledges local processing of already-ingested events. Matching by time or opener is correlation, not causal proof.
- **Redirects.** A redirect chain belongs to the same navigation, and the request id is stable across hops. A cross-origin redirect discards and re-creates the reserved client environment (`platform-concept-model` §3.6).
- **BCG switch.** Outcome metadata may include `bcgSwitch: Confirmed | Suspected | Unknown` with evidence and separately observed `openerSevered` (H8). Header-based inference is not a confirmed group identity; unavailable topology must not be fabricated.

### 2.9 NodeRef and DOM concepts

- **`NodeRef`** = `{navigable, document, backendRef}` (§1.2). It is never a JS wrapper: identity is by *node*, and each realm has its own wrapper (`DOM#concept-node-adopt`).
- **Composed tree.** Queries, hit tests and visibility operate on the *flat/composed* tree. Shadow roots carry their `mode`. "Closed" restricts page code only: protocol DOM agents and BiDi `locateNodes` pierce closed roots, while page-side code (our injected engines) cannot pierce them without help. Stagehand v4 runs as an extension for `openOrClosedShadowRoot`. The adapter states whether closed roots are reachable from injected code as a capability (`closedShadowAccess: "protocol" | "injected" | "none"`).
- **Top layer** (modal dialog, popover, fullscreen) and **inert** subtrees affect hit testing and focus. A top-layer element can still paint for one frame after it closes (H27).
- **`content-visibility`.** Nodes may match selectors but have no boxes until proximity is computed (H28).
- **Retargeting.** `elementsFromPoint` must be called per shadow root to see inside (H26). Slotted nodes hit-test where they *render*.

### 2.10 Input

- **What.** Trusted input injected below the page: pointer (mouse, pen, touch), keyboard, wheel, IME, file selection.
- **Fidelity is a backend property.** `InputFidelity = "native" | "webdriver" | "synthetic"`:
  - `native`: CDP `Input.*`; patched WebKit `Input.*`, which synthesizes platform events in the UI process.
  - `webdriver`: BiDi `input.performActions`.
  - `synthetic`: stock WebKit page-JS shims; `isTrusted === false`, no activation (H21).
- **State.** Kept per (session × Page), as BiDi keys it (`BIDI#input-state`): pressed keys and modifiers, pressed buttons, pointer position, source map, and an **undo list** (the cancel list). CDP input is stateless, so L1 keeps this state itself.
- **Operations** (`Gesture` values compiled per backend):
  - `move`, `down`, `up`, `wheel`, `key down/up`, `insertText` (IME commit, distinct from key presses, H25), `setFiles{element, paths}`. `setFiles` paths are **remote-end paths** under BiDi. A local-file convenience requires a staging/upload capability; if unavailable, report Unsupported rather than interpreting a local path on a remote machine.
  - BiDi compiles sequences to *ticks*; CDP compiles to timed `dispatch*Event` with interpolated moves. Double and triple click sequences explicitly set `clickCount` on CDP mouse events ([protocol definition](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Input.pdl)). Timing and position behavior are backend policy to probe, not a universal 500 ms / 2 px invariant.
  - Input to one Page is serialized (a per-page semaphore). Its acquisition consumes the operation deadline. Actionability is revalidated after acquiring the permit and before dispatch; separate observations need not hold the permit. Multi-step workflows need explicit exclusivity if interleaving would change their meaning.
- **Compensation.** Every `down` pushes its inverse onto the undo list. When a gesture is interrupted or its scope closes, release owned pressed inputs in reverse order (`input.releaseActions` semantics), retaining the input permit during bounded compensation. This is best-effort: a dead transport cannot release input, and a release event can itself trigger page behavior. Record cleanup failure and mark uncertain input state unavailable for further gestures until reset/reconciled; never claim that compensation undid a click or submission.
- **Activation.** Activation-triggering events (trusted `keydown` except Esc, `mousedown`, `pointerdown` for mouse, `pointerup` for non-mouse pointers, `touchend`) grant *transient* and *sticky* activation to the target Window, its ancestors and same-origin descendants. *Consumption* clears transient activation across the whole tab tree (`HTML#consume-user-activation`). L1 tracks a **best-effort activation estimate** per document epoch, which no protocol exposes. The estimate is **diagnostic only**: it explains failures such as "no popup opened because the page had no transient activation", and it never gates an operation. Operations that need activation (opening a popup past the blocker, `requestFullscreen`, `showPicker`, file pickers, beforeunload prompts) declare `requiresActivation`. Gated APIs can also be exercised directly through evaluation with user activation (§2.6). Activation is lost on new Windows and kept across bfcache (H15, H21, H22).
- **Focus.** Key input routes to the *focused area of the top-level traversable*, which requires **system focus** (H24). The adapter focuses the Page through the protocol before key input (`Emulation.setFocusEmulationEnabled` / `setActiveAndFocused`, or activate).
- **Click target.** The click target is the common ancestor of the `pointerdown` and `pointerup` targets *at dispatch time*. A re-render between down and up retargets the click (H20). This is why hit-target verification (§2.17) must cover the trusted event stream, not just a pre-check.

### 2.11 User prompts (obligations)

- **Kinds.** `alert`, `confirm`, `prompt`, `beforeunload` (gates navigation and close), and `print`, which is page-event only and has no BiDi hook. File choosers are a separate obligation kind (§2.11.1).
- **Identity.** `PromptId`, scoped to the navigable that opened it.
- **Blocking semantics.** A simple dialog **pauses the event loop of its agent** (`HTML#pause`). Other documents sharing that agent may also block (H14). Site/group information alone is not always enough to prove sharing; L1 records confirmed and suspected blocking relationships separately. Confirmed blockers produce `PromptBlocking{prompt, resolution}` observations; suspected blockers are diagnostic context and never categorically reject otherwise usable pages. Deadlines bound cases where topology is unavailable. **Prompts do not block** in these cases: suppressed (sandboxed modals, termination nesting, prerender), print, file pickers, permission and HTTP-auth prompts (auth blocks only the *request*).
- **Blocking is waitable while resolution is pending.** `resolution` is `Pending` when a handler or the default policy will resolve the prompt, and `None` when nothing will (no handler, and the policy leaves prompts open). Operations treat `Pending` as a `NotReady` condition and wait within their deadline. A prompt opened by one action therefore never makes the *next* action fail during the default's grace period. Only `None` is terminal for blocked operations.
- **Automatic resolutions are reported, never silent.** Every prompt resolved by a default policy is recorded on the operation that was running when it opened (span event and operation record) and published on `page.prompts`. A later failure on that page includes recent auto-resolutions in its message, for example "`confirm('Delete account?')` was auto-dismissed 0.4 s earlier". Silent auto-dismissal hides application bugs.
- **Decision.** `Accept{text?} | Dismiss`, governed by the shared obligation lifecycle (§2.11.2).
- **Policy.** Each user context has a **default decision policy**: dismiss after a bounded grace period, except `beforeunload`, which accepts. A scoped handler can override it; handler ownership is bounded by its own deadline, not by an unbounded await. Under BiDi the adapter configures `unhandledPromptBehavior` consistently with explicit handling where supported, so automatic remote handling does not race a local handler unnoticed; CDP uses `Page.javascriptDialogOpening` + `handleJavaScriptDialog`; patched WebKit uses the `Dialog.*` domain; stock WebKit uses an explicitly limited JS shim (patched `alert`, `confirm` and `prompt`).

#### 2.11.1 File chooser

The file picker runs in parallel and does **not** pause the page (H23). It is an obligation `Select{paths} | Cancel`, armed per Page *before* the triggering input: CDP `Page.setInterceptFileChooserDialog` (enable only while armed, P8), BiDi `input.fileDialogOpened` + `unhandledPromptBehavior.file`, or WebKit `Page.setInterceptFileChooserDialog`. The default intent is `Cancel`; whether the backend can reproduce native cancellation and its page event is a capability to verify. Do not claim a native event from an unverified shim.

#### 2.11.2 Shared obligation lifecycle

The local state is `Pending → DecisionSelected → Sending → Acknowledged | Rejected | Unknown`, with a separate `Ended` state when the resource disappears before resolution. Atomic selection admits one terminal winner. Handler registrations follow the declaration precedence ladder (P10): scope specificity, then explicit priority, then recency. The chosen chain is snapshotted when the obligation arrives. Only the current handler owns a decision token. `Fallthrough` invalidates that token and grants a new one to the next handler; it is not a remote decision. The obligation also has a total resolution deadline, so a chain of handlers cannot repeatedly reset the budget. A removed registration is skipped even if it was in the arrival-time snapshot.

Returning without deciding or falling through, failure, interruption, scope exit or the handler deadline invokes the phase-specific fallback while still Pending. Once selected, a decision is delivered by a bounded resolver independently of the handler fiber. Losing or expired tokens return `AlreadyDecided`/`HandlerExpired`. Removing a registration stops new assignments; existing obligations fall back or finish under the resolver, so no request is abandoned with its handler scope.

A timeout or disconnect after dispatch records Unknown and never sends a contradictory fallback. A definitive rejection records the error; recovery is allowed only when the backend proves the obligation is still pending, under the same resolver. Optional logging subscribers cannot claim obligations. Handlers needed to unblock an action run before and concurrently with that action (§4.1).

### 2.12 Network: requests, responses, interception, bodies

- **Request.** `RequestId` is stable across redirects, with hops indexed by `redirectCount`. Fields: `navigable` (attribution; may be a worker realm, or absent for service-worker fetches), `navigation: Option<NavigationId>` (BiDi provides this; CDP derives it from `loaderId`), `resourceType`, `method`, `url`, `headers` (merged with the CDP ExtraInfo halves), `isNavigationRequest`, `servedBy: Network | Cache | ServiceWorker` (H17).
- **Lifecycle.** `Sent → ResponseStarted → (Completed | Failed{error})`. Redirects nest inside. Service-worker-served requests can begin at `ResponseStarted` with no `Sent` (normative in BiDi, H17). Requests belonging to a document that has been destroyed may **never** emit a terminal event (fetch-group termination). Ending the owning epoch removes them from that epoch's readiness accounting, but does not prove a remote request failure: keepalive work can outlive the document. Retain attribution as detached while observable, or finish local tracking as `ObservationEnded{reason: OwnerEnded}`. Never fabricate a network failure solely from owner cleanup.
- **Event ordering.** CDP delivers `requestWillBeSent`, `requestPaused` and the ExtraInfo events in several orders: Puppeteer documents four, A–D, including crbug 1196004. The adapter keeps **slots of raw facts per request** and emits each model event exactly once, when its prerequisites are present. Ordering is scoped to the request/hop facts required by that event. Optional asynchronous enrichment cannot block obligation delivery or unrelated state changes (§4); missing enrichment is explicit.
- **Interception** is a declaration plus a stream of obligations:
  - `Intercept{phases ⊆ {Request, Response, Auth}, patterns: UrlPattern[], resourceTypes?, scope: UserContext | Page}` is a scoped resource. The adapter **reconciles** backend enablement from the set of active intercepts, using the union of patterns. It never uses a global `*` unless a predicate-only route demands it, and it never disables interception while any request is still paused (chromium-bidi `CdpTarget` reconciliation).
  - BiDi constraints: intercepts block only if the session is subscribed to the phase's event (the adapter does both), and BiDi intercepts cannot be scoped to a user context. Emulating a context-scoped intercept with a browser-global one would pause traffic in every other context, including observe-only tabs we don't own, and it may outlive a dropped connection (probe 19). Under P9 that emulation is therefore allowed only when every affected context is owned by this client, or with explicit opt-in. Otherwise the request fails with `Unsupported`. Page-scoped intercepts (`contexts`) remain available.
  - **`PausedRequest`** is a phase-indexed obligation. Request phase permits `Continue{overrides} | Fulfill{response} | Fail{reason}` where supported; response phase exposes only the backend-supported response decisions; auth phase permits `ProvideCredentials | DefaultAuth | CancelAuth`. `Fallthrough` transfers local ownership to the next matching handler (§2.11.2).
  - Matching handlers have deterministic precedence and bounded execution. Request/response fallback is continue unchanged where supported; auth fallback is `DefaultAuth` unless explicitly configured otherwise. Unsupported decisions are rejected before selection or dispatch.
  - Each paused request has a handler fiber plus a resolver owned by the interception manager. Registration teardown cannot disable interception until outstanding obligations have reached a known resolution or the manager has reported a bounded cleanup failure. Unknown resolution never counts as acknowledged success.
  - Backend gaps: WebKit has no auth phase and rejects redirect fulfilment; BiDi `failRequest` takes no reason and is not allowed at the auth phase; Firefox accepts a `provideResponse` body only at `beforeRequestSent`. These are capability facts on `Intercept` (§8).
- **Bodies.** A body is fetched lazily and can be *unavailable*: `Body = Effect<Uint8Array, BodyUnavailable{reason: NotCollected | Evicted | Redirect | Streaming | LimitExceeded}>`.
  - BiDi requires a **data collector to exist before the request starts**. `Collector{types, maxSize, scope}` is an internal scoped resource acquired automatically when a wait/capture expresses interest in bodies, before its trigger (§4.1). Its filtering and size limits are explicit. A later request for a body cannot retroactively collect it. Return owned bytes for ordinary body waits, or an explicit scoped body lease for streaming/large data, so closing an observation window does not immediately invalidate its result.
  - CDP buffers bodies with eviction (`Network.getResponseBody`).
  - Streaming bodies use `Fetch.takeResponseBodyAsStream` (CDP) as a `Stream`.
- **Service workers.** Interception may see a request twice (page→SW and SW→network) or never (Cache API). `bypassServiceWorker` is a capability: CDP `Network.setBypassServiceWorker`, no BiDi equivalent (H17).
- **Long-lived connections.** WebSocket and EventSource connections are excluded from network-idle accounting (§2.17), but they are still part of the network model: `Connection{id, kind: WebSocket | EventSource, url, navigable, frames: Stream<Frame>, closed}`. Observing frames is a capability (CDP exposes WebSocket frames natively; BiDi has no equivalent). Mocking or intercepting them needs injected page code and is a separate capability. Both are declared in §8 rather than assumed.

### 2.13 Downloads

`Download{id, navigable, navigation: Option<NavigationId>, url, suggestedFilename}`. It is created by a navigation response with `Content-Disposition: attachment` (and carries the navigation id) or by `<a download>` (no id). Download behavior is a declaration scoped to a user context: `Allow{dir} | Deny`. Events: `progress` and `Done{Completed{path} | Canceled}`. The navigable keeps its old document (H11). WebKit reports downloads at browser level, keyed by `pageProxyId`, and the adapter re-attributes them.

### 2.14 Workers

- **Dedicated worker.** Its realm's owner is the creating document (or worker). It is suspended while its owners are in bfcache, and closed when no longer permissible.
- **Shared worker.** Lives while any owner exists, plus a grace period. Its scope is a child of the user context.
- **Service worker.** `ServiceWorkerRegistration{storageKey, scope}` **persists across sessions** in persistent profiles. Each running instance is a **new realm**; the UA may terminate idle workers at any time, and the next event creates a new one (H18). Its scope is a child of the user context, with the realm scope cycling under a stable registration scope. Never hold SW handles across awaits.
- **CDP specifics.** Attaching to a service worker target keeps it from being destroyed, so attach only when a consumer needs it (Puppeteer detaches them otherwise, `puppeteer` M3). Chromium reports closed workers as *crashed* (`puppeteer` 6a).

### 2.15 Overrides and emulation

Each override is an identified registration `(id, setting, scope: UserContext | Page | Frame?, value, sequence)`. Releasing a registration removes that id, even when it is not newest. The effective value is recomputed from remaining registrations, never restored by blindly popping or writing the released registration's remembered predecessor.

- **Precedence.** The declaration precedence ladder (P10) applies: for settings that genuinely support these scopes, the most specific scope wins (Frame over Page over UserContext over Browser), then explicit priority, then the newest active registration. A parent change still affects descendants without a more specific override. Headers and other mergeable declarations specify their merge rule separately; precedence alone does not define object merging.
- **Application.** The manager serializes updates at the backend's physical setting scope and tracks desired versus acknowledged revisions. Acquisition awaits its application acknowledgement and cannot return success on a failed apply. Failed release/restoration records cleanup failure and uncertain effective state rather than advertising the desired value as fact. Superseded updates cannot overwrite a newer revision.
- **Concurrent use.** Registrations define shared state, not fiber-local isolation. A workflow requiring an unchanged setting acquires a reentrant lease; descendants can nest overrides, unrelated conflicting writers wait within their deadline or get `OverrideConflict`. Remote-global settings require a browser-level lease or an unsupported-isolation result. These leases only coordinate this client; interference by other clients invalidates any exclusivity guarantee.
- **Restoration.** Capture the external baseline when readable. Otherwise require an explicit baseline/reset policy; backend reset is not necessarily restoration of the previous user's state. Attached sessions cannot promise restoration of unknown state. Browser finalizers are a fallback for owned registrations, not permission to reset an external user's settings.
- **Settings.** Viewport/DPR, user agent, locale, timezone, geolocation, media, touch, scripting, network conditions, CPU throttling, cache, headers, CSP, certificate handling, permissions and download policy are capability- and scope-dependent. Success without effect is not sufficient evidence of support. Applying any declaration to future targets follows §3.2.
- **Page time.** Browser-side time (`Date`, `performance.now`, timers, `requestAnimationFrame`) is a setting like any other. Its modes:
  - `Real`, the default.
  - `Fixed{at}` or `Offset{by}`: shifts what the page sees as "now".
  - `Virtual{policy}`: the backend's virtual time (CDP `Emulation.setVirtualTimePolicy`: pause, advance, budget, pause while fetches are pending).
  - `Controlled`: injected fake timers that the driver advances explicitly (`install`, `pauseAt`, `runFor`, `fastForward`). Playwright's BSD-licensed clock is prior art.

  `Controlled` and `Fixed` are implemented through a preload script and so require `timing: "beforeAuthorScript"` (P9); otherwise the page may have captured real timers first. Each mode is a per-backend capability (probe 21). Page time is independent of the driver's own deadline clock (§5.2): advancing page time never advances operation deadlines, and test clocks never freeze the browser.

### 2.16 Storage, cookies, permissions

- **Partitioning.** Storage is keyed by user context **and partition key** (top-level site plus an ancestor bit or nonce in Chromium; `originAttributes` in Firefox; WebKit is its own scheme). The spec still says "origin" (`STORAGE#storage-key`), and implementations don't. `PartitionKey` is an opaque, backend-specific value with a neutral `{topLevelSite?, crossSiteAncestor?}` view (H29).
- **Cookies.** `Cookie{name, value, domain, path, expires, httpOnly, secure, sameSite, partitionKey?}`. CHIPS `Partitioned` cookies require `Secure`. Reads and writes always state their partition.
- **StorageState** (snapshot/restore): `{version, source?: {backend, userContext}, cookies[], origins: [{origin, partitionKey?, localStorage, indexedDB?}]}`. Source context is provenance, not a restriction on the destination: restoring login state into a fresh user context is supported. Portable origin/site partitions are preserved within the destination context. Opaque backend-specific keys require a compatible explicit mapping or produce `StorageStateIncompatible`; never silently move data between unrelated site partitions. Restore preflights known incompatibilities and reports partial application if later writes fail; it is not a browser-wide transaction. Session storage is per Page and cloned only into popups that keep their opener.
- **Permissions.** `(descriptor, origin, topLevelOrigin?) → granted | denied | prompt`, scoped to a user context: the BiDi `permissions.setPermission` extension, CDP `Browser.grantPermissions` / `setPermission`, or WebKit `Emulation.grantPermissions`. The result is ANDed with Permissions Policy, so an iframe `allow=` attribute can still deny.

### 2.17 Readiness predicates (precise definitions)

Prior art relies on loose words ("visible", "stable", "idle"). L1 defines each one precisely. Each predicate yields `Ready | NotReady{reason, observedAt}` or an observation error. A reason describes the present condition, not proof that it can never improve. L2 chooses whether to retry, wait for invalidation, scroll, activate or fail. Negative observations and inability to obtain an observation are distinct; deadlines guarantee bounded waiting.

| Predicate | Definition | Current-condition diagnostics |
|---|---|---|
| **Connected** | Operation-time connectivity and document-binding check (§1.3) | `Replaced`, `Detached`, `Suspended` (surfaced as `StaleRef{reason}` for explicit refs) |
| **Visible** | `checkVisibility({contentVisibilityAuto, opacityProperty, visibilityProperty})` and a non-empty client rect. For `display: contents`, any visible child counts (`CSSOMVIEW#dom-element-checkvisibility`; Playwright `domUtils`) | `NoBox`, `ContentVisibilitySkipped` |
| **Stable** | Bounding rect unchanged across *k* consecutive rendering updates. *k* = 2 frames on Chromium, Firefox and BiDi; 6 frames on WebKit/Windows, skipping frames under 15 ms. These are initial policy defaults to measure, not protocol capabilities | `NoRenderingOpportunity{lastFrameAt, visibility}` when updates are not observed; visibility alone does not prove rendering has stopped (H19) |
| **Enabled** | ARIA-disabled semantics: native `disabled`, `fieldset` inheritance and `aria-disabled` (Playwright `getAriaDisabled`; Puppeteer checks only native `disabled`) | — |
| **Editable** | Enabled, and not `readonly` or `aria-readonly`, and an editable element type | `NotEditableType` (terminal for this resolved target; locator re-resolution is a policy decision) |
| **NotInert** | Not in an inert subtree (modal dialog, `inert` attribute) | `BlockedByModal{dialog}` |
| **InViewport** | At least one content quad intersects the viewport with area > 0.99 CSS px²; scrolling is a separate action policy | `OutsideViewport`; failed scrolling is an action diagnostic |
| **ReceivesPointer** (hit-testable) | WebDriver *pointer-interactable*. At the action point (the centre of the first in-viewport content quad, rounded), the top of the composed-tree hit test (`elementsFromPoint` per shadow root, walking iframe ancestors with border and padding offsets) is the target or a descendant (`WD#dfn-pointer-interactable`; Playwright `expectHitTarget`). **Verified twice**: a pre-check, plus a capture-phase guard on the first *trusted* event that blocks dispatch on mismatch (layout shift between check and input, H20). | `Covered{by: NodeDescription, subtreeRoot}` |
| **NetworkIdle(N, T, exclude)** | For navigable subtree N: the count of in-flight requests attributed to N's fully active documents and their dedicated workers has been zero for T ms. Excluded by default: WebSocket, EventSource, streaming bodies, keepalive/beacon, favicon, and client-less SW fetches. Count is reset when a document epoch ends (`platform-concept-model` §3.12; Playwright uses 500 ms over the subtree) | `LongPolling{requests}` (diagnostic after T×k) |
| **DomQuiet(T)** | No mutation records in the subtree for T ms. Uses an injected `MutationObserver` over the composed tree via a channel; it must explicitly observe shadow roots, because `subtree` does not cross them (`puppeteer` M5) | — |
| **PromptFree** | No known prompt blocking the navigable; report observation coverage when event-loop topology is unknown | `PromptBlocking{prompt, resolution: Pending \| None}`. `Pending` is waitable (§2.11) |

**Actionability** (L2 vocabulary) selects observations and preparation policies. Compatible instantaneous DOM predicates are batched in one injected evaluation; stability requires multiple rendering samples and cross-frame checks may require more than one realm. No batch is an atomic guarantee covering the subsequent input. Presets below are proposals to validate through call sites, not locked L1 semantics:

- `click`/`hover`: Visible, Stable, Enabled (click only), NotInert, InViewport, ReceivesPointer.
- `fill`: Visible, Enabled, Editable, NotInert.

Users can adjust individual predicates instead of using a blanket `force` (Playwright #34436). In particular, perceived visibility, hit testing and click policy are distinct: opacity checks do not define whether a node can receive input. Defaults and names must make that distinction clear.

### 2.18 Capture

| Capture | CDP | BiDi | WebKit |
|---|---|---|---|
| **Screenshot** (viewport, full page, clip, element) | `Page.captureScreenshot` | `browsingContext.captureScreenshot` | `Playwright.takePageScreenshot` / `Page.snapshotRect` (stock) |
| **PDF** | `Page.printToPDF` (streamable via `IO`) | `browsingContext.print` (base64) | — |
| **Screencast** | `Stream<Frame>`: `Page.startScreencast` + ack | writes a **file on the remote end** (`startScreencast` → path) | patched `Screencast.*` |

Screencast through BiDi is not an equivalent `Stream`; it is a separate capability (`screencastFrames` vs `screencastFile`). Full-page screenshots over about 16k px crash some stacks (browser-use), so the adapter tiles them.

### 2.19 Console, errors, logs

`ConsoleMessage{realm, level, args: RemoteValue[], stack?}` and `PageError{realm, exception}`. Under BiDi, `log.entryAdded` is buffered by the remote end until subscribed and replayed on subscribe. Under CDP it requires `Runtime.enable`: in the **OnDemand realm strategy (stealth) console capture is unavailable**, because enabling Runtime is the detection vector (`non-js-cdp-clients` §7).

### 2.20 Sensitive values

Some values are secrets in both directions, and tracing is on by default (§7), so redaction has to be structural (P12).

- **Inbound.** Operations that accept secrets take Effect `Redacted<string>`: typed or inserted text (`insertText`, fill), `ProvideCredentials` for HTTP auth, cookie values and header values in declarations. Plain strings remain accepted, but the type makes the redacted path the obvious one for credentials.
- **Outbound.** Values that are usually secret are returned as `Redacted`: cookie values (including inside `StorageState`), `Authorization`, `Cookie` and `Set-Cookie` header values on request and response events, and credential prompts. Callers unwrap them explicitly with `Redacted.value`.
- **Never rendered.** Spans, span events, operation records, error messages, `NotReady` histories and agent-facing snapshots render `Redacted` values as `<redacted>`. Values typed into fields marked `type=password` are redacted in traces even when passed as plain strings.
- **Agent tooling.** Agent toolkits refer to secrets by name (placeholders resolved by the driver, as in browser-use and Stagehand), so a model never sees the value. Substitution happens inside L1 at dispatch time, under the same redaction rules.

---

## 3. Lifecycles in Effect

### 3.1 Lifetimes, scopes and release policies

The model's containment graph, operation lifetimes and remote destruction ownership are related but distinct. A Page is a navigable and directly owns its main document; child frames are associated with the parent document that created them. Suspended documents retain their subtrees until evicted. Realms are siblings linked to documents because of initial-blank Window reuse.

```text
Browser lifetime + cleanup scope
└─ UserContext lifetime + cleanup scope
   ├─ declarations and their managers
   └─ Page / Navigable lifetime + cleanup scope
      ├─ Document epochs (active, suspended, ended)
      │  └─ child Frame / Navigable lifetimes
      ├─ Realm lifetimes linked to document epochs
      ├─ navigation and operation records
      └─ obligation managers
Caller scopes own narrow handles, subscriptions and observation windows.
```

- **Release policy.** Every page/context records `ObserveOnly | CloseOwned | RemoveOwned` as appropriate to its kind. Handles and declarations record their own disown/remove policy; Browser ownership is specified in §2.1. The default context and pre-existing attached pages are ObserveOnly. Contexts/pages explicitly created through the library are owned unless the creation API explicitly transfers ownership. Browser launch owns the process; attachment does not. Ending observation releases local subscriptions and handles without closing the observed page or removing its context. **Popups follow their opener.** A popup opened by an owned page is owned (`CloseOwned`) whichever context it lands in, unless explicitly released. A popup opened by an observe-only page is `ObserveOnly` unless explicitly taken into ownership. So "attach, create a temporary page, release" cleans up the temporary page's popups and leaves the user's tabs alone (acceptance scenario 7). `Origin` is descriptive and never substitutes for release policy.
- **Ownership ledger.** Ownership is recorded in a ledger keyed by model id with the backend correlation evidence (context ids, target ids). The ledger lives with the connection by default. It can be provided as a persistent service (for example a `KeyValueStore`), so that after a dropped connection to a remote browser, a later connection can recognize and clean up resources the earlier one owned. Without that, they would only look adopted and would leak. Reconnection itself is out of scope for now; the ledger makes reclaiming possible rather than impossible. Where a backend can tag resources remotely, the tag is extra evidence, not a requirement.
- **Request close vs end lifetime.** `page.close({promptUnload: true})` requests a transition and waits for confirmation. Dismissal returns `CloseCanceled{reason: BeforeUnload}` without ending the scope. A close timeout leaves closure unconfirmed and records uncertainty (§5), not a fabricated PageClosed. Owned-resource finalization uses an explicit bounded teardown policy rather than an interactive, cancelable close: close without beforeunload where supported, then report any failure. It may escalate only within owned resources; an attached browser process is never killed.
- **Lifetime signal.** Each object has a single-assignment `closed: Effect<CloseReason>` and a cleanup Scope. `within<A, E, R>(effect)` has type `Effect<A, E | TargetGone, R>`, where `TargetGone{object, reason: CloseReason, dispatch}` is the single lifetime error tag (P11). It arbitrates completion against lifetime end before requesting child cleanup. A remote end first records/publishes its reason; operation waiters receive that reason through this arbitration. Closing the scope with `Exit.fail(reason)` alone only interrupts forked fibers. Caller interruption retains its Effect Cause and is not converted into a catchable lifetime error. Which event wins an actual race is recorded once; cleanup cannot overwrite a completed result.
- **Remote facts and model loss.** A remote close invalidates local bindings and releases local resources; it does not send another remote close. Permanent loss of observation ends the model lifetime with ConnectionLost or ModelUnavailable without asserting destruction of the remote object. A temporary quarantine fails current operations through an availability signal without completing `closed`; resynchronization must establish valid bindings before new operations resume. If continuity cannot be established, end the old model lifetimes and expose newly discovered resources.
- **Ownership defaults.** `context.newPage()` registers cleanup with the context and returns `Effect<Page, E>` without Scope in R. `withPage(f)` narrows that lifetime; handles and subscriptions are caller-scoped. Closing a caller scope releases only the handles it owns, not every handle in the realm. Parent cleanup never assumes ownership of adopted children solely from containment.
- **Suspension.** This is domain state plus a signal/latch, not a built-in Scope operation. Known suspension makes explicit-ref operations fail with `StaleRef{reason: Suspended}`; a waiting policy may opt in to resume under its deadline. Waiting does not create a new usable realm or revive invalid protocol handles.
- **Cleanup order.** Keep transport, ingestion and obligation resolvers alive while owned page/context teardown still needs them. Stop new work, resolve/drain obligations within their cleanup budget, release declarations and owned resources in dependency order, then disconnect or close the owned process. Pages can close concurrently where safe. Finalizers are uninterruptible at the outer resource boundary but their remote waits are bounded and permit timeout cancellation; cleanup failure is reported separately from the original operation failure. No global dependency needed by teardown is finalized early merely because it appears later in a scope tree.

Close reasons are tagged data with object id, last known URL/title and operation context:

```ts
type CloseReason =
  | BrowserClosed | BrowserCrashed | ConnectionLost | ModelUnavailable
  | UserContextRemoved | ObservationReleased
  | PageClosed | PageCrashed
  | FrameDetached
  | DocumentReplaced | DocumentEvicted | DocumentDestroyed | DocumentUnloaded
  | RealmDestroyed
```

Reason variants carry their relevant cause and identifiers. Callers never see `CloseReason` variants as top-level error tags: they arrive as the `reason` of one `TargetGone` error, matched with `catchTag("TargetGone")` and refined with `catchReason` (P11, §6). A reason is a statement about this model lifetime; remote destruction is claimed only when observed. The explicit lifetime signal and resource release policy are the contract; Scope is the mechanism for cleanup.

### 3.2 Target attach: pause, configure, resume

Initialization has `Initializing → Ready | Failed` state and an acknowledged configuration revision. A target is published as usable only after its required setup succeeds. Diagnostic target discovery may precede Ready, but normal page acquisition awaits initialization.

1. Establish routing, lifetime observation and bounded buffering, then attach with pause-on-start where supported. Reconcile auto-attach for child targets. Existing running targets carry an explicit limited document-start guarantee.
2. Install required state tracking and reconcile the initial frame/document snapshot with buffered events. Assign realm/world bindings according to the chosen strategy. Install bindings before scripts that call them; prepare body collectors and subscriptions before intercepts or triggering traffic. Independent setup may run concurrently, but dependency ordering is explicit.
3. Apply the effective declaration revision: overrides, preloads, intercept patterns, policies, utility scripts and file-chooser interception as needed. `runImmediately` is a separate opted-in action for an already-existing document. Classify failures as required (initialization fails) or optional (capability unavailable with a recorded reason). `allSettled` may collect diagnostics but may not turn required failures into success.
4. Coordinate concurrent registration changes with initialization so a target cannot escape configuration between a snapshot of declarations and publication. Resume after required acknowledgements, then publish Ready. A declaration removed during setup is reconciled before that revision is considered effective.
5. On failure or interruption, release partial owned registrations and close a newly-owned target where possible. Resume/detach an external paused target under bounded cleanup so we do not leave it frozen. This is cleanup, never successful initialization. Record any unresolved pause or cleanup failure.

CDP and patched WebKit compile declarations through this process. BiDi uses native declaration scopes where supported; unsupported scopes require adapter reconciliation or an explicit Unsupported. Configuration on already-running documents cannot retroactively precede author code. The same initialization gate applies after a session swap.

### 3.3 Adoption

The browser can create resources without any user call: popups, `window.open`, `target=_blank` and workers. Existing resources are also discovered on attach. They enter the model with origin metadata and an explicit release policy (§3.1). Adoption means observation, not unconditional destruction ownership.

`expectPopup(action)` acquires its observation window before the action, filters by original opener where available and waits within one deadline. An unrelated popup from the same opener can match; URL/predicate filters and an explicit first-match or ambiguity policy are needed. If a backend cannot report original opener reliably, expose that limitation rather than inventing causation. Popup handlers can run while the triggering action is pending.

### 3.4 Process swaps

L1 holds each navigable's current adapter session in a `SubscriptionRef<SessionBinding>`:

- **CDP OOPIF swap:** `frameDetached{swap}`, then iframe target attach.
- **CDP prerender activation:** `isPageTargetBecomingPrimary`, then a session swap with the main frame re-keyed.
- **WebKit provisional page:** `targetCreated{isProvisional}` → `didCommitProvisionalTarget{old, new}`.

On a swap, declarations are reconciled through the new session's initialization gate. Events from old sessions are classified by their resource/generation: reject stale frame updates, but still route late replies and request completions needed for cleanup or reconciliation. An in-flight command may retry only with valid target semantics and dispatch evidence (§6); otherwise a mutation records uncertain execution (§5). Requests spanning sessions require explicit correlation evidence. URL alone is ambiguous when several requests use the same URL; a backend heuristic must preserve ambiguity rather than merge unrelated requests.

---

## 4. Ingestion and ordering

1. **Transport.** One reader per connection; writes fail promptly after closure. Pipe fd3 is a long-lived outbox and fd4 uses NUL framing. WebSocket framing has an explicit size limit. Transport and protocol routing remain alive through remote cleanup.
2. **Dispatcher.** Decode the envelope and assign a local monotonic receive sequence. Route replies to pending-command/operation records and events to ordered per-session folds. Reply delivery must not wait for user consumers, optional enrichment or a full event queue. A reply arriving after an event on the wire does not itself imply that the event has been folded.
3. **State fold.** Required event schemas are decoded in the fold. Update authoritative state before publishing the corresponding model event. Fold transitions do not await browser commands, user code or asynchronous enrichment. Cross-session updates use resource/generation identity and explicit arbitration; wire order is not a substitute for those rules.
4. **Integrity failures.** An optional telemetry decode failure can fail only that stream. Failure to decode a required lifetime/identity event, or overflow of the core queue, marks the affected session `ModelUnavailable{reason}` and wakes waiters. Stop dependent operations and fail or quarantine the session; retain best-effort cleanup routing where possible. Resume only after a backend-specific snapshot plus event reconciliation proves a consistent generation. If no safe resynchronization exists, end the session. Envelope corruption that prevents routing ends the connection.
5. **Buffering and enrichment.** Core queues have explicit item/byte limits; reaching a limit fails integrity rather than silently dropping or blocking the shared reader. Public subscribers have separate bounded buffers: exact event consumers fail with `EventOverflow`, while opt-in sliding consumers receive a gap indication. **Subscriptions carry their filter, and the publisher evaluates it before buffering**, so a consumer's buffer holds only matching events. A combinator waiting for one response therefore cannot overflow on unrelated traffic. Filters run synchronously on already-folded model events and must not await. State snapshots can coalesce revisions explicitly. Optional enrichment is lazy or delivered separately with correlation ids; if an enriched ordered stream is offered, its head-of-line wait has its own limit and cannot delay prompt/request resolution or the state fold. Stream termination and lifetime signals do not rely on free space in a data buffer.
6. **Local processing barrier.** `drainObserved` captures the receive watermark for selected sessions and waits for their folds to process the already-ingested events through that watermark, or fail integrity. It does not await future events, asynchronous enrichment or all effects caused by previously sent commands. A backend round trip can gather more evidence but adds no universal causal guarantee. CDP describes `Page.enable` only as enabling notifications ([protocol definition](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl)).
7. **Cross-session ordering.** There is no total browser-wide event order. Use navigation/request identity, frame generations and opener metadata where available. If attribution is unknown, retain unknown. User handlers always run outside ingestion and state-fold fibers.
8. **How public streams end.** An event stream owned by a model object (`page.requests`, `page.console`, `frame.navigations`, and so on) **ends successfully** when its owner ends normally: closed by command, closed by script, user context removed, document replaced, or observation released. A consumer's `Stream.runForEach` then simply finishes. The stream **fails with `TargetGone{reason}`** when the owner ends abnormally (crash, connection lost, `ModelUnavailable`), and with `EventOverflow` on overflow. Which reasons count as normal is fixed per object kind and documented with each stream.

### 4.1 Observation windows

An observation window is an internal scoped resource that coordinates eager subscriptions, collectors and handlers needed by one user operation. It is the foundation for popup, response-body, navigation and dialog combinators; users normally see the combinator, not the resource plumbing.

1. Acquire local subscriptions and await required remote enablement; install data collectors and obligation handlers before the trigger. If this fails, do not trigger.
2. Establish predicates, starting state and a local sequence watermark. Run observation/handlers concurrently with the trigger so a prompt or paused request cannot deadlock the trigger.
3. Correlate by the strongest available identity and explicit filter. Temporal inclusion alone does not prove causation. Preserve the distinction between waiting for current state and for a new matching event.
4. Define the completion rule per combinator: normally both trigger completion and the requested observation. A failed trigger is preserved; any already-created resources still follow ownership cleanup. A satisfied observation does not silently discard a failed trigger. An unresolved trigger at deadline retains its dispatch uncertainty. Explicitly document alternative completion policies.
5. All stages share the operation deadline (§5.2). On exit, unsubscribe and release collectors/handlers under the cleanup budget. Materialize ordinary returned bodies as owned bytes, or return an explicit caller-scoped lease. Returned Pages follow their own release policy, not an accidental lifetime tied to the observation window.

---

## 5. Interruption, compensation and outcomes

Caller cancellation remains Effect interruption. Lifetime end, observation timeout and protocol failure are distinct events; none proves that an already-dispatched mutation did not execute. Ordinary public operations return `Effect<A, E, R>`, not a nested Exit that callers must unpack for every action.

### 5.1 Operation records and dispatch uncertainty

Each user operation has an internal id and record, linked to its trace. It tracks target/document generation, deadline, attempts and these independent axes:

- **Dispatch:** `NotSent | MayHaveBeenSent | Acknowledged`. Set MayHaveBeenSent before an asynchronous write crosses a boundary where delivery is uncertain. A write failure is NotSent only if the transport proves that nothing was delivered. Acknowledgement can be success or a definitive rejection and is not proof of the application's intended result.
- **Observation:** `Pending | Observed{result, evidence} | Unknown{cause, lastObserved}`. A high-level action can include several commands; record partial dispatch rather than reducing it to one success flag.
- **Caller:** `Waiting | Completed | Failed | Interrupted`. Finishing the caller does not erase remote work.
- **Cleanup:** `NotNeeded | Pending | Completed | Failed{cause}`. Completion is specific to cleanup, not reversal of page side effects.

If a caller is still waiting, the uncertainty travels **on the error it receives**, never as a separate tag (P11). A deadline after uncertain mutating dispatch gives `Timeout{phase: "dispatchedUnconfirmed", dispatch: MayHaveBeenSent, operationId, lastObserved}`. Transport loss or a lost session binding gives `TargetGone{reason, dispatch: MayHaveBeenSent, operationId}`. A caller that wants to know "did my click happen?" reads `dispatch`; a caller that doesn't care catches one tag. If the caller was interrupted, preserve that Cause and record uncertainty for diagnostics/optional inspection rather than pretending to return a catchable error to the canceled fiber. Known remote completion and interruption can race; atomically retain the observed result and caller status independently.

Pending ids for abandoned queries can be tombstoned. Resource-creating replies retain a cleanup route: a late newPage/newContext/handle/preload/intercept result must be adopted into the intended owner if still live, or released according to its explicit ownership policy. Keep these routes outside the canceled caller scope. Reconcile through resource events where possible. Bound retained records and reconciliation time; on expiry, report an unresolved possible resource leak and preserve any identifier in diagnostics. Unknown late ids after expiry are ignored, never reused for a new command.

| Operation class | Before dispatch | After dispatch if caller is interrupted | Compensation / recovery |
|---|---|---|---|
| Library read/query | No remote work | Detach waiter; record interruption | Retry only with valid target/generation semantics (§6) |
| Author evaluation | No remote work | Result and side effects may be unknown | No automatic re-evaluation; optional backend-specific termination is explicit and may affect other execution |
| Navigation | No remote work | May continue; retain navigation evidence | Do not automatically navigate again or stop a newer navigation; cancellation requires a separately supported, correlated operation |
| Input gesture | No remote work | Partial input may have reached the page | Bounded release of owned pressed inputs; record failures and resulting input uncertainty |
| Obligation decision | Pending can fall back | Selected resolver continues independently | No contradictory second decision after uncertain dispatch (§2.11.2) |
| Resource creation | No resource requested | Resource may exist remotely | Late-reply/event reconciliation and owned cleanup |
| Resource release | Resource still live | Remote closure may remain unknown | Bounded cleanup; escalate only within owned resources |

The operation record is internal by default. L2 may expose a diagnostic/inspection handle for agents or recovery flows; ordinary `click`, `goto` and reads keep simple Effect results. `Exit` remains available through normal Effect combinators without a special browser outcome wrapper.

### 5.2 One operation deadline

One monotonic deadline covers the entire user operation: acquiring permits/leases, setting up an observation window, resolving a locator, checking actionability, dispatching and waiting for the requested postcondition. Nested calls inherit the remaining budget; an explicit nested timeout may shorten it but never restart or extend the parent deadline. Nested retry loops do not multiply budgets or re-dispatch an outer mutation.

Cleanup has a separate bounded budget so caller timeout still permits release of held input and owned resources. Preserve the primary failure and attach cleanup diagnostics rather than replacing it with a later timeout. Deadline failures are one `Timeout` tag. Its `phase` (`resolving | waitingForCondition | dispatchedUnconfirmed | postcondition`) and `dispatch` fields distinguish a failed condition observation, no completed observation, and uncertain execution after dispatch. `waitingForCondition` carries the last `NotReady` observation and its de-duplicated history, so the error answers "was it ever ready?".

Clock and deadline policy are injectable. Real-browser layers use a live monotonic clock for operational deadlines even when the surrounding test uses TestClock; in-memory adapter/model tests can supply a controllable clock. Browser wall-clock event timestamps and trace timestamps are separate from monotonic deadline arithmetic. This keeps production waits bounded without making deterministic model tests impossible.

---

## 6. Error vocabulary (L1)

Ordinary operations follow P11. Their error channel is the lifetime tag, the deadline tag and the verb's own domain error, with detail in fields recovered by `catchReason`. Names are conceptual, not a finalized exported union.

| Family | Tag | Fields | Appears on |
|---|---|---|---|
| **Lifetime** | `TargetGone` | `object` (id, kind, last URL/title), `reason: CloseReason` (§3.1, including `ConnectionLost` and `ModelUnavailable`), `dispatch`, `operationId` | Every operation that depends on an object staying alive |
| **Deadline** | `Timeout` | `operation`, `phase: resolving \| waitingForCondition \| dispatchedUnconfirmed \| postcondition`, `dispatch`, `lastObserved`, `history`, `operationId` | Every operation with a deadline (§5.2). It replaces draft 2's `OutcomeUnknown`, `NavigationUnobserved` and `CommandTimeout` |
| **Domain** | one per verb family | `NavigationError{reason}` (§2.8 projection); `EvaluationError{reason: JsException \| Unserializable}`; `StaleRef{ref, reason: Replaced \| Detached \| Suspended \| BindingLost}` (explicit refs and handles only; locators re-resolve instead); `BodyUnavailable{reason}`; `CloseCanceled`; `ObligationError{reason: AlreadyDecided \| HandlerExpired}`; `OverrideConflict`; `StorageStateIncompatible`; `PromptUnhandled{prompt}` (only when a policy leaves prompts open, §2.11); `LaunchError{reason: IncompatibleBrowserRevision \| InitializationFailed \| …}` | The verb that produces them |
| **Capability** | `Unsupported` | `capability`, `backend`, `method?` | Only where the capability is not statically known for the instance (P7). Normalizes vendor "not implemented" strings: Chrome's `unknown error - Method X is not implemented`, WebKit "Method not implemented" |
| **Stream** | `EventOverflow` | `stream` | Event streams only (§4) |

- **Unexpected protocol failures are defects at L1/L2 verbs.** Examples: an unexpected `ProtocolError{method, code, message}`, a result that fails its schema (`DecodeError`), an adapter invariant violation. Callers cannot meaningfully recover from these, and making them typed would put a protocol tag on every signature. They die with full context, and the operation record and span keep the details. Expected protocol conditions are normalized into the families above. Raw L0 command APIs keep a typed `ProtocolError` for callers who work at that level. This choice is to be validated against the DESIGN.md acceptance scenarios.
- **`SessionSwapped` is internal.** L1 either retries (§6 rules below) or surfaces `TargetGone{reason, dispatch}`.
- **Observations are not errors.** `NotReady{predicate, reason}` (including `PromptBlocking` and suspension) feeds waits. At the deadline it becomes `Timeout{phase: "waitingForCondition"}` carrying the last observation and history. Strict-match ambiguity is such an observation: it is retried until the deadline, and the final `Timeout` lists the candidates.

Retry policy is centralized but depends on `(error, operation kind, phase, target binding, dispatch evidence, remaining deadline)`. Adapters normalize vendor errors at their boundary; higher layers never choose retry behavior by message substring. A tag alone is insufficient:

- Before dispatch, a locator may re-resolve a replaced/detached node. An explicit NodeRef/HandleRef never silently becomes a different object.
- A page-level read may restart on a new document only if its contract asks for current state. A read bound to a particular document must not retarget it.
- Library-generated read-only probes can retry when binding semantics remain valid. Arbitrary author evaluation is not assumed pure because it looks like a query.
- Once input or another mutation may have reached the browser, failed observation is not permission to repeat it. Re-observe without replaying the mutation, unless a specific operation proves safe repetition.
- An uncertain operation is never retried automatically merely because its underlying transport error is classified transient. An explicit user retry can still repeat side effects; expose the operation id and dispatch diagnostics.

Separate resolving/re-observing from dispatch attempts in tracing and implementation. A click whose mouse-down submitted a form must not submit it again because a later readiness check failed.

---

## 7. Observability built into the model

Every model operation is an `Effect.fn`-traced span: `navigable.navigate`, `realm.evaluate`, `input.gesture`. Protocol commands are child spans at `level: Debug`, with `protocol.method` and `protocol.session`. Retry attempts and predicate results become **span events**, which is Playwright's call log as structured data. Navigation outcomes, close reasons and obligation decisions are span attributes.

Use the deadline clock policy in §5.2 and record observation timing separately from protocol timestamps. Traces include operation ids, dispatch phase, confirmed versus inferred evidence, and cleanup status. In particular, "no matching event observed" is not emitted as "the action had no effect".

Two rules keep traces safe and honest:
- **Redaction.** `Redacted` values, and anything §2.20 classifies as secret, are rendered as `<redacted>` in span attributes, span events, logs and error messages. The tracer enforces this, not each call site (P12).
- **Auto-resolutions are visible.** Obligations resolved by a default policy (dialogs, file choosers, unhandled paused requests) become span events on the operation that was running when they arrived (§2.11).

---

## 8. Capabilities

A `CapabilitySet` is bound to a connected browser and refined by context/page configuration, backend revision and target kind. Entries are `Supported{evidence, limitations} | Unsupported{reason} | Unknown`. Static profiles are starting evidence, not proof of every advertised behavior. Probe uncertain behavior only in an owned disposable target or through a read-only check; do not mutate adopted pages as a side effect of capability discovery. Cache results by relevant backend revision, configuration and scope rather than method name alone.

L2 exposes instance-bound capability handles (for example an AX-tree reader tied to a particular page) or refines a statically known browser/page type. A capability from browser A cannot authorize an operation on browser B. Runtime-selected backends/configurations require checking or refinement before specialized use. Common methods capture implementation dependencies at construction and keep ordinary call sites free of platform services; advanced caller-scoped operations may still require Scope. Ambient services can configure factories but are not evidence that an arbitrary page supports a feature.

The following matrix preserves the research snapshot. It is a planning inventory, not a conformance result for draft 2. Unknown/unverified entries remain probe work (§9), and policy defaults such as stability sampling are not capabilities.

| Capability | CDP (Chromium) | BiDi: Chrome (chromium-bidi) | BiDi: Firefox | WebKit (Playwright-patched) | WebKit (stock: iOS / WKWebView / GTK inspector) | Safari BiDi (STP, experimental) |
|---|---|---|---|---|---|---|
| own process / headless | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | **attach-only** | ✓ / ✗ |
| user contexts (parallel isolation) | ✓ | ✓ | ✓ | ✓ | ✗ | **✗** |
| page / popup events | ✓ | ✓ | ✓ | ✓ (`pageProxyCreated`) | **poll** `/json` | ✓ |
| pause-configure-resume | ✓ | n/a (declarative) | n/a | ✓ (`Target.resume`) | partial (`setPauseOnStart`) | n/a |
| isolated worlds | ✓ | ✓ (sandbox) | ✓ | ✓ (`createUserWorld`) | **✗** | partial (unverified) |
| input fidelity | native | webdriver | webdriver | native | **synthetic** | webdriver (just landed) |
| network events | ✓ | ✓ | ✓ | ✓ | ✓ | **✗** |
| interception phases | req, resp, auth | req, resp, auth | req, resp (body at req only), auth | req (resp upstream); no auth | req, resp | ✗ |
| body access | buffered + stream | collectors | collectors (Fx 143+) | `getResponseBody` | `getResponseBody` | ✗ |
| realm discovery | tracked / on-demand | tracked | tracked | tracked | tracked | partial |
| console | ✓ (needs Runtime) | ✓ | ✓ | ✓ | ✓ | **✗ (not delivered)** |
| prompts | ✓ | ✓ | ✓ | ✓ (`Dialog`) | JS shim | ✓ |
| file chooser interception | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| downloads | ✓ | ✓ | ✓ | ✓ (browser-level) | ✗ | ✗ |
| screencast | frames | **✗** | file (Fx 154+) | frames | ✗ | ✗ |
| PDF | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| AX tree | ✓ | ✗ (locator only) | ✗ | partial | partial | ✗ |
| tracing / coverage / CPU throttling | ✓ | via `goog:cdp` | `moz:profiler` | ✗ | ✗ | ✗ |
| bypass service worker | ✓ | ✗ | ✗ | ? | ? | ✗ |
| evaluation with user activation | ✓ (`userGesture`) | ✓ (`userActivation`; probe 20) | ✓ (`userActivation`; probe 20) | ✓ (`emulateUserGesture`) | ? | ? |
| page time: virtual | ✓ (`setVirtualTimePolicy`) | ✗ | ✗ | ✗ | ✗ | ✗ |
| page time: controlled / fixed (needs before-author-script preload) | ✓ | ✓ | ✓ | ✓ | ? | ? |
| WebSocket frame observation | ✓ | ✗ | ✗ | ✓ (`Network.webSocket*`) | ✓ (`Network.webSocket*`) | ✗ |
| closed shadow access from injected code | via protocol DOM | via `locateNodes` | via `locateNodes` | via protocol DOM | via protocol DOM | ? |
| protocol stability | per Chromium major (pinned codegen) | spec + chromium-bidi | spec | **revision-pinned; ~27% of rolls change it** | per Safari version | spec; impl. partial |

Sources: `webdriver-bidi` support matrix; `webkit` capability matrix and §1.3–1.7; `playwright-internals`; `puppeteer` M1. `?` marks items that still need probing (§9).

**WebKit notes** (from `research/webkit.md`):
- **Patched WebKit is not Safari, and its protocol churns.** Generate schemas from the `protocol.json` shipped in each build zip, and verify them at launch (`IncompatibleBrowserRevision`).
- **Safari BiDi is reachable only on Technology Preview,** and only when both `webSocketUrl` and `safari:experimentalWebSocketUrl` are set. wpt.fyi shows 0/4338 BiDi subtests for STP 254.
- **WebKitGTK/WPE BiDi (Igalia)** passes about 23% of BiDi WPT subtests, has no network or emulation modules, and is off in every distro build. It suits a smoke-test lane, not a primary backend.
- **Classic `safaridriver`** allows one session per Mac and has no events, interception or console. Its main role is bootstrapping the BiDi session.
- **Stable Safari 27 shipped an MCP server** (`safaridriver --mcp`), not BiDi.

**Backend order:** CDP; then BiDi (Firefox, plus Chrome as a cross-check); then a WebKit inspector client with a **patched** profile (Playwright builds) and an attach-only **stock** profile (iOS, WebViews); Safari and WebKitGTK as experimental quirk profiles of the BiDi backend.

---

## 9. Conformance probes (open questions to measure, not argue)

The specs leave key orderings and identities undefined, and the notes disagree. Before L1 is coded we need a **probe suite**: small pages plus scripted protocol sessions run against each backend, recording what actually happens. Its output fills the `?`s above and fixes the adapter's rules.

1. **Commit ordering.** Order of realm-created vs commit (`realmCreated` vs `navigationCommitted`; `executionContextCreated` vs `frameNavigated`). Spec text implies realm first, while chromium-bidi derives realms after commit.
2. **Initial about:blank reuse.** Do CDP and BiDi keep the same context or realm id across the Window reuse?
3. **bfcache.** Is `realmDestroyed` sent on entry? Are realms and contexts re-announced on restore, and with the same ids? Is `contextDestroyed` sent for bfcached children? Does `BackForwardCacheRestore` keep the `loaderId`? This decides true **Suspended** support vs the `restoredFrom` degradation.
4. **Missing terminal events.** For canceled `navigate`, `intercept()`, `javascript:` non-string, and superseded navigations, what does each backend emit? This establishes which outcomes can be observed affirmatively and which must remain unresolved (§2.8).
5. **Prerender activation.** Which ids does the activated page carry? Do preload scripts run in prerendered documents?
6. **Fenced frames.** Are they children or top-level in `getTree` and `Target`?
7. **Service workers.** How are SW-served requests and SW subrequests attributed? Is the double interception real?
8. **Orphaned children.** Does every backend emit detach for children of a navigated-away document?
9. **Event-loop sharing.** Does `alert()` in a popup block evaluation in its same-site opener, on each engine?
10. **Stability.** Measure rAF cadence and `stableFrames` per backend and headless mode, and check behavior in background tabs.
11. **Lightpanda and similar partial CDPs.** Which methods return success without effect?
12. **Pipe EOF.** Does Chrome exit when fd3 and fd4 close after the parent is SIGKILLed? Does Bun's `child_process` support extra fds? (`effect-building-blocks` open questions 1–2.)
13. **BCG switch detection.** How does each backend reveal that a commit switched browsing context groups (COOP, prerender activation)? Candidates are an opener change on target info, a new `WindowProxy` identity, or `sharedId` invalidation. Without a confirmed signal, record suspected/unknown topology with evidence; response headers alone do not establish every group switch.
14. **Safari BiDi on stable.** Does `safari:experimentalWebSocketUrl` work on stable Safari 27, or only on STP? (`webkit` open questions.)
15. **Canceled/preserved-document navigation.** Start a navigation that cancels, downloads or returns 204/205; confirm the old realm remains usable and waits do not require a nonexistent replacement realm event.
16. **Delayed consequences and processing barriers.** Trigger synchronous and timer-delayed navigation, then a round trip; verify `drainObserved` covers only its local watermark and operation deadlines report unobserved completion without inventing cancellation.
17. **Node/reference continuity.** Remove/reinsert and cross-document adopt a node, reset a document with `document.open`, and restore from bfcache. Probe document identity, connectivity, node binding and handle validity separately.
18. **Initialization boundaries.** Inject required setup failure and concurrent declaration changes during popup/OOPIF creation; check initialization failure, cleanup, and the actual before-script boundary. Check existing-page attachment separately.
19. **Connection loss with active declarations.** Drop the client connection while intercepts are installed and requests are paused, on CDP and on BiDi (including BiDi-only sessions). Are paused requests released, do intercepts persist, and does the session survive? This decides whether browser-global emulation can ever be safe in attached mode (§2.12).
20. **Evaluation with user activation.** Does `userGesture` / `userActivation` / `emulateUserGesture` grant transient activation (popup past the blocker, `requestFullscreen`, clipboard), sticky activation, or both, on each backend?
21. **Page time.** Which time modes work per backend? Does virtual time interact with network idle and rendering-based predicates? Does an injected controlled clock reliably run before author script under each backend's preload mechanism?

Model/transport tests also need deterministic schedules for: typed lifetime delivery versus caller interruption; late resource replies after owner shutdown; observe-only teardown; out-of-order override release and failed application; competing/hung obligation handlers; malformed required events and overload while replies still flow; one deadline across nested waits and permit acquisition; response-body retention after window closure; and storage restoration into a fresh context. These tests can use an injected clock and synthetic protocol traffic, without pretending they establish browser behavior.

The probe suite is also the regression suite for adapters: recorded traffic decodes against the generated schemas (drift test), and recorded behavior re-runs on each browser roll.

---

## 10. Hazard coverage

How each hazard from `platform-concept-model` §4 is handled by the model:

| Hazard | Mechanism |
|---|---|
| H1 detached between query and action | Binding/connectivity validation at use; locator re-resolution before dispatch; no automatic mutation replay |
| H2 navigation during evaluation | Explicit lifetime arbitration via `within`; record any uncertain evaluation side effects |
| H3 evaluation in a bfcached document | `StaleRef{reason: Suspended}` fail-fast for explicit refs; `NotReady` for locators; opt-in wait via `Latch` |
| H4 script before realm-created | preload scripts (P9) registered before navigation; never rely on realm events for "first" |
| H5 frame scripted before it's known | Verified pause/configure boundary where supported; existing-page limits explicit |
| H6 popup before listeners | Observation window; opener/filter correlation; blank-document load does not establish destination readiness |
| H7 process swap | Session generation + initialization gate; operation-aware retry or uncertain execution |
| H8 BCG switch | Confirmed/suspected/unknown topology; invalidate proven-lost reference bindings |
| H9 navigation without terminal event | Affirmative evidence or `Timeout{phase: "postcondition"}` at deadline; no silence-based cancellation |
| H10 failed but committed | `Failed{errorDocument}` |
| H11 no document | `Download`, `NoContent` outcomes |
| H12 ignored during traversal/unload | `Canceled` only with affirmative reason evidence; otherwise unresolved |
| H13 about:blank reuse | Realm as sibling of Document; `isInitialAboutBlank`; replace semantics |
| H14 prompt blocks siblings | Confirmed blocking signal; suspected topology is diagnostic; `PromptBlocking{resolution: Pending}` is waitable; auto-resolutions are reported |
| H15 beforeunload needs activation | Activation estimate; canceled navigation/close retains live resource and active realm |
| H16 bfcache restore | Confirmed document restoration; independent node/handle continuity checks |
| H17 service worker responds | `servedBy`; `Sent`-less lifecycle; `bypassServiceWorker` capability |
| H18 SW restart | realm scope cycles under a stable registration scope |
| H19 rendering waits hang when hidden | `NoRenderingOpportunity` reason; `activate` |
| H20 click lands elsewhere | two-phase hit-target verification (pre-check + trusted-event guard) |
| H21 synthetic ≠ user input | `InputFidelity`; `requiresActivation` |
| H22 transient activation expiry | chain gated operations within one gesture; activation estimate |
| H23 file chooser doesn't pause | file-chooser obligation armed before input |
| H24 focus headless vs headed | focus the Page before key input |
| H25 IME | `insertText` / composition primitive |
| H26 shadow DOM retargeting | per-shadow-root hit tests; composed-tree queries; `closedShadowAccess` capability |
| H27 top layer / inert | `NotInert` predicate; `BlockedByModal{dialog}` |
| H28 content-visibility | `ContentVisibilitySkipped` reason |
| H29 wrong storage partition | Explicit partition mapping; portable StorageState can restore into fresh contexts |
| H30 prerender | `Activated` outcome; capability-gated prerender pages |
| H31 keepalive outlives page | Detach readiness accounting; retain remote work or end observation without inventing network failure |
| H32 small traps | documented per operation |

---

## 11. Proposed contracts and the ergonomic API

These are design commitments to validate through implementation and call sites, not a reason to freeze L1 ahead of ergonomics:

- **Identity:** our navigable/document/realm ids absorb protocol churn. Refs retain their binding; local knowledge of invalidity does not prove current validity.
- **Lifetimes:** explicit reason signals plus cleanup scopes; release ownership is independent of observation and follows openers; an ownership ledger makes reclaiming possible after connection loss. Suspension does not automatically revive handles. Public streams end normally with their owner and fail only on abnormal ends.
- **Navigation:** observed terminal outcomes, separate document loading, and unresolved observation when evidence is missing.
- **Obligations:** one locally selected terminal decision, acknowledged/rejected/unknown remote resolution, bounded phase-specific fallback.
- **Declarations:** acknowledged installation, a required timing guarantee (`beforeAuthorScript` fails rather than degrades), and never applied to resources we don't own. One precedence ladder for every declaration kind, with concurrency rules for overrides.
- **Ingestion:** ordered folds before publication; bounded buffers, explicit integrity failure and a local processing watermark.
- **Interruption:** normal Effect cancellation plus internal dispatch/observation/cleanup records. Recovery never assumes an uncertain mutation did not occur.
- **Waiting:** one shared operation deadline and explicit cleanup budget; observations and action policies remain distinct.
- **Capabilities:** instance-bound evidence and refinement; static typing where the instance choice is known, runtime Unsupported otherwise.
- **Realm discovery:** Tracked or OnDemand, with explicit differences in observability and no promise of undetectability.
- **Errors:** ordinary verbs fail with `TargetGone`, `Timeout` or their domain error; dispatch uncertainty is a field; unexpected protocol failures are defects at L1/L2 verbs (to validate).
- **Secrets:** `Redacted` in and out; never rendered.

**Left to DESIGN.md:** locator AST/strictness, action and assertion call sites, ergonomic wait combinators, extraction signatures, agent tooling, test fixtures, artifacts, tracing export, naming and module layout. Agent snapshots carry binding identity; lack of an observed effect is not proof of no effect. Public methods should normally return useful values in Effect without exposing operation-record machinery, collector setup or protocol subscriptions.

### 11.1 Call-site acceptance scenarios

Write these examples before finalizing the public surface; revise L1 if they require protocol knowledge or repeated resource ceremony:

1. **Login and reuse.** Open an owned isolated context, fill fields, submit once, observe the logged-in state, save portable storage state, then restore it into a fresh context. Errors identify the failed step without requiring callers to understand partition ids.
2. **Click and wait.** Resolve and validate under one deadline, dispatch once, then wait for a named URL/navigation/condition. The caller can distinguish "never dispatched", "dispatched but completion unobserved" and "observed failure" from one `Timeout` or domain error (its `phase` and `dispatch` fields), without matching a dozen tags. A delayed navigation is supported by an explicit observation, not a magic flush.
3. **Popup plus dialog.** Install handlers/listeners before the trigger; handling a prompt cannot wait for the trigger to finish. Return a usable popup with a clear lifetime and defined ambiguity behavior.
4. **Response body.** Express interest in a matching response and body, trigger the action, then decode the returned bytes. Collection is acquired automatically before traffic and the result survives window cleanup. Limits and unsupported collection surface before dispatch where knowable.
5. **Download.** Trigger and correlate a download, await completion under one deadline, and save or transfer the artifact. Remote filesystem paths are not silently treated as local paths; unsupported transfer is explicit. This capability still needs a concrete L2 contract.
6. **Concurrent pages.** Read different pages concurrently, serialize input only where required, and isolate settings through contexts or explicit leases. Out-of-order fiber completion cannot restore another fiber's override.
7. **Attach and release.** Observe existing tabs, create a temporary owned page that opens a popup, then release the connection. The temporary page and its popup are cleaned up and existing tabs remain open. No declaration installed by the client ever touched the existing tabs.
8. **Consume events until close.** Log a page's requests with `Stream.runForEach` until the page closes. The loop finishes normally when the page is closed by command or script, fails with `TargetGone` on a crash, and never overflows because of requests it filtered out. Secrets in headers appear as `<redacted>`.

### 11.2 Review disposition

[Review 1](reviews/01-draft-1.md) preserves the original findings. Draft 2 addressed findings 1–10 in §§3.1/5, 2.8/4, 2.6, 3.1/3.3, 3.2, 2.11.2/2.12, 2.15, 1.3/2.5, 4, and 6 respectively. The ergonomic recommendations are incorporated as the shared deadline (§5.2), instance capabilities (§8), automatic body collection (§§2.12/4.1), observation-versus-policy split (§2.17), optional schema validation (§2.7), and portable storage state (§2.16). CDP clickCount is corrected in §2.10.

[Review 2](reviews/02-draft-2.md) reviewed draft 2. Draft 3 addresses its findings as follows:
- **1** (L1-minted ids): §1.2, with `NavigationId` minted before dispatch.
- **2** (no effect on non-owned resources): P9, §2.12, probe 19.
- **3** (one precedence ladder): P10, §2.7, §2.11.2, §2.15.
- **4** (smaller inconsistencies): §1.1, §1.2 (`DocumentGeneration`), §2.3, §2.5.
- **5** (small error channels): P11, §3.1, §5, §6.
- **6** (navigation success projection): §2.8.
- **7** (stream termination): §4 item 8.
- **8** (waitable prompt blocking, reported auto-resolution): §2.11, §2.17, §7.
- **9** (required timing guarantees): P9, §2.7, §2.15.
- **10** (ownership follows openers; ownership ledger): §3.1.
- **11** (filter before buffering): §4 item 5.
- **Concepts:** `Redacted` values (P12, §2.20, §7), evaluation with user activation (§2.6, §2.10, probe 20), page time (§2.15, probe 21), long-lived connections (§2.12), value identity (§1.2).
- **Document:** the "Guarantees at a glance" table follows the principles.

Two refinements go beyond review 2. First, dispatch uncertainty is a field on both `Timeout` and `TargetGone`, so transport loss after dispatch is covered as well as deadlines. Second, unexpected protocol failures are defects at L1/L2 verbs, which keeps the ordinary error channel to three tags; this needs validation against the acceptance scenarios.

The operation record and observation window are internal concepts first. Concrete public signatures, all acceptance examples above, and browser-dependent guarantees remain to be implemented and measured. The original research notes are unchanged; where a draft-1 interpretation conflicted with this revision, use the corrected contract here and keep the probe question open.
