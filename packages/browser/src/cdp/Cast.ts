/**
 * A domain for interacting with Cast, Presentation API, and Remote Playback API
 * functionalities.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * `Sink`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Sink {
  readonly name: string
  readonly id: string
  /**
   * Text describing the current session. Present only if there is an active
   * session on the sink.
   */
  readonly session?: string | undefined
}

/**
 * Schema for `Sink`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Sink = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    id: Schema.String,
    session: Schema.optional(Schema.String)
  }).annotate({ identifier: "Cast.Sink" })
) as any as Schema.Codec<Sink>

/**
 * Starts observing for sinks that can be used for tab mirroring, and if set,
 * sinks compatible with |presentationUrl| as well. When sinks are found, a
 * |sinksUpdated| event is fired.
 * Also starts observing for issue messages. When an issue is added or removed,
 * an |issueUpdated| event is fired.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EnableParams {
  readonly presentationUrl?: string | undefined
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
    presentationUrl: Schema.optional(Schema.String)
  }).annotate({ identifier: "Cast.EnableParams" })
) as any as Schema.Codec<EnableParams>

/**
 * This is fired whenever the outstanding issue/error message changes.
 * |issueMessage| is empty if there is no issue.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface IssueUpdatedParams {
  readonly issueMessage: string
}

/**
 * Schema for `IssueUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const IssueUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    issueMessage: Schema.String
  }).annotate({ identifier: "Cast.IssueUpdatedParams" })
) as any as Schema.Codec<IssueUpdatedParams>

/**
 * Sets a sink to be used when the web page requests the browser to choose a
 * sink via Presentation API, Remote Playback API, or Cast SDK.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetSinkToUseParams {
  readonly sinkName: string
}

/**
 * Schema for `SetSinkToUseParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetSinkToUseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sinkName: Schema.String
  }).annotate({ identifier: "Cast.SetSinkToUseParams" })
) as any as Schema.Codec<SetSinkToUseParams>

/**
 * This is fired whenever the list of available sinks changes. A sink is a
 * device or a software surface that you can cast to.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SinksUpdatedParams {
  readonly sinks: ReadonlyArray<Sink>
}

/**
 * Schema for `SinksUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SinksUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sinks: Schema.Array(Sink)
  }).annotate({ identifier: "Cast.SinksUpdatedParams" })
) as any as Schema.Codec<SinksUpdatedParams>

/**
 * Starts mirroring the desktop to the sink.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StartDesktopMirroringParams {
  readonly sinkName: string
}

/**
 * Schema for `StartDesktopMirroringParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StartDesktopMirroringParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sinkName: Schema.String
  }).annotate({ identifier: "Cast.StartDesktopMirroringParams" })
) as any as Schema.Codec<StartDesktopMirroringParams>

/**
 * Starts mirroring the tab to the sink.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StartTabMirroringParams {
  readonly sinkName: string
}

/**
 * Schema for `StartTabMirroringParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StartTabMirroringParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sinkName: Schema.String
  }).annotate({ identifier: "Cast.StartTabMirroringParams" })
) as any as Schema.Codec<StartTabMirroringParams>

/**
 * Stops the active Cast session on the sink.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StopCastingParams {
  readonly sinkName: string
}

/**
 * Schema for `StopCastingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StopCastingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sinkName: Schema.String
  }).annotate({ identifier: "Cast.StopCastingParams" })
) as any as Schema.Codec<StopCastingParams>

/**
 * Stops observing for sinks and issues.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Cast.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Cast.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Starts observing for sinks that can be used for tab mirroring, and if set,
 * sinks compatible with |presentationUrl| as well. When sinks are found, a
 * |sinksUpdated| event is fired.
 * Also starts observing for issue messages. When an issue is added or removed,
 * an |issueUpdated| event is fired.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Cast.enable", EnableParams, void> = /*#__PURE__*/ Protocol.command(
  "Cast.enable",
  EnableParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets a sink to be used when the web page requests the browser to choose a
 * sink via Presentation API, Remote Playback API, or Cast SDK.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setSinkToUse: Protocol.CommandDef<"Cast.setSinkToUse", SetSinkToUseParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Cast.setSinkToUse",
    SetSinkToUseParams,
    undefined,
    { status: "stable" }
  )

/**
 * Starts mirroring the desktop to the sink.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const startDesktopMirroring: Protocol.CommandDef<
  "Cast.startDesktopMirroring",
  StartDesktopMirroringParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Cast.startDesktopMirroring",
  StartDesktopMirroringParams,
  undefined,
  { status: "stable" }
)

/**
 * Starts mirroring the tab to the sink.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const startTabMirroring: Protocol.CommandDef<"Cast.startTabMirroring", StartTabMirroringParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Cast.startTabMirroring",
    StartTabMirroringParams,
    undefined,
    { status: "stable" }
  )

/**
 * Stops the active Cast session on the sink.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const stopCasting: Protocol.CommandDef<"Cast.stopCasting", StopCastingParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Cast.stopCasting",
    StopCastingParams,
    undefined,
    { status: "stable" }
  )

/**
 * This is fired whenever the outstanding issue/error message changes.
 * |issueMessage| is empty if there is no issue.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const issueUpdated: Protocol.EventDef<"Cast.issueUpdated", IssueUpdatedParams> = /*#__PURE__*/ Protocol.event(
  "Cast.issueUpdated",
  IssueUpdatedParams,
  { status: "stable" }
)

/**
 * This is fired whenever the list of available sinks changes. A sink is a
 * device or a software surface that you can cast to.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const sinksUpdated: Protocol.EventDef<"Cast.sinksUpdated", SinksUpdatedParams> = /*#__PURE__*/ Protocol.event(
  "Cast.sinksUpdated",
  SinksUpdatedParams,
  { status: "stable" }
)
