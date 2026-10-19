# CONCEPTS: the native browser model

*Status: draft 1, 2026-10-18. Sources: `research/*.md` (nine notes). Spec anchors use the conventions in `research/platform-concept-model.md`: `HTML#x` means `https://html.spec.whatwg.org/#x`, `BIDI#x` the WebDriver BiDi editor's draft, and so on.*

This document defines **layer 1** of the library: a protocol-neutral, spec-grounded model of what a browser *is* and what a driver can *do* to it. It covers no ergonomics and no API sugar. Those belong to layer 2 (DESIGN.md), and every convenience there must be expressible in the terms defined here.

```
L2  Ergonomic API      locators, actions, expectations, agent toolkit, test fixtures   (DESIGN.md)
L1  Native model       identities, lifecycles, state, events, obligations, outcomes    (this document)
L0  Protocol adapters  CDP · WebDriver BiDi · WebKit Inspector (patched / stock)       (generated + adapters)
    Transports         pipe (fd3/fd4, NUL framing) · WebSocket                          (fail-fast, no reconnect)
```

---

## 0. Principles

Each principle is a convergence across the prior art. The cited notes give the evidence.

**P1. Spec identity is primary; protocol identity is adapter-internal.**
The public model is keyed by *navigable*, *document epoch*, *realm*, *navigation* and *request*, the concepts the HTML spec and BiDi use. CDP `targetId`, `sessionId`, `executionContextId` and `loaderId`, and WebKit `pageProxyId` and provisional target ids, never appear as primary identity. They change on events that leave spec identity untouched: out-of-process-iframe swaps, COOP process swaps, WebKit provisional pages and prerender activation (`platform-concept-model` §3.16; `webkit` §1.3; `playwright-internals` §2). Absorbing that churn in the adapter is the single largest ergonomic win available.

**P2. Everything with a lifetime is a `Scope`, and every lifetime ends with a typed reason.**
A lifetime ends in one of two ways. A *command* (close, remove, disown) closes the scope locally. A *remote fact* (detach, destroy, crash, disconnect) completes the scope with an `Exit` carrying a typed `CloseReason`. Either way, fibers forked into the scope are interrupted and waiters fail with the reason. Playwright's hand-rolled `LongStandingScope` and Puppeteer BiDi-core's `dispose(reason)` are both promise-only versions of this (`playwright-internals` §1; `puppeteer` M2). The most common complaint about Playwright, "Target page, context or browser has been closed", is the absence of this.

**P3. Interruption stops waiting; it never pretends to cancel.**
No protocol can cancel an in-flight command: not CDP, not BiDi, not WebKit (`non-js-cdp-clients` summary; `webdriver-bidi` §3). Interrupting a fiber abandons the reply (the pending id is tombstoned and late replies are dropped). It then runs the operation's declared **compensation**: release held input, resolve paused requests, disown handles. A mutating operation that was interrupted *after* being sent completes with `OutcomeUnknown`, never a silent success or failure. agent-browser's `outcome_unknown` is the precedent.

**P4. Ingestion is lossless and ordered; derived state is folded before re-emission.**
There is one reader per transport, and events are dispatched in order per session. The adapter updates model state (frame tree, document epochs, realm sets, in-flight requests) *synchronously in the dispatch fiber* before publishing to user streams. Dropping an internal event corrupts identity tracking. This is the effect-cdp flaw (`effect-building-blocks` Part B) and the reason Puppeteer leaks hanging handlers (`puppeteer` M3, `FrameTree.waitForFrame`). User-facing streams may opt into sliding buffers; internal ones never do.

**P5. Subscribe-before-trigger is structural.**
Every subscription is live *when the effect that creates it returns*. Every "wait for X caused by Y" is a combinator that subscribes, runs Y, then awaits X. In Effect 4.0.5, `Stream.fromPubSub` and `Stream.callback` subscribe lazily in a forked fiber, and forking then triggering lost events in testing (`effect-building-blocks`, verified t2). Eager `PubSub.subscribe` is therefore mandatory in L1.

**P6. Obligations are linear.**
Three kinds of event demand exactly one response: a paused request, an open user prompt, an intercepted file chooser. Each is an **obligation** with a typed `Decision`, resolved exactly once. If the handler fails, is interrupted, or its scope closes, a **default decision** applies (continue, dismiss, cancel). Every surveyed library got this wrong somewhere: Puppeteer requests stay paused forever, Playwright's `unrouteAll({behavior})`, Selenium's global intercept hangs the page, and pydoll documents the rule but doesn't enforce it.

**P7. Capabilities are declared, probed and typed.**
Backends differ widely (§8). A capability that is absent is a typed `Unsupported{capability, backend}` error, or better, a missing service in `R`. It is never a silent no-op: Lightpanda stubs that return success, and Puppeteer's 56 runtime "unsupported" throws, are the cautionary examples (`puppeteer` M1; `ai-agent-browser-use`, Lightpanda).

**P8. Protocol features are demand-driven and reference-counted.**
A protocol feature (CDP domain enable, BiDi module subscription, `Fetch` patterns, file-chooser interception) is acquired while a consumer needs it and released after. This keeps traffic down. It also makes a **stealth posture** expressible: no `Runtime.enable`, so realms are discovered on demand rather than tracked (`non-js-cdp-clients` §7). Stealth has to be an architectural option, because an eager-enable design cannot retrofit it.

**P9. Configuration is declarative and covers future targets.**
Init scripts, emulation, extra headers, intercepts, download behavior and bindings are **declarations scoped to a user context or page**. The adapter applies them to every current *and future* target before any page script runs. BiDi has this natively (`contexts | userContexts`). CDP and WebKit implement it with attach-pause-configure-resume (`Target.setAutoAttach{waitForDebuggerOnStart}` → configure → `runIfWaitingForDebugger`; WebKit `Target.resume`), re-applied on every process swap.

**P10. Overrides stack.**
An override (viewport, locale, timezone, geolocation, cache behavior, ...) is a scoped resource: acquire sets the value, release restores the *previous* value. Nested scopes compose without WebdriverIO's `claimRestore` bookkeeping (`webdriver-bidi` lesson 5).

---

## 1. Identity

### 1.1 Three spec layers

| Layer | Concept | Stable across | Changes on | What binds here |
|---|---|---|---|---|
| **Slot** | Navigable (top-level traversable = Page; child navigable = Frame) | every navigation, cross-site, COOP, process swap | never (until destroyed) | `Page`, `Frame`, input state, navigation history, prompts |
| **Epoch** | Document (+ its Window realm, usually) | same-document navigations, `document.open()`, bfcache suspend/restore | cross-document commit | `NodeRef`, document readiness, network-idle accounting |
| **Topology** | Browsing context, browsing context group (BCG), agent cluster, event loop | navigations within a BCG | BCG switch (COOP, prerender activation, fenced-frame embedder nav, UA choice) | opener links, `window.name`, BiDi `sharedId` map, event-loop sharing (prompts block siblings) |

(`platform-concept-model` §1, §3.2–3.5.) Realms sit between the epoch and slot layers. A Window realm normally lives and dies with its document epoch. The **one exception** is the initial `about:blank` Window, which is *reused* by the first same-origin-domain navigation (`HTML#initialise-the-document-object`). So `Realm` is modelled as a sibling of `Document` under the navigable, linked to the document epoch(s) it served, not as a strict child.

### 1.2 Model ids and their protocol mappings

All model ids are branded opaque strings minted by L1. Protocol ids live only in adapter tables.

| Model id | Minted from | CDP (Chromium) | BiDi | WebKit (patched) |
|---|---|---|---|---|
| `UserContextId` | backend | `browserContextId` | `userContext` | `browserContextId` |
| `NavigableId` (Page, Frame) | backend where stable, else L1 | `frameId` (survives OOPIF swap; main frame re-keyed on prerender swap) | `context` (= navigable id) | `pageProxyId` (page) / `frameId` |
| `DocumentId` | **always L1** | keyed by `loaderId` + frame | keyed by committing navigation id, else realm | keyed by `loaderId` |
| `RealmId` | **always L1** | `executionContextId` per session (or `uniqueId`); world name | `realm` | `executionContextId` per target; `type: normal\|user` |
| `NavigationId` | backend where available, else L1 | `loaderId` (cross-doc); synthetic (same-doc) | `navigation` (null for `historyUpdated`) | `loaderId` from `Playwright.navigate` |
| `RequestId` | backend | `requestId` (stable across redirects; `Fetch`/`Network` ids reconciled) | `request` (stable across redirects; `redirectCount`) | `requestId` |
| `NodeRef` | composite | `{navigable, document, backendNodeId}` | `{navigable, document, sharedId}` | `{navigable, document, objectId→nodeId}` |
| `HandleRef` | composite | `{realm, objectId, objectGroup}` | `{realm, handle}` | `{realm, objectId}` |
| `PromptId`, `DownloadId`, `InterceptId`, `SubscriptionId` | L1 | — | — | — |

**`DocumentId` is always ours.** BiDi exposes no document id (`platform-concept-model` §3.5). CDP's `loaderId` is per navigation, and bfcache restores have to keep the old one. Five independent tools key element identity by document plus node: Chrome DevTools MCP (`loaderId_backendNodeId`), agent-browser (session, frame, `loaderId`), Playwright (frame `seq` renumbered on commit), chromium-bidi (contexts destroyed on new `loaderId`) and Stagehand v4 (snapshot bound to URL). `NodeRef` therefore carries its `DocumentId`, and staleness is decidable without a round trip.

### 1.3 Staleness

A `NodeRef` is in one of four states:

- **Live**: its document epoch is the navigable's active document, the document is fully active, and the node is connected.
- **Suspended**: the epoch is in bfcache. The ref may come back to life on restore.
- **Stale(Replaced)**: a newer epoch committed (`DocumentReplaced{navigation}`).
- **Stale(Detached)**: the node was disconnected, or the navigable was destroyed.

This is WebDriver's definition (`WD#dfn-is-stale`) plus *Suspended*. Under BiDi, a BCG switch also kills every `sharedId`, because the node map is per BCG. The adapter reports this as `Stale(Replaced)` with `bcgSwitched: true`.

---

## 2. Concept catalogue

Each entry follows the same layout: **what it is**, **identity**, **lifetime** (start / end triggers, with protocol signals), **state** (observable as `SubscriptionRef`), **events** (`Stream`), **operations**, **invariants**, and **hazards** (H-numbers from `platform-concept-model` §4).

### 2.1 Browser

- **What.** One connected browser endpoint and its process, if we own the process.
- **Ownership.** `Launched{process}` or `Attached{endpoint}`. With `Launched`, release closes gracefully (`Browser.close` / `Playwright.close` id −9999 / `browser.close`) with a bounded timeout, then kills (SIGTERM, then `forceKillAfter`). With `Attached`, release only disconnects. iOS, the WebKit inspector HTTP server, BiDi-attached Safari and remote CDP endpoints (Browserbase and similar) are attach-only, and some of them cannot create contexts (`webkit` lesson 8).
- **Lifetime.** Ends on graceful close (`BrowserClosed`), process exit (`BrowserCrashed{exitCode, signal, stderrTail}`; include the exit status, as chromedp does) or transport loss (`ConnectionLost`).
- **State.** `userContexts`, `version`, `backend: BackendInfo`, `capabilities: CapabilitySet`.
- **Invariants.** There is exactly one reader fiber per transport. The transport fails fast after close. Writes after close fail with `ConnectionLost`. Effect's `Socket` writer *suspends* while disconnected, so we must not inherit that behavior (`effect-building-blocks`, verified t6). Single-client backends (the patched-WebKit WebSocket, `safaridriver`) are singletons guarded by a `Semaphore(1)` per (backend, profile).

### 2.2 UserContext

- **What.** A storage partition plus a scope for overrides (`BIDI#user-context`; CDP browser context; WebKit `WebsiteDataStore`).
- **Identity.** `UserContextId`. The `default` context always exists, cannot be removed, and is *adopted*, not created.
- **Lifetime.** Created by command, or adopted. Ends on `remove` (which closes its pages *without* beforeunload, `BIDI#remove-user-context`) or with the browser.
- **State.** `pages`; the active overrides stack (§2.15); `promptPolicy` (default decisions, §2.11); `downloadPolicy`; intercepts and preload scripts declared at this scope.
- **Invariants.** No storage is shared across user contexts. A child navigable's user context equals its parent's. Popups inherit their opener's user context; the spec leaves this open, but every implementation does it.

### 2.3 Page (top-level traversable)

- **What.** A tab or window: a top-level traversable that owns session history, the traversal queue, visibility and system focus (`HTML#traversable-navigable`).
- **Kinds.** `tab`, `popup` (auxiliary; `opener` set; `is created by web content`), `prerender` (hidden traversable; scripting blocked until activation), `fenced` (a traversable with an unfenced parent; its own BCG). Prerender and fenced pages are modelled but capability-gated.
- **Identity.** `NavigableId`. `originalOpener: Option<NavigableId>` is kept even under `noopener`, where `window.open` returns `null` (`BIDI#original-opener`; H6).
- **Origin.** `Created` (by command), `Opened{opener}` (popup, `target=_blank`, `window.open`) or `Adopted` (already existed at attach). Pages born outside any user call are adopted into their user context's scope (§3.3).
- **Lifetime.**
  - **Start:** CDP `Target.attachedToTarget{type: page}` (paused under auto-attach); BiDi `contextCreated` with no parent; WebKit `Playwright.pageProxyCreated`.
  - **Initial state:** a fresh page holds the *initial `about:blank`* with `hasPlannedNavigation`. It is not "loaded" (H6, H13).
  - **End:** `PageClosed{by: Command | Script (window.close) | UserContextRemoved | Crash | Browser}`. Closing by command may run beforeunload (`promptUnload`), which can **cancel** the close if the prompt is dismissed (H15).
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
  - **End:** container removal (*no unload events*, `HTML#destroy-a-child-navigable`) or the parent document being destroyed or replaced. HTML never formally fires "navigable destroyed" for children orphaned by a parent navigation (`platform-concept-model` §3.2 spec gap). The adapter must close child Frame scopes itself whenever the parent's document epoch ends. chromium-bidi does exactly this on `loaderId` change (`puppeteer` 6b).
- **Process swaps (implementation layer).** A cross-site navigation of an iframe moves it to another process. CDP shows this as `Page.frameDetached{reason: "swap"}` followed by a new iframe target and session. The Frame (spec identity) **persists**. Only its adapter session changes, held in a `SubscriptionRef<SessionBinding>`. In-flight commands on the old session fail with an adapter-internal `SessionSwapped`, which L1 retries at the navigable layer (H7). Playwright's handling of detach-before-attach races, a "safe roundtrip" then decide, is the reference (`playwright-internals` §2).
- **State.** `parent`, `children` (document order), `containerRef: NodeRef` (the iframe element in the parent document), `activeDocument`, `url`, `name`.
- **Invariants.** A frame's children belong to its *active document*. When that epoch ends, the children end too.

### 2.5 Document (epoch)

- **What.** One occupant of a navigable: the Document plus its Window (usually), DOM, readiness and fetch group.
- **Identity.** `DocumentId`, minted by L1 at commit. Fields: `url`, `origin`, `navigation: NavigationId | null` (the navigation that committed it; null for the initial `about:blank`), `isInitialAboutBlank`, `isErrorDocument` (H10), `restoredFrom?` (see below).
- **State machine.**

  ```
  Initial(about:blank) ─┬─(commit, reuse Window)──► Loading ─► Interactive ─► Complete
                        └─(commit, new Window)────► Loading ─► …
  Complete ─(unload → bfcache)──► Suspended ─(reactivate)──► Complete
  Any ─(replaced | destroyed | evicted)──► Ended{reason}
  ```

  Readiness transitions come from protocol lifecycle events (CDP `Page.lifecycleEvent` DOMContentLoaded/load, BiDi `domContentLoaded`/`load`, WebKit equivalents). Only events whose loader/navigation id matches *this* epoch are accepted. Stale lifecycle events from the previous document must not leak, and `browsingContext.create` waits for the initial `about:blank` load for exactly this reason (`puppeteer` 6d).
- **Mutation without replacement.** `document.open()` keeps the epoch but replaces every node and erases listeners. NodeRefs into the old tree go `Stale(Detached)`; the epoch does not end (H1).
- **bfcache.** When a document is suspended, NodeRefs and handles are **Suspended**: operations on them fail fast with `DocumentSuspended` instead of hanging (H3). On reactivation they come back to life. Reactivation fires **no commit and no new realm**. BiDi nevertheless emits `realmDestroyed` on bfcache entry (its cleanup steps run on every unload), so the adapter must hold the realm in *Suspended* until it learns whether the document was restored or evicted. If a backend cannot tell bfcache entry from destruction, it degrades as follows: the old epoch ends with `Ended{reason: Unloaded}`, and a restore creates a **new** epoch with `restoredFrom: oldId` (handles are not revived). The conformance probes in §9 decide which backends support true suspension.
- **Invariants.** A navigable has at most one *active* document. Tasks for a non-fully-active document are not run: they wait rather than fail, which is why the driver must race explicitly (H2, H3).

### 2.6 Realm and World

- **What.** A JS global environment (ECMA-262 §9.3) where script runs and handles live.
- **Kinds.** `window{navigable, world}`, `dedicatedWorker{owner}`, `sharedWorker`, `serviceWorker{registration}`, `worklet{kind}`. The kind is an open union; ShadowRealm has no protocol type yet.
- **World.** For window realms, `world: "main" | Isolated{name}`. An isolated world is an automation concept with three implementations: BiDi `sandbox` (lazily created per Window and name), CDP isolated world (`Page.createIsolatedWorld` / `addScriptToEvaluateOnNewDocument{worldName}`), and WebKit `Page.createUserWorld` (patched only; stock WebKit has **no** isolated worlds). The library's own injected code (selector engines, readiness checks, snapshotters) runs in a **utility world** where available. Page scripts then cannot tamper with it, and our evaluations don't trip page monkey-patches (`playwright-internals` §2). Where isolated worlds are unavailable, a capability flag says so, and the fallback (snapshotting main-world globals) is explicit.
- **Identity.** `RealmId`, minted by L1. The adapter maps it to (session, `executionContextId`) for CDP and `realm` for BiDi. CDP `executionContextId`s are per process, so the adapter keys by `uniqueId`.
- **Discovery strategy** (P8; a per-user-context choice):
  - **Tracked.** Enable `Runtime` (or subscribe to BiDi `script.realm*`) and fold create/destroy events into `realms: SubscriptionRef<RealmSet>`. This gives complete, observable, low-latency information, and it is what Playwright, Puppeteer and chromium-bidi do.
  - **OnDemand.** No `Runtime.enable`. Realms are obtained when needed: an isolated world via `Page.createIsolatedWorld`, a main-world handle via `Runtime.evaluate("globalThis")` without a context id, or `DOM.resolveNode`. They are cached in a `ScopedRef` and invalidated on "Cannot find context with specified id". This is the stealth strategy (pydoll, zendriver, rod, rebrowser). The realm *set* is not observable here, so features that need it (console capture, `executionContextCreated`-driven waits) are **absent from the type**, not failing at run time.
- **Lifetime.**
  - **Start:** CDP `Runtime.executionContextCreated`, BiDi `script.realmCreated`, or on-demand acquisition. The *default realm* of a navigable is a **resettable deferred**. It is reset on start of a navigation to a non-blank URL, on destruction of the current context, and on `executionContextsCleared`. It resolves on the next default context, *or* on `frameNavigated` when Chromium reused the context (initial about:blank → same-site). See `puppeteer` 6c.
  - **End:** `RealmDestroyed{reason: DocumentReplaced | DocumentSuspended | FrameDetached | WorkerTerminated | ProcessSwapped | Crashed}`.
- **Invariants.**
  - Every evaluation runs **in the realm's scope**: realm death interrupts it with the typed reason (H2). Evaluations also race "prompt open on this event loop" (H14) and "document suspended" (H3) and fail fast.
  - A non-stalling evaluation (title, readiness probes, screenshot preparation) refuses to start while a navigation is pending or a prompt is open, because CDP `Runtime.evaluate` would hang (`playwright-internals` §2).
  - Handles belong to exactly one realm and die with it.

### 2.7 Values, handles, channels and preload scripts

- **Value transfer is by value by default** (BiDi's model). An evaluation's result is decoded with a caller-supplied `Schema`. The wire carries the protocol's deep serialization: BiDi `RemoteValue`, or CDP `deepSerializedValue` / `returnByValue`. **Handles are opt-in** and require `Scope`: `HandleRef{realm, ...}` is created with ownership `root` (BiDi) or in a realm-scoped `objectGroup` (CDP), and released in a batch by the finalizer (`script.disown` / `Runtime.releaseObjectGroup`), skipped if the realm already died.
- **Node values.** A node result becomes a `NodeRef` bound to the current document epoch. The BiDi `sharedId` works across main and sandbox realms, with a same-origin check. The CDP `backendNodeId` is resolved into a realm with `DOM.resolveNode`.
- **Channels** (page → driver messages). `Channel<A>` has a driver-chosen id and a `Schema<A>`, and is exposed as a `Stream<A>` filtered by channel id. BiDi passes it as a function argument (`script.message`). CDP uses `Runtime.addBinding` (string payload, JSON-encoded) or chromium-bidi's long-poll. Patched WebKit uses `Runtime.addBinding`, and stock WebKit a sync-XHR bridge (`webkit` §1.7). Channels are the transport for in-page observers: mutation invalidations, readiness probes, recorder events.
- **Preload scripts.** A `PreloadScript{source, world, scope: UserContext | Page, channels}` runs in every new Window *before author script*, including iframes and popups, re-applied on process swaps (P9). This is the only correct way to run code "at document start" (H4, H5). BiDi: `script.addPreloadScript`. CDP: `Page.addScriptToEvaluateOnNewDocument{worldName, runImmediately}` per target, during the paused setup. WebKit: `Page.setBootstrapScript`.

### 2.8 Navigation

- **What.** One attempt to change a navigable's active session history entry.
- **Identity.** `NavigationId`. Navigations started by commands are created *before* the command is sent, so the subscription precedes the trigger (P5). Navigations started by the page are adopted from the first protocol signal (CDP `Page.frameRequestedNavigation` / `frameStartedNavigating`, BiDi `navigationStarted`).
- **Kinds.** `crossDocument`, `fragment`, `historyApi` (`pushState`/`replaceState`, which BiDi reports as `historyUpdated` with **no** navigation id), `intercepted` (Navigation API: cross-document converted to same-document), `traversal` (back/forward; may restore from bfcache), `reload`, `javascriptUrl`, `download`, `prerenderActivation`.
- **Outcome**, a closed union. This is the center of the model:

  ```ts
  type NavigationOutcome =
    | { _tag: "Committed";    document: DocumentId; response: Option<ResponseRef> }
    | { _tag: "SameDocument"; via: "fragment" | "historyApi" | "intercepted"; url: string }
    | { _tag: "Restored";     document: DocumentId }                 // bfcache reactivation
    | { _tag: "Activated";    document: DocumentId }                 // prerender activation
    | { _tag: "Download";     download: DownloadId }                 // old document stays active (H11)
    | { _tag: "NoContent";    status: 204 | 205 }                    // old document stays active (H11)
    | { _tag: "Failed";       error: NetError; errorDocument: Option<DocumentId> } // error page may commit (H10)
    | { _tag: "Aborted";      document: DocumentId; cause: string }  // after commit, while loading
    | { _tag: "Superseded";   by: NavigationId }                     // silently replaced (H9)
    | { _tag: "Canceled";     reason: "beforeunload" | "navigateEvent" | "sandbox" | "unloading" | "traversalInProgress" }
    | { _tag: "NoOp";         reason: "javascriptNonString" }
  ```

  Several of these have **no terminal protocol event** (H9): a canceled `navigate` event, an `intercept()`, a non-string `javascript:` result, supersession at the fetch stage, and prerender activation. The adapter therefore completes outstanding navigations with these rules:
  1. A newer navigation started on the same navigable → `Superseded`.
  2. `historyUpdated` after start → `SameDocument{intercepted}`.
  3. No document change after a quiescence window → `Canceled`/`NoOp` (with `inferred: true`).
  4. Navigable destroyed → the navigable's close reason.

  The two sources of the tracker are chromium-bidi's `NavigationTracker` state machine (`puppeteer` 6d) and HTML's algorithm landmarks (`platform-concept-model` §3.6).
- **Readiness of a committed navigation.** Readiness is separate from the outcome. A navigation completes at *commit*. Readiness is a property of the resulting `Document` (`Loading | Interactive | Complete`). "Wait until load" is `outcome.document` + `Document.readiness ≥ Complete`, not a separate kind of navigation. Network idle is a separate predicate (§2.17).
- **Navigations caused by actions.** Input dispatch is bracketed by a **navigation barrier**: navigations requested on *top-level* frames during the action are collected, and the action's outcome includes them (Playwright's `SignalBarrier`, `playwright-internals` §2). After input, a **flush** (CDP: a no-op `Page.enable` round trip) guarantees that events caused by the input have arrived before the barrier is checked.
- **Redirects.** A redirect chain belongs to the same navigation, and the request id is stable across hops. A cross-origin redirect discards and re-creates the reserved client environment (`platform-concept-model` §3.6).
- **BCG switch.** It is reported on the outcome: `Committed{..., bcgSwitched: true, openerSevered: boolean}` (H8).

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
  - `move`, `down`, `up`, `wheel`, `key down/up`, `insertText` (IME commit, distinct from key presses, H25), `setFiles{element, paths}`. `setFiles` paths are **remote-end paths** under BiDi; the adapter uploads or stages files where the backend is remote.
  - BiDi compiles sequences to *ticks*; CDP compiles to timed `dispatch*Event` with interpolated moves. Double and triple clicks are synthesized: within 500 ms and 2 px, because CDP has no click count (`puppeteer` 6g).
  - Input to one Page is serialized (a per-page semaphore).
- **Compensation.** Every `down` pushes its inverse onto the undo list. When a gesture is interrupted or its scope closes, the undo list is **replayed in reverse** (`input.releaseActions` semantics). An interrupted drag never leaves a button pressed.
- **Activation.** Activation-triggering events (trusted `keydown` except Esc, `mousedown`, `pointerdown` for mouse, `pointerup` for non-mouse pointers, `touchend`) grant *transient* and *sticky* activation to the target Window, its ancestors and same-origin descendants. *Consumption* clears transient activation across the whole tab tree (`HTML#consume-user-activation`). L1 tracks a **best-effort activation estimate** per document epoch, which no protocol exposes. Operations that need activation (opening a popup past the blocker, `requestFullscreen`, `showPicker`, file pickers, beforeunload prompts) declare `requiresActivation`. Activation is lost on new Windows and kept across bfcache (H15, H21, H22).
- **Focus.** Key input routes to the *focused area of the top-level traversable*, which requires **system focus** (H24). The adapter focuses the Page through the protocol before key input (`Emulation.setFocusEmulationEnabled` / `setActiveAndFocused`, or activate).
- **Click target.** The click target is the common ancestor of the `pointerdown` and `pointerup` targets *at dispatch time*. A re-render between down and up retargets the click (H20). This is why hit-target verification (§2.17) must cover the trusted event stream, not just a pre-check.

### 2.11 User prompts (obligations)

- **Kinds.** `alert`, `confirm`, `prompt`, `beforeunload` (gates navigation and close), and `print`, which is page-event only and has no BiDi hook. File choosers are a separate obligation kind (§2.11.1).
- **Identity.** `PromptId`, scoped to the navigable that opened it.
- **Blocking semantics.** A simple dialog **pauses the event loop of its agent** (`HTML#pause`). Every same-site document in the same BCG stops: openers, popups and same-site iframes (H14). L1 derives `eventLoopKey = (bcgId, siteOrOrigin)` per document and propagates `promptOpen` to every navigable sharing that key. Evaluations in any of them fail fast with `PromptBlocking{prompt}`. **Prompts do not block** in these cases: suppressed (sandboxed modals, termination nesting, prerender), print, file pickers, permission and HTTP-auth prompts (auth blocks only the *request*).
- **Decision.** `Accept{text?} | Dismiss`. Resolved exactly once (P6).
- **Policy.** Each user context has a **default decision policy**: dismiss after a grace period, except `beforeunload`, which accepts. A scoped handler can override it. A handler that fails or is interrupted falls back to the default. Under BiDi this maps to the `unhandledPromptBehavior` capability plus `handleUserPrompt`; under CDP to `Page.javascriptDialogOpening` + `handleJavaScriptDialog`; under patched WebKit to the `Dialog.*` domain; under stock WebKit to a JS shim (patched `alert`, `confirm` and `prompt`).

#### 2.11.1 File chooser

The file picker runs in parallel and does **not** pause the page (H23). It is an obligation `Select{paths} | Cancel`, armed per Page *before* the triggering input: CDP `Page.setInterceptFileChooserDialog` (enable only while armed, P8), BiDi `input.fileDialogOpened` + `unhandledPromptBehavior.file`, or WebKit `Page.setInterceptFileChooserDialog`. The default is `Cancel`, after which a `cancel` event fires in the page.

### 2.12 Network: requests, responses, interception, bodies

- **Request.** `RequestId` is stable across redirects, with hops indexed by `redirectCount`. Fields: `navigable` (attribution; may be a worker realm, or absent for service-worker fetches), `navigation: Option<NavigationId>` (BiDi provides this; CDP derives it from `loaderId`), `resourceType`, `method`, `url`, `headers` (merged with the CDP ExtraInfo halves), `isNavigationRequest`, `servedBy: Network | Cache | ServiceWorker` (H17).
- **Lifecycle.** `Sent → ResponseStarted → (Completed | Failed{error})`. Redirects nest inside. Service-worker-served requests can begin at `ResponseStarted` with no `Sent` (normative in BiDi, H17). Requests belonging to a document that has been destroyed may **never** emit a terminal event (fetch-group termination). The adapter completes them as `Failed{error: Abandoned}` when their document epoch ends.
- **Event ordering.** CDP delivers `requestWillBeSent`, `requestPaused` and the ExtraInfo events in several orders: Puppeteer documents four, A–D, including crbug 1196004. The adapter keeps **slots of raw facts per request** and emits each model event exactly once, when its prerequisites are present. Events that need asynchronous enrichment keep their place in the outbound order (chromium-bidi's `ProcessingQueue` of promise-events, `puppeteer` 6f/6h).
- **Interception** is a declaration plus a stream of obligations:
  - `Intercept{phases ⊆ {Request, Response, Auth}, patterns: UrlPattern[], resourceTypes?, scope: UserContext | Page}` is a scoped resource. The adapter **reconciles** backend enablement from the set of active intercepts, using the union of patterns. It never uses a global `*` unless a predicate-only route demands it, and it never disables interception while any request is still paused (chromium-bidi `CdpTarget` reconciliation).
  - BiDi constraints: intercepts block only if the session is subscribed to the phase's event (the adapter does both), and BiDi intercepts cannot be scoped to a user context (the adapter emulates this with a global intercept and immediate continue for foreign contexts, flagged as costly).
  - **`PausedRequest`** is an obligation with `Decision = Continue{overrides} | Fulfill{response} | Fail{reason} | ProvideCredentials{...} | DefaultAuth | CancelAuth`. A **`Fallthrough`** decision passes the request to the next matching intercept (middleware-style composition). When none remain, the default (`Continue`) applies.
  - Each paused request is handled in its own fiber (a `FiberSet` per intercept scope). `onExit` applies the default decision on handler failure or interruption, or when the scope closes.
  - Backend gaps: WebKit has no auth phase and rejects redirect fulfilment; BiDi `failRequest` takes no reason and is not allowed at the auth phase; Firefox accepts a `provideResponse` body only at `beforeRequestSent`. These are capability facts on `Intercept` (§8).
- **Bodies.** A body is fetched lazily and can be *unavailable*: `Body = Effect<Uint8Array, BodyUnavailable{reason: NotCollected | Evicted | Redirect | Streaming}>`.
  - BiDi requires a **data collector to exist before the request starts**. `Collector{types, maxSize, scope}` is a scoped resource installed by any consumer that wants bodies.
  - CDP buffers bodies with eviction (`Network.getResponseBody`).
  - Streaming bodies use `Fetch.takeResponseBodyAsStream` (CDP) as a `Stream`.
- **Service workers.** Interception may see a request twice (page→SW and SW→network) or never (Cache API). `bypassServiceWorker` is a capability: CDP `Network.setBypassServiceWorker`, no BiDi equivalent (H17).

### 2.13 Downloads

`Download{id, navigable, navigation: Option<NavigationId>, url, suggestedFilename}`. It is created by a navigation response with `Content-Disposition: attachment` (and carries the navigation id) or by `<a download>` (no id). Download behavior is a declaration scoped to a user context: `Allow{dir} | Deny`. Events: `progress` and `Done{Completed{path} | Canceled}`. The navigable keeps its old document (H11). WebKit reports downloads at browser level, keyed by `pageProxyId`, and the adapter re-attributes them.

### 2.14 Workers

- **Dedicated worker.** Its realm's owner is the creating document (or worker). It is suspended while its owners are in bfcache, and closed when no longer permissible.
- **Shared worker.** Lives while any owner exists, plus a grace period. Its scope is a child of the user context.
- **Service worker.** `ServiceWorkerRegistration{storageKey, scope}` **persists across sessions** in persistent profiles. Each running instance is a **new realm**; the UA may terminate idle workers at any time, and the next event creates a new one (H18). Its scope is a child of the user context, with the realm scope cycling under a stable registration scope. Never hold SW handles across awaits.
- **CDP specifics.** Attaching to a service worker target keeps it from being destroyed, so attach only when a consumer needs it (Puppeteer detaches them otherwise, `puppeteer` M3). Chromium reports closed workers as *crashed* (`puppeteer` 6a).

### 2.15 Overrides and emulation

Each override is a scoped declaration of `(setting, scope: UserContext | Page | Frame?, value)`. Acquiring it pushes onto a per-(setting, scope) stack and applies the top; releasing it pops and re-applies the new top, or `null` (BiDi's "reset"). Settings: viewport and device pixel ratio, user agent, locale, timezone, geolocation, media features, color scheme, forced colors, reduced motion, touch, scripting enabled, offline / network conditions, CPU throttling (CDP-only), cache behavior, extra HTTP headers, bypass CSP, ignore certificate errors, permissions (§2.16), download behavior.

- **Remote-end-global state outlives sessions.** For example, BiDi device-pixel-ratio overrides are never cleared, and cache behavior is remote-end global. Its finalizers therefore register on the Browser scope as well, so a crash in a child scope cannot leak state into the next test (`webdriver-bidi` §0).
- **Not every override is mapped everywhere.** Lightpanda returns success for several emulation calls that do nothing. Capability probing (§8) must mark these as `unsupported`, not trust the reply.

### 2.16 Storage, cookies, permissions

- **Partitioning.** Storage is keyed by user context **and partition key** (top-level site plus an ancestor bit or nonce in Chromium; `originAttributes` in Firefox; WebKit is its own scheme). The spec still says "origin" (`STORAGE#storage-key`), and implementations don't. `PartitionKey` is an opaque, backend-specific value with a neutral `{topLevelSite?, crossSiteAncestor?}` view (H29).
- **Cookies.** `Cookie{name, value, domain, path, expires, httpOnly, secure, sameSite, partitionKey?}`. CHIPS `Partitioned` cookies require `Secure`. Reads and writes always state their partition.
- **StorageState** (snapshot/restore): `{userContext, cookies[], origins: [{origin, partitionKey?, localStorage, indexedDB?}]}`. Restoring into a different partition is an error, not a silent mismatch. Session storage is per Page and cloned only into popups that keep their opener.
- **Permissions.** `(descriptor, origin, topLevelOrigin?) → granted | denied | prompt`, scoped to a user context: the BiDi `permissions.setPermission` extension, CDP `Browser.grantPermissions` / `setPermission`, or WebKit `Emulation.grantPermissions`. The result is ANDed with Permissions Policy, so an iframe `allow=` attribute can still deny.

### 2.17 Readiness predicates (precise definitions)

Prior art relies on loose words ("visible", "stable", "idle"). L1 defines each one precisely. Each predicate evaluates to `Ready | NotReady{reason}`, where `reason` explains *why it cannot progress*, so waits never hang silently.

| Predicate | Definition | Cannot-progress reasons |
|---|---|---|
| **Connected** | `NodeRef` is Live (§1.3) | `Stale(Replaced \| Detached)`, `Suspended` |
| **Visible** | `checkVisibility({contentVisibilityAuto, opacityProperty, visibilityProperty})` and a non-empty client rect. For `display: contents`, any visible child counts (`CSSOMVIEW#dom-element-checkvisibility`; Playwright `domUtils`) | `NoBox`, `ContentVisibilitySkipped` |
| **Stable** | Bounding rect unchanged across *k* consecutive rendering updates. *k* = 2 frames on Chromium, Firefox and BiDi; 6 frames on WebKit/Windows, skipping frames under 15 ms. This is the backend's `stableFrames` capability | **`NoRenderingOpportunity{visibility}`** for a hidden tab, occluded window or headless without frames (H19) |
| **Enabled** | ARIA-disabled semantics: native `disabled`, `fieldset` inheritance and `aria-disabled` (Playwright `getAriaDisabled`; Puppeteer checks only native `disabled`) | — |
| **Editable** | Enabled, and not `readonly` or `aria-readonly`, and an editable element type | `NotEditableType` (terminal) |
| **NotInert** | Not in an inert subtree (modal dialog, `inert` attribute) | `BlockedByModal{dialog}` |
| **InViewport** | At least one content quad intersects the viewport with area > 0.99 after scrolling | `CannotScrollIntoView` |
| **ReceivesPointer** (hit-testable) | WebDriver *pointer-interactable*. At the action point (the centre of the first in-viewport content quad, rounded), the top of the composed-tree hit test (`elementsFromPoint` per shadow root, walking iframe ancestors with border and padding offsets) is the target or a descendant (`WD#dfn-pointer-interactable`; Playwright `expectHitTarget`). **Verified twice**: a pre-check, plus a capture-phase guard on the first *trusted* event that blocks dispatch on mismatch (layout shift between check and input, H20). | `Covered{by: NodeDescription, subtreeRoot}` |
| **NetworkIdle(N, T, exclude)** | For navigable subtree N: the count of in-flight requests attributed to N's fully active documents and their dedicated workers has been zero for T ms. Excluded by default: WebSocket, EventSource, streaming bodies, keepalive/beacon, favicon, and client-less SW fetches. Count is reset when a document epoch ends (`platform-concept-model` §3.12; Playwright uses 500 ms over the subtree) | `LongPolling{requests}` (diagnostic after T×k) |
| **DomQuiet(T)** | No mutation records in the subtree for T ms. Uses an injected `MutationObserver` over the composed tree via a channel; it must explicitly observe shadow roots, because `subtree` does not cross them (`puppeteer` M5) | — |
| **PromptFree** | No prompt open on the navigable's event loop | `PromptBlocking{prompt}` |

**Actionability** (L2 vocabulary) is a *set* of these predicates evaluated in **one injected round trip** per attempt (Vibium, Playwright), with the failing predicate named in the error. Presets per action:

- `click`/`hover`: Visible, Stable, Enabled (click only), NotInert, InViewport, ReceivesPointer.
- `fill`: Visible, Enabled, Editable, NotInert.

Users can drop individual predicates instead of using a blanket `force` (Playwright #34436).

### 2.18 Capture

| Capture | CDP | BiDi | WebKit |
|---|---|---|---|
| **Screenshot** (viewport, full page, clip, element) | `Page.captureScreenshot` | `browsingContext.captureScreenshot` | `Playwright.takePageScreenshot` / `Page.snapshotRect` (stock) |
| **PDF** | `Page.printToPDF` (streamable via `IO`) | `browsingContext.print` (base64) | — |
| **Screencast** | `Stream<Frame>`: `Page.startScreencast` + ack | writes a **file on the remote end** (`startScreencast` → path) | patched `Screencast.*` |

Screencast through BiDi is not an equivalent `Stream`; it is a separate capability (`screencastFrames` vs `screencastFile`). Full-page screenshots over about 16k px crash some stacks (browser-use), so the adapter tiles them.

### 2.19 Console, errors, logs

`ConsoleMessage{realm, level, args: RemoteValue[], stack?}` and `PageError{realm, exception}`. Under BiDi, `log.entryAdded` is buffered by the remote end until subscribed and replayed on subscribe. Under CDP it requires `Runtime.enable`: in the **OnDemand realm strategy (stealth) console capture is unavailable**, because enabling Runtime is the detection vector (`non-js-cdp-clients` §7).

---

## 3. Lifecycles in Effect

### 3.1 The scope tree

```
Browser                 Scope (sequential: close pages ∥, then contexts, then process)
└─ UserContext          Scope.fork(browser)          close: removeUserContext / disposeBrowserContext
   ├─ declarations      intercepts, preload scripts, overrides, collectors, policies (scoped resources)
   └─ Page              Scope.fork(userContext)      close: close(promptUnload?) — or remote PageClosed
      ├─ Navigation*    fibers keyed by NavigationId (FiberMap), complete with NavigationOutcome
      ├─ Frame          Scope.fork(page | parent document)   remote-only end (detach / parent epoch end)
      │  └─ Document    Scope.fork(frame)            remote-only end (replaced / destroyed / evicted); Suspendable
      │     └─ (NodeRefs are values, not scopes; validity checked against epoch state)
      ├─ Realm          Scope.fork(navigable)        remote-only end; Suspendable; linked to ≥1 Document epoch
      │  └─ Handle*     Scope (caller's)             release: disown / releaseObjectGroup (skipped if realm dead)
      ├─ PausedRequest* fibers in the intercept's FiberSet (default Decision on exit)
      └─ UserPrompt*    obligation fibers (default Decision on exit)
```

- **Closing locally vs ending remotely.** A local close sends a command and awaits the matching remote confirmation within a bounded finalizer timeout (chromedp uses 5 s). A remote end closes the scope with `Exit.fail(reason)`. Both interrupt every fiber forked in the scope. Every node exposes `closed: Effect<CloseReason>` and `within(effect): Effect<A, E | CloseReason>` (`effect-building-blocks` type sketch).
- **Close reasons are data.**

  ```ts
  type CloseReason =
    | BrowserClosed | BrowserCrashed{exitCode, signal} | ConnectionLost{cause}
    | UserContextRemoved
    | PageClosed{by: "command" | "script" | "userContext" | "browser"} | PageCrashed
    | FrameDetached{by: "removed" | "parentReplaced" | "parentClosed"}
    | DocumentReplaced{navigation: NavigationId} | DocumentEvicted | DocumentDestroyed
    | RealmDestroyed{cause: DocumentReplaced | DocumentEvicted | FrameDetached | WorkerTerminated | Crashed}
  ```

  Every error message built from these names *which object* (id, url, title), *why it ended*, and *what the caller was doing*, which is the fix for Playwright's most common complaint.
- **Suspension.** `Document` and `Realm` scopes support `suspend` and `resume`. Fibers that touch a suspended node by default **fail fast** with `DocumentSuspended`; they can opt to wait on a `Latch`. This applies spec semantics (tasks not runnable) without the spec's hang (H3).
- **Ownership defaults** (ergonomics constraint from `effect-building-blocks` idiom 9). Child resources are **parent-owned**: `newPage` registers the page's finalizer in the user context's scope and returns `Effect<Page, E>` with no `Scope` in `R`. Strict nesting (`withPage(f)`) and caller-owned handles are opt-in. Pages are heavy and need deterministic cleanup, so `FinalizationRegistry` tricks are acceptable only for cheap remote handles.
- **Finalizer strategy.** Scope finalizer strategy is per scope (verified), so the Browser scope is sequential and owns a parallel `pages` sub-scope. Pages close concurrently, then contexts, then the process. Every finalizer is bounded with `timeoutOrElse`, because `Scope.close` cannot be interrupted (verified).

### 3.2 Target attach: pause, configure, resume

For CDP (and WebKit `isPaused` targets), every new target is configured **while paused**:

1. Attach with `{autoAttach: true, flatten: true, waitForDebuggerOnStart: true}`. Re-issue this on every child session, so out-of-process iframes and workers attach recursively.
2. In parallel, under `allSettled` with failures logged (chromium-bidi's logging bug is a reminder):
   - `Page.enable` + `getFrameTree` (restoring frames we missed);
   - lifecycle events;
   - realm tracking per strategy;
   - network if demanded;
   - the reconciled `Fetch` patterns;
   - preload scripts with `runImmediately`;
   - bindings for channels;
   - the effective override stack;
   - file-chooser interception if armed;
   - the utility world.
3. `Runtime.runIfWaitingForDebugger` runs in `Effect.ensuring`, so an interrupted setup never leaves a tab frozen.
4. Events that arrive before the frame tree is known are **buffered**, preserving order. Child-target attaches are buffered until their parent frame is known.

This is the CDP compilation of P9. Under BiDi the same declarations are sent once with `contexts | userContexts`, and the remote end applies them.

### 3.3 Adoption

The browser can create resources without any user call: popups, `window.open`, `target=_blank`, service workers, and pages that already existed at attach. They are **adopted** into the scope of their user context, and published on `popups` and `pages` streams with their origin (`Opened{opener}` / `Adopted`). The `expectPopup(action)` combinator (L2) is: `PubSub.subscribe` (eager) → `action` → take first matching `Opened{opener ∈ thisPage}`. It correlates by `originalOpener`, which works even with `noopener`.

### 3.4 Process swaps

L1 holds each navigable's current adapter session in a `SubscriptionRef<SessionBinding>`:

- **CDP OOPIF swap:** `frameDetached{swap}`, then iframe target attach.
- **CDP prerender activation:** `isPageTargetBecomingPrimary`, then a session swap with the main frame re-keyed.
- **WebKit provisional page:** `targetCreated{isProvisional}` → `didCommitProvisionalTarget{old, new}`.

On a swap, the declarations (P9) are re-applied to the new session during its paused setup. Events from the stale session are dropped by checking session identity (Playwright `_eventBelongsToStaleFrame`), and in-flight commands on the old session are retried by L1 against the new binding when they are idempotent. Otherwise they surface `OutcomeUnknown`. Network requests that span the swap are *adopted* by the new session; WebKit matches them by URL.

---

## 4. Ingestion and ordering

1. **Transport.** One `messages: Stream<string>` with exactly one consumer, and `send` fails fast after `closed`.
   - **Pipe:** fd3 for input with one long-lived outbox stream (a finite stream would send EOF and disconnect Chrome), fd4 for output split on NUL.
   - **WebSocket:** our own `ws` constructor with `maxPayload` 256 MiB and no `perMessageDeflate`.

   Effect `Socket` and `ChildProcess` have pitfalls here; see `effect-building-blocks` (verified).
2. **Dispatcher (one fiber).** It decodes the *envelope* only (`{id?, method?, sessionId?}`) and routes:
   - **Replies** go by id to pending `Deferred`s, and are resolved before any event that follows them on the wire.
   - **Events** go by session to that session's ordered queue.

   Params are decoded **in the consumer's fiber**, so protocol drift becomes a `DecodeError` for that consumer and never kills the connection. That was chromiumoxide's fatal untagged-enum bug.
3. **Per-session fold.** One fiber per session applies events to the model state in order: frame tree, epochs, realms, navigations, request slots, prompts. It then publishes model events. A state change is visible in `SubscriptionRef`s *before* the corresponding model event is observable.
4. **Ordered output with enrichment.** Model events that need asynchronous enrichment (cookies for a paused request, a node description) are queued as *promise-events* in a FIFO, so their order is kept (chromium-bidi `ProcessingQueue`).
5. **Flush barrier.** `session.flush` (CDP: `Page.enable` round trip; BiDi: a no-op command) is an explicit primitive. It guarantees that every event caused by previously sent commands has been folded. It is used after input (§2.8) and in tests.
6. **Cross-session ordering is not guaranteed** (CDP, BiDi and WebKit alike; Mozilla bug 1882454 shows BiDi network events after `load`). Model rules that span sessions use **ids, not arrival order**: navigation id on requests, `loaderId` matching, and opener ids.
7. **Handlers never run on the reader.** User callbacks run in their own fibers. Synchronous listeners that call back into the browser deadlock (chromedp #455, zendriver #144, Vibium #128).

---

## 5. Interruption, compensation and outcomes

| Operation class | Examples | On interrupt before send | On interrupt after send | Compensation |
|---|---|---|---|---|
| **Query** (read-only) | evaluate (pure), describe, getBoxModel, snapshot, screenshot | nothing sent | reply abandoned (tombstoned id) | none; safe to retry |
| **Evaluation with side effects** | evaluate (author code) | nothing sent | `OutcomeUnknown` | optional `Runtime.terminateExecution` (CDP) for runaway scripts. BiDi has no equivalent; a cooperative in-page `AbortController` pattern is an open question |
| **Navigation** | navigate, reload, traverse | nothing sent | navigation continues; `OutcomeUnknown` unless the outcome is later observed | optional `Page.stopLoading` / navigate-to-current |
| **Input gesture** | click, drag, type | nothing sent | partial dispatch possible | **replay the undo list** (release keys and buttons); always performed |
| **Obligation decision** | continue, fulfil, accept | the obligation stays pending; the default decision applies on scope exit | sent | none (exactly-once enforced) |
| **Resource creation** | newPage, newContext, addPreloadScript, addIntercept | nothing sent | resource may exist remotely | adopt-or-destroy on late reply (`raceUncancellableOperationWithCleanup` done properly with `acquireRelease` + `uninterruptibleMask`) |
| **Resource release** | close, remove, disown | — | finalizers are uninterruptible but bounded | on timeout: escalate (kill process / mark leaked) |

The outcome type:

```ts
type Outcome<A, E> = Exit<A, E | OutcomeUnknown>
```

`OutcomeUnknown{operation, sentAt, lastObserved}` is returned only for mutating operations interrupted after send. Higher layers decide whether to re-observe (for example, re-read state) or to fail.

---

## 6. Error vocabulary (L1)

Errors come in three families.

| Family | Errors | Notes |
|---|---|---|
| **Lifetime** | `CloseReason` (§3.1), `Stale{node, reason}`, `DocumentSuspended`, `PromptBlocking{prompt}` | — |
| **Protocol** (one tagged error with a `reason`, the HttpClientError pattern) | `ProtocolError{method, code, message, data}`, `DecodeError{method, issue}`, `CommandTimeout{method, after}`, `SessionSwapped`, `Unsupported{capability, backend, method?}` | `Unsupported` normalizes vendor "not implemented" strings: Chrome's `unknown error - Method X is not implemented`, WebKit "Method not implemented" |
| **Domain** | `JsException{realm, details}`, `NavigationFailed{error, errorDocument}`, `NotReady{predicate, reason, history}`, `StrictViolation{candidates}`, `BodyUnavailable{reason}`, `IncompatibleBrowserRevision{expected, actual, missing}`, `OutcomeUnknown{...}` | `NotReady` is raised by the predicates (§2.17); L2 wraps it into actionability and expectation errors |

Errors are classified as **retryable** or **terminal** in exactly one place (`isRetryable`), by tag. Never by message substring: Puppeteer and Playwright both classify by substring today, and it breaks across vendors.

---

## 7. Observability built into the model

Every model operation is an `Effect.fn`-traced span: `navigable.navigate`, `realm.evaluate`, `input.gesture`. Protocol commands are child spans at `level: Debug`, with `protocol.method` and `protocol.session`. Retry attempts and predicate results become **span events**, which is Playwright's call log as structured data. Navigation outcomes, close reasons and obligation decisions are span attributes.

L1 uses a **live clock** reference for all deadlines and span timestamps. `@effect/vitest`'s `it.effect` installs `TestClock`, which would otherwise freeze library waits and stamp traces with fake times (`testing-models`, fixtures section).

---

## 8. Capabilities

A `CapabilitySet` is computed per backend at connect. It is static where known and **probed** where uncertain, with results cached per method. L2 consumes it in two ways: as **services in `R`**, where absence should be a compile error (`Tracing`, `Coverage`, `AxTree`, `ScreencastFrames`, `RuntimeEvents`), or as **typed `Unsupported`** where only a runtime check is possible.

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
| closed shadow access from injected code | via protocol DOM | via `locateNodes` | via `locateNodes` | via protocol DOM | via protocol DOM | ? |
| stable-frames k | 2 | 2 | 2 | 2 (6 on Windows) | ? | ? |
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
4. **Missing terminal events.** For canceled `navigate`, `intercept()`, `javascript:` non-string, and superseded navigations, what does each backend emit? This fixes the inference rules in §2.8.
5. **Prerender activation.** Which ids does the activated page carry? Do preload scripts run in prerendered documents?
6. **Fenced frames.** Are they children or top-level in `getTree` and `Target`?
7. **Service workers.** How are SW-served requests and SW subrequests attributed? Is the double interception real?
8. **Orphaned children.** Does every backend emit detach for children of a navigated-away document?
9. **Event-loop sharing.** Does `alert()` in a popup block evaluation in its same-site opener, on each engine?
10. **Stability.** Measure rAF cadence and `stableFrames` per backend and headless mode, and check behavior in background tabs.
11. **Lightpanda and similar partial CDPs.** Which methods return success without effect?
12. **Pipe EOF.** Does Chrome exit when fd3 and fd4 close after the parent is SIGKILLed? Does Bun's `child_process` support extra fds? (`effect-building-blocks` open questions 1–2.)
13. **BCG switch detection.** How does each backend reveal that a commit switched browsing context groups (COOP, prerender activation)? Candidates are an opener change on target info, a new `WindowProxy` identity, or `sharedId` invalidation. Without a signal, `bcgSwitched` has to be inferred from response headers (COOP) and outcome kind.
14. **Safari BiDi on stable.** Does `safari:experimentalWebSocketUrl` work on stable Safari 27, or only on STP? (`webkit` open questions.)

The probe suite is also the regression suite for adapters: recorded traffic decodes against the generated schemas (drift test), and recorded behavior re-runs on each browser roll.

---

## 10. Hazard coverage

How each hazard from `platform-concept-model` §4 is handled by the model:

| Hazard | Mechanism |
|---|---|
| H1 detached between query and action | NodeRef validity + re-resolution at action time (L2 locators); `document.open` → `Stale(Detached)` |
| H2 navigation during evaluation | evaluation forked in the realm scope; realm end interrupts with `DocumentReplaced` |
| H3 evaluation in a bfcached document | `DocumentSuspended` fail-fast; opt-in wait via `Latch` |
| H4 script before realm-created | preload scripts (P9) registered before navigation; never rely on realm events for "first" |
| H5 frame scripted before it's known | auto-attach with pause; preload scripts scoped by user context |
| H6 popup before listeners | eager subscription per user context; `originalOpener` correlation; initial about:blank ≠ loaded |
| H7 process swap | `SessionBinding` ref; re-apply declarations; idempotent retry or `OutcomeUnknown` |
| H8 BCG switch | `bcgSwitched` / `openerSevered` on the outcome; `Stale(Replaced)` for sharedIds |
| H9 navigation without terminal event | supersession / historyUpdated / quiescence inference; `inferred` flag |
| H10 failed but committed | `Failed{errorDocument}` |
| H11 no document | `Download`, `NoContent` outcomes |
| H12 ignored during traversal/unload | `Canceled{traversalInProgress \| unloading}` |
| H13 about:blank reuse | Realm as sibling of Document; `isInitialAboutBlank`; replace semantics |
| H14 prompt blocks siblings | `eventLoopKey` propagation; `PromptBlocking` fail-fast; default policy |
| H15 beforeunload needs activation | activation estimate; `close` / `navigate` can return `Canceled{beforeunload}` |
| H16 bfcache restore | `Restored` outcome; Suspended → Complete; handles revive (if supported) |
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
| H29 wrong storage partition | `PartitionKey` on every storage op; StorageState carries partitions |
| H30 prerender | `Activated` outcome; capability-gated prerender pages |
| H31 keepalive outlives page | requests of ended epochs → `Failed{Abandoned}` or attributed `detached` |
| H32 small traps | documented per operation |

---

## 11. Decisions this document locks, and what it leaves to DESIGN.md

**Locked by L1:**
- **Identity:** navigable / document epoch / realm, with our own ids. `NodeRef` carries its epoch.
- **Lifetimes:** a scope tree with remote-driven closure and typed reasons. Suspension exists for bfcache.
- **Navigation:** the outcome union, with inference rules where the spec has gaps.
- **Obligations:** paused requests, prompts and file choosers resolved exactly once, with defaults.
- **Declarations** cover future targets; overrides stack.
- **Ingestion:** lossless and ordered, with state folded before emission and an explicit flush barrier.
- **Interruption:** abandon plus compensate, with `OutcomeUnknown`.
- **Readiness predicates** with precise definitions and cannot-progress reasons.
- **Capabilities** as services or typed `Unsupported`. Probes settle the unknowns.
- **Realm discovery:** Tracked or OnDemand (stealth), chosen per user context.

**Left to DESIGN.md (L2, ergonomics first):**
- Locator values (AST, strictness policy, relative `has` locators), actions and actionability presets.
- The expectation/condition algebra with history in failures.
- Combinators: `expectPopup`, `waitForResponse({during})`, `withNavigationBarrier`.
- Agent toolkit: snapshots with refs bound to document epochs, typed `StaleRef`, the action outcome "no observable effect", one `effect/ai` toolkit serving in-process use, MCP and CLI.
- Test integration (Layers, `TestInfo`, artifacts on `Exit`), tracing artifacts, record/replay.
- Naming, module layout, and the call sites we want users to write first.
