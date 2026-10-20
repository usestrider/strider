/**
 * The Inspector domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Fired when remote debugging connection is about to be terminated. Contains detach reason.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DetachedParams {
  /**
   * The reason why connection has been terminated.
   */
  readonly reason: string
}

/**
 * Schema for `DetachedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DetachedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    reason: Schema.String
  }).annotate({ identifier: "Inspector.DetachedParams" })
) as any as Schema.Codec<DetachedParams>

/**
 * Disables inspector domain notifications.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Inspector.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Inspector.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables inspector domain notifications.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Inspector.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Inspector.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Fired when remote debugging connection is about to be terminated. Contains detach reason.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const detached: Protocol.EventDef<"Inspector.detached", DetachedParams> = /*#__PURE__*/ Protocol.event(
  "Inspector.detached",
  DetachedParams,
  { status: "stable" }
)

/**
 * Fired when debugging target has crashed
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const targetCrashed: Protocol.EventDef<"Inspector.targetCrashed", void> = /*#__PURE__*/ Protocol.event(
  "Inspector.targetCrashed",
  undefined,
  { status: "stable" }
)

/**
 * Fired when debugging target has reloaded after crash
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const targetReloadedAfterCrash: Protocol.EventDef<"Inspector.targetReloadedAfterCrash", void> =
  /*#__PURE__*/ Protocol.event(
    "Inspector.targetReloadedAfterCrash",
    undefined,
    { status: "stable" }
  )

/**
 * Fired on worker targets when main worker script and any imported scripts have been evaluated.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const workerScriptLoaded: Protocol.EventDef<"Inspector.workerScriptLoaded", void> = /*#__PURE__*/ Protocol.event(
  "Inspector.workerScriptLoaded",
  undefined,
  { status: "experimental" }
)
