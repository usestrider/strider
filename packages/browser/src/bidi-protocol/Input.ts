/**
 * The input module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08). Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Browser from "./Browser.ts"
import * as BrowsingContext from "./BrowsingContext.ts"
import * as Script from "./Script.ts"

/**
 * `ElementOrigin`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ElementOrigin {
  readonly type: "element"
  readonly element: Script.SharedReference
}

/**
 * Schema for `ElementOrigin`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ElementOrigin = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("element"),
    element: Script.SharedReference
  }).annotate({ identifier: "input.ElementOrigin" })
) as any as Schema.Codec<ElementOrigin>

/**
 * `FileDialogInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FileDialogInfo {
  readonly context: BrowsingContext.BrowsingContext
  readonly userContext?: Browser.UserContext | undefined
  readonly element?: Script.SharedReference | undefined
  readonly multiple: boolean
}

/**
 * Schema for `FileDialogInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FileDialogInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext.BrowsingContext,
    userContext: Schema.optional(Browser.UserContext),
    element: Schema.optional(Script.SharedReference),
    multiple: Schema.Boolean
  }).annotate({ identifier: "input.FileDialogInfo" })
) as any as Schema.Codec<FileDialogInfo>

/**
 * `KeyDownAction`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface KeyDownAction {
  readonly type: "keyDown"
  readonly value: Redacted.Redacted<string>
}

/**
 * Schema for `KeyDownAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeyDownAction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("keyDown"),
    value: Schema.RedactedFromValue(Schema.String)
  }).annotate({ identifier: "input.KeyDownAction" })
) as any as Schema.Codec<KeyDownAction>

/**
 * `KeySourceAction`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type KeySourceAction = PauseAction | KeyDownAction | KeyUpAction

/**
 * Schema for `KeySourceAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeySourceAction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([PauseAction, KeyDownAction, KeyUpAction])
) as any as Schema.Codec<KeySourceAction>

/**
 * `KeySourceActions`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface KeySourceActions {
  readonly type: "key"
  readonly id: string
  readonly actions: ReadonlyArray<KeySourceAction>
}

/**
 * Schema for `KeySourceActions`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeySourceActions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("key"),
    id: Schema.String,
    actions: Schema.Array(KeySourceAction)
  }).annotate({ identifier: "input.KeySourceActions" })
) as any as Schema.Codec<KeySourceActions>

/**
 * `KeyUpAction`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface KeyUpAction {
  readonly type: "keyUp"
  readonly value: Redacted.Redacted<string>
}

/**
 * Schema for `KeyUpAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const KeyUpAction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("keyUp"),
    value: Schema.RedactedFromValue(Schema.String)
  }).annotate({ identifier: "input.KeyUpAction" })
) as any as Schema.Codec<KeyUpAction>

/**
 * `NoneSourceAction`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type NoneSourceAction = PauseAction

/**
 * Schema for `NoneSourceAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NoneSourceAction = /*#__PURE__*/ Schema.suspend(() => PauseAction) as any as Schema.Codec<NoneSourceAction>

/**
 * `NoneSourceActions`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NoneSourceActions {
  readonly type: "none"
  readonly id: string
  readonly actions: ReadonlyArray<NoneSourceAction>
}

/**
 * Schema for `NoneSourceActions`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NoneSourceActions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("none"),
    id: Schema.String,
    actions: Schema.Array(NoneSourceAction)
  }).annotate({ identifier: "input.NoneSourceActions" })
) as any as Schema.Codec<NoneSourceActions>

/**
 * `Origin`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Origin = "viewport" | "pointer" | ElementOrigin

/**
 * Schema for `Origin`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Origin = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([Schema.Literal("viewport"), Schema.Literal("pointer"), ElementOrigin])
) as any as Schema.Codec<Origin>

/**
 * `PauseAction`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PauseAction {
  readonly type: "pause"
  readonly duration?: number | undefined
}

/**
 * Schema for `PauseAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PauseAction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("pause"),
    duration: Schema.optional(Schema.Int)
  }).annotate({ identifier: "input.PauseAction" })
) as any as Schema.Codec<PauseAction>

/**
 * `PerformActionsParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PerformActionsParameters {
  readonly context: BrowsingContext.BrowsingContext
  readonly actions: ReadonlyArray<SourceActions>
}

/**
 * Schema for `PerformActionsParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PerformActionsParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext.BrowsingContext,
    actions: Schema.Array(SourceActions)
  }).annotate({ identifier: "input.PerformActionsParameters" })
) as any as Schema.Codec<PerformActionsParameters>

/**
 * `PerformActionsResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PerformActionsResult = { readonly [key: string]: unknown }

/**
 * Schema for `PerformActionsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PerformActionsResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  PerformActionsResult
>

/**
 * `PointerDownAction`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PointerDownAction {
  readonly type: "pointerDown"
  readonly button: number
  readonly width?: number | undefined
  readonly height?: number | undefined
  readonly pressure?: number | undefined
  readonly tangentialPressure?: number | undefined
  readonly twist?: number | undefined
  readonly altitudeAngle?: number | undefined
  readonly azimuthAngle?: number | undefined
}

/**
 * Schema for `PointerDownAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PointerDownAction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("pointerDown"),
    button: Schema.Int,
    width: Schema.optional(Schema.Int),
    height: Schema.optional(Schema.Int),
    pressure: Schema.optional(Schema.Number),
    tangentialPressure: Schema.optional(Schema.Number),
    twist: Schema.optional(Schema.Int),
    altitudeAngle: Schema.optional(Schema.Number),
    azimuthAngle: Schema.optional(Schema.Number)
  }).annotate({ identifier: "input.PointerDownAction" })
) as any as Schema.Codec<PointerDownAction>

/**
 * `PointerMoveAction`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PointerMoveAction {
  readonly type: "pointerMove"
  readonly x: number
  readonly y: number
  readonly duration?: number | undefined
  readonly origin?: Origin | undefined
  readonly width?: number | undefined
  readonly height?: number | undefined
  readonly pressure?: number | undefined
  readonly tangentialPressure?: number | undefined
  readonly twist?: number | undefined
  readonly altitudeAngle?: number | undefined
  readonly azimuthAngle?: number | undefined
}

/**
 * Schema for `PointerMoveAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PointerMoveAction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("pointerMove"),
    x: Schema.Number,
    y: Schema.Number,
    duration: Schema.optional(Schema.Int),
    origin: Schema.optional(Origin),
    width: Schema.optional(Schema.Int),
    height: Schema.optional(Schema.Int),
    pressure: Schema.optional(Schema.Number),
    tangentialPressure: Schema.optional(Schema.Number),
    twist: Schema.optional(Schema.Int),
    altitudeAngle: Schema.optional(Schema.Number),
    azimuthAngle: Schema.optional(Schema.Number)
  }).annotate({ identifier: "input.PointerMoveAction" })
) as any as Schema.Codec<PointerMoveAction>

/**
 * `PointerParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PointerParameters {
  readonly pointerType?: PointerType | undefined
}

/**
 * Schema for `PointerParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PointerParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pointerType: Schema.optional(PointerType)
  }).annotate({ identifier: "input.PointerParameters" })
) as any as Schema.Codec<PointerParameters>

/**
 * `PointerSourceAction`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PointerSourceAction = PauseAction | PointerDownAction | PointerUpAction | PointerMoveAction

/**
 * Schema for `PointerSourceAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PointerSourceAction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([PauseAction, PointerDownAction, PointerUpAction, PointerMoveAction])
) as any as Schema.Codec<PointerSourceAction>

/**
 * `PointerSourceActions`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PointerSourceActions {
  readonly type: "pointer"
  readonly id: string
  readonly parameters?: PointerParameters | undefined
  readonly actions: ReadonlyArray<PointerSourceAction>
}

/**
 * Schema for `PointerSourceActions`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PointerSourceActions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("pointer"),
    id: Schema.String,
    parameters: Schema.optional(PointerParameters),
    actions: Schema.Array(PointerSourceAction)
  }).annotate({ identifier: "input.PointerSourceActions" })
) as any as Schema.Codec<PointerSourceActions>

/**
 * `PointerType` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PointerType =
  | "mouse"
  | "pen"
  | "touch"
  | (string & {})

/**
 * Schema for `PointerType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PointerType = Schema.String as any as Schema.Codec<PointerType>

/**
 * `PointerUpAction`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PointerUpAction {
  readonly type: "pointerUp"
  readonly button: number
}

/**
 * Schema for `PointerUpAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PointerUpAction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("pointerUp"),
    button: Schema.Int
  }).annotate({ identifier: "input.PointerUpAction" })
) as any as Schema.Codec<PointerUpAction>

/**
 * `ReleaseActionsParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReleaseActionsParameters {
  readonly context: BrowsingContext.BrowsingContext
}

/**
 * Schema for `ReleaseActionsParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReleaseActionsParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext.BrowsingContext
  }).annotate({ identifier: "input.ReleaseActionsParameters" })
) as any as Schema.Codec<ReleaseActionsParameters>

/**
 * `ReleaseActionsResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ReleaseActionsResult = { readonly [key: string]: unknown }

/**
 * Schema for `ReleaseActionsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReleaseActionsResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  ReleaseActionsResult
>

/**
 * `SetFilesParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetFilesParameters {
  readonly context: BrowsingContext.BrowsingContext
  readonly element: Script.SharedReference
  readonly files: ReadonlyArray<string>
}

/**
 * Schema for `SetFilesParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetFilesParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext.BrowsingContext,
    element: Script.SharedReference,
    files: Schema.Array(Schema.String)
  }).annotate({ identifier: "input.SetFilesParameters" })
) as any as Schema.Codec<SetFilesParameters>

/**
 * `SetFilesResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetFilesResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetFilesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetFilesResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<SetFilesResult>

/**
 * `SourceActions`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SourceActions = NoneSourceActions | KeySourceActions | PointerSourceActions | WheelSourceActions

/**
 * Schema for `SourceActions`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SourceActions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([NoneSourceActions, KeySourceActions, PointerSourceActions, WheelSourceActions])
) as any as Schema.Codec<SourceActions>

/**
 * `WheelScrollAction`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WheelScrollAction {
  readonly type: "scroll"
  readonly x: number
  readonly y: number
  readonly deltaX: number
  readonly deltaY: number
  readonly duration?: number | undefined
  readonly origin?: Origin | undefined
}

/**
 * Schema for `WheelScrollAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WheelScrollAction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("scroll"),
    x: Schema.Int,
    y: Schema.Int,
    deltaX: Schema.Int,
    deltaY: Schema.Int,
    duration: Schema.optional(Schema.Int),
    origin: Schema.optional(Origin)
  }).annotate({ identifier: "input.WheelScrollAction" })
) as any as Schema.Codec<WheelScrollAction>

/**
 * `WheelSourceAction`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type WheelSourceAction = PauseAction | WheelScrollAction

/**
 * Schema for `WheelSourceAction`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WheelSourceAction = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([PauseAction, WheelScrollAction])
) as any as Schema.Codec<WheelSourceAction>

/**
 * `WheelSourceActions`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WheelSourceActions {
  readonly type: "wheel"
  readonly id: string
  readonly actions: ReadonlyArray<WheelSourceAction>
}

/**
 * Schema for `WheelSourceActions`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WheelSourceActions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("wheel"),
    id: Schema.String,
    actions: Schema.Array(WheelSourceAction)
  }).annotate({ identifier: "input.WheelSourceActions" })
) as any as Schema.Codec<WheelSourceActions>

/**
 * Sends `input.performActions`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const performActions: Protocol.CommandDef<"input.performActions", PerformActionsParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "input.performActions",
    PerformActionsParameters,
    undefined,
    { status: "stable", compensation: "releaseInput" }
  )

/**
 * Sends `input.releaseActions`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const releaseActions: Protocol.CommandDef<"input.releaseActions", ReleaseActionsParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "input.releaseActions",
    ReleaseActionsParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `input.setFiles`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setFiles: Protocol.CommandDef<"input.setFiles", SetFilesParameters, void> = /*#__PURE__*/ Protocol.command(
  "input.setFiles",
  SetFilesParameters,
  undefined,
  { status: "stable" }
)

/**
 * The `input.fileDialogOpened` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const fileDialogOpened: Protocol.EventDef<"input.fileDialogOpened", FileDialogInfo> = /*#__PURE__*/ Protocol
  .event(
    "input.fileDialogOpened",
    FileDialogInfo,
    { status: "stable" }
  )
