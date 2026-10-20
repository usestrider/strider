/**
 * This domain provides experimental commands only supported in headless mode.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Encoding options for a screenshot.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScreenshotParams {
  /**
   * Image compression format (defaults to png).
   */
  readonly format?: ScreenshotParamsFormat | undefined
  /**
   * Compression quality from range [0..100] (jpeg and webp only).
   */
  readonly quality?: number | undefined
  /**
   * Optimize image encoding for speed, not for resulting size (defaults to false)
   */
  readonly optimizeForSpeed?: boolean | undefined
}

/**
 * Schema for `ScreenshotParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScreenshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    format: Schema.optional(ScreenshotParamsFormat),
    quality: Schema.optional(Schema.Int),
    optimizeForSpeed: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "HeadlessExperimental.ScreenshotParams" })
) as any as Schema.Codec<ScreenshotParams>

/**
 * Image compression format (defaults to png).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ScreenshotParamsFormat =
  | "jpeg"
  | "png"
  | "webp"
  | (string & {})

/**
 * Schema for `ScreenshotParamsFormat`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScreenshotParamsFormat = Schema.String as any as Schema.Codec<ScreenshotParamsFormat>

/**
 * Sends a BeginFrame to the target and returns when the frame was completed. Optionally captures a
 * screenshot from the resulting frame. Requires that the target was created with enabled
 * BeginFrameControl. Designed for use with --run-all-compositor-stages-before-draw, see also
 * https://goo.gle/chrome-headless-rendering for more background.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BeginFrameParams {
  /**
   * Timestamp of this BeginFrame in Renderer TimeTicks (milliseconds of uptime). If not set,
   * the current time will be used.
   */
  readonly frameTimeTicks?: number | undefined
  /**
   * The interval between BeginFrames that is reported to the compositor, in milliseconds.
   * Defaults to a 60 frames/second interval, i.e. about 16.666 milliseconds.
   */
  readonly interval?: number | undefined
  /**
   * Whether updates should not be committed and drawn onto the display. False by default. If
   * true, only side effects of the BeginFrame will be run, such as layout and animations, but
   * any visual updates may not be visible on the display or in screenshots.
   */
  readonly noDisplayUpdates?: boolean | undefined
  /**
   * If set, a screenshot of the frame will be captured and returned in the response. Otherwise,
   * no screenshot will be captured. Note that capturing a screenshot can fail, for example,
   * during renderer initialization. In such a case, no screenshot data will be returned.
   */
  readonly screenshot?: ScreenshotParams | undefined
}

/**
 * Schema for `BeginFrameParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BeginFrameParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameTimeTicks: Schema.optional(Schema.Number),
    interval: Schema.optional(Schema.Number),
    noDisplayUpdates: Schema.optional(Schema.Boolean),
    screenshot: Schema.optional(ScreenshotParams)
  }).annotate({ identifier: "HeadlessExperimental.BeginFrameParams" })
) as any as Schema.Codec<BeginFrameParams>

/**
 * Sends a BeginFrame to the target and returns when the frame was completed. Optionally captures a
 * screenshot from the resulting frame. Requires that the target was created with enabled
 * BeginFrameControl. Designed for use with --run-all-compositor-stages-before-draw, see also
 * https://goo.gle/chrome-headless-rendering for more background.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BeginFrameResult {
  /**
   * Whether the BeginFrame resulted in damage and, thus, a new frame was committed to the
   * display. Reported for diagnostic uses, may be removed in the future.
   */
  readonly hasDamage: boolean
  /**
   * Base64-encoded image data of the screenshot, if one was requested and successfully taken. (Encoded as a base64 string when passed over JSON)
   */
  readonly screenshotData?: string | undefined
}

/**
 * Schema for `BeginFrameResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BeginFrameResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    hasDamage: Schema.Boolean,
    screenshotData: Schema.optional(Schema.String)
  }).annotate({ identifier: "HeadlessExperimental.BeginFrameResult" })
) as any as Schema.Codec<BeginFrameResult>

/**
 * Sends a BeginFrame to the target and returns when the frame was completed. Optionally captures a
 * screenshot from the resulting frame. Requires that the target was created with enabled
 * BeginFrameControl. Designed for use with --run-all-compositor-stages-before-draw, see also
 * https://goo.gle/chrome-headless-rendering for more background.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const beginFrame: Protocol.CommandDef<"HeadlessExperimental.beginFrame", BeginFrameParams, BeginFrameResult> =
  /*#__PURE__*/ Protocol.command(
    "HeadlessExperimental.beginFrame",
    BeginFrameParams,
    BeginFrameResult,
    { status: "stable" }
  )
