/**
 * DOM debugging allows setting breakpoints on particular DOM operations and events. JavaScript
 * execution will stop on these operations as if there was a regular breakpoint set.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as Runtime from "./Runtime.ts"

/**
 * CSP Violation type.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CSPViolationType =
  | "trustedtype-sink-violation"
  | "trustedtype-policy-violation"
  | (string & {})

/**
 * Schema for `CSPViolationType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSPViolationType = Schema.String as any as Schema.Codec<CSPViolationType>

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
 * Object event listener.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EventListener {
  /**
   * `EventListener`'s type.
   */
  readonly type: string
  /**
   * `EventListener`'s useCapture.
   */
  readonly useCapture: boolean
  /**
   * `EventListener`'s passive flag.
   */
  readonly passive: boolean
  /**
   * `EventListener`'s once flag.
   */
  readonly once: boolean
  /**
   * Script id of the handler code.
   */
  readonly scriptId: Runtime.ScriptId
  /**
   * Line number in the script (0-based).
   */
  readonly lineNumber: number
  /**
   * Column number in the script (0-based).
   */
  readonly columnNumber: number
  /**
   * Event handler function value.
   */
  readonly handler?: Runtime.RemoteObject | undefined
  /**
   * Event original handler function value.
   */
  readonly originalHandler?: Runtime.RemoteObject | undefined
  /**
   * Node the listener is added to (if any).
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
}

/**
 * Schema for `EventListener`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EventListener = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.String,
    useCapture: Schema.Boolean,
    passive: Schema.Boolean,
    once: Schema.Boolean,
    scriptId: Runtime.ScriptId,
    lineNumber: Schema.Int,
    columnNumber: Schema.Int,
    handler: Schema.optional(Runtime.RemoteObject),
    originalHandler: Schema.optional(Runtime.RemoteObject),
    backendNodeId: Schema.optional(DOM.BackendNodeId)
  }).annotate({ identifier: "DOMDebugger.EventListener" })
) as any as Schema.Codec<EventListener>

/**
 * Returns event listeners of the given object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetEventListenersParams {
  /**
   * Identifier of the object to return listeners for.
   */
  readonly objectId: Runtime.RemoteObjectId
  /**
   * The maximum depth at which Node children should be retrieved, defaults to 1. Use -1 for the
   * entire subtree or provide an integer larger than 0.
   */
  readonly depth?: number | undefined
  /**
   * Whether or not iframes and shadow roots should be traversed when returning the subtree
   * (default is false). Reports listeners for all contexts if pierce is enabled.
   */
  readonly pierce?: boolean | undefined
}

/**
 * Schema for `GetEventListenersParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetEventListenersParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: Runtime.RemoteObjectId,
    depth: Schema.optional(Schema.Int),
    pierce: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "DOMDebugger.GetEventListenersParams" })
) as any as Schema.Codec<GetEventListenersParams>

/**
 * Returns event listeners of the given object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetEventListenersResult {
  /**
   * Array of relevant listeners.
   */
  readonly listeners: ReadonlyArray<EventListener>
}

/**
 * Schema for `GetEventListenersResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetEventListenersResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    listeners: Schema.Array(EventListener)
  }).annotate({ identifier: "DOMDebugger.GetEventListenersResult" })
) as any as Schema.Codec<GetEventListenersResult>

/**
 * Removes DOM breakpoint that was set using `setDOMBreakpoint`.
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
 * Removes breakpoint on particular DOM event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveEventListenerBreakpointParams {
  /**
   * Event name.
   */
  readonly eventName: string
  /**
   * EventTarget interface name.
   */
  readonly targetName?: string | undefined
}

/**
 * Schema for `RemoveEventListenerBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveEventListenerBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    eventName: Schema.String,
    targetName: Schema.optional(Schema.String)
  }).annotate({ identifier: "DOMDebugger.RemoveEventListenerBreakpointParams" })
) as any as Schema.Codec<RemoveEventListenerBreakpointParams>

/**
 * Removes breakpoint from XMLHttpRequest.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveXHRBreakpointParams {
  /**
   * Resource URL substring.
   */
  readonly url: string
}

/**
 * Schema for `RemoveXHRBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveXHRBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String
  }).annotate({ identifier: "DOMDebugger.RemoveXHRBreakpointParams" })
) as any as Schema.Codec<RemoveXHRBreakpointParams>

/**
 * Sets breakpoint on particular CSP violations.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetBreakOnCSPViolationParams {
  /**
   * CSP Violations to stop upon.
   */
  readonly violationTypes: ReadonlyArray<CSPViolationType>
}

/**
 * Schema for `SetBreakOnCSPViolationParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetBreakOnCSPViolationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    violationTypes: Schema.Array(CSPViolationType)
  }).annotate({ identifier: "DOMDebugger.SetBreakOnCSPViolationParams" })
) as any as Schema.Codec<SetBreakOnCSPViolationParams>

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
    type: DOMBreakpointType
  }).annotate({ identifier: "DOMDebugger.SetDOMBreakpointParams" })
) as any as Schema.Codec<SetDOMBreakpointParams>

/**
 * Sets breakpoint on particular DOM event.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetEventListenerBreakpointParams {
  /**
   * DOM Event name to stop on (any DOM event will do).
   */
  readonly eventName: string
  /**
   * EventTarget interface name to stop on. If equal to `"*"` or not provided, will stop on any
   * EventTarget.
   */
  readonly targetName?: string | undefined
}

/**
 * Schema for `SetEventListenerBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetEventListenerBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    eventName: Schema.String,
    targetName: Schema.optional(Schema.String)
  }).annotate({ identifier: "DOMDebugger.SetEventListenerBreakpointParams" })
) as any as Schema.Codec<SetEventListenerBreakpointParams>

/**
 * Sets breakpoint on XMLHttpRequest.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetXHRBreakpointParams {
  /**
   * Resource URL substring. All XHRs having this substring in the URL will get stopped upon.
   */
  readonly url: string
}

/**
 * Schema for `SetXHRBreakpointParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetXHRBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    url: Schema.String
  }).annotate({ identifier: "DOMDebugger.SetXHRBreakpointParams" })
) as any as Schema.Codec<SetXHRBreakpointParams>

/**
 * Returns event listeners of the given object.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getEventListeners: Protocol.CommandDef<
  "DOMDebugger.getEventListeners",
  GetEventListenersParams,
  GetEventListenersResult
> = /*#__PURE__*/ Protocol.command(
  "DOMDebugger.getEventListeners",
  GetEventListenersParams,
  GetEventListenersResult,
  { status: "stable" }
)

/**
 * Removes DOM breakpoint that was set using `setDOMBreakpoint`.
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
 * Removes breakpoint on particular DOM event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeEventListenerBreakpoint: Protocol.CommandDef<
  "DOMDebugger.removeEventListenerBreakpoint",
  RemoveEventListenerBreakpointParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOMDebugger.removeEventListenerBreakpoint",
  RemoveEventListenerBreakpointParams,
  undefined,
  { status: "stable" }
)

/**
 * Removes breakpoint from XMLHttpRequest.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeXHRBreakpoint: Protocol.CommandDef<
  "DOMDebugger.removeXHRBreakpoint",
  RemoveXHRBreakpointParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOMDebugger.removeXHRBreakpoint",
  RemoveXHRBreakpointParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets breakpoint on particular CSP violations.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setBreakOnCSPViolation: Protocol.CommandDef<
  "DOMDebugger.setBreakOnCSPViolation",
  SetBreakOnCSPViolationParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOMDebugger.setBreakOnCSPViolation",
  SetBreakOnCSPViolationParams,
  undefined,
  { status: "experimental" }
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
 * Sets breakpoint on particular DOM event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setEventListenerBreakpoint: Protocol.CommandDef<
  "DOMDebugger.setEventListenerBreakpoint",
  SetEventListenerBreakpointParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "DOMDebugger.setEventListenerBreakpoint",
  SetEventListenerBreakpointParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets breakpoint on XMLHttpRequest.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setXHRBreakpoint: Protocol.CommandDef<"DOMDebugger.setXHRBreakpoint", SetXHRBreakpointParams, void> =
  /*#__PURE__*/ Protocol.command(
    "DOMDebugger.setXHRBreakpoint",
    SetXHRBreakpointParams,
    undefined,
    { status: "stable" }
  )
