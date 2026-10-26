/**
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-stock`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Parses and evaluates the given test string and sends back the result. Returned values are saved to the "audit" object group. Call setup before and teardown after if the `WebInspectorAudit` object should be passed into the test.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RunParams {
  /**
   * Test string to parse and evaluate.
   */
  readonly test: string
  /**
   * Specifies in which isolated context to run the test. Each content script lives in an isolated context and this parameter may be used to specify one of those contexts. If the parameter is omitted or 0 the evaluation will be performed in the context of the inspected page.
   */
  readonly contextId?: Runtime.ExecutionContextId | undefined
}

/**
 * Schema for `RunParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RunParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    test: Schema.String,
    contextId: Schema.optional(Runtime.ExecutionContextId)
  }).annotate({ identifier: "Audit.RunParams" })
) as any as Schema.Codec<RunParams>

/**
 * Parses and evaluates the given test string and sends back the result. Returned values are saved to the "audit" object group. Call setup before and teardown after if the `WebInspectorAudit` object should be passed into the test.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RunResult {
  /**
   * Evaluation result.
   */
  readonly result: Runtime.RemoteObject
  /**
   * True if the result was thrown during the evaluation.
   */
  readonly wasThrown?: boolean | undefined
}

/**
 * Schema for `RunResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RunResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Runtime.RemoteObject,
    wasThrown: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Audit.RunResult" })
) as any as Schema.Codec<RunResult>

/**
 * Creates the `WebInspectorAudit` object that is passed to run. Must call teardown before calling setup more than once.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetupParams {
  /**
   * Specifies in which isolated context to run the test. Each content script lives in an isolated context and this parameter may be used to specify one of those contexts. If the parameter is omitted or 0 the evaluation will be performed in the context of the inspected page.
   */
  readonly contextId?: Runtime.ExecutionContextId | undefined
}

/**
 * Schema for `SetupParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetupParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contextId: Schema.optional(Runtime.ExecutionContextId)
  }).annotate({ identifier: "Audit.SetupParams" })
) as any as Schema.Codec<SetupParams>

/**
 * Parses and evaluates the given test string and sends back the result. Returned values are saved to the "audit" object group. Call setup before and teardown after if the `WebInspectorAudit` object should be passed into the test.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const run: Protocol.CommandDef<"Audit.run", RunParams, RunResult> = /*#__PURE__*/ Protocol.command(
  "Audit.run",
  RunParams,
  RunResult,
  { status: "stable" }
)

/**
 * Creates the `WebInspectorAudit` object that is passed to run. Must call teardown before calling setup more than once.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setup: Protocol.CommandDef<"Audit.setup", SetupParams, void> = /*#__PURE__*/ Protocol.command(
  "Audit.setup",
  SetupParams,
  undefined,
  { status: "stable" }
)

/**
 * Destroys the `WebInspectorAudit` object that is passed to run. Must call setup before calling teardown.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const teardown: Protocol.CommandDef<"Audit.teardown", void, void> = /*#__PURE__*/ Protocol.command(
  "Audit.teardown",
  undefined,
  undefined,
  { status: "stable" }
)
