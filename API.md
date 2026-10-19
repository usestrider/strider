# API: the ergonomic layer (L2)

*Revision 5.2, 2026-10-18. These are sketches: names and signatures are provisional, nothing is implemented, and the types show shape rather than compile-verified code. Every behavior here must be expressible in [CONCEPTS.md](CONCEPTS.md).*

## Purpose

This layer is what users write. It turns the native model into a small vocabulary of browsers, contexts, pages, locators, actions, expectations and events, with the following properties:

- No protocol knowledge.
- `Scope` only where something with a lifecycle is acquired.
- One deadline per call.
- Errors that say what happened.

Error unions on reads, captures and evaluations are shortened in the sketches (`ReadError`, `CaptureError`). Like every operation, they also include `TargetGone | Timeout`.

## Conventions

- **If it doesn't have to be a function, it isn't one.**
  - A member that takes no arguments is a value: an `Effect` for operations (`locator.click`, `page.reload`, `browser.newPage`, `tab.inspect`), a plain property for pure derivations (`locator.first`).
  - A member whose parameters are all optional is the default value plus an `xWith(options)` function: `locator.click` / `locator.clickWith({ button: "right" })`.
  - A member with required arguments is a function and may take trailing options: `goto(url)`, `fill(value)`, `dragTo(target, options)`.
- **Cross-cutting settings are dual combinators, not option fields.** Timeouts and diagnostics apply to any effect: `button.click.pipe(Browser.withTimeout("5 seconds"))`. Option bags hold only what is specific to the operation.
- **Anything with a lifecycle requires `Scope`.**
  - **What it covers:** contexts, pages, access upgrades, handles, capability handles and every declaration (routes, dialog and file-chooser handlers, init scripts, overrides, clocks). Each is acquired into the caller's `Scope` and released when that scope closes.
  - **Seeing an event acquires nothing.** A popup belongs to the scope that acquired its opener, and a download's file to its context.
  - **What doesn't need it:** values with no remote lifetime (locators, snapshots, captured bodies, storage-state bytes).
  - **Early release** (`page.close`) is always possible; the finalizer then does nothing.
- **Handles get members; decorators are dual combinators.** `Expect.*` and `Browser.with*` work both data-first and in `pipe`.
- **State is a `Watchable`; each event type is a module** (see State and events). State can be read at any time and waited on safely. Events are not page members: `Download.next(page)` subscribes, and the action that causes the download comes on the next line.
- **No public fibers, no writable `Deferred`s or `Ref`s.** The library never forks on the caller's behalf and never returns a `Fiber`. Callers fork their own consumers with `Effect.forkScoped`. Internally, `Deferred`s latch results and `SubscriptionRef`s hold state, but only read-only views cross the API.
- **No platform services at call sites.** Platform services appear only in the launch and connect layers, so `Scope` is the only requirement an ordinary call site can see.
- **Immutable by default; mutable state is read through an `Effect`.** Handles, locators, snapshots, events and errors are immutable values. Anything that can change is never a plain field: `page.url`, `page.title`, `browser.capabilities`, page lists, and whether a handle still holds its access. Such reads are `Effect`s, evaluated when they run, so they can't go stale in a variable. Changes arrive on a `Watchable`'s `changes`. Internally this state lives in a `SubscriptionRef` (CONCEPTS.md §2), which the public API never exposes for writing. Mutability is avoided wherever an immutable value can do.
- **Plain fields on live handles must be fixed, and say why.** A live handle (browser, context, page, frame, download, intercepted request) may expose a plain field only if the value can't change for the handle's lifetime. Each such field carries a one-line justification. Ids, `closed` and sub-handles bound to their parent (`keyboard`, `mouse`, `clock`, whose own state is again read through `Effect`s) are exempt by construction. A field that can't be justified becomes an `Effect`. Immutable values (snapshots, locators, navigations, dialogs) are exempt entirely.
- **Brand liberally.** Every id and every meaningful string or number is a branded type (CONCEPTS.md §1): `Url`, `UrlPattern`, `HttpStatus`, `HeaderName`, `LocalPath`/`RemotePath`, `CssPixels`/`DevicePixels`, `Locale`, `RefId`, …
  - **Outputs** are always branded.
  - **Inputs** require the brand where two meanings could be confused at one call site: local vs remote paths (`File.local` / `File.remote`), CSS vs device pixels.
  - **Elsewhere, inputs accept a plain string** when the member name already fixes its meaning (`goto(url)`, `route(pattern)`). The string is parsed at the boundary, and a bad one fails immediately with an invalid-input reason, never by waiting.
  - **Tokens are never accepted as plain strings.** A token is a produced value whose meaning depends on where it came from: ids, snapshot refs, document generations, registration handles such as `InitScript`, operation ids. It is accepted only in its branded or opaque form. A brand doesn't prove provenance, so tokens are also checked against their origin when used: a `RefId` from another snapshot or document fails with `StaleRef`, and an `InitScript` from a closed scope fails as a dependency. Values whose meaning is intrinsic (`Url`, `HttpStatus`) round-trip freely.
- **Unions of valid models; `Option` for what's truly optional.** Everything the library returns is a tagged union of its valid shapes rather than a record with optional fields: navigations, dialogs, request initiators, ownership. Genuinely optional values are `Option`, never `?:`, `undefined` or `null`. Input option bags keep `?:` to mean "use the default", but mutually exclusive alternatives are unions: a route body is JSON *or* text *or* bytes, and a screenshot covers the viewport *or* the full page *or* a clip *or* an element.
- **Locators are values,** resolved again on every attempt.
- **Snapshots are named `read*`.** Retrying assertions take locators.
- **Access is typed.** Pages have three levels and contexts two. There are no type guards for narrowing, because access is a grant held by a `Scope`, not a fact about the page; `.inspect` and `.control` are the only way up. Pages are `ObservedPage` ⊂ `ReadonlyPage` ⊂ `Page`, like `ReadonlyArray` and `Array`. A helper that only reads takes `ReadonlyPage`, and a `Page` is accepted. Calling an action on a page you may only inspect is a compile error, and autocomplete doesn't offer it.
- **Long, explicit names are fine.** `BrowserContext` avoids a clash with Effect's `Context`.
- **Names encode behavior.** One grammar, so a call's semantics can be read from its name:

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
  | `with*` (dual) | a cross-cutting setting over any effect | `Browser.withTimeout` |
  | `export*` / `import` | crosses a persistence boundary; carries secrets | `exportStorageState`, `StorageState.import` |

- **Every scoped acquisition returns a handle, never `void`.** Registrations (routes, dialog handlers, init scripts, overrides, clocks) return handles with an idempotent `remove` and, where useful, state such as `hits: Watchable<number>`. You can then release early or inspect without nesting another `Effect.scoped`, and the scope's finalizer becomes a no-op.
- **Every effect ends.** Each library operation that waits does so under the operation deadline, and anything open-ended is a `Stream` whose consumer decides when to stop. The single exception is lifetime signals (`closed`), which wait exactly as long as the resource lives.
- **Every error reason carries a hint,** a one-line fix that is shown in the rendered message:
  - `NotPermitted`: "call `.control` on this page"
  - `StaleRef`: "refs end with their document; use a locator or take a new snapshot"
  - `Unsupported`: "supported on: chromium (CDP)"
  - `StrictViolation`: "2 matches; try `getByRole('button', { name: 'Save' })`"
  - `Timeout` awaiting a `next`: "a matching download started 12 ms before `Download.next` subscribed; call it before the action that causes it"
- **Explicit over implicit.** Nothing hidden may change behavior or add waiting. Helpers that make explicit behavior simpler are welcome, but they stay opt-in. That rules out magic delays, grace periods and heuristic windows by default. If you want such behavior, ask for it in code: an `Expect`, a `waitFor`, a `next`, or a named option. Actionability waiting is the documented contract of each action: named checks, adjustable per call, reported in errors. It is not a hidden heuristic.
- **One way to do each thing.** No aliases, and no parallel mechanisms for the same job (that is why `withPage` went away). A convenience is allowed only where it is the dominant call site and is documented as its expansion: `page.url` is `page.status.map(…)`, `download.finished` is `status.waitFor(…)`, and `browser.newPage` is `newContext` followed by `newPage`.

## Top data models

```ts
interface ObservedPage {                                // state and events only
  readonly id: NavigableId
  readonly status: Watchable<PageStatus>                 // one consistent snapshot; ends with Closed{reason}
  readonly url: Watchable<Url>                           // status.map(…): derived from the same source
  readonly frames: Watchable<FrameTree>
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
  readonly status: HttpStatus
  readonly headers: Headers                             // keyed by HeaderName; classified values arrive as Redacted
}
interface CapturedResponse<B> extends NetworkResponse { readonly body: B }

interface Snapshot {                                    // a structured tree; text is one rendering of it
  readonly document: DocumentId
  readonly generation: DocumentGeneration
  readonly root: SnapshotNode
  readonly text: string                                 // Playwright-style YAML aria snapshot, with evidence tags for inferred nodes
  readonly refs: ReadonlyMap<RefId, SnapshotNode>       // already branded
  ref(id: RefId): Locator                              // lazy, like any locator; its actions fail with StaleRef{reason} once the document or generation moves on
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
  launchWith(options: {
    readonly headless?: boolean
    readonly channel?: "stable" | "beta" | "canary"
    readonly executablePath?: LocalPath | string
    readonly args?: ReadonlyArray<string>
    readonly profile?: LaunchProfile                     // default LaunchProfile.automation
    readonly userDataDir?: LocalPath | string            // a profile directory you own; never deleted
  }): Layer<Browser, LaunchError, ChildProcessSpawner | FileSystem>
  connect(endpoint: Url | string, options?: { readonly headers?: Record<string, Redacted<string> | string> }):
    Layer<Browser, ConnectError, WebSocketConstructor>
}
// Firefox.launch / launchWith; WebKit.launch / launchWith / attach(endpoint); Bidi.connect(endpoint): same shape

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
class Browser extends Context.Service<Browser, BrowserHandle>()("effect-browser/Browser") {
  // provided by a backend layer (Chromium.launch, Firefox.launch, …)
  // dual combinators over any effect
  static withTimeout: Dual<Duration.Input>            // one budget for everything inside; nested operations share it
  static withDefaultTimeout: Dual<Duration.Input>     // default budget per operation inside
  static withDiagnostics: Dual<"local" | "strict">
}
// Dual<X> = { (x: X): <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, R>; <A, E, R>(self: Effect<A, E, R>, x: X): Effect<A, E, R> }

interface BrowserHandle {
  readonly info: BackendInfo                                                         // fixed for the connection
  readonly capabilities: Watchable<CapabilitySet>                                    // refined as probes complete
  readonly newContext: Effect<BrowserContext, ContextError, Scope>                   // owned; removed when the scope closes
  newContextWith(options: ContextOptions): Effect<BrowserContext, ContextError, Scope>
  readonly newPage: Effect<Page, PageError, Scope>                                   // a fresh context + page, released together
  newPageWith(options: ContextOptions): Effect<Page, PageError, Scope>
  readonly pages: Watchable<ReadonlyArray<ObservedPage>>                             // attach mode: what exists, and changes
  readonly defaultContext: ObservedContext                                           // fixed: exists for the whole connection
}

interface ObservedContext {                              // a context we don't control, e.g. the default context when attached
  readonly id: UserContextId
  readonly pages: Watchable<ReadonlyArray<ObservedPage>>
  readonly closed: Effect<CloseReason>
  readonly control: Effect<BrowserContext, ContextError, Scope>   // explicit; reading storage needs it too
}
interface BrowserContext extends ObservedContext {        // two levels only: reads happen on pages
  readonly newPage: Effect<Page, PageError, Scope>       // closed with its unsolicited popups when the scope closes
  readonly pages: Watchable<ReadonlyArray<Page>>
  readonly exportStorageState: Effect<Redacted<StorageStateBytes>, StorageStateError>   // branded bytes; a Uint8Array subtype
  readonly clock: Clock                                  // context-wide timeline (opt-in)
  route<E, R>(pattern: UrlPattern, handler: RouteHandler<E, R>): Effect<RouteRegistration, RouteError, Scope | R>
  addInitScript(script: InitScriptSource, options?: InitScriptOptions): Effect<InitScript, DeclarationError, Scope>
  emulate(settings: Emulation): Effect<Registration, DeclarationError, Scope>
}

interface ContextOptions {
  readonly storageState?: StorageState                  // from StorageState.import(bytes)
  readonly dialogs?: "dismiss" | "accept" | "leaveOpen"  // decision when no handler claims a dialog; default "dismiss"
  readonly viewport?: { width: CssPixels | number; height: CssPixels | number }   // CSS pixels by definition
  readonly locale?: Locale | string
  readonly timezone?: TimeZoneId | string
  readonly permissions?: ReadonlyArray<Permission>
  readonly focus?: "system" | "emulated"                 // default "system"; "emulated" makes every page report focus (owned contexts only)
  readonly eventLog?: number                             // retained events per module and page, for history; default 100, 0 keeps none
}
```

## Pages

```ts
interface ReadonlyPage extends ObservedPage {
  // locators
  getByRole(role: AriaRole, options?: { name?: string | RegExp; exact?: boolean }): ReadonlyLocator
  getByText(text: string | RegExp, options?: { exact?: boolean }): ReadonlyLocator
  getByLabel(text: string | RegExp): ReadonlyLocator
  getByTestId(id: string): ReadonlyLocator
  locator(css: string): ReadonlyLocator
  frame(locator: ReadonlyLocator): ReadonlyFrame         // enters an iframe by its element
  // one-shot reads
  readonly title: Effect<string, ReadError>
  readonly ariaSnapshot: Effect<Snapshot, ReadError>     // the accessibility tree only: what assistive technology sees
  readonly snapshot: Effect<Snapshot, ReadError>         // accessibility tree + inferred interactivity, every inferred node tagged with its evidence
  snapshotWith(options: { sources?: "aria" | "aria+interactivity"; root?: ReadonlyLocator; depth?: number; interactiveOnly?: boolean }):
    Effect<Snapshot, ReadError>                          // size is explicit: no automatic truncation
  readonly screenshot: Effect<Uint8Array, CaptureError>  // viewport, PNG
  screenshotWith(options: {
    area?: { _tag: "Viewport" } | { _tag: "FullPage" } | { _tag: "Clip"; rect: Rect<CssPixels> } | { _tag: "Element"; locator: ReadonlyLocator }
    format?: { _tag: "Png" } | { _tag: "Jpeg"; quality: number }   // quality exists only for JPEG
  }): Effect<Uint8Array, CaptureError>
  readonly pdf: Effect<Uint8Array, CaptureError>
  pdfWith(options: PdfOptions): Effect<Uint8Array, CaptureError>
  evaluate<Args extends ReadonlyArray<unknown>, A>(    // isolated world: no page globals
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect<A, EvaluationError | TargetGone | Timeout>
}

interface Page extends ReadonlyPage {
  // the locator members above return Locator (with actions) instead of ReadonlyLocator
  readonly context: BrowserContext                      // fixed: a page never changes context
  goto(url: Url | string, options?: { waitUntil?: LoadState; accept?: ReadonlyArray<"download" | "noContent"> }):
    Effect<PageNavigation, NavigationError | TargetGone | Timeout>
  readonly reload: Effect<PageNavigation, NavigationError | TargetGone | Timeout>
  reloadWith(options: { waitUntil?: LoadState }): Effect<PageNavigation, NavigationError | TargetGone | Timeout>
  readonly back: Effect<Option<PageNavigation>, NavigationError | TargetGone | Timeout>    // None: no history entry
  backWith(options: { waitUntil?: LoadState }): Effect<Option<PageNavigation>, NavigationError | TargetGone | Timeout>
  readonly forward: Effect<Option<PageNavigation>, NavigationError | TargetGone | Timeout>
  forwardWith(options: { waitUntil?: LoadState }): Effect<Option<PageNavigation>, NavigationError | TargetGone | Timeout>
  evaluate<Args extends ReadonlyArray<unknown>, A>(    // main world
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect<A, EvaluationError | TargetGone | Timeout>
  evaluateAs<S extends Schema.Top>(schema: S, fn: (...args: any) => unknown, ...args: ReadonlyArray<unknown>):
    Effect<S["Type"], EvaluationError | TargetGone | Timeout>
  evaluateHandle(fn: () => unknown): Effect<JSHandle, EvaluationError | TargetGone | Timeout, Scope>
  readonly keyboard: Keyboard
  readonly mouse: Mouse
  readonly clock: Clock
  route<E, R>(pattern: UrlPattern, handler: RouteHandler<E, R>): Effect<RouteRegistration, RouteError, Scope | R>
  addInitScript(script: InitScriptSource, options?: InitScriptOptions): Effect<InitScript, DeclarationError, Scope>
  emulate(settings: Emulation): Effect<Registration, DeclarationError, Scope>
  readonly activate: Effect<void, TargetGone>            // bring to front; rendering-based waits need it
  readonly close: Effect<void, TargetGone | Timeout>     // owned teardown: no beforeunload
  closeWith(options: { runBeforeUnload: boolean }): Effect<void, CloseCanceled | TargetGone | Timeout>
}
```

Notes:

- **Evaluated functions cross into the page.** They must be self-contained, and values travel as arguments. A `ReferenceError` from an evaluated function carries a hint saying so.
- **Evaluation runs by value by default.** Results are serialized and deserialized. `evaluateAs(schema, …)` validates the result. Handles are opt-in and scoped. Running as a user gesture is an option on an `evaluateWith(options, fn, …args)` variant (not shown), where the backend supports it.
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
  readonly isVisible: Effect<boolean, ReadError>
  readonly all: Effect<ReadonlyArray<ReadonlyLocator>, ReadError>   // pinned to the current nth matches
  readonly snapshot: Effect<Snapshot, ReadError>
  readAttribute(name: string): Effect<Option<string>, ReadError>
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
  fill(value: string | Redacted<string>): Effect<void, ActionError | TargetGone | Timeout>
  press(key: KeyName): Effect<void, ActionError | TargetGone | Timeout>
  pressSequentially(text: string | Redacted<string>, options?: { delay?: Duration.Input }): Effect<void, ActionError | TargetGone | Timeout>
  selectOption(values: string | ReadonlyArray<string>): Effect<void, ActionError | TargetGone | Timeout>
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

declare const File: {                                    // FileInput: the brand is required, so paths can't be confused
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

## Expectations

```ts
declare const Expect: {
  // no extra arguments: the matcher itself is the function
  //   locator.pipe(Expect.toBeVisible)   or   Expect.toBeVisible(locator)
  toBeVisible: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  toBeHidden: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  toBeEnabled: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  toBeChecked: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  toBeFocused: (subject: ReadonlyLocator) => Effect<void, ExpectationFailed | TargetGone>
  // with arguments: dual
  //   locator.pipe(Expect.toHaveText("1 item"))   or   Expect.toHaveText(locator, "1 item")
  toHaveText: DualMatcher<ReadonlyLocator, [expected: string | RegExp | ReadonlyArray<string | RegExp>]>
  toHaveValue: DualMatcher<ReadonlyLocator, [expected: string | RegExp]>
  toHaveAttribute: DualMatcher<ReadonlyLocator, [name: string, expected?: string | RegExp]>
  toHaveCount: DualMatcher<ReadonlyLocator, [count: number]>
  toMatchAriaSnapshot: DualMatcher<ReadonlyLocator, [template: string]>
  toHaveURL: DualMatcher<ReadonlyPage, [expected: string | RegExp]>
  toHaveTitle: DualMatcher<ReadonlyPage, [expected: string | RegExp]>
  // the general form: any observable, any condition
  that<A>(observable: Observable<A>, condition: Condition<A>): Effect<void, ExpectationFailed | TargetGone>
  poll<A, E, R>(probe: Effect<A, E, R>, condition: Condition<A>): Effect<void, E | ExpectationFailed, R>
  soft<A, E, R>(self: Effect<A, E, R>): Effect<void, never, R | SoftExpectations>   // failures collected, reported at scope end
  withInterval: Dual<Duration.Input>                     // re-check interval for conditions with no change signal; default 100 ms
}
declare const Cond: {
  not<A>(c: Condition<A>): Condition<A>                  // the wait is for the negation, and it passes when the element is missing
  and<A>(...cs: ReadonlyArray<Condition<A>>): Condition<A>   // evaluated against one observation
  because<A>(why: string): (c: Condition<A>) => Condition<A>
}
```

- **How expectations evaluate.** One check runs immediately. After that, a check runs on every change signal for the subject: a `Watchable` change, or a DOM mutation in the subject's subtree. Conditions with no change signal, such as layout and visibility, are also re-checked at a fixed interval (`Expect.withInterval`). There is no backoff, because backoff adds more lag the longer a test waits (rule 23). Everything runs on the live clock, within the deadline (`Browser.withTimeout` adjusts it).
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
  next(target: T, filter?: F): Effect<Pending<A, E>, ObserveError, Scope>                     // subscribed when this returns
  stream(target: T, filter?: F): Effect<Stream<A, E | EventOverflow>, ObserveError, Scope>   // every match from now on
  history(target: T, filter?: F): Effect<EventLog<A>>                                         // every retained match; never waits
}
interface Pending<A, E = never> extends Effect<A, E | TargetGone | Timeout> {   // yield* awaits the first match, under the deadline of the await
  readonly poll: Effect<Option<Exit<A, E | TargetGone | Timeout>>>
}
interface EventLog<A> {
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
| `NetworkResponse` | `NetworkResponse`, or `CapturedResponse<B>` given `body` | `url`, `method`, `status`; `next` requires `url`. `body` (`Body.json(schema)`, `Body.text`, `Body.bytes`) and `where` need inspect and apply to `next` and `stream` | any page or context |
| `ConsoleMessage` | `ConsoleMessage` | `level`, `text` | any page or context |
| `UncaughtException` | `UncaughtException`: thrown errors and unhandled rejections | `message` | any page or context |
| `Dialog` | `Dialog` | `_tag` | any page; `Dialog.handle` needs `Page` |
| `FileChooser` | `FileChooser` | — | `Page` |
| `Download` | `Download` | `url` | `Page` or `BrowserContext` |
| `AutoResolution` | `AutoResolution`: an obligation decided by a default policy | — | `Page` or `BrowserContext` |

Each module has the most specific accurate name, with a prefix only where a bare name would clash with the fetch `Request`/`Response` or DOM `Navigation` globals. `ConsoleMessage` avoids Effect's `Console`, and `UncaughtException` avoids our `PageError` and the `*Error` suffix our failures use.

**Events:**
- **Subscribe, act, collect.** `next` and `stream` are subscribed by the time their effect returns, so code order is subscription order, and one action can have several outcomes. Filters apply before buffering, so unrelated traffic can't overflow a subscription.
- **A late subscription is diagnosed, not hidden.** If a match arrived shortly before `next` subscribed, the `Timeout` names it in its hint: "a matching download started 12 ms before `Download.next` subscribed".
- **Waits look forward; `history` looks back.** `history` answers questions you couldn't ask in advance: debugging, failure reports, agents and the CLI, and events from before you had a handle, such as a popup's first requests.
  - It never subscribes or waits, so it can't catch what an action causes: right after a click, the download usually isn't in it yet. There is deliberately no `last`, because its only use that `history` doesn't cover would be exactly that race.
  - It isn't a complete record: the log is capped, so a missing entry proves nothing unless `dropped` is 0. Complete records come from a `stream` opened at the start, or from `Har.record`. All three read the same network model.
  - To wait for something that may already have happened, use `Expect.poll` on `history`.
- **Logs are bounded** by `ContextOptions.eventLog` (attached pages use the default), as Playwright's `page.consoleMessages()` and `requests()` are. Entries never decay: metadata is copied, without bodies, and handles live as long as their owner.
- **Events report; handlers decide.** No event verb decides anything. Obligations are decided by scoped handlers: `page.route`, `Dialog.handle` and `FileChooser.handle`. A dialog blocks its page, so the click that opens one doesn't finish until it is decided, and the handler has to be registered first.
- **Events reveal resources; they don't acquire them.** A popup belongs to the scope that acquired its opener, and a download's file to its context, so `Popup.next` and `Popup.history` return the same handle with one lifetime. The `Scope` on `next` and `stream` holds only the subscription. Ownership follows the opener: popups of owned pages are owned, and popups of attached pages stay open.
- **Results outlive the subscription.** A captured response body is owned bytes, so it survives the subscription and even the page closing. A `Pending`'s deadline starts when it is awaited, not when it subscribes. If the owner (page or context) ends normally before a match, awaiting fails promptly with `TargetGone` rather than waiting for its deadline.
- **Event streams end** normally when their owner ends normally or the acquiring scope closes. They fail with `TargetGone` on an abnormal end, and with `EventOverflow` past their bound.

**State:**
- **Watching gives you the present, not the past.** `changes` starts with the current value and conflates, so intermediate stages can be skipped. To see transitions from the beginning, subscribe before the cause, or fork the consumer right after you get the handle.
- **Waits are level-triggered.** `waitFor` checks the current value and then the changes, so skipped stages don't matter.
- **The terminal state is data.** `changes` emits the terminal state (`Closed{reason}`, `Completed`, …) last and then ends. It doesn't fail, because the union already says why it ended.
- **Only state the model folds from protocol events is watchable.** Reads that need a round trip (DOM reads, `title`) stay plain `Effect`s rather than hiding a poll. An event log is not state: its changes are just the events again, and a level-triggered wait on it would match old events.

## Network

```ts
type RouteHandler<E, R> = (request: InterceptedRequest) => Effect<RouteDecision, E, R>   // E is logged; the default decision applies
interface InterceptedRequest {
  readonly request: NetworkRequest                       // fixed: the request as paused at this phase
  readonly fetch: Effect<FetchedResponse, RouteError>     // perform it, then patch the response
  fetchWith(overrides: RequestOverrides): Effect<FetchedResponse, RouteError>
}
declare const Route: {
  readonly continue: RouteDecision
  continueWith(overrides: RequestOverrides): RouteDecision
  fulfill(response: { status?: HttpStatus | number; headers?: Headers; body?: ResponseBody }): RouteDecision   // no body: empty
  readonly abort: RouteDecision
  abortWith(reason: AbortReason): RouteDecision
  readonly fallthrough: RouteDecision                    // next matching handler
}
declare const ResponseBody: {                           // exactly one kind of body
  json(value: unknown): ResponseBody
  text(text: string): ResponseBody
  bytes(data: Uint8Array, mimeType?: MimeType | string): ResponseBody
  file(path: LocalPath | string): ResponseBody
}
// HAR record and replay: Recordings, below
```

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
  // the browser-side file is deleted when its context closes, unless the backend's download policy keeps it; saveAs copies it out first
}

declare const StorageState: {
  import(bytes: Redacted<StorageStateBytes | Uint8Array>): Effect<StorageState, StorageStateError>   // accepts bytes read back from disk; validates either way
}
```

- **Default dialog policy.** It is explicit and has no delay. A context's `dialogs` option (`"dismiss"`, the default for owned contexts; `"accept"`; or `"leaveOpen"`) decides immediately when no handler claims a dialog. `beforeunload` is accepted under `"dismiss"`, so closing never hangs. On attached pages there is no default unless the caller sets one. Every automatic decision is an `AutoResolution` event and is recorded on the operation that was running.
- **Waiting on a dialog.** An operation blocked by a dialog that a handler or the policy is resolving waits within its deadline, normally just a round trip. Under `"leaveOpen"` it fails immediately with a hint naming the dialog.
- **Storage state.** `context.exportStorageState` returns the full restorable state as `Redacted<Uint8Array>`. Writing it somewhere is an explicit, visible step. Diagnostic JSON of a context never contains secrets.

## Page time

```ts
interface Clock {
  install(mode: { mode: "fixed"; at: DateInput } | { mode: "offset"; by: Duration.Input } | { mode: "controlled"; at?: DateInput }):
    Effect<Registration, DeclarationError, Scope>        // needs before-author-script timing
  readonly resume: Effect<void, ClockError>
  pauseAt(at: DateInput): Effect<void, ClockError>
  runFor(duration: Duration.Input): Effect<void, ClockError>       // fires every due timer in order
  fastForward(duration: Duration.Input): Effect<void, ClockError>  // jumps; due timers fire at most once
  setFixedTime(at: DateInput): Effect<void, ClockError>
}
```

- **One timeline per scope.** `page.clock` is a single timeline covering every document and frame of the page across navigations. Each operation is appended to a log that new documents replay, which is how Playwright's clock works. `context.clock` is the same thing, context-wide.
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
const button = snap.ref(id)                            // a Locator, never rebound; acting fails with StaleRef{reason} after navigation or document.open()

// One toolkit definition serves an in-process model, an MCP server and the CLI (CLI.md).
const toolkit = BrowserToolkit.make({
  page,
  secrets: { password: Redacted.make(env.PASSWORD) },  // the model sees %password%; substitution happens at dispatch
  capture: CapturePolicy.strict                        // what snapshots and screenshots may contain
})
// tools: navigate, snapshot, click(ref), fill(ref, text | %secret%), press, select, scroll, screenshot, back, wait, tabs
// tool parameters are Schemas, so a model's "e12" is decoded to a RefId before the handler runs
// each action returns ActionReport { dispatch, observed: { navigations, dialogs, popups, downloads,
//   dom: { _tag: "Changed" } | { _tag: "Unchanged" } | { _tag: "NotObserved" } } }
LanguageModel.generateText({ prompt, toolkit })
McpServer.toolkit(toolkit)
```

`observed` reports what was seen. It never claims "no effect"; if nothing was observed, the report says exactly that.

Snapshots:
- **Many sites aren't accessible.** Clickable `<div>`s have no role and icon buttons have no name, so the default `snapshot` adds two kinds of inferred information to the accessibility tree:
  - *inferred interactivity:* click listeners where the backend can list them, `cursor: pointer`, `tabindex`, `contenteditable`, `onclick`;
  - *inferred names:* visible text, `title`, `placeholder`, `alt`, a nearby label.
- **Every inference is tagged with its evidence** in both the value and the text, so a model or a reader can tell `button "Save"` from `clickable "Save" [inferred: cursorPointer]`.
- **`ariaSnapshot` is the pure accessibility tree,** used by `Expect.toMatchAriaSnapshot`.
- **Same node, same ref** within a document generation, so a renamed button keeps its ref.
- **Diffs are explicit** (`snapshot.diff(previous)`), never an automatic switch between full and delta output.
- **Visual-only UIs** (canvas, maps) need screenshots and coordinate actions. The toolkit offers those as an explicit tool set rather than a fallback.

## Recordings: traces and HAR

```ts
declare const Trace: {
  record(target: BrowserContext | Page): Effect<TraceRecording, TraceError, Scope>          // actions, logs, errors, console
  recordWith(target: BrowserContext | Page, options: {
    readonly screenshots?: "perAction" | "off"                                  // default "off"
    readonly screencast?: "native" | { readonly polled: Duration.Input } | "off" // BiDi has no native screencast; default "off"
    readonly domSnapshots?: boolean                                             // default false; needs control (below)
    readonly network?: boolean                                                  // HAR entries, so snapshots render with their resources
  }): Effect<TraceRecording, TraceError | Unsupported, Scope>
}
interface TraceRecording extends Registration {
  exportTrace(path: LocalPath | string): Effect<LocalPath, TraceError>         // a zip that Playwright's trace viewer opens
}

declare const Har: {
  record(target: BrowserContext | Page, options: {
    readonly content: "embed" | "attach" | "omit"        // required: never inferred from a file extension
    readonly detail?: "full" | "minimal"
    readonly url?: UrlPattern
    readonly webSocketFrames?: boolean                    // Unsupported on BiDi
    readonly inFlightAtStop?: "wait" | "markIncomplete"
  }): Effect<HarRecording, HarError | Unsupported, Scope>
  replay(source: HarArchive | LocalPath | string): (target: Page | BrowserContext) => Effect<HarReplay, HarError, Scope>
  replayWith(source: HarArchive | LocalPath | string, options: {
    readonly match?: HarMatch                             // default: exact URL, method and body, for any method
    readonly ambiguity?: "sequential" | "first" | "fail"  // default "sequential": identical requests replay in recorded order
    readonly redirects?: "replayHops" | "fulfillFinal"
    readonly incomplete?: "abort" | "skip"                // entries the recording never finished
    readonly notFound?: "abort" | "fallthrough"           // default "abort"
  }): (target: Page | BrowserContext) => Effect<HarReplay, HarError, Scope>
}
interface HarRecording extends Registration {
  readonly entries: Watchable<number>
  exportHar(path: LocalPath | string, options?: { readonly include?: ReadonlyArray<SecretClass> }): Effect<LocalPath, HarError>   // redacted unless included
}
interface HarReplay extends RouteRegistration { readonly misses: Watchable<number> }
```

- **Traces open in Playwright's trace viewer** (research/playwright-trace-format.md).
  - We write format version 9. The viewer rejects files newer than itself, and version 10 is unreleased.
  - Every public operation is already an `Effect.fn` span, so spans become the viewer's nested steps, and logs and errors become its log and error events.
  - Actions carry our own names, never Playwright's, because the viewer special-cases Playwright's names and assumes their selector syntax.
  - Timestamps come from a real monotonic clock, never Effect's `Clock`, so `TestClock` can't freeze them.
- **Levels are opt-in, and their costs are stated.**
  - Actions, logs, errors and console output are always recorded.
  - Screenshots and the screencast cost bandwidth. BiDi has no native screencast, so it is polled at the interval you choose.
  - DOM snapshots install Playwright's capture script in the page's main world, where it hooks CSSOM methods. That changes the page, so it needs control and never runs on attached or observed pages.
- **Exports are explicit and redacted.** Both files cross a persistence boundary (`export*`). Classified fields are stripped under the active diagnostics preset, and raw content (bodies, snapshots, screenshots) is included only when asked for.
- **HAR replay has one documented matching rule:** exact URL, method and body, for any method. Extra criteria are named matchers (`HarMatch.headers([...])`).
  - Nothing is scored, and no CORS headers are added. Repeated headers stay separate.
  - The archive is validated when opened; a bad archive fails with `HarError` instead of falling through to the network.
  - Entries the recording never finished follow `incomplete` instead of stalling.
  - There is no `update` mode: to re-record, use `Har.record`.
- **HAR recording** records requests as sent. Timings follow the HAR spec, and an entry without a body says why. On BiDi, the body collectors start when the recording scope is acquired (research/har.md).

## Testing

**Vitest first, ready for etest.** Everything a test needs is a Layer or a scoped Effect with a lifetime. Runner specifics sit behind one per-test service, `TestRun`. The Vitest adapter is the only runner code today. When `@effect/test` (etest) is ready, an etest adapter attaches the same Layers with `Test.provide` (research/effect-test-runner.md).

```ts
import { layer } from "@effect/vitest"
import { BrowserTest } from "effect-browser/test"
import { VitestBrowser } from "effect-browser/test/vitest"
import { Chromium } from "effect-browser/chromium"

layer(VitestBrowser.layer(Chromium.launch))("checkout", (it) => {
  it.effect("adds to cart", () =>
    Effect.gen(function* () {
      const page = yield* BrowserTest.page      // fresh context + page per test; closed after
      yield* page.goto("/shop")
      // …
    }))
})
```

```ts
// effect-browser/test: runner-agnostic
declare const BrowserTest: {
  browser<E, R>(backend: Layer<Browser, E, R>, options?: {
    readonly restart?: "onCrash" | "onFailure" | "never"  // default "onCrash"
  }): Layer<Browser, E, R>                                 // LaunchProfile.concurrent unless the backend sets a profile
  readonly page: Effect<Page, PageError, Browser | TestRun | Scope>
  pageWith(options: ContextOptions & { readonly trace?: "onFailure" | "always" | "off" }): Effect<Page, PageError, Browser | TestRun | Scope>
}
class TestRun extends Context.Service<TestRun, {          // per test, from the runner adapter
  readonly info: TestInfo                                  // project, file, id, attempt, worker, shard
  attach(artifact: TestArtifact): Effect<void>             // Vitest: recordArtifact; etest: attachments (proposed upstream)
  readonly check: Effect<void>                             // one Expect check; etest counts assertions (proposed upstream)
}>()("effect-browser/TestRun") {}

// effect-browser/test/vitest
declare const VitestBrowser: {
  layer<E, R>(backend: Layer<Browser, E, R>, options?: { readonly restart?: "onCrash" | "onFailure" | "never" }):
    Layer<Browser | TestRun, E, R>                         // BrowserTest.browser, plus TestRun from the current Vitest test
}
```

- **Defaults.** Each is visible and can be overridden:
  - a browser per layer block, which is about one per file under Vitest's default isolation;
  - a fresh context and page per test;
  - `LaunchProfile.concurrent`, `focus: "emulated"` and the `local` diagnostics preset;
  - restart `onCrash`;
  - traces kept on failure, where an interrupted test counts as failed;
  - a live deadline clock under `TestClock`.
- **Parallelism** (research/test-parallelism.md).
  - Files run in parallel across Vitest workers, each with its own browser. We recommend `maxWorkers: "50%"`.
  - Concurrent tests within a file are opt-in (`layer(…, { concurrent: true })`), and each one gets its own `TestClock`.
  - One browser for a whole run waits for etest's run-wide shared layers. Under Vitest, `Chromium.connect` to a browser you started yourself covers it.
  - Sharding belongs to the runner. `TestInfo` makes artifact names unique per shard, worker, test and attempt.
- **Contexts don't isolate everything.** Launch flags, the downloads directory, browser-wide commands, extensions, and OS focus, clipboard and GPU are shared. The library always scopes commands to the context it owns.
- **Artifacts.** Traces and HARs attach through `TestRun.attach`. Under Vitest that is `recordArtifact`, with `effect-browser:trace` and `effect-browser:har` artifact types.
- **No fixture magic.** Everything is a `Layer`, and dependencies are tracked in `R`.

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
  yield* page.getByLabel("Password").fill(Redacted.make(env.PASSWORD))
  yield* page.getByRole("button", { name: "Sign in" }).click
  yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
  return yield* page.context.exportStorageState
}))
const page = yield* browser.newPageWith({ storageState: yield* StorageState.import(state) })

// 2. Click, then wait for a named outcome
const orders = yield* PageNavigation.next(page, { url: "**/orders" })   // subscribed before the click
yield* page.getByRole("link", { name: "Orders" }).click
const nav = yield* orders

// 3. Popup with a dialog inside it
const popups = yield* Popup.next(page)
yield* page.getByText("Connect account").click
const popup = yield* popups                              // a Page, owned by the scope that acquired `page`
yield* Dialog.handle(popup, Dialog.acceptAll)            // a dialog blocks its page, so the decision is registered first
yield* popup.getByRole("button", { name: "Allow" }).click

// 4 + 9. Response body, decoded and filtered
const added = yield* NetworkResponse.next(page, { url: "**/api/cart", method: "POST", body: Body.json(Cart),
  where: (r) => Effect.succeed(r.body.items.length > 0) })
yield* page.getByRole("button", { name: "Add to cart" }).click
const res = yield* added                                 // CapturedResponse<Cart>

// 5. Download
const download = yield* Download.next(page)
yield* page.getByText("Export CSV").click
const file = yield* download
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
yield* page.clock.runFor("5 minutes")
yield* page.getByText("Session expired").pipe(Expect.toBeVisible)

// 11. Ordered setup scripts
const helper = yield* page.addInitScript(installTestHooks)
yield* page.addInitScript(useTestHooks, { after: [helper] })   // dependencies only on equal or broader scope

// 12. Operational failures stay typed and evidenced; timeouts are cross-cutting
yield* page.locator("button[").click.pipe(              // invalid selector: immediate, no waiting
  Effect.catchReason("ActionError", "InvalidSelector", (e) => Console.log(e.message)))
yield* page.getByRole("button", { name: "Pay" }).click.pipe(Browser.withTimeout("5 seconds"))

// 13. One action, several outcomes, collected later
const checkout = yield* Popup.next(page)
const order = yield* NetworkResponse.next(page, { url: "**/api/order" })
yield* page.getByRole("button", { name: "Pay" }).click
const [tab, placed] = yield* Effect.all([checkout, order])   // each latched, even if it arrived during the click

// 14. Watch state while doing other work
const pdf = yield* Download.next(page)
yield* page.getByText("Export PDF").click
const report = yield* pdf
yield* report.status.changes.pipe(Stream.runForEach(renderProgress), Effect.forkScoped)   // fork first: watching shows the present
yield* page.status.waitFor((s) => s._tag === "Open" && s.document.readiness === "complete")
yield* report.finished

// 15. What already happened: reads, not subscriptions
const errors = yield* UncaughtException.history(page)   // EventLog: entries, oldest first, and how many were dropped
const carts = yield* NetworkResponse.history(page, { url: "**/api/cart" })   // metadata only, never bodies
```

## Open questions

1. **How the Vitest adapter finds the current test.** @effect/vitest passes Vitest's test context to `it.effect` as an argument, not as a service, so `VitestBrowser.layer` can't read it from the environment. Recommendation: propose that @effect/vitest provide it as a service in every `it.effect`. Until then, tests pass it explicitly.

Decided:
- **The fake browser** stays internal first. Once stable, it becomes a narrow `effect-browser/testing` subpath for event- and lifecycle-level scenarios. It doesn't emulate a DOM: actions against fake pages fail with `Unsupported`.
- **No Vitest reporter plugin.** The library stays runner-agnostic, and flakiness is classified from `test.retry` / `test.outcome` span attributes and `TestInfo`.
- **Testing ships for Vitest first, behind `TestRun`,** so that moving to etest is a new adapter, not a redesign (revision 5.18).
