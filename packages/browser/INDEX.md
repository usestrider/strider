# @usestrider/browser API index

Generated from `src/` by `pnpm index`; don't edit by hand. One line per declaration and member, by entry point, module and `@category`. Experimental APIs are marked. The browsable reference is generated from the same sources by `pnpm api-reference`.

## `@usestrider/browser`

### AriaPattern

Patterns that describe part of the accessibility tree, for `Expect.toMatchAria`.

*models*

- `interface AriaPattern`
  - `readonly [TypeId]: typeof TypeId`
- `interface Children`
  - `readonly [ChildrenTypeId]: typeof ChildrenTypeId`

*constructors*

- `const node: (role: AriaRole.AriaRole, name: string | RegExp, children: Children) => AriaPattern`
- `const text: (value: string | RegExp) => AriaPattern`
- `const exactly: (...children: ReadonlyArray<AriaPattern>) => Children`
- `const including: (...children: ReadonlyArray<AriaPattern>) => Children`

*constants*

- `const unchecked: Children`

*guards*

- `const isAriaPattern: (u: unknown) => u is AriaPattern`

### AriaRole

The WAI-ARIA roles that `getByRole`, snapshots and `AriaPattern` use.

*models*

- `type AriaRole = | "alert" | "alertdialog" | "application" | "article" | "banner" | "blockquote" | "button" | "caption" | "cell" | "checkbox" | "code" | "columnheader" | "combobox" | "complementary" | "contentinfo" |…`

*constants*

- `const all: ReadonlySet<AriaRole>`

*guards*

- `const isAriaRole: (u: unknown) => u is AriaRole`

### AutoResolution

Dialogs, file choosers and paused requests that a default policy decided, because no handler or route did.

*models*

- `type Subject = typeof Subject.Type`
- `type Policy = typeof Policy.Type`
- `class AutoResolution: Schema.Class { subject, decision, policy, at }`
- `interface Filter`
  - `readonly subject?: Subject["_tag"] | ReadonlyArray<Subject["_tag"]> | undefined`

*schemas*

- `const Subject = Schema.Union([Schema.TaggedStruct("Dialog", { kind: Schema.Literals(["Alert", "Confirm", "Prompt", "BeforeUnload", "Unknown"]), message: Schema.String }), Schema.TaggedStruct("FileChooser", {}), Sche…`
- `const Policy = Schema.Union([Schema.TaggedStruct("ContextOption", { name: Schema.Literal("dialogs"), value: Schema.String }), Schema.TaggedStruct("Default", {})])`

*subscriptions*

- `const next: <PE = never, PR = never>(target: Page.Page | UserContext.UserContext, filter?: Filter | undefined, where?: Subscription.Where<AutoResolution, PE, PR> | undefined) => Effect.Effect< Effect.Effect<AutoResolution, PE | Target.TargetGone | Deadline.Timeout>, Subscription.SubscriptionError, Scope.Scope | PR >`
- `const stream: <PE = never, PR = never>(target: Page.Page | UserContext.UserContext, filter?: Filter | undefined, where?: Subscription.Where<AutoResolution, PE, PR> | undefined) => Effect.Effect< Stream.Stream<AutoResolution, PE | Subscription.EventOverflow | Target.TargetGone>, Subscription.SubscriptionError, Scope.Scope | PR >`

*getters*

- `const history: (target: Page.Page | UserContext.UserContext, filter?: Filter | undefined) => Effect.Effect<Subscription.History<AutoResolution>, Subscription.SubscriptionError>`

### Browser

The `Browser` service, which every backend provides, with its accessors and the settings every backend shares.

*services*

- `interface Browser`
  - `readonly [TypeId]: typeof TypeId`
  - `readonly info: Info`
  - `readonly capabilities: Watchable.Watchable<CapabilitySet>`
  - `newContext(options?: UserContext.Options | undefined): Effect.Effect<UserContext.UserContext, UserContext.UserContextError | Deadline.Timeout, Scope.Scope>`
  - `newPage(options?: UserContext.Options | undefined): Effect.Effect<Page.Page, Page.PageError | Target.TargetGone | Deadline.Timeout, Scope.Scope>`
  - `readonly pages: Watchable.Watchable<ReadonlyArray<Page.ObservedPage>>`
  - `readonly defaultContext: UserContext.ObservedUserContext`

*tags*

- `const Browser: Context.Service<Browser, Browser>`

*accessors*

- `const newPage: (options?: UserContext.Options | undefined) => Effect.Effect<Page.Page, Page.PageError | Target.TargetGone | Deadline.Timeout, Browser | Scope.Scope>`
- `const newContext: (options?: UserContext.Options | undefined) => Effect.Effect<UserContext.UserContext, UserContext.UserContextError | Deadline.Timeout, Browser | Scope.Scope>`

*layers*

- `const layerTest: (timeline: string) => Layer.Layer<Browser>` (experimental)

*models*

- `class Info: Schema.Class { product, version, protocol, revision }`
- `type CapabilityEntry = typeof CapabilityEntry.Type`
- `class CapabilitySet: Schema.Class { entries }`
  - `has(name: string): boolean`
- `interface LaunchOptions`
  - `readonly executablePath: FilePath.Local | string`
  - `readonly headless?: boolean | undefined`
  - `readonly args?: ReadonlyArray<string> | undefined`
  - `readonly profile?: LaunchProfile.LaunchProfile | undefined`
  - `readonly userDataDir?: FilePath.Local | string | undefined`
  - `readonly coreDumps?: boolean | undefined`
- `interface ConnectOptions`
  - `readonly headers?: Readonly<Record<string, string | Redacted.Redacted<string>>> | undefined`
- `interface Operation extends Tracing.Operation`
  - `readonly name: string`
  - `readonly target: Target.Description`
- `type BrowserErrorReason = typeof BrowserErrorReason.Type`

*schemas*

- `const CapabilityEntry = Schema.Struct({ name: Schema.String, status: Schema.Literals(["supported", "partial", "unsupported", "unknown"]), evidence: Schema.String, limitations: Schema.Array(Schema.String) })`
- `const BrowserErrorReason = Schema.Union([ExecutableNotFound, ProcessExited, IncompatibleRevision, ConnectionFailed, Reason.InvalidInput])`

*references*

- `const SpanNameGenerator: Context.Reference<(operation: Operation) => string>`
- `const TracerDisabledWhen: Context.Reference<Predicate.Predicate<Operation>>`
- `const TraceProtocolCommands: Context.Reference<boolean>`

*guards*

- `const isBrowser: (u: unknown) => u is Browser`
- `const isBrowserError: (u: unknown) => u is BrowserError`

*errors*

- `class BrowserError: Schema.TaggedError "BrowserError" { reason, diagnostics }`
  - `override get cause(): unknown`

*reasons*

- `class ExecutableNotFound: Schema.Error { searched, hint }`
- `class ProcessExited: Schema.Error { code, stderrTail, hint }`
- `class IncompatibleRevision: Schema.Error { revision, hint }`
- `class ConnectionFailed: Schema.Error { stage, hint, cause }`

### BrowserWorker

Workers that pages and contexts start: a page's dedicated workers, and a context's shared and service workers.

*models*

- `type Kind = "dedicated" | "shared" | "service"`
- `interface ObservedBrowserWorker extends Pipeable.Pipeable, Inspectable.Inspectable`
  - `readonly [TypeId]: typeof TypeId`
  - `readonly realm: Target.RealmId`
  - `readonly kind: Kind`
  - `readonly url: Url.Url`
  - `readonly closed: Effect.Effect<Target.CloseReason>`
- `interface BrowserWorker extends ObservedBrowserWorker`
  - `evaluate<Args extends ReadonlyArray<unknown>, B>(fn: (...args: Args) => B | Promise<B>, ...args: Args): Effect.Effect<JSHandle.Serialized<B>, BrowserWorkerErro…`
- `interface Filter`
  - `readonly url?: Url.Pattern | string | undefined`
  - `readonly kind?: Kind | undefined`
- `type BrowserWorkerErrorReason = typeof BrowserWorkerErrorReason.Type`

*schemas*

- `const BrowserWorkerErrorReason = Schema.Union([Reason.EvaluationThrown, Reason.NotSerializable, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])`

*subscriptions*

- `const next`
  - `<PE = never, PR = never>(target: Page.Page | UserContext.UserContext, filter?: Filter | undefined, where?: Subscription.Where<BrowserWorker, PE, PR> | undefine…`
  - `<PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined, where?: Subscription.Where<ObservedBrowserWo…`
- `const stream`
  - `<PE = never, PR = never>(target: Page.Page | UserContext.UserContext, filter?: Filter | undefined, where?: Subscription.Where<BrowserWorker, PE, PR> | undefine…`
  - `<PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined, where?: Subscription.Where<ObservedBrowserWo…`

*getters*

- `const history`
  - `(target: Page.Page | UserContext.UserContext, filter?: Filter | undefined): Effect.Effect<Subscription.History<BrowserWorker>, Subscription.SubscriptionError>`
  - `(target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined): Effect.Effect<Subscription.History<ObservedBrowserWorker>, Subscrip…`

*guards*

- `const isBrowserWorker: (u: unknown) => u is ObservedBrowserWorker`
- `const isBrowserWorkerError: (u: unknown) => u is BrowserWorkerError`

*errors*

- `class BrowserWorkerError: Schema.TaggedError "BrowserWorkerError" { reason, diagnostics }`
  - `override get cause(): unknown`

### Capability

Features that only some backends have, each reached through a handle bound to one page.

*models*

- `interface Capability<out H, out Access extends "inspect" | "control" = "inspect">`
  - `readonly access: Access`
  - `readonly [TypeId]: () => H`
  - `readonly name: string`
- `interface AxNode`
  - `readonly role: string`
  - `readonly name: string`
  - `readonly properties: Readonly<Record<string, unknown>>`
  - `readonly children: ReadonlyArray<AxNode>`
- `interface AxTreeReader`
  - `readonly read: Effect.Effect<AxNode, CapabilityError | Target.TargetGone | Deadline.Timeout>`
- `interface ScreencastFrame`
  - `readonly at: MonotonicInstant.MonotonicInstant`
  - `readonly width: Pixels.Device`
  - `readonly height: Pixels.Device`
  - `readonly jpeg: Uint8Array`
- `interface ScreencastControl`
  - `readonly frames: Stream.Stream<ScreencastFrame, Target.TargetGone>`
- `interface VideoRecording`
  - `readonly file: Effect.Effect<FilePath.Local, CapabilityError | Target.TargetGone | Deadline.Timeout>`
- `type CapabilityErrorReason = typeof CapabilityErrorReason.Type`

*schemas*

- `const CapabilityErrorReason = Schema.Union([Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])`

*constants*

- `const AxTree: Capability<AxTreeReader>`
- `const Screencast: Capability<ScreencastControl>`
- `const Video: Capability<VideoRecording>`

*guards*

- `const isCapability: (u: unknown) => u is Capability<unknown> | Capability<unknown, "control">`
- `const isCapabilityError: (u: unknown) => u is CapabilityError`

*errors*

- `class CapabilityError: Schema.TaggedError "CapabilityError" { capability, reason, diagnostics }`
  - `override get cause(): unknown`

*capabilities*

- `const VirtualAuthenticator: Capability<WebAuthn.VirtualAuthenticator, "control">`

### Condition

Conditions for `Expect.that`: predicates with a description, so a failure says what was expected.

*models*

- `interface Condition<in A> extends Pipeable`
  - `readonly [TypeId]: (a: A) => boolean`

*constructors*

- `const make: <A>(description: string, predicate: P.Predicate<A>) => Condition<A>`

*combinators*

- `const not: <A>(condition: Condition<A>) => Condition<A>`
- `const and: <A>(...conditions: ReadonlyArray<Condition<A>>) => Condition<A>`
- `const because`
  - `(why: string): <A>(condition: Condition<A>) => Condition<A>`
  - `<A>(condition: Condition<A>, why: string): Condition<A>`

*guards*

- `const isCondition: (u: unknown) => u is Condition<never>`

### ConsoleMessage

The messages that a page or its workers write to the console.

*models*

- `type Level = typeof Level.Type`
- `type SourceLocation = typeof SourceLocation.Type`
- `class ConsoleMessage: Schema.Class { level, text, location, origin, at }`
- `interface Filter`
  - `readonly level?: Level | ReadonlyArray<Level> | undefined`
  - `readonly text?: string | RegExp | undefined`

*schemas*

- `const Level = Schema.Literals(["debug", "log", "info", "warning", "error"])`
- `const SourceLocation = Schema.Struct({ url: Url.Url, line: Schema.Int, column: Schema.Int })`

*subscriptions*

- `const next: <PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined, where?: Subscription.Where<ConsoleMessage, PE, PR> | undefined) => Effect.Effect< Effect.Effect<ConsoleMessage, PE | Target.TargetGone | Deadline.Timeout>, Subscription.SubscriptionError, Scope.Scope | PR >`
- `const stream: <PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined, where?: Subscription.Where<ConsoleMessage, PE, PR> | undefined) => Effect.Effect< Stream.Stream<ConsoleMessage, PE | Subscription.EventOverflow | Target.TargetGone>, Subscription.SubscriptionError, Scope.Scope | PR >`

*getters*

- `const history: (target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined) => Effect.Effect<Subscription.History<ConsoleMessage>, Subscription.SubscriptionError>`

### CookieJar

A context's cookies: reading, setting and removing them.

*models*

- `type Name = typeof Name.Type`
- `type Domain = typeof Domain.Type`
- `type PartitionKey = typeof PartitionKey.Type`
- `class Cookie: Schema.Class { name, value, domain, path, expires, httpOnly, secure, sameSite, partitionKey, priority }`
- `interface Input`
  - `readonly name: Name | string`
  - `readonly value: string | Redacted.Redacted<string>`
  - `readonly scope: | { readonly url: Url.Url | string; readonly domain?: never; readonly path?: never } | { readonly domain: Domain | string; readonly path: strin…`
  - `readonly expires?: DateTime.DateTime.Input | undefined`
  - `readonly httpOnly?: boolean | undefined`
  - `readonly secure?: boolean | undefined`
  - `readonly sameSite?: "strict" | "lax" | "none" | undefined`
  - `readonly partitionKey?: PartitionKey | undefined`
- `interface Match`
  - `readonly name: Name | string`
  - `readonly domain?: Domain | string | undefined`
  - `readonly path?: string | undefined`
- `interface CookieJar`
  - `readonly list: Effect.Effect<ReadonlyArray<Cookie>, CookieJarError | Target.TargetGone | Deadline.Timeout>`
  - `listFor(url: Url.Url | string): Effect.Effect<ReadonlyArray<Cookie>, CookieJarError | Target.TargetGone | Deadline.Timeout>`
  - `set(cookie: Input): Effect.Effect<void, CookieJarError | Target.TargetGone | Deadline.Timeout>`
  - `remove(match: Match): Effect.Effect<void, CookieJarError | Target.TargetGone | Deadline.Timeout>`
  - `readonly clear: Effect.Effect<void, CookieJarError | Target.TargetGone | Deadline.Timeout>`
- `type CookieJarErrorReason = typeof CookieJarErrorReason.Type`

*schemas*

- `const Name = Schema.String.pipe(Schema.brand("~@usestrider/browser/CookieJar/Name"))`
- `const Domain = Schema.String.pipe(Schema.brand("~@usestrider/browser/CookieJar/Domain"))`
- `const PartitionKey = Schema.Union([Schema.TaggedStruct("Unpartitioned", {}), Schema.TaggedStruct("Partitioned", { topLevelSite: Url.Site, crossSiteAncestor: Schema.Option(Schema.Boolean) })])`
- `const CookieJarErrorReason = Schema.Union([Reason.InvalidInput, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])`

*converting*

- `const toCookie: (cookie: Cookie) => Cookies.Cookie`

*guards*

- `const isCookieJarError: (u: unknown) => u is CookieJarError`

*errors*

- `class CookieJarError: Schema.TaggedError "CookieJarError" { operation, reason, diagnostics }`
  - `override get cause(): unknown`

### Deadline

Time limits for operations: one deadline covers everything an operation does.

*combinators*

- `const within`
  - `(duration: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>`
  - `<A, E, R>(self: Effect.Effect<A, E, R>, duration: Duration.Input): Effect.Effect<A, E, R>`
- `const withDefaultBudget`
  - `(duration: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>`
  - `<A, E, R>(self: Effect.Effect<A, E, R>, duration: Duration.Input): Effect.Effect<A, E, R>`

*getters*

- `const remaining: Effect.Effect<Option.Option<Duration.Duration>>`

*references*

- `const CurrentDeadline: Context.Reference<Option.Option<MonotonicInstant.MonotonicInstant>>`
- `const DefaultBudget: Context.Reference<Duration.Duration>`

*guards*

- `const isTimeout: (u: unknown) => u is Timeout`

*errors*

- `class Timeout: Schema.TaggedError "Timeout" { operation, phase, budget, last, history, hint, diagnostics }`

### Declaration

Declarations: settings and handlers that change how a page or context behaves for as long as their scope lasts.

*models*

- `interface Registration`
  - `readonly remove: Effect.Effect<void>`
- `interface HandlerRegistration extends Registration`
  - `readonly handled: Watchable.Watchable<number>`
- `type DeclarationErrorReason = typeof DeclarationErrorReason.Type`

*schemas*

- `const DeclarationErrorReason = Schema.Union([TimingUnsupported, Conflict, DependencyReleased, Reason.InvalidInput, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure, Reason.ViewportMismatch])`

*guards*

- `const isDeclarationError: (u: unknown) => u is DeclarationError`

*errors*

- `class DeclarationError: Schema.TaggedError "DeclarationError" { declaration, reason, diagnostics }`
  - `override get cause(): unknown`

*reasons*

- `class TimingUnsupported: Schema.Error { needed, hint }`
- `class Conflict: Schema.Error { with, hint }`
- `class DependencyReleased: Schema.Error { hint }`

### Diagnostics

The record of what happened that every failure carries, and the preset that decides how much of a URL is shown.

*models*

- `type OperationId = typeof OperationId.Type`
- `type DispatchState = typeof DispatchState.Type`
- `type StepEvidence = typeof StepEvidence.Type`
- `type ObservedValue = typeof ObservedValue.Type`
- `type CleanupState = typeof CleanupState.Type`
- `class Diagnostics: Schema.Class { operationId, dispatch, progress, lastObserved, cleanup }`
- `type Preset = typeof Preset.Type`

*schemas*

- `const OperationId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Diagnostics/OperationId"))`
- `const DispatchState = Schema.Union([Schema.TaggedStruct("NotSent", {}), Schema.TaggedStruct("MayHaveBeenSent", {}), Schema.TaggedStruct("Acknowledged", { result: Schema.Literals(["ok", "rejected"]) })])`
- `const StepEvidence = Schema.Struct({ step: Schema.String, state: Schema.Literals(["unsent", "uncertain", "ok", "rejected"]), at: MonotonicInstant.MonotonicInstant })`
- `const ObservedValue = Schema.Struct({ at: MonotonicInstant.MonotonicInstant, value: Schema.Unknown })`
- `const CleanupState = Schema.Union([Schema.TaggedStruct("NotNeeded", {}), Schema.TaggedStruct("Pending", {}), Schema.TaggedStruct("Completed", {}), Schema.TaggedStruct("Failed", { cause: Schema.String })])`
- `const Preset = Schema.Literals(["local", "strict"])`

*combinators*

- `const withPreset`
  - `(preset: Preset): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>`
  - `<A, E, R>(self: Effect.Effect<A, E, R>, preset: Preset): Effect.Effect<A, E, R>`

*references*

- `const CurrentPreset: Context.Reference<Preset>`

### Dialog

The dialogs a page opens: `alert`, `confirm`, `prompt` and `beforeunload`.

*models*

- `type PromptId = typeof PromptId.Type`
- `interface Decision`
  - `readonly [DecisionTypeId]: typeof DecisionTypeId`
- `type Dialog = typeof Dialog.Type`
- `type Pending = | Extract<Dialog, { readonly _tag: "Alert" }> & { readonly accept: Effect.Effect<Decision> } | Extract<Dialog, { readonly _tag: "Confirm" }> & { readonly accept: Effect.Effect<Decision> readonly dism…`
- `type Kind = Dialog["_tag"]`
- `interface Filter`
  - `readonly kind?: Kind | ReadonlyArray<Kind> | undefined`

*schemas*

- `const PromptId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Dialog/PromptId"))`
- `const Dialog = Schema.Union([Schema.TaggedStruct("Alert", { id: PromptId, message: Schema.String }), Schema.TaggedStruct("Confirm", { id: PromptId, message: Schema.String }), Schema.TaggedStruct("Prompt", { id: Pro…`

*subscriptions*

- `const next: <PE = never, PR = never>(target: Page.ObservedPage, filter?: Filter | undefined, where?: Subscription.Where<Dialog, PE, PR> | undefined) => Effect.Effect< Effect.Effect<Dialog, PE | Target.TargetGone | Deadline.Timeout>, Subscription.SubscriptionError, Scope.Scope | PR >`
- `const stream: <PE = never, PR = never>(target: Page.ObservedPage, filter?: Filter | undefined, where?: Subscription.Where<Dialog, PE, PR> | undefined) => Effect.Effect< Stream.Stream<Dialog, PE | Subscription.EventOverflow | Target.TargetGone>, Subscription.SubscriptionError, Scope.Scope | PR >`

*getters*

- `const history: (target: Page.ObservedPage, filter?: Filter | undefined) => Effect.Effect<Subscription.History<Dialog>, Subscription.SubscriptionError>`

*handlers*

- `const handle: <E, R>(page: Page.Page, handler: (dialog: Pending) => Effect.Effect<Decision, E, R>) => Effect.Effect<Declaration.HandlerRegistration, Declaration.DeclarationError | Target.TargetGone, Scope.Scope | R>`
- `const acceptAll: (dialog: Pending) => Effect.Effect<Decision>`
- `const dismissAll: (dialog: Pending) => Effect.Effect<Decision>`

*guards*

- `const isDecision: (u: unknown) => u is Decision`

### Download

The files a page or context downloads: waiting for one, following its progress, and saving it.

*models*

- `type Id = typeof Id.Type`
- `type Status = typeof Status.Type`
- `interface Download extends Pipeable.Pipeable, Inspectable.Inspectable`
  - `readonly [TypeId]: typeof TypeId`
  - `readonly id: Id`
  - `readonly url: Url.Url`
  - `readonly suggestedFilename: FileInput.FileName`
  - `readonly status: Watchable.Watchable<Status>`
  - `readonly finished: Effect.Effect<void, DownloadError | Target.TargetGone | Deadline.Timeout>`
  - `readonly stream: Stream.Stream<Uint8Array, DownloadError | Target.TargetGone | Deadline.Timeout>`
  - `saveAs(path: FilePath.Local | string): Effect.Effect<void, DownloadError | Target.TargetGone | Deadline.Timeout>`
  - `readonly cancel: Effect.Effect<void, DownloadError | Deadline.Timeout>`
- `interface Filter`
  - `readonly url?: Url.Pattern | string | undefined`
- `type DownloadErrorReason = typeof DownloadErrorReason.Type`

*schemas*

- `const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/Download/Id"))`
- `const Status = Schema.Union([Schema.TaggedStruct("InProgress", { received: Schema.Int, total: Schema.Option(Schema.Int) }), Schema.TaggedStruct("Completed", {}), Schema.TaggedStruct("Canceled", {}), Schema.TaggedSt…`
- `const DownloadErrorReason = Schema.Union([DownloadCanceled, DownloadFailed, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])`

*subscriptions*

- `const next: <PE = never, PR = never>(target: Page.Page | UserContext.UserContext, filter?: Filter | undefined, where?: Subscription.Where<Download, PE, PR> | undefined) => Effect.Effect< Effect.Effect<Download, PE | Target.TargetGone | Deadline.Timeout>, Subscription.SubscriptionError, Scope.Scope | PR >`
- `const stream: <PE = never, PR = never>(target: Page.Page | UserContext.UserContext, filter?: Filter | undefined, where?: Subscription.Where<Download, PE, PR> | undefined) => Effect.Effect< Stream.Stream<Download, PE | Subscription.EventOverflow | Target.TargetGone>, Subscription.SubscriptionError, Scope.Scope | PR >`

*getters*

- `const history: (target: Page.Page | UserContext.UserContext, filter?: Filter | undefined) => Effect.Effect<Subscription.History<Download>, Subscription.SubscriptionError>`

*guards*

- `const isDownload: (u: unknown) => u is Download`
- `const isDownloadError: (u: unknown) => u is DownloadError`

*errors*

- `class DownloadError: Schema.TaggedError "DownloadError" { operation, reason, diagnostics }`
  - `override get cause(): unknown`

*reasons*

- `class DownloadCanceled: Schema.Error { hint }`
- `class DownloadFailed: Schema.Error { why, hint }`

### Emulation

Emulated settings: viewport, locale, time zone, media features, network conditions and more.

*models*

- `type Locale = typeof Locale.Type`
- `type TimeZoneId = typeof TimeZoneId.Type`
- `interface Viewport`
  - `readonly width: number`
  - `readonly height: number`
  - `readonly deviceScaleFactor?: number | undefined`
  - `readonly mobile?: boolean | undefined`
- `interface Media`
  - `readonly type?: "screen" | "print" | undefined`
  - `readonly colorScheme?: "light" | "dark" | "noPreference" | undefined`
  - `readonly reducedMotion?: "reduce" | "noPreference" | undefined`
  - `readonly forcedColors?: "active" | "none" | undefined`
  - `readonly contrast?: "more" | "less" | "custom" | "noPreference" | undefined`
- `interface NetworkConditions`
  - `readonly download: number`
  - `readonly upload: number`
  - `readonly latency: Duration.Input`
- `interface Geolocation`
  - `readonly latitude: number`
  - `readonly longitude: number`
  - `readonly accuracy?: number | undefined`
- `interface Emulation`
  - `readonly extraHTTPHeaders?: Readonly<Record<string, string>> | undefined`
  - `readonly viewport?: Viewport | undefined`
  - `readonly userAgent?: string | undefined`
  - `readonly locale?: Locale | string | undefined`
  - `readonly timezone?: TimeZoneId | string | undefined`
  - `readonly geolocation?: Geolocation | "unavailable" | undefined`
  - `readonly media?: Media | undefined`
  - `readonly network?: NetworkConditions | "offline" | undefined`
  - `readonly cpuSlowdown?: number | undefined`
  - `readonly javaScript?: "enabled" | "disabled" | undefined`
  - `readonly touch?: boolean | undefined`

*schemas*

- `const Locale = Schema.String.pipe(Schema.check(Schema.makeFilter((input: string) => { try { return Intl.getCanonicalLocales(input).length === 1 } catch { return false } }, { expected: "a BCP 47 language tag, such a…`
- `const TimeZoneId = Schema.String.pipe(Schema.check(Schema.makeFilter((input: string) => { try { new Intl.DateTimeFormat(undefined, { timeZone: input }) return true } catch { return false } }, { expected: "an IANA time …`

### Expect

Expectations that retry: each `Expect.to*` checks until it passes or the deadline passes.

*models*

- `type Matcher<S> = (subject: S) => Effect.Effect<void, ExpectationFailed | Target.TargetGone>`
- `interface DualMatcher<S, Args extends ReadonlyArray<unknown>>`
  - `(...args: Args): (subject: S) => Effect.Effect<void, ExpectationFailed | Target.TargetGone>`
  - `(subject: S, ...args: Args): Effect.Effect<void, ExpectationFailed | Target.TargetGone>`

*combinators*

- `const withCheckInterval`
  - `(interval: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>`
  - `<A, E, R>(self: Effect.Effect<A, E, R>, interval: Duration.Input): Effect.Effect<A, E, R>`

*matchers*

- `const toBeVisible: Matcher<Locator.ReadonlyLocator>`
- `const toBeInViewport: DualMatcher<Locator.ReadonlyLocator, [options?: { readonly ratio?: number | undefined readonly inViewport?: boolean | undefined } | undefined]>`
- `const toBeHidden: Matcher<Locator.ReadonlyLocator>`
- `const toBeEnabled: Matcher<Locator.ReadonlyLocator>`
- `const toBeDisabled: Matcher<Locator.ReadonlyLocator>`
- `const toBeChecked: Matcher<Locator.ReadonlyLocator>`
- `const toBeFocused: Matcher<Locator.ReadonlyLocator>`
- `const toBeEditable: Matcher<Locator.ReadonlyLocator>`
- `const toHaveText: DualMatcher< Locator.ReadonlyLocator, [expected: string | RegExp | ReadonlyArray<string | RegExp>] >`
- `const toHaveAccessibleName: DualMatcher< Locator.ReadonlyLocator, [expected: string | RegExp, options?: { readonly ignoreCase?: boolean | undefined } | undefined] >`
- `const toHaveClass: DualMatcher< Locator.ReadonlyLocator, [expected: string | RegExp | ReadonlyArray<string | RegExp>] >`
- `const toContainText: DualMatcher<Locator.ReadonlyLocator, [expected: string | RegExp]>`
- `const toHaveValue: DualMatcher<Locator.ReadonlyLocator, [expected: string | RegExp]>`
- `const toHaveValues: DualMatcher<Locator.ReadonlyLocator, [expected: ReadonlyArray<string | RegExp>]>`
- `const toHaveAttribute: DualMatcher< Locator.ReadonlyLocator, [name: string, expected?: string | RegExp | undefined] >`
- `const toHaveCSS: DualMatcher< Locator.ReadonlyLocator, [name: string, expected: string | RegExp, options?: { readonly not?: boolean | undefined readonly pseudo?: "before" | "after" | undefined } | undefined] >`
- `const toHaveCount: DualMatcher<Locator.ReadonlyLocator, [count: number]>`
- `const toMatchAria: DualMatcher<Locator.ReadonlyLocator, [pattern: AriaPattern.AriaPattern]>`
- `const toHaveURL: DualMatcher<Page.ReadonlyPage, [expected: string | RegExp]>`
- `const toHaveTitle: DualMatcher<Page.ReadonlyPage, [expected: string | RegExp]>`
- `const that: <A, E, R>(subject: Effect.Effect<A, E, R>, condition: Condition.Condition<A>) => Effect.Effect<void, E | ExpectationFailed | Target.TargetGone, R>`

*references*

- `const CheckInterval: Context.Reference<Duration.Duration>`

*guards*

- `const isExpectationFailed: (u: unknown) => u is ExpectationFailed`

*errors*

- `class ExpectationFailed: Schema.TaggedError "ExpectationFailed" { subject, condition, last, history, elapsed, checks, nearest, suggestions, diagnostics }`

### FileChooser

File choosers: the file picker a page opens when a file input is clicked.

*models*

- `interface Decision`
  - `readonly [DecisionTypeId]: typeof DecisionTypeId`
- `type FileChooser = typeof FileChooser.Type`
- `type Pending = | { readonly _tag: "Single" select(file: FileInput.FileInput): Effect.Effect<Decision> readonly cancel: Effect.Effect<Decision> } | { readonly _tag: "Multiple" select(files: ReadonlyArray<FileInput.F…`
- `interface Filter`
  - `readonly multiple?: boolean | undefined`
- `type FileChooserErrorReason = typeof FileChooserErrorReason.Type`

*schemas*

- `const FileChooser = Schema.Union([Schema.TaggedStruct("Single", {}), Schema.TaggedStruct("Multiple", {})])`
- `const FileChooserErrorReason = Schema.Union([Reason.InvalidInput])`

*subscriptions*

- `const next: <PE = never, PR = never>(target: Page.Page, filter?: Filter | undefined, where?: Subscription.Where<FileChooser, PE, PR> | undefined) => Effect.Effect< Effect.Effect<FileChooser, PE | Target.TargetGone | Deadline.Timeout>, Subscription.SubscriptionError, Scope.Scope | PR >`
- `const stream: <PE = never, PR = never>(target: Page.Page, filter?: Filter | undefined, where?: Subscription.Where<FileChooser, PE, PR> | undefined) => Effect.Effect< Stream.Stream<FileChooser, PE | Subscription.EventOverflow | Target.TargetGone>, Subscription.SubscriptionError, Scope.Scope | PR >`

*getters*

- `const history: (target: Page.Page, filter?: Filter | undefined) => Effect.Effect<Subscription.History<FileChooser>, Subscription.SubscriptionError>`

*handlers*

- `const handle: <E, R>(page: Page.Page, handler: (chooser: Pending) => Effect.Effect<Decision, E, R>) => Effect.Effect<Declaration.HandlerRegistration, Declaration.DeclarationError | Target.TargetGone, Scope.Scope | R>`
- `const choose = (files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>) => (chooser: Pending): Effect.Effect<Decision, FileChooserError> => FileChooserImpl.choose(files)(chooser)`

*guards*

- `const isDecision: (u: unknown) => u is Decision`
- `const isFileChooserError: (u: unknown) => u is FileChooserError`

*errors*

- `class FileChooserError: Schema.TaggedError "FileChooserError" { reason, diagnostics }`
  - `override get cause(): unknown`

### FileInput

Files to upload, each saying where its bytes come from.

*models*

- `type FileName = typeof FileName.Type`
- `type MimeType = typeof MimeType.Type`
- `interface FileInput`
  - `readonly [TypeId]: typeof TypeId`

*schemas*

- `const FileName = Schema.String.pipe(Schema.brand("~@usestrider/browser/FileInput/FileName"))`
- `const MimeType = Schema.String.pipe(Schema.brand("~@usestrider/browser/FileInput/MimeType"))`

*constructors*

- `const local: (path: FilePath.Local | string) => FileInput`
- `const remote: (path: FilePath.Remote) => FileInput`
- `const bytes: (name: FileName | string, mimeType: MimeType | string, data: Uint8Array) => FileInput`

*guards*

- `const isFileInput: (u: unknown) => u is FileInput`

### FilePath

File paths, branded by which machine they're on.

*models*

- `type Local = typeof Local.Type`
- `type Remote = typeof Remote.Type`

*schemas*

- `const Local = Schema.String.pipe(Schema.brand("~@usestrider/browser/FilePath/Local"))`
- `const Remote = Schema.String.pipe(Schema.brand("~@usestrider/browser/FilePath/Remote"))`

### Har

HAR recordings: a page's or context's network traffic, exported as an HTTP Archive.

*models*

- `type SecretClass = "credentials" | "cookies" | "authorizationHeaders" | "typedText" | "requestBodies"` (experimental)
- `interface Options` (experimental)
  - `readonly content: "embed" | "attach" | "omit"`
  - `readonly detail?: "full" | "minimal" | undefined`
  - `readonly url?: Url.Pattern | string | undefined`
  - `readonly webSocketFrames?: boolean | undefined`
  - `readonly inFlightAtStop?: "wait" | "markIncomplete" | undefined`
- `interface ExportOptions` (experimental)
  - `readonly include?: ReadonlyArray<SecretClass> | undefined`
- `interface Recording extends Declaration.Registration` (experimental)
  - `readonly entries: WatchableApi.Watchable<number>`
  - `exportHar(path: FilePath.Local | string, options?: ExportOptions | undefined): Effect.Effect<FilePath.Local, HarError>`
- `type HarErrorReason = typeof HarErrorReason.Type` (experimental)

*schemas*

- `const HarErrorReason = Schema.Union([WriteFailed, ReadFailed, Reason.InvalidInput, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])` (experimental)

*constructors*

- `const record: (target: UserContext.UserContext | Page.Page, options: Options) => Effect.Effect<Recording, HarError | Target.TargetGone | Deadline.Timeout, Scope.Scope>` (experimental)

*guards*

- `const isHarError: (u: unknown) => u is HarError` (experimental)

*errors*

- `class HarError: Schema.TaggedError "HarError" { reason, diagnostics }` (experimental)
  - `override get cause(): unknown`

*reasons*

- `class WriteFailed: Schema.Error { path, hint, cause }` (experimental)
- `class ReadFailed: Schema.Error { path, hint, cause }` (experimental)

### InitScript

Init scripts: code that runs at the start of every new document of a page or context, before the page's own scripts.

*models*

- `type Id = typeof Id.Type`
- `interface InitScript extends Declaration.Registration`
  - `readonly id: Id`
- `type Source = | (() => void) | { readonly source: string } | { readonly path: FilePath.Local | string }`
- `interface Options`
  - `readonly world?: "main" | "isolated" | undefined`
  - `readonly after?: ReadonlyArray<InitScript> | undefined`
  - `readonly timing?: "beforeAuthorScript" | "bestEffort" | undefined`
  - `readonly workers?: boolean | undefined`

*schemas*

- `const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/InitScript/Id"))`

### JSHandle

Handles to values in the page, and the type of what an evaluation returns by value.

*models*

- `interface JSHandle<A = unknown> extends Pipeable.Pipeable, Inspectable.Inspectable`
  - `readonly [TypeId]: typeof TypeId`
  - `readonly realm: Target.RealmId`
  - `evaluate<Args extends ReadonlyArray<unknown>, B>(fn: (value: A, ...args: Args) => B | Promise<B>, ...args: Args): Effect.Effect<Serialized<B>, JSHandleError | …`
  - `evaluateHandle<Args extends ReadonlyArray<unknown>, B>(fn: (value: A, ...args: Args) => B | Promise<B>, ...args: Args): Effect.Effect<JSHandle<Awaited<B>>, JSH…`
  - `readonly read: Effect.Effect<Serialized<A>, JSHandleError | Target.TargetGone | Deadline.Timeout>`
  - `readonly release: Effect.Effect<void>`
- `type JSHandleErrorReason = typeof JSHandleErrorReason.Type`

*schemas*

- `const JSHandleErrorReason = Schema.Union([Reason.EvaluationThrown, Reason.NotSerializable, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])`

*guards*

- `const isJSHandle: (u: unknown) => u is JSHandle`
- `const isJSHandleError: (u: unknown) => u is JSHandleError`

*errors*

- `class JSHandleError: Schema.TaggedError "JSHandleError" { operation, reason, diagnostics }`
  - `override get cause(): unknown`

*utility types*

- `interface NotSerializable<Message extends string>`
  - `readonly [NotSerializableTypeId]: Message`
- `type Serialized<A> = A extends string | number | boolean | bigint | null | undefined | Date | RegExp ? A : A extends ReadonlyMap<infer K, infer V> ? Map<Serialized<K>, Serialized<V>> : A extends ReadonlySet<infer T> ? Se…`

### Keyboard

Keys sent to whatever has focus, for what an action on a locator can't express.

*models*

- `type Key = typeof Key.Type`
- `type Modifier = "Alt" | "Control" | "Meta" | "Shift"`
- `type Layout = "us" | "uk" | "de" | "fr" | "es" | "it"`
- `interface PressOptions`
  - `readonly modifiers?: ReadonlyArray<Modifier> | undefined`
- `interface TypeOptions`
  - `readonly delay?: Duration.Input | undefined`
- `interface HeldKey`
  - `readonly release: Effect.Effect<void>`
- `interface Keyboard`
  - `press(key: Key | string, options?: PressOptions | undefined): Effect.Effect<void, KeyboardError | Target.TargetGone | Deadline.Timeout>`
  - `pressSequentially(text: string | Redacted.Redacted<string>, options?: TypeOptions | undefined): Effect.Effect<void, KeyboardError | Target.TargetGone | Deadlin…`
  - `insertText(text: string | Redacted.Redacted<string>): Effect.Effect<void, KeyboardError | Target.TargetGone | Deadline.Timeout>`
  - `hold(key: Key | string): Effect.Effect<HeldKey, KeyboardError | Target.TargetGone | Deadline.Timeout, Scope.Scope>`
- `type KeyboardErrorReason = typeof KeyboardErrorReason.Type`

*schemas*

- `const Key = Schema.String.pipe(Schema.brand("~@usestrider/browser/Keyboard/Key"))`
- `const KeyboardErrorReason = Schema.Union([Reason.InvalidInput, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])`

*guards*

- `const isKeyboardError: (u: unknown) => u is KeyboardError`

*errors*

- `class KeyboardError: Schema.TaggedError "KeyboardError" { operation, reason, diagnostics }`
  - `override get cause(): unknown`

### LaunchProfile

The flags and preferences a browser is launched with, as values you can inspect.

*models*

- `class LaunchProfile: Schema.Class { name, args, prefs }`

*constants*

- `const stock: LaunchProfile`
- `const automation: LaunchProfile`
- `const concurrent: LaunchProfile`

### Ledger

A record of what a program owns outside itself: the browsers it launched, and the directories it made for them.

*layers*

- `const layer: (directory: string) => Layer.Layer<never, never, FileSystem.FileSystem | Path.Path>` (experimental)

*models*

- `type Item = typeof Item.Type` (experimental)
- `class Record: Schema.Class { owner, items }` (experimental)
- `interface Ledger` (experimental)
  - `readonly add: (item: Item) => Effect.Effect<void>`
  - `readonly remove: (item: Item) => Effect.Effect<void>`

*schemas*

- `const Item = Schema.Union([Schema.TaggedStruct("Browser", { pid: Schema.Number, executable: Schema.String, profile: Schema.String }), Schema.TaggedStruct("Directory", { path: Schema.String })])` (experimental)

*getters*

- `const read: (directory: string) => Effect.Effect< ReadonlyArray<{ readonly file: string; readonly record: Record }>, never, FileSystem.FileSystem | Path.Path >` (experimental)

*references*

- `const CurrentLedger: Context.Reference<Ledger>` (experimental)

### Locator

Locators: how to find elements on a page, and the actions and reads that use them.

*models*

- `interface RoleOptions`
  - `readonly level?: number | undefined`
  - `readonly checked?: boolean | undefined`
  - `readonly pressed?: boolean | undefined`
  - `readonly expanded?: boolean | undefined`
  - `readonly selected?: boolean | undefined`
  - `readonly disabled?: boolean | undefined`
  - `readonly name?: string | RegExp | undefined`
  - `readonly exact?: boolean | undefined`
  - `readonly includeHidden?: boolean | undefined`
- `interface TextOptions`
  - `readonly exact?: boolean | undefined`
- `interface Queries<L>`
  - `getByRole(role: AriaRole.AriaRole, options?: RoleOptions | undefined): L`
  - `getByText(text: string | RegExp, options?: TextOptions | undefined): L`
  - `getByLabel(text: string | RegExp, options?: TextOptions | undefined): L`
  - `getByPlaceholder(text: string | RegExp, options?: TextOptions | undefined): L`
  - `getByAltText(text: string | RegExp, options?: TextOptions | undefined): L`
  - `getByTitle(text: string | RegExp, options?: TextOptions | undefined): L`
  - `getByTestId(id: string): L`
  - `locator(css: string): L`
- `interface FilterOptions`
  - `readonly has?: RelativeLocator | undefined`
  - `readonly hasNot?: RelativeLocator | undefined`
  - `readonly hasText?: string | RegExp | undefined`
  - `readonly hasNotText?: string | RegExp | undefined`
  - `readonly visible?: boolean | undefined`
- `interface ReadonlyLocator extends Queries<ReadonlyLocator>, Pipeable.Pipeable, Equal.Equal, Inspectable.Inspectable`
  - `readonly [TypeId]: typeof TypeId`
  - `frame(iframe: ReadonlyLocator): ReadonlyFrameLocator`
  - `filter(options: FilterOptions): ReadonlyLocator`
  - `and(other: ReadonlyLocator): ReadonlyLocator`
  - `or(other: ReadonlyLocator): ReadonlyLocator`
  - `nth(index: number): ReadonlyLocator`
  - `readonly first: ReadonlyLocator`
  - `readonly last: ReadonlyLocator`
  - `describe(label: string): ReadonlyLocator`
  - `readonly count: Effect.Effect<number, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `readonly readText: Effect.Effect<string, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `readonly readValue: Effect.Effect<string, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `readonly readHtml: Effect.Effect<string, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `readAttribute(name: string): Effect.Effect<Option.Option<string>, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `readonly isVisible: Effect.Effect<boolean, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `readonly isEditable: Effect.Effect<boolean, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `readonly isEnabled: Effect.Effect<boolean, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `readonly isChecked: Effect.Effect<boolean, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `readonly all: Effect.Effect<ReadonlyArray<ReadonlyLocator>, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `snapshot(options?: Snapshot.Options | undefined): Effect.Effect<Snapshot.Snapshot<ReadonlyLocator>, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `evaluate<Args extends ReadonlyArray<unknown>, B>(fn: (element: Element, ...args: Args) => B | Promise<B>, ...args: Args): Effect.Effect<JSHandle.Serialized<B>,…`
  - `evaluateAll<Args extends ReadonlyArray<unknown>, B>(fn: (elements: Array<Element>, ...args: Args) => B | Promise<B>, ...args: Args): Effect.Effect<JSHandle.Ser…`
- `interface Checks`
  - `readonly rendered?: boolean | undefined`
  - `readonly visible?: boolean | undefined`
  - `readonly enabled?: boolean | undefined`
  - `readonly editable?: boolean | undefined`
  - `readonly notInert?: boolean | undefined`
  - `readonly inViewport?: boolean | undefined`
  - `readonly receivesPointer?: boolean | undefined`
  - `readonly stable?: boolean | { readonly frames: number } | undefined`
- `interface ActionOptions`
  - `readonly checks?: Checks | undefined`
  - `readonly trial?: boolean | undefined`
- `interface DispatchEventOptions`
  - `readonly trial?: boolean | undefined`
  - `readonly eventClass?: | "Event" | "CustomEvent" | "MouseEvent" | "KeyboardEvent" | "PointerEvent" | "FocusEvent" | "WheelEvent" | "InputEvent" | "DragEvent" | …`
  - `readonly init?: Readonly<Record<string, unknown>> | undefined`
- `interface PointerOptions extends ActionOptions`
  - `readonly position?: Mouse.Point | undefined`
  - `readonly modifiers?: ReadonlyArray<Keyboard.Modifier> | undefined`
- `interface ClickOptions extends PointerOptions`
  - `readonly button?: Mouse.Button | undefined`
- `interface DragOptions extends PointerOptions`
  - `readonly targetPosition?: Mouse.Point | undefined`
  - `readonly steps?: number | undefined`
  - `readonly html?: "native" | "synthetic" | undefined`
- `interface PressOptions extends ActionOptions, Keyboard.PressOptions`
- `interface TypeOptions extends ActionOptions, Keyboard.TypeOptions`
- `type SelectOption = | { readonly value: string } | { readonly label: string } | { readonly index: number }`
- `interface Locator extends ReadonlyLocator`
  - `dispatchEvent(type: string, options?: DispatchEventOptions | undefined): ActionEffect`
  - `getByRole(role: AriaRole.AriaRole, options?: RoleOptions | undefined): Locator`
  - `getByText(text: string | RegExp, options?: TextOptions | undefined): Locator`
  - `getByLabel(text: string | RegExp, options?: TextOptions | undefined): Locator`
  - `getByPlaceholder(text: string | RegExp, options?: TextOptions | undefined): Locator`
  - `getByAltText(text: string | RegExp, options?: TextOptions | undefined): Locator`
  - `getByTitle(text: string | RegExp, options?: TextOptions | undefined): Locator`
  - `getByTestId(id: string): Locator`
  - `locator(css: string): Locator`
  - `frame(iframe: ReadonlyLocator): FrameLocator`
  - `filter(options: FilterOptions): Locator`
  - `and(other: ReadonlyLocator): Locator`
  - `or(other: ReadonlyLocator): Locator`
  - `nth(index: number): Locator`
  - `readonly first: Locator`
  - `readonly last: Locator`
  - `describe(label: string): Locator`
  - `readonly all: Effect.Effect<ReadonlyArray<Locator>, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `snapshot(options?: Snapshot.Options | undefined): Effect.Effect<Snapshot.Snapshot<Locator>, LocatorError | Target.TargetGone | Deadline.Timeout>`
  - `click(options?: ClickOptions | undefined): ActionEffect`
  - `dblclick(options?: ClickOptions | undefined): ActionEffect`
  - `tap(options?: PointerOptions | undefined): ActionEffect`
  - `hover(options?: PointerOptions | undefined): ActionEffect`
  - `check(options?: PointerOptions | undefined): ActionEffect`
  - `uncheck(options?: PointerOptions | undefined): ActionEffect`
  - `focus(options?: ActionOptions | undefined): ActionEffect`
  - `blur(options?: ActionOptions | undefined): ActionEffect`
  - `clear(options?: ActionOptions | undefined): ActionEffect`
  - `scrollIntoView(options?: ActionOptions | undefined): ActionEffect`
  - `fill(value: string | Redacted.Redacted<string>, options?: ActionOptions | undefined): ActionEffect`
  - `press(key: Keyboard.Key | string, options?: PressOptions | undefined): ActionEffect`
  - `pressSequentially(text: string | Redacted.Redacted<string>, options?: TypeOptions | undefined): ActionEffect`
  - `selectText(options?: ActionOptions | undefined): ActionEffect`
  - `selectOption(choice: SelectOption | ReadonlyArray<SelectOption>, options?: ActionOptions | undefined): ActionEffect`
  - `setInputFiles(files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>, options?: ActionOptions | undefined): ActionEffect`
  - `dragTo(target: ReadonlyLocator, options?: DragOptions | undefined): ActionEffect`
- `interface RelativeLocator extends Queries<RelativeLocator>`
  - `readonly [RelativeLocatorTypeId]: typeof RelativeLocatorTypeId`
- `interface ReadonlyFrameLocator extends Queries<ReadonlyLocator>`
  - `readonly owner: ReadonlyLocator`
  - `frame(iframe: ReadonlyLocator): ReadonlyFrameLocator`
- `interface FrameLocator extends ReadonlyFrameLocator`
  - `getByRole(role: AriaRole.AriaRole, options?: RoleOptions | undefined): Locator`
  - `getByText(text: string | RegExp, options?: TextOptions | undefined): Locator`
  - `getByLabel(text: string | RegExp, options?: TextOptions | undefined): Locator`
  - `getByPlaceholder(text: string | RegExp, options?: TextOptions | undefined): Locator`
  - `getByAltText(text: string | RegExp, options?: TextOptions | undefined): Locator`
  - `getByTitle(text: string | RegExp, options?: TextOptions | undefined): Locator`
  - `getByTestId(id: string): Locator`
  - `locator(css: string): Locator`
  - `frame(iframe: ReadonlyLocator): FrameLocator`
- `type LocatorErrorReason = typeof LocatorErrorReason.Type`

*schemas*

- `const LocatorErrorReason = Schema.Union([StrictViolation, StaleRef, NoMatch, WrongElement, StateUnchanged, NotEditable, FileUnreadable, Reason.InvalidInput, Reason.EvaluationThrown, Reason.NotSerializable, Reason.NotPermitted,…`

*constructors*

- `const relative: Queries<RelativeLocator>`

*guards*

- `const isLocator: (u: unknown) => u is ReadonlyLocator`
- `const isLocatorError: (u: unknown) => u is LocatorError`

*errors*

- `class LocatorError: Schema.TaggedError "LocatorError" { operation, locator, reason, diagnostics }`
  - `override get cause(): unknown`

*reasons*

- `class StrictViolation: Schema.Error { candidates, suggestions, hint }`
- `class StaleRef: Schema.Error { why, hint }`
- `class NoMatch: Schema.Error { hint }`
- `class WrongElement: Schema.Error { expected, element, hint }`
- `class StateUnchanged: Schema.Error { expected, hint }`
- `class NotEditable: Schema.Error { element, hint }`
- `class FileUnreadable: Schema.Error { path, hint, cause }`

### MonotonicInstant

Instants on the real monotonic clock, used for deadlines and event timestamps.

*models*

- `type MonotonicInstant = typeof MonotonicInstant.Type`

*schemas*

- `const MonotonicInstant = Schema.Number.pipe(Schema.brand("~@usestrider/browser/MonotonicInstant"))`

### Mouse

Pointer input at coordinates, for interfaces such as canvases that locators can't reach.

*models*

- `interface Point`
  - `readonly x: Pixels.Css | number`
  - `readonly y: Pixels.Css | number`
- `type Button = "left" | "right" | "middle"`
- `interface MoveOptions`
  - `readonly steps?: number | undefined`
- `interface ClickOptions`
  - `readonly button?: Button | undefined`
  - `readonly clickCount?: number | undefined`
  - `readonly modifiers?: ReadonlyArray<Keyboard.Modifier> | undefined`
- `interface HeldButton`
  - `readonly release: Effect.Effect<void>`
- `interface Mouse`
  - `readonly position: Effect.Effect<Point>`
  - `move(to: Point, options?: MoveOptions | undefined): Effect.Effect<void, MouseError | Target.TargetGone | Deadline.Timeout>`
  - `click(at: Point, options?: ClickOptions | undefined): Effect.Effect<void, MouseError | Target.TargetGone | Deadline.Timeout>`
  - `hold(button: Button): Effect.Effect<HeldButton, MouseError | Target.TargetGone | Deadline.Timeout, Scope.Scope>`
  - `wheel(delta: Point): Effect.Effect<void, MouseError | Target.TargetGone | Deadline.Timeout>`
- `type MouseErrorReason = typeof MouseErrorReason.Type`

*schemas*

- `const MouseErrorReason = Schema.Union([Reason.InvalidInput, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])`

*guards*

- `const isMouseError: (u: unknown) => u is MouseError`

*errors*

- `class MouseError: Schema.TaggedError "MouseError" { operation, reason, diagnostics }`
  - `override get cause(): unknown`

### NetworkConnection

The WebSockets and event sources a page opens: connections that stay open and carry messages.

*models*

- `type Id = typeof Id.Type`
- `type Kind = "webSocket" | "eventSource"`
- `class Frame: Schema.Class { direction, payload, at }`
- `interface NetworkConnection extends Pipeable.Pipeable, Inspectable.Inspectable`
  - `readonly [TypeId]: typeof TypeId`
  - `readonly id: Id`
  - `readonly kind: Kind`
  - `readonly url: Url.Url`
  - `readonly openedAt: DateTime.Utc`
  - `readonly frames: Effect.Effect< Stream.Stream<Frame, Subscription.EventOverflow | Target.TargetGone>, Subscription.SubscriptionError, Scope.Scope >`
  - `readonly closed: Effect.Effect<Target.CloseReason>`
- `interface Filter`
  - `readonly url?: Url.Pattern | string | undefined`
  - `readonly kind?: Kind | undefined`

*schemas*

- `const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/NetworkConnection/Id"))`

*subscriptions*

- `const next: <PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined, where?: Subscription.Where<NetworkConnection, PE, PR> | undefined) => Effect.Effect< Effect.Effect<NetworkConnection, PE | Target.TargetGone | Deadline.Timeout>, Subscription.SubscriptionError, Scope.Scope | PR >`
- `const stream: <PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined, where?: Subscription.Where<NetworkConnection, PE, PR> | undefined) => Effect.Effect< Stream.Stream<NetworkConnection, PE | Subscription.EventOverflow | Target.TargetGone>, Subscription.SubscriptionError, Scope.Scope | PR >`

*getters*

- `const history: (target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined) => Effect.Effect<Subscription.History<NetworkConnection>, Subscription.SubscriptionError>`

*guards*

- `const isNetworkConnection: (u: unknown) => u is NetworkConnection`

### NetworkRequest

The requests a page or context sends, as events and as the data routes and responses refer to.

*models*

- `type Id = typeof Id.Type`
- `type HopId = typeof HopId.Type`
- `type ResourceType = typeof ResourceType.Type`
- `type Initiator = typeof Initiator.Type`
- `class NetworkRequest: Schema.Class { hop, method, url, headers, resourceType, initiator, at }`
- `interface Filter`
  - `readonly url?: Url.Pattern | string | undefined`
  - `readonly method?: HttpMethod.HttpMethod | undefined`
  - `readonly resourceType?: ResourceType | ReadonlyArray<ResourceType> | undefined`

*schemas*

- `const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/NetworkRequest/Id"))`
- `const HopId = Schema.String.pipe(Schema.brand("~@usestrider/browser/NetworkRequest/HopId"))`
- `const ResourceType = Schema.Literals(["document", "stylesheet", "image", "media", "font", "script", "fetch", "xhr", "webSocket", "eventSource", "manifest", "ping", "other"])`
- `const Initiator = Schema.Union([Schema.TaggedStruct("Document", { navigable: Target.NavigableId, navigation: Schema.Option(Schema.String.pipe(Schema.brand("~@usestrider/browser/PageNavigation/Id"))) }), Schema.TaggedS…`
- `const Method = Schema.Literals(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "TRACE", "QUERY"] as const satisfies ReadonlyArray<HttpMethod.HttpMethod>)`

*subscriptions*

- `const next: <PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter: Filter & { readonly url: Url.Pattern | string }, where?: Subscription.Where<NetworkRequest, PE, PR> | undefined) => Effect.Effect< Effect.Effect<NetworkRequest, PE | Target.TargetGone | Deadline.Timeout>, Subscription.SubscriptionError, Scope.Scope | PR >`
- `const stream: <PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined, where?: Subscription.Where<NetworkRequest, PE, PR> | undefined) => Effect.Effect< Stream.Stream<NetworkRequest, PE | Subscription.EventOverflow | Target.TargetGone>, Subscription.SubscriptionError, Scope.Scope | PR >`
- `const response: (target: Page.ObservedPage | UserContext.ObservedUserContext, request: NetworkRequest) => Effect.Effect< Effect.Effect<Option.Option<NetworkResponse.NetworkResponse>, RequestError | Deadline.Timeout>, RequestError, Scope.Scope >`

*getters*

- `const history: (target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined) => Effect.Effect<Subscription.History<NetworkRequest>, Subscription.SubscriptionError>`
- `const headersSent: (target: Page.ObservedPage | UserContext.ObservedUserContext, request: NetworkRequest) => Effect.Effect<Headers.Headers, Deadline.Timeout>`

*converting*

- `const toHttpClientRequest: (request: NetworkRequest) => HttpClientRequest.HttpClientRequest`

*errors*

- `class RequestError: Schema.TaggedError "RequestError" { hop, reason, diagnostics }`

*reasons*

- `class ResponseUnavailable: Schema.Error { why }`

### NetworkResponse

The responses a page or context receives, with their bodies when a subscription asks for them.

*models*

- `type StatusCode = typeof StatusCode.Type`
- `type ServedBy = typeof ServedBy.Type`
- `class NetworkResponse: Schema.Class { hop, url, status, statusText, httpVersion, headers, servedBy, at }`
- `interface CapturedResponse<B> extends NetworkResponse, HttpIncomingMessage.HttpIncomingMessage<ResponseError>`
  - `readonly body: B`
- `type BodyDecoder<B, DE, DR> = (message: HttpIncomingMessage.HttpIncomingMessage<ResponseError>) => Effect.Effect<B, DE, DR>`
- `interface Filter`
  - `readonly url?: Url.Pattern | string | undefined`
  - `readonly method?: HttpMethod.HttpMethod | undefined`
  - `readonly status?: StatusCode | number | ((status: StatusCode) => boolean) | undefined`
- `type ResponseErrorReason = typeof ResponseErrorReason.Type`

*schemas*

- `const StatusCode = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 100, maximum: 599 })), Schema.brand("~@usestrider/browser/NetworkResponse/StatusCode"))`
- `const ServedBy = Schema.Literals(["network", "cache", "serviceWorker", "cacheOrServiceWorker", "route", "unknown"])`
- `const ResponseErrorReason = Schema.Union([BodyUnavailable, MalformedBody, Reason.BackendFailure])`

*combinators*

- `const withBodyLimit`
  - `(limit: ByteSize.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>`
  - `<A, E, R>(self: Effect.Effect<A, E, R>, limit: ByteSize.Input): Effect.Effect<A, E, R>`

*subscriptions*

- `const next`
  - `<B, DE, DR, PE = never, PR = never>(target: Page.ReadonlyPage | UserContext.UserContext, filter: Filter & { readonly url: Url.Pattern | string readonly body: B…`
  - `<PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter: Filter & { readonly url: Url.Pattern | string }, where?: Subscrip…`
- `const stream`
  - `<B, DE, DR, PE = never, PR = never>(target: Page.ReadonlyPage | UserContext.UserContext, filter: Filter & { readonly body: BodyDecoder<B, DE, DR> }, where?: Su…`
  - `<PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined, where?: Subscription.Where<NetworkResponse, …`

*getters*

- `const history: (target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined) => Effect.Effect<Subscription.History<NetworkResponse>, Subscription.SubscriptionError>`

*references*

- `const BodyLimit: Context.Reference<ByteSize.ByteSize>`

*guards*

- `const isResponseError: (u: unknown) => u is ResponseError`

*errors*

- `class ResponseError: Schema.TaggedError "ResponseError" { url, reason, diagnostics }`
  - `override get cause(): unknown`

*reasons*

- `class BodyUnavailable: Schema.Error { why, hint }`
- `class MalformedBody: Schema.Error { expected, hint }`

### Operation

Operations of your own, kept as the library keeps its: one deadline for everything inside, and a `Timeout` that says how far the operation got.

*tags*

- `class Current: Context.Service {  }`

*models*

- `interface Operation`
  - `readonly [TypeId]: typeof TypeId`
  - `readonly name: string`
  - `readonly id: Diagnostics.OperationId`
- `interface Options`
  - `readonly attributes?: Readonly<Record<string, unknown>> | undefined`
- `interface Fn`
  - `<Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>>(body: (...args: Args) => Generator<Eff, AEff, never>): (...args: Args) => Run<Eff, AE…`
  - `<Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A>(body: (...args: Args) => Generator<Eff, AEff, never>, a: (_: Run<Eff, AEff>, ...ar…`
  - `<Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B>(body: (...args: Args) => Generator<Eff, AEff, never>, a: (_: Run<Eff, AEff>, ..…`
  - `<Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C>(body: (...args: Args) => Generator<Eff, AEff, never>, a: (_: Run<Eff, AEff>,…`
  - `<Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D>(body: (...args: Args) => Generator<Eff, AEff, never>, a: (_: Run<Eff, AEf…`
  - `<Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D, E>(body: (...args: Args) => Generator<Eff, AEff, never>, a: (_: Run<Eff, …`
  - `<Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D, E, F>(body: (...args: Args) => Generator<Eff, AEff, never>, a: (_: Run<Ef…`
  - `<Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D, E, F, G>(body: (...args: Args) => Generator<Eff, AEff, never>, a: (_: Run…`
  - `<Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D, E, F, G, H>(body: (...args: Args) => Generator<Eff, AEff, never>, a: (_: …`
  - `<Eff extends Effect.Effect<any, any, any>, AEff, Args extends Array<any>, A, B, C, D, E, F, G, H, I>(body: (...args: Args) => Generator<Eff, AEff, never>, a: (…`

*constructors*

- `const fn: (name: string, options?: Options | undefined) => Fn`

*combinators*

- `const named`
  - `(name: string, options?: Options | undefined): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Current>>`
  - `<A, E, R>(self: Effect.Effect<A, E, R>, name: string, options?: Options | undefined): Effect.Effect<A, E, Exclude<R, Current>>`
- `const markSent: Effect.Effect<void, never, Current>`
- `const observe: (value: unknown) => Effect.Effect<void, never, Current>`
- `const bound: <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Deadline.Timeout, R | Current>`

### OriginStorage

`localStorage` and `sessionStorage`, for the origin of a page's current document.

*models*

- `interface ReadonlyOriginStorage`
  - `readonly entries: Effect.Effect< ReadonlyArray<readonly [key: string, value: string]>, OriginStorageError | Target.TargetGone | Deadline.Timeout >`
  - `get(key: string): Effect.Effect<Option.Option<string>, OriginStorageError | Target.TargetGone | Deadline.Timeout>`
- `interface OriginStorage extends ReadonlyOriginStorage`
  - `set(key: string, value: string | Redacted.Redacted<string>): Effect.Effect<void, OriginStorageError | Target.TargetGone | Deadline.Timeout>`
  - `remove(key: string): Effect.Effect<void, OriginStorageError | Target.TargetGone | Deadline.Timeout>`
  - `readonly clear: Effect.Effect<void, OriginStorageError | Target.TargetGone | Deadline.Timeout>`
- `type OriginStorageErrorReason = typeof OriginStorageErrorReason.Type`

*schemas*

- `const OriginStorageErrorReason = Schema.Union([Reason.InvalidInput, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])`

*guards*

- `const isOriginStorageError: (u: unknown) => u is OriginStorageError`

*errors*

- `class OriginStorageError: Schema.TaggedError "OriginStorageError" { operation, reason, diagnostics }`
  - `override get cause(): unknown`

### Page

Pages, at three access levels: `ObservedPage` ⊂ `ReadonlyPage` ⊂ `Page`, like `ReadonlyArray` ⊂ `Array`.

*models*

- `type ViewportSize = typeof ViewportSize.Type`
- `type DocumentStatus = typeof DocumentStatus.Type`
- `type Prompt = typeof Prompt.Type`
- `type Status = typeof Status.Type`
- `interface FrameTree`
  - `readonly id: Target.NavigableId`
  - `readonly url: Url.Url`
  - `readonly name: Option.Option<string>`
  - `readonly children: ReadonlyArray<FrameTree>`
- `interface FrameTreeEncoded`
  - `readonly id: string`
  - `readonly url: string`
  - `readonly name: Option.Option<string>`
  - `readonly children: ReadonlyArray<FrameTreeEncoded>`
- `type ScreenshotOptions = ScreenshotFormat & { readonly area?: | "viewport" | "fullPage" | { readonly clip: { readonly x: Pixels.Css readonly y: Pixels.Css readonly width: Pixels.Css readonly height: Pixels.Css } readonly ele…`
- `type ScreenshotFormat = | { readonly format?: "png" | undefined readonly quality?: undefined } | { readonly format: "jpeg" readonly quality: number }`
- `interface Length`
  - `readonly value: number`
  - `readonly unit: "in" | "cm" | "mm" | "px"`
- `interface PdfOptions`
  - `readonly paper?: | "letter" | "legal" | "tabloid" | "a3" | "a4" | "a5" | { readonly width: Length; readonly height: Length } | undefined`
  - `readonly landscape?: boolean | undefined`
  - `readonly margins?: { readonly top?: Length | undefined readonly right?: Length | undefined readonly bottom?: Length | undefined readonly left?: Length | undefi…`
  - `readonly scale?: number | undefined`
  - `readonly background?: boolean | undefined`
  - `readonly pageRanges?: string | undefined`
  - `readonly preferCssPageSize?: boolean | undefined`
  - `readonly header?: string | undefined`
  - `readonly footer?: string | undefined`
- `interface GotoOptions`
  - `readonly waitUntil?: PageNavigation.LoadState | undefined`
  - `readonly accept?: ReadonlyArray<"download" | "noContent"> | undefined`
- `interface ReloadOptions`
  - `readonly waitUntil?: PageNavigation.LoadState | undefined`
  - `readonly bypassCache?: boolean | undefined`
- `interface TraverseOptions`
  - `readonly waitUntil?: PageNavigation.LoadState | undefined`
- `interface ObservedPage extends Pipeable.Pipeable, Equal.Equal, Inspectable.Inspectable`
  - `readonly [TypeId]: typeof TypeId`
  - `readonly id: Target.NavigableId`
  - `readonly status: Watchable.Watchable<Status>`
  - `readonly url: Watchable.Watchable<Url.Url>`
  - `readonly frames: Watchable.Watchable<FrameTree>`
  - `readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.ObservedBrowserWorker>>`
  - `readonly closed: Effect.Effect<Target.CloseReason>`
  - `readonly inspect: Effect.Effect<ReadonlyPage, PageError, Scope.Scope>`
  - `readonly control: Effect.Effect<Page, PageError, Scope.Scope>`
- `interface ReadonlyPage extends ObservedPage, Locator.Queries<Locator.ReadonlyLocator>`
  - `readonly viewportSize: Effect.Effect<Option.Option<ViewportSize>, PageError | Target.TargetGone | Deadline.Timeout>`
  - `frame(iframe: Locator.ReadonlyLocator): Locator.ReadonlyFrameLocator`
  - `readonly title: Effect.Effect<string, PageError | Target.TargetGone | Deadline.Timeout>`
  - `readonly readHtml: Effect.Effect<string, PageError | Target.TargetGone | Deadline.Timeout>`
  - `snapshot(options?: Snapshot.Options | undefined): Effect.Effect<Snapshot.Snapshot<Locator.ReadonlyLocator>, PageError | Target.TargetGone | Deadline.Timeout>`
  - `screenshot(options?: ScreenshotOptions | undefined): Effect.Effect<Uint8Array, PageError | Target.TargetGone | Deadline.Timeout>`
  - `pdf(options?: PdfOptions | undefined): Effect.Effect<Uint8Array, PageError | Target.TargetGone | Deadline.Timeout>`
  - `readonly localStorage: OriginStorage.ReadonlyOriginStorage`
  - `readonly sessionStorage: OriginStorage.ReadonlyOriginStorage`
  - `evaluate<Args extends ReadonlyArray<unknown>, A>(fn: (...args: Args) => A | Promise<A>, ...args: Args): Effect.Effect<JSHandle.Serialized<A>, PageError | Targe…`
  - `capability<H>(capability: Capability.Capability<H>): Effect.Effect<H, Capability.CapabilityError | Target.TargetGone | Deadline.Timeout, Scope.Scope>`
- `interface Page extends ReadonlyPage`
  - `capability<H>(capability: Capability.Capability<H, "inspect" | "control">): Effect.Effect< H, Capability.CapabilityError | Target.TargetGone | Deadline.Timeout…`
  - `getByRole(role: AriaRole.AriaRole, options?: Locator.RoleOptions | undefined): Locator.Locator`
  - `getByText(text: string | RegExp, options?: Locator.TextOptions | undefined): Locator.Locator`
  - `getByLabel(text: string | RegExp, options?: Locator.TextOptions | undefined): Locator.Locator`
  - `getByPlaceholder(text: string | RegExp, options?: Locator.TextOptions | undefined): Locator.Locator`
  - `getByAltText(text: string | RegExp, options?: Locator.TextOptions | undefined): Locator.Locator`
  - `getByTitle(text: string | RegExp, options?: Locator.TextOptions | undefined): Locator.Locator`
  - `getByTestId(id: string): Locator.Locator`
  - `locator(css: string): Locator.Locator`
  - `frame(iframe: Locator.ReadonlyLocator): Locator.FrameLocator`
  - `snapshot(options?: Snapshot.Options | undefined): Effect.Effect<Snapshot.Snapshot<Locator.Locator>, PageError | Target.TargetGone | Deadline.Timeout>`
  - `readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.BrowserWorker>>`
  - `readonly localStorage: OriginStorage.OriginStorage`
  - `readonly sessionStorage: OriginStorage.OriginStorage`
  - `readonly context: UserContext.UserContext`
  - `goto(url: Url.Url | string, options?: GotoOptions | undefined): Effect.Effect<PageNavigation.PageNavigation, PageError | Target.TargetGone | Deadline.Timeout>`
  - `setContent(html: string, options?: { readonly waitUntil?: PageNavigation.LoadState | undefined } | undefined): Effect.Effect<void, PageError | Target.TargetGon…`
  - `reload(options?: ReloadOptions | undefined): Effect.Effect<PageNavigation.PageNavigation, PageError | Target.TargetGone | Deadline.Timeout>`
  - `back(options?: TraverseOptions | undefined): Effect.Effect<Option.Option<PageNavigation.PageNavigation>, PageError | Target.TargetGone | Deadline.Timeout>`
  - `forward(options?: TraverseOptions | undefined): Effect.Effect<Option.Option<PageNavigation.PageNavigation>, PageError | Target.TargetGone | Deadline.Timeout>`
  - `evaluateInMainWorld<Args extends ReadonlyArray<unknown>, A>(fn: (...args: Args) => A | Promise<A>, ...args: Args): Effect.Effect<JSHandle.Serialized<A>, PageEr…`
  - `evaluateHandle<Args extends ReadonlyArray<unknown>, A>(fn: (...args: Args) => A | Promise<A>, ...args: Args): Effect.Effect<JSHandle.JSHandle<Awaited<A>>, Page…`
  - `readonly keyboard: Keyboard.Keyboard`
  - `readonly mouse: Mouse.Mouse`
  - `readonly clock: PageClock.PageClock`
  - `route<E, R, P extends Route.Phase = "request">(pattern: Url.Pattern | string, handler: Route.Handler<E, R, NoInfer<P>>, options: Route.Options<P> & { readonly …`
  - `route<E, R>(pattern: Url.Pattern | string, handler: Route.Handler<E, R>, options?: Route.Options | undefined): Effect.Effect<Route.Registration, Route.RouteErr…`
  - `route<E, R, P extends Route.Phase = "request">(pattern: Url.Pattern | string, handler: Route.Handler<E, R, NoInfer<P> | "request">, options?: Route.Options<P> …`
  - `route<E, R, P extends Route.Phase = "request", D extends Route.Phase = P | "request">(pattern: Url.Pattern | string, handler: RoutePhaseDiagnostic.Handler<E, R…`
  - `addInitScript(script: InitScript.Source, options?: InitScript.Options | undefined): Effect.Effect< InitScript.InitScript, Declaration.DeclarationError | Target…`
  - `emulate(settings: Emulation.Emulation): Effect.Effect< Declaration.Registration, Declaration.DeclarationError | Target.TargetGone | Deadline.Timeout, Scope.Sco…`
  - `readonly activate: Effect.Effect<void, PageError | Target.TargetGone | Deadline.Timeout>`
  - `close(): Effect.Effect<void, PageError | Target.TargetGone | Deadline.Timeout>`
  - `close(options: { readonly runBeforeUnload: boolean }): Effect.Effect<void, PageError | Target.TargetGone | Deadline.Timeout>`
- `type PageErrorReason = typeof PageErrorReason.Type`

*schemas*

- `const ViewportSize = Schema.Struct({ width: Schema.Number, height: Schema.Number })`
- `const DocumentStatus = Schema.Struct({ id: Target.DocumentId, readiness: Schema.Literals(["loading", "interactive", "complete"]), lifecycle: Schema.Literals(["active", "suspended"]) })`
- `const Prompt = Schema.Struct({ id: Dialog.PromptId, kind: Schema.Literals(["alert", "confirm", "prompt", "beforeunload", "unknown"]), blocking: Schema.Literals(["confirmed", "suspected"]) })`
- `const Status = Schema.Union([Schema.TaggedStruct("Open", { url: Url.Url, document: DocumentStatus, prompt: Schema.Option(Prompt) }), Schema.TaggedStruct("Closed", { reason: Target.CloseReason })])`
- `const FrameTree: Schema.Codec<FrameTree, FrameTreeEncoded>`
- `const PageErrorReason = Schema.Union([PageNavigation.NavigationFailed, PageNavigation.NavigationCanceled, PageNavigation.NavigationSuperseded, PageNavigation.BecameDownload, PageNavigation.NoContent, InitializationFailed, C…`

*combinators*

- `const withUserGesture: <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>`

*references*

- `const UserGesture: Context.Reference<boolean>`

*guards*

- `const isPage: (u: unknown) => u is ObservedPage`
- `const isPageError: (u: unknown) => u is PageError`

*errors*

- `class CaptureInvalidated: Schema.Error { document, replacement, hint }`
- `class PageError: Schema.TaggedError "PageError" { operation, reason, diagnostics }`
  - `override get cause(): unknown`

*reasons*

- `class InitializationFailed: Schema.Error { step, hint }`
- `class CloseCanceled: Schema.Error { hint }`

### PageClock

Page time: the clock a page's scripts read, under your control.

*models*

- `type Mode = | { readonly mode: "fixed"; readonly at: DateTime.DateTime.Input } | { readonly mode: "offset"; readonly by: Duration.Input } | { readonly mode: "controlled"; readonly at: DateTime.DateTime.Input }`
- `interface InstallOptions`
  - `readonly workers?: boolean | undefined`
- `interface PageClock`
  - `install(mode: Mode, options?: InstallOptions | undefined): Effect.Effect< Declaration.Registration, Declaration.DeclarationError | Target.TargetGone | Deadline…`
  - `adjust(duration: Duration.Input): Effect.Effect<void, PageClockError | Target.TargetGone | Deadline.Timeout>`
  - `setTime(at: DateTime.DateTime.Input): Effect.Effect<void, PageClockError | Target.TargetGone | Deadline.Timeout>`
  - `readonly resume: Effect.Effect<void, PageClockError | Target.TargetGone | Deadline.Timeout>`
- `type PageClockErrorReason = typeof PageClockErrorReason.Type`

*schemas*

- `const PageClockErrorReason = Schema.Union([NotInstalled, WrongMode, Reason.InvalidInput, Reason.BackendFailure])`

*guards*

- `const isPageClockError: (u: unknown) => u is PageClockError`

*errors*

- `class PageClockError: Schema.TaggedError "PageClockError" { operation, reason, diagnostics }`
  - `override get cause(): unknown`

*reasons*

- `class NotInstalled: Schema.Error { hint }`
- `class WrongMode: Schema.Error { mode, hint }`

### PageNavigation

Navigations of a page: the event, and what `goto`, `reload`, `back` and `forward` return.

*models*

- `type Id = typeof Id.Type`
- `type PageNavigation = typeof PageNavigation.Type`
- `type LoadState = "commit" | "domContentLoaded" | "load"`
- `interface Filter`
  - `readonly url?: Url.Pattern | string | undefined`
  - `readonly frames?: "main" | "all" | undefined`
- `interface NextFilter extends Filter`
  - `readonly waitUntil?: LoadState | undefined`

*schemas*

- `const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/PageNavigation/Id"))`
- `const PageNavigation = Schema.Union([Schema.TaggedStruct("Committed", { id: Id, frame: Target.NavigableId, url: Url.Url, document: Target.DocumentId, response: Schema.Option(NetworkResponse.NetworkResponse) }), Schema.Tagg…`

*subscriptions*

- `const next: <PE = never, PR = never>(target: Page.ObservedPage, filter?: NextFilter | undefined, where?: Subscription.Where<PageNavigation, PE, PR> | undefined) => Effect.Effect< Effect.Effect<PageNavigation, Page.PageError | PE | Target.TargetGone | Deadline.Timeout>, Subscription.SubscriptionError, Scope.Scope | PR >`
- `const stream: <PE = never, PR = never>(target: Page.ObservedPage, filter?: Filter | undefined, where?: Subscription.Where<PageNavigation, PE, PR> | undefined) => Effect.Effect< Stream.Stream<PageNavigation, PE | Subscription.EventOverflow | Target.TargetGone>, Subscription.SubscriptionError, Scope.Scope | PR >`

*getters*

- `const history: (target: Page.ObservedPage, filter?: Filter | undefined) => Effect.Effect<Subscription.History<PageNavigation>, Subscription.SubscriptionError>`

*reasons*

- `class NavigationFailed: Schema.Error { url, netError, hint }`
- `class NavigationCanceled: Schema.Error { url, why, hint }`
- `class NavigationSuperseded: Schema.Error { url, by, hint }`
- `class BecameDownload: Schema.Error { url, hint }`
- `class NoContent: Schema.Error { url, hint }`

### Pixels

CSS pixels and device pixels, which differ by the device pixel ratio.

*models*

- `type Css = typeof Css.Type`
- `type Device = typeof Device.Type`

*schemas*

- `const Css = Schema.Number.pipe(Schema.check(Schema.isFinite()), Schema.brand("~@usestrider/browser/Pixels/Css"))`
- `const Device = Schema.Number.pipe(Schema.check(Schema.isFinite()), Schema.brand("~@usestrider/browser/Pixels/Device"))`

### Popup

Pages opened by another page, such as with `window.open` or a `target="_blank"` link.

*models*

- `interface Filter`
  - `readonly url?: Url.Pattern | string | undefined`

*subscriptions*

- `const next`
  - `<PE = never, PR = never>(target: Page.Page, filter?: Filter | undefined, where?: Subscription.Where<Page.Page, PE, PR> | undefined): Effect.Effect< Effect.Effe…`
  - `<PE = never, PR = never>(target: Page.ObservedPage, filter?: Filter | undefined, where?: Subscription.Where<Page.ObservedPage, PE, PR> | undefined): Effect.Eff…`
- `const stream`
  - `<PE = never, PR = never>(target: Page.Page, filter?: Filter | undefined, where?: Subscription.Where<Page.Page, PE, PR> | undefined): Effect.Effect< Stream.Stre…`
  - `<PE = never, PR = never>(target: Page.ObservedPage, filter?: Filter | undefined, where?: Subscription.Where<Page.ObservedPage, PE, PR> | undefined): Effect.Eff…`

*getters*

- `const history`
  - `(target: Page.Page, filter?: Filter | undefined): Effect.Effect<Subscription.History<Page.Page>, Subscription.SubscriptionError>`
  - `(target: Page.ObservedPage, filter?: Filter | undefined): Effect.Effect<Subscription.History<Page.ObservedPage>, Subscription.SubscriptionError>`

### Reason

Failure reasons that more than one module's error can carry.

*models*

- `interface Reason`
  - `readonly _tag: string`
  - `readonly hint: string`
  - `readonly message: string`

*reasons*

- `class InvalidInput: Schema.Error { input, expected, hint }`
- `class NotPermitted: Schema.Error { required, hint }`
- `class Unsupported: Schema.Error { capability, backend, hint }`
- `class BackendFailure: Schema.Error { kind, method, hint, cause }`
- `class EvaluationThrown: Schema.Error { exception, hint }`
- `class NotSerializable: Schema.Error { path, hint }`
- `class PromptBlocking: Schema.Error { kind, text, hint }`
- `class ViewportMismatch: Schema.Error { requested, actual, hint }`

### Route

Routes intercept a page's or context's requests, and a route's handler decides what happens to each one.

*models*

- `type Phase = "request" | "response" | "auth"`
- `interface Decision<in P extends Phase = Phase>`
  - `readonly [DecisionTypeId]: (phase: P) => void`
- `interface Challenge`
  - `readonly origin: string`
  - `readonly scheme: string`
  - `readonly realm: string`
- `interface Paused`
  - `readonly request: NetworkRequest.NetworkRequest`
  - `readonly requestBody: Effect.Effect<Option.Option<Uint8Array>, RouteError | Target.TargetGone | Deadline.Timeout>`
- `interface RequestPhase extends Paused`
  - `readonly phase: "request"`
- `interface ResponsePhase extends Paused`
  - `readonly phase: "response"`
  - `readonly response: NetworkResponse.NetworkResponse`
  - `readonly responseBody: Effect.Effect<Uint8Array, RouteError | Target.TargetGone | Deadline.Timeout>`
- `interface AuthPhase extends Paused`
  - `readonly phase: "auth"`
  - `readonly challenge: Challenge`
- `type Intercepted<P extends Phase = Phase> = { readonly request: RequestPhase readonly response: ResponsePhase readonly auth: AuthPhase }[P]`
- `type Handler<E, R, P extends Phase = "request"> = (intercepted: Intercepted<P>) => Effect.Effect<Decision<P>, E, R>`
- `interface Options<P extends Phase = "request">`
  - `readonly phase?: P | undefined`
- `interface ResponseChange`
  - `readonly status?: number | undefined`
  - `readonly headers?: Headers.Input | undefined`
- `type AbortReason = | "failed" | "aborted" | "timedOut" | "accessDenied" | "connectionClosed" | "connectionReset" | "connectionRefused" | "connectionAborted" | "connectionFailed" | "nameNotResolved" | "internetDisconnec…`
- `interface FromHarOptions`
  - `readonly notFound?: "abort" | "fallthrough" | undefined`
- `interface Registration extends Declaration.Registration`
  - `readonly hits: Watchable.Watchable<number>`
- `type RouteErrorReason = typeof RouteErrorReason.Type`

*schemas*

- `const RouteErrorReason = Schema.Union([Reason.InvalidInput, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])`

*constructors*

- `const continue: Effect.Effect<Decision<Phase>>`
- `const continueWith`
  - `(change: (request: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest): Effect.Effect<Decision<"request">>`
  - `(change: ResponseChange): Effect.Effect<Decision<"response">>`
- `const fulfill: (response: HttpServerResponse.HttpServerResponse) => Effect.Effect<Decision<"request" | "response">>`
- `const abort: (reason?: AbortReason | undefined) => Effect.Effect<Decision<"request" | "response">>`
- `const fallthrough: Effect.Effect<Decision<Phase>>`
- `const fromHar: (path: FilePath.Local | string, options?: FromHarOptions | undefined) => Effect.Effect<Handler<never, never, "request">, Har.HarError, FileSystem.FileSystem>`
- `const provideCredentials: (credentials: { readonly username: string readonly password: Redacted.Redacted<string> }) => Effect.Effect<Decision<"auth">>`

*guards*

- `const isDecision: (u: unknown) => u is Decision<never>`
- `const isRouteError: (u: unknown) => u is RouteError`

*errors*

- `class RouteError: Schema.TaggedError "RouteError" { pattern, reason, diagnostics }`
  - `override get cause(): unknown`

### Snapshot

Accessibility snapshots of a page, for agents and for checking a page's structure.

*models*

- `type RefId = typeof RefId.Type`
- `type Generation = typeof Generation.Type`
- `type InteractivityEvidence = typeof InteractivityEvidence.Type`
- `type Role = | { readonly _tag: "Aria"; readonly role: AriaRole.AriaRole } | { readonly _tag: "Inferred" readonly role: "clickable" | "editable" | "focusable" readonly evidence: readonly [InteractivityEvidence, .…`
- `type Name = typeof Name.Type`
- `type State = typeof State.Type`
- `interface Node`
  - `readonly ref: Option.Option<RefId>`
  - `readonly role: Role`
  - `readonly name: Name`
  - `readonly states: ReadonlySet<State>`
  - `readonly editable?: boolean | undefined`
  - `readonly validationMessage: Option.Option<string>`
  - `readonly children: ReadonlyArray<Node>`
- `interface NodeEncoded`
  - `readonly ref: Option.Option<string>`
  - `readonly role: Node["role"]`
  - `readonly name: Node["name"]`
  - `readonly states: Node["states"]`
  - `readonly editable?: boolean | undefined`
  - `readonly validationMessage: Option.Option<string>`
  - `readonly children: ReadonlyArray<NodeEncoded>`
- `class Data: Schema.Class { document, generation, root, text }`
- `class Diff: Schema.Class { added, removed, changed, text }`
- `interface Snapshot<L extends Locator.ReadonlyLocator = Locator.ReadonlyLocator> extends Data`
  - `readonly [TypeId]: typeof TypeId`
  - `readonly refs: ReadonlyMap<RefId, Node>`
  - `ref(id: RefId): L`
  - `diff(previous: Snapshot): Effect.Effect<Diff, SnapshotError>`
- `interface Options`
  - `readonly sources?: "aria" | "aria+interactivity" | undefined`
  - `readonly depth?: number | undefined`
  - `readonly interactiveOnly?: boolean | undefined`

*schemas*

- `const RefId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Snapshot/RefId"))`
- `const Generation = Schema.Number.pipe(Schema.brand("~@usestrider/browser/Snapshot/Generation"))`
- `const InteractivityEvidence = Schema.Literals(["clickListener", "cursorPointer", "tabindex", "contentEditable", "onclickAttribute", "password"])`
- `const Role: Schema.Codec<Role>`
- `const Name = Schema.Union([Schema.TaggedStruct("Accessible", { value: Schema.String, from: Schema.optional(Schema.Literal("text")), fieldContent: Schema.optional(Schema.Boolean) }), Schema.TaggedStruct("Inferred"…`
- `const State = Schema.Literals(["checked", "expanded", "selected", "disabled", "focused", "pressed", "invalid"])`
- `const Node: Schema.Codec<Node, NodeEncoded>`

*guards*

- `const isSnapshot: (u: unknown) => u is Snapshot`
- `const isSnapshotError: (u: unknown) => u is SnapshotError`

*errors*

- `class SnapshotError: Schema.TaggedError "SnapshotError" { reason, diagnostics }`
  - `override get cause(): unknown`

*reasons*

- `class DocumentsDiffer: Schema.Error { documents, hint }`

### StorageState

A context's saved storage: cookies, `localStorage` and IndexedDB, for each origin and partition.

*models*

- `class StorageState: Schema.Class { cookies, origins }`

*schemas*

- `const IndexedDbDatabase = Schema.Struct({ name: Schema.String, version: Schema.Int, stores: Schema.Array(Schema.Struct({ name: Schema.String, keyPath: Schema.Option(Schema.Union([Schema.String, Schema.Array(Schema.String)])),…`
- `const OriginState = Schema.Struct({ origin: Url.Origin, partition: CookieJar.PartitionKey, topLevelOrigin: Schema.optionalKey(Url.Origin), localStorage: Schema.Array(Schema.Tuple([Schema.String, Schema.Redacted(Schema.S…`
- `const Json = Schema.fromJsonString(Schema.toCodecJson(StorageState))`

*reasons*

- `class Incompatible: Schema.Error { partitions, hint }`

### Subscription

What every event module shares: `next`, `stream` and `history`, the `where` predicate, and their errors.

*models*

- `type Where<A, PE, PR> = (event: A) => Effect.Effect<boolean, PE, PR>`
- `interface History<A>`
  - `readonly entries: ReadonlyArray<A>`
  - `readonly dropped: number`
- `type SubscriptionErrorReason = typeof SubscriptionErrorReason.Type`

*schemas*

- `const History = <S extends Schema.Top>(entry: S) => Schema.Struct({ entries: Schema.Array(entry), dropped: Schema.Int })`
- `const SubscriptionErrorReason = Schema.Union([Reason.InvalidInput, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])`

*combinators*

- `const withCapacity`
  - `(capacity: number): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>`
  - `<A, E, R>(self: Effect.Effect<A, E, R>, capacity: number): Effect.Effect<A, E, R>`

*references*

- `const Capacity: Context.Reference<number>`

*guards*

- `const isSubscriptionError: (u: unknown) => u is SubscriptionError`
- `const isEventOverflow: (u: unknown) => u is EventOverflow`

*errors*

- `class SubscriptionError: Schema.TaggedError "SubscriptionError" { operation, reason, diagnostics }`
  - `override get cause(): unknown`
- `class EventOverflow: Schema.TaggedError "EventOverflow" { bound, at, diagnostics }`

### Target

What operations act on, how each one is identified, and how it ends.

*models*

- `type NavigableId = typeof NavigableId.Type`
- `type DocumentId = typeof DocumentId.Type`
- `type RealmId = typeof RealmId.Type`
- `type CloseReason = typeof CloseReason.Type`
- `type Description = typeof Description.Type`
- `type EventOrigin = typeof EventOrigin.Type`

*schemas*

- `const NavigableId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Target/NavigableId"))`
- `const DocumentId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Target/DocumentId"))`
- `const RealmId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Target/RealmId"))`
- `const CloseReason = Schema.Union([BrowserClosed, BrowserCrashed, ConnectionLost, ModelUnavailable, UserContextRemoved, AccessReleased, PageClosed, ObligationEnded, DownloadEnded, HopEnded, PageCrashed, FrameDetached, Do…`
- `const Description = Schema.Union([Schema.TaggedStruct("Page", { id: NavigableId }), Schema.TaggedStruct("Frame", { id: NavigableId }), Schema.TaggedStruct("Document", { id: DocumentId }), Schema.TaggedStruct("Realm", { …`
- `const EventOrigin = Schema.Union([Schema.TaggedStruct("Page", { page: NavigableId }), Schema.TaggedStruct("Worker", { realm: RealmId })])`

*guards*

- `const isTargetGone: (u: unknown) => u is TargetGone`

*errors*

- `class TargetGone: Schema.TaggedError "TargetGone" { target, reason, diagnostics }`

*reasons*

- `class BrowserClosed: Schema.Error { hint }`
- `class BrowserCrashed: Schema.Error { hint }`
- `class ConnectionLost: Schema.Error { hint }`
- `class ModelUnavailable: Schema.Error { hint }`
- `class UserContextRemoved: Schema.Error { hint }`
- `class AccessReleased: Schema.Error { hint }`
- `class PageCrashed: Schema.Error { hint }`
- `class FrameDetached: Schema.Error { hint }`
- `class DocumentReplaced: Schema.Error { hint }`
- `class DocumentEvicted: Schema.Error { hint }`
- `class DocumentDestroyed: Schema.Error { hint }`
- `class DocumentUnloaded: Schema.Error { hint }`
- `class RealmDestroyed: Schema.Error { hint }`
- `class NetworkConnectionClosed: Schema.Error { hint }`
- `class PageClosed: Schema.Error { by, hint }`
- `class ObligationEnded: Schema.Error { hint }`
- `class DownloadEnded: Schema.Error { hint }`
- `class HopEnded: Schema.Error { hint }`
- `class Vanished: Schema.Error { hint }`

### Trace

Recordings of what happened on a page, exported as traces that Playwright's trace viewer opens.

*models*

- `type Options = CaptureOptions & (NetworkOptions | SnapshotOptions)` (experimental)
- `interface CaptureOptions` (experimental)
  - `readonly screenshots?: "perAction" | "off" | undefined`
  - `readonly screencast?: "native" | { readonly polled: Duration.Input } | "off" | undefined`
- `interface NetworkOptions` (experimental)
  - `readonly domSnapshots?: false | undefined`
  - `readonly network?: boolean | undefined`
- `interface SnapshotOptions` (experimental)
  - `readonly domSnapshots: true`
  - `readonly network: true`
- `interface Recording extends Declaration.Registration` (experimental)
  - `exportTrace(path: FilePath.Local | string): Effect.Effect<FilePath.Local, TraceError>`
- `type TraceErrorReason = typeof TraceErrorReason.Type` (experimental)

*schemas*

- `const TraceErrorReason = Schema.Union([WriteFailed, Reason.InvalidInput, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])` (experimental)

*constructors*

- `const record: (target: UserContext.UserContext | Page.Page, options?: Options | undefined) => Effect.Effect<Recording, TraceError | Target.TargetGone | Deadline.Timeout, Scope.Scope>` (experimental)

*guards*

- `const isTraceError: (u: unknown) => u is TraceError` (experimental)

*errors*

- `class TraceError: Schema.TaggedError "TraceError" { reason, diagnostics }` (experimental)
  - `override get cause(): unknown`

*reasons*

- `class WriteFailed: Schema.Error { path, hint, cause }` (experimental)

### UncaughtException

Errors a page or its workers threw and didn't catch, and promise rejections nothing handled.

*models*

- `class UncaughtException: Schema.Class { kind, name, message, stack, origin, at }`
- `interface Filter`
  - `readonly message?: string | RegExp | undefined`

*subscriptions*

- `const next: <PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined, where?: Subscription.Where<UncaughtException, PE, PR> | undefined) => Effect.Effect< Effect.Effect<UncaughtException, PE | Target.TargetGone | Deadline.Timeout>, Subscription.SubscriptionError, Scope.Scope | PR >`
- `const stream: <PE = never, PR = never>(target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined, where?: Subscription.Where<UncaughtException, PE, PR> | undefined) => Effect.Effect< Stream.Stream<UncaughtException, PE | Subscription.EventOverflow | Target.TargetGone>, Subscription.SubscriptionError, Scope.Scope | PR >`

*getters*

- `const history: (target: Page.ObservedPage | UserContext.ObservedUserContext, filter?: Filter | undefined) => Effect.Effect<Subscription.History<UncaughtException>, Subscription.SubscriptionError>`

### Url

URLs, URL patterns, origins and sites, as branded strings.

*models*

- `type Url = typeof Url.Type`
- `type Pattern = typeof Pattern.Type`
- `type Origin = typeof Origin.Type`
- `type Site = typeof Site.Type`

*schemas*

- `const Url = Schema.String.pipe(Schema.check(Schema.makeFilter((input: string) => URL.canParse(input), { expected: "an absolute URL" })), Schema.brand("~@usestrider/browser/Url/Url"))`
- `const Pattern = Schema.String.pipe(Schema.brand("~@usestrider/browser/Url/Pattern"))`
- `const Origin = Schema.String.pipe(Schema.check(Schema.makeFilter(isOrigin, { expected: "a serialized origin, such as https: Schema.brand("~@usestrider/browser/Url/Origin"))`
- `const Site = Schema.String.pipe(Schema.check(Schema.makeFilter((input: string) => isOrigin(input) && URL.parse(input)!.port === "", { expected: "a site, such as https: })), Schema.brand("~@usestrider/browser/Url/…`

### UserContext

User contexts: isolated browser sessions, at two access levels.

*models*

- `type Id = typeof Id.Type`
- `interface ObservedUserContext extends Pipeable.Pipeable, Equal.Equal, Inspectable.Inspectable`
  - `readonly [TypeId]: typeof TypeId`
  - `readonly id: Id`
  - `readonly pages: Watchable.Watchable<ReadonlyArray<Page.ObservedPage>>`
  - `readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.ObservedBrowserWorker>>`
  - `readonly closed: Effect.Effect<Target.CloseReason>`
  - `readonly control: Effect.Effect<UserContext, UserContextError, Scope.Scope>`
- `type Permission = | "geolocation" | "notifications" | "camera" | "microphone" | "clipboard-read" | "clipboard-write" | "midi" | "background-sync" | "persistent-storage" | "accelerometer" | "gyroscope" | "magnetometer"…`
- `interface GrantOptions`
  - `readonly origin?: Url.Origin | string | undefined`
- `interface UserContext extends ObservedUserContext`
  - `readonly newPage: Effect.Effect<Page.Page, Page.PageError | Target.TargetGone | Deadline.Timeout, Scope.Scope>`
  - `readonly pages: Watchable.Watchable<ReadonlyArray<Page.Page>>`
  - `readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.BrowserWorker>>`
  - `readonly cookies: CookieJar.CookieJar`
  - `readonly exportStorageState: Effect.Effect<StorageState.StorageState, UserContextError | Target.TargetGone>`
  - `readonly clock: PageClock.PageClock`
  - `route<E, R, P extends Route.Phase = "request">(pattern: Url.Pattern | string, handler: Route.Handler<E, R, NoInfer<P>>, options: Route.Options<P> & { readonly …`
  - `route<E, R>(pattern: Url.Pattern | string, handler: Route.Handler<E, R>, options?: Route.Options | undefined): Effect.Effect<Route.Registration, Route.RouteErr…`
  - `route<E, R, P extends Route.Phase = "request">(pattern: Url.Pattern | string, handler: Route.Handler<E, R, NoInfer<P> | "request">, options?: Route.Options<P> …`
  - `route<E, R, P extends Route.Phase = "request", D extends Route.Phase = P | "request">(pattern: Url.Pattern | string, handler: RoutePhaseDiagnostic.Handler<E, R…`
  - `addInitScript(script: InitScript.Source, options?: InitScript.Options | undefined): Effect.Effect< InitScript.InitScript, Declaration.DeclarationError | Target…`
  - `emulate(settings: Emulation.Emulation): Effect.Effect< Declaration.Registration, Declaration.DeclarationError | Target.TargetGone | Deadline.Timeout, Scope.Sco…`
  - `grant(permissions: ReadonlyArray<Permission>, options?: GrantOptions | undefined): Effect.Effect< Declaration.Registration, Declaration.DeclarationError | Targ…`
- `interface Options`
  - `readonly acceptInsecureCerts?: boolean | undefined`
  - `readonly httpCredentials?: { readonly origin?: string | undefined readonly username: string readonly password: Redacted.Redacted<string> } | undefined`
  - `readonly proxy?: { readonly server: string readonly bypass?: ReadonlyArray<string> | undefined readonly credentials?: { readonly username: string readonly pass…`
  - `readonly storageState?: StorageState.StorageState | undefined`
  - `readonly dialogs?: "dismiss" | "accept" | "leaveOpen" | undefined`
  - `readonly focus?: "system" | "emulated" | undefined`
  - `readonly keyboardLayout?: Keyboard.Layout | undefined`
  - `readonly eventLog?: number | undefined`
  - `readonly downloads?: "temporary" | "deny" | { readonly directory: string } | undefined`
  - `readonly emulation?: Emulation.Emulation | undefined`
  - `readonly permissions?: ReadonlyArray<Permission> | undefined`
- `type UserContextErrorReason = typeof UserContextErrorReason.Type`

*schemas*

- `const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/UserContext/Id"))`
- `const UserContextErrorReason = Schema.Union([StorageState.Incompatible, Reason.InvalidInput, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure, Reason.ViewportMismatch])`

*guards*

- `const isUserContext: (u: unknown) => u is ObservedUserContext`
- `const isUserContextError: (u: unknown) => u is UserContextError`

*errors*

- `class UserContextError: Schema.TaggedError "UserContextError" { operation, reason, diagnostics }`
  - `override get cause(): unknown`

### VideoWriter

Writes timestamped image frames to a finished WebM file.

*services*

- `const VideoWriter: Context.Service<VideoWriter, VideoWriter>`

*layers*

- `const layerFfmpeg: (options: { readonly path: string }) => Layer.Layer<VideoWriter, never, ChildProcessSpawner.ChildProcessSpawner>`

*models*

- `type Frame = typeof Frame.Type`
- `type Destination = typeof Destination.Type`
- `interface VideoWriter`
  - `readonly write: (frames: Stream.Stream<Frame>, destination: Destination) => Effect.Effect<string, VideoWriterError>`

*schemas*

- `const Frame = Schema.Struct({ at: Schema.Number, format: Schema.Literals(["jpeg", "png"]), data: Schema.Uint8Array, width: Schema.Number, height: Schema.Number })`
- `const Destination = Schema.Struct({ path: Schema.String, width: Schema.Number, height: Schema.Number })`

*errors*

- `class VideoWriterError: Schema.TaggedError "VideoWriterError" { reason }`

### Watchable

Read-only views of state that changes, kept up to date from the browser's events.

*models*

- `interface Watchable<A> extends Effect.Effect<A>`
  - `readonly [TypeId]: typeof TypeId`
  - `readonly changes: Stream.Stream<A>`
  - `waitFor<B extends A>(refinement: Predicate.Refinement<A, B>): Effect.Effect<B, Deadline.Timeout | Target.TargetGone | Ended>`
  - `waitFor(predicate: Predicate.Predicate<A>): Effect.Effect<A, Deadline.Timeout | Target.TargetGone | Ended>`
  - `map<B>(f: (a: A) => B): Watchable<B>`

*guards*

- `const isWatchable: (u: unknown) => u is Watchable<unknown>`
- `const isEnded: (u: unknown) => u is Ended`

*errors*

- `class Ended: Schema.TaggedError "Ended" { operation, value, diagnostics }`

### WebAuthn

Native virtual authenticators and the credentials they hold on one Chromium page.

*models*

- `type Credential = typeof Credential.Type`
- `interface VirtualAuthenticator`
  - `readonly credentials: Effect.Effect<ReadonlyArray<Credential>, WebAuthnError | Target.TargetGone | Deadline.Timeout>`
  - `readonly addCredential: (credential: Credential) => Effect.Effect<void, WebAuthnError | Target.TargetGone | Deadline.Timeout>`
  - `readonly removeCredential: (credentialId: Uint8Array) => Effect.Effect<void, WebAuthnError | Target.TargetGone | Deadline.Timeout>`
  - `readonly clearCredentials: Effect.Effect<void, WebAuthnError | Target.TargetGone | Deadline.Timeout>`
  - `readonly setUserVerified: (verified: boolean) => Effect.Effect<void, WebAuthnError | Target.TargetGone | Deadline.Timeout>`
  - `readonly setAutomaticPresenceSimulation: (enabled: boolean) => Effect.Effect<void, WebAuthnError | Target.TargetGone | Deadline.Timeout>`
- `type WebAuthnErrorReason = typeof WebAuthnErrorReason.Type`

*schemas*

- `const Credential = Schema.Struct({ credentialId, isResidentCredential: Schema.Boolean, rpId: Schema.String.check(Schema.makeFilter((value) => { const url = URL.parse(`https: return value.length > 0 && url !== null && u…`
- `const WebAuthnErrorReason = Schema.Union([Reason.InvalidInput, Reason.BackendFailure, Reason.Unsupported])`

*errors*

- `class WebAuthnError: Schema.TaggedError "WebAuthnError" { reason, diagnostics }`
  - `override get cause(): unknown`

## `@usestrider/browser/ai`

### BrowserToolkit

The agent toolkit: browser tools for a model, defined once, and served in your program, over MCP and by the CLI.

*models*

- `type SecretName = typeof SecretName.Type` (experimental)
- `type ToolName = keyof Tools` (experimental)
- `type Tools = ToolsImpl.Tools` (experimental)
- `const ToolFailure = ToolsImpl.ToolFailure` (experimental)
- `type ToolFailure = ToolsImpl.ToolFailure` (experimental)
- `interface MakeOptions` (experimental)
  - `readonly context: UserContext.UserContext`
  - `readonly secrets: Readonly<Record<SecretName | string, Redacted.Redacted<string>>>`
  - `readonly capture: CapturePolicy.CapturePolicy`
  - `readonly browser?: Browser.Browser | undefined`

*schemas*

- `const SecretName = Schema.String.pipe(Schema.brand("~@usestrider/browser/ai/BrowserToolkit/SecretName"))` (experimental)

*constructors*

- `const make: (options: MakeOptions) => Effect.Effect<Toolkit.WithHandler<Tools>, never, Scope.Scope>` (experimental)

*constants*

- `const toolkit: Toolkit.Toolkit<Tools>` (experimental)

### CapturePolicy

What page content may reach a model.

*models*

- `class CapturePolicy: Schema.Class { screenshots, snapshotText, consoleText }` (experimental)

*constants*

- `const strict: CapturePolicy` (experimental)
- `const local: CapturePolicy` (experimental)

## `@usestrider/browser/bidi`

### Bidi

The generic WebDriver BiDi backend: connects to any BiDi endpoint, such as Safari Technology Preview or a remote grid.

*layers*

- `const layerConnect: (endpoint: Url.Url | string, options?: Browser.ConnectOptions | undefined) => Layer.Layer<Browser.Browser, Browser.BrowserError, Socket.WebSocketConstructor>`

## `@usestrider/browser/bidi-protocol`

12 generated modules: Browser, BrowsingContext, Common, Emulation, Input, Log, Network, Permissions, Script, Session, Storage, WebExtension. Their declarations are in the API reference.

## `@usestrider/browser/cdp`

56 generated modules: Accessibility, Ads, Animation, Audits, Autofill, BackgroundService, BluetoothEmulation, Browser, CacheStorage, Cast, CrashReportContext, CSS, Debugger, DeviceAccess, DeviceOrientation, DigitalCredentials, DOM, DOMDebugger, DOMSnapshot, DOMStorage, Emulation, EventBreakpoints, Extensions, FedCm, Fetch, FileSystem, HeadlessExperimental, HeapProfiler, IndexedDB, Input, Inspector, IO, LayerTree, Log, Media, Memory, Network, Overlay, Page, Performance, PerformanceTimeline, Preload, Profiler, PWA, Runtime, Security, ServiceWorker, SmartCardEmulation, Storage, SystemInfo, Target, Tethering, Tracing, WebAudio, WebAuthn, WebMCP. Their declarations are in the API reference.

## `@usestrider/browser/chromium`

### Chromium

The Chromium backend: Chromium, Chrome and Edge, over the Chrome DevTools Protocol.

*layers*

- `const layer: (options: Browser.LaunchOptions) => Layer.Layer< Browser.Browser, Browser.BrowserError, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem >`
- `const layerConfig: (options: Config.Wrap<Browser.LaunchOptions>) => Layer.Layer< Browser.Browser, Browser.BrowserError | Config.ConfigError, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem >`
- `const layerConnect: (endpoint: Url.Url | string, options?: Browser.ConnectOptions | undefined) => Layer.Layer<Browser.Browser, Browser.BrowserError, Socket.WebSocketConstructor>`

## `@usestrider/browser/cli`

### CurrentSession

What `strider run` gives a segment: the live CLI session, and its pages by name.

*services*

- `interface CurrentSession` (experimental)
  - `readonly context: UserContext.UserContext`
  - `page(name: PageName | string): Effect.Effect<Page.Page, PageNotFound>`
  - `keep(page: Page.Page, name?: PageName | string): Effect.Effect<PageName, NameTaken>`

*tags*

- `const CurrentSession: Context.Service<CurrentSession, CurrentSession>` (experimental)

*models*

- `type PageName = typeof PageName.Type` (experimental)

*schemas*

- `const PageName = Schema.String.pipe(Schema.brand("~@usestrider/browser/cli/CurrentSession/PageName"))` (experimental)

*guards*

- `const isPageNotFound: (u: unknown) => u is PageNotFound` (experimental)
- `const isNameTaken: (u: unknown) => u is NameTaken` (experimental)

*errors*

- `class PageNotFound: Schema.TaggedError "PageNotFound" { name, hint }` (experimental)
- `class NameTaken: Schema.TaggedError "NameTaken" { name, hint }` (experimental)

### Segment

Typed programs run in a live CLI session, with arguments decoded before their callback runs.

*models*

- `interface Segment<S extends Schema.Constraint, A, E = never, R = never>` (experimental)
  - `readonly [TypeId]: typeof TypeId`
  - `readonly schema: S`
  - `readonly run: (args: S["Type"]) => Effect.Effect<A, E, R>`

*constructors*

- `const make: <S extends Schema.Constraint, A, E, R>(schema: S, run: (args: S["Type"]) => Effect.Effect<A, E, R>) => Segment<S, A, E, R>` (experimental)

*guards*

- `const isSegment: (value: unknown) => value is Segment<Schema.Constraint, unknown, unknown, unknown>` (experimental)

## `@usestrider/browser/experimental`

### Browser

Experimental recovery of Chromium pages for session hosts.

*models*

- `type Found = typeof Found.Type` (experimental)
- `interface Reclaimed` (experimental)
  - `readonly page: Page.Page`
  - `readonly found: Found`
  - `readonly handoff?: Handoff | undefined`
  - `readonly lastKnown?: LastKnown | undefined`
- `type LastKnown = typeof LastKnown.Type` (experimental)
- `type Handoff = typeof Handoff.Type` (experimental)

*schemas*

- `const Found = Reports.Found` (experimental)
- `const LastKnown = Reports.LastKnown` (experimental)
- `const Handoff = Reports.Handoff` (experimental)

*claims*

- `const reclaim = (claim: ClaimedPage.Claim, options?: { readonly observationTimeout?: number | undefined readonly lastKnown?: LastKnown | undefined } | undefined) => Claims.reclaimPage(claim, options)` (experimental)

### Claim

Errors and leftover state reported by experimental browser claims.

*errors*

- `class ClaimError: Schema.TaggedError "ClaimError" { operation, reason, diagnostics }` (experimental)

*reasons*

- `class Gone: Schema.Error { hint }` (experimental)
- `class OtherBrowser: Schema.Error { hint }` (experimental)

### Page

Experimental page claims issued only for owned pages.

*models*

- `type Claim = typeof Claim.Type` (experimental)

*schemas*

- `const Claim = Schema.String.pipe(Schema.brand("~@usestrider/browser/experimental/Page/Claim"))` (experimental)

*claims*

- `const claim = (value: Base.Page) => Claims.claimPage(value)` (experimental)

### UserContext

Experimental context persistence and recovery for session hosts.

*models*

- `type Claim = typeof Claim.Type` (experimental)
- `type Found = typeof Found.Type` (experimental)
- `interface Reclaimed` (experimental)
  - `readonly context: Base.UserContext`
  - `readonly found: Found`
  - `readonly handoff?: Browser.Handoff | undefined`
  - `readonly lastKnown?: Browser.LastKnown | undefined`

*schemas*

- `const Claim = Schema.String.pipe(Schema.brand("~@usestrider/browser/experimental/UserContext/Claim"))` (experimental)
- `const Found = Schema.Struct({ pages: Schema.Array(Schema.Struct({ page: Target.NavigableId, found: Reports.Found })) })` (experimental)

*claims*

- `const claim = (value: Base.UserContext) => Claims.claimUserContext(value)` (experimental)
- `const create = (options: Base.Options & { readonly reclaimable: true }) => Claims.createContext(options)` (experimental)
- `const reclaim = (claim: Claim, options?: | Base.Options & { readonly observationTimeout?: number | undefined readonly lastKnown?: Browser.LastKnown | undefined } | undefined) => Claims.reclaimContext(claim, options)` (experimental)

## `@usestrider/browser/firefox`

### Firefox

The Firefox backend: Firefox, over WebDriver BiDi.

*layers*

- `const layer: (options: Browser.LaunchOptions) => Layer.Layer< Browser.Browser, Browser.BrowserError, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Socket.WebSocketConstructor >`
- `const layerConfig: (options: Config.Wrap<Browser.LaunchOptions>) => Layer.Layer< Browser.Browser, Browser.BrowserError | Config.ConfigError, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Socket.WebSocketConstructor >`
- `const layerConnect: (endpoint: Url.Url | string, options?: Browser.ConnectOptions | undefined) => Layer.Layer<Browser.Browser, Browser.BrowserError, Socket.WebSocketConstructor>`

## `@usestrider/browser/protocol`

### BidiConnection

A raw WebDriver BiDi connection, for working with the protocol directly: one session over one `Transport`.

*models*

- `interface BidiConnection` (experimental)
  - `readonly session: Protocol.ProtocolSession`
  - `readonly closed: Effect.Effect<Transport.ConnectionLost>`

*constructors*

- `const make: (transport: Transport.Transport) => Effect.Effect<BidiConnection, never, Scope.Scope>` (experimental)

### CdpConnection

A raw Chrome DevTools Protocol connection, for working with the protocol directly: the browser's own session, and each target session the browser announces, over one `Transport`.

*models*

- `interface CdpConnection` (experimental)
  - `readonly browser: Protocol.ProtocolSession`
  - `readonly session: (sessionId: Target.SessionID) => Effect.Effect<Protocol.ProtocolSession, Protocol.ProtocolError>`
  - `readonly closed: Effect.Effect<Transport.ConnectionLost>`

*constructors*

- `const make: (transport: Transport.Transport) => Effect.Effect<CdpConnection, never, Scope.Scope>` (experimental)

### Protocol

The raw protocol client: commands and events as data, the session they run on, and the errors a session reports.

*services*

- `interface ProtocolSession` (experimental)
  - `readonly key: SessionKey | undefined`
  - `send<M extends string, P, A>(command: Command<M, P, A>): Effect.Effect<A, ProtocolError>`
  - `subscribe<M extends string, A>(event: EventDef<M, A>, options: SlidingOptions<A>): Effect.Effect<Stream.Stream<A | Gap, ProtocolError>, never, Scope.Scope>`
  - `subscribe<M extends string, A>(event: EventDef<M, A>, options?: SubscribeOptions<A> | undefined): Effect.Effect<Stream.Stream<A, ProtocolError>, never, Scope.S…`
  - `readonly drainObserved: Effect.Effect<void>`
  - `readonly ended: Effect.Effect<SessionEnded>`

*tags*

- `const ProtocolSession: Context.Service<ProtocolSession, ProtocolSession>` (experimental)

*models*

- `interface Traits` (experimental)
  - `readonly status: "stable" | "experimental" | "deprecated"`
  - `readonly session?: "browser" | "target" | undefined`
  - `readonly compensation?: string | undefined`
  - `readonly createsResource?: true | undefined`
  - `readonly release?: ReadonlyArray<Release> | undefined`
  - `readonly redirect?: string | undefined`
- `interface Release` (experimental)
  - `readonly method: string`
  - `readonly param: string`
  - `readonly from: string`
  - `readonly paramsFrom?: Readonly<Record<string, string>> | undefined`
  - `readonly list?: true | undefined`
- `interface Command<M extends string, P, A> extends Effect.Effect<A, ProtocolError, ProtocolSession>` (experimental)
  - `readonly method: M`
  - `readonly params: P`
  - `readonly definition: CommandDef<M, P, A>`
- `interface CommandDef<M extends string, P, A>` (experimental)
  - `(...args: CommandArgs<P>): Command<M, P, A>`
  - `readonly method: M`
  - `readonly Params: Schema.Codec<P, unknown> | undefined`
  - `readonly Result: Schema.Codec<A, unknown> | undefined`
  - `readonly traits: Traits`
- `interface EventDef<M extends string, A>` (experimental)
  - `readonly method: M`
  - `readonly Params: Schema.Codec<A, unknown> | undefined`
  - `readonly traits: Traits`
- `type SessionKey = typeof SessionKey.Type` (experimental)
- `type Prefilter<A> = A extends ReadonlyArray<unknown> ? never : { readonly [K in keyof A]?: NonNullable<A[K]> extends string | number | boolean ? A[K] : Prefilter<NonNullable<A[K]>> }` (experimental)
- `interface SubscribeOptions<A>` (experimental)
  - `readonly buffer?: { readonly lossless: number } | undefined`
  - `readonly prefilter?: Prefilter<A> | undefined`
- `interface SlidingOptions<A>` (experimental)
  - `readonly buffer: { readonly sliding: number }`
  - `readonly prefilter?: Prefilter<A> | undefined`
- `class Gap: Schema.TaggedClass "Gap" { dropped }` (experimental)
- `interface LateReply` (experimental)
  - `readonly session: ProtocolSession`
  - `readonly method: string`
  - `readonly params: unknown`
  - `readonly result: unknown`
  - `readonly release: Effect.Effect<void>`
- `type Validation = "decode" | "trust"` (experimental)
- `type RejectReason = "NoSuchTarget" | "NoSuchFrame" | "NoSuchNode" | "InvalidArgument" | "Unrecognized"` (experimental)

*schemas*

- `const SessionKey = Schema.String.pipe(Schema.brand("~@usestrider/browser/protocol/Protocol/SessionKey"))` (experimental)

*constructors*

- `const command: <M extends string, P, A>(method: M, Params: Schema.Codec<P, unknown> | undefined, Result: Schema.Codec<A, unknown> | undefined, traits: Traits) => CommandDef<M, P, A>` (experimental)
- `const event: <M extends string, A>(method: M, Params: Schema.Codec<A, unknown> | undefined, traits: Traits) => EventDef<M, A>` (experimental)

*combinators*

- `const on` (experimental)
  - `(session: ProtocolSession): <M extends string, P, A>(command: Command<M, P, A>) => Effect.Effect<A, ProtocolError>`
  - `<M extends string, P, A>(command: Command<M, P, A>, session: ProtocolSession): Effect.Effect<A, ProtocolError>`
- `const withCommandTimeout` (experimental)
  - `(timeout: Duration.Input): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>`
  - `<A, E, R>(self: Effect.Effect<A, E, R>, timeout: Duration.Input): Effect.Effect<A, E, R>`
- `const withValidation` (experimental)
  - `(validation: Validation): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>`
  - `<A, E, R>(self: Effect.Effect<A, E, R>, validation: Validation): Effect.Effect<A, E, R>`
- `const withLateReplyHandler` (experimental)
  - `(handler: (reply: LateReply) => Effect.Effect<void>): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>`
  - `<A, E, R>(self: Effect.Effect<A, E, R>, handler: (reply: LateReply) => Effect.Effect<void>): Effect.Effect<A, E, R>`

*references*

- `const CommandTimeout: Context.Reference<Duration.Duration>` (experimental)
- `const CurrentValidation: Context.Reference<Validation>` (experimental)
- `const CurrentLateReplyHandler: Context.Reference<(reply: LateReply) => Effect.Effect<void>>` (experimental)

*guards*

- `const isGap: (u: unknown) => u is Gap` (experimental)
- `const isProtocolError: (u: unknown) => u is ProtocolError` (experimental)

*errors*

- `class ProtocolError: Schema.TaggedError "ProtocolError" { reason }` (experimental)

*reasons*

- `class Rejected: Schema.Error { method, reason, code, description }` (experimental)
- `class Decode: Schema.Error { method, issue }` (experimental)
- `class Encode: Schema.Error { method, issue }` (experimental)
- `class SessionEnded: Schema.Error { why }` (experimental)
- `class NoReply: Schema.Error { method, timeout }` (experimental)
- `class EventOverflow: Schema.Error { method, capacity }` (experimental)
- `class Unsupported: Schema.Error { method }` (experimental)

*utility types*

- `type CommandArgs<P> = [P] extends [void] ? [] : {} extends P ? [params?: P] : [params: P]` (experimental)

### SocketConnector

Opens scoped socket connections to endpoints known only at run time, such as the inspector server of a MiniBrowser that `WebKit.layer` launched.

*services*

- `const SocketConnector: Context.Service<SocketConnector, SocketConnector>` (experimental)

*layers*

- `const layer: (make: (endpoint: Endpoint) => Effect.Effect<Socket.Socket>) => Layer.Layer<SocketConnector>` (experimental)

*models*

- `interface Endpoint` (experimental)
  - `readonly host: string`
  - `readonly port: number`
  - `readonly path?: string | undefined`
  - `readonly tls?: boolean | TlsOptions | undefined`
  - `readonly connectTimeout?: Duration.Input | undefined`
- `type TlsOptions = Socket.TlsUpgradeOptions` (experimental)
- `interface Connection extends Socket.Reader, Socket.Writer` (experimental)
  - `readonly close: Effect.Effect<void>`
- `interface SocketConnector` (experimental)
  - `readonly connect: (endpoint: Endpoint) => Effect.Effect<Connection, Socket.SocketError, Scope.Scope>`

*constructors*

- `const fromSocket: (socket: Socket.Socket) => Effect.Effect<Connection, Socket.SocketError, Scope.Scope>` (experimental)

### Transport

The transports that carry a raw browser connection's messages: framed text in both directions, read by one consumer, and never reconnected.

*models*

- `interface Transport` (experimental)
  - `readonly send: (message: string) => Effect.Effect<void, TransportError>`
  - `readonly messages: Stream.Stream<string, TransportError>`
  - `readonly closed: Effect.Effect<ConnectionLost>`
- `interface WebSocketOptions` (experimental)
  - `readonly headers?: Readonly<Record<string, string | Redacted.Redacted<string>>> | undefined`
  - `readonly openTimeout?: Duration.Input | undefined`

*constructors*

- `const pipe: (handle: ChildProcessSpawner.ChildProcessHandle) => Effect.Effect<Transport, never, Scope.Scope>` (experimental)
- `const webSocket: (url: string, options?: WebSocketOptions | undefined) => Effect.Effect<Transport, TransportError, Scope.Scope | Socket.WebSocketConstructor>` (experimental)

*constants*

- `const pipeFds` (experimental)
  - `readonly fd3: { readonly type: "input" }`
  - `readonly fd4: { readonly type: "output" }`

*guards*

- `const isTransportError: (u: unknown) => u is TransportError` (experimental)

*errors*

- `class TransportError: Schema.TaggedError "TransportError" { reason }` (experimental)

*reasons*

- `class ConnectFailed: Schema.Error { description }` (experimental)
- `class ConnectionLost: Schema.Error { initiator, description }` (experimental)

## `@usestrider/browser/test`

### TestRun

Test support that works with any test runner: the running test, and the files attached to it.

*services*

- `interface TestRun`
  - `readonly info: TestInfo`
  - `attach(artifact: TestArtifact): Effect.Effect<void>`

*tags*

- `const TestRun: Context.Service<TestRun, TestRun>`

*models*

- `class TestInfo: Schema.Class { project, file, id, attempt, repeat, worker, shard }`
- `type TestArtifact = typeof TestArtifact.Type`

*schemas*

- `const TestArtifact = Schema.Union([Schema.Struct({ trace: FilePath.Local }), Schema.Struct({ har: FilePath.Local }), Schema.Struct({ screenshot: FilePath.Local })])`

## `@usestrider/browser/webkit`

### WebKit

The WebKit backend: stock WebKitGTK and WPE, launched in automation mode or attached through their inspector.

*layers*

- `const layer: (options: LaunchOptions) => Layer.Layer< Browser.Browser, Browser.BrowserError, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | SocketConnector.SocketConnector >`
- `const layerConfig: (options: Config.Wrap<LaunchOptions>) => Layer.Layer< Browser.Browser, Browser.BrowserError | Config.ConfigError, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | SocketConnector.SocketConnector >`
- `const layerAttach: (endpoint: Url.Url | string, options?: ConnectOptions | undefined) => Layer.Layer<Browser.Browser, Browser.BrowserError, Socket.WebSocketConstructor>`

*models*

- `interface LaunchOptions extends Browser.LaunchOptions`
  - `readonly video?: { readonly polled: Duration.Input; readonly directory: string } | undefined`
- `interface ConnectOptions extends Browser.ConnectOptions`
  - `readonly video?: LaunchOptions["video"]`

## `@usestrider/browser/webkit-automation-protocol`

1 generated modules: Automation. Their declarations are in the API reference.

## `@usestrider/browser/webkit-stock-protocol`

28 generated modules: Animation, Audit, Browser, Canvas, Console, CPUProfiler, CSS, Debugger, DOM, DOMDebugger, DOMStorage, GenericTypes, Heap, IndexedDB, Inspector, LayerTree, Memory, Network, Page, Recording, Runtime, ScriptProfiler, Security, ServiceWorker, Storage, Target, Timeline, Worker. Their declarations are in the API reference.
