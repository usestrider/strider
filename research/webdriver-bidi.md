# WebDriver BiDi: spec, clients, browser support (as of 2026-10-18)

Sources were cloned with `--depth 1` into `/tmp/prior-art/`. They are treated as data only; nothing was built or run.

| Repo | SHA | Commit date |
|---|---|---|
| w3c/webdriver-bidi (`index.bs`, 15,730 lines) | `f922e6af669ead51496db85f37813f39438ef171` | 2026-10-08 |
| webdriverio/webdriverio (sparse) | `b8053b705df3f3572f6f45f66607bd26b970e519` | 2026-10-18 |
| SeleniumHQ/selenium (sparse) | `7e2b00119955183f050a09290bb2a2d5ab7270b6` | 2026-10-18 |
| microsoft/playwright (pre-existing shared clone, `server/bidi` read) | `b335271cdc2b57cac2be8ad37c5dd283ac6b8938` | 2026-10-17 |
| GoogleChromeLabs/chromium-bidi (pre-existing shared clone, read only) | `89696e8c5530b36b938cc428aa8c9dffb12c2ac7` | 2026-10-17 |

Citations use `file:line`. `bs:` means `webdriver-bidi/index.bs`.

---

## Summary

- **BiDi has one session per WebSocket, and its events carry no session id or subscription id.** Ids are flat: navigable ("context"), user context, realm, handle, sharedId, navigation, request, intercept, collector, preload script, and subscription. A subscription is scoped by top-level traversable or by user context, and gets back a subscription id (`bs:898-958`, `bs:2234-2352`). Every client routes events itself. Playwright rebuilds CDP-style per-page "sessions" from `params.context`, `source.realm` and worker owner chains (`playwright/.../bidi/bidiConnection.ts:73-115`). Selenium Java delivers every event to every listener registered for that method, whatever context it subscribed for (`selenium/java/.../bidi/Connection.java:331-384`).
- **Configuration is scoped declaratively instead of attached per target.** Preload scripts, data collectors, emulation overrides and extra headers take `contexts | userContexts`, and the remote end applies them when new contexts are created. There is no `waitForDebuggerOnStart` equivalent. This is a better basis for `Scope` than CDP's attach/configure/resume dance. The catch is which object owns each piece of state. Some state belongs to the session (intercepts, preload scripts, subscriptions). Some belongs to the remote end and outlives the session. Device-pixel-ratio overrides are explicitly never cleared (`bs:3352-3356`).
- **Script works by value by default.** `RemoteValue` is a tagged deep serialization (Map, Set, Date, RegExp, node, window, cycles via `internalId`). Only the *root* result gets a handle, and only when `resultOwnership: "root"` (`bs:12750-12756`). Nodes are referenced by `sharedId`. Channels (`script.message`) replace `Runtime.addBinding`. Neither evaluate nor callFunction has a timeout or cancel (`bs:13600`, `bs:13785`).
- **Network.** Intercepts block only when the session is also *subscribed* to the phase's event for that navigable (`bs:11163-11195`). Response and request bodies are now in the spec via **data collectors** (`network.addDataCollector`/`getData`/`disownData`, `bs:8161-8470`, `bs:9860-10611`). Cache behavior is global to the remote end (`bs:10660-10788`).
- **Support in late 2026.** Firefox is BiDi-only: CDP was removed in Firefox 141, and screencast landed in 154. Chrome's support comes from chromium-bidi, a JS mapper running over CDP. In the source as of 2026-10-17, `startScreencast` and the forced-colors override are still unimplemented. Safari has only early pieces in Technology Preview (STP 254, Oct 8 2026, added initial `captureScreenshot`). Tracing, coverage, the AX tree, CPU and bandwidth throttling, live screencast frames and drag interception remain CDP-only.
- **CDDL to types.** WebdriverIO uses `cddl` + `cddl2ts` and produces types only. It has a key-casing bug that it works around by hand. chromium-bidi uses `cddlconv` to produce Zod. Selenium's normalizer and projector is the most serious prior art: it hoists enums, flattens group choices into variant records, and classifies union selectors as discriminated, ordered or correlated. An Effect Schema generator needs those same three selector kinds, plus `StructWithRest` for `Extensible`, verbatim wire keys, and command↔result correlation by id.

---

## Object model and lifecycle graph

```
Remote end (browser)
│  remote-end-global state (survives sessions unless noted):
│   set of user contexts; default/navigable cache behavior (reset when last session ends, bs:1847-1858);
│   download behavior (bs:3146); viewport/locale/timezone/screen/scripting/geolocation/... override maps
│   (weak maps keyed by navigable|user context, bs:3352-3416, 6614-7791); DPR overrides (never cleared, bs:3355);
│   collected network data + max total collected size (FIFO eviction, bs:8190, 8412-8428)
│
├── BiDi session  (session.new | classic+webSocketUrl)  ── ends: session.end / browser.close
│    ├─ WebSocket connection(s): closing one does NOT end the session (bs:1452); >1 conn is an open Issue (bs:1113)
│    ├─ subscriptions {id, events, top-level traversable ids | user context ids | global} + known subscription ids
│    ├─ intercept map {id → phases, urlPatterns, contexts}; blocked request map {request → (phase, response)}
│    ├─ preload script map; network collectors; extra headers; emulated UA / network conditions; screencasts
│    └─ sandbox map (weak: Window → name → SandboxWindowProxy)              cleanup: bs:1808-1845
│
└── User context  ("default" + browser.createUserContext; storage partition; per-UC proxy, insecure certs,
     │             prompt handler)        removeUserContext closes all its traversables w/o beforeunload (bs:3029-3052)
     └── Top-level traversable = browsingContext (id == classic window handle; stable across navigations) ─ client window
          ├── child navigables (iframes; same id space; `parent` field; OOPIF boundaries invisible)
          ├── Navigation (UUID): navigationStarted → navigationCommitted → domContentLoaded → load
          │                      | fragmentNavigated | navigationAborted | navigationFailed | downloadWillBegin/End
          └── active document's Window realm (realm id)    ── dies on unload → script.realmDestroyed
               ├── sandbox realms (lazily by name per Window; no realmCreated is specified for them)
               ├── handle object map (strong; freed by script.disown or realm death)  (bs:12650-12690)
               ├── nodes → sharedId (session+navigable "seen nodes"; deserializable from any same-origin realm)
               └── worker realms (dedicated: owners=[realm]; shared/service: related via owner set, bs:1305-1331)
```

**How lifetimes and events relate:**

- **Subscription replay.** `session.subscribe` runs per-event "subscribe steps" in priority order *before* it returns, and these replay existing state as synthetic events. `contextCreated` (priority 1) walks the trees recursively (`bs:5872-5879`). `realmCreated` (priority 2) covers existing realms (`bs:14096-14135`). `log.entryAdded` (priority 10) flushes the per-session **log buffer**, which collects entries while nobody is subscribed (`bs:14676-14700`, `bs:14913-14938`). The local listener must therefore be attached *before* the subscribe is sent. Selenium JS's `addCallback` documents exactly this race (`selenium/javascript/selenium-webdriver/bidi/index.js:375-420`).
- **Contexts.** `browsingContext.create` emits `contextCreated` with `hasPlannedNavigation` and `userContext`. Close emits `contextDestroyed` with the full subtree info, then **prunes** context-scoped subscriptions. A subscription whose id set becomes empty is removed, but its id stays in "known subscription ids", so a later unsubscribe-by-id still succeeds (`bs:5881-5925`, `bs:900`). Removing a user context prunes UC-scoped subscriptions the same way (`bs:1709-1732`).
- **Quirk.** For a *top-level* context, `contextDestroyed` computes its related navigables as `{parent}`, which is empty (`bs:5908`). Under "event is enabled" (`bs:930-958`), as written, only *global* subscriptions receive it. A context- or user-context-scoped subscriber never sees its own tab die. Verify this against WPT before relying on scoped subscriptions for teardown.
- **Navigation and realms.** A navigation keeps the navigable id but replaces the realm. `realmDestroyed` fires from the "unloading document cleanup steps" (`bs:14139-14200`). Handles and sandbox realms die with the Window. Navigation ids also appear on network events (`network.BaseParameters.navigation`, `bs:8693-8705`), so requests can be grouped per navigation.
- **Session end.** Blocked requests are *resumed* (continue), collectors are dropped and screencasts stopped. Remote-end overrides are not reset; only cache behavior resets, and only when the last session ends (`bs:1808-1858`).

---

## Mechanisms (with citations)

### 1. Sessions, commands, subscriptions

- **Envelope.** `Command = {id, method, params, Extensible}`. Replies are `{type:"success", id, result}` or `{type:"error", id|null, error, message, stacktrace?}`. Events are `{type:"event", method, params}` (`bs:584-662`). Every command runs "in parallel", so **responses can arrive out of order** (`bs:737-741`, `bs:1252`). The command id is opaque to the remote end and may be reused (`bs:763-770`).
- **Subscription API.** `session.subscribe {events: [+text], contexts? | userContexts?}` returns `{subscription}`. `events` may name a whole module, e.g. `"network"` (`bs:1001-1019`). Contexts are widened to their top-level traversable, so you cannot subscribe to a single iframe. Passing both `contexts` and `userContexts` is invalid (`bs:2270-2275`). `session.unsubscribe` takes either `{subscriptions:[ids]}` or the legacy `{events}`. The legacy form only removes *global* subscriptions and errors if any named event was not matched (`bs:2384-2432`).
- **Delivery.** Subscriptions are **deduplicated on delivery**. The event is emitted once to the session if *any* subscription matches, with no subscription id attached (`bs:1399-1410`, `bs:915-958`). Overlapping subscriptions therefore cannot be told apart on the wire.
- **Two connection modes.** One is a classic HTTP session with the `webSocketUrl: true` capability. The other is a "BiDi-only" session at `ws://…/session` followed by `session.new` (`bs:1474-1517`, `bs:2123-2188`).

### 2. Browsing contexts, user contexts, navigation

- **`browsingContext.Info`** contains `{context, parent?, children, url, userContext, originalOpener, clientWindow}` (`bs:3495-3515`). `create {type: tab|window, referenceContext?, background?, userContext?}` (`bs:4297-4406`). `close {promptUnload?}` works only on top-level contexts. Whether closing the last tab closes the browser is still open (Issue #170, `bs:4291`).
- **`navigate {context, url, wait: none|interactive|complete}`** returns `{navigation: id|null, url}`. It is implemented by "await a navigation" over the event set started/failed/fragment and then committed/DCL/load/aborted/download (`bs:3595-3668`). Failures surface as `unknown error`, with an open Issue on reporting them better (`bs:3652-3658`).
- **`locateNodes`** takes `css | xpath | innerText | accessibility{name, role} | context` locators and returns `NodeRemoteValue[]` with sharedIds (`bs:3670-3716`). This is the only a11y surface; there is no AX tree.

### 3. Script

**Commands.** `script.evaluate {expression, target, awaitPromise, resultOwnership?, serializationOptions?, userActivation?}` and `script.callFunction {functionDeclaration, target, awaitPromise, arguments?: LocalValue[], this?, …}` (`bs:13561-13856`). `target` is `{realm}` or `{context, sandbox?}`; the latter resolves to the context's *current* active document at call time (`bs:13344-13420`). A thrown exception is a *success* response with `{type:"exception", exceptionDetails}`, not a protocol error (`bs:11604-11631`). There is **no timeout and no cancel** (`bs:13600`, `bs:13785`). WebdriverIO adds a client-side timer and keeps an "expired ids" set so it can drop late replies, citing w3c/webdriver-bidi#199 (`webdriverio/packages/webdriver/src/bidi/core.ts:22-45, 300-330`).

**Values.**
- `LocalValue` (input) is a primitive, `{type: array|object|map|set|date|regexp, value}`, `{handle}`, `{sharedId}` or `{type:"channel", value:{channel, serializationOptions?, ownership?}}` (`bs:11715-11770`).
- `RemoteValue` (output) is a tagged union of ~21 kinds, plus `handle?` and `internalId?` (`bs:12463-12640`). Non-JSON numbers are strings: `"NaN" "-0" "Infinity" "-Infinity"`. Map and object entries are `[[key, value]]` tuples.
- Depth is controlled by `serializationOptions {maxDomDepth=0, maxObjectDepth=null, includeShadowTree=none}` (`bs:13168-13180`).
- Duplicates and cycles carry `internalId` and appear by value only once (`bs:12716-12741`).
- Nodes always get a `sharedId` and a partial `NodeProperties` (`bs:12560-12600`).

**Ownership.** `resultOwnership` defaults to `"none"`. With `"root"`, the root object (and only the root) is put in the realm's *strong* handle map. After that the serializer sets ownership to `"none"` for nested values (`bs:12684-12693`, `bs:12750-12756`). Handles live until `script.disown {handles[], target}` or until the realm is discarded. There are no object groups (`bs:13514-13559`, `bs:12650-12660`). `sharedId` deserialization re-checks same-origin-domain and wraps the node in a `SandboxProxy` when the target is a sandbox. This is how one node is passed between the main world and an isolated world (`bs:12427-12457`). Playwright gets "handle-only" results with `resultOwnership: Root` plus `maxObjectDepth: 0, maxDomDepth: 0` (`playwright/.../bidi/bidiExecutionContext.ts:68-69`). It obtains sharedIds by re-serializing a handle (`:141-150`).

**Sandboxes.** `target {context, sandbox: name}` lazily creates a per-Window sandbox realm (`bs:1542-1566`). Large parts of the definition are still "Issue: Define how this works" (`bs:1571`, `bs:1610`, `bs:1629`). No `realmCreated` is specified for sandboxes. Playwright learns the utility world's realm id by evaluating `1 + 1` in it (`playwright/.../bidi/bidiPage.ts:158-185`).

**Preload scripts.** `script.addPreloadScript {functionDeclaration, arguments?: ChannelValue[], contexts? (top-level only) | userContexts?, sandbox?}` (`bs:13423-13512`). The function runs on every new Window, iframes included, matched by the top-level id, before any author script. Exceptions are reported to the page, not to the client (`bs:11452-11553`). Arguments may *only* be channels.

**Channels vs `Runtime.addBinding`.** A channel is a function *value* that the remote end creates and passes as an argument. It is not a page-visible global. Calling it emits `script.message {channel, data: RemoteValue, source: {realm, context?, userContext?}}`, serialized with the channel's own options and ownership (`bs:11556-11602`, `bs:13990-14050`). With `ownership: "root"`, a page can hand the client a live *handle*, which CDP bindings cannot do: their payload is a string. Channel ids are chosen by the client and are not namespaced.

**CDP comparison.**
- `Runtime.RemoteObject` returns an `objectId` for *every* non-primitive unless `returnByValue`, and `returnByValue` is lossy JSON. BiDi defaults to faithful by-value results with explicit opt-in handles.
- CDP's `objectGroup` and `releaseObjectGroup` give bulk release. In BiDi the client must keep a handle list per realm, or rely on realm death.
- CDP's `Runtime.callFunctionOn(serializationOptions: {serialization: "deep"})` and `deepSerializedValue` exist largely so chromium-bidi can implement this on top of CDP.
- `Page.addScriptToEvaluateOnNewDocument` must be re-issued on each auto-attached target. BiDi scopes preload scripts by user context once.

### 4. Input

- **Model.** `input.performActions {context, actions: SourceActions[]}`. Sources are `none` (pause only), `key`, `pointer` (`pointerType: mouse|pen|touch`, `bs:15108-15115`) and `wheel`. Each source has a client-chosen `id` and an ordered action list (`bs:15032-15190`).
- **Ticks.** Per WebDriver Classic "extract an action sequence", the per-source lists are transposed into **ticks**. Tick *n* holds the *n*-th action of every source (padded with pauses). All actions in a tick dispatch concurrently, and the tick lasts as long as its longest `duration`. A pointer `move` can use `origin: viewport | pointer | {type:"element", element: SharedReference}`. Pointer actions carry width, height, pressure, tilt, twist and altitude/azimuth (`bs:15170-15187`).
- **State.** Input state is keyed by **(session, top-level traversable)** (`bs:15192-15198`). That covers pressed keys, modifiers, pressed buttons, pointer x/y and the source map, so state persists across calls. `input.releaseActions {context}` dispatches the **input cancel list in reverse** (synthesizing keyUp and pointerUp for everything still held) and then resets the state (`bs:15208-15262`). CDP `Input.dispatch*Event` is stateless; the client tracks modifiers and buttons.
- **Files.** `input.setFiles {context, element: SharedReference, files: [paths]}` takes paths on the **remote end's filesystem**; nothing is uploaded. It fires `cancel` if the selection is unchanged and returns `unsupported operation` if the paths are unreadable (`bs:15265-15350`). File pickers raise `input.fileDialogOpened {context, element?, multiple}` and are dismissed or left open via the `file` key of `unhandledPromptBehavior` (`bs:15355-15444`, `bs:2001-2015`). CDP equivalents are `DOM.setFileInputFiles` and `Page.setInterceptFileChooserDialog`.

### 5. Network

- **Intercepts.**
  - `network.addIntercept {phases: [beforeRequestSent|responseStarted|authRequired], contexts? (top-level), urlPatterns?}` has **no `userContexts`**, unlike collectors, preloads and emulation (`bs:9968-10049`).
  - Matching checks contexts, phase and URL pattern (`bs:8487-8530`). The event then carries `isBlocked` and `intercepts: [ids]` (`bs:8693-8758`).
  - **Blocking happens only inside the loop over sessions for which the event is enabled.** An intercept without a subscription silently never blocks (`bs:11163-11195`). With several sessions, each blocks in turn.
  - Blocked requests are released at session cleanup (`bs:1822-1826`). `removeIntercept` does **not** release requests that are already blocked (`bs:10650-10654`).
- **Decisions per phase.**
  - `continueRequest {url, method, headers, cookies, body}` is valid only at beforeRequestSent (`bs:10051-10185`).
  - `continueResponse {statusCode, reasonPhrase, headers, cookies, credentials}` (`bs:10187-10234`).
  - `provideResponse {statusCode, headers, cookies, body}` works in any phase (`bs:10507-10563`).
  - `failRequest` is not allowed at authRequired, and you cannot choose the error reason (Issue 508, `bs:10367-10419`).
  - `continueWithAuth {action: provideCredentials|default|cancel}` (`bs:10236-10309`).
- **Rough edges.**
  - The responseStarted trigger stores the blocked phase as `"beforeRequestSent"` (`bs:11399-11400`). As written, that would let `continueRequest` run at responseStarted and would reject `continueResponse`. It looks like an editorial bug.
  - `addIntercept` stores `browsingContexts` but matching reads `contexts` (`bs:10042` vs `bs:8506`).
  - Implementations diverge. WebdriverIO notes that Firefox accepts a `provideResponse` body only at beforeRequestSent. It also notes that Chromium turns a context-scoped intercept whose context died into a **global** one, which blocks other tabs (`webdriverio/packages/webdriverio/src/utils/interception/index.ts:228-247, 787-806`).
- **Data collectors (now in the spec).**
  - `network.addDataCollector {dataTypes: [request|response], maxEncodedDataSize (per item), collectorType: "blob", contexts? | userContexts?}` (`bs:9860-9966`).
  - `network.getData {request, dataType, collector?, disown?}` *waits* while collection is pending, then returns `BytesValue` or one of the errors `no such network data` / `unavailable network data` (evicted) (`bs:10421-10505`). There are also `disownData` and `removeDataCollector`.
  - Bodies are cloned **only if a collector exists when the request or response is created** (`bs:8236-8270`).
  - Only the final body in a redirect chain is kept (`bs:8303-8305`).
  - The remote end has a total budget with FIFO eviction, and size is counted in encoded bytes, so limits differ between browsers (`bs:8190-8197`, `bs:8412-8428`).
  - Playwright installs one global 20 MB collector at connect (`playwright/.../bidi/bidiBrowser.ts:89-92`) and calls `getData` lazily in `response.body()` (`bidiNetworkManager.ts:131-134`).
- **Cache and headers.**
  - `network.setCacheBehavior {cacheBehavior: default|bypass, contexts?}` is remote-end-global state. Called without contexts it clears per-context entries (`bs:10660-10788`).
  - Playwright switches the *global* cache to bypass whenever any context has routes (`bidiBrowser.ts:148-154`).
  - Also present: `network.setExtraHeaders` (session-scoped, by context or user context) and `emulation.setNetworkConditions`, which supports **offline only** (`bs:7018-7138`).
- **Request identity.** The request id is stable across redirects, and `redirectCount` tells hops apart (`bs:8693-8705`).

### 6. CDDL → types

- **The spec's CDDL.** The spec carries two CDDL modules, *remote* (client→browser) and *local* (browser→client); types used in both directions are emitted into both (`bs:567-572`). CI extracts `local.cddl`, `remote.cddl` and `all.cddl` (`scripts/cddl/generate.js`), validates them with the Rust `cddl` crate, and uploads them as a `cddl` artifact (`webdriver-bidi/scripts/test.sh`, `.github/workflows/test.yml:16-45`).
- **WebdriverIO** (`infra/bidiCodegen/src/generate.ts`).
  - Pipeline: download the CI artifact via Octokit, parse with the npm `cddl` parser, then `cddl2ts.transform(ast, {useUnknown: true})` writes `localTypes.ts`/`remoteTypes.ts`.
  - A recast pass then emits `BidiHandler` methods. It treats any remote group whose first property is `method` as a command and finds the result *by name convention* (`${Name}Result`, otherwise `EmptyResult`). Each method returns `result.result as local.X`, an unchecked cast (`generate.ts:79-123`).
  - Event typing is a mapped type over `EventData['method']` (`packages/webdriver/src/types.ts:66-76`).
  - Defect: quoted keys are camelCased. `"prefers-color-scheme"` becomes `prefersColorScheme` (`remoteTypes.ts:613-619`), so `emulate.ts` converts keys back to wire names by hand (`toMediaFeatureWire`, `emulate.ts:119-131`). Numeric ranges collapse to `number`, and some `.default`s are dropped.
- **chromium-bidi.** `cddlconv 0.2.0` generates Zod (`src/protocol-parser/generated/webdriver-bidi.ts`, 7,196 lines). `Extensible` becomes `z.record(z.string(), z.any())` joined with `.and(...)`. Group choices become `z.object({...}).and(z.union([...]))`. Recursive values are `z.lazy`, and `RemoteValue` is typed `z.ZodType`, which erases its type. Unions are tried in CDDL order. That order matters: the spec orders `SharedReference` before `RemoteObjectReference` "in the order in which matches need to be evaluated" (`bs:12358-12359`).
- **Selenium** (`common/webref_cddl.bzl`, `javascript/selenium-webdriver/normalize_bidi_ast.mjs`, `project_bidi_schema.mjs`, `java/.../bidi/BiDiGenerator.java`).
  - Inputs: it pins **w3c/webref** `ed/cddl/*-all.cddl` for the core spec *and* extension specs (permissions, bluetooth, digital-credentials, prefetch, ua-client-hints), plus Firefox vendor grammars (`moz:` Debugging, Profiler, Commands, Fields).
  - Normalization hoists inline literal unions into enums. It rewrites `{common, (A // B)}` into self-contained variant records, so "field required only in this variant" holds by construction (`normalize_bidi_ast.mjs:17-60`).
  - The projected schema classifies every union selector as **discriminated `{by}`**, **ordered structural `{ordered: [{ref, requires: [key]}]}`** or **`correlated`** ("resolved by request id, not the payload", which is how `ResultData` works). It also marks `objectOnly`, `scalarValues`, nullable, numeric bounds, and `outbound`/`inbound` reachability (send-side accessors only for outbound types), and keeps vendor contributions in a separate namespace (`project_bidi_schema.mjs:18-80`).
- **What an Effect Schema generator needs.**
  1. **Directionality.** Decode-only for `local` types, encode-only for `outbound` types.
  2. **Splice group choices into the map** and emit `Schema.Union` of complete `Schema.Struct`s. Detect literal discriminators (`type`, `action`, `proxyType`, `state`, `method`) and expose them via `Schema.toTaggedUnion(tag)` for `match`/`cases`.
  3. **Untagged unions.** For `RemoteReference`, `LocalValue` (handle/sharedId arms mixed with `type`-tagged arms), geolocation `coordinates` vs `error`, and `input.Origin` (`"viewport"`/`"pointer"`/object), generate an order-preserving union with key-presence guards (Selenium's `requires`). Without the guards, an `Extensible` arm swallows its siblings.
  4. **`Extensible`** (`*text => any`) becomes `Schema.StructWithRest(struct, [Schema.Record(Schema.String, Schema.Unknown)])` where vendor keys must survive (`goog:channel`, `moz:*`, capabilities). Elsewhere, plain `Struct` is cheaper.
  5. **Verbatim wire keys.** Add `Schema.encodeKeys` only if TS names are camelCased.
  6. **Optional vs nullable.** `? k: T / null` becomes `optionalKey(NullOr(T))`. `null` means "reset override" and is semantically distinct from absent.
  7. **Defaults.** `.default` becomes `withDecodingDefault` only on decoded types; never send defaults.
  8. **Constraints.** `js-uint`/`js-int`/float ranges, `.ge`/`.gt` and non-empty `[+T]` become checks.
  9. **Recursion.** `RemoteValue`/`LocalValue`/`NodeProperties` use `Schema.suspend`. Add transforms for special numbers, BigInt-as-text, and `[[k, v]]` → `Map`.
  10. **Correlation.** A **command registry** `{method, params, result, errors}` lets responses decode by the pending id's command, not by the payload. An **event registry** is keyed by `method`.
  11. **Errors.** `ErrorCode` literals become tagged errors with an unknown fallback. Normalize Chrome's `unknown error - Method X is not implemented` to `UnsupportedOperation`; WebdriverIO already has to regex this (`emulate.ts:106-114`).
  12. **Extension modules and vendor grammars** go into separate namespaces (command names containing `:`, `bs:721-733`).
  13. **Spec anchors** (`#command-…`) in JSDoc.

### 7. Spec-level friction and ordering

- **Ordering.** Commands may complete out of order. No event has a sequence number; navigation and network events carry wall-clock `timestamp`s. Ordering is *implied* only where events are emitted inside a command's steps: subscribe replays, `contextCreated` during `create`, `navigationStarted` before `navigate` returns. Cross-module ordering is not guaranteed. Mozilla bug 1882454 reports `network.responseCompleted` arriving after the navigation `load` events. W3C minutes from 2020–21 show the WG chose *not* to impose strict ordering.
- **Concrete friction.**
  - Subscription is a separate step from listening, and the wire gives no subscription attribution.
  - Intercepts need an event subscription to take effect.
  - Intercepts cannot be scoped by user context.
  - Top-level `contextDestroyed` reaches only global subscriptions, as written.
  - Sandboxes are under-specified, and there is no timeout or cancel for script.
  - `setFiles` works on remote-end paths.
  - Screencast writes a *file on the remote end* (`bs:5468-5616`), not a stream.
  - Override state is split between session and remote end, and some of it outlives sessions.
  - Navigation failures are reported as `unknown error`.

---

## CDP ↔ BiDi mapping

| Concept a driver needs | CDP | WebDriver BiDi | Note for a neutral core |
|---|---|---|---|
| Transport/session | browser WS; flat sessions (`sessionId` on every message) via `Target.attachToTarget{flatten}` | one session per WS; no per-target channel; events tagged with `context`/`source.realm` | build a client-side router (Playwright `bidiConnection.ts:73-115`) |
| Browser context | `Target.createBrowserContext` / `disposeBrowserContext` | `browser.createUserContext {proxy, acceptInsecureCerts, unhandledPromptBehavior}` / `removeUserContext`; `"default"` | same scope shape |
| Page / top-level target | `targetId` (type page) | top-level `browsingContext` (= window handle) | — |
| Frame | `frameId`; OOPIFs are separate targets | child `browsingContext` with `parent`; OOPIF invisible; id stable across navigations | BiDi is simpler |
| New-target setup race | `Target.setAutoAttach{waitForDebuggerOnStart}` + `Runtime.runIfWaitingForDebugger` | none; settings declared by `contexts`/`userContexts` apply at creation | model config as scoped declarations |
| Event enablement | `Domain.enable` per session | `session.subscribe {events, contexts \| userContexts}` → id; `unsubscribe {subscriptions}` | acquireRelease per subscription |
| Execution context | `Runtime.executionContextCreated {id, uniqueId, auxData{frameId, isDefault}}` | `script.realmCreated {realm, type, context, sandbox?, origin}` / `realmDestroyed` | Realm |
| Isolated world | `Page.createIsolatedWorld` | `target {context, sandbox: "name"}` (lazy) | "world" = name |
| Evaluate | `Runtime.evaluate` / `callFunctionOn(objectId \| executionContextId)` | `script.evaluate` / `callFunction(target)` | — |
| Value model | `RemoteObject` (objectId by default; `returnByValue` JSON; `deepSerializedValue`) | `RemoteValue` (tagged deep by default; handle only on root with `ownership: root`) | default by-value, opt-in handles |
| Handle release | `releaseObject`, `releaseObjectGroup` | `script.disown {handles[], target}`; realm death | batch disown in finalizer |
| Node identity | `nodeId` (DOM.enable), `backendNodeId` | `sharedId` (cross-realm, same-origin checked) | ElementRef = sharedId |
| Page→client callback | `Runtime.addBinding` → `bindingCalled{payload: string}` | channel argument → `script.message {channel, data: RemoteValue, source}` | Channel = Stream |
| Init script | `Page.addScriptToEvaluateOnNewDocument` (per target) | `script.addPreloadScript {fn, channel args, contexts \| userContexts, sandbox}` | scoped |
| Navigation | `Page.navigate` → `loaderId`; lifecycle events | `browsingContext.navigate {wait}` → navigation id; started/committed/DCL/load/aborted/failed | Navigation entity |
| Network observe | `Network.requestWillBeSent` / `responseReceived` / `loadingFinished` / `loadingFailed` | `network.beforeRequestSent` / `responseStarted` / `responseCompleted` / `fetchError` | — |
| Interception | `Fetch.enable {patterns{urlPattern, resourceType, requestStage}, handleAuthRequests}` → `requestPaused` / `authRequired` | `network.addIntercept {phases, urlPatterns, contexts}` + subscription → `isBlocked`, `intercepts` | no resourceType filter in BiDi |
| Resolve paused request | `continueRequest` / `fulfillRequest` / `failRequest(reason)` / `continueResponse` / `continueWithAuth` | `continueRequest` / `provideResponse` / `failRequest` (no reason) / `continueResponse` / `continueWithAuth` | decision ADT |
| Bodies | `Network.getResponseBody`, `Fetch.getResponseBody` / `takeResponseBodyAsStream`, `getRequestPostData` | `addDataCollector` + `getData {disown}` | collector must pre-exist |
| Cache | `Network.setCacheDisabled` (per target) | `network.setCacheBehavior` (global or top-level; remote-end state) | — |
| Extra headers | `Network.setExtraHTTPHeaders` | `network.setExtraHeaders {contexts \| userContexts}` | — |
| Input | `Input.dispatchMouse/Key/TouchEvent` (stateless) | `input.performActions` (ticks; state per session × traversable) + `releaseActions` | Actions DSL |
| File input | `DOM.setFileInputFiles`; `Page.fileChooserOpened` | `input.setFiles`; `input.fileDialogOpened` + `unhandledPromptBehavior.file` | — |
| Dialogs | `Page.javascriptDialogOpening` / `handleJavaScriptDialog` | `userPromptOpened` / `Closed`; `handleUserPrompt`; capability default handler | — |
| Screenshot / PDF | `Page.captureScreenshot` / `printToPDF` (stream via IO) | `browsingContext.captureScreenshot` / `print` (base64) | — |
| Screencast | `Page.startScreencast` → `screencastFrame` + ack | `startScreencast` → remote file path; `stopScreencast` | not equivalent |
| Emulation | `Emulation.*` (device metrics, CPU, vision, sensors, …) | `setViewport` + `emulation.*` (value \| null, contexts \| userContexts) | null = release |
| Downloads | `Browser.setDownloadBehavior`, `downloadWillBegin` / `Progress` | `browser.setDownloadBehavior`, `downloadWillBegin` / `End` | — |
| Console / errors | `Runtime.consoleAPICalled` / `exceptionThrown` | `log.entryAdded` (buffered until subscribed) | — |
| Escape hatch | n/a | `goog:cdp.sendCommand` / `getSession` / `resolveRealm` (Chrome); `moz:*` (Firefox) | capability-gated |
| Multiplexed clients | separate sessions | `goog:channel` tag on commands → echoed on events (chromium-bidi only) | — |

---

## Support matrix as of 2026-10-18

The Chrome column draws on the chromium-bidi source at `89696e8`. Its `CommandProcessor.ts` dispatch table lists what is implemented. The README says the source now lives in the Chromium tree (`third_party/chromium-bidi`) as "a JavaScript layer translating between BiDi and CDP, running inside a Chrome tab". ChromeDriver hosts the mapper, as do Puppeteer and Playwright in-process (`playwright/.../bidi/bidiOverCdp.ts`).

| Feature | Chrome (chromium-bidi) | Firefox | Safari / WebKit |
|---|---|---|---|
| Core: session, subscribe, browsingContext, script, log, input | Yes | Yes (BiDi-only since **CDP removal in Fx 141**; deprecated in 129) | Partial, **Technology Preview only**: STP 253 (2026-09-23) fixed `script.callFunction` error text; STP 254 (2026-10-08) "initial support" for `captureScreenshot`. WebKit bug 281937 (script module) was still NEW in snapshots. No BiDi in Safari 27 stable notes |
| addIntercept / continue / provide / auth | Yes. Caveat: dead-context intercept becomes global (WDIO comment) | Yes. `provideResponse` body only at beforeRequestSent (WDIO comment) | No |
| Data collectors / getData | Yes (Playwright relies on it) | Yes. `addDataCollector` in Fx 143 (response only); request bodies in Milestone 18 (done 2026-01-04) | No |
| setCacheBehavior, setExtraHeaders | Yes | Yes | No |
| Emulation (UA, geolocation, locale, timezone, screen, orientation, touch, scripting, media features) | Mostly. `setForcedColorsModeThemeOverride` throws Unsupported; WDIO saw "Method emulation.setViewportMetaOverride is not implemented" in **Chrome 155** | Yes (Milestones 16–18) | No |
| `emulation.setNetworkConditions` | Yes (offline) | Fx 150, offline only | No |
| `browsingContext.setBypassCSP` | Routed | Milestones 19/20 (2026-03/06) | No |
| `startScreencast` / `stopScreencast` | **Not implemented** (throws) | Fx 154 (bug 2042671); meta bug 2042668 still open | No |
| Downloads (`setDownloadBehavior` + events) | Yes | Yes (Milestones 20/22) | No |
| webExtension.install / uninstall | Yes | Yes, plus `moz:listExtensions` (Fx 158) | No |
| Permissions extension spec | Yes | Yes; camera/mic in Fx 158 (2026-10-13) | No |
| Profiling / tracing | via `goog:cdp.sendCommand` only | vendor `moz:profiler.start/stop` (returns a file path) | No |

**Still CDP-only (no BiDi command in the spec):**
- Tracing (`Tracing.*`), `Performance.getMetrics`, CPU and heap profiling, JS and CSS **coverage**
- The full **accessibility tree** (BiDi offers only an `accessibility` locator)
- DOMSnapshot / CSS / Overlay / Debugger
- CPU throttling; network latency and bandwidth throttling (BiDi is offline-only)
- Vision-deficiency, idle, focus and sensor emulation
- Live screencast *frames*; PDF or body *streaming*
- Drag interception; service-worker bypass; TLS security details
- WebAuthn virtual authenticators (classic WebDriver extension only)
- Prerender control (Playwright sends `goog:prerenderingDisabled`, w3c#321)
- Background color override (Playwright: "Not implemented")

Puppeteer 25.14.0's BiDi page lists Accessibility, Coverage, Tracing, `emulateCPUThrottling`, `emulateNetworkConditions`, `screencast`, `metrics` and drag APIs as unsupported. It also still lists `HTTPResponse.buffer()` as unsupported, which suggests that page lags behind data collectors.

---

## Ergonomics: what to steal, what to avoid

### Call sites at their best

WebdriverIO `mock` is declarative, filters on the remote end by URL pattern, and returns a disposable handle (`webdriverio/packages/webdriverio/src/commands/browser/mock.ts`, `examples/bidi/multiremote-mock.js`):

```js
const mock = await browser.mock('https://example.com/**')
mock.respond({ mocked: true })
await browser.url('https://example.com/')
await mock.waitForResponse({ timeout: 10_000 })
mock.getInstance('myChromeBrowser').calls.length   // recorded calls
```

WebdriverIO `addInitScript` wraps preload script + channel + `script.message` into a typed handle (`commands/browser/addInitScript.ts:19-47`):

```js
const script = await browser.addInitScript((emit) => {
  new MutationObserver(ms => ms.forEach(m => emit(m.target.nodeName)))
    .observe(document, { childList: true, subtree: true })
})
script.on('data', (data) => console.log(data))
await script.remove()
```

Selenium Java modules are `AutoCloseable` (`module/Network.java:45`, `LogInspector.java:43`), which gives try-with-resources scoping. `RemoteNetwork.addRequestHandler(Predicate<URI>, UnaryOperator<HttpRequest>)` is a pure request→request function (`remote/RemoteNetwork.java:175-181`).

Playwright never shows BiDi to users at all. `page.route` and `page.evaluate` sit on a CDP-shaped internal model. Its BiDi backend fits under that model by (a) subscribing once to whole modules, `events: ['browsingContext','network','log','script','input']` (`bidiBrowser.ts:77-85`), and (b) routing by context.

### Call sites at their worst

- **Two-step subscribe-then-listen with nothing linking the steps** (`examples/bidi/logging.js`):
  ```js
  await browser.sessionSubscribe({ events: ['log.entryAdded'] })
  browser.on('log.entryAdded', (e) => console.log(e))   // never unsubscribed; misses replayed events if attached late
  ```
- **Leaks.** `addInitScript` subscribes globally to `script.message` and never unsubscribes. Its own doc example calls an undefined `reset()` instead of `script.remove()` (`addInitScript.ts:22-27, 147-175`). Arguments are JSON-stringified into the source, and arity is capped at 5 by overloads.
- **Selenium JS `Network.subscribeAndHandleEvent`.**
  - It attaches a **new raw `ws.on('message')` listener per call**, which parses every frame, command replies included.
  - It identifies event types by *sniffing shape*: `'initiator' in params` → BeforeRequestSent, `'response' in params` → ResponseStarted, which also matches responseCompleted and authRequired (`selenium/javascript/selenium-webdriver/bidi/network.js:147-198`).
  - The core `subscribe` is self-documented as "Not the correct implementation" (`bidi/index.js:279-294`).
- **Selenium Java context listeners.** `addListener(contextId, event, handler)` subscribes per context, but dispatch calls *every* handler for that method (`Connection.java:348-380`), so a context-scoped listener sees other tabs' events. `clearListener(Set<contexts>, event)` ignores the contexts ("This is not the correct implementation", `BiDi.java:113-121`).
- **Selenium `RemoteNetwork`.** The constructor installs a **global, pattern-less** beforeRequestSent intercept and an authRequired intercept. Every request in the browser then round-trips through the client, with filtering done client-side (`RemoteNetwork.java:53-147`). If the handler throws or stalls, the page hangs.
- **Override stacking.** WebdriverIO `emulate` had to build `claimRestore` so an *older* restore does not clear a *newer* override of the same scope (`emulate.ts:73-100`). Overrides are last-writer-wins maps with no stack on the wire.

### Where users hit friction

- **Ceremony.** Every feature needs subscribe + command + listener, plus remembering to unsubscribe. Intercepts need a matching subscription or they do nothing.
- **Footguns.**
  - Context-scoped intercepts become global on Chromium after their context dies.
  - Remote-end-global cache and emulation state outlives the test.
  - `setFiles` paths are resolved on the remote host.
  - WDIO warns that repeated `**` wildcards in URLPattern "can make the match very slow and freeze a test" (`mock.ts:44-48`).
- **Confusing names.** `browsingContext` means navigable, and "context" means a tab *or* a frame. `userContext` means browser profile. `realm` means execution context. A `sandbox` is a named world. `isBlocked` is a per-session view.
- **Poor errors.** `navigate` failures are `unknown error`. The "not implemented" wording varies by vendor. `no such request` races occur when a request is cancelled while blocked, and WDIO swallows them (`interception/index.ts:784-790`). There is no script timeout.
- **Hard to discover.** The `sandbox` field for isolated worlds; `resultOwnership: "root"` to get a handle at all; `maxObjectDepth: 0` for a handle-only result; channels taking `ownership: "root"` to emit live handles; `goog:channel`; `userActivation: true` on evaluate.

### How the internals make a nice surface possible

- **One firehose subscription plus a client-side router keyed by context, realm and owner chain** (Playwright). That turns BiDi into per-page event emitters, so user-level APIs never touch `session.subscribe`.
- **A typed event map from the discriminated `method`** (WDIO `EventMap`, Playwright `BidiEvents`). The listener payload type follows from the event name.
- **Attach the local listener before sending subscribe; roll back on failure** (Selenium JS `addCallback`).
- **Per-mock ownership via `event.intercepts.includes(myId)`**, not URL re-matching (WDIO `#isOwnEvent`, `interception/index.ts:926-939`).
- **Capability-aware fallbacks hidden behind one verb**, e.g. WDIO's Firefox early-answer path in `mock.respond`.

**Takeaway.** The pleasant APIs all hide subscriptions, intercept ids and handles behind a *returned resource with a dispose method*. The bad ones expose the protocol's split between "configure" and "listen".

---

## Lessons for a protocol-neutral core (Effect v4 primitives)

1. **Connection as a service; out-of-order RPC.** `Context.Service` `ProtocolClient` keeps a `Map<id, Deferred>` and one reader fiber (`Effect.forkScoped`). Interrupting a waiter deletes its Deferred and records the id as abandoned, so a late reply is dropped (WDIO's expired-ids). BiDi has **no cancel**, so "real interruption" means *compensating actions*: `failRequest`/`continueRequest` for blocked requests, `releaseActions` for input, `disown` for handles. Attach them with `Effect.onInterrupt`/`onExit`, never by assuming the remote stops.
2. **A command registry is the schema boundary.** Generate `{method, params: Schema, result: Schema, errors}` per command. Decode results through the pending id's command (Selenium's `correlated`). Decode events with a `Schema.Union` keyed by `method`. Map error codes to `Schema.TaggedError` classes (`NoSuchFrame`, `NoSuchHandle`, `NoSuchRequest`, `UnsupportedOperation`, …) and normalize vendor "not implemented" strings.
3. **Events are scoped Streams with subscribe-after-listen ordering.** `events(spec)` returns `Stream` built as follows: `PubSub.subscribe` (local) first, then `session.subscribe`, finalizer `session.unsubscribe({subscriptions:[id]})`, then `Stream.filter` by context, userContext or realm, because the wire has no attribution. Internal model events (context, realm and navigation lifecycle) use one permanent global subscription per browser scope, as in Playwright. Use bounded or sliding PubSubs per consumer so a slow user stream cannot stall the router.
4. **A Scope tree that mirrors protocol containment, with externally closed scopes.** Browser ⊃ UserContext (`acquireRelease(createUserContext, removeUserContext)`) ⊃ Page (`create`/`close`) ⊃ Frame ⊃ Realm ⊃ Handle. Frames and realms are *observed*, not created: their scope closes when `contextDestroyed`/`realmDestroyed` arrives. Expose `realm.destroyed: Deferred<void>` and run every realm-bound op as `Effect.raceFirst(op, realm.destroyed → RealmDestroyed)`. Navigation becomes typed interruption of in-flight evaluates. Handle finalizers batch `script.disown` per realm and skip it if the realm is already gone.
5. **Overrides are stacked, scoped resources.** Each setting (`emulation.*`, `setViewport`, `setCacheBehavior`, `setDownloadBehavior`, `setExtraHeaders`, `setBypassCSP`) is `acquireRelease(set(v), restorePrevious)` keyed by (setting, target) in an `RcMap` holding a stack. Release re-applies the previous value, or `null`, so nested scopes compose and WDIO's `claimRestore` logic becomes structural. Remote-end-global state must be released even on session failure, so register the finalizers on the Browser scope.
6. **Interception: total handlers on the remote end.** `Network.intercept({phases, urlPatterns, contexts}, handler)` runs the following inside one Scope: ensure the phase subscription (the spec requires it), `addIntercept`, and route only events whose `intercepts` contains our id. The handler returns a decision ADT (`Continue{overrides} | Fulfill | Fail | Auth`) and runs in a `FiberSet` tied to the scope. `Effect.onExit` guarantees a default `continueRequest` on failure or interruption. Close order is `removeIntercept`, then drain still-blocked ids. Push URL filtering into `urlPatterns`; never install a pattern-less global intercept (the RemoteNetwork lesson). For per-user-context routing, which `addIntercept` lacks, do what Playwright does: a global intercept with immediate continue for foreign contexts, isolated and flagged as costly.
7. **Bodies through a scoped collector.** `acquireRelease(addDataCollector, removeDataCollector)` must be installed *before* the navigation. `response.body` = `getData({disown: true})`, with typed `UnavailableNetworkData` for eviction. Map to CDP `Network.getResponseBody` on the CDP backend.
8. **Values: a Schema codec between `LocalValue` and `RemoteValue`.** `evaluate(fn, args, {result: Schema})` encodes args to `LocalValue` and decodes the `RemoteValue` with a schema, by value by default. `evaluateHandle` requires `Scope` and uses `ownership: root, maxObjectDepth: 0`. `ElementRef` holds `sharedId`, which works across main and sandbox realms and is cheap. `JSHandle` holds `handle`. On CDP, map `sharedId` to `backendNodeId` and handles to `objectId`.
9. **Channels as Streams.** `realm.channel(schema)` allocates a unique channel id and returns `{arg: LocalValue, messages: Stream<A>}` filtered by channel id and decoded by `schema`. `PreloadScript.make(fn, {channels, userContexts, sandbox})` is a scoped resource. On CDP the same API compiles to `Runtime.addBinding` plus a JSON payload. Name it "world" so it is not tied to either protocol.
10. **Input as stateful, interruptible gestures.** Per top-level context, keep a `Semaphore` and an `Actions` builder that compiles typed per-source sequences into BiDi ticks, or into a CDP event schedule. Pressed state is an `acquireRelease`: `withPointerDown(effect)` releases in the finalizer, and scope close calls `releaseActions`. An interrupted drag never leaves a button down.
11. **Navigation as an entity.** `navigate` returns `Navigation {id}` plus a `Stream` of lifecycle states correlated by id, with `wait` as a stream predicate. `navigation: null` covers same-document changes. Network events carry `navigation`, so per-navigation request sets come for free.
12. **Capabilities as a typed service, not version sniffing.** Probe lazily and cache `UnsupportedOperation` per method in an `RcMap`. Offer `Effect.catchTag("UnsupportedOperation", fallback)` with a CDP fallback through `goog:cdp.sendCommand` when the backend is chromium-bidi.
13. **Test the BiDi backend against Chrome without ChromeDriver** by running the chromium-bidi mapper over your own CDP connection (Playwright `bidiOverCdp.ts`). The CDP-first library can then grow a BiDi backend under one transport.

---

## Open questions

1. Can the core rely on the *implied* ordering, e.g. `contextCreated` before the `create` response and replayed events before the `subscribe` response, or should it always reconcile with `getTree`/`getRealms`? Mozilla bug 1882454 shows cross-module reordering is real.
2. Is the top-level `contextDestroyed` scoping (only global subscribers, `bs:5908`) intended? Check WPT and whether the WG has an issue open.
3. Should the library hold one global firehose subscription (simple, Playwright-proven) or scoped subscriptions per consumer (less traffic, more bookkeeping)?
4. Should it adopt `goog:channel` multiplexing (Chrome only) or keep attribution entirely client-side?
5. Per-user-context interception: wait for `userContexts` on `addIntercept`, or accept the global intercept tax?
6. Screencast: the spec's file-on-remote model and CDP's frame stream differ. Should a neutral `Stream<Frame>` exist, falling back to CDP on Chrome?
7. Script timeouts (w3c#199): client-side only, or inject an `AbortController` pattern in-page for cooperative cancel?
8. Safari: STP has fragments (`callFunction`, `captureScreenshot`). Is there any public WebKit timeline? None was found as of 2026-10-18.
9. Generator source: the w3c CI artifact (WDIO) or pinned webref CDDL with extension specs and vendor grammars (Selenium)? The latter covers permissions, bluetooth and `moz:profiler`.
10. Spec errata to track: the responseStarted phase recorded as `beforeRequestSent` (`bs:11400`); the `browsingContexts`/`contexts` key mismatch in addIntercept (`bs:10042`); the unspecified sandbox realm creation (`bs:1571`).

## Web sources

- Firefox CDP retirement: <https://fxdx.dev/cdp-retirement-in-firefox/>, <https://fxdx.dev/deprecating-cdp-support-in-firefox-embracing-the-future-with-webdriver-bidi/>, <https://www.selenium.dev/blog/2025/remove-cdp-firefox/>
- Mozilla BiDi milestones (17–22, dates): <https://wiki.mozilla.org/WebDriver/RemoteProtocol/WebDriver_BiDi>
- Firefox newsletters: <https://fxdx.dev/firefox-webdriver-newsletter-158/>, <https://fxdx.dev/firefox-webdriver-newsletter-150/>, <https://fxdx.dev/firefox-webdriver-newsletter-143/>; MDN Fx 154/158 notes <https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/158>
- Firefox screencast: <https://bugzilla.mozilla.org/show_bug.cgi?id=2042671>, <https://bugzilla.mozilla.org/show_bug.cgi?id=2042668>; ordering bug <https://bugzilla.mozilla.org/show_bug.cgi?id=1882454>
- Safari TP: <https://webkit.org/blog/18420/release-notes-for-safari-technology-preview-254/>, <https://webkit.org/blog/18357/release-notes-for-safari-technology-preview-253/>, <https://webkit.org/blog/18325/webkit-features-for-safari-27-0/>, WebKit bugs 288060 / 281937 <https://www2.webkit.org/show_bug.cgi?id=281937>
- Puppeteer BiDi support list (25.14.0): <https://pptr.dev/webdriver-bidi>
- chromium-bidi releases: <https://github.com/GoogleChromeLabs/chromium-bidi/releases>; ChromeDriver mapper notes <https://developer.chrome.com/docs/chromedriver/downloads>
- WG ordering discussion: <https://www.w3.org/2021/05/12-webdriver-minutes.html>, <https://www.w3.org/2020/10/26-webdriver-irc>
- Firefox vendor CDDL (`moz:profiler`, `moz:listExtensions`): <https://raw.githubusercontent.com/mozilla-firefox/firefox/511b0de4764c52d9acb0d813c7ef712cabd6b975/remote/webdriver-bidi/cddl/Profiler.cddl>
