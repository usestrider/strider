/**
 * This domain allows interacting with the Digital Credentials API for automation.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Page from "./Page.ts"

/**
 * The type of virtual wallet action.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type VirtualWalletAction =
  | "respond"
  | "decline"
  | "wait"
  | "clear"
  | (string & {})

/**
 * Schema for `VirtualWalletAction`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const VirtualWalletAction = Schema.String as any as Schema.Codec<VirtualWalletAction>

/**
 * Sets the behavior of the virtual wallet for digital credential requests
 * issued from this frame.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetVirtualWalletBehaviorParams {
  /**
   * The action of the virtual wallet.
   */
  readonly action: VirtualWalletAction
  /**
   * The protocol identifier (e.g. "openid4vp"). Required when |action| is
   * "respond", forbidden otherwise.
   */
  readonly protocol?: string | undefined
  /**
   * The response data object returned by the wallet.
   * Required when |action| is "respond", forbidden otherwise.
   */
  readonly response?: { readonly [key: string]: unknown } | undefined
  /**
   * The frame to scope the virtual wallet behavior to.
   */
  readonly frameId?: Page.FrameId | undefined
}

/**
 * Schema for `SetVirtualWalletBehaviorParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetVirtualWalletBehaviorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    action: VirtualWalletAction,
    protocol: Schema.optional(Schema.String),
    response: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    frameId: Schema.optional(Page.FrameId)
  }).annotate({ identifier: "DigitalCredentials.SetVirtualWalletBehaviorParams" })
) as any as Schema.Codec<SetVirtualWalletBehaviorParams>

/**
 * Sets the behavior of the virtual wallet for digital credential requests
 * issued from this frame.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setVirtualWalletBehavior: Protocol.CommandDef<
  "DigitalCredentials.setVirtualWalletBehavior",
  SetVirtualWalletBehaviorParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DigitalCredentials.setVirtualWalletBehavior",
  SetVirtualWalletBehaviorParams,
  undefined,
  { status: "stable" }
)
