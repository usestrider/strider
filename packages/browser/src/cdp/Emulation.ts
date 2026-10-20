/**
 * This domain emulates different environments for the page.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as Network from "./Network.ts"
import * as Page from "./Page.ts"

/**
 * `DevicePosture`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DevicePosture {
  /**
   * Current posture of the device
   */
  readonly type: DevicePostureType
}

/**
 * Schema for `DevicePosture`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DevicePosture = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: DevicePostureType
  }).annotate({ identifier: "Emulation.DevicePosture" })
) as any as Schema.Codec<DevicePosture>

/**
 * Current posture of the device
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DevicePostureType =
  | "continuous"
  | "folded"
  | (string & {})

/**
 * Schema for `DevicePostureType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DevicePostureType = Schema.String as any as Schema.Codec<DevicePostureType>

/**
 * Enum of image types that can be disabled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type DisabledImageType =
  | "avif"
  | "jxl"
  | "webp"
  | (string & {})

/**
 * Schema for `DisabledImageType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DisabledImageType = Schema.String as any as Schema.Codec<DisabledImageType>

/**
 * `DisplayFeature`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DisplayFeature {
  /**
   * Orientation of a display feature in relation to screen
   */
  readonly orientation: DisplayFeatureOrientation
  /**
   * The offset from the screen origin in either the x (for vertical
   * orientation) or y (for horizontal orientation) direction.
   */
  readonly offset: number
  /**
   * A display feature may mask content such that it is not physically
   * displayed - this length along with the offset describes this area.
   * A display feature that only splits content will have a 0 mask_length.
   */
  readonly maskLength: number
}

/**
 * Schema for `DisplayFeature`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DisplayFeature = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    orientation: DisplayFeatureOrientation,
    offset: Schema.Int,
    maskLength: Schema.Int
  }).annotate({ identifier: "Emulation.DisplayFeature" })
) as any as Schema.Codec<DisplayFeature>

/**
 * Orientation of a display feature in relation to screen
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DisplayFeatureOrientation =
  | "vertical"
  | "horizontal"
  | (string & {})

/**
 * Schema for `DisplayFeatureOrientation`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DisplayFeatureOrientation = Schema.String as any as Schema.Codec<DisplayFeatureOrientation>

/**
 * `MediaFeature`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MediaFeature {
  readonly name: string
  readonly value: string
}

/**
 * Schema for `MediaFeature`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MediaFeature = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "Emulation.MediaFeature" })
) as any as Schema.Codec<MediaFeature>

/**
 * `PressureMetadata`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PressureMetadata {
  readonly available?: boolean | undefined
}

/**
 * Schema for `PressureMetadata`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PressureMetadata = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    available: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Emulation.PressureMetadata" })
) as any as Schema.Codec<PressureMetadata>

/**
 * `PressureSource` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PressureSource =
  | "cpu"
  | (string & {})

/**
 * Schema for `PressureSource`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PressureSource = Schema.String as any as Schema.Codec<PressureSource>

/**
 * `PressureState` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PressureState =
  | "nominal"
  | "fair"
  | "serious"
  | "critical"
  | (string & {})

/**
 * Schema for `PressureState`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PressureState = Schema.String as any as Schema.Codec<PressureState>

/**
 * `SafeAreaInsets`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SafeAreaInsets {
  /**
   * Overrides safe-area-inset-top.
   */
  readonly top?: number | undefined
  /**
   * Overrides safe-area-max-inset-top.
   */
  readonly topMax?: number | undefined
  /**
   * Overrides safe-area-inset-left.
   */
  readonly left?: number | undefined
  /**
   * Overrides safe-area-max-inset-left.
   */
  readonly leftMax?: number | undefined
  /**
   * Overrides safe-area-inset-bottom.
   */
  readonly bottom?: number | undefined
  /**
   * Overrides safe-area-max-inset-bottom.
   */
  readonly bottomMax?: number | undefined
  /**
   * Overrides safe-area-inset-right.
   */
  readonly right?: number | undefined
  /**
   * Overrides safe-area-max-inset-right.
   */
  readonly rightMax?: number | undefined
}

/**
 * Schema for `SafeAreaInsets`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SafeAreaInsets = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    top: Schema.optional(Schema.Int),
    topMax: Schema.optional(Schema.Int),
    left: Schema.optional(Schema.Int),
    leftMax: Schema.optional(Schema.Int),
    bottom: Schema.optional(Schema.Int),
    bottomMax: Schema.optional(Schema.Int),
    right: Schema.optional(Schema.Int),
    rightMax: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Emulation.SafeAreaInsets" })
) as any as Schema.Codec<SafeAreaInsets>

/**
 * `ScreenId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ScreenId = Brand.Branded<string, "~@usestrider/browser/cdp/Emulation/ScreenId">

/**
 * Schema for `ScreenId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScreenId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Emulation/ScreenId")
) as any as Schema.Codec<ScreenId>

/**
 * Screen information similar to the one returned by window.getScreenDetails() method,
 * see https://w3c.github.io/window-management/#screendetailed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScreenInfo {
  /**
   * Offset of the left edge of the screen.
   */
  readonly left: number
  /**
   * Offset of the top edge of the screen.
   */
  readonly top: number
  /**
   * Width of the screen.
   */
  readonly width: number
  /**
   * Height of the screen.
   */
  readonly height: number
  /**
   * Offset of the left edge of the available screen area.
   */
  readonly availLeft: number
  /**
   * Offset of the top edge of the available screen area.
   */
  readonly availTop: number
  /**
   * Width of the available screen area.
   */
  readonly availWidth: number
  /**
   * Height of the available screen area.
   */
  readonly availHeight: number
  /**
   * Specifies the screen's device pixel ratio.
   */
  readonly devicePixelRatio: number
  /**
   * Specifies the screen's orientation.
   */
  readonly orientation: ScreenOrientation
  /**
   * Specifies the screen's color depth in bits.
   */
  readonly colorDepth: number
  /**
   * Indicates whether the device has multiple screens.
   */
  readonly isExtended: boolean
  /**
   * Indicates whether the screen is internal to the device or external, attached to the device.
   */
  readonly isInternal: boolean
  /**
   * Indicates whether the screen is set as the the operating system primary screen.
   */
  readonly isPrimary: boolean
  /**
   * Specifies the descriptive label for the screen.
   */
  readonly label: string
  /**
   * Specifies the unique identifier of the screen.
   */
  readonly id: ScreenId
}

/**
 * Schema for `ScreenInfo`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScreenInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    left: Schema.Int,
    top: Schema.Int,
    width: Schema.Int,
    height: Schema.Int,
    availLeft: Schema.Int,
    availTop: Schema.Int,
    availWidth: Schema.Int,
    availHeight: Schema.Int,
    devicePixelRatio: Schema.Number,
    orientation: ScreenOrientation,
    colorDepth: Schema.Int,
    isExtended: Schema.Boolean,
    isInternal: Schema.Boolean,
    isPrimary: Schema.Boolean,
    label: Schema.String,
    id: ScreenId
  }).annotate({ identifier: "Emulation.ScreenInfo" })
) as any as Schema.Codec<ScreenInfo>

/**
 * Screen orientation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScreenOrientation {
  /**
   * Orientation type.
   */
  readonly type: ScreenOrientationType
  /**
   * Orientation angle.
   */
  readonly angle: number
}

/**
 * Schema for `ScreenOrientation`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScreenOrientation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: ScreenOrientationType,
    angle: Schema.Int
  }).annotate({ identifier: "Emulation.ScreenOrientation" })
) as any as Schema.Codec<ScreenOrientation>

/**
 * Orientation type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ScreenOrientationType =
  | "portraitPrimary"
  | "portraitSecondary"
  | "landscapePrimary"
  | "landscapeSecondary"
  | (string & {})

/**
 * Schema for `ScreenOrientationType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScreenOrientationType = Schema.String as any as Schema.Codec<ScreenOrientationType>

/**
 * `SensorMetadata`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SensorMetadata {
  readonly available?: boolean | undefined
  readonly minimumFrequency?: number | undefined
  readonly maximumFrequency?: number | undefined
}

/**
 * Schema for `SensorMetadata`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SensorMetadata = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    available: Schema.optional(Schema.Boolean),
    minimumFrequency: Schema.optional(Schema.Number),
    maximumFrequency: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Emulation.SensorMetadata" })
) as any as Schema.Codec<SensorMetadata>

/**
 * `SensorReading`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SensorReading {
  readonly single?: SensorReadingSingle | undefined
  readonly xyz?: SensorReadingXYZ | undefined
  readonly quaternion?: SensorReadingQuaternion | undefined
}

/**
 * Schema for `SensorReading`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SensorReading = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    single: Schema.optional(SensorReadingSingle),
    xyz: Schema.optional(SensorReadingXYZ),
    quaternion: Schema.optional(SensorReadingQuaternion)
  }).annotate({ identifier: "Emulation.SensorReading" })
) as any as Schema.Codec<SensorReading>

/**
 * `SensorReadingQuaternion`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SensorReadingQuaternion {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly w: number
}

/**
 * Schema for `SensorReadingQuaternion`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SensorReadingQuaternion = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    z: Schema.Number,
    w: Schema.Number
  }).annotate({ identifier: "Emulation.SensorReadingQuaternion" })
) as any as Schema.Codec<SensorReadingQuaternion>

/**
 * `SensorReadingSingle`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SensorReadingSingle {
  readonly value: number
}

/**
 * Schema for `SensorReadingSingle`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SensorReadingSingle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    value: Schema.Number
  }).annotate({ identifier: "Emulation.SensorReadingSingle" })
) as any as Schema.Codec<SensorReadingSingle>

/**
 * `SensorReadingXYZ`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SensorReadingXYZ {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * Schema for `SensorReadingXYZ`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SensorReadingXYZ = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    z: Schema.Number
  }).annotate({ identifier: "Emulation.SensorReadingXYZ" })
) as any as Schema.Codec<SensorReadingXYZ>

/**
 * Used to specify sensor types to emulate.
 * See https://w3c.github.io/sensors/#automation for more information.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SensorType =
  | "absolute-orientation"
  | "accelerometer"
  | "ambient-light"
  | "gravity"
  | "gyroscope"
  | "linear-acceleration"
  | "magnetometer"
  | "relative-orientation"
  | (string & {})

/**
 * Schema for `SensorType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SensorType = Schema.String as any as Schema.Codec<SensorType>

/**
 * Used to specify User Agent Client Hints to emulate. See https://wicg.github.io/ua-client-hints
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UserAgentBrandVersion {
  readonly brand: string
  readonly version: string
}

/**
 * Schema for `UserAgentBrandVersion`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UserAgentBrandVersion = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    brand: Schema.String,
    version: Schema.String
  }).annotate({ identifier: "Emulation.UserAgentBrandVersion" })
) as any as Schema.Codec<UserAgentBrandVersion>

/**
 * Used to specify User Agent Client Hints to emulate. See https://wicg.github.io/ua-client-hints
 * Missing optional values will be filled in by the target with what it would normally use.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UserAgentMetadata {
  /**
   * Brands appearing in Sec-CH-UA.
   */
  readonly brands?: ReadonlyArray<UserAgentBrandVersion> | undefined
  /**
   * Brands appearing in Sec-CH-UA-Full-Version-List.
   */
  readonly fullVersionList?: ReadonlyArray<UserAgentBrandVersion> | undefined
  readonly platform: string
  readonly platformVersion: string
  readonly architecture: string
  readonly model: string
  readonly mobile: boolean
  readonly bitness?: string | undefined
  readonly wow64?: boolean | undefined
  /**
   * Used to specify User Agent form-factor values.
   * See https://wicg.github.io/ua-client-hints/#sec-ch-ua-form-factors
   */
  readonly formFactors?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `UserAgentMetadata`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UserAgentMetadata = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    brands: Schema.optional(Schema.Array(UserAgentBrandVersion)),
    fullVersionList: Schema.optional(Schema.Array(UserAgentBrandVersion)),
    platform: Schema.String,
    platformVersion: Schema.String,
    architecture: Schema.String,
    model: Schema.String,
    mobile: Schema.Boolean,
    bitness: Schema.optional(Schema.String),
    wow64: Schema.optional(Schema.Boolean),
    formFactors: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Emulation.UserAgentMetadata" })
) as any as Schema.Codec<UserAgentMetadata>

/**
 * advance: If the scheduler runs out of immediate work, the virtual time base may fast forward to
 * allow the next delayed task (if any) to run; pause: The virtual time base may not advance;
 * pauseIfNetworkFetchesPending: The virtual time base may not advance if there are any pending
 * resource fetches.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type VirtualTimePolicy =
  | "advance"
  | "pause"
  | "pauseIfNetworkFetchesPending"
  | (string & {})

/**
 * Schema for `VirtualTimePolicy`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const VirtualTimePolicy = Schema.String as any as Schema.Codec<VirtualTimePolicy>

/**
 * `WorkAreaInsets`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface WorkAreaInsets {
  /**
   * Work area top inset in pixels. Default is 0;
   */
  readonly top?: number | undefined
  /**
   * Work area left inset in pixels. Default is 0;
   */
  readonly left?: number | undefined
  /**
   * Work area bottom inset in pixels. Default is 0;
   */
  readonly bottom?: number | undefined
  /**
   * Work area right inset in pixels. Default is 0;
   */
  readonly right?: number | undefined
}

/**
 * Schema for `WorkAreaInsets`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WorkAreaInsets = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    top: Schema.optional(Schema.Int),
    left: Schema.optional(Schema.Int),
    bottom: Schema.optional(Schema.Int),
    right: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Emulation.WorkAreaInsets" })
) as any as Schema.Codec<WorkAreaInsets>

/**
 * Add a new screen to the device. Only supported in headless mode.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddScreenParams {
  /**
   * Offset of the left edge of the screen in pixels.
   */
  readonly left: number
  /**
   * Offset of the top edge of the screen in pixels.
   */
  readonly top: number
  /**
   * The width of the screen in pixels.
   */
  readonly width: number
  /**
   * The height of the screen in pixels.
   */
  readonly height: number
  /**
   * Specifies the screen's work area. Default is entire screen.
   */
  readonly workAreaInsets?: WorkAreaInsets | undefined
  /**
   * Specifies the screen's device pixel ratio. Default is 1.
   */
  readonly devicePixelRatio?: number | undefined
  /**
   * Specifies the screen's rotation angle. Available values are 0, 90, 180 and 270. Default is 0.
   */
  readonly rotation?: number | undefined
  /**
   * Specifies the screen's color depth in bits. Default is 24.
   */
  readonly colorDepth?: number | undefined
  /**
   * Specifies the descriptive label for the screen. Default is none.
   */
  readonly label?: string | undefined
  /**
   * Indicates whether the screen is internal to the device or external, attached to the device. Default is false.
   */
  readonly isInternal?: boolean | undefined
}

/**
 * Schema for `AddScreenParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddScreenParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    left: Schema.Int,
    top: Schema.Int,
    width: Schema.Int,
    height: Schema.Int,
    workAreaInsets: Schema.optional(WorkAreaInsets),
    devicePixelRatio: Schema.optional(Schema.Number),
    rotation: Schema.optional(Schema.Int),
    colorDepth: Schema.optional(Schema.Int),
    label: Schema.optional(Schema.String),
    isInternal: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Emulation.AddScreenParams" })
) as any as Schema.Codec<AddScreenParams>

/**
 * Add a new screen to the device. Only supported in headless mode.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddScreenResult {
  readonly screenInfo: ScreenInfo
}

/**
 * Schema for `AddScreenResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddScreenResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    screenInfo: ScreenInfo
  }).annotate({ identifier: "Emulation.AddScreenResult" })
) as any as Schema.Codec<AddScreenResult>

/**
 * `getOverriddenSensorInformation.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetOverriddenSensorInformationParams {
  readonly type: SensorType
}

/**
 * Schema for `GetOverriddenSensorInformationParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetOverriddenSensorInformationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: SensorType
  }).annotate({ identifier: "Emulation.GetOverriddenSensorInformationParams" })
) as any as Schema.Codec<GetOverriddenSensorInformationParams>

/**
 * `getOverriddenSensorInformation.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetOverriddenSensorInformationResult {
  readonly requestedSamplingFrequency: number
}

/**
 * Schema for `GetOverriddenSensorInformationResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetOverriddenSensorInformationResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestedSamplingFrequency: Schema.Number
  }).annotate({ identifier: "Emulation.GetOverriddenSensorInformationResult" })
) as any as Schema.Codec<GetOverriddenSensorInformationResult>

/**
 * Returns device's screen configuration. In headful mode, the physical screens configuration is returned,
 * whereas in headless mode, a virtual headless screen configuration is provided instead.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetScreenInfosResult {
  readonly screenInfos: ReadonlyArray<ScreenInfo>
}

/**
 * Schema for `GetScreenInfosResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetScreenInfosResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    screenInfos: Schema.Array(ScreenInfo)
  }).annotate({ identifier: "Emulation.GetScreenInfosResult" })
) as any as Schema.Codec<GetScreenInfosResult>

/**
 * Remove screen from the device. Only supported in headless mode.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RemoveScreenParams {
  readonly screenId: ScreenId
}

/**
 * Schema for `RemoveScreenParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RemoveScreenParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    screenId: ScreenId
  }).annotate({ identifier: "Emulation.RemoveScreenParams" })
) as any as Schema.Codec<RemoveScreenParams>

/**
 * Fired when a page calls screen.orientation.lock() or screen.orientation.unlock()
 * while device emulation is enabled. This allows the DevTools frontend to update the
 * emulated device orientation accordingly.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ScreenOrientationLockChangedParams {
  /**
   * Whether the screen orientation is currently locked.
   */
  readonly locked: boolean
  /**
   * The orientation lock type requested by the page. Only set when locked is true.
   */
  readonly orientation?: ScreenOrientation | undefined
}

/**
 * Schema for `ScreenOrientationLockChangedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ScreenOrientationLockChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    locked: Schema.Boolean,
    orientation: Schema.optional(ScreenOrientation)
  }).annotate({ identifier: "Emulation.ScreenOrientationLockChangedParams" })
) as any as Schema.Codec<ScreenOrientationLockChangedParams>

/**
 * Automatically render all web contents using a dark theme.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetAutoDarkModeOverrideParams {
  /**
   * Whether to enable or disable automatic dark mode.
   * If not specified, any existing override will be cleared.
   */
  readonly enabled?: boolean | undefined
}

/**
 * Schema for `SetAutoDarkModeOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetAutoDarkModeOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Emulation.SetAutoDarkModeOverrideParams" })
) as any as Schema.Codec<SetAutoDarkModeOverrideParams>

/**
 * Allows overriding the automation flag.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetAutomationOverrideParams {
  /**
   * Whether the override should be enabled.
   */
  readonly enabled: boolean
}

/**
 * Schema for `SetAutomationOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetAutomationOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Emulation.SetAutomationOverrideParams" })
) as any as Schema.Codec<SetAutomationOverrideParams>

/**
 * Overrides the value of navigator.cpuPerformance
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetCPUPerformanceOverrideParams {
  /**
   * Override value. Omitting the parameter disables the override.
   */
  readonly performanceTier?: SetCPUPerformanceOverrideParamsPerformanceTier | undefined
}

/**
 * Schema for `SetCPUPerformanceOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetCPUPerformanceOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    performanceTier: Schema.optional(SetCPUPerformanceOverrideParamsPerformanceTier)
  }).annotate({ identifier: "Emulation.SetCPUPerformanceOverrideParams" })
) as any as Schema.Codec<SetCPUPerformanceOverrideParams>

/**
 * Override value. Omitting the parameter disables the override.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetCPUPerformanceOverrideParamsPerformanceTier =
  | "unknown"
  | "low"
  | "mid"
  | "high"
  | "ultra"
  | (string & {})

/**
 * Schema for `SetCPUPerformanceOverrideParamsPerformanceTier`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCPUPerformanceOverrideParamsPerformanceTier = Schema.String as any as Schema.Codec<
  SetCPUPerformanceOverrideParamsPerformanceTier
>

/**
 * Enables CPU throttling to emulate slow CPUs.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetCPUThrottlingRateParams {
  /**
   * Throttling rate as a slowdown factor (1 is no throttle, 2 is 2x slowdown, etc).
   */
  readonly rate: number
}

/**
 * Schema for `SetCPUThrottlingRateParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetCPUThrottlingRateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rate: Schema.Number
  }).annotate({ identifier: "Emulation.SetCPUThrottlingRateParams" })
) as any as Schema.Codec<SetCPUThrottlingRateParams>

/**
 * Override the value of navigator.connection.saveData
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetDataSaverOverrideParams {
  /**
   * Override value. Omitting the parameter disables the override.
   */
  readonly dataSaverEnabled?: boolean | undefined
}

/**
 * Schema for `SetDataSaverOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetDataSaverOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    dataSaverEnabled: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Emulation.SetDataSaverOverrideParams" })
) as any as Schema.Codec<SetDataSaverOverrideParams>

/**
 * Sets or clears an override of the default background color of the frame. This override is used
 * if the content does not specify one.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetDefaultBackgroundColorOverrideParams {
  /**
   * RGBA of the default background color. If not specified, any existing override will be
   * cleared.
   */
  readonly color?: DOM.RGBA | undefined
}

/**
 * Schema for `SetDefaultBackgroundColorOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetDefaultBackgroundColorOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    color: Schema.optional(DOM.RGBA)
  }).annotate({ identifier: "Emulation.SetDefaultBackgroundColorOverrideParams" })
) as any as Schema.Codec<SetDefaultBackgroundColorOverrideParams>

/**
 * Overrides the values of device screen dimensions (window.screen.width, window.screen.height,
 * window.innerWidth, window.innerHeight, and "device-width"/"device-height"-related CSS media
 * query results).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetDeviceMetricsOverrideParams {
  /**
   * Overriding width value in pixels (minimum 0, maximum 10000000). 0 disables the override.
   */
  readonly width: number
  /**
   * Overriding height value in pixels (minimum 0, maximum 10000000). 0 disables the override.
   */
  readonly height: number
  /**
   * Overriding device scale factor value. 0 disables the override.
   */
  readonly deviceScaleFactor: number
  /**
   * Whether to emulate mobile device. This includes viewport meta tag, overlay scrollbars, text
   * autosizing and more.
   */
  readonly mobile: boolean
  /**
   * Scale to apply to resulting view image.
   */
  readonly scale?: number | undefined
  /**
   * Overriding screen width value in pixels (minimum 0, maximum 10000000).
   */
  readonly screenWidth?: number | undefined
  /**
   * Overriding screen height value in pixels (minimum 0, maximum 10000000).
   */
  readonly screenHeight?: number | undefined
  /**
   * Overriding view X position on screen in pixels (minimum 0, maximum 10000000).
   */
  readonly positionX?: number | undefined
  /**
   * Overriding view Y position on screen in pixels (minimum 0, maximum 10000000).
   */
  readonly positionY?: number | undefined
  /**
   * Do not set visible view size, rely upon explicit setVisibleSize call.
   */
  readonly dontSetVisibleSize?: boolean | undefined
  /**
   * Screen orientation override.
   */
  readonly screenOrientation?: ScreenOrientation | undefined
  /**
   * If set, the visible area of the page will be overridden to this viewport. This viewport
   * change is not observed by the page, e.g. viewport-relative elements do not change positions.
   */
  readonly viewport?: Page.Viewport | undefined
  /**
   * Scrollbar type. Default: `default`.
   */
  readonly scrollbarType?: SetDeviceMetricsOverrideParamsScrollbarType | undefined
  /**
   * If set to true, enables screen orientation lock emulation, which
   * intercepts screen.orientation.lock() calls from the page and reports
   * orientation changes via screenOrientationLockChanged events. This is
   * useful for emulating mobile device orientation lock behavior in
   * responsive design mode.
   */
  readonly screenOrientationLockEmulation?: boolean | undefined
  /**
   * Viewport meta tag behavior. Default: `default`. Note: if `mobile` is `true`,
   * the viewport meta tag is always enabled.
   */
  readonly viewportMeta?: SetDeviceMetricsOverrideParamsViewportMeta | undefined
}

/**
 * Schema for `SetDeviceMetricsOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetDeviceMetricsOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    width: Schema.Int,
    height: Schema.Int,
    deviceScaleFactor: Schema.Number,
    mobile: Schema.Boolean,
    scale: Schema.optional(Schema.Number),
    screenWidth: Schema.optional(Schema.Int),
    screenHeight: Schema.optional(Schema.Int),
    positionX: Schema.optional(Schema.Int),
    positionY: Schema.optional(Schema.Int),
    dontSetVisibleSize: Schema.optional(Schema.Boolean),
    screenOrientation: Schema.optional(ScreenOrientation),
    viewport: Schema.optional(Page.Viewport),
    scrollbarType: Schema.optional(SetDeviceMetricsOverrideParamsScrollbarType),
    screenOrientationLockEmulation: Schema.optional(Schema.Boolean),
    viewportMeta: Schema.optional(SetDeviceMetricsOverrideParamsViewportMeta)
  }).annotate({ identifier: "Emulation.SetDeviceMetricsOverrideParams" })
) as any as Schema.Codec<SetDeviceMetricsOverrideParams>

/**
 * Scrollbar type. Default: `default`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SetDeviceMetricsOverrideParamsScrollbarType =
  | "overlay"
  | "default"
  | (string & {})

/**
 * Schema for `SetDeviceMetricsOverrideParamsScrollbarType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetDeviceMetricsOverrideParamsScrollbarType = Schema.String as any as Schema.Codec<
  SetDeviceMetricsOverrideParamsScrollbarType
>

/**
 * Viewport meta tag behavior. Default: `default`. Note: if `mobile` is `true`,
 * the viewport meta tag is always enabled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SetDeviceMetricsOverrideParamsViewportMeta =
  | "enable"
  | "default"
  | (string & {})

/**
 * Schema for `SetDeviceMetricsOverrideParamsViewportMeta`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetDeviceMetricsOverrideParamsViewportMeta = Schema.String as any as Schema.Codec<
  SetDeviceMetricsOverrideParamsViewportMeta
>

/**
 * Start reporting the given posture value to the Device Posture API.
 * This override can also be set in setDeviceMetricsOverride().
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetDevicePostureOverrideParams {
  readonly posture: DevicePosture
}

/**
 * Schema for `SetDevicePostureOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetDevicePostureOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    posture: DevicePosture
  }).annotate({ identifier: "Emulation.SetDevicePostureOverrideParams" })
) as any as Schema.Codec<SetDevicePostureOverrideParams>

/**
 * `setDisabledImageTypes.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetDisabledImageTypesParams {
  /**
   * Image types to disable.
   */
  readonly imageTypes: ReadonlyArray<DisabledImageType>
}

/**
 * Schema for `SetDisabledImageTypesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetDisabledImageTypesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    imageTypes: Schema.Array(DisabledImageType)
  }).annotate({ identifier: "Emulation.SetDisabledImageTypesParams" })
) as any as Schema.Codec<SetDisabledImageTypesParams>

/**
 * Start using the given display features to pupulate the Viewport Segments API.
 * This override can also be set in setDeviceMetricsOverride().
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetDisplayFeaturesOverrideParams {
  readonly features: ReadonlyArray<DisplayFeature>
}

/**
 * Schema for `SetDisplayFeaturesOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetDisplayFeaturesOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    features: Schema.Array(DisplayFeature)
  }).annotate({ identifier: "Emulation.SetDisplayFeaturesOverrideParams" })
) as any as Schema.Codec<SetDisplayFeaturesOverrideParams>

/**
 * `setDocumentCookieDisabled.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetDocumentCookieDisabledParams {
  /**
   * Whether document.coookie API should be disabled.
   */
  readonly disabled: boolean
}

/**
 * Schema for `SetDocumentCookieDisabledParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetDocumentCookieDisabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    disabled: Schema.Boolean
  }).annotate({ identifier: "Emulation.SetDocumentCookieDisabledParams" })
) as any as Schema.Codec<SetDocumentCookieDisabledParams>

/**
 * `setEmitTouchEventsForMouse.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetEmitTouchEventsForMouseParams {
  /**
   * Whether touch emulation based on mouse input should be enabled.
   */
  readonly enabled: boolean
  /**
   * Touch/gesture events configuration. Default: current platform.
   */
  readonly configuration?: SetEmitTouchEventsForMouseParamsConfiguration | undefined
}

/**
 * Schema for `SetEmitTouchEventsForMouseParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetEmitTouchEventsForMouseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean,
    configuration: Schema.optional(SetEmitTouchEventsForMouseParamsConfiguration)
  }).annotate({ identifier: "Emulation.SetEmitTouchEventsForMouseParams" })
) as any as Schema.Codec<SetEmitTouchEventsForMouseParams>

/**
 * Touch/gesture events configuration. Default: current platform.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetEmitTouchEventsForMouseParamsConfiguration =
  | "mobile"
  | "desktop"
  | (string & {})

/**
 * Schema for `SetEmitTouchEventsForMouseParamsConfiguration`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetEmitTouchEventsForMouseParamsConfiguration = Schema.String as any as Schema.Codec<
  SetEmitTouchEventsForMouseParamsConfiguration
>

/**
 * Emulates the given media type or media feature for CSS media queries.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetEmulatedMediaParams {
  /**
   * Media type to emulate. Empty string disables the override.
   */
  readonly media?: string | undefined
  /**
   * Media features to emulate.
   */
  readonly features?: ReadonlyArray<MediaFeature> | undefined
}

/**
 * Schema for `SetEmulatedMediaParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetEmulatedMediaParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    media: Schema.optional(Schema.String),
    features: Schema.optional(Schema.Array(MediaFeature))
  }).annotate({ identifier: "Emulation.SetEmulatedMediaParams" })
) as any as Schema.Codec<SetEmulatedMediaParams>

/**
 * Emulates the given OS text scale.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetEmulatedOSTextScaleParams {
  readonly scale?: number | undefined
}

/**
 * Schema for `SetEmulatedOSTextScaleParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetEmulatedOSTextScaleParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scale: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Emulation.SetEmulatedOSTextScaleParams" })
) as any as Schema.Codec<SetEmulatedOSTextScaleParams>

/**
 * Emulates the given vision deficiency.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetEmulatedVisionDeficiencyParams {
  /**
   * Vision deficiency to emulate. Order: best-effort emulations come first, followed by any
   * physiologically accurate emulations for medically recognized color vision deficiencies.
   */
  readonly type: SetEmulatedVisionDeficiencyParamsType
}

/**
 * Schema for `SetEmulatedVisionDeficiencyParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetEmulatedVisionDeficiencyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: SetEmulatedVisionDeficiencyParamsType
  }).annotate({ identifier: "Emulation.SetEmulatedVisionDeficiencyParams" })
) as any as Schema.Codec<SetEmulatedVisionDeficiencyParams>

/**
 * Vision deficiency to emulate. Order: best-effort emulations come first, followed by any
 * physiologically accurate emulations for medically recognized color vision deficiencies.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetEmulatedVisionDeficiencyParamsType =
  | "none"
  | "blurredVision"
  | "reducedContrast"
  | "achromatopsia"
  | "deuteranopia"
  | "protanopia"
  | "tritanopia"
  | (string & {})

/**
 * Schema for `SetEmulatedVisionDeficiencyParamsType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetEmulatedVisionDeficiencyParamsType = Schema.String as any as Schema.Codec<
  SetEmulatedVisionDeficiencyParamsType
>

/**
 * Enables or disables simulating a focused and active page.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetFocusEmulationEnabledParams {
  /**
   * Whether to enable to disable focus emulation.
   */
  readonly enabled: boolean
}

/**
 * Schema for `SetFocusEmulationEnabledParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetFocusEmulationEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Emulation.SetFocusEmulationEnabledParams" })
) as any as Schema.Codec<SetFocusEmulationEnabledParams>

/**
 * Overrides the Geolocation Position or Error. Omitting latitude, longitude or
 * accuracy emulates position unavailable.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetGeolocationOverrideParams {
  /**
   * Mock latitude
   */
  readonly latitude?: number | undefined
  /**
   * Mock longitude
   */
  readonly longitude?: number | undefined
  /**
   * Mock accuracy
   */
  readonly accuracy?: number | undefined
  /**
   * Mock altitude
   */
  readonly altitude?: number | undefined
  /**
   * Mock altitudeAccuracy
   */
  readonly altitudeAccuracy?: number | undefined
  /**
   * Mock heading
   */
  readonly heading?: number | undefined
  /**
   * Mock speed
   */
  readonly speed?: number | undefined
}

/**
 * Schema for `SetGeolocationOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetGeolocationOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    latitude: Schema.optional(Schema.Number),
    longitude: Schema.optional(Schema.Number),
    accuracy: Schema.optional(Schema.Number),
    altitude: Schema.optional(Schema.Number),
    altitudeAccuracy: Schema.optional(Schema.Number),
    heading: Schema.optional(Schema.Number),
    speed: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Emulation.SetGeolocationOverrideParams" })
) as any as Schema.Codec<SetGeolocationOverrideParams>

/**
 * `setHardwareConcurrencyOverride.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetHardwareConcurrencyOverrideParams {
  /**
   * Hardware concurrency to report
   */
  readonly hardwareConcurrency: number
}

/**
 * Schema for `SetHardwareConcurrencyOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetHardwareConcurrencyOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    hardwareConcurrency: Schema.Int
  }).annotate({ identifier: "Emulation.SetHardwareConcurrencyOverrideParams" })
) as any as Schema.Codec<SetHardwareConcurrencyOverrideParams>

/**
 * Overrides the Idle state.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetIdleOverrideParams {
  /**
   * Mock isUserActive
   */
  readonly isUserActive: boolean
  /**
   * Mock isScreenUnlocked
   */
  readonly isScreenUnlocked: boolean
}

/**
 * Schema for `SetIdleOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetIdleOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    isUserActive: Schema.Boolean,
    isScreenUnlocked: Schema.Boolean
  }).annotate({ identifier: "Emulation.SetIdleOverrideParams" })
) as any as Schema.Codec<SetIdleOverrideParams>

/**
 * Overrides default host system locale with the specified one.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetLocaleOverrideParams {
  /**
   * ICU style C locale (e.g. "en_US"). If not specified or empty, disables the override and
   * restores default host system locale.
   */
  readonly locale?: string | undefined
}

/**
 * Schema for `SetLocaleOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetLocaleOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    locale: Schema.optional(Schema.String)
  }).annotate({ identifier: "Emulation.SetLocaleOverrideParams" })
) as any as Schema.Codec<SetLocaleOverrideParams>

/**
 * Sets a specified page scale factor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPageScaleFactorParams {
  /**
   * Page scale factor.
   */
  readonly pageScaleFactor: number
}

/**
 * Schema for `SetPageScaleFactorParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPageScaleFactorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pageScaleFactor: Schema.Number
  }).annotate({ identifier: "Emulation.SetPageScaleFactorParams" })
) as any as Schema.Codec<SetPageScaleFactorParams>

/**
 * Overrides a pressure source of a given type, as used by the Compute
 * Pressure API, so that updates to PressureObserver.observe() are provided
 * via setPressureStateOverride instead of being retrieved from
 * platform-provided telemetry data.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPressureSourceOverrideEnabledParams {
  readonly enabled: boolean
  readonly source: PressureSource
  readonly metadata?: PressureMetadata | undefined
}

/**
 * Schema for `SetPressureSourceOverrideEnabledParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPressureSourceOverrideEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean,
    source: PressureSource,
    metadata: Schema.optional(PressureMetadata)
  }).annotate({ identifier: "Emulation.SetPressureSourceOverrideEnabledParams" })
) as any as Schema.Codec<SetPressureSourceOverrideEnabledParams>

/**
 * Provides a given pressure state that will be processed and eventually be
 * delivered to PressureObserver users. |source| must have been previously
 * overridden by setPressureSourceOverrideEnabled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPressureStateOverrideParams {
  readonly source: PressureSource
  readonly state: PressureState
}

/**
 * Schema for `SetPressureStateOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPressureStateOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    source: PressureSource,
    state: PressureState
  }).annotate({ identifier: "Emulation.SetPressureStateOverrideParams" })
) as any as Schema.Codec<SetPressureStateOverrideParams>

/**
 * Set primary screen. Only supported in headless mode.
 * Note that this changes the coordinate system origin to the top-left
 * of the new primary screen, updating the bounds and work areas
 * of all existing screens accordingly.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPrimaryScreenParams {
  readonly screenId: ScreenId
}

/**
 * Schema for `SetPrimaryScreenParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPrimaryScreenParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    screenId: ScreenId
  }).annotate({ identifier: "Emulation.SetPrimaryScreenParams" })
) as any as Schema.Codec<SetPrimaryScreenParams>

/**
 * Overrides the values for env(safe-area-inset-*) and env(safe-area-max-inset-*). Unset values will cause the
 * respective variables to be undefined, even if previously overridden.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetSafeAreaInsetsOverrideParams {
  readonly insets: SafeAreaInsets
}

/**
 * Schema for `SetSafeAreaInsetsOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetSafeAreaInsetsOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    insets: SafeAreaInsets
  }).annotate({ identifier: "Emulation.SetSafeAreaInsetsOverrideParams" })
) as any as Schema.Codec<SetSafeAreaInsetsOverrideParams>

/**
 * Switches script execution in the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetScriptExecutionDisabledParams {
  /**
   * Whether script execution should be disabled in the page.
   */
  readonly value: boolean
}

/**
 * Schema for `SetScriptExecutionDisabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetScriptExecutionDisabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    value: Schema.Boolean
  }).annotate({ identifier: "Emulation.SetScriptExecutionDisabledParams" })
) as any as Schema.Codec<SetScriptExecutionDisabledParams>

/**
 * `setScrollbarsHidden.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetScrollbarsHiddenParams {
  /**
   * Whether scrollbars should be always hidden.
   */
  readonly hidden: boolean
}

/**
 * Schema for `SetScrollbarsHiddenParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetScrollbarsHiddenParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    hidden: Schema.Boolean
  }).annotate({ identifier: "Emulation.SetScrollbarsHiddenParams" })
) as any as Schema.Codec<SetScrollbarsHiddenParams>

/**
 * Overrides a platform sensor of a given type. If |enabled| is true, calls to
 * Sensor.start() will use a virtual sensor as backend rather than fetching
 * data from a real hardware sensor. Otherwise, existing virtual
 * sensor-backend Sensor objects will fire an error event and new calls to
 * Sensor.start() will attempt to use a real sensor instead.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetSensorOverrideEnabledParams {
  readonly enabled: boolean
  readonly type: SensorType
  readonly metadata?: SensorMetadata | undefined
}

/**
 * Schema for `SetSensorOverrideEnabledParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetSensorOverrideEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean,
    type: SensorType,
    metadata: Schema.optional(SensorMetadata)
  }).annotate({ identifier: "Emulation.SetSensorOverrideEnabledParams" })
) as any as Schema.Codec<SetSensorOverrideEnabledParams>

/**
 * Updates the sensor readings reported by a sensor type previously overridden
 * by setSensorOverrideEnabled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetSensorOverrideReadingsParams {
  readonly type: SensorType
  readonly reading: SensorReading
}

/**
 * Schema for `SetSensorOverrideReadingsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetSensorOverrideReadingsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: SensorType,
    reading: SensorReading
  }).annotate({ identifier: "Emulation.SetSensorOverrideReadingsParams" })
) as any as Schema.Codec<SetSensorOverrideReadingsParams>

/**
 * Allows overriding the difference between the small and large viewport sizes, which determine the
 * value of the `svh` and `lvh` unit, respectively. Only supported for top-level frames.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetSmallViewportHeightDifferenceOverrideParams {
  /**
   * This will cause an element of size 100svh to be `difference` pixels smaller than an element
   * of size 100lvh.
   */
  readonly difference: number
}

/**
 * Schema for `SetSmallViewportHeightDifferenceOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetSmallViewportHeightDifferenceOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    difference: Schema.Int
  }).annotate({ identifier: "Emulation.SetSmallViewportHeightDifferenceOverrideParams" })
) as any as Schema.Codec<SetSmallViewportHeightDifferenceOverrideParams>

/**
 * Overrides default host system timezone with the specified one.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetTimezoneOverrideParams {
  /**
   * The timezone identifier. List of supported timezones:
   * https://source.chromium.org/chromium/chromium/deps/icu.git/+/faee8bc70570192d82d2978a71e2a615788597d1:source/data/misc/metaZones.txt
   * If empty, disables the override and restores default host system timezone.
   */
  readonly timezoneId: string
}

/**
 * Schema for `SetTimezoneOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetTimezoneOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timezoneId: Schema.String
  }).annotate({ identifier: "Emulation.SetTimezoneOverrideParams" })
) as any as Schema.Codec<SetTimezoneOverrideParams>

/**
 * Enables touch on platforms which do not support them.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetTouchEmulationEnabledParams {
  /**
   * Whether the touch event emulation should be enabled.
   */
  readonly enabled: boolean
  /**
   * Maximum touch points supported. Defaults to one.
   */
  readonly maxTouchPoints?: number | undefined
}

/**
 * Schema for `SetTouchEmulationEnabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetTouchEmulationEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean,
    maxTouchPoints: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Emulation.SetTouchEmulationEnabledParams" })
) as any as Schema.Codec<SetTouchEmulationEnabledParams>

/**
 * Allows overriding user agent with the given string.
 * `userAgentMetadata` must be set for Client Hint headers to be sent.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetUserAgentOverrideParams {
  /**
   * User agent to use.
   */
  readonly userAgent: string
  /**
   * Browser language to emulate.
   */
  readonly acceptLanguage?: string | undefined
  /**
   * The platform navigator.platform should return.
   */
  readonly platform?: string | undefined
  /**
   * To be sent in Sec-CH-UA-* headers and returned in navigator.userAgentData
   */
  readonly userAgentMetadata?: UserAgentMetadata | undefined
}

/**
 * Schema for `SetUserAgentOverrideParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetUserAgentOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    userAgent: Schema.String,
    acceptLanguage: Schema.optional(Schema.String),
    platform: Schema.optional(Schema.String),
    userAgentMetadata: Schema.optional(UserAgentMetadata)
  }).annotate({ identifier: "Emulation.SetUserAgentOverrideParams" })
) as any as Schema.Codec<SetUserAgentOverrideParams>

/**
 * Overrides virtual keyboard geometry in CSS pixels, relative to the top-level viewport. The
 * provided rect is used for navigator.virtualKeyboard.boundingRect, geometrychange events, and
 * env(keyboard-inset-*) values on the inspected frame. The override applies independently of
 * navigator.virtualKeyboard.overlaysContent so clients can preview overlay geometry without
 * mutating page state. Values are rounded to the nearest CSS pixel. Omitting the rect clears the
 * override.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetVirtualKeyboardGeometryOverrideParams {
  readonly keyboardRect?: DOM.Rect | undefined
}

/**
 * Schema for `SetVirtualKeyboardGeometryOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetVirtualKeyboardGeometryOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    keyboardRect: Schema.optional(DOM.Rect)
  }).annotate({ identifier: "Emulation.SetVirtualKeyboardGeometryOverrideParams" })
) as any as Schema.Codec<SetVirtualKeyboardGeometryOverrideParams>

/**
 * Turns on virtual time for all frames (replacing real-time with a synthetic time source) and sets
 * the current virtual time policy.  Note this supersedes any previous time budget.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetVirtualTimePolicyParams {
  readonly policy: VirtualTimePolicy
  /**
   * If set, after this many virtual milliseconds have elapsed virtual time will be paused and a
   * virtualTimeBudgetExpired event is sent.
   */
  readonly budget?: number | undefined
  /**
   * If set this specifies the maximum number of tasks that can be run before virtual is forced
   * forwards to prevent deadlock.
   */
  readonly maxVirtualTimeTaskStarvationCount?: number | undefined
  /**
   * If set, base::Time::Now will be overridden to initially return this value.
   */
  readonly initialVirtualTime?: Network.TimeSinceEpoch | undefined
}

/**
 * Schema for `SetVirtualTimePolicyParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetVirtualTimePolicyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    policy: VirtualTimePolicy,
    budget: Schema.optional(Schema.Number),
    maxVirtualTimeTaskStarvationCount: Schema.optional(Schema.Int),
    initialVirtualTime: Schema.optional(Network.TimeSinceEpoch)
  }).annotate({ identifier: "Emulation.SetVirtualTimePolicyParams" })
) as any as Schema.Codec<SetVirtualTimePolicyParams>

/**
 * Turns on virtual time for all frames (replacing real-time with a synthetic time source) and sets
 * the current virtual time policy.  Note this supersedes any previous time budget.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetVirtualTimePolicyResult {
  /**
   * Absolute timestamp at which virtual time was first enabled (up time in milliseconds).
   */
  readonly virtualTimeTicksBase: number
}

/**
 * Schema for `SetVirtualTimePolicyResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetVirtualTimePolicyResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    virtualTimeTicksBase: Schema.Number
  }).annotate({ identifier: "Emulation.SetVirtualTimePolicyResult" })
) as any as Schema.Codec<SetVirtualTimePolicyResult>

/**
 * Updates specified screen parameters. Only supported in headless mode.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UpdateScreenParams {
  /**
   * Target screen identifier.
   */
  readonly screenId: ScreenId
  /**
   * Offset of the left edge of the screen in pixels.
   */
  readonly left?: number | undefined
  /**
   * Offset of the top edge of the screen in pixels.
   */
  readonly top?: number | undefined
  /**
   * The width of the screen in pixels.
   */
  readonly width?: number | undefined
  /**
   * The height of the screen in pixels.
   */
  readonly height?: number | undefined
  /**
   * Specifies the screen's work area.
   */
  readonly workAreaInsets?: WorkAreaInsets | undefined
  /**
   * Specifies the screen's device pixel ratio.
   */
  readonly devicePixelRatio?: number | undefined
  /**
   * Specifies the screen's rotation angle. Available values are 0, 90, 180 and 270.
   */
  readonly rotation?: number | undefined
  /**
   * Specifies the screen's color depth in bits.
   */
  readonly colorDepth?: number | undefined
  /**
   * Specifies the descriptive label for the screen.
   */
  readonly label?: string | undefined
  /**
   * Indicates whether the screen is internal to the device or external, attached to the device. Default is false.
   */
  readonly isInternal?: boolean | undefined
}

/**
 * Schema for `UpdateScreenParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UpdateScreenParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    screenId: ScreenId,
    left: Schema.optional(Schema.Int),
    top: Schema.optional(Schema.Int),
    width: Schema.optional(Schema.Int),
    height: Schema.optional(Schema.Int),
    workAreaInsets: Schema.optional(WorkAreaInsets),
    devicePixelRatio: Schema.optional(Schema.Number),
    rotation: Schema.optional(Schema.Int),
    colorDepth: Schema.optional(Schema.Int),
    label: Schema.optional(Schema.String),
    isInternal: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Emulation.UpdateScreenParams" })
) as any as Schema.Codec<UpdateScreenParams>

/**
 * Updates specified screen parameters. Only supported in headless mode.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UpdateScreenResult {
  readonly screenInfo: ScreenInfo
}

/**
 * Schema for `UpdateScreenResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UpdateScreenResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    screenInfo: ScreenInfo
  }).annotate({ identifier: "Emulation.UpdateScreenResult" })
) as any as Schema.Codec<UpdateScreenResult>

/**
 * Add a new screen to the device. Only supported in headless mode.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const addScreen: Protocol.CommandDef<"Emulation.addScreen", AddScreenParams, AddScreenResult> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.addScreen",
    AddScreenParams,
    AddScreenResult,
    { status: "experimental" }
  )

/**
 * Clears the overridden device metrics.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const clearDeviceMetricsOverride: Protocol.CommandDef<"Emulation.clearDeviceMetricsOverride", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.clearDeviceMetricsOverride",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Clears a device posture override set with either setDeviceMetricsOverride()
 * or setDevicePostureOverride() and starts using posture information from the
 * platform again.
 * Does nothing if no override is set.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clearDevicePostureOverride: Protocol.CommandDef<"Emulation.clearDevicePostureOverride", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.clearDevicePostureOverride",
    undefined,
    undefined,
    { status: "experimental" }
  )

/**
 * Clears the display features override set with either setDeviceMetricsOverride()
 * or setDisplayFeaturesOverride() and starts using display features from the
 * platform again.
 * Does nothing if no override is set.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clearDisplayFeaturesOverride: Protocol.CommandDef<"Emulation.clearDisplayFeaturesOverride", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.clearDisplayFeaturesOverride",
    undefined,
    undefined,
    { status: "experimental" }
  )

/**
 * Clears the overridden Geolocation Position and Error.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const clearGeolocationOverride: Protocol.CommandDef<"Emulation.clearGeolocationOverride", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.clearGeolocationOverride",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Clears Idle state overrides.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const clearIdleOverride: Protocol.CommandDef<"Emulation.clearIdleOverride", void, void> = /*#__PURE__*/ Protocol
  .command(
    "Emulation.clearIdleOverride",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `Emulation.getOverriddenSensorInformation`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getOverriddenSensorInformation: Protocol.CommandDef<
  "Emulation.getOverriddenSensorInformation",
  GetOverriddenSensorInformationParams,
  GetOverriddenSensorInformationResult
> = /*#__PURE__*/ Protocol.command(
  "Emulation.getOverriddenSensorInformation",
  GetOverriddenSensorInformationParams,
  GetOverriddenSensorInformationResult,
  { status: "experimental" }
)

/**
 * Returns device's screen configuration. In headful mode, the physical screens configuration is returned,
 * whereas in headless mode, a virtual headless screen configuration is provided instead.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getScreenInfos: Protocol.CommandDef<"Emulation.getScreenInfos", void, GetScreenInfosResult> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.getScreenInfos",
    undefined,
    GetScreenInfosResult,
    { status: "experimental" }
  )

/**
 * Remove screen from the device. Only supported in headless mode.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const removeScreen: Protocol.CommandDef<"Emulation.removeScreen", RemoveScreenParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.removeScreen",
    RemoveScreenParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Requests that page scale factor is reset to initial values.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const resetPageScaleFactor: Protocol.CommandDef<"Emulation.resetPageScaleFactor", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.resetPageScaleFactor",
    undefined,
    undefined,
    { status: "experimental" }
  )

/**
 * Automatically render all web contents using a dark theme.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setAutoDarkModeOverride: Protocol.CommandDef<
  "Emulation.setAutoDarkModeOverride",
  SetAutoDarkModeOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setAutoDarkModeOverride",
  SetAutoDarkModeOverrideParams,
  undefined,
  { status: "experimental" }
)

/**
 * Allows overriding the automation flag.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setAutomationOverride: Protocol.CommandDef<
  "Emulation.setAutomationOverride",
  SetAutomationOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setAutomationOverride",
  SetAutomationOverrideParams,
  undefined,
  { status: "experimental" }
)

/**
 * Overrides the value of navigator.cpuPerformance
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setCPUPerformanceOverride: Protocol.CommandDef<
  "Emulation.setCPUPerformanceOverride",
  SetCPUPerformanceOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setCPUPerformanceOverride",
  SetCPUPerformanceOverrideParams,
  undefined,
  { status: "experimental" }
)

/**
 * Enables CPU throttling to emulate slow CPUs.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setCPUThrottlingRate: Protocol.CommandDef<
  "Emulation.setCPUThrottlingRate",
  SetCPUThrottlingRateParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setCPUThrottlingRate",
  SetCPUThrottlingRateParams,
  undefined,
  { status: "stable" }
)

/**
 * Override the value of navigator.connection.saveData
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setDataSaverOverride: Protocol.CommandDef<
  "Emulation.setDataSaverOverride",
  SetDataSaverOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setDataSaverOverride",
  SetDataSaverOverrideParams,
  undefined,
  { status: "experimental" }
)

/**
 * Sets or clears an override of the default background color of the frame. This override is used
 * if the content does not specify one.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setDefaultBackgroundColorOverride: Protocol.CommandDef<
  "Emulation.setDefaultBackgroundColorOverride",
  SetDefaultBackgroundColorOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setDefaultBackgroundColorOverride",
  SetDefaultBackgroundColorOverrideParams,
  undefined,
  { status: "stable" }
)

/**
 * Overrides the values of device screen dimensions (window.screen.width, window.screen.height,
 * window.innerWidth, window.innerHeight, and "device-width"/"device-height"-related CSS media
 * query results).
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setDeviceMetricsOverride: Protocol.CommandDef<
  "Emulation.setDeviceMetricsOverride",
  SetDeviceMetricsOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setDeviceMetricsOverride",
  SetDeviceMetricsOverrideParams,
  undefined,
  { status: "stable" }
)

/**
 * Start reporting the given posture value to the Device Posture API.
 * This override can also be set in setDeviceMetricsOverride().
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setDevicePostureOverride: Protocol.CommandDef<
  "Emulation.setDevicePostureOverride",
  SetDevicePostureOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setDevicePostureOverride",
  SetDevicePostureOverrideParams,
  undefined,
  { status: "experimental" }
)

/**
 * Sends `Emulation.setDisabledImageTypes`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setDisabledImageTypes: Protocol.CommandDef<
  "Emulation.setDisabledImageTypes",
  SetDisabledImageTypesParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setDisabledImageTypes",
  SetDisabledImageTypesParams,
  undefined,
  { status: "experimental" }
)

/**
 * Start using the given display features to pupulate the Viewport Segments API.
 * This override can also be set in setDeviceMetricsOverride().
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setDisplayFeaturesOverride: Protocol.CommandDef<
  "Emulation.setDisplayFeaturesOverride",
  SetDisplayFeaturesOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setDisplayFeaturesOverride",
  SetDisplayFeaturesOverrideParams,
  undefined,
  { status: "experimental" }
)

/**
 * Sends `Emulation.setDocumentCookieDisabled`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setDocumentCookieDisabled: Protocol.CommandDef<
  "Emulation.setDocumentCookieDisabled",
  SetDocumentCookieDisabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setDocumentCookieDisabled",
  SetDocumentCookieDisabledParams,
  undefined,
  { status: "experimental" }
)

/**
 * Sends `Emulation.setEmitTouchEventsForMouse`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setEmitTouchEventsForMouse: Protocol.CommandDef<
  "Emulation.setEmitTouchEventsForMouse",
  SetEmitTouchEventsForMouseParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setEmitTouchEventsForMouse",
  SetEmitTouchEventsForMouseParams,
  undefined,
  { status: "experimental" }
)

/**
 * Emulates the given media type or media feature for CSS media queries.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setEmulatedMedia: Protocol.CommandDef<"Emulation.setEmulatedMedia", SetEmulatedMediaParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.setEmulatedMedia",
    SetEmulatedMediaParams,
    undefined,
    { status: "stable" }
  )

/**
 * Emulates the given OS text scale.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setEmulatedOSTextScale: Protocol.CommandDef<
  "Emulation.setEmulatedOSTextScale",
  SetEmulatedOSTextScaleParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setEmulatedOSTextScale",
  SetEmulatedOSTextScaleParams,
  undefined,
  { status: "stable" }
)

/**
 * Emulates the given vision deficiency.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setEmulatedVisionDeficiency: Protocol.CommandDef<
  "Emulation.setEmulatedVisionDeficiency",
  SetEmulatedVisionDeficiencyParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setEmulatedVisionDeficiency",
  SetEmulatedVisionDeficiencyParams,
  undefined,
  { status: "stable" }
)

/**
 * Enables or disables simulating a focused and active page.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setFocusEmulationEnabled: Protocol.CommandDef<
  "Emulation.setFocusEmulationEnabled",
  SetFocusEmulationEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setFocusEmulationEnabled",
  SetFocusEmulationEnabledParams,
  undefined,
  { status: "experimental" }
)

/**
 * Overrides the Geolocation Position or Error. Omitting latitude, longitude or
 * accuracy emulates position unavailable.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setGeolocationOverride: Protocol.CommandDef<
  "Emulation.setGeolocationOverride",
  SetGeolocationOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setGeolocationOverride",
  SetGeolocationOverrideParams,
  undefined,
  { status: "stable" }
)

/**
 * Sends `Emulation.setHardwareConcurrencyOverride`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setHardwareConcurrencyOverride: Protocol.CommandDef<
  "Emulation.setHardwareConcurrencyOverride",
  SetHardwareConcurrencyOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setHardwareConcurrencyOverride",
  SetHardwareConcurrencyOverrideParams,
  undefined,
  { status: "experimental" }
)

/**
 * Overrides the Idle state.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setIdleOverride: Protocol.CommandDef<"Emulation.setIdleOverride", SetIdleOverrideParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.setIdleOverride",
    SetIdleOverrideParams,
    undefined,
    { status: "stable" }
  )

/**
 * Overrides default host system locale with the specified one.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setLocaleOverride: Protocol.CommandDef<"Emulation.setLocaleOverride", SetLocaleOverrideParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.setLocaleOverride",
    SetLocaleOverrideParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Sets a specified page scale factor.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setPageScaleFactor: Protocol.CommandDef<"Emulation.setPageScaleFactor", SetPageScaleFactorParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.setPageScaleFactor",
    SetPageScaleFactorParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Overrides a pressure source of a given type, as used by the Compute
 * Pressure API, so that updates to PressureObserver.observe() are provided
 * via setPressureStateOverride instead of being retrieved from
 * platform-provided telemetry data.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setPressureSourceOverrideEnabled: Protocol.CommandDef<
  "Emulation.setPressureSourceOverrideEnabled",
  SetPressureSourceOverrideEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setPressureSourceOverrideEnabled",
  SetPressureSourceOverrideEnabledParams,
  undefined,
  { status: "experimental" }
)

/**
 * Provides a given pressure state that will be processed and eventually be
 * delivered to PressureObserver users. |source| must have been previously
 * overridden by setPressureSourceOverrideEnabled.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setPressureStateOverride: Protocol.CommandDef<
  "Emulation.setPressureStateOverride",
  SetPressureStateOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setPressureStateOverride",
  SetPressureStateOverrideParams,
  undefined,
  { status: "experimental" }
)

/**
 * Set primary screen. Only supported in headless mode.
 * Note that this changes the coordinate system origin to the top-left
 * of the new primary screen, updating the bounds and work areas
 * of all existing screens accordingly.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setPrimaryScreen: Protocol.CommandDef<"Emulation.setPrimaryScreen", SetPrimaryScreenParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.setPrimaryScreen",
    SetPrimaryScreenParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Overrides the values for env(safe-area-inset-*) and env(safe-area-max-inset-*). Unset values will cause the
 * respective variables to be undefined, even if previously overridden.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setSafeAreaInsetsOverride: Protocol.CommandDef<
  "Emulation.setSafeAreaInsetsOverride",
  SetSafeAreaInsetsOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setSafeAreaInsetsOverride",
  SetSafeAreaInsetsOverrideParams,
  undefined,
  { status: "experimental" }
)

/**
 * Switches script execution in the page.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setScriptExecutionDisabled: Protocol.CommandDef<
  "Emulation.setScriptExecutionDisabled",
  SetScriptExecutionDisabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setScriptExecutionDisabled",
  SetScriptExecutionDisabledParams,
  undefined,
  { status: "stable" }
)

/**
 * Sends `Emulation.setScrollbarsHidden`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setScrollbarsHidden: Protocol.CommandDef<
  "Emulation.setScrollbarsHidden",
  SetScrollbarsHiddenParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setScrollbarsHidden",
  SetScrollbarsHiddenParams,
  undefined,
  { status: "experimental" }
)

/**
 * Overrides a platform sensor of a given type. If |enabled| is true, calls to
 * Sensor.start() will use a virtual sensor as backend rather than fetching
 * data from a real hardware sensor. Otherwise, existing virtual
 * sensor-backend Sensor objects will fire an error event and new calls to
 * Sensor.start() will attempt to use a real sensor instead.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setSensorOverrideEnabled: Protocol.CommandDef<
  "Emulation.setSensorOverrideEnabled",
  SetSensorOverrideEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setSensorOverrideEnabled",
  SetSensorOverrideEnabledParams,
  undefined,
  { status: "experimental" }
)

/**
 * Updates the sensor readings reported by a sensor type previously overridden
 * by setSensorOverrideEnabled.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setSensorOverrideReadings: Protocol.CommandDef<
  "Emulation.setSensorOverrideReadings",
  SetSensorOverrideReadingsParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setSensorOverrideReadings",
  SetSensorOverrideReadingsParams,
  undefined,
  { status: "experimental" }
)

/**
 * Allows overriding the difference between the small and large viewport sizes, which determine the
 * value of the `svh` and `lvh` unit, respectively. Only supported for top-level frames.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setSmallViewportHeightDifferenceOverride: Protocol.CommandDef<
  "Emulation.setSmallViewportHeightDifferenceOverride",
  SetSmallViewportHeightDifferenceOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setSmallViewportHeightDifferenceOverride",
  SetSmallViewportHeightDifferenceOverrideParams,
  undefined,
  { status: "experimental" }
)

/**
 * Overrides default host system timezone with the specified one.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setTimezoneOverride: Protocol.CommandDef<
  "Emulation.setTimezoneOverride",
  SetTimezoneOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setTimezoneOverride",
  SetTimezoneOverrideParams,
  undefined,
  { status: "stable" }
)

/**
 * Enables touch on platforms which do not support them.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setTouchEmulationEnabled: Protocol.CommandDef<
  "Emulation.setTouchEmulationEnabled",
  SetTouchEmulationEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setTouchEmulationEnabled",
  SetTouchEmulationEnabledParams,
  undefined,
  { status: "stable" }
)

/**
 * Allows overriding user agent with the given string.
 * `userAgentMetadata` must be set for Client Hint headers to be sent.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setUserAgentOverride: Protocol.CommandDef<
  "Emulation.setUserAgentOverride",
  SetUserAgentOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setUserAgentOverride",
  SetUserAgentOverrideParams,
  undefined,
  { status: "stable" }
)

/**
 * Overrides virtual keyboard geometry in CSS pixels, relative to the top-level viewport. The
 * provided rect is used for navigator.virtualKeyboard.boundingRect, geometrychange events, and
 * env(keyboard-inset-*) values on the inspected frame. The override applies independently of
 * navigator.virtualKeyboard.overlaysContent so clients can preview overlay geometry without
 * mutating page state. Values are rounded to the nearest CSS pixel. Omitting the rect clears the
 * override.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setVirtualKeyboardGeometryOverride: Protocol.CommandDef<
  "Emulation.setVirtualKeyboardGeometryOverride",
  SetVirtualKeyboardGeometryOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setVirtualKeyboardGeometryOverride",
  SetVirtualKeyboardGeometryOverrideParams,
  undefined,
  { status: "experimental" }
)

/**
 * Turns on virtual time for all frames (replacing real-time with a synthetic time source) and sets
 * the current virtual time policy.  Note this supersedes any previous time budget.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setVirtualTimePolicy: Protocol.CommandDef<
  "Emulation.setVirtualTimePolicy",
  SetVirtualTimePolicyParams,
  SetVirtualTimePolicyResult
> = /*#__PURE__*/ Protocol.command(
  "Emulation.setVirtualTimePolicy",
  SetVirtualTimePolicyParams,
  SetVirtualTimePolicyResult,
  { status: "experimental" }
)

/**
 * Updates specified screen parameters. Only supported in headless mode.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const updateScreen: Protocol.CommandDef<"Emulation.updateScreen", UpdateScreenParams, UpdateScreenResult> =
  /*#__PURE__*/ Protocol.command(
    "Emulation.updateScreen",
    UpdateScreenParams,
    UpdateScreenResult,
    { status: "experimental" }
  )

/**
 * Fired when a page calls screen.orientation.lock() or screen.orientation.unlock()
 * while device emulation is enabled. This allows the DevTools frontend to update the
 * emulated device orientation accordingly.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const screenOrientationLockChanged: Protocol.EventDef<
  "Emulation.screenOrientationLockChanged",
  ScreenOrientationLockChangedParams
> = /*#__PURE__*/ Protocol.event(
  "Emulation.screenOrientationLockChanged",
  ScreenOrientationLockChangedParams,
  { status: "experimental" }
)

/**
 * Notification sent after the virtual time budget for the current VirtualTimePolicy has run out.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const virtualTimeBudgetExpired: Protocol.EventDef<"Emulation.virtualTimeBudgetExpired", void> =
  /*#__PURE__*/ Protocol.event(
    "Emulation.virtualTimeBudgetExpired",
    undefined,
    { status: "experimental" }
  )
