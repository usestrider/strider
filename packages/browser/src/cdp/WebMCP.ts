/**
 * The WebMCP domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as Page from "./Page.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Tool annotations
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Annotation {
  /**
   * A hint indicating that the tool does not modify any state.
   */
  readonly readOnly?: boolean | undefined
  /**
   * A hint indicating that the tool output may contain untrusted content, ex: UGC, 3rd party data.
   */
  readonly untrustedContent?: boolean | undefined
  /**
   * A hint indicating that executing the tool will result in consequential actions, ex: booking a flight, transferring money.
   */
  readonly consequential?: boolean | undefined
  /**
   * If the declarative tool was declared with the autosubmit attribute.
   */
  readonly autosubmit?: boolean | undefined
}

/**
 * Schema for `Annotation`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Annotation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    readOnly: Schema.optional(Schema.Boolean),
    untrustedContent: Schema.optional(Schema.Boolean),
    consequential: Schema.optional(Schema.Boolean),
    autosubmit: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "WebMCP.Annotation" })
) as any as Schema.Codec<Annotation>

/**
 * Represents the status of a tool invocation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type InvocationStatus =
  | "Completed"
  | "Canceled"
  | "Error"
  | (string & {})

/**
 * Schema for `InvocationStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InvocationStatus = Schema.String as any as Schema.Codec<InvocationStatus>

/**
 * Definition of a tool that was removed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RemovedTool {
  /**
   * Tool name.
   */
  readonly name: string
  /**
   * Frame identifier associated with the tool registration.
   */
  readonly frameId: Page.FrameId
}

/**
 * Schema for `RemovedTool`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RemovedTool = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    frameId: Page.FrameId
  }).annotate({ identifier: "WebMCP.RemovedTool" })
) as any as Schema.Codec<RemovedTool>

/**
 * Definition of a tool that can be invoked.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Tool {
  /**
   * Tool name.
   */
  readonly name: string
  /**
   * Tool description.
   */
  readonly description: string
  /**
   * Schema for the tool's input parameters.
   */
  readonly inputSchema?: { readonly [key: string]: unknown } | undefined
  /**
   * Optional annotations for the tool.
   */
  readonly annotations?: Annotation | undefined
  /**
   * Frame identifier associated with the tool registration.
   */
  readonly frameId: Page.FrameId
  /**
   * Optional node ID for declarative tools.
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
  /**
   * The stack trace at the time of the registration.
   */
  readonly stackTrace?: Runtime.StackTrace | undefined
}

/**
 * Schema for `Tool`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Tool = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    inputSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    annotations: Schema.optional(Annotation),
    frameId: Page.FrameId,
    backendNodeId: Schema.optional(DOM.BackendNodeId),
    stackTrace: Schema.optional(Runtime.StackTrace)
  }).annotate({ identifier: "WebMCP.Tool" })
) as any as Schema.Codec<Tool, unknown>

/**
 * Cancels a pending tool invocation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CancelInvocationParams {
  /**
   * Invocation identifier to cancel.
   */
  readonly invocationId: string
}

/**
 * Schema for `CancelInvocationParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CancelInvocationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    invocationId: Schema.String
  }).annotate({ identifier: "WebMCP.CancelInvocationParams" })
) as any as Schema.Codec<CancelInvocationParams>

/**
 * Invokes a registered tool.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InvokeToolParams {
  /**
   * Frame in which to invoke the tool.
   */
  readonly frameId: Page.FrameId
  /**
   * Name of the tool to invoke.
   */
  readonly toolName: string
  /**
   * Input parameters for the tool, matching the tool's inputSchema.
   */
  readonly input: { readonly [key: string]: unknown }
}

/**
 * Schema for `InvokeToolParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InvokeToolParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Page.FrameId,
    toolName: Schema.String,
    input: Schema.Record(Schema.String, Schema.Unknown)
  }).annotate({ identifier: "WebMCP.InvokeToolParams" })
) as any as Schema.Codec<InvokeToolParams>

/**
 * Invokes a registered tool.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InvokeToolResult {
  /**
   * Unique identifier for this invocation. Response is sent before tool events.
   */
  readonly invocationId: string
}

/**
 * Schema for `InvokeToolResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InvokeToolResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    invocationId: Schema.String
  }).annotate({ identifier: "WebMCP.InvokeToolResult" })
) as any as Schema.Codec<InvokeToolResult>

/**
 * Event fired when a tool invocation starts.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ToolInvokedParams {
  /**
   * Name of the tool to invoke.
   */
  readonly toolName: string
  /**
   * Frame id
   */
  readonly frameId: Page.FrameId
  /**
   * Invocation identifier.
   */
  readonly invocationId: string
  /**
   * The input parameters used for the invocation.
   */
  readonly input: string
}

/**
 * Schema for `ToolInvokedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ToolInvokedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    toolName: Schema.String,
    frameId: Page.FrameId,
    invocationId: Schema.String,
    input: Schema.String
  }).annotate({ identifier: "WebMCP.ToolInvokedParams" })
) as any as Schema.Codec<ToolInvokedParams>

/**
 * Event fired when a tool invocation completes or fails.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ToolRespondedParams {
  /**
   * Invocation identifier.
   */
  readonly invocationId: string
  /**
   * Status of the invocation.
   */
  readonly status: InvocationStatus
  /**
   * Output or error delivered as delivered to the agent. Missing if `status` is anything other than Completed.
   * Note: The output is untrusted and poses a prompt injection risk. Clients should treat this as potentially malicious user input.
   */
  readonly output?: unknown | undefined
  /**
   * Error text for protocol users.
   */
  readonly errorText?: string | undefined
  /**
   * The exception object, if the javascript tool threw an error>
   */
  readonly exception?: Runtime.RemoteObject | undefined
}

/**
 * Schema for `ToolRespondedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ToolRespondedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    invocationId: Schema.String,
    status: InvocationStatus,
    output: Schema.optional(Schema.Unknown),
    errorText: Schema.optional(Schema.String),
    exception: Schema.optional(Runtime.RemoteObject)
  }).annotate({ identifier: "WebMCP.ToolRespondedParams" })
) as any as Schema.Codec<ToolRespondedParams>

/**
 * Event fired when new tools are added.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ToolsAddedParams {
  /**
   * Array of tools that were added.
   */
  readonly tools: ReadonlyArray<Tool>
}

/**
 * Schema for `ToolsAddedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ToolsAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    tools: Schema.Array(Tool)
  }).annotate({ identifier: "WebMCP.ToolsAddedParams" })
) as any as Schema.Codec<ToolsAddedParams, unknown>

/**
 * Event fired when tools are removed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ToolsRemovedParams {
  /**
   * Array of tools that were removed.
   */
  readonly tools: ReadonlyArray<RemovedTool>
}

/**
 * Schema for `ToolsRemovedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ToolsRemovedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    tools: Schema.Array(RemovedTool)
  }).annotate({ identifier: "WebMCP.ToolsRemovedParams" })
) as any as Schema.Codec<ToolsRemovedParams>

/**
 * Cancels a pending tool invocation.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const cancelInvocation: Protocol.CommandDef<"WebMCP.cancelInvocation", CancelInvocationParams, void> =
  /*#__PURE__*/ Protocol.command(
    "WebMCP.cancelInvocation",
    CancelInvocationParams,
    undefined,
    { status: "stable" }
  )

/**
 * Disables the WebMCP domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"WebMCP.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "WebMCP.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables the WebMCP domain, allowing events to be sent. Enabling the domain will trigger a toolsAdded event for
 * all currently registered tools.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"WebMCP.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "WebMCP.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Invokes a registered tool.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const invokeTool: Protocol.CommandDef<"WebMCP.invokeTool", InvokeToolParams, InvokeToolResult> =
  /*#__PURE__*/ Protocol.command(
    "WebMCP.invokeTool",
    InvokeToolParams,
    InvokeToolResult,
    { status: "stable" }
  )

/**
 * Event fired when a tool invocation starts.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const toolInvoked: Protocol.EventDef<"WebMCP.toolInvoked", ToolInvokedParams> = /*#__PURE__*/ Protocol.event(
  "WebMCP.toolInvoked",
  ToolInvokedParams,
  { status: "stable" }
)

/**
 * Event fired when a tool invocation completes or fails.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const toolResponded: Protocol.EventDef<"WebMCP.toolResponded", ToolRespondedParams> = /*#__PURE__*/ Protocol
  .event(
    "WebMCP.toolResponded",
    ToolRespondedParams,
    { status: "stable" }
  )

/**
 * Event fired when new tools are added.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const toolsAdded: Protocol.EventDef<"WebMCP.toolsAdded", ToolsAddedParams> = /*#__PURE__*/ Protocol.event(
  "WebMCP.toolsAdded",
  ToolsAddedParams,
  { status: "stable" }
)

/**
 * Event fired when tools are removed.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const toolsRemoved: Protocol.EventDef<"WebMCP.toolsRemoved", ToolsRemovedParams> = /*#__PURE__*/ Protocol.event(
  "WebMCP.toolsRemoved",
  ToolsRemovedParams,
  { status: "stable" }
)
