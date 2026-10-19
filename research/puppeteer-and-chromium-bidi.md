# Puppeteer and chromium-bidi: prior art for an Effect-native browser driver

Sources are read-only shallow clones, read on 2026-10-18. No code from them was run.

- **puppeteer** `ff3103c8e46f1b97e00a6a4a72f8e2509cbc796f` (2026-10-16, puppeteer-core 25.14.0). Paths are relative to `packages/puppeteer-core/src/` unless they start with `docs/`.
- **chromium-bidi** `89696e8c5530b36b938cc428aa8c9dffb12c2ac7` (2026-10-17). Paths are relative to `src/bidiMapper/` unless they start with `src/`.

Citations use the form `path:line`. Excerpts are trimmed.

---

## Summary

- **Two protocols through inheritance.** Puppeteer puts both protocols behind abstract classes in `api/`. `Page` alone has 73 `abstract` members, and `cdp/` and `bidi/` each implement them. Shared logic sits in the base classes as template methods: locators, `waitForSelector`, `waitForNetworkIdle`, and screenshot option handling. This only holds up because Chrome's BiDi runs *on top of* CDP. Puppeteer's BiDi page reaches CDP for emulation, tracing, coverage, accessibility and `queryObjects`, using `goog:cdp.sendCommand`. On Firefox those calls become runtime `UnsupportedOperation` errors (there are 56 throw sites in `bidi/`). The type system never shows which features a browser supports.
- **`bidi/core` is a clean, spec-shaped projection driven by events.** Each object (Session, Browser, UserContext, BrowsingContext, Realm, Navigation, Request, UserPrompt) subscribes to the session firehose through a disposable wrapper emitter and filters by id. A *terminal protocol event* is the only thing that disposes an object, and disposal cascades. The design is worth copying. Two parts are not: the O(live objects) fan-out per event, and identity that is mutated in place (a `WindowRealm` changes its `id` on navigation).
- **The CDP side is mature but has accreted.** Pause-on-attach (`waitForDebuggerOnStart`), events held back until the frame tree loads, and reconciliation of four `requestWillBeSent`/`requestPaused` orderings are all correct. However, errors are classified by matching message substrings. I also found two latent bugs. `FrameTree.waitForFrame` never registers its waiter, so a `frameNavigated` for a not-yet-known frame is dropped and its handler hangs forever. `CdpFrame.waitForNavigation` can `throw undefined`.
- **Locators are an immutable builder compiled to RxJS.** `retry({delay: 100})` is raced against a timer and an `AbortSignal`, and the preconditions (in viewport, bounding box stable over two rAFs, enabled, visible) run concurrently via `merge`. This maps almost 1:1 onto `Effect.retry` + `Schedule` + `Effect.timeout` + `Effect.raceAll`. Puppeteer's version retries every error and has no hit-target check.
- **Cancellation was bolted on.** `AbortSignal` support arrived API by API between 19.10 and 24.37. CDP `goto` still ignores it. No API cancels the browser-side operation, and listener cleanup is uneven.
- **chromium-bidi is the best model of CDP state that exists.** It has:
  - a target "unblock" phase;
  - normalized storages with id references instead of an object graph;
  - a navigation tracker keyed by `loaderId` with pending and committed navigations;
  - a resettable "default realm" deferred;
  - per-request slots of partial CDP facts with emit-once guards;
  - **one FIFO outbound queue of *promised* events**, which keeps ordering intact while slow enrichment finishes;
  - reconcilers that diff desired state against actual state for Fetch, cache and domain enablement;
  - per-top-level-context input state with an undo log.
- **Ergonomics.** Puppeteer's best call sites are locators, typed selectors and `using` handles. Its worst make the user handle registration races (`Promise.all([waitForNavigation(), click()])`), coordinate interception handlers through shared mutable state, and live with closures that silently aren't closures.

---

## Architecture

### Puppeteer

```
api/        abstract Browser/BrowserContext/Page/Frame/Realm/JSHandle/ElementHandle/HTTPRequest + Locators
            (real logic: Realm.waitForFunction→WaitTask, Frame.waitForSelector→QueryHandler, Page.waitForNetworkIdle…)
 ├─ cdp/    CdpBrowser → TargetManager → CdpTarget → CdpPage → FrameManager{FrameTree, NetworkManager,
 │          IsolatedWorld→ExecutionContext, LifecycleWatcher} → Connection / CdpCDPSession (CallbackRegistry)
 └─ bidi/   BidiBrowser → BidiBrowserContext → BidiPage → BidiFrame → BidiFrameRealm   (adapters onto…)
     └─ bidi/core/  Session → Browser → UserContext → BrowsingContext → {WindowRealm, DedicatedWorkerRealm,
                    Navigation, Request, UserPrompt}                                   (spec-shaped model)
         └─ BidiConnection ← WebSocket (Firefox, Chrome-native BiDi) | BidiOverCdp (in-process chromium-bidi)
injected/   page-side Pollers, visibility checks, p-selectors; injected into an isolated world through LazyArg
```

On Chrome, "BiDi mode" means `connectBidiOverCdp`. It instantiates `BidiMapper.BidiServer` inside Node on a `NoOpTransport`, wired to Puppeteer's own CDP connection (`bidi/BidiOverCdp.ts:21-68`). The CDP connection stays live, and that is what makes the `goog:cdp.*` tunnel possible.

### chromium-bidi

```
BidiServer: transport in → CommandProcessor (concurrent) ; all responses+events → ProcessingQueue (FIFO) → transport out
 ├─ BidiParser: zod schemas generated from the spec CDDL (src/protocol-parser/generated/*, tools/update_bidi_types.py)
 ├─ *Processor per module (browsingContext, script, network, input, storage, emulation, …)
 ├─ CdpTargetManager: Target.attachedToTarget / detachedFromTarget / targetInfoChanged, Page.frameAttached …
 ├─ CdpTarget (1 per CDP session): #unblock(), toggle*IfNeeded reconcilers, unblocked: Deferred<Result>
 ├─ BrowsingContextImpl (1 per frame): NavigationTracker, lifecycle Deferreds, default-realm Deferred
 ├─ Storages: BrowsingContext, Realm, Network, PreloadScript, ContextConfig, UserContext
 └─ EventManager + SubscriptionManager: (event × context|userContext × channel), buffers, subscribe hooks
```

It runs in-process in Node (Puppeteer), in a hidden tab (`src/bidiTab/`, used by ChromeDriver), or natively.

---

## Mechanisms

### M1. One API over two protocols (Q1)

**Layering.** The shared logic needs only two primitives: `abstract mainRealm(): Realm; abstract isolatedRealm(): Realm;` (`api/Frame.ts:420-425`).

- `QueryHandler.waitFor` always runs in the isolated realm and transfers the result handle to the main realm (`common/QueryHandler.ts:148-219`).
- `Realm.waitForFunction` builds a `WaitTask` on whichever realm it is called on (`api/Realm.ts:148-183`).
- Element methods are decorated with `@bindIsolatedHandle`, which adopts `this` into the isolated world, runs the method there, and transfers any returned handles back (`api/ElementHandle.ts:132-170`). As a result, page scripts that tamper with prototypes cannot break Puppeteer's helpers.

**Leak 1: unsupported at runtime.** There are 56 `UnsupportedOperation` sites in `bidi/`, including:

- `Page.metrics` and `captureHeapSnapshot`;
- `setBypassServiceWorker` and `setDragInterception`;
- `openDevTools`;
- `Mouse.drag*` (`bidi/Input.ts:594-610`);
- `HTTPRequest.resourceType` and `postData`, which depend on the non-standard `goog:` fields;
- `HTTPResponse.securityDetails` and `ElementHandle.backendNodeId`;
- PWA, screens and extensions;
- `createCDPSession` when CDP isn't available.

**Leak 2: the CDP tunnel.** `BidiPage` builds CDP managers on a `BidiCdpSession` (`bidi/Page.ts:129-139`). These are `EmulationManager`, `Tracing` and `Coverage`. Media type, CPU throttling, media features, idle state and vision deficiency all go through `goog:cdp.sendCommand` (`bidi/CDPSession.ts:67-93`), which throws when `!cdpSupported`. `BidiBrowser` also subscribes to raw CDP events (`bidi/Browser.ts:72-83`):

```ts
static readonly subscribeCdpEvents: Array<CdpEvent['method']> = [
  'goog:cdp.Debugger.scriptParsed', 'goog:cdp.CSS.styleSheetAdded',
  'goog:cdp.Runtime.executionContextsCleared', 'goog:cdp.Tracing.tracingComplete',
  'goog:cdp.Network.requestWillBeSent', 'goog:cdp.Page.screencastFrame', …
```

**Leak 3: protocol types in the public API.** Examples are `JSHandle.remoteObject(): Protocol.Runtime.RemoteObject` (`api/JSHandle.ts:206`), `emulateVisionDeficiency(type?: Protocol.Emulation…)` (`api/Page.ts:2406-2408`), and `setUserAgent(…, Protocol.Emulation.UserAgentMetadata)` (`api/Page.ts:1796-1807`).

**Leak 4: semantics diverge silently.**

- `GoToOptions extends WaitForOptions`, which declares `signal` (`api/Frame.ts:48-90`). CDP `goto` never reads it (`cdp/Frame.ts:148-235`), while BiDi `goto` honours it through `waitForNavigation`.
- BiDi `goto` navigates with `readiness: interactive` and then swallows errors by matching substrings: `'navigation canceled'` and `'Navigation was aborted by another navigation'` (`bidi/Frame.ts:302-341`).
- `WaitTask` has to recognise both CDP and BiDi error strings (`common/WaitTask.ts:214-230`).
- BiDi sessions are created with `'goog:prerenderingDisabled': true` because prerender behaviour is unspecified (`bidi/Browser.ts:96-99`).

**CDP-only in practice:** tracing; JS and CSS coverage; heap snapshots; `metrics`; the accessibility snapshot (CDP even under BiDi); drag interception; service-worker bypass; DevTools, PWA, screens and extension actions; WebMCP; `queryObjects`; backend node ids; request `resourceType` and `postData`; TLS details. Emulation is split: viewport, geolocation, timezone, locale, orientation, UA and offline go over BiDi, and the rest over CDP.

**What this means for us.** A single fat interface with "unsupported" escape hatches pushes capability checks to run time, and the user only finds out in production. Model capabilities as separate services so that a missing one is a type or `Layer` error (see L1).

### M2. Puppeteer's `bidi/core` object model (Q2)

The README sets the rules (`bidi/core/README.md`):

- follow the spec, not Puppeteer's needs;
- "objects are nodes and events are edges … never compose edges";
- only `Browser` exposes the session.

**Objects.**

- **Session.** `Session.from` sends `session.new` and then builds `Browser` (`bidi/core/Session.ts:27-38`). It also normalizes a vendor difference: it emits a synthetic `navigationStarted` before every `fragmentNavigated` (`Session.ts:63-74`).
- **Browser.** It syncs initial state by calling `getTree` while temporarily collecting `contextCreated` events. For any context it hasn't seen yet, it **re-emits** a synthetic `contextCreated` "so contexts are created naturally" (`bidi/core/Browser.ts:92-116`). The initial snapshot and live updates therefore share one code path.
- **UserContext** creates top-level `BrowsingContext`s where `!info.parent && info.userContext === id` (`UserContext.ts:78-107`).
- **BrowsingContext** does several jobs. It creates child contexts and tracks the URL from `historyUpdated`, `domContentLoaded` and `load`. It owns a `defaultRealm` and sandbox realms. It creates a `Navigation` on `navigationStarted`, unless one is still live, which it treats as a "nested navigation" (`BrowsingContext.ts:266-294`). It creates a `Request` on `beforeRequestSent` when `redirectCount === 0`, and a `UserPrompt` on `userPromptOpened`.
- **Navigation** binds lazily to the first navigation id it observes:

  ```ts
  #matches(navigation: string | null): boolean {
    if (this.#navigation !== undefined && !this.#navigation.disposed) return false;
    if (this.#id === undefined) { this.#id = navigation; return true; }
    return this.#id === navigation;
  }
  ```
  (`Navigation.ts:141-150`). It ends in one of three ways:
  - a `fragment`, `failed` or `aborted` event is emitted;
  - `navigationCommitted`, DCL or `load` disposes it without emitting anything;
  - the context closes, which emits `failed` (`Navigation.ts:53-139`).
- **Request** follows a redirect chain by matching `redirectCount + 1`. For Firefox it adds a heuristic that compares `Authorization` headers to detect a request re-sent after auth (`Request.ts:74-101`). It ends on `fetchError`, a non-3xx `responseCompleted`, or a closed context.
- **WindowRealm** is a stable object for each `(context, sandbox)` pair. On `realmCreated` it **mutates** its own `id` and `origin` and emits `updated` (`Realm.ts:180-192`). Its script target is `{context, sandbox}`, not the realm id (`Realm.ts:225-227`).

**Disposal.** Each object owns a `DisposableStack`. Subscriptions go through `new EventEmitter(parent)` wrappers, and disposing a wrapper removes only the handlers registered through it (`common/EventEmitter.ts:73-81, 193-200`):

```ts
const sessionEmitter = this.#disposables.use(new EventEmitter(this.#session));
sessionEmitter.on('browsingContext.contextDestroyed', info => {
  if (info.context !== this.id) return;
  this.dispose('Browsing context already closed.');
});
```
(`BrowsingContext.ts:200-240`)

`dispose(reason)` records the reason, disposes the children (`BrowsingContext.ts:366-373`), emits `closed`, and unwinds the stack. Commands are guarded by `@throwIfDisposed(reason)`, and `dispose` itself by `@inertIfDisposed` (`util/decorators.ts:53-78`). Using a closed object therefore throws the *reason* it was closed, for example "Browsing context already closed: User context was closed: …".

**Verdict: mostly true.** State changes only happen inside event handlers. Commands such as `navigate` send the request and wait for the event to create the `Navigation`, so there is no double bookkeeping between commands and events. The weaknesses are:

1. Every live object listens to the whole session and filters. A `Request` registers 5 network handlers, so N in-flight requests means N× dispatch per event.
2. Success is implicit. A navigation that completes is just *disposed*, so consumers race `fragment | failed | aborted` against the context's `load` (see M5).
3. A `navigationStarted` that arrives while a navigation is live is swallowed.
4. Identity is mutated. Handles from an old `WindowRealm` id become invalid without any signal, and `updated` is what triggers `WaitTask` reruns.

**Copy:** scoped subscriptions; terminal events as the only finalizers; synthetic events to bootstrap initial state; disposal errors that carry a reason; a spec-shaped core under an ergonomic layer.

### M3. CDP side (Q3)

**Connection and sessions.**

- `Connection.onMessage` creates the child `CdpCDPSession` synchronously when it sees `Target.attachedToTarget`, *before* routing the message onward, so listeners can configure the session at once (`cdp/Connection.ts:209-224`).
- `detachedFromTarget` triggers `session.onClosed()`, which rejects every pending callback with `TargetCloseError` (`CdpSession.ts:170-174`, `common/CallbackRegistry.ts` `clear`).
- Every send has a 180 s default protocol timeout (`Connection.ts:69`). Each `Callback` captures `new ProtocolError()` at send time to keep the async stack trace.
- CDP has no way to cancel a command. An abandoned call still completes remotely.
- The error string "Session with given id not found" is converted to `TargetCloseError` by substring match (`CdpSession.ts:94-119`).

**TargetManager.** It calls `Target.setDiscoverTargets`, then sets browser-level auto-attach (`TargetManager.ts:160-181`):

```ts
await this.#connection.send('Target.setAutoAttach', {
  waitForDebuggerOnStart: true, flatten: true, autoAttach: true,
  filter: [{type: 'page', exclude: true}, ...this.#discoveryFilter],
});
```

With this filter, tabs attach at the top level and pages attach underneath them.

1. **On attach** it creates the target and fires `CDPSessionEvent.Ready` synchronously, so `FrameManager` and `NetworkManager` can enqueue their setup. It then runs `Target.setAutoAttach` on the child, network conditions, and `Runtime.runIfWaitingForDebugger` in parallel (`TargetManager.ts:449-486`).
2. **Service workers are detached silently** unless network rules are configured. In the code's words, "being attached to service workers will prevent them from ever being destroyed" (`TargetManager.ts:362-416`).
3. **Initialization waits** until every initial tab has produced a child (`#targetsIdsForInit`, `TargetManager.ts:99-109, 526-538`).
4. **Prerender activation swaps sessions.** `isPageTargetBecomingPrimary` leads to `CDPSessionEvent.Swapped` (`TargetManager.ts:319-326`), and then `FrameManager.swapFrameTree` re-keys the main frame onto the new target id (`FrameManager.ts:157-178`). Swaps are detected by reference comparison (`this.#client !== client`, `FrameManager.ts:117-121`). There is no explicit session generation.

**FrameManager.**

- `initialize` sends the following in parallel while the target is paused (`FrameManager.ts:229-268`): `Page.enable`, `Page.getFrameTree`, `setLifecycleEventsEnabled`, `Runtime.enable` followed by `createIsolatedWorld`, preload scripts, bindings and `Audits.enable`.
- Every `Page.*` and `Runtime.*` handler first runs `await this.#frameTreeHandled?.valueOrThrow()` (`FrameManager.ts:184-227`). Events that arrive before `getFrameTree` returns are held back, and their relative order is preserved because they all wait on the same deferred.
- `#frameNavigatedReceived` removes duplicates between the tree snapshot and live `frameNavigated` events (`FrameManager.ts:443-447`).
- **Out-of-process iframes (OOPIFs).** A `frameDetached` with `reason: 'swap'` keeps the frame and emits `FrameSwapped`, while `'remove'` detaches it recursively (`FrameManager.ts:568-588`). An `iframe` target attach moves the frame to the new session (`FrameManager.ts:375-388`).
- The main frame keeps its identity across cross-process navigations by being re-keyed (`FrameManager.ts:497-513`).

**Dropped events.** Most handlers for unknown ids simply `return` (for example `#onLifecycleEvent`, `FrameManager.ts:404-412`). `#onFrameNavigated` is different: it calls `await this._frameTree.waitForFrame(frameId)` (`FrameManager.ts:515`), and that waiter is never registered:

```ts
const deferred = Deferred.create<FrameType>();
const callbacks =
  this.#waitRequests.get(frameId) || new Set<Deferred<FrameType>>();
callbacks.add(deferred);            // never stored in #waitRequests
return deferred.valueOrThrow();
```
(`cdp/FrameTree.ts:44-48`)

As a result, a `frameNavigated` for a frame that hasn't attached yet is silently dropped, and the handler leaks forever.

**ExecutionContext and isolated worlds.**

- **Creating the utility world.** Puppeteer's world, `__puppeteer_utility_world__<version>`, is installed with `Page.addScriptToEvaluateOnNewDocument({worldName})`. For frames that already exist it uses `Page.createIsolatedWorld` (`FrameManager.ts:521-554`).
- **Classifying contexts.** Each `Runtime.executionContextCreated` is sorted by `auxData.isDefault`, by world name, or by extension origin (`FrameManager.ts:607-666`). The result is passed to `IsolatedWorld.setContext`, which calls `taskManager.rerunAll()` (`IsolatedWorld.ts:102-109`).
- **Disposal.** An `ExecutionContext` disposes on `executionContextDestroyed`, on `executionContextsCleared`, or when its session disconnects (`ExecutionContext.ts:108-121`). Each context subscribes to every `Runtime.*` event on its session, so this is another O(N) fan-out.
- **Evaluating with no context.** The world waits for the next `context` event, raced against `disposed` and a timeout (`IsolatedWorld.ts:149-165`), and the comment on line 156 reads: "The message has to match the CDP message expected by the WaitTask class." Errors are part of control flow and are encoded as strings.

**NetworkManager.**

- **Clients.** There is one manager per page, with any number of clients (the main target, OOPIFs and workers) added through `addClient` (`NetworkManager.ts:134-163`).
- **Interception** is `Fetch.enable({patterns: [{urlPattern: '*'}], handleAuthRequests: true})` plus a disabled cache (`NetworkManager.ts:366-394`).
- **Event orderings.** The orderings the manager must reconcile are documented in one place:

  ```
   * A. `_onRequestWillBeSent`
   * B. `_onRequestWillBeSent`, `_onRequestPaused`
   * C. `_onRequestPaused`, `_onRequestWillBeSent`
   * D. `_onRequestPaused`, `_onRequestWillBeSent`, `_onRequestPaused`, … (crbug.com/1196004)
  ```
  (`cdp/NetworkEventManager.ts:45-76`)

  Redirects reuse the `requestId`, and ExtraInfo events can arrive before or after their counterpart. Whichever half arrives first is stored in maps keyed by network id, and the request is emitted once both halves are present (`NetworkManager.ts:412-440, 474-520`). If interception is on only for auth, paused requests are continued automatically (`NetworkManager.ts:478-489`).
- **Lifecycle.** A request goes `Request → Response → RequestFinished | RequestFailed`, with `RequestServedFromCache` as a side event.
- **Cooperative interception.** `Page.on('request')` is overridden to wrap each handler in `enqueueInterceptAction` (`api/Page.ts:898-923`). After the synchronous emit, `finalizeInterceptions` awaits the queued handlers in sequence and applies the highest-priority decision (`api/HTTPRequest.ts:337-354`). If no handler resolves the request, it stays paused forever.
- **Error filtering.** `#canIgnoreError` swallows `TargetClose` errors and any message containing "Not supported" or "wasn't found" (`NetworkManager.ts:125-132`).

### M4. Locators (Q4)

- **An immutable builder.** Every setter clones the locator (`api/locators/locators.ts:208-273`). There are five kinds: `NodeLocator` (selector or handle), `FunctionLocator` (`waitForFunction`), `MappedLocator`, `FilteredLocator` and `RaceLocator` (`locators.ts:847-1208`). Each compiles to `_wait(): Observable<Handle>`.
- **The click pipeline** (`locators.ts:399-429`):

  ```ts
  return this._wait(options).pipe(
    this.operators.conditions([this.#ensureElementIsInTheViewportIfNeeded,
      this.#waitForStableBoundingBoxIfNeeded, this.#waitForEnabledIfNeeded], signal),
    tap(() => this.emit(LocatorEvent.Action, undefined)),
    mergeMap(handle => from(handle.click(options)).pipe(catchError(/* dispose, rethrow */))),
    this.operators.retryAndRaceWithSignalAndTimer(signal, cause),
  );
  ```
- **Conditions** are `mergeMap(h => merge(...conditions.map(c => c(h, signal))).pipe(defaultIfEmpty(h)))`. They run concurrently and each one uses `ignoreElements` (`locators.ts:166-178`).
- **Retry and timeout** are `pipe(retry({delay: RETRY_DELAY}), raceWith(fromAbortSignal(signal), timeout(this._timeout)))` with `RETRY_DELAY = 100` (`locators.ts:179-192, 1220`). The retry is unbounded and unfiltered. Any failure re-runs the whole pipeline, including re-querying the element.
- **Each precondition:**
  - *Visibility:* `handle.isVisible()` or `isHidden()`, re-polled from Node every 100 ms (`locators.ts:1106-1123`). Element *existence* is waited for in the page through `waitForSelector({visible: false})` (`locators.ts:1133-1154`).
  - *Stable bounding box:* two `getBoundingClientRect()` calls on consecutive rAFs must be equal, retried otherwise. The code comments "we don't use waitForFunction because that relies on RAF" (`locators.ts:327-373`).
  - *In viewport:* `isIntersectingViewport({threshold: 0})`, then `scrollIntoView()`, then poll until intersecting (`locators.ts:378-397`).
  - *Enabled:* only checks `disabled` on native form controls (`locators.ts:291-321`). It ignores `aria-disabled` and `inert`.
- **Race** uses RxJS `race`, where the first *notification* of any kind wins (`locators.ts:1202-1208`). CHANGELOG 20.8.3 had to add "reject the race if there are only failures", and 21.1.1 "do not retry via catchError".
- **Gaps.**
  - There is no hit-target or occlusion check. `ElementHandle.click` scrolls and then clicks at the box centre (`api/ElementHandle.ts:769-777`), so whatever element is on top receives the click.
  - There is a check-then-act window between the bounding-box check and the click.
  - Errors that can never succeed are retried until the timeout.
  - The same `_timeout` is applied to both the inner `waitForSelector` and the outer race.

**How this maps to Effect.**

| Puppeteer locators | Effect |
|---|---|
| `_wait` | `Effect<Handle, LocatorError, Scope>` |
| `conditions` | `Effect.all(checks, {concurrency: "unbounded", discard: true})` |
| `retry({delay})` | `Effect.retry({schedule: Schedule.spaced("100 millis"), while: isRetryable})` |
| `raceWith(timer, abort)` | `Effect.timeout`; fiber interruption replaces the signal |
| `Locator.race` | `Effect.raceAll`, which fails only if every branch fails, the behaviour Puppeteer had to patch in |
| `LocatorEvent.Action` | a span event or a `Stream` |

### M5. Waiting and cancellation (Q5)

**`waitForNavigation` on CDP.**

- **How it works.** `LifecycleWatcher` records `frame._loaderId` and subscribes to lifecycle, navigated, swapped and detached events plus network events. It succeeds when two conditions hold (`cdp/LifecycleWatcher.ts:234-266`):
  - Every expected lifecycle event is present on the frame, and on each child that `_hasStartedLoading`.
  - Either a same-document navigation was seen, or the `loaderId` changed or the frame swapped.
- **Termination.** It ends on a deferred timeout, on frame detach ("Navigating frame was detached"), or on an abort signal.
- **Problem 1: register-before-trigger is left to the user.** The watcher is created when the method is called, so the documented idiom is `Promise.all([page.waitForNavigation(), page.click('a.my-link')])` (`api/Page.ts:1913`).
- **Problem 2: an abort listener leaks.** The listener is added without `{once}` and never removed (`LifecycleWatcher.ts:103-108`).
- **Problem 3: a bug.** `if (result instanceof Error) { throw error; }` throws `undefined`, because `error` is the falsy value from the first race (`cdp/Frame.ts:267-268`).
- **`goto`** builds the watcher before `Page.navigate`, races the command against termination, and then waits for the same-document or new-document promise depending on whether `Page.navigate` returned a `loaderId` (`cdp/Frame.ts:173-208`).

**`waitForNavigation` on BiDi.** This is about 100 lines of RxJS (`bidi/Frame.ts:362-459`). It works as follows:

1. Take the first `navigation` or `historyUpdated` event.
2. Run `#waitForLoad$`, delayed until child frames detach.
3. Race against the navigation's `fragment`, `failed` and `aborted` events.
4. Follow the request redirect chain to the final response.
5. `combineLatest` the result with `#waitForNetworkIdle$`.
6. Race everything against `timeout`, `fromAbortSignal` and frame detach.

**`waitForNetworkIdle`.**

- An in-flight counter is computed for every page from the moment it is constructed, whether or not anything waits on it. Each request does `concat(of(1), merge(failed, finished, response).pipe(filter(id), take(1), map(() => -1)))`, and the results are folded with `mergeScan` into a `ReplaySubject` (`api/Page.ts:836-866`).
- Waiting is `distinctUntilChanged()` followed by `switchMap(over ? EMPTY : timer(idleTime))`, raced against timeout, abort and close (`api/Page.ts:2061-2093`).
- Each completion event costs O(inflight) because of the filter.

**`waitForSelector` and `waitForFunction`** both go through `WaitTask` (`common/WaitTask.ts`).

1. **In-page poller.** It creates a `RAFPoller`, `MutationPoller` or `IntervalPoller` (`injected/Poller.ts`) in the realm with `evaluateHandle`, calls `start()`, and awaits `poller.result()` (`WaitTask.ts:100-158`).
2. **Surviving navigation.** When the realm gets a new context, `rerunAll` aborts the previous run (through `#reruns` AbortControllers) and installs a fresh poller (`WaitTask.ts:92-99, 266-272`).
3. **Error classification by substring.**
   - "Execution context was destroyed", "Cannot find context with specified id" and "DiscardedBrowsingContextError" mean: wait for the rerun.
   - A detached frame means: fail (`WaitTask.ts:201-238`).
4. **Polling mode.** `visible` and `hidden` force rAF polling (`QueryHandler.ts:165-166`).
5. **Shadow DOM.** `MutationPoller` explicitly observes shadow roots, because "a `subtree` observation does not cross shadow boundaries" (`Poller.ts:89-135`).
6. **Termination** stops and disposes the in-page poller (`WaitTask.ts:172-196`). This is the only place where cancellation reaches the page.

**`AbortSignal` history** (from `CHANGELOG.md`):

| Version | Change |
|---|---|
| 19.10.0 | `waitForSelector` |
| 20.0.0 | `waitForFunction` |
| 22.12.0 | `waitForRequest`, `waitForResponse`, `waitForNetworkIdle`, `waitForFrame` |
| 22.15.0 | `waitForNavigation` |
| 23.1.0 | "support signal in WaitFor functions" |
| 23.7.0 | "remove event listeners from AbortSignal in WaitTask" |
| 24.37.0 | `launch` |

**Where it falls short.**

1. It isn't universal. CDP `goto` ignores the signal, and `click`, `type`, `evaluate`, `screenshot` and `pdf` don't accept one.
2. Aborting never cancels the browser-side work. `Page.navigate` and `Runtime.evaluate` keep running.
3. Every API re-implements racing against the signal (`fromAbortSignal`, `throwIfAborted`, ad hoc listeners), each with its own cleanup.
4. Defaults live in mutable page state (`setDefaultTimeout`, `setDefaultNavigationTimeout`), and `timeout: 0` means "wait forever".

### M6. chromium-bidi: the CDP state machines (Q6)

**6a. Target attach and unblock** (`modules/cdp/CdpTargetManager.ts:184-363`, `modules/cdp/CdpTarget.ts:236-328`)

The target lifecycle is `attached(paused) → configuring → unblocked | detached | crashed`. On attach, chromium-bidi does the following:

- **Its own tab.** It ignores the mapper tab (`selfTargetId`).
- **Duplicates.** It drops repeat attaches by target key. Service workers are keyed per *parent session*, because one worker can attach under several pages (`CdpTargetManager.ts:222-235`).
- **By target type:**
  - `tab`: set auto-attach recursively.
  - `page` or `iframe`: `CdpTarget.create`. Then either `maybeContext.updateCdpTarget` when an OOPIF takes over an existing frame, or `BrowsingContextImpl.create`.
  - `worker` or `service_worker`: only kept if an owning realm exists. Otherwise it calls `detach()`, which runs `Runtime.runIfWaitingForDebugger` and then `Target.detachFromTarget`.
  - `shared_worker`: becomes a standalone realm.

**`#unblock`** sends the following in parallel under `Promise.allSettled`:

- `Page.enable` and file-chooser interception;
- `getFrameTree`, used to *restore* child contexts it missed;
- lifecycle events, `Runtime.enable` and `Network.enable` (durable messages);
- the Fetch toggles;
- recursive auto-attach;
- the window id;
- the per-user-context emulation config;
- preload scripts with `runImmediately`;
- `runIfWaitingForDebugger` on the target and on its parent.

It then resolves `unblocked`. The public `contextCreated` event is a **promise event** that waits on `unblocked` (`BrowsingContextImpl.ts:176-207`). (Minor issue: the failure log checks `result instanceof Error` on `allSettled` results, so setup failures are never logged, `CdpTarget.ts:313-321`.) Crashes and detaches delete realms and dispose contexts, and the code notes that CDP reports closed workers as *crashed* (`CdpTargetManager.ts:452-496`).

**6b. Browsing contexts** (`modules/context/BrowsingContextImpl.ts`)

- **Storage.** `BrowsingContextStorage` is flat. Parents and children are stored as **ids** and looked up through storage (`BrowsingContextImpl.ts:290-308`), so there are no dangling object references.
- **Creation** happens from three sources: an attach, `Page.frameAttached` for in-process frames (`CdpTargetManager.ts:155-176`), or frame-tree restore (`CdpTarget.ts:330-367`).
- **Destruction** happens on `Page.frameSubtreeWillBeDetached`, on target detach, or on a document change. A document change means a new `loaderId`, which deletes all children and emits their events (`BrowsingContextImpl.ts:1059-1069`).
- **Disposal order matters** (`BrowsingContextImpl.ts:223-261`):
  1. fail the navigations;
  2. reject the default-realm deferred;
  3. delete the realms;
  4. reject pending DCL and `load` with "navigation canceled";
  5. emit `contextDestroyed`;
  6. *then* dispose the children;
  7. clear buffers and remove the context from storage.

**6c. Realms** (`modules/script/RealmStorage.ts`, `BrowsingContextImpl.ts:365-413, 659-764`)

- **Storage.** `RealmStorage` is a query table. `findRealms({realmId, browsingContextId, executionContextId, origin, type, sandbox, cdpSessionId, isHidden})` scans every realm.
- **Creation.** A `WindowRealm` is created on `executionContextCreated` when `auxData.frameId` matches the context. Internal isolated contexts with an empty name are ignored. Because CDP reports an empty origin for sandboxes, the sandbox origin is copied from the default realm.
- **The default realm is a resettable deferred.**
  - **Reset** on `frameStartedNavigating` for the initial navigation to a non-blank URL (`BrowsingContextImpl.ts:533-549`), on `executionContextDestroyed` for the current realm (`:738-744`), and on `executionContextsCleared` (`:753-760`).
  - **Resolved** on `executionContextCreated` with `isDefault`. It is *also* resolved on `frameNavigated` when CDP reused the context. As the code says, "navigating from initial about:blank to a same-site URL … no `Runtime.executionContextCreated` event is emitted" (`BrowsingContextImpl.ts:505-517`).
- **Sandboxes** are created lazily with `Page.createIsolatedWorld`, after waiting for the default realm. When provisional frames create duplicates, "it's always the first one (i.e. the oldest one) that is more relevant" (`BrowsingContextImpl.ts:378-413`).
- **The mapper's own helper sandbox** is a hidden uuid (`BrowsingContextImpl.ts:70, 130-131`).

**6d. The navigation tracker** (`modules/context/NavigationTracker.ts`)

`NavigationState = {navigationId: uuid, url, loaderId?, isInitial, isFragmentNavigation?, started, committed: Deferred<void>, finished: Deferred<NavigationResult>}` (`NavigationTracker.ts:50-182`). The tracker holds `#lastCommittedNavigation`, `#pendingNavigation`, and a `loaderId → NavigationState` map.

| Input | Transition |
|---|---|
| command | `createPendingNavigation(url)`. Any pending navigation fails with "canceled by concurrent navigation" (`:272-294`) |
| `Page.frameStartedNavigating(url, loaderId, type)` | Cancels a pending navigation whose `loaderId` differs. Reuses the state for a known `loaderId` and updates whether it is a fragment navigation, since `sameDocument` can become `differentDocument`. Otherwise adopts the pending navigation or creates one. `start()` emits `navigationStarted` unless the navigation is initial or a fragment (`:467-509`) |
| `Page.frameNavigated` | With `unreachableUrl`: fails it ("the requested url is unreachable"). Otherwise resolves by `loaderId`, then pending, then new. Fails the previous committed navigation if it is a different one. Resolves `committed` and emits `navigationCommitted`. A bfcache restore is marked loaded immediately (`:338-387`) |
| `Page.navigatedWithinDocument` | Always updates the URL. Only `fragment` finishes a fragment navigation (`:389-424`). `historyApi` emits `historyUpdated` instead (`BrowsingContextImpl.ts:558-582`) |
| `Page.lifecycleEvent load` (matching `loaderId`) | `load()` and clears the initial flag (`:431-437`) |
| `Network.loadingFailed` with `requestId === loaderId` | `fail`. It is *failed* if not yet committed and *aborted* if committed (`:171-181, 522-524`) |
| `Browser.downloadWillBegin` | The download takes over the pending navigation id (`:533-561`) |

**`navigate`** creates the pending navigation, sends `Page.navigate`, and races `#waitNavigation(wait)` against `navigationState.finished` (`BrowsingContextImpl.ts:1103-1168`). For readiness:

- `none` waits for commit and for the command to return;
- a fragment navigation waits for `finished`;
- `interactive` waits on the DCL deferred;
- `complete` waits on the `load` deferred (`:1170-1203`).

Lifecycle deferreds are swapped out on document change and only accept events for the current `loaderId`. When the mapper attaches late and misses `init` and `commit`, it adopts the first `loaderId` it sees (`BrowsingContextImpl.ts:584-657`). `browsingContext.create` waits for the initial `about:blank` load so that stale DCL and `load` events don't leak into the next navigation (`modules/context/BrowsingContextProcessor.ts:144-154`, WPT #35846).

**6e. Preload scripts** (`modules/script/PreloadScript.ts`, `ChannelProxy.ts`)

- **Ids.** One BiDi id maps to many CDP ids, one per target. Each target gets `Page.addScriptToEvaluateOnNewDocument({source, worldName: sandbox, runImmediately})` with the user function wrapped to receive channel arguments (`PreloadScript.ts:39-156`).
- **New targets** get the matching scripts during unblock with `runImmediately: true` (`CdpTarget.ts:653-668`). Scripts are disposed per target on detach (`CdpTargetManager.ts:456-460`).
- **Channels** don't use `Runtime.addBinding`. Instead, each channel is an in-page FIFO object that the mapper long-polls with a pipeline of `Runtime.callFunctionOn(getMessage, {awaitPromise: true})` calls (`ChannelProxy.ts:73-112, 177-240`). Listeners are re-attached for every new realm (`BrowsingContextImpl.ts:720-728`).
- **A bug.** `remove()` does `Promise.all([this.#cdpPreloadScripts.map(…)])`, wrapping the array in another array, so the removals are never awaited (`PreloadScript.ts:161-174`).

**6f. Network** (`modules/network/NetworkStorage.ts`, `NetworkRequest.ts`)

- **One request object per CDP request id**, across all targets. It is created by whichever event arrives first. Requests can migrate between targets through `updateCdpTarget` (`NetworkStorage.ts:126-216`).
- **Slots of raw facts.** `NetworkRequest` keeps `#request.{info, extraInfo, paused, auth}` and `#response.{info, extraInfo, paused, loadingFinished, loadingFailed}` (`NetworkRequest.ts:94-122`). Derived getters pick the most authoritative source; for the URL, a paused response beats overrides, which beat the response, and so on (`:170-185`).
- **Emit when ready.** `#emitEventsIfReady` emits each BiDi event once its prerequisites are satisfied. For example, `beforeRequestSent` needs `info` plus either `extraInfo`, or a pause when interception is expected (`:506-579`). `#emittedEvents` guards emit-once, with an exception for `authRequired` (`:129-135, 929-962`).
- **Interception.** A `Fetch.requestPaused` blocks the request (sets `#interceptPhase`) only if a matching intercept exists *and* the client is subscribed. Otherwise it is continued automatically (`:671-707`). `waitNextPhase` is a deferred that is replaced on every phase change (`:471-474`).
- **Fetch enablement is reconciled.** Required stages are computed from the intercepts, and `Fetch.enable` or `disable` is sent only on change (`CdpTarget.ts:369-423`). Fetch is never disabled while any request is still blocked (`:582-595`).
- **Async enrichment keeps its place.** Events that need async enrichment, such as the cookies for paused requests, are registered as promise events so their position in the queue doesn't change (`NetworkRequest.ts:964-982`).

**6g. Input** (`modules/input/*`)

- **State.** There is one `InputState` per *top-level* context. It holds:
  - input sources by id (`none`, `key`, `pointer` or `wheel`; the mouse is pointer 0, other pointers are allocated from 2);
  - a global key state merged across sources;
  - `cancelList`, an undo log;
  - a mutex queue (`InputState.ts`).
- **`performActions`** runs on that queue (`InputProcessor.ts:43-64`). It builds ticks, then dispatches every action in a tick concurrently, with tick duration = max(action durations) (`ActionDispatcher.ts:153-201`). Each `keyDown` or `pointerDown` pushes its inverse onto `cancelList`. `releaseActions` replays the list in reverse and resets the state (`InputProcessor.ts:65-89`).
- **Pointer moves** are interpolated by elapsed time over the duration (`ActionDispatcher.ts:435-506`). Zero-duration hover moves are deferred, because Chromium aligns `mouseMoved` to rAF (`:113-119`).
- **Double and triple clicks** are synthesized by `ClickContext` (within 500 ms and 2 px), because `Input.dispatchMouseEvent` has no click count (`InputSource.ts`).
- **The context is looked up again on every tick**, since it "can be disposed between action ticks" (`ActionDispatcher.ts:131-136`).

**6h. Ordering and delivery** (`src/utils/ProcessingQueue.ts`, `BidiServer.ts`, `modules/session/EventManager.ts`)

- **Commands run concurrently** (`void processCommand(...)`, `BidiServer.ts:64-69`).
- **Every outbound message goes through one queue.** Responses and events alike are added as a `Promise<Result<OutgoingMessage>>` and drained strictly FIFO (`ProcessingQueue.ts:21-81`; `BidiServer.ts:93-96, 201-209, 280-291`). As a result, events that occurred before a command completed are delivered before its response, even when their payload is still being enriched.
- **Buffering.** `log.entryAdded` is buffered, 100 entries per context, and replayed to new subscribers (`EventManager.ts:93-95, 309-327`).
- **Subscribe hooks** emit synthetic `contextCreated` events for contexts that already exist (`EventManager.ts:329-333`; `BrowsingContextProcessor.ts:57-60`).
- **Reconciliation on (un)subscribe.** `toggleModulesIfNeeded` reconciles CDP domains for every context (`EventManager.ts:356-364`).
- **Incoming commands** are validated with zod schemas generated from the CDDL (`src/protocol-parser/protocol-parser.ts:34-60`). Outgoing events are typed but not validated.

### M7. Known pain points from issues and changelogs (Q7)

This section draws on GitHub issues and PRs, pptr.dev, MDN, w3.org and Mozilla posts. Each finding cites its source. Version entries were checked against the cloned `CHANGELOG.md` where possible.

**Parity gaps.**
- **Features unsupported under BiDi.** pptr.dev/webdriver-bidi (docs for v25.14.0) lists Accessibility, Coverage and Tracing as entirely unsupported. It also lists:
  - `emulateCPUThrottling`, `emulateIdleState`, `emulateMediaFeatures`, `emulateMediaType` and `emulateVisionDeficiency`;
  - `setBypassCSP`, `emulateNetworkConditions` and `setOfflineMode`;
  - `createCDPSession`, `metrics` and `queryObjects`;
  - screencast, drag-and-drop and `PageEvent.popup`;
  - `HTTPRequest.resourceType` and `HTTPResponse.securityDetails`.
- **Partially supported options.** `goto` ignores `referer`; `reload` ignores `ignoreCache`; `setViewport` takes only width, height and DPR; `screenshot` and `pdf` accept subsets of their options. Selectors work "except for ARIA".
- **The docs lag the code.** Response bodies became available through BiDi data collectors in 24.13.0 (#14016; `bidi/Browser.ts:122-135` creates collectors capped at 20 MB). The page still lists them as unsupported. Use runtime capability probing *and* types, not a static list.
- **Firefox moved to BiDi:**
  - Puppeteer 23.0.0 (2024-08-07) defaults Firefox to BiDi (#12732).
  - 24.0.0 removes Firefox-over-CDP (#13427).
  - Firefox 141 (2025-07) removed its CDP implementation (MDN release notes).
- **Close-ordering bug.** `Page.close()` over BiDi failed because Puppeteer closed nested contexts before the top-level one, and BiDi only accepts top-level closes. Fixed in #14549 (CHANGELOG ~24.33).
- **Request leak in the BiDi path.** Disposed `Request`s for `data:` URLs were never removed from `BrowsingContext.#requests` (PR #14916, closed unmerged). This is a concrete example of the per-object bookkeeping leaks the M2 design invites.

**Recurring Puppeteer bug classes.**
- **The `waitForNavigation` race** (#1412, 2017, which led to the `Promise.all` idiom).
- **Navigation hangs.** PR #15488 (open, 2026-09-23) reports that `goto` awaits `navigationResponse()` with no timeout and "leaves `goto` pending forever" when a follow-up navigation happens, *while BiDi resolves*. This is a CDP/BiDi semantic split in a single API.
- **"Execution context was destroyed"** (#3323, #13056 where an uncaught throw via dispose crashes Node, and the 22.12.1 fix #12666 "execution contexts might be created before previous is destroyed").
- **"Navigating frame was detached" masking a broken WebSocket** (#13400, 41 comments; `pipe: true` made it go away).
- **"Target closed" during auto-attach** (#1947, #10153), and target-close errors in NetworkManager (24.10.2, #13946).
- **OOPIFs.** Requested in 2018 (#2548), integrated into the frame manager in 11.0.0 (#7556), and still incomplete. #10017 (open) reports interception and request events missing for OOPIFs; #10715 reports `evaluate` hanging when a frame becomes an OOPIF.
- **Interception stalls.** #5003; #3471 calls the `requestWillBeSent`↔`requestPaused` matching heuristics unreliable; #4041 notes that responses served by a service worker aren't intercepted.
- **`waitForNetworkIdle`.** The in-flight count gets stuck (#11235), the idle timer was reset incorrectly (fixed in 24.12.1, #14005), and it differs from `networkidle0` (#8509).
- **Service workers poison auto-attach.** `connect` hangs waiting for an attach that never comes (#11627, open).
- **Leaks.** `NetworkEventManager` maps grow when navigating away before load (#9186, closed "not planned"). The AbortSignal listener leak in WaitTask was fixed in 23.7.0.
- **AbortSignal arrived API by API.** Earlier entries: 19.10.0 `waitForSelector` (#10018); 20.0.0 `waitForFunction` (#10078).
- **Locator pain.**
  - #11893: filter predicates run in the page, so captured variables silently time out.
  - #12194: errors carry no stack pointing at where the locator was built.
  - #12508: no `getByLabel` or `getByTitle`.

**chromium-bidi.**
- **Overhead.** BiDi-over-CDP script evaluation measured 1.47 ms per call against 0.165 ms for raw CDP, about 9× (#3974, 2026-01). The maintainers attribute it to the translation layer. `navigate` measured 391 ms against 51 ms for classic WebDriver on macOS (#4240). For us this means: if we speak CDP directly, don't route through a BiDi mapper on the hot path.
- **Navigation heuristics.** #2856 says CDP heuristics "do not always allow for proper events emitting". PR #3236 (2025-03) moved to `Page.frameStartedNavigating`, which matches the tracker in 6d. Other edge cases:
  - #2425: `fragmentNavigated` was emitted for `pushState` (fixed).
  - #2894: `traverseHistory` emits no navigation events.
  - #2082: bfcache.
- **OOPIF emulation.** #3532: "emulations are not apply to OOPiF and are reset when an iFrame is moved out of process". This is exactly why chromium-bidi reapplies context config during `#unblock`.
- **Workers.** #3702: "worker targets also receive all CDP commands that do not apply".
- **Repository move (as of Sept–Oct 2026).** The README says the source has moved into Chromium (`third_party/chromium-bidi`) and issues go to crbug. Future history will therefore be on crbug, not GitHub.

**Spec status and adoption.**
- **The W3C draft (2026-10-08) has no tracing, coverage, accessibility-tree or performance-metrics modules.** It does now define screencast, `navigationCommitted`/`navigationAborted`/`historyUpdated`, download events, data collectors (`addDataCollector`/`getData`, with sizes declared up front), network conditions and several emulation overrides.
- **Adoption.** Selenium removed Firefox CDP in 4.29.0 (2025-02). WebdriverIO v9 defaults to BiDi. Cypress 14.1 uses BiDi for Firefox 135+.
- **Playwright's BiDi gap list (#32577, open, updated 2026-08).** It includes content quads for clicks, `DOM.describeNode` equivalents, per-user-context proxy and headers, and `resourceType`. On the Firefox side: "Navigation ID stays the same across different navigations" and "`script.realmDestroyed` arrives after `contextDestroyed`". The second shows that terminal-event *order* between modules cannot be assumed, so our state machines must accept either order.

---

## Ergonomics: what to steal, what to avoid

### Puppeteer at its best

```ts
await page.locator('button').click();                                   // waits + actionability + retry
const enabled = await page.locator('button').map(b => !b.disabled).wait();
await Locator.race([page.locator('.cookie-accept'), page.locator('#app')]).wait();
await using browser = await puppeteer.launch();                         // close-or-disconnect on scope exit
using email = await page.waitForSelector('input[type=email]');          // ElementHandle<HTMLInputElement>
await page.locator('::-p-text(Submit)').click();                        // p-selectors; `>>>` pierces shadow DOM
await page.waitForNetworkIdle({idleTime: 500, concurrency: 2});
```

**How the internals make these possible:**

- **Locators** are inert values until a terminal call (`click`, `fill`, `wait`). They hold no handle, so nothing can go stale between steps.
- **Typed selectors.** The CSS is parsed at the type level: `NodeFor<S> = ParseSelector<S>`, from `typed-query-selector` (`common/types.ts:113-114`).
- **Ownership-aware disposal.** `Browser[asyncDisposeSymbol]` closes the browser if it launched it and disconnects otherwise (`api/Browser.ts:906-913`). `@moveable` plus `.move()` hands ownership out of a `using` block (`api/JSHandle.ts:39, 147-163`).
- **Helper injection.** `LazyArg` resolves the injected helper bundle for each execution context, so user code never sees the bootstrapping. Running helpers in an isolated world protects them from page globals.
- **Shared serialization.** Screenshots are serialized browser-wide (`@guarded` on the browser key, `api/Page.ts:2889-2895`) and per context (`BrowserContext.startScreenshot`, `api/BrowserContext.ts:142-153`). A temporary viewport change is restored through `AsyncDisposableStack.defer` (`api/Page.ts:2950-2985`). Users get correct concurrent screenshots without thinking about it.

### Puppeteer at its worst

1. **The user has to register before triggering.**

   ```ts
   const [response] = await Promise.all([
     page.waitForNavigation(),     // must subscribe before the click
     page.click('a.my-link'),
   ]);
   ```
   (`api/Page.ts:1910-1916`) If the user writes the obvious sequential version, the wait misses fast navigations and then hangs until the timeout.
2. **Interception is a listener protocol over shared mutable state.**

   ```ts
   await page.setRequestInterception(true);
   page.on('request', req => {
     if (req.isInterceptResolutionHandled()) return;
     if (req.url().endsWith('.png')) req.abort(); else req.continue();
   });
   ```
   The guide warns: "Always assume that an unknown handler may have already called abort/continue/respond", and the check is "only safe in a synchronous code block" (`docs/guides/network-interception.md:33-43`). If the user forgets to resolve, the page stalls. Priorities are bare numbers that each call opts into separately. `on('request')` quietly changes meaning from observer to middleware (`api/Page.ts:898-923`).
3. **Closures aren't closures.** `.filter(b => b.textContent === name)` is serialized, so `name` is undefined in the page. The guide's workaround is string-building: `` .filter(`button => button.textContent === ${JSON.stringify(buttonName)}`) `` (`docs/guides/page-interactions.md:152-159`).
4. **There are three clicks with three semantics.**
   - `page.click(sel)` does `$` and `assert`, with no waiting, and fails with "No element found for selector" (`api/Frame.ts:1084-1093`). The guide claims it uses `waitForSelector` (`page-interactions.md:269-271`).
   - `handle.click()` scrolls and clicks a coordinate, with no checks.
   - `locator.click()` waits, checks preconditions and retries.
5. **Timeouts and cancellation are inconsistent.** There are mutable page-level defaults, per-call `timeout` options, `timeout: 0` meaning infinite, and a per-locator `setTimeout`. `signal` is accepted by some APIs and silently ignored by CDP `goto`.
6. **Handles leak unless disposed.** The guide says `waitForSelector` "requires manually disposing the resulting ElementHandle to prevent memory leaks" (`page-interactions.md:239-240`).
7. **Error messages lack context.**
   - "Execution context was destroyed, most likely because of a navigation." doesn't say which operation failed (`cdp/ExecutionContext.ts:558-565`).
   - "Node is either not clickable or not an Element" covers hidden, zero-size, detached and non-element alike (`api/ElementHandle.ts:735`).
   - Apart from `TimeoutError`, `TargetCloseError`, `ProtocolError` and `UnsupportedOperation`, the library itself tells errors apart by `message.includes`, so users can't do better.
8. **Capabilities are discovered at runtime.** `UnsupportedOperation` only appears when the BiDi path runs.
9. **Dialogs block.** The BiDi session sets `unhandledPromptBehavior: ignore` (`bidi/Browser.ts:92-94`), so an unhandled `alert` stalls the page unless someone listens for `page.on('dialog')`.

### What to steal

- **Locators as inert, immutable values** that compile to one retrying effect. Give them actionability defaults that can be configured per call.
- **Type-level selector parsing.**
- **Ownership-aware disposal.** Launched resources close, connected ones disconnect.
- **Isolated-world helpers** for every built-in operation.
- **Built-in serialization** of operations that mutate shared state, such as viewport changes during full-page screenshots.
- **Waits that survive navigation**, in the style of `WaitTask` reruns.

### What to avoid

- **Register-then-trigger as user responsibility.** Provide `expect*` combinators that subscribe first. In Effect, run the trigger inside a scope where the subscription already exists (L6).
- **Interception through event emitters.** Use a scoped handler that returns a decision value and falls back to a total default (L9).
- **Selectors that silently capture nothing.** Require explicit `args` for page functions, as in `page.evaluate(fn, ...args)`, and make page-side callbacks type-check against a `Serializable` constraint.
- **Global mutable timeouts.** Use `Effect.timeout` at call sites, with a `Context.Reference` default that can be overridden in a scope.
- **Untyped errors.** Use `Schema.TaggedError` with operation context (selector, frame URL, phase).

---

## What works well

- **`bidi/core` as an event-sourced projection** with scoped subscriptions and disposal driven by terminal events, plus synthetic events for initial state (M2).
- **Pause, configure, resume on attach.** Puppeteer's `waitForDebuggerOnStart` flow (`Ready` fired synchronously before resume) and chromium-bidi's `#unblock`, with `contextCreated` gated on it.
- **Holding events back** until the snapshot (`getFrameTree`) is applied, so order is preserved (`FrameManager.ts:184-227`).
- **chromium-bidi's normalized storages**, with id references and query filters, instead of an object graph.
- **The navigation tracker**: explicit pending and committed states, `loaderId` as the correlation key, a fixed cancellation vocabulary ("canceled by concurrent navigation" / "context disposal"), bfcache and same-site context reuse handled, and the distinction between *failed* (before commit) and *aborted* (after commit).
- **Slots plus emit-once** for network events whose arrival order is undefined, and **promise events in one FIFO queue** to keep ordering while enrichment runs.
- **Reconcilers that diff desired state against applied state** (`toggleFetchIfNeeded`, `toggleModulesIfNeeded`) instead of imperative enable and disable calls scattered through the code.
- **The input undo log** (`cancelList`) and the per-top-level-context mutex.
- **In-page pollers**, including `MutationPoller`'s handling of shadow roots, which avoid round trips for each poll.

## Pitfalls

- **Errors classified by message substrings** throughout Puppeteer: `WaitTask`, `ExecutionContext`, `NetworkManager.#canIgnoreError`, `CdpSession`, and BiDi `goto`. Some messages even have to be *forged* to match (`IsolatedWorld.ts:156`).
- **O(N) fan-out.** Every Request, Realm and ExecutionContext subscribes to the whole session and filters by id.
- **Silent drops and hangs:**
  - `FrameTree.waitForFrame` (`cdp/FrameTree.ts:44-48`);
  - interception with no resolver;
  - `BrowsingContextStorage.waitForContext` has no timeout or cancellation (`modules/context/BrowsingContextStorage.ts:79-95`);
  - the never-awaited preload removal (`PreloadScript.ts:161-174`);
  - setup failures that are never logged (`CdpTarget.ts:313-321`).
- **Mutated identity.** `WindowRealm.id` changes on navigation (M2). Frame ids are re-keyed on swap and activation (`FrameManager.ts:157-178, 497-513`).
- **Cancellation doesn't reach the browser.** It stops waiting but not the work, and there is no `Page.stopLoading` on abort.
- **Promise-race plumbing hides bugs** like `throw error` versus `throw result` (`cdp/Frame.ts:267-268`). Abort listeners leak (`LifecycleWatcher.ts:103-108`).
- **The PDF stream never closes on cancel.** `getReadableFromProtocolStream` has no `cancel()`, so a consumer that stops early leaks the `IO` handle (`common/util.ts:238-255`).
- **Interception is global.** `Fetch.enable({urlPattern: '*'})` also disables the cache whenever interception is on (`NetworkManager.ts:366-394`).
- **Service-worker attach changes their lifetime**, so Puppeteer has to choose between observability and the browser's normal behaviour (`TargetManager.ts:362-416`).

---

## Lessons and candidate abstractions for an Effect-native design

Each item lists the Puppeteer or chromium-bidi evidence, the abstraction we should build, and how it maps to Effect 4. The Effect 4 module and function names were checked against the locally installed `effect@4.0.4` type declarations, not against 4.0.5; the tables summarize which names were confirmed.

**L1. Model capabilities as services, not one fat class.**
- **Why:** Puppeteer's fat abstract classes plus runtime `UnsupportedOperation` (M1).
- **Design:** Split capabilities into services: `Navigation`, `Script`, `Dom`, `Input`, `Network`, `Interception`, `Emulation`, `Screenshot`, `Pdf`, `Storage`. CDP-only services are separate: `Tracing`, `Coverage`, `HeapProfiler`, `Accessibility`, `CdpSession`.
- **Effect mapping:** Each is a `Context.Service`. The driver layers are `Layer<Navigation | Script | … , never, BrowserConnection>`. Only the CDP and Chrome-BiDi layers provide `Tracing`, so using tracing on Firefox becomes an unsatisfied `R` and fails at compile time. The `goog:cdp` tunnel is just another `CdpSession` layer built from a BiDi connection, which is what Puppeteer does dynamically.

**L2. A typed protocol client.**
- **Why:** callback registries with string errors (M3).
- **Design:** `send(cmd)` is `Effect<A, ProtocolError | SessionClosed | ConnectionClosed>`. Pending calls are a `MutableHashMap<id, Deferred>`. Closing a session fails them all with a *typed* `SessionClosed {sessionId, reason}`. Interrupting the caller removes its entry; document that the remote side is not cancelled.
- **Schemas:** Generate Effect `Schema`s for commands and events from CDP's `browser_protocol.json` and the BiDi CDDL, the same way chromium-bidi generates zod from CDDL. Decode events at the edge, either lazily or only for subscribed methods, so the firehose isn't validated twice.

**L3. Target lifecycle as a scoped resource with an init phase.**
- **Why:** pause on attach, then `Ready` / `#unblock` (M3, 6a).
- **Design:** A `TargetInit` registry where features contribute `(session) => Effect<void>`. The attach handler runs them all, then `runIfWaitingForDebugger`.
- **Effect mapping:** Model each `CdpSession` as `Scope`-owned, under a `Scope.fork` of its parent's scope. Detach and crash close the scope, and finalizers handle the cleanup (realms, contexts, preload bookkeeping). Make the public "context created" depend on init finishing, the way chromium-bidi gates `contextCreated`.

**L4. A normalized state store and an event-sourced projection.**
- **Why:** chromium-bidi's storages plus `bidi/core`'s "events are the only writers".
- **Design:** One `BrowserState` (contexts, realms, navigations, requests) updated by a single fiber that consumes protocol events in order. It exposes queries and change streams.
- **Effect mapping:** `SubscriptionRef<BrowserState>`, or `TxHashMap` / `TxSubscriptionRef` for transactional updates across tables. Use `Stream.changes` for derived waits. Use stable *ids* instead of object pointers. Instead of mutating ids, model "current realm for (context, sandbox)" as derived state.

**L5. Route events by key, not by broadcast.**
- **Why:** O(N) filtering in Puppeteer.
- **Design:** The demultiplexer keys events by `(sessionId, method, primary id)`.
- **Effect mapping:** `PubSub` per session plus a keyed router (`Stream.groupByKey`, or a `HashMap<key, Queue>`). Each subscription is `Stream.fromPubSub` inside a `Scope`, so unsubscribing is automatic, like `bidi/core`'s wrapper emitters but structural. Give late subscribers bounded replay buffers, as chromium-bidi does for `log.entryAdded`.

**L6. Navigations as first-class handles.**
- **Why:** chromium-bidi's `NavigationState` and pending navigations (6d) versus Puppeteer's `Promise.all` idiom (M5).
- **Design:** `page.navigate(url)` returns `Navigation { id, committed: Effect<void, NavigationFailed>, settled(readiness): Effect<Response | null, NavigationError> }`. The tracker is a pure state machine, `(State, CdpEvent) => [State, Emit[]]`, which makes it easy to unit-test against recorded traces.
- **Navigations a user action triggers:** `Page.expectNavigation(trigger)` subscribes to `navigationStarted` *first* (as a scoped stream fork), runs `trigger`, and returns the handle. The subscription is created before the trigger runs, which removes the race.

**L7. Waiting that survives realm changes.**
- **Why:** `WaitTask` reruns (M5).
- **Design:** A `waitFor(predicate)` that runs a page-side poller in the current realm and restarts the poller on every realm change.
- **Effect mapping:** `realmChanges: Stream<Realm>` piped through `Stream.switchMap(realm => Stream.fromEffect(runPollerIn(realm)))`. The poller is installed with `Effect.acquireRelease`, with `poller.stop()` and `releaseObject` as release. `ContextDestroyed` is a typed *retryable* error, so no string matching is needed. Wrap the whole thing in `Effect.timeout`, and let interruption replace `AbortSignal` everywhere.

**L8. Locators as data plus an interpreter.**
- **Why:** M4.
- **Design:** `Locator<A>` is a description of a query (selector, role, function), filters and maps, plus actionability options. Actions are `Effect<void, ActionError, Page>`.
- **Effect mapping:** Preconditions are an `Effect.all` of checks. The retry is `Effect.retry({schedule: Schedule.spaced("100 millis"), while: isRetryable})`. `race` uses `Effect.raceAll`. Add the missing **hit-target check**: `elementFromPoint` at the click point must be the target or one of its descendants. Use typed failure reasons: `NotAttached | NotVisible | Disabled | Unstable | Obscured | OutOfViewport`.

**L9. Interception as a scoped handler that returns a decision.**
- **Why:** Puppeteer's listener protocol versus chromium-bidi's phases and reconciler (6f).
- **Design:** `Network.intercept(pattern, phase, handler: Request => Effect<Decision>)` is scoped. Acquiring it adds the intercept, and `Fetch.enable` is reconciled from the set of live intercepts; release removes it. `Decision = Continue(overrides?) | Fulfill(response) | Fail(reason) | Pass`. Multiple handlers fold in registration order, and the first non-`Pass` wins, which makes priorities explicit.
- **Totality:** If a handler fails or times out, the request is continued and the error is surfaced, so a request is never left stalled. Never disable Fetch while requests are still paused.

**L10. Input with the compensation built in.**
- **Why:** 6g.
- **Design:** One input actor per top-level context. Pressing a key or button is a resource.
- **Effect mapping:** A per-context `Semaphore.make(1)` plus a `Ref<InputState>`. `keyDown` and `pointerDown` are `Effect.acquireRelease`, with the matching up event as release, so interrupting a drag never leaves a button stuck. That is chromium-bidi's `cancelList`, enforced by `Scope`.

**L11. Binary outputs as resource-safe streams.**
- **Why:** the PDF stream leak.
- **Design:** `Pdf.stream(opts): Stream<Uint8Array, PdfError>` acquires the `printToPDF` handle in a scope (`IO.close` as finalizer) and pulls `IO.read` with `Stream.paginate` or `Stream.fromPull`. Screencast and recording work the same way as `Stream`s with scoped start and stop.
- **Shared state:** Full-page screenshots use `acquireRelease(setViewport(full), restore)` under a browser-level `Semaphore`, mirroring Puppeteer's `@guarded`, `startScreenshot` and `AsyncDisposableStack`.

**L12. Order delivery without blocking on enrichment.**
- **Why:** chromium-bidi's `ProcessingQueue` (6h).
- **Design and mapping:** Model user-visible events as `Stream.mapEffect(enrich, {concurrency: n})`, which keeps output order while enriching concurrently. Give responses to our *own* commands the same treatment, so a command's result is observed after the events it caused.

**L13. Typed, contextual errors.** Use `Schema.TaggedError`s:
- `TargetClosed {target, reason}`
- `ContextDestroyed {frameId, during}`
- `NavigationFailed {url, errorText}` and `NavigationAborted {url, by: "concurrent" | "dispose"}`
- `Timeout {operation, after}`
- `ProtocolError {method, code, message}`
- `Unsupported {capability, driver}`, which should be rare thanks to L1
- `ActionError {selector, reason}`

These replace every substring check.

---

## Open questions

1. **Identity of the default realm.** Should we expose stable `(frame, world)` handles that rebind on navigation, as `bidi/core` does with `WindowRealm`, or immutable realm values that fail with `ContextDestroyed`? The first makes nicer call sites, the second is more honest. Possibly both: a `Realm` value, plus a `Frame.world(name)` *reference* that re-resolves.
2. **CDP first, then BiDi: embed chromium-bidi or reimplement?** Running the mapper in-process (Puppeteer's `BidiOverCdp`) gives BiDi semantics over CDP for free, at the cost of an extra layer. Alternatively, we could port its trackers (navigation, network slots, input) to Effect as the CDP driver's state core, so that "CDP driver" and "BiDi semantics" share one model.
3. **Service workers.** Do we stay attached, which keeps them alive, or attach on demand? Puppeteer flips this behaviour depending on whether network rules exist.
4. **Event validation cost.** Should we decode every CDP event with `Schema` or only the subscribed and typed ones? We need a performance budget for the firehose, especially `Network.*` and `Runtime.consoleAPICalled`.
5. **Hit-target checks versus speed.** For scraping and AI-agent workloads, actionability checks (stability over two rAFs, hit-testing) add round trips on every action. Should actionability be a policy chosen per call or per layer, for example `strict`, `fast` or `none`, with typed failure reasons whichever is chosen?
6. **Prerender, bfcache and activation.** Puppeteer disables prerendering under BiDi. Should we expose prerender targets at all, or only after activation?
7. **Cancelling a navigation.** On interrupt, should `navigate` issue `Page.stopLoading` or `browsingContext.navigate` to `about:blank`? Neither library does.
