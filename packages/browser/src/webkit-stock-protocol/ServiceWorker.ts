/**
 * Actions and events related to the inspected service worker.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-stock`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * ServiceWorker metadata and initial state.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Configuration {
  readonly targetId: string
  readonly securityOrigin: string
  /**
   * ServiceWorker main script URL.
   */
  readonly url: string
  /**
   * ServiceWorker main script content.
   */
  readonly content: string
}

/**
 * Schema for `Configuration`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Configuration = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: Schema.String,
    securityOrigin: Schema.String,
    url: Schema.String,
    content: Schema.String
  }).annotate({ identifier: "ServiceWorker.Configuration" })
) as any as Schema.Codec<Configuration>

/**
 * Returns the initialization information for this target.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetInitializationInfoResult {
  readonly info: Configuration
}

/**
 * Schema for `GetInitializationInfoResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetInitializationInfoResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    info: Configuration
  }).annotate({ identifier: "ServiceWorker.GetInitializationInfoResult" })
) as any as Schema.Codec<GetInitializationInfoResult>

/**
 * Returns the initialization information for this target.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getInitializationInfo: Protocol.CommandDef<
  "ServiceWorker.getInitializationInfo",
  void,
  GetInitializationInfoResult
> = /*#__PURE__*/ Protocol.command(
  "ServiceWorker.getInitializationInfo",
  undefined,
  GetInitializationInfoResult,
  { status: "stable" }
)
