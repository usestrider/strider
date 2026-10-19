/**
 * Specialized features, reached through a handle bound to one page, so a feature from one browser can't
 * authorize an operation on another. A missing capability fails with Unsupported naming the backend.
 * `browser.capabilities` lists what this instance supports, with evidence.
 */
import type { Effect, Stream } from "effect"
import type { DevicePixels, MonotonicInstant } from "./Brand.ts"
import type { ReadError, TargetGone } from "./Errors.ts"

declare const CapabilityTypeId: unique symbol
export interface Capability<out H> { readonly [CapabilityTypeId]: () => H; readonly name: string }

export interface AxNode {                               // the browser's own accessibility tree, unprocessed
  readonly role: string
  readonly name: string
  readonly properties: Readonly<Record<string, unknown>>
  readonly children: ReadonlyArray<AxNode>
}
export interface AxTreeReader {
  readonly read: Effect.Effect<AxNode, ReadError | TargetGone>
}
export interface ScreencastFrame {
  readonly at: MonotonicInstant
  readonly width: DevicePixels
  readonly height: DevicePixels
  readonly jpeg: Uint8Array
}
export interface ScreencastControl {
  /** Frames from now on, as the browser renders them (CDP, patched WebKit); subscribed when this returns. */
  readonly frames: Stream.Stream<ScreencastFrame, TargetGone>
}

export declare const Capability: {
  readonly AxTree: Capability<AxTreeReader>
  readonly Screencast: Capability<ScreencastControl>
}
