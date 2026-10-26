/**
 * Runtime domain exposes JavaScript runtime by means of remote evaluation and mirror objects. Evaluation results are returned as mirror object that expose object type, string representation and unique identifier that can be used for further object reference. Original objects are maintained in memory unless they are either explicitly released or are released along with the other objects in their object group.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Network from "./Network.ts"

/**
 * From Wikipedia: a basic block is a portion of the code within a program with only one entry point and only one exit point. This type gives the location of a basic block and if that basic block has executed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BasicBlock {
  /**
   * Start offset of the basic block.
   */
  readonly startOffset: number
  /**
   * End offset of the basic block.
   */
  readonly endOffset: number
  /**
   * Indicates if the basic block has executed before.
   */
  readonly hasExecuted: boolean
  /**
   * Indicates how many times the basic block has executed.
   */
  readonly executionCount: number
}

/**
 * Schema for `BasicBlock`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BasicBlock = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    startOffset: Schema.Int,
    endOffset: Schema.Int,
    hasExecuted: Schema.Boolean,
    executionCount: Schema.Int
  }).annotate({ identifier: "Runtime.BasicBlock" })
) as any as Schema.Codec<BasicBlock>

/**
 * Represents function call argument. Either remote object id <code>objectId</code> or primitive <code>value</code> or neither of (for undefined) them should be specified.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CallArgument {
  /**
   * Primitive value.
   */
  readonly value?: unknown | undefined
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
    objectId: Schema.optional(RemoteObjectId)
  }).annotate({ identifier: "Runtime.CallArgument" })
) as any as Schema.Codec<CallArgument>

/**
 * `CollectionEntry`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CollectionEntry {
  /**
   * Entry key of a map-like collection, otherwise not provided.
   */
  readonly key?: RemoteObject | undefined
  /**
   * Entry value.
   */
  readonly value: RemoteObject
}

/**
 * Schema for `CollectionEntry`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CollectionEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    key: Schema.optional(RemoteObject),
    value: RemoteObject
  }).annotate({ identifier: "Runtime.CollectionEntry" })
) as any as Schema.Codec<CollectionEntry>

/**
 * `EntryPreview`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EntryPreview {
  /**
   * Entry key. Specified for map-like collection entries.
   */
  readonly key?: ObjectPreview | undefined
  /**
   * Entry value.
   */
  readonly value: ObjectPreview
}

/**
 * Schema for `EntryPreview`.
 *
 * @stability unstable
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
 * Range of an error in source code.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ErrorRange {
  /**
   * Start offset of range (inclusive).
   */
  readonly startOffset: number
  /**
   * End offset of range (exclusive).
   */
  readonly endOffset: number
}

/**
 * Schema for `ErrorRange`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ErrorRange = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    startOffset: Schema.Int,
    endOffset: Schema.Int
  }).annotate({ identifier: "Runtime.ErrorRange" })
) as any as Schema.Codec<ErrorRange>

/**
 * Description of an isolated world.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExecutionContextDescription {
  /**
   * Unique id of the execution context. It can be used to specify in which execution context script evaluation should be performed.
   */
  readonly id: ExecutionContextId
  readonly type: ExecutionContextType
  /**
   * Human readable name describing given context.
   */
  readonly name: string
  /**
   * Id of the owning frame.
   */
  readonly frameId: Network.FrameId
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
    type: ExecutionContextType,
    name: Schema.String,
    frameId: Network.FrameId
  }).annotate({ identifier: "Runtime.ExecutionContextDescription" })
) as any as Schema.Codec<ExecutionContextDescription>

/**
 * Id of an execution context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ExecutionContextId = Brand.Branded<
  number,
  "~@usestrider/browser/webkit-stock-protocol/Runtime/ExecutionContextId"
>

/**
 * Schema for `ExecutionContextId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExecutionContextId = /*#__PURE__*/ Schema.Int.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-stock-protocol/Runtime/ExecutionContextId")
) as any as Schema.Codec<ExecutionContextId>

/**
 * Type of the execution context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ExecutionContextType =
  | "normal"
  | "user"
  | "internal"
  | (string & {})

/**
 * Schema for `ExecutionContextType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExecutionContextType = Schema.String as any as Schema.Codec<ExecutionContextType>

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
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ObjectPreview {
  /**
   * Object type.
   */
  readonly type: ObjectPreviewType
  /**
   * Object subtype hint. Specified for <code>object</code> type values only.
   */
  readonly subtype?: ObjectPreviewSubtype | undefined
  /**
   * String representation of the object.
   */
  readonly description?: string | undefined
  /**
   * Determines whether preview is lossless (contains all information of the original object).
   */
  readonly lossless: boolean
  /**
   * True iff some of the properties of the original did not fit.
   */
  readonly overflow?: boolean | undefined
  /**
   * List of the properties.
   */
  readonly properties?: ReadonlyArray<PropertyPreview> | undefined
  /**
   * List of the entries. Specified for <code>map</code> and <code>set</code> subtype values only.
   */
  readonly entries?: ReadonlyArray<EntryPreview> | undefined
  /**
   * Size of the array/collection. Specified for array/map/set/weakmap/weakset object type values only.
   */
  readonly size?: number | undefined
}

/**
 * Schema for `ObjectPreview`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ObjectPreview = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: ObjectPreviewType,
    subtype: Schema.optional(ObjectPreviewSubtype),
    description: Schema.optional(Schema.String),
    lossless: Schema.Boolean,
    overflow: Schema.optional(Schema.Boolean),
    properties: Schema.optional(Schema.Array(PropertyPreview)),
    entries: Schema.optional(Schema.Array(EntryPreview)),
    size: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Runtime.ObjectPreview" })
) as any as Schema.Codec<ObjectPreview>

/**
 * Object subtype hint. Specified for <code>object</code> type values only.
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
  | "error"
  | "map"
  | "set"
  | "weakmap"
  | "weakset"
  | "iterator"
  | "class"
  | "proxy"
  | "weakref"
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
   * A function which serves as a getter for the property, or <code>undefined</code> if there is no getter (accessor descriptors only).
   */
  readonly get?: RemoteObject | undefined
  /**
   * A function which serves as a setter for the property, or <code>undefined</code> if there is no setter (accessor descriptors only).
   */
  readonly set?: RemoteObject | undefined
  /**
   * True if the result was thrown during the evaluation.
   */
  readonly wasThrown?: boolean | undefined
  /**
   * True if the type of this property descriptor may be changed and if the property may be deleted from the corresponding object.
   */
  readonly configurable?: boolean | undefined
  /**
   * True if this property shows up during enumeration of the properties on the corresponding object.
   */
  readonly enumerable?: boolean | undefined
  /**
   * True if the property is owned for the object.
   */
  readonly isOwn?: boolean | undefined
  /**
   * Property symbol object, if the property is a symbol.
   */
  readonly symbol?: RemoteObject | undefined
  /**
   * True if the property is a private field.
   */
  readonly isPrivate?: boolean | undefined
  /**
   * True if the property value came from a native getter.
   */
  readonly nativeGetter?: boolean | undefined
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
    wasThrown: Schema.optional(Schema.Boolean),
    configurable: Schema.optional(Schema.Boolean),
    enumerable: Schema.optional(Schema.Boolean),
    isOwn: Schema.optional(Schema.Boolean),
    symbol: Schema.optional(RemoteObject),
    isPrivate: Schema.optional(Schema.Boolean),
    nativeGetter: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.PropertyDescriptor" })
) as any as Schema.Codec<PropertyDescriptor>

/**
 * `PropertyPreview`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PropertyPreview {
  /**
   * Property name.
   */
  readonly name: string
  /**
   * Object type.
   */
  readonly type: PropertyPreviewType
  /**
   * Object subtype hint. Specified for <code>object</code> type values only.
   */
  readonly subtype?: PropertyPreviewSubtype | undefined
  /**
   * User-friendly property value string.
   */
  readonly value?: string | undefined
  /**
   * Nested value preview.
   */
  readonly valuePreview?: ObjectPreview | undefined
  /**
   * True if this is a private field.
   */
  readonly isPrivate?: boolean | undefined
  /**
   * True if this is an internal property.
   */
  readonly internal?: boolean | undefined
}

/**
 * Schema for `PropertyPreview`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PropertyPreview = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    type: PropertyPreviewType,
    subtype: Schema.optional(PropertyPreviewSubtype),
    value: Schema.optional(Schema.String),
    valuePreview: Schema.optional(ObjectPreview),
    isPrivate: Schema.optional(Schema.Boolean),
    internal: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.PropertyPreview" })
) as any as Schema.Codec<PropertyPreview>

/**
 * Object subtype hint. Specified for <code>object</code> type values only.
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
  | "error"
  | "map"
  | "set"
  | "weakmap"
  | "weakset"
  | "iterator"
  | "class"
  | "proxy"
  | "weakref"
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
 * Object type.
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
  | "bigint"
  | "accessor"
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
   * Object subtype hint. Specified for <code>object</code> <code>function</code> (for class) type values only.
   */
  readonly subtype?: RemoteObjectSubtype | undefined
  /**
   * Object class (constructor) name. Specified for <code>object</code> type values only.
   */
  readonly className?: string | undefined
  /**
   * Remote object value (in case of primitive values or JSON values if it was requested).
   */
  readonly value?: unknown | undefined
  /**
   * String representation of the object.
   */
  readonly description?: string | undefined
  /**
   * Unique object identifier (for non-primitive values).
   */
  readonly objectId?: RemoteObjectId | undefined
  /**
   * Size of the array/collection. Specified for array/map/set/weakmap/weakset object type values only.
   */
  readonly size?: number | undefined
  /**
   * Remote object for the class prototype. Specified for class object type values only.
   */
  readonly classPrototype?: RemoteObject | undefined
  /**
   * Preview containing abbreviated property values. Specified for <code>object</code> type values only.
   */
  readonly preview?: ObjectPreview | undefined
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
    description: Schema.optional(Schema.String),
    objectId: Schema.optional(RemoteObjectId),
    size: Schema.optional(Schema.Int),
    classPrototype: Schema.optional(RemoteObject),
    preview: Schema.optional(ObjectPreview)
  }).annotate({ identifier: "Runtime.RemoteObject" })
) as any as Schema.Codec<RemoteObject>

/**
 * Object subtype hint. Specified for <code>object</code> <code>function</code> (for class) type values only.
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
  | "error"
  | "map"
  | "set"
  | "weakmap"
  | "weakset"
  | "iterator"
  | "class"
  | "proxy"
  | "weakref"
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
export type RemoteObjectId = Brand.Branded<string, "~@usestrider/browser/webkit-stock-protocol/Runtime/RemoteObjectId">

/**
 * Schema for `RemoteObjectId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoteObjectId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-stock-protocol/Runtime/RemoteObjectId")
) as any as Schema.Codec<RemoteObjectId>

/**
 * `StructureDescription`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StructureDescription {
  /**
   * Array of strings, where the strings represent object properties.
   */
  readonly fields?: ReadonlyArray<string> | undefined
  /**
   * Array of strings, where the strings represent optional object properties.
   */
  readonly optionalFields?: ReadonlyArray<string> | undefined
  /**
   * Name of the constructor.
   */
  readonly constructorName?: string | undefined
  /**
   * Pointer to the StructureRepresentation of the protoype if one exists.
   */
  readonly prototypeStructure?: StructureDescription | undefined
  /**
   * If true, it indicates that the fields in this StructureDescription may be inaccurate. I.e, there might have been fields that have been deleted before it was profiled or it has fields we haven't profiled.
   */
  readonly isImprecise?: boolean | undefined
}

/**
 * Schema for `StructureDescription`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StructureDescription = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fields: Schema.optional(Schema.Array(Schema.String)),
    optionalFields: Schema.optional(Schema.Array(Schema.String)),
    constructorName: Schema.optional(Schema.String),
    prototypeStructure: Schema.optional(StructureDescription),
    isImprecise: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.StructureDescription" })
) as any as Schema.Codec<StructureDescription>

/**
 * Syntax error type: "none" for no error, "irrecoverable" for unrecoverable errors, "unterminated-literal" for when there is an unterminated literal, "recoverable" for when the expression is unfinished but valid so far.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SyntaxErrorType =
  | "none"
  | "irrecoverable"
  | "unterminated-literal"
  | "recoverable"
  | (string & {})

/**
 * Schema for `SyntaxErrorType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SyntaxErrorType = Schema.String as any as Schema.Codec<SyntaxErrorType>

/**
 * Container for type information that has been gathered.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TypeDescription {
  /**
   * If true, we were able to correlate the offset successfuly with a program location. If false, the offset may be bogus or the offset may be from a CodeBlock that hasn't executed.
   */
  readonly isValid: boolean
  /**
   * Least common ancestor of all Constructors if the TypeDescription has seen any structures. This string is the display name of the shared constructor function.
   */
  readonly leastCommonAncestor?: string | undefined
  /**
   * Set of booleans for determining the aggregate type of this type description.
   */
  readonly typeSet?: TypeSet | undefined
  /**
   * Array of descriptions for all structures seen for this variable.
   */
  readonly structures?: ReadonlyArray<StructureDescription> | undefined
  /**
   * If true, this indicates that no more structures are being profiled because some maximum threshold has been reached and profiling has stopped because of memory pressure.
   */
  readonly isTruncated?: boolean | undefined
}

/**
 * Schema for `TypeDescription`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TypeDescription = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    isValid: Schema.Boolean,
    leastCommonAncestor: Schema.optional(Schema.String),
    typeSet: Schema.optional(TypeSet),
    structures: Schema.optional(Schema.Array(StructureDescription)),
    isTruncated: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.TypeDescription" })
) as any as Schema.Codec<TypeDescription>

/**
 * Describes the location of an expression we want type information for.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TypeLocation {
  /**
   * What kind of type information do we want (normal, function return values, 'this' statement).
   */
  readonly typeInformationDescriptor: number
  /**
   * sourceID uniquely identifying a script
   */
  readonly sourceID: string
  /**
   * character offset for assignment range
   */
  readonly divot: number
}

/**
 * Schema for `TypeLocation`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TypeLocation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    typeInformationDescriptor: Schema.Int,
    sourceID: Schema.String,
    divot: Schema.Int
  }).annotate({ identifier: "Runtime.TypeLocation" })
) as any as Schema.Codec<TypeLocation>

/**
 * `TypeSet`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TypeSet {
  /**
   * Indicates if this type description has been type Function.
   */
  readonly isFunction: boolean
  /**
   * Indicates if this type description has been type Undefined.
   */
  readonly isUndefined: boolean
  /**
   * Indicates if this type description has been type Null.
   */
  readonly isNull: boolean
  /**
   * Indicates if this type description has been type Boolean.
   */
  readonly isBoolean: boolean
  /**
   * Indicates if this type description has been type Integer.
   */
  readonly isInteger: boolean
  /**
   * Indicates if this type description has been type Number.
   */
  readonly isNumber: boolean
  /**
   * Indicates if this type description has been type String.
   */
  readonly isString: boolean
  /**
   * Indicates if this type description has been type Object.
   */
  readonly isObject: boolean
  /**
   * Indicates if this type description has been type Symbol.
   */
  readonly isSymbol: boolean
  /**
   * Indicates if this type description has been type BigInt.
   */
  readonly isBigInt: boolean
}

/**
 * Schema for `TypeSet`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TypeSet = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    isFunction: Schema.Boolean,
    isUndefined: Schema.Boolean,
    isNull: Schema.Boolean,
    isBoolean: Schema.Boolean,
    isInteger: Schema.Boolean,
    isNumber: Schema.Boolean,
    isString: Schema.Boolean,
    isObject: Schema.Boolean,
    isSymbol: Schema.Boolean,
    isBigInt: Schema.Boolean
  }).annotate({ identifier: "Runtime.TypeSet" })
) as any as Schema.Codec<TypeSet>

/**
 * Calls the async callback when the promise with the given ID gets settled.
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
  /**
   * Whether the resulting value should be considered for saving in the $n history.
   */
  readonly saveResult?: boolean | undefined
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
    generatePreview: Schema.optional(Schema.Boolean),
    saveResult: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.AwaitPromiseParams" })
) as any as Schema.Codec<AwaitPromiseParams>

/**
 * Calls the async callback when the promise with the given ID gets settled.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AwaitPromiseResult {
  /**
   * Evaluation result.
   */
  readonly result: RemoteObject
  /**
   * True if the result was thrown during the evaluation.
   */
  readonly wasThrown?: boolean | undefined
  /**
   * If the result was saved, this is the $n index that can be used to access the value.
   */
  readonly savedResultIndex?: number | undefined
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
    wasThrown: Schema.optional(Schema.Boolean),
    savedResultIndex: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Runtime.AwaitPromiseResult" })
) as any as Schema.Codec<AwaitPromiseResult>

/**
 * Calls function with given declaration on the given object. Object group of the result is inherited from the target object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CallFunctionOnParams {
  /**
   * Identifier of the object to call function on.
   */
  readonly objectId: RemoteObjectId
  /**
   * Declaration of the function to call.
   */
  readonly functionDeclaration: string
  /**
   * Call arguments. All call arguments must belong to the same JavaScript world as the target object.
   */
  readonly arguments?: ReadonlyArray<CallArgument> | undefined
  /**
   * Specifies whether function call should stop on exceptions and mute console. Overrides setPauseOnException state.
   */
  readonly doNotPauseOnExceptionsAndMuteConsole?: boolean | undefined
  /**
   * Whether the result is expected to be a JSON object which should be sent by value.
   */
  readonly returnByValue?: boolean | undefined
  /**
   * Whether preview should be generated for the result.
   */
  readonly generatePreview?: boolean | undefined
  /**
   * Whether the expression should be considered to be in a user gesture or not.
   */
  readonly emulateUserGesture?: boolean | undefined
  /**
   * Whether to automatically await returned promise.
   */
  readonly awaitPromise?: boolean | undefined
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
    objectId: RemoteObjectId,
    functionDeclaration: Schema.String,
    arguments: Schema.optional(Schema.Array(CallArgument)),
    doNotPauseOnExceptionsAndMuteConsole: Schema.optional(Schema.Boolean),
    returnByValue: Schema.optional(Schema.Boolean),
    generatePreview: Schema.optional(Schema.Boolean),
    emulateUserGesture: Schema.optional(Schema.Boolean),
    awaitPromise: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.CallFunctionOnParams" })
) as any as Schema.Codec<CallFunctionOnParams>

/**
 * Calls function with given declaration on the given object. Object group of the result is inherited from the target object.
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
   * True if the result was thrown during the evaluation.
   */
  readonly wasThrown?: boolean | undefined
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
    wasThrown: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.CallFunctionOnResult" })
) as any as Schema.Codec<CallFunctionOnResult>

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
   * Specifies whether evaluation should stop on exceptions and mute console. Overrides setPauseOnException state.
   */
  readonly doNotPauseOnExceptionsAndMuteConsole?: boolean | undefined
  /**
   * Specifies in which isolated context to perform evaluation. Each content script lives in an isolated context and this parameter may be used to specify one of those contexts. If the parameter is omitted or 0 the evaluation will be performed in the context of the inspected page.
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
   * Whether the resulting value should be considered for saving in the $n history.
   */
  readonly saveResult?: boolean | undefined
  /**
   * Whether the expression should be considered to be in a user gesture or not.
   */
  readonly emulateUserGesture?: boolean | undefined
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
    doNotPauseOnExceptionsAndMuteConsole: Schema.optional(Schema.Boolean),
    contextId: Schema.optional(ExecutionContextId),
    returnByValue: Schema.optional(Schema.Boolean),
    generatePreview: Schema.optional(Schema.Boolean),
    saveResult: Schema.optional(Schema.Boolean),
    emulateUserGesture: Schema.optional(Schema.Boolean)
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
   * True if the result was thrown during the evaluation.
   */
  readonly wasThrown?: boolean | undefined
  /**
   * If the result was saved, this is the $n index that can be used to access the value.
   */
  readonly savedResultIndex?: number | undefined
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
    wasThrown: Schema.optional(Schema.Boolean),
    savedResultIndex: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Runtime.EvaluateResult" })
) as any as Schema.Codec<EvaluateResult>

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
 * Returns a list of basic blocks for the given sourceID with information about their text ranges and whether or not they have executed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetBasicBlocksParams {
  /**
   * Indicates which sourceID information is requested for.
   */
  readonly sourceID: string
}

/**
 * Schema for `GetBasicBlocksParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetBasicBlocksParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sourceID: Schema.String
  }).annotate({ identifier: "Runtime.GetBasicBlocksParams" })
) as any as Schema.Codec<GetBasicBlocksParams>

/**
 * Returns a list of basic blocks for the given sourceID with information about their text ranges and whether or not they have executed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetBasicBlocksResult {
  readonly basicBlocks: ReadonlyArray<BasicBlock>
}

/**
 * Schema for `GetBasicBlocksResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetBasicBlocksResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    basicBlocks: Schema.Array(BasicBlock)
  }).annotate({ identifier: "Runtime.GetBasicBlocksResult" })
) as any as Schema.Codec<GetBasicBlocksResult>

/**
 * Returns entries of given Map / Set collection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetCollectionEntriesParams {
  /**
   * Id of the collection to get entries for.
   */
  readonly objectId: RemoteObjectId
  /**
   * Symbolic group name that can be used to release multiple. If not provided, it will be the same objectGroup as the RemoteObject determined from <code>objectId</code>. This is useful for WeakMap to release the collection entries.
   */
  readonly objectGroup?: string | undefined
  /**
   * If provided skip to this value before collecting values. Otherwise, start at the beginning. Has no effect when the `objectId<` is for a `iterator<`/`WeakMap<`/`WeakSet<` object.
   */
  readonly fetchStart?: number | undefined
  /**
   * If provided only return `fetchCount` values. Otherwise, return values all the way to the end.
   */
  readonly fetchCount?: number | undefined
}

/**
 * Schema for `GetCollectionEntriesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetCollectionEntriesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: RemoteObjectId,
    objectGroup: Schema.optional(Schema.String),
    fetchStart: Schema.optional(Schema.Int),
    fetchCount: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Runtime.GetCollectionEntriesParams" })
) as any as Schema.Codec<GetCollectionEntriesParams>

/**
 * Returns entries of given Map / Set collection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetCollectionEntriesResult {
  /**
   * Array of collection entries.
   */
  readonly entries: ReadonlyArray<CollectionEntry>
}

/**
 * Schema for `GetCollectionEntriesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetCollectionEntriesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    entries: Schema.Array(CollectionEntry)
  }).annotate({ identifier: "Runtime.GetCollectionEntriesResult" })
) as any as Schema.Codec<GetCollectionEntriesResult>

/**
 * Returns displayable properties of a given object. Object group of the result is inherited from the target object. Displayable properties are own properties, internal properties, and native getters in the prototype chain (assumed to be bindings and treated like own properties for the frontend).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetDisplayablePropertiesParams {
  /**
   * Identifier of the object to return properties for.
   */
  readonly objectId: RemoteObjectId
  /**
   * If provided skip to this value before collecting values. Otherwise, start at the beginning. Has no effect when the `objectId` is for a `iterator`/`WeakMap`/`WeakSet` object.
   */
  readonly fetchStart?: number | undefined
  /**
   * If provided only return `fetchCount` values. Otherwise, return values all the way to the end.
   */
  readonly fetchCount?: number | undefined
  /**
   * Whether preview should be generated for property values.
   */
  readonly generatePreview?: boolean | undefined
}

/**
 * Schema for `GetDisplayablePropertiesParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetDisplayablePropertiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: RemoteObjectId,
    fetchStart: Schema.optional(Schema.Int),
    fetchCount: Schema.optional(Schema.Int),
    generatePreview: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.GetDisplayablePropertiesParams" })
) as any as Schema.Codec<GetDisplayablePropertiesParams>

/**
 * Returns displayable properties of a given object. Object group of the result is inherited from the target object. Displayable properties are own properties, internal properties, and native getters in the prototype chain (assumed to be bindings and treated like own properties for the frontend).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetDisplayablePropertiesResult {
  /**
   * Object properties.
   */
  readonly properties: ReadonlyArray<PropertyDescriptor>
  /**
   * Internal object properties. Only included if `fetchStart` is 0.
   */
  readonly internalProperties?: ReadonlyArray<InternalPropertyDescriptor> | undefined
}

/**
 * Schema for `GetDisplayablePropertiesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetDisplayablePropertiesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    properties: Schema.Array(PropertyDescriptor),
    internalProperties: Schema.optional(Schema.Array(InternalPropertyDescriptor))
  }).annotate({ identifier: "Runtime.GetDisplayablePropertiesResult" })
) as any as Schema.Codec<GetDisplayablePropertiesResult>

/**
 * Returns a preview for the given object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetPreviewParams {
  /**
   * Identifier of the object to return a preview for.
   */
  readonly objectId: RemoteObjectId
}

/**
 * Schema for `GetPreviewParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetPreviewParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: RemoteObjectId
  }).annotate({ identifier: "Runtime.GetPreviewParams" })
) as any as Schema.Codec<GetPreviewParams>

/**
 * Returns a preview for the given object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetPreviewResult {
  readonly preview: ObjectPreview
}

/**
 * Schema for `GetPreviewResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetPreviewResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    preview: ObjectPreview
  }).annotate({ identifier: "Runtime.GetPreviewResult" })
) as any as Schema.Codec<GetPreviewResult>

/**
 * Returns properties of a given object. Object group of the result is inherited from the target object.
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
   * If true, returns properties belonging only to the object itself, not to its prototype chain.
   */
  readonly ownProperties?: boolean | undefined
  /**
   * If provided skip to this value before collecting values. Otherwise, start at the beginning. Has no effect when the `objectId` is for a `iterator`/`WeakMap`/`WeakSet` object.
   */
  readonly fetchStart?: number | undefined
  /**
   * If provided only return `fetchCount` values. Otherwise, return values all the way to the end.
   */
  readonly fetchCount?: number | undefined
  /**
   * Whether preview should be generated for property values.
   */
  readonly generatePreview?: boolean | undefined
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
    fetchStart: Schema.optional(Schema.Int),
    fetchCount: Schema.optional(Schema.Int),
    generatePreview: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Runtime.GetPropertiesParams" })
) as any as Schema.Codec<GetPropertiesParams>

/**
 * Returns properties of a given object. Object group of the result is inherited from the target object.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetPropertiesResult {
  /**
   * Object properties.
   */
  readonly properties: ReadonlyArray<PropertyDescriptor>
  /**
   * Internal object properties. Only included if `fetchStart` is 0.
   */
  readonly internalProperties?: ReadonlyArray<InternalPropertyDescriptor> | undefined
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
    properties: Schema.Array(PropertyDescriptor),
    internalProperties: Schema.optional(Schema.Array(InternalPropertyDescriptor))
  }).annotate({ identifier: "Runtime.GetPropertiesResult" })
) as any as Schema.Codec<GetPropertiesResult>

/**
 * Returns detailed information on the given function.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetRuntimeTypesForVariablesAtOffsetsParams {
  /**
   * An array of type locations we're requesting information for. Results are expected in the same order they're sent in.
   */
  readonly locations: ReadonlyArray<TypeLocation>
}

/**
 * Schema for `GetRuntimeTypesForVariablesAtOffsetsParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetRuntimeTypesForVariablesAtOffsetsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    locations: Schema.Array(TypeLocation)
  }).annotate({ identifier: "Runtime.GetRuntimeTypesForVariablesAtOffsetsParams" })
) as any as Schema.Codec<GetRuntimeTypesForVariablesAtOffsetsParams>

/**
 * Returns detailed information on the given function.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetRuntimeTypesForVariablesAtOffsetsResult {
  readonly types: ReadonlyArray<TypeDescription>
}

/**
 * Schema for `GetRuntimeTypesForVariablesAtOffsetsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetRuntimeTypesForVariablesAtOffsetsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    types: Schema.Array(TypeDescription)
  }).annotate({ identifier: "Runtime.GetRuntimeTypesForVariablesAtOffsetsResult" })
) as any as Schema.Codec<GetRuntimeTypesForVariablesAtOffsetsResult>

/**
 * Parses JavaScript source code for errors.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ParseParams {
  /**
   * Source code to parse.
   */
  readonly source: string
}

/**
 * Schema for `ParseParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ParseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    source: Schema.String
  }).annotate({ identifier: "Runtime.ParseParams" })
) as any as Schema.Codec<ParseParams>

/**
 * Parses JavaScript source code for errors.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ParseResult {
  /**
   * Parse result.
   */
  readonly result: SyntaxErrorType
  /**
   * Parse error message.
   */
  readonly message?: string | undefined
  /**
   * Range in the source where the error occurred.
   */
  readonly range?: ErrorRange | undefined
}

/**
 * Schema for `ParseResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ParseResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    result: SyntaxErrorType,
    message: Schema.optional(Schema.String),
    range: Schema.optional(ErrorRange)
  }).annotate({ identifier: "Runtime.ParseResult" })
) as any as Schema.Codec<ParseResult>

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
 * Assign a saved result index to this value.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SaveResultParams {
  /**
   * Id or value of the object to save.
   */
  readonly value: CallArgument
  /**
   * Unique id of the execution context. To specify in which execution context script evaluation should be performed. If not provided, determine from the CallArgument's objectId.
   */
  readonly contextId?: ExecutionContextId | undefined
}

/**
 * Schema for `SaveResultParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SaveResultParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    value: CallArgument,
    contextId: Schema.optional(ExecutionContextId)
  }).annotate({ identifier: "Runtime.SaveResultParams" })
) as any as Schema.Codec<SaveResultParams>

/**
 * Assign a saved result index to this value.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SaveResultResult {
  /**
   * If the value was saved, this is the $n index that can be used to access the value.
   */
  readonly savedResultIndex?: number | undefined
}

/**
 * Schema for `SaveResultResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SaveResultResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    savedResultIndex: Schema.optional(Schema.Int)
  }).annotate({ identifier: "Runtime.SaveResultResult" })
) as any as Schema.Codec<SaveResultResult>

/**
 * Creates an additional reference to all saved values in the Console using the the given string as a prefix instead of $.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetSavedResultAliasParams {
  /**
   * Passing an empty/null string will clear the alias.
   */
  readonly alias?: string | undefined
}

/**
 * Schema for `SetSavedResultAliasParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetSavedResultAliasParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    alias: Schema.optional(Schema.String)
  }).annotate({ identifier: "Runtime.SetSavedResultAliasParams" })
) as any as Schema.Codec<SetSavedResultAliasParams>

/**
 * Calls the async callback when the promise with the given ID gets settled.
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
    {
      status: "stable",
      createsResource: true,
      release: [{ method: "Runtime.releaseObject", param: "objectId", from: "/result/objectId" }]
    }
  )

/**
 * Calls function with given declaration on the given object. Object group of the result is inherited from the target object.
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
      release: [{ method: "Runtime.releaseObject", param: "objectId", from: "/result/objectId" }]
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
 * Disables control flow profiling on the VM.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disableControlFlowProfiler: Protocol.CommandDef<"Runtime.disableControlFlowProfiler", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.disableControlFlowProfiler",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Disables type profiling on the VM.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disableTypeProfiler: Protocol.CommandDef<"Runtime.disableTypeProfiler", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.disableTypeProfiler",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Enables reporting of execution contexts creation by means of <code>executionContextCreated</code> event. When the reporting gets enabled the event will be sent immediately for each existing execution context.
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
 * Enables control flow profiling on the VM.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enableControlFlowProfiler: Protocol.CommandDef<"Runtime.enableControlFlowProfiler", void, void> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.enableControlFlowProfiler",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Enables type profiling on the VM.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enableTypeProfiler: Protocol.CommandDef<"Runtime.enableTypeProfiler", void, void> = /*#__PURE__*/ Protocol
  .command(
    "Runtime.enableTypeProfiler",
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
      release: [{ method: "Runtime.releaseObject", param: "objectId", from: "/result/objectId" }]
    }
  )

/**
 * Returns a list of basic blocks for the given sourceID with information about their text ranges and whether or not they have executed.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getBasicBlocks: Protocol.CommandDef<"Runtime.getBasicBlocks", GetBasicBlocksParams, GetBasicBlocksResult> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.getBasicBlocks",
    GetBasicBlocksParams,
    GetBasicBlocksResult,
    { status: "stable" }
  )

/**
 * Returns entries of given Map / Set collection.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getCollectionEntries: Protocol.CommandDef<
  "Runtime.getCollectionEntries",
  GetCollectionEntriesParams,
  GetCollectionEntriesResult
> = /*#__PURE__*/ Protocol.command(
  "Runtime.getCollectionEntries",
  GetCollectionEntriesParams,
  GetCollectionEntriesResult,
  { status: "stable" }
)

/**
 * Returns displayable properties of a given object. Object group of the result is inherited from the target object. Displayable properties are own properties, internal properties, and native getters in the prototype chain (assumed to be bindings and treated like own properties for the frontend).
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getDisplayableProperties: Protocol.CommandDef<
  "Runtime.getDisplayableProperties",
  GetDisplayablePropertiesParams,
  GetDisplayablePropertiesResult
> = /*#__PURE__*/ Protocol.command(
  "Runtime.getDisplayableProperties",
  GetDisplayablePropertiesParams,
  GetDisplayablePropertiesResult,
  { status: "stable" }
)

/**
 * Returns a preview for the given object.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getPreview: Protocol.CommandDef<"Runtime.getPreview", GetPreviewParams, GetPreviewResult> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.getPreview",
    GetPreviewParams,
    GetPreviewResult,
    { status: "stable" }
  )

/**
 * Returns properties of a given object. Object group of the result is inherited from the target object.
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
        { method: "Runtime.releaseObject", param: "objectId", from: "/properties/*/value/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/properties/*/get/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/properties/*/set/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/properties/*/symbol/objectId" },
        { method: "Runtime.releaseObject", param: "objectId", from: "/internalProperties/*/value/objectId" }
      ]
    }
  )

/**
 * Returns detailed information on the given function.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getRuntimeTypesForVariablesAtOffsets: Protocol.CommandDef<
  "Runtime.getRuntimeTypesForVariablesAtOffsets",
  GetRuntimeTypesForVariablesAtOffsetsParams,
  GetRuntimeTypesForVariablesAtOffsetsResult
> = /*#__PURE__*/ Protocol.command(
  "Runtime.getRuntimeTypesForVariablesAtOffsets",
  GetRuntimeTypesForVariablesAtOffsetsParams,
  GetRuntimeTypesForVariablesAtOffsetsResult,
  { status: "stable" }
)

/**
 * Parses JavaScript source code for errors.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const parse: Protocol.CommandDef<"Runtime.parse", ParseParams, ParseResult> = /*#__PURE__*/ Protocol.command(
  "Runtime.parse",
  ParseParams,
  ParseResult,
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
 * Assign a saved result index to this value.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const saveResult: Protocol.CommandDef<"Runtime.saveResult", SaveResultParams, SaveResultResult> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.saveResult",
    SaveResultParams,
    SaveResultResult,
    { status: "stable" }
  )

/**
 * Creates an additional reference to all saved values in the Console using the the given string as a prefix instead of $.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setSavedResultAlias: Protocol.CommandDef<"Runtime.setSavedResultAlias", SetSavedResultAliasParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Runtime.setSavedResultAlias",
    SetSavedResultAliasParams,
    undefined,
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
