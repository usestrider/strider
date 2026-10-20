/**
 * The Input domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * `DragData`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DragData {
  readonly items: ReadonlyArray<DragDataItem>
  /**
   * List of filenames that should be included when dropping
   */
  readonly files?: ReadonlyArray<string> | undefined
  /**
   * Bit field representing allowed drag operations. Copy = 1, Link = 2, Move = 16
   */
  readonly dragOperationsMask: number
}

/**
 * Schema for `DragData`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DragData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    items: Schema.Array(DragDataItem),
    files: Schema.optional(Schema.Array(Schema.String)),
    dragOperationsMask: Schema.Int
  }).annotate({ identifier: "Input.DragData" })
) as any as Schema.Codec<DragData>

/**
 * `DragDataItem`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DragDataItem {
  /**
   * Mime type of the dragged data.
   */
  readonly mimeType: string
  /**
   * Depending of the value of `mimeType`, it contains the dragged link,
   * text, HTML markup or any other data.
   */
  readonly data: string
  /**
   * Title associated with a link. Only valid when `mimeType` == "text/uri-list".
   */
  readonly title?: string | undefined
  /**
   * Stores the base URL for the contained markup. Only valid when `mimeType`
   * == "text/html".
   */
  readonly baseURL?: string | undefined
}

/**
 * Schema for `DragDataItem`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DragDataItem = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    mimeType: Schema.String,
    data: Schema.String,
    title: Schema.optional(Schema.String),
    baseURL: Schema.optional(Schema.String)
  }).annotate({ identifier: "Input.DragDataItem" })
) as any as Schema.Codec<DragDataItem>

/**
 * `GestureSourceType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type GestureSourceType =
  | "default"
  | "touch"
  | "mouse"
  | (string & {})

/**
 * Schema for `GestureSourceType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GestureSourceType = Schema.String as any as Schema.Codec<GestureSourceType>

/**
 * `MouseButton` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MouseButton =
  | "none"
  | "left"
  | "middle"
  | "right"
  | "back"
  | "forward"
  | (string & {})

/**
 * Schema for `MouseButton`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MouseButton = Schema.String as any as Schema.Codec<MouseButton>

/**
 * UTC time in seconds, counted from January 1, 1970.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TimeSinceEpoch = number

/**
 * Schema for `TimeSinceEpoch`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TimeSinceEpoch = Schema.Number as any as Schema.Codec<TimeSinceEpoch>

/**
 * `TouchPoint`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TouchPoint {
  /**
   * X coordinate of the event relative to the main frame's viewport in CSS pixels.
   */
  readonly x: number
  /**
   * Y coordinate of the event relative to the main frame's viewport in CSS pixels. 0 refers to
   * the top of the viewport and Y increases as it proceeds towards the bottom of the viewport.
   */
  readonly y: number
  /**
   * X radius of the touch area (default: 1.0).
   */
  readonly radiusX?: number | undefined
  /**
   * Y radius of the touch area (default: 1.0).
   */
  readonly radiusY?: number | undefined
  /**
   * Rotation angle (default: 0.0).
   */
  readonly rotationAngle?: number | undefined
  /**
   * Force (default: 1.0).
   */
  readonly force?: number | undefined
  /**
   * The normalized tangential pressure, which has a range of [-1,1] (default: 0).
   */
  readonly tangentialPressure?: number | undefined
  /**
   * The plane angle between the Y-Z plane and the plane containing both the stylus axis and the Y axis, in degrees of the range [-90,90], a positive tiltX is to the right (default: 0)
   */
  readonly tiltX?: number | undefined
  /**
   * The plane angle between the X-Z plane and the plane containing both the stylus axis and the X axis, in degrees of the range [-90,90], a positive tiltY is towards the user (default: 0).
   */
  readonly tiltY?: number | undefined
  /**
   * The clockwise rotation of a pen stylus around its own major axis, in degrees in the range [0,359] (default: 0).
   */
  readonly twist?: number | undefined
  /**
   * Identifier used to track touch sources between events, must be unique within an event.
   */
  readonly id?: number | undefined
}

/**
 * Schema for `TouchPoint`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TouchPoint = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    radiusX: Schema.optional(Schema.Number),
    radiusY: Schema.optional(Schema.Number),
    rotationAngle: Schema.optional(Schema.Number),
    force: Schema.optional(Schema.Number),
    tangentialPressure: Schema.optional(Schema.Number),
    tiltX: Schema.optional(Schema.Number),
    tiltY: Schema.optional(Schema.Number),
    twist: Schema.optional(Schema.Int),
    id: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Input.TouchPoint" })
) as any as Schema.Codec<TouchPoint>

/**
 * Dispatches a drag event into the page.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DispatchDragEventParams {
  /**
   * Type of the drag event.
   */
  readonly type: DispatchDragEventParamsType
  /**
   * X coordinate of the event relative to the main frame's viewport in CSS pixels.
   */
  readonly x: number
  /**
   * Y coordinate of the event relative to the main frame's viewport in CSS pixels. 0 refers to
   * the top of the viewport and Y increases as it proceeds towards the bottom of the viewport.
   */
  readonly y: number
  readonly data: DragData
  /**
   * Bit field representing pressed modifier keys. Alt=1, Ctrl=2, Meta/Command=4, Shift=8
   * (default: 0).
   */
  readonly modifiers?: number | undefined
}

/**
 * Schema for `DispatchDragEventParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DispatchDragEventParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: DispatchDragEventParamsType,
    x: Schema.Number,
    y: Schema.Number,
    data: DragData,
    modifiers: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Input.DispatchDragEventParams" })
) as any as Schema.Codec<DispatchDragEventParams>

/**
 * Type of the drag event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DispatchDragEventParamsType =
  | "dragEnter"
  | "dragOver"
  | "drop"
  | "dragCancel"
  | (string & {})

/**
 * Schema for `DispatchDragEventParamsType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DispatchDragEventParamsType = Schema.String as any as Schema.Codec<DispatchDragEventParamsType>

/**
 * Dispatches a key event to the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DispatchKeyEventParams {
  /**
   * Type of the key event.
   */
  readonly type: DispatchKeyEventParamsType
  /**
   * Bit field representing pressed modifier keys. Alt=1, Ctrl=2, Meta/Command=4, Shift=8
   * (default: 0).
   */
  readonly modifiers?: number | undefined
  /**
   * Time at which the event occurred.
   */
  readonly timestamp?: TimeSinceEpoch | undefined
  /**
   * Text as generated by processing a virtual key code with a keyboard layout. Not needed for
   * for `keyUp` and `rawKeyDown` events (default: "")
   */
  readonly text?: Redacted.Redacted<string> | undefined
  /**
   * Text that would have been generated by the keyboard if no modifiers were pressed (except for
   * shift). Useful for shortcut (accelerator) key handling (default: "").
   */
  readonly unmodifiedText?: Redacted.Redacted<string> | undefined
  /**
   * Unique key identifier (e.g., 'U+0041') (default: "").
   */
  readonly keyIdentifier?: string | undefined
  /**
   * Unique DOM defined string value for each physical key (e.g., 'KeyA') (default: "").
   */
  readonly code?: string | undefined
  /**
   * Unique DOM defined string value describing the meaning of the key in the context of active
   * modifiers, keyboard layout, etc (e.g., 'AltGr') (default: "").
   */
  readonly key?: string | undefined
  /**
   * Windows virtual key code (default: 0).
   */
  readonly windowsVirtualKeyCode?: number | undefined
  /**
   * Native virtual key code (default: 0).
   */
  readonly nativeVirtualKeyCode?: number | undefined
  /**
   * Whether the event was generated from auto repeat (default: false).
   */
  readonly autoRepeat?: boolean | undefined
  /**
   * Whether the event was generated from the keypad (default: false).
   */
  readonly isKeypad?: boolean | undefined
  /**
   * Whether the event was a system key event (default: false).
   */
  readonly isSystemKey?: boolean | undefined
  /**
   * Whether the event was from the left or right side of the keyboard. 1=Left, 2=Right (default:
   * 0).
   */
  readonly location?: number | undefined
  /**
   * Editing commands to send with the key event (e.g., 'selectAll') (default: []).
   * These are related to but not equal the command names used in `document.execCommand` and NSStandardKeyBindingResponding.
   * See https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/editing/commands/editor_command_names.h for valid command names.
   */
  readonly commands?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `DispatchKeyEventParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DispatchKeyEventParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: DispatchKeyEventParamsType,
    modifiers: Schema.optional(Schema.Int),
    timestamp: Schema.optional(TimeSinceEpoch),
    text: Schema.optional(Schema.RedactedFromValue(Schema.String)),
    unmodifiedText: Schema.optional(Schema.RedactedFromValue(Schema.String)),
    keyIdentifier: Schema.optional(Schema.String),
    code: Schema.optional(Schema.String),
    key: Schema.optional(Schema.String),
    windowsVirtualKeyCode: Schema.optional(Schema.Int),
    nativeVirtualKeyCode: Schema.optional(Schema.Int),
    autoRepeat: Schema.optional(Schema.Boolean),
    isKeypad: Schema.optional(Schema.Boolean),
    isSystemKey: Schema.optional(Schema.Boolean),
    location: Schema.optional(Schema.Int),
    commands: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Input.DispatchKeyEventParams" })
) as any as Schema.Codec<DispatchKeyEventParams>

/**
 * Type of the key event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DispatchKeyEventParamsType =
  | "keyDown"
  | "keyUp"
  | "rawKeyDown"
  | "char"
  | (string & {})

/**
 * Schema for `DispatchKeyEventParamsType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DispatchKeyEventParamsType = Schema.String as any as Schema.Codec<DispatchKeyEventParamsType>

/**
 * Dispatches a mouse event to the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DispatchMouseEventParams {
  /**
   * Type of the mouse event.
   */
  readonly type: DispatchMouseEventParamsType
  /**
   * X coordinate of the event relative to the main frame's viewport in CSS pixels.
   */
  readonly x: number
  /**
   * Y coordinate of the event relative to the main frame's viewport in CSS pixels. 0 refers to
   * the top of the viewport and Y increases as it proceeds towards the bottom of the viewport.
   */
  readonly y: number
  /**
   * Bit field representing pressed modifier keys. Alt=1, Ctrl=2, Meta/Command=4, Shift=8
   * (default: 0).
   */
  readonly modifiers?: number | undefined
  /**
   * Time at which the event occurred.
   */
  readonly timestamp?: TimeSinceEpoch | undefined
  /**
   * Mouse button (default: "none").
   */
  readonly button?: MouseButton | undefined
  /**
   * A number indicating which buttons are pressed on the mouse when a mouse event is triggered.
   * Left=1, Right=2, Middle=4, Back=8, Forward=16, None=0.
   */
  readonly buttons?: number | undefined
  /**
   * Number of times the mouse button was clicked (default: 0).
   */
  readonly clickCount?: number | undefined
  /**
   * The normalized pressure, which has a range of [0,1] (default: 0).
   */
  readonly force?: number | undefined
  /**
   * The normalized tangential pressure, which has a range of [-1,1] (default: 0).
   */
  readonly tangentialPressure?: number | undefined
  /**
   * The plane angle between the Y-Z plane and the plane containing both the stylus axis and the Y axis, in degrees of the range [-90,90], a positive tiltX is to the right (default: 0).
   */
  readonly tiltX?: number | undefined
  /**
   * The plane angle between the X-Z plane and the plane containing both the stylus axis and the X axis, in degrees of the range [-90,90], a positive tiltY is towards the user (default: 0).
   */
  readonly tiltY?: number | undefined
  /**
   * The clockwise rotation of a pen stylus around its own major axis, in degrees in the range [0,359] (default: 0).
   */
  readonly twist?: number | undefined
  /**
   * X delta in CSS pixels for mouse wheel event (default: 0).
   */
  readonly deltaX?: number | undefined
  /**
   * Y delta in CSS pixels for mouse wheel event (default: 0).
   */
  readonly deltaY?: number | undefined
  /**
   * Pointer type (default: "mouse").
   */
  readonly pointerType?: DispatchMouseEventParamsPointerType | undefined
}

/**
 * Schema for `DispatchMouseEventParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DispatchMouseEventParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: DispatchMouseEventParamsType,
    x: Schema.Number,
    y: Schema.Number,
    modifiers: Schema.optional(Schema.Int),
    timestamp: Schema.optional(TimeSinceEpoch),
    button: Schema.optional(MouseButton),
    buttons: Schema.optional(Schema.Int),
    clickCount: Schema.optional(Schema.Int),
    force: Schema.optional(Schema.Number),
    tangentialPressure: Schema.optional(Schema.Number),
    tiltX: Schema.optional(Schema.Number),
    tiltY: Schema.optional(Schema.Number),
    twist: Schema.optional(Schema.Int),
    deltaX: Schema.optional(Schema.Number),
    deltaY: Schema.optional(Schema.Number),
    pointerType: Schema.optional(DispatchMouseEventParamsPointerType)
  }).annotate({ identifier: "Input.DispatchMouseEventParams" })
) as any as Schema.Codec<DispatchMouseEventParams>

/**
 * Pointer type (default: "mouse").
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DispatchMouseEventParamsPointerType =
  | "mouse"
  | "pen"
  | (string & {})

/**
 * Schema for `DispatchMouseEventParamsPointerType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DispatchMouseEventParamsPointerType = Schema.String as any as Schema.Codec<
  DispatchMouseEventParamsPointerType
>

/**
 * Type of the mouse event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DispatchMouseEventParamsType =
  | "mousePressed"
  | "mouseReleased"
  | "mouseMoved"
  | "mouseWheel"
  | (string & {})

/**
 * Schema for `DispatchMouseEventParamsType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DispatchMouseEventParamsType = Schema.String as any as Schema.Codec<DispatchMouseEventParamsType>

/**
 * Dispatches a touch event to the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DispatchTouchEventParams {
  /**
   * Type of the touch event. TouchEnd and TouchCancel must not contain any touch points, while
   * TouchStart and TouchMove must contains at least one.
   */
  readonly type: DispatchTouchEventParamsType
  /**
   * Active touch points on the touch device. One event per any changed point (compared to
   * previous touch event in a sequence) is generated, emulating pressing/moving/releasing points
   * one by one.
   */
  readonly touchPoints: ReadonlyArray<TouchPoint>
  /**
   * Bit field representing pressed modifier keys. Alt=1, Ctrl=2, Meta/Command=4, Shift=8
   * (default: 0).
   */
  readonly modifiers?: number | undefined
  /**
   * Time at which the event occurred.
   */
  readonly timestamp?: TimeSinceEpoch | undefined
}

/**
 * Schema for `DispatchTouchEventParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DispatchTouchEventParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: DispatchTouchEventParamsType,
    touchPoints: Schema.Array(TouchPoint),
    modifiers: Schema.optional(Schema.Int),
    timestamp: Schema.optional(TimeSinceEpoch)
  }).annotate({ identifier: "Input.DispatchTouchEventParams" })
) as any as Schema.Codec<DispatchTouchEventParams>

/**
 * Type of the touch event. TouchEnd and TouchCancel must not contain any touch points, while
 * TouchStart and TouchMove must contains at least one.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DispatchTouchEventParamsType =
  | "touchStart"
  | "touchEnd"
  | "touchMove"
  | "touchCancel"
  | (string & {})

/**
 * Schema for `DispatchTouchEventParamsType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DispatchTouchEventParamsType = Schema.String as any as Schema.Codec<DispatchTouchEventParamsType>

/**
 * Emitted only when `Input.setInterceptDrags` is enabled. Use this data with `Input.dispatchDragEvent` to
 * restore normal drag and drop behavior.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DragInterceptedParams {
  readonly data: DragData
}

/**
 * Schema for `DragInterceptedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DragInterceptedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    data: DragData
  }).annotate({ identifier: "Input.DragInterceptedParams" })
) as any as Schema.Codec<DragInterceptedParams>

/**
 * Emulates touch event from the mouse event parameters.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EmulateTouchFromMouseEventParams {
  /**
   * Type of the mouse event.
   */
  readonly type: EmulateTouchFromMouseEventParamsType
  /**
   * X coordinate of the mouse pointer in DIP.
   */
  readonly x: number
  /**
   * Y coordinate of the mouse pointer in DIP.
   */
  readonly y: number
  /**
   * Mouse button. Only "none", "left", "right" are supported.
   */
  readonly button: MouseButton
  /**
   * Time at which the event occurred (default: current time).
   */
  readonly timestamp?: TimeSinceEpoch | undefined
  /**
   * X delta in DIP for mouse wheel event (default: 0).
   */
  readonly deltaX?: number | undefined
  /**
   * Y delta in DIP for mouse wheel event (default: 0).
   */
  readonly deltaY?: number | undefined
  /**
   * Bit field representing pressed modifier keys. Alt=1, Ctrl=2, Meta/Command=4, Shift=8
   * (default: 0).
   */
  readonly modifiers?: number | undefined
  /**
   * Number of times the mouse button was clicked (default: 0).
   */
  readonly clickCount?: number | undefined
}

/**
 * Schema for `EmulateTouchFromMouseEventParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EmulateTouchFromMouseEventParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: EmulateTouchFromMouseEventParamsType,
    x: Schema.Int,
    y: Schema.Int,
    button: MouseButton,
    timestamp: Schema.optional(TimeSinceEpoch),
    deltaX: Schema.optional(Schema.Number),
    deltaY: Schema.optional(Schema.Number),
    modifiers: Schema.optional(Schema.Int),
    clickCount: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Input.EmulateTouchFromMouseEventParams" })
) as any as Schema.Codec<EmulateTouchFromMouseEventParams>

/**
 * Type of the mouse event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type EmulateTouchFromMouseEventParamsType =
  | "mousePressed"
  | "mouseReleased"
  | "mouseMoved"
  | "mouseWheel"
  | (string & {})

/**
 * Schema for `EmulateTouchFromMouseEventParamsType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EmulateTouchFromMouseEventParamsType = Schema.String as any as Schema.Codec<
  EmulateTouchFromMouseEventParamsType
>

/**
 * This method sets the current candidate text for IME.
 * Use imeCommitComposition to commit the final text.
 * Use imeSetComposition with empty string as text to cancel composition.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ImeSetCompositionParams {
  /**
   * The text to insert
   */
  readonly text: Redacted.Redacted<string>
  /**
   * selection start
   */
  readonly selectionStart: number
  /**
   * selection end
   */
  readonly selectionEnd: number
  /**
   * replacement start
   */
  readonly replacementStart?: number | undefined
  /**
   * replacement end
   */
  readonly replacementEnd?: number | undefined
}

/**
 * Schema for `ImeSetCompositionParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ImeSetCompositionParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.RedactedFromValue(Schema.String),
    selectionStart: Schema.Int,
    selectionEnd: Schema.Int,
    replacementStart: Schema.optional(Schema.Int),
    replacementEnd: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Input.ImeSetCompositionParams" })
) as any as Schema.Codec<ImeSetCompositionParams>

/**
 * This method emulates inserting text that doesn't come from a key press,
 * for example an emoji keyboard or an IME.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InsertTextParams {
  /**
   * The text to insert.
   */
  readonly text: Redacted.Redacted<string>
}

/**
 * Schema for `InsertTextParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InsertTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.RedactedFromValue(Schema.String)
  }).annotate({ identifier: "Input.InsertTextParams" })
) as any as Schema.Codec<InsertTextParams>

/**
 * Ignores input events (useful while auditing page).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetIgnoreInputEventsParams {
  /**
   * Ignores input events processing when set to true.
   */
  readonly ignore: boolean
}

/**
 * Schema for `SetIgnoreInputEventsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetIgnoreInputEventsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ignore: Schema.Boolean
  }).annotate({ identifier: "Input.SetIgnoreInputEventsParams" })
) as any as Schema.Codec<SetIgnoreInputEventsParams>

/**
 * Prevents default drag and drop behavior and instead emits `Input.dragIntercepted` events.
 * Drag and drop behavior can be directly controlled via `Input.dispatchDragEvent`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetInterceptDragsParams {
  readonly enabled: boolean
}

/**
 * Schema for `SetInterceptDragsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetInterceptDragsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Input.SetInterceptDragsParams" })
) as any as Schema.Codec<SetInterceptDragsParams>

/**
 * Synthesizes a pinch gesture over a time period by issuing appropriate touch events.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SynthesizePinchGestureParams {
  /**
   * X coordinate of the start of the gesture in CSS pixels.
   */
  readonly x: number
  /**
   * Y coordinate of the start of the gesture in CSS pixels.
   */
  readonly y: number
  /**
   * Relative scale factor after zooming (>1.0 zooms in, <1.0 zooms out).
   */
  readonly scaleFactor: number
  /**
   * Relative pointer speed in pixels per second (default: 800).
   */
  readonly relativeSpeed?: number | undefined
  /**
   * Which type of input events to be generated (default: 'default', which queries the platform
   * for the preferred input type).
   */
  readonly gestureSourceType?: GestureSourceType | undefined
}

/**
 * Schema for `SynthesizePinchGestureParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SynthesizePinchGestureParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    scaleFactor: Schema.Number,
    relativeSpeed: Schema.optional(Schema.Int),
    gestureSourceType: Schema.optional(GestureSourceType)
  }).annotate({ identifier: "Input.SynthesizePinchGestureParams" })
) as any as Schema.Codec<SynthesizePinchGestureParams>

/**
 * Synthesizes a scroll gesture over a time period by issuing appropriate touch events.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SynthesizeScrollGestureParams {
  /**
   * X coordinate of the start of the gesture in CSS pixels.
   */
  readonly x: number
  /**
   * Y coordinate of the start of the gesture in CSS pixels.
   */
  readonly y: number
  /**
   * The distance to scroll along the X axis (positive to scroll left).
   */
  readonly xDistance?: number | undefined
  /**
   * The distance to scroll along the Y axis (positive to scroll up).
   */
  readonly yDistance?: number | undefined
  /**
   * The number of additional pixels to scroll back along the X axis, in addition to the given
   * distance.
   */
  readonly xOverscroll?: number | undefined
  /**
   * The number of additional pixels to scroll back along the Y axis, in addition to the given
   * distance.
   */
  readonly yOverscroll?: number | undefined
  /**
   * Prevent fling (default: true).
   */
  readonly preventFling?: boolean | undefined
  /**
   * Swipe speed in pixels per second (default: 800).
   */
  readonly speed?: number | undefined
  /**
   * Which type of input events to be generated (default: 'default', which queries the platform
   * for the preferred input type).
   */
  readonly gestureSourceType?: GestureSourceType | undefined
  /**
   * The number of times to repeat the gesture (default: 0).
   */
  readonly repeatCount?: number | undefined
  /**
   * The number of milliseconds delay between each repeat. (default: 250).
   */
  readonly repeatDelayMs?: number | undefined
  /**
   * The name of the interaction markers to generate, if not empty (default: "").
   */
  readonly interactionMarkerName?: string | undefined
}

/**
 * Schema for `SynthesizeScrollGestureParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SynthesizeScrollGestureParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    xDistance: Schema.optional(Schema.Number),
    yDistance: Schema.optional(Schema.Number),
    xOverscroll: Schema.optional(Schema.Number),
    yOverscroll: Schema.optional(Schema.Number),
    preventFling: Schema.optional(Schema.Boolean),
    speed: Schema.optional(Schema.Int),
    gestureSourceType: Schema.optional(GestureSourceType),
    repeatCount: Schema.optional(Schema.Int),
    repeatDelayMs: Schema.optional(Schema.Int),
    interactionMarkerName: Schema.optional(Schema.String)
  }).annotate({ identifier: "Input.SynthesizeScrollGestureParams" })
) as any as Schema.Codec<SynthesizeScrollGestureParams>

/**
 * Synthesizes a tap gesture over a time period by issuing appropriate touch events.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SynthesizeTapGestureParams {
  /**
   * X coordinate of the start of the gesture in CSS pixels.
   */
  readonly x: number
  /**
   * Y coordinate of the start of the gesture in CSS pixels.
   */
  readonly y: number
  /**
   * Duration between touchdown and touchup events in ms (default: 50).
   */
  readonly duration?: number | undefined
  /**
   * Number of times to perform the tap (e.g. 2 for double tap, default: 1).
   */
  readonly tapCount?: number | undefined
  /**
   * Which type of input events to be generated (default: 'default', which queries the platform
   * for the preferred input type).
   */
  readonly gestureSourceType?: GestureSourceType | undefined
}

/**
 * Schema for `SynthesizeTapGestureParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SynthesizeTapGestureParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    duration: Schema.optional(Schema.Int),
    tapCount: Schema.optional(Schema.Int),
    gestureSourceType: Schema.optional(GestureSourceType)
  }).annotate({ identifier: "Input.SynthesizeTapGestureParams" })
) as any as Schema.Codec<SynthesizeTapGestureParams>

/**
 * Cancels any active dragging in the page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const cancelDragging: Protocol.CommandDef<"Input.cancelDragging", void, void> = /*#__PURE__*/ Protocol.command(
  "Input.cancelDragging",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Dispatches a drag event into the page.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const dispatchDragEvent: Protocol.CommandDef<"Input.dispatchDragEvent", DispatchDragEventParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Input.dispatchDragEvent",
    DispatchDragEventParams,
    undefined,
    { status: "experimental", compensation: "releaseInput" }
  )

/**
 * Dispatches a key event to the page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const dispatchKeyEvent: Protocol.CommandDef<"Input.dispatchKeyEvent", DispatchKeyEventParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Input.dispatchKeyEvent",
    DispatchKeyEventParams,
    undefined,
    { status: "stable", compensation: "releaseInput" }
  )

/**
 * Dispatches a mouse event to the page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const dispatchMouseEvent: Protocol.CommandDef<"Input.dispatchMouseEvent", DispatchMouseEventParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Input.dispatchMouseEvent",
    DispatchMouseEventParams,
    undefined,
    { status: "stable", compensation: "releaseInput" }
  )

/**
 * Dispatches a touch event to the page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const dispatchTouchEvent: Protocol.CommandDef<"Input.dispatchTouchEvent", DispatchTouchEventParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Input.dispatchTouchEvent",
    DispatchTouchEventParams,
    undefined,
    { status: "stable", compensation: "releaseInput" }
  )

/**
 * Emulates touch event from the mouse event parameters.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const emulateTouchFromMouseEvent: Protocol.CommandDef<
  "Input.emulateTouchFromMouseEvent",
  EmulateTouchFromMouseEventParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Input.emulateTouchFromMouseEvent",
  EmulateTouchFromMouseEventParams,
  undefined,
  { status: "experimental" }
)

/**
 * This method sets the current candidate text for IME.
 * Use imeCommitComposition to commit the final text.
 * Use imeSetComposition with empty string as text to cancel composition.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const imeSetComposition: Protocol.CommandDef<"Input.imeSetComposition", ImeSetCompositionParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Input.imeSetComposition",
    ImeSetCompositionParams,
    undefined,
    { status: "experimental" }
  )

/**
 * This method emulates inserting text that doesn't come from a key press,
 * for example an emoji keyboard or an IME.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const insertText: Protocol.CommandDef<"Input.insertText", InsertTextParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Input.insertText",
    InsertTextParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Ignores input events (useful while auditing page).
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setIgnoreInputEvents: Protocol.CommandDef<"Input.setIgnoreInputEvents", SetIgnoreInputEventsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Input.setIgnoreInputEvents",
    SetIgnoreInputEventsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Prevents default drag and drop behavior and instead emits `Input.dragIntercepted` events.
 * Drag and drop behavior can be directly controlled via `Input.dispatchDragEvent`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setInterceptDrags: Protocol.CommandDef<"Input.setInterceptDrags", SetInterceptDragsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Input.setInterceptDrags",
    SetInterceptDragsParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Synthesizes a pinch gesture over a time period by issuing appropriate touch events.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const synthesizePinchGesture: Protocol.CommandDef<
  "Input.synthesizePinchGesture",
  SynthesizePinchGestureParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Input.synthesizePinchGesture",
  SynthesizePinchGestureParams,
  undefined,
  { status: "experimental" }
)

/**
 * Synthesizes a scroll gesture over a time period by issuing appropriate touch events.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const synthesizeScrollGesture: Protocol.CommandDef<
  "Input.synthesizeScrollGesture",
  SynthesizeScrollGestureParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Input.synthesizeScrollGesture",
  SynthesizeScrollGestureParams,
  undefined,
  { status: "experimental" }
)

/**
 * Synthesizes a tap gesture over a time period by issuing appropriate touch events.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const synthesizeTapGesture: Protocol.CommandDef<"Input.synthesizeTapGesture", SynthesizeTapGestureParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Input.synthesizeTapGesture",
    SynthesizeTapGestureParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Emitted only when `Input.setInterceptDrags` is enabled. Use this data with `Input.dispatchDragEvent` to
 * restore normal drag and drop behavior.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const dragIntercepted: Protocol.EventDef<"Input.dragIntercepted", DragInterceptedParams> = /*#__PURE__*/ Protocol
  .event(
    "Input.dragIntercepted",
    DragInterceptedParams,
    { status: "experimental" }
  )
