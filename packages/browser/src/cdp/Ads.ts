/**
 * A domain for ad-related metrics and data.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Network from "./Network.ts"
import * as Page from "./Page.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Ad frame data.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AdFrameData {
  /**
   * The DevTools frame token.
   */
  readonly frameId: Page.FrameId
  /**
   * The initial origin of the frame. To minimize the payload size, this is
   * only sent once per frame.
   */
  readonly initialOrigin?: string | undefined
  /**
   * The network bytes of the frame.
   */
  readonly networkBytes: number
  /**
   * The CPU time of the frame, in milliseconds.
   */
  readonly cpuTime: number
}

/**
 * Schema for `AdFrameData`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AdFrameData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Page.FrameId,
    initialOrigin: Schema.optional(Schema.String),
    networkBytes: Schema.Number,
    cpuTime: Schema.Number
  }).annotate({ identifier: "Ads.AdFrameData" })
) as any as Schema.Codec<AdFrameData>

/**
 * Ad metrics for a page.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AdMetrics {
  /**
   * The viewport ad density by area, represented as a percentage (an integer
   * between 0 and 100).
   */
  readonly viewportAdDensityByArea: number
  /**
   * The time-weighted average of the viewport ad density by area, measured
   * across the duration of the page.
   */
  readonly averageViewportAdDensityByArea: number
  /**
   * The number of ads currently visible within the viewport.
   */
  readonly viewportAdCount: number
  /**
   * The time-weighted average of the viewport ad count, measured across the
   * duration of the page.
   */
  readonly averageViewportAdCount: number
  /**
   * The total ad CPU usage, in milliseconds.
   */
  readonly totalAdCpuTime: number
  /**
   * The total ad network bytes.
   */
  readonly totalAdNetworkBytes: number
  /**
   * The list of ad frames that have been updated since the last event.
   */
  readonly updateAdFrames: ReadonlyArray<AdFrameData>
  /**
   * The list of ad frame IDs that have been removed since the last event.
   */
  readonly removeAdFrames: ReadonlyArray<Page.FrameId>
}

/**
 * Schema for `AdMetrics`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AdMetrics = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    viewportAdDensityByArea: Schema.Int,
    averageViewportAdDensityByArea: Schema.Number,
    viewportAdCount: Schema.Int,
    averageViewportAdCount: Schema.Number,
    totalAdCpuTime: Schema.Number,
    totalAdNetworkBytes: Schema.Number,
    updateAdFrames: Schema.Array(AdFrameData),
    removeAdFrames: Schema.Array(Page.FrameId)
  }).annotate({ identifier: "Ads.AdMetrics" })
) as any as Schema.Codec<AdMetrics>

/**
 * An ad script.
 * Note: when the script is a transitive ad script, we only fill in the
 * immediate ancestor script in the provenance's adScriptAncestry field (as its
 * first entry), rather than filling in the full ancestry. This saves work for
 * the backend, and the frontend can reconstruct the full ancestry if
 * necessary.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AdScript {
  /**
   * The script ID.
   */
  readonly scriptId: Runtime.ScriptId
  /**
   * The ad provenance.
   */
  readonly provenance: Network.AdProvenance
}

/**
 * Schema for `AdScript`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AdScript = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: Runtime.ScriptId,
    provenance: Network.AdProvenance
  }).annotate({ identifier: "Ads.AdScript" })
) as any as Schema.Codec<AdScript>

/**
 * Retrieves ad metrics for the current page.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAdMetricsResult {
  readonly metrics: AdMetrics
}

/**
 * Schema for `GetAdMetricsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAdMetricsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    metrics: AdMetrics
  }).annotate({ identifier: "Ads.GetAdMetricsResult" })
) as any as Schema.Codec<GetAdMetricsResult>

/**
 * Retrieves ad scripts for the current page. To minimize payload size, this
 * only returns the newly tracked ad scripts since the last call to
 * getAdScripts (i.e., the delta).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAdScriptsResult {
  readonly newScripts: ReadonlyArray<AdScript>
}

/**
 * Schema for `GetAdScriptsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAdScriptsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    newScripts: Schema.Array(AdScript)
  }).annotate({ identifier: "Ads.GetAdScriptsResult" })
) as any as Schema.Codec<GetAdScriptsResult>

/**
 * Retrieves ad metrics for the current page.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getAdMetrics: Protocol.CommandDef<"Ads.getAdMetrics", void, GetAdMetricsResult> = /*#__PURE__*/ Protocol
  .command(
    "Ads.getAdMetrics",
    undefined,
    GetAdMetricsResult,
    { status: "stable" }
  )

/**
 * Retrieves ad scripts for the current page. To minimize payload size, this
 * only returns the newly tracked ad scripts since the last call to
 * getAdScripts (i.e., the delta).
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getAdScripts: Protocol.CommandDef<"Ads.getAdScripts", void, GetAdScriptsResult> = /*#__PURE__*/ Protocol
  .command(
    "Ads.getAdScripts",
    undefined,
    GetAdScriptsResult,
    { status: "stable" }
  )
