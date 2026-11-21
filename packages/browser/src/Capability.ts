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
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
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
 * The access parameter defaults to `"inspect"`. A `"control"` capability needs a page you control. `Options` is
 * what acquisition takes after the capability, as `Video`'s `VideoOptions`; `never` for one that takes none.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Capability<out H, out Access extends "inspect" | "control" = "inspect", in Options = never> {
  /**
   * The access needed to acquire this capability.
   */
  readonly access: Access
  readonly [TypeId]: (options: Options) => H
  readonly name: string
}

/**
 * Checks whether a value is a `Capability`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isCapability = (
  u: unknown
): u is Capability<unknown, "inspect", never> | Capability<unknown, "control", never> =>
  Predicate.hasProperty(u, TypeId)

const make = <H, Options = never>(name: string): Capability<H, "inspect", Options> => ({
  [TypeId]: () => undefined as H,
  name,
  access: "inspect"
})

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
 * How `Video` records: the file's size and frame rate, and where it goes.
 *
 * **Details**
 *
 * Chromium and WebKit make the file exactly `size`, padded black, and constant-rate at `fps`. Firefox records
 * natively and treats `size` as a box the page fits inside with its shape kept and no padding, and `fps` as a
 * ceiling on its frame rate, not a constant rate.
 *
 * **Example** (Recording a small, steady file to a path of your own)
 *
 * ```ts import.meta.vitest
 * import { Capability, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const recordTo = Effect.fn("recordTo")(function*(page: Page.Page, path: string) {
 *   const options: Capability.VideoOptions = {
 *     size: { width: 640, height: 360 },
 *     fps: 25,
 *     path,
 *     overwrite: false
 *   }
 *   const video = yield* Effect.scoped(Effect.gen(function*() {
 *     const recording = yield* page.capability(Capability.Video, options)
 *     yield* page.getByRole("button", { name: "Pay" }).click()
 *     return recording
 *   }))
 *   return yield* video.file
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface VideoOptions {
  /**
   * The file's width and height in pixels, each a positive integer. On Chromium and WebKit every image is scaled to
   * fit, centred, and padded black. On Firefox it is a box: the page is fitted inside it with its shape kept and no
   * padding, so one side may be shorter.
   *
   * @default the page's viewport in CSS pixels when the capability is acquired, scaled down (never up) to fit 800 by
   * 800: a 1280 by 720 viewport gives 800 by 450
   */
  readonly size?: { readonly width: number; readonly height: number } | undefined
  /**
   * The file's frame rate, finite and positive: constant on Chromium and WebKit, and a ceiling on Firefox, whose
   * frames keep their own times and which takes whole numbers only. Without it, the file is variable-rate, and
   * each image lasts until the next.
   *
   * @default none: variable-rate
   */
  readonly fps?: number | undefined
  /**
   * The absolute path of the file, in a directory that exists. With a path, video doesn't need the context's
   * downloads directory.
   *
   * @default none: a new file in the context's downloads directory, or on WebKit the layer's video directory
   */
  readonly path?: string | undefined
  /**
   * Whether the recording may replace a file already at `path`. With `false`, an existing file fails acquisition
   * with `InvalidInput`, and a file that appears there while recording fails `file`, leaving that file in place.
   *
   * @default true
   */
  readonly overwrite?: boolean | undefined
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
 * `page.capability(Capability.Video, options)` takes `VideoOptions`: the file's size, a frame rate, and a path.
 * The file is the page's viewport scaled down to fit 800 by 800 unless `size` says otherwise. On Chromium and
 * WebKit every image is scaled to fit it, centred, and padded black, as when the viewport changes while
 * recording, and `fps` makes the file constant-rate. Firefox writes the file itself: it fits the page inside the
 * size with its shape kept and no padding, and takes `fps` as a ceiling. Chromium uses a `VideoWriter` provided to
 * its browser layer. Without a `path`, both write into the context's downloads directory until recording ends.
 * Temporary downloads are removed with the context; set `UserContext.Options.downloads`, or `path`, to keep the
 * file. WebKit requires explicit layer video options and a writer, and writes into the directory those options
 * name, or to `path`. Its initial PNG is immediate; subsequent captures wait the configured interval after
 * completion. PNG polling can miss short states and adds work to the page. Video does not enable WebKit downloads
 * or native screencasts. Without `fps`, Chromium and opted-in WebKit keep each source frame's time, showing it
 * until the next frame or recording end. Closing its scope or ending its page/session closes input and waits
 * for a started writer to finish, for up to `Deadline.DefaultBudget` (30 seconds unless set) on the browser
 * clock, as read when the capability is acquired: wrap the acquisition in `Deadline.withDefaultBudget` to give a
 * slow encoder longer. A recording that receives no image fails promptly with `BackendFailure`.
 *
 * **Gotchas**
 *
 * It fails with `Unsupported` on Chromium without a `VideoWriter`, or WebKit without both a writer and explicit
 * polled-video options. It fails on Firefox too when Strider didn't launch it, because the file would be out of
 * reach, or, without a `path`, when the page's context denies downloads. Without a `path`, Chromium fails the
 * same way when the context has no downloads directory. A `size` that isn't positive integers, an `fps` that isn't
 * finite and positive, a relative `path`, a `path` in a directory that doesn't exist or that names a directory,
 * and with `overwrite: false` an existing file, fail with `InvalidInput` before recording starts. Firefox fails
 * a fractional `fps` with `Unsupported`.
 *
 * **Example** (Recording a checkout)
 *
 * ```ts import.meta.vitest
 * import { Capability, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const recorded = Effect.fn("recorded")(function*(page: Page.Page) {
 *   const video = yield* Effect.scoped(Effect.gen(function*() {
 *     const recording = yield* page.capability(Capability.Video, {
 *       size: { width: 800, height: 450 },
 *       fps: 25
 *     })
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
export const Video: Capability<VideoRecording, "inspect", VideoOptions> = make("Video")

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
  Reason.InvalidInput
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
