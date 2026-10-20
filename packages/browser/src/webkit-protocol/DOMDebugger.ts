/**
 * DOM debugging allows setting breakpoints on particular DOM operations and events. JavaScript execution will stop on these operations as if there was a regular breakpoint set.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Debugger from "./Debugger.ts"
import * as DOM from "./DOM.ts"

/**
 * DOM breakpoint type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DOMBreakpointType =
  | "subtree-modified"
  | "attribute-modified"
  | "node-removed"
  | (string & {})

/**
 * Schema for `DOMBreakpointType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DOMBreakpointType = Schema.String as any as Schema.Codec<DOMBreakpointType>

/**
 * Event breakpoint type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type EventBreakpointType =
  | "animation-frame"
  | "interval"
  | "listener"
  | "timeout"
  | (string & {})

/**
 * Schema for `EventBreakpointType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EventBreakpointType = Schema.String as any as Schema.Codec<EventBreakpointType>

/**
 * Removes DOM breakpoint that was set using <code>setDOMBreakpoint</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveDOMBreakpointParams {
  /**
   * Identifier of the node to remove breakpoint from.
   */
  readonly nodeId: DOM.NodeId
  /**
   * Type of the breakpoint to remove.
   */
  readonly type: DOMBreakpointType
}

/**
 * Schema for `RemoveDOMBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveDOMBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId,
    type: DOMBreakpointType
  }).annotate({ identifier: "DOMDebugger.RemoveDOMBreakpointParams" })
) as any as Schema.Codec<RemoveDOMBreakpointParams>

/**
 * Removes breakpoint on particular event of given type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveEventBreakpointParams {
  readonly breakpointType: EventBreakpointType
  /**
   * The name of the specific event to stop on.
   */
  readonly eventName?: string | undefined
  /**
   * If true, eventName is case sensitive. Defaults to true.
   */
  readonly caseSensitive?: boolean | undefined
  /**
   * If true, treats eventName as a regex. Defaults to false.
   */
  readonly isRegex?: boolean | undefined
}

/**
 * Schema for `RemoveEventBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveEventBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakpointType: EventBreakpointType,
    eventName: Schema.optional(Schema.String),
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOMDebugger.RemoveEventBreakpointParams" })
) as any as Schema.Codec<RemoveEventBreakpointParams>

/**
 * Removes breakpoint from network activity for the given URL.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveURLBreakpointParams {
  /**
   * Resource URL substring. An empty string will stop pausing on all requests.
   */
  readonly url: string
  /**
   * Whether the URL string is a regular expression.
   */
  readonly isRegex?: boolean | undefined
}

/**
 * Schema for `RemoveURLBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveURLBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    isRegex: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOMDebugger.RemoveURLBreakpointParams" })
) as any as Schema.Codec<RemoveURLBreakpointParams>

/**
 * Sets breakpoint on particular operation with DOM.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetDOMBreakpointParams {
  /**
   * Identifier of the node to set breakpoint on.
   */
  readonly nodeId: DOM.NodeId
  /**
   * Type of the operation to stop upon.
   */
  readonly type: DOMBreakpointType
  /**
   * Options to apply to this breakpoint to modify its behavior.
   */
  readonly options?: Debugger.BreakpointOptions | undefined
}

/**
 * Schema for `SetDOMBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetDOMBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId,
    type: DOMBreakpointType,
    options: Schema.optional(Debugger.BreakpointOptions)
  }).annotate({ identifier: "DOMDebugger.SetDOMBreakpointParams" })
) as any as Schema.Codec<SetDOMBreakpointParams>

/**
 * Sets breakpoint on particular event of given type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetEventBreakpointParams {
  readonly breakpointType: EventBreakpointType
  /**
   * The name of the specific event to stop on.
   */
  readonly eventName?: string | undefined
  /**
   * If true, eventName is case sensitive. Defaults to true.
   */
  readonly caseSensitive?: boolean | undefined
  /**
   * If true, treats eventName as a regex. Defaults to false.
   */
  readonly isRegex?: boolean | undefined
  /**
   * Options to apply to this breakpoint to modify its behavior.
   */
  readonly options?: Debugger.BreakpointOptions | undefined
}

/**
 * Schema for `SetEventBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetEventBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    breakpointType: EventBreakpointType,
    eventName: Schema.optional(Schema.String),
    caseSensitive: Schema.optional(Schema.Boolean),
    isRegex: Schema.optional(Schema.Boolean),
    options: Schema.optional(Debugger.BreakpointOptions)
  }).annotate({ identifier: "DOMDebugger.SetEventBreakpointParams" })
) as any as Schema.Codec<SetEventBreakpointParams>

/**
 * Sets breakpoint on network activity for the given URL.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetURLBreakpointParams {
  /**
   * Resource URL substring or regular expression. All requests having this substring in the URL will get stopped upon. An empty string will pause on all requests.
   */
  readonly url: string
  /**
   * Whether the URL string is a regular expression.
   */
  readonly isRegex?: boolean | undefined
  /**
   * Options to apply to this breakpoint to modify its behavior.
   */
  readonly options?: Debugger.BreakpointOptions | undefined
}

/**
 * Schema for `SetURLBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetURLBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String,
    isRegex: Schema.optional(Schema.Boolean),
    options: Schema.optional(Debugger.BreakpointOptions)
  }).annotate({ identifier: "DOMDebugger.SetURLBreakpointParams" })
) as any as Schema.Codec<SetURLBreakpointParams>

/**
 * Removes DOM breakpoint that was set using <code>setDOMBreakpoint</code>.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeDOMBreakpoint: Protocol.CommandDef<
  "DOMDebugger.removeDOMBreakpoint",
  RemoveDOMBreakpointParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOMDebugger.removeDOMBreakpoint",
  RemoveDOMBreakpointParams,
  undefined,
  { status: "stable" }
)

/**
 * Removes breakpoint on particular event of given type.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeEventBreakpoint: Protocol.CommandDef<
  "DOMDebugger.removeEventBreakpoint",
  RemoveEventBreakpointParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOMDebugger.removeEventBreakpoint",
  RemoveEventBreakpointParams,
  undefined,
  { status: "stable" }
)

/**
 * Removes breakpoint from network activity for the given URL.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeURLBreakpoint: Protocol.CommandDef<
  "DOMDebugger.removeURLBreakpoint",
  RemoveURLBreakpointParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOMDebugger.removeURLBreakpoint",
  RemoveURLBreakpointParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets breakpoint on particular operation with DOM.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setDOMBreakpoint: Protocol.CommandDef<"DOMDebugger.setDOMBreakpoint", SetDOMBreakpointParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOMDebugger.setDOMBreakpoint",
    SetDOMBreakpointParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets breakpoint on particular event of given type.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setEventBreakpoint: Protocol.CommandDef<"DOMDebugger.setEventBreakpoint", SetEventBreakpointParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOMDebugger.setEventBreakpoint",
    SetEventBreakpointParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets breakpoint on network activity for the given URL.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setURLBreakpoint: Protocol.CommandDef<"DOMDebugger.setURLBreakpoint", SetURLBreakpointParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOMDebugger.setURLBreakpoint",
    SetURLBreakpointParams,
    undefined,
    { status: "stable" }
  )
