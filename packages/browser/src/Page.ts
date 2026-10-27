/**
 * Pages, at three access levels: `ObservedPage` ⊂ `ReadonlyPage` ⊂ `Page`, like `ReadonlyArray` ⊂ `Array`.
 *
 * - An `ObservedPage` offers state and events only.
 * - A `ReadonlyPage` adds reads in the isolated world, where the page's own globals are invisible, and never
 *   scrolls, focuses or dispatches input.
 * - A `Page` adds input, navigation, main-world evaluation and declarations.
 *
 * Access is a grant held by a `Scope`: `inspect` and `control` are the only ways up, and no type guard
 * narrows it. A subtype never changes what an inherited member does: `evaluate` is the isolated world on every
 * page, and the main world is only `evaluateInMainWorld`, on a `Page`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Equal from "effect/Equal"
import type * as Inspectable from "effect/Inspectable"
import type * as Option from "effect/Option"
import type * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as AriaRole from "./AriaRole.ts"
import type * as BrowserWorker from "./BrowserWorker.ts"
import type * as Capability from "./Capability.ts"
import type * as Deadline from "./Deadline.ts"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as Dialog from "./Dialog.ts"
import type * as Emulation from "./Emulation.ts"
import type * as InitScript from "./InitScript.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import type * as JSHandle from "./JSHandle.ts"
import type * as Keyboard from "./Keyboard.ts"
import * as Locator from "./Locator.ts"
import type * as Mouse from "./Mouse.ts"
import type * as OriginStorage from "./OriginStorage.ts"
import type * as PageClock from "./PageClock.ts"
import * as PageNavigation from "./PageNavigation.ts"
import type * as Pixels from "./Pixels.ts"
import * as Reason from "./Reason.ts"
import type * as Route from "./Route.ts"
import type * as Snapshot from "./Snapshot.ts"
import * as Target from "./Target.ts"
import * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"
import type * as Watchable from "./Watchable.ts"

const TypeId = "~@usestrider/browser/Page"

/**
 * Schema for the state of a page's current document.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DocumentStatus = Schema.Struct({
  id: Target.DocumentId,
  readiness: Schema.Literals(["loading", "interactive", "complete"]),
  lifecycle: Schema.Literals(["active", "suspended"])
})

/**
 * The state of a page's current document.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DocumentStatus = typeof DocumentStatus.Type

/**
 * Schema for a user prompt that is open on the page.
 *
 * **Details**
 *
 * `blocking` is `"confirmed"` when the browser reported the prompt, and `"suspected"` when the page stopped
 * responding in a way that only a prompt explains.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Prompt = Schema.Struct({
  id: Dialog.PromptId,
  kind: Schema.Literals(["alert", "confirm", "prompt", "beforeunload", "unknown"]),
  blocking: Schema.Literals(["confirmed", "suspected"])
})

/**
 * A user prompt that is open on the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Prompt = typeof Prompt.Type

/**
 * Schema for a page's state: open, with its URL, document and any open prompt, or closed, with why.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Status = Schema.Union([
  Schema.TaggedStruct("Open", { url: Url.Url, document: DocumentStatus, prompt: Schema.Option(Prompt) }),
  Schema.TaggedStruct("Closed", { reason: Target.CloseReason })
])

/**
 * A page's state: open, with its URL, document and any open prompt, or closed, with why.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Status = typeof Status.Type

/**
 * A snapshot of a page's frame tree.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FrameTree {
  readonly id: Target.NavigableId
  readonly url: Url.Url
  readonly name: Option.Option<string>
  readonly children: ReadonlyArray<FrameTree>
}

/**
 * The encoded form of a `FrameTree`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FrameTreeEncoded {
  readonly id: string
  readonly url: string
  readonly name: Option.Option<string>
  readonly children: ReadonlyArray<FrameTreeEncoded>
}

/**
 * Schema for a snapshot of a page's frame tree.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FrameTree: Schema.Codec<FrameTree, FrameTreeEncoded> = Schema.Struct({
  id: Target.NavigableId,
  url: Url.Url,
  name: Schema.Option(Schema.String),
  children: Schema.Array(Schema.suspend((): Schema.Codec<FrameTree, FrameTreeEncoded> => FrameTree))
})

/**
 * Settings for `screenshot`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScreenshotOptions {
  /**
   * What to capture. An element is captured beyond the viewport if needed, never by scrolling.
   *
   * @default the viewport
   */
  readonly area?:
    | { readonly _tag: "Viewport" }
    | { readonly _tag: "FullPage" }
    | {
      readonly _tag: "Clip"
      readonly rect: {
        readonly x: Pixels.Css
        readonly y: Pixels.Css
        readonly width: Pixels.Css
        readonly height: Pixels.Css
      }
    }
    | { readonly _tag: "Element"; readonly locator: Locator.ReadonlyLocator }
    | undefined
  /**
   * The image format.
   *
   * @default PNG
   */
  readonly format?: { readonly _tag: "Png" } | { readonly _tag: "Jpeg"; readonly quality: number } | undefined
  /**
   * One image pixel per CSS pixel, or per device pixel.
   *
   * @default "device"
   */
  readonly scale?: "css" | "device" | undefined
  /**
   * Make the default white background transparent.
   *
   * @default false
   */
  readonly omitBackground?: boolean | undefined
}

/**
 * A length for PDF paper sizes and margins.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Length {
  readonly value: number
  readonly unit: "in" | "cm" | "mm" | "px"
}

/**
 * Settings for `pdf`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PdfOptions {
  /**
   * The paper size, by name or by its dimensions.
   *
   * @default "letter"
   */
  readonly paper?:
    | "letter"
    | "legal"
    | "tabloid"
    | "a3"
    | "a4"
    | "a5"
    | { readonly width: Length; readonly height: Length }
    | undefined
  /**
   * Print in landscape orientation.
   *
   * @default false
   */
  readonly landscape?: boolean | undefined
  /**
   * Margins around each page.
   *
   * @default none
   */
  readonly margins?: {
    readonly top?: Length | undefined
    readonly right?: Length | undefined
    readonly bottom?: Length | undefined
    readonly left?: Length | undefined
  } | undefined
  /**
   * A zoom factor for the printed page.
   *
   * @default 1
   */
  readonly scale?: number | undefined
  /**
   * Print background graphics.
   *
   * @default false
   */
  readonly background?: boolean | undefined
  /**
   * Pages to print, such as `"1-3, 5"`.
   *
   * @default every page
   */
  readonly pageRanges?: string | undefined
  /**
   * Use the page's CSS `@page` size over `paper`.
   *
   * @default false
   */
  readonly preferCssPageSize?: boolean | undefined
  /**
   * An HTML template for the header; unsupported on BiDi.
   */
  readonly header?: string | undefined
  /**
   * An HTML template for the footer; unsupported on BiDi.
   */
  readonly footer?: string | undefined
}

/**
 * Settings for `goto`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GotoOptions {
  /**
   * How far the navigation must get before `goto` returns.
   *
   * @default "commit"
   */
  readonly waitUntil?: PageNavigation.LoadState | undefined
  /**
   * Outcomes to accept as navigations: a download is returned as `PageNavigation`'s `BecameDownload`, and a 204
   * or 205 as its `NoContent`, with the response. Otherwise a download fails with the `BecameDownload` reason and
   * a 204 with `NoContent`. Either way the page stays where it was.
   *
   * @default none
   */
  readonly accept?: ReadonlyArray<"download" | "noContent"> | undefined
}

/**
 * Settings for `reload`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReloadOptions {
  /**
   * How far the navigation must get before the call returns.
   *
   * @default "commit"
   */
  readonly waitUntil?: PageNavigation.LoadState | undefined
  /**
   * Reload without the HTTP cache.
   *
   * @default false
   */
  readonly bypassCache?: boolean | undefined
}

/**
 * Settings for `back` and `forward`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TraverseOptions {
  /**
   * How far the navigation must get before the call returns.
   *
   * @default "commit"
   */
  readonly waitUntil?: PageNavigation.LoadState | undefined
}

/**
 * A page you can observe: its state and events, but no reads of its content.
 *
 * **Details**
 *
 * Pages are equal by identity: a `ReadonlyPage` and a `Page` for the same tab are equal, because identity is
 * the tab and not the access level.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ObservedPage extends Pipeable.Pipeable, Equal.Equal, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId
  readonly id: Target.NavigableId
  /**
   * One consistent view of the page's state; ends with `Closed`.
   */
  readonly status: Watchable.Watchable<Status>
  /**
   * The page's URL; `status.map(…)`, so it never disagrees with `status`.
   */
  readonly url: Watchable.Watchable<Url.Url>
  /**
   * The frame tree.
   */
  readonly frames: Watchable.Watchable<FrameTree>
  /**
   * The page's dedicated workers.
   */
  readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.ObservedBrowserWorker>>
  /**
   * Waits as long as the page lives, then gives the reason it ended.
   */
  readonly closed: Effect.Effect<Target.CloseReason>
  /**
   * Gains inspect access for the scope: installs the isolated world. The page stays open after.
   */
  readonly inspect: Effect.Effect<ReadonlyPage, PageError, Scope.Scope>
  /**
   * Gains control for the scope. The page stays open after.
   */
  readonly control: Effect.Effect<Page, PageError, Scope.Scope>
}

/**
 * A page you can read: locators, snapshots, captures and isolated-world evaluation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReadonlyPage extends ObservedPage, Locator.Queries<Locator.ReadonlyLocator> {
  /**
   * Enters an iframe by its element.
   */
  frame(iframe: Locator.ReadonlyLocator): Locator.ReadonlyFrameLocator
  /**
   * The document's title, read now.
   */
  readonly title: Effect.Effect<string, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * The document's serialized HTML.
   */
  readonly readHtml: Effect.Effect<string, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * A snapshot of the page: the accessibility tree, with inferred interactivity unless `sources` is `"aria"`.
   */
  snapshot(
    options?: Snapshot.Options | undefined
  ): Effect.Effect<Snapshot.Snapshot<Locator.ReadonlyLocator>, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * A screenshot; the viewport as PNG unless options say otherwise.
   */
  screenshot(
    options?: ScreenshotOptions | undefined
  ): Effect.Effect<Uint8Array, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * The page printed as PDF.
   */
  pdf(options?: PdfOptions | undefined): Effect.Effect<Uint8Array, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * The current origin's `localStorage`, readable.
   */
  readonly localStorage: OriginStorage.ReadonlyOriginStorage
  /**
   * The current origin's `sessionStorage`, readable.
   */
  readonly sessionStorage: OriginStorage.ReadonlyOriginStorage
  /**
   * Calls `fn` in the isolated world, where page globals are invisible, and returns the result by value.
   *
   * **Example** (The result type is what arrives)
   *
   * ```ts import.meta.vitest
   * import { Effect } from "effect"
   * import { Page } from "@usestrider/browser"
   *
   * const now = Effect.fn("now")(function*(page: Page.ReadonlyPage) {
   *   const when: Date = yield* page.evaluate(() => new Date())
   *   return when
   * })
   * ```
   */
  evaluate<Args extends ReadonlyArray<unknown>, A>(
    fn: (...args: Args) => A | Promise<A>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<A>, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Acquires a specialized feature bound to this page, for the caller's scope. A backend without it fails with
   * `Unsupported`, naming the backends that have it.
   */
  capability<H>(
    capability: Capability.Capability<H>
  ): Effect.Effect<H, Capability.CapabilityError | Target.TargetGone, Scope.Scope>
}

/**
 * A page you control.
 *
 * **Example** (Navigate, act, read)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Expect, Page } from "@usestrider/browser"
 *
 * const search = Effect.fn("search")(function*(page: Page.Page, query: string) {
 *   yield* page.goto("https://shop.example.com")
 *   yield* page.getByRole("searchbox").fill(query)
 *   yield* page.getByRole("searchbox").press("Enter")
 *   yield* page.getByRole("heading", { name: "Results" }).pipe(Expect.toBeVisible)
 *   return yield* page.getByRole("listitem").count
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Page extends ReadonlyPage {
  getByRole(role: AriaRole.AriaRole, options?: Locator.RoleOptions | undefined): Locator.Locator
  getByText(text: string | RegExp, options?: Locator.TextOptions | undefined): Locator.Locator
  getByLabel(text: string | RegExp, options?: Locator.TextOptions | undefined): Locator.Locator
  getByPlaceholder(text: string | RegExp, options?: Locator.TextOptions | undefined): Locator.Locator
  getByAltText(text: string | RegExp, options?: Locator.TextOptions | undefined): Locator.Locator
  getByTitle(text: string | RegExp, options?: Locator.TextOptions | undefined): Locator.Locator
  getByTestId(id: string): Locator.Locator
  locator(css: string): Locator.Locator
  frame(iframe: Locator.ReadonlyLocator): Locator.FrameLocator
  snapshot(
    options?: Snapshot.Options | undefined
  ): Effect.Effect<Snapshot.Snapshot<Locator.Locator>, PageError | Target.TargetGone | Deadline.Timeout>
  readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.BrowserWorker>>
  readonly localStorage: OriginStorage.OriginStorage
  readonly sessionStorage: OriginStorage.OriginStorage
  /**
   * The page's context; fixed, because a page never changes context.
   */
  readonly context: UserContext.UserContext
  /**
   * Navigates to `url`; returns at commit unless `waitUntil` asks for more.
   */
  goto(
    url: Url.Url | string,
    options?: GotoOptions | undefined
  ): Effect.Effect<PageNavigation.PageNavigation, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Reloads the current document.
   */
  reload(
    options?: ReloadOptions | undefined
  ): Effect.Effect<PageNavigation.PageNavigation, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Goes back one history entry; `None` when there is none.
   */
  back(
    options?: TraverseOptions | undefined
  ): Effect.Effect<Option.Option<PageNavigation.PageNavigation>, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Goes forward one history entry; `None` when there is none.
   */
  forward(
    options?: TraverseOptions | undefined
  ): Effect.Effect<Option.Option<PageNavigation.PageNavigation>, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` in the page's main world, where its own globals are visible, and returns the result by value.
   *
   * **Gotchas**
   *
   * Page scripts can see and tamper with what runs here. Prefer `evaluate` unless you need the page's
   * globals. Wrap the call in `Page.withUserGesture` when the page checks for one.
   */
  evaluateInMainWorld<Args extends ReadonlyArray<unknown>, A>(
    fn: (...args: Args) => A | Promise<A>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<A>, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` in the isolated world and returns its result as a handle, for values that can't cross.
   */
  evaluateHandle<Args extends ReadonlyArray<unknown>, A>(
    fn: (...args: Args) => A | Promise<A>,
    ...args: Args
  ): Effect.Effect<JSHandle.JSHandle<Awaited<A>>, PageError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
  /**
   * The page's keyboard.
   */
  readonly keyboard: Keyboard.Keyboard
  /**
   * The page's mouse.
   */
  readonly mouse: Mouse.Mouse
  /**
   * The page's clock.
   */
  readonly clock: PageClock.PageClock
  /**
   * Intercepts the page's requests matching `pattern` at one phase while the registration lives.
   *
   * **Details**
   *
   * The page's routes are asked before its context's, the most recent first; one that falls through passes
   * the request on. Each handler runs in a fiber of the registration's scope, with `Deadline.DefaultBudget`
   * as read here, per request. The phase is `"request"` unless `options.phase` says `"response"` or
   * `"auth"`, and decides what the handler is given and may decide.
   *
   * **Gotchas**
   *
   * On Chromium, a route that matches a cross-origin request also sees its CORS preflight, an `OPTIONS`
   * request, which Firefox and WebKit don't show. WebKit pauses only a redirect's first hop.
   */
  route<E, R, P extends Route.Phase = "request">(
    pattern: Url.Pattern | string,
    handler: Route.Handler<E, R, P>,
    options?: Route.Options<P> | undefined
  ): Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone, Scope.Scope | R>
  /**
   * Runs a script in every new document of this page, before its own scripts, while the registration lives.
   *
   * **Details**
   *
   * The context's scripts run first, then the page's, in the order they were added; `after` makes a script
   * depend on others, which it runs only after. Added to a loaded page, a script runs from the next document.
   * See `InitScript` for the rest.
   *
   * **Example** (Ordered setup scripts)
   *
   * ```ts import.meta.vitest
   * import { Effect } from "effect"
   * import { Page } from "@usestrider/browser"
   *
   * const installHooks = Effect.fn("installHooks")(function*(page: Page.Page) {
   *   const helper = yield* page.addInitScript({ source: "window.__hooks = []" })
   *   yield* page.addInitScript({ source: "window.__hooks.push('ready')" }, { after: [helper] })
   * })
   * ```
   */
  addInitScript(
    script: InitScript.Source,
    options?: InitScript.Options | undefined
  ): Effect.Effect<InitScript.InitScript, Declaration.DeclarationError | Target.TargetGone, Scope.Scope>
  /**
   * Overrides the given settings while the registration lives; page overrides beat context ones. One call is
   * one registration, and a field the backend can't apply fails it before anything is applied (`Emulation`).
   */
  emulate(
    settings: Emulation.Emulation
  ): Effect.Effect<Declaration.Registration, Declaration.DeclarationError | Target.TargetGone, Scope.Scope>
  /**
   * Brings the page to the front. Waits that depend on rendering need it.
   */
  readonly activate: Effect.Effect<void, Target.TargetGone>
  /**
   * Closes the page as its owner: no `beforeunload` prompt.
   */
  close(): Effect.Effect<void, Target.TargetGone | Deadline.Timeout>
  /**
   * Closes the page, running `beforeunload` when asked. Its prompt is decided as any dialog is: by the page's
   * `Dialog.handle`, or else its context's policy, which leaves. A handler's stay fails the close with
   * `CloseCanceled` and leaves the page usable. Browsers prompt only once the user has interacted with the page,
   * so an untouched page closes at once.
   */
  close(options: {
    readonly runBeforeUnload: boolean
  }): Effect.Effect<void, PageError | Target.TargetGone | Deadline.Timeout>
}

/**
 * Checks whether a value is a page.
 *
 * **Gotchas**
 *
 * This identifies the kind, not the access: it narrows to `ObservedPage`, because access is a grant held by
 * a scope, not a fact about the page.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isPage = (u: unknown): u is ObservedPage => Predicate.hasProperty(u, TypeId)

/**
 * Reference to whether main-world evaluation runs with a user gesture.
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const UserGesture: Context.Reference<boolean> = Context.Reference<boolean>(
  "@usestrider/browser/Page/UserGesture",
  { defaultValue: () => false }
)

/**
 * Runs main-world evaluation inside an effect with a user gesture, for pages that require one, such as to
 * open a popup or start media.
 *
 * @see {@link UserGesture} for the reference it sets
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export const withUserGesture = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.provideService(self, UserGesture, true)

/**
 * Reason for a page that couldn't be set up for the access it was asked for.
 *
 * **Details**
 *
 * `step` names what failed, such as installing the isolated world.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class InitializationFailed
  extends Schema.Error<InitializationFailed>("@usestrider/browser/Page/InitializationFailed")({
    _tag: Schema.tag("InitializationFailed"),
    step: Schema.String,
    hint: Schema.String
  })
{
  override get message(): string {
    return `Page setup failed at ${this.step} (${this.hint})`
  }
}

/**
 * Reason for a close the page refused through `beforeunload`; the page stays usable.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class CloseCanceled extends Schema.Error<CloseCanceled>("@usestrider/browser/Page/CloseCanceled")({
  _tag: Schema.tag("CloseCanceled"),
  hint: Schema.String
}) {
  override get message(): string {
    return `The page refused to close (${this.hint})`
  }
}

/**
 * Schema for the reasons a page operation can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PageErrorReason = Schema.Union([
  PageNavigation.NavigationFailed,
  PageNavigation.NavigationCanceled,
  PageNavigation.NavigationSuperseded,
  PageNavigation.BecameDownload,
  PageNavigation.NoContent,
  InitializationFailed,
  CloseCanceled,
  Reason.EvaluationThrown,
  Reason.NotSerializable,
  // A capture's element: none, or several (QUIRKS.md, Q126)
  Locator.NoMatch,
  Locator.StrictViolation,
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure,
  Reason.PromptBlocking
])

/**
 * The reasons a page operation can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PageErrorReason = typeof PageErrorReason.Type

const PageErrorTypeId = "~@usestrider/browser/Page/PageError"

/**
 * Error for a page operation that failed: navigation, evaluation, capture, reads, or setting the page up.
 *
 * **Example** (Accepting a failed navigation)
 *
 * ```ts import.meta.vitest
 * import { Effect, Option } from "effect"
 * import { Page } from "@usestrider/browser"
 *
 * const tryOpen = Effect.fn("tryOpen")(function*(page: Page.Page, url: string) {
 *   return yield* page.goto(url).pipe(
 *     Effect.map(Option.some),
 *     Effect.catchReason("PageError", "NavigationFailed", () => Effect.succeedNone)
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class PageError extends Schema.TaggedError<PageError>(PageErrorTypeId)("PageError", {
  operation: Schema.String,
  reason: PageErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [PageErrorTypeId] = PageErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}

/**
 * Checks whether a value is a `PageError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isPageError = (u: unknown): u is PageError => Predicate.hasProperty(u, PageErrorTypeId)
