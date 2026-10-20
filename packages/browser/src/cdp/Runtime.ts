/**
 * Runtime domain exposes JavaScript runtime by means of remote evaluation and mirror objects.
 * Evaluation results are returned as mirror object that expose object type, string representation
 * and unique identifier that can be used for further object reference. Original objects are
 * maintained in memory unless they are either explicitly released or are released along with the
 * other objects in their object group.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Represents function call argument. Either remote object id `objectId`, primitive `value`,
 * unserializable primitive value or neither of (for undefined) them should be specified.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CallArgument {
  /**
   * Primitive value or serializable javascript object.
   */
  readonly value?: unknown | undefined
  /**
   * Primitive value which can not be JSON-stringified.
   */
  readonly unserializableValue?: UnserializableValue | undefined
  /**
   * Remote object handle.
   */
  readonly objectId?: RemoteObjectId | undefined
}

/**
 * Schema for `CallArgument`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CallArgument = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    value: Schema.optional(Schema.Unknown),
    unserializableValue: Schema.optional(UnserializableValue),
    objectId: Schema.optional(RemoteObjectId)
  }).annotate({ identifier: "Runtime.CallArgument" })
) as any as Schema.Codec<CallArgument>

/**
 * Stack entry for runtime errors and assertions.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CallFrame {
  /**
   * JavaScript function name.
   */
  readonly functionName: string
  /**
   * JavaScript script id.
   */
  readonly scriptId: ScriptId
  /**
   * JavaScript script name or url.
   */
  readonly url: string
  /**
   * JavaScript script line number (0-based).
   */
  readonly lineNumber: number
  /**
   * JavaScript script column number (0-based).
   */
  readonly columnNumber: number
}

/**
 * Schema for `CallFrame`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CallFrame = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    functionName: Schema.String,
    scriptId: ScriptId,
    url: Schema.String,
    lineNumber: Schema.Int,
    columnNumber: Schema.Int
  }).annotate({ identifier: "Runtime.CallFrame" })
) as any as Schema.Codec<CallFrame>

/**
 * `CustomPreview`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CustomPreview {
  /**
   * The JSON-stringified result of formatter.header(object, config) call.
   * It contains json ML array that represents RemoteObject.
   */
  readonly header: string
  /**
   * If formatter returns true as a result of formatter.hasBody call then bodyGetterId will
   * contain RemoteObjectId for the function that returns result of formatter.body(object, config) call.
   * The result value is json ML array.
   */
  readonly bodyGetterId?: RemoteObjectId | undefined
}

/**
 * Schema for `CustomPreview`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CustomPreview = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    header: Schema.String,
    bodyGetterId: Schema.optional(RemoteObjectId)
  }).annotate({ identifier: "Runtime.CustomPreview" })
) as any as Schema.Codec<CustomPreview>

/**
 * Represents deep serialized value.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DeepSerializedValue {
  readonly type: DeepSerializedValueType
  readonly value?: unknown | undefined
  readonly objectId?: string | undefined
  /**
   * Set if value reference met more then once during serialization. In such
   * case, value is provided only to one of the serialized values. Unique
   * per value in the scope of one CDP call.
   */
  readonly weakLocalObjectReference?: number | undefined
}

/**
 * Schema for `DeepSerializedValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeepSerializedValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: DeepSerializedValueType,
    value: Schema.optional(Schema.Unknown),
    objectId: Schema.optional(Schema.String),
    weakLocalObjectReference: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Runtime.DeepSerializedValue" })
) as any as Schema.Codec<DeepSerializedValue>

/**
 * `DeepSerializedValue.type` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DeepSerializedValueType =
  | "undefined"
  | "null"
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "regexp"
  | "date"
  | "symbol"
  | "array"
  | "object"
  | "function"
  | "map"
  | "set"
  | "weakmap"
  | "weakset"
  | "error"
  | "proxy"
  | "promise"
  | "typedarray"
  | "arraybuffer"
  | "node"
  | "window"
  | "generator"
  | (string & {})

/**
 * Schema for `DeepSerializedValueType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DeepSerializedValueType = Schema.String as any as Schema.Codec<DeepSerializedValueType>

/**
 * `EntryPreview`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EntryPreview {
  /**
   * Preview of the key. Specified for map-like collection entries.
   */
  readonly key?: ObjectPreview | undefined
  /**
   * Preview of the value.
   */
  readonly value: ObjectPreview
}

/**
 * Schema for `EntryPreview`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EntryPreview = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    key: Schema.optional(ObjectPreview),
    value: ObjectPreview
  }).annotate({ identifier: "Runtime.EntryPreview" })
) as any as Schema.Codec<EntryPreview>

/**
 * Detailed information about exception (or error) that was thrown during script compilation or
 * execution.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExceptionDetails {
  /**
   * Exception id.
   */
  readonly exceptionId: number
  /**
   * Exception text, which should be used together with exception object when available.
   */
  readonly text: string
  /**
   * Line number of the exception location (0-based).
   */
  readonly lineNumber: number
  /**
   * Column number of the exception location (0-based).
   */
  readonly columnNumber: number
  /**
   * Script ID of the exception location.
   */
  readonly scriptId?: ScriptId | undefined
  /**
   * URL of the exception location, to be used when the script was not reported.
   */
  readonly url?: string | undefined
  /**
   * JavaScript stack trace if available.
   */
  readonly stackTrace?: StackTrace | undefined
  /**
   * Exception object if available.
   */
  readonly exception?: RemoteObject | undefined
  /**
   * Identifier of the context where exception happened.
   */
  readonly executionContextId?: ExecutionContextId | undefined
  /**
   * Dictionary with entries of meta data that the client associated
   * with this exception, such as information about associated network
   * requests, etc.
   */
  readonly exceptionMetaData?: { readonly [key: string]: unknown } | undefined
}

/**
 * Schema for `ExceptionDetails`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExceptionDetails = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    exceptionId: Schema.Int,
    text: Schema.String,
    lineNumber: Schema.Int,
    columnNumber: Schema.Int,
    scriptId: Schema.optional(ScriptId),
    url: Schema.optional(Schema.String),
    stackTrace: Schema.optional(StackTrace),
    exception: Schema.optional(RemoteObject),
    executionContextId: Schema.optional(ExecutionContextId),
    exceptionMetaData: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
  }).annotate({ identifier: "Runtime.ExceptionDetails" })
) as any as Schema.Codec<ExceptionDetails>

/**
 * Description of an isolated world.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExecutionContextDescription {
  /**
   * Unique id of the execution context. It can be used to specify in which execution context
   * script evaluation should be performed.
   */
  readonly id: ExecutionContextId
  /**
   * Execution context origin.
   */
  readonly origin: string
  /**
   * Human readable name describing given context.
   */
  readonly name: string
  /**
   * A system-unique execution context identifier. Unlike the id, this is unique across
   * multiple processes, so can be reliably used to identify specific context while backend
   * performs a cross-process navigation.
   */
  readonly uniqueId?: string | undefined
  /**
   * Embedder-specific auxiliary data likely matching {isDefault: boolean, type: 'default'|'isolated'|'worker', frameId: string}
   */
  readonly auxData?: { readonly [key: string]: unknown } | undefined
}

/**
 * Schema for `ExecutionContextDescription`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExecutionContextDescription = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: ExecutionContextId,
    origin: Schema.String,
    name: Schema.String,
    uniqueId: Schema.optional(Schema.String),
    auxData: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
  }).annotate({ identifier: "Runtime.ExecutionContextDescription" })
) as any as Schema.Codec<ExecutionContextDescription>

/**
 * Id of an execution context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ExecutionContextId = Brand.Branded<number, "~@usestrider/browser/cdp/Runtime/ExecutionContextId">

/**
 * Schema for `ExecutionContextId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExecutionContextId = /*#__PURE__*/ Schema.Int.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Runtime/ExecutionContextId")
) as any as Schema.Codec<ExecutionContextId>

/**
 * Object internal property descriptor. This property isn't normally visible in JavaScript code.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InternalPropertyDescriptor {
  /**
   * Conventional property name.
   */
  readonly name: string
  /**
   * The value associated with the property.
   */
  readonly value?: RemoteObject | undefined
}

/**
 * Schema for `InternalPropertyDescriptor`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InternalPropertyDescriptor = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.optional(RemoteObject)
  }).annotate({ identifier: "Runtime.InternalPropertyDescriptor" })
) as any as Schema.Codec<InternalPropertyDescriptor>

/**
 * Object containing abbreviated remote object value.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ObjectPreview {
  /**
   * Object type.
   */
  readonly type: ObjectPreviewType
  /**
   * Object subtype hint. Specified for `object` type values only.
   */
  readonly subtype?: ObjectPreviewSubtype | undefined
  /**
   * String representation of the object.
   */
  readonly description?: string | undefined
  /**
   * True iff some of the properties or entries of the original object did not fit.
   */
  readonly overflow: boolean
  /**
   * List of the properties.
   */
  readonly properties: ReadonlyArray<PropertyPreview>
  /**
   * List of the entries. Specified for `map` and `set` subtype values only.
   */
  readonly entries?: ReadonlyArray<EntryPreview> | undefined
}

/**
 * Schema for `ObjectPreview`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ObjectPreview = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: ObjectPreviewType,
    subtype: Schema.optional(ObjectPreviewSubtype),
    description: Schema.optional(Schema.String),
    overflow: Schema.Boolean,
    properties: Schema.Array(PropertyPreview),
    entries: Schema.optional(Schema.Array(EntryPreview))
  }).annotate({ identifier: "Runtime.ObjectPreview" })
) as any as Schema.Codec<ObjectPreview>

/**
 * Object subtype hint. Specified for `object` type values only.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ObjectPreviewSubtype =
  | "array"
  | "null"
  | "node"
  | "regexp"
  | "date"
  | "map"
  | "set"
  | "weakmap"
  | "weakset"
  | "iterator"
  | "generator"
  | "error"
  | "proxy"
  | "promise"
  | "typedarray"
  | "arraybuffer"
  | "dataview"
  | "webassemblymemory"
  | "wasmvalue"
  | "deferredmodule"
  | "trustedtype"
  | (string & {})

/**
 * Schema for `ObjectPreviewSubtype`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ObjectPreviewSubtype = Schema.String as any as Schema.Codec<ObjectPreviewSubtype>

/**
 * Object type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ObjectPreviewType =
  | "object"
  | "function"
  | "undefined"
  | "string"
  | "number"
  | "boolean"
  | "symbol"
  | "bigint"
  | (string & {})

/**
 * Schema for `ObjectPreviewType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ObjectPreviewType = Schema.String as any as Schema.Codec<ObjectPreviewType>

/**
 * Object private field descriptor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PrivatePropertyDescriptor {
  /**
   * Private property name.
   */
  readonly name: string
  /**
   * The value associated with the private property.
   */
  readonly value?: RemoteObject | undefined
  /**
   * A function which serves as a getter for the private property,
   * or `undefined` if there is no getter (accessor descriptors only).
   */
  readonly get?: RemoteObject | undefined
  /**
   * A function which serves as a setter for the private property,
   * or `undefined` if there is no setter (accessor descriptors only).
   */
  readonly set?: RemoteObject | undefined
}

/**
 * Schema for `PrivatePropertyDescriptor`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PrivatePropertyDescriptor = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.optional(RemoteObject),
    get: Schema.optional(RemoteObject),
    set: Schema.optional(RemoteObject)
  }).annotate({ identifier: "Runtime.PrivatePropertyDescriptor" })
) as any as Schema.Codec<PrivatePropertyDescriptor>

/**
 * Object property descriptor.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PropertyDescriptor {
  /**
   * Property name or symbol description.
   */
  readonly name: string
  /**
   * The value associated with the property.
   */
  readonly value?: RemoteObject | undefined
  /**
   * True if the value associated with the property may be changed (data descriptors only).
   */
  readonly writable?: boolean | undefined
  /**
   * A function which serves as a getter for the property, or `undefined` if there is no getter
   * (accessor descriptors only).
   */
  readonly get?: RemoteObject | undefined
  /**
   * A function which serves as a setter for the property, or `undefined` if there is no setter
   * (accessor descriptors only).
   */
  readonly set?: RemoteObject | undefined
  /**
   * True if the type of this property descriptor may be changed and if the property may be
   * deleted from the corresponding object.
   */
  readonly configurable: boolean
  /**
   * True if this property shows up during enumeration of the properties on the corresponding
   * object.
   */
  readonly enumerable: boolean
  /**
   * True if the result was thrown during the evaluation.
   */
  readonly wasThrown?: boolean | undefined
  /**
   * True if the property is owned for the object.
   */
  readonly isOwn?: boolean | undefined
  /**
   * Property symbol object, if the property is of the `symbol` type.
   */
  readonly symbol?: RemoteObject | undefined
}

/**
 * Schema for `PropertyDescriptor`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PropertyDescriptor = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.optional(RemoteObject),
    writable: Schema.optional(Schema.Boolean),
    get: Schema.optional(RemoteObject),
    set: Schema.optional(RemoteObject),
    configurable: Schema.Boolean,
    enumerable: Schema.Boolean,
    wasThrown: Schema.optional(Schema.Boolean),
    isOwn: Schema.optional(Schema.Boolean),
    symbol: Schema.optional(RemoteObject)
  }).annotate({ identifier: "Runtime.PropertyDescriptor" })
) as any as Schema.Codec<PropertyDescriptor>

/**
 * `PropertyPreview`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PropertyPreview {
  /**
   * Property name.
   */
  readonly name: string
  /**
   * Object type. Accessor means that the property itself is an accessor property.
   */
  readonly type: PropertyPreviewType
  /**
   * User-friendly property value string.
   */
  readonly value?: string | undefined
  /**
   * Nested value preview.
   */
  readonly valuePreview?: ObjectPreview | undefined
  /**
   * Object subtype hint. Specified for `object` type values only.
   */
  readonly subtype?: PropertyPreviewSubtype | undefined
}

/**
 * Schema for `PropertyPreview`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PropertyPreview = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    type: PropertyPreviewType,
    value: Schema.optional(Schema.String),
    valuePreview: Schema.optional(ObjectPreview),
    subtype: Schema.optional(PropertyPreviewSubtype)
  }).annotate({ identifier: "Runtime.PropertyPreview" })
) as any as Schema.Codec<PropertyPreview>

/**
 * Object subtype hint. Specified for `object` type values only.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PropertyPreviewSubtype =
  | "array"
  | "null"
  | "node"
  | "regexp"
  | "date"
  | "map"
  | "set"
  | "weakmap"
  | "weakset"
  | "iterator"
  | "generator"
  | "error"
  | "proxy"
  | "promise"
  | "typedarray"
  | "arraybuffer"
  | "dataview"
  | "webassemblymemory"
  | "wasmvalue"
  | "deferredmodule"
  | "trustedtype"
  | (string & {})

/**
 * Schema for `PropertyPreviewSubtype`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PropertyPreviewSubtype = Schema.String as any as Schema.Codec<PropertyPreviewSubtype>

/**
 * Object type. Accessor means that the property itself is an accessor property.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PropertyPreviewType =
  | "object"
  | "function"
  | "undefined"
  | "string"
  | "number"
  | "boolean"
  | "symbol"
  | "accessor"
  | "bigint"
  | (string & {})

/**
 * Schema for `PropertyPreviewType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PropertyPreviewType = Schema.String as any as Schema.Codec<PropertyPreviewType>

/**
 * Mirror object referencing original JavaScript object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoteObject {
  /**
   * Object type.
   */
  readonly type: RemoteObjectType
  /**
   * Object subtype hint. Specified for `object` type values only.
   * NOTE: If you change anything here, make sure to also update
   * `subtype` in `ObjectPreview` and `PropertyPreview` below.
   */
  readonly subtype?: RemoteObjectSubtype | undefined
  /**
   * Object class (constructor) name. Specified for `object` type values only.
   */
  readonly className?: string | undefined
  /**
   * Remote object value in case of primitive values or JSON values (if it was requested).
   */
  readonly value?: unknown | undefined
  /**
   * Primitive value which can not be JSON-stringified does not have `value`, but gets this
   * property.
   */
  readonly unserializableValue?: UnserializableValue | undefined
  /**
   * String representation of the object.
   */
  readonly description?: string | undefined
  /**
   * Deep serialized value.
   */
  readonly deepSerializedValue?: DeepSerializedValue | undefined
  /**
   * Unique object identifier (for non-primitive values).
   */
  readonly objectId?: RemoteObjectId | undefined
  /**
   * Preview containing abbreviated property values. Specified for `object` type values only.
   */
  readonly preview?: ObjectPreview | undefined
  readonly customPreview?: CustomPreview | undefined
}

/**
 * Schema for `RemoteObject`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoteObject = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: RemoteObjectType,
    subtype: Schema.optional(RemoteObjectSubtype),
    className: Schema.optional(Schema.String),
    value: Schema.optional(Schema.Unknown),
    unserializableValue: Schema.optional(UnserializableValue),
    description: Schema.optional(Schema.String),
    deepSerializedValue: Schema.optional(DeepSerializedValue),
    objectId: Schema.optional(RemoteObjectId),
    preview: Schema.optional(ObjectPreview),
    customPreview: Schema.optional(CustomPreview)
  }).annotate({ identifier: "Runtime.RemoteObject" })
) as any as Schema.Codec<RemoteObject>

/**
 * Object subtype hint. Specified for `object` type values only.
 * NOTE: If you change anything here, make sure to also update
 * `subtype` in `ObjectPreview` and `PropertyPreview` below.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RemoteObjectSubtype =
  | "array"
  | "null"
  | "node"
  | "regexp"
  | "date"
  | "map"
  | "set"
  | "weakmap"
  | "weakset"
  | "iterator"
  | "generator"
  | "error"
  | "proxy"
  | "promise"
  | "typedarray"
  | "arraybuffer"
  | "dataview"
  | "webassemblymemory"
  | "wasmvalue"
  | "deferredmodule"
  | "trustedtype"
  | (string & {})

/**
 * Schema for `RemoteObjectSubtype`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoteObjectSubtype = Schema.String as any as Schema.Codec<RemoteObjectSubtype>

/**
 * Object type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RemoteObjectType =
  | "object"
  | "function"
  | "undefined"
  | "string"
  | "number"
  | "boolean"
  | "symbol"
  | "bigint"
  | (string & {})

/**
 * Schema for `RemoteObjectType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoteObjectType = Schema.String as any as Schema.Codec<RemoteObjectType>

/**
 * Unique object identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RemoteObjectId = Brand.Branded<string, "~@usestrider/browser/cdp/Runtime/RemoteObjectId">

/**
 * Schema for `RemoteObjectId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoteObjectId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Runtime/RemoteObjectId")
) as any as Schema.Codec<RemoteObjectId>

/**
 * Unique script identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ScriptId = Brand.Branded<string, "~@usestrider/browser/cdp/Runtime/ScriptId">

/**
 * Schema for `ScriptId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScriptId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Runtime/ScriptId")
) as any as Schema.Codec<ScriptId>

/**
 * Represents options for serialization. Overrides `generatePreview` and `returnByValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SerializationOptions {
  readonly serialization: SerializationOptionsSerialization
  /**
   * Deep serialization depth. Default is full depth. Respected only in `deep` serialization mode.
   */
  readonly maxDepth?: number | undefined
  /**
   * Embedder-specific parameters. For example if connected to V8 in Chrome these control DOM
   * serialization via `maxNodeDepth: integer` and `includeShadowTree: "none" | "open" | "all"`.
   * Values can be only of type string or integer.
   */
  readonly additionalParameters?: { readonly [key: string]: unknown } | undefined
}

/**
 * Schema for `SerializationOptions`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SerializationOptions = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    serialization: SerializationOptionsSerialization,
    maxDepth: Schema.optional(Schema.Int),
    additionalParameters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
  }).annotate({ identifier: "Runtime.SerializationOptions" })
) as any as Schema.Codec<SerializationOptions>

/**
 * `SerializationOptions.serialization` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SerializationOptionsSerialization =
  | "deep"
  | "json"
  | "idOnly"
  | (string & {})

/**
 * Schema for `SerializationOptionsSerialization`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SerializationOptionsSerialization = Schema.String as any as Schema.Codec<SerializationOptionsSerialization>

/**
 * Call frames for assertions or error messages.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StackTrace {
  /**
   * String label of this stack trace. For async traces this may be a name of the function that
   * initiated the async call.
   */
  readonly description?: string | undefined
  /**
   * JavaScript function name.
   */
  readonly callFrames: ReadonlyArray<CallFrame>
  /**
   * Asynchronous JavaScript stack trace that preceded this stack, if available.
   */
  readonly parent?: StackTrace | undefined
  /**
   * Asynchronous JavaScript stack trace that preceded this stack, if available.
   */
  readonly parentId?: StackTraceId | undefined
}

/**
 * Schema for `StackTrace`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StackTrace = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    description: Schema.optional(Schema.String),
    callFrames: Schema.Array(CallFrame),
    parent: Schema.optional(StackTrace),
    parentId: Schema.optional(StackTraceId)
  }).annotate({ identifier: "Runtime.StackTrace" })
) as any as Schema.Codec<StackTrace>

/**
 * If `debuggerId` is set stack trace comes from another debugger and can be resolved there. This
 * allows to track cross-debugger calls. See `Runtime.StackTrace` and `Debugger.paused` for usages.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StackTraceId {
  readonly id: string
  readonly debuggerId?: UniqueDebuggerId | undefined
}

/**
 * Schema for `StackTraceId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StackTraceId = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String,
    debuggerId: Schema.optional(UniqueDebuggerId)
  }).annotate({ identifier: "Runtime.StackTraceId" })
) as any as Schema.Codec<StackTraceId>

/**
 * Number of milliseconds.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TimeDelta = number

/**
 * Schema for `TimeDelta`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TimeDelta = Schema.Number as any as Schema.Codec<TimeDelta>

/**
 * Number of milliseconds since epoch.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Timestamp = number

/**
 * Schema for `Timestamp`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Timestamp = Schema.Number as any as Schema.Codec<Timestamp>

/**
 * Unique identifier of current debugger.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type UniqueDebuggerId = Brand.Branded<string, "~@usestrider/browser/cdp/Runtime/UniqueDebuggerId">

/**
 * Schema for `UniqueDebuggerId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UniqueDebuggerId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Runtime/UniqueDebuggerId")
) as any as Schema.Codec<UniqueDebuggerId>

/**
 * Primitive value which cannot be JSON-stringified. Includes values `-0`, `NaN`, `Infinity`,
 * `-Infinity`, and bigint literals.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type UnserializableValue = string

/**
 * Schema for `UnserializableValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UnserializableValue = Schema.String as any as Schema.Codec<UnserializableValue>

/**
 * If executionContextId is empty, adds binding with the given name on the
 * global objects of all inspected contexts, including those created later,
 * bindings survive reloads.
 * Binding function takes exactly one argument, this argument should be string,
 * in case of any other input, function throws an exception.
 * Each binding function call produces Runtime.bindingCalled notification.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddBindingParams {
  readonly name: string
  /**
   * If specified, the binding is exposed to the executionContext with
   * matching name, even for contexts created after the binding is added.
   * See also `ExecutionContext.name` and `worldName` parameter to
   * `Page.addScriptToEvaluateOnNewDocument`.
   * This parameter is mutually exclusive with `executionContextId`.
   */
  readonly executionContextName?: string | undefined
}

/**
 * Schema for `AddBindingParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddBindingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    executionContextName: Schema.optional(Schema.String)
  }).annotate({ identifier: "Runtime.AddBindingParams" })
) as any as Schema.Codec<AddBindingParams>

/**
 * Add handler to promise with given promise object id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AwaitPromiseParams {
  /**
   * Identifier of the promise.
   */
  readonly promiseObjectId: RemoteObjectId
  /**
   * Whether the result is expected to be a JSON object that should be sent by value.
   */
  readonly returnByValue?: boolean | undefined
  /**
   * Whether preview should be generated for the result.
   */
  readonly generatePreview?: boolean | undefined
}

/**
 * Schema for `AwaitPromiseParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AwaitPromiseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    promiseObjectId: RemoteObjectId,
    returnByValue: Schema.optional(Schema.Boolean),
    generatePreview: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.AwaitPromiseParams" })
) as any as Schema.Codec<AwaitPromiseParams>

/**
 * Add handler to promise with given promise object id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AwaitPromiseResult {
  /**
   * Promise result. Will contain rejected value if promise was rejected.
   */
  readonly result: RemoteObject
  /**
   * Exception details if stack strace is available.
   */
  readonly exceptionDetails?: ExceptionDetails | undefined
}

/**
 * Schema for `AwaitPromiseResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AwaitPromiseResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: RemoteObject,
    exceptionDetails: Schema.optional(ExceptionDetails)
  }).annotate({ identifier: "Runtime.AwaitPromiseResult" })
) as any as Schema.Codec<AwaitPromiseResult>

/**
 * Notification is issued every time when binding is called.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BindingCalledParams {
  readonly name: string
  readonly payload: string
  /**
   * Identifier of the context where the call was made.
   */
  readonly executionContextId: ExecutionContextId
}

/**
 * Schema for `BindingCalledParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BindingCalledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    payload: Schema.String,
    executionContextId: ExecutionContextId
  }).annotate({ identifier: "Runtime.BindingCalledParams" })
) as any as Schema.Codec<BindingCalledParams>

/**
 * Calls function with given declaration on the given object. Object group of the result is
 * inherited from the target object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CallFunctionOnParams {
  /**
   * Declaration of the function to call.
   */
  readonly functionDeclaration: string
  /**
   * Identifier of the object to call function on. Either objectId or executionContextId should
   * be specified.
   */
  readonly objectId?: RemoteObjectId | undefined
  /**
   * Call arguments. All call arguments must belong to the same JavaScript world as the target
   * object.
   */
  readonly arguments?: ReadonlyArray<CallArgument> | undefined
  /**
   * In silent mode exceptions thrown during evaluation are not reported and do not pause
   * execution. Overrides `setPauseOnException` state.
   */
  readonly silent?: boolean | undefined
  /**
   * Whether the result is expected to be a JSON object which should be sent by value.
   * Can be overriden by `serializationOptions`.
   */
  readonly returnByValue?: boolean | undefined
  /**
   * Whether preview should be generated for the result.
   */
  readonly generatePreview?: boolean | undefined
  /**
   * Whether execution should be treated as initiated by user in the UI.
   */
  readonly userGesture?: boolean | undefined
  /**
   * Whether execution should `await` for resulting value and return once awaited promise is
   * resolved.
   */
  readonly awaitPromise?: boolean | undefined
  /**
   * Specifies execution context which global object will be used to call function on. Either
   * executionContextId or objectId should be specified.
   */
  readonly executionContextId?: ExecutionContextId | undefined
  /**
   * Symbolic group name that can be used to release multiple objects. If objectGroup is not
   * specified and objectId is, objectGroup will be inherited from object.
   */
  readonly objectGroup?: string | undefined
  /**
   * Whether to throw an exception if side effect cannot be ruled out during evaluation.
   */
  readonly throwOnSideEffect?: boolean | undefined
  /**
   * An alternative way to specify the execution context to call function on.
   * Compared to contextId that may be reused across processes, this is guaranteed to be
   * system-unique, so it can be used to prevent accidental function call
   * in context different than intended (e.g. as a result of navigation across process
   * boundaries).
   * This is mutually exclusive with `executionContextId`.
   */
  readonly uniqueContextId?: string | undefined
  /**
   * Specifies the result serialization. If provided, overrides
   * `generatePreview` and `returnByValue`.
   */
  readonly serializationOptions?: SerializationOptions | undefined
}

/**
 * Schema for `CallFunctionOnParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CallFunctionOnParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    functionDeclaration: Schema.String,
    objectId: Schema.optional(RemoteObjectId),
    arguments: Schema.optional(Schema.Array(CallArgument)),
    silent: Schema.optional(Schema.Boolean),
    returnByValue: Schema.optional(Schema.Boolean),
    generatePreview: Schema.optional(Schema.Boolean),
    userGesture: Schema.optional(Schema.Boolean),
    awaitPromise: Schema.optional(Schema.Boolean),
    executionContextId: Schema.optional(ExecutionContextId),
    objectGroup: Schema.optional(Schema.String),
    throwOnSideEffect: Schema.optional(Schema.Boolean),
    uniqueContextId: Schema.optional(Schema.String),
    serializationOptions: Schema.optional(SerializationOptions)
  }).annotate({ identifier: "Runtime.CallFunctionOnParams" })
) as any as Schema.Codec<CallFunctionOnParams>

/**
 * Calls function with given declaration on the given object. Object group of the result is
 * inherited from the target object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CallFunctionOnResult {
  /**
   * Call result.
   */
  readonly result: RemoteObject
  /**
   * Exception details.
   */
  readonly exceptionDetails?: ExceptionDetails | undefined
}

/**
 * Schema for `CallFunctionOnResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CallFunctionOnResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: RemoteObject,
    exceptionDetails: Schema.optional(ExceptionDetails)
  }).annotate({ identifier: "Runtime.CallFunctionOnResult" })
) as any as Schema.Codec<CallFunctionOnResult>

/**
 * Compiles expression.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CompileScriptParams {
  /**
   * Expression to compile.
   */
  readonly expression: string
  /**
   * Source url to be set for the script.
   */
  readonly sourceURL: string
  /**
   * Specifies whether the compiled script should be persisted.
   */
  readonly persistScript: boolean
  /**
   * Specifies in which execution context to perform script run. If the parameter is omitted the
   * evaluation will be performed in the context of the inspected page.
   */
  readonly executionContextId?: ExecutionContextId | undefined
}

/**
 * Schema for `CompileScriptParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CompileScriptParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    expression: Schema.String,
    sourceURL: Schema.String,
    persistScript: Schema.Boolean,
    executionContextId: Schema.optional(ExecutionContextId)
  }).annotate({ identifier: "Runtime.CompileScriptParams" })
) as any as Schema.Codec<CompileScriptParams>

/**
 * Compiles expression.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CompileScriptResult {
  /**
   * Id of the script.
   */
  readonly scriptId?: ScriptId | undefined
  /**
   * Exception details.
   */
  readonly exceptionDetails?: ExceptionDetails | undefined
}

/**
 * Schema for `CompileScriptResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CompileScriptResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: Schema.optional(ScriptId),
    exceptionDetails: Schema.optional(ExceptionDetails)
  }).annotate({ identifier: "Runtime.CompileScriptResult" })
) as any as Schema.Codec<CompileScriptResult>

/**
 * Issued when console API was called.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ConsoleAPICalledParams {
  /**
   * Type of the call.
   */
  readonly type: ConsoleAPICalledParamsType
  /**
   * Call arguments.
   */
  readonly args: ReadonlyArray<RemoteObject>
  /**
   * Identifier of the context where the call was made.
   */
  readonly executionContextId: ExecutionContextId
  /**
   * Call timestamp.
   */
  readonly timestamp: Timestamp
  /**
   * Stack trace captured when the call was made. The async stack chain is automatically reported for
   * the following call types: `assert`, `error`, `trace`, `warning`. For other types the async call
   * chain can be retrieved using `Debugger.getStackTrace` and `stackTrace.parentId` field.
   */
  readonly stackTrace?: StackTrace | undefined
  /**
   * Console context descriptor for calls on non-default console context (not console.*):
   * 'anonymous#unique-logger-id' for call on unnamed context, 'name#unique-logger-id' for call
   * on named context.
   */
  readonly context?: string | undefined
}

/**
 * Schema for `ConsoleAPICalledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ConsoleAPICalledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: ConsoleAPICalledParamsType,
    args: Schema.Array(RemoteObject),
    executionContextId: ExecutionContextId,
    timestamp: Timestamp,
    stackTrace: Schema.optional(StackTrace),
    context: Schema.optional(Schema.String)
  }).annotate({ identifier: "Runtime.ConsoleAPICalledParams" })
) as any as Schema.Codec<ConsoleAPICalledParams>

/**
 * Type of the call.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ConsoleAPICalledParamsType =
  | "log"
  | "debug"
  | "info"
  | "error"
  | "warning"
  | "dir"
  | "dirxml"
  | "table"
  | "trace"
  | "clear"
  | "startGroup"
  | "startGroupCollapsed"
  | "endGroup"
  | "assert"
  | "profile"
  | "profileEnd"
  | "count"
  | "timeEnd"
  | (string & {})

/**
 * Schema for `ConsoleAPICalledParamsType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ConsoleAPICalledParamsType = Schema.String as any as Schema.Codec<ConsoleAPICalledParamsType>

/**
 * Evaluates expression on global object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EvaluateParams {
  /**
   * Expression to evaluate.
   */
  readonly expression: string
  /**
   * Symbolic group name that can be used to release multiple objects.
   */
  readonly objectGroup?: string | undefined
  /**
   * Determines whether Command Line API should be available during the evaluation.
   */
  readonly includeCommandLineAPI?: boolean | undefined
  /**
   * In silent mode exceptions thrown during evaluation are not reported and do not pause
   * execution. Overrides `setPauseOnException` state.
   */
  readonly silent?: boolean | undefined
  /**
   * Specifies in which execution context to perform evaluation. If the parameter is omitted the
   * evaluation will be performed in the context of the inspected page.
   * This is mutually exclusive with `uniqueContextId`, which offers an
   * alternative way to identify the execution context that is more reliable
   * in a multi-process environment.
   */
  readonly contextId?: ExecutionContextId | undefined
  /**
   * Whether the result is expected to be a JSON object that should be sent by value.
   */
  readonly returnByValue?: boolean | undefined
  /**
   * Whether preview should be generated for the result.
   */
  readonly generatePreview?: boolean | undefined
  /**
   * Whether execution should be treated as initiated by user in the UI.
   */
  readonly userGesture?: boolean | undefined
  /**
   * Whether execution should `await` for resulting value and return once awaited promise is
   * resolved.
   */
  readonly awaitPromise?: boolean | undefined
  /**
   * Whether to throw an exception if side effect cannot be ruled out during evaluation.
   * This implies `disableBreaks` below.
   */
  readonly throwOnSideEffect?: boolean | undefined
  /**
   * Terminate execution after timing out (number of milliseconds).
   */
  readonly timeout?: TimeDelta | undefined
  /**
   * Disable breakpoints during execution.
   */
  readonly disableBreaks?: boolean | undefined
  /**
   * Setting this flag to true enables `let` re-declaration and top-level `await`.
   * Note that `let` variables can only be re-declared if they originate from
   * `replMode` themselves.
   */
  readonly replMode?: boolean | undefined
  /**
   * The Content Security Policy (CSP) for the target might block 'unsafe-eval'
   * which includes eval(), Function(), setTimeout() and setInterval()
   * when called with non-callable arguments. This flag bypasses CSP for this
   * evaluation and allows unsafe-eval. Defaults to true.
   */
  readonly allowUnsafeEvalBlockedByCSP?: boolean | undefined
  /**
   * An alternative way to specify the execution context to evaluate in.
   * Compared to contextId that may be reused across processes, this is guaranteed to be
   * system-unique, so it can be used to prevent accidental evaluation of the expression
   * in context different than intended (e.g. as a result of navigation across process
   * boundaries).
   * This is mutually exclusive with `contextId`.
   */
  readonly uniqueContextId?: string | undefined
  /**
   * Specifies the result serialization. If provided, overrides
   * `generatePreview` and `returnByValue`.
   */
  readonly serializationOptions?: SerializationOptions | undefined
}

/**
 * Schema for `EvaluateParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    expression: Schema.String,
    objectGroup: Schema.optional(Schema.String),
    includeCommandLineAPI: Schema.optional(Schema.Boolean),
    silent: Schema.optional(Schema.Boolean),
    contextId: Schema.optional(ExecutionContextId),
    returnByValue: Schema.optional(Schema.Boolean),
    generatePreview: Schema.optional(Schema.Boolean),
    userGesture: Schema.optional(Schema.Boolean),
    awaitPromise: Schema.optional(Schema.Boolean),
    throwOnSideEffect: Schema.optional(Schema.Boolean),
    timeout: Schema.optional(TimeDelta),
    disableBreaks: Schema.optional(Schema.Boolean),
    replMode: Schema.optional(Schema.Boolean),
    allowUnsafeEvalBlockedByCSP: Schema.optional(Schema.Boolean),
    uniqueContextId: Schema.optional(Schema.String),
    serializationOptions: Schema.optional(SerializationOptions)
  }).annotate({ identifier: "Runtime.EvaluateParams" })
) as any as Schema.Codec<EvaluateParams>

/**
 * Evaluates expression on global object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EvaluateResult {
  /**
   * Evaluation result.
   */
  readonly result: RemoteObject
  /**
   * Exception details.
   */
  readonly exceptionDetails?: ExceptionDetails | undefined
}

/**
 * Schema for `EvaluateResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluateResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: RemoteObject,
    exceptionDetails: Schema.optional(ExceptionDetails)
  }).annotate({ identifier: "Runtime.EvaluateResult" })
) as any as Schema.Codec<EvaluateResult>

/**
 * Issued when unhandled exception was revoked.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExceptionRevokedParams {
  /**
   * Reason describing why exception was revoked.
   */
  readonly reason: string
  /**
   * The id of revoked exception, as reported in `exceptionThrown`.
   */
  readonly exceptionId: number
}

/**
 * Schema for `ExceptionRevokedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExceptionRevokedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    reason: Schema.String,
    exceptionId: Schema.Int
  }).annotate({ identifier: "Runtime.ExceptionRevokedParams" })
) as any as Schema.Codec<ExceptionRevokedParams>

/**
 * Issued when exception was thrown and unhandled.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExceptionThrownParams {
  /**
   * Timestamp of the exception.
   */
  readonly timestamp: Timestamp
  readonly exceptionDetails: ExceptionDetails
}

/**
 * Schema for `ExceptionThrownParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExceptionThrownParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Timestamp,
    exceptionDetails: ExceptionDetails
  }).annotate({ identifier: "Runtime.ExceptionThrownParams" })
) as any as Schema.Codec<ExceptionThrownParams>

/**
 * Issued when new execution context is created.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExecutionContextCreatedParams {
  /**
   * A newly created execution context.
   */
  readonly context: ExecutionContextDescription
}

/**
 * Schema for `ExecutionContextCreatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExecutionContextCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: ExecutionContextDescription
  }).annotate({ identifier: "Runtime.ExecutionContextCreatedParams" })
) as any as Schema.Codec<ExecutionContextCreatedParams>

/**
 * Issued when execution context is destroyed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExecutionContextDestroyedParams {
  /**
   * Unique Id of the destroyed context
   */
  readonly executionContextUniqueId?: string | undefined
}

/**
 * Schema for `ExecutionContextDestroyedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExecutionContextDestroyedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    executionContextUniqueId: Schema.optional(Schema.String)
  }).annotate({ identifier: "Runtime.ExecutionContextDestroyedParams" })
) as any as Schema.Codec<ExecutionContextDestroyedParams>

/**
 * This method tries to lookup and populate exception details for a
 * JavaScript Error object.
 * Note that the stackTrace portion of the resulting exceptionDetails will
 * only be populated if the Runtime domain was enabled at the time when the
 * Error was thrown.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetExceptionDetailsParams {
  /**
   * The error object for which to resolve the exception details.
   */
  readonly errorObjectId: RemoteObjectId
}

/**
 * Schema for `GetExceptionDetailsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetExceptionDetailsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    errorObjectId: RemoteObjectId
  }).annotate({ identifier: "Runtime.GetExceptionDetailsParams" })
) as any as Schema.Codec<GetExceptionDetailsParams>

/**
 * This method tries to lookup and populate exception details for a
 * JavaScript Error object.
 * Note that the stackTrace portion of the resulting exceptionDetails will
 * only be populated if the Runtime domain was enabled at the time when the
 * Error was thrown.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetExceptionDetailsResult {
  readonly exceptionDetails?: ExceptionDetails | undefined
}

/**
 * Schema for `GetExceptionDetailsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetExceptionDetailsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    exceptionDetails: Schema.optional(ExceptionDetails)
  }).annotate({ identifier: "Runtime.GetExceptionDetailsResult" })
) as any as Schema.Codec<GetExceptionDetailsResult>

/**
 * Returns the JavaScript heap usage.
 * It is the total usage of the corresponding isolate not scoped to a particular Runtime.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetHeapUsageResult {
  /**
   * Used JavaScript heap size in bytes.
   */
  readonly usedSize: number
  /**
   * Allocated JavaScript heap size in bytes.
   */
  readonly totalSize: number
  /**
   * Used size in bytes in the embedder's garbage-collected heap.
   */
  readonly embedderHeapUsedSize: number
  /**
   * Size in bytes of backing storage for array buffers and external strings.
   */
  readonly backingStorageSize: number
}

/**
 * Schema for `GetHeapUsageResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetHeapUsageResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    usedSize: Schema.Number,
    totalSize: Schema.Number,
    embedderHeapUsedSize: Schema.Number,
    backingStorageSize: Schema.Number
  }).annotate({ identifier: "Runtime.GetHeapUsageResult" })
) as any as Schema.Codec<GetHeapUsageResult>

/**
 * Returns the isolate id.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetIsolateIdResult {
  /**
   * The isolate id.
   */
  readonly id: string
}

/**
 * Schema for `GetIsolateIdResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetIsolateIdResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String
  }).annotate({ identifier: "Runtime.GetIsolateIdResult" })
) as any as Schema.Codec<GetIsolateIdResult>

/**
 * Returns properties of a given object. Object group of the result is inherited from the target
 * object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetPropertiesParams {
  /**
   * Identifier of the object to return properties for.
   */
  readonly objectId: RemoteObjectId
  /**
   * If true, returns properties belonging only to the element itself, not to its prototype
   * chain.
   */
  readonly ownProperties?: boolean | undefined
  /**
   * If true, returns accessor properties (with getter/setter) only; internal properties are not
   * returned either.
   */
  readonly accessorPropertiesOnly?: boolean | undefined
  /**
   * Whether preview should be generated for the results.
   */
  readonly generatePreview?: boolean | undefined
  /**
   * If true, returns non-indexed properties only.
   */
  readonly nonIndexedPropertiesOnly?: boolean | undefined
}

/**
 * Schema for `GetPropertiesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetPropertiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: RemoteObjectId,
    ownProperties: Schema.optional(Schema.Boolean),
    accessorPropertiesOnly: Schema.optional(Schema.Boolean),
    generatePreview: Schema.optional(Schema.Boolean),
    nonIndexedPropertiesOnly: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.GetPropertiesParams" })
) as any as Schema.Codec<GetPropertiesParams>

/**
 * Returns properties of a given object. Object group of the result is inherited from the target
 * object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetPropertiesResult {
  /**
   * Object properties.
   */
  readonly result: ReadonlyArray<PropertyDescriptor>
  /**
   * Internal object properties (only of the element itself).
   */
  readonly internalProperties?: ReadonlyArray<InternalPropertyDescriptor> | undefined
  /**
   * Object private properties.
   */
  readonly privateProperties?: ReadonlyArray<PrivatePropertyDescriptor> | undefined
  /**
   * Exception details.
   */
  readonly exceptionDetails?: ExceptionDetails | undefined
}

/**
 * Schema for `GetPropertiesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetPropertiesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: Schema.Array(PropertyDescriptor),
    internalProperties: Schema.optional(Schema.Array(InternalPropertyDescriptor)),
    privateProperties: Schema.optional(Schema.Array(PrivatePropertyDescriptor)),
    exceptionDetails: Schema.optional(ExceptionDetails)
  }).annotate({ identifier: "Runtime.GetPropertiesResult" })
) as any as Schema.Codec<GetPropertiesResult>

/**
 * Returns all let, const and class variables from global scope.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GlobalLexicalScopeNamesParams {
  /**
   * Specifies in which execution context to lookup global scope variables.
   */
  readonly executionContextId?: ExecutionContextId | undefined
}

/**
 * Schema for `GlobalLexicalScopeNamesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GlobalLexicalScopeNamesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    executionContextId: Schema.optional(ExecutionContextId)
  }).annotate({ identifier: "Runtime.GlobalLexicalScopeNamesParams" })
) as any as Schema.Codec<GlobalLexicalScopeNamesParams>

/**
 * Returns all let, const and class variables from global scope.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GlobalLexicalScopeNamesResult {
  readonly names: ReadonlyArray<string>
}

/**
 * Schema for `GlobalLexicalScopeNamesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GlobalLexicalScopeNamesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    names: Schema.Array(Schema.String)
  }).annotate({ identifier: "Runtime.GlobalLexicalScopeNamesResult" })
) as any as Schema.Codec<GlobalLexicalScopeNamesResult>

/**
 * Issued when object should be inspected (for example, as a result of inspect() command line API
 * call).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InspectRequestedParams {
  readonly object: RemoteObject
  readonly hints: { readonly [key: string]: unknown }
  /**
   * Identifier of the context where the call was made.
   */
  readonly executionContextId?: ExecutionContextId | undefined
}

/**
 * Schema for `InspectRequestedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InspectRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    object: RemoteObject,
    hints: Schema.Record(Schema.String, Schema.Unknown),
    executionContextId: Schema.optional(ExecutionContextId)
  }).annotate({ identifier: "Runtime.InspectRequestedParams" })
) as any as Schema.Codec<InspectRequestedParams>

/**
 * `queryObjects.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface QueryObjectsParams {
  /**
   * Identifier of the prototype to return objects for.
   */
  readonly prototypeObjectId: RemoteObjectId
  /**
   * Symbolic group name that can be used to release the results.
   */
  readonly objectGroup?: string | undefined
}

/**
 * Schema for `QueryObjectsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const QueryObjectsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    prototypeObjectId: RemoteObjectId,
    objectGroup: Schema.optional(Schema.String)
  }).annotate({ identifier: "Runtime.QueryObjectsParams" })
) as any as Schema.Codec<QueryObjectsParams>

/**
 * `queryObjects.Result`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface QueryObjectsResult {
  /**
   * Array with objects.
   */
  readonly objects: RemoteObject
}

/**
 * Schema for `QueryObjectsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const QueryObjectsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objects: RemoteObject
  }).annotate({ identifier: "Runtime.QueryObjectsResult" })
) as any as Schema.Codec<QueryObjectsResult>

/**
 * Releases remote object with given id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReleaseObjectParams {
  /**
   * Identifier of the object to release.
   */
  readonly objectId: RemoteObjectId
}

/**
 * Schema for `ReleaseObjectParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReleaseObjectParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: RemoteObjectId
  }).annotate({ identifier: "Runtime.ReleaseObjectParams" })
) as any as Schema.Codec<ReleaseObjectParams>

/**
 * Releases all remote objects that belong to a given group.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReleaseObjectGroupParams {
  /**
   * Symbolic object group name.
   */
  readonly objectGroup: string
}

/**
 * Schema for `ReleaseObjectGroupParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReleaseObjectGroupParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectGroup: Schema.String
  }).annotate({ identifier: "Runtime.ReleaseObjectGroupParams" })
) as any as Schema.Codec<ReleaseObjectGroupParams>

/**
 * This method does not remove binding function from global object but
 * unsubscribes current runtime agent from Runtime.bindingCalled notifications.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoveBindingParams {
  readonly name: string
}

/**
 * Schema for `RemoveBindingParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoveBindingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String
  }).annotate({ identifier: "Runtime.RemoveBindingParams" })
) as any as Schema.Codec<RemoveBindingParams>

/**
 * Runs script with given id in a given context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RunScriptParams {
  /**
   * Id of the script to run.
   */
  readonly scriptId: ScriptId
  /**
   * Specifies in which execution context to perform script run. If the parameter is omitted the
   * evaluation will be performed in the context of the inspected page.
   */
  readonly executionContextId?: ExecutionContextId | undefined
  /**
   * Symbolic group name that can be used to release multiple objects.
   */
  readonly objectGroup?: string | undefined
  /**
   * In silent mode exceptions thrown during evaluation are not reported and do not pause
   * execution. Overrides `setPauseOnException` state.
   */
  readonly silent?: boolean | undefined
  /**
   * Determines whether Command Line API should be available during the evaluation.
   */
  readonly includeCommandLineAPI?: boolean | undefined
  /**
   * Whether the result is expected to be a JSON object which should be sent by value.
   */
  readonly returnByValue?: boolean | undefined
  /**
   * Whether preview should be generated for the result.
   */
  readonly generatePreview?: boolean | undefined
  /**
   * Whether execution should `await` for resulting value and return once awaited promise is
   * resolved.
   */
  readonly awaitPromise?: boolean | undefined
}

/**
 * Schema for `RunScriptParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RunScriptParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scriptId: ScriptId,
    executionContextId: Schema.optional(ExecutionContextId),
    objectGroup: Schema.optional(Schema.String),
    silent: Schema.optional(Schema.Boolean),
    includeCommandLineAPI: Schema.optional(Schema.Boolean),
    returnByValue: Schema.optional(Schema.Boolean),
    generatePreview: Schema.optional(Schema.Boolean),
    awaitPromise: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.RunScriptParams" })
) as any as Schema.Codec<RunScriptParams>

/**
 * Runs script with given id in a given context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RunScriptResult {
  /**
   * Run result.
   */
  readonly result: RemoteObject
  /**
   * Exception details.
   */
  readonly exceptionDetails?: ExceptionDetails | undefined
}

/**
 * Schema for `RunScriptResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RunScriptResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: RemoteObject,
    exceptionDetails: Schema.optional(ExceptionDetails)
  }).annotate({ identifier: "Runtime.RunScriptResult" })
) as any as Schema.Codec<RunScriptResult>

/**
 * Enables or disables async call stacks tracking.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetAsyncCallStackDepthParams {
  /**
   * Maximum depth of async call stacks. Setting to `0` will effectively disable collecting async
   * call stacks (default).
   */
  readonly maxDepth: number
}

/**
 * Schema for `SetAsyncCallStackDepthParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetAsyncCallStackDepthParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    maxDepth: Schema.Int
  }).annotate({ identifier: "Runtime.SetAsyncCallStackDepthParams" })
) as any as Schema.Codec<SetAsyncCallStackDepthParams>

/**
 * `setCustomObjectFormatterEnabled.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetCustomObjectFormatterEnabledParams {
  readonly enabled: boolean
}

/**
 * Schema for `SetCustomObjectFormatterEnabledParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetCustomObjectFormatterEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "Runtime.SetCustomObjectFormatterEnabledParams" })
) as any as Schema.Codec<SetCustomObjectFormatterEnabledParams>

/**
 * `setMaxCallStackSizeToCapture.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetMaxCallStackSizeToCaptureParams {
  readonly size: number
}

/**
 * Schema for `SetMaxCallStackSizeToCaptureParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetMaxCallStackSizeToCaptureParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    size: Schema.Int
  }).annotate({ identifier: "Runtime.SetMaxCallStackSizeToCaptureParams" })
) as any as Schema.Codec<SetMaxCallStackSizeToCaptureParams>

/**
 * If executionContextId is empty, adds binding with the given name on the
 * global objects of all inspected contexts, including those created later,
 * bindings survive reloads.
 * Binding function takes exactly one argument, this argument should be string,
 * in case of any other input, function throws an exception.
 * Each binding function call produces Runtime.bindingCalled notification.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const addBinding: Protocol.CommandDef<"Runtime.addBinding", AddBindingParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Runtime.addBinding",
    AddBindingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Add handler to promise with given promise object id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const awaitPromise: Protocol.CommandDef<"Runtime.awaitPromise", AwaitPromiseParams, AwaitPromiseResult> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.awaitPromise",
    AwaitPromiseParams,
    AwaitPromiseResult,
    { status: "stable" }
  )

/**
 * Calls function with given declaration on the given object. Object group of the result is
 * inherited from the target object.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const callFunctionOn: Protocol.CommandDef<"Runtime.callFunctionOn", CallFunctionOnParams, CallFunctionOnResult> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.callFunctionOn",
    CallFunctionOnParams,
    CallFunctionOnResult,
    {
      status: "stable",
      createsResource: true,
      release: [{ method: "Runtime.releaseObject", param: "objectId", from: "/result/objectId" }, {
        method: "Runtime.releaseObject",
        param: "objectId",
        from: "/exceptionDetails/exception/objectId"
      }]
    }
  )

/**
 * Compiles expression.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const compileScript: Protocol.CommandDef<"Runtime.compileScript", CompileScriptParams, CompileScriptResult> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.compileScript",
    CompileScriptParams,
    CompileScriptResult,
    {
      status: "stable",
      createsResource: true,
      release: [{ method: "Runtime.releaseObject", param: "objectId", from: "/exceptionDetails/exception/objectId" }]
    }
  )

/**
 * Disables reporting of execution contexts creation.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Runtime.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Runtime.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Discards collected exceptions and console API calls.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const discardConsoleEntries: Protocol.CommandDef<"Runtime.discardConsoleEntries", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.discardConsoleEntries",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Enables reporting of execution contexts creation by means of `executionContextCreated` event.
 * When the reporting gets enabled the event will be sent immediately for each existing execution
 * context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Runtime.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Runtime.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Evaluates expression on global object.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const evaluate: Protocol.CommandDef<"Runtime.evaluate", EvaluateParams, EvaluateResult> = /*#__PURE__*/ Protocol
  .command(
    "Runtime.evaluate",
    EvaluateParams,
    EvaluateResult,
    {
      status: "stable",
      createsResource: true,
      release: [{ method: "Runtime.releaseObject", param: "objectId", from: "/result/objectId" }, {
        method: "Runtime.releaseObject",
        param: "objectId",
        from: "/exceptionDetails/exception/objectId"
      }]
    }
  )

/**
 * This method tries to lookup and populate exception details for a
 * JavaScript Error object.
 * Note that the stackTrace portion of the resulting exceptionDetails will
 * only be populated if the Runtime domain was enabled at the time when the
 * Error was thrown.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getExceptionDetails: Protocol.CommandDef<
  "Runtime.getExceptionDetails",
  GetExceptionDetailsParams,
  GetExceptionDetailsResult
> = /*#__PURE__*/ Protocol.command(
  "Runtime.getExceptionDetails",
  GetExceptionDetailsParams,
  GetExceptionDetailsResult,
  { status: "experimental" }
)

/**
 * Returns the JavaScript heap usage.
 * It is the total usage of the corresponding isolate not scoped to a particular Runtime.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getHeapUsage: Protocol.CommandDef<"Runtime.getHeapUsage", void, GetHeapUsageResult> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.getHeapUsage",
    undefined,
    GetHeapUsageResult,
    { status: "experimental" }
  )

/**
 * Returns the isolate id.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getIsolateId: Protocol.CommandDef<"Runtime.getIsolateId", void, GetIsolateIdResult> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.getIsolateId",
    undefined,
    GetIsolateIdResult,
    { status: "experimental" }
  )

/**
 * Returns properties of a given object. Object group of the result is inherited from the target
 * object.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getProperties: Protocol.CommandDef<"Runtime.getProperties", GetPropertiesParams, GetPropertiesResult> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.getProperties",
    GetPropertiesParams,
    GetPropertiesResult,
    {
      status: "stable",
      createsResource: true,
      release: [
        { method: "Runtime.releaseObject", param: "objectId", from: "/result/*/value/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/result/*/get/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/result/*/set/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/result/*/symbol/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/internalProperties/*/value/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/privateProperties/*/value/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/privateProperties/*/get/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/privateProperties/*/set/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/exceptionDetails/exception/objectId" }
      ]
    }
  )

/**
 * Returns all let, const and class variables from global scope.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const globalLexicalScopeNames: Protocol.CommandDef<
  "Runtime.globalLexicalScopeNames",
  GlobalLexicalScopeNamesParams,
  GlobalLexicalScopeNamesResult
> = /*#__PURE__*/ Protocol.command(
  "Runtime.globalLexicalScopeNames",
  GlobalLexicalScopeNamesParams,
  GlobalLexicalScopeNamesResult,
  { status: "stable" }
)

/**
 * Sends `Runtime.queryObjects`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const queryObjects: Protocol.CommandDef<"Runtime.queryObjects", QueryObjectsParams, QueryObjectsResult> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.queryObjects",
    QueryObjectsParams,
    QueryObjectsResult,
    { status: "stable" }
  )

/**
 * Releases remote object with given id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const releaseObject: Protocol.CommandDef<"Runtime.releaseObject", ReleaseObjectParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.releaseObject",
    ReleaseObjectParams,
    undefined,
    { status: "stable" }
  )

/**
 * Releases all remote objects that belong to a given group.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const releaseObjectGroup: Protocol.CommandDef<"Runtime.releaseObjectGroup", ReleaseObjectGroupParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.releaseObjectGroup",
    ReleaseObjectGroupParams,
    undefined,
    { status: "stable" }
  )

/**
 * This method does not remove binding function from global object but
 * unsubscribes current runtime agent from Runtime.bindingCalled notifications.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removeBinding: Protocol.CommandDef<"Runtime.removeBinding", RemoveBindingParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.removeBinding",
    RemoveBindingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Tells inspected instance to run if it was waiting for debugger to attach.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const runIfWaitingForDebugger: Protocol.CommandDef<"Runtime.runIfWaitingForDebugger", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.runIfWaitingForDebugger",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Runs script with given id in a given context.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const runScript: Protocol.CommandDef<"Runtime.runScript", RunScriptParams, RunScriptResult> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.runScript",
    RunScriptParams,
    RunScriptResult,
    { status: "stable" }
  )

/**
 * Enables or disables async call stacks tracking.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setAsyncCallStackDepth: Protocol.CommandDef<
  "Runtime.setAsyncCallStackDepth",
  SetAsyncCallStackDepthParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Runtime.setAsyncCallStackDepth",
  SetAsyncCallStackDepthParams,
  undefined,
  { status: "stable", redirect: "Debugger" }
)

/**
 * Sends `Runtime.setCustomObjectFormatterEnabled`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setCustomObjectFormatterEnabled: Protocol.CommandDef<
  "Runtime.setCustomObjectFormatterEnabled",
  SetCustomObjectFormatterEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Runtime.setCustomObjectFormatterEnabled",
  SetCustomObjectFormatterEnabledParams,
  undefined,
  { status: "experimental" }
)

/**
 * Sends `Runtime.setMaxCallStackSizeToCapture`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setMaxCallStackSizeToCapture: Protocol.CommandDef<
  "Runtime.setMaxCallStackSizeToCapture",
  SetMaxCallStackSizeToCaptureParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Runtime.setMaxCallStackSizeToCapture",
  SetMaxCallStackSizeToCaptureParams,
  undefined,
  { status: "experimental" }
)

/**
 * Terminate current or next JavaScript execution.
 * Will cancel the termination when the outer-most script execution ends.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const terminateExecution: Protocol.CommandDef<"Runtime.terminateExecution", void, void> = /*#__PURE__*/ Protocol
  .command(
    "Runtime.terminateExecution",
    undefined,
    undefined,
    { status: "experimental" }
  )

/**
 * Notification is issued every time when binding is called.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const bindingCalled: Protocol.EventDef<"Runtime.bindingCalled", BindingCalledParams> = /*#__PURE__*/ Protocol
  .event(
    "Runtime.bindingCalled",
    BindingCalledParams,
    { status: "experimental" }
  )

/**
 * Issued when console API was called.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const consoleAPICalled: Protocol.EventDef<"Runtime.consoleAPICalled", ConsoleAPICalledParams> =
  /*#__PURE__*/ Protocol.event(
    "Runtime.consoleAPICalled",
    ConsoleAPICalledParams,
    { status: "stable" }
  )

/**
 * Issued when unhandled exception was revoked.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const exceptionRevoked: Protocol.EventDef<"Runtime.exceptionRevoked", ExceptionRevokedParams> =
  /*#__PURE__*/ Protocol.event(
    "Runtime.exceptionRevoked",
    ExceptionRevokedParams,
    { status: "stable" }
  )

/**
 * Issued when exception was thrown and unhandled.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const exceptionThrown: Protocol.EventDef<"Runtime.exceptionThrown", ExceptionThrownParams> =
  /*#__PURE__*/ Protocol.event(
    "Runtime.exceptionThrown",
    ExceptionThrownParams,
    { status: "stable" }
  )

/**
 * Issued when new execution context is created.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const executionContextCreated: Protocol.EventDef<
  "Runtime.executionContextCreated",
  ExecutionContextCreatedParams
> = /*#__PURE__*/ Protocol.event(
  "Runtime.executionContextCreated",
  ExecutionContextCreatedParams,
  { status: "stable" }
)

/**
 * Issued when execution context is destroyed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const executionContextDestroyed: Protocol.EventDef<
  "Runtime.executionContextDestroyed",
  ExecutionContextDestroyedParams
> = /*#__PURE__*/ Protocol.event(
  "Runtime.executionContextDestroyed",
  ExecutionContextDestroyedParams,
  { status: "stable" }
)

/**
 * Issued when all executionContexts were cleared in browser
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const executionContextsCleared: Protocol.EventDef<"Runtime.executionContextsCleared", void> =
  /*#__PURE__*/ Protocol.event(
    "Runtime.executionContextsCleared",
    undefined,
    { status: "stable" }
  )

/**
 * Issued when object should be inspected (for example, as a result of inspect() command line API
 * call).
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const inspectRequested: Protocol.EventDef<"Runtime.inspectRequested", InspectRequestedParams> =
  /*#__PURE__*/ Protocol.event(
    "Runtime.inspectRequested",
    InspectRequestedParams,
    { status: "stable" }
  )
