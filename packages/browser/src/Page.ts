/**
 * Pages, at three access levels: `ObservedPage` ⊂ `ReadonlyPage` ⊂ `Page`, like `ReadonlyArray` ⊂ `Array`.
 *
 * - An `ObservedPage` reports its state and events, and nothing more.
 * - A `ReadonlyPage` adds reads, run in an isolated world where the page's own globals are invisible; it never
 *   scrolls, focuses or sends input.
 * - A `Page` adds input, navigation, evaluation among the page's own scripts, and declarations.
 *
 * Access is granted for a `Scope`: `inspect` and `control` are the only ways up, and no type guard narrows a page's
 * access. A subtype never changes what an inherited member does: `evaluate` runs in the isolated world whatever
 * the page's access, and only `evaluateInMainWorld`, on a `Page`, runs among the page's own scripts. WebKit has no
 * isolated worlds: there, reads run in the page's own world, and `evaluate` fails with `Unsupported`.
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
import type * as RoutePhaseDiagnostic from "./internal/routePhaseDiagnostic.ts"
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
   * Use the page's CSS `@page` size over `paper`. `Unsupported` over WebDriver BiDi (`pdf.preferCssPageSize`).
   *
   * @default false
   */
  readonly preferCssPageSize?: boolean | undefined
  /**
   * An HTML template for the header. `Unsupported` over WebDriver BiDi (`pdf.headerFooter`).
   *
   * @default none
   */
  readonly header?: string | undefined
  /**
   * An HTML template for the footer. `Unsupported` over WebDriver BiDi (`pdf.headerFooter`).
   *
   * @default none
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
   * Outcomes `goto` returns instead of failing: `"download"` returns a download as the `BecameDownload`
   * navigation, and `"noContent"` returns a 204 or 205 as `NoContent`, with the response. Without them, `goto`
   * fails with the reason of the same name. Either way the page stays where it was.
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
 * Pages are equal when they are the same tab, whatever their access: a `ReadonlyPage` and a `Page` for one tab
 * are equal.
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
   *
   * **Example** (Checking for an open prompt)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect, Option } from "effect"
   *
   * const promptOpen = Effect.fn("promptOpen")(function*(page: Page.ObservedPage) {
   *   const status = yield* page.status
   *   return status._tag === "Open" && Option.isSome(status.prompt)
   * })
   * ```
   */
  readonly status: Watchable.Watchable<Status>
  /**
   * The page's URL, derived from `status`, so the two never disagree.
   *
   * **Example** (Waiting for the checkout URL)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const toCheckout = Effect.fn("toCheckout")(function*(page: Page.Page) {
   *   yield* page.getByRole("button", { name: "Checkout" }).click()
   *   yield* page.url.waitFor((url) => url.startsWith("https://shop.example.com/checkout"))
   * })
   * ```
   */
  readonly url: Watchable.Watchable<Url.Url>
  /**
   * The frame tree.
   *
   * **Example** (Listing the URLs of the page's iframes)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const frameUrls = Effect.fn("frameUrls")(function*(page: Page.ObservedPage) {
   *   const tree = yield* page.frames
   *   return tree.children.map((frame) => frame.url)
   * })
   * ```
   */
  readonly frames: Watchable.Watchable<FrameTree>
  /**
   * The page's dedicated workers.
   *
   * **Example** (Listing the page's workers)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const workerScripts = Effect.fn("workerScripts")(function*(page: Page.ObservedPage) {
   *   const workers = yield* page.workers
   *   return workers.map((worker) => worker.url)
   * })
   * ```
   */
  readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.ObservedBrowserWorker>>
  /**
   * Waits as long as the page lives, then gives the reason it ended.
   *
   * **Example** (Checking that the page closed itself)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const closesItself = Effect.fn("closesItself")(function*(page: Page.Page) {
   *   yield* page.getByRole("button", { name: "Close window" }).click()
   *   const reason = yield* page.closed
   *   return reason._tag === "PageClosed" && reason.by === "script"
   * })
   * ```
   */
  readonly closed: Effect.Effect<Target.CloseReason>
  /**
   * Gets inspect access for the caller's scope, installing the isolated world. The page stays open when the scope
   * closes.
   *
   * **Example** (Reading every tab's title)
   *
   * ```ts import.meta.vitest
   * import { Browser } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const tabTitles = Effect.fn("tabTitles")(function*() {
   *   const tabs = yield* (yield* Browser.Browser).pages
   *   return yield* Effect.forEach(
   *     tabs,
   *     (tab) => Effect.flatMap(tab.inspect, (page) => page.title)
   *   )
   * })
   * ```
   */
  readonly inspect: Effect.Effect<ReadonlyPage, PageError, Scope.Scope>
  /**
   * Gets control for the caller's scope. The page stays open when the scope closes.
   *
   * **Example** (Acting on a tab you observe)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const acceptCookies = Effect.fn("acceptCookies")(function*(tab: Page.ObservedPage) {
   *   const page = yield* tab.control
   *   yield* page.getByRole("button", { name: "Accept cookies" }).click()
   * })
   * ```
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
   *
   * **Example** (Reading text inside an iframe)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const cardBrand = Effect.fn("cardBrand")(function*(page: Page.ReadonlyPage) {
   *   const payment = page.frame(page.locator("iframe#payment"))
   *   return yield* payment.getByTestId("card-brand").readText
   * })
   * ```
   */
  frame(iframe: Locator.ReadonlyLocator): Locator.ReadonlyFrameLocator
  /**
   * The document's title, read now.
   *
   * **Example** (Checking the page's title)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const onCart = Effect.fn("onCart")(function*(page: Page.ReadonlyPage) {
   *   const title = yield* page.title
   *   return title.startsWith("Cart")
   * })
   * ```
   */
  readonly title: Effect.Effect<string, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * The document's serialized HTML.
   *
   * **Example** (Saving the page's HTML)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect, FileSystem } from "effect"
   *
   * const saveHtml = Effect.fn("saveHtml")(function*(page: Page.ReadonlyPage) {
   *   const fs = yield* FileSystem.FileSystem
   *   yield* fs.writeFileString("./cart.html", yield* page.readHtml)
   * })
   * ```
   */
  readonly readHtml: Effect.Effect<string, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * A snapshot of the page: the accessibility tree, with inferred interactivity unless `sources` is `"aria"`.
   *
   * **Example** (Describing the page's controls)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const describeControls = Effect.fn("describeControls")(
   *   function*(page: Page.ReadonlyPage) {
   *     const snapshot = yield* page.snapshot({ interactiveOnly: true })
   *     return snapshot.text
   *   }
   * )
   * ```
   */
  snapshot(
    options?: Snapshot.Options | undefined
  ): Effect.Effect<Snapshot.Snapshot<Locator.ReadonlyLocator>, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * A screenshot; the viewport as PNG unless options say otherwise.
   *
   * **Gotchas**
   *
   * Every Chromium screenshot first reads renderer layout metrics, including viewport captures. This adds a
   * renderer round trip and style/layout work within the existing deadline; a paused or slow renderer can
   * exhaust that deadline before capture dispatch. Interruption stops waiting and prevents later dispatch.
   * The browser may hold this read while it processes a navigation. It does not wait for the page to load
   * or an earlier screenshot to finish, and another navigation can still intervene before dispatch.
   *
   * On Chromium, committed main-document replacement before the native capture reply fails with
   * `CaptureInvalidated`, naming both documents, including a same-URL reload. Preparation belongs to the
   * original document too. Same-document changes and canceled navigations do not invalidate capture. The
   * first received native reply keeps its result across a later replacement, even while decoding.
   * This does not cancel Chromium's pending command, restore its temporary settings, or retry. A caller
   * may explicitly capture again. In a controlled overlap on Chromium 155.0.8059.79, an immediate second
   * capture returned replacement-document pixels at the requested viewport dimensions. Completion and
   * unchanged dimensions are not guaranteed for every invalidation.
   * Other backends, subframe replacement and hangs without a main-document commit keep the existing deadline.
   *
   * **Example** (Capturing one element)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const captureCart = Effect.fn("captureCart")(function*(page: Page.ReadonlyPage) {
   *   const cart = page.getByRole("region", { name: "Cart" })
   *   return yield* page.screenshot({ area: { _tag: "Element", locator: cart } })
   * })
   * ```
   */
  screenshot(
    options?: ScreenshotOptions | undefined
  ): Effect.Effect<Uint8Array, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * The page printed as PDF. `Unsupported` on WebKit, which has no print-to-PDF (`pdf`).
   *
   * **Example** (Saving an invoice as an A4 PDF)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect, FileSystem } from "effect"
   *
   * const saveInvoice = Effect.fn("saveInvoice")(function*(page: Page.ReadonlyPage) {
   *   const fs = yield* FileSystem.FileSystem
   *   const pdf = yield* page.pdf({
   *     paper: "a4",
   *     margins: { top: { value: 1, unit: "cm" } },
   *     background: true
   *   })
   *   yield* fs.writeFile("./invoice.pdf", pdf)
   * })
   * ```
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
   * **Gotchas**
   *
   * Fails with `Unsupported` on WebKit, which has no isolated worlds (`isolatedWorlds`); use `evaluateInMainWorld`.
   *
   * **Example** (Reading the page's time as a `Date`)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
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
   *
   * **Example** (Reading Chromium's own accessibility tree)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const rawTree = Effect.fn("rawTree")(function*(page: Page.ReadonlyPage) {
   *   const reader = yield* page.capability(Capability.AxTree)
   *   return yield* reader.read
   * })
   * ```
   */
  capability<H>(
    capability: Capability.Capability<H>
  ): Effect.Effect<H, Capability.CapabilityError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
}

/**
 * A page you control.
 *
 * **Example** (Searching the shop)
 *
 * ```ts import.meta.vitest
 * import { Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
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
  /**
   * Acquires a specialized feature for the caller's scope, including features that change native page behavior.
   */
  capability<H>(capability: Capability.Capability<H, "inspect" | "control">): Effect.Effect<
    H,
    Capability.CapabilityError | Target.TargetGone | Deadline.Timeout,
    Scope.Scope
  >

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
   * The page's user context, which never changes.
   */
  readonly context: UserContext.UserContext
  /**
   * Navigates to `url`; returns at commit unless `waitUntil` asks for more.
   *
   * **Example** (Opening the cart once it has loaded)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const openCart = Effect.fn("openCart")(function*(page: Page.Page) {
   *   const navigation = yield* page.goto("https://shop.example.com/cart", {
   *     waitUntil: "load"
   *   })
   *   return navigation.url
   * })
   * ```
   */
  goto(
    url: Url.Url | string,
    options?: GotoOptions | undefined
  ): Effect.Effect<PageNavigation.PageNavigation, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Reloads the current document.
   *
   * **Example** (Reloading without the cache)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const hardReload = Effect.fn("hardReload")(function*(page: Page.Page) {
   *   yield* page.reload({ bypassCache: true, waitUntil: "load" })
   * })
   * ```
   */
  reload(
    options?: ReloadOptions | undefined
  ): Effect.Effect<PageNavigation.PageNavigation, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Goes back one history entry; `None` when there is none.
   *
   * **Example** (Going back to the cart)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect, Option } from "effect"
   *
   * const backToCart = Effect.fn("backToCart")(function*(page: Page.Page) {
   *   yield* page.goto("https://shop.example.com/cart")
   *   yield* page.getByRole("link", { name: "Checkout" }).click()
   *   const navigation = yield* page.back()
   *   return Option.map(navigation, (back) => back.url)
   * })
   * ```
   */
  back(
    options?: TraverseOptions | undefined
  ): Effect.Effect<Option.Option<PageNavigation.PageNavigation>, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Goes forward one history entry; `None` when there is none.
   *
   * **Example** (Returning after going back)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect, Option } from "effect"
   *
   * const backAndForth = Effect.fn("backAndForth")(function*(page: Page.Page) {
   *   yield* page.back()
   *   const navigation = yield* page.forward({ waitUntil: "load" })
   *   return Option.isSome(navigation)
   * })
   * ```
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
   *
   * **Example** (Reading a global the page's scripts set)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const appVersion = Effect.fn("appVersion")(function*(page: Page.Page) {
   *   return yield* page.evaluateInMainWorld(() =>
   *     String(Reflect.get(window, "APP_VERSION"))
   *   )
   * })
   * ```
   */
  evaluateInMainWorld<Args extends ReadonlyArray<unknown>, A>(
    fn: (...args: Args) => A | Promise<A>,
    ...args: Args
  ): Effect.Effect<JSHandle.Serialized<A>, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Calls `fn` in the isolated world and returns its result as a handle, for values that can't come back by value.
   *
   * **Gotchas**
   *
   * Fails with `Unsupported` on WebKit, which has no isolated worlds (`isolatedWorlds`); use `evaluateInMainWorld`.
   *
   * **Example** (Reading a canvas through a handle)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const chartImage = Effect.fn("chartImage")(function*(page: Page.Page) {
   *   const canvas = yield* page.evaluateHandle(() => document.querySelector("canvas"))
   *   return yield* canvas.evaluate((element) => element?.toDataURL("image/png"))
   * })
   * ```
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
   * - The route is in force for requests that start after this declaration returns.
   * - The page's routes are asked before its context's, the most recent first; `Route.fallthrough` passes the
   *   request to the next.
   * - `options.phase` (`"request"`, `"response"` or `"auth"`) decides what the handler is given and may decide.
   * - Each request's handler runs in a fiber of the registration's scope, under the `Deadline.DefaultBudget` in
   *   effect where `route` was called.
   *
   * **Gotchas**
   *
   * On Chromium, a request already underway without response interception may not pick up a later response
   * route, even before its headers arrive. A response that does pause selects the current routes by precedence.
   *
   * On Chromium, a route that matches a cross-origin request also sees its CORS preflight, an `OPTIONS`
   * request, which Firefox and WebKit don't show. WebKit pauses only a redirect's first hop.
   *
   * The phase defaults to `"request"`. Response-only handlers require `{ phase: "response" }`, and
   * authentication handlers require `{ phase: "auth" }`. When options may omit the phase, the handler must
   * also handle `"request"`; union phases require a handler compatible with every possible phase.
   *
   * **Example** (Blocking analytics requests)
   *
   * ```ts import.meta.vitest
   * import { Page, Route } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const blockAnalytics = Effect.fn("blockAnalytics")(function*(page: Page.Page) {
   *   yield* page.route(
   *     "https://analytics.example.com/**",
   *     () => Route.abort()
   *   )
   *   yield* page.goto("https://shop.example.com")
   * })
   * ```
   */
  route<E, R, P extends Route.Phase = "request">(
    pattern: Url.Pattern | string,
    handler: Route.Handler<E, R, NoInfer<P>>,
    options: Route.Options<P> & { readonly phase: P }
  ): Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone | Deadline.Timeout, Scope.Scope | R>
  route<E, R>(
    pattern: Url.Pattern | string,
    handler: Route.Handler<E, R>,
    options?: Route.Options | undefined
  ): Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone | Deadline.Timeout, Scope.Scope | R>
  route<E, R, P extends Route.Phase = "request">(
    pattern: Url.Pattern | string,
    handler: Route.Handler<E, R, NoInfer<P> | "request">,
    options?: Route.Options<P> | undefined
  ): Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone | Deadline.Timeout, Scope.Scope | R>
  route<E, R, P extends Route.Phase = "request", D extends Route.Phase = P | "request">(
    pattern: Url.Pattern | string,
    handler: RoutePhaseDiagnostic.Handler<E, R, NoInfer<P> | "request", D>,
    options?: Route.Options<P> | undefined
  ): Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone | Deadline.Timeout, Scope.Scope | R>
  /**
   * Runs a script in every new document of this page, before its own scripts, while the registration lives.
   *
   * **Details**
   *
   * The context's scripts run first, then the page's, in the order they were added; `after` names scripts that
   * must run before this one. A script added to a page that has already loaded runs from the next document. See
   * `InitScript` for the rest.
   *
   * **Example** (Ordering setup scripts)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const installHooks = Effect.fn("installHooks")(function*(page: Page.Page) {
   *   const helper = yield* page.addInitScript({ source: "window.__hooks = []" })
   *   yield* page.addInitScript({ source: "window.__hooks.push('ready')" }, {
   *     after: [helper]
   *   })
   * })
   * ```
   */
  addInitScript(
    script: InitScript.Source,
    options?: InitScript.Options | undefined
  ): Effect.Effect<
    InitScript.InitScript,
    Declaration.DeclarationError | Target.TargetGone | Deadline.Timeout,
    Scope.Scope
  >
  /**
   * Overrides the given settings while the registration lives.
   *
   * **Details**
   *
   * A page's overrides take precedence over its context's. One call is one registration: if the backend can't
   * apply a field, the call fails with `Unsupported` before applying any (see `Emulation`).
   *
   * **Example** (A phone-sized viewport for one step)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const openMobileMenu = Effect.fn("openMobileMenu")(function*(page: Page.Page) {
   *   yield* Effect.scoped(Effect.gen(function*() {
   *     yield* page.emulate({ viewport: { width: 390, height: 844 } })
   *     yield* page.getByRole("button", { name: "Menu" }).click()
   *   }))
   * })
   * ```
   */
  emulate(
    settings: Emulation.Emulation
  ): Effect.Effect<
    Declaration.Registration,
    Declaration.DeclarationError | Target.TargetGone | Deadline.Timeout,
    Scope.Scope
  >
  /**
   * Brings the page to the front.
   *
   * **Details**
   *
   * A page in the background, such as a popup's opener, may render too few frames to act on, and actions on it
   * time out. A context made with `focus: "emulated"` keeps every page rendering instead.
   *
   * **Gotchas**
   *
   * Fails with `Unsupported` on attached WebKit, whose inspector can't bring a page forward (`emulation.focus`).
   *
   * **Example** (Returning to the opener after a popup)
   *
   * ```ts import.meta.vitest
   * import { Page, Popup } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const keepShopping = Effect.fn("keepShopping")(function*(page: Page.Page) {
   *   const popups = yield* Popup.next(page)
   *   yield* page.getByRole("link", { name: "Size guide" }).click()
   *   yield* popups
   *   yield* page.activate
   *   yield* page.getByRole("button", { name: "Add to cart" }).click()
   * })
   * ```
   */
  readonly activate: Effect.Effect<void, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Closes the page without running `beforeunload`, so no prompt opens.
   *
   * **Details**
   *
   * It is done once the browser reports the page ended, whether or not the browser has answered the command yet. If
   * the page hasn't ended by the deadline, it fails with `Timeout`, and the browser goes on with the command, so the
   * page may still close.
   *
   * **Example** (Checking a second page, then closing it)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const helpTitle = Effect.fn("helpTitle")(function*(page: Page.Page) {
   *   const help = yield* page.context.newPage
   *   yield* help.goto("https://shop.example.com/help")
   *   const title = yield* help.title
   *   yield* help.close()
   *   return title
   * })
   * ```
   */
  close(): Effect.Effect<void, PageError | Target.TargetGone | Deadline.Timeout>
  /**
   * Closes the page, running its `beforeunload` handlers first when `runBeforeUnload` is `true`.
   *
   * **Details**
   *
   * - The prompt is decided as any dialog is: by the page's `Dialog.handle`, or else by its context's `dialogs`
   *   policy. `"dismiss"` and `"accept"` both leave; under `"leaveOpen"` the prompt stays open and the close times
   *   out.
   * - A handler that decides `stay` fails the close with `CloseCanceled`, and the page stays usable.
   * - Browsers prompt only once the user has interacted with the page, so a page nobody has touched closes at once.
   * - `Unsupported` on WebKit (`close.runBeforeUnload`).
   *
   * **Example** (Keeping a page with unsaved changes open)
   *
   * ```ts import.meta.vitest
   * import { Dialog, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const stayedOpen = Effect.fn("stayedOpen")(function*(page: Page.Page) {
   *   yield* Dialog.handle(page, Dialog.dismissAll)
   *   yield* page.getByLabel("Message").pressSequentially("Draft reply")
   *   return yield* page.close({ runBeforeUnload: true }).pipe(
   *     Effect.as(false),
   *     Effect.catchReason("PageError", "CloseCanceled", () => Effect.succeed(true))
   *   )
   * })
   * ```
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
 * It narrows to `ObservedPage`, whatever the page's access: get more with `inspect` or `control`.
 *
 * **Example** (Reading the title of a value that may be a page)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const titleOf = Effect.fn("titleOf")(function*(value: unknown) {
 *   if (!Page.isPage(value)) return Option.none<string>()
 *   const page = yield* value.inspect
 *   return Option.some(yield* page.title)
 * })
 * ```
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isPage = (u: unknown): u is ObservedPage => Predicate.hasProperty(u, TypeId)

/**
 * Reference to whether `evaluateInMainWorld` runs with a user gesture.
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
 * Makes each `evaluateInMainWorld` inside an effect run with a user gesture, for pages that require one, such as
 * to open a popup or start media.
 *
 * **Example** (Starting a video)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const playVideo = Effect.fn("playVideo")(function*(page: Page.Page) {
 *   yield* page.evaluateInMainWorld(() => document.querySelector("video")?.play()).pipe(
 *     Page.withUserGesture
 *   )
 * })
 * ```
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
 * A Chromium `page.screenshot` call's main document was replaced before its native capture reply arrived.
 *
 * **Details**
 *
 * The capture is not retried. Chromium's outstanding command cannot be canceled, and its temporary capture
 * settings may remain changed. A caller may explicitly capture the replacement document, but this error does
 * not guarantee that a subsequent capture will complete. An immediate explicit replacement capture completed
 * with the expected pixels and viewport dimensions in a controlled Chromium 155.0.8059.79 overlap.
 * Other backends retain their existing behavior.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class CaptureInvalidated
  extends Schema.Error<CaptureInvalidated>("@usestrider/browser/Page/CaptureInvalidated")({
    _tag: Schema.tag("CaptureInvalidated"),
    document: Target.DocumentId,
    replacement: Target.DocumentId,
    hint: Schema.String
  })
{
  override get message(): string {
    return `Screenshot document ${this.document} was replaced by ${this.replacement} (${this.hint})`
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
  CaptureInvalidated,
  Reason.EvaluationThrown,
  Reason.NotSerializable,
  // A capture's element: none, or several (QUIRKS.md, Q126)
  Locator.NoMatch,
  Locator.StrictViolation,
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure,
  Reason.ViewportMismatch,
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
 * Error for a page operation that failed: navigation, evaluation, capture, reads or setting the page up.
 *
 * **Example** (Recovering from a failed navigation)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
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
