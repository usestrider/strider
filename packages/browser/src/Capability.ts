/**
 * Features that only some backends have, each reached through a handle bound to one page.
 *
 * `page.capability(Capability.Screencast)` acquires a handle for the caller's scope. A backend without the feature
 * fails with `Unsupported`, naming the backends that have it. `browser.capabilities` lists what the connected
 * browser supports, with each entry's `evidence`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Duration from "effect/Duration"
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FilePath from "./FilePath.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import type * as MonotonicInstant from "./MonotonicInstant.ts"
import type * as Pixels from "./Pixels.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"
import type * as WebAuthn from "./WebAuthn.ts"

const TypeId = "~@usestrider/browser/Capability"

/**
 * A feature that only some backends have, whose handle has type `H`.
 *
 * **Details**
 *
 * The access parameter defaults to `"inspect"`. A `"control"` capability needs a page you control.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Capability<out H, out Access extends "inspect" | "control" = "inspect"> {
  /**
   * The access needed to acquire this capability.
   */
  readonly access: Access
  readonly [TypeId]: () => H
  readonly name: string
}

/**
 * Checks whether a value is a `Capability`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isCapability = (u: unknown): u is Capability<unknown> | Capability<unknown, "control"> =>
  Predicate.hasProperty(u, TypeId)

const make = <H>(name: string): Capability<H> => ({ [TypeId]: () => undefined as H, name, access: "inspect" })

/**
 * One node of the browser's own accessibility tree, unprocessed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AxNode {
  readonly role: string
  readonly name: string
  readonly properties: Readonly<Record<string, unknown>>
  readonly children: ReadonlyArray<AxNode>
}

/**
 * Reads the browser's own accessibility tree, unlike the processed one in snapshots.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AxTreeReader {
  /**
   * Reads the page's whole tree, its frames' included, from the root.
   *
   * **Example** (Listing the top of Chromium's tree)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const rawTree = Effect.fn("rawTree")(function*(page: Page.ReadonlyPage) {
   *   const reader = yield* page.capability(Capability.AxTree)
   *   const root = yield* reader.read
   *   return root.children.map((node) => `${node.role}: ${node.name}`)
   * })
   * ```
   */
  readonly read: Effect.Effect<AxNode, CapabilityError | Target.TargetGone | Deadline.Timeout>
}

/**
 * One frame of a screencast, as JPEG bytes.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScreencastFrame {
  readonly at: MonotonicInstant.MonotonicInstant
  readonly width: Pixels.Device
  readonly height: Pixels.Device
  readonly jpeg: Uint8Array
}

/**
 * Frames as the browser renders them.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScreencastControl {
  /**
   * The frames rendered from when the capability was acquired.
   *
   * **Example** (Collecting the frames of an animation)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect, Fiber, Stream } from "effect"
   *
   * const recordCarousel = Effect.fn("recordCarousel")(function*(page: Page.Page) {
   *   const screencast = yield* page.capability(Capability.Screencast)
   *   const frames = yield* Effect.forkScoped(
   *     screencast.frames.pipe(Stream.take(60), Stream.runCollect)
   *   )
   *   yield* page.getByRole("button", { name: "Next slide" }).click()
   *   return yield* Fiber.join(frames)
   * })
   * ```
   */
  readonly frames: Stream.Stream<ScreencastFrame, Target.TargetGone>
}

/**
 * A page recorded to a video file while the capability's scope lives.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface VideoRecording {
  /**
   * The finished file when recording ends. A writer failure fails this effect with `BackendFailure`.
   */
  readonly file: Effect.Effect<FilePath.Local, CapabilityError | Target.TargetGone | Deadline.Timeout>
}

/**
 * The browser's own accessibility tree; Chromium only.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const AxTree: Capability<AxTreeReader> = make("AxTree")

/**
 * The browser's own screencast frames: Chromium's alone.
 *
 * **Gotchas**
 *
 * Acquiring this capability first reads renderer layout metrics. This adds a renderer round trip and
 * style/layout work within the existing acquisition deadline; a paused or slow renderer can exhaust
 * that deadline before the screencast starts, and a metrics error fails acquisition. The browser may
 * hold this read while it processes a navigation. It does not wait for the page to load. Another
 * navigation or a detach can still intervene before start; the read does not guarantee that the page stays active.
 * Chromium shares the stream with other screencasts and video recordings. Each frame is acknowledged after
 * all consumers take it or release their scopes. Close the scope when you stop reading, so other consumers
 * can continue. Joining an idle active stream first receives its latest image.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const Screencast: Capability<ScreencastControl> = make("Screencast")

/**
 * A WebM video file of the page.
 *
 * **Details**
 *
 * Firefox writes the file itself; Chromium uses a `VideoWriter` provided to its browser layer. Both write into
 * the context's downloads directory until recording ends. Temporary downloads are removed with
 * the context; set `UserContext.Options.downloads` to keep the file in a directory of yours.
 * WebKit requires explicit layer video options and a writer, and writes into the directory those options name.
 * Its initial PNG is immediate; subsequent captures wait the configured interval after completion. PNG polling
 * can miss short states and adds work to the page. Video does not enable WebKit downloads or native screencasts.
 * Chromium and opted-in WebKit keep each source frame's time, showing it until the next frame or recording end.
 * Viewport changes are scaled and padded to the initial size. Closing its scope or ending its page/session closes input and waits for a started
 * writer to finish, for up to `Deadline.DefaultBudget` (30 seconds unless set) on the browser clock, as read when
 * the capability is acquired: wrap the acquisition in `Deadline.withDefaultBudget` to give a slow encoder longer.
 * A recording that receives no image fails promptly with `BackendFailure`.
 *
 * **Gotchas**
 *
 * It fails with `Unsupported` on Chromium without a `VideoWriter`, or WebKit without both a writer and explicit
 * polled-video options. It fails on
 * Firefox too when Strider didn't launch it, or when the page's context denies downloads, because the file would
 * be out of reach.
 *
 * **Example** (Recording a checkout)
 *
 * ```ts import.meta.vitest
 * import { Capability, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const recorded = Effect.fn("recorded")(function*(page: Page.Page) {
 *   const video = yield* Effect.scoped(Effect.gen(function*() {
 *     const recording = yield* page.capability(Capability.Video)
 *     yield* page.getByRole("button", { name: "Pay" }).click()
 *     return recording
 *   }))
 *   return yield* video.file
 * })
 * ```
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const Video: Capability<VideoRecording> = make("Video")

/**
 * Overlays drawn over a page for recordings: HTML of the caller's, and chapter title cards.
 *
 * **Details**
 *
 * Overlays are elements in the page, so they appear in screenshots and video alike, on every browser. They sit
 * above the page, ignore the pointer, and are never matched by locators, included in snapshots or hit by an
 * action. They stay across the page's navigations, drawn again in each document its main frame commits. WebKit's
 * video samples the page, so it can miss an overlay shown for less than its interval.
 *
 * **Example** (Labeling a step of a recording)
 *
 * ```ts import.meta.vitest
 * import { Capability, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const labeled = Effect.fn("labeled")(function*(page: Page.Page) {
 *   const overlay: Capability.OverlayControl = yield* page.capability(Capability.Overlay)
 *   yield* overlay.add(`<div style="position:fixed;top:8px;left:8px">Searching</div>`)
 *   yield* page.getByRole("searchbox").fill("strider")
 * }, Effect.scoped)
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface OverlayControl {
  /**
   * Shows `html` over the page until the caller's scope closes, or until `duration` passes, whichever is first.
   *
   * **Details**
   *
   * It returns once the overlay is in the page; the removal at `duration` happens apart from the caller. The HTML
   * is the caller's and is inserted as it is; its scripts don't run.
   *
   * **Example** (Labeling a recording while a step runs)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const labeled = Effect.fn("labeled")(function*(page: Page.Page) {
   *   const overlay = yield* page.capability(Capability.Overlay)
   *   yield* overlay.add(`<div style="position:fixed;top:8px;right:8px">Signing in</div>`)
   *   yield* page.getByRole("button", { name: "Sign in" }).click()
   * }, Effect.scoped)
   * ```
   */
  add(
    html: string,
    options?: OverlayControl.AddOptions | undefined
  ): Effect.Effect<void, CapabilityError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
  /**
   * Shows a centered title card over a blurred page for `duration`, then removes it, returning once it has gone.
   *
   * **Details**
   *
   * The title and description are shown as text, never as HTML.
   *
   * **Example** (Opening a chapter of a recording)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const checkout = Effect.fn("checkout")(function*(page: Page.Page) {
   *   const overlay = yield* page.capability(Capability.Overlay)
   *   yield* overlay.chapter("Checkout", { description: "Paying by card" })
   *   yield* page.getByRole("button", { name: "Pay" }).click()
   * }, Effect.scoped)
   * ```
   */
  chapter(
    title: string,
    options?: OverlayControl.ChapterOptions | undefined
  ): Effect.Effect<void, CapabilityError | Target.TargetGone | Deadline.Timeout>
  /**
   * Hides every overlay without removing any, until `show`.
   *
   * **Example** (Taking a screenshot without the overlays)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const plain = Effect.fn("plain")(function*(page: Page.Page) {
   *   const overlay = yield* page.capability(Capability.Overlay)
   *   yield* overlay.hide
   *   const png = yield* page.screenshot()
   *   yield* overlay.show
   *   return png
   * }, Effect.scoped)
   * ```
   */
  readonly hide: Effect.Effect<void, CapabilityError | Target.TargetGone | Deadline.Timeout>
  /**
   * Shows the overlays `hide` hid.
   *
   * **Example** (Showing the overlays again)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const reveal = Effect.fn("reveal")(function*(page: Page.Page) {
   *   const overlay = yield* page.capability(Capability.Overlay)
   *   yield* overlay.hide
   *   yield* overlay.show
   * }, Effect.scoped)
   * ```
   */
  readonly show: Effect.Effect<void, CapabilityError | Target.TargetGone | Deadline.Timeout>
  /**
   * Annotates the page's input actions until the caller's scope closes: a title naming each action and its
   * locator, and a cursor at its point, then a wait of `duration` before the action's input.
   *
   * **Details**
   *
   * It covers the locator actions that send input: `click`, `dblclick`, `hover`, `tap`, `check`, `uncheck`,
   * `dragTo`, `fill`, `press`, `pressSequentially`, `selectOption` and `clear`. Input sent through `page.mouse`
   * or `page.keyboard` isn't annotated. The wait counts toward the action's deadline, and the action checks its
   * target again after it, so the input goes where the target is then. Points are in the top-level page, also for
   * a target in a frame. A point marker and a highlight over the target are drawn only when `style` gives them.
   * While another call's scope is open, the latest call's options apply.
   *
   * **Example** (Recording a sign-in with each action shown)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const signIn = Effect.fn("signIn")(function*(page: Page.Page) {
   *   const overlay = yield* page.capability(Capability.Overlay)
   *   yield* overlay.actions({
   *     position: "bottom",
   *     style: { highlight: "outline: 2px solid orange" }
   *   })
   *   yield* page.getByLabel("Email").fill("ada@example.com")
   *   yield* page.getByRole("button", { name: "Sign in" }).click()
   * }, Effect.scoped)
   * ```
   */
  actions(
    options?: OverlayControl.ActionsOptions | undefined
  ): Effect.Effect<void, CapabilityError, Scope.Scope>
}

/**
 * Options of `OverlayControl`'s members.
 *
 * **Example** (Typing options before passing them)
 *
 * ```ts import.meta.vitest
 * import { Capability, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const options: Capability.OverlayControl.ActionsOptions = { duration: "250 millis" }
 * const quick = Effect.fn("quick")(function*(page: Page.Page) {
 *   const overlay = yield* page.capability(Capability.Overlay)
 *   yield* overlay.actions(options)
 * }, Effect.scoped)
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export declare namespace OverlayControl {
  /**
   * Options of `add`.
   *
   * **Example** (Showing a note for three seconds)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const note: Capability.OverlayControl.AddOptions = { duration: "3 seconds" }
   * const remind = Effect.fn("remind")(function*(page: Page.Page) {
   *   const overlay = yield* page.capability(Capability.Overlay)
   *   yield* overlay.add(`<p style="position:fixed;bottom:8px">Saved</p>`, note)
   * }, Effect.scoped)
   * ```
   *
   * @stability unstable
   * @category models
   * @since 0.1.0
   */
  export interface AddOptions {
    /**
     * How long the overlay stays, unless the caller's scope closes first.
     *
     * @default until the caller's scope closes
     */
    readonly duration?: Duration.Input | undefined
  }
  /**
   * Options of `chapter`.
   *
   * **Example** (A short chapter with a description)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const card: Capability.OverlayControl.ChapterOptions = {
   *   description: "Paying by card",
   *   duration: "1 second"
   * }
   * const checkout = Effect.fn("checkout")(function*(page: Page.Page) {
   *   const overlay = yield* page.capability(Capability.Overlay)
   *   yield* overlay.chapter("Checkout", card)
   * }, Effect.scoped)
   * ```
   *
   * @stability unstable
   * @category models
   * @since 0.1.0
   */
  export interface ChapterOptions {
    /**
     * A line of text under the title.
     *
     * @default no description
     */
    readonly description?: string | undefined
    /**
     * How long the card is shown.
     *
     * @default "2 seconds"
     */
    readonly duration?: Duration.Input | undefined
  }
  /**
   * Where an action's title is drawn.
   *
   * **Example** (Drawing titles at the bottom)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const position: Capability.OverlayControl.Position = "bottom"
   * const captioned = Effect.fn("captioned")(function*(page: Page.Page) {
   *   const overlay = yield* page.capability(Capability.Overlay)
   *   yield* overlay.actions({ position })
   * }, Effect.scoped)
   * ```
   *
   * @stability unstable
   * @category models
   * @since 0.1.0
   */
  export type Position = "top-left" | "top" | "top-right" | "bottom-left" | "bottom" | "bottom-right"
  /**
   * Options of `actions`.
   *
   * **Example** (Marking each action's point without a cursor)
   *
   * ```ts import.meta.vitest
   * import { Capability, Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const marked: Capability.OverlayControl.ActionsOptions = {
   *   cursor: "none",
   *   style: { point: "width: 12px; height: 12px; border-radius: 50%; background: red" }
   * }
   * const showClicks = Effect.fn("showClicks")(function*(page: Page.Page) {
   *   const overlay = yield* page.capability(Capability.Overlay)
   *   yield* overlay.actions(marked)
   *   yield* page.getByRole("button", { name: "Save" }).click()
   * }, Effect.scoped)
   * ```
   *
   * @stability unstable
   * @category models
   * @since 0.1.0
   */
  export interface ActionsOptions {
    /**
     * How long each action waits, with its annotation shown, before its input.
     *
     * @default "500 millis"
     */
    readonly duration?: Duration.Input | undefined
    /**
     * Where the action's title is drawn.
     *
     * @default "top-right"
     */
    readonly position?: Position | undefined
    /**
     * Whether a cursor is drawn at the last action's point.
     *
     * @default "pointer"
     */
    readonly cursor?: "pointer" | "none" | undefined
    /**
     * CSS declarations for what is drawn, each a string such as `"outline: 2px solid orange"`.
     *
     * @default no point marker or highlight, and the title's own style
     */
    readonly style?:
      | {
        /**
         * CSS declarations for a mark centered on the action's point, such as its size and colour.
         *
         * @default no point marker
         */
        readonly point?: string | undefined
        /**
         * CSS declarations for a box over the target, such as an outline.
         *
         * @default no highlight
         */
        readonly highlight?: string | undefined
        /**
         * CSS declarations added to the title's own, such as its font.
         *
         * @default the title's own style: white 14px text on a dark box
         */
        readonly title?: string | undefined
      }
      | undefined
  }
}

/**
 * Overlays drawn over a page for recordings, on every backend.
 *
 * **Details**
 *
 * Requires control access. Nothing is drawn or watched until it is acquired. Overlays added through it are removed
 * when their own scope closes, and every one when the capability's scope closes.
 *
 * **Example** (Opening a recording with a chapter card)
 *
 * ```ts import.meta.vitest
 * import { Capability, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const recordSignIn = Effect.fn("recordSignIn")(function*(page: Page.Page) {
 *   const video = yield* page.capability(Capability.Video)
 *   const overlay = yield* page.capability(Capability.Overlay)
 *   yield* overlay.chapter("Signing in")
 *   yield* page.getByRole("button", { name: "Sign in" }).click()
 *   return video
 * })
 * ```
 *
 * @see OverlayControl
 * @stability unstable
 * @category capabilities
 * @since 0.1.0
 */
export const Overlay: Capability<OverlayControl, "control"> = {
  [TypeId]: () => undefined as unknown as OverlayControl,
  name: "Overlay",
  access: "control"
}

/**
 * A native Chromium virtual authenticator on this page, removed when the caller's scope closes.
 *
 * **Details**
 *
 * Requires control access. Acquisition creates a CTAP2 authenticator with internal transport, resident keys
 * and user verification supported, verification successful, automatic user presence enabled, and UI disabled.
 * These are fixed defaults. Only one acquisition may live on a page; overlap fails with `CapabilityError`.
 * Credentials survive navigation. Another page or popup needs an explicit copy; copies keep separate counters.
 * Firefox and WebKit fail with `Unsupported`.
 *
 * **Example** (Enabling native passkey registration)
 *
 * ```ts import.meta.vitest
 * import { Capability, Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const registerPasskey = Effect.fn("registerPasskey")(function*(page: Page.Page) {
 *   const authenticator = yield* page.capability(Capability.VirtualAuthenticator)
 *   yield* page.getByRole("button", { name: "Create passkey" }).click()
 *   yield* page.getByText("Passkey created").pipe(Expect.toBeVisible)
 *   return yield* authenticator.credentials
 * })
 * ```
 *
 * @see WebAuthn.VirtualAuthenticator
 * @stability unstable
 * @category capabilities
 * @since 0.1.0
 */
export const VirtualAuthenticator: Capability<WebAuthn.VirtualAuthenticator, "control"> = {
  [TypeId]: () => undefined as unknown as WebAuthn.VirtualAuthenticator,
  name: "VirtualAuthenticator",
  access: "control"
}

/**
 * Schema for the reasons acquiring or using a capability can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CapabilityErrorReason = Schema.Union([
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure,
  Reason.InvalidInput,
  Reason.PromptBlocking
])

/**
 * The reasons acquiring or using a capability can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CapabilityErrorReason = typeof CapabilityErrorReason.Type

const CapabilityErrorTypeId = "~@usestrider/browser/Capability/CapabilityError"

/**
 * Error for a capability that couldn't be acquired or used.
 *
 * **Example** (Reading the tree only where the browser has one)
 *
 * ```ts import.meta.vitest
 * import { Capability, Page } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const rawTree = Effect.fn("rawTree")(function*(page: Page.ReadonlyPage) {
 *   const reader = yield* page.capability(Capability.AxTree)
 *   return Option.some(yield* reader.read)
 * }, Effect.catchReason("CapabilityError", "Unsupported", () => Effect.succeedNone))
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class CapabilityError extends Schema.TaggedError<CapabilityError>(CapabilityErrorTypeId)("CapabilityError", {
  capability: Schema.String,
  reason: CapabilityErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [CapabilityErrorTypeId] = CapabilityErrorTypeId
  override get message(): string {
    return `${this.capability}: ${this.reason.message}`
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}

/**
 * Checks whether a value is a `CapabilityError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isCapabilityError = (u: unknown): u is CapabilityError => Predicate.hasProperty(u, CapabilityErrorTypeId)
