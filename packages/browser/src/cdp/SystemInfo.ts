/**
 * The SystemInfo domain defines methods and events for querying low-level system information.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Describes a single graphics processor (GPU).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GPUDevice {
  /**
   * PCI ID of the GPU vendor, if available; 0 otherwise.
   */
  readonly vendorId: number
  /**
   * PCI ID of the GPU device, if available; 0 otherwise.
   */
  readonly deviceId: number
  /**
   * Sub sys ID of the GPU, only available on Windows.
   */
  readonly subSysId?: number | undefined
  /**
   * Revision of the GPU, only available on Windows.
   */
  readonly revision?: number | undefined
  /**
   * String description of the GPU vendor, if the PCI ID is not available.
   */
  readonly vendorString: string
  /**
   * String description of the GPU device, if the PCI ID is not available.
   */
  readonly deviceString: string
  /**
   * String description of the GPU driver vendor.
   */
  readonly driverVendor: string
  /**
   * String description of the GPU driver version.
   */
  readonly driverVersion: string
}

/**
 * Schema for `GPUDevice`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GPUDevice = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    vendorId: Schema.Number,
    deviceId: Schema.Number,
    subSysId: Schema.optional(Schema.Number),
    revision: Schema.optional(Schema.Number),
    vendorString: Schema.String,
    deviceString: Schema.String,
    driverVendor: Schema.String,
    driverVersion: Schema.String
  }).annotate({ identifier: "SystemInfo.GPUDevice" })
) as any as Schema.Codec<GPUDevice>

/**
 * Provides information about the GPU(s) on the system.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GPUInfo {
  /**
   * The graphics devices on the system. Element 0 is the primary GPU.
   */
  readonly devices: ReadonlyArray<GPUDevice>
  /**
   * An optional dictionary of additional GPU related attributes.
   */
  readonly auxAttributes?: { readonly [key: string]: unknown } | undefined
  /**
   * An optional dictionary of graphics features and their status.
   */
  readonly featureStatus?: { readonly [key: string]: unknown } | undefined
  /**
   * An optional array of GPU driver bug workarounds.
   */
  readonly driverBugWorkarounds: ReadonlyArray<string>
  /**
   * Supported accelerated video decoding capabilities.
   */
  readonly videoDecoding: ReadonlyArray<VideoDecodeAcceleratorCapability>
  /**
   * Supported accelerated video encoding capabilities.
   */
  readonly videoEncoding: ReadonlyArray<VideoEncodeAcceleratorCapability>
}

/**
 * Schema for `GPUInfo`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GPUInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    devices: Schema.Array(GPUDevice),
    auxAttributes: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    featureStatus: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    driverBugWorkarounds: Schema.Array(Schema.String),
    videoDecoding: Schema.Array(VideoDecodeAcceleratorCapability),
    videoEncoding: Schema.Array(VideoEncodeAcceleratorCapability)
  }).annotate({ identifier: "SystemInfo.GPUInfo" })
) as any as Schema.Codec<GPUInfo>

/**
 * Image format of a given image.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ImageType =
  | "jpeg"
  | "webp"
  | "unknown"
  | (string & {})

/**
 * Schema for `ImageType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ImageType = Schema.String as any as Schema.Codec<ImageType>

/**
 * Represents process info.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ProcessInfo {
  /**
   * Specifies process type.
   */
  readonly type: string
  /**
   * Specifies process id.
   */
  readonly id: number
  /**
   * Specifies cumulative CPU usage in seconds across all threads of the
   * process since the process start.
   */
  readonly cpuTime: number
}

/**
 * Schema for `ProcessInfo`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ProcessInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.String,
    id: Schema.Int,
    cpuTime: Schema.Number
  }).annotate({ identifier: "SystemInfo.ProcessInfo" })
) as any as Schema.Codec<ProcessInfo>

/**
 * Describes the width and height dimensions of an entity.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Size {
  /**
   * Width in pixels.
   */
  readonly width: number
  /**
   * Height in pixels.
   */
  readonly height: number
}

/**
 * Schema for `Size`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Size = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    width: Schema.Int,
    height: Schema.Int
  }).annotate({ identifier: "SystemInfo.Size" })
) as any as Schema.Codec<Size>

/**
 * YUV subsampling type of the pixels of a given image.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SubsamplingFormat =
  | "yuv420"
  | "yuv422"
  | "yuv444"
  | (string & {})

/**
 * Schema for `SubsamplingFormat`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SubsamplingFormat = Schema.String as any as Schema.Codec<SubsamplingFormat>

/**
 * Describes a supported video decoding profile with its associated minimum and
 * maximum resolutions.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface VideoDecodeAcceleratorCapability {
  /**
   * Video codec profile that is supported, e.g. VP9 Profile 2.
   */
  readonly profile: string
  /**
   * Maximum video dimensions in pixels supported for this |profile|.
   */
  readonly maxResolution: Size
  /**
   * Minimum video dimensions in pixels supported for this |profile|.
   */
  readonly minResolution: Size
}

/**
 * Schema for `VideoDecodeAcceleratorCapability`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const VideoDecodeAcceleratorCapability = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    profile: Schema.String,
    maxResolution: Size,
    minResolution: Size
  }).annotate({ identifier: "SystemInfo.VideoDecodeAcceleratorCapability" })
) as any as Schema.Codec<VideoDecodeAcceleratorCapability>

/**
 * Describes a supported video encoding profile with its associated maximum
 * resolution and maximum framerate.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface VideoEncodeAcceleratorCapability {
  /**
   * Video codec profile that is supported, e.g H264 Main.
   */
  readonly profile: string
  /**
   * Maximum video dimensions in pixels supported for this |profile|.
   */
  readonly maxResolution: Size
  /**
   * Maximum encoding framerate in frames per second supported for this
   * |profile|, as fraction's numerator and denominator, e.g. 24/1 fps,
   * 24000/1001 fps, etc.
   */
  readonly maxFramerateNumerator: number
  readonly maxFramerateDenominator: number
}

/**
 * Schema for `VideoEncodeAcceleratorCapability`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const VideoEncodeAcceleratorCapability = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    profile: Schema.String,
    maxResolution: Size,
    maxFramerateNumerator: Schema.Int,
    maxFramerateDenominator: Schema.Int
  }).annotate({ identifier: "SystemInfo.VideoEncodeAcceleratorCapability" })
) as any as Schema.Codec<VideoEncodeAcceleratorCapability>

/**
 * Returns information about the feature state.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetFeatureStateParams {
  readonly featureState: string
}

/**
 * Schema for `GetFeatureStateParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetFeatureStateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    featureState: Schema.String
  }).annotate({ identifier: "SystemInfo.GetFeatureStateParams" })
) as any as Schema.Codec<GetFeatureStateParams>

/**
 * Returns information about the feature state.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetFeatureStateResult {
  readonly featureEnabled: boolean
}

/**
 * Schema for `GetFeatureStateResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetFeatureStateResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    featureEnabled: Schema.Boolean
  }).annotate({ identifier: "SystemInfo.GetFeatureStateResult" })
) as any as Schema.Codec<GetFeatureStateResult>

/**
 * Returns information about the system.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetInfoResult {
  /**
   * Information about the GPUs on the system.
   */
  readonly gpu: GPUInfo
  /**
   * A platform-dependent description of the model of the machine. On Mac OS, this is, for
   * example, 'MacBookPro'. Will be the empty string if not supported.
   */
  readonly modelName: string
  /**
   * A platform-dependent description of the version of the machine. On Mac OS, this is, for
   * example, '10.1'. Will be the empty string if not supported.
   */
  readonly modelVersion: string
  /**
   * The command line string used to launch the browser. Will be the empty string if not
   * supported.
   */
  readonly commandLine: string
}

/**
 * Schema for `GetInfoResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetInfoResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    gpu: GPUInfo,
    modelName: Schema.String,
    modelVersion: Schema.String,
    commandLine: Schema.String
  }).annotate({ identifier: "SystemInfo.GetInfoResult" })
) as any as Schema.Codec<GetInfoResult>

/**
 * Returns information about all running processes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetProcessInfoResult {
  /**
   * An array of process info blocks.
   */
  readonly processInfo: ReadonlyArray<ProcessInfo>
}

/**
 * Schema for `GetProcessInfoResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetProcessInfoResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    processInfo: Schema.Array(ProcessInfo)
  }).annotate({ identifier: "SystemInfo.GetProcessInfoResult" })
) as any as Schema.Codec<GetProcessInfoResult>

/**
 * Returns information about the feature state.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getFeatureState: Protocol.CommandDef<
  "SystemInfo.getFeatureState",
  GetFeatureStateParams,
  GetFeatureStateResult
> = /*#__PURE__*/ Protocol.command(
  "SystemInfo.getFeatureState",
  GetFeatureStateParams,
  GetFeatureStateResult,
  { status: "stable", session: "browser" }
)

/**
 * Returns information about the system.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getInfo: Protocol.CommandDef<"SystemInfo.getInfo", void, GetInfoResult> = /*#__PURE__*/ Protocol.command(
  "SystemInfo.getInfo",
  undefined,
  GetInfoResult,
  { status: "stable", session: "browser" }
)

/**
 * Returns information about all running processes.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getProcessInfo: Protocol.CommandDef<"SystemInfo.getProcessInfo", void, GetProcessInfoResult> =
  /*#__PURE__*/ Protocol.command(
    "SystemInfo.getProcessInfo",
    undefined,
    GetProcessInfoResult,
    { status: "stable", session: "browser" }
  )
