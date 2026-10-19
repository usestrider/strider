/**
 * Pages, at three access levels: ObservedPage ⊂ ReadonlyPage ⊂ Page, like ReadonlyArray ⊂ Array.
 *
 * Access is a grant held by a Scope (`.inspect`, `.control`), never narrowed by a type guard. A subtype never
 * changes what an inherited member does: `evaluate` is the isolated world on every page, and the main world is
 * only `evaluateWith({ world: "main" })` on a Page.
 */
import type { Effect, Option, Redacted, Scope } from "effect"
import type { AriaRole, CssPixels, DocumentId, NavigableId, PromptId, Url, UrlPattern } from "./Brand.ts"
import type { Capability } from "./Capability.ts"
import type {
  CaptureError, CapabilityError, CloseCanceled, CloseReason, DeclarationError, EvaluationError, NavigationError,
  PageError, ReadError, RouteError, StorageError, TargetGone, Timeout
} from "./Errors.ts"
import type { BrowserWorker, ObservedBrowserWorker, PageNavigation } from "./Events.ts"
import type { JSHandle, Serialized } from "./Handle.ts"
import type { Keyboard, Mouse } from "./Input.ts"
import type { FrameLocator, Locator, ReadonlyFrameLocator, ReadonlyLocator, RoleOptions, TextOptions } from "./Locator.ts"
import type { InitScript, InitScriptOptions, InitScriptSource, Registration, RouteHandler, RouteRegistration } from "./Network.ts"
import type { PageClock } from "./PageClock.ts"
import type { Snapshot, SnapshotOptions } from "./Snapshot.ts"
import type { Emulation, UserContext } from "./UserContext.ts"
import type { Watchable } from "./Watchable.ts"

// ── State ─────────────────────────────────────────────────────
export type PageStatus =
  | { readonly _tag: "Open"; readonly url: Url; readonly document: DocumentStatus; readonly prompt: Option.Option<PromptSnapshot> }
  | { readonly _tag: "Closed"; readonly reason: CloseReason }
export interface DocumentStatus {
  readonly id: DocumentId
  readonly readiness: "loading" | "interactive" | "complete"
  readonly lifecycle: "active" | "suspended"
}
export interface PromptSnapshot {
  readonly id: PromptId
  readonly kind: "alert" | "confirm" | "prompt" | "beforeunload"
  readonly blocking: "confirmed" | "suspected"
}
export interface FrameTree {                            // a snapshot of the frame tree, as state
  readonly id: NavigableId
  readonly url: Url
  readonly name: Option.Option<string>
  readonly children: ReadonlyArray<FrameTree>
}
/** goto, reload, back and forward resolve at commit unless waitUntil asks for more; the span records which. */
export type LoadState = "commit" | "domContentLoaded" | "load"

// ── Capture options ───────────────────────────────────────────
export interface ScreenshotOptions {
  readonly area?:                                       // default the viewport
    | { readonly _tag: "Viewport" } | { readonly _tag: "FullPage" }
    | { readonly _tag: "Clip"; readonly rect: { readonly x: CssPixels; readonly y: CssPixels; readonly width: CssPixels; readonly height: CssPixels } }
    | { readonly _tag: "Element"; readonly locator: ReadonlyLocator }   // captured beyond the viewport, never by scrolling
  readonly format?: { readonly _tag: "Png" } | { readonly _tag: "Jpeg"; readonly quality: number }   // default PNG
  readonly scale?: "css" | "device"                     // default "device"
  readonly omitBackground?: boolean                     // default false
}
export interface Length { readonly value: number; readonly unit: "in" | "cm" | "mm" | "px" }
export interface PdfOptions {                           // (new in the sketch)
  readonly paper?: "letter" | "legal" | "tabloid" | "a3" | "a4" | "a5" | { readonly width: Length; readonly height: Length }   // default "letter"
  readonly landscape?: boolean                          // default false
  readonly margins?: { readonly top?: Length; readonly right?: Length; readonly bottom?: Length; readonly left?: Length }   // default none
  readonly scale?: number                               // default 1
  readonly background?: boolean                         // default false: no background graphics
  readonly pageRanges?: string                          // e.g. "1-3, 5"; default every page
  readonly preferCssPageSize?: boolean                  // default false
  readonly header?: string                              // HTML template; Unsupported on BiDi
  readonly footer?: string
}

// ── Origin storage: localStorage and sessionStorage of the current document's origin (new in the sketch) ──
export interface ReadonlyOriginStorage {
  readonly entries: Effect.Effect<ReadonlyArray<readonly [key: string, value: string]>, StorageError | TargetGone>
  get(key: string): Effect.Effect<Option.Option<string>, StorageError | TargetGone>
}
export interface OriginStorage extends ReadonlyOriginStorage {
  set(key: string, value: string | Redacted.Redacted<string>): Effect.Effect<void, StorageError | TargetGone>
  remove(key: string): Effect.Effect<void, StorageError | TargetGone>
  readonly clear: Effect.Effect<void, StorageError | TargetGone>
}

// ── ObservedPage: state and events only ───────────────────────
export interface ObservedPage {
  readonly id: NavigableId
  readonly status: Watchable<PageStatus>                // one consistent snapshot; ends with Closed{reason}
  readonly url: Watchable<Url>                          // status.map(…): derived from the same source
  readonly frames: Watchable<FrameTree>
  readonly workers: Watchable<ReadonlyArray<ObservedBrowserWorker>>   // dedicated workers of this page (new in the sketch)
  readonly closed: Effect.Effect<CloseReason>           // a lifetime signal: waits as long as the page lives
  readonly inspect: Effect.Effect<ReadonlyPage, PageError, Scope.Scope>   // installs the utility world; never scrolls, focuses or dispatches input
  readonly control: Effect.Effect<Page, PageError, Scope.Scope>           // access lasts for the scope; the page stays open
}

// ── ReadonlyPage: adds isolated-world reads ───────────────────
export interface ReadonlyPage extends ObservedPage {
  getByRole(role: AriaRole, options?: RoleOptions): ReadonlyLocator
  getByText(text: string | RegExp, options?: TextOptions): ReadonlyLocator
  getByLabel(text: string | RegExp, options?: TextOptions): ReadonlyLocator
  getByPlaceholder(text: string | RegExp, options?: TextOptions): ReadonlyLocator
  getByAltText(text: string | RegExp, options?: TextOptions): ReadonlyLocator
  getByTitle(text: string | RegExp, options?: TextOptions): ReadonlyLocator
  getByTestId(id: string): ReadonlyLocator
  locator(css: string): ReadonlyLocator
  frame(iframe: ReadonlyLocator): ReadonlyFrameLocator
  // one-shot reads
  readonly title: Effect.Effect<string, ReadError>
  readonly readHtml: Effect.Effect<string, ReadError>   // the document's serialized HTML (new in the sketch)
  readonly ariaSnapshot: Effect.Effect<Snapshot<ReadonlyLocator>, ReadError>   // the accessibility tree only
  readonly snapshot: Effect.Effect<Snapshot<ReadonlyLocator>, ReadError>       // plus inferred interactivity, tagged with evidence
  snapshotWith(options: SnapshotOptions): Effect.Effect<Snapshot<ReadonlyLocator>, ReadError>   // size is explicit: no automatic truncation
  readonly screenshot: Effect.Effect<Uint8Array, CaptureError>                  // the viewport, PNG
  screenshotWith(options: ScreenshotOptions): Effect.Effect<Uint8Array, CaptureError>
  readonly pdf: Effect.Effect<Uint8Array, CaptureError>
  pdfWith(options: PdfOptions): Effect.Effect<Uint8Array, CaptureError>
  readonly localStorage: ReadonlyOriginStorage
  readonly sessionStorage: ReadonlyOriginStorage
  /** The isolated world: page globals are invisible. */
  evaluate<Args extends ReadonlyArray<unknown>, A>(fn: (...args: Args) => A | Promise<A>, ...args: Args):
    Effect.Effect<Serialized<A>, EvaluationError | TargetGone | Timeout>
  /** A specialized feature, bound to this page. */
  capability<H>(capability: Capability<H>): Effect.Effect<H, CapabilityError, Scope.Scope>
}

// ── Page: adds input, navigation, main-world evaluation and declarations ──
export interface Page extends ReadonlyPage {
  getByRole(role: AriaRole, options?: RoleOptions): Locator
  getByText(text: string | RegExp, options?: TextOptions): Locator
  getByLabel(text: string | RegExp, options?: TextOptions): Locator
  getByPlaceholder(text: string | RegExp, options?: TextOptions): Locator
  getByAltText(text: string | RegExp, options?: TextOptions): Locator
  getByTitle(text: string | RegExp, options?: TextOptions): Locator
  getByTestId(id: string): Locator
  locator(css: string): Locator
  frame(iframe: ReadonlyLocator): FrameLocator
  readonly ariaSnapshot: Effect.Effect<Snapshot<Locator>, ReadError>
  readonly snapshot: Effect.Effect<Snapshot<Locator>, ReadError>
  snapshotWith(options: SnapshotOptions): Effect.Effect<Snapshot<Locator>, ReadError>
  readonly workers: Watchable<ReadonlyArray<BrowserWorker>>
  readonly localStorage: OriginStorage
  readonly sessionStorage: OriginStorage

  readonly context: UserContext                         // fixed: a page never changes context
  goto(url: Url | string, options?: {
    readonly waitUntil?: LoadState                      // default "commit"
    readonly accept?: ReadonlyArray<"download" | "noContent">   // default none: a download or 204 is a NavigationError
  }): Effect.Effect<PageNavigation, NavigationError | TargetGone | Timeout>
  readonly reload: Effect.Effect<PageNavigation, NavigationError | TargetGone | Timeout>
  reloadWith(options: { readonly waitUntil?: LoadState; readonly bypassCache?: boolean }): Effect.Effect<PageNavigation, NavigationError | TargetGone | Timeout>
  readonly back: Effect.Effect<Option.Option<PageNavigation>, NavigationError | TargetGone | Timeout>      // None: no history entry
  backWith(options: { readonly waitUntil?: LoadState }): Effect.Effect<Option.Option<PageNavigation>, NavigationError | TargetGone | Timeout>
  readonly forward: Effect.Effect<Option.Option<PageNavigation>, NavigationError | TargetGone | Timeout>
  forwardWith(options: { readonly waitUntil?: LoadState }): Effect.Effect<Option.Option<PageNavigation>, NavigationError | TargetGone | Timeout>

  /** The world is always spelled out; the main world needs control. */
  evaluateWith<Args extends ReadonlyArray<unknown>, A>(
    options: { readonly world: "isolated" | "main"; readonly userGesture?: boolean },   // userGesture default false
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect.Effect<Serialized<A>, EvaluationError | TargetGone | Timeout>
  evaluateHandle<Args extends ReadonlyArray<unknown>, A>(   // the isolated world, like evaluate
    fn: (...args: Args) => A | Promise<A>, ...args: Args
  ): Effect.Effect<JSHandle<Awaited<A>>, EvaluationError | TargetGone | Timeout, Scope.Scope>

  readonly keyboard: Keyboard                           // sub-handles bound to the page
  readonly mouse: Mouse
  readonly clock: PageClock

  route<E, R>(pattern: UrlPattern | string, handler: RouteHandler<E, R>): Effect.Effect<RouteRegistration, RouteError, Scope.Scope | R>
  addInitScript(script: InitScriptSource, options?: InitScriptOptions): Effect.Effect<InitScript, DeclarationError, Scope.Scope>
  /** Overrides the given settings while the registration lives; page scope beats context scope. */
  emulate(settings: Emulation): Effect.Effect<Registration, DeclarationError, Scope.Scope>
  readonly activate: Effect.Effect<void, TargetGone>    // bring to front; rendering-based waits need it
  readonly close: Effect.Effect<void, TargetGone | Timeout>   // owned teardown: no beforeunload
  closeWith(options: { readonly runBeforeUnload: boolean }): Effect.Effect<void, CloseCanceled | TargetGone | Timeout>
}

