/**
 * EventBreakpoints permits setting JavaScript breakpoints on operations and events
 * occurring in native code invoked from JavaScript. Once breakpoint is hit, it is
 * reported through Debugger domain, similarly to regular breakpoints being hit.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Removes breakpoint on particular native event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RemoveInstrumentationBreakpointParams {
  /**
   * Instrumentation name to stop on.
   */
  readonly eventName: string
}

/**
 * Schema for `RemoveInstrumentationBreakpointParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RemoveInstrumentationBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    eventName: Schema.String
  }).annotate({ identifier: "EventBreakpoints.RemoveInstrumentationBreakpointParams" })
) as any as Schema.Codec<RemoveInstrumentationBreakpointParams>

/**
 * Sets breakpoint on particular native event.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetInstrumentationBreakpointParams {
  /**
   * Instrumentation name to stop on.
   */
  readonly eventName: string
}

/**
 * Schema for `SetInstrumentationBreakpointParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetInstrumentationBreakpointParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    eventName: Schema.String
  }).annotate({ identifier: "EventBreakpoints.SetInstrumentationBreakpointParams" })
) as any as Schema.Codec<SetInstrumentationBreakpointParams>

/**
 * Removes all breakpoints
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"EventBreakpoints.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "EventBreakpoints.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Removes breakpoint on particular native event.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const removeInstrumentationBreakpoint: Protocol.CommandDef<
  "EventBreakpoints.removeInstrumentationBreakpoint",
  RemoveInstrumentationBreakpointParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "EventBreakpoints.removeInstrumentationBreakpoint",
  RemoveInstrumentationBreakpointParams,
  undefined,
  { status: "stable" }
)

/**
 * Sets breakpoint on particular native event.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setInstrumentationBreakpoint: Protocol.CommandDef<
  "EventBreakpoints.setInstrumentationBreakpoint",
  SetInstrumentationBreakpointParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "EventBreakpoints.setInstrumentationBreakpoint",
  SetInstrumentationBreakpointParams,
  undefined,
  { status: "stable" }
)
