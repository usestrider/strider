# CONCEPTS: the native browser model (L1)

*Revision 5, 2026-10-18. A condensed restatement of draft 4 (commit `6cc0bc1`), with [review 4](reviews/04-draft-4.md) folded in. The reasoning behind each contract is in that draft and in [reviews/](reviews/); this document keeps the decisions. Spec anchors: `HTML#x` is `https://html.spec.whatwg.org/#x`; `BIDI#x` is the WebDriver BiDi editor's draft.*

## Purpose

L1 is a protocol-neutral, spec-grounded model of what a browser is, what a driver can observe, and what it can do. It sits between the protocol adapters ([PROTOCOL.md](PROTOCOL.md)) and the public API ([API.md](API.md)). Every API convenience must be expressible here, and nothing here mentions protocol ids.

## 1. Identity

The spec has three identity layers, and drivers tend to conflate them:

| Layer | Concept | Survives | Changes on |
|---|---|---|---|
| **Slot** | Navigable: a top-level traversable (Page) or a child navigable (Frame) | every navigation, process swap and COOP swap | destruction only |
| **Epoch** | Document, plus its Window realm (usually) | same-document navigation, `document.open()` (new generation), back/forward-cache suspend and restore when continuity is shown | cross-document commit |
| **Topology** | Browsing context, browsing context group, agent, event loop | navigations within the group | a browsing-context-group switch (COOP, prerender activation, fenced frames), which also severs openers |

Realms are siblings of documents, not children. The one exception that forces this is the initial `about:blank` Window, which the first same-origin navigation reuses (`HTML#initialise-the-document-object`).

**Every public id is minted by L1.** Backend ids are correlation evidence held in adapter tables. This isolates identity from process swaps and session churn. It also lets a navigation started by a command have its id before the command is sent. A reconnection starts a new id namespace.

| Id | Minted when |
|---|---|
| `UserContextId`, `NavigableId` | context or navigable first created or observed |
| `DocumentId` | initial or adopted document observed, or cross-document commit |
| `DocumentGeneration` | document created; incremented when its tree is reset (`document.open()`, or a detected document-node replacement) |
| `RealmId` | realm observed or acquired |
| `NavigationId` | before dispatch for command-started navigations; on the first signal for page-started ones |
| `RequestId`, `RequestHopId = (RequestId, redirectCount)` | first fact about the request; each redirect hop |
| `NodeRef = {navigable, document, generation, binding}` | node returned by a query or evaluation |
| `HandleRef = {realm, binding, lease}` | handle acquired by a caller |
| `PromptId`, `DownloadId`, `InterceptId`, `OperationId`, … | on creation |

**Model objects are values.** References are `Equal`/`Hash` by immutable identity within their connection. Mutable state (URL, connectivity, descriptions) never affects hashing. Two independently acquired handle leases are not equal even when they point at the same remote object, because each owns its own release. Event payloads are immutable snapshots, and reading live state is an explicit operation.

**Staleness of a `NodeRef`:**

- **Known invalid:** its document or navigable ended, the backend binding was invalidated, it was adopted into another document, or its generation is old. Explicit-ref operations fail with `StaleRef{reason: Replaced | Detached | Suspended | BindingLost}`. Locators re-resolve instead.
- **Suspended:** its document is in back/forward cache. Explicit-ref operations fail fast; locators see `NotReady`.
- **Connected, disconnected or unknown:** these are observations with timestamps, not guarantees. A detached node reinserted *within the same generation* can become usable again. Refs from an old generation never revive.

## 2. Top data models

**Immutable by default.** An entity is a set of immutable identity fields plus *one* `SubscriptionRef` holding its current state; anything that can change lives in that ref and nowhere else. Snapshots, events, outcomes and errors are immutable values. Lifetime ends are `Deferred`-backed `Effect`s. Readers always go through an `Effect` (`SubscriptionRef.get`), so a value is read when the effect runs, never captured stale in a field. Watchers use `changes`. Only the state fold (PROTOCOL.md) writes these refs. The public API exposes reads and event streams, never the refs themselves.

**Identity fields must be fixed for the entity's lifetime, and say why.** Each plain field carries a one-line justification. Ids, `closed` and streams are exempt by construction. A field that can't be justified moves into `state`. Applying this rule moved three fields: a document's and a window realm's navigable (prerender activation moves both into the existing tab), `isInitialAboutBlank` (cleared by `document.open()`), and a navigation's kind (the Navigation API can intercept a cross-document navigation into a same-document one).

```ts
// ── Containment ────────────────────────────────────────────
interface BrowserModel {
  readonly id: BrowserId
  readonly backend: BackendInfo                         // fixed for the connection
  readonly ownership: { _tag: "Launched"; process: ProcessInfo } | { _tag: "Attached"; endpoint: string }   // fixed: set when connecting
  readonly state: SubscriptionRef<{
    userContexts: ReadonlyMap<UserContextId, UserContextModel>
    capabilities: CapabilitySet                         // refined as probes complete
  }>
  readonly closed: Effect<CloseReason>
}
interface UserContextModel {
  readonly id: UserContextId
  readonly isDefault: boolean                           // fixed: the default context exists for the whole connection
  readonly state: SubscriptionRef<{
    access: Access; release: "leaveOpen" | "removeOwned"
    pages: ReadonlyArray<NavigableId>
    declarations: DeclarationSet                        // §7
    promptPolicy: PromptPolicy                          // §5
  }>
  readonly closed: Effect<CloseReason>
}
interface NavigableModel<S extends NavigableState = NavigableState> {   // Page and Frame share this
  readonly id: NavigableId
  readonly kind: "page" | "frame"                       // fixed: a frame never becomes top-level, nor the reverse
  readonly parent: Option<NavigableId>                  // a frame never changes parent
  readonly state: SubscriptionRef<S>
  readonly closed: Effect<CloseReason>
}
interface NavigableState {
  children: ReadonlyArray<NavigableId>
  activeDocument: DocumentId
  access: Access; release: ReleasePolicy; cleanupScope: Option<CleanupScopeId>
}
interface PageModel extends NavigableModel<PageState> {
  readonly pageKind: "tab" | "popup" | "prerender" | "fenced"   // fixed: an activated prerender page ends (PrerenderActivated)
  readonly origin: { _tag: "Created" } | { _tag: "Opened"; opener: Option<NavigableId> } | { _tag: "Adopted" }   // fixed: how it came to exist
  readonly originalOpener: Option<NavigableId>          // fixed at creation; kept even under noopener
}
interface PageState extends NavigableState {
  prompt: Option<PromptId>
  input: InputState                                     // §5
}
interface DocumentModel {
  readonly id: DocumentId
  readonly origin: string                               // fixed for the document; document.domain changes only the effective domain
  readonly navigation: Option<NavigationId>             // fixed: the committing navigation; None for the initial about:blank
  readonly isErrorDocument: boolean                     // fixed: error documents are created as such
  readonly restoredFrom: Option<DocumentId>             // fixed at creation; only with correlating evidence
  readonly state: SubscriptionRef<{
    navigable: NavigableId                              // changes only on prerender activation
    isInitialAboutBlank: boolean                        // cleared by document.open()
    generation: DocumentGeneration                      // bumped by document.open()
    url: string                                         // changes on same-document navigation
    lifecycle: "active" | "suspended" | { _tag: "ended"; reason: CloseReason }
    readiness: "loading" | "interactive" | "complete"   // current state; can return to loading
    loading: LoadingResult                              // per generation; post-commit failure lives here
  }>
}
interface RealmModel {
  readonly id: RealmId
  readonly kind: { _tag: "window"; world: "main" | { isolated: string } }   // fixed: a realm never changes kind or world
    | { _tag: "dedicatedWorker"; owner: RealmId } | { _tag: "sharedWorker" }
    | { _tag: "serviceWorker"; registration: string } | { _tag: "worklet"; type: string }
  readonly state: SubscriptionRef<{
    navigable: Option<NavigableId>                      // window realms; moves with its document on prerender activation
    documents: ReadonlyArray<DocumentId>                // usually one; two after initial-blank reuse
    lifecycle: "active" | "suspended" | { _tag: "destroyed"; reason: CloseReason }
  }>
}

// ── Navigation ─────────────────────────────────────────────
interface NavigationModel {
  readonly id: NavigationId
  readonly navigable: NavigableId                       // fixed: a navigation targets one navigable
  readonly initiatedAs: "crossDocument" | "fragment" | "historyApi" | "traversal" | "reload" | "javascriptUrl" | "prerenderActivation"
                                                        // fixed: how it started; interception or a download shows up in the outcome
  readonly status: SubscriptionRef<
    | { _tag: "pending" }
    | { _tag: "observed"; outcome: NavigationOutcome; evidence: Evidence }
    | { _tag: "unresolved"; lastObserved: Evidence }>
}
type NavigationOutcome =
  | { _tag: "Committed"; document: DocumentId; response: Option<ResponseRef> }
  | { _tag: "SameDocument"; document: DocumentId; via: "fragment" | "historyApi" | "intercepted" }
  | { _tag: "Restored"; document: DocumentId }        // back/forward cache
  | { _tag: "Activated"; document: DocumentId }       // prerender
  | { _tag: "Download"; download: DownloadId }        // old document stays
  | { _tag: "NoContent"; status: 204 | 205 }          // old document stays
  | { _tag: "Failed"; error: NetError; errorDocument: Option<DocumentId> }
  | { _tag: "Superseded"; by: NavigationId }
  | { _tag: "Canceled"; reason: "beforeunload" | "navigateEvent" | "sandbox" | "unloading" | "traversalInProgress" }
  | { _tag: "NoOp"; reason: "javascriptNonString" | "noHistoryEntry" }

// ── Network: immutable snapshots; a request's progress is a stream of them ──
interface RequestSnapshot {
  readonly hop: RequestHopId; readonly navigable: Option<NavigableId>; readonly navigation: Option<NavigationId>
  readonly method: string; readonly url: string; readonly headers: Headers   // classified values are Redacted
  readonly resourceType: ResourceType; readonly servedBy: "network" | "cache" | "serviceWorker"
}
interface ResponseSnapshot {
  readonly hop: RequestHopId; readonly status: number; readonly url: string; readonly headers: Headers
  readonly body: BodyAccess                             // availability is read through an Effect
}
interface ConnectionModel {                            // long-lived connections
  readonly id: ConnectionId; readonly kind: "webSocket" | "eventSource"; readonly url: string; readonly navigable: NavigableId   // fixed at open
  readonly frames: Stream<ConnectionFrame>              // capability
  readonly closed: Effect<CloseReason>
}

// ── Obligations ────────────────────────────────────────────
interface ObligationModel {
  readonly subject:
    | { _tag: "PausedRequest"; hop: RequestHopId; phase: "request" | "response" | "auth"; occurrence: number }
    | { _tag: "Prompt"; prompt: PromptSnapshot }
    | { _tag: "FileChooser"; navigable: NavigableId; multiple: boolean }
  readonly state: SubscriptionRef<"pending" | "decisionSelected" | "sending" | "acknowledged" | "rejected" | "unknown" | "ended">
}

// ── Access, release, operations ────────────────────────────
type Access = "observe" | "inspect" | "control"
type ReleasePolicy = "leaveOpen" | "closeOwned" | "removeOwned"
interface OperationRecord {                            // internal; inspected through an Effect
  readonly id: OperationId
  readonly state: Ref<{
    dispatch: "notSent" | "mayHaveBeenSent" | "acknowledged"
    progress: ReadonlyArray<StepEvidence>               // per command: unsent | uncertain | ok | rejected
    observation: "pending" | { observed: unknown } | { unknown: Evidence }
    caller: "waiting" | "completed" | "failed" | "interrupted"
    cleanup: "notNeeded" | "pending" | "completed" | { failed: string }
  }>
}
type Readiness = { _tag: "Ready" } | { _tag: "NotReady"; predicate: Predicate; reason: NotReadyReason; observedAt: number }

type CloseReason =
  | BrowserClosed | BrowserCrashed | ConnectionLost | ModelUnavailable
  | UserContextRemoved | ObservationReleased | AccessReleased | PrerenderActivated
  | PageClosed /* by: command | script | userContextRemoved | browser */ | PageCrashed
  | FrameDetached | DocumentReplaced | DocumentEvicted | DocumentDestroyed | DocumentUnloaded
  | RealmDestroyed
```

## 3. Lifetimes, access and cleanup

```text
Browser lifetime + cleanup scope
└─ UserContext lifetime + cleanup scope
   ├─ declarations and their managers
   └─ Page lifetime + cleanup scope
      ├─ Document epochs (active, suspended, ended)
      │  └─ child Frames
      ├─ Realms (linked to documents)
      ├─ navigation and operation records
      └─ obligation managers
Caller scopes own handles, subscriptions, observation windows and declarations.
Cleanup groups can span sibling pages, independently of this graph.
```

- **Three separate decisions.** Every remote resource carries:
  - **access**: what we may do to it;
  - **release policy**: what happens to it when we let go;
  - **cleanup group**: which scope releases it.

  Being a child in the model graph grants none of them.
- **Access.** `observe` permits protocol events only. `inspect` adds isolated-world injection and reads: locators, readiness predicates, snapshots, screenshots, body reads. `control` adds input, navigation, main-world evaluation, declarations and obligation decisions. Discovered resources start at `observe`, and upgrading never changes release policy. An upgrade is held by the `Scope` that acquired it; once that scope closes, the upgraded handle fails with `TargetGone{reason: AccessReleased}` rather than silently keeping its powers. A declaration whose physical effect reaches past its target needs explicit wider access, or fails with `NotPermitted`. Access is a library contract, not a browser security boundary.
- **Release and cleanup groups.**
  - Created resources are owned: `closeOwned` or `removeOwned`.
  - The default context and pages that existed at attach are `leaveOpen`.
  - **Every acquisition requires a `Scope`, and that scope is the cleanup group.** This covers contexts, pages, access upgrades, popups, downloads, handles, capability handles and every declaration. Values with no remote lifetime (locators, snapshots, captured bodies) need none. An early `close` makes the finalizer a no-op.
  - A popup of an owned page is released with the scope that observed it (`Observe.popup`). If nobody asked for it, it is released with the scope that acquired its opener, even if the opener has already closed. A popup of a `leaveOpen` page is `observe`/`leaveOpen`.
  - Transfer to another scope is explicit and atomic with respect to shutdown. Ambiguous opener evidence never implies ownership.
- **Ownership ledger.** The connection records owned resources, groups and transfers. A persisted ledger yields *reclamation candidates* only. Automatic destructive reclaim across connections needs verified browser incarnation, resource identity and claimant coordination, and is deferred.
- **Requesting a close is not ending a lifetime.** `closeWith({runBeforeUnload: true})` can be refused (`CloseCanceled`), and the page stays usable. A close timeout leaves closure unconfirmed rather than fabricating `PageClosed`. Teardown of owned resources uses a bounded close without beforeunload.
- **Lifetime signal and `within`.** Each object has a single-assignment `closed: Effect<CloseReason>`. `within(effect): Effect<A, E | TargetGone, R>` arbitrates completion against the end of the lifetime and delivers the typed reason; closing a `Scope` alone would only interrupt. Caller interruption remains interruption. Whichever of completion or end wins the race is recorded once.
- **Remote facts and model loss.** A remote close invalidates local bindings without sending another close. Permanent loss of observation ends lifetimes with `ConnectionLost` or `ModelUnavailable` without asserting remote destruction. A temporary quarantine fails current operations without completing `closed`, and resumes only after a verified resynchronization.
- **Suspension** (back/forward cache) is a domain state, not a scope operation. Explicit-ref operations fail fast; waits may opt in to resume within their deadline. Resuming never revives invalid handles.
- **Cleanup order.** Transport, ingestion and obligation resolvers stay alive while owned resources tear down. The order is: stop new work, drain obligations within the cleanup budget, release declarations and owned resources in dependency order, then disconnect or close the owned process. Finalizers are bounded.

## 4. Documents, realms and navigation

- **Document lifecycle.** `Active ⇄ Suspended` (back/forward cache, only with confirmed evidence) and `→ Ended{reason}`.
  - Readiness events are accepted only for the matching epoch and generation.
  - `document.open()` keeps the epoch, starts a new generation, and returns readiness to `loading`.
  - A restored document gets the same id only when the adapter can correlate it; otherwise the old epoch ends with `DocumentUnloaded` and the new one carries `restoredFrom`.
  - Node and handle continuity are proven separately from document continuity.
  - On prerender activation the prerender page ends with `PrerenderActivated`. Its document and realms move into the activating tab, and their `navigable` changes in state.
- **Frames.** A frame is created synchronously, before any protocol notification arrives. It ends on container removal, or when its parent's document permanently ends; the adapter closes orphans itself because HTML never fires an event for them. A frame keeps its identity across process swaps; only its adapter session changes.
- **Realms and worlds.**
  - **Kinds:** window (main or isolated world), dedicated, shared and service workers, and worklets. The kind is an open union.
  - **The library's own code** runs in a utility isolated world wherever one exists. Stock WebKit has none, and says so as a capability.
  - **Two discovery strategies, chosen per context:**
    - **Tracked:** realm events folded into state.
    - **OnDemand:** no `Runtime.enable`; realms acquired when needed and validated on use. This is the stealth posture. It has no observable realm set and no console capture, and these are absent from the types rather than failing.
  - **During a pending navigation** the active realm stays usable. A prospective replacement is tracked separately, so a canceled navigation, a 204 or a download never strands the page.
  - **Evaluation** is bounded by `within`, fails fast on known suspension or confirmed prompt blocking, and may request user activation.
- **Values, handles and channels.**
  - Evaluation transfers values by default. Handles are opt-in, owned by the caller's scope, and released in batches unless the realm already died.
  - Node results become `NodeRef`s bound to the current epoch and generation.
  - Channels carry page-to-driver messages as typed streams; they are the transport for in-page observers.
- **Navigation outcomes.** An outcome is reported only with affirmative evidence; otherwise the navigation stays `unresolved` and waiting callers get `Timeout{phase: postcondition}`.
  - `Superseded` needs proof that the navigation was replaced.
  - A `historyUpdated` event with no attribution does not finish a pending navigation.
  - Silence never means `Canceled` or `NoOp`.
  - A failure after a successful commit is a loading result of the document; the commit outcome is not revised.
  - Navigations observed during an action are correlated, not proven caused by it.
  - Browsing-context-group switches are reported as `Confirmed | Suspected | Unknown`.
- **Projection for callers** (API.md):
  - **Success:** `Committed`, `SameDocument`, `Restored`, `Activated`. An HTTP 404/500 document is a successful commit.
  - **`back`/`forward`:** `NoOp{noHistoryEntry}` becomes `None`.
  - **Failure:** everything else becomes `NavigationError{reason}`. `Download` and `NoContent` count as failures unless the call accepts them.
  - **`waitUntil: load`** waits on the resulting document and generation within the same deadline.

## 5. Input and obligations

- **Input fidelity is a backend property:** `native` (CDP, patched WebKit), `webdriver` (BiDi) or `synthetic` (stock WebKit shims; untrusted, no activation).
- **Input state** is kept per page: pressed keys and buttons, pointer position, and an undo list. Input to one page is serialized, and acquiring the permit consumes the operation deadline. Actionability is checked again after acquiring the permit.
- **Compensation.** On interruption or scope close, owned pressed inputs are released in reverse order. This is bounded and best-effort, and records failures. Input state that might be inconsistent blocks further gestures until it is reset.
- **Activation.** The library keeps a diagnostic estimate of user activation; it never gates an operation. Operations that need activation declare it, and evaluation can request it from the backend.
- **Focus.** Key input requires system focus; the adapter focuses the page first.
- **Click target.** A click goes to the common ancestor of the pointer-down and pointer-up targets, so hit-target verification also guards the trusted event stream (§8).
- **Prompts.**
  - A dialog pauses the event loop of its agent and can block same-agent siblings. Blocking is recorded as confirmed or suspected.
  - `PromptBlocking{resolution: Pending}` is waitable within the caller's deadline; `None` is terminal.
  - Default policy, applied only to controlled targets:
    - owned pages: dismiss after a grace period, except `beforeunload`, which is accepted;
    - attached pages: no default unless the caller opts in.
  - Every automatic decision is published and recorded on relevant operations, with correlation but no claim of causation.
- **File chooser.** It does not pause the page. It is armed before the triggering input, and its default is `Cancel`.
- **Obligation lifecycle.** States are `pending → decisionSelected → sending → acknowledged | rejected | unknown`, plus `ended`.
  - **One winner.** An atomic transition selects at most one decision.
  - **Handler chain.** The chain is snapshotted when the obligation arrives and ordered by the precedence rule (§7). Only the current handler holds a decision token. `Fallthrough` passes a new token on.
  - **One budget.** A total resolution deadline covers the whole chain.
  - **Fallback.** Failure, interruption, scope exit, returning without a decision, or the deadline applies the phase-specific fallback, but only while the obligation is still pending.
  - **Delivery.** A selected decision is delivered by a resolver independent of the handler fiber.
  - **No contradictions.** A timeout or disconnect after sending records `unknown` and never sends a contradictory fallback.

## 6. Network

- **Requests and hops.** A request id spans the redirect chain. Each hop has its own identity, snapshot, response and body access, so a held 302 never becomes the next hop's 200. Snapshots record explicitly when information (such as CDP's extra-info events) is missing.
- **Request lifecycle.** `Sent → ResponseStarted → Completed | Failed`.
  - A service-worker response can start without `Sent`.
  - Requests of a destroyed document may never terminate. They leave readiness accounting and are tracked as detached, and no network failure is fabricated for them.
  - The adapter keeps raw facts per request and emits each model event once its prerequisites are present.
- **Interception** is a declaration plus a stream of obligations.
  - Backend enablement is reconciled from the union of active patterns, and is never disabled while a request is paused.
  - Decisions depend on the phase:
    - **request:** `Continue{overrides} | Fulfill | Fail`;
    - **response:** only the decisions the backend supports;
    - **auth:** `ProvideCredentials | DefaultAuth | CancelAuth`.
  - Defaults are continue for request and response, and `DefaultAuth` for auth.
  - BiDi cannot scope intercepts to a user context, so emulating that needs browser-wide access (§3).
- **Bodies.** A body may be unavailable for a stated reason: not collected, evicted, a redirect, streaming, or over a limit.
  - When a caller expresses interest, collection is acquired automatically *before* the trigger; BiDi needs a collector before the request starts.
  - Ordinary results are owned bytes. Large or streaming bodies use explicit caller-scoped leases.
- **Service workers.** Interception may see a request twice or never. Bypassing service workers is a capability.
- **Long-lived connections.** WebSocket and EventSource connections are modelled but excluded from network idle. Observing frames and mocking them are separate capabilities.

## 7. Declarations

Declarations are init scripts, routes, overrides, emulation, download and prompt policies, data collectors and page clocks. All are identified registrations with scoped lifetimes.

- **Installation.**
  - Installation is acknowledged, or acquisition fails.
  - A declaration states the timing it needs (`beforeAuthorScript | bestEffort`). An unmet requirement fails with `Unsupported`; it never silently degrades.
  - Declarations stay within the target's access scope.
  - Attaching to a running page cannot precede scripts that already ran.
  - A target is published as ready only after its required setup succeeds. Optional setup failures appear as unavailable capabilities.
- **Precedence** for settings and handlers: scope specificity first (Frame, then Page, then Context, then Browser), then explicit priority, then recency. Releasing any registration recomputes the effective state, including when fibers finish out of order.
- **Init scripts** form an ordered bundle per world and revision.
  - **Phases.** A reserved *environment phase* (library shims such as the page clock) runs before user scripts.
  - **Order.** Within a phase, array order applies, then explicit `after` dependencies, then registration sequence.
  - **Dependencies** may point only to registrations of equal or broader scope, so they always outlive the dependent. Invalid edges fail at acquisition.
  - **Execution.** A bundle runs once per document and world, and a content reset does not replay it. Required failures stop dependents and are reported. Executed effects are never rolled back.
  - **Removal** affects future documents only.
- **Overrides.**
  - **Application.** Updates are serialized at the backend's physical scope. Desired and acknowledged revisions are tracked separately, and a failed apply never returns success.
  - **Exclusive use.** Exclusive use needs a lease; conflicting writers wait or get `OverrideConflict`.
  - **Restoration.** It is promised only when the previous value is known, restoration is supported, and access permits it. Attached sessions never reset an external user's settings.
- **Page time.** Application time is one timeline per scope: page by default, context optionally.
  - **Modes:** `fixed` (wall time frozen, timers live), `offset`, `controlled` (wall time, monotonic time, timers and animation frames driven explicitly), and `virtual` (a backend scheduler, as a capability).
  - **Replay.** Every operation is appended to a log that each new document and frame in scope replays, so the timeline survives navigation and covers same-origin frames. Workers are explicit opt-in.
  - **Readiness.** Sampling uses native rendering, independent of the application clock; a paused clock never stalls actionability, and page time is never advanced implicitly. Where rendering really is frozen, readiness reports `ClockPaused`.
  - **Removal and restoration.** Removing the clock affects future documents. Restoring it in place is a capability; the simple path is an owned page that gets closed.
- **Storage.**
  - **Partitioning.** Storage is keyed by user context and partition key, and the partition key is opaque per backend.
  - **`StorageState`.** It is portable into fresh contexts. Source context is provenance, not a restriction. Mismatched opaque partitions fail with `StorageStateError{Incompatible}`, and partial restores are reported.
  - **Export and import.** Export is an explicit, versioned codec to `Redacted<Uint8Array>`, and import validates it. Diagnostic JSON is never a persistence format.
- **Permissions** are scoped to a user context and combined (AND) with Permissions Policy.

## 8. Readiness predicates

Each predicate yields `Ready`, `NotReady{reason}` or an observation error. A reason describes the present condition and does not promise it can never improve. L2 decides whether to wait, scroll, activate or fail.

| Predicate | Definition | Reasons |
|---|---|---|
| Connected | binding, generation and connectivity checked at use | `Replaced`, `Detached`, `Suspended` |
| Visible | `checkVisibility({contentVisibilityAuto, opacityProperty, visibilityProperty})` and a non-empty rect; for `display: contents`, any visible child | `NoBox`, `ContentVisibilitySkipped` |
| Stable | rect unchanged across *k* native rendering updates (initial defaults: 2 frames; 6 on WebKit/Windows), independent of the application clock | `NoRenderingOpportunity{lastFrameAt}`, `ClockPaused` |
| Enabled | ARIA-disabled semantics: `disabled`, `fieldset` inheritance, `aria-disabled` | — |
| Editable | enabled, not `readonly`/`aria-readonly`, and an editable element type | `NotEditableType` |
| NotInert | not inside an inert subtree | `BlockedByModal{dialog}` |
| InViewport | a content quad intersects the viewport (area > 0.99 CSS px²); scrolling is an action policy | `OutsideViewport` |
| ReceivesPointer | at the action point, the composed-tree hit test (per shadow root, through iframes) lands on the target or a descendant; checked before dispatch *and* guarded on the first trusted event | `Covered{by}` |
| Unique | exactly one match; ambiguity is classified as stable or transient across the sampling window | `Ambiguous{candidates, stable}` |
| NetworkIdle(N, T) | no in-flight requests attributed to subtree N's active documents and their workers for T ms; long-lived connections, beacons, favicons and client-less service-worker fetches excluded | `LongPolling{requests}` |
| DomQuiet(T) | no mutations in the composed subtree for T ms (shadow roots observed explicitly) | — |
| PromptFree | no known prompt blocking the navigable | `PromptBlocking{prompt, resolution}` |

Compatible instantaneous checks are batched in one injected evaluation. No batch is an atomic guarantee that covers the input that follows it.

## 9. Operations

- **Interruption and records.** Caller cancellation remains Effect interruption. Each user operation has a record (§2) linked to its span.
  - Dispatch is marked `mayHaveBeenSent` before any boundary where delivery becomes uncertain.
  - Abandoned query ids are tombstoned.
  - Late replies that create resources (pages, contexts, handles, scripts, intercepts) are adopted into their intended owner, or released.

| Operation | Interrupted before dispatch | Interrupted after dispatch | Recovery |
|---|---|---|---|
| read/query | no remote work | waiter detached | retry only with a valid binding |
| author evaluation | no remote work | result unknown | no automatic re-evaluation |
| navigation | no remote work | may continue | no automatic re-navigation |
| input gesture | no remote work | partial input possible | bounded release of held input |
| obligation decision | fallback applies | resolver continues | no contradictory decision |
| resource creation | nothing created | may exist | late-reply adoption or cleanup |

- **Observation windows.** A window is the internal resource behind every `Observe.*` combinator.
  - **Before the trigger:** it acquires subscriptions, collectors and handlers, including remote enablement. If that fails, the trigger never runs.
  - **Revision boundary:** it sets one between the current-state snapshot and the live subscription.
  - **Concurrency:** handlers run alongside the trigger.
  - **Correlation:** by the strongest identity available.
  - **Completion:** both the trigger and the observation must complete. A trigger failure is never discarded, and caller `E` and `R` are preserved.
  - **Owner ends without a match:** fails promptly.
  - **Results:** a latched immutable result outlives the window.
- **Deadline.** There is one monotonic deadline per operation, inherited by nested calls and only ever shortened. Cleanup has its own budget. Deadline failures are `Timeout{phase}`, carrying the last observation and its de-duplicated history.
- **Retries.** Retry decisions depend on the operation, its phase, the target binding, dispatch evidence and the remaining deadline, never on an error tag alone.
  - Locators re-resolve before dispatch.
  - Explicit refs never rebind.
  - Nothing that may have dispatched is repeated automatically.
- **Errors (L1 view).** Lifetime ends surface as `TargetGone{reason: CloseReason}` and deadlines as `Timeout`. Everything else is a domain error per verb family whose `reason` includes `NotPermitted`, `Unsupported` and `BackendFailure{Rejected | IncompatibleResponse}`. All of them carry the diagnostic envelope. Defects are reserved for bugs. `SessionSwapped` is internal.
- **Event streams.**
  - **Normal end:** a stream owned by an object ends successfully when the object ends normally, after draining what was already published.
  - **Abnormal end:** it fails with `TargetGone` on abnormal ends and with `EventOverflow` on overflow.
  - **Filtering:** declarative metadata prefilters run before buffering. Caller predicates run in subscriber workers, never on the ingestion path.

## 10. Secrets and diagnostics

- **Classified fields.** Credentials, cookie values, typed text, and authentication and cookie headers are classified. They are wrapped as `Redacted` on the way out, and protected by the central diagnostic serializer even after being unwrapped for transport.
- **Descriptions** use ids and preset-dependent URL detail (README.md); the default preset is origins only.
- **Raw content** (bodies, console arguments, DOM snapshots, screenshots) may contain secrets echoed by the page. It is recorded as metadata by default and exported only under an explicit capture policy. There is no taint tracking.
- **Agent secret placeholders** are substituted at dispatch, inside L1. A page can still echo a secret into other channels, so capture policy applies to anything sent to a model.

## 11. Open questions

Browser-dependent unknowns are in [PROBES.md](PROBES.md). Design questions:

1. **Isolated worlds and access.** Does creating an isolated world count as mutation for `inspect`? The current answer is no, and the stealth posture may override it.
2. **Default sampling windows** for `Unique` (stable ambiguity) and `Stable` per backend.
3. **The neutral representation of partition keys** across Chromium, Firefox and WebKit.
4. **The context-level page clock.** Does one timeline across pages need cross-page synchronization, or is replaying the log per page enough?
