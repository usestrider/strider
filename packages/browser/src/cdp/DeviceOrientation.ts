/**
 * The DeviceOrientation domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Overrides the Device Orientation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetDeviceOrientationOverrideParams {
  /**
   * Mock alpha
   */
  readonly alpha: number
  /**
   * Mock beta
   */
  readonly beta: number
  /**
   * Mock gamma
   */
  readonly gamma: number
}

/**
 * Schema for `SetDeviceOrientationOverrideParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetDeviceOrientationOverrideParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    alpha: Schema.Number,
    beta: Schema.Number,
    gamma: Schema.Number
  }).annotate({ identifier: "DeviceOrientation.SetDeviceOrientationOverrideParams" })
) as any as Schema.Codec<SetDeviceOrientationOverrideParams>

/**
 * Clears the overridden Device Orientation.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clearDeviceOrientationOverride: Protocol.CommandDef<
  "DeviceOrientation.clearDeviceOrientationOverride",
  void,
  void
> = /*#__PURE__*/ Protocol.command(
  "DeviceOrientation.clearDeviceOrientationOverride",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Overrides the Device Orientation.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setDeviceOrientationOverride: Protocol.CommandDef<
  "DeviceOrientation.setDeviceOrientationOverride",
  SetDeviceOrientationOverrideParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DeviceOrientation.setDeviceOrientationOverride",
  SetDeviceOrientationOverrideParams,
  undefined,
  { status: "stable" }
)
