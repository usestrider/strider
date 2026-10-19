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
- **Handles get members; decorators are dual combinators.** `Observe.*`, `Expect.*` and `Browser.with*` work both data-first and in `pipe`.
- **No platform services at call sites.** Platform services appear only in the launch and connect layers, so `Scope` is the only requirement an ordinary call site can see.
- **Immutable by default; mutable state is read through an `Effect`.** Handles, locators, snapshots, events and errors are immutable values. Anything that can change is never a plain field: `page.url`, `page.title`, `browser.capabilities`, page lists, and whether a handle still holds its access. Such reads are `Effect`s, evaluated when they run, so they can't go stale in a variable. Changes arrive on `events` streams. Internally this state lives in a `SubscriptionRef` (CONCEPTS.md §2), which the public API never exposes for writing. Mutability is avoided wherever an immutable value can do.
- **Plain fields on live handles must be fixed, and say why.** A live handle (browser, context, page, frame, download, intercepted request) may expose a plain field only if the value can't change for the handle's lifetime. Each such field carries a one-line justification. Ids, `closed`, event streams and sub-handles bound to their parent (`keyboard`, `mouse`, `clock`, whose own state is again read through `Effect`s) are exempt by construction. A field that can't be justified becomes an `Effect`. Immutable values (snapshots, locators, navigations, dialogs) are exempt entirely.
- **Brand liberally.** Every id and every meaningful string or number is a branded type (CONCEPTS.md §1): `Url`, `UrlPattern`, `HttpStatus`, `HeaderName`, `LocalPath`/`RemotePath`, `CssPixels`/`DevicePixels`, `Locale`, `RefId`, …
  - **Outputs** are always branded.
  - **Inputs** require the brand where two meanings could be confused at one call site: local vs remote paths (`File.local` / `File.remote`), CSS vs device pixels.
  - **Elsewhere, inputs accept a plain string** when the member name already fixes its meaning (`goto(url)`, `route(pattern)`). The string is parsed at the boundary, and a bad one fails immediately with an invalid-input reason, never by waiting.
- **Locators are values,** resolved again on every attempt.
- **Snapshots are named `read*`.** Retrying assertions take locators.
- **Access is typed.** `ObservedPage` ⊂ `ReadonlyPage` ⊂ `Page`, like `ReadonlyArray` and `Array`. A helper that only reads takes `ReadonlyPage`, and a `Page` is accepted. Calling an action on a page you may only inspect is a compile error, and autocomplete doesn't offer it.
- **Long, explicit names are fine.** `BrowserContext` avoids a clash with Effect's `Context`.

## Top data models

```ts
interface ObservedPage {                                // events only
  readonly id: NavigableId
  readonly url: Effect<string>
  readonly closed: Effect<CloseReason>                  // completes when the page's lifetime ends
  readonly events: PageEvents                           // navigations, requests, console, dialogs, popups, downloads
  readonly inspect: Effect<ReadonlyPage, PageError, Scope>   // installs the utility world; page stays open
  readonly control: Effect<Page, PageError, Scope>           // access lasts for the scope; page stays open
}
interface ReadonlyPage extends ObservedPage { /* locators, reads, snapshots, screenshots — see Pages */ }
interface Page extends ReadonlyPage { /* input, navigation, main-world evaluation, declarations */ }

interface Navigation {                                  // success value of goto/reload/back/forward
  readonly id: NavigationId
  readonly document: DocumentId
  readonly response: Option<ResponseSnapshot>           // 404/500 is still a successful commit
  readonly kind: "committed" | "sameDocument" | "restored" | "activated"
}

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
  ref(id: RefId | string): Effect<Locator, StaleRef>   // strings from model output are parsed; StaleRef{reason} once the document or generation moves on
}
```

`Page`, `Locator`, `Navigation` and the other model handles are `Equal`/`Hash` by identity (CONCEPTS.md §1). A `ReadonlyPage` and a `Page` for the same tab are equal, because identity is the tab and not the access level.

## Entry points and cross-cutting settings

```ts
class Browser extends Context.Service<Browser, BrowserHandle>()("effect-browser/Browser") {
  static readonly launch: Layer<Browser, LaunchError, ChildProcessSpawner>           // headless Chromium
  static launchWith(options: {
    readonly backend?: "chromium" | "firefox" | "webkit"
    readonly headless?: boolean
    readonly executablePath?: string
    readonly args?: ReadonlyArray<string>
  }): Layer<Browser, LaunchError, ChildProcessSpawner>
  static connect(endpoint: string, options?: {
    readonly headers?: Record<string, Redacted<string> | string>
  }): Layer<Browser, ConnectError, WebSocketConstructor>

  // dual combinators over any effect
  static withTimeout: Dual<Duration.Input>            // one budget for everything inside; nested operations share it
  static withDefaultTimeout: Dual<Duration.Input>     // default budget per operation inside
  static withDiagnostics: Dual<"local" | "strict">
}
// Dual<X> = { (x: X): <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, R>; <A, E, R>(self: Effect<A, E, R>, x: X): Effect<A, E, R> }

interface BrowserHandle {
  readonly info: BackendInfo                                                         // fixed for the connection
  readonly capabilities: Effect<CapabilitySet>                                       // refined as probes complete
  readonly newContext: Effect<BrowserContext, ContextError, Scope>                   // owned; removed when the scope closes
  newContextWith(options: ContextOptions): Effect<BrowserContext, ContextError, Scope>
  readonly newPage: Effect<Page, PageError, Scope>                                   // a fresh context + page, released together
  newPageWith(options: ContextOptions): Effect<Page, PageError, Scope>
  readonly pages: Effect<ReadonlyArray<ObservedPage>>                                // attach mode: what already exists
  readonly defaultContext: ObservedContext                                           // fixed: exists for the whole connection
}

interface BrowserContext {
  readonly newPage: Effect<Page, PageError, Scope>       // closed with its unsolicited popups when the scope closes
  readonly pages: Effect<ReadonlyArray<Page>>
  readonly exportStorageState: Effect<Redacted<Uint8Array>, StorageStateError>
  readonly clock: Clock                                  // context-wide timeline (opt-in)
  route<E, R>(pattern: UrlPattern, handler: RouteHandler<E, R>): Effect<void, RouteError, Scope | R>
  addInitScript(script: InitScriptSource, options?: InitScriptOptions): Effect<InitScript, DeclarationError, Scope>
  emulate(settings: Emulation): Effect<void, DeclarationError, Scope>
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
  screenshotWith(options: ScreenshotOptions): Effect<Uint8Array, CaptureError>
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
  route<E, R>(pattern: UrlPattern, handler: RouteHandler<E, R>): Effect<void, RouteError, Scope | R>
  onDialog<E, R>(handler: (dialog: Dialog) => Effect<DialogDecision, E, R>): Effect<void, DeclarationError, Scope | R>
  addInitScript(script: InitScriptSource, options?: InitScriptOptions): Effect<InitScript, DeclarationError, Scope>
  emulate(settings: Emulation): Effect<void, DeclarationError, Scope>
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

- **How expectations evaluate.** One check runs immediately, then re-checks on a backoff schedule plus DOM-change invalidations, all within the deadline (`Browser.withTimeout` adjusts it).
- **What failure contains.** `ExpectationFailed{subject, condition, last, history, elapsed}`. `history` is the de-duplicated sequence of observed values with timestamps, which answers "was it ever right?". When nothing matched, the error adds an accessibility snapshot of the nearest existing ancestor and suggested locators.

## Observation combinators

Every "wait for X caused by Y" is a combinator that decorates the trigger. It subscribes, and installs any collectors and handlers, *before* the trigger runs. It returns the trigger's own value alongside the observation, and preserves the trigger's `E` and `R`.

```ts
declare const Observe: {
  // no arguments: the combinator itself
  popup: <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, Page], E | ObserveError | TargetGone | Timeout, R | Scope>
  download: <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, Download], E | ObserveError | TargetGone | Timeout, R | Scope>
  navigation: <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, Navigation], E | NavigationError | TargetGone | Timeout, R>
  // optional configuration
  popupWith(options: { url?: UrlPattern }): typeof Observe.popup
  navigationWith(options: { url?: UrlPattern; waitUntil?: LoadState }): typeof Observe.navigation
  // required arguments: a filter is mandatory, since "any response" is a footgun
  response<B = Uint8Array, PE = never, PR = never>(filter: {
    readonly url: UrlPattern
    readonly method?: string
    readonly status?: HttpStatus | number | ((status: HttpStatus) => boolean)
    readonly body?: BodyDecoder<B>                       // Body.json(schema), Body.text, Body.bytes; collection is automatic
    readonly where?: (response: CapturedResponse<B>) => Effect<boolean, PE, PR>   // runs off the ingestion path
  }): <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, CapturedResponse<B>], E | PE | ResponseError | TargetGone | Timeout, R | PR>
  request(filter: RequestFilter): <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, RequestSnapshot], E | ObserveError | TargetGone | Timeout, R>
  dialog<DE, DR>(handler: (dialog: Dialog) => Effect<DialogDecision, DE, DR>): <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, Dialog], E | DE | ObserveError | TargetGone | Timeout, R | DR>   // handler runs while the trigger runs
  fileChooser(files: FileInput | ReadonlyArray<FileInput>): <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, void], E | ObserveError | TargetGone | Timeout, R>
}
// combinators with arguments also have a data-first overload: Observe.response(trigger, filter)
```

- **Completion rule.** Both the trigger and the observation must complete. A trigger failure is never discarded.
- **When the owner ends first.** If the owner (page or context) ends normally before a match, the combinator fails promptly with `TargetGone` rather than waiting for its deadline.
- **Results outlive the window.** A captured response body is owned bytes, so it survives the observation window and even the page closing.
- **Popups.** A popup returned by `Observe.popup` is acquired into the caller's `Scope`. A popup nobody asked for is released with the scope that acquired its opener. Ownership follows the opener: popups of owned pages are owned, popups of attached pages stay open.

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
  fulfill(response: { status?: HttpStatus | number; headers?: Headers; body?: Uint8Array | string; json?: unknown }): RouteDecision
  readonly abort: RouteDecision
  abortWith(reason: AbortReason): RouteDecision
  readonly fallthrough: RouteDecision                    // next matching handler
}
declare const Har: {
  replay(path: LocalPath | string, options?: { notFound?: "fallthrough" | "abort"; update?: boolean }):
    (target: Page | BrowserContext) => Effect<void, RouteError, Scope>
}
```

- **The handler's return type is the obligation.** A handler that fails, is interrupted, or leaves its scope gets the default decision (continue). A paused request is never left hanging.
- **Order.** Handlers compose by precedence: most specific scope first, then priority, then recency.

## Dialogs, downloads, storage, permissions

```ts
interface Dialog {
  readonly kind: "alert" | "confirm" | "prompt" | "beforeunload"
  readonly message: string
  readonly default: Option<string>
}
declare const Dialog: {
  readonly accept: DialogDecision
  readonly dismiss: DialogDecision
  respond(text: string): DialogDecision                  // prompt() with an answer
}

interface Download {
  readonly url: Url                                      // fixed when the download begins
  readonly suggestedFilename: FileName                   // fixed when the download begins
  readonly done: Effect<void, DownloadError>
  readonly stream: Stream<Uint8Array, DownloadError>
  saveAs(path: LocalPath | string): Effect<void, DownloadError>   // always a local path; transfers from a remote browser where supported
  // the browser-side file is deleted when the acquiring scope closes, unless the backend's download policy keeps it
}

declare const StorageState: {
  import(bytes: Redacted<Uint8Array>): Effect<StorageState, StorageStateError>
}
```

- **Default dialog policy.** On owned pages, dialogs are dismissed after a short grace period, except `beforeunload`, which is accepted. On attached pages there is no default unless the caller opts in. Every automatic decision is published on `page.events.dialogs` and recorded on the operation that was running.
- **Waiting on a dialog.** An operation blocked by a dialog that is about to be resolved waits within its deadline; it does not fail immediately.
- **Storage state.** `context.exportStorageState` returns the full restorable state as `Redacted<Uint8Array>`. Writing it somewhere is an explicit, visible step. Diagnostic JSON of a context never contains secrets.

## Page time

```ts
interface Clock {
  install(mode: { mode: "fixed"; at: DateInput } | { mode: "offset"; by: Duration.Input } | { mode: "controlled"; at?: DateInput }):
    Effect<void, DeclarationError, Scope>                // needs before-author-script timing
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
browser.capabilities                       // Effect<CapabilitySet>: the current set, with evidence and limitations
```

Common members are on every backend. Specialized features are reached through a capability handle bound to *this* page, so a feature from one browser can't authorize an operation on another.

## Agents

```ts
const snap = yield* page.snapshot                      // interactive elements get [ref=eN]; refs bound to document + generation
const button = yield* snap.ref("e12")                  // Locator; fails with StaleRef{reason} after navigation or document.open()

// One toolkit definition serves an in-process model, an MCP server and a CLI.
const toolkit = BrowserToolkit.make({
  page,
  secrets: { password: Redacted.make(env.PASSWORD) },  // the model sees %password%; substitution happens at dispatch
  capture: CapturePolicy.strict                        // what snapshots and screenshots may contain
})
// tools: navigate, snapshot, click(ref), fill(ref, text | %secret%), press, select, scroll, screenshot, back, wait, tabs
// each action returns ActionReport { dispatch, observed: { navigations, dialogs, popups, downloads, domChanged } }
LanguageModel.generateText({ prompt, toolkit })
McpServer.toolkit(toolkit)
```

`observed` reports what was seen. It never claims "no effect"; if nothing was observed, the report says exactly that.

## Testing

```ts
import { layer } from "@effect/vitest"
import { BrowserTest } from "effect-browser/test"

layer(BrowserTest.chromium)("checkout", (it) => {
  it.effect("adds to cart", () =>
    Effect.gen(function* () {
      const page = yield* BrowserTest.page      // fresh context + page per test; closed after
      yield* page.goto("/shop")
      // …
    }))
})
```

`BrowserTest` layers (`chromium`, `firefox`, `webkit`, and `launchWith(options)`) provide:

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
  Observe.navigationWith({ url: "**/orders" }))

// 3. Popup with a dialog inside it
const [, popup] = yield* page.getByText("Connect account").click.pipe(Observe.popup)
yield* popup.getByRole("button", { name: "Allow" }).click.pipe(Observe.dialog(() => Effect.succeed(Dialog.accept)))

// 4 + 9. Response body, decoded and filtered, without ordering subscriptions by hand
const [, res] = yield* page.getByRole("button", { name: "Add to cart" }).click.pipe(
  Observe.response({ url: "**/api/cart", method: "POST", body: Body.json(Cart),
    where: (r) => Effect.succeed(r.body.items.length > 0) }))

// 5. Download
const [, file] = yield* page.getByText("Export CSV").click.pipe(Observe.download)
yield* file.saveAs("./export.csv")

// 6. Concurrent pages, settings isolated by context
yield* Effect.forEach(urls, (url) => Effect.scoped(Effect.gen(function* () {
  const p = yield* browser.newPageWith({ locale: "de-DE" })   // context + page released per URL
  yield* p.goto(url)
  return yield* p.title
})), { concurrency: 4 })

// 7. Attach, inspect one tab, control another, leave both open
const browser = yield* Browser                          // provided by Browser.connect(endpoint)
const [first, second] = yield* browser.pages
yield* Effect.scoped(Effect.gen(function* () {
  const reader = yield* first.inspect
  const text = yield* reader.getByRole("heading").readText
  const tab = yield* second.control
  yield* tab.route("**/analytics/**", () => Effect.succeed(Route.abort))
  yield* tab.getByRole("button", { name: "Refresh" }).click
}))                                                     // route and access released; both tabs stay open

// 8. Log requests until the page closes
yield* page.events.requests.pipe(
  Stream.filter((r) => r.resourceType === "fetch"),
  Stream.runForEach((r) => Console.log(r.method, r.url)))   // ends normally on close; fails on crash

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
```

## Open questions

1. **Access-typed handles.** Is the `ObservedPage` ⊂ `ReadonlyPage` ⊂ `Page` split right? Open details:
   - the access level of popups from inspected pages;
   - two levels for contexts (`ObservedContext`, `BrowserContext`) or three;
   - no type guards for narrowing listed pages.
2. **Module layout.** One package with subpath exports (`/test`, `/ai`, `/cdp`) or several packages?
3. **The ambiguity window.** What is the default stable-ambiguity window: about one second, or a number of rendering samples?
4. **The AI snapshot format.** Adopt Playwright's YAML-like aria snapshot as-is, or define our own with diffs?
5. **A runner plugin.** Is a Vitest reporter needed for flaky-test classification, or do spans suffice?
