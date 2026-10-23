# CONCEPTS: the native browser model (L1)

*Revision 5.25, 2026-10-19; checked against the built adapter contract, with how a locator finds elements (§8) and how an action waits (§5), after [review 12](reviews/12-l1-first-slice.md), and the first slice built, 2026-10-22; how events are delivered, popups and dialogs, after [review 13](reviews/13-events-slice.md), built 2026-10-23. A condensed restatement of draft 4 (commit `6cc0bc1`), with [review 4](reviews/04-draft-4.md) folded in. The reasoning behind each contract is in that draft and in [reviews/](reviews/); this document keeps the decisions. Spec anchors: `HTML#x` is `https://html.spec.whatwg.org/#x`; `BIDI#x` is the WebDriver BiDi editor's draft.*

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

**Every public id is minted by the adapter, in L1's types** (review 08, candidate 2; review 12). Backend ids are correlation evidence held in the adapter's tables, and L1 never sees one. This isolates identity from process swaps and session churn. It also lets a navigation started by a command have its id before the command is sent. Each connection's adapter mints its own, so a reconnection starts a new id namespace.

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

**Brand liberally.** Every id, and every string or number that means more than "some text" or "some quantity", is a branded type defined by a `Schema` that validates at the boundary. Ids are distinct brands per kind, so a `DocumentId` can never be passed where a `NavigableId` is expected. **Tokens**, meaning produced values whose meaning depends on their origin (ids, `RefId`, `DocumentGeneration`, registration handles, `OperationId`), are accepted back only in branded or opaque form, never as plain strings or numbers. They are also checked against their origin when used, because a brand alone doesn't prove provenance. In the public API each brand is a Schema in the module that owns it (API.md, Conventions), named in parentheses below. Value brands used by the model:

| Brand | Meaning | Validated as |
|---|---|---|
| `Url` (`Url.Url`) | an absolute URL | WHATWG URL parse |
| `UrlPattern` (`Url.Pattern`) | a matcher (glob or URLPattern), never navigated to | pattern compile |
| `Origin`, `Site` (`Url.Origin`, `Url.Site`) | scheme+host+port; registrable-domain site (partition keys) | derived from `Url` |
| `HttpStatusCode` (`NetworkResponse.StatusCode`) | 100–599 | integer range |
| `HeaderName` | case-normalized header name | token grammar |
| `CookieName`, `CookieDomain` (`CookieJar.Name`, `CookieJar.Domain`) | cookie attributes | RFC 6265 grammar |
| `LocalPath`, `RemotePath` (`FilePath.Local`, `FilePath.Remote`) | a path on the driver's machine vs. on the browser's host | non-empty; never interchangeable |
| `CssPixels`, `DevicePixels` (`Pixels.Css`, `Pixels.Device`) | layout units vs. device pixels (differ by device pixel ratio) | finite number |
| `Locale`, `TimeZoneId` (`Emulation.Locale`, `Emulation.TimeZoneId`) | BCP 47 tag; IANA zone | `Intl` validation |
| `RefId` (`Snapshot.RefId`) | an agent snapshot ref (`e12`) | `^e\d+$` |
| `SecretName` (`BrowserToolkit.SecretName`) | an agent secret placeholder | identifier grammar |

**Model objects are values.** References are `Equal`/`Hash` by immutable identity within their connection. Mutable state (URL, connectivity, descriptions) never affects hashing. Two independently acquired handle leases are not equal even when they point at the same remote object, because each owns its own release. Event payloads are immutable snapshots, and reading live state is an explicit operation.

**Staleness of a `NodeRef`:**

- **Known invalid:** its document or navigable ended, the backend binding was invalidated, it was adopted into another document, or its generation is old. Explicit-ref operations fail with `StaleRef{reason: Replaced | Detached | Suspended | BindingLost}`. Locators re-resolve instead.
- **Suspended:** its document is in back/forward cache. Explicit-ref operations fail fast; locators see `NotReady`.
- **Connected, disconnected or unknown:** these are observations with timestamps, not guarantees. A detached node reinserted *within the same generation* can become usable again. Refs from an old generation never revive.

## 2. Top data models

**Immutable by default.** An entity is a set of immutable identity fields plus *one* `SubscriptionRef` holding its current state; anything that can change lives in that ref and nowhere else. Snapshots, events, outcomes and errors are immutable values. Lifetime ends are `Deferred`-backed `Effect`s. Readers always go through an `Effect` (`SubscriptionRef.get`), so a value is read when the effect runs, never captured stale in a field. Watchers use `changes`. Only the state fold (PROTOCOL.md) writes these refs. The public API exposes reads and event streams, never the refs themselves.

**Identity fields must be fixed for the entity's lifetime, and say why.** Each plain field carries a one-line justification. Ids, `closed` and streams are exempt by construction. A field that can't be justified moves into `state`. Applying this rule moved three fields: a document's and a window realm's navigable (prerender activation moves both into the existing tab), `isInitialAboutBlank` (cleared by `document.open()`), and a navigation's kind (the Navigation API can intercept a cross-document navigation into a same-document one).

**Unions of valid models, not optional fields.** When fields only make sense together, the model is a tagged union of its valid shapes, so impossible combinations can't be built: a page with a parent, a worker realm attached to a tab, a left-open page with a cleanup scope. A value that is genuinely optional, such as an opener the backend didn't report, is an `Option`, never `?:`, `undefined` or `null`. Generated L0 wire types mirror the protocol's optional keys, and adapters convert them at the L0→L1 boundary.

**The fold** (review 12, candidate 2). The adapter's sink is L1's fold: one per connection, run in receive order before the adapter publishes the event, and the only writer of entity state. The first slice folds what its operations read:

| Fact | Folded into |
|---|---|
| `UserContextAdded`, `UserContextRemoved` | a context: its id, whether it is the default, its pages, its `closed`; removing it closes its pages |
| `PageAdded`, `NavigableRemoved` | a page: its id, its context, its status (`Opening{url}` until its first document commits, then `Open{url, document, prompt}`, then `Closed{reason, url}`), its `closed`, its input permit (§5), its event channels (§9), the scope that owns it; and for a popup whose opener the backend names, a `Popup` event on the opener, and its release added to the opener's scope (§3) |
| `NavigationStarted` | a popup's URL, from its first navigation, which its `Popup` event's filters read (review 13) |
| `DocumentCommitted`, `DocumentUrlChanged`, `DocumentOpened`, `DocumentReadiness` | the page's active document: its id, URL and readiness; the document it replaced ends with `DocumentReplaced` |
| `RealmAdded`, `RealmRemoved` | which document each window realm belongs to, so the engine's realm (§8, Queries) is forgotten when it goes |
| `NavigationEnded` | a navigation's outcome, latched once |
| `RequestSent`, `ResponseReceived` | the responses of navigation requests, so a committed navigation carries its response |
| `ObligationOpened` for a prompt, `PromptClosed` | the page's prompt and a `Dialog` event; its decision, by the page's latest handler or else the context's `dialogs` policy, reported as an `AutoResolution` on the page and the context; and whether nothing will decide it (§5) |

A page is open from its first commit: `createPage` replies once the page is ready, so `PageReady` adds nothing yet. Connection loss ends everything with `ConnectionLost`. Facts the slice doesn't fold (frames' own documents, other requests, console, downloads, file choosers) wait for the modules that consume them; PROTOCOL.md lists them.

```ts
// ── Containment ────────────────────────────────────────────
interface BrowserModel {
  readonly id: BrowserId
  readonly backend: BackendInfo                         // fixed for the connection
  readonly ownership: { _tag: "Launched"; process: ProcessInfo } | { _tag: "Attached"; endpoint: Url }   // fixed: set when connecting
  readonly state: SubscriptionRef<{
    userContexts: ReadonlyMap<UserContextId, UserContextModel>
    capabilities: CapabilitySet                         // refined as probes complete
  }>
  readonly closed: Effect<CloseReason>
}

type Ownership =                                        // replaces release policy + optional cleanup scope
  | { _tag: "LeaveOpen" }                               // discovered or attached: never destroyed by us
  | { _tag: "Owned"; release: "close" | "remove"; scope: CleanupScopeId }

interface UserContextModel {
  readonly id: UserContextId
  readonly isDefault: boolean                           // fixed: the default context exists for the whole connection
  readonly state: SubscriptionRef<{
    access: Access; ownership: Ownership
    pages: ReadonlyArray<NavigableId>
    declarations: DeclarationSet                        // §7
    promptPolicy: PromptPolicy                          // §5
  }>
  readonly closed: Effect<CloseReason>
}

type NavigableModel = PageModel | FrameModel             // a page never has a parent; a frame always does
interface NavigableState {
  children: ReadonlyArray<NavigableId>
  activeDocument: DocumentId
  access: Access; ownership: Ownership
}
interface PageModel {
  readonly _tag: "Page"
  readonly id: NavigableId
  readonly pageKind: "tab" | "popup" | "prerender" | "fenced"   // fixed: an activated prerender page ends (PrerenderActivated)
  readonly origin:                                      // fixed: how it came to exist
    | { _tag: "Created" }
    | { _tag: "Opened"; originalOpener: Option<NavigableId> }   // None: the backend didn't report it; kept even under noopener
    | { _tag: "Adopted"; originalOpener: Option<NavigableId> }
  readonly state: SubscriptionRef<NavigableState & { prompt: Option<PromptId>; input: InputState }>
  readonly closed: Effect<CloseReason>
}
interface FrameModel {
  readonly _tag: "Frame"
  readonly id: NavigableId
  readonly parent: NavigableId                          // fixed: a frame never changes parent
  readonly state: SubscriptionRef<NavigableState>
  readonly closed: Effect<CloseReason>
}

interface DocumentModel {
  readonly id: DocumentId
  readonly origin: Origin                               // fixed for the document; document.domain changes only the effective domain
  readonly createdBy:                                   // fixed: replaces optional navigation/restoredFrom and the error flag
    | { _tag: "InitialBlank" }
    | { _tag: "Navigation"; navigation: NavigationId }
    | { _tag: "ErrorPage"; navigation: NavigationId }   // H10: a failed navigation that still committed
    | { _tag: "Restored"; navigation: NavigationId; from: DocumentId }   // only with correlating evidence
    | { _tag: "Adopted" }                               // existed before we attached
  readonly state: SubscriptionRef<{
    navigable: NavigableId                              // changes only on prerender activation
    isInitialAboutBlank: boolean                        // cleared by document.open()
    generation: DocumentGeneration                      // bumped by document.open()
    url: Url                                            // changes on same-document navigation
    lifecycle: { _tag: "Active" } | { _tag: "Suspended" } | { _tag: "Ended"; reason: CloseReason }   // Suspended: no backend built confirms it (§4)
    readiness: "loading" | "interactive" | "complete"   // current state; can return to loading
    loading: LoadingResult                              // per generation; post-commit failure lives here; not observed yet (§4)
  }>
}

type RealmModel = WindowRealmModel | WorkerRealmModel   // only window realms belong to a tab
type RealmLifecycle = { _tag: "Active" } | { _tag: "Suspended" } | { _tag: "Destroyed"; reason: CloseReason }
interface WindowRealmModel {
  readonly _tag: "Window"
  readonly id: RealmId
  readonly world: { _tag: "Main" } | { _tag: "Isolated"; name: string }   // fixed: a realm never changes world
  readonly state: SubscriptionRef<{
    navigable: NavigableId                              // moves with its document on prerender activation
    documents: NonEmptyReadonlyArray<DocumentId>        // usually one; two after initial-blank reuse
    lifecycle: RealmLifecycle
  }>
}
interface WorkerRealmModel {
  readonly _tag: "Worker"
  readonly id: RealmId
  readonly worker:                                      // fixed: a realm never changes kind
    | { _tag: "Dedicated"; owner: RealmId }
    | { _tag: "Shared" }
    | { _tag: "Service"; registrationScope: Url }
    | { _tag: "Worklet"; type: string }
  readonly state: SubscriptionRef<{ lifecycle: RealmLifecycle }>
}

// ── Navigation ─────────────────────────────────────────────
interface NavigationModel {
  readonly id: NavigationId
  readonly navigable: NavigableId                       // fixed: a navigation targets one navigable
  readonly initiatedAs: "crossDocument" | "fragment" | "historyApi" | "traversal" | "reload" | "javascriptUrl" | "prerenderActivation"
                                                        // fixed: how it started; interception or a download shows up in the outcome
  readonly status: SubscriptionRef<
    | { _tag: "Pending" }
    | { _tag: "Observed"; outcome: NavigationOutcome; evidence: Evidence }
    | { _tag: "Unresolved"; lastObserved: Evidence }>
}
type NavigationOutcome =
  | { _tag: "Committed"; document: DocumentId; response: Option<ResponseRef> }   // None: about:blank, data:, and so on
  | { _tag: "SameDocument"; document: DocumentId; via: "fragment" | "historyApi" | "intercepted" }
  | { _tag: "Restored"; document: DocumentId }        // back/forward cache
  | { _tag: "Activated"; document: DocumentId }       // prerender
  | { _tag: "Download"; download: DownloadId }        // old document stays
  | { _tag: "NoContent"; status: 204 | 205 }          // old document stays
  | { _tag: "Failed"; error: NetError; errorDocument: Option<DocumentId> }   // None: no error page correlated (yet)
  | { _tag: "Superseded"; by: NavigationId }
  | { _tag: "Canceled"; reason: "beforeunload" | "navigateEvent" | "sandbox" | "unloading" | "traversalInProgress" }
  | { _tag: "NoOp"; reason: "javascriptNonString" | "noHistoryEntry" }

// ── Network: immutable snapshots; a request's progress is a stream of them ──
interface RequestSnapshot {
  readonly hop: RequestHopId
  readonly initiator:                                   // replaces optional navigable + navigation
    | { _tag: "Document"; navigable: NavigableId; navigation: Option<NavigationId> }   // None: a subresource
    | { _tag: "Worker"; realm: RealmId }
    | { _tag: "Unattributed" }                           // e.g. a client-less service-worker fetch
  readonly method: HttpMethod; readonly url: Url; readonly headers: Headers   // classified values are Redacted
  readonly resourceType: ResourceType
}
interface ResponseSnapshot {
  readonly hop: RequestHopId; readonly status: StatusCode; readonly url: Url; readonly headers: Headers
  readonly servedBy: "network" | "cache" | "serviceWorker" | "cacheOrServiceWorker" | "route" | "unknown"   // what answered (review 09)
  readonly body: BodyAccess                             // availability is read through an Effect
}
interface ConnectionModel {                            // long-lived connections
  readonly id: ConnectionId; readonly kind: "webSocket" | "eventSource"; readonly url: Url; readonly navigable: NavigableId   // fixed at open
  readonly frames: Stream<ConnectionFrame>              // capability
  readonly closed: Effect<CloseReason>
}

// ── Obligations ────────────────────────────────────────────
interface ObligationModel {
  readonly subject:
    | { _tag: "PausedRequest"; hop: RequestHopId; phase: "request" | "response" | "auth"; occurrence: number }
    | { _tag: "Prompt"; prompt: PromptSnapshot }
    | { _tag: "FileChooser"; navigable: NavigableId; multiple: boolean }
  readonly state: SubscriptionRef<
    | { _tag: "Pending" } | { _tag: "DecisionSelected"; decision: Decision } | { _tag: "Sending"; decision: Decision }
    | { _tag: "Acknowledged"; decision: Decision } | { _tag: "Rejected"; decision: Decision; error: BackendFailure }
    | { _tag: "Unknown"; decision: Decision; evidence: Evidence } | { _tag: "Ended"; reason: CloseReason }>
}

// ── Access, operations ─────────────────────────────────────
type Access = "observe" | "inspect" | "control"
interface OperationRecord {                            // internal; inspected through an Effect
  readonly id: OperationId
  readonly state: Ref<{
    dispatch: { _tag: "NotSent" } | { _tag: "MayHaveBeenSent" } | { _tag: "Acknowledged"; result: "ok" | "rejected" }
    progress: ReadonlyArray<StepEvidence>               // per command: unsent | uncertain | ok | rejected
    observation: { _tag: "Pending" } | { _tag: "Observed"; value: unknown } | { _tag: "Unknown"; evidence: Evidence }
    caller: "waiting" | "completed" | "failed" | "interrupted"
    cleanup: { _tag: "NotNeeded" } | { _tag: "Pending" } | { _tag: "Completed" } | { _tag: "Failed"; cause: string }
  }>
}
type Readiness = { _tag: "Ready" } | { _tag: "NotReady"; predicate: Predicate; reason: NotReadyReason; observedAt: number }

type CloseReason =
  | BrowserClosed | BrowserCrashed | ConnectionLost | ModelUnavailable
  | UserContextRemoved | AccessReleased | PrerenderActivated
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
Caller scopes own handles, subscriptions and declarations.
Cleanup groups can span sibling pages, independently of this graph.
```

- **Three separate decisions.** Every remote resource carries:
  - **access**: what we may do to it;
  - **ownership**: `LeaveOpen`, or `Owned{release: close | remove, scope}`, which records what happens when we let go and which scope does it. One union, so a left-open resource can't carry a cleanup scope.

  Being a child in the model graph grants none of them.
- **Access.** `observe` permits protocol events only. `inspect` adds isolated-world injection and reads: locators, readiness predicates, snapshots, screenshots, body reads. `control` adds input, navigation, main-world evaluation, declarations and obligation decisions. Discovered resources start at `observe`, and upgrading never changes release policy. An upgrade is held by the `Scope` that acquired it; once that scope closes, the upgraded handle fails with `TargetGone{reason: AccessReleased}` rather than silently keeping its powers. A declaration whose physical effect reaches past its target needs explicit wider access, or fails with `NotPermitted`. Access is a library contract, not a browser security boundary. Creating an isolated world is not mutation, because page scripts can't see it. What `inspect` must never do is change visible page state: it never scrolls, focuses or dispatches input. An element screenshot below the fold is captured beyond the viewport rather than by scrolling the user's tab; where a backend can't do that, it fails with `NotPermitted` and a hint.
- **Release and cleanup groups.**
  - Created resources are `Owned`.
  - The default context and pages that existed at attach are `LeaveOpen`.
  - **Every acquisition requires a `Scope`, and that scope is the cleanup group.** This covers contexts, pages, access upgrades, handles, capability handles and every declaration. Values with no remote lifetime (locators, snapshots, captured bodies) need none. An early `close` makes the finalizer a no-op.
  - **Seeing an event acquires nothing.** A popup of an owned page is released with the scope that acquired its opener, even if the opener has already closed; subscribing to it changes nothing. The model records the scope that acquired each owned page and adds a popup's release to it when the popup appears; a scope that has already closed closes the popup at once (review 13). A popup of a `LeaveOpen` page is `observe`/`LeaveOpen`. A download's file belongs to its context.
  - Transfer to another scope is explicit and atomic with respect to shutdown. Ambiguous opener evidence never implies ownership.
- **Ownership ledger.** The connection records owned resources, groups and transfers. A persisted ledger yields *reclamation candidates* only. Automatic destructive reclaim across connections needs verified browser incarnation, resource identity and claimant coordination, and is deferred.
- **Requesting a close is not ending a lifetime.** `close({ runBeforeUnload: true })` can be refused (`PageError{CloseCanceled}`), and the page stays usable. A close timeout leaves closure unconfirmed rather than fabricating `PageClosed`. Teardown of owned resources uses a bounded close without beforeunload.
- **Lifetime signal and `within`.** Each object has a single-assignment `closed: Effect<CloseReason>`. `within(effect): Effect<A, E | TargetGone, R>` arbitrates completion against the end of the lifetime and delivers the typed reason; closing a `Scope` alone would only interrupt. Caller interruption remains interruption. Whichever of completion or end wins the race is recorded once.
- **Remote facts and model loss.** A remote close invalidates local bindings without sending another close. Permanent loss of observation ends lifetimes with `ConnectionLost` or `ModelUnavailable` without asserting remote destruction. A temporary quarantine fails current operations without completing `closed`, and resumes only after a verified resynchronization.
- **Suspension** (back/forward cache) is a domain state, not a scope operation. Explicit-ref operations fail fast; waits may opt in to resume within their deadline. Resuming never revives invalid handles.
- **Cleanup order.** Transport, ingestion and obligation resolvers stay alive while owned resources tear down. The order is: stop new work, drain obligations within the cleanup budget, release declarations and owned resources in dependency order, then disconnect or close the owned process. Finalizers are bounded.

## 4. Documents, realms and navigation

- **Document lifecycle.** `Active ⇄ Suspended` (back/forward cache, only with confirmed evidence) and `→ Ended{reason}`.
  - No backend built confirms a suspension (review 12). Chromium and Firefox restores are recorded as new documents, `createdBy: Restored{from}`, after the old one ended, and WebKit keeps no back/forward cache. So every restore is a new epoch, the second branch below, and `Suspended` stays in the model for a backend that can confirm it.
  - Readiness events are accepted only for the matching epoch and generation.
  - `document.open()` keeps the epoch, starts a new generation, and returns readiness to `loading`.
  - A restored document gets the same id only when the adapter can correlate it; otherwise the old epoch ends with `DocumentUnloaded` and the new one is `createdBy: Restored{from}`.
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
  - A failure after a successful commit is a loading result of the document; the commit outcome is not revised. No backend reports one yet, so a document's `loading` isn't observed (review 12).
  - An error page that commits after its navigation was reported `Failed` is that navigation's document, `createdBy: ErrorPage{navigation}`, never a navigation of its own, which would supersede one started since. Chromium commits its error pages that way (PROTOCOL.md; found by the first slice).
  - Navigations observed during an action are correlated, not proven caused by it.
  - Browsing-context-group switches are reported as `Confirmed | Suspected | Unknown`.
- **Projection for callers** (API.md):
  - **Success:** `Committed`, `SameDocument`, `Restored`, `Activated`. An HTTP 404/500 document is a successful commit.
  - **`back`/`forward`:** `NoOp{noHistoryEntry}` becomes `None`.
  - **Failure:** everything else becomes `PageError` with a navigation reason (`NavigationFailed`, `NavigationCanceled`, `NavigationSuperseded`, `BecameDownload`, `NoContent`). `BecameDownload` and `NoContent` count as failures unless the call accepts them.
  - **`waitUntil`:** a navigation resolves at commit. `domContentLoaded` or `load`, when asked for, waits on the resulting document and generation within the same deadline.

## 5. Input and obligations

- **Input fidelity is a backend property:** `native` (CDP, patched WebKit), `webdriver` (BiDi) or `synthetic` (stock WebKit shims; untrusted, no activation).
- **Input state** is kept per page: pressed keys and buttons, pointer position, and an undo list. Input to one page is serialized, and acquiring the permit consumes the operation deadline. Actionability is checked again after acquiring the permit.
- **Actions** (review 12, candidate 4). An action's checks run in the page at each animation frame: every check is about layout, which changes only when the page renders, and a timer would be a cadence nobody chose. An attempt is one evaluation in the engine (§8, Queries) that resolves the locator and checks it at each frame until the checks pass or the round's cap runs out: one second, or what is left of the deadline.
  1. **Resolve.** No match is `NotReady{NoMatch}`; two or more fail at once with `StrictViolation`.
  2. **Check**, in §8's order: Visible, Enabled, NotInert, InViewport (scrolling the element to the centre of the viewport, once, when it is outside), Stable (the rect unchanged across *k* frames, 2 by default) and ReceivesPointer at the action point. A round that sees no frame at all ends `NotReady{NoRenderingOpportunity}`.
  3. **Act.** Ready, L1 takes the page's input permit, checks again under it, and dispatches the pointer move, down and up at the action point: the padding box's centre, or `position` from its top left, in viewport CSS pixels. From the first input event the dispatch may have been sent, and nothing is sent again. `trial` stops after the check under the permit.
  4. **Fail** at the deadline with `Timeout{phase}`, carrying the last `NotReady`, its de-duplicated history, and a hint that explains it, so the error says what stands in the way: "Another element covers the element's action point: div.toast "Saved"". The phase is `waitingForCondition`, or `resolving` when nothing ever matched.

  Not built yet: the guard on the first trusted event (§8, ReceivesPointer), coordinates in child frames, modifiers, and the actions besides `click`.
- **Compensation.** On interruption or scope close, owned pressed inputs are released in reverse order. This is bounded and best-effort, and records failures. Input state that might be inconsistent blocks further gestures until it is reset.
- **Activation.** The library keeps a diagnostic estimate of user activation; it never gates an operation. Operations that need activation declare it, and evaluation can request it from the backend.
- **Focus.** Key input requires system focus; the adapter focuses the page first.
- **Click target.** A click goes to the common ancestor of the pointer-down and pointer-up targets, so hit-target verification also guards the trusted event stream (§8).
- **Prompts.**
  - A dialog pauses the event loop of its agent and can block same-agent siblings. Blocking is recorded as confirmed or suspected.
  - `PromptBlocking{resolution: Pending}` is waitable within the caller's deadline; `None` is terminal.
  - Default policy, applied only to controlled targets:
    - owned contexts: an explicit `dialogs` policy (`dismiss` by default, `accept`, or `leaveOpen`) decides immediately when no handler claims the dialog. `beforeunload` is accepted under `dismiss`. There is no grace period, so the policy adds no hidden lag;
    - attached pages: no default unless the caller sets one.
  - Every automatic decision is published and recorded on relevant operations, with correlation but no claim of causation.
  - **Handlers** (review 13). The page's latest `Dialog.handle` decides, chosen when the dialog opens: the chain is one handler, since `Dialog` has no fallthrough. It runs in its registration's scope with `Deadline.DefaultBudget`, as read at `handle`; failing, being interrupted or running out of time leaves the dialog to the policy, and the failure is logged. A resolver in the model's scope delivers whichever decision comes, apart from the handler's fiber.
  - **What a dialog blocks** (review 13, probed). Chromium and WebKit block every evaluation, in every world, while a dialog is open, and Firefox doesn't; on all three, the input that opens a dialog returns only once it is decided. When nothing will decide a dialog (no handler when it opened, and a `"leaveOpen"` policy), every operation on its page fails at once with `PromptBlocking{kind, text}`, including the input that opened it, whose dispatch `MayHaveBeenSent`.
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
  - Requests of a destroyed document may never terminate. They are tracked as detached, and no network failure is fabricated for them.
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
  - A `body` in a `next` or `stream` filter acquires collection before that call returns; BiDi needs a collector before the request starts.
  - Ordinary results are owned bytes. Large or streaming bodies use explicit caller-scoped leases.
- **Service workers.** Interception may see a request twice or never. Bypassing service workers is a capability.
- **Long-lived connections.** WebSocket and EventSource connections are modelled. Observing frames and mocking them are separate capabilities.

## 7. Declarations

Declarations are init scripts, routes, overrides, emulation, download and prompt policies, data collectors and page clocks. All are identified registrations with scoped lifetimes.

- **Installation.**
  - Installation is acknowledged, or acquisition fails.
  - A declaration states the timing it needs (`beforeAuthorScript | bestEffort`). An unmet requirement fails with `Unsupported`; it never silently degrades.
  - Declarations stay within the target's access scope.
  - Attaching to a running page cannot precede scripts that already ran.
  - A target is published as ready only after its required setup succeeds. Optional setup failures appear as unavailable capabilities.
- **Precedence** for settings and handlers: scope specificity first (Page, then Context, then Browser; the API declares nothing on a frame, so Frame joins when a declaration needs it, review 12), then explicit priority, then recency. Releasing any registration recomputes the effective state, including when fibers finish out of order.
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
  - **Context-wide timelines** need no cross-page synchronization. Each operation is broadcast, in order, to every current document in the context and appended to the log that new pages replay. It completes once every document has acknowledged it, and a page that fails reports its own typed reason. Controlled and fixed clocks don't advance between operations, so pages stay in lockstep. After `resume`, while real time flows, pages may differ by milliseconds; this is documented, not corrected.
  - **Readiness.** Sampling uses native rendering, independent of the application clock; a paused clock never stalls actionability, and page time is never advanced implicitly. Where rendering really is frozen, readiness reports `ClockPaused`.
  - **Removal and restoration.** Removing the clock affects future documents. Restoring it in place is a capability; the simple path is an owned page that gets closed.
- **Storage.**
  - **Partitioning.** Storage is keyed by user context and partition key:
    ```ts
    type PartitionKey =
      | { _tag: "Unpartitioned" }
      | { _tag: "Partitioned"; topLevelSite: Site; crossSiteAncestor: Option<boolean>; vendor: Option<VendorPartition> }
    ```
    `topLevelSite` is the common core: CDP's cookie `partitionKey`, Firefox's `originAttributes` and BiDi's `storage.PartitionKey` all carry it. `crossSiteAncestor` is an `Option` because only Chromium reports it. Backend-specific detail, such as Chromium's nonces for anonymous iframes, goes in `vendor` and round-trips within the same backend only.
  - **`StorageState`.** It is portable into fresh contexts. Source context is provenance, not a restriction. Mismatched opaque partitions fail the new context with `UserContextError{Incompatible}`, and partial restores are reported.
  - **Export and import.** Export is an explicit, versioned codec to `Redacted<Uint8Array>`, and import validates it. Diagnostic JSON is never a persistence format.
- **Permissions** are scoped to a user context and combined (AND) with Permissions Policy.

## 8. Queries and readiness predicates

### Queries

A locator is data: a list of steps (a query, then `filter`, `and`, `or`, `nth`) that one engine of ours interprets, the same on every backend (review 12, candidate 3). So a locator means the same thing in every browser, and a test of it on one backend speaks for all three. The engine is a self-contained function in our source, installed in each document's utility world on first use, as WebKit's evaluation helper is, and sent requests as JSON. It isn't the browser's accessibility tree: the three engines' trees differ at the edges, WebKit's protocol can't query its tree, and an action needs the element in the utility world anyway to check it. When a request's document ends under it, the request goes again to the page's new document, within the deadline; the engine dispatches nothing, so sending again is always safe.

- **The tree** is the document's composed tree, in tree order: open shadow roots are searched, a shadow root's elements right after its host, and closed ones aren't. Iframes are entered only through `frame()`.
- **Text** is an element's text content in the flat tree, skipping `script`, `style`, `noscript` and `template`, with a button-like `input`'s value, and with whitespace collapsed and trimmed. It isn't `innerText`, which depends on layout, differs between engines, and forces layout for every candidate.
- **`getByText`** matches the smallest element whose text matches: one whose text matches while no child element's does, so `<p>1 <b>item</b></p>` is found by "1 item". The document's `head` isn't searched. A string is a case-insensitive substring, `exact` is equality, case-sensitive, and a `RegExp` is tested as given.
- **`getByRole`** takes an element's role from its `role` attribute (the first token the engine knows), or else its implicit role under HTML-AAM, from a table in the engine. Its name is computed under accname 1.2: `aria-labelledby`, `aria-label`, the native label (`label`, `alt`, `caption`, `legend`, a button's value), the content for roles named from content, then `title` and `placeholder`. An embedded control adds its value to another element's name, never to its own. Elements outside the accessibility tree (`aria-hidden`, `display: none`, `visibility: hidden`, the `hidden` attribute) are skipped unless `includeHidden` is set. A name matches as text does.
- **The other queries** follow from those: `getByLabel` matches labelable elements by their label (`label[for]`, a wrapping `label`, `aria-labelledby`, `aria-label`); `getByPlaceholder`, `getByAltText` and `getByTitle` match their attribute; `getByTestId` matches `data-testid` exactly; and `locator(css)` runs `querySelectorAll` in the document and each open shadow root, where a malformed selector fails with `InvalidInput` at once.

### Readiness predicates

Each predicate yields `Ready`, `NotReady{reason}` or an observation error. A reason describes the present condition and does not promise it can never improve. L2 decides whether to wait, scroll, activate or fail; an action checks at each animation frame (§5, Actions).

| Predicate | Definition | Reasons |
|---|---|---|
| Connected | binding, generation and connectivity checked at use | `Replaced`, `Detached`, `Suspended` |
| Visible | `checkVisibility({contentVisibilityAuto, opacityProperty, visibilityProperty})` and a non-empty rect; for `display: contents`, any visible child | `NoBox`, `ContentVisibilitySkipped` |
| Stable | rect unchanged across *k* native rendering updates, independent of the application clock. *k* is a per-backend default measured by probe 10 (initially 2, or 6 on WebKit/Windows). It is shown in the action's span and in any error ("waited for 2 stable frames"), and can be overridden per call | `NoRenderingOpportunity{lastFrameAt}`, `ClockPaused` |
| Enabled | ARIA-disabled semantics: `disabled`, `fieldset` inheritance, `aria-disabled` | — |
| Editable | enabled, not `readonly`/`aria-readonly`, and an editable element type | `NotEditableType` |
| NotInert | not inside an inert subtree | `BlockedByModal{dialog}` |
| InViewport | a content quad intersects the viewport (area > 0.99 CSS px²); scrolling is an action policy | `OutsideViewport` |
| ReceivesPointer | at the action point, the composed-tree hit test (per shadow root, through iframes) lands on the target or a descendant; checked before dispatch *and* guarded on the first trusted event | `Covered{by}` |
| Unique | exactly one match (hidden matches count); actions fail immediately on ambiguity, with no retry window | `Ambiguous{candidates, visibleCount}` |
| PromptFree | no known prompt blocking the navigable | `PromptBlocking{prompt, resolution}`; built for `resolution: None` as the shared reason `PromptBlocking{kind, text}` (§5) |

There are no time-window predicates such as network idle or DOM quiet: waiting for T ms of silence is a heuristic (rule 23). Compatible instantaneous checks are batched in one injected evaluation. No batch is an atomic guarantee that covers the input that follows it.

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

- **Subscriptions.** A subscription is the internal resource behind an event module's `next` and `stream`.
  - **Before it returns:** it acquires collectors and remote enablement, so the caller's next line already runs subscribed. If that fails, the caller gets `SubscriptionError` before reaching its action.
  - **Revision boundary:** it sets one between the current-state snapshot and the live subscription.
  - **Correlation:** by the strongest identity available.
  - **Owner ends without a match:** fails promptly.
  - **Results:** a latched immutable result outlives the subscription.
  - **Delivery** (review 13). The fold publishes each event to a channel per kind and target (a page's popups, a context's automatic decisions), which logs it and offers it to every subscription whose declarative filter matches, each into a buffer of its own; offering never blocks the fold. Registration is the revision boundary, kept by sequence numbers: an entry whose details arrive later (a popup's URL) is offered again to the subscriptions it now matches, but never to one made after it was published. A `stream` buffers `Subscription.Capacity` events (1,000) and then fails with `EventOverflow`, alone; `next` keeps what arrives until its first match or its deadline, and times out in the phase `waitingForEvent`, with a hint naming a match that came before it subscribed. The end of the target ends streams normally when it was closed, and fails waits and other streams with `TargetGone`. `PubSub` doesn't fit: it offers every message to every subscriber, so filters would run after buffering, and its bounded strategies stall the publisher or drop silently.
- **Event logs.** Each page and context keeps a bounded log per event kind, fed by the same fold as subscriptions. Entries are copied metadata or handles to resources owned elsewhere, never collected bodies, so nothing in a log decays. A log counts what it drops: every event of its kind it discarded, since which ones a later filter would have matched can't be known (review 13). Logs serve `history`, the digest that agent tools and CLI commands return between calls, and the hint on a late subscription's `Timeout`, which names a match that arrived just before it subscribed.
- **Deadline.** There is one monotonic deadline per operation, inherited by nested calls and only ever shortened. It lives in `Deadline.CurrentDeadline`, an absolute instant on the live clock, set only by `Deadline.within`; an operation with no enclosing deadline gets `Deadline.DefaultBudget` from when it starts. An event wait takes its deadline at `next`. Cleanup has its own budget. Deadline failures are `Timeout{phase}`, carrying the last observation and its de-duplicated history.
- **Retries.** Retry decisions depend on the operation, its phase, the target binding, dispatch evidence and the remaining deadline, never on an error tag alone.
  - Locators re-resolve before dispatch.
  - Explicit refs never rebind.
  - Nothing that may have dispatched is repeated automatically.
- **Errors (L1 view).** Lifetime ends surface as `TargetGone{reason: CloseReason}` and deadlines as `Timeout`. Everything else is the error of the module whose operation failed (`LocatorError`, `PageError`, …; one per module), whose `reason` includes the shared `NotPermitted`, `Unsupported` and `BackendFailure{Rejected | IncompatibleResponse}`. L0 hands over a normalized `RejectReason`, which L1 maps using its own state (`NoSuchNode` becomes `StaleRef{Detached}`); reasons it doesn't map surface as `BackendFailure{Rejected}`. All of them carry the diagnostic envelope, and every reason carries a one-line remediation `hint`. Defects are reserved for bugs, and for gaps: a member the interfaces declare that isn't built yet fails as the defect `NotBuilt{member}`, loud and never a no-op, because no caller could handle it as a condition of the browser (review 12, candidate 6). A module-level function that isn't built stays a declaration, absent at run time, unless its module needs the binding to load: `Deferred.await`, exported under a reserved word, is a `NotBuilt` function, and `Route.continue` a decision nothing reads yet. `SessionSwapped` is internal.
- **State and event streams have different contracts.**
  - **State** (`Watchable`) is a read-only view of an entity's state ref:
    - reading it is an `Effect`;
    - `changes` starts with the current value, conflates, drops consecutive equal values, and ends after emitting the terminal state as data;
    - `waitFor` is level-triggered;
    - a late subscriber sees the present, not the past, which is safe because waits are level-triggered;
    - only state folded from protocol events is watchable.
  - **Events** are subscribed eagerly: the subscription is live when `next` or `stream` returns, because a lazily subscribed event stream would race its own cause. Event streams are lossless up to a bound. Reading the event log (`history`) never waits.
  - **Normal end:** an event stream owned by an object ends successfully when the object ends normally, after draining what was already published.
  - **Abnormal end:** it fails with `TargetGone` on abnormal ends and with `EventOverflow` on overflow.
  - **Filtering:** declarative metadata prefilters run before buffering. Caller predicates run in subscriber workers, never on the ingestion path.
- **No public fibers, no writable `Deferred`s or `Ref`s.**
  - **Internal:** the model's background work (state folds, handlers, resolvers) runs in fibers scoped to the owning entity. `Deferred`s latch first matches, lifetime ends and obligation decisions; `Deferred.succeed` returning `false` enforces a single winner.
  - **Public:** only read-only views cross the API: `Effect`, `Watchable`, `ReadonlyDeferred`, and `Stream` from eager subscriptions.
- **Effect primitives behind these mechanisms.** Named so the implementation uses them rather than rebuilding them:

  | Mechanism | Effect module |
  |---|---|
  | domains and subscriptions enabled on demand (principle 8) | `RcMap`, keyed by session and domain; the last scope to close disables |
  | input serialized per page (§5) | `Semaphore`, one permit per page |
  | the initialization gate (PROTOCOL.md) | `Latch` |
  | compatible instantaneous checks batched into one evaluation (§8) | `Request` and `RequestResolver`, which also batch reads across concurrent fibers |
  | capability evidence per backend revision | `Cache` |
  | init-script dependencies and cycle checks (§7) | `Graph` |
  | handlers and resolvers scoped to their entity | `FiberSet`, `FiberMap` |
  | the persisted ownership ledger (§3) | `KeyValueStore` (`effect/persistence`) |
  | byte limits: payloads, body capture, queues | `ByteSize` |
  | single-winner decisions and latched first matches | `Deferred`; callers get its read side, `ReadonlyDeferred`, which at run time is Effect's `Deferred` marked read-only (review 13) |
  | event delivery (Subscriptions) | a `Queue` per subscription that the fold offers to without suspending, not `PubSub` (review 13) |
  | `Expect`'s re-checks on change signals | `Reactivity`: the model invalidates keys (a `Watchable` change, a subtree mutation), and `Reactivity.stream` re-runs the check. Not built yet: expectations re-check at `Expect.CheckInterval` (100 ms), which is what visibility, a condition with no change signal, needs (review 12, candidate 5) |

## 10. Secrets and diagnostics

- **Classified fields.** Credentials, cookie values, typed text, and authentication and cookie headers are classified. They are wrapped as `Redacted` on the way out. Values with preset-dependent detail (URLs, titles, descriptions) implement Effect's `Redactable` and render from the preset in the current fiber's context, so Effect's logs, spans, errors and inspection redact them the same way, in user code too. Sensitive header names join `Headers.CurrentRedactedNames`.
- **Descriptions** use ids and preset-dependent URL detail (README.md); the default preset is origins only.
- **Raw content** (bodies, console arguments, DOM snapshots, screenshots) may contain secrets echoed by the page. It is recorded as metadata by default and exported only under an explicit capture policy. There is no taint tracking.
- **Agent secret placeholders** are substituted at dispatch, inside L1. A page can still echo a secret into other channels, so capture policy applies to anything sent to a model.

## 11. Open questions

Browser-dependent unknowns are in [PROBES.md](PROBES.md). No design questions are open at this layer right now.
