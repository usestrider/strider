/**
 * The Inspector domain.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-stock`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Runtime from "./Runtime.ts"

/**
 * `evaluateForTestInFrontend.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EvaluateForTestInFrontendParams {
  readonly script: string
}

/**
 * Schema for `EvaluateForTestInFrontendParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluateForTestInFrontendParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    script: Schema.String
  }).annotate({ identifier: "Inspector.EvaluateForTestInFrontendParams" })
) as any as Schema.Codec<EvaluateForTestInFrontendParams>

/**
 * `inspect.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InspectParams {
  readonly object: Runtime.RemoteObject
  readonly hints: { readonly [key: string]: unknown }
}

/**
 * Schema for `InspectParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InspectParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    object: Runtime.RemoteObject,
    hints: Schema.Record(Schema.String, Schema.Unknown)
  }).annotate({ identifier: "Inspector.InspectParams" })
) as any as Schema.Codec<InspectParams, unknown>

/**
 * Disables inspector domain notifications.
 *
 * @stability unstable
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
 * @stability unstable
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
 * Sent by the frontend after all initialization messages have been sent.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const initialized: Protocol.CommandDef<"Inspector.initialized", void, void> = /*#__PURE__*/ Protocol.command(
  "Inspector.initialized",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * The `Inspector.evaluateForTestInFrontend` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const evaluateForTestInFrontend: Protocol.EventDef<
  "Inspector.evaluateForTestInFrontend",
  EvaluateForTestInFrontendParams
> = /*#__PURE__*/ Protocol.event(
  "Inspector.evaluateForTestInFrontend",
  EvaluateForTestInFrontendParams,
  { status: "stable" }
)

/**
 * The `Inspector.inspect` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const inspect: Protocol.EventDef<"Inspector.inspect", InspectParams> = /*#__PURE__*/ Protocol.event(
  "Inspector.inspect",
  InspectParams,
  { status: "stable" }
)
