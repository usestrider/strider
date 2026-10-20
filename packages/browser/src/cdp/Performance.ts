/**
 * The Performance domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Run-time execution metric.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Metric {
  /**
   * Metric name.
   */
  readonly name: string
  /**
   * Metric value.
   */
  readonly value: number
}

/**
 * Schema for `Metric`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Metric = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.Number
  }).annotate({ identifier: "Performance.Metric" })
) as any as Schema.Codec<Metric>

/**
 * Enable collecting and reporting metrics.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EnableParams {
  /**
   * Time domain to use for collecting and reporting duration metrics.
   */
  readonly timeDomain?: EnableParamsTimeDomain | undefined
}

/**
 * Schema for `EnableParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EnableParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timeDomain: Schema.optional(EnableParamsTimeDomain)
  }).annotate({ identifier: "Performance.EnableParams" })
) as any as Schema.Codec<EnableParams>

/**
 * Time domain to use for collecting and reporting duration metrics.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type EnableParamsTimeDomain =
  | "timeTicks"
  | "threadTicks"
  | (string & {})

/**
 * Schema for `EnableParamsTimeDomain`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EnableParamsTimeDomain = Schema.String as any as Schema.Codec<EnableParamsTimeDomain>

/**
 * Retrieve current values of run-time metrics.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetMetricsResult {
  /**
   * Current values for run-time metrics.
   */
  readonly metrics: ReadonlyArray<Metric>
}

/**
 * Schema for `GetMetricsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetMetricsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    metrics: Schema.Array(Metric)
  }).annotate({ identifier: "Performance.GetMetricsResult" })
) as any as Schema.Codec<GetMetricsResult>

/**
 * Current values of the metrics.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MetricsParams {
  /**
   * Current values of the metrics.
   */
  readonly metrics: ReadonlyArray<Metric>
  /**
   * Timestamp title.
   */
  readonly title: string
}

/**
 * Schema for `MetricsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MetricsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    metrics: Schema.Array(Metric),
    title: Schema.String
  }).annotate({ identifier: "Performance.MetricsParams" })
) as any as Schema.Codec<MetricsParams>

/**
 * Disable collecting and reporting metrics.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Performance.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Performance.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enable collecting and reporting metrics.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Performance.enable", EnableParams, void> = /*#__PURE__*/ Protocol.command(
  "Performance.enable",
  EnableParams,
  undefined,
  { status: "stable" }
)

/**
 * Retrieve current values of run-time metrics.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getMetrics: Protocol.CommandDef<"Performance.getMetrics", void, GetMetricsResult> = /*#__PURE__*/ Protocol
  .command(
    "Performance.getMetrics",
    undefined,
    GetMetricsResult,
    { status: "stable" }
  )

/**
 * Current values of the metrics.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const metrics: Protocol.EventDef<"Performance.metrics", MetricsParams> = /*#__PURE__*/ Protocol.event(
  "Performance.metrics",
  MetricsParams,
  { status: "stable" }
)
