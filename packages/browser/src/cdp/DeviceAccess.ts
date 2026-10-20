/**
 * The DeviceAccess domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * A device id.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type DeviceId = Brand.Branded<string, "~@usestrider/browser/cdp/DeviceAccess/DeviceId">

/**
 * Schema for `DeviceId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/DeviceAccess/DeviceId")
) as any as Schema.Codec<DeviceId>

/**
 * Device information displayed in a user prompt to select a device.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PromptDevice {
  readonly id: DeviceId
  /**
   * Display name as it appears in a device request user prompt.
   */
  readonly name: string
}

/**
 * Schema for `PromptDevice`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PromptDevice = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: DeviceId,
    name: Schema.String
  }).annotate({ identifier: "DeviceAccess.PromptDevice" })
) as any as Schema.Codec<PromptDevice>

/**
 * Device request id.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type RequestId = Brand.Branded<string, "~@usestrider/browser/cdp/DeviceAccess/RequestId">

/**
 * Schema for `RequestId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RequestId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/DeviceAccess/RequestId")
) as any as Schema.Codec<RequestId>

/**
 * Cancel a prompt in response to a DeviceAccess.deviceRequestPrompted event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CancelPromptParams {
  readonly id: RequestId
}

/**
 * Schema for `CancelPromptParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CancelPromptParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: RequestId
  }).annotate({ identifier: "DeviceAccess.CancelPromptParams" })
) as any as Schema.Codec<CancelPromptParams>

/**
 * A device request opened a user prompt to select a device. Respond with the
 * selectPrompt or cancelPrompt command.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeviceRequestPromptedParams {
  readonly id: RequestId
  readonly devices: ReadonlyArray<PromptDevice>
}

/**
 * Schema for `DeviceRequestPromptedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeviceRequestPromptedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: RequestId,
    devices: Schema.Array(PromptDevice)
  }).annotate({ identifier: "DeviceAccess.DeviceRequestPromptedParams" })
) as any as Schema.Codec<DeviceRequestPromptedParams>

/**
 * Select a device in response to a DeviceAccess.deviceRequestPrompted event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SelectPromptParams {
  readonly id: RequestId
  readonly deviceId: DeviceId
}

/**
 * Schema for `SelectPromptParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SelectPromptParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: RequestId,
    deviceId: DeviceId
  }).annotate({ identifier: "DeviceAccess.SelectPromptParams" })
) as any as Schema.Codec<SelectPromptParams>

/**
 * Cancel a prompt in response to a DeviceAccess.deviceRequestPrompted event.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const cancelPrompt: Protocol.CommandDef<"DeviceAccess.cancelPrompt", CancelPromptParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DeviceAccess.cancelPrompt",
    CancelPromptParams,
    undefined,
    { status: "stable" }
  )

/**
 * Disable events in this domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"DeviceAccess.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "DeviceAccess.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enable events in this domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"DeviceAccess.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "DeviceAccess.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Select a device in response to a DeviceAccess.deviceRequestPrompted event.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const selectPrompt: Protocol.CommandDef<"DeviceAccess.selectPrompt", SelectPromptParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DeviceAccess.selectPrompt",
    SelectPromptParams,
    undefined,
    { status: "stable" }
  )

/**
 * A device request opened a user prompt to select a device. Respond with the
 * selectPrompt or cancelPrompt command.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const deviceRequestPrompted: Protocol.EventDef<
  "DeviceAccess.deviceRequestPrompted",
  DeviceRequestPromptedParams
> = /*#__PURE__*/ Protocol.event(
  "DeviceAccess.deviceRequestPrompted",
  DeviceRequestPromptedParams,
  { status: "stable" }
)
