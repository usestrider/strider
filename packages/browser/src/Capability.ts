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

const TypeId = "~@usestrider/browser/Capability"

/**
 * A feature that only some backends have, whose handle has type `H`.
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
   * The finished file after the recording scope closes. A writer failure fails this effect with `BackendFailure`.
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
 * Firefox writes the file itself; Chromium uses a `VideoWriter` provided to its browser layer. Recording lasts
 * while the capability's scope lives, into the directory the page's context
 * downloads to. Chromium records at 25fps, holding the latest frame while idle and scaling and padding viewport
 * changes to the initial size. Ending its scope waits up to five seconds on the browser clock for the writer.
 * So the file is removed with the context's temporary downloads, unless
 * `UserContext.Options.downloads` names a directory of yours.
 *
 * **Gotchas**
 *
 * It fails with `Unsupported` on Chromium without a `VideoWriter`, and on WebKit. It fails on
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
