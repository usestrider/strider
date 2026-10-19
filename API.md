# API: the ergonomic layer (L2)

*Revision 5.2, 2026-10-18. These are sketches: names and signatures are provisional, nothing is implemented, and the types show shape rather than compile-verified code. Every behavior here must be expressible in [CONCEPTS.md](CONCEPTS.md).*

## Purpose

This layer is what users write. It turns the native model into a small vocabulary of browsers, contexts, pages, locators, actions, expectations and observations, with the following properties:

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
  - **What it covers:** contexts, pages, access upgrades, popups, downloads, handles, capability handles and every declaration (routes, dialog handlers, init scripts, overrides, clocks). Each is acquired into the caller's `Scope` and released when that scope closes.
  - **What doesn't need it:** values with no remote lifetime (locators, snapshots, captured bodies, storage-state bytes).
  - **Early release** (`page.close`) is always possible; the finalizer then does nothing.
- **Handles get members; decorators are dual combinators.** `Expect.*` and `Browser.with*` work both data-first and in `pipe`. Event observations are applied to a trigger the same way: `click.pipe(page.events.popup)`.
- **State is a `Watchable`; events are an `Observation`** (see State and events). State can be read at any time and waited on safely. Events must be subscribed to before their cause, and the API makes that subscription explicit.
- **No public fibers, no writable `Deferred`s or `Ref`s.** The library never forks on the caller's behalf and never returns a `Fiber`. Callers fork their own consumers with `Effect.forkScoped`. Internally, `Deferred`s latch results and `SubscriptionRef`s hold state, but only read-only views cross the API.
- **No platform services at call sites.** Platform services appear only in the launch and connect layers, so `Scope` is the only requirement an ordinary call site can see.
- **Immutable by default; mutable state is read through an `Effect`.** Handles, locators, snapshots, events and errors are immutable values. Anything that can change is never a plain field: `page.url`, `page.title`, `browser.capabilities`, page lists, and whether a handle still holds its access. Such reads are `Effect`s, evaluated when they run, so they can't go stale in a variable. Changes arrive on `events` streams. Internally this state lives in a `SubscriptionRef` (CONCEPTS.md §2), which the public API never exposes for writing. Mutability is avoided wherever an immutable value can do.
- **Plain fields on live handles must be fixed, and say why.** A live handle (browser, context, page, frame, download, intercepted request) may expose a plain field only if the value can't change for the handle's lifetime. Each such field carries a one-line justification. Ids, `closed`, event streams and sub-handles bound to their parent (`keyboard`, `mouse`, `clock`, whose own state is again read through `Effect`s) are exempt by construction. A field that can't be justified becomes an `Effect`. Immutable values (snapshots, locators, navigations, dialogs) are exempt entirely.
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
  | `read*`, `is*`, nouns | one-shot read; no waiting, no retry | `readText`, `isVisible`, `title`, `count` |
  | `Watchable` members | state: read now, watch, `waitFor` | `status`, `url`, `download.status` |
  | `Expect.to*` | retries until the deadline | `Expect.toHaveText` |
  | `events.*` | an `Observation` of something caused | `page.events.response(…)` |
  | `on*` | a scoped handler registration | `onDialog` |
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
- **One way to do each thing.** No aliases, and no parallel mechanisms for the same job (that is why `withPage` went away). A convenience is allowed only where it is the dominant call site and is documented as its expansion: `page.url` is `page.status.map(…)`, `download.finished` is `status.waitFor(…)`, and `browser.newPage` is `newContext` followed by `newPage`.

## Top data models

```ts
interface ObservedPage {                                // state and events only
  readonly id: NavigableId
  readonly status: Watchable<PageStatus>                 // one consistent snapshot; ends with Closed{reason}
  readonly url: Watchable<Url>                           // status.map(…): derived from the same source
  readonly frames: Watchable<FrameTree>
  readonly closed: Effect<CloseReason>                  // lifetime signal: waits as long as the page lives
  readonly events: ObservedPageEvents                   // ReadonlyPage and Page narrow this to ReadonlyPageEvents / PageEvents
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

type Navigation =                                       // success value of goto/reload/back/forward
  | { readonly _tag: "Committed"; readonly id: NavigationId; readonly document: DocumentId
      readonly response: Option<ResponseSnapshot> }      // 404/500 is still a commit; None for about:blank, data:, …
  | { readonly _tag: "SameDocument"; readonly id: NavigationId; readonly document: DocumentId
      readonly via: "fragment" | "historyApi" | "intercepted" }
  | { readonly _tag: "Restored"; readonly id: NavigationId; readonly document: DocumentId }   // back/forward cache
  | { readonly _tag: "Activated"; readonly id: NavigationId; readonly document: DocumentId }  // prerender

interface ResponseSnapshot {                            // immutable; one redirect hop
  readonly hop: RequestHopId
  readonly url: Url
  readonly status: HttpStatus
  readonly headers: Headers                             // keyed by HeaderName; classified values arrive as Redacted
}
interface CapturedResponse<B> extends ResponseSnapshot { readonly body: B }

interface AriaSnapshot {                                // for agents and structural assertions
  readonly document: DocumentId
  readonly generation: DocumentGeneration
  readonly text: string                                 // YAML-like tree with [ref=eN]
  ref(id: RefId): Effect<Locator, StaleRef>            // StaleRef{reason} if the ref is from another snapshot, or the document or generation moved on
  readonly refs: ReadonlyMap<RefId, RefSummary>        // role, name and state for each ref, already branded
}
```

`Page`, `Locator`, `Navigation` and the other model handles are `Equal`/`Hash` by identity (CONCEPTS.md §1). A `ReadonlyPage` and a `Page` for the same tab are equal, because identity is the tab and not the access level.

## Modules and backends

One package with subpath exports and a single version, the same model Effect v4 uses. Backends are imports, not option values, so only the protocol code you import is loaded:

```ts
import { Browser, Expect } from "effect-browser"          // API types, services, combinators
import { Chromium } from "effect-browser/chromium"        // CDP backend
import { Firefox } from "effect-browser/firefox"          // BiDi backend
import { WebKit } from "effect-browser/webkit"            // Playwright-patched builds; stock attach (iOS, WKWebView)
import { Bidi } from "effect-browser/bidi"                // any BiDi endpoint (Safari Technology Preview, remote grids)
import { BrowserTest } from "effect-browser/test"         // peer dependency: @effect/vitest
import { BrowserToolkit } from "effect-browser/ai"        // builds on effect/ai
import * as Cdp from "effect-browser/cdp"                 // raw generated L0 commands, for power users

declare const Chromium: {
  readonly launch: Layer<Browser, LaunchError, ChildProcessSpawner>        // headless Chrome for Testing
  launchWith(options: {
    readonly headless?: boolean
    readonly channel?: "stable" | "beta" | "canary"
    readonly executablePath?: LocalPath | string
    readonly args?: ReadonlyArray<string>
  }): Layer<Browser, LaunchError, ChildProcessSpawner>
  connect(endpoint: Url | string, options?: { readonly headers?: Record<string, Redacted<string> | string> }):
    Layer<Browser, ConnectError, WebSocketConstructor>
}
// Firefox.launch / launchWith; WebKit.launch / launchWith / attach(endpoint); Bidi.connect(endpoint): same shape

program.pipe(Effect.provide(Chromium.launch))
```

- **No platform packages of our own.** Launching needs only Effect's `ChildProcessSpawner` and `WebSocketConstructor` services, which `@effect/platform-node` and `@effect/platform-bun` provide.
- **Backend layers can carry their known capabilities in their types,** so specialized features need no `Unsupported` case when the backend is chosen in code (P7). The mechanism is to be settled when the sketches are compiled: a capability-typed `Browser` service, or backend-specific accessors.
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
  readonly viewport?: { width: CssPixels | number; height: CssPixels | number }   // CSS pixels by definition
  readonly locale?: Locale | string
  readonly timezone?: TimeZoneId | string
  readonly permissions?: ReadonlyArray<Permission>
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
  readonly snapshot: Effect<AriaSnapshot, ReadError>     // with refs, for agents
  snapshotWith(options: { mode: "ai" | "full"; root?: ReadonlyLocator }): Effect<AriaSnapshot, ReadError>
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
    Effect<Navigation, NavigationError | TargetGone | Timeout>
  readonly reload: Effect<Navigation, NavigationError | TargetGone | Timeout>
  reloadWith(options: { waitUntil?: LoadState }): Effect<Navigation, NavigationError | TargetGone | Timeout>
  readonly back: Effect<Option<Navigation>, NavigationError | TargetGone | Timeout>    // None: no history entry
  backWith(options: { waitUntil?: LoadState }): Effect<Option<Navigation>, NavigationError | TargetGone | Timeout>
  readonly forward: Effect<Option<Navigation>, NavigationError | TargetGone | Timeout>
  forwardWith(options: { waitUntil?: LoadState }): Effect<Option<Navigation>, NavigationError | TargetGone | Timeout>
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
  onDialog<E, R>(handler: (dialog: Dialog) => Effect<DialogDecision, E, R>): Effect<HandlerRegistration, DeclarationError, Scope | R>
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
- **Declarations are scoped registrations.** `route`, `onDialog`, `addInitScript` and `emulate` are removed when the caller's scope closes. In `@effect/vitest`'s `it.effect` that scope is already present; elsewhere, use `Effect.scoped`.

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
  readonly snapshot: Effect<AriaSnapshot, ReadError>
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
  readonly checks?: Partial<Record<"visible" | "stable" | "enabled" | "notInert" | "inViewport" | "receivesPointer", boolean>>
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
- **Strictness.** An action needs exactly one match. A *stable* ambiguity (the same candidates across the sampling window) fails early with `ActionError{reason: StrictViolation{candidates, suggestions}}`. A *transient* ambiguity, such as a fading toast, is retried until the deadline.
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
}
declare const Cond: {
  not<A>(c: Condition<A>): Condition<A>                  // the wait is for the negation, and it passes when the element is missing
  and<A>(...cs: ReadonlyArray<Condition<A>>): Condition<A>   // evaluated against one observation
  because<A>(why: string): (c: Condition<A>) => Condition<A>
}
```

- **How expectations evaluate.** One check runs immediately, then re-checks on a backoff schedule plus DOM-change invalidations, all within the deadline (`Browser.withTimeout` adjusts it). `Expect.that` also accepts a `Watchable`, which re-checks when the value changes instead of polling.
- **What failure contains.** `ExpectationFailed{subject, condition, last, history, elapsed}`. `history` is the de-duplicated sequence of observed values with timestamps, which answers "was it ever right?". When nothing matched, the error adds an accessibility snapshot of the nearest existing ancestor and suggested locators.

## State and events

Two kinds of things change over time, and they get different types on purpose. RxJS draws the same line (`BehaviorSubject` vs hot `Subject`), and so does the industry's move to signals for state and streams for events.

| | State | Events |
|---|---|---|
| Examples | page status and URL, frame tree, download progress, page lists, capabilities | responses, requests, navigations, popups, dialogs, downloads, console messages |
| Type | `Watchable<A>` | `Observation<A, E, R>` |
| Late subscriber gets | the current value, so nothing that matters is missed | nothing from before it subscribed, so subscribing is explicit and eager |
| Slow consumer gets | the latest value (conflated) | every match, losslessly, up to a bound (`EventOverflow`) |

```ts
interface Watchable<A> extends Effect<A> {               // yield* reads the current value
  readonly changes: Stream<A>                            // current value first, then each distinct change; ends after the terminal state
  waitFor<B extends A>(refinement: Refinement<A, B>): Effect<B, Timeout | TargetGone>   // level-triggered, under the deadline
  waitFor(predicate: Predicate<A>): Effect<A, Timeout | TargetGone>
  map<B>(f: (a: A) => B): Watchable<B>                   // derived from the same source, so never glitchy
}

interface Observation<A, E = never, R = never> {
  // 1. around a trigger: the first match, plus the trigger's own result
  <X, TE, TR>(trigger: Effect<X, TE, TR>): Effect<readonly [X, A], TE | E | TargetGone | Timeout, TR | R>
  // 2. arm now, await later: the first match is latched
  readonly pending: Effect<Pending<A, E>, ObserveError, Scope | R>
  // 3. every match from now on: subscribed before this effect returns
  readonly stream: Effect<Stream<A, E | EventOverflow>, ObserveError, Scope | R>
}
interface Pending<A, E = never> extends Effect<A, E | TargetGone | Timeout> {   // yield* awaits, under the deadline of the await
  readonly poll: Effect<Option<Exit<A, E | TargetGone | Timeout>>>
}

interface ObservedPageEvents {                            // observe: protocol events only; nothing injected, nothing decided
  response(filter: {
    readonly url: UrlPattern                              // required: "any response" as a first match is a footgun
    readonly method?: HttpMethod | string
    readonly status?: HttpStatus | number | ((status: HttpStatus) => boolean)
  }): Observation<ResponseSnapshot, ResponseError>        // metadata only; bodies need inspect
  request(filter: RequestFilter): Observation<RequestSnapshot, ObserveError>
  readonly requests: Observation<RequestSnapshot>         // every request: for logging
  readonly navigation: Observation<Navigation, NavigationError>
  navigationWith(options: { url?: UrlPattern; waitUntil?: LoadState }): Observation<Navigation, NavigationError>
  readonly popup: Observation<ObservedPage, ObserveError, Scope>   // popups of pages we don't control are only observed
  popupWith(options: { url?: UrlPattern }): Observation<ObservedPage, ObserveError, Scope>
  readonly console: Observation<ConsoleMessage>
  readonly pageErrors: Observation<PageErrorEvent>
}
interface ReadonlyPageEvents extends ObservedPageEvents { // inspect: adds bodies, which need collection set up
  response<B = Uint8Array, PE = never, PR = never>(filter: {
    readonly url: UrlPattern
    readonly method?: HttpMethod | string
    readonly status?: HttpStatus | number | ((status: HttpStatus) => boolean)
    readonly body?: BodyDecoder<B>                        // Body.json(schema), Body.text, Body.bytes; collection is automatic
    readonly where?: (response: CapturedResponse<B>) => Effect<boolean, PE, PR>   // runs off the ingestion path
  }): Observation<CapturedResponse<B>, PE | ResponseError, PR>
}
interface PageEvents extends ReadonlyPageEvents {         // control: adds what acquires or decides
  readonly popup: Observation<Page, ObserveError, Scope>  // narrower: a controlled page's popups are controlled, owned if it is
  popupWith(options: { url?: UrlPattern }): Observation<Page, ObserveError, Scope>
  readonly download: Observation<Download, ObserveError, Scope>
  dialog<DE, DR>(handler: (dialog: Dialog) => Effect<DialogDecision, DE, DR>): Observation<Dialog, DE | ObserveError, DR>
  fileChooser(files: FileInput | ReadonlyArray<FileInput>): Observation<void, ObserveError>
  readonly autoResolutions: Observation<AutoResolution>   // dialogs and paused requests decided by a default policy
}
// Observations only produce values, so the narrower types in PageEvents are valid overrides and Page stays a ReadonlyPage.
```

**Events:**
- **Every event observation is eager.** `.pending` and `.stream` are subscribed by the time their effect returns, and the trigger form subscribes before it runs the trigger. Filters apply before buffering, so unrelated traffic can't overflow a subscription.
- **Completing around a trigger.** Both the trigger and the first match must complete, and a trigger failure is never discarded. If the owner (page or context) ends normally before a match, the observation fails promptly with `TargetGone` rather than waiting for its deadline.
- **Results outlive the observation.** A captured response body is owned bytes, so it survives the observation and even the page closing. A `Pending`'s deadline starts when it is awaited, not when it is armed.
- **Event streams end** normally when their owner ends normally or the acquiring scope closes. They fail with `TargetGone` on an abnormal end, and with `EventOverflow` past their bound.
- **Popups.** A popup from `page.events.popup` is acquired into the caller's `Scope`. A popup nobody asked for is released with the scope that acquired its opener. Ownership follows the opener: popups of owned pages are owned, and popups of attached pages stay open.

**State:**
- **Watching gives you the present, not the past.** `changes` starts with the current value and conflates, so intermediate stages can be skipped. To see transitions from the beginning, subscribe before the cause, or fork the consumer right after you get the handle.
- **Waits are level-triggered.** `waitFor` checks the current value and then the changes, so skipped stages don't matter.
- **The terminal state is data.** `changes` emits the terminal state (`Closed{reason}`, `Completed`, …) last and then ends. It doesn't fail, because the union already says why it ended.
- **Only state the model folds from protocol events is watchable.** Reads that need a round trip (DOM reads, `title`) stay plain `Effect`s rather than hiding a poll.

## Network

```ts
type RouteHandler<E, R> = (request: InterceptedRequest) => Effect<RouteDecision, E, R>   // E is logged; the default decision applies
interface InterceptedRequest {
  readonly request: RequestSnapshot                      // fixed: the request as paused at this phase
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
declare const Har: {
  replay(path: LocalPath | string, options?: { notFound?: "fallthrough" | "abort"; update?: boolean }):
    (target: Page | BrowserContext) => Effect<RouteRegistration, RouteError, Scope>
}
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
declare const Dialog: {                                  // ready-made handlers; match on _tag for anything finer
  readonly acceptAll: (dialog: Dialog) => Effect<DialogDecision>    // Alert/Confirm/Prompt: accept; BeforeUnload: leave
  readonly dismissAll: (dialog: Dialog) => Effect<DialogDecision>   // Alert: accept; Confirm/Prompt: dismiss; BeforeUnload: stay
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
  // the browser-side file is deleted when the acquiring scope closes, unless the backend's download policy keeps it
}

declare const StorageState: {
  import(bytes: Redacted<StorageStateBytes | Uint8Array>): Effect<StorageState, StorageStateError>   // accepts bytes read back from disk; validates either way
}
```

- **Default dialog policy.** On owned pages, dialogs are dismissed after a short grace period, except `beforeunload`, which is accepted. On attached pages there is no default unless the caller opts in. Every automatic decision is published on `page.events.autoResolutions` and recorded on the operation that was running.
- **Waiting on a dialog.** An operation blocked by a dialog that is about to be resolved waits within its deadline; it does not fail immediately.
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
const snap = yield* page.snapshot                      // interactive elements get [ref=eN]; refs bound to document + generation
const [id] = snap.refs.keys()                          // RefIds come from the snapshot, already branded
const button = yield* snap.ref(id)                     // Locator; fails with StaleRef{reason} after navigation or document.open()

// One toolkit definition serves an in-process model, an MCP server and a CLI.
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

## Testing

```ts
import { layer } from "@effect/vitest"
import { BrowserTest } from "effect-browser/test"
import { Chromium } from "effect-browser/chromium"

layer(BrowserTest.layer(Chromium.launch))("checkout", (it) => {
  it.effect("adds to cart", () =>
    Effect.gen(function* () {
      const page = yield* BrowserTest.page      // fresh context + page per test; closed after
      yield* page.goto("/shop")
      // …
    }))
})
```

`BrowserTest.layer(backend)` wraps any backend layer (`Chromium.launch`, `Firefox.launchWith(…)`, …) and provides:

- a browser shared by the suite;
- a fresh context and page per test;
- a live deadline clock under `TestClock`;
- the `local` diagnostics preset;
- traces and screenshots retained on failure, through finalizers that see the `Exit`;
- a `TestInfo` service.

There is no fixture magic: everything is a `Layer`, and dependencies are tracked in `R`.

## Errors as users see them

```ts
class TargetGone extends Schema.TaggedError<TargetGone>()("TargetGone", {
  target: TargetDescription, reason: CloseReason, diagnostics: Diagnostics }) {}
class Timeout extends Schema.TaggedError<Timeout>()("Timeout", {
  operation: Schema.String,
  phase: Schema.Literals(["resolving", "waitingForCondition", "dispatchedUnconfirmed", "postcondition"]),
  last: Schema.Option(Observation), history: Schema.Array(Observation), diagnostics: Diagnostics }) {}
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
const [, nav] = yield* page.getByRole("link", { name: "Orders" }).click.pipe(
  page.events.navigationWith({ url: "**/orders" }))

// 3. Popup with a dialog inside it
const [, popup] = yield* page.getByText("Connect account").click.pipe(page.events.popup)
yield* popup.getByRole("button", { name: "Allow" }).click.pipe(popup.events.dialog(Dialog.acceptAll))

// 4 + 9. Response body, decoded and filtered, without ordering subscriptions by hand
const [, res] = yield* page.getByRole("button", { name: "Add to cart" }).click.pipe(
  page.events.response({ url: "**/api/cart", method: "POST", body: Body.json(Cart),
    where: (r) => Effect.succeed(r.body.items.length > 0) }))

// 5. Download
const [, file] = yield* page.getByText("Export CSV").click.pipe(page.events.download)
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
const requests = yield* page.events.requests.stream     // subscribed now, so nothing is missed
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

// 13. Arm now, collect later, across several steps
const cart = yield* page.events.response({ url: "**/api/cart" }).pending
yield* page.getByRole("button", { name: "Add to cart" }).click
yield* page.getByRole("button", { name: "Checkout" }).click
const placed = yield* cart                               // latched, even if it arrived during the clicks

// 14. Watch state while doing other work
const [, report] = yield* page.getByText("Export PDF").click.pipe(page.events.download)
yield* report.status.changes.pipe(Stream.runForEach(renderProgress), Effect.forkScoped)   // fork first: watching shows the present
yield* page.status.waitFor((s) => s._tag === "Open" && s.document.readiness === "complete")
yield* report.finished
```

## Open questions

1. **The ambiguity window.** What is the default stable-ambiguity window: about one second, or a number of rendering samples?
2. **The AI snapshot format.** Adopt Playwright's YAML-like aria snapshot as-is, or define our own with diffs?
3. **A fake browser for users.** Should the timeline-scripted fake browser (PROBES.md) be exposed for testing automation logic without a real browser, or stay internal?
4. **A runner plugin.** Is a Vitest reporter needed for flaky-test classification, or do spans suffice?
