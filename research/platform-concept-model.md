# Platform concept model (spec-grounded)

Research note feeding CONCEPTS.md. Sources were fetched on 2026-10-18 from the living specs and read as text. They are the HTML Living Standard, DOM, Fetch, Storage, Service Workers (nightly), Permissions, WebDriver BiDi (editor's draft), WebDriver classic, ECMA-262 §9, the ShadowRealm proposal, CSSOM View, CSS Position 4, CSS Contain 2, UI Events, Pointer Events, Fullscreen, Prerendering Revamped (WICG), Fenced Frame (WICG) and CHIPS (privacycg).

**Citation convention.** `HTML#x` means `https://html.spec.whatwg.org/#x` (anchors are the same in the multipage edition). The other prefixes are:

- `DOM#` dom.spec.whatwg.org
- `FETCH#` fetch.spec.whatwg.org
- `STORAGE#` storage.spec.whatwg.org
- `SW#` w3c.github.io/ServiceWorker
- `PERM#` w3c.github.io/permissions
- `BIDI#` w3c.github.io/webdriver-bidi
- `WD#` w3c.github.io/webdriver
- `PRERENDER#` wicg.github.io/nav-speculation/prerendering.html
- `FENCED#` wicg.github.io/fenced-frame
- `CSSOMVIEW#`, `CSSPOS4#`, `CSSCONTAIN#`, `UIEVENTS#`, `POINTER#`, `FULLSCREEN#`: the corresponding CSSWG and W3C drafts

ECMA-262 is cited by section number.

---

## 1. Summary

The platform has **three identity layers** that a driver tends to conflate:

1. **Navigable, a stable "slot".** A navigable is a tab, an iframe, or the slot inside a fenced frame or prerender. It has an `id`, a parent and a session history. Its identity survives every navigation, including cross-site ones, COOP swaps and process swaps. WebDriver BiDi's `browsingContext.BrowsingContext` id is the **navigable id**, not the browsing context (`BIDI#navigable-id`). Most driver handles (Page, Frame) should bind to this layer.
2. **Document and its Window, realm and environment settings object: one "epoch" of a navigable.** A navigation normally creates a new Document, Window and realm. There are three exceptions:
   - The initial `about:blank` Window is *reused* by the first same-origin-domain navigation (`HTML#initialise-the-document-object`).
   - `document.open()` keeps the same Document and realm but wipes the tree (`HTML#document-open-steps`).
   - bfcache keeps an old Document alive, not fully active, and later reactivates it without creating a new realm (`HTML#reactivate-a-document`).

   Element handles, JS handles and sandboxes belong to this layer.
3. **Browsing context, browsing context group and agent cluster: the scripting and isolation topology.** A browsing context is 1:1 with a `WindowProxy`. A navigation that requires a browsing context group (BCG) switch (COOP, fenced-frame embedder navigation, prerender activation, optional UA swaps) gives the *same navigable* a *new browsing context* and severs opener links (`HTML#obtain-browsing-context-navigation`). Event loops are per agent. Agents are per (BCG, agent cluster key = site, or origin). So "which pages freeze when this page shows `alert()`" is answered at this layer.

Processes are **not** a spec concept. Protocol identities (CDP target, session, `executionContextId`) are per process, so they change on events that leave spec identity untouched (§3.16).

Navigation is the richest hazard source. A navigation id is minted before anything is known. It can be silently superseded, intercepted into a same-document navigation, turned into a download, end with no document (204/205), or commit an *error document* while reporting "failed". BiDi gives no terminal event for several of these (H9–H12).

---

## 2. Containment and lifecycle graph

```
UserAgent
 ├─ UserContext (BIDI#user-context; storage partition)          1 ──* TopLevelTraversable
 │   └─ TopLevelTraversable  (HTML#top-level-traversable)        [Scope: tab]
 │       ├─ session history entries[] (step-indexed)             1 ──* SessionHistoryEntry
 │       │    └─ SessionHistoryEntry ── documentState ── Document | null (evicted)
 │       │                                   └─ nestedHistories[] (child navigables' entries)
 │       ├─ storage shed (sessionStorage)                        1 ──1
 │       └─ active Document  ◄── "fully active" chain ──►
 │            ├─ Window (global) ═ realm ═ environment settings object  (1:1:1)
 │            │    ├─ WindowProxy (per browsing context, survives Window swaps)
 │            │    ├─ sandbox realms (BiDi "sandbox"/CDP isolated world)  0..* per Window
 │            │    ├─ dedicated workers (owner set)  0..*  ── nested dedicated workers
 │            │    └─ worklet global scopes 0..*  (terminated with document)
 │            ├─ node tree (+ shadow trees, top layer, pending top layer removals)
 │            │    └─ navigable container (iframe/frame/object/embed)
 │            │          └─ ChildNavigable (HTML#child-navigable)  [Scope: frame]
 │            │                └─ active Document ... (recursive)
 │            └─ fencedframe ─► fenced navigable = TraversableNavigable with unfenced parent
 │                                 (FENCED#traversable-navigable-unfenced-parent; own BCG)
 │
 ├─ BrowsingContextGroup (HTML#browsing-context-group)
 │    ├─ browsing context set (top-level BCs) ── each BC: 1 WindowProxy, opener, group
 │    ├─ agent cluster map[key] ─► AgentCluster ─► similar-origin window agent ─► event loop
 │    └─ historical agent cluster key map (monotonic)
 │
 ├─ Shared workers / Service worker registrations (keyed by storage key + scope)
 │    └─ ServiceWorker (state machine) ─► ServiceWorkerGlobalScope realm (0..1 while running)
 └─ Permission store, cookie jar(s) (partitioned), HTTP cache partitions

Lifecycle of a Document (window event loop):
  created ──(set up window ESO ⇒ BiDi realmCreated)──► not yet active
     ──(apply history step: make active; BiDi navigationCommitted; "scripts may run")──► fully active
     ──(parent not fully active / entry not current)──► active-but-not-fully-active | inactive-in-bfcache
     ──(reactivate: pageshow persisted=true)──► fully active
     ──(unload: pagehide, visibility hidden, [unload if !salvageable], cleanup ⇒ BiDi realmDestroyed)──►
     ──(destroy: abort, drop tasks, browsing context := null, workers lose owner)──► dead
```

Cardinalities: a navigable has exactly one active session history entry and therefore at most one active document. A traversable has many entries. A Document belongs to at most one browsing context (null once destroyed, or when it was created via `createHTMLDocument`). A browsing context has many Documents over time, and the Documents of one browsing context all share its `WindowProxy`. A realm, a global and an environment settings object are strictly 1:1:1 (`HTML#realms-settings-objects-global-objects`).

---

## 3. Concept entries

### 3.1 User context (BiDi only)
- **Definition and identity.** "A collection of zero or more top-level traversables… Each user context has an associated storage partition" (`BIDI#user-context`). Identified by a string id; `"default"` always exists (`BIDI#default-user-context`). CDP's equivalent is `browserContextId`.
- **Containment.** One user context contains many top-level traversables. A child navigable inherits its parent's user context. Whether a popup inherits its opener's user context is an open spec issue; implementations do inherit it.
- **Lifecycle.** Created by command or by the UA, and removable only when empty (except the default context). Removal closes its traversables in practice.
- **State.** Storage partition (cookies, storage, cache) and per-context overrides: viewport, locale, timezone, prompt handlers, proxy, network conditions, extra headers.
- **Driver operations.** `create(options)`, `remove`, list, set overrides.
- **Invariants.** No storage is shared across user contexts.

### 3.2 Navigable, traversable navigable and top-level traversable
- **Definition.** A navigable "presents a Document to the user via its active session history entry" (`HTML#navigable`). Fields: `id`, `parent`, `current` and `active session history entry`, `is closing`, `container`, and `ongoing navigation`, which is a navigation id, `"traversal"` or null (`HTML#ongoing-navigation`). Prerendering adds `loading mode` and `scripting mode` (`PRERENDER#navigable-loading-mode`).
- **Kinds.**
  - A **traversable navigable** (`HTML#traversable-navigable`) owns the session history entries, the current step, a **session history traversal queue** (which serialises all history mutation for the tab), the system visibility state and `is created by web content`.
  - A **top-level traversable** has a null parent.
  - A **child navigable** has a parent and is presented by a *navigable container* element (`HTML#child-navigable`).
- **Identity.** `id` is "a unique internal value". It is BiDi's navigable id, and it equals the WebDriver window handle for top-level traversables. BiDi also records `original opener` (`BIDI#original-opener`), which survives `window.opener = null`.
- **Creation.**
  - **Top-level.** Created from UI or by command (*create a fresh top-level traversable*, which then navigates), or by `window.open` and targeted links or forms via the *rules for choosing a navigable* (`HTML#the-rules-for-choosing-a-navigable`). The latter path synchronously creates an auxiliary browsing context and its initial `about:blank`, sets `is created by web content`, and consumes transient activation if a popup blocker is active.
  - **Child.** Created synchronously during iframe insertion (`HTML#the-iframe-element`). The BiDi `navigable created` hook runs later, from appended traversal steps.
- **Destruction.**
  - **Child.** Container removal runs *destroy a child navigable* "without any unload events firing" (`HTML#destroy-a-child-navigable`).
  - **Top-level.** *Close* → *definitely close*, which checks beforeunload, then unloads, then destroys (`HTML#close-a-top-level-traversable`). The UA "may destroy a top-level traversable at any time" (`HTML#destroy-a-top-level-traversable`).
  - **Prerender.** Discarded, or emptied on activation.
  - **Spec gap.** When a parent *document* is destroyed by navigation, its child documents are destroyed but *destroy a child navigable* is never called, so the BiDi `navigable destroyed` hook is not formally invoked for them. When the parent goes into bfcache, the children stay attached through its nested histories and are merely not fully active.
- **State to track.** Parent and children (in document order), active document URL and readiness, ongoing navigation id, opener, user context, visibility, loading mode and scripting mode.
- **Operations.** navigate, reload, traverse, close(promptUnload), activate, screenshot/print, set viewport, locateNodes.
- **Events.** Created (`hasPlannedNavigation`), destroyed, navigation events, prompts.
- **Invariants.**
  - The id is immutable.
  - There is at most one ongoing navigation per navigable.
  - "Any attempts to navigate a navigable that is currently traversing are ignored" (`HTML#navigate`).
  - A child navigable's user context equals its parent's.

### 3.3 Browsing context, browsing context group, agent cluster, agent and event loop
- **Browsing context** (`HTML#browsing-context`). "A programmatic representation of a series of documents," 1:1 with a `WindowProxy`.
  - Fields: `opener browsing context`, `opener origin at creation`, `is popup`, `is auxiliary` (auxiliary contexts are always top-level, `HTML#auxiliary-browsing-context`), `group`.
  - It is created together with its initial `about:blank` (`HTML#creating-a-new-browsing-context`).
- **BCG switch** (`HTML#obtain-browsing-context-navigation`).
  - **Trigger.** A top-level navigation gets a new browsing context in a **new group** when:
    - the COOP enforcement result requires it (`HTML#coop-enforcement-result`, `HTML#check-browsing-context-group-switch-coop-value`); or
    - the UA optionally decides to (non-HTTP(S) cross-site, browser-UI-initiated, or a group of size 1: "Some implementations swap browsing context groups here for performance reasons"); or
    - it is an embedder navigation of a fenced frame (`FENCED#bcg-swap`); or
    - it is a prerender activation.
  - **Effects.**
    - The old browsing context survives only in bfcache.
    - The opener is severed, and the WindowProxy is new.
    - The top-level `window.name` is cleared on cross-origin commits (`HTML#resetBCName`).
- **Browsing context group** (`HTML#browsing-context-group`).
  - It holds the browsing context set, the cross-origin isolation mode, the agent cluster map, and a monotonic *historical agent cluster key map*. The key map keeps same-origin documents in one cluster (`HTML#historical-agent-cluster-key-map`).
  - The group dies with its last browsing context.
- **Agent cluster and agent** (ECMA-262 §9.6–9.7).
  - An agent is a set of execution contexts plus an executing thread.
  - A cluster is "a maximal set of agents that can communicate by operating on shared memory."
  - An embedding "must not leave some agents in the cluster active while other agents… are deactivated indefinitely."
- **Clustering in HTML.** *Obtain a similar-origin window agent* (`HTML#obtain-similar-origin-window-agent`) keys the cluster:
  - by **site**, normally;
  - by **origin**, under `Origin-Agent-Cluster: ?1` (`HTML#origin-agent-cluster`) or cross-origin isolation.

  There is "only one similar-origin window agent per browsing context agent cluster". Each agent has exactly one **event loop** (`HTML#window-event-loop`).
- **Event loop.**
  - "A task is runnable if its document is either null or fully active" (`HTML#concept-task-runnable`), so a bfcached document's tasks **wait** rather than fail.
  - `pause` (`HTML#pause`): "the corresponding event loop must not run further tasks, and any script in the currently running task must block". It is used by `alert`, `confirm`, `prompt` and the beforeunload prompt.
  - The termination nesting level, which is non-zero during `beforeunload`, `pagehide` and `unload`, makes `window.open` return null and permits dialog suppression.
- **Invariant.** Same-site documents in one group (openers, popups, iframes) share one event loop, so a dialog or busy loop in one stalls the others. Agent clusters are idealised process boundaries, "generally more restrictive than the actual process boundaries".
- **Driver exposure.** Internal. Derive `eventLoopKey = (bcgId, clusterKey)` to predict blocking, and report BCG switches as a fact on the navigation ("opener severed").

### 3.4 Session history entry and document state
- **Entry** (`HTML#session-history-entry`). Fields: `step` (int or "pending"), `URL`, `document state`, `classic history API state`, `navigation API state`, `navigation API key` / `id`, `scroll restoration mode`, `persisted user state`.
- **Document state.** Fields: `document` (may be **nulled**, i.e. evicted; traversing back to the entry refetches), `history policy container`, `request referrer`, `initiator origin`, `origin`, `about base URL`, `nested histories`, `resource` (POST body or srcdoc string), `reload pending`, `ever populated`, `navigable target name`.
- **Invariants.**
  - `javascript:` URLs are never stored ("javascript: URLs are never stored in session history").
  - `pushState` on the initial `about:blank` acts as a replace.
  - The traversable's step indexes across *all* nested navigables (the "Jake diagram", `HTML#jake-diagram`). `history.length` therefore spans frames.
- **Driver exposure.** Internal or derived. The protocols expose only `traverseHistory(delta)` and coarse entry lists. Don't model the full history tree.

### 3.5 Document
- **Identity.** No protocol-visible id in BiDi. A driver must synthesise a "document epoch" from navigation ids or realm ids. CDP has `loaderId`, which is per navigation, plus document node ids per DOM agent.
- **State that matters.** `URL`, `origin`, `is initial about:blank`, `current document readiness` (`loading` → `interactive` → `complete`), `salvageable`, `page showing`, `has been revealed`, `visibility state`, `unload counter`, `active sandboxing flag set`, `opener policy`, `during-loading navigation ID for WebDriver BiDi` (`HTML#concept-document-navigation-id`, set at creation and cleared when loading finishes), `bfcache blocking details`, `top layer`, `pending top layer removals` (`CSSPOS4#document-top-layer`), and the focused area.
- **Status lattice.**
  - *Fully active*: active document of a navigable whose container document is fully active (`HTML#fully-active`).
  - *Active but not fully active*: a child of a bfcached parent.
  - *Inactive and salvageable*: in bfcache.
  - *Destroyed*.
- **Creation paths.**
  1. **Initial `about:blank`.** Created with the browsing context, synchronously, with `is initial about:blank = true` (`HTML#is-initial-about:blank`). It is never a navigation. For an iframe whose `src` is absent or `about:blank`, the initial insertion runs only the "iframe load event steps".
  2. **Navigation response** (`HTML#initialise-the-document-object`). Creates a new Window, realm and agent unless the old document is the initial `about:blank` and is same-origin-domain with the new origin, in which case **the Window is reused**.
  3. **srcdoc.** A navigation to `about:srcdoc` whose `resource` is the attribute string (`HTML#process-the-iframe-attributes`).
  4. **`javascript:` URL.** Evaluated in the *target's current realm*. If the result is a string, a new Document is created from it as `text/html`, with the same URL, *replace* handling and the initiator's origin (`HTML#evaluate-a-javascript:-url`). Otherwise there is no navigation.
  5. **Error document.** On network error, CSP or XFO block, the UA commits "a document for inline content that doesn't have a DOM", made unsalvageable with reason `"navigation-failure"` (`HTML#populating-a-session-history-entry`).
  6. **Non-DOM documents.** Media, text, plugins and PDF viewers (§7.5 loaders).
- **Mutation without replacement.** `document.open()` (`HTML#document-open-steps`) stops the ongoing navigation, erases all listeners (nodes and Window), runs "replace all with null", updates the URL via the *URL and history update steps*, clears `is initial about:blank` and resets readiness to `loading`. Document, Window and realm survive.
- **Unload** (`HTML#unload-a-document`). Raises the unload counter and the termination nesting level. Then it fires `pagehide` (persisted = salvageable), sets visibility to `hidden`, fires `unload` *only if not salvageable*, records the suspended timers, and runs the **unloading document cleanup steps**. BiDi's `realmDestroyed` lives there, so it fires even when the document goes to bfcache. Finally it destroys the document if it is not salvageable.
- **Destroy** (`HTML#destroy-a-document`). Aborts the document (cancels fetches and the parser, and fires BiDi `navigation aborted` if loading was still in progress), runs the cleanup steps, removes the document's queued tasks *without running them*, sets the browsing context to null, removes the document from worker owner sets, and terminates worklets.
- **Reactivate (bfcache restore)** (`HTML#reactivate-a-document`). Resets autocomplete=off controls, shifts timers by the suspend duration, updates navigation API entries, and, if readiness is complete, sets `page showing`, visibility `visible` and `pageshow(persisted=true)`. **No new realm and no BiDi navigationCommitted** (`documentIsNew` is false in `HTML#update-document-for-history-step-application`).
- **Prerendered document.** Its navigable's scripting mode is `blocked-until-activation`, so no script runs. Dialogs return as suppressed, `print()` is a no-op and downloads are deferred (`PRERENDER#intrusive-behaviors`). On activation the whole session history entry, including the document and its browsing context, *moves* into the predecessor top-level traversable: "traversing across the associated history entries will cause a browsing context group switch… this will sever any opener relationships" (`PRERENDER#prerendering-traversable-activate`). Then `prerenderingchange` fires.
- **Fenced frame.** `<fencedframe>` is a *fenced navigable container*. Its fenced navigable is a **traversable navigable with an unfenced parent**, not a child navigable (`FENCED#traversable-navigable-unfenced-parent`). It has its own session history, a separate BCG, and user activation that does not cross the boundary. Sandbox flags do cross. Embedder-initiated navigations force a BCG swap.

### 3.6 Navigation
- **Identity.** A navigation id is "a UUID string generated during navigation… used to interface with the WebDriver BiDi specification as well as to track the ongoing navigation" (`HTML#navigation-id`). BiDi's `browsingContext.navigate` creates the id itself and passes it to `navigate` (`BIDI#await-a-navigation`). The *committed* document then carries it as `during-loading navigation ID`, so `domContentLoaded` and `load` carry it too.
- **Kinds.** Cross-document, fragment (`HTML#navigate-fragid`), URL-and-history update (`pushState`, `replaceState`, `document.open`, `about:blank?x`), `javascript:`, history traversal (`HTML#apply-the-history-step`, by delta or `navigation.traverseTo`), reload, Navigation-API-intercepted (cross-document converted to same-document), download-converted, and prerender activation.
- **Algorithm landmarks in `HTML#navigate`, in order.** Steps that end the navigation are tagged *(terminal)*.
  1. Mint the id.
  2. Hop to the target's event loop if necessary.
  3. *(terminal)* `unload counter > 0` gives **navigation failed**.
  4. *(terminal)* Sandbox or "allowed to perform a navigation" checks give **failed**.
  5. Resolve `auto` to push or replace. It must be replace for `javascript:` or the initial `about:blank`, and is replace when the URL is unchanged.
  6. *(terminal)* Fragment-only change: navigate to the fragment synchronously, giving **fragmentNavigated**.
  7. Mark the parent delayed for `load`.
  8. **BiDi navigationStarted** (status pending).
  9. *(terminal)* Ongoing traversal gives **failed**.
  10. Set the ongoing navigation. This aborts the previous one via "inform the navigation API about aborting navigation" (`HTML#set-the-ongoing-navigation`).
  11. *(terminal)* `javascript:` queues the evaluation.
  12. Fire the Navigation API `navigate` event (same origin-domain, not from browser UI, not the initial `about:blank`). Cancel and intercept are both handled here.
  13. In parallel: *check if unloading is canceled* (beforeunload in every descendant, `HTML#checking-if-unloading-is-canceled`).
  14. Abort the current document and its descendants.
  15. Fetch, following redirects manually, with COOP, CSP, CORP and XFO checks per hop (`HTML#create-navigation-params-by-fetching`).
  16. Populate the entry: error document, download, or 204/205 (no document).
  17. *Finalize a cross-document navigation*, then *apply the history step*, which makes the document active, fires **BiDi navigationCommitted**, and only then can "scripts… run for the newly-created document".
- **Redirects.** The reserved client (environment) is **discarded and re-created when a redirect crosses origins**, which gives a new environment id. `responseOrigin`, COOP and sandbox flags are recomputed per hop. The classic history state is reset. The BiDi request id stays stable across redirects (`BIDI#request-id`).
- **Same-document.** A fragment navigation updates the entry and fires `popstate` (via restore) and a queued `hashchange`, plus **BiDi fragmentNavigated** with the id. `pushState` and `replaceState` fire no `hashchange` or `popstate`, and give **BiDi historyUpdated**, which has *no navigation id* (`HTML#url-and-history-update-steps`).
- **Navigation API intercept** (`HTML#inner-navigate-event-firing-algorithm`). `canIntercept` is true iff the document "can have its URL rewritten" to the destination and the navigation is not a cross-document traverse. `intercept({handler, precommitHandler})` changes `interception state`. The commit then performs a URL-and-history update (historyUpdated). `navigatesuccess` and `navigateerror` follow the handler promises. A canceled `navigate` event returns from `navigate` **without any BiDi terminal hook**.
- **beforeunload** (`HTML#steps-to-fire-beforeunload`). A prompt is shown only if the event was canceled or `returnValue` was set, *and* the document has **sticky activation**, *and* the sandboxed-modals flag is unset, *and* no prompt has been shown yet in this check. The BiDi handler can auto-dismiss it, which cancels the navigation.
- **Downloads** (`HTML#handle-as-a-download`). Two paths: a navigation response with `Content-Disposition: attachment` (carries the navigation id), and `<a download>` (id null, fires a `navigate` event with `downloadRequest`). Hooks: BiDi `downloadWillBegin`, which can deny with `allowed: false`, then `downloadEnd` (`complete` or `canceled`). The navigable keeps its old document.
- **Terminal outcomes a driver must model:**
  - committed (cross-document)
  - same-document (fragment or intercept)
  - download
  - no-content (204/205)
  - failed, though an error document may still commit
  - aborted (after commit, while loading)
  - superseded (silently, at the fetch stage)
  - canceled (beforeunload, the navigate event, sandbox, unload counter, or traversal in progress)
  - javascript-noop

### 3.7 Realm, global object and environment settings object
- **Definition.** ECMA-262 §9.3: "a set of intrinsic objects, an ECMAScript global environment, all of the ECMAScript code that is loaded within the scope of that global environment." In HTML each realm's `[[HostDefined]]` is its settings object (`HTML#realms-settings-objects-global-objects`).
- **Fields.**
  - *Environment* (`HTML#environment`): `id`, `creation URL`, `top-level creation URL`, `top-level origin`, `target browsing context`, `active service worker` and `execution ready flag`.
  - *Settings object*: adds the module map, API base URL, origin, policy container, cross-origin isolated capability and time origin.
- **Identity.** BiDi `realm id` is opaque and "must not be derivable from… the navigable id" (`BIDI#realm-id`). BiDi `script.RealmType` values: `window`, `dedicated-worker`, `shared-worker`, `service-worker`, `worker`, `paint-worklet`, `audio-worklet`, `worklet`. A window realm's info carries `context` (navigable id) and an optional `sandbox`.
- **Lifecycle.**
  - **Window realm.** Created in *create and initialize a Document object*, before the document is active. BiDi `realmCreated` fires at "set up a window environment settings object", so in principle **before navigationCommitted**. The execution ready flag is set in *make active*.
  - **Worker realm.** Created, with `realmCreated` emitted, *before the worker script is fetched*. Execution ready is set after the fetch succeeds.
  - **Destroyed.** BiDi `realmDestroyed` fires from the unloading cleanup steps, which includes entry into bfcache, from worklet termination, and from destruction of a worker event loop.
- **Kinds and lifetimes relative to documents:**
  - **Window.** Usually one per document, except the reused initial `about:blank` Window.
  - **Dedicated worker.** Owned by the creating document or worker through the *owner set*. It is *actively needed* while an owner is fully active, *suspendable* while owners are bfcached, and closed when not *permissible* (`HTML#active-needed-worker`, `HTML#permissible-worker`).
  - **Shared worker.** Lives while any owner exists, plus a between-loads timeout and an optional extended lifetime.
  - **Service worker.** Independent (§3.9).
  - **Worklet.** Owned by the document and terminated on destroy.
  - **ShadowRealm.** A TC39 proposal. `new ShadowRealm()` creates a realm synchronously in the same agent, with host-chosen globals and "HostInitializeShadowRealm" (proposal §3.6.1). It has no BiDi realm type yet, and it lives as long as its JS object is reachable.
- **Sandbox realms** (`BIDI#sandbox-realm`). "Each sandbox is a unique ECMAScript Realm", keyed by (Window, name) in a per-session *sandbox map*. Platform objects are reached through `SandboxProxy`, which shows only Web IDL properties and no page expandos. Much of this is still "Define how this works" (issue markers). CDP's equivalent is the isolated world created with `Page.createIsolatedWorld`: a separate V8 context per (frame, world) that shares the DOM but has distinct JS wrappers. The sandbox **dies with its Window**, and the map is keyed by Window, not navigable. Preload scripts can target a sandbox.
- **Script execution gate.** "check if we can run script" returns "do not run" if the global is a Window whose document is not fully active, or if scripting is disabled (`HTML#check-if-we-can-run-script`). BiDi preload scripts run "on creation of a new Window, before any author-defined script" (`BIDI#preload-script`). The HTML integration point for them is not formally hooked.

### 3.8 Node identity, shadow DOM, top layer, inert and content-visibility
- **Node identity.** A node has a `node document`, which is changed by *adopt* (`DOM#concept-node-adopt`). Each realm, page or sandbox, has its own JS wrapper for the same node. Cross-realm identity is therefore *by node, not by wrapper*.
- **BiDi `sharedId`.** It comes from WebDriver's browsing-context-group node map, a weak map from node to id kept per BCG (`WD#dfn-get-or-create-a-node-reference`). Resolving a sharedId fails with `no such node` in two cases (`BIDI#deserialize-shared-reference`):
  - the node was not seen in that navigable; or
  - the realm is not same origin-domain with the node's document.
- **Staleness.** An element "is stale if its node document is not the active document or if it is not connected" (`WD#dfn-is-stale`). It follows that a BCG switch kills every sharedId, and a bfcache restore *revalidates* them.
- **Shadow DOM** (`DOM#concept-shadow-root`).
  - A shadow root has a mode (`open` or `closed`), delegates focus, a slot assignment mode (`named` or `manual`), and the clonable, serializable and declarative flags.
  - **Retargeting** (`DOM#retarget`) maps `event.target`, `elementsFromPoint` results and focus to the host for outside observers.
  - "Closed" restricts only what page code can observe (`DOM#concept-closed-shadow-hidden`). Protocol DOM agents and BiDi `locateNodes` can still pierce closed roots.
  - Slotted nodes render in the flat tree but remain children of the host. Hit testing and `checkVisibility` use the flat tree.
- **Top layer** (`CSSPOS4#document-top-layer`).
  - It is an ordered set per Document, managed only by the UA. Its members are the modal `<dialog>` (`HTML#dom-dialog-showmodal`), popovers (`HTML#show-popover`) and the fullscreen element. They paint above everything else, in set order.
  - Removals go through *pending top layer removals* and are processed at the end of update-the-rendering. An element can therefore be closed and still painted for one frame.
- **Inert** (`HTML#inert-subtrees`). An inert node hit-tests like `pointer-events: none`, cannot be focused, and is hidden from assistive technology. A topmost modal dialog inerts "every node that is connected to document, with the exception of the subject element" (`HTML#blocked-by-a-modal-dialog`).
- **content-visibility** (`CSSCONTAIN#skips-its-contents`). `hidden`, or `auto` while the element is not "relevant to the user" (near the viewport, focused or selected), skips rendering the contents. The skipped nodes have no boxes and are not hit-test targets, and `checkVisibility()` returns false for them. Proximity is determined inside update-the-rendering.

### 3.9 Service workers
- **Registration** (`SW#dfn-service-worker-registration`). A tuple of (storage key, scope URL) plus installing, waiting and active workers. It persists across sessions until unregistered ("A user agent must persistently keep a list of registered service worker registrations").
- **Service worker.** A state machine: `parsed → installing → installed → activating → activated → redundant` (`SW#dfn-state`). Its lifetime "is tied to the execution lifetime of events, not references". The UA "may terminate service workers at any time" when idle. Each restart creates a **new ServiceWorkerGlobalScope realm**, which means new realm ids and a new CDP worker target.
- **Control** (`SW#control-and-use`). A client (environment) is controlled when its `active service worker` is non-null. This is decided at environment creation during navigation (registration matching in Handle Fetch), inherited for initial `about:blank`, `srcdoc` and same-origin initial replacement, and changed by `clients.claim()`.
- **Interception.** HTTP fetch (`FETCH#http-fetch`) calls *handle fetch* when `service-workers mode` is `all`. Navigation requests from browser UI use `all`. Network redirects disable SW for the follow-up ("Redirects coming from the network… are not to be exposed to a service worker").
- **Driver operations.** List registrations, unregister, bypass (CDP `Network.setBypassServiceWorker`; no BiDi equivalent yet), stop.

### 3.10 Input, events and activation
- **Dispatch** (`DOM#concept-event-dispatch`). Builds the event path (composed across shadow roots only if `composed`), retargets, then runs capture, target and bubble. `isTrusted` is false for anything created by script. "The sole legacy exception is click()", which dispatches an *untrusted* click (`DOM#dom-event-istrusted`). Activation behaviour (links, form submit, checkbox) runs for both trusted and synthetic clicks. Pickers are shown only through user activation.
- **Activation-triggering input events** (`HTML#activation-triggering-input-event`). Trusted `keydown` (not Esc, not a UA shortcut), `mousedown`, `pointerdown` with `pointerType=mouse`, `pointerup` with a non-mouse pointer, and `touchend`. *Activation notification* runs **before dispatch**. It stamps `last activation timestamp` on the document's Window, on **all ancestor navigables' windows**, and on **same-origin descendants**. Fenced frames block this.
- **Activation states** (`HTML#sticky-activation`, `HTML#transient-activation`, `HTML#history-action-activation`). Sticky is per Window and never reverts, so it is lost when navigation creates a new Window and kept across bfcache. Transient lasts a UA-defined "few seconds". History-action activation has no time limit but is consumable.
- **Consumption** (`HTML#consume-user-activation`). Clears transient activation in **every window of the top-level traversable's tree**.
- **Gate levels** (`HTML#user-activation-gated-apis`). Sticky-gated (beforeunload prompt, typically autoplay, vibrate). Transient-gated. Transient-consuming (popups past the popup blocker, `requestFullscreen` (`FULLSCREEN`), `showPicker` and file/colour pickers (`HTML#show-the-picker,-if-applicable`), payment and share). History-action-consuming (cancelling back/forward through the `navigate` event, close watchers).
- **Pointer and mouse.** Compatibility mouse events interleave with pointer events, and cancelling `pointerdown` suppresses them. **Click target** is "the nearest common inclusive ancestor of the corresponding pointerdown and pointerup targets in the DOM at the moment" of dispatch, or the capture target (Pointer Events, click dispatch). Popover light dismiss runs on pointer events (`HTML#light-dismiss-open-popovers`).
- **Keyboard and IME** (`UIEVENTS#events-composition-key-events`). `keydown(isComposing=false) → compositionstart → compositionupdate (between beforeinput and input) → keyup(true) … → compositionend → keyup(false)`. A cancelled `keydown` suppresses composition.
- **Focus** (`HTML#focus`). Keys route to "the currently focused area of a top-level traversable", which **requires system focus** (`HTML#currently-focused-area-of-a-top-level-traversable`). `focus()` on a container focuses its content navigable. Fixup runs in update-the-rendering and fires `blur`; removing the focused node fixes up synchronously without `blur`. `window.focus()` needs transient activation or the "focus-without-user-activation" policy.

### 3.11 User prompts
- **Simple dialogs** (`HTML#simple-dialogs`). `alert`, `confirm` and `prompt` first check *cannot show simple dialogs* (`HTML#cannot-show-simple-dialogs`): the sandboxed-modals flag, a non-zero termination nesting level, or UA choice. When suppressed they return `undefined`, `false` and `null` respectively. Otherwise:
  1. The BiDi `user prompt opened` hook returns a handler (accept, dismiss or ignore).
  2. If no handler applies, the dialog **pauses** the event loop.
  3. BiDi `user prompt closed` fires.

  Prerendering suppresses all three.
- **beforeunload.** See §3.6. It is the only prompt that gates navigation and close.
- **print** (`HTML#dom-print`). Ignored if the document is not fully active or the unload counter is greater than 0. The printing steps fire `beforeprint` and `afterprint`. HTML has no BiDi prompt hook for print; CDP treats it as a page event.
- **File picker.** Gated and consumed by transient activation. It runs **in parallel**, does not pause, and fires BiDi `input.fileDialogOpened` with a possible auto-dismiss, after which a `cancel` event fires. The File System Access pickers (`showOpenFilePicker`) are separate and have no spec hook.
- **Other UA prompts** (permissions, HTTP auth via `network.authRequired`, certificates) do not pause the event loop. HTTP auth blocks only the *request*.

### 3.12 Network and fetch lifecycle
- **Request fields** (selection). client and **reserved client**, mode, destination, redirect mode, service-workers mode, credentials mode, keepalive, user-activation, top-level navigation initiator origin.
- **Fetch group** (`FETCH#fetch-groups`).
  - Each environment settings object has a fetch group of *fetch records* (request, controller).
  - Terminating the group (document destruction) terminates each record "if… keepalive is false", then processes deferred fetches (`fetchLater`).
  - Keepalive fetches outlive their document.
- **Pipeline.**
  - Main fetch → HTTP fetch.
  - HTTP fetch runs, in order:
    1. Service-worker *handle fetch*, when the service-workers mode is `all`.
    2. CORS preflight, if needed. It is a separate request with its own cache (`FETCH#cors-preflight-fetch`).
    3. HTTP-network-or-cache fetch (cookies, auth, cache partition).
    4. CORS, TAO and CORP checks.
    5. Redirects: `follow` allows at most 20 hops; navigations use `manual`.
  - The cache partition is keyed by the network partition key: the top-level site plus an optional second key (`FETCH#determine-the-http-cache-partition`).
- **Where the BiDi hooks sit (normative).**
  - `before request sent` is inside HTTP-network-or-cache fetch, before the cache lookup.
  - `response started` fires on a cache hit, a network response, or a **service-worker response**. A SW-served request therefore has no preceding before-request-sent.
  - `response completed` fires on every followed redirect and at end of body.
  - `fetch error` fires on a network error.
- **Network idle** is not a spec concept. Proposed definition, for a navigable subtree N:
  - Count the *fetch records with a non-null controller and the done flag unset*, across the fetch groups of N's fully active documents and their dedicated workers.
  - By default, exclude WebSocket, EventSource, streaming bodies, keepalive/beacon, and client-less SW fetches.
  - N is idle when that count has been 0 for T ms.

  Protocols only expose request events, so a driver approximates the count per navigable and must reset it when a document is destroyed. Aborted fetches of an old document may never emit a terminal event.

### 3.13 Storage, cookies and partitioning
- **Storage key.** Per spec, the storage key is still only an origin, with the note "This is expected to change; see Client-Side Storage Partitioning" (`STORAGE#storage-key`). Shipping engines also key by top-level site, plus an ancestor or nonce bit. The model must therefore carry the **partition key** separately from the origin.
- **Where storage lives.**
  - The UA storage shed holds localStorage, IndexedDB, the Cache API and SW registrations.
  - Each **traversable** holds its own session storage shed (`STORAGE#traversable-navigable-storage-shed`). That shed is cloned into a new top-level traversable only "if opener is non-null" (`HTML#copy-session-storage`).
- **Cookies.**
  - The same-site mode is computed per request (`FETCH#determine-the-same-site-mode`).
  - CHIPS `Partitioned` cookies require `Secure` and are keyed by the top-level site. They are sent only when the request's partition key matches.
  - BiDi exposes `storage.PartitionKey = {userContext, sourceOrigin, vendor:*}`, with implementation-defined required attributes (`BIDI#type-storage-PartitionKey`).
- **Rule.** Snapshotting and restoring storage state must record the user context and the partition, or the restore lands silently in the wrong jar.

### 3.14 Permissions
A single UA permission store of (descriptor, permission key, state ∈ {granted, denied, prompt}) (`PERM#dfn-permission-store`). The key "is usually per-origin", and features may double-key it with the top-level origin. The outcome is ANDed with Permissions Policy (iframe `allow`). Lifetime is UA-negotiated. Automation is through `permissions.setPermission` (BiDi extension, scoped to a user context) or the classic "Set Permission" command.

### 3.15 Rendering, stability and visibility
- **Update the rendering** (`HTML#update-the-rendering`) is a task queued for each navigable that has a **rendering opportunity**: the UA is "currently able to present the contents… considering content presentable even if it's outside the viewport" (`HTML#rendering-opportunity`).
- **Documents that skip it.** A document is not updated if it is render-blocked, its visibility is `hidden`, rendering is suppressed for a view transition, it has no opportunity, or the update would be unnecessary (no visible change and no rAF callbacks).
- **Step order.**
  1. Reveal, autofocus.
  2. Resize, scroll, media queries.
  3. Animations, fullscreen.
  4. **rAF callbacks**.
  5. Style and layout, with the content-visibility and ResizeObserver loop.
  6. Focus fixup, view transitions.
  7. IntersectionObserver, paint timing.
  8. Paint, then top-layer removals.
- **Proposed definitions.**
  - *Visible*: `checkVisibility({contentVisibilityAuto, opacityProperty, visibilityProperty})` (`CSSOMVIEW#dom-element-checkvisibility`) and a non-empty client rect.
  - *Hit-testable*: WebDriver's **pointer-interactable** (`WD#dfn-pointer-interactable`): the first element in paint order at the in-view centre point (`WD#dfn-center-point`). The element is *obscured* (`WD#dfn-obscuring`) if that first element is not an inclusive descendant of it.
  - Compute hit-testing with `elementsFromPoint` (`CSSOMVIEW#dom-document-elementsfrompoint`). It works per Document (an iframe appears as its element) and retargets out of shadow trees, so call it on the right `ShadowRoot`.
  - *Stable*: the bounding box is unchanged across k consecutive rendering updates. This is undefined, and hangs, when there is no rendering opportunity: a hidden tab, an occluded window, or headless without frames.

### 3.16 Process and site isolation (implementation layer)
Spec identity diverges from protocol identity in these places:

| Event | Spec identity | Protocol identity (typical CDP, Chromium) |
|---|---|---|
| iframe navigates cross-site | same navigable; new Document, Window, realm | frame moves to a new process. Expect `Page.frameDetached{reason:"swap"}`, then a new `Target.attachedToTarget` (iframe target with its own session), new execution contexts, and a new session for in-flight commands. `frameId` stays. |
| top-level COOP or BCG swap | same navigable, new BC/WindowProxy, opener severed | same target id, possibly a new renderer process; `executionContextId`s are per process (use `uniqueId`) |
| bfcache restore | same Document and realm reactivated | `Page.frameNavigated{type:"BackForwardCacheRestore"}`, contexts re-announced (verify) |
| prerender activation | the prerendered entry *moves* into the predecessor traversable | the prerender target and main frame tree swap into the tab; frame and target ids of the visible tab may change (verify) |
| fenced frame | traversable with unfenced parent | separate frame tree node / target (implementation-specific) |
| service worker restart | new SW global realm | new worker target and context |
| initial about:blank → same-origin doc | **same Window and realm** | context may or may not be re-created (verify) |

The model should own its own ids (navigable, document epoch, realm) and map them to protocol ids per session. It must never expose `executionContextId`, `sessionId` or `loaderId` as primary identity.

---

## 4. Hazards catalogue

Each entry gives the symptom, then the spec-level cause.

- **H1. Element detached between query and action.** Any task can mutate the DOM, and WebDriver defines stale as "node document is not the active document or… not connected". Special cases:
  - `document.open()` keeps the document but replaces every node and erases listeners.
  - iframe removal destroys the subtree's documents *without* unload events.
  - Frameworks re-render by replacing nodes.

  Actions must re-resolve their target at action time and must not cache nodes across awaits.
- **H2. A navigation commits while an evaluation is in flight.** *Destroy a document* removes the document's queued tasks "without running those tasks". The realm becomes unreachable. A pending promise in the evaluation **never settles**. The driver must race every evaluation against "realm destroyed / document epoch ended" and fail with a typed error.
- **H3. Evaluation in a bfcached document hangs instead of failing.** Tasks are runnable only if the document is fully active. A continuation queued in a document that enters bfcache waits until it is restored, which may be never. Treat "document became not fully active" as a suspension signal and time out, or reject, explicitly.
- **H4. Script runs before the realm-created event arrives.** The new document's parser scripts may run right after *make active*. Protocol events (`realmCreated`, `executionContextCreated`) are asynchronous messages. Anything that must run first, such as bindings, init scripts or console capture, must be a **preload script** registered *before* the navigation (`BIDI#preload-script`). Ordering of `realmCreated` against `navigationCommitted` is not pinned down: per the spec text realm creation precedes commit, while implementations derive it from context creation after commit.
- **H5. A child frame is scripted before the driver knows it exists.** An iframe's child navigable and initial `about:blank` are created synchronously in the parent's task, and the parent can script `contentWindow` immediately. The BiDi `navigable created` hook runs from session-history traversal steps, which are later. A driver that attaches to frames on `contextCreated` will miss early activity. Use preload scripts with global scope and auto-attach.
- **H6. A popup opens before listeners are attached.** The window open steps synchronously create the traversable, the auxiliary BC and `about:blank`, and start the navigation in the opener's task. Subscribe to context creation *per user context* before the triggering action. Correlate by `originalOpener`, which is set even for `noopener`, where `window.open` returns `null`. The popup's first document is `about:blank`, `hasPlannedNavigation:true`. Don't treat it as "loaded".
- **H7. A frame or page is swapped into a new process.** Site isolation, not spec. Spec ids hold, protocol sessions and contexts change (§3.16). In-flight protocol commands on the old session may error with "target closed" even though the navigable is alive. Retry at the navigable layer after resolving the new session.
- **H8. A BCG switch severs the opener.** COOP, UA-optional swaps, fenced-frame embedder navigation and prerender activation create a new browsing context. `window.opener` becomes null, `window.name` is cleared, and sharedIds die (they are keyed per BCG). A popup-flow test (OAuth) can break purely from server headers.
- **H9. A navigation id with no terminal event.** `navigationStarted` fires *before* the `navigate` event and before `javascript:` evaluation, and HTML provides no terminal hook when:
  - the `navigate` event is cancelled
  - `intercept()` converts it (only `historyUpdated`, with no id, follows)
  - a `javascript:` URL returns a non-string
  - the navigation is superseded at the fetch stage ("abort fetchController, and return")
  - it is a prerender activation, per the spec note

  Waiters keyed by id must also terminate on "a newer navigation started on this navigable", "historyUpdated after start", "document epoch unchanged after quiescence", or a timeout.
- **H10. "Failed" but a document still committed.** On network error, CSP, COEP or XFO block, HTML creates an inline error document, makes it unsalvageable, fires `navigation failed` and then *finalizes the navigation*. The navigable's URL is now the failed URL, showing an error page. "Failed" must not be read as "still on the old page".
- **H11. A navigation that produces no document.** 204/205 responses, downloads and handoffs to external protocols leave the old document active ("finalize a cross-document navigation… If historyEntry's document is null, then return"). A `goto()` that waits for `load` must resolve via download or no-content events.
- **H12. Navigation ignored during traversal or unload.** Calls during a history traversal fail with `canceled`. Navigations started from `beforeunload`, `pagehide` or `unload` handlers fail (unload counter). `window.open` returns null inside them (termination nesting level).
- **H13. The initial about:blank breaks "new document means new realm".** The first same-origin-domain navigation reuses its Window and realm (§3.5). Navigations from it are always *replace*, and the Navigation API is disabled on it. An iframe that stays on about:blank never emits `navigationStarted`.
- **H14. A dialog blocks the event loop and every page that shares it.** `pause` blocks the agent's event loop: every same-site document in the BCG, including openers, popups and same-site iframes in other tabs of the same group. Evaluations in *any* of them hang until the prompt is handled. The model needs "prompt open" as observable state per navigable, a configured default handler per user context, and the rule that evaluations fail fast while their event loop is paused.
- **H15. beforeunload depends on sticky activation.** A prompt appears only if the document has sticky activation. Synthetic `el.click()` grants none. Tests that interact through trusted protocol input will see prompts that script-driven tests never see. Closing a page or navigating can hang on this prompt.
- **H16. bfcache restores a document.**
  - Back or forward may reactivate a document with **no navigation commit, no new realm, no parser events**. The visible events are `pageshow(persisted=true)` and `visibilitychange`.
  - BiDi still emitted `realmDestroyed` when it left (its cleanup steps run on every unload).
  - Old handles become valid again; timers resume shifted.
  - Child frames come back, though `contextDestroyed` may or may not have been sent for them (BiDi issue).
  - The model needs a `Suspended` document state, distinct from `Destroyed`.
- **H17. A service worker answers a request.**
  - A response from `respondWith` emits *response started* with no *before request sent* for the client request. The SW's own `fetch()` appears as a separate request from a non-navigable realm.
  - Network redirects followed after SW involvement bypass the SW.
  - Interception at the protocol level may see the request twice (page→SW, SW→network) or never (cache API).
  - Request interception and mocking need a "bypass SW" option and SW-aware attribution: the SW realm → controlled clients.
- **H18. The service worker vanishes or restarts.** The UA may terminate an idle SW at any time, and a new global realm appears on the next event. Never hold SW handles across awaits. Registrations survive across sessions in persistent profiles.
- **H19. Rendering-dependent waits hang in background tabs.** `requestAnimationFrame`, rendering steps, IntersectionObserver and `content-visibility:auto` proximity run only for documents with a rendering opportunity and visibility `visible`. A "stable" or "visible" check in a hidden or headless frame waits forever. Bring the tab to the front (`activate`), or detect `visibilityState==='hidden'` and fail with a reason.
- **H20. The click lands elsewhere.** The click target is the nearest common ancestor of the `pointerdown` and `pointerup` targets *at dispatch time*. If the DOM re-renders between down and up, or a popover light-dismisses on pointerdown, the click goes to an ancestor or is lost. Hit testing also respects the top layer, inert subtrees, pointer capture and `pointer-events`. Check the hit target right before dispatch (elementsFromPoint, per shadow root) and verify the target in the trusted event stream.
- **H21. Synthetic input is not user input.** `dispatchEvent` and `el.click()` events are untrusted. They grant no activation and do not open pickers or popups past the blocker. Only protocol-injected input yields `isTrusted` activation-triggering events. Activation propagates to ancestors and same-origin descendants, and consumption clears it for the *whole tab tree*.
- **H22. Transient activation expires or is consumed.** The window is a UA-defined "few seconds". Driver latency between the click and the gated call, or a second gated call, fails. Model "requires user gesture" as an attribute of an action, and chain the gated operation in the same input dispatch.
- **H23. The file chooser pops up without a pause.** `showPicker` and file inputs run in parallel. The page continues and gets `cancel` if dismissed. Use `input.fileDialogOpened` (BiDi) or file-chooser interception (CDP) armed before the click, or set files directly (`input.setFiles`).
- **H24. Focus differs headless versus headed.** Key routing requires *system focus* on the top-level traversable. `document.hasFocus()` is false in unfocused windows, and fixup happens only at a rendering update. Focus the navigable through the protocol before key input.
- **H25. IME and composition.** Committed IME text arrives as composition plus `beforeinput` and `input`, not as key events. The driver needs an `insertText` or composition primitive distinct from `press`.
- **H26. Shadow DOM and retargeting.** `document.elementsFromPoint` returns the host. Closed roots are hidden from page code but reachable through protocol DOM. Selectors don't pierce. Slotted nodes hit-test where they *render* but live in the light DOM.
- **H27. Top layer and inert.** A modal dialog inerts everything else, so clicks hit the dialog or backdrop. A pending top-layer removal can paint for one frame after close.
- **H28. content-visibility hides existing nodes.** Nodes match selectors but have no boxes. `checkVisibility()` stays false until the next rendering opportunity determines proximity.
- **H29. Storage lands in the wrong partition.** A top-level cookie is invisible to the same origin embedded cross-site. Session storage is per tab and cloned only to popups that keep an opener. Saved storage state must carry partition keys and user context.
- **H30. Prerender.** Nothing runs before activation. Then the document appears in an *existing* tab already loaded: its `load` happened in another navigable, and BiDi defines no terminal event for the activation.
- **H31. Keepalive and beacon outlive the page.** Fetch group termination skips keepalive. `fetchLater` flushes on destroy. Attribute these to "detached", not to the new document.
- **H32. Small traps.**
  - Navigating an iframe that is not completely loaded is a replace, and so is a `Location` navigation before load without transient activation (`HTML#location-object-navigate`), so `history.length` drifts.
  - `loading=lazy` iframes stay on about:blank until they intersect.
  - CPU-bound same-agent pages block each other's evaluations.
  - BCG switches clear `window.name`, so `target="foo"` may open a new tab.

---

## 5. Implications for a protocol-neutral model

### 5.1 First-class, derived, internal

| First-class (public types and handles) | Derived (computed views) | Internal (adapter only) |
|---|---|---|
| `UserContext` (storage and override scope) | Browsing context and opener graph (exposed as `opener`, `bcgSwitched` facts) | CDP target, session, `executionContextId`, `loaderId`, frame tokens |
| `Page` = top-level traversable (incl. popups; prerender and fenced as kinds) | Session history (length, can-go-back), from events | Process ids, OOPIF attach plumbing |
| `Frame` = child navigable (id = navigable id) | Event-loop key (BCG × site), used for "paused by dialog" propagation | Sandbox naming and mapping to isolated worlds |
| `Document` epoch (synthetic id; states Loading/Interactive/Complete/Suspended/Destroyed) | Visibility, stability, hit-testability predicates | Preload-script registration per protocol |
| `Realm` (kind: window, sandbox, dedicated/shared/service worker, worklet) | Network idle; "page settled" | BiDi sharedId ↔ CDP backendNodeId mapping |
| `Navigation` (id + discriminated terminal outcome, §3.6) | Activation state (best-effort; no protocol exposes it directly) | |
| `Request`/`Response` (id stable across redirects; SW-served flag) | | |
| `UserPrompt` (alert/confirm/prompt/beforeunload; file chooser separately) | | |
| `Download`, `ServiceWorkerRegistration`, `Permission`, `Cookie{partition}` | | |
| `NodeRef` (navigable + document epoch + protocol node id), `JsHandle` (realm-scoped) | | |

`NodeRef` must carry its document epoch. Identity across realms is by node. Validity is "epoch is current and fully active". This matches `WD#dfn-is-stale`, plus *suspended* for bfcache.

### 5.2 Lifecycles as Effect `Scope` trees
- `Browser` scope ⊃ `UserContext` scope ⊃ `Page` scope ⊃ `Frame` scope ⊃ `Document` scope ⊃ `Realm` scope ⊃ handle scopes (`JsHandle` release = `script.disown` / `Runtime.releaseObject`).
- **Closing a scope is a command. A spec-driven end is an exit.** Scope finalisers send `close`, `removeUserContext` or `disown`. Externally caused ends complete each scope with a typed exit, which interrupts fibers working inside it: `DocumentReplaced(navigationId)`, `FrameDetached`, `PageClosed`, `RealmDestroyed`. This fixes H1 and H2 structurally: an `evaluate` is forked in the realm's scope, so the realm's death interrupts it.
- **bfcache does not fit "scope closed".** A `Document` scope needs a *suspend* state. Fibers in it block on a `Latch` (spec: tasks not runnable). They resume on reactivate and are interrupted on destroy or eviction. BiDi `realmDestroyed`-on-unload must be reconciled: the adapter keeps the realm "suspended" until reactivation, or until the document is evicted or destroyed.
- **Popups are scopes born outside any user call.** They are adopted into the user context's scope. A `Page.waitForPopup(action)` combinator subscribes *before* running `action` (H6). That is an Effect `acquireRelease` around a subscription, then `action`, then `take`.
- **Workers.** A dedicated worker's realm scope is a child of its owner's document scope (an owner set of one, ignoring nested workers). Shared and service worker scopes are children of the user context. SW restarts close and reopen a realm scope under a stable `ServiceWorkerRegistration` scope.
- **Navigations are fibers keyed by navigation id.** They are scoped to the navigable, resolve to the outcome union of §3.6, and are completed by "superseded" when a newer id starts (H9).

### 5.3 Observable state: `SubscriptionRef` vs `Stream`
- **`SubscriptionRef` (current value, replayable to late subscribers):**
  - the navigable tree per page (parent/children, url, readiness, kind)
  - the active document epoch per navigable
  - the realm set per navigable (incl. sandboxes)
  - `promptOpen: Option<UserPrompt>` per navigable, with event-loop propagation
  - in-flight request count per navigable subtree (feeds network idle)
  - focused navigable
  - viewport and emulation overrides
  - download progress
- **`Stream` (discrete facts):** navigation lifecycle, requests and responses, console, prompts, realm and context created/destroyed, file dialogs, downloads, bfcache hide/show. The adapter that folds protocol events into the SubscriptionRefs must use a lossless queue: dropping corrupts identity tracking (the `effect-cdp` flaw). User-facing streams may slide.
- Waiting predicates (network idle, stable, visible) reduce `SubscriptionRef` changes and rendering ticks, and must report *why* they cannot progress: no rendering opportunity, prompt open, or document suspended.

---

## 6. Open questions

1. **Order of `realmCreated` and `navigationCommitted`.** The spec text implies realm first. Measure chromium-bidi and Firefox, then pin our ordering contract.
2. **bfcache.** Do implementations send `realmDestroyed` on bfcache entry, as the spec implies? Do they re-announce realms or contexts on restore? Do they send `contextDestroyed` for bfcached child navigables (open BiDi issue)?
3. **Initial about:blank Window reuse.** Do CDP and BiDi keep the same context or realm id across the reuse?
4. **Missing terminal events.** For intercepted, cancelled, superseded and `javascript:` navigations, do implementations emit failed or aborted where HTML has no hook? Our outcome union needs a fallback rule.
5. **Prerender activation.** Which navigable or target id does the activated page carry? Do preload scripts run in prerendered documents?
6. **Fenced frames.** Do they appear in `getTree` as children or as top-level contexts?
7. **SW attribution.** Are SW-served requests and SW subrequests attributed to the client navigable?
8. **Sandbox semantics.** BiDi SandboxProxy (IDL-only) and CDP isolated worlds differ in what page prototype patches leak. Can we promise either cross-protocol?
9. **Partition keys.** What neutral representation round-trips Chromium (site + ancestor bit + nonce), Firefox (originAttributes) and WebKit?
10. **ShadowRealm.** No BiDi realm type yet. Keep the `Realm` kind open-ended?
11. **Orphaned descendants.** HTML never destroys the child navigables of a document destroyed by navigation. Confirm that every implementation still emits detach events, so `Frame` scopes always close.
12. **Event-loop sharing in practice.** Measure, per engine, whether `alert()` in a popup blocks evaluation in its same-site opener before relying on H14.
