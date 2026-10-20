# API: the ergonomic layer (L2)

*Revision 5.24, 2026-10-19. Nothing is implemented. The full signatures live in [sketch/](sketch/), which type-checks against Effect 4.0.5 ([sketch/INDEX.md](sketch/INDEX.md) lists every member); this document keeps the contracts and the excerpts that explain them, and where an excerpt and the sketch differ, the sketch is right. Every behavior here must be expressible in [CONCEPTS.md](CONCEPTS.md).*

## Purpose

This layer is what users write. It turns the native model into a small vocabulary of browsers, contexts, pages, locators, actions, expectations and events, with the following properties:

- No protocol knowledge.
- `Scope` only where something with a lifecycle is acquired.
- One deadline per call.
- Errors that say what happened.

Error unions on reads, captures and evaluations are shortened in the sketches (`ReadError`, `CaptureError`). Like every operation, they also include `TargetGone | Timeout`.

## Conventions

The README's principles, as they apply to this layer. The reasons live there; these are the rules.

**Members**
- **If it doesn't have to be a function, it isn't one** (principle 12).
  - No arguments: a value, which is an `Effect` for operations (`locator.click`, `browser.newPage`, `tab.inspect`) or a plain property for pure derivations (`locator.first`).
  - All-optional parameters: the default value plus `xWith(options)`, as in `click` / `clickWith({ button: "right" })`.
  - Required arguments: a function, with trailing options (`goto(url)`, `dragTo(target, options)`).
- **Handles get members; cross-cutting settings are dual combinators** that work data-first and in `pipe`: `Expect.*`, `Deadline.*` and `Diagnostics.*`, as in `button.click.pipe(Deadline.within("5 seconds"))`. Option bags hold only what is specific to one operation.
- **Events are modules, not members.** `Download.next(page)` subscribes, and the action that causes the download comes on the next line (State and events).

**Lifetimes**
- **Anything with a lifecycle requires `Scope`:** contexts, pages, access upgrades, handles, capability handles and every declaration (routes, dialog and file-chooser handlers, init scripts, overrides, clocks). Values with no remote lifetime (locators, snapshots, captured bodies, storage-state bytes) need none. Seeing an event acquires nothing: a popup belongs to the scope that acquired its opener, and a download's file to its context.
- **Every scoped acquisition returns a handle,** never `void`, with an idempotent `remove` and, where useful, state such as `hits: Watchable<number>`. Releasing early (`page.close`, `remove`) makes the finalizer a no-op.
- **No public fibers, and no writable `Deferred`s or `Ref`s.** The library never forks for you; fork your own consumers with `Effect.forkScoped`. A latched result is handed out as a `ReadonlyDeferred`.
- **No platform services at call sites.** They appear only in the launch and connect layers, so `Scope` is the only requirement an ordinary call site sees.

**Values and types**
- **Immutable by default.** Handles, locators, snapshots, events and errors are immutable. Anything that can change is read through an `Effect` or a `Watchable` (`page.url`, `page.title`, `browser.capabilities`, page lists, held access), so it can't go stale in a variable. A plain field on a live handle must be fixed for the handle's lifetime and say why in a comment; ids, `closed` and sub-handles bound to their parent (`keyboard`, `mouse`, `clock`) are exempt.
- **Brand liberally** (principle 14). Outputs are always branded. Inputs require the brand only where two meanings could be confused (`FileInput.local` / `FileInput.remote`, CSS vs device pixels); elsewhere a plain string is parsed at the boundary and fails at once if it is bad (`goto(url)`, `route(pattern)`). Tokens (ids, refs, generations, registration handles) are accepted only in branded form, and are checked against their origin when used.
- **Unions of valid models; `Option` for what's truly optional** (principle 15). Input option bags keep `?:` for "use the default", and mutually exclusive inputs are unions: a route body is JSON *or* text *or* bytes.
- **Access is typed.** `ObservedPage` ⊂ `ReadonlyPage` ⊂ `Page`, like `ReadonlyArray` ⊂ `Array`; contexts have two levels. `.inspect` and `.control` are the only way up, with no type guards, because access is a grant held by a `Scope`. A helper that only reads takes a `ReadonlyPage`, and calling an action on a page you may only inspect is a compile error. A subtype never changes what an inherited member does.
- **Locators are values,** resolved again on every attempt. The one exception is a ref (`snapshot.ref(id)`), which is pinned to one node and fails with `StaleRef` rather than rebinding.

**Names**
- **Spec names first, then Effect's types.** `UserContext` is the spec's and BiDi's term, and it avoids Effect's `Context`. Where Effect has the type, we use it: `Headers`, `HttpMethod`, `HttpServerResponse`, `HttpClientRequest` and `HttpIncomingMessage` from `effect/http`, `DateTime.DateTime.Input`, and `Config`. Our own names get a prefix only where a bare one would clash with the DOM (`FileInput`) or with Effect (`PageClock`, `EventHistory`, `HttpStatusCode`). Long, explicit names are fine.
- **Names encode behavior** (principle 18):

  | Form | Meaning | Examples |
  |---|---|---|
  | verb | acts on the page, once | `click`, `fill`, `goto`, `route` |
  | `read*`, `is*`, nouns | one-shot read; no waiting, no retry | `readText`, `isVisible`, `title`, `count`, `ConsoleMessage.history` |
  | `Watchable` members | state: read now, watch, `waitFor` | `status`, `url`, `download.status` |
  | `Expect.to*` | retries until the deadline | `Expect.toHaveText` |
  | `next`, `stream` | subscribe to an event type from now on | `Download.next(page)`, `NetworkRequest.stream(page)` |
  | `handle` | a scoped handler that decides an obligation | `Dialog.handle(page, Dialog.acceptAll)` |
  | `new*` | creates an owned resource | `newPage`, `newContext` |
  | `*With` | the configured form of a member | `clickWith`, `newPageWith` |
  | `with*`, `within` (dual) | a cross-cutting setting over any effect | `Deadline.within`, `Deadline.withDefaultBudget`, `Diagnostics.withPreset` |
  | `export*` / `import` | crosses a persistence boundary; carries secrets | `exportStorageState`, `StorageState.import` |

**Behavior**
- **Signatures are checked, not described.** `sketch/` declares the whole API and checks it with `tsc --strict`. Its scenarios assert requirement channels (an ordinary call site sees only `Browser` and `Scope`) and pin each access rule with `@ts-expect-error`, so loosening a rule fails the check.
- **Explicit over implicit** (rule 23). Nothing hidden changes behavior or adds waiting: no magic delays, grace periods or heuristic windows. Every default is stated where its option is declared and recorded in the operation's span, and no helper changes a default on your behalf. Actionability waiting is each action's documented contract: named checks, adjustable per call, reported in errors.
- **Every effect ends.** Waits run under a deadline, open-ended things are `Stream`s, and lifetime signals (`closed`) are the only exception.
- **Every error reason carries a hint,** shown in the rendered message:
  - `NotPermitted`: "call `.control` on this page"
  - `StaleRef`: "refs end with their document; use a locator or take a new snapshot"
  - `Unsupported`: "supported on: chromium (CDP)"
  - `StrictViolation`: "2 matches; try `getByRole('button', { name: 'Save' })`"
  - `Timeout` awaiting a `next`: "a matching download started 12 ms before `Download.next` subscribed; call it before the action that causes it"
- **One way to do each thing** (principle 22). A convenience exists only at the dominant call site, documented as its expansion: `page.url` is `page.status.map(…)`, `download.finished` is `status.waitFor(…)`, and `browser.newPage` is `newContext` followed by `newPage`.

## Top data models

```ts
interface ObservedPage {                                // state and events only
  readonly id: NavigableId
  readonly status: Watchable<PageStatus>                 // one consistent snapshot; ends with Closed{reason}
  readonly url: Watchable<Url>                           // status.map(…): derived from the same source
  readonly frames: Watchable<FrameTree>
  readonly workers: Watchable<ReadonlyArray<ObservedBrowserWorker>>   // dedicated workers of this page; a Page narrows to BrowserWorker
  readonly closed: Effect<CloseReason>                  // lifetime signal: waits as long as the page lives
  readonly inspect: Effect<ReadonlyPage, PageError, Scope>   // installs the utility world; page stays open
  readonly control: Effect<Page, PageError, Scope>           // access lasts for the scope; page stays open
}
interface ReadonlyPage extends ObservedPage { /* locators, reads, snapshots, screenshots — see Pages */ }
type PageStatus =
  | { readonly _tag: "Open"; readonly url: Url; readonly document: DocumentStatus; readonly prompt: Option<PromptSnapshot> }
  | { readonly _tag: "Closed"; readonly reason: CloseReason }
interface DocumentStatus {
  readonly id: DocumentId
  readonly readiness: "loading" | "interactive" | "complete"
  readonly lifecycle: "active" | "suspended"
}
interface Page extends ReadonlyPage { /* input, navigation, main-world evaluation, declarations */ }

type PageNavigation =                                   // success value of goto/reload/back/forward; also an event type
  | { readonly _tag: "Committed"; readonly id: NavigationId; readonly document: DocumentId
      readonly response: Option<NetworkResponse> }       // 404/500 is still a commit; None for about:blank, data:, …
  | { readonly _tag: "SameDocument"; readonly id: NavigationId; readonly document: DocumentId
      readonly via: "fragment" | "historyApi" | "intercepted" }
  | { readonly _tag: "Restored"; readonly id: NavigationId; readonly document: DocumentId }   // back/forward cache
  | { readonly _tag: "Activated"; readonly id: NavigationId; readonly document: DocumentId }  // prerender

interface NetworkResponse {                             // immutable; one redirect hop. NetworkRequest is its request-side twin
  readonly hop: RequestHopId
  readonly url: Url
  readonly status: HttpStatusCode                       // a branded number, so it goes wherever Effect HTTP expects a status
  readonly headers: Headers                             // Effect's Headers (effect/http); classified values are redacted
}
interface CapturedResponse<B> extends NetworkResponse, HttpIncomingMessage<ResponseError> {   // owned bytes, readable with Effect's decoders
  readonly body: B                                      // what the subscription's body decoder produced
}

interface Snapshot<L extends ReadonlyLocator = ReadonlyLocator> {   // a structured tree; text is one rendering of it; L follows the page's access
  readonly document: DocumentId
  readonly generation: DocumentGeneration
  readonly root: SnapshotNode
  readonly text: string                                 // the YAML rendering agents already read, plus evidence tags for inferred nodes
  readonly refs: ReadonlyMap<RefId, SnapshotNode>       // already branded
  ref(id: RefId): L                                    // pinned to one node, never rebound; acting fails with StaleRef{reason} once the document or generation moves on
  diff(previous: Snapshot): Effect<SnapshotDiff, SnapshotDiffError>   // explicit; fails if the documents differ
}
interface SnapshotNode {
  readonly ref: Option<RefId>                           // same node, same ref within a document generation
  readonly role:                                        // where the role came from is always visible
    | { readonly _tag: "Aria"; readonly role: AriaRole }
    | { readonly _tag: "Inferred"; readonly role: "clickable" | "editable" | "focusable"; readonly evidence: NonEmptyReadonlyArray<InteractivityEvidence> }
  readonly name:
    | { readonly _tag: "Accessible"; readonly value: string }
    | { readonly _tag: "Inferred"; readonly value: string; readonly from: "text" | "title" | "placeholder" | "alt" | "nearbyLabel" }
    | { readonly _tag: "None" }
  readonly states: ReadonlySet<"checked" | "expanded" | "selected" | "disabled" | "focused" | "pressed">
  readonly children: ReadonlyArray<SnapshotNode>
}
type InteractivityEvidence = "clickListener" | "cursorPointer" | "tabindex" | "contentEditable" | "onclickAttribute"
type SnapshotDiff = { readonly added: ReadonlyArray<SnapshotNode>; readonly removed: ReadonlyArray<RefId>; readonly changed: ReadonlyArray<SnapshotNode>; readonly text: string }
```

`Page`, `Locator`, `PageNavigation` and the other model handles are `Equal`/`Hash` by identity (CONCEPTS.md §1). A `ReadonlyPage` and a `Page` for the same tab are equal, because identity is the tab and not the access level.

## Modules and backends

One package with subpath exports and a single version, the same model Effect v4 uses. Backends are imports, not option values, so only the protocol code you import is loaded:

```ts
import { Browser, Expect } from "effect-browser"          // API types, services, combinators
import { Chromium } from "effect-browser/chromium"        // CDP backend
import { Firefox } from "effect-browser/firefox"          // BiDi backend
import { WebKit } from "effect-browser/webkit"            // Playwright-patched builds; stock attach (iOS, WKWebView)
import { Bidi } from "effect-browser/bidi"                // any BiDi endpoint (Safari Technology Preview, remote grids)
import { BrowserTest } from "effect-browser/test"         // runner-agnostic test Layers
import { VitestBrowser } from "effect-browser/test/vitest" // the Vitest adapter; peer dependency: @effect/vitest
import { BrowserToolkit } from "effect-browser/ai"        // builds on effect/ai
// the package's bin is the CLI (CLI.md); effect-browser/cli has only what `eb run` provides to segments
import * as Cdp from "effect-browser/cdp"                 // raw generated L0 commands, for power users

declare const Chromium: {
  readonly launch: Layer<Browser, LaunchError, ChildProcessSpawner | FileSystem>   // headless Chrome for Testing, temporary profile
  launchWith(options: LaunchOptions): Layer<Browser, LaunchError, ChildProcessSpawner | FileSystem>
  launchConfig(options: Config.Wrap<LaunchOptions>): Layer<Browser, LaunchError | ConfigError, ChildProcessSpawner | FileSystem>   // e.g. the executable path from CI's environment
  connect(endpoint: Url | string, options?: { readonly headers?: Record<string, Redacted<string> | string> }):
    Layer<Browser, ConnectError, WebSocketConstructor>
}
// Firefox.launch / launchWith / launchConfig; WebKit.launch / launchWith / launchConfig / attach(endpoint); Bidi.connect(endpoint): same shape

interface LaunchOptions {
  readonly headless?: boolean                            // default true
  readonly channel?: "stable" | "beta" | "canary"        // default: Chrome for Testing, not an installed channel
  readonly executablePath?: LocalPath | string
  readonly args?: ReadonlyArray<string>
  readonly profile?: LaunchProfile                       // default LaunchProfile.automation
  readonly userDataDir?: LocalPath | string              // a profile directory you own; never deleted
}

interface LaunchProfile {                                // a value you can inspect; the actual args and prefs are recorded in the launch span and trace
  readonly name: "stock" | "automation" | "concurrent"
  readonly args: ReadonlyArray<string>
  readonly prefs: Readonly<Record<string, string | number | boolean>>
}
declare const LaunchProfile: {
  readonly stock: LaunchProfile        // the browser's own defaults; nothing added
  readonly automation: LaunchProfile   // first-run, sync and update prompts off; nothing a page can observe
  readonly concurrent: LaunchProfile   // automation, plus background-timer and renderer throttling off, for many pages at once
}

program.pipe(Effect.provide(Chromium.launch))
```

- **No platform packages of our own.** Launching needs only Effect's `ChildProcessSpawner`, `FileSystem` and `WebSocketConstructor` services, which `@effect/platform-node` and `@effect/platform-bun` provide.
- **Profiles are temporary by default.** A launch acquires a directory with `FileSystem.makeTempDirectoryScoped` before the browser starts, and it is deleted after the browser exits. The profile, downloads and crash dumps never outlive the `Browser` layer. `userDataDir` names a directory you own instead: it is never deleted, and the browser locks it, so one browser uses it at a time. Reusing a login across browsers is storage state, not a shared profile.
- **Backend layers can carry their known capabilities in their types,** so specialized features need no `Unsupported` case when the backend is chosen in code (P7). The mechanism is to be settled when the sketches are compiled: a capability-typed `Browser` service, or backend-specific accessors.
- **Launch profiles are values, not hidden flags** (rule 23). `concurrent` changes what pages observe (timer cadence, background rendering), so it is opt-in and visible. No profile disables the back/forward cache, third-party storage partitioning or popup blocking: the model handles those hazards explicitly.
- **A browser-download CLI,** if needed, starts as `effect-browser/install` plus a `bin`, not as a separate package.

## Entry points and cross-cutting settings

```ts
class Browser extends Context.Service<Browser, BrowserHandle>()("effect-browser/Browser") {}   // provided by a backend layer (Chromium.launch, …)

declare const Deadline: {                                // dual combinators over any effect
  within: Dual<Duration.Input>                           // one deadline for everything inside, shared; nesting can only shorten it
  withDefaultBudget: Dual<Duration.Input>                // what an operation gets when no deadline encloses it; 30 seconds unless set
  readonly remaining: Effect<Option<Duration>>           // time left before the enclosing deadline
  readonly Current: Context.Reference<Option<MonotonicInstant>>   // read freely; set only through within
  readonly DefaultBudget: Context.Reference<Duration>    // withDefaultBudget is Effect.provideService on this reference
}
declare const Diagnostics: {
  withPreset: Dual<"local" | "strict">                   // how Redactable values render inside; "strict" unless set
}
// Dual<X> = { (x: X): <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, R>; <A, E, R>(self: Effect<A, E, R>, x: X): Effect<A, E, R> }

interface BrowserHandle {
  readonly info: BackendInfo                                                         // fixed for the connection
  readonly capabilities: Watchable<CapabilitySet>                                    // refined as probes complete
  readonly newContext: Effect<UserContext, UserContextError, Scope>                   // owned; removed when the scope closes
  newContextWith(options: UserContextOptions): Effect<UserContext, UserContextError, Scope>
  readonly newPage: Effect<Page, PageError, Scope>                                   // a fresh context + page, released together
  newPageWith(options: UserContextOptions): Effect<Page, PageError, Scope>
  readonly pages: Watchable<ReadonlyArray<ObservedPage>>                             // attach mode: what exists, and changes
  readonly defaultContext: ObservedUserContext                                           // fixed: exists for the whole connection
}

interface ObservedUserContext {                              // a context we don't control, e.g. the default context when attached
  readonly id: UserContextId
  readonly pages: Watchable<ReadonlyArray<ObservedPage>>
  readonly workers: Watchable<ReadonlyArray<ObservedBrowserWorker>>   // shared and service workers
  readonly closed: Effect<CloseReason>
  readonly control: Effect<UserContext, UserContextError, Scope>   // explicit; reading storage needs it too
}
interface UserContext extends ObservedUserContext {        // two levels only: reads happen on pages
  readonly newPage: Effect<Page, PageError, Scope>       // closed with its unsolicited popups when the scope closes
  readonly pages: Watchable<ReadonlyArray<Page>>
  readonly workers: Watchable<ReadonlyArray<BrowserWorker>>
  readonly cookies: CookieJar                            // a sub-handle bound to the context (Storage, below)
  readonly exportStorageState: Effect<Redacted<StorageStateBytes>, StorageStateError>   // branded bytes; a Uint8Array subtype
  readonly clock: PageClock                              // context-wide timeline (opt-in)
  route<E, R>(pattern: UrlPattern, handler: RouteHandler<E, R>): Effect<RouteRegistration, RouteError, Scope | R>
  addInitScript(script: InitScriptSource, options?: InitScriptOptions): Effect<InitScript, DeclarationError, Scope>
  emulate(settings: Emulation): Effect<Registration, DeclarationError, Scope>
  grant(permissions: ReadonlyArray<Permission>, options?: { origin?: Origin | string }): Effect<Registration, DeclarationError, Scope>   // default every origin; ANDed with Permissions Policy
}

interface UserContextOptions {                          // an unset option keeps the browser's own value unless a default is stated
  readonly storageState?: StorageState                  // from StorageState.import(bytes)
  readonly dialogs?: "dismiss" | "accept" | "leaveOpen"  // decision when no handler claims a dialog; default "dismiss"
  readonly focus?: "system" | "emulated"                 // default "system"; "emulated" makes every page report focus (owned contexts only)
  readonly eventLog?: number                             // retained events per module and page, for history; default 100, 0 keeps none
  readonly emulation?: Emulation                         // held for the context's life: emulate(...) without a scope
  readonly permissions?: ReadonlyArray<Permission>       // granted for the context's life, every origin: grant(...) without a scope
}

interface Emulation {                                    // what a declaration overrides while it lives; unset fields are untouched
  readonly viewport?: { width: number; height: number; deviceScaleFactor?: number; mobile?: boolean }   // CSS pixels; defaults 1 and false
  readonly userAgent?: string
  readonly locale?: Locale | string
  readonly timezone?: TimeZoneId | string
  readonly geolocation?: { latitude: number; longitude: number; accuracy?: number } | "unavailable"
  readonly media?: {
    type?: "screen" | "print"; colorScheme?: "light" | "dark" | "noPreference"; reducedMotion?: "reduce" | "noPreference"
    forcedColors?: "active" | "none"; contrast?: "more" | "less" | "custom" | "noPreference"
  }
  readonly network?: "offline" | { download: number; upload: number; latency: Duration.Input }   // bytes per second
  readonly cpuSlowdown?: number                          // a factor; CDP only
  readonly javaScript?: "enabled" | "disabled"
  readonly touch?: boolean
}
```

- **One concept, two lifetimes.** Creation options are declarations held for the context's whole life; `emulate` and `grant` are the same declarations, scoped. So viewport, locale and timezone live in `Emulation`, not as separate options.
- **Overrides restore only what they know.** Removing one restores the previous value when it is known and access permits; precedence is page over context (CONCEPTS.md §7). A field the backend can't apply fails with `Unsupported` naming it.

## Pages

```ts
interface ReadonlyPage extends ObservedPage {
  // locators
  // a string matches as a case-insensitive substring unless exact: true; a RegExp is used as given
  getByRole(role: AriaRole, options?: { name?: string | RegExp; exact?: boolean; includeHidden?: boolean }): ReadonlyLocator
  getByText(text: string | RegExp, options?: { exact?: boolean }): ReadonlyLocator
  getByLabel(text: string | RegExp, options?: { exact?: boolean }): ReadonlyLocator
  getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): ReadonlyLocator
  getByAltText(text: string | RegExp, options?: { exact?: boolean }): ReadonlyLocator
  getByTitle(text: string | RegExp, options?: { exact?: boolean }): ReadonlyLocator
  getByTestId(id: string): ReadonlyLocator               // the data-testid attribute
  locator(css: string): ReadonlyLocator
  frame(iframe: ReadonlyLocator): ReadonlyFrameLocator   // enters an iframe by its element; lazy, like any locator
  // one-shot reads
  readonly title: Effect<string, ReadError>
  readonly readHtml: Effect<string, ReadError>           // the document's serialized HTML
  readonly ariaSnapshot: Effect<Snapshot, ReadError>     // the accessibility tree only: what assistive technology sees
  readonly snapshot: Effect<Snapshot, ReadError>         // accessibility tree + inferred interactivity, every inferred node tagged with its evidence
  snapshotWith(options: { sources?: "aria" | "aria+interactivity"; root?: ReadonlyLocator; depth?: number; interactiveOnly?: boolean }):   // defaults: aria+interactivity, the whole page, every level, every node
    Effect<Snapshot, ReadError>                          // size is explicit: no automatic truncation
  readonly screenshot: Effect<Uint8Array, CaptureError>  // viewport, PNG
  screenshotWith(options: {
    area?: { _tag: "Viewport" } | { _tag: "FullPage" } | { _tag: "Clip"; rect: Rect<CssPixels> } | { _tag: "Element"; locator: ReadonlyLocator }
    format?: { _tag: "Png" } | { _tag: "Jpeg"; quality: number }   // quality exists only for JPEG
    scale?: "css" | "device"                              // default "device"
    omitBackground?: boolean                              // default false
  }): Effect<Uint8Array, CaptureError>
  readonly pdf: Effect<Uint8Array, CaptureError>
  pdfWith(options: PdfOptions): Effect<Uint8Array, CaptureError>
  readonly localStorage: ReadonlyOriginStorage           // the current document's origin; a Page makes them writable
  readonly sessionStorage: ReadonlyOriginStorage
  capability<H>(capability: Capability<H>): Effect<H, CapabilityError, Scope>
  evaluate<Args extends ReadonlyArray<unknown>, A>(    // the isolated world, on every page: page globals are invisible
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect<Serialized<A>, EvaluationError | TargetGone | Timeout>
}

interface Page extends ReadonlyPage {
  // the locator, frame and snapshot members above return Locator, FrameLocator and Snapshot<Locator>;
  // workers are BrowserWorkers, and localStorage and sessionStorage are writable OriginStorage
  readonly context: UserContext                      // fixed: a page never changes context
  goto(url: Url | string, options?: { waitUntil?: LoadState; accept?: ReadonlyArray<"download" | "noContent"> }):   // defaults: commit; a download or 204 is a NavigationError
    Effect<PageNavigation, NavigationError | TargetGone | Timeout>
  readonly reload: Effect<PageNavigation, NavigationError | TargetGone | Timeout>
  reloadWith(options: { waitUntil?: LoadState; bypassCache?: boolean }): Effect<PageNavigation, NavigationError | TargetGone | Timeout>
  readonly back: Effect<Option<PageNavigation>, NavigationError | TargetGone | Timeout>    // None: no history entry
  backWith(options: { waitUntil?: LoadState }): Effect<Option<PageNavigation>, NavigationError | TargetGone | Timeout>
  readonly forward: Effect<Option<PageNavigation>, NavigationError | TargetGone | Timeout>
  forwardWith(options: { waitUntil?: LoadState }): Effect<Option<PageNavigation>, NavigationError | TargetGone | Timeout>
  evaluateWith<Args extends ReadonlyArray<unknown>, A>(   // the world is always spelled out; the main world needs control
    options: { readonly world: "isolated" | "main"; readonly userGesture?: boolean },
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect<Serialized<A>, EvaluationError | TargetGone | Timeout>
  evaluateHandle<Args extends ReadonlyArray<unknown>, A>(   // the isolated world, like evaluate
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect<JSHandle<Awaited<A>>, EvaluationError | TargetGone | Timeout, Scope>
  readonly keyboard: Keyboard
  readonly mouse: Mouse
  readonly clock: PageClock
  route<E, R>(pattern: UrlPattern, handler: RouteHandler<E, R>): Effect<RouteRegistration, RouteError, Scope | R>
  addInitScript(script: InitScriptSource, options?: InitScriptOptions): Effect<InitScript, DeclarationError, Scope>
  emulate(settings: Emulation): Effect<Registration, DeclarationError, Scope>
  readonly activate: Effect<void, TargetGone>            // bring to front; rendering-based waits need it
  readonly close: Effect<void, TargetGone | Timeout>     // owned teardown: no beforeunload
  closeWith(options: { runBeforeUnload: boolean }): Effect<void, CloseCanceled | TargetGone | Timeout>
}

type LoadState = "commit" | "domContentLoaded" | "load"  // goto, reload, back and forward resolve at commit unless waitUntil asks for more

type Serialized<A> =                                   // what actually arrives: defined once, next to our serializer, the same on every backend
  A extends string | number | boolean | bigint | null | undefined | Date | RegExp ? A
  : A extends ReadonlyMap<infer K, infer V> ? Map<Serialized<K>, Serialized<V>>
  : A extends ReadonlySet<infer T> ? Set<Serialized<T>>
  : A extends ReadonlyArray<infer T> ? Array<Serialized<T>>
  : A extends Node ? NotSerializable<"DOM nodes don't cross by value; use evaluateHandle">
  : A extends Function | symbol ? never
  : { [K in keyof A as A[K] extends Function | symbol ? never : K]: Serialized<A[K]> }   // class instances arrive as their data

interface PdfOptions {                                   // Length is a value and a unit: in, cm, mm or px
  readonly paper?: "letter" | "legal" | "tabloid" | "a3" | "a4" | "a5" | { width: Length; height: Length }   // default "letter", as Chrome and BiDi
  readonly landscape?: boolean                           // default false
  readonly margins?: { top?: Length; right?: Length; bottom?: Length; left?: Length }   // default none
  readonly scale?: number                                // default 1
  readonly background?: boolean                          // default false
  readonly pageRanges?: string                           // e.g. "1-3, 5"; default every page
  readonly preferCssPageSize?: boolean                   // default false
  readonly header?: string; readonly footer?: string     // HTML templates; Unsupported on BiDi
}
interface ReadonlyOriginStorage {
  readonly entries: Effect<ReadonlyArray<readonly [key: string, value: string]>, StorageError | TargetGone>
  get(key: string): Effect<Option<string>, StorageError | TargetGone>
}
interface OriginStorage extends ReadonlyOriginStorage {
  set(key: string, value: string | Redacted<string>): Effect<void, StorageError | TargetGone>
  remove(key: string): Effect<void, StorageError | TargetGone>
  readonly clear: Effect<void, StorageError | TargetGone>
}
```

Notes:

- **Evaluated functions cross into the page.** They must be self-contained, and values travel as arguments. A `ReferenceError` from an evaluated function carries a hint saying so.
- **One name per world.** `evaluate` always runs in the isolated world, so a helper that takes a `ReadonlyPage` behaves the same when it is given a `Page`. The main world is `evaluateWith({ world: "main" }, …)`, only on `Page`, so it is visible at every call site that uses it. So is running as a user gesture, where the backend supports it.
- **The type says what arrives.** Results cross by value, typed `Serialized<A>`. To validate a result instead of trusting the function's type, decode it: `.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Cart)))`. Handles are opt-in and scoped.
- **Reads of page storage follow access.** `localStorage` and `sessionStorage` belong to the current document's origin. Reading needs inspect; writing needs control.
- **Navigation resolves at commit.** That is when a navigation has succeeded. Waiting for `domContentLoaded` or `load` is an extra wait you ask for with `waitUntil`, and the span records which state was waited for.
- **Declarations are scoped registrations.** `route`, `addInitScript`, `emulate`, `Dialog.handle` and `FileChooser.handle` are removed when the caller's scope closes. In `@effect/vitest`'s `it.effect` that scope is already present; elsewhere, use `Effect.scoped`.

## Locators, actions and actionability

```ts
interface ReadonlyLocator extends Pipeable, Equal.Equal, Inspectable {
  getByRole(role: AriaRole, options?: RoleOptions): ReadonlyLocator     // chained queries are relative
  getByText(text: string | RegExp, options?: TextOptions): ReadonlyLocator
  locator(css: string): ReadonlyLocator
  filter(options: {
    has?: RelativeLocator; hasNot?: RelativeLocator
    hasText?: string | RegExp; hasNotText?: string | RegExp
    visible?: boolean
  }): ReadonlyLocator
  and(other: ReadonlyLocator): ReadonlyLocator
  or(other: ReadonlyLocator): ReadonlyLocator
  nth(index: number): ReadonlyLocator
  readonly first: ReadonlyLocator                        // pure derivations are plain properties
  readonly last: ReadonlyLocator
  describe(label: string): ReadonlyLocator               // used in errors and traces
  // one-shot reads: no waiting, no retry
  readonly count: Effect<number, ReadError>
  readonly readText: Effect<string, ReadError>
  readonly readValue: Effect<string, ReadError>
  readonly readHtml: Effect<string, ReadError>           // outerHTML
  readonly isVisible: Effect<boolean, ReadError>
  readonly isEnabled: Effect<boolean, ReadError>
  readonly isChecked: Effect<boolean, ReadError>
  readonly all: Effect<ReadonlyArray<ReadonlyLocator>, ReadError>   // pinned to the current nth matches
  readonly snapshot: Effect<Snapshot, ReadError>
  readAttribute(name: string): Effect<Option<string>, ReadError>
  evaluate<Args extends ReadonlyArray<unknown>, B>(      // the isolated world, with the element first; strict: exactly one match
    fn: (element: Element, ...args: Args) => B | Promise<B>, ...args: Args
  ): Effect<Serialized<B>, EvaluationError | ReadError | TargetGone | Timeout>
}

interface Locator extends ReadonlyLocator {             // chainers and first/last return Locator
  readonly click: Effect<void, ActionError | TargetGone | Timeout>
  clickWith(options: ClickOptions): Effect<void, ActionError | TargetGone | Timeout>
  readonly dblclick: Effect<void, ActionError | TargetGone | Timeout>
  dblclickWith(options: ClickOptions): Effect<void, ActionError | TargetGone | Timeout>
  readonly hover: Effect<void, ActionError | TargetGone | Timeout>
  hoverWith(options: PointerOptions): Effect<void, ActionError | TargetGone | Timeout>
  readonly check: Effect<void, ActionError | TargetGone | Timeout>
  readonly uncheck: Effect<void, ActionError | TargetGone | Timeout>
  readonly focus: Effect<void, ActionError | TargetGone | Timeout>
  readonly clear: Effect<void, ActionError | TargetGone | Timeout>
  readonly tap: Effect<void, ActionError | TargetGone | Timeout>              // touch
  readonly scrollIntoView: Effect<void, ActionError | TargetGone | Timeout>   // the toolkit's scroll
  fill(value: string | Redacted<string>): Effect<void, ActionError | TargetGone | Timeout>
  press(key: KeyName | string, options?: { modifiers?: ReadonlyArray<"Alt" | "Control" | "Meta" | "Shift"> }): Effect<void, ActionError | TargetGone | Timeout>
  pressSequentially(text: string | Redacted<string>, options?: { delay?: Duration.Input }): Effect<void, ActionError | TargetGone | Timeout>   // delay default 0
  selectOption(options: SelectOption | ReadonlyArray<SelectOption>): Effect<void, ActionError | TargetGone | Timeout>   // { value } | { label } | { index }: which one is always stated
  setInputFiles(files: FileInput | ReadonlyArray<FileInput>): Effect<void, ActionError | TargetGone | Timeout>
  dragTo(target: Locator, options?: DragOptions): Effect<void, ActionError | TargetGone | Timeout>
}

interface ClickOptions extends PointerOptions {
  readonly button?: "left" | "right" | "middle"
  readonly modifiers?: ReadonlyArray<"Alt" | "Control" | "Meta" | "Shift">
  readonly position?: { x: CssPixels | number; y: CssPixels | number }   // CSS pixels from the element's padding box
  readonly checks?: Partial<Record<"visible" | "enabled" | "notInert" | "inViewport" | "receivesPointer", boolean>>
    & { readonly stable?: boolean | { readonly frames: number } }   // default frames per backend; shown in spans and errors
  readonly trial?: boolean                               // run every check, dispatch nothing
}

declare const FileInput: {                               // the brand is required, so paths can't be confused
  local(path: LocalPath | string): FileInput             // read on this machine, uploaded if the browser is remote
  remote(path: RemotePath): FileInput                    // already on the browser's host (BiDi input.setFiles semantics)
  bytes(name: FileName | string, mimeType: MimeType | string, data: Uint8Array): FileInput
}

const RelativeLocator: {                                 // only valid inside filter({ has })
  getByRole(role: AriaRole, options?: RoleOptions): RelativeLocator
  getByText(text: string | RegExp): RelativeLocator
  locator(css: string): RelativeLocator
}
```

- **Actionability is the CONCEPTS.md §8 predicate set**, evaluated in one injected round trip per attempt. The presets are:
  - `click`/`hover`: visible, stable, enabled, notInert, inViewport, receivesPointer;
  - `fill`: visible, enabled, editable, notInert.

  Turn off individual checks with `clickWith({ checks })`; there is no blanket `force`.
- **Strictness.** An action needs exactly one match, and ambiguity fails immediately with `ActionError{reason: StrictViolation{candidates, suggestions, hint}}`. There is no retry window. Strictness counts every match, hidden ones included, and the hint says when narrowing would fix it, e.g. "1 of 2 matches is visible; add `.filter({ visible: true })`". If duplicates are expected to be transient (a fading toast), say so in the code: `yield* toast.pipe(Expect.toHaveCount(0))` before acting.
- **`has:` takes only `RelativeLocator`.** That makes Playwright's silent "page-rooted locator inside `has`" mismatch a type error.
- **Once only.** An action dispatches at most once per call. If a later step fails after input may have reached the page, the error carries that evidence and the action is never replayed.

## Keyboard, mouse, frames and handles

```ts
interface Keyboard {                                     // keys to whatever has focus; input to one page is serialized
  press(key: KeyName | string, options?: { modifiers?: ReadonlyArray<Modifier> }): Effect<void, ActionError | TargetGone | Timeout>
  pressSequentially(text: string | Redacted<string>, options?: { delay?: Duration.Input }): Effect<void, ActionError | TargetGone | Timeout>   // delay default 0
  insertText(text: string | Redacted<string>): Effect<void, ActionError | TargetGone | Timeout>   // no key events, as an input method
  hold(key: KeyName | string): Effect<HeldInput, ActionError | TargetGone | Timeout, Scope>
}
interface Mouse {                                        // coordinates, for canvas-like UIs; CSS pixels from the viewport's top left
  readonly position: Effect<Point>                       // mutable state, so read through an Effect
  move(to: Point, options?: { steps?: number }): Effect<void, ActionError | TargetGone | Timeout>   // steps default 1
  click(at: Point, options?: { button?: "left" | "right" | "middle"; clickCount?: number; modifiers?: ReadonlyArray<Modifier> }): Effect<void, ActionError | TargetGone | Timeout>
  hold(button: "left" | "right" | "middle"): Effect<HeldInput, ActionError | TargetGone | Timeout, Scope>
  wheel(delta: { x: CssPixels | number; y: CssPixels | number }): Effect<void, ActionError | TargetGone | Timeout>
}
interface HeldInput { readonly release: Effect<void> }   // idempotent; the scope's finalizer becomes a no-op

interface ReadonlyFrameLocator {                         // an iframe's document, entered by its element; lazy like any locator
  readonly owner: ReadonlyLocator                        // the iframe element
  // getByRole, getByText, getByLabel, getByPlaceholder, getByAltText, getByTitle, getByTestId, locator, frame
}                                                        // FrameLocator: the same queries returning Locator

interface JSHandle<A = unknown> {                        // a value in one realm, owned by the scope that acquired it
  readonly realm: RealmId                                // fixed: a handle never moves between realms
  evaluate<Args extends ReadonlyArray<unknown>, B>(fn: (value: A, ...args: Args) => B | Promise<B>, ...args: Args):
    Effect<Serialized<B>, EvaluationError | TargetGone | Timeout>
  evaluateHandle<Args extends ReadonlyArray<unknown>, B>(fn: (value: A, ...args: Args) => B | Promise<B>, ...args: Args):
    Effect<JSHandle<Awaited<B>>, EvaluationError | TargetGone | Timeout, Scope>
  readonly read: Effect<Serialized<A>, EvaluationError | TargetGone | Timeout>   // the value itself, by value
  readonly release: Effect<void>                         // early release; idempotent
}
```

- **Held input is scoped.** `hold` acquires a key or button and releases it when `release` runs or its scope closes, and on interruption, in reverse order (CONCEPTS.md §5). A failed step never leaves Shift held down.
- **Frames are entered, not held.** A frame locator re-resolves its iframe element on every attempt, like any locator; the frame tree as state is `page.frames`.
- **Handles end with their realm.** Using a handle after its realm ends fails with `TargetGone{RealmDestroyed}`. Handles are released in batches unless the realm already ended.

## Expectations

```ts
declare const Expect: {
  // no extra arguments: the matcher itself is the function
  //   locator.pipe(Expect.toBeVisible)   or   Expect.toBeVisible(locator)
  toBeVisible: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  toBeHidden: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  toBeEnabled: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  toBeDisabled: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  toBeChecked: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  toBeFocused: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  toBeEditable: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  // with arguments: dual
  //   locator.pipe(Expect.toHaveText("1 item"))   or   Expect.toHaveText(locator, "1 item")
  toHaveText: DualMatcher<ReadonlyLocator, [expected: string | RegExp | ReadonlyArray<string | RegExp>]>
  toContainText: DualMatcher<ReadonlyLocator, [expected: string | RegExp]>
  toHaveValue: DualMatcher<ReadonlyLocator, [expected: string | RegExp]>
  toHaveAttribute: DualMatcher<ReadonlyLocator, [name: string, expected?: string | RegExp]>
  toHaveCount: DualMatcher<ReadonlyLocator, [count: number]>
  toMatchAria: DualMatcher<ReadonlyLocator, [pattern: AriaPattern]>
  toHaveURL: DualMatcher<ReadonlyPage, [expected: string | RegExp]>
  toHaveTitle: DualMatcher<ReadonlyPage, [expected: string | RegExp]>
  // the general form: a subject and a condition
  //   a Watchable is re-checked on each change; any other Effect is re-run at the interval
  that<A, E, R>(subject: Effect<A, E, R>, condition: Condition<A>): Effect<void, E | ExpectationFailed | TargetGone, R>
  withInterval: Dual<Duration.Input>                     // re-check interval for subjects with no change signal; default 100 ms
}
declare const Condition: {
  make<A>(description: string, predicate: Predicate<A>): Condition<A>   // the description appears in ExpectationFailed
  not<A>(c: Condition<A>): Condition<A>                  // the wait is for the negation, and it passes when the element is missing
  and<A>(...cs: ReadonlyArray<Condition<A>>): Condition<A>   // evaluated against one observation
  because<A>(why: string): (c: Condition<A>) => Condition<A>
}
declare const AriaPattern: {                             // matched against ariaSnapshot; how children match is always stated
  node(role: AriaRole, name: string | RegExp, children: ChildrenPattern): AriaPattern   // "" means no accessible name
  text(value: string | RegExp): AriaPattern
  exactly(...children: ReadonlyArray<AriaPattern>): ChildrenPattern     // these children, in this order, and no others
  including(...children: ReadonlyArray<AriaPattern>): ChildrenPattern   // these children in this order; others may come between
  readonly unchecked: ChildrenPattern                                   // children are not compared
}
```

- **How expectations evaluate.** An expectation is `Reactivity.stream(keys, check)`: one check runs immediately, and another each time the model invalidates a key the subject depends on (a `Watchable` change, or a DOM mutation in the subject's subtree). Conditions with no change signal, such as layout and visibility, are also re-checked at a fixed interval (`Expect.withInterval`). There is no backoff, because backoff adds more lag the longer a test waits (rule 23). Everything runs on the live clock, within the deadline (`Deadline.within` adjusts it).
- **Accumulating failures is Effect's job.** To check several things and report every failure, use `Effect.validate` or `Effect.all(…, { mode: "result" })`; there is no separate soft-expectation mechanism.
- **What failure contains.** `ExpectationFailed{subject, condition, last, history, elapsed, checks}`. `checks` counts the checks and names what triggered them. `history` is the de-duplicated sequence of observed values with timestamps, which answers "was it ever right?". When nothing matched, the error adds an accessibility snapshot of the nearest existing ancestor and suggested locators.

## State and events

Two kinds of things change over time, and they get different types on purpose. RxJS draws the same line (`BehaviorSubject` vs hot `Subject`), and so does the industry's move to signals for state and streams for events.

| | State | Events |
|---|---|---|
| Examples | page status and URL, frame tree, download progress, page lists, capabilities | responses, requests, navigations, popups, dialogs, downloads, console messages |
| Type | `Watchable<A>` | a module per event type (`Download`, `NetworkResponse`, …) |
| Late subscriber gets | the current value, so nothing that matters is missed | nothing from before it subscribed; what already happened is a separate read of a bounded log |
| Slow consumer gets | the latest value (conflated) | every match, losslessly, up to a bound (`EventOverflow`) |

```ts
interface Watchable<A> extends Effect<A> {               // yield* reads the current value
  readonly changes: Stream<A>                            // current value first, then each distinct change; ends after the terminal state
  waitFor<B extends A>(refinement: Refinement<A, B>): Effect<B, Timeout | TargetGone>   // level-triggered, under the deadline
  waitFor(predicate: Predicate<A>): Effect<A, Timeout | TargetGone>
  map<B>(f: (a: A) => B): Watchable<B>                   // derived from the same source, so never glitchy
}

interface EventModule<T, A, F, E = never> {               // every event module has these three verbs; T: targets, F: filter
  next<PE = never, PR = never>(target: T, filter?: F, where?: Where<A, PE, PR>):   // subscribed when this returns; await with Deferred.await
    Effect<ReadonlyDeferred<A, E | PE | TargetGone | Timeout>, ObserveError, Scope | PR>
  stream<PE = never, PR = never>(target: T, filter?: F, where?: Where<A, PE, PR>):   // every match from now on
    Effect<Stream<A, E | PE | EventOverflow | TargetGone>, ObserveError, Scope | PR>
  history(target: T, filter?: F): Effect<EventHistory<A>>                            // every retained match; a read, so no where
}
type Where<A, PE, PR> = (event: A) => Effect<boolean, PE, PR>   // a caller predicate, after the declarative filter
interface EventHistory<A> {
  readonly entries: ReadonlyArray<A>                     // oldest first
  readonly dropped: number                               // matches the cap discarded, so a truncated log doesn't look complete
}

// in use: call sites 2–5, 13 and 15
```

| Module | Emits | Filter | Targets |
|---|---|---|---|
| `PageNavigation` | `PageNavigation` | `url`; `next` also takes `waitUntil` | any page |
| `Popup` | `Page` from a `Page`, otherwise `ObservedPage` | `url` | any page |
| `NetworkRequest` | `NetworkRequest` | `RequestFilter`; `next` requires `url` | any page or context |
| `NetworkResponse` | `NetworkResponse`, or `CapturedResponse<B>` given `body` | `url`, `method`, `status`; `next` requires `url`. `body` (any decoder of an `HttpIncomingMessage`, such as `HttpIncomingMessage.schemaBodyJson(Cart)`) needs inspect, applies to `next` and `stream`, and types their `where` | any page or context |
| `ConsoleMessage` | `ConsoleMessage` | `level`, `text` | any page or context |
| `UncaughtException` | `UncaughtException`: thrown errors and unhandled rejections | `message` | any page or context |
| `Dialog` | `Dialog` | `_tag` | any page; `Dialog.handle` needs `Page` |
| `FileChooser` | `FileChooser` | — | `Page` |
| `Download` | `Download` | `url` | `Page` or `UserContext` |
| `AutoResolution` | `AutoResolution`: an obligation decided by a default policy | — | `Page` or `UserContext` |
| `BrowserWorker` | `BrowserWorker` from a `Page` or `UserContext` (it can `evaluate`, which needs control: workers have no isolated world), otherwise `ObservedBrowserWorker` | `url`, `kind` | any page or context |
| `NetworkConnection` | `NetworkConnection`: a WebSocket or EventSource, whose `frames` subscribe from now on (CDP and patched WebKit; Unsupported on BiDi) | `url`, `kind` | any page or context |

Each module has the most specific accurate name, with a prefix only where a bare name would clash with the fetch `Request`/`Response` or DOM `Navigation` globals. `ConsoleMessage` avoids Effect's `Console`, and `UncaughtException` avoids our `PageError` and the `*Error` suffix our failures use.

**Events:**
- **Filters are data; `where` is a function.** The filter is applied before buffering, so unrelated traffic can't overflow a subscription. `where` runs after it, in the subscriber, never on the ingestion path. It is a separate trailing argument because TypeScript can't type a callback from a sibling property of the same object: as its own argument, `where` gets the decoded body type from `body`. The sketch found this.
- **Subscribe, act, collect.** `next` and `stream` are subscribed by the time their effect returns, so code order is subscription order, and one action can have several outcomes. Filters apply before buffering, so unrelated traffic can't overflow a subscription. A subscription made too late is diagnosed: its `Timeout` names the match that arrived just before it subscribed.
- **`history` looks back.** It answers questions you couldn't ask in advance (debugging, failure reports, agents, the CLI, a popup's first requests) and never subscribes or waits, so it can't catch what an action causes; that is why there is no `last`.
  - The log is capped by `UserContextOptions.eventLog`, so a missing entry proves nothing unless `dropped` is 0. Complete records come from a `stream` opened at the start, or from `Har.record`.
  - Entries never decay: metadata is copied, without bodies, and handles live as long as their owner.
  - To wait for something that may already have happened, use `Expect.that` on `history`.
- **Events report; handlers decide.** Obligations are decided only by scoped handlers: `page.route`, `Dialog.handle` and `FileChooser.handle`. A dialog blocks its page, so the click that opens one doesn't finish until it is decided, and the handler is registered first.
- **Events reveal resources; they don't acquire them.** `Popup.next` and `Popup.history` return the same handle, owned by the scope that acquired its opener; the `Scope` on `next` and `stream` holds only the subscription. Popups of owned pages are owned, and popups of attached pages stay open.
- **A wait's deadline is set where the wait starts.** `next` hands out the read side of the `Deferred` that latches the first match (a `ReadonlyDeferred`, proposed upstream: upstream/effect-readonly-deferred.md). Its timer comes from the deadline in force at `next`, so the budget is stated where the wait begins: `Download.next(page).pipe(Deadline.within("2 minutes"))`. Time spent in your own steps before you await counts against it. Awaiting always ends: in the match, in `TargetGone` as soon as the owner ends, or in `Timeout`, which fails the deferred rather than interrupting it, because interruption means the caller cancelled. If upstream declines the type, `next` returns the awaiting `Effect` instead, with the same timing.
- **Results outlive the subscription.** A captured response body is owned bytes, so it survives the subscription and even the page closing.
- **Event streams end** normally when their owner ends normally or the acquiring scope closes. They fail with `TargetGone` on an abnormal end, and with `EventOverflow` past their bound, so both are in every event stream's error type.

**State:**
- **Watching gives you the present, not the past.** `changes` starts with the current value and conflates, so intermediate stages can be skipped. To see transitions from the beginning, subscribe before the cause, or fork the consumer right after you get the handle.
- **Waits are level-triggered.** `waitFor` checks the current value and then the changes, so skipped stages don't matter.
- **The terminal state is data.** `changes` emits the terminal state (`Closed{reason}`, `Completed`, …) last and then ends. It doesn't fail, because the union already says why it ended.
- **Only state the model folds from protocol events is watchable.** Reads that need a round trip (DOM reads, `title`) stay plain `Effect`s rather than hiding a poll. An event log is not state: its changes are just the events again, and a level-triggered wait on it would match old events.

## Network

```ts
type RouteHandler<E, R> = (request: InterceptedRequest) => Effect<RouteDecision, E, R>   // E is logged; the default decision applies
interface InterceptedRequest {
  readonly request: NetworkRequest                       // fixed: the request as paused at this phase; .toHttpClientRequest for HttpClient
  readonly fetch: Effect<HttpClientResponse, RouteError>  // let the browser perform it, then fulfil with a patched response
  fetchWith(change: (request: HttpClientRequest) => HttpClientRequest): Effect<HttpClientResponse, RouteError>
}
declare const Route: {
  readonly continue: RouteDecision
  continueWith(change: (request: HttpClientRequest) => HttpClientRequest): RouteDecision   // a change the backend can't apply fails with Unsupported
  fulfill(response: HttpServerResponse): RouteDecision   // HttpServerResponse.json, .text, .uint8Array, .stream, .file, .fromClientResponse
  readonly abort: RouteDecision
  abortWith(reason: AbortReason): RouteDecision
  readonly fallthrough: RouteDecision                    // next matching handler
  provideCredentials(credentials: { username: string; password: Redacted<string> }): RouteDecision   // the auth phase only
}
// HAR recording: Recordings, below

yield* page.route("**/api/user", () => Effect.succeed(Route.fulfill(HttpServerResponse.jsonUnsafe({ name: "Ada" }))))
yield* page.route("**/api/**", () => Effect.succeed(Route.continueWith(HttpClientRequest.setHeader("x-test", "1"))))
```

- **Requests and responses are Effect's HTTP types.** A fulfilled response is an `HttpServerResponse` and a request change is an `HttpClientRequest` transform, so everything `effect/http` offers for building them applies. What each backend can change differs (CDP: URL, method, headers and body; BiDi adds cookies), and a change it can't apply fails with `Unsupported` naming the field rather than being dropped.

```ts
interface Registration { readonly remove: Effect<void> }          // idempotent; the scope's finalizer becomes a no-op
interface RouteRegistration extends Registration { readonly hits: Watchable<number> }
interface HandlerRegistration extends Registration { readonly handled: Watchable<number> }
interface InitScript extends Registration { readonly id: InitScriptId }   // also usable in { after: [...] }
```

- **The handler's return type is the obligation.** A handler that fails, is interrupted, or leaves its scope gets the default decision (continue). A paused request is never left hanging.
- **Order.** Handlers compose by precedence: most specific scope first, then priority, then recency.

## Dialogs, downloads, storage, permissions

```ts
type Dialog =                                          // each shape offers only the decisions valid for it
  | { readonly _tag: "Alert"; readonly message: string; readonly accept: DialogDecision }
  | { readonly _tag: "Confirm"; readonly message: string; readonly accept: DialogDecision; readonly dismiss: DialogDecision }
  | { readonly _tag: "Prompt"; readonly message: string; readonly defaultValue: string
      readonly accept: DialogDecision                    // answers with defaultValue
      respond(text: string): DialogDecision
      readonly dismiss: DialogDecision }
  | { readonly _tag: "BeforeUnload"; readonly leave: DialogDecision; readonly stay: DialogDecision }
declare const Dialog: EventModule<ObservedPage, Dialog, DialogFilter> & {
  handle<E, R>(page: Page, handler: (dialog: Dialog) => Effect<DialogDecision, E, R>): Effect<HandlerRegistration, DeclarationError, Scope | R>
  // ready-made handlers; match on _tag for anything finer
  readonly acceptAll: (dialog: Dialog) => Effect<DialogDecision>    // Alert/Confirm/Prompt: accept; BeforeUnload: leave
  readonly dismissAll: (dialog: Dialog) => Effect<DialogDecision>   // Alert: accept; Confirm/Prompt: dismiss; BeforeUnload: stay
}

type FileChooser =                                     // doesn't pause the page; Cancel when no handler decides
  | { readonly _tag: "Single"; select(file: FileInput): FileChooserDecision; readonly cancel: FileChooserDecision }
  | { readonly _tag: "Multiple"; select(files: ReadonlyArray<FileInput>): FileChooserDecision; readonly cancel: FileChooserDecision }
declare const FileChooser: EventModule<Page, FileChooser, never> & {
  handle<E, R>(page: Page, handler: (chooser: FileChooser) => Effect<FileChooserDecision, E, R>): Effect<HandlerRegistration, DeclarationError, Scope | R>
  choose(files: FileInput | ReadonlyArray<FileInput>): (chooser: FileChooser) => Effect<FileChooserDecision, ActionError>   // fails on a Single chooser given several files, so Cancel applies
}

interface Download {
  readonly url: Url                                      // fixed when the download begins
  readonly suggestedFilename: FileName                   // fixed when the download begins
  readonly status: Watchable<
    | { readonly _tag: "InProgress"; readonly received: number; readonly total: Option<number> }
    | { readonly _tag: "Completed" } | { readonly _tag: "Canceled" } | { readonly _tag: "Failed"; readonly reason: string }>
  readonly finished: Effect<void, DownloadError>          // status.waitFor(finished), under the deadline
  readonly stream: Stream<Uint8Array, DownloadError>
  saveAs(path: LocalPath | string): Effect<void, DownloadError>   // always a local path; transfers from a remote browser where supported
  readonly cancel: Effect<void, DownloadError>
  // the browser-side file is deleted when its context closes, unless the backend's download policy keeps it; saveAs copies it out first
}

interface CookieJar {                                    // context.cookies
  readonly list: Effect<ReadonlyArray<BrowserCookie>, StorageError>          // every cookie in the context
  listFor(url: Url | string): Effect<ReadonlyArray<BrowserCookie>, StorageError>   // what a request to url would send
  set(cookie: CookieInput): Effect<void, StorageError>                       // a change, not a declaration: a scope doesn't undo it
  remove(match: { name: CookieName | string; domain?: CookieDomain | string; path?: string }): Effect<void, StorageError>
  readonly clear: Effect<void, StorageError>
  toCookie(cookie: BrowserCookie): Cookies.Cookie                            // to effect/http's Cookie, unredacting the value explicitly
}
interface BrowserCookie {                                // Effect's cookie attributes plus what only browsers store
  readonly name: CookieName; readonly value: Redacted<string>                // values are classified
  readonly domain: CookieDomain; readonly path: string
  readonly expires: Option<DateTime.Utc>                 // None: a session cookie
  readonly httpOnly: boolean; readonly secure: boolean; readonly sameSite: "strict" | "lax" | "none"
  readonly partitionKey: PartitionKey; readonly priority: "low" | "medium" | "high"
}
interface CookieInput {
  readonly name: CookieName | string
  readonly value: string | Redacted<string>
  readonly scope: { _tag: "Url"; url: Url | string } | { _tag: "Domain"; domain: CookieDomain | string; path: string }   // which one is always stated
  readonly expires?: DateTime.DateTime.Input             // default: a session cookie
  readonly httpOnly?: boolean; readonly secure?: boolean // defaults false
  readonly sameSite?: "strict" | "lax" | "none"          // default "lax"
  readonly partitionKey?: PartitionKey                   // default Unpartitioned
}

declare const StorageState: {
  import(bytes: Redacted<StorageStateBytes | Uint8Array>): Effect<StorageState, StorageStateError>   // accepts bytes read back from disk; validates either way
}
```

- **Default dialog policy.** It is explicit and has no delay. A context's `dialogs` option (`"dismiss"`, the default for owned contexts; `"accept"`; or `"leaveOpen"`) decides immediately when no handler claims a dialog. `beforeunload` is accepted under `"dismiss"`, so closing never hangs. On attached pages there is no default unless the caller sets one. Every automatic decision is an `AutoResolution` event and is recorded on the operation that was running.
- **Waiting on a dialog.** An operation blocked by a dialog that a handler or the policy is resolving waits within its deadline, normally just a round trip. Under `"leaveOpen"` it fails immediately with a hint naming the dialog.
- **Cookies are a change, not a declaration.** `set` and `remove` act once, like a click; a scope closing doesn't undo them. Reading cookies needs a controlled context, as reading storage state does.
- **Storage state.** `context.exportStorageState` returns the full restorable state as `Redacted<Uint8Array>`. Writing it somewhere is an explicit, visible step. Diagnostic JSON of a context never contains secrets.

## Page time

```ts
interface PageClock {
  install(mode:
    | { readonly mode: "fixed"; readonly at: DateTime.DateTime.Input }   // wall time frozen at `at`; timers run
    | { readonly mode: "offset"; readonly by: Duration.Input }    // wall time shifted; everything else real
    | { readonly mode: "controlled"; readonly at: DateTime.DateTime.Input }   // wall time, monotonic time, timers and frames move only when told
  ): Effect<Registration, DeclarationError, Scope>                 // needs before-author-script timing
  adjust(duration: Duration.Input): Effect<void, ClockError>      // controlled: advances, firing every due timer in order
  setTime(at: DateTime.DateTime.Input): Effect<void, ClockError>   // fixed or controlled: jumps; due timers fire at most once, like waking from sleep
  readonly resume: Effect<void, ClockError>                       // real time again, from now
}
```

- **Effect's words.** `adjust` and `setTime` mean what they mean on `TestClock`, so a test reads the same whichever clock it moves.
- **One timeline per scope.** `page.clock` covers every document and frame of the page, because a test's time must not reset when the page navigates. Each operation is appended to a log that new documents replay. `context.clock` is the same thing, context-wide.
- **Actionability keeps working.** Readiness sampling uses native rendering, not the page's clock, so a paused clock does not stall `click`. Nothing advances page time implicitly.
- **Separate clocks.** Page time never touches library deadlines, and `TestClock` never touches the page.

## Capabilities

```ts
page.capability(Capability.AxTree)         // Effect<AxTreeReader, CapabilityError, Scope>   — reason: Unsupported{capability, backend}
page.capability(Capability.Screencast)     // Effect<ScreencastControl, CapabilityError, Scope>
browser.capabilities                       // Watchable<CapabilitySet>: the current set, with evidence and limitations
```

Common members are on every backend. Specialized features are reached through a capability handle bound to *this* page, so a feature from one browser can't authorize an operation on another.

## Agents

```ts
const snap = yield* page.snapshot                      // aria + inferred interactivity; e.g. `- clickable "Add to cart" [ref=e9] [inferred: clickListener, cursorPointer]`
const [id] = snap.refs.keys()                          // RefIds come from the snapshot, already branded
const button = snap.ref(id)                            // a Locator pinned to one node; acting fails with StaleRef{reason} after navigation or document.open()

// One toolkit definition serves an in-process model, an MCP server and the CLI (CLI.md).
const toolkit = BrowserToolkit.make({
  context,                                             // the model works in this context; every page tool names its page
  secrets: { password: yield* Config.Redacted("PASSWORD") },   // the model sees %password%; substitution happens at dispatch
  capture: CapturePolicy.strict                        // required: what snapshots and screenshots may contain
})
// tools: pages, newPage(url, name?), goto(page, url), back(page), snapshot(page), click(page, target),
//   fill(page, target, text | %secret%), press(page, key), select(page, target, values), scroll(page, target),
//   screenshot(page), next(page, event, filter) → a wait handle, await(wait), expect(page, target, condition),
//   history(page, event, filter)
// parameters are Schemas: a model's "e12" is decoded to a RefId and checked against that page's latest snapshot
LanguageModel.generateText({ prompt, toolkit })
McpServer.toolkit(toolkit)
```

- **No tool waits after it acts.** Each result carries the outcome of the call, then a digest of what the event logs recorded since the previous call: navigations, popups, dialogs and who decided them, downloads, uncaught exceptions, console errors and failed requests. Its boundaries are calls, not time windows, and it reports what was seen without claiming what caused it.
- **Changes are diffed, not guessed.** Whether the page changed is a question for `snapshot.diff`, asked explicitly.
- **Waiting is a tool like any other:** `next` and `await` for events, `expect` for conditions.
- **Failures go back to the model.** Tools are `effect/ai` `Tool`s with `failureMode: "return"`, so an `ActionError`, `Timeout` or `StaleRef` reaches the model as data, hint included, instead of ending the conversation.

Snapshots:
- **Many sites aren't accessible.** Clickable `<div>`s have no role and icon buttons have no name, so the default `snapshot` adds two kinds of inferred information to the accessibility tree:
  - *inferred interactivity:* click listeners where the backend can list them, `cursor: pointer`, `tabindex`, `contenteditable`, `onclick`;
  - *inferred names:* visible text, `title`, `placeholder`, `alt`, a nearby label.
- **Every inference is tagged with its evidence** in both the value and the text, so a model or a reader can tell `button "Save"` from `clickable "Save" [inferred: cursorPointer]`.
- **`ariaSnapshot` is the pure accessibility tree,** which `Expect.toMatchAria` matches against.
- **Same node, same ref** within a document generation, so a renamed button keeps its ref.
- **Diffs are explicit** (`snapshot.diff(previous)`), never an automatic switch between full and delta output.
- **Visual-only UIs** (canvas, maps) need screenshots and coordinate actions. The toolkit offers those as an explicit tool set rather than a fallback.

## Recordings: traces and HAR

```ts
declare const Trace: {
  record(target: UserContext | Page): Effect<TraceRecording, TraceError, Scope>          // spans, logs, errors and console; nothing captured from the page
  recordWith(target: UserContext | Page, options: {
    readonly screenshots?: "perAction" | "off"                                  // default "off"
    readonly screencast?: "native" | { readonly polled: Duration.Input } | "off" // BiDi has no native screencast; default "off"
    readonly domSnapshots?: boolean                                             // default false; needs control (below)
    readonly network?: boolean                                                  // default false; HAR entries, so snapshots render with their resources
  }): Effect<TraceRecording, TraceError | Unsupported, Scope>
}
interface TraceRecording extends Registration {
  exportTrace(path: LocalPath | string): Effect<LocalPath, TraceError>         // Playwright's trace-viewer zip, format 9
}

declare const Har: {
  record(target: UserContext | Page, options: {
    readonly content: "embed" | "attach" | "omit"        // required: never inferred from a file extension
    readonly detail?: "full" | "minimal"                  // default "full"
    readonly url?: UrlPattern                             // default: every request
    readonly webSocketFrames?: boolean                    // default false; Unsupported on BiDi
    readonly inFlightAtStop?: "wait" | "markIncomplete"   // default "markIncomplete": stopping never waits unless asked
  }): Effect<HarRecording, HarError | Unsupported, Scope>
}
interface HarRecording extends Registration {
  readonly entries: Watchable<number>
  exportHar(path: LocalPath | string, options?: { readonly include?: ReadonlyArray<SecretClass> }): Effect<LocalPath, HarError>   // redacted unless included
}
```

- **Spans are the record.** Every public operation is already an `Effect.fn` span, so whatever tracer you install already receives the trace: `effect/observability`'s OTLP exporters for any OpenTelemetry backend, or `effect/devtools` to watch it live in Effect's DevTools. `Trace.record` adds what spans can't carry: page-side captures (screenshots, screencast, DOM snapshots) as span attachments, and the export.
- **Playwright's zip is one export.** `exportTrace` writes format version 9, which Playwright's trace viewer opens (research/playwright-trace-format.md). The archive, like a HAR recorded with `content: "attach"`, is written as a stream with `effect/encoding`'s `Zip` (in flight).
  - The viewer rejects files newer than itself, and version 10 is unreleased.
  - Spans become the viewer's nested steps, and logs and errors become its log and error events.
  - Actions carry our own names, never Playwright's, because the viewer special-cases Playwright's names and assumes their selector syntax.
  - Timestamps come from a real monotonic clock, never Effect's `Clock`, so `TestClock` can't freeze them.
- **Levels are opt-in, and their costs are stated.**
  - Actions, logs, errors and console output are always recorded.
  - Screenshots and the screencast cost bandwidth. BiDi has no native screencast, so it is polled at the interval you choose.
  - DOM snapshots install Playwright's capture script in the page's main world, where it hooks CSSOM methods. That changes the page, so it needs control and never runs on attached or observed pages.
- **Exports are explicit and redacted.** Both files cross a persistence boundary (`export*`). Classified fields are stripped under the active diagnostics preset, and raw content (bodies, snapshots, screenshots) is included only when asked for.
- **HAR recording** records requests as sent. Timings follow the HAR spec, and an entry without a body says why. On BiDi, the body collectors start when the recording scope is acquired (research/har.md).
- **HAR replay is deferred.** Mocking the network is `route`'s job, and replay is test infrastructure that will be reworked with etest.

## Testing

**Vitest first, ready for etest.** Everything a test needs is a Layer or a scoped Effect with a lifetime. Runner specifics sit behind one per-test service, `TestRun`. When `@effect/test` (etest) is ready, an etest adapter attaches the same Layers with `Test.provide` (research/effect-test-runner.md).

```ts
import { layer } from "@effect/vitest"
import { BrowserTest } from "effect-browser/test"
import { VitestBrowser } from "effect-browser/test/vitest"
import { Chromium } from "effect-browser/chromium"

layer(VitestBrowser.layer(Chromium.launch))("checkout", (it) => {
  it.effect("adds to cart", () =>
    Effect.gen(function* () {
      const page = yield* BrowserTest.page      // a fresh context and page per test, closed after
      yield* page.goto("/shop")
      // …
    }))
})
```

```ts
// effect-browser/test: runner-agnostic
declare const BrowserTest: {
  readonly page: Effect<Page, PageError, Browser | Scope>                     // Browser, then newPage
  pageWith(options: UserContextOptions): Effect<Page, PageError, Browser | Scope>
}
class TestRun extends Context.Service<TestRun, {          // per test, from the runner adapter
  readonly info: TestInfo                                  // project, file, id, attempt, worker, shard
  attach(artifact: TestArtifact): Effect<void>             // Vitest: recordArtifact
}>()("effect-browser/TestRun") {}

// effect-browser/test/vitest
declare const VitestBrowser: {
  layer<E, R>(backend: Layer<Browser, E, R>): Layer<Browser | TestRun, E, R>   // the backend you pass, unchanged, plus TestRun from the current test
}
```

- **Nothing changes because it's a test.** The layer launches exactly the backend you pass. Profile, focus, diagnostics and tracing are whatever the test chose, as anywhere else: a suite that runs many pages at once says `Chromium.launchWith({ profile: LaunchProfile.concurrent })` and `pageWith({ focus: "emulated" })`, and a test that wants a trace calls `Trace.record` and attaches the export with `TestRun.attach` (under Vitest, `recordArtifact`).
- **Lifetimes.** One browser per layer block, which is about one per file under Vitest's default isolation, and a fresh context and page per test. Deadlines run on a live clock even under `TestClock`.
- **Parallelism** (research/test-parallelism.md). Files run in parallel across Vitest workers, each with its own browser. Concurrent tests within a file are opt-in (`layer(…, { concurrent: true })`). One browser for a whole run waits for etest's run-wide shared layers.
- **Contexts don't isolate everything.** Launch flags, the downloads directory, browser-wide commands, extensions, and OS focus, clipboard and GPU are shared. The library always scopes commands to the context it owns.
- **No fixture magic.** Everything is a `Layer`, and dependencies are tracked in `R`.
- **`Expect` and etest's assertions.** Under etest, `Expect` will fail with `AssertionError`-shaped data and record into the attempt's `AssertionRecord`. It keeps its own retry loop, because it re-checks on change signals, which etest's interval-based `eventually` can't do.

## Errors as users see them

```ts
class TargetGone extends Schema.TaggedError<TargetGone>()("TargetGone", {
  target: TargetDescription, reason: CloseReason, diagnostics: Diagnostics }) {}
class Timeout extends Schema.TaggedError<Timeout>()("Timeout", {
  operation: Schema.String,
  phase: Schema.Literals(["resolving", "waitingForCondition", "dispatchedUnconfirmed", "postcondition"]),
  last: Schema.Option(ObservedValue), history: Schema.Array(ObservedValue), diagnostics: Diagnostics }) {}
class ActionError extends Schema.TaggedError<ActionError>()("ActionError", {
  action: Schema.String,
  reason: Schema.Union([StrictViolation, NotEditable, InvalidSelector, InvalidOption, NotPermitted, Unsupported, BackendFailure]),
  diagnostics: Diagnostics }) {}
// NavigationError, EvaluationError, ResponseError, ExpectationFailed, RouteError, DeclarationError, … follow the same shape
// every reason carries `hint: string`, e.g.
class NotPermitted extends Schema.TaggedError<NotPermitted>()("NotPermitted", {
  required: Schema.Literals(["inspect", "control", "browserWide"]), hint: Schema.String }) {}   // "call `.control` on this page"

// recovery reads naturally:
locator.click.pipe(
  Effect.catchReason("ActionError", "StrictViolation", (v) => Console.log(v.suggestions)),
  Effect.catchTag("Timeout", (t) =>
    t.phase === "dispatchedUnconfirmed" ? recheckState : Effect.fail(t))
)
```

`Diagnostics` is the shared envelope: `operationId`, `dispatch`, `progress`, `lastObserved` and `cleanup`. It is rendered under the active preset (README.md).

## Call sites (acceptance scenarios)

These are the checks for this layer. If a scenario needs protocol knowledge or repeated ceremony, the model underneath is wrong.

```ts
// 1. Log in once, reuse the session
const state = yield* Effect.scoped(Effect.gen(function* () {
  const page = yield* browser.newPage
  yield* page.goto("https://app.example.com/login")
  yield* page.getByLabel("Email").fill("me@example.com")
  yield* page.getByLabel("Password").fill(yield* Config.Redacted("PASSWORD"))
  yield* page.getByRole("button", { name: "Sign in" }).click
  yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
  return yield* page.context.exportStorageState
}))
const page = yield* browser.newPageWith({ storageState: yield* StorageState.import(state) })

// 2. Click, then wait for a named outcome
const orders = yield* PageNavigation.next(page, { url: "**/orders" })   // subscribed before the click
yield* page.getByRole("link", { name: "Orders" }).click
const nav = yield* Deferred.await(orders)

// 3. Popup with a dialog inside it
const popups = yield* Popup.next(page)
yield* page.getByText("Connect account").click
const popup = yield* Deferred.await(popups)              // a Page, owned by the scope that acquired `page`
yield* Dialog.handle(popup, Dialog.acceptAll)            // a dialog blocks its page, so the decision is registered first
yield* popup.getByRole("button", { name: "Allow" }).click

// 4 + 9. Response body, decoded and filtered
const added = yield* NetworkResponse.next(page,
  { url: "**/api/cart", method: "POST", body: HttpIncomingMessage.schemaBodyJson(Cart) },
  (r) => Effect.succeed(r.body.items.length > 0))         // where: typed from the decoded body
yield* page.getByRole("button", { name: "Add to cart" }).click
const res = yield* Deferred.await(added)                 // CapturedResponse<Cart>

// 5. Download
const download = yield* Download.next(page)
yield* page.getByText("Export CSV").click
const file = yield* Deferred.await(download)
yield* file.saveAs("./export.csv")

// 6. Concurrent pages, settings isolated by context
yield* Effect.forEach(urls, (url) => Effect.scoped(Effect.gen(function* () {
  const p = yield* browser.newPageWith({ locale: "de-DE" })   // context + page released per URL
  yield* p.goto(url)
  return yield* p.title
})), { concurrency: 4 })

// 7. Attach, inspect one tab, control another, leave both open
const browser = yield* Browser                          // provided by Chromium.connect(endpoint)
const [first, second] = yield* browser.pages
yield* Effect.scoped(Effect.gen(function* () {
  const reader = yield* first.inspect
  const text = yield* reader.getByRole("heading").readText
  const tab = yield* second.control
  const blocked = yield* tab.route("**/analytics/**", () => Effect.succeed(Route.abort))
  yield* tab.getByRole("button", { name: "Refresh" }).click
  yield* Console.log(`blocked ${yield* blocked.hits} analytics calls`)
}))                                                     // route and access released; both tabs stay open

// 8. Log requests until the page closes
const requests = yield* NetworkRequest.stream(page)     // subscribed now, so nothing is missed
yield* requests.pipe(
  Stream.filter((r) => r.resourceType === "fetch"),
  Stream.runForEach((r) => Console.log(r.method, r.url)),
  Effect.forkScoped)                                     // background; ends normally on close, fails on crash

// 10. Paused application time
yield* page.clock.install({ mode: "controlled", at: "2026-01-01T09:00:00Z" })
yield* page.goto("/session")
yield* page.getByRole("button", { name: "Start" }).click   // no page time passes
yield* page.clock.adjust("5 minutes")
yield* page.getByText("Session expired").pipe(Expect.toBeVisible)

// 11. Ordered setup scripts
const helper = yield* page.addInitScript(installTestHooks)
yield* page.addInitScript(useTestHooks, { after: [helper] })   // dependencies only on equal or broader scope

// 12. Operational failures stay typed and evidenced; timeouts are cross-cutting
yield* page.locator("button[").click.pipe(              // invalid selector: immediate, no waiting
  Effect.catchReason("ActionError", "InvalidSelector", (e) => Console.log(e.message)))
yield* page.getByRole("button", { name: "Pay" }).click.pipe(Deadline.within("5 seconds"))

// 13. One action, several outcomes, collected later
const checkout = yield* Popup.next(page)
const order = yield* NetworkResponse.next(page, { url: "**/api/order" })
yield* page.getByRole("button", { name: "Pay" }).click
const [tab, placed] = yield* Effect.all([Deferred.await(checkout), Deferred.await(order)])   // each latched, even if it arrived during the click

// 14. Watch state while doing other work
const pdf = yield* Download.next(page)
yield* page.getByText("Export PDF").click
const report = yield* Deferred.await(pdf)
yield* report.status.changes.pipe(Stream.runForEach(renderProgress), Effect.forkScoped)   // fork first: watching shows the present
yield* page.status.waitFor((s) => s._tag === "Open" && s.document.readiness === "complete")
yield* report.finished

// 15. What already happened: reads, not subscriptions
const errors = yield* UncaughtException.history(page)   // EventHistory: entries, oldest first, and how many were dropped
const carts = yield* NetworkResponse.history(page, { url: "**/api/cart" })   // metadata only, never bodies

// 16. Structure, matched explicitly
yield* page.getByRole("navigation").pipe(Expect.toMatchAria(
  AriaPattern.node("navigation", "Main", AriaPattern.including(
    AriaPattern.node("link", "Orders", AriaPattern.unchecked)))))

// 17+. The newly sketched areas (input held across steps, frames, cookies, origin storage, emulation,
//      workers, WebSocket frames, reads and handles) are in sketch/scenarios/gaps.ts, type-checked.
```

## Open questions

1. **How the Vitest adapter finds the current test.** @effect/vitest passes Vitest's test context to `it.effect` as an argument, not as a service, so `VitestBrowser.layer` can't read it from the environment. Recommendation: propose that @effect/vitest provide it as a service in every `it.effect`. Until then, tests pass it explicitly.

Decided:
- **The fake browser** stays internal first. Once stable, it becomes a narrow `effect-browser/testing` subpath for event- and lifecycle-level scenarios. It doesn't emulate a DOM: actions against fake pages fail with `Unsupported`.
- **No Vitest reporter plugin.** The library stays runner-agnostic, and flakiness is classified from `test.retry` / `test.outcome` span attributes and `TestInfo`.
- **Testing ships for Vitest first, behind `TestRun`,** so that moving to etest is a new adapter, not a redesign (revision 5.18).
