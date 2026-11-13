/**
 * The script module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08), and the Permissions spec's module. Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Browser from "./Browser.ts"
import * as BrowsingContext from "./BrowsingContext.ts"

/**
 * `AddPreloadScriptParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddPreloadScriptParameters {
  readonly functionDeclaration: string
  readonly arguments?: ReadonlyArray<ChannelValue> | undefined
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
  readonly sandbox?: string | undefined
}

/**
 * Schema for `AddPreloadScriptParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddPreloadScriptParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    functionDeclaration: Schema.String,
    arguments: Schema.optional(Schema.Array(ChannelValue)),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext)),
    sandbox: Schema.optional(Schema.String)
  }).annotate({ identifier: "script.AddPreloadScriptParameters" })
) as any as Schema.Codec<AddPreloadScriptParameters>

/**
 * `AddPreloadScriptResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddPreloadScriptResult {
  readonly script: PreloadScript
}

/**
 * Schema for `AddPreloadScriptResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddPreloadScriptResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    script: PreloadScript
  }).annotate({ identifier: "script.AddPreloadScriptResult" })
) as any as Schema.Codec<AddPreloadScriptResult>

/**
 * `ArrayBufferRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ArrayBufferRemoteValue {
  readonly type: "arraybuffer"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `ArrayBufferRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ArrayBufferRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("arraybuffer"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.ArrayBufferRemoteValue" })
) as any as Schema.Codec<ArrayBufferRemoteValue>

/**
 * `ArrayLocalValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ArrayLocalValue {
  readonly type: "array"
  readonly value: ListLocalValue
}

/**
 * Schema for `ArrayLocalValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ArrayLocalValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("array"),
    value: ListLocalValue
  }).annotate({ identifier: "script.ArrayLocalValue" })
) as any as Schema.Codec<ArrayLocalValue>

/**
 * `ArrayRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ArrayRemoteValue {
  readonly type: "array"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
  readonly value?: ListRemoteValue | undefined
}

/**
 * Schema for `ArrayRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ArrayRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("array"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId),
    value: Schema.optional(ListRemoteValue)
  }).annotate({ identifier: "script.ArrayRemoteValue" })
) as any as Schema.Codec<ArrayRemoteValue>

/**
 * `AudioWorkletRealmInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AudioWorkletRealmInfo {
  readonly realm: Realm
  readonly origin: string
  readonly type: "audio-worklet"
}

/**
 * Schema for `AudioWorkletRealmInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AudioWorkletRealmInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realm: Realm,
    origin: Schema.String,
    type: Schema.Literal("audio-worklet")
  }).annotate({ identifier: "script.AudioWorkletRealmInfo" })
) as any as Schema.Codec<AudioWorkletRealmInfo>

/**
 * `BigIntValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BigIntValue {
  readonly type: "bigint"
  readonly value: string
}

/**
 * Schema for `BigIntValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BigIntValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("bigint"),
    value: Schema.String
  }).annotate({ identifier: "script.BigIntValue" })
) as any as Schema.Codec<BigIntValue>

/**
 * `BooleanValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface BooleanValue {
  readonly type: "boolean"
  readonly value: boolean
}

/**
 * Schema for `BooleanValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BooleanValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("boolean"),
    value: Schema.Boolean
  }).annotate({ identifier: "script.BooleanValue" })
) as any as Schema.Codec<BooleanValue>

/**
 * `CallFunctionParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CallFunctionParameters {
  readonly functionDeclaration: string
  readonly awaitPromise: boolean
  readonly target: Target
  readonly arguments?: ReadonlyArray<LocalValue> | undefined
  readonly resultOwnership?: ResultOwnership | undefined
  readonly serializationOptions?: SerializationOptions | undefined
  readonly this?: LocalValue | undefined
  readonly userActivation?: boolean | undefined
}

/**
 * Schema for `CallFunctionParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CallFunctionParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    functionDeclaration: Schema.String,
    awaitPromise: Schema.Boolean,
    target: Target,
    arguments: Schema.optional(Schema.Array(LocalValue)),
    resultOwnership: Schema.optional(ResultOwnership),
    serializationOptions: Schema.optional(SerializationOptions),
    this: Schema.optional(LocalValue),
    userActivation: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "script.CallFunctionParameters" })
) as any as Schema.Codec<CallFunctionParameters>

/**
 * `CallFunctionResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CallFunctionResult = EvaluationResult

/**
 * Schema for `CallFunctionResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CallFunctionResult = /*#__PURE__*/ Schema.suspend(() => EvaluationResult) as any as Schema.Codec<
  CallFunctionResult
>

/**
 * `Channel`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Channel = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Script/Channel">

/**
 * Schema for `Channel`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Channel = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Script/Channel")
) as any as Schema.Codec<Channel>

/**
 * `ChannelProperties`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ChannelProperties {
  readonly channel: Channel
  readonly serializationOptions?: SerializationOptions | undefined
  readonly ownership?: ResultOwnership | undefined
}

/**
 * Schema for `ChannelProperties`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ChannelProperties = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    channel: Channel,
    serializationOptions: Schema.optional(SerializationOptions),
    ownership: Schema.optional(ResultOwnership)
  }).annotate({ identifier: "script.ChannelProperties" })
) as any as Schema.Codec<ChannelProperties>

/**
 * `ChannelValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ChannelValue {
  readonly type: "channel"
  readonly value: ChannelProperties
}

/**
 * Schema for `ChannelValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ChannelValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("channel"),
    value: ChannelProperties
  }).annotate({ identifier: "script.ChannelValue" })
) as any as Schema.Codec<ChannelValue>

/**
 * `ContextTarget`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ContextTarget {
  readonly context: BrowsingContext.BrowsingContext
  readonly sandbox?: string | undefined
}

/**
 * Schema for `ContextTarget`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ContextTarget = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext.BrowsingContext,
    sandbox: Schema.optional(Schema.String)
  }).annotate({ identifier: "script.ContextTarget" })
) as any as Schema.Codec<ContextTarget>

/**
 * `DateRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DateRemoteValue {
  readonly type: "date"
  readonly value: string
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `DateRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DateRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("date"),
    value: Schema.String,
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.DateRemoteValue" })
) as any as Schema.Codec<DateRemoteValue>

/**
 * `DedicatedWorkerRealmInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DedicatedWorkerRealmInfo {
  readonly realm: Realm
  readonly origin: string
  readonly type: "dedicated-worker"
  readonly owners: readonly [Realm]
}

/**
 * Schema for `DedicatedWorkerRealmInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DedicatedWorkerRealmInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realm: Realm,
    origin: Schema.String,
    type: Schema.Literal("dedicated-worker"),
    owners: Schema.Tuple([Realm])
  }).annotate({ identifier: "script.DedicatedWorkerRealmInfo" })
) as any as Schema.Codec<DedicatedWorkerRealmInfo>

/**
 * `DisownParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DisownParameters {
  readonly handles: ReadonlyArray<Handle>
  readonly target: Target
}

/**
 * Schema for `DisownParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DisownParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handles: Schema.Array(Handle),
    target: Target
  }).annotate({ identifier: "script.DisownParameters" })
) as any as Schema.Codec<DisownParameters>

/**
 * `DisownResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DisownResult = { readonly [key: string]: unknown }

/**
 * Schema for `DisownResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DisownResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<DisownResult>

/**
 * `ErrorRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ErrorRemoteValue {
  readonly type: "error"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `ErrorRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ErrorRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("error"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.ErrorRemoteValue" })
) as any as Schema.Codec<ErrorRemoteValue>

/**
 * `EvaluateParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EvaluateParameters {
  readonly expression: string
  readonly target: Target
  readonly awaitPromise: boolean
  readonly resultOwnership?: ResultOwnership | undefined
  readonly serializationOptions?: SerializationOptions | undefined
  readonly userActivation?: boolean | undefined
}

/**
 * Schema for `EvaluateParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluateParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    expression: Schema.String,
    target: Target,
    awaitPromise: Schema.Boolean,
    resultOwnership: Schema.optional(ResultOwnership),
    serializationOptions: Schema.optional(SerializationOptions),
    userActivation: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "script.EvaluateParameters" })
) as any as Schema.Codec<EvaluateParameters>

/**
 * `EvaluateResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type EvaluateResult = EvaluationResult

/**
 * Schema for `EvaluateResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluateResult = /*#__PURE__*/ Schema.suspend(() => EvaluationResult) as any as Schema.Codec<
  EvaluateResult
>

/**
 * `EvaluationResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type EvaluationResult = EvaluationResultSuccess | EvaluationResultException

/**
 * Schema for `EvaluationResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluationResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([EvaluationResultSuccess, EvaluationResultException])
) as any as Schema.Codec<EvaluationResult>

/**
 * `EvaluationResultException`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EvaluationResultException {
  readonly type: "exception"
  readonly exceptionDetails: ExceptionDetails
  readonly realm: Realm
}

/**
 * Schema for `EvaluationResultException`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluationResultException = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("exception"),
    exceptionDetails: ExceptionDetails,
    realm: Realm
  }).annotate({ identifier: "script.EvaluationResultException" })
) as any as Schema.Codec<EvaluationResultException>

/**
 * `EvaluationResultSuccess`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EvaluationResultSuccess {
  readonly type: "success"
  readonly result: RemoteValue
  readonly realm: Realm
}

/**
 * Schema for `EvaluationResultSuccess`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EvaluationResultSuccess = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("success"),
    result: RemoteValue,
    realm: Realm
  }).annotate({ identifier: "script.EvaluationResultSuccess" })
) as any as Schema.Codec<EvaluationResultSuccess>

/**
 * `ExceptionDetails`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExceptionDetails {
  readonly columnNumber: number
  readonly exception: RemoteValue
  readonly lineNumber: number
  readonly stackTrace: StackTrace
  readonly text: string
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
    columnNumber: Schema.Int,
    exception: RemoteValue,
    lineNumber: Schema.Int,
    stackTrace: StackTrace,
    text: Schema.String
  }).annotate({ identifier: "script.ExceptionDetails" })
) as any as Schema.Codec<ExceptionDetails>

/**
 * `FunctionRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FunctionRemoteValue {
  readonly type: "function"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `FunctionRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FunctionRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("function"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.FunctionRemoteValue" })
) as any as Schema.Codec<FunctionRemoteValue>

/**
 * `GeneratorRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GeneratorRemoteValue {
  readonly type: "generator"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `GeneratorRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GeneratorRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("generator"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.GeneratorRemoteValue" })
) as any as Schema.Codec<GeneratorRemoteValue>

/**
 * `GetRealmsParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetRealmsParameters {
  readonly context?: BrowsingContext.BrowsingContext | undefined
  readonly type?: RealmType | undefined
}

/**
 * Schema for `GetRealmsParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetRealmsParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: Schema.optional(BrowsingContext.BrowsingContext),
    type: Schema.optional(RealmType)
  }).annotate({ identifier: "script.GetRealmsParameters" })
) as any as Schema.Codec<GetRealmsParameters>

/**
 * `GetRealmsResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetRealmsResult {
  readonly realms: ReadonlyArray<RealmInfo>
}

/**
 * Schema for `GetRealmsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetRealmsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realms: Schema.Array(RealmInfo)
  }).annotate({ identifier: "script.GetRealmsResult" })
) as any as Schema.Codec<GetRealmsResult>

/**
 * `HTMLCollectionRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HTMLCollectionRemoteValue {
  readonly type: "htmlcollection"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
  readonly value?: ListRemoteValue | undefined
}

/**
 * Schema for `HTMLCollectionRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HTMLCollectionRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("htmlcollection"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId),
    value: Schema.optional(ListRemoteValue)
  }).annotate({ identifier: "script.HTMLCollectionRemoteValue" })
) as any as Schema.Codec<HTMLCollectionRemoteValue>

/**
 * `Handle`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Handle = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Script/Handle">

/**
 * Schema for `Handle`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Handle = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Script/Handle")
) as any as Schema.Codec<Handle>

/**
 * `InternalId`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type InternalId = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Script/InternalId">

/**
 * Schema for `InternalId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InternalId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Script/InternalId")
) as any as Schema.Codec<InternalId>

/**
 * `ListLocalValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ListLocalValue = ReadonlyArray<LocalValue>

/**
 * Schema for `ListLocalValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ListLocalValue = /*#__PURE__*/ Schema.suspend(() => Schema.Array(LocalValue)) as any as Schema.Codec<
  ListLocalValue
>

/**
 * `ListRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ListRemoteValue = ReadonlyArray<RemoteValue>

/**
 * Schema for `ListRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ListRemoteValue = /*#__PURE__*/ Schema.suspend(() => Schema.Array(RemoteValue)) as any as Schema.Codec<
  ListRemoteValue
>

/**
 * `LocalValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LocalValue =
  | RemoteReference
  | PrimitiveProtocolValue
  | ChannelValue
  | ArrayLocalValue
  | LocalValueOption5
  | MapLocalValue
  | ObjectLocalValue
  | LocalValueOption8
  | SetLocalValue

/**
 * Schema for `LocalValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LocalValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([
    RemoteReference,
    PrimitiveProtocolValue,
    ChannelValue,
    ArrayLocalValue,
    LocalValueOption5,
    MapLocalValue,
    ObjectLocalValue,
    LocalValueOption8,
    SetLocalValue
  ])
) as any as Schema.Codec<LocalValue>

/**
 * `LocalValue.Option5`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LocalValueOption5 {
  readonly type: "date"
  readonly value: string
}

/**
 * Schema for `LocalValueOption5`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LocalValueOption5 = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("date"),
    value: Schema.String
  }).annotate({ identifier: "script.LocalValueOption5" })
) as any as Schema.Codec<LocalValueOption5>

/**
 * `LocalValue.Option8`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LocalValueOption8 {
  readonly type: "regexp"
  readonly value: RegExpValue
}

/**
 * Schema for `LocalValueOption8`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LocalValueOption8 = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("regexp"),
    value: RegExpValue
  }).annotate({ identifier: "script.LocalValueOption8" })
) as any as Schema.Codec<LocalValueOption8>

/**
 * `MapLocalValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MapLocalValue {
  readonly type: "map"
  readonly value: MappingLocalValue
}

/**
 * Schema for `MapLocalValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MapLocalValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("map"),
    value: MappingLocalValue
  }).annotate({ identifier: "script.MapLocalValue" })
) as any as Schema.Codec<MapLocalValue>

/**
 * `MapRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MapRemoteValue {
  readonly type: "map"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
  readonly value?: MappingRemoteValue | undefined
}

/**
 * Schema for `MapRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MapRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("map"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId),
    value: Schema.optional(MappingRemoteValue)
  }).annotate({ identifier: "script.MapRemoteValue" })
) as any as Schema.Codec<MapRemoteValue>

/**
 * `MappingLocalValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MappingLocalValue = ReadonlyArray<readonly [LocalValue | string, LocalValue]>

/**
 * Schema for `MappingLocalValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MappingLocalValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Array(Schema.Tuple([Schema.Union([LocalValue, Schema.String]), LocalValue]))
) as any as Schema.Codec<MappingLocalValue>

/**
 * `MappingRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type MappingRemoteValue = ReadonlyArray<readonly [RemoteValue | string, RemoteValue]>

/**
 * Schema for `MappingRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MappingRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Array(Schema.Tuple([Schema.Union([RemoteValue, Schema.String]), RemoteValue]))
) as any as Schema.Codec<MappingRemoteValue>

/**
 * `MessageParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MessageParameters {
  readonly channel: Channel
  readonly data: RemoteValue
  readonly source: Source
}

/**
 * Schema for `MessageParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MessageParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    channel: Channel,
    data: RemoteValue,
    source: Source
  }).annotate({ identifier: "script.MessageParameters" })
) as any as Schema.Codec<MessageParameters>

/**
 * `NodeListRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NodeListRemoteValue {
  readonly type: "nodelist"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
  readonly value?: ListRemoteValue | undefined
}

/**
 * Schema for `NodeListRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NodeListRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("nodelist"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId),
    value: Schema.optional(ListRemoteValue)
  }).annotate({ identifier: "script.NodeListRemoteValue" })
) as any as Schema.Codec<NodeListRemoteValue>

/**
 * `NodeProperties`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NodeProperties {
  readonly nodeType: number
  readonly childNodeCount: number
  readonly attributes?: { readonly [key: string]: string } | undefined
  readonly children?: ReadonlyArray<NodeRemoteValue> | undefined
  readonly localName?: string | undefined
  readonly mode?: NodePropertiesMode | undefined
  readonly namespaceURI?: string | undefined
  readonly nodeValue?: string | undefined
  readonly shadowRoot?: NodeRemoteValue | null | undefined
}

/**
 * Schema for `NodeProperties`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NodeProperties = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeType: Schema.Int,
    childNodeCount: Schema.Int,
    attributes: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    children: Schema.optional(Schema.Array(NodeRemoteValue)),
    localName: Schema.optional(Schema.String),
    mode: Schema.optional(NodePropertiesMode),
    namespaceURI: Schema.optional(Schema.String),
    nodeValue: Schema.optional(Schema.String),
    shadowRoot: Schema.optional(Schema.Union([NodeRemoteValue, Schema.Null]))
  }).annotate({ identifier: "script.NodeProperties" })
) as any as Schema.Codec<NodeProperties>

/**
 * `NodeProperties.mode` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type NodePropertiesMode =
  | "open"
  | "closed"
  | (string & {})

/**
 * Schema for `NodePropertiesMode`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NodePropertiesMode = Schema.String as any as Schema.Codec<NodePropertiesMode>

/**
 * `NodeRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NodeRemoteValue {
  readonly type: "node"
  readonly sharedId?: SharedId | undefined
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
  readonly value?: NodeProperties | undefined
}

/**
 * Schema for `NodeRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NodeRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("node"),
    sharedId: Schema.optional(SharedId),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId),
    value: Schema.optional(NodeProperties)
  }).annotate({ identifier: "script.NodeRemoteValue" })
) as any as Schema.Codec<NodeRemoteValue>

/**
 * `NullValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NullValue {
  readonly type: "null"
}

/**
 * Schema for `NullValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NullValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("null")
  }).annotate({ identifier: "script.NullValue" })
) as any as Schema.Codec<NullValue>

/**
 * `NumberValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NumberValue {
  readonly type: "number"
  readonly value: number | SpecialNumber
}

/**
 * Schema for `NumberValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NumberValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("number"),
    value: Schema.Union([Schema.Number, SpecialNumber])
  }).annotate({ identifier: "script.NumberValue" })
) as any as Schema.Codec<NumberValue>

/**
 * `ObjectLocalValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ObjectLocalValue {
  readonly type: "object"
  readonly value: MappingLocalValue
}

/**
 * Schema for `ObjectLocalValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ObjectLocalValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("object"),
    value: MappingLocalValue
  }).annotate({ identifier: "script.ObjectLocalValue" })
) as any as Schema.Codec<ObjectLocalValue>

/**
 * `ObjectRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ObjectRemoteValue {
  readonly type: "object"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
  readonly value?: MappingRemoteValue | undefined
}

/**
 * Schema for `ObjectRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ObjectRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("object"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId),
    value: Schema.optional(MappingRemoteValue)
  }).annotate({ identifier: "script.ObjectRemoteValue" })
) as any as Schema.Codec<ObjectRemoteValue>

/**
 * `PaintWorkletRealmInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PaintWorkletRealmInfo {
  readonly realm: Realm
  readonly origin: string
  readonly type: "paint-worklet"
}

/**
 * Schema for `PaintWorkletRealmInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PaintWorkletRealmInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realm: Realm,
    origin: Schema.String,
    type: Schema.Literal("paint-worklet")
  }).annotate({ identifier: "script.PaintWorkletRealmInfo" })
) as any as Schema.Codec<PaintWorkletRealmInfo>

/**
 * `PreloadScript`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PreloadScript = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Script/PreloadScript">

/**
 * Schema for `PreloadScript`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PreloadScript = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Script/PreloadScript")
) as any as Schema.Codec<PreloadScript>

/**
 * `PrimitiveProtocolValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PrimitiveProtocolValue = UndefinedValue | NullValue | StringValue | NumberValue | BooleanValue | BigIntValue

/**
 * Schema for `PrimitiveProtocolValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PrimitiveProtocolValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([UndefinedValue, NullValue, StringValue, NumberValue, BooleanValue, BigIntValue])
) as any as Schema.Codec<PrimitiveProtocolValue>

/**
 * `PromiseRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PromiseRemoteValue {
  readonly type: "promise"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `PromiseRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PromiseRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("promise"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.PromiseRemoteValue" })
) as any as Schema.Codec<PromiseRemoteValue>

/**
 * `ProxyRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ProxyRemoteValue {
  readonly type: "proxy"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `ProxyRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ProxyRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("proxy"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.ProxyRemoteValue" })
) as any as Schema.Codec<ProxyRemoteValue>

/**
 * `Realm`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Realm = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Script/Realm">

/**
 * Schema for `Realm`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Realm = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Script/Realm")
) as any as Schema.Codec<Realm>

/**
 * `RealmDestroyedParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RealmDestroyedParameters {
  readonly realm: Realm
}

/**
 * Schema for `RealmDestroyedParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RealmDestroyedParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realm: Realm
  }).annotate({ identifier: "script.RealmDestroyedParameters" })
) as any as Schema.Codec<RealmDestroyedParameters>

/**
 * `RealmInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RealmInfo =
  | WindowRealmInfo
  | DedicatedWorkerRealmInfo
  | SharedWorkerRealmInfo
  | ServiceWorkerRealmInfo
  | WorkerRealmInfo
  | PaintWorkletRealmInfo
  | AudioWorkletRealmInfo
  | WorkletRealmInfo

/**
 * Schema for `RealmInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RealmInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([
    WindowRealmInfo,
    DedicatedWorkerRealmInfo,
    SharedWorkerRealmInfo,
    ServiceWorkerRealmInfo,
    WorkerRealmInfo,
    PaintWorkletRealmInfo,
    AudioWorkletRealmInfo,
    WorkletRealmInfo
  ])
) as any as Schema.Codec<RealmInfo>

/**
 * `RealmTarget`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RealmTarget {
  readonly realm: Realm
}

/**
 * Schema for `RealmTarget`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RealmTarget = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realm: Realm
  }).annotate({ identifier: "script.RealmTarget" })
) as any as Schema.Codec<RealmTarget>

/**
 * `RealmType` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RealmType =
  | "window"
  | "dedicated-worker"
  | "shared-worker"
  | "service-worker"
  | "worker"
  | "paint-worklet"
  | "audio-worklet"
  | "worklet"
  | (string & {})

/**
 * Schema for `RealmType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RealmType = Schema.String as any as Schema.Codec<RealmType>

/**
 * `RegExpRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RegExpRemoteValue {
  readonly type: "regexp"
  readonly value: RegExpValue
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `RegExpRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RegExpRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("regexp"),
    value: RegExpValue,
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.RegExpRemoteValue" })
) as any as Schema.Codec<RegExpRemoteValue>

/**
 * `RegExpValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RegExpValue {
  readonly pattern: string
  readonly flags?: string | undefined
}

/**
 * Schema for `RegExpValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RegExpValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pattern: Schema.String,
    flags: Schema.optional(Schema.String)
  }).annotate({ identifier: "script.RegExpValue" })
) as any as Schema.Codec<RegExpValue>

/**
 * `RemoteObjectReference`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemoteObjectReference {
  readonly handle: Handle
  readonly sharedId?: SharedId | undefined
}

/**
 * Schema for `RemoteObjectReference`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoteObjectReference = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: Handle,
    sharedId: Schema.optional(SharedId)
  }).annotate({ identifier: "script.RemoteObjectReference" })
) as any as Schema.Codec<RemoteObjectReference>

/**
 * `RemoteReference`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RemoteReference = SharedReference | RemoteObjectReference

/**
 * Schema for `RemoteReference`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoteReference = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([SharedReference, RemoteObjectReference])
) as any as Schema.Codec<RemoteReference>

/**
 * `RemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RemoteValue =
  | PrimitiveProtocolValue
  | SymbolRemoteValue
  | ArrayRemoteValue
  | ObjectRemoteValue
  | FunctionRemoteValue
  | RegExpRemoteValue
  | DateRemoteValue
  | MapRemoteValue
  | SetRemoteValue
  | WeakMapRemoteValue
  | WeakSetRemoteValue
  | GeneratorRemoteValue
  | ErrorRemoteValue
  | ProxyRemoteValue
  | PromiseRemoteValue
  | TypedArrayRemoteValue
  | ArrayBufferRemoteValue
  | NodeListRemoteValue
  | HTMLCollectionRemoteValue
  | NodeRemoteValue
  | WindowProxyRemoteValue

/**
 * Schema for `RemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([
    PrimitiveProtocolValue,
    SymbolRemoteValue,
    ArrayRemoteValue,
    ObjectRemoteValue,
    FunctionRemoteValue,
    RegExpRemoteValue,
    DateRemoteValue,
    MapRemoteValue,
    SetRemoteValue,
    WeakMapRemoteValue,
    WeakSetRemoteValue,
    GeneratorRemoteValue,
    ErrorRemoteValue,
    ProxyRemoteValue,
    PromiseRemoteValue,
    TypedArrayRemoteValue,
    ArrayBufferRemoteValue,
    NodeListRemoteValue,
    HTMLCollectionRemoteValue,
    NodeRemoteValue,
    WindowProxyRemoteValue
  ])
) as any as Schema.Codec<RemoteValue>

/**
 * `RemovePreloadScriptParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RemovePreloadScriptParameters {
  readonly script: PreloadScript
}

/**
 * Schema for `RemovePreloadScriptParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemovePreloadScriptParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    script: PreloadScript
  }).annotate({ identifier: "script.RemovePreloadScriptParameters" })
) as any as Schema.Codec<RemovePreloadScriptParameters>

/**
 * `RemovePreloadScriptResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RemovePreloadScriptResult = { readonly [key: string]: unknown }

/**
 * Schema for `RemovePreloadScriptResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RemovePreloadScriptResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  RemovePreloadScriptResult
>

/**
 * `ResultOwnership` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ResultOwnership =
  | "root"
  | "none"
  | (string & {})

/**
 * Schema for `ResultOwnership`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResultOwnership = Schema.String as any as Schema.Codec<ResultOwnership>

/**
 * `SerializationOptions`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SerializationOptions {
  readonly maxDomDepth?: number | null | undefined
  readonly maxObjectDepth?: number | null | undefined
  readonly includeShadowTree?: SerializationOptionsIncludeShadowTree | undefined
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
    maxDomDepth: Schema.optional(Schema.Union([Schema.Int, Schema.Null])),
    maxObjectDepth: Schema.optional(Schema.Union([Schema.Int, Schema.Null])),
    includeShadowTree: Schema.optional(SerializationOptionsIncludeShadowTree)
  }).annotate({ identifier: "script.SerializationOptions" })
) as any as Schema.Codec<SerializationOptions>

/**
 * `SerializationOptions.includeShadowTree` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SerializationOptionsIncludeShadowTree =
  | "none"
  | "open"
  | "all"
  | (string & {})

/**
 * Schema for `SerializationOptionsIncludeShadowTree`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SerializationOptionsIncludeShadowTree = Schema.String as any as Schema.Codec<
  SerializationOptionsIncludeShadowTree
>

/**
 * `ServiceWorkerRealmInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ServiceWorkerRealmInfo {
  readonly realm: Realm
  readonly origin: string
  readonly type: "service-worker"
}

/**
 * Schema for `ServiceWorkerRealmInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerRealmInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realm: Realm,
    origin: Schema.String,
    type: Schema.Literal("service-worker")
  }).annotate({ identifier: "script.ServiceWorkerRealmInfo" })
) as any as Schema.Codec<ServiceWorkerRealmInfo>

/**
 * `SetLocalValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetLocalValue {
  readonly type: "set"
  readonly value: ListLocalValue
}

/**
 * Schema for `SetLocalValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetLocalValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("set"),
    value: ListLocalValue
  }).annotate({ identifier: "script.SetLocalValue" })
) as any as Schema.Codec<SetLocalValue>

/**
 * `SetRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetRemoteValue {
  readonly type: "set"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
  readonly value?: ListRemoteValue | undefined
}

/**
 * Schema for `SetRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("set"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId),
    value: Schema.optional(ListRemoteValue)
  }).annotate({ identifier: "script.SetRemoteValue" })
) as any as Schema.Codec<SetRemoteValue>

/**
 * `SharedId`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SharedId = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/Script/SharedId">

/**
 * Schema for `SharedId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SharedId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/Script/SharedId")
) as any as Schema.Codec<SharedId>

/**
 * `SharedReference`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SharedReference {
  readonly sharedId: SharedId
  readonly handle?: Handle | undefined
}

/**
 * Schema for `SharedReference`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SharedReference = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sharedId: SharedId,
    handle: Schema.optional(Handle)
  }).annotate({ identifier: "script.SharedReference" })
) as any as Schema.Codec<SharedReference>

/**
 * `SharedWorkerRealmInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SharedWorkerRealmInfo {
  readonly realm: Realm
  readonly origin: string
  readonly type: "shared-worker"
}

/**
 * Schema for `SharedWorkerRealmInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SharedWorkerRealmInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realm: Realm,
    origin: Schema.String,
    type: Schema.Literal("shared-worker")
  }).annotate({ identifier: "script.SharedWorkerRealmInfo" })
) as any as Schema.Codec<SharedWorkerRealmInfo>

/**
 * `Source`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Source {
  readonly realm: Realm
  readonly context?: BrowsingContext.BrowsingContext | undefined
  readonly userContext?: Browser.UserContext | undefined
}

/**
 * Schema for `Source`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Source = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realm: Realm,
    context: Schema.optional(BrowsingContext.BrowsingContext),
    userContext: Schema.optional(Browser.UserContext)
  }).annotate({ identifier: "script.Source" })
) as any as Schema.Codec<Source>

/**
 * `SpecialNumber` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SpecialNumber =
  | "NaN"
  | "-0"
  | "Infinity"
  | "-Infinity"
  | (string & {})

/**
 * Schema for `SpecialNumber`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SpecialNumber = Schema.String as any as Schema.Codec<SpecialNumber>

/**
 * `StackFrame`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StackFrame {
  readonly columnNumber: number
  readonly functionName: string
  readonly lineNumber: number
  readonly url: string
}

/**
 * Schema for `StackFrame`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StackFrame = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    columnNumber: Schema.Int,
    functionName: Schema.String,
    lineNumber: Schema.Int,
    url: Schema.String
  }).annotate({ identifier: "script.StackFrame" })
) as any as Schema.Codec<StackFrame>

/**
 * `StackTrace`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StackTrace {
  readonly callFrames: ReadonlyArray<StackFrame>
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
    callFrames: Schema.Array(StackFrame)
  }).annotate({ identifier: "script.StackTrace" })
) as any as Schema.Codec<StackTrace>

/**
 * `StringValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StringValue {
  readonly type: "string"
  readonly value: string
}

/**
 * Schema for `StringValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StringValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("string"),
    value: Schema.String
  }).annotate({ identifier: "script.StringValue" })
) as any as Schema.Codec<StringValue>

/**
 * `SymbolRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SymbolRemoteValue {
  readonly type: "symbol"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `SymbolRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SymbolRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("symbol"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.SymbolRemoteValue" })
) as any as Schema.Codec<SymbolRemoteValue>

/**
 * `Target`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Target = ContextTarget | RealmTarget

/**
 * Schema for `Target`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Target = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([ContextTarget, RealmTarget])
) as any as Schema.Codec<Target>

/**
 * `TypedArrayRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TypedArrayRemoteValue {
  readonly type: "typedarray"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `TypedArrayRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TypedArrayRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("typedarray"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.TypedArrayRemoteValue" })
) as any as Schema.Codec<TypedArrayRemoteValue>

/**
 * `UndefinedValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UndefinedValue {
  readonly type: "undefined"
}

/**
 * Schema for `UndefinedValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UndefinedValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("undefined")
  }).annotate({ identifier: "script.UndefinedValue" })
) as any as Schema.Codec<UndefinedValue>

/**
 * `WeakMapRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WeakMapRemoteValue {
  readonly type: "weakmap"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `WeakMapRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WeakMapRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("weakmap"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.WeakMapRemoteValue" })
) as any as Schema.Codec<WeakMapRemoteValue>

/**
 * `WeakSetRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WeakSetRemoteValue {
  readonly type: "weakset"
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `WeakSetRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WeakSetRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("weakset"),
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.WeakSetRemoteValue" })
) as any as Schema.Codec<WeakSetRemoteValue>

/**
 * `WindowProxyProperties`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WindowProxyProperties {
  readonly context: BrowsingContext.BrowsingContext
}

/**
 * Schema for `WindowProxyProperties`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WindowProxyProperties = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BrowsingContext.BrowsingContext
  }).annotate({ identifier: "script.WindowProxyProperties" })
) as any as Schema.Codec<WindowProxyProperties>

/**
 * `WindowProxyRemoteValue`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WindowProxyRemoteValue {
  readonly type: "window"
  readonly value: WindowProxyProperties
  readonly handle?: Handle | undefined
  readonly internalId?: InternalId | undefined
}

/**
 * Schema for `WindowProxyRemoteValue`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WindowProxyRemoteValue = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("window"),
    value: WindowProxyProperties,
    handle: Schema.optional(Handle),
    internalId: Schema.optional(InternalId)
  }).annotate({ identifier: "script.WindowProxyRemoteValue" })
) as any as Schema.Codec<WindowProxyRemoteValue>

/**
 * `WindowRealmInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WindowRealmInfo {
  readonly realm: Realm
  readonly origin: string
  readonly type: "window"
  readonly context: BrowsingContext.BrowsingContext
  readonly userContext?: Browser.UserContext | undefined
  readonly sandbox?: string | undefined
}

/**
 * Schema for `WindowRealmInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WindowRealmInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realm: Realm,
    origin: Schema.String,
    type: Schema.Literal("window"),
    context: BrowsingContext.BrowsingContext,
    userContext: Schema.optional(Browser.UserContext),
    sandbox: Schema.optional(Schema.String)
  }).annotate({ identifier: "script.WindowRealmInfo" })
) as any as Schema.Codec<WindowRealmInfo>

/**
 * `WorkerRealmInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WorkerRealmInfo {
  readonly realm: Realm
  readonly origin: string
  readonly type: "worker"
}

/**
 * Schema for `WorkerRealmInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WorkerRealmInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realm: Realm,
    origin: Schema.String,
    type: Schema.Literal("worker")
  }).annotate({ identifier: "script.WorkerRealmInfo" })
) as any as Schema.Codec<WorkerRealmInfo>

/**
 * `WorkletRealmInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface WorkletRealmInfo {
  readonly realm: Realm
  readonly origin: string
  readonly type: "worklet"
}

/**
 * Schema for `WorkletRealmInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const WorkletRealmInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realm: Realm,
    origin: Schema.String,
    type: Schema.Literal("worklet")
  }).annotate({ identifier: "script.WorkletRealmInfo" })
) as any as Schema.Codec<WorkletRealmInfo>

/**
 * Sends `script.addPreloadScript`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const addPreloadScript: Protocol.CommandDef<
  "script.addPreloadScript",
  AddPreloadScriptParameters,
  AddPreloadScriptResult
> = /*#__PURE__*/ Protocol.command(
  "script.addPreloadScript",
  AddPreloadScriptParameters,
  AddPreloadScriptResult,
  {
    status: "stable",
    createsResource: true,
    release: [{ method: "script.removePreloadScript", param: "script", from: "/script" }]
  }
)

/**
 * Sends `script.callFunction`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const callFunction: Protocol.CommandDef<"script.callFunction", CallFunctionParameters, CallFunctionResult> =
  /*#__PURE__*/ Protocol.command(
    "script.callFunction",
    CallFunctionParameters,
    CallFunctionResult,
    {
      status: "stable",
      createsResource: true,
      release: [{
        method: "script.disown",
        param: "handles",
        from: "/result/handle",
        list: true,
        paramsFrom: { "/target/realm": "/realm" }
      }, {
        method: "script.disown",
        param: "handles",
        from: "/exceptionDetails/exception/handle",
        list: true,
        paramsFrom: { "/target/realm": "/realm" }
      }]
    }
  )

/**
 * Sends `script.disown`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disown: Protocol.CommandDef<"script.disown", DisownParameters, void> = /*#__PURE__*/ Protocol.command(
  "script.disown",
  DisownParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `script.evaluate`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const evaluate: Protocol.CommandDef<"script.evaluate", EvaluateParameters, EvaluateResult> =
  /*#__PURE__*/ Protocol.command(
    "script.evaluate",
    EvaluateParameters,
    EvaluateResult,
    {
      status: "stable",
      createsResource: true,
      release: [{
        method: "script.disown",
        param: "handles",
        from: "/result/handle",
        list: true,
        paramsFrom: { "/target/realm": "/realm" }
      }, {
        method: "script.disown",
        param: "handles",
        from: "/exceptionDetails/exception/handle",
        list: true,
        paramsFrom: { "/target/realm": "/realm" }
      }]
    }
  )

/**
 * Sends `script.getRealms`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getRealms: Protocol.CommandDef<"script.getRealms", GetRealmsParameters, GetRealmsResult> =
  /*#__PURE__*/ Protocol.command(
    "script.getRealms",
    GetRealmsParameters,
    GetRealmsResult,
    { status: "stable" }
  )

/**
 * Sends `script.removePreloadScript`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const removePreloadScript: Protocol.CommandDef<
  "script.removePreloadScript",
  RemovePreloadScriptParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "script.removePreloadScript",
  RemovePreloadScriptParameters,
  undefined,
  { status: "stable" }
)

/**
 * The `script.message` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const message: Protocol.EventDef<"script.message", MessageParameters> = /*#__PURE__*/ Protocol.event(
  "script.message",
  MessageParameters,
  { status: "stable" }
)

/**
 * The `script.realmCreated` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const realmCreated: Protocol.EventDef<"script.realmCreated", RealmInfo> = /*#__PURE__*/ Protocol.event(
  "script.realmCreated",
  RealmInfo,
  { status: "stable" }
)

/**
 * The `script.realmDestroyed` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const realmDestroyed: Protocol.EventDef<"script.realmDestroyed", RealmDestroyedParameters> =
  /*#__PURE__*/ Protocol.event(
    "script.realmDestroyed",
    RealmDestroyedParameters,
    { status: "stable" }
  )
