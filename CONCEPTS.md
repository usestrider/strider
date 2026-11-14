# CONCEPTS: the native browser model (L1)

*Revision 5.25, 2026-10-19; checked against the built adapter contract, with how a locator finds elements (§8) and how an action waits (§5), and the first slice built, 2026-10-22; how events are delivered, popups, and dialogs, built 2026-10-23. A condensed restatement of draft 4 (commit `6cc0bc1`). The reasoning behind each contract is in that draft; this document keeps the decisions. Spec anchors: `HTML#x` is `https://html.spec.whatwg.org/#x`; `BIDI#x` is the WebDriver BiDi editor's draft.*

## Purpose

L1 is a protocol-neutral, spec-grounded model of what a browser is, what a driver can observe, and what it can do. It sits between the protocol adapters ([PROTOCOL.md](PROTOCOL.md)) and the public API ([API.md](API.md)). Every API convenience must be expressible here, and nothing here mentions protocol ids.

## 1. Identity

The spec has three identity layers, and drivers tend to conflate them:

| Layer | Concept | Survives | Changes on |
|---|---|---|---|
| **Slot** | Navigable: a top-level traversable (Page) or a child navigable (Frame) | every navigation, process swap, and COOP swap | destruction only |
| **Epoch** | Document, plus its Window realm (usually) | same-document navigation, `document.open()` (new generation), back/forward-cache suspend and restore when continuity is shown | cross-document commit |
| **Topology** | Browsing context, browsing context group, agent, event loop | navigations within the group | a browsing-context-group switch (COOP, prerender activation, fenced frames), which also severs openers |

Realms are siblings of documents, not children. The one exception that forces this is the initial `about:blank` Window, which the first same-origin navigation reuses (`HTML#initialise-the-document-object`).

**Every public id is minted by the adapter, in L1's types.** Backend ids are correlation evidence held in the adapter's tables, and L1 never sees one. This isolates identity from process swaps and session churn. It also lets a navigation started by a command have its id before the command is sent. Each connection's adapter mints its own, so a reconnection starts a new id namespace. Built: the counters are the process's, so no two connections mint the same id, and a trace recording can match an operation to its target by the ids in its span (QUIRKS.md, Q162).

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

Browser-reported URLs that cannot be parsed become `about:blank` rather than ending the connection, including network and obligation URLs. Each malformed conversion emits a warning and, unless tracing is suppressed, a `browser.url.malformed` event on its own short-lived span; both carry `browser.url.reported`, shown as `REDACTED` under the default strict diagnostics preset and as the exact browser string under local. Empty strings and Chromium's `":"` placeholder also become `about:blank`, without diagnostics. Optional script-location URLs remain `None` when unparseable. The naming and suppression settings receive `browser.url.malformed` with a Browser target; `browser.operation` identifies the original operation or diagnostic name.

**Model objects are values.** References are `Equal`/`Hash` by immutable identity within their connection. Mutable state (URL, connectivity, descriptions) never affects hashing. Two independently acquired handle leases are not equal even when they point at the same remote object, because each owns its own release. Event payloads are immutable snapshots, and reading live state is an explicit operation.

**Staleness of a `NodeRef`:**

- **Known invalid:** its document or navigable ended, the backend binding was invalidated, it was adopted into another document, or its generation is old. Explicit-ref operations fail with `StaleRef{reason: Replaced | Detached | Suspended | BindingLost}`. Locators re-resolve instead.
- **Suspended:** its document is in back/forward cache. Explicit-ref operations fail fast; locators see `NotReady`.
- **Connected, disconnected, or unknown:** these are observations with timestamps, not guarantees. A detached node reinserted *within the same generation* can become usable again. Refs from an old generation never revive.

## 2. Top data models

**Immutable by default.** An entity is a set of immutable identity fields plus *one* `SubscriptionRef` holding its current state; anything that can change lives in that ref and nowhere else, the caller's settings for it included. Snapshots, events, outcomes, and errors are immutable values. Lifetime ends are `Deferred`-backed `Effect`s. Readers always go through an `Effect` (`get`), so a value is read when the effect runs, never captured stale in a field; a projection that must be synchronous, such as a watchable's, reads the value now. Watchers use `changes`. Only the fold writes these refs. The public API exposes reads and event streams, never the refs themselves.

**One writer, in code.** The fold is the only writer of the model: of every entity's state, and of every setting a caller gives it (a page's handlers, routes, owner, and `beforeunload` stays; a context's options, routes, and grants). Built:

- **One ordered stream.** The adapter's facts and the caller's commands reach the fold through one inbox, applied one at a time, each in full, in the order they arrived, and always with the model's context, never the caller's operation or deadline. An input that finds the fold idle is applied at once on its caller's fiber, then whatever arrived meanwhile; one that finds a step running waits its turn. The adapter's sink returns once its fact is applied, so facts are folded in receive order, before the adapter publishes the event, and a protocol event's facts back to back, so no reader sees half of one. A caller's setting is a command, applied the same way: registering returns once the registration is applied, and removing it, when its scope closes, is a command too.
- **Ordered against the events.** Who decides an obligation is chosen as the fold folds its opening (§5): the page's latest handler, a request's routes, the context's policy. So a dialog folded after `Dialog.handle` returned is that handler's to decide, and one folded before isn't, whatever the deciders' fibers do next.
- **Nothing else can write.** An entity carries the read side of its state (`get`, `changes`); the ref behind it is the fold's alone, so writing from anywhere else doesn't compile. The model hands out entities by id, never its tables.
- **A step never waits.** No step waits on the browser or on a caller, so the stream never stalls: deciding an obligation, releasing a page, and installing the engine happen apart, and what they write comes back as a command (a policy's `AutoResolution`, a dialog nothing will decide, a stay).
- **Two exceptions, each with a single writer of its own.** A page's input state (§5) is written by the gesture that holds the page's input permit, at the rate of input events. Where the engine is installed (§8, Queries) is the runtime's `Cache` of its own work, which dedupes concurrent installs; it is no fact about the browser and no caller's setting.

**Identity fields must be fixed for the entity's lifetime, and say why.** Each plain field carries a one-line justification. Ids, `closed`, and streams are exempt by construction. A field that can't be justified moves into `state`. Applying this rule moved three fields: a document's and a window realm's navigable (state can represent transfer between pages, which current adapters do not implement), `isInitialAboutBlank` (cleared by `document.open()`), and a navigation's kind (the Navigation API can intercept a cross-document navigation into a same-document one).

**Unions of valid models, not optional fields.** When fields only make sense together, the model is a tagged union of its valid shapes, so impossible combinations can't be built: a page with a parent, a worker realm attached to a tab, a left-open page with a cleanup scope. A value that is genuinely optional, such as an opener the backend didn't report, is an `Option`, never `?:`, `undefined`, or `null`. Generated L0 wire types mirror the protocol's optional keys, and adapters convert them at the L0→L1 boundary.

**The fold.** The adapter's sink is L1's fold: one per connection, run in receive order before the adapter publishes the event, and the only writer of entity state. The first slice folds what its operations read, and the commands above:

| Fact | Folded into |
|---|---|
| `UserContextAdded`, `UserContextRemoved` | a context: its id, whether it is the default, its pages, its `closed`; removing it closes its pages |
| `PageAdded`, `NavigableRemoved` | a page: its id, its context, its status (`Opening{url}` until its first document commits, then `Open{url, document, prompt}`, then `Closed{reason, url}`), its `closed`, its input permit (§5), its event channels (§9), the scope that owns it; and for a popup whose opener the backend names, a `Popup` event on the opener, and its release added to the opener's scope (§3) |
| `NavigationStarted` | a popup's URL, from its first navigation, which its `Popup` event's filters read; where a page's own navigation was going, and a frame's |
| `FrameAdded`, `NavigableRemoved` for a frame | which page each frame belongs to, so its requests and console reach the page |
| `DocumentCommitted`, `DocumentUrlChanged`, `DocumentOpened`, `DocumentReadiness` | the page's active document: its id, URL, and readiness; the document it replaced ends with `DocumentReplaced` |
| `RealmAdded`, `RealmRemoved` | which document each window realm belongs to; which page and context each realm belongs to; a worker, its `BrowserWorker` event on its page and context, the page's and context's `workers`, and its end |
| `ErrorDocumentAttributed` | associates a previously observed error document with an already ended navigation; changes no current-document, readiness, or outcome state |
| `NavigationEnded` | a navigation's outcome, latched once; for a page's own navigation, a `PageNavigation` event with where it ended, and for a frame's too, naming the frame, which a subscription asks for with `frames: "all"` |
| `RequestSent`, `ResponseReceived`, `RequestFinished`, `RequestFailed` | the responses of navigation requests, so a committed navigation carries its response; each hop, bounded, with its request, response, and end, and `NetworkRequest` and `NetworkResponse` events on the initiator's page and context |
| `ConsoleMessage`, `UncaughtException` | events on the realm's page and context |
| `ConnectionOpened`, `ConnectionFrame`, `ConnectionClosed` | a connection: its `NetworkConnection` event, its frames, and its end |
| `DownloadStarted`, `DownloadProgress`, `DownloadEnded` | a download: its `Download` event on its page and context, and its status, which its context's end cancels |
| `ObligationOpened` for a prompt, `PromptClosed` | the page's prompt and a `Dialog` event; who decides it, chosen now: the page's latest handler or else the context's `dialogs` policy, its decision reported as an `AutoResolution` on the page and the context; and whether nothing will decide it (§5) |
| `ObligationOpened` for a file chooser | a `FileChooser` event on its page; who decides it, chosen now: the page's latest handler or else cancel, reported as an `AutoResolution` (§5) |
| `ObligationOpened` for a paused request | who decides it, chosen now: the routes that match it, the page's then the context's, the most recent first, or else continue (§6) |

A page is open from its first commit: `createPage` replies once the page is ready, so `PageReady` adds nothing yet. Connection loss ends everything with `ConnectionLost`. Frames' documents are folded too: each frame's parent and current document, which a frame locator resolves in, and `page.frames` shows.

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
  readonly pageKind: "tab" | "popup" | "prerender" | "fenced"   // fixed: how the page was created
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
    | { _tag: "UnattributedErrorPage" }                // observed before its navigation identity is known
    | { _tag: "ErrorPage"; navigation: NavigationId }   // H10: a failed navigation that still committed
    | { _tag: "Restored"; navigation: NavigationId; from: DocumentId }   // only with correlating evidence
    | { _tag: "Adopted" }                               // existed before we attached
  readonly state: SubscriptionRef<{
    navigable: NavigableId                              // fixed in current adapters
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
    navigable: NavigableId                              // fixed in current adapters
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
  | { _tag: "Activated"; document: DocumentId }       // prerender activation is not implemented
  | { _tag: "Download"; download: DownloadId }        // old document stays
  | { _tag: "NoContent"; status: 204 | 205; response: Option<ResponseRef> }   // old document stays
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
  readonly servedBy: "network" | "cache" | "serviceWorker" | "cacheOrServiceWorker" | "route" | "unknown"   // what answered
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
interface OperationRecord {                            // what Operation.Current holds; written through markSent, observe and bound
  readonly id: OperationId
  readonly state: Ref<{
    dispatch: { _tag: "NotSent" } | { _tag: "MayHaveBeenSent" } | { _tag: "Acknowledged"; result: "ok" | "rejected" }
    progress: ReadonlyArray<StepEvidence>               // per step, an operation run inside it: unsent | uncertain | ok | rejected
    observation: { _tag: "Pending" } | { _tag: "Observed"; value: unknown } | { _tag: "Unknown"; evidence: Evidence }
    caller: "waiting" | "completed" | "failed" | "interrupted"
    cleanup: { _tag: "NotNeeded" } | { _tag: "Pending" } | { _tag: "Completed" } | { _tag: "Failed"; cause: string }
  }>
}
type Readiness = { _tag: "Ready" } | { _tag: "NotReady"; predicate: Predicate; reason: NotReadyReason; observedAt: number }

type CloseReason =
  | BrowserClosed | BrowserCrashed | ConnectionLost | ModelUnavailable
  | UserContextRemoved | AccessReleased
  | PageClosed /* by: command | script | userContextRemoved */ | PageCrashed
  | ObligationEnded | DownloadEnded | HopEnded            // a dialog, file chooser or paused request; a download; a request hop
  | Vanished                                              // gone for a reason nothing reported
  | FrameDetached | DocumentReplaced | DocumentEvicted | DocumentDestroyed | DocumentUnloaded
  | RealmDestroyed
  | NetworkConnectionClosed                              // a WebSocket or EventSource the page or the server closed
// Each is a Schema.Error class with a `hint` (Target.PageClosed, ...). State holds the instances, and TargetGone carries the same one: nothing converts at the boundary.
```

## 3. Lifetimes, access, and cleanup

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
- **Access.** `observe` permits protocol events only. `inspect` adds isolated-world injection and reads: locators, readiness predicates, snapshots, screenshots, body reads. `control` adds input, navigation, main-world evaluation, declarations, and obligation decisions. Discovered resources start at `observe`, and upgrading never changes release policy. An upgrade is held by the `Scope` that acquired it; once that scope closes, the upgraded handle fails with `TargetGone{reason: AccessReleased}` rather than silently keeping its powers. A declaration whose physical effect reaches past its target needs explicit wider access, or fails with `NotPermitted`. Access is a library contract, not a browser security boundary. Creating an isolated world is not mutation, because page scripts can't see it. What `inspect` must never do is change visible page state: it never scrolls, focuses, or dispatches input. An element screenshot below the fold is captured beyond the viewport rather than by scrolling the user's tab; where a backend can't do that, it fails with `NotPermitted` and a hint.

  Built: a page the connection created, or one in a context it created, is controlled for its life; any other page is observed, and `inspect` and `control` acquire a grant held by the caller's scope. A released grant fails what it gave with `AccessReleased`, a `TargetGone` every member declares (QUIRKS.md, Q143), and removes the declarations made through it. Access is enforced at the handle: L0 has one level (QUIRKS.md, Q142).
- **Chromium `page.screenshot` is bound to its main document before geometry is read.** The adapter registers the binding in its event worker before L1 preparation and checks it again before native dispatch. A committed replacement while no earlier terminal native reply has been received invalidates capture with both document identities. The protocol reader records reply receipt before decoding; receive sequence resolves a reply against an earlier queued document commit. Same-document navigation and a provisional navigation that never commits do not replace the binding. Cleanup removes it on success, error, and interruption. This policy fails the caller promptly without canceling or repairing Chromium's outstanding command, retrying, waiting for destination load, or returning pixels from a new document. An immediate explicit replacement capture in the pinned Chromium 155.0.8059.79 regression returned the expected replacement pixels at 1100×1000; a subsequent capture still has no general recovery guarantee. This binding applies to `page.screenshot`; trace screenshot collection is outside this contract. Other backends and subframe-only changes retain their current contract.
- **Chromium screenshot preparation includes one renderer layout-metrics read.** It runs interruptibly inside the document binding and operation deadline for `page.screenshot`, and supplies existing full-page and CSS sizing. The renderer round trip waits behind tracked navigation processing and can update style/layout; a paused or slow renderer can consume the remaining budget before native screenshot dispatch. Observed events are drained and the binding checked before dispatch. A timeout retains the operation's existing `dispatchedUnconfirmed` phase. Cancellation prevents later dispatch, without canceling browser commands already sent. The read neither waits for load nor for an earlier screenshot, and supplies no atomic activation guarantee against a later navigation. Per-action and polled trace screenshots use the same adapter read and incur its renderer/layout cost, without acquiring the public screenshot document binding.
- **Chromium screencast acquisition uses the same renderer layout-metrics read.** After subscribing to frames and before sending start, it reads metrics once within the existing acquisition deadline. Renderer responsiveness and style/layout work consume that budget; a paused or slow renderer can exhaust it, and a metrics error fails acquisition before start. The read orders acquisition behind tracked navigation processing, without waiting for load or guaranteeing activation across another navigation or detach. Timeout hints remain `dispatchedUnconfirmed` even when start was never sent. Interruption prevents a late metrics reply from starting the screencast. The frame subscription belongs to the caller's scope. Native trace screencasts acquire the same capability and share this read.

- **WebKit video is explicitly polled.** Its layer takes `video: { polled: Duration.Input, directory: string }` and reads an optional `VideoWriter`; neither enables video alone. The interval is finite and positive, without a sampling default. The absolute writable directory already exists, stays caller-owned, and enables no downloads. The first viewport PNG is immediate, and each subsequent serial capture waits the configured delay after completion, also respecting writer backpressure. The shared writer path paces the latest image at 25fps on the browser clock, retaining the initial output dimensions for fitting. These repeated frames add no motion detail: transient states between samples may be missed, and polling competes with the page. Navigation replaces inspector targets without ending the recording; actual page/context/connection end is observed even when the writer is blocked, using the same five-second finish handling as Chromium.

- **Chromium screencasts share a session-wide stream.** Each acquisition reserves a consumer before its metrics read; a confirmed stream is reused without another native start. If an earlier owned start remains unconfirmed, Chromium's specific “Screencast is already active” reply can confirm joining that stream; other errors retain their mapping. Acquisition failure or caller scope closure releases that reservation. Closing the scope also interrupts an unfinished acquisition, including metrics or transport writing, before cleanup can be overtaken by a later start write. Scope closure and late successful starts cannot send stop while another consumer is acquiring or live. The last release stops a stream known to have started. An abandoned start releases its reservation promptly and immediately supplies uncertain-start cleanup evidence, unless a stop has already been attempted since that start; there is no grace interval or wait for its reply. Cleanup runs when no consumer remains, including when the start never replies. A success arriving during or after that cleanup can require another stop, still only when no consumer remains; it cannot confirm sharing if a stop was dispatched since that start. A known rejected start needs no stop; a rejection arriving after abandonment adds no cleanup, though uncertainty may already have caused a stop. Ended sessions receive no further stops. A new start waits for an in-flight stop exchange within its own acquisition deadline. Cleanup has a fresh one-second browser-clock budget covering the transport write and reply, independent of acquisition's deadline; rejection or missing confirmation is ignored. Transport work must honor interruption for that budget to bound waiting, and missing confirmation cannot prove that the remote stream ended. The session dispatches frames to its consumers and acknowledges each native frame once after all have taken it or released their scopes. A slow consumer backpressures frame delivery; joining an idle confirmed stream replays its latest image without another acknowledgement. Video uses this same source and acknowledges as its writer takes each image.
- **Release and cleanup groups.**
  - Created resources are `Owned`.
  - The default context and pages that existed at attach are `LeaveOpen`.
  - **Every acquisition requires a `Scope`, and that scope is the cleanup group.** This covers contexts, pages, access upgrades, handles, capability handles, and every declaration. Values with no remote lifetime (locators, snapshots, captured bodies) need none. An early `close` makes the finalizer a no-op.
  - **Seeing an event acquires nothing.** A popup of an owned page is released with the scope that acquired its opener, even if the opener has already closed; subscribing to it changes nothing. The model records the scope that acquired each owned page and adds a popup's release to it when the popup appears; a scope that has already closed closes the popup at once. A popup of a `LeaveOpen` page is `observe`/`LeaveOpen`. A download's file belongs to its context.
  - Transfer to another scope is explicit and atomic with respect to shutdown. Ambiguous opener evidence never implies ownership.
- **Ownership ledger.** The connection records owned resources, groups, and transfers. A persisted ledger yields *reclamation candidates* only. Automatic destructive reclaim across connections needs verified browser incarnation, resource identity, and claimant coordination, and is deferred.
  Built:
  - **Transfers:** `Model.transfer` moves a page's ownership to another scope, which then releases it, and a scope releases a page only while it still owns it. `CurrentSession.keep` is the first caller.
  - **The persisted ledger:** `Ledger.layer(directory)` keeps one record per program of the browsers it launched, each known by its profile directory, and the temporary directories it made, written as they come and go and removed when the program ends cleanly. `strider prune` lists what a dead program's record names, telling a reused process id by the process's start time, and reclaims it only with `--yes`.
  - **Not recorded:** contexts on an attached browser. Chromium's are disposed with their connection; Firefox's would need a new session to remove, which Firefox refuses while a dead program's lingers (QUIRKS.md, Q137).
- **Requesting a close is not ending a lifetime.** `close({ runBeforeUnload: true })` can be refused (`PageError{CloseCanceled}`), and the page stays usable. A backend that closes a page without asking it, stock WebKit's Automation, refuses the option (`close.runBeforeUnload`). A close timeout leaves closure unconfirmed rather than fabricating `PageClosed`. Teardown of owned resources uses a bounded close without beforeunload.
  Built: the prompt is decided as any dialog is, a handler's stay is the refusal, and an owned context's policy leaves. Browsers prompt only once the user has interacted with the page, so an untouched page closes at once (QUIRKS.md, Q150). An owned page's release is done when the page ends: its close is sent apart, in the model's scope, and runs to its own end, and the release waits once, for the end, under `Deadline.DefaultBudget` from when it starts, not the deadline of the operation whose scope it finalizes; a refused close ends the wait. Halfway through, a release still waiting logs a warning naming the page and whether the browser has answered the close; it warns again if it stops waiting with the page open. `close` sends its close apart the same way and is done once the page ends, whether or not the browser has answered; it fails with `Timeout` only when the page hasn't ended by its own deadline, and a refusal or a handler's stay still fails it. A context the library created is removed the same way when its scope closes: the backend answers the removal and reports the context's end once its pages' have come, and the removal waits once, for that end, under the same budget, warning halfway naming the context and whether the browser has answered or which of its pages haven't ended. A command that fails because its target or the connection is gone already ends a wait without a warning, and a target that has ended, as everything has once the connection is lost, isn't waited for.
- **Declaration cleanup and deadlines.** Removing a CDP declaration first removes its local registration, then reapplies the remaining settings in work owned by the connection, with its own cleanup budget. An ordinary operation waits for that work only within its own deadline; stopping that wait does not cancel the cleanup. Borrowed-context setup rollback explicitly waits for confirmation before returning to the previous model settings.
- **Lifetime signal and `within`.** Each object has a single-assignment `closed: Effect<CloseReason>`. `within(effect): Effect<A, E | TargetGone, R>` arbitrates completion against the end of the lifetime and delivers the typed reason; closing a `Scope` alone would only interrupt. Caller interruption remains interruption. Whichever of completion or end wins the race is recorded once.
- **Remote facts and model loss.** A remote close invalidates local bindings without sending another close. Permanent loss of observation ends lifetimes with `ConnectionLost` or `ModelUnavailable` without asserting remote destruction. A temporary quarantine fails current operations without completing `closed`, and resumes only after a verified resynchronization.
- **Suspension** (back/forward cache) is a domain state, not a scope operation. Explicit-ref operations fail fast; waits may opt in to resume within their deadline. Resuming never revives invalid handles.
- **Cleanup order.** Transport, ingestion, and obligation resolvers stay alive while owned resources tear down. The order is: stop new work, drain obligations within the cleanup budget, release declarations and owned resources in dependency order, then disconnect or close the owned process. Finalizers are bounded.

### Native virtual authenticators

Native virtual WebAuthn authenticators are acquired by a controlled page's `capability(Capability.VirtualAuthenticator)` into the caller's scope. Chromium's virtual environment belongs to the page's frame tree, survives navigation, and does not cover sibling pages or popups. L1 checks scope and access lifetime on every handle call; the adapter reserves one owner per page, releases a late creation, removes the authenticator, and disables the environment before allowing reacquisition. An overlapping acquisition fails rather than allowing one scope's cleanup to remove another's authenticator. Credential listing exports redacted private-key bytes; importing provisions a separate native store with its own counter. Firefox's current BiDi transport and stock WebKit refuse acquisition.

### Experimental claims and handoff

The experimental subpath gives session hosts opaque Schema claims for owned Chromium pages and non-default
contexts. A saved claim identifies the browser by its WebSocket GUID, a tab by its tab target, and a context by
its native context id; public ids remain connection-local and change on reconnect. A scoped control grant alone
does not permit claim issuance. Firefox, stock WebKit, and Chromium pipe connections without a WebSocket
identity refuse direct claims with a named `Unsupported` capability. A vanished target is `Gone`, and a claim
from another browser is `OtherBrowser`.

Only the experimental reclaimable-context constructor opts out of Chromium's `disposeOnDetach`; ordinary
contexts keep their existing disconnect and scope cleanup. Internal Chromium handoff closes the old scope and
its declarations, settling paused handlers, while leaving owned pages and reclaimable contexts open. Reclaim
acquires ownership for the new scope, which closes the page or removes the context on ordinary exit. Default
context control never gives removal ownership. Context settings are supplied again because they belong to the
old protocol sessions; routes and init scripts are declared again by the host. Page reclaim returns a scope-owned
page and a Schema report discriminated as `Observed` (with the dialogs actually observed) or `Unknown` (without
current dialog data or an inferred cause). Observation defaults to 1000 milliseconds, within the caller's deadline.
Only expiry of that observation bound permits Unknown success; caller deadline expiry stays `Timeout`, and
interruption stays interruption, without acquiring ownership. Unknown pages remain explicitly closeable and are
closed on scope exit, even while their protocol initialization is blocked. Ordinary actions retain their deadlines.
Context reclaim returns the context and per-page reports made before setup. Empty contexts and contexts whose
pages are all Observed receive normal setup, including the normal defaults when settings are omitted. With no
settings requested and at least one Unknown page, recovery adopts the whole context without session setup,
so the blocked page can be owned without touching its dialog. This fallback also affects healthy siblings and
future pages: there is no automatic dialog decision, unrouted HTTP challenge forwarding, file chooser
interception/cancellation, or managed temporary download directory with an allow declaration. The browser's
native behavior remains in place; normal setup is not restored automatically later. Per-page Observed reports do
not promise these omitted defaults in a mixed context. Any supplied settings, including local `dialogs` or
`eventLog`, are refused with `UserContext.reclaim.settings` before ownership changes when any page is Unknown.
Observation and last-known metadata options are not settings. Otherwise settings apply within the caller
deadline, and setup failure preserves the surviving targets.

Internal planned handoff captures the current model's dialog details before teardown as serializable `LastKnown`
snapshots bound to the exact page or context claim. A context snapshot aggregates its pages' historical events,
including pages without individual claims. The host explicitly supplies a snapshot on the matching reclaim; it remains separate
from the current observation report, never evidence that a dialog is still open. Empty last-known details do not
confirm a healthy current page. Current prompt data is retained independently of the configurable event log.
Reclaim never dismisses a dialog to make observation succeed. Planned Chromium handoff is different: after caller
handlers have their normal opportunity to answer, the page's release finalizer dismisses residual dialogs through
the original session before context declarations are removed. It never automatically accepts, even with an accept
policy or for beforeunload. A caller handler may still accept normally. Dismissal has a separate 1000 ms budget;
failure or expiry records `Unknown` and does not fail scope closure. Confirmed command reply and dialog closure
produce typed `DialogDismissed { kind, message }` events in the separate handoff report. Historical events never
stand for the next connection's present state. `Complete` means the release-time dismissal loop completed; it
cannot rule out a dialog opened later during teardown. Each handoff declaration release has a separate 1000 ms
confirmation budget. Unconfirmed release retains its warning and makes the handoff report Unknown, preserving
any already-confirmed dismissal events; it does not fail scope closure. A bounded release may stop before
restoring every healthy sibling, especially if the old connection stays open; Unknown does not promise restored
settings. Handoff returns recovery snapshots only for issued page or context claims; unclaimed pages have no
recovery record. Dismissing a navigation's beforeunload prompt cancels the navigation
and preserves the tab and original document. A killed client runs no handoff finalizer: crash reclaim stays
observational and can return Unknown. Leases, expiry, and host adoption are separate; persistent
contexts must not be enabled by a host until expiry cleanup is available.

## 4. Documents, realms, and navigation

- **Document lifecycle.** `Active ⇄ Suspended` (back/forward cache, only with confirmed evidence) and `→ Ended{reason}`.
  - No backend built confirms a suspension. Chromium and Firefox restores are recorded as new documents, `createdBy: Restored{from}`, after the old one ended, and WebKit keeps no back/forward cache. So every restore is a new epoch, the second branch below, and `Suspended` stays in the model for a backend that can confirm it.
  - Readiness events are accepted only for the matching epoch and generation.
  - `document.open()` keeps the epoch, starts a new generation, and returns readiness to `loading`.
  - A restored document gets the same id only when the adapter can correlate it; otherwise the old epoch ends with `DocumentUnloaded` and the new one is `createdBy: Restored{from}`.
  - Node and handle continuity are proven separately from document continuity.
  - Current adapters do not implement prerender activation or document and realm transfer between pages.
- **Frames.** A frame is created synchronously, before any protocol notification arrives. It ends on container removal, or when its parent's document permanently ends; the adapter closes orphans itself because HTML never fires an event for them. A frame keeps its identity across process swaps; only its adapter session changes.
  Stock WebKit confirms every newly established pairing between an Automation child-frame handle and an inspector frame with a temporary window mark (QUIRKS.md, Q228). Time-origin and URL fingerprints cannot prove identity or exclude a candidate: even a unique match can belong to a sibling. Both lookup directions continue past a candidate whose mark does not match, and reject a removed frame or a document replaced during confirmation or cleanup. Established handle caching is retained. Each new pairing requires extra protocol commands, and page scripts can briefly see the mark even when fingerprints would have matched uniquely. The mark is removed after the check, including a failed or interrupted check.
- **Realms and worlds.**
  - **Kinds:** window (main or isolated world), workers (dedicated, shared, and service), and worklets. The kind is an open union.
  - **The library's own code** runs in a utility isolated world wherever one exists. Stock WebKit has none, and says so as a capability: there the engine, the trace capture, and the library's own reads run in the page's world, and a caller's `evaluate` is refused rather than moved there (QUIRKS.md, Q194).
  - **Two discovery strategies, chosen per context:**
    - **Tracked:** realm events folded into state.
    - **OnDemand:** no `Runtime.enable`; realms acquired when needed and validated on use. It has no observable realm set and no console capture, and these are absent from the types rather than failing.
  - **During a pending navigation** the active realm stays usable. A prospective replacement is tracked separately, so a canceled navigation, a 204, or a download never strands the page.
  - **Evaluation** is bounded by `within`, fails fast on known suspension or confirmed prompt blocking, and may request user activation.
  - **A starting dedicated worker** on Chromium: its realm is added as soon as Chromium reports its context, which can be before the worker's script has loaded. An evaluation sent in that window can crash the renderer or go unanswered, so the adapter holds evaluations in a dedicated worker it caught starting until `Inspector.workerScriptLoaded`, or, for a worker that gets init scripts, where that event can't be relied on, also once they have run and the worker has resumed. The worker's end releases the hold, and the evaluation then fails with the realm's end; the wait runs within the evaluation's deadline. Handing out the worker doesn't wait.
- **Values, handles, and channels.**
  - Evaluation transfers values by default. Handles are opt-in, owned by the caller's scope, and released in batches unless the realm already died.
    Built: a scope's handles in a realm are one object group, released in one command as the scope closes (QUIRKS.md, Q132).
  - Node results become `NodeRef`s bound to the current epoch and generation.
  - Channels carry page-to-driver messages as typed streams; they are the transport for in-page observers.
- **Navigation outcomes.** An outcome is reported only with affirmative evidence; otherwise the navigation stays `unresolved` and waiting callers get `Timeout{phase: postcondition}`.
  - `Superseded` needs proof that the navigation was replaced.
  - A `historyUpdated` event with no attribution does not finish a pending navigation.
  - Silence never means `Canceled` or `NoOp`.
  - A failure after a successful commit is a loading result of the document; the commit outcome is not revised. No backend reports one yet, so a document's `loading` isn't observed.
  - An error page belongs to its failed navigation, never a new navigation that supersedes one started since. When ownership is known at observation, its commit says `createdBy: ErrorPage{navigation}`. When an outstanding command reply could still establish ownership, its document is observed immediately with `createdBy: UnattributedErrorPage`; identified lifecycle events, requests, and downloads continue in receive order. Unknown attribution does not make a real error document stale, and it never consumes a live reservation by URL.
  - Eventual attribution names the original document. A pending navigation ends once with `Failed.errorDocument: Some(document)` when its command reply identifies that error. If its `Failed` outcome was already published without a document, `ErrorDocumentAttributed{document, navigation}` supplies the relationship separately. Facts remain immutable. Neither relationship commits the document again, revives an ended document, changes the current document, resets readiness, or changes prompts, frames, or realm membership. If no reply establishes identity, attribution can remain unknown; intended-URL matching is restricted to the retained completed failure, never a live reservation.
  - Deferred correlation lasts only while outstanding commands can establish identity. Completion, rejection, and interruption resolve or release it; page removal clears it and reply bindings. Ended identities needed by those commands are released after correlation completes. The last failure without an error document is retained until its error arrives, a normal commit with no outstanding correlation supersedes it, or the navigable closes.
  - Navigations observed during an action are correlated, not proven caused by it.
  - Browsing-context-group switches are reported as `Confirmed | Suspected | Unknown`.
- **Projection for callers** (API.md):
  - **Success:** `Committed`, `SameDocument`, `Restored`, `Activated`. An HTTP 404/500 document is a successful commit.
  - **`back`/`forward`:** `NoOp{noHistoryEntry}` becomes `None`.
  - **Failure:** everything else becomes `PageError` with a navigation reason (`NavigationFailed`, `NavigationCanceled`, `NavigationSuperseded`, `BecameDownload`, `NoContent`). `BecameDownload` and `NoContent` count as failures unless the call accepts them.
  - **Accepted outcomes** (built): `goto({ accept })` returns a download as `BecameDownload{id, url}` and a 204 or 205 as `NoContent{id, url, response}`, variants of `PageNavigation` that nothing else returns.
  - **`waitUntil`:** a navigation resolves at commit. `domContentLoaded` or `load`, when asked for, waits on the resulting document and generation within the same deadline.

## 5. Input and obligations

- **Input fidelity is a backend property:** `native` (CDP, and stock WebKit launched, through its Automation protocol) or `webdriver` (BiDi). Attached stock WebKit has no input: its inspector has no `Input` domain, and the library refuses input there (`input.native`, `Unsupported`, nothing sent) rather than dispatch untrusted events that stand in for it; a page's own script can dispatch them with `evaluateInMainWorld`.
- **Input state** is kept per page: pressed keys and buttons, pointer position, and an undo list. Input to one page is serialized, and acquiring the permit consumes the operation deadline. Actionability is checked again after acquiring the permit.
  - **L1 keeps it, and every gesture is built from it.** The keys held, in the order they were pressed, the buttons held, and the pointer's position are L1's, and the adapters keep none of their own: every mouse event carries the buttons held, so moves with a button down are a drag on every backend.
  - **Modifiers are keys.** A gesture with modifiers presses the ones not already held before it and releases them after, in the same dispatch, and also sets the events' flags, which Firefox ignores. Shift changes the key a press sends (`a` becomes `A`), and Control, Alt, or Meta make it a shortcut with no text. WebKit's mouse events ignore modifiers either way, which the capability `input.pointerModifiers` says.
  - **The undo list is the held keys and buttons,** each released by the scope that held it.
- **Actions.** An action's checks run in the page, starting with an immediate sample when stability is required or the rendered check is off, and then following native rendering updates; a timer would be a cadence nobody chose. An attempt is one evaluation in the engine (§8, Queries) that resolves the locator and checks it until the checks pass or the round's cap runs out: the first readiness round returns early only when its first sample, taken after a rendering update when Rendered requires one, observes a blocker; a sample that only takes the stability baseline keeps waiting in the same round. An incomplete stability baseline adds no failure history; observed blockers and established instability do. Subsequent rounds wait with a 1000 ms cap when more than 1000 ms remains, otherwise half the remaining deadline.
  1. **Resolve.** No match is `NotReady{NoMatch}`; two or more fail at once with `StrictViolation`.
  2. **Check**, in §8's order: the action variant of Visible (ignoring opacity), Enabled, NotInert, InViewport (a nonempty client rectangle survives viewport and parent-frame clipping; if none does, scrolling once per attempt when permitted, centred for a box that fits and aligned at its start for an oversized box), Stable (the rect unchanged across *k* rendering updates, 2 by default), and ReceivesPointer at the action point. Stability starts with a rectangle sampled immediately, followed by *k* native rendering updates; a changed rectangle or a replacement element starts its observation over. The independent Rendered check waits for a rendering update before the first check when stability is off. It defaults on for pointer actions and off for other actions; stability still requires its requested updates either way. A round that sees no frame at all reports `NoRenderingOpportunity` only when Rendered is enabled. Otherwise it retains the current-layout reason it observed.
  3. **Act.** Ready, L1 takes the page's input permit, checks again under it, and dispatches the action's gesture at the action point: the first reachable client-rectangle centre after viewport and parent-frame clipping, or an explicit `position` from the padding box's top left, in viewport CSS pixels. A click, check, or uncheck that acquires the permit without queuing can reuse its stability observation through a single-use engine token, only before the next rendering update and only if the resolved element, rectangle, and requested frame count still match. Another action attempt invalidates the token; a queued action or invalid token takes fresh stability samples. All other checks still run under the permit. Acting check and uncheck retain their initial checked-state read and confirm the result after input; an already-correct state returns after the initial read. When a label association supplies the checked-state source and input is needed, Enabled applies to both that source and the selected pointer target. Each readiness pass resolves the current source again, including under the input permit, using the same native, fieldset and ARIA-disabled predicate. A persistently disabled source times out with Disabled evidence without dispatch. The explicit enabled-check override and trial behavior apply as usual. When `receivesPointer` is enabled, centres are hit-tested in rectangle order until one reaches the target or a descendant and its iframe in every parent document, so an uncovered later line can be chosen over a covered first line. If none reaches it locally, the first geometric centre retains the local `Covered` result; if all locally reachable centres are covered in parents, L1 retains the first parent `Covered` result. Candidate lists are produced anew for each check, including under the input permit. Disabling `receivesPointer` uses the first geometric centre without coverage probes. Explicit positions are never substituted. The viewport check scrolls only when no geometric fragment remains, independently of coverage. A default point is adjusted inward if integer rounding would leave the rectangle and an integer coordinate fits. A target with no remaining rectangle has no default point, even with all checks disabled: it waits and fails with `Timeout` if it never acquires one. Explicit offsets retain their padding-box origin. For a click the gesture is the pointer move, down, and up; each action's is in API.md (Locators). A pointer gesture is guarded (§8, ReceivesPointer): the check under the permit arms the guard, and after the dispatch L1 asks whether it stopped the gesture, in which case the action goes back to checking, its history saying `Covered`. From the first input event the dispatch may have been sent, and the gesture is not replayed unless the guard proves the page's handlers never saw it. A failed gesture may still release its possibly held input (Compensation, below). `trial` stops after the check under the permit. Actions that need no input (`focus`, `scrollIntoView`, `selectOption`, and `fill` on an input whose value isn't typed) do their work in the utility world in that same check.
  4. **Fail** at the deadline with `Timeout{phase}`, carrying the last `NotReady`, its de-duplicated history, and a hint that explains it, so the error says what stands in the way: "Another element covers the element's action point: div.toast "Saved"". The phase is `waitingForCondition`, or `resolving` when nothing ever matched.

  Built: the guard, modifiers, the actions besides `click`, and coordinates in child frames. An action resolves its frames' iframes on each attempt (§8, Queries), scrolling each into view in its parent, since Chromium renders nothing in a cross-site frame outside the viewport. L1 obtains each iframe's visible content bounds from the engine in its parent document, outermost first, and passes their intersection to the child engine in child viewport coordinates. This uses the same protocol routing across origins and processes. The engine supplies locally reachable candidates within those bounds and its viewport when pointer checks are enabled; L1 adds each iframe's content-box origin, innermost first, and tries candidates in order until ReceivesPointer also passes in every parent document. Input names the frame and its origin: CDP and WebKit send page coordinates, which reach every frame, and BiDi sends the frame's own coordinates to the frame's context, since Firefox doesn't deliver page coordinates into a cross-site frame. The guard is armed and disarmed in the frame's document.
- **Compensation.** On interruption or scope close, owned pressed inputs are released in reverse order. This is bounded and best-effort, and records failures. Input state that might be inconsistent blocks further gestures until it is reset. Built: `keyboard.hold` and `mouse.hold` release in their scope's finalizer, once however often `release` runs; a release that fails on a live page records why, and the next gesture sends it again first, runs if it gets through, and fails with `BackendFailure` naming it if not, so only a release that fails twice leaves the state unknown (QUIRKS.md, Q84). A release on a page that is gone succeeds, since the page took its input with it.
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
  - **A dialog's kind is the browser's to say.** Stock WebKit's Automation says a dialog is open and what it says, not whether it is an alert, a confirm, a prompt, or a `beforeunload`, so there a dialog is `Unknown`: accepting it answers as its OK button would, dismissing it as its Cancel button, and text answers only a prompt (QUIRKS.md, Q206); the capability `prompts.kind` says so. It is found by asking every 100 ms, which the page can't see, and after each input, which returns once the dialog it opened is decided, as on every backend (Q224).
  - **Handlers.** The page's latest `Dialog.handle` decides, chosen when the fold folds the dialog's opening, so one registered before it opened decides it and one registered after doesn't (§2, One writer): the chain is one handler, since `Dialog` has no fallthrough. It runs in its registration's scope with `Deadline.DefaultBudget`, as read at `handle`; failing, being interrupted, or running out of time leaves the dialog to the policy, and the failure is logged. A resolver in the model's scope delivers whichever decision comes, apart from the handler's fiber.
  - **What a dialog blocks** (probed). Chromium and WebKit block every evaluation, in every world, while a dialog is open, and Firefox doesn't; on all three, the input that opens a dialog returns only once it is decided. When nothing will decide a dialog (no handler when it opened, and a `"leaveOpen"` policy), every operation on its page fails at once with `PromptBlocking{kind, text}`, including the input that opened it, whose dispatch `MayHaveBeenSent`.
- **File chooser.** It does not pause the page. It is armed before the triggering input, and its default is `Cancel`.
  - **Armed for every page of an owned context**, so every chooser is reported and decided and none is shown. Stock WebKit reports none: its Automation cancels a chooser it wasn't given files for, so a context there arms nothing, and `setInputFiles` sets an input's files directly (QUIRKS.md, Q220). The page's latest `FileChooser.handle` decides, as for dialogs; failing, being interrupted, or running out of time cancels it, reported as an `AutoResolution`. A chooser in a context the library didn't create is left as the browser has it.
  - **What each backend does** (probed). With interception, Chromium and WebKit fire nothing on the input for `Cancel`, and `input` and `change` for files set. Firefox reports every chooser, and with `unhandledPromptBehavior.file: "ignore"` a canceled one stays open, so the page's later clicks open nothing; with `"dismiss"`, which the adapter sets, the input gets `cancel` as it opens and files set after it still arrive.
- **Obligation lifecycle.** States are `pending → decisionSelected → sending → acknowledged | rejected | unknown`, plus `ended`.
  - **One winner.** An atomic transition selects at most one decision.
  - **Handler chain.** The chain is snapshotted when the obligation arrives and ordered by the precedence rule (§7). Only the current handler holds a decision token. `Fallthrough` passes a new token on.
  - **One budget.** A total resolution deadline covers the whole chain.
  - **Fallback.** Failure, interruption, scope exit, returning without a decision, or the deadline applies the phase-specific fallback, but only while the obligation is still pending.
  - **Delivery.** A selected decision is delivered by a resolver independent of the handler fiber.
  - **No contradictions.** A timeout or disconnect after sending records `unknown` and never sends a contradictory fallback.

## 6. Network

A new context may carry a normalized HTTP proxy endpoint, a bypass host list (default empty), and optional
credentials with a Redacted password. An omitted proxy leaves browser settings untouched. CDP and BiDi set the
endpoint per user context; launched stock WebKit sets HTTP/HTTPS proxy environment variables on that context's
process, overriding inherited proxy variables without changing the parent environment. Localhost, 127.0.0.1, and
::1 remain direct, including control connections; bypass hosts otherwise follow the backend's native host rules.
Unsupported endpoint schemes, WebKit credentials, and settings for an existing WebKit process are explicit refusals.

Context HTTP credentials install a context-owned auth route before user routes and an auth-phase intercept only
when configured, following [Pay for what you use](docs/decisions.md#pay-for-what-you-use). Page routes and later
context routes retain precedence; fallthrough reaches the configured pair, while cancellation or handler failure
keeps the existing default. An optional HTTP(S) origin compares normalized scheme, hostname, and effective port.
Only website challenges receive this pair: CDP supplies the challenge source, and BiDi combines status, authentication headers, challenge metadata, and this request's proxy-attempt evidence. Conflicting or inconclusive evidence receives neither automatic pair; a stale
407 is accepted as website evidence only after this request's proxy attempt, with a website header, no proxy
header, and an explicitly empty challenge list. Passwords remain redacted until answering the
protocol obligation. Automatic decisions are bounded to one credential submission across a native request and its whole redirect chain, even across origins; attempt
state lives in the backend's existing request/auth ledger and ends with that request. Unconfigured requests gain no
attempt state or interception. Stock WebKit refuses the option through its auth interception capability.

Automatic proxy authentication participates in native interception without replacing route declarations. CDP
requires a Proxy source and matching endpoint origin; BiDi requires a 407 with a matching proxy challenge, a Proxy-Authenticate header, and no conflicting
WWW-Authenticate header.
Configured credentials are submitted at most once per request, then canceled if challenged again. Website
challenges continue through the ordinary obligations and auth routes; Firefox's missing challenge fields are read
from WWW-Authenticate, never inferred from its potentially stale 407 status. Attempt state is removed when requests
finish or their owner ends. Firefox's native proxy auth cache spans user contexts: a connection reserves each proxy
endpoint's credentials (including none) before yielding. Each creation owns a share: a confirmed pre-creation
rejection or confirmed unused rollback releases only its share. Another pending creation, prior successful context,
observed navigable, or uncertain remote outcome retains the binding. Conflicting configurations are refused. Configured
credentials on an attached Firefox are refused because the pre-existing cache is unowned. Retained bindings survive
later context cleanup; interceptor and request state do not.


- **Requests and hops.** A request id spans the redirect chain. Each hop has its own identity, snapshot, response, and body access, so a held 302 never becomes the next hop's 200. Snapshots record explicitly when information (such as CDP's extra-info events) is missing.
  Built: a hop also keeps the headers as the network sent and received them where the backend reports them apart (CDP's `ExtraInfo`, with `Cookie` and `Set-Cookie`), and the time its end was reported; recordings read them, and the request and response events keep the headers their own events gave (QUIRKS.md, Q158).
  Request subscriptions with a body decoder declare request collection for their page or context in their scope. A matching event starts a native read without waiting for the response; each subscriber enforces its own limit and owns its decoded result. Adapter reads distinguish absent, bytes, native reported text, incomplete, over-limit, and unavailable reports, separately from legacy recording reads. Stock WebKit refuses both empty and missing native text because neither establishes absence or completeness; Chromium refuses empty fallback data while preserving complete carried empty bytes. Native request identifiers reused across redirects are checked before and after asynchronous reads; ambiguous hop data is refused. No body decoder leaves the plain event path unchanged, following [Pay for what you use](docs/decisions.md#pay-for-what-you-use).

  A hop knows when its headers as sent are settled, with its first attributable report, its end (including failure or cancellation), eviction, or loss of its owning frame (including removal of an ancestor), worker, context, page, or browser connection. `NetworkRequest.headersSent` waits within the operation's deadline for that settlement, then returns the available sent headers or the request event's headers when none were reported. Owner removal settles only the affected header waits without fabricating a network failure for detached requests. Eviction releases existing waiters; new lookups use the immutable snapshot.
  CDP queues early `ExtraInfo` in a request's `ahead` list and records outstanding expectations by hop and phase in `owed`. An arriving header report satisfies the earliest expectation for its phase, or waits in `ahead` until its hop is known. `redirectHasExtraInfo` determines whether the hop ending in a redirect expects both phases; when it expects none, the request event's headers are used without consuming the queued reports. For a final network response, `hasExtraInfo: true` registers both expectations and holds the response until its extra headers arrive. A final response from a cache, service worker, or route does not wait, even if `hasExtraInfo` is true; it uses the request event's headers if sent headers have not already been reported. A final failure leaves the last hop eligible for late request headers, with earlier redirect expectations taking precedence. Attributable late headers update the retained model and adapter feed without reopening settled waits or promising to rewrite flushed recordings. Retention remains bounded. BiDi reports sent headers from the request event; WebKit with the response (Q181).
  On Chromium, awaiting definitive headers before allowing the same response to proceed waits until the deadline; the immediate request snapshot remains available with possible omissions such as `Cookie`. A hop's request body is read by hop, kept where a body collection for requests covers the page.
- **Request lifecycle.** `Sent → ResponseStarted → Completed | Failed`.
  - A service-worker response can start without `Sent`.
  - Requests of a destroyed document may never terminate. They are tracked as detached, and no network failure is fabricated for them.
  - The adapter keeps raw facts per request and emits each model event once its prerequisites are present.
- **Interception** is a declaration plus a stream of obligations.
  - Backend enablement is reconciled from the union of active patterns, and is never disabled while a request is paused.
  - Decisions depend on the phase:
    - **request:** `Continue{overrides} | Fulfill | Fail`;
    - **response:** only the decisions the backend supports; `ContinueResponse{status, headers}` on CDP and BiDi;
    - **auth:** `ProvideCredentials | DefaultAuth | CancelAuth`.
  - Defaults are continue for request and response, and `DefaultAuth` for auth.
  - BiDi cannot scope intercepts to a user context, so emulating that needs browser-wide access (§3).
  - **Built.** A route is a handler of paused requests at one phase, registered as a dialog's handler is (§5), and asked in precedence order: the page's routes, then its context's, the most recent first, until one decides; `fallthrough` asks the next. A route declares an intercept wide enough for its pattern and matches the pattern itself. The default is continue, and at an authentication challenge `CancelAuth`, the challenge's response, not `DefaultAuth`, the browser's prompt, which waits forever headless on Firefox. Every context the library creates declares `Challenges` where the backend can pause one (`network.challenges`), so a challenge no route matches is paused too and gets `CancelAuth`: on Chromium a document's, on Firefox every one, on stock WebKit none (QUIRKS.md, Q252). A challenge in a context the library didn't create is left as the browser has it, as a file chooser there is. When every matching route fell through or failed, or the backend refused a decision, the default is published as an automatic decision. A refused decision never leaves the request paused. Each paused request's body is readable on every backend (BiDi needs a request data collector, declared with each request-phase intercept); a paused response's only on CDP.
  - **Route activation.** A route is in force for requests that start after its declaration returns. On Chromium, a request already underway without response interception may not pick up a later response route, even before its headers arrive: interception stages are selected when the request starts. An existing response pause selects the current routes by precedence.
  - **Chromium's interceptor is kept installed** (QUIRKS.md Q46). The CDP adapter enables `Fetch` for every page from its start and never disables it. In contexts the library creates, default challenge handling installs a wildcard Document Request pattern with `handleAuthRequests: true`, even without user routes. Proxy credentials and routes add their required patterns. Only when there are no interception consumers does it use a nonempty pattern no request matches, including in contexts the library did not create without routes or proxy credentials. Declaring an intercept on a live page updates the installed patterns; it does not add response interception retroactively to requests already underway. A Document-only pattern still installs Chromium's proxy for subresource factories; the unmatched fallback also retains that proxy.
- **Bodies.** A body may be unavailable for a stated reason: not collected, evicted, a redirect, streaming, over a limit, or a request that failed after its response started.
  - **A collection names its bodies**: requests', responses', or both. A HAR collects requests' always, and responses' unless it omits content; a response subscription collects responses'.
  - **Collected for a subscription**: up to `NetworkResponse.BodyLimit`, declared in its scope. A body is read once its hop has ended; a redirect hop has none, without asking the browser.
  - A `body` in a `next` or `stream` filter acquires collection before that call returns; BiDi needs a collector before the request starts.
  - Ordinary results are owned bytes. Large or streaming bodies use explicit caller-scoped leases.
- **Service workers.** Interception may see a request twice or never. Bypassing service workers is a capability.
- **Long-lived connections.** WebSocket and EventSource connections are modelled. Observing frames and mocking them are separate capabilities.

## 7. Declarations

Declarations are init scripts, HTTP and WebSocket routes, overrides, emulation, download and prompt policies, data collectors, and page clocks. All are identified registrations with scoped lifetimes.

- **Installation.**
  - Installation is acknowledged, or acquisition fails.
  - A declaration states the timing it needs (`beforeAuthorScript | bestEffort`). An unmet requirement fails with `Unsupported`; it never silently degrades.
  - Declarations stay within the target's access scope.
  - Attaching to a running page cannot precede scripts that already ran.
  - A target is published as ready only after its required setup succeeds. Optional setup failures appear as unavailable capabilities.
- **Precedence** for settings and handlers: scope specificity first (Page, then Context, then Browser; the API declares nothing on a frame, so Frame joins when a declaration needs it), then explicit priority, then recency. Releasing any registration recomputes the effective state, including when fibers finish out of order. On CDP, releasing the last viewport override clears the emulation and waits for the original renderer dimensions, under a fresh cleanup deadline on the browser clock. Releasing an override while another remains applies the current effective override. On BiDi, viewport defaults are set per user context for future pages; broader writes then restore existing page overrides from the declaration registry. New user contexts receive the browser default without rewriting existing contexts. BiDi viewport release skips closing pages and removing contexts, and gives each remaining context/page its own five-second cleanup budget on the browser clock, detached from the expired operation. Failed or interrupted removal/close resets its lifecycle flag and reconciles surviving resources from the current registry, with the same per-target budgets and diagnostics; an ended transport skips recovery writes. Release and recovery work belong to the connection: an active operation's deadline bounds its wait, and stopping that wait marks cleanup unconfirmed while native cleanup continues. Outside an operation, or when confirmation is explicitly required, release waits for cleanup. A rejected or timed-out cleanup warns and marks restoration unconfirmed without stopping other targets; an ended session is quiet. Failed or interrupted viewport initialization attempts context removal under a separate five-second cleanup budget while preserving the original failure. Confirmed removal ends its pages and context in the model; unconfirmed removal retains the known context and warns rather than claiming it ended. Restoration holds unless cleanup logs a warning: an unknown original size, a deadline, or unexpected protocol failure warns without failing the scope; an ended session is quiet. Each target is cleaned up independently. On CDP, a context the library created and removes as its scope closes skips releasing its own file chooser, challenge and credential declarations: the removal follows, so their commands would only add round trips. A context handed off or not yet committed keeps them. If the browser refuses the removal, the context's interception and file chooser are reconciled with the declarations that remain, each target and each reset on its own, so one that fails warns and leaves the others to run.
- **WebSocket routes** replace the main-world constructor only with explicit script consent. A registration
  selects future constructions once, newest matching registration first, across existing documents and future
  pages/frames. Existing sockets and saved constructors remain native. A mock opens explicitly; a proxy opens the
  saved native constructor in the originating realm. Directional handlers are fixed before open: absent proxy
  handlers forward, installed handlers send explicitly or drop. Passive event streams never change forwarding.
  Every connection has a registration-owned child scope; handler failure closes rather than contacting a server.
  Admission includes unused issued credit, queued payload, and pending Blob conversions, across realms. The
  registration keeps a counted 2 MiB host-send pool, leaving 14 MiB for 1 MiB page credits and an additional
  1 MiB server credit only for proxies. Thus mocks + 2 * proxies <= 14; host completion/cancellation returns its
  credit exactly once. The realm spends preauthorized credit synchronously before snapshotting mutable
  data. A drained surrender or confirmed realm destruction reclaims them exactly once. See `WebSocketRoute` for
  all ceilings and the guide for the conservative allocation policy. Removing a registration closes its sockets,
  drains conversion work, removes future scripts, and restores only the constructor still owned by its shim.
- **Init scripts** form an ordered bundle per world and revision. Built as below, with what the probes found on every backend: a script runs before `document.documentElement` exists, in every frame, and a throw is reported as the page's uncaught exception.
  - **Phases.** A reserved *environment phase* (library shims such as the page clock) runs before user scripts.
  - **Order.** Within a phase, array order applies, then explicit `after` dependencies, then registration sequence.
  - **Dependencies** may point only to registrations of equal or broader scope, so they always outlive the dependent. Invalid edges fail at acquisition. Built: the order above already puts a dependency first, so a dependency only gates: L0 runs a script only if each script it comes after ran in that document without throwing, which also stops it once its dependency is removed. Each bundle is one block statement, so its bookkeeping is hidden while a script's top-level declarations stay global; Firefox's preload scripts are functions, one per script, which keep what ran under a symbol, and their top-level declarations aren't global.
  - **Execution.** A bundle runs once per document and world, and a content reset does not replay it. Required failures stop dependents and are reported. Executed effects are never rolled back.
  - **Removal** affects future documents only.
  - **Workers.** A main-world script declared for workers also runs in the scope's dedicated workers started from then on, before their own script, in the same order; it may depend only on scripts that run there too. Built on CDP and WebKit, where a new worker waits for the adapter; WebDriver BiDi's preload scripts reach documents only.
- **Overrides.**
  - **Application.** Updates are serialized at the backend's physical scope. Desired and acknowledged revisions are tracked separately, and a failed apply never returns success.
  - **Exclusive use.** Exclusive use needs a lease; conflicting writers wait or get `OverrideConflict`.
  - **Restoration.** It is promised only when the previous value is known, restoration is supported, and access permits it. Attached sessions never reset an external user's settings.
- **Page time.** Application time is one timeline per scope: page by default, context optionally. Built as a shim of the library's, since no backend has an application clock: an environment-phase, main-world init script that replaces `Date`, `performance.now`, and in controlled mode the timers and animation frames, driven by evaluation in each document's main world. The replay log reduces to the timeline's state (its mode, and its wall time or offset), declared again with each operation under a higher version, so a document given two states keeps the newer. One timeline covers a page: a page's clock and its context's can't both be installed.
  - **Modes:** `fixed` (wall time frozen, timers live), `offset`, `controlled` (wall time, monotonic time, timers, and animation frames driven explicitly), and `virtual` (a backend scheduler, as a capability).
  - **Replay.** Every operation is appended to a log that each new document and frame in scope replays, so the timeline survives navigation and covers same-origin frames. Workers are explicit opt-in. Built: `install(mode, { workers: true })`, whose operations reach the current dedicated workers as they reach documents.
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
    `topLevelSite` is the common core: CDP's cookie `partitionKey`, Firefox's `originAttributes`, and BiDi's `storage.PartitionKey` all carry it. `crossSiteAncestor` is an `Option` because only Chromium reports it. Backend-specific detail, such as Chromium's nonces for anonymous iframes, goes in `vendor` and round-trips within the same backend only.
  - **`StorageState`.** It is portable into fresh contexts. Source context is provenance, not a restriction. Mismatched opaque partitions fail the new context with `UserContextError{Incompatible}`, and partial restores are reported.
  - **Export and import.** Export is an explicit, versioned codec to `Redacted<Uint8Array>`, and import validates it. Diagnostic JSON is never a persistence format.
  - **Built** as JSON text through `StorageState.Json`. Export reads the cookies, and each origin of a document open in the context's pages and frames from the isolated world: `localStorage` and every IndexedDB database, records in a JSON-safe encoding of the library's. A frame whose site isn't its page's is that page's top-level site's partition. Import sets the cookies, then writes each origin from a page of the new context whose documents a route fulfills, a partitioned origin from a frame of a page at its top-level site, all before the context is returned. A site is approximated without the public suffix list (QUIRKS.md). Partial restores aren't reported: a restore that fails fails the context, which is removed. A partitioned origin also records the top-level origin it was read under, and is written from a page there, since stock WebKit keys a partition by that origin, port included (QUIRKS.md, Q232).
- **Permissions** are scoped to a user context and combined (AND) with Permissions Policy.

## 8. Queries and readiness predicates

### Queries

A locator is data: a list of steps (a query, then `filter`, `and`, `or`, `nth`) that one engine of ours interprets, the same on every backend. So a locator means the same thing in every browser, and a test of it on one backend speaks for all three. The engine is a self-contained function in our source, installed in each document's utility world on first use, as WebKit's evaluation helper is, and sent requests as JSON. It isn't the browser's accessibility tree: the three engines' trees differ at the edges, WebKit's protocol can't query its tree, and an action needs the element in the utility world anyway to check it. When a request's document ends under it, the request goes again to the page's new document, within the deadline; a request that only reads is sent again safely; one that applies input in its own round (a fill, a select, a focus) is not replayed once it may have been applied, and its answer says whether it was. Where it is installed is a `Cache` the runtime keeps per document: concurrent requests to one document share one install, which runs apart from the operation that asked first while each waits until its own deadline; a failed install isn't kept, and a request that finds the realm gone or the engine missing invalidates the entry and installs again. Its answers are decoded with a schema, never cast: where the engine shares the page's world (stock WebKit), a page's script can answer in its place, and an answer the engine doesn't give fails as `BackendFailure{IncompatibleResponse}`.

The internal cooperative driver is a separate, explicitly invoked execution path for work that must run before
readiness or assertion checks. It installs its implementation only on use, sharing the ordinary engine's check
helpers. A session names its document and operation; each yielded token authorizes one check and is consumed
before resuming. The host probes triggers through their own frame routes while the target is paused, then verifies
the target's document chain before resuming. These probes are not an atomic snapshot across frames. A final check,
including a trial under the input permit, can restart without applying anything so the caller can release the
permit. Invalidation discards resolved elements, stability evidence and coordinates; cancellation, deadline,
completion and page departure dispose session resources. Viewport checks share the ordinary native intersection
sampler, but a cooperative session owns each individual pending observation and rendering wait. A failed or
invalidated sample yields to the host before retrying; a target that gains or loses its rendered box during an asynchronous
observation is sampled again after that yield. Moving an existing box does not require stable geometry. Each observation is published to the session before timeout
construction, including a synchronous missing-match result. Expiry retains only a serialized timeout answer for
single-use delivery: at most 64 answers, one MiB of estimated UTF-16 string storage (including ownership keys),
and 30 seconds. Oldest answers are evicted first; oversized answers are not retained. A shared retention timer
and departure listener remain only while this bounded cache holds answers. Consumption, cancellation, departure
and retention expiry release them. The host can finish a session under a bounded cleanup deadline to collect
failed-check evidence without another check or application; a missing answer is reported explicitly rather than
silently starting another round on the same document. A waiting evaluation reports departure separately, even before the host receives the new
document commit. That reply, or a changed target or ancestor document route after disposal, causes rerouting
under the original deadline; the old continuation is cancelled, never replayed.
Page-scoped locator handlers activate this driver only on their page. The mutable page dispatch replaces ordinary
action/assertion execution, including for previously created locators and effects. A page semaphore serializes
callbacks; inherited suppression lets callback actions run ordinarily without recursion. Final checks restart
before application so the host releases the input permit before invoking a handler. Explicit removal disables
selection; scope closure also interrupts selected work and waits for its finalizers before releasing captured
services. A callback closing its own registration scope interrupts itself without a self-join. Default dispatch returns only after the last registration
and all outstanding invocations and hidden waits drain. Callback services are captured while the triggering
operation, deadline, clock and suppression remain inherited. URL assertions retain their model-only watcher
on ordinary pages; opted-in pages use cooperative URL checks with the same failure/evidence loop as locator
matchers. Hash and history events wake active URL checks without installing listeners on unused pages. Original typed callback errors remain unknown-valued
in process; serialized diagnostics do not promise lossless arbitrary-error transport.

- **The tree** is the document's composed tree, in tree order: open shadow roots are searched, a shadow root's elements right after its host, and closed ones aren't. A scope's own open shadow root counts as under it, so a locator scoped to a host finds the host's shadow content. Iframes are entered only through `frame()`.
- **Frames.** A frame locator is a boundary in the steps. L1 splits them at each boundary; the engine of each document on the way finds its iframe, which must be one match and an iframe, and the adapter names the frame the iframe holds (`contentFrame`: CDP's `DOM.describeNode`, a window proxy's `context` on BiDi, WebKit's `contentFrameId`). The last part goes to the engine of the frame's current document. A frame not there yet is a request that matches nothing, in a round of at most 100 ms, so the next round looks for the frame again. Same-origin and cross-site frames go the same way. Role/filter combinations are validated from the whole query at the first frame lookup, so a missing frame cannot hide an invalid combination.
- **Pressed, expanded, and selected** share readers between role filters and snapshots. ARIA keywords are ASCII case-insensitive, without trimming. Pressed is supported on buttons: absent or invalid values match false, and mixed matches neither boolean. Selected is supported on gridcell, option, row, tab, rowheader, columnheader, and treeitem: absent or invalid values match false. Expanded is supported only on expansion roles: absent matches neither boolean, and every present value other than true matches false. Native option.selected takes precedence over aria-selected; native details.open takes precedence over aria-expanded. Snapshots emit these positive markers only for exactly true, ignoring attributes on unsupported roles. Native details is an exception: open details emits expanded even with its ordinary group role, but group expanded filters still fail as invalid selectors. No expansion state is inferred for summary. These are Strider query and snapshot policies, not promises to reproduce browser accessibility trees; native precedence can differ from browser accessibility state.
- **Checked state** uses native checked for checkbox/radio inputs, with indeterminate matching neither boolean role filter. The seven ARIA checkable roles use `aria-checked`. ARIA keywords `true`, `false`, `mixed`, and `undefined` are recognized ASCII case-insensitively, without trimming. `mixed` is false on radio, menuitemradio, and switch; on checkbox, menuitemcheckbox, option, and treeitem it matches neither boolean filter and reads false for boolean reads and actions. Absent, empty, undefined, and unrecognized values use the role default: unsupported checking on option/treeitem, false on the other five roles. Unsupported reads and check/uncheck fail with `WrongElement` before input. This invalid-token fallback is Strider policy, so malformed optional state cannot authorize a click; it does not claim browser accessibility parity. Snapshots emit checked only for boolean true. Selection remains independent through `aria-selected` or native option selection.
- **Snapshots** walk the same tree with the same roles and names, from the document or one element: an element with no role gives its children to its parent, unless inferred interactivity makes it a node; hidden elements are left out; adjacent text is one `text` node, dropped when it only repeats its parent's name. Every element node gets a ref from a table the engine keeps for its document, so the same node keeps its ref while the document lives; a ref locator names its document, the table, and the ref, and resolves to that node or fails with `StaleRef`. L1 stitches each iframe's frame tree under it. Password inputs without an explicit ARIA role appear as `editable [ref=e1] [inferred: password]` when inferred interactivity is enabled. Their accessible names, including labels, titles, and placeholders, are retained; controls with no accessible name stay unnamed, without nearby-label inference. Disabled and read-only inputs retain this designation. Explicit ARIA roles are preserved. Password values do not contribute to snapshot names or find data, including when another element references the input for its name.
- **Text** is an element's text content in the flat tree, skipping `script`, `style`, `noscript`, and `template`, with a button-like `input`'s value, and with whitespace collapsed and trimmed. It isn't `innerText`, which depends on layout, differs between engines, and forces layout for every candidate.
- **`getByText`** matches the smallest element whose text matches: one whose text matches while no child element's does, so `<p>1 <b>item</b></p>` is found by "1 item". The document's `head` isn't searched. A string is a case-insensitive substring, `exact` is equality, case-sensitive, and a `RegExp` is tested as given.
- **`getByRole`** takes an element's role from its `role` attribute (the first token the engine knows), or else its implicit role under HTML-AAM, from a table in the engine. Its name is computed under accname 1.2: `aria-labelledby`, `aria-label`, the native label (`label`, `alt`, `caption`, `legend`, a button's value), the content for roles named from content, then `title` and `placeholder`. An embedded control adds its value to another element's name, never to its own; password inputs contribute no value. Elements outside the accessibility tree (`aria-hidden`, `display: none`, `visibility: hidden`, the `hidden` attribute) are skipped unless `includeHidden` is set. A name matches as text does. Optional `level`, `checked`, `pressed`, `expanded`, `selected`, and `disabled` filters narrow by native and ARIA state, in combination with name and visibility. Unsupported role/filter combinations fail through the invalid-selector path when used, even if no elements match; omitted filters leave matching unchanged.
- **The other queries** follow from those: `getByLabel` matches labelable elements by their label (`label[for]`, a wrapping `label`, `aria-labelledby`, `aria-label`); `getByPlaceholder`, `getByAltText`, and `getByTitle` match their attribute; `getByTestId` matches `data-testid` exactly; and `locator(css)` runs `querySelectorAll` in the document and each open shadow root, where a malformed selector fails with `InvalidInput` at once.

### Snapshot editability and capture

Redacted capture collects optional `editable` on snapshot nodes independently of semantic role: true for native field kinds, ARIA field
roles, and contenteditable elements, including inherited and plaintext-only editability. Read-only and disabled
fields retain the signal because they still contain field data. Ordinary library and full capture omit this metadata; absence does not prove a node is not a field. Older
serialized snapshot nodes remain decodable. An accessible editable name derived from its own content carries optional `from: "text"`;
labels retain their existing names. Optional `fieldContent` on accessible and inferred names records that the
chosen name contains field content, including content copied into an ancestor or another node's name. Absent
provenance is not evidence of absence: ordinary library snapshots and full capture omit name provenance.
Only redacted capture requests collect field editability and name provenance, including equivalent custom policies. These additions do not change local snapshot text or semantic roles.

The toolkit derives one redacted tree for snapshot rendering and find matching, names and paths. It masks field
content and validation messages, including names that contain field content contributed by descendants,
embedded control values, referenced controls, nearby fields, or image-alt inference. It keeps public labels,
roles, states, and refs. Field ancestry follows assigned slots and shadow hosts, including noneditable
descendants of native and ARIA fields. It classifies actual content contributors, preserving explicit public
label precedence. A mixed name is masked whole; native select and ARIA listbox option names are masked with
their field subtree. Non-full console capture also
replaces exceptions in digests and history with an event marker and monotonic occurrence time, excluding all
page-supplied details. Full local capture keeps its existing content and search behavior. Capture remains bounded:
ordinary text, labels, and other metadata can still disclose content. Assertions such as `expect --text` and
action selectors still match original page content and can confirm guesses at masked values. Name provenance
covers field contributions during name construction; it is not general taint tracking or a secrecy guarantee.

### Readiness predicates

Each predicate yields `Ready`, `NotReady{reason}`, or an observation error. A reason describes the present condition and does not promise it can never improve. L2 decides whether to wait, scroll, activate, or fail; an action checks at each animation frame (§5, Actions).

| Predicate | Definition | Reasons |
|---|---|---|
| Rendered | wait for a native rendering update before checking when stability is off; enabled by default for pointer actions, independently adjustable per call | `NoRenderingOpportunity` |
| Connected | binding, generation, and connectivity checked at use | `Replaced`, `Detached`, `Suspended` |
| Visible | `checkVisibility({contentVisibilityAuto, opacityProperty, visibilityProperty})` and a non-empty rect; for `display: contents`, any visible child | `NoBox`, `ContentVisibilitySkipped` |
| Stable | rect unchanged across *k* native rendering updates, independent of the application clock. *k* is a per-backend default measured by probe 10 (initially 2, or 6 on WebKit/Windows). It is shown in the action's span and in any error ("waited for 2 stable frames"), and can be overridden per call | `NotStable` |
| Enabled | ARIA-disabled semantics: `disabled`, `fieldset` inheritance, `aria-disabled` | — |
| Editable | enabled, not `readonly`/`aria-readonly`, and an editable element type | `NotEditableType` |
| NotInert | not inside an inert subtree | `BlockedByModal{dialog}` |
| InViewport | a nonempty client rectangle remains after viewport and parent-frame clipping; scrolling is an action policy | `OutsideViewport` |
| ReceivesPointer | at the action point, the composed-tree hit test (per shadow root, through iframes) lands on the target or a descendant; checked before dispatch *and* guarded on the first trusted event. The guard is capture-phase listeners on the window for the gesture's pointer, mouse, touch, and click events, armed under the input permit just before dispatch: the first trusted one decides, and if it lands outside the target, it and the rest of the gesture are stopped (`preventDefault`, `stopImmediatePropagation`). Moves aren't guarded, so hover effects still happen | `Covered{by}` |
| Unique | exactly one match (hidden matches count); actions fail immediately on ambiguity, with no retry window | `Ambiguous{candidates, visibleCount}` |
| PromptFree | no known prompt blocking the navigable | `PromptBlocking{prompt, resolution}`; built for `resolution: None` as the shared reason `PromptBlocking{kind, text}` (§5) |

An action needs its element reachable; visible means a person can see it. Actions accept an element with `opacity: 0` on itself or any ancestor. For that element, `isVisible` returns false, `Expect.toBeVisible` waits, and `filter({ visible: true })` excludes that element; `filter({ visible: false })` includes it. Opacity alone does not make an action wait for a fade-in.

An action's `visible` check requires CSS visibility, content visibility, and a nonempty box. Pointer actions require their action point to receive the pointer, so a covering element blocks them. Non-pointer actions accept transparency without a pointer hit test: `fill` and `clear` require enabled, editable, and not inert; `focus`, `press`, and `pressSequentially` require not inert; `selectOption` requires enabled, the chosen options included; `scrollIntoView` requires stability. `setInputFiles` runs no readiness checks.

There are no time-window predicates such as network idle or DOM quiet: waiting for T ms of silence is a heuristic (rule 23). Compatible instantaneous checks are batched in one injected evaluation. No batch is an atomic guarantee that covers the input that follows it.

A design-mode fill guards the native insertion after focus and selection, in the target document and each ancestor document. Cancellable events that would edit another target are stopped before their native mutation. Keyboard and insertion events in an ancestor document are blocked; once a keyboard or input event was allowed in the target document, a later block cannot justify replay. Only cancellation before any input was allowed permits another attempt; partial or unconfirmed insertion fails without replay. On failure or interruption, the page's input permit stays closed until connection-scoped cleanup confirms guard removal, including while a dialog blocks the document. A document whose script context a navigation destroyed counts as confirmed once the model ends that document, within the cleanup's deadline; a document still live then, or an engine that is missing, does not. The interrupted caller returns promptly. If cleanup fails, a warning identifies the page and input remains blocked; close the page before sending more input. Ordinary fills install no such guards.

## 9. Operations

- **Interruption and records.** Caller cancellation remains Effect interruption. Each user operation has a record (§2) linked to its span.
  - Its `Timeout` takes its phase from the record: sent and unconfirmed is `dispatchedUnconfirmed`; sent and confirmed, with what it waits for afterwards missing, `postcondition`; nothing sent and nothing observed but `NoMatch`, `resolving`; nothing sent and something else observed, `waitingForCondition`. An event wait says `waitingForEvent` itself.
  - An operation started inside another is a step of it. When it ends, it joins the enclosing record's `progress`, and the enclosing dispatch takes its latest step's dispatch when that step sent and steps run sequentially; a manually marked send that succeeded counts as acknowledged, but success cannot confirm a call known to have ended without a reply, and one repeated in a row is kept once. An event wait awaited inside an operation is a step of it, wherever it subscribed.
  - A `Timeout` that leaves an operation is its own. One a step ran out with keeps the step's phase, history, and hint, and takes the operation's name, budget, and record. Inside the operation, the step's is the step's.
  - Work an operation leaves running is no step of it. A handler's decision is an operation of its own, under the handler's budget from when it starts; a recording's fibers run under no operation's deadline.
  - A program's own operations are the same, through `Operation.fn` and `Operation.named` (API.md).
  - Dispatch is marked `mayHaveBeenSent` before any boundary where delivery becomes uncertain.
  - A successful adapter write or creation reply confirms the call; an explicit protocol rejection confirms it as rejected. Local refusal, disconnection, and a missing reply do not prove acknowledgement. An evaluation explicitly sent as a write records its reply; a read-only evaluation cannot confirm an earlier write. An engine action confirms its applied `Ready` answer; a guard that stops input restores `NotSent`. Each new write starts uncertain again, including a later step, so it cannot inherit an earlier call's confirmation. Overlapping calls and steps stay uncertain while any write lacks an acknowledgement, including one whose wait has ended or been interrupted. Once all writes in the overlap are acknowledged, any rejection makes the result rejected; a later independent write starts fresh. Read-only steps do not hold write overlaps open or overwrite later evidence when they finish. Manual sends remain part of an overlap until guarded, confirmed, or settled by step completion. Acknowledgement may describe an input recovery release, so it does not by itself prove the requested gesture was sent. A method that sends several commands records its overall reply, not separate delivery evidence for each command.
  - Diagnostics are snapshots of evidence known when the error is built. Cleanup owned by the operation and its steps contributes to the snapshot: held-input recovery reports its completed or failed release, and abandoned page or context creation reports `Pending` while its reply or release remains outstanding. Reporting never extends a deadline, changes resource ownership, or waits for background cleanup. Multiple outcomes summarize as `Failed` before `Pending`, before `Completed`, before `NotNeeded`, preserving the first failure's cause. Future scope finalizers are outside earlier snapshots.
  - Abandoned query ids are tombstoned.
  - Late replies that create resources (pages, contexts, handles, scripts, intercepts) are released by the library. L0 callers can supply a custom late-reply handler.

| Operation | Interrupted before dispatch | Interrupted after dispatch | Recovery |
|---|---|---|---|
| read/query | no remote work | waiter detached | retry only with a valid binding |
| author evaluation | no remote work | result unknown | no automatic re-evaluation |
| navigation | no remote work | may continue | no automatic re-navigation |
| input gesture | no remote work | partial input possible | bounded release of held input |
| obligation decision | fallback applies | resolver continues | no contradictory decision |
| resource creation | nothing created | may exist | late-reply cleanup |

- **Subscriptions.** A subscription is the internal resource behind an event module's `next` and `stream`.
  - **Before it returns:** it acquires collectors and remote enablement, so the caller's next line already runs subscribed. If that fails, the caller gets `SubscriptionError` before reaching its action.
  - **Revision boundary:** it sets one between the current-state snapshot and the live subscription.
  - **Correlation:** by the strongest identity available.
  - **One-shot terminal ordering.** A `next` wait latches the first completed delivery and accepted predicate, delivery/predicate failure, registration deadline, target end, or acquiring-scope cancellation. Queue admission is not a match. Target end commits `TargetGone` synchronously with the channel's end, independently of the delivery worker; an ended channel commits it at registration. Scope closure commits interruption before canceling worker work. Neither can replace an existing outcome, and closure discards queued entries without running delivery or predicates. A separate deadline waiter uses the registration-time browser clock and budget, so blocked delivery cannot defer committing a timeout. Cooperative interruption still cannot force an already uninterruptible user effect to stop.
  - **One-shot cleanup.** A terminal outcome removes its subscriber and discards buffered entries immediately. The delivery worker closes its child scope only after it exits, detaching internal finalizers from the acquiring scope. Terminal notification and owned-work release are separate: a Timeout or TargetGone can be reported while uninterruptible work remains held, but acquiring-scope release must still wait for that work before releasing caller resources. The deadline waiter commits and notifies without closing the child scope. That acquiring scope is an upper lifetime bound for an unfinished wait, not a reason to retain a completed subscription. Interrupting a consumer leaves the unfinished subscription alive. Caller requirements captured for predicates retain their caller context.
  - **Results:** a latched immutable result outlives the subscription.
  - **Delivery.** The fold publishes each event to a channel per kind and target (a page's popups, a context's automatic decisions), which logs it and offers it to every subscription whose declarative filter matches, each into a buffer of its own; offering never blocks the fold. Registration is the revision boundary, kept by sequence numbers: an entry whose details arrive later (a popup's URL) is offered again to the subscriptions it now matches, but never to one made after it was published. A `stream` buffers `Subscription.Capacity` events (1,000) and then fails with `EventOverflow`, alone; `next` keeps what arrives until its first match or its deadline, and times out in the phase `waitingForEvent`, with a hint naming a match that came before it subscribed. The end of the target ends streams normally when it was closed, and fails waits and other streams with `TargetGone`. `PubSub` doesn't fit: it offers every message to every subscriber, so filters would run after buffering, and its bounded strategies stall the publisher or drop silently.
  - **Attribution and delivery.** The fold publishes each event to its page's channel and its context's, by the page and context each navigable, realm, and request belongs to; an event it can attribute to neither reaches no subscription. Delivering can take an effect in the subscriber, such as reading a body or waiting for a load, whose failure fails the wait or the stream. A filter that asks for events the backend can't report fails `next`, `stream`, and `history` with `SubscriptionError{Unsupported}`, and `history` checks its filter as they do.
- **Event logs.** Each page and context keeps a bounded log per event kind, fed by the same fold as subscriptions. Entries are copied metadata or handles to resources owned elsewhere, never collected bodies, so nothing in a log decays. A log counts what it drops: every event of its kind it discarded, since which ones a later filter would have matched can't be known. Logs serve `history`, the digest that agent tools and CLI commands return between calls, and the hint on a late subscription's `Timeout`, which names a match that arrived just before it subscribed.
- **Deadline.** There is one monotonic deadline per operation, inherited by nested calls and only ever shortened. It lives in `Deadline.CurrentDeadline`, an absolute instant on the clock the browser runs on (the live monotonic clock for a real browser, Effect's clock for `Browser.layerTest`), set only by `Deadline.within`; an operation with no enclosing deadline gets `Deadline.DefaultBudget` from when it starts. An event wait takes its deadline at `next`. Every command an operation sends waits for its reply until the deadline, in place of the protocol's `CommandTimeout`: L1 calls the adapter through a wrapper that bounds each call by the operation it runs in, marks a call that changes the browser as sent before it goes, lets a creation the deadline cut short finish apart and closes what it made, and leaves releases alone. Cleanup has its own budget: it runs detached from the operation, under `CommandTimeout`. Deadline failures are `Timeout{phase}`, carrying the last observation and its de-duplicated history.
- **Retries.** Retry decisions depend on the operation, its phase, the target binding, dispatch evidence, and the remaining deadline, never on an error tag alone.
  - Locators re-resolve before dispatch.
  - Explicit refs never rebind.
  - Nothing that may have dispatched is repeated automatically, except input a guard stopped before its native mutation: an intercepted pointer gesture (§8, ReceivesPointer), or design-mode insertion cancelled before any input was allowed.
- **Errors (L1 view).** Lifetime ends surface as `TargetGone{reason: CloseReason}` and deadlines as `Timeout`. Everything else is the error of the module whose operation failed (`LocatorError`, `PageError`, …; one per module), whose `reason` includes the shared `NotPermitted`, `Unsupported`, and `BackendFailure{Rejected | IncompatibleResponse}`. L0 hands over a normalized `RejectReason`, which L1 maps using its own state (`NoSuchNode` becomes `StaleRef{Detached}`); reasons it doesn't map surface as `BackendFailure{Rejected}`. All of them carry the diagnostic envelope, and every reason carries a one-line remediation `hint`. Defects are reserved for bugs, and for gaps: a member the interfaces declare that isn't built yet fails as the defect `NotBuilt{member}`, loud and never a no-op, because no caller could handle it as a condition of the browser. A module-level function that isn't built stays a declaration, absent at run time, unless its module needs the binding to load: `Route.continue` is a decision nothing reads yet. `SessionSwapped` is internal.
- **Caller locations.** Operations capture their caller stacks when constructed, including operations built before recording starts. Formatting and filtering wait until a recording or failure rendering consumes the frame. Library frames from both source and compiled modules are excluded. When capture is enabled but no user caller is available, failure rendering retains the operation name without a location; source exports omit unavailable locations.
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
  - **An event is published before the state it changes.** The fold publishes a navigation's end before it latches the outcome `goto` waits on, a popup before it joins its context's `pages`, a worker before it joins the lists, a dialog before its page is blocked, and a document's readiness after its page's status. So when a caller resumes on the state, the event is already published, and a subscription the caller makes next doesn't receive the event of what it just did: `PageNavigation.next` after `goto` waits for the next navigation, not `goto`'s.
- **Reactivity in the page.** A locator's expectation changes when its page does, so the page is where it waits. One round is one engine request: a check now, then a check on each mutation of the document (a `MutationObserver` on children, attributes, and text), each `input`, `change`, `focusin`, and `focusout` event (a value or focus isn't a mutation), and each animation frame (layout isn't one either), answering when the condition holds or after a second; in the operation's last second, after half of what's left, so the last answer, with what it saw, comes back before the deadline. L1 sends rounds until the deadline, so nothing changes unseen between checks and there is no cadence to choose. A change the observer can't see, in a shadow root or a page that renders no frames, is seen by the next frame or the next round.
- **No public fibers, no writable `Deferred`s or `Ref`s.**
  - **Internal:** the model's background work (state folds, handlers, resolvers) runs in fibers scoped to the owning entity. `Deferred`s latch first matches, lifetime ends, and obligation decisions; `Deferred.succeed` returning `false` enforces a single winner.
  - **Public:** only read-only views cross the API: `Effect`, `Watchable`, and `Stream` from eager subscriptions. A latched first match is handed out as an `Effect` that awaits its `Deferred`.
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
  | single-winner decisions and latched first matches | `Deferred`; callers get an `Effect` that awaits it, `Deferred.await`, which nothing can complete |
  | event delivery (Subscriptions) | a `Queue` per subscription that the fold offers to without suspending, not `PubSub` |
  | `Expect`'s re-checks on change signals | `Reactivity`: the model invalidates keys (a `Watchable` change, a subtree mutation), and `Reactivity.stream` re-runs the check. Built differently: a locator's expectation waits in the page, where its changes happen (Reactivity in the page, below); a `Watchable`'s is its `changes` stream; any other effect is re-run at `Expect.CheckInterval` (100 ms) |

## 10. Secrets and diagnostics

- **Classified fields.** Credentials, cookie values, typed text, and authentication and cookie headers are classified. They are wrapped as `Redacted` on the way out. `NetworkRequest` and `NetworkResponse` implement Effect's `Redactable` and render their URL from the preset in the current fiber's context, so Effect's logger, formatter, and inspection redact it the same way, in user code too; JSON and Schema encoding keep it whole. Other values that carry a URL or a title, such as navigations and console locations, show it whole. Sensitive header names join `Headers.CurrentRedactedNames`.
- **Descriptions** use ids and preset-dependent URL detail (docs/design.md); the default preset shows a URL's origin and path, each query value `REDACTED`.
- Built: `Diagnostics.CurrentPreset`, `"strict"` unless set, and the span helper every operation's span opens through. Under `"strict"` a URL in a span attribute keeps its origin and path, each query value `REDACTED`, with no credentials or fragment; under `"local"` it is whole. The helper renders it as a string when the span opens, from the preset in the operation's context, rather than as a `Redactable`; the model's own log uses the layer's preset (QUIRKS.md, Q156). Descriptions don't use the preset yet.
- **Raw content** (bodies, console arguments, DOM snapshots, screenshots) may contain secrets echoed by the page. It is recorded as metadata by default and exported only under an explicit capture policy. There is no taint tracking.
- **Agent secret placeholders** are substituted at dispatch, inside L1. A page can still echo a secret into other channels, so capture policy applies to anything sent to a model.

## 11. Open questions

No design questions are open at this layer right now.
