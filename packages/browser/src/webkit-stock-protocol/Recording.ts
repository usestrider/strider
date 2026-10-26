/**
 * General types used for recordings of actions performed in the inspected page.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * Container object for a single frame of the recording.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Frame {
  /**
   * Information about an action made to the recorded object. Follows the structure [name, parameters, swizzleTypes, stackTrace, snapshot], where name is a string, parameters is an array, swizzleTypes is an array, stackTrace is a Console.StackTrace, and snapshot is a data URL image of the current contents after this action.
   */
  readonly actions: ReadonlyArray<unknown>
  /**
   * Total execution time of all actions recorded in this frame in milliseconds.
   */
  readonly duration?: number | undefined
  /**
   * Flag indicating if the recording was stopped before this frame ended.
   */
  readonly incomplete?: boolean | undefined
}

/**
 * Schema for `Frame`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Frame = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    actions: Schema.Array(Schema.Unknown),
    duration: Schema.optional(Schema.Number),
    incomplete: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Recording.Frame" })
) as any as Schema.Codec<Frame>

/**
 * Information about the initial state of the recorded object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InitialState {
  /**
   * Key-value map for each attribute of the state.
   */
  readonly attributes?: { readonly [key: string]: unknown } | undefined
  /**
   * Array of saved states of the context.
   */
  readonly states?: ReadonlyArray<{ readonly [key: string]: unknown }> | undefined
  /**
   * Array of values that were used to construct the recorded object.
   */
  readonly parameters?: ReadonlyArray<unknown> | undefined
  /**
   * Current content at the start of the recording.
   */
  readonly content?: string | undefined
}

/**
 * Schema for `InitialState`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InitialState = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    attributes: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    states: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
    parameters: Schema.optional(Schema.Array(Schema.Unknown)),
    content: Schema.optional(Schema.String)
  }).annotate({ identifier: "Recording.InitialState" })
) as any as Schema.Codec<InitialState>

/**
 * `Initiator` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Initiator =
  | "frontend"
  | "console"
  | "auto-capture"
  | (string & {})

/**
 * Schema for `Initiator`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Initiator = Schema.String as any as Schema.Codec<Initiator>

/**
 * `Recording`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Recording {
  /**
   * Used for future/backwards compatibility.
   */
  readonly version: number
  readonly type: Type
  /**
   * JSON data of inital state of object before recording.
   */
  readonly initialState: InitialState
  /**
   * Array of objects that can be referenced by index. Used to avoid duplicating objects.
   */
  readonly data: ReadonlyArray<unknown>
  readonly name?: string | undefined
}

/**
 * Schema for `Recording`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Recording = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    version: Schema.Int,
    type: Type,
    initialState: InitialState,
    data: Schema.Array(Schema.Unknown),
    name: Schema.optional(Schema.String)
  }).annotate({ identifier: "Recording.Recording" })
) as any as Schema.Codec<Recording>

/**
 * The type of the recording.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Type =
  | "canvas-2d"
  | "offscreen-canvas-2d"
  | "canvas-bitmaprenderer"
  | "offscreen-canvas-bitmaprenderer"
  | "canvas-webgl"
  | "offscreen-canvas-webgl"
  | "canvas-webgl2"
  | "offscreen-canvas-webgl2"
  | (string & {})

/**
 * Schema for `Type`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Type = Schema.String as any as Schema.Codec<Type>
