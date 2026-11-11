/**
 * The `Browser` service, which every backend provides, with its accessors and the settings every backend shares.
 *
 * A backend's layer provides `Browser`: `Chromium.layer({ executablePath })` launches the browser at that path, and
 * `Chromium.layerConnect(endpoint)` attaches to one that's already running. Each backend is an import of its own
 * (`@usestrider/browser/chromium`, `/firefox`, `/webkit`, and `/bidi`), so a program loads only the protocol code it
 * uses. A launched browser gets a temporary profile, made before it starts and deleted after it exits.
 *
 * **Tracing**
 *
 * Every operation you call opens one span, named like `Locator.click`, with attributes in OpenTelemetry's style:
 * `browser.operation`, `browser.page.id`, `url.full` (redacted under the current diagnostics preset), and
 * `error.type`. What happens inside an operation isn't traced, unless `TraceProtocolCommands` adds a span for each
 * protocol command. `SpanNameGenerator` and `TracerDisabledWhen` rename or suppress spans, as their namesakes do
 * for Effect's `HttpClient`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FilePath from "./FilePath.ts"
import * as BrowserImpl from "./internal/browser.ts"
import * as BrowserClock from "./internal/browserClock.ts"
import * as BrowserService from "./internal/browserService.ts"
import * as Fake from "./internal/fake.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Tracing from "./internal/tracing.ts"
import type * as LaunchProfile from "./LaunchProfile.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"
import type * as UserContext from "./UserContext.ts"
import type * as Watchable from "./Watchable.ts"

const TypeId = "~@usestrider/browser/Browser"

/**
 * What the connected browser is; fixed for the connection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class Info extends Schema.Class<Info>("@usestrider/browser/Browser/Info")({
  product: Schema.String,
  version: Schema.String,
  protocol: Schema.Literals(["cdp", "bidi", "webkit", "fake"]),
  revision: Schema.String
}) {}

/**
 * Schema for one capability and how well the connected browser supports it.
 *
 * **Details**
 *
 * `evidence` names the probe or profile behind the status, and `limitations` lists what a partial status
 * leaves out.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CapabilityEntry = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(["supported", "partial", "unsupported", "unknown"]),
  evidence: Schema.String,
  limitations: Schema.Array(Schema.String)
})

/**
 * One capability and how well the connected browser supports it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CapabilityEntry = typeof CapabilityEntry.Type

/**
 * What the connected browser supports, as its backend describes it, with the `evidence` for each entry.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class CapabilitySet extends Schema.Class<CapabilitySet>("@usestrider/browser/Browser/CapabilitySet")({
  entries: Schema.Array(CapabilityEntry)
}) {
  /**
   * Whether the capability's status is `"supported"`.
   *
   * **Example** (Emulating a locale only where the browser can)
   *
   * ```ts import.meta.vitest
   * import type { Browser } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const germanPage = Effect.fn("germanPage")(function*(browser: Browser.Browser) {
   *   const capabilities = yield* browser.capabilities
   *   const emulation = capabilities.has("emulation.locale") ? { locale: "de-DE" } : {}
   *   return yield* browser.newPage({ emulation })
   * })
   * ```
   */
  has(name: string): boolean {
    return this.entries.some((entry) => entry.name === name && entry.status === "supported")
  }
}

/**
 * The connected browser.
 *
 * @stability unstable
 * @category services
 * @since 0.1.0
 */
export interface Browser {
  readonly [TypeId]: typeof TypeId
  /**
   * What the browser is; fixed for the connection.
   */
  readonly info: Info
  /**
   * What it supports, as its backend describes it.
   *
   * **Example** (Listing what the browser can't do)
   *
   * ```ts import.meta.vitest
   * import { Browser } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const missing = Effect.gen(function*() {
   *   const browser = yield* Browser.Browser
   *   const { entries } = yield* browser.capabilities
   *   const unsupported = entries.filter((entry) => entry.status === "unsupported")
   *   return unsupported.map((entry) => entry.name)
   * })
   * ```
   */
  readonly capabilities: Watchable.Watchable<CapabilitySet>
  /**
   * Creates a context you own, removed when the scope closes.
   *
   * **Example** (Two pages sharing one context's storage)
   *
   * ```ts import.meta.vitest
   * import type { Browser } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const shopAndCart = Effect.fn("shopAndCart")(function*(browser: Browser.Browser) {
   *   const context = yield* browser.newContext()
   *   const shop = yield* context.newPage
   *   const cart = yield* context.newPage
   *   yield* shop.goto("https://shop.example.com")
   *   yield* cart.goto("https://shop.example.com/cart")
   * })
   * ```
   */
  newContext(
    options?: UserContext.Options | undefined
  ): Effect.Effect<UserContext.UserContext, UserContext.UserContextError | Deadline.Timeout, Scope.Scope>
  /**
   * Creates a context and a page in it, released together: `newContext`, then its `newPage`.
   *
   * **Example** (A page that accepts every dialog)
   *
   * ```ts import.meta.vitest
   * import type { Browser } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const openShop = Effect.fn("openShop")(function*(browser: Browser.Browser) {
   *   const page = yield* browser.newPage({ dialogs: "accept" })
   *   yield* page.goto("https://shop.example.com")
   *   return page
   * })
   * ```
   */
  newPage(
    options?: UserContext.Options | undefined
  ): Effect.Effect<Page.Page, Page.PageError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
  /**
   * Every page of the browser, kept up to date as pages open and close. A page this connection created, or whose
   * context it created, is a `Page`. Any other, such as a launched browser's first tab or an attached browser's
   * tabs, is an observed page, whose `inspect` and `control` give access for a scope.
   *
   * **Example** (Waiting for a second tab)
   *
   * ```ts import.meta.vitest
   * import { Browser } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const secondTab = Effect.gen(function*() {
   *   const browser = yield* Browser.Browser
   *   const pages = yield* browser.pages.waitFor((pages) => pages.length >= 2)
   *   return pages[1]!
   * })
   * ```
   */
  readonly pages: Watchable.Watchable<ReadonlyArray<Page.ObservedPage>>
  /**
   * The browser's default context; fixed, because it exists for the whole connection.
   */
  readonly defaultContext: UserContext.ObservedUserContext
}

/**
 * The service tag for `Browser`, provided by a backend layer.
 *
 * @stability unstable
 * @category tags
 * @since 0.1.0
 */
export const Browser: Context.Service<Browser, Browser> = BrowserService.Browser

/**
 * Checks whether a value is a `Browser`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isBrowser = (u: unknown): u is Browser => Predicate.hasProperty(u, TypeId)

/**
 * Creates a context and a page in it, using the `Browser` from context; both close when the scope closes.
 *
 * **When to use**
 *
 * Use as the starting point of a test or script. Code that already holds a `Browser` calls its `newPage`
 * member, which does the same.
 *
 * **Example** (Opening a page with a German locale)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage({ emulation: { locale: "de-DE" } })
 *   yield* page.goto("https://shop.example.com")
 *   return yield* page.title
 * }))
 * ```
 *
 * @stability unstable
 * @category accessors
 * @since 0.1.0
 */
export const newPage = (
  options?: UserContext.Options | undefined
): Effect.Effect<Page.Page, Page.PageError | Target.TargetGone | Deadline.Timeout, Browser | Scope.Scope> =>
  Effect.flatMap(Effect.service(Browser), (browser) => browser.newPage(options))

/**
 * Creates a context you own, using the `Browser` from context; removed when the scope closes.
 *
 * **Example** (Starting from a saved login)
 *
 * ```ts import.meta.vitest
 * import { Browser, StorageState } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * declare const signedIn: StorageState.StorageState
 *
 * const account = Effect.scoped(Effect.gen(function*() {
 *   const context = yield* Browser.newContext({ storageState: signedIn })
 *   const page = yield* context.newPage
 *   yield* page.goto("https://app.example.com/account")
 *   return yield* page.title
 * }))
 * ```
 *
 * @stability unstable
 * @category accessors
 * @since 0.1.0
 */
export const newContext = (
  options?: UserContext.Options | undefined
): Effect.Effect<UserContext.UserContext, UserContext.UserContextError | Deadline.Timeout, Browser | Scope.Scope> =>
  Effect.flatMap(Effect.service(Browser), (browser) => browser.newContext(options))

/**
 * Settings for launching a browser: the executable to run, and how to run it.
 *
 * **Details**
 *
 * `executablePath` must be absolute, and nothing else is looked up: not `PATH`, not an install location. A relative
 * path or a bare command name fails with `InvalidInput`, and a path with no file there with `ExecutableNotFound`.
 * Code that runs on several machines reads it from the environment with the backend's `layerConfig`.
 *
 * **Gotchas**
 *
 * Strider never downloads or installs a browser. Install it as you would any program (an operating system's
 * package, a vendor's installer, a Nix package) and name its executable here. `strider browsers` lists the ones it
 * can find on this machine, with their versions.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LaunchOptions {
  /**
   * The browser's executable, as an absolute path.
   */
  readonly executablePath: FilePath.Local | string
  /**
   * Run without a visible window. WebKit has no headless mode, so `true` fails there with `InvalidInput`.
   *
   * @default true, except on WebKit, which opens a window
   */
  readonly headless?: boolean | undefined
  /**
   * Extra command-line arguments, added after the profile's.
   *
   * @default none
   */
  readonly args?: ReadonlyArray<string> | undefined
  /**
   * The browser's flags and preferences, as an inspectable value. WebKit takes neither.
   *
   * @default LaunchProfile.automation
   */
  readonly profile?: LaunchProfile.LaunchProfile | undefined
  /**
   * A profile directory you own, never deleted. Chromium and Firefox lock it while they run, so two browsers can't
   * share one. On WebKit, it's the default context's only. Once `Chromium.layer` connects to the browser it
   * launched, closing its scope asks that browser to close and waits up to five seconds for exit. If it is still
   * running, Strider sends SIGTERM, then SIGKILL five seconds later if it has not exited. A hung browser can take
   * roughly ten seconds to stop, plus process-group cleanup. If startup fails after spawning the browser, cleanup
   * skips the graceful-close wait and uses signals. This best effort helps preserve recent storage; crashes or
   * forced termination can still lose writes.
   *
   * @default a temporary profile, deleted after the browser exits
   */
  readonly userDataDir?: FilePath.Local | string | undefined
  /**
   * Let the browser write a core dump when it crashes. A crashed page is reported once its process has exited, and
   * on a host that writes core dumps, a process doesn't exit until its core is written, which can take half a
   * minute or more. So the browser starts with the limit on core dumps at 0, through `sh`, which then becomes the
   * browser. It does nothing on Windows, which has no such limit. Set it to `true` to debug a crash with its core.
   *
   * @default false
   */
  readonly coreDumps?: boolean | undefined
}

/**
 * Settings for connecting to a running browser.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ConnectOptions {
  /**
   * Headers for the WebSocket handshakes and HTTP requests, such as a grid's token.
   *
   * @default none
   */
  readonly headers?: Readonly<Record<string, string | Redacted.Redacted<string>>> | undefined
}

/**
 * Provides a fake `Browser` whose first page plays a scripted timeline, for event and lifecycle tests.
 *
 * **Details**
 *
 * The timeline is marble-style, after RxJS's `TestScheduler`, and runs on Effect's clock, so under `TestClock`
 * it moves only as the test adjusts it. Deadlines run on the clock the browser runs on, so here they are on
 * Effect's clock too: a `next` within 200 ms times out when the test adjusts the clock past it, never before. The
 * first page opened plays it:
 *
 * - `-` is a tick of 10 ms;
 * - `commit` commits a document at `https://example.test/`, and `load` makes it interactive, then complete;
 * - `resp(name)` is a request for `https://example.test/name`, answered with 200 and finished;
 * - `dialog(kind)` opens an `alert`, `confirm`, `prompt`, or `beforeunload` prompt, decided as any dialog is;
 * - `popup` opens a popup with the page as its opener;
 * - `crash` ends the page as crashed, and `|` as closed by its script.
 *
 * The same model that follows a real browser's events follows the fake's, so events, waits, and lifetimes behave
 * as they do with a browser. `goto` and `reload` commit at once; `info.protocol` is `"fake"`.
 *
 * **Gotchas**
 *
 * The fake has no DOM: locator actions and reads fail with `Unsupported`. It tests what happens around
 * events and lifetimes, not page content. A timeline it can't read fails the layer as a defect, naming where.
 *
 * **Example** (Testing a response that arrives before its wait runs)
 *
 * ```ts import.meta.vitest
 * import { Browser, NetworkResponse } from "@usestrider/browser"
 * import { Effect } from "effect"
 * import { TestClock } from "effect/testing"
 *
 * const test = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   const cart = yield* NetworkResponse.next(page, { url: "https://example.test/cart" })
 *   yield* TestClock.adjust("20 millis")
 *   return yield* cart
 * })).pipe(Effect.provide(Browser.layerTest("--resp(cart)--commit--load--|")))
 * ```
 *
 * @stability experimental
 * @category layers
 * @since 0.1.0
 */
export const layerTest = (timeline: string): Layer.Layer<Browser> =>
  Layer.unwrap(Clock.clockWith((clock) =>
    Effect.sync(() =>
      // Its browser is a timeline on Effect's clock, which its deadlines are on too
      Layer.provideMerge(
        BrowserImpl.layer(Fake.connect(Fake.parse(timeline), {
          info: new Info(Fake.info),
          capabilities: new CapabilitySet({ entries: Fake.capabilities })
        })),
        Layer.succeed(BrowserClock.CurrentClock, BrowserClock.fromClock(clock))
      )
    )
  ))

/**
 * What a span is about, as given to `SpanNameGenerator` and `TracerDisabledWhen`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Operation extends Tracing.Operation {
  /**
   * The operation, such as `Locator.click` or `Download.next`.
   */
  readonly name: string
  readonly target: Target.Description
}

/**
 * Reference to the function that names each operation's span; by default the operation's name, such as
 * `Locator.click`.
 *
 * **Details**
 *
 * Every operation opens one span. Its attributes are `browser.operation`, the id of what it acts on
 * (`browser.page.id`, `browser.context.id`, or `browser.realm.id`), attributes of its own, such as
 * `browser.locator`, and a URL as `url.full`, shown as `Diagnostics.CurrentPreset` allows.
 *
 * **Example** (Prefixing every span with the service's name)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * declare const checkout: Effect.Effect<void>
 *
 * const traced = checkout.pipe(
 *   Effect.provideService(
 *     Browser.SpanNameGenerator,
 *     (operation) => `shop ${operation.name}`
 *   )
 * )
 * ```
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const SpanNameGenerator: Context.Reference<(operation: Operation) => string> = Tracing.SpanNameGenerator

/**
 * Reference to a predicate that suppresses an operation's span when it returns `true`.
 *
 * **Example** (Leaving visibility checks out of traces)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * declare const checkout: Effect.Effect<void>
 *
 * const quieter = checkout.pipe(
 *   Effect.provideService(
 *     Browser.TracerDisabledWhen,
 *     (operation) => operation.name === "Locator.isVisible"
 *   )
 * )
 * ```
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const TracerDisabledWhen: Context.Reference<Predicate.Predicate<Operation>> = Tracing.TracerDisabledWhen

/**
 * Reference to whether each protocol command gets a child span; off unless set, because commands are a hot
 * path.
 *
 * **Details**
 *
 * A command's span is named by its method, such as `Page.navigate` or `browsingContext.navigate`, with
 * `browser.protocol.method` and `browser.protocol.id`, under the span of the operation that sent it. It's read
 * where each command is sent, so it can be set around one operation.
 *
 * **Example** (Tracing the commands of one click)
 *
 * ```ts import.meta.vitest
 * import { Browser, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const placeOrder = Effect.fn("placeOrder")(function*(page: Page.Page) {
 *   yield* page.getByRole("button", { name: "Place order" }).click().pipe(
 *     Effect.provideService(Browser.TraceProtocolCommands, true)
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const TraceProtocolCommands: Context.Reference<boolean> = Tracing.TraceProtocolCommands

/**
 * Reason for a launch whose `executablePath` names no file.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class ExecutableNotFound
  extends Schema.Error<ExecutableNotFound>("@usestrider/browser/Browser/ExecutableNotFound")({
    _tag: Schema.tag("ExecutableNotFound"),
    searched: Schema.Array(Schema.String),
    hint: Schema.String
  })
{
  override get message(): string {
    return `No browser executable found (${this.hint})`
  }
}

/**
 * Reason for a browser process that exited before it was ready.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class ProcessExited extends Schema.Error<ProcessExited>("@usestrider/browser/Browser/ProcessExited")({
  _tag: Schema.tag("ProcessExited"),
  code: Schema.Option(Schema.Int),
  stderrTail: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `The browser exited before it was ready (${this.hint})`
  }
}

/**
 * Reason for a browser whose protocol revision this version of Strider doesn't support.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class IncompatibleRevision extends Schema.Error<IncompatibleRevision>(
  "@usestrider/browser/Browser/IncompatibleRevision"
)({
  _tag: Schema.tag("IncompatibleRevision"),
  revision: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `Unsupported browser revision ${this.revision} (${this.hint})`
  }
}

/**
 * Reason for a connection that was refused, or whose handshake failed.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class ConnectionFailed extends Schema.Error<ConnectionFailed>("@usestrider/browser/Browser/ConnectionFailed")({
  _tag: Schema.tag("ConnectionFailed"),
  stage: Schema.Literals(["refused", "handshake"]),
  hint: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {
  override get message(): string {
    return `Connection ${this.stage} failed (${this.hint})`
  }
}

/**
 * Schema for the reasons launching or connecting can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BrowserErrorReason = Schema.Union([
  ExecutableNotFound,
  ProcessExited,
  IncompatibleRevision,
  ConnectionFailed,
  Reason.InvalidInput
])

/**
 * The reasons launching or connecting can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BrowserErrorReason = typeof BrowserErrorReason.Type

const BrowserErrorTypeId = "~@usestrider/browser/Browser/BrowserError"

/**
 * Error for a browser that couldn't be launched or connected to.
 *
 * **Example** (Logging the output of a browser that exited at launch)
 *
 * ```ts import.meta.vitest
 * import { NodeServices } from "@effect/platform-node"
 * import { Browser } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { Effect, Layer } from "effect"
 *
 * const ChromiumLive = Chromium.layer({ executablePath: "/usr/bin/chromium" }).pipe(
 *   Layer.provide(NodeServices.layer)
 * )
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage()
 *   yield* page.goto("https://shop.example.com")
 * })).pipe(
 *   Effect.provide(ChromiumLive),
 *   Effect.catchReason(
 *     "BrowserError",
 *     "ProcessExited",
 *     (reason) => Effect.logError(reason.stderrTail)
 *   )
 * )
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class BrowserError extends Schema.TaggedError<BrowserError>(BrowserErrorTypeId)("BrowserError", {
  reason: BrowserErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [BrowserErrorTypeId] = BrowserErrorTypeId
  override get message(): string {
    return this.reason.message
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}

/**
 * Checks whether a value is a `BrowserError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isBrowserError = (u: unknown): u is BrowserError => Predicate.hasProperty(u, BrowserErrorTypeId)
