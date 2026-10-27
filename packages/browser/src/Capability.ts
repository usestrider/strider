/**
 * Specialized features that not every backend offers, reached through a handle bound to one page.
 *
 * A capability handle is acquired from a page (`page.capability(Capability.Screencast)`), so a feature from one
 * browser can't authorize an operation on another. A backend without the feature fails with `Unsupported`,
 * naming the backends that have it. `Browser.capabilities` lists what the connected browser supports, with
 * the evidence for each entry.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FilePath from "./FilePath.ts"
import type * as MonotonicInstant from "./MonotonicInstant.ts"
import type * as Pixels from "./Pixels.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"

const TypeId = "~@usestrider/browser/Capability"

/**
 * A specialized feature, whose handle has type `H`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Capability<out H> {
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
export const isCapability = (u: unknown): u is Capability<unknown> => Predicate.hasProperty(u, TypeId)

const make = <H>(name: string): Capability<H> => ({ [TypeId]: () => undefined as H, name })

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
 * Reads the browser's own accessibility tree, as opposed to the processed one in snapshots.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AxTreeReader {
  readonly read: Effect.Effect<AxNode, CapabilityError | Target.TargetGone>
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
   * Frames from now on; subscribed when the capability is acquired.
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
   * The file, once the capability's scope has closed and the browser has written it.
   */
  readonly file: Effect.Effect<FilePath.Local, CapabilityError | Target.TargetGone>
}

/**
 * The browser's own accessibility tree.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const AxTree: Capability<AxTreeReader> = make("AxTree")

/**
 * Native screencast frames; CDP and patched WebKit.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const Screencast: Capability<ScreencastControl> = make("Screencast")

/**
 * A video file of the page, recorded by the browser; Firefox's.
 *
 * **Details**
 *
 * Firefox writes a WebM file while the capability's scope lives, into the directory the page's context
 * downloads to, so the file goes with a context's temporary downloads unless they go to a directory of the
 * caller's (`UserContext.Options.downloads`).
 *
 * **Gotchas**
 *
 * `Unsupported` on Chromium and WebKit, which stream frames rather than write a file (`Screencast`), and where
 * Firefox wasn't launched by the program, or its context denies downloads: the file would be out of reach.
 *
 * **Example** (Recording a checkout)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Capability, Page } from "@usestrider/browser"
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
 * Schema for the reasons acquiring or using a capability can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CapabilityErrorReason = Schema.Union([Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])

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
}

/**
 * Checks whether a value is a `CapabilityError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isCapabilityError = (u: unknown): u is CapabilityError => Predicate.hasProperty(u, CapabilityErrorTypeId)
