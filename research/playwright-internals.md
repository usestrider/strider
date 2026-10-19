# Playwright server internals: prior art for an Effect-native browser library

- **Source:** `microsoft/playwright` at commit `b335271cdc2b57cac2be8ad37c5dd283ac6b8938` (2026-10-17, "chore(chromium): remove switches..."), root `package.json` version `1.65.0-next`. Shallow clone at `/tmp/prior-art/playwright`.
- **Paths:** All paths below are relative to `packages/`. `core/` is short for `playwright-core/src/` and `inj/` is short for `injected/src/`.
- **Method:** I read the source only. I did not run, install or build anything. GitHub issue numbers come from `gh search issues` and `gh issue view`.

---

## Summary

- **Two halves.** Playwright is a typed RPC system with a browser driver behind it. The protocol is declared in `protocol/spec/*.yml` and generated into `channels.d.ts` and `validator.ts`. The client is a thin set of `ChannelOwner` proxies. All the hard logic lives in the server: `core/server/**`, plus the injected page script in `inj/`. The split exists so that Python, Java and .NET can drive one Node server. That choice drives most of the design, and most of the costs.
- **Cancellation is cooperative "race and abandon".** It is not real cancellation. `Progress.race(p)` races `p` against a rejected-on-abort promise (`core/server/progress.ts:108-125`). The losing work keeps running. Cleanup happens only where someone remembered to write it, for example `raceUncancellableOperationWithCleanup` and in-page `abort()` handles. This is the biggest thing Effect can do strictly better.
- **Timeouts are deadlines owned by the server.** The client computes `timeout` and sends it in call metadata. The server arms one timer per call. Since 1.6x every API also takes `signal?: AbortSignal`, which travels as an `__abort__` wire message.
- **Every element-touching action is two nested retry loops.** The outer loop re-resolves the selector with backoff `[0,20,50,100,100,500]` ms (`frames.ts:1143-1179`). The inner loop handles actionability with waits `[0,20,100,100,500]` ms (`dom.ts:330-383`). Inside the inner loop, scroll alignment cycles through four strategies to escape sticky headers. "Stable" means two consecutive `requestAnimationFrame` samples with an identical bounding box (`stableRafCount=1` on Chromium, `5` on WebKit/Windows).
- **The hit-target check has two layers.** A pre-check with `elementsFromPoint` walks shadow roots and iframes. Then a capture-phase interceptor on `window` validates the *actual* trusted event, and suppresses it if the target moved (`inj/injectedScript.ts:1119-1220`).
- **Locators are immutable selector strings.** Building one has no side effects. They are resolved from scratch on every attempt, in an isolated "utility world", and handles are adopted into the main world only when returned.
- **Navigation is tracked per document.** The document id is CDP `loaderId`, kept as `_pendingDocument` and `_currentDocument`. Playwright synthesizes `networkidle` itself: 500 ms with zero in-flight requests across the whole frame subtree. Actions automatically wait for navigations they trigger via a ref-counted `SignalBarrier`.
- **OOPIFs come from `Target.setAutoAttach({waitForDebuggerOnStart, flatten})` at every level.** Each target gets a `FrameSession`. Frame id equals target id. Attach events are buffered until `Page.getFrameTree` arrives. A cheap `Page.enable` round trip serves as an ordering barrier.
- **Web-first assertions (`expect(locator)`) poll on the server.** The client makes one RPC. The server does a one-shot check, then a backoff loop. `expect.poll` and `toPass` poll on the client with `[100,250,500,1000]`.
- **Network interception is all or nothing on CDP.** Any route turns on `Fetch.enable({urlPattern:'*'})` and disables the cache. URL matching happens in Playwright. Requests are correlated with `Network.requestWillBeSent` via `networkId`.
- **Licensing.** The server and the injected script are Apache-2.0, © Microsoft. The `NOTICE` file credits Puppeteer. The exceptions are `inj/clock.ts` (BSD-3, derived from sinon fake-timers) and `isomorphic/cssTokenizer.ts` (CC0).
- **The biggest lessons for us:**
  - Make lifetimes (`Scope`), deadlines and retry schedules first-class values, not ambient conventions.
  - Make "subscribe before act" impossible to get wrong.
  - Make interception obligations linear: each request is resolved exactly once, with an automatic fallback when its scope closes.

---

## Architecture

### Package map (what matters)

| Path | Role |
|---|---|
| `protocol/spec/*.yml` (19 files, about 5.3k lines) | IDL. Each interface has `initializer`, `commands` (params, returns, flags such as `slowMo`, `snapshot`, `pause`) and `events`. Generated into `core/server/channels.d.ts`, `core/client/channels.d.ts` and `protocol/src/validator.ts`. |
| `core/client/*` | Language binding for JS. `ChannelOwner` uses a `Proxy` to turn method calls into validated RPCs (`channelOwner.ts:157-180`). `Locator`, `Waiter`, route-handler matching and `TimeoutSettings` live here. |
| `core/server/dispatchers/*` | One `Dispatcher` per exposed server object. It maps guid to object, validates in and out, and owns a `ProgressController` per call. |
| `core/server/*.ts` | Engine-agnostic model: `Browser`, `BrowserContext`, `Page`, `FrameManager`, `Frame`, `ExecutionContext`, `ElementHandle`, `Route`/`Request`/`Response`, `Screenshotter`, `Clock`, `DialogManager`. |
| `core/server/{chromium,firefox,webkit,bidi}/*` | `PageDelegate` and `BrowserContext` implementations per protocol. BiDi already exists here (`bidiPage.ts` uses `script.realmCreated` with `sandbox` for the utility world). |
| `inj/*` | The injected script: selector engines, ARIA/role/accname, actionability checks, hit-target interception, aria snapshots, the fake clock and the snapshotter. It is bundled as a string and evaluated per execution context. |
| `playwright/src/matchers/*` | Test-runner `expect`, plus `toPass` and `expect.poll`, which poll on the client. |

### The client/server split

- The server has one RPC entry, `DispatcherConnection.dispatch` (`core/server/dispatchers/dispatcher.ts:297-400`). For each call it does the following:
  1. Look up the dispatcher by guid.
  2. Validate params and metadata against the generated validator.
  3. Build `CallMetadata`.
  4. Run `instrumentation.onBeforeCall` under its own `ProgressController`, with a hard 3 s timeout ("generous… in case it wants to capture a screenshot").
  5. Run the method under a fresh `ProgressController.run(..., validMetadata.timeout)`.
  6. Validate the result.
  7. Run `onAfterCall`, again with 3 s.
  8. Apply `slowMo`.
  9. On error, attach `compressCallLog(callMetadata.log)` to the reply.
- **Object lifecycle on the wire:**
  - `__create__ {type, guid, initializer}` is sent to the *parent* scope.
  - `__adopt__` reparents an object, for example a page moving between contexts.
  - `__dispose__` disposes the object, recursively.
  - Each dispatcher keeps a child map. `_disposeRecursively` tears down the subtree (`dispatcher.ts:117-160`).
- **Handles are garbage-collected by bucket count, not by reachability.** At 10,000 objects per bucket, or 100,000 for `JSHandle`/`ElementHandle`, the oldest 10% are force-disposed (`dispatcher.ts:43-48, 281-295`). A client holding an evicted handle then gets a `TargetClosedError`.
- **In-process mode** (`core/inprocess.ts`) wires both connections through `setImmediate`. There is still full validation, but buffers are passed raw (`useRawBuffers`). So even in-process JS pays the full RPC discipline.
- **Events are opt-in.** The client must call `updateSubscription('request' | 'response' | 'console' | …)` before the server emits them (`pageDispatcher.ts:263`).

**Why the split exists:**
1. One implementation serves four language bindings.
2. It enables `browserType.connect()` to remote "browser servers".
3. There is a single choke point for tracing, the inspector, pause/step and `slowMo`. Protocol flags like `snapshot: true` and `pause: true` drive that instrumentation.

**What it costs:**
- Every call is serialized and validated twice, plus at least one macrotask hop.
- User callbacks (route handlers, `exposeFunction`, locator handlers, `waitForEvent` predicates) run on the client. So the server must pause and round-trip. Example: a paused request becomes a `route` event, the client matches the handler (`client/page.ts:212-234`), then calls `continue`.
- Logic is split confusingly. `waitForEvent` and route URL matching are client-side. `expect(locator)` polling is server-side. `toPass` and `poll` are client-side.
- Handles need GC heuristics.
- State is retained for debugging. A maintainer on #15400: "Playwright is focused on testing scenarios, where contexts are constantly closed and re-opened… We store some useful metadata inside the context… and destroy this metadata as the context is closed."
- Error stacks have to be rewritten to point at user code. `_wrapApiCall` uses zones plus `captureLibraryStackTrace` (`client/channelOwner.ts:189-224`).

**Server object model.** The server builds a tree of `SdkObject`s (an `EventEmitter` plus `guid`, `attribution` and `instrumentation`):

```
Playwright → BrowserType → Browser → BrowserContext → Page → FrameManager → Frame
  → {main, utility} FrameExecutionContext → JSHandle / ElementHandle
```

Engines plug in through `PageDelegate`, for example `navigateFrame`, `getContentQuads`, `scrollRectIntoViewIfNeeded`, `adoptElementHandle`, `rafCountForStablePosition`, `inputActionEpilogue` and `noUtilityWorld?`.

---

## Mechanisms

### 1. Progress, timeouts and cancellation (`core/server/progress.ts`)

**The Progress interface** (`progress.ts:25-35`):

```ts
export interface Progress {
  timeout: number;
  deadline: number;
  disableTimeout(): void;
  log(message: string): void;
  race<T>(promise: Promise<T> | Promise<T>[]): Promise<T>;
  wait(timeout: number): Promise<void>; // timeout = 0 here means "wait 0 ms", not forever.
  signal: AbortSignal;
  metadata: CallMetadata;
  setAllowConcurrentOrNestedRaces(allow: boolean): void;
}
```

**The `ProgressController` state machine** is `'before' | 'running' | {error} | 'finished'` (`progress.ts:37-162`). `run(task, timeout)` does three things:
- Computes `deadline = monotonicTime() + timeout`.
- Arms one `setTimeout`. On fire, it rejects `_forceAbortPromise` with `TimeoutError("Timeout Nms exceeded.")` and calls `AbortController.abort`. The timer callback is skipped while the debugger has the call paused.
- Hands the task a `Progress` object whose `race` is:

```ts
race: <T>(promise) => {
  ...
  return Promise.race([...promises, this._forceAbortPromise]).finally(() => outerProgress = undefined);
},
```

**`abort(error)`** (`progress.ts:66-80`) behaves differently depending on state:
- If the controller is running, it does the same as a timeout.
- If it is still `'before'`, it stores `_pendingAbortError`, so that `run` throws immediately.
- Either way it awaits `_donePromise`, so the aborter waits until the task has actually unwound.

**Semantics: abandon, not cancel.**
- `race` only stops the *awaiting* async function at its next raced `await`. The CDP command, in-page promise or timer it raced keeps going.
- Test `tests/page/page-click-timeout-4.spec.ts:36-45` (`CL-121`) shows that this is still useful. A click whose pre-action hook outlives the timeout never dispatches mouse events, because the next `progress.race` throws.
- Code that must undo side effects uses one of these:
  - `raceUncancellableOperationWithCleanup(progress, run, cleanup)`, which runs `cleanup(t)` if `run` resolves after the abort (`progress.ts:171-185`).
  - Explicit in-page abort handles. For example, `waitForFunctionExpression` returns `{result, abort}` and calls `h.abort()` in `catch`. The comment says "it is important to await abort() to prevent any side effects after this method returns" (`frames.ts:1611-1680`).
  - Fire-and-forget cleanup in `finally`.
- Nested `race` is considered a bug. It is detected only under `PW_DETECT_NESTED_PROGRESS`. Callers that legitimately run races concurrently toggle `setAllowConcurrentOrNestedRaces(true)`, for example `rafrafTimeout`, `raceNavigationAction` and the locator-handler checkpoint.

**Where the server enforces aborts.**
- `DispatcherConnection` keeps `_activeProgressControllers: Map<callId, {controller, abortError}>`. It swaps in a new controller for each phase (before, call, after) so that an abort hits whichever phase is active (`dispatcher.ts:357-395`).
- `__abort__ {id, reason}` aborts by call id (`dispatcher.ts:306-313`).
- `Dispatcher.stopPendingOperations(error)` collects the guids of a dispatcher subtree and aborts every active controller whose `metadata.objectId` is in it (`dispatcher.ts:124-134, 196-205`). This is how closing a page fails in-flight calls.

**Client side** (`client/connection.ts:179-225`):

```ts
if (signal?.aborted)
  throw new AbortError(undefined, { cause: signal.reason });
...
const metadata: channels.Metadata = { title: options.title, location, internal: options.internal, timeout: options.timeout };
...
abortListener = () => {
  const reason = signal.reason instanceof Error ? signal.reason.message : String(signal.reason);
  emptyZone.run(() => this.onmessage({ guid, method: '__abort__', params: { id, reason } }));
};
```

- The timeout is resolved on the client (`client/timeoutSettings.ts`) in this order:
  1. The per-call option.
  2. The page default.
  3. The context default.
  4. `DEFAULT_PLAYWRIGHT_TIMEOUT` (30 s).
  
  Navigation has a separate chain. In inspector/debug mode the timeout becomes 0.
- 183 public methods now document `signal?: AbortSignal`. The docs warn: "providing a signal does not disable the default timeout… pass `timeout: 0`".

**Lifetime scopes: `LongStandingScope`** (`isomorphic/manualPromise.ts:57-112`).
- A scope has `close(error)` and `race(promise)`. Every pending race resolves to a *cloned* error carrying the racer's own stack. `safeRace(p, default)` returns a default value instead of throwing.
- Several objects own one: `Page.openScope`, `Frame._detachedScope` and `ExecutionContext._contextDestroyedScope`.
- Retry loops race their sleeps against `[page.openScope, frame._detachedScope]` so they react immediately to close or detach (`frames.ts:1160-1167`).
- This is a hand-rolled, promise-only version of `Scope` plus `Deferred`.

**Cleanup after abort is best-effort.**
- `Screenshotter` cleanup is `finally { await progress.race(this._restorePageAfterScreenshot()).catch(() => {}) }` (`screenshotter.ts:219, 245`). After a timeout, `race` rejects immediately, so the restore is fired but not awaited.
- The hit-target interceptor's `stop()` is explicitly not awaited "in case the renderer is stuck (e.g. on alert)" (`dom.ts:514-519`).

---

### 2. Frames, execution contexts and navigation (`core/server/frames.ts`, `chromium/crPage.ts`)

**Document model.** A `Frame` holds the following state:
- `_currentDocument` and `_pendingDocument`, each a `{documentId, request}`. `documentId` is CDP's `loaderId`.
- `_firedLifecycleEvents: Set<'commit'|'domcontentloaded'|'load'|'networkidle'>`.
- `_inflightRequests`.
- Per-world `ContextData = {contextPromise: ManualPromise, context}`.
- `_detachedScope`.
- `_redirectedNavigations`.
- A `seq` number used in aria refs.

**Transitions (all on `FrameManager`):**
- `frameRequestedNavigation`, or `requestStarted` for a request with `_documentId`, sets the pending document. Setting a pending document *rejects all "non-stalling" evaluations* in that frame (`frames.ts:588-603`).
- `frameCommittedNewDocumentNavigation` (`frames.ts:234-281`) does the following:
  1. Remove child frames.
  2. Commit the pending document if ids match. If a *different* pending document already exists, keep it ("Chromium error page followed by a new navigation request").
  3. `_onClearLifecycle()` emits `RemoveLifecycle` for each fired event, then re-adds `commit`.
  4. Emit internal `NavigationEvent {url, name, newDocument}`.
  5. Re-number `frame.seq` for the main frame, so that stale aria refs cannot resolve against the new document.
- `frameCommittedSameDocumentNavigation` emits a `NavigationEvent` without `newDocument` (`frames.ts:283-296`).
- `frameAbortedNavigation` emits a `NavigationEvent` with `error` only if the document id matches the pending one.

**`goto` algorithm** (`gotoImpl`, `frames.ts:697-755`):
1. Subscribe to `InternalNavigation` *before* calling `delegate.navigateFrame`, collecting events into an array. This is subscribe-before-act.
2. Chromium's `Page.navigate` returns `loaderId`, or throws `NavigationAbortedError` on `errorText` or `isDownload` (`crPage.ts:615-623`).
3. If there is a `newDocumentId`, wait for an event where `newDocument.documentId === id || !error`. If the event's document id differs, throw "interrupted by another navigation". If there is no `loaderId`, wait for a same-document event.
4. If `waitUntil` has not fired yet, wait for `AddLifecycle(waitUntil)`. The default is `load`.
5. Return `request._finalRequest().response()`, following redirects.
6. `goto` wraps everything in `raceNavigationAction`, which races against detach and page close. If the navigation was aborted because a route redirected it (a HAR redirect), it follows `_redirectedNavigations[documentId].gotoPromise` (`frames.ts:663-690`).

**Lifecycle events.**
- Chromium only maps the `load` and `DOMContentLoaded` names from `Page.lifecycleEvent` (`crPage.ts:626-633`). `commit` is synthetic.
- **`networkidle` is computed by Playwright** (`frames.ts:641-662, 1820-1838`):
  - Each frame starts a 500 ms timer whenever its in-flight set becomes empty. Favicon and `eventsource` requests are excluded.
  - The timer sets `_firedNetworkIdleSelf`.
  - `mainFrame()._recalculateNetworkIdle()` fires `networkidle` for a frame only when its *whole subtree* is idle.
  - `networkidle` can only be removed for the frame that is being re-committed.
- The initial `about:blank` is special-cased. Lifecycle listeners are attached only after the first non-initial commit (`crPage.ts:520-532`). Page creation awaits `_firstNonInitialNavigationCommittedPromise`.

**Navigations caused by actions** (`waitForSignalsCreatedBy` and `SignalBarrier`, `frames.ts:192-217, 1870-1915`):
- For an action with `waitAfter`, a barrier is registered and `retain()`ed.
- Input dispatch is bracketed by `frameWillPotentiallyRequestNavigation` / `frameDidPotentiallyRequestNavigation`, which retain and release.
- Each `frameRequestedNavigation` on a *top-level* frame adds a waiter for the next public `InternalNavigation` (commit or abort).
- After the action:
  1. `inputActionEpilogue()` runs. On Chromium this is a `Page.enable` no-op round trip to flush already-sent events (`crPage.ts:358-360`).
  2. The barrier is released and awaited.
  3. One `setImmediate` follows.
- **Pre-action checks** (`page.ts:547-600`) run before each attempt:
  1. If the main frame has a pending document, wait for it to commit or abort.
  2. Run the locator-handler checkpoint, which shows user overlay handlers when their locator is visible.
  3. Wait again.

**Main world vs utility world.**
- Chromium names the utility world `__playwright_utility_world_<pageGuid>` (`crPage.ts:108`).
- For existing frames it calls `Page.createIsolatedWorld({grantUniveralAccess:true})`. For future documents it registers `Page.addScriptToEvaluateOnNewDocument({source:'', worldName})`, which forces Chrome to create the world in every new document (`crPage.ts:512-540`).
- Selectors run in the utility world unless a custom engine without `contentScript` (or `_react`/`_vue`) needs the main world (`core/server/selectors.ts:73-92`).
- Resolved elements are adopted into the main context before they are returned to the user (`frames.ts:887-893`). The adoption goes through `DOM.describeNode` and `resolveNode`.
- The point is twofold:
  - Page scripts cannot tamper with the injected script's globals or see its listeners.
  - Playwright evaluations do not trip the page's monkey-patches.
- Engines without isolated worlds (`noUtilityWorld`, for example WebView) fall back to snapshotting the main-world globals (`page.ts:227`, `dom.ts:115`).

**How context lifetimes are tracked.**
- `contextCreated(world, ctx)` resolves `contextPromise`. If a context already exists, the old one is destroyed first, because multiple sessions can race (`frames.ts:1796-1806`).
- `contextDestroyed` calls `context.contextDestroyed('Execution context was destroyed, most likely because of a navigation')`, which closes the context's `LongStandingScope`. It then calls `_setContext(world, null)`, which *installs a fresh unresolved `ManualPromise`* (`frames.ts:1787-1818`). Any later `frame.context(world)` call therefore waits for the next document's context. Calls racing the old context fail with the destroyed reason, and retry loops treat that as retriable.
- Every `ExecutionContext` evaluation is wrapped in `raceAgainstContextDestroyed` (`javascript.ts:72-90`).
- The injected script and utility script are lazily created once per context and cached as promises (`dom.ts:95-130`, `javascript.ts:107-122`).
- **Non-stalling evaluation** (`frames.ts:605-621`): `raceAgainstEvaluationStallingEvents` throws immediately if a navigation is pending or a dialog is open, because CDP `Runtime.evaluate` would hang. It is also rejected when either of those starts mid-evaluation (`dialog.ts:113-117`). It is used for `title()`, screenshot preparation and similar calls.

**Chromium session tree and OOPIFs** (`chromium/crConnection.ts`, `crBrowser.ts`, `crPage.ts`).

`CRConnection` routes messages by `sessionId` to flat `CRSession`s. Events are emitted on a microtask (`Promise.resolve().then(...)`). Responses resolve synchronously (`crConnection.ts:162-185`). A session `send` captures a `ProtocolError` at call time, for a good stack, and rejects all callbacks on dispose or crash.

**Browser level** (`crBrowser.ts:85, 171-218`):
- `Target.setAutoAttach({autoAttach:true, waitForDebuggerOnStart:true, flatten:true})` on the root session.
- `page` targets become `CRPage`, with the opener resolved from `openerId`.
- `service_worker` targets become `CRServiceWorker`.
- Everything else is detached. One reason is that shared workers stall waiting for `runIfWaitingForDebugger`.
- One hack: `setAutoAttach` "does not wait for new Targets being attached… making a dummy call afterwards fixes this" (`Target.getTargetInfo`).

**Per target, `FrameSession._initialize`** (`crPage.ts:472-603`):
- The following are all issued in parallel *while the target is paused*:
  - `Page.enable` and `Page.getFrameTree`. The frame tree is replayed as attach and commit events. *Child-target attach events are buffered until the tree is known.*
  - `Log.enable`, `Page.setLifecycleEventsEnabled`, `Runtime.enable`.
  - The utility-world registration.
  - `Network.enable`, plus `Fetch.enable` if routes exist.
  - `Target.setAutoAttach(waitForDebuggerOnStart, flatten)` for OOPIFs and workers.
  - Emulation calls: viewport, touch, UA, locale, timezone, geolocation, media, focus emulation, font families.
  - `Page.setBypassCSP` and `Security.setIgnoreCertificateErrors` if requested.
  - `Page.setInterceptFileChooserDialog` *only if a listener exists*.
  - `Runtime.addBinding` if needed.
  - Init scripts with `runImmediately`.
- Then `Runtime.runIfWaitingForDebugger`, then `_firstNonInitialNavigationCommittedPromise`.
- The target cannot run any script before Playwright's hooks are in place. This is the key ordering guarantee.

**OOPIF attach** (`crPage.ts:759-790`):
- Frame id equals target id.
- If the frame is unknown (when connecting over CDP to an existing page), a frame is created under `parentFrameId`.
- Child frames are removed, and contexts that the *parent* session holds for that frame are destroyed.
- A new `FrameSession(child)` is created and `_initialize(false)` runs.

**Remote/local swaps:**
- `_onFrameAttached` with an existing session marks it `_swappedIn` (remote to local).
- `Page.frameDetached{reason:'swap'}` keeps the frame (local to remote).
- If `Target.detachedFromTarget` arrives before `frameAttached`, Playwright makes "a safe roundtrip" (`Page.enable`) and then decides whether this was a detach or a swap (`crPage.ts:831-856`).
- `_eventBelongsToStaleFrame` drops events from the old process after a swap (`crPage.ts:655-666`).

**Page readiness.**
- `Page.reportAsNew(opener)` waits for the opener's initialization. `_markInitialized` then emits `context.page`, replays buffered console messages and errors, and only then resolves `waitForInitializedOrError` (`page.ts:226-266`).
- Pages whose initialization failed get a dummy main frame.

---

### 3. Actionability and retries (`core/server/dom.ts`, `inj/injectedScript.ts`)

The canonical algorithm is written in the source itself (`inj/injectedScript.ts:1119-1148`, the "Life of a pointer action" comment). The concrete steps are below.

**Outer loop: resolve the target.**

`Frame._retryWithProgressIfNotConnected` (`frames.ts:1197-1247`) runs inside `retryWithProgressAndBackoff`:

```ts
const backoffScale = [20, 50, 100, 100, 500];
if (progress.timeout) {
  // For small timeouts, cap the large backoff values to produce meaningul retries.
  while (backoffScale.length && backoffScale[backoffScale.length - 1] > progress.timeout / 5)
    backoffScale.pop();
}
```

- `retryWithProgressAndTimeouts` prepends `0`. So the sleeps are 0, 20, 50, 100, 100, 500, 500… ms, each raced against page close and frame detach.
- Each attempt does the following:
  1. `performActionPreChecks` (skipped with `force`).
  2. Resolve the selector in the utility world, logging "locator resolved to …" and recording the element's box.
  3. If there is no element, or with `waitForFrameVisible` the frame is hidden, keep polling.
  4. Call the inner action. If it returns `'error:notconnected'`, log "element was detached from the DOM, retrying" and keep polling.
- **Non-retriable errors** (`frames.ts:1181-1195`): abort or timeout, JS errors in evaluate, closed sessions, `NonRecoverableDOMError`, invalid selectors and a detached frame. *Everything else is retried*, including context-destroyed errors.

**Inner loop: act on a resolved handle.**

`ElementHandle._retryAction` (`dom.ts:330-383`):

```ts
const waitTime = [0, 20, 100, 100, 500];
while (true) {
  if (retry) {
    const timeout = waitTime[Math.min(retry - 1, waitTime.length - 1)];
    if (timeout) await progress.wait(timeout);
  }
  if (!options.skipActionPreChecks && !options.force)
    await this._frame._page.performActionPreChecks(progress);
  const result = await action(progress, retry);
  ++retry;
  if (result === 'error:notvisible') { if (options.force) throw new NonRecoverableDOMError(...); continue; }
  ... // notinviewport, optionsnotfound, optionnotenabled, {hitTargetDescription}, {missingState} → continue
  return result; // 'done' | 'error:notconnected' (bubbles to outer loop)
}
```

**One pointer-action attempt.** `_retryPointerAction` and `_performPointerAction` (`dom.ts:385-523`) do the following:

1. **Scroll strategy for this retry.** Retry `r` uses `[undefined, {block:'end',inline:'end'}, {block:'center',inline:'center'}, {block:'start',inline:'start'}][r % 4]`:
   - `undefined` means protocol scrolling: `DOM.scrollIntoViewIfNeeded` with an optional rect.
   - The others call `element.scrollIntoView({...opts, behavior:'instant'})`, "to scroll elements from under sticky headers/footers".
   - If the element is in a child frame, the code first does a best-effort scroll so that throttled iframes become visible (issue #27196).
2. **State checks (unless `force`).** In one injected call, `checkElementStates(node, waitForEnabled ? ['visible','enabled','stable','non-inert'] : ['visible','stable'], frameVisible)`.
   - **Stable** (`inj/injectedScript.ts:718-765`):
     - Sample `getBoundingClientRect` on each `requestAnimationFrame`.
     - The element is stable when it is unchanged for `stableRafCount` consecutive comparisons after the first sample. That is 2 frames in total on Chromium, Firefox and BiDi (`rafCountForStablePosition() = 1`), and 6 frames on WebKit/Windows (`5`).
     - With a count above 1, frames shorter than 15 ms are skipped (a "WebKit Win bug").
     - Any change returns `{missingState:'stable'}` immediately, so the outer `_retryAction` sleeps. It does not keep sampling.
   - **Visible** (`inj/domUtils.ts:130-154`): requires `checkVisibility()` and `visibility:visible` and a non-empty box. For `display:contents`, any visible child counts. It is also ANDed with `frameVisible`.
   - **Enabled**: ARIA-disabled semantics, `getAriaDisabled`. This covers native `disabled`, `fieldset` inheritance and `aria-disabled`.
   - **Editable**: enabled, and not `readonly`/`aria-readonly`. It throws on non-editable element types.
   - **Non-inert**: `isElementInert`. It can be skipped with `PLAYWRIGHT_SKIP_INERT_CHECK`.
   - **Label retargeting**: `retarget(node, 'follow-label')` maps a `<label>` to its control.
3. **Scroll into view** with the chosen strategy.
4. **Click point.**
   - With `position`, the point is the padding box offset (`_offsetPoint`).
   - Otherwise it is `_clickablePoint` (`dom.ts:258-310`). This takes `DOM.getContentQuads`, intersects them with the viewport and drops quads with area ≤ 0.99. If none are left, the result is `'error:notinviewport'`. Otherwise it uses the middle of the first quad. Firefox searches for an integer point inside the quad.
   - The point is rounded.
   - `onBeforeInputAction` fires here, which is where tracing captures the "action" snapshot.
5. **Hit-target pre-check (unless `force`).**
   - `_checkFrameIsHitTarget` walks iframe ancestors (`dom.ts:951-990`). For each one it translates the point by the iframe box and its border/padding, then checks that the parent document's hit test lands on the `<iframe>` element. If the iframe has a CSS transform, the pre-check is skipped and the code relies on the interceptor.
   - In the target frame, `setupHitTargetInterceptor` first runs `expectHitTarget(point, element)`. This walks shadow roots from the bottom up, using `elementsFromPoint` with workarounds for `display:contents` and a WebKit shadow-host bug, and requires that the hit element be the target or a descendant (composed tree, `assignedSlot`).
   - On failure the result is `{hitTargetDescription: "<div …> from <dialog …> subtree intercepts pointer events"}`, which leads to a retry.
6. **Event interceptor.**
   - At injected-script startup, a capture-phase, non-passive listener is installed on `window` for the action's event set (`inj/injectedScript.ts:1498-1506`):
     - mouse: `mousedown`, `mouseup`, `pointerdown`, `pointerup`, `click`, `auxclick`, `dblclick`, `contextmenu`
     - hover: `mousemove`
     - tap: pointer and touch events
   - On the *first trusted* event it re-runs `expectHitTarget` at the event's client coordinates.
   - If that check fails, or in `trial` mode (`blockAllEvents`), it calls `preventDefault`, `stopPropagation` and `stopImmediatePropagation` on every subsequent event.
   - `stop()` returns the verdict. If no event arrived (JS disabled, an overlaying iframe), it returns `'done'`.
   - The re-check exists because of layout shift between the pre-check and the real input.
   - Drag skips interception, because the dragged element sits under the cursor.
7. **Dispatch.** Inside `waitForSignalsCreatedBy(waitAfter)`: press modifiers, call `action.perform` (`Input.dispatchMouseEvent` move/down/up), restore modifiers, then `stop()` the interceptor. Unless `noWaitAfter`, a failed interception returns `{hitTargetDescription}` and the action is retried.
   - The click has already been sent, but it was blocked in the page, so a retry is safe.
   - After that, wait for any navigations triggered by the input.

**`force`.** It skips pre-checks (navigation wait and locator handlers), state checks and both hit-target layers. Scrolling still happens. `notvisible` and `notinviewport` become non-recoverable errors instead of retries.

**`fill`** (`dom.ts:631-655`): checks `['visible','enabled','editable','non-inert']`, then runs `injected.fill`. Inputs whose type changes value semantically are set directly. Otherwise the code selects the content and returns `'needsinput'`, after which the server calls `keyboard.insertText(value)`, or `Delete` for an empty value. There is no stability check and no hit-target check.

**Assertion-based waits** (`waitForSelector` with state, `frames.ts:839-899`) use the same outer backoff. With `state: 'hidden' | 'detached'`, an unresolved selector counts as success.

---

### 4. Locators, selectors and the injected script

**Locators are strings.**
- A client `Locator` is `{_frame, _selector}`. The constructor only appends selector parts (`client/locator.ts:50-85`):

```ts
if (options?.hasText)
  this._selector += ` >> internal:has-text=${escapeForTextSelector(options.hasText, false)}`;
...
if (options?.visible !== undefined)
  this._selector += ` >> visible=${options.visible ? 'true' : 'false'}`;
```

- `getByRole('button', {name:'Sign in'})` compiles to `internal:role=button[name="Sign in"i]` (`isomorphic/locatorUtils.ts:69-90`).
- `locator.click()` is just `frame.click(selector, {strict: true, ...})`.
- No element identity crosses the RPC boundary unless the user explicitly asks for an `ElementHandle`. Every attempt of every retry loop re-parses and re-queries the selector. That is how "locators re-resolve on every action" works, and why they survive re-renders.
- `Locator.toString()` and `asLocator(lang, selector)` regenerate idiomatic, language-specific source from the selector string. This powers error messages such as `locator('div')`, codegen and trace titles.

**Frames inside selectors.**
- `splitSelectorByFrame` cuts at `internal:control=enter-frame`.
- `FrameSelectors.resolveFramesForSelector` queries `iframe`/`frame` in each hop. It is strict, and errors if the match is not an iframe. It then maps to the content frame via `DOM.describeNode(...).frameId`, and tracks `frameVisible` through the chain (`frameSelectors.ts:125-200`).
- Aria refs like `f3e12` jump straight to the frame whose `seq` is 3 (`frameSelectors.ts:110-121`).

**Injected engines** (`inj/injectedScript.ts:216-245`): `css` (shadow-piercing by default), `xpath`, `text`, `role`/`internal:role`, `internal:label`, `internal:text`, `internal:has(-not)(-text)`, `internal:and`/`or`/`chain`, `nth`, `visible`, `internal:attr`, `internal:testid`, `internal:describe`, `aria-ref`, `aria-template`, layout selectors, plus custom engines that are `eval`ed in.
- `querySelectorAll` folds parts over a `Set<Element>` of roots (`:382-437`).
- `_evaluator.begin()` and `end()` scope caches for computed style, text and ARIA to a single query.

**Text matching** (`inj/injectedScript.ts:1794-1833`, `inj/selectorUtils.ts:67-115`):
- Element text means: concatenated text nodes, `<input>` value for buttons, shadow-root content, and whitespace normalized.
- A regex is tested against the full text.
- `"quoted"` is strict: the normalized text must equal the selector, or for external `text=` a whole immediate text node must match.
- Anything else is lax: case-insensitive substring.
- The engine returns the *innermost* matching elements. `elementMatchesText` returns `'self'` only if no child also matches. A `lastDidNotMatchSelf` subtree prune avoids rechecking descendants.

**Role and accessible name** (`inj/roleUtils.ts`):
- This is a full implementation of WAI-ARIA 1.2 implicit roles and *accname-1.2*, with spec step comments (2a hidden-not-referenced, 2b labelledby, 2c embedded control, 2d native, 2e aria-label, …) at `:766+`.
- Memoization uses ref-counted `beginAriaCaches()`/`endAriaCaches()` (`:1378-1405`).
- The `role` engine filters by name (exact, `i`, regex), `checked`, `disabled`, `expanded`, `level`, `pressed`, `selected` and `include-hidden`.
- No CDP `Accessibility` domain is used. Everything is computed in JS, which is portable to BiDi.

**Strict mode.** With `strict`, multiple matches throw a `strictModeViolationError`. Each match is listed with a generated, unique, language-specific locator (`inj/injectedScript.ts:1338-1343`):

```
Error: strict mode violation: locator('div') resolved to 2 elements:
    1) <div>a</div> aka getByText('a')
    2) <div>b</div> aka getByText('b')
```

(`tests/page/expect-misc.spec.ts:640-652`). Strictness is not retried. It fails immediately (#36045 asks to wait instead).

**Aria snapshot and refs** (`inj/ariaSnapshot.ts`):
- `generateAriaTree(root, {mode})` has four modes, each mapping to visibility and ref policy (`:58-80`):
  - `ai`: ARIA-or-visible, refs on interactable nodes (visible and receives pointer events), generic roles, active and cursor:pointer markers, optional boxes.
  - `default`: ARIA visibility, no refs. Used by `toMatchAriaSnapshot`.
  - `codegen`
  - `autoexpect`
- **Ref minting** (`:225-238`):

```ts
let ariaRef = (element as any)._ariaRef as AriaRef | undefined;
if (!ariaRef || ariaRef.role !== ariaNode.role || ariaRef.name !== ariaNode.name) {
  ariaRef = { role: ariaNode.role, name: ariaNode.name, ref: (options.refPrefix ?? '') + 'e' + (++lastRef) };
  (element as any)._ariaRef = ariaRef;
}
```

  So refs are *stable across snapshots* as long as the element keeps its role and name. The prefix is `f<frameSeq>` in AI mode (`inj/injectedScript.ts:330-338`).
- `aria-ref=e12` resolves *only against the last snapshot taken in that injected-script instance* (`_lastAriaSnapshotForQuery`) and requires `isConnected` (`:766-772`). After a navigation the context, and therefore the script instance, is new, and the main frame's `seq` is renumbered. So old refs cannot resolve against the new document.
- The server stitches iframes. For each rendered iframe ref it recurses with ``aria-ref=${ref} >> internal:control=enter-frame >> body,frameset`` and splices the children in (`page.ts:1123-1175`). It retries obtaining `body` with `[1000,2000,4000,8000]`.
- The public surface is `page.ariaSnapshot({mode:'ai'})` plus `page.getByRef(ref)`, which is `locator('aria-ref=…')` (`client/page.ts:786-788`).

---

### 5. Web-first assertions

**The retry loop lives on the server.**
- `expect(locator).toBeVisible()` calls `locator._expect(expression, options)`, which makes *one* `Frame.expect` RPC with the timeout. The default expect timeout is 5 s.
- `Frame.expect` (`frames.ts:1475-1535`) runs these steps:
  1. `performActionPreChecks`, which handles locator overlays and pending navigation.
  2. **A one-shot check that ignores the deadline** (`progress = nullProgress`), so `toBeVisible({timeout: 1})` passes if the element is already visible.
  3. `retryWithProgressAndBackoff`, re-running the pre-checks and `_expectInternal` until `matches !== isNot`.
- `_expectInternal` (`:1537-1610`) evaluates `injected.expect(...)` against strict (non-array) or non-strict (count and array) resolution. It handles "zero elements" semantics per matcher. For example, `to.be.hidden` passes and `not.to.be.attached` passes.
- On a mismatch it records `lastIntermediateResult` (received value, error) and, if nothing resolved, an aria snapshot of `body`. A timeout produces an `ExpectError{received, timedOut, customErrorMessage}` whose typed `errorDetails` pass through a generated validator.
- Mismatches surface in the call log as `unexpected value "…"` lines. `compressCallLog` folds repeated retry blocks into `N × …` (`core/server/callLog.ts:17-35`).

**Client-side polling.**
- `expect.poll(fn)` and `expect(fn).toPass()` use `pollAgainstDeadline(callback, deadline, [100,250,500,1000])`. The last interval repeats. The loop stops early if the next sleep would cross the deadline (`isomorphic/timeoutRunner.ts:42-62`).
- `toPass` defaults to `timeout: 0`, meaning it is bounded only by the test timeout (`playwright/src/matchers/matchers.ts:496-529`).

**`toHaveScreenshot`.** The server loop takes screenshots with sleeps `[0,100,250,500]` then 1000 ms. It succeeds when two consecutive screenshots are equal and match the expected image (`page.ts:718-790`). It also uses `rafrafTimeout`: a double rAF raced with a timer (`frames.ts:1731-1747`).

---

### 6. Network (`chromium/crNetworkManager.ts`, `server/network.ts`)

**CDP mapping.**
- `Network.enable` runs on *every* session: page, OOPIF and worker (`crNetworkManager.ts:97`).
- Interception is a single switch (`:159-179`):

```ts
const enabled = this._userRequestInterceptionEnabled || !!this._credentials?.length || !!this._proxyCredentials;
...
const cachePromise = info.session.send('Network.setCacheDisabled', { cacheDisabled: enabled });
...
fetchPromise = info.session.send('Fetch.enable', { handleAuthRequests: true, patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
```

  Any route, even for one URL, pauses *every* request and disables the HTTP cache.
- Dispatchers keep `URLMatch` patterns server-side (`setNetworkInterceptionPatterns`, `browserContextDispatcher.ts:315-328`), so non-matching requests continue without a client round trip.
- **Correlation** (`:206-285`):
  - `Network.requestWillBeSent` and `Fetch.requestPaused` (keyed by `networkId`) can arrive in either order. Two maps hold the unmatched half.
  - `requestPaused` without a `networkId` is continued immediately.
  - `data:` URLs are skipped.
  - If Chromium restarts a request internally (a CORS / private-network retry), the code re-sends `Fetch.continueRequest` with the same `_alreadyContinuedParams`.
  - `responseReceivedExtraInfo` can arrive without `requestPaused`. In that case the code stops waiting and dispatches the request.
  - Favicon requests are aborted outright when intercepted (`frames.ts:334-337`).
- **Auth:** `Fetch.authRequired` triggers `continueWithAuth` with `ProvideCredentials` once per request and challenge source. A second challenge gets `CancelAuth`.

**Route semantics** (`server/network.ts:385-480`):
- A `Route` holds `_futureHandlers`. `handle(handlers)` immediately calls `continue({isFallback:true})`, which shifts and invokes the next handler. When the chain runs out, the default is a real continue.
- `fulfill` adds CORS headers automatically when the request has a cross-origin `Origin` (#12929).
- `_startHandling` asserts single resolution ("Route is already handled!").
- Client side (`client/page.ts:212-234`): page routes are tried in order, then context routes. Expiring `times` handlers are spliced out. When no routes remain, interception is disabled.
- `route.fallback()` means "next handler". `route.continue()` means "send to network now".
- Handlers that never resolve the route leave the request hanging. Hence `unrouteAll({behavior:'wait'|'ignoreErrors'|'default'})`.

**Request and response lifetimes.**
- `Request` and `Response` live on the server. The page keeps the last 100 requests (`page.ts:401-404`).
- Response bodies are fetched lazily with `Network.getResponseBody`. #13449 is still open: "Request content was evicted from inspector cache" for large bodies.
- Redirects form a chain (`redirectedFrom`, `_finalRequest()`), which `goto` uses to return the final response.
- Requests are attached to frames for `networkidle` accounting and to documents through `_documentId`.

**HAR.**
- **Replay** is a client route handler (`client/harRouter.ts:47-110`) that calls `localUtils.harLookup`. The server-side algorithm (`harBackend.ts:96-150`):
  1. Filter entries on exact URL and method.
  2. For POST, require an equal body, or an equal body after stripping multipart boundaries.
  3. If several entries match, prefer the one with the most matching headers.
  4. Follow redirect entries, with cycle detection.
  5. For navigations, if the final URL differs, return `redirect` so that `redirectNavigationRequest` restarts the navigation at the final URL. This updates `document.URL`.
  6. A recorded `status: -1` means "stall" (#29311).
  7. On a miss, apply `notFound: 'abort' | 'fallback'`.
- **Recording** is `har/harTracer.ts`, which listens to context network events.

---

### 7. Other mechanisms

**Tracing** (`server/trace/recorder/tracing.ts`, `isomorphic/trace/versions/traceV10.ts`):
- The trace is a zip containing `trace.trace` (JSONL events), `trace.network` (resource snapshots, which are HAR entries) and `resources/<sha1>`. The format is version 10.
- Event types: `context-options`, `before`/`input`/`after`/`log` per call (the `callId` is the RPC id), `event`, `console`, `screencast-frame`, `screenshot`, `aria-snapshot`, `frame-snapshot` and `resource-snapshot`.
- DOM snapshots are taken at the `before`, `action` (in `onBeforeInputAction`, with the click point) and `after` phases.
- Snapshots are *incremental*. A node can be a `[[snapshotsAgo, nodeIndex]]` reference to an unchanged subtree, numbered in post-order (`traceV10.ts:218-256`).
- All of this hangs off the dispatcher's instrumentation hooks, each bounded at 3 s.

**Clock** (`server/clock.ts`, `inj/clock.ts`):
- The clock is a sinon-style fake timer, injected into every frame.
- Each operation (`install`, `fastForward`, `pauseAt`, `resume`, `setFixedTime`, `setSystemTime`) is applied in two places: it is evaluated in all existing frames, *and* appended as an init script `__pwClock.controller.log(op, wallNow, arg)`.
- New documents therefore replay the operation log and catch up. It is an event-sourced clock.

**`waitForEvent`** (`client/waiter.ts`, `client/page.ts:509-523`):
- It is purely client-side. The event plus predicate races against a timeout, `AbortSignal`, page `Crash` and page `Close`, which all reject.
- `__waitInfo__` before/log/after messages are fire-and-forget so that the trace shows the wait.
- The server-side helper equivalent is `helper.waitForEvent(progress, emitter, event, pred)`, which removes its listener in `finally` (`server/helper.ts:58-73`).

**Dialogs** (`server/dialog.ts:113-130`):
- On open, all non-stalling evaluations are invalidated.
- If no handler claims the dialog it is auto-closed. `beforeunload` is accepted and the other types are dismissed.
- If a client subscribes, it *must* accept or dismiss, or actions stall. The docs say so explicitly.
- Before closing a context, open `beforeunload` dialogs are force-closed (`crBrowser.ts:554-557`).

**Downloads:**
- Configured per context with `Browser.setDownloadBehavior({behavior:'allowAndName'|'deny', downloadPath, eventsEnabled:true})`. `Browser.downloadWillBegin`/`downloadProgress` arrive on the root session.
- `Page.navigate` returning `isDownload` becomes `NavigationAbortedError('Download is starting')`.
- A download that starts in a new window is reported on the opener page.
- Downloads are cancelled before the context is disposed, because Edge crashes otherwise.

**File chooser:** `Page.setInterceptFileChooserDialog` is enabled only while a `filechooser` listener exists. `Page.fileChooserOpened{backendNodeId}` is resolved to an `ElementHandle`, and the user calls `setFiles`.

**Screenshots** (`screenshotter.ts`):
- Screenshots are serialized per page through a `TaskQueue`.
- Preparation runs in all frames, in the utility world:
  - Inject the user `style` and hide the caret.
  - With `animations:'disabled'`, `finish()` finite animations and `cancel()` infinite ones, re-applying on `transitionrun` and `animationstart`.
  - Await `document.fonts.ready`.
- An element screenshot runs `_waitAndScrollIntoViewIfNeeded` (visible + stable) and then captures with document coordinates.

**CDP domains per page and why:**

| Domain or call | Why |
|---|---|
| `Page.enable`, `getFrameTree`, `setLifecycleEventsEnabled` | Frame tree, navigation and lifecycle. `Page.enable` doubles as a barrier. |
| `Runtime.enable` | Execution contexts (worlds), console, exceptions, bindings. |
| `Log.enable` | Browser-side log entries for console and errors. |
| `Network.enable` (all sessions) | Request model, networkidle, response bodies. |
| `Fetch.enable('*')` + `Network.setCacheDisabled` | Only while routes or credentials exist. |
| `Target.setAutoAttach(waitForDebuggerOnStart, flatten)` | OOPIFs and workers, deterministic instrumentation before first script. |
| `Page.createIsolatedWorld` / `addScriptToEvaluateOnNewDocument(worldName)` | Utility world. |
| `Emulation.*`, `Security.setIgnoreCertificateErrors`, `Page.setBypassCSP` | Context options. |
| `Page.setInterceptFileChooserDialog`, `Runtime.addBinding`, `Inspector.enable` | Only when needed. `Inspector.enable` only when connecting, to detect crashed or discarded tabs. |

**Not used:** `DOM.enable`, `CSS.enable`, `Accessibility.*`, `Overlay`. DOM calls (`describeNode`, `getContentQuads`, `scrollIntoViewIfNeeded`, `resolveNode`) work without `DOM.enable`.

---

## What works well

1. **Separating "where am I allowed to run" from "what to run".** The utility world plus the lazily-cached injected script per context makes evaluation robust against hostile pages. Context replacement is a single promise swap.
2. **Paused-target initialization.** `waitForDebuggerOnStart` plus parallel setup plus `runIfWaitingForDebugger` gives a total ordering guarantee with no "missed first event" races, uniformly for pages, OOPIFs and workers.
3. **Selectors as data.** Locators cost nothing to build and are re-resolved on every attempt. They are serializable, so they can appear in traces, error messages and codegen. Generated "aka" locators in strict-mode errors are excellent.
4. **The actionability algorithm.** It has been tested against a decade of real-world UI weirdness:
   - Scroll strategy rotation.
   - The two-phase hit target (pre-check plus trusted-event interceptor that blocks mis-targeted events).
   - Frame-chain hit testing.
   - rAF stability.
   - Locator handlers for overlays.
5. **Waiting for action-caused navigation.** `SignalBarrier` lets `click()` "just work" when it navigates, without the user doing a `Promise.all` dance.
6. **Call logs as a debugging UX.** Every retry step logs a human sentence. Repeated blocks are compressed. The log is attached to the error and rendered as "Call log:".
7. **Document-id-based navigation tracking** with internal events, rather than URL comparison.
8. **One-shot-then-poll assertions.** The final failure includes the last received value and an aria snapshot.
9. **An event-sourced clock**, and incremental DOM snapshots in traces.

---

## Pitfalls and complaints

- **Cancellation is not real.** Timeouts abandon work. Cleanup is ad hoc: fire-and-forget restores, `.catch(() => {})` everywhere, in-page pollers needing manual `abort()`. Nested `race` misuse is only detectable under an env var.
- **Lifecycle complexity leaks to users.**
  - "Execution context was destroyed, most likely because of a navigation" is the most common confusing error (#34495, #26740, #9840).
  - "Target page, context or browser has been closed" is a generic catch-all (#27997, 40 comments; #33515; #35128).
  - Request #12462: "Provide a meaningful error message instead of 'Context was closed'".
- **The `networkidle` heuristic** (500 ms, no requests, whole subtree) is officially **DISCOURAGED** in the docs (`docs/src/api/params.md:7`). Long-polling, analytics or WebSockets-over-XHR make it never fire. Related goto timeouts: #12182 (62 comments).
- **`waitForNavigation`** is "deprecated: inherently racy". Its replacement, `waitForURL`, cannot detect same-URL navigations (#20853). A maintainer: "It only works if and only if you know for sure what the page is doing."
- **Interception is all or nothing.** It disables the cache, adds latency to every request and has surprising cache interactions (#26613). Response bodies get evicted (#13449, open).
- **Strict mode fails fast.** It does not wait for uniqueness (#36045). `force` is all or nothing; users want to drop only `stable` for perpetually animated buttons (#34436).
- **The hit-target check is a frequent source of "X intercepts pointer events" failures:**
  - #12821 (17 comments)
  - #10638, a regression after the subtree change
  - #36339, "Click fails in 1.53 where it previously passed"
  - #5858, shadow DOM
- **Memory.** Per-context debugging metadata and handle retention grow in long-running processes (#15400). Request history is capped at 100 per page. The dispatcher's GC evicts handles by count.
- **OOPIF and connect-over-CDP edge cases:**
  - #42955: the main frame was replaced by a nested sandboxed iframe when `parentFrameId` was unknown.
  - #42730: `connectOverCDP` never completes when a pre-existing target is unresponsive; mitigated by `Inspector.enable` on connect.
  - Firefox iframe permission bugs: #21780, #6453.
- **`toPass` has foot-guns.** It defaults to an unbounded timeout (#23937). Its failure output missed the last inner error (#31866).
- **Zombie options.** `noWaitAfter` is documented as "This option has no effect" on several methods (`docs/src/api/params.md:80-82`).

---

## Licensing

- **Server, client, protocol and injected script:** Apache License 2.0, "Copyright (c) Microsoft Corporation", in each file header. Every file in `inj/*.ts` carries that header, except:
  - `inj/clock.ts`: BSD-3-Clause, "Copyright (c) 2010-2014, Christian Johansen" (sinon fake-timers/lolex lineage), "Modifications copyright (c) Microsoft Corporation".
  - `isomorphic/cssTokenizer.ts`: CC0, from tabatkins/parse-css. No attribution is required.
  - `isomorphic/deviceDescriptors.ts` and many `server/*` files also say "Copyright 2017 Google Inc." (Puppeteer lineage, Apache-2.0).
- **Root `NOTICE`:** "Playwright / Copyright (c) Microsoft Corporation / This software contains code derived from the Puppeteer project … available under the Apache 2.0 license".
- **What reusing the selector, aria and actionability code would require** (Apache-2.0 §4):
  - Keep the per-file copyright and license headers on copied files.
  - Add prominent "modified by …" notices to files we change.
  - Ship a copy of the Apache-2.0 license.
  - Carry the relevant parts of Playwright's `NOTICE` into our NOTICE, meaning the Microsoft copyright and the Puppeteer derivation line.
- **If we take `clock.ts`:** also reproduce the BSD-3 notice and disclaimer in the source and in binary or bundled distributions. That matters because the injected script ships as a string bundle. BSD-3 also forbids using the authors' names for endorsement.
- **No copyleft is involved.** Our library can use any license compatible with Apache-2.0.
- **Patent clause:** Apache-2.0 §3 grants a patent license, which terminates if we sue over patents in the work.

---

## Ergonomics: what to steal, what to avoid

### The API at its best (real call sites)

```ts
// docs/src/locators.md:24-30
await page.getByLabel('User Name').fill('John');
await page.getByLabel('Password').fill('secret-password');
await page.getByRole('button', { name: 'Sign in' }).click();
await expect(page.getByText('Welcome, John!')).toBeVisible();
```

```ts
// docs/src/locators.md:811-816: composition by chaining and filtering, no waits anywhere
await page
    .getByRole('listitem')
    .filter({ hasText: 'Product 2' })
    .getByRole('button', { name: 'Add to cart' })
    .click();
```

```ts
// docs/src/mock.md:118-125: patch a live response in five lines
await page.route('*/**/api/v1/fruits', async route => {
  const response = await route.fetch();
  const json = await response.json();
  json.push({ name: 'Loquat', id: 100 });
  await route.fulfill({ response, json });
});
```

```ts
// docs/src/aria-snapshots.md:13-21: declarative structural assertion
await expect(page).toMatchAriaSnapshot(`
  - banner:
    - heading /Playwright enables reliable end-to-end/ [level=1]
    - link "Get started":
      - /url: /docs/intro
`);
```

```ts
// docs/src/api/class-page.md:3434-3440: cross-cutting overlay handling, declared once
await page.addLocatorHandler(page.getByText('Sign up to the newsletter'), async () => {
  await page.getByRole('button', { name: 'No thanks' }).click();
});
await page.goto('https://example.com');
await page.getByRole('button', { name: 'Start here' }).click();
```

**Why these are pleasant:**
- There is zero lifecycle ceremony: no handles, no waits, no frames.
- Names follow how users perceive the page (role, label, text).
- The "what" (the locator) is separate from the "when" (auto-wait and retry).
- Assertions and actions share the same vocabulary.

### The API at its worst

```ts
// docs/src/events.md: "subscribe before act" pushed onto the user, with a comment as the only guard
// Start waiting for popup before clicking. Note no await.
const popupPromise = page.waitForEvent('popup');
await page.getByText('open the popup').click();
const popup = await popupPromise;
```

- Swap the two lines and the code races, or hangs until the timeout.
- Java and Python solve this with a *scoped callback*: `page.waitForPopup(() -> {...})` and `with page.expect_popup() as popup:`. That is strictly better and maps directly to Effect.

```ts
// docs/src/api/class-page.md:5229-5233: deprecated as "inherently racy", still widely used
const navigationPromise = page.waitForNavigation();
await page.getByText('Navigate after timeout').click();
await navigationPromise;
```

```ts
// docs/src/frames.md:16: even the docs `await` a synchronous Locator; FrameLocator vs frame() vs contentFrame() confuses users
const username = await page.frameLocator('.frame-class').getByLabel('User Name');
```

```ts
// Must-handle obligations with no type-level enforcement (docs/src/dialogs.md)
page.on('dialog', dialog => dialog.accept());   // forgetting to accept/dismiss here stalls every later action
await page.route('**/*', route => { if (cond) route.fulfill({...}); }); // else-branch forgot → request hangs forever
await page.unrouteAll({ behavior: 'ignoreErrors' }); // a three-valued enum to handle in-flight handler lifetimes
```

### Friction catalogue

- **Two parallel APIs.** The old `page.click(selector)`, `$`, `$$`, `$eval` and `ElementHandle` API sits next to locators. More than 30 `page.*` methods are marked "discouraged: Use locator-based…" (`docs/src/api/class-page.md`). Discoverability suffers, and `ElementHandle`s go stale.
- **Timeout ceremony.** There are three tiers (action 30 s, navigation, expect 5 s) plus `test.setTimeout`, and `timeout: 0` means "infinite". Yet in `progress.wait(0)` it means "no wait" (`progress.ts:31` notes this inversion). `signal` does not disable the default timeout, so callers need both.
- **Confusing names:**
  - `continue` vs `fallback`.
  - `waitForLoadState('networkidle')`, discouraged but prominent.
  - `noWaitAfter`, which now "has no effect" in places.
  - `force`, which skips several unrelated checks.
  - `strict` (on by default for locators, off for `page.$`).
- **Hard to discover:** `addLocatorHandler`, `locator.or/and`, `toPass` intervals, `route.fetch`, the HAR `notFound` modes, `getByRef`, `ariaSnapshot({mode:'ai'})`.
- **Error messages, good and bad.**
  - The good: call logs, "aka" locators, `intercepts pointer events` with the subtree root.
  - The bad: messages about lifetimes, such as "Target page, context or browser has been closed" and "Execution context was destroyed…". They do not say *which* object, *why* it closed, or *what you were doing*. `closeReason` exists but is rarely set.

### How the internals make the nice surface possible

| Surface nicety | Internal enabler |
|---|---|
| `locator.click()` never needs a manual wait | Two retry loops, server-side deadline, actionability state machine, `SignalBarrier` for navigations |
| Locators survive re-renders | Locator = selector string. Re-resolved every attempt, in the utility world |
| `expect(...).toBeVisible()` is one line and fast | A single RPC with a server-side one-shot check, then polling. The failure carries the last received value plus an aria snapshot |
| Readable failures | `progress.log` at every step, `compressCallLog`, `asLocator()` regeneration, generated "aka" selectors |
| Overlays don't break flows | The locator-handler checkpoint inside `performActionPreChecks` |
| `goto` returns the right response | Document-id tracking plus the redirect chain `_finalRequest()` |

**Lessons for our call sites:**
1. Steal the "what vs when" separation: locator values plus auto-waiting actions plus retrying assertions.
2. Make every must-handle obligation (dialogs, routes, file choosers) a *scoped handler whose return type proves resolution*, with a safe default when the scope ends.
3. Make "wait for X caused by Y" a *combinator* (`Page.expectPopup(action)`), never two statements.
4. Use one timeout concept, the deadline in context, and one cancellation concept, interruption.
5. Keep the call-log UX, but make it structured data on typed errors.

---

## Lessons and candidate abstractions for an Effect-native design

1. **Progress becomes the Effect runtime itself.**
   - Actions are `Effect<A, ActionError, Page>`. Timeouts apply once, at the API edge: `Effect.timeoutFail({ duration, onTimeout: () => new ActionTimeout({ log }) })`.
   - Interruption, not `Promise.race`, stops work, and nested races stop being a bug class.
   - The *budget* still matters for schedule shaping (Playwright drops backoff steps larger than `timeout/5`). Expose a `Deadline` service, either a `Context.Reference` or a fiber-local, set by the timeout combinator. Retry schedules can read it.
   - Replace `raceUncancellableOperationWithCleanup` with `Effect.acquireRelease(run, (t, exit) => Exit.isInterrupted(exit) ? cleanup(t) : Effect.void)` inside `Effect.uninterruptibleMask`.
   - In-page side effects become `acquireRelease` resources whose finalizers run *uninterruptibly with their own short timeout*, like Playwright's 3 s instrumentation budget, so cleanup is always awaited. Examples: the hit-target interceptor, screenshot styles, the `waitForFunction` poller and init scripts.
2. **`LongStandingScope` becomes `Scope` plus a typed close reason.**
   - Browser, Context, Page, Frame and ExecutionContext each own a `Scope` (`Scope.fork(parent)`).
   - Operations on a frame are forked into its scope (`Effect.forkIn`) or raced against `Deferred<CloseReason>`.
   - Detach and navigation become *typed* errors carrying object identity and reason: `FrameDetached{frameId, url}`, `ContextDestroyed{world, documentId, cause: Navigation|Detach|Crash}`, `PageClosed{reason}`. This fixes the most common complaint.
3. **Execution contexts become `SubscriptionRef<Option<Ctx>>` per world.**
   - `context(world)` is `ref.changes.pipe(Stream.filterMap(identity), Stream.runHead)`.
   - Destroying a context sets `None` and closes that context's Scope, which interrupts its evaluations.
   - The injected script handle is a `ScopedCache`/`Effect.cached` resource keyed by context.
4. **Retry policy as values.**
   - Selector resolution: `Schedule.fromDelays(0, 20, 50, 100, 100, 500)` then `Schedule.spaced("500 millis")`.
   - Actionability: `[0,20,100,100,500]`.
   - Assertions: one-shot, then the same backoff.
   - Model "continue polling" as a typed retriable error (`NotYet{reason}`). Model non-retriables (`InvalidSelector`, `JsError`, `StrictViolation`, `Detached`) as distinct tags, and drive the loop with `Effect.retry({ schedule, while: isRetriable })`.
   - Each attempt emits a `CallLogEntry` via `Effect.annotateCurrentSpan` or a fiber-local log. The final error includes the compressed log as data.
5. **Actionability as a configurable check set.** `Actionability = Set<Visible | Stable | Enabled | Editable | ReceivesEvents | NotInert>`, with presets per action. This solves #34436 (skip only `Stable`). Keep the algorithm verbatim: rAF stability, scroll rotation, frame-chain hit test, trusted-event interceptor as a scoped resource.
6. **Locators as a Schema-typed AST, not strings.**
   - `Locator` is `Data.TaggedEnum` (`Role`, `Text`, `Label`, `TestId`, `Css`, `Chain`, `Filter`, `Nth`, `EnterFrame`, `AriaRef`) with `Equal`/`Hash`, plus a printer to Playwright selector syntax so the injected engines can be reused.
   - Strict mode becomes a policy: `Fail | WaitForUnique | First`, which fixes #36045.
7. **Subscribe-before-act as a combinator.** Provide `Page.expectEvent(stream, predicate)(action): Effect<[A, Ev]>`. It uses `PubSub.subscribe` in a `Scope` *before* running `action`, then `Stream.runHead`. All "wait for X caused by Y" APIs (popup, download, request/response, navigation, file chooser, dialog) are instances. This is the Java/Python `expect_*` ergonomics, made total.
8. **CDP session tree as scoped resources.**
   - Each `Target.attachedToTarget` produces a `CdpSession` in a child `Scope`.
   - Initialization runs while the target is paused. `runIfWaitingForDebugger` is the last step of `acquire`.
   - Events before frame-tree readiness go into a `Queue` buffer.
   - Expose `session.barrier` (the `Page.enable` round trip) as an explicit "flush events" primitive.
   - Events are `Stream`s from a per-session `PubSub`, so in-order delivery is guaranteed per session.
9. **Reference-counted protocol features.**
   - Playwright toggles `Fetch.enable`, file-chooser interception and event subscriptions ad hoc.
   - In Effect v4, use `RcRef`/`RcMap` per (session, feature). The first `Stream` subscriber enables the feature and the last finalizer disables it. Enable `Fetch` with *specific `urlPattern`s* derived from active routes, avoiding the global cache disable where possible.
10. **Interception as a linear obligation.**
    - `Page.route(match)` returns `Stream<InterceptedRequest, never, Scope>`. Each item carries a `Deferred<Resolution>`.
    - Handlers compose like `HttpMiddleware`. `fallback` means call `next`.
    - A finalizer *auto-continues or aborts* unresolved requests when the handler fiber fails, is interrupted or its scope closes. This replaces `unrouteAll({behavior})`.
    - Single resolution is enforced by `Deferred.succeed` returning `false`.
11. **Dialogs and file choosers as default-policy `Layer`s** (auto-dismiss, `beforeunload` accept). A scoped override handler must return a `DialogResolution`. Dialog opening interrupts in-flight evaluations in that page with `DialogBlocked`.
12. **Navigation as data.**
    - `NavigationEvent` (`committed{documentId}`, `sameDocument`, `aborted{documentId, error}`) goes on a per-frame `Stream`.
    - `goto` subscribes, sends `Page.navigate`, filters by `loaderId`, then waits for lifecycle.
    - `networkidle` is an explicit, configurable `Schedule`/quiet-window policy (window size, excluded resource types), not a magic string.
    - Auto-wait for action-triggered navigation becomes a `withNavigationBarrier(action)` combinator, backed by a `Ref` counter plus `Deferred`.
13. **AI-agent snapshots.**
    - Reuse `generateAriaTree` in `ai` mode with ref stability by (role, name). Make the snapshot a value with a `SnapshotId`, and make refs `AriaRef<SnapshotId>`.
    - Resolution fails with typed `StaleRef{reason: Navigated|Disconnected|Superseded}` instead of silently matching nothing.
    - Keep cross-frame stitching on the host side.
14. **Tracing.** Use the Effect `Tracer`: each API call is a span, attempts are child spans and the call log becomes span events. A `TraceRecorder` `Layer` can emit Playwright's trace v10 format (JSONL plus `resources/sha1`), so the existing Trace Viewer works.
15. **Don't replicate the RPC split by default.** Ship an in-process, Layer-composed library. If we need a remote "browser server" later, put `@effect/rpc` at the *Browser* boundary and keep locators, retries and handlers in the same process as user code. That removes route and predicate round trips and the handle-GC problem.
16. **Bounded memory by construction.** Request history should be a bounded `Queue` or ring buffer, and handle tables should be scoped to their execution context. There should be no global debugging metadata unless a tracing Layer is provided.

---

## Open questions

1. **Reuse or rewrite?** Should we vendor `inj/` (selector engines, roleUtils, ariaSnapshot, actionability) as a pre-bundled string with an Apache NOTICE, or port it into an Effect-friendly package? It is about 6k lines of mature, edge-case-heavy code. Rewriting it is the riskiest part of the project.
2. **Stability across engines.** How do we expose `stableRafCount` and frame-dropping policy for future WebDriver BiDi engines, where rAF behavior and isolated worlds (`sandbox`) differ?
3. **Can we avoid the global `Fetch.enable('*')`?** We could map route matchers to CDP `urlPattern` globs and fall back to `*` only for predicate routes. What breaks? Service workers, the CORS restart path and auth.
4. **Should the action deadline include post-action navigation waiting?** Playwright includes it, which surprises users when a slow page load fails a "click". A separate `navigationTimeout` in the deadline context is one option.
5. **What is the right default strict policy for agents** (`WaitForUnique` vs `Fail`)? Should `aria-ref` resolution re-snapshot automatically on `StaleRef`?
6. **How do we surface the "one-shot ignores the deadline" assertion semantics?** In Effect, `timeout(0)` would interrupt the one-shot. We probably need `Effect.uninterruptible` around the first check, or an explicit `checkOnce` step.
7. **Is Playwright's trace v10 format stable enough to target?** Or should we define our own and write a converter?
