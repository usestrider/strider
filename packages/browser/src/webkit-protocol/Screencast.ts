/**
 * The Screencast domain.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Unique identifier of the screencast.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ScreencastId = Brand.Branded<string, "~@usestrider/browser/webkit-protocol/Screencast/ScreencastId">

/**
 * Schema for `ScreencastId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScreencastId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/Screencast/ScreencastId")
) as any as Schema.Codec<ScreencastId>

/**
 * `screencastFrame.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScreencastFrameParams {
  /**
   * Base64 data
   */
  readonly data: string
  readonly timestamp: number
  readonly deviceWidth: number
  readonly deviceHeight: number
}

/**
 * Schema for `ScreencastFrameParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScreencastFrameParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    data: Schema.String,
    timestamp: Schema.Number,
    deviceWidth: Schema.Int,
    deviceHeight: Schema.Int
  }).annotate({ identifier: "Screencast.ScreencastFrameParams" })
) as any as Schema.Codec<ScreencastFrameParams>

/**
 * `screencastFrameAck.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScreencastFrameAckParams {
  /**
   * Screencast session generation
   */
  readonly generation: number
}

/**
 * Schema for `ScreencastFrameAckParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScreencastFrameAckParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    generation: Schema.Int
  }).annotate({ identifier: "Screencast.ScreencastFrameAckParams" })
) as any as Schema.Codec<ScreencastFrameAckParams>

/**
 * Starts screencast.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StartScreencastParams {
  readonly width: number
  readonly height: number
  readonly toolbarHeight: number
  readonly quality: number
}

/**
 * Schema for `StartScreencastParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartScreencastParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    width: Schema.Int,
    height: Schema.Int,
    toolbarHeight: Schema.Int,
    quality: Schema.Int
  }).annotate({ identifier: "Screencast.StartScreencastParams" })
) as any as Schema.Codec<StartScreencastParams>

/**
 * Starts screencast.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StartScreencastResult {
  /**
   * Screencast session generation.
   */
  readonly generation: number
}

/**
 * Schema for `StartScreencastResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartScreencastResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    generation: Schema.Int
  }).annotate({ identifier: "Screencast.StartScreencastResult" })
) as any as Schema.Codec<StartScreencastResult>

/**
 * Sends `Screencast.screencastFrameAck`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const screencastFrameAck: Protocol.CommandDef<"Screencast.screencastFrameAck", ScreencastFrameAckParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Screencast.screencastFrameAck",
    ScreencastFrameAckParams,
    undefined,
    { status: "stable" }
  )

/**
 * Starts screencast.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const startScreencast: Protocol.CommandDef<
  "Screencast.startScreencast",
  StartScreencastParams,
  StartScreencastResult
> = /*#__PURE__*/ Protocol.command(
  "Screencast.startScreencast",
  StartScreencastParams,
  StartScreencastResult,
  { status: "stable" }
)

/**
 * Stops screencast.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stopScreencast: Protocol.CommandDef<"Screencast.stopScreencast", void, void> = /*#__PURE__*/ Protocol
  .command(
    "Screencast.stopScreencast",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * The `Screencast.screencastFrame` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const screencastFrame: Protocol.EventDef<"Screencast.screencastFrame", ScreencastFrameParams> =
  /*#__PURE__*/ Protocol.event(
    "Screencast.screencastFrame",
    ScreencastFrameParams,
    { status: "stable" }
  )
