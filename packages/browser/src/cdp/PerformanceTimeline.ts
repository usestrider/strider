/**
 * Reporting of performance timeline events, as specified in
 * https://w3c.github.io/performance-timeline/#dom-performanceobserver.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as Network from "./Network.ts"
import * as Page from "./Page.ts"

/**
 * See https://github.com/WICG/LargestContentfulPaint and largest_contentful_paint.idl
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LargestContentfulPaint {
  readonly renderTime: Network.TimeSinceEpoch
  readonly loadTime: Network.TimeSinceEpoch
  /**
   * The number of pixels being painted.
   */
  readonly size: number
  /**
   * The id attribute of the element, if available.
   */
  readonly elementId?: string | undefined
  /**
   * The URL of the image (may be trimmed).
   */
  readonly url?: string | undefined
  readonly nodeId?: DOM.BackendNodeId | undefined
}

/**
 * Schema for `LargestContentfulPaint`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LargestContentfulPaint = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    renderTime: Network.TimeSinceEpoch,
    loadTime: Network.TimeSinceEpoch,
    size: Schema.Number,
    elementId: Schema.optional(Schema.String),
    url: Schema.optional(Schema.String),
    nodeId: Schema.optional(DOM.BackendNodeId)
  }).annotate({ identifier: "PerformanceTimeline.LargestContentfulPaint" })
) as any as Schema.Codec<LargestContentfulPaint>

/**
 * See https://wicg.github.io/layout-instability/#sec-layout-shift and layout_shift.idl
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LayoutShift {
  /**
   * Score increment produced by this event.
   */
  readonly value: number
  readonly hadRecentInput: boolean
  readonly lastInputTime: Network.TimeSinceEpoch
  readonly sources: ReadonlyArray<LayoutShiftAttribution>
}

/**
 * Schema for `LayoutShift`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LayoutShift = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    value: Schema.Number,
    hadRecentInput: Schema.Boolean,
    lastInputTime: Network.TimeSinceEpoch,
    sources: Schema.Array(LayoutShiftAttribution)
  }).annotate({ identifier: "PerformanceTimeline.LayoutShift" })
) as any as Schema.Codec<LayoutShift>

/**
 * `LayoutShiftAttribution`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface LayoutShiftAttribution {
  readonly previousRect: DOM.Rect
  readonly currentRect: DOM.Rect
  readonly nodeId?: DOM.BackendNodeId | undefined
}

/**
 * Schema for `LayoutShiftAttribution`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LayoutShiftAttribution = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    previousRect: DOM.Rect,
    currentRect: DOM.Rect,
    nodeId: Schema.optional(DOM.BackendNodeId)
  }).annotate({ identifier: "PerformanceTimeline.LayoutShiftAttribution" })
) as any as Schema.Codec<LayoutShiftAttribution>

/**
 * `TimelineEvent`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TimelineEvent {
  /**
   * Identifies the frame that this event is related to. Empty for non-frame targets.
   */
  readonly frameId: Page.FrameId
  /**
   * The event type, as specified in https://w3c.github.io/performance-timeline/#dom-performanceentry-entrytype
   * This determines which of the optional "details" fields is present.
   */
  readonly type: string
  /**
   * Name may be empty depending on the type.
   */
  readonly name: string
  /**
   * Time in seconds since Epoch, monotonically increasing within document lifetime.
   */
  readonly time: Network.TimeSinceEpoch
  /**
   * Event duration, if applicable.
   */
  readonly duration?: number | undefined
  readonly lcpDetails?: LargestContentfulPaint | undefined
  readonly layoutShiftDetails?: LayoutShift | undefined
}

/**
 * Schema for `TimelineEvent`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TimelineEvent = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Page.FrameId,
    type: Schema.String,
    name: Schema.String,
    time: Network.TimeSinceEpoch,
    duration: Schema.optional(Schema.Number),
    lcpDetails: Schema.optional(LargestContentfulPaint),
    layoutShiftDetails: Schema.optional(LayoutShift)
  }).annotate({ identifier: "PerformanceTimeline.TimelineEvent" })
) as any as Schema.Codec<TimelineEvent>

/**
 * Previously buffered events would be reported before method returns.
 * See also: timelineEventAdded
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EnableParams {
  /**
   * The types of event to report, as specified in
   * https://w3c.github.io/performance-timeline/#dom-performanceentry-entrytype
   * The specified filter overrides any previous filters, passing empty
   * filter disables recording.
   * Note that not all types exposed to the web platform are currently supported.
   */
  readonly eventTypes: ReadonlyArray<string>
}

/**
 * Schema for `EnableParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EnableParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    eventTypes: Schema.Array(Schema.String)
  }).annotate({ identifier: "PerformanceTimeline.EnableParams" })
) as any as Schema.Codec<EnableParams>

/**
 * Sent when a performance timeline event is added. See reportPerformanceTimeline method.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TimelineEventAddedParams {
  readonly event: TimelineEvent
}

/**
 * Schema for `TimelineEventAddedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TimelineEventAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    event: TimelineEvent
  }).annotate({ identifier: "PerformanceTimeline.TimelineEventAddedParams" })
) as any as Schema.Codec<TimelineEventAddedParams>

/**
 * Previously buffered events would be reported before method returns.
 * See also: timelineEventAdded
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"PerformanceTimeline.enable", EnableParams, void> = /*#__PURE__*/ Protocol
  .command(
    "PerformanceTimeline.enable",
    EnableParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sent when a performance timeline event is added. See reportPerformanceTimeline method.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const timelineEventAdded: Protocol.EventDef<"PerformanceTimeline.timelineEventAdded", TimelineEventAddedParams> =
  /*#__PURE__*/ Protocol.event(
    "PerformanceTimeline.timelineEventAdded",
    TimelineEventAddedParams,
    { status: "stable" }
  )
