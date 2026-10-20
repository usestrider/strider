/**
 * The Tethering domain defines methods and events for browser port binding.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Informs that port was successfully bound and got a specified connection id.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AcceptedParams {
  /**
   * Port number that was successfully bound.
   */
  readonly port: number
  /**
   * Connection id to be used.
   */
  readonly connectionId: string
}

/**
 * Schema for `AcceptedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AcceptedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    port: Schema.Int,
    connectionId: Schema.String
  }).annotate({ identifier: "Tethering.AcceptedParams" })
) as any as Schema.Codec<AcceptedParams>

/**
 * Request browser port binding.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BindParams {
  /**
   * Port number to bind.
   */
  readonly port: number
}

/**
 * Schema for `BindParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BindParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    port: Schema.Int
  }).annotate({ identifier: "Tethering.BindParams" })
) as any as Schema.Codec<BindParams>

/**
 * Request browser port unbinding.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UnbindParams {
  /**
   * Port number to unbind.
   */
  readonly port: number
}

/**
 * Schema for `UnbindParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UnbindParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    port: Schema.Int
  }).annotate({ identifier: "Tethering.UnbindParams" })
) as any as Schema.Codec<UnbindParams>

/**
 * Request browser port binding.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const bind: Protocol.CommandDef<"Tethering.bind", BindParams, void> = /*#__PURE__*/ Protocol.command(
  "Tethering.bind",
  BindParams,
  undefined,
  { status: "stable" }
)

/**
 * Request browser port unbinding.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const unbind: Protocol.CommandDef<"Tethering.unbind", UnbindParams, void> = /*#__PURE__*/ Protocol.command(
  "Tethering.unbind",
  UnbindParams,
  undefined,
  { status: "stable" }
)

/**
 * Informs that port was successfully bound and got a specified connection id.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const accepted: Protocol.EventDef<"Tethering.accepted", AcceptedParams> = /*#__PURE__*/ Protocol.event(
  "Tethering.accepted",
  AcceptedParams,
  { status: "stable" }
)
