# API: the ergonomic layer (L2)

*Revision 5, 2026-10-18. These are sketches: names and signatures are provisional, nothing is implemented, and the types show shape rather than compile-verified code. Every behavior here must be expressible in [CONCEPTS.md](CONCEPTS.md).*

## Purpose

This layer is what users write. It turns the native model into a small vocabulary of browsers, contexts, pages, locators, actions, expectations and observations, with the following properties:

- No protocol knowledge.
- `Scope` only where something with a lifecycle is acquired.
- One deadline per call.
- Errors that say what happened.

Error unions on reads, captures and evaluations are shortened in the sketches (`ReadError`, `CaptureError`). Like every operation, they also include `TargetGone | Timeout`.

Design rules:

- **Handles get methods; decorators are dual combinators.** `locator.click()` is a method. `Observe.response(...)` and `Expect.toHaveText(...)` work both data-first and in `pipe`.
- **Anything with a lifecycle requires `Scope`.** The following are acquired into the caller's `Scope` and released when it closes: contexts, pages, access upgrades, popups, downloads, handles, capability handles and every declaration (routes, dialog handlers, init scripts, overrides, clocks). Values with no remote lifetime need no `Scope`: locators, snapshots, captured bodies, storage-state bytes. Early release (`page.close()`) is always possible, and the scope's finalizer then does nothing.
- **No platform services at call sites.** Platform services appear only in the layers that launch or connect, so `Scope` is the only requirement an ordinary call site can see.
- **Locators are values.** A locator is resolved again on every attempt; it is never a stale handle.
- **Snapshots are named `read*`.** Retrying assertions take locators. "Awaited a snapshot, then asserted" is therefore hard to write by accident.
- **Ambient services are only for configuration.** Defaults (timeouts, diagnostics preset, strictness) come from `Context.Reference`s. There is no implicit "current page", except the explicit test layer.
- **The name `BrowserContext` is deliberate.** It avoids a clash with Effect's `Context` module.

## Top data models

```ts
type Access = "observe" | "inspect" | "control"

interface ObservedPage {                    // events only
  readonly id: NavigableId
  readonly url: Effect<string>
  readonly closed: Effect<CloseReason>      // completes when the page's lifetime ends
  readonly events: PageEvents               // navigations, requests, console, dialogs, popups, downloads
  inspect(): Effect<ReadonlyPage, PageError, Scope>   // installs the utility world; page stays open
  control(): Effect<Page, PageError, Scope>           // access lasts for the scope; page stays open
}
interface ReadonlyPage extends ObservedPage { /* locators, reads, snapshots, screenshots — see below */ }
interface Page extends ReadonlyPage { /* input, navigation, main-world evaluation, declarations */ }

interface Navigation {                      // success value of goto/reload/back/forward
  readonly id: NavigationId
  readonly document: DocumentId
  readonly response: Option<ResponseSnapshot>   // 404/500 is still a successful commit
  readonly kind: "committed" | "sameDocument" | "restored" | "activated"
}

interface ResponseSnapshot {                // immutable; one redirect hop
  readonly hop: RequestHopId
  readonly url: string
  readonly status: number
  readonly headers: Headers                 // classified values arrive as Redacted
}
interface CapturedResponse<B> extends ResponseSnapshot { readonly body: B }

interface AriaSnapshot {                    // for agents and structural assertions
  readonly document: DocumentId
  readonly generation: DocumentGeneration
  readonly text: string                     // YAML-like tree with [ref=eN]
  ref(id: string): Effect<Locator, StaleRef>   // StaleRef{reason} once the document or generation moves on
}
```

`Page`, `Locator`, `Navigation` and the other model handles are `Equal`/`Hash` by identity (CONCEPTS.md §1), so they work as `HashMap` keys and in assertions.

## Entry points

```ts
class Browser extends Context.Service<Browser, BrowserHandle>()("effect-browser/Browser") {
  static launch(options?: {
    readonly backend?: "chromium" | "firefox" | "webkit"
    readonly headless?: boolean
    readonly executablePath?: string
    readonly args?: ReadonlyArray<string>
  }): Layer<Browser, LaunchError, ChildProcessSpawner>

  static connect(endpoint: string, options?: {
    readonly headers?: Record<string, Redacted<string> | string>
  }): Layer<Browser, ConnectError, WebSocketConstructor>
}

interface BrowserHandle {
  readonly info: BackendInfo
  newContext(options?: ContextOptions): Effect<BrowserContext, ContextError, Scope>   // owned; removed when the scope closes
  newPage(options?: ContextOptions): Effect<Page, PageError, Scope>                    // a fresh context + page, released together
  readonly pages: Effect<ReadonlyArray<ObservedPage>>   // attach mode: what already exists
  readonly defaultContext: ObservedContext
}

interface BrowserContext {
  newPage(): Effect<Page, PageError, Scope>              // closed with its unsolicited popups when the scope closes
  readonly pages: Effect<ReadonlyArray<Page>>
  readonly storageState: { export(): Effect<Redacted<Uint8Array>, StorageStateError> }
  readonly clock: Clock                                   // context-wide timeline (opt-in)
  route<E, R>(pattern: UrlPattern, handler: RouteHandler<E, R>): Effect<void, RouteError, Scope | R>
  addInitScript(script: InitScriptSource, options?: InitScriptOptions): Effect<InitScript, DeclarationError, Scope>
  emulate(settings: Emulation): Effect<void, DeclarationError, Scope>
}

interface ContextOptions {
  readonly storageState?: StorageState     // from StorageState.import(bytes)
  readonly viewport?: { width: number; height: number }
  readonly locale?: string
  readonly timezone?: string
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
  frame(locator: ReadonlyLocator): ReadonlyFrame          // enters an iframe by its element
  // reads (one-shot)
  readonly title: Effect<string, ReadError>
  evaluate<Args extends ReadonlyArray<unknown>, A>(           // isolated world: no page globals
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect<A, EvaluationError | TargetGone | Timeout>
  snapshot(options?: { mode?: "ai" | "full" }): Effect<AriaSnapshot, ReadError>
  screenshot(options?: ScreenshotOptions): Effect<Uint8Array, CaptureError>
  pdf(options?: PdfOptions): Effect<Uint8Array, CaptureError>
}

interface Page extends ReadonlyPage {
  // the locator methods above return Locator (with actions) instead of ReadonlyLocator
  goto(url: string, options?: { waitUntil?: "commit" | "domcontentloaded" | "load"; timeout?: Duration.Input; accept?: ReadonlyArray<"download" | "noContent"> }):
    Effect<Navigation, NavigationError | TargetGone | Timeout>
  reload(options?: GotoOptions): Effect<Navigation, NavigationError | TargetGone | Timeout>
  back(options?: GotoOptions): Effect<Option<Navigation>, NavigationError | TargetGone | Timeout>   // None: no history entry
  forward(options?: GotoOptions): Effect<Option<Navigation>, NavigationError | TargetGone | Timeout>
  evaluate<Args extends ReadonlyArray<unknown>, A>(
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect<A, EvaluationError | TargetGone | Timeout>       // main world
  evaluateWith<S extends Schema.Top>(schema: S, fn: (...args: any) => unknown, ...args: ReadonlyArray<unknown>):
    Effect<S["Type"], EvaluationError | TargetGone | Timeout>
  evaluateHandle(fn: () => unknown): Effect<JSHandle, EvaluationError | TargetGone | Timeout, Scope>
  readonly keyboard: Keyboard
  readonly mouse: Mouse
  readonly clock: Clock
  route<E, R>(pattern: UrlPattern, handler: RouteHandler<E, R>): Effect<void, RouteError, Scope | R>
  onDialog<E, R>(handler: (dialog: Dialog) => Effect<DialogDecision, E, R>): Effect<void, DeclarationError, Scope | R>
  addInitScript(script: InitScriptSource, options?: InitScriptOptions): Effect<InitScript, DeclarationError, Scope>
  emulate(settings: Emulation): Effect<void, DeclarationError, Scope>
  activate(): Effect<void, TargetGone>                        // bring to front; rendering-based waits need it
  close(options?: { runBeforeUnload?: boolean }): Effect<void, CloseCanceled | TargetGone | Timeout>
}
```

Notes:

- **Evaluated functions cross into the page.** They must be self-contained, and values travel as arguments. A `ReferenceError` from an evaluated function carries a hint saying so.
- **Evaluation runs by value by default.** Results are serialized and deserialized. `evaluateWith(schema, …)` validates the result. Handles are opt-in and scoped. `{ userActivation: true }` (an options overload, not shown) runs the function as a user gesture where the backend supports it.
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
  first(): ReadonlyLocator
  last(): ReadonlyLocator
  describe(label: string): ReadonlyLocator                    // used in errors and traces
  // one-shot reads: no waiting, no retry
  count(): Effect<number, ReadError>
  readText(): Effect<string, ReadError>
  readValue(): Effect<string, ReadError>
  readAttribute(name: string): Effect<Option<string>, ReadError>
  isVisible(): Effect<boolean, ReadError>
  all(): Effect<ReadonlyArray<ReadonlyLocator>, ReadError>    // pinned to the current nth matches
  snapshot(): Effect<AriaSnapshot, ReadError>
}

interface Locator extends ReadonlyLocator {                   // chainers return Locator
  click(options?: ClickOptions): Effect<void, ActionError | TargetGone | Timeout>
  dblclick(options?: ClickOptions): Effect<void, ActionError | TargetGone | Timeout>
  hover(options?: PointerOptions): Effect<void, ActionError | TargetGone | Timeout>
  fill(value: string | Redacted<string>, options?: ActionOptions): Effect<void, ActionError | TargetGone | Timeout>
  press(key: KeyName, options?: ActionOptions): Effect<void, ActionError | TargetGone | Timeout>
  pressSequentially(text: string | Redacted<string>, options?: TypeOptions): Effect<void, ActionError | TargetGone | Timeout>
  check(): Effect<void, ActionError | TargetGone | Timeout>
  uncheck(): Effect<void, ActionError | TargetGone | Timeout>
  selectOption(values: string | ReadonlyArray<string>): Effect<void, ActionError | TargetGone | Timeout>
  setInputFiles(files: FileInput | ReadonlyArray<FileInput>): Effect<void, ActionError | TargetGone | Timeout>
  dragTo(target: Locator, options?: DragOptions): Effect<void, ActionError | TargetGone | Timeout>
}

interface ClickOptions extends PointerOptions {
  readonly button?: "left" | "right" | "middle"
  readonly modifiers?: ReadonlyArray<"Alt" | "Control" | "Meta" | "Shift">
  readonly position?: { x: number; y: number }
  readonly checks?: Partial<Record<"visible" | "stable" | "enabled" | "notInert" | "inViewport" | "receivesPointer", boolean>>
  readonly trial?: boolean                                    // run every check, dispatch nothing
  readonly timeout?: Duration.Input
}

const RelativeLocator: {                                      // only valid inside filter({ has })
  getByRole(role: AriaRole, options?: RoleOptions): RelativeLocator
  getByText(text: string | RegExp): RelativeLocator
  locator(css: string): RelativeLocator
}
```

- **Actionability is the CONCEPTS.md §8 predicate set**, evaluated in one injected round trip per attempt. The presets are:
  - `click`/`hover`: visible, stable, enabled, notInert, inViewport, receivesPointer;
  - `fill`: visible, enabled, editable, notInert.

  Turn off individual checks with `checks`; there is no blanket `force`.
- **Strictness.** An action needs exactly one match. A *stable* ambiguity, meaning the same candidates across the sampling window, fails early with `ActionError{reason: StrictViolation{candidates, suggestions}}`. A *transient* ambiguity, such as a fading toast, is retried until the deadline.
- **`has:` takes only `RelativeLocator`.** That makes Playwright's silent "page-rooted locator inside `has`" mismatch a type error.
- **Once only.** An action dispatches at most once per call. If a later step fails after input may have reached the page, the error carries that evidence and the action is never replayed.

## Expectations

```ts
declare const Expect: {
  // each is dual: Expect.toHaveText(locator, "1 item") or locator.pipe(Expect.toHaveText("1 item"))
  toBeVisible: Dual<ReadonlyLocator, [options?: ExpectOptions]>
  toBeHidden: Dual<ReadonlyLocator, [options?: ExpectOptions]>
  toBeEnabled: Dual<ReadonlyLocator, [options?: ExpectOptions]>
  toBeChecked: Dual<ReadonlyLocator, [options?: ExpectOptions]>
  toBeFocused: Dual<ReadonlyLocator, [options?: ExpectOptions]>
  toHaveText: Dual<ReadonlyLocator, [expected: string | RegExp | ReadonlyArray<string | RegExp>, options?: ExpectOptions]>
  toHaveValue: Dual<ReadonlyLocator, [expected: string | RegExp, options?: ExpectOptions]>
  toHaveAttribute: Dual<ReadonlyLocator, [name: string, expected?: string | RegExp, options?: ExpectOptions]>
  toHaveCount: Dual<ReadonlyLocator, [count: number, options?: ExpectOptions]>
  toMatchAriaSnapshot: Dual<ReadonlyLocator, [template: string, options?: ExpectOptions]>
  toHaveURL: Dual<ReadonlyPage, [expected: string | RegExp, options?: ExpectOptions]>
  toHaveTitle: Dual<ReadonlyPage, [expected: string | RegExp, options?: ExpectOptions]>
  // the general form: any observable, any condition
  that<A>(observable: Observable<A>, condition: Condition<A>, options?: ExpectOptions): Effect<void, ExpectationFailed | TargetGone>
  poll<A, E, R>(probe: Effect<A, E, R>, condition: Condition<A>, options?: ExpectOptions): Effect<void, E | ExpectationFailed, R>
  soft<A, E, R>(self: Effect<A, E, R>): Effect<void, never, R | SoftExpectations>   // failures collected, reported at scope end
}
// Dual<S, Args> = { (subject: S, ...args: Args): Effect<void, ExpectationFailed | TargetGone>; (...args: Args): (subject: S) => Effect<…> }
declare const Cond: {
  not<A>(c: Condition<A>): Condition<A>       // the wait is for the negation, and it passes when the element is missing
  and<A>(...cs: ReadonlyArray<Condition<A>>): Condition<A>   // evaluated against one observation
  because<A>(why: string): (c: Condition<A>) => Condition<A>
}
```

- **How expectations evaluate.** One check runs immediately, then re-checks on a backoff schedule plus DOM-change invalidations, all within the call's deadline.
- **What failure contains.** `ExpectationFailed{subject, condition, last, history, elapsed}`. `history` is the de-duplicated sequence of observed values with timestamps, which answers "was it ever right?". When nothing matched, the error adds an accessibility snapshot of the nearest existing ancestor and suggested locators.

## Observation combinators

Every "wait for X caused by Y" is a combinator that decorates the trigger. It subscribes, and installs any collectors and handlers, *before* the trigger runs. It returns the trigger's own value alongside the observation, and preserves the trigger's `E` and `R`.

```ts
declare const Observe: {
  response<B = Uint8Array, PE = never, PR = never>(options: {
    readonly url?: UrlPattern
    readonly method?: string
    readonly status?: number | ((status: number) => boolean)
    readonly body?: BodyDecoder<B>                          // e.g. Body.json(schema); collection is set up automatically
    readonly where?: (response: CapturedResponse<B>) => Effect<boolean, PE, PR>   // runs off the ingestion path
  }): <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, CapturedResponse<B>], E | PE | ResponseError | TargetGone | Timeout, R | PR>

  request(options: RequestFilter): <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, RequestSnapshot], E | ObserveError | TargetGone | Timeout, R>
  popup(options?: { url?: UrlPattern }): <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, Page], E | ObserveError | TargetGone | Timeout, R | Scope>
  download(): <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, Download], E | ObserveError | TargetGone | Timeout, R | Scope>
  navigation(options?: { url?: UrlPattern; waitUntil?: LoadState }): <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, Navigation], E | NavigationError | TargetGone | Timeout, R>
  dialog<DE, DR>(handler: (dialog: Dialog) => Effect<DialogDecision, DE, DR>): <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, Dialog], E | DE | ObserveError | TargetGone | Timeout, R | DR>   // handler runs while the trigger runs
  fileChooser(files: FileInput | ReadonlyArray<FileInput>): <A, E, R>(trigger: Effect<A, E, R>) =>
    Effect<readonly [A, void], E | ObserveError | TargetGone | Timeout, R>
}
// each also has a data-first overload: Observe.response(trigger, options)
```

- **Completion rule.** Both the trigger and the observation must complete. A trigger failure is never discarded.
- **When the owner ends first.** If the owner (page or context) ends normally before a match, the combinator fails promptly with `TargetGone` rather than waiting for its deadline.
- **Results outlive the window.** A captured response body is owned bytes, so it survives the observation window and even the page closing.
- **Popups.** A popup returned by `Observe.popup` is acquired into the caller's `Scope`. A popup nobody asked for is released with the scope that acquired its opener. Ownership follows the opener: popups of owned pages are owned, popups of attached pages stay open.

## Network

```ts
type RouteHandler<E, R> = (request: InterceptedRequest) => Effect<RouteDecision, E, R>   // E is logged; the default decision applies
interface InterceptedRequest {
  readonly request: RequestSnapshot
  fetch(overrides?: RequestOverrides): Effect<FetchedResponse, RouteError>   // perform it, then patch the response
}
declare const Route: {
  continue(overrides?: RequestOverrides): RouteDecision
  fulfill(response: { status?: number; headers?: Headers; body?: Uint8Array | string; json?: unknown }): RouteDecision
  abort(reason?: AbortReason): RouteDecision
  readonly fallthrough: RouteDecision                       // next matching handler
}
declare const Har: {
  replay(path: string, options?: { notFound?: "fallthrough" | "abort"; update?: boolean }):
    (page: Page | BrowserContext) => Effect<void, RouteError, Scope>
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
  accept(text?: string): DialogDecision
  readonly dismiss: DialogDecision
}

interface Download {
  readonly url: string
  readonly suggestedFilename: string
  readonly done: Effect<void, DownloadError>
  saveAs(path: string): Effect<void, DownloadError>        // transfers from a remote browser where supported
  // the browser-side file is deleted when the acquiring scope closes, unless the backend's download policy keeps it
  stream(): Stream<Uint8Array, DownloadError>
}

declare const StorageState: {
  import(bytes: Redacted<Uint8Array>): Effect<StorageState, StorageStateError>
}
```

- **Default dialog policy.** On owned pages, dialogs are dismissed after a short grace period, except `beforeunload`, which is accepted. On attached pages there is no default unless the caller opts in. Every automatic decision is published on `page.events.dialogs` and recorded on the operation that was running.
- **Waiting on a dialog.** An operation blocked by a dialog that is about to be resolved waits within its deadline; it does not fail immediately.
- **Storage state.** `storageState.export()` returns the full restorable state as `Redacted<Uint8Array>`. Writing it somewhere is an explicit, visible step. Diagnostic JSON of a context never contains secrets.

## Page time

```ts
interface Clock {
  install(options: { mode: "fixed"; at: DateInput } | { mode: "offset"; by: Duration.Input } | { mode: "controlled"; at?: DateInput }):
    Effect<void, DeclarationError, Scope>                     // needs before-author-script timing
  pauseAt(at: DateInput): Effect<void, ClockError>
  resume(): Effect<void, ClockError>
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
browser.capabilities                        // the full set, with evidence and limitations
```

Common methods are on every backend. Specialized features are reached through a capability handle bound to *this* page, so a feature from one browser can't authorize an operation on another.

## Agents

```ts
const snap = yield* page.snapshot({ mode: "ai" })      // interactive elements get [ref=eN]; refs bound to document + generation
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

layer(BrowserTest.chromium())("checkout", (it) => {
  it.effect("adds to cart", () =>
    Effect.gen(function* () {
      const page = yield* BrowserTest.page      // fresh context + page per test; closed after
      yield* page.goto("/shop")
      // …
    }))
})
```

`BrowserTest` layers provide:

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
locator.click().pipe(
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
  const ctx = yield* browser.newContext()
  const page = yield* ctx.newPage()
  yield* page.goto("https://app.example.com/login")
  yield* page.getByLabel("Email").fill("me@example.com")
  yield* page.getByLabel("Password").fill(Redacted.make(env.PASSWORD))
  yield* page.getByRole("button", { name: "Sign in" }).click()
  yield* page.getByText("Welcome").pipe(Expect.toBeVisible())
  return yield* ctx.storageState.export()
}))
const page = yield* browser.newPage({ storageState: yield* StorageState.import(state) })

// 2. Click, then wait for a named outcome
const [, nav] = yield* page.getByRole("link", { name: "Orders" }).click().pipe(
  Observe.navigation({ url: "**/orders" }))

// 3. Popup with a dialog inside it
const [, popup] = yield* page.getByText("Connect account").click().pipe(Observe.popup({ url: "**/oauth/**" }))
yield* popup.getByRole("button", { name: "Allow" }).click().pipe(Observe.dialog(() => Effect.succeed(Dialog.accept())))

// 4 + 9. Response body, decoded and filtered, without ordering subscriptions by hand
const [, res] = yield* page.getByRole("button", { name: "Add to cart" }).click().pipe(
  Observe.response({ url: "**/api/cart", method: "POST", body: Body.json(Cart),
    where: (r) => Effect.succeed(r.body.items.length > 0) }))

// 5. Download
const [, file] = yield* page.getByText("Export CSV").click().pipe(Observe.download())
yield* file.saveAs("./export.csv")

// 6. Concurrent pages, settings isolated by context
yield* Effect.forEach(urls, (url) => Effect.scoped(Effect.gen(function* () {
  const p = yield* browser.newPage({ locale: "de-DE" })     // context + page released per URL
  yield* p.goto(url)
  return yield* p.title
})), { concurrency: 4 })

// 7. Attach, inspect one tab, control another, leave both open
const browser = yield* Browser                          // provided by Browser.connect(endpoint)
const [first, second] = yield* browser.pages
yield* Effect.scoped(Effect.gen(function* () {
  const reader = yield* first.inspect()
  const text = yield* reader.getByRole("heading").readText()
  const tab = yield* second.control()
  yield* tab.route("**/analytics/**", () => Effect.succeed(Route.abort()))
  yield* tab.getByRole("button", { name: "Refresh" }).click()
}))                                                          // route and access released; both tabs stay open

// 8. Log requests until the page closes
yield* page.events.requests.pipe(
  Stream.filter((r) => r.resourceType === "fetch"),
  Stream.runForEach((r) => Console.log(r.method, r.url)))   // ends normally on close; fails on crash

// 10. Paused application time
yield* page.clock.install({ mode: "controlled", at: "2026-01-01T09:00:00Z" })
yield* page.goto("/session")
yield* page.getByRole("button", { name: "Start" }).click()  // no page time passes
yield* page.clock.runFor("5 minutes")
yield* page.getByText("Session expired").pipe(Expect.toBeVisible())

// 11. Ordered setup scripts
const helper = yield* page.addInitScript(installTestHooks)
yield* page.addInitScript(useTestHooks, { after: [helper] })   // dependencies only on equal or broader scope

// 12. Operational failures stay typed and evidenced
yield* page.locator("button[").click().pipe(                 // invalid selector: immediate, no waiting
  Effect.catchReason("ActionError", "InvalidSelector", (e) => Console.log(e.message)))
```

## Open questions

1. **Access-typed handles.** Is the `ObservedPage` ⊂ `ReadonlyPage` ⊂ `Page` split the right shape (versus a generic access parameter)? `BrowserContext` is settled as a name.
2. **Module layout.** One package with subpath exports (`/test`, `/ai`, `/cdp`) or several packages?
3. **The ambiguity window.** What is the default stable-ambiguity window: about one second, or a number of rendering samples?
4. **The AI snapshot format.** Adopt Playwright's YAML-like aria snapshot as-is, or define our own with diffs?
5. **A runner plugin.** Is a Vitest reporter needed for flaky-test classification, or do spans suffice?
