/**
 * This domain allows inspection of Web Audio API.
 * https://webaudio.github.io/web-audio-api/
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Protocol object for AudioListener
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AudioListener {
  readonly listenerId: GraphObjectId
  readonly contextId: GraphObjectId
}

/**
 * Schema for `AudioListener`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AudioListener = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    listenerId: GraphObjectId,
    contextId: GraphObjectId
  }).annotate({ identifier: "WebAudio.AudioListener" })
) as any as Schema.Codec<AudioListener>

/**
 * Protocol object for AudioNode
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AudioNode {
  readonly nodeId: GraphObjectId
  readonly contextId: GraphObjectId
  readonly nodeType: NodeType
  readonly numberOfInputs: number
  readonly numberOfOutputs: number
  readonly channelCount: number
  readonly channelCountMode: ChannelCountMode
  readonly channelInterpretation: ChannelInterpretation
}

/**
 * Schema for `AudioNode`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AudioNode = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: GraphObjectId,
    contextId: GraphObjectId,
    nodeType: NodeType,
    numberOfInputs: Schema.Number,
    numberOfOutputs: Schema.Number,
    channelCount: Schema.Number,
    channelCountMode: ChannelCountMode,
    channelInterpretation: ChannelInterpretation
  }).annotate({ identifier: "WebAudio.AudioNode" })
) as any as Schema.Codec<AudioNode>

/**
 * Protocol object for AudioParam
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AudioParam {
  readonly paramId: GraphObjectId
  readonly nodeId: GraphObjectId
  readonly contextId: GraphObjectId
  readonly paramType: ParamType
  readonly rate: AutomationRate
  readonly defaultValue: number
  readonly minValue: number
  readonly maxValue: number
}

/**
 * Schema for `AudioParam`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AudioParam = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    paramId: GraphObjectId,
    nodeId: GraphObjectId,
    contextId: GraphObjectId,
    paramType: ParamType,
    rate: AutomationRate,
    defaultValue: Schema.Number,
    minValue: Schema.Number,
    maxValue: Schema.Number
  }).annotate({ identifier: "WebAudio.AudioParam" })
) as any as Schema.Codec<AudioParam>

/**
 * Enum of AudioParam::AutomationRate from the spec
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AutomationRate =
  | "a-rate"
  | "k-rate"
  | (string & {})

/**
 * Schema for `AutomationRate`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AutomationRate = Schema.String as any as Schema.Codec<AutomationRate>

/**
 * Protocol object for BaseAudioContext
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BaseAudioContext {
  readonly contextId: GraphObjectId
  readonly contextType: ContextType
  readonly contextState: ContextState
  readonly realtimeData?: ContextRealtimeData | undefined
  /**
   * Platform-dependent callback buffer size.
   */
  readonly callbackBufferSize: number
  /**
   * Number of output channels supported by audio hardware in use.
   */
  readonly maxOutputChannelCount: number
  /**
   * Context sample rate.
   */
  readonly sampleRate: number
  readonly renderQuantumSize: number
}

/**
 * Schema for `BaseAudioContext`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BaseAudioContext = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contextId: GraphObjectId,
    contextType: ContextType,
    contextState: ContextState,
    realtimeData: Schema.optional(ContextRealtimeData),
    callbackBufferSize: Schema.Number,
    maxOutputChannelCount: Schema.Number,
    sampleRate: Schema.Number,
    renderQuantumSize: Schema.Number
  }).annotate({ identifier: "WebAudio.BaseAudioContext" })
) as any as Schema.Codec<BaseAudioContext>

/**
 * Enum of AudioNode::ChannelCountMode from the spec
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ChannelCountMode =
  | "clamped-max"
  | "explicit"
  | "max"
  | (string & {})

/**
 * Schema for `ChannelCountMode`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ChannelCountMode = Schema.String as any as Schema.Codec<ChannelCountMode>

/**
 * Enum of AudioNode::ChannelInterpretation from the spec
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ChannelInterpretation =
  | "discrete"
  | "speakers"
  | (string & {})

/**
 * Schema for `ChannelInterpretation`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ChannelInterpretation = Schema.String as any as Schema.Codec<ChannelInterpretation>

/**
 * Fields in AudioContext that change in real-time.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ContextRealtimeData {
  /**
   * The current context time in second in BaseAudioContext.
   */
  readonly currentTime: number
  /**
   * The time spent on rendering graph divided by render quantum duration,
   * and multiplied by 100. 100 means the audio renderer reached the full
   * capacity and glitch may occur.
   */
  readonly renderCapacity: number
  /**
   * A running mean of callback interval.
   */
  readonly callbackIntervalMean: number
  /**
   * A running variance of callback interval.
   */
  readonly callbackIntervalVariance: number
}

/**
 * Schema for `ContextRealtimeData`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContextRealtimeData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    currentTime: Schema.Number,
    renderCapacity: Schema.Number,
    callbackIntervalMean: Schema.Number,
    callbackIntervalVariance: Schema.Number
  }).annotate({ identifier: "WebAudio.ContextRealtimeData" })
) as any as Schema.Codec<ContextRealtimeData>

/**
 * Enum of AudioContextState from the spec
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ContextState =
  | "suspended"
  | "running"
  | "closed"
  | "interrupted"
  | (string & {})

/**
 * Schema for `ContextState`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContextState = Schema.String as any as Schema.Codec<ContextState>

/**
 * Enum of BaseAudioContext types
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ContextType =
  | "realtime"
  | "offline"
  | (string & {})

/**
 * Schema for `ContextType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContextType = Schema.String as any as Schema.Codec<ContextType>

/**
 * An unique ID for a graph object (AudioContext, AudioNode, AudioParam) in Web Audio API
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type GraphObjectId = Brand.Branded<string, "~@usestrider/browser/cdp/WebAudio/GraphObjectId">

/**
 * Schema for `GraphObjectId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GraphObjectId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/WebAudio/GraphObjectId")
) as any as Schema.Codec<GraphObjectId>

/**
 * Enum of AudioNode types
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type NodeType = string

/**
 * Schema for `NodeType`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NodeType = Schema.String as any as Schema.Codec<NodeType>

/**
 * Enum of AudioParam types
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ParamType = string

/**
 * Schema for `ParamType`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ParamType = Schema.String as any as Schema.Codec<ParamType>

/**
 * Notifies that the construction of an AudioListener has finished.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AudioListenerCreatedParams {
  readonly listener: AudioListener
}

/**
 * Schema for `AudioListenerCreatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AudioListenerCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    listener: AudioListener
  }).annotate({ identifier: "WebAudio.AudioListenerCreatedParams" })
) as any as Schema.Codec<AudioListenerCreatedParams>

/**
 * Notifies that a new AudioListener has been created.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AudioListenerWillBeDestroyedParams {
  readonly contextId: GraphObjectId
  readonly listenerId: GraphObjectId
}

/**
 * Schema for `AudioListenerWillBeDestroyedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AudioListenerWillBeDestroyedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contextId: GraphObjectId,
    listenerId: GraphObjectId
  }).annotate({ identifier: "WebAudio.AudioListenerWillBeDestroyedParams" })
) as any as Schema.Codec<AudioListenerWillBeDestroyedParams>

/**
 * Notifies that a new AudioNode has been created.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AudioNodeCreatedParams {
  readonly node: AudioNode
}

/**
 * Schema for `AudioNodeCreatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AudioNodeCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    node: AudioNode
  }).annotate({ identifier: "WebAudio.AudioNodeCreatedParams" })
) as any as Schema.Codec<AudioNodeCreatedParams>

/**
 * Notifies that an existing AudioNode has been destroyed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AudioNodeWillBeDestroyedParams {
  readonly contextId: GraphObjectId
  readonly nodeId: GraphObjectId
}

/**
 * Schema for `AudioNodeWillBeDestroyedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AudioNodeWillBeDestroyedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contextId: GraphObjectId,
    nodeId: GraphObjectId
  }).annotate({ identifier: "WebAudio.AudioNodeWillBeDestroyedParams" })
) as any as Schema.Codec<AudioNodeWillBeDestroyedParams>

/**
 * Notifies that a new AudioParam has been created.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AudioParamCreatedParams {
  readonly param: AudioParam
}

/**
 * Schema for `AudioParamCreatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AudioParamCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    param: AudioParam
  }).annotate({ identifier: "WebAudio.AudioParamCreatedParams" })
) as any as Schema.Codec<AudioParamCreatedParams>

/**
 * Notifies that an existing AudioParam has been destroyed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AudioParamWillBeDestroyedParams {
  readonly contextId: GraphObjectId
  readonly nodeId: GraphObjectId
  readonly paramId: GraphObjectId
}

/**
 * Schema for `AudioParamWillBeDestroyedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AudioParamWillBeDestroyedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contextId: GraphObjectId,
    nodeId: GraphObjectId,
    paramId: GraphObjectId
  }).annotate({ identifier: "WebAudio.AudioParamWillBeDestroyedParams" })
) as any as Schema.Codec<AudioParamWillBeDestroyedParams>

/**
 * Notifies that existing BaseAudioContext has changed some properties (id stays the same)..
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ContextChangedParams {
  readonly context: BaseAudioContext
}

/**
 * Schema for `ContextChangedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContextChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BaseAudioContext
  }).annotate({ identifier: "WebAudio.ContextChangedParams" })
) as any as Schema.Codec<ContextChangedParams>

/**
 * Notifies that a new BaseAudioContext has been created.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ContextCreatedParams {
  readonly context: BaseAudioContext
}

/**
 * Schema for `ContextCreatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContextCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    context: BaseAudioContext
  }).annotate({ identifier: "WebAudio.ContextCreatedParams" })
) as any as Schema.Codec<ContextCreatedParams>

/**
 * Notifies that an existing BaseAudioContext will be destroyed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ContextWillBeDestroyedParams {
  readonly contextId: GraphObjectId
}

/**
 * Schema for `ContextWillBeDestroyedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ContextWillBeDestroyedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contextId: GraphObjectId
  }).annotate({ identifier: "WebAudio.ContextWillBeDestroyedParams" })
) as any as Schema.Codec<ContextWillBeDestroyedParams>

/**
 * Fetch the realtime data from the registered contexts.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetRealtimeDataParams {
  readonly contextId: GraphObjectId
}

/**
 * Schema for `GetRealtimeDataParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetRealtimeDataParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contextId: GraphObjectId
  }).annotate({ identifier: "WebAudio.GetRealtimeDataParams" })
) as any as Schema.Codec<GetRealtimeDataParams>

/**
 * Fetch the realtime data from the registered contexts.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetRealtimeDataResult {
  readonly realtimeData: ContextRealtimeData
}

/**
 * Schema for `GetRealtimeDataResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetRealtimeDataResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    realtimeData: ContextRealtimeData
  }).annotate({ identifier: "WebAudio.GetRealtimeDataResult" })
) as any as Schema.Codec<GetRealtimeDataResult>

/**
 * Notifies that an AudioNode is connected to an AudioParam.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NodeParamConnectedParams {
  readonly contextId: GraphObjectId
  readonly sourceId: GraphObjectId
  readonly destinationId: GraphObjectId
  readonly sourceOutputIndex?: number | undefined
}

/**
 * Schema for `NodeParamConnectedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NodeParamConnectedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contextId: GraphObjectId,
    sourceId: GraphObjectId,
    destinationId: GraphObjectId,
    sourceOutputIndex: Schema.optional(Schema.Number)
  }).annotate({ identifier: "WebAudio.NodeParamConnectedParams" })
) as any as Schema.Codec<NodeParamConnectedParams>

/**
 * Notifies that an AudioNode is disconnected to an AudioParam.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NodeParamDisconnectedParams {
  readonly contextId: GraphObjectId
  readonly sourceId: GraphObjectId
  readonly destinationId: GraphObjectId
  readonly sourceOutputIndex?: number | undefined
}

/**
 * Schema for `NodeParamDisconnectedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NodeParamDisconnectedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contextId: GraphObjectId,
    sourceId: GraphObjectId,
    destinationId: GraphObjectId,
    sourceOutputIndex: Schema.optional(Schema.Number)
  }).annotate({ identifier: "WebAudio.NodeParamDisconnectedParams" })
) as any as Schema.Codec<NodeParamDisconnectedParams>

/**
 * Notifies that two AudioNodes are connected.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NodesConnectedParams {
  readonly contextId: GraphObjectId
  readonly sourceId: GraphObjectId
  readonly destinationId: GraphObjectId
  readonly sourceOutputIndex?: number | undefined
  readonly destinationInputIndex?: number | undefined
}

/**
 * Schema for `NodesConnectedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NodesConnectedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contextId: GraphObjectId,
    sourceId: GraphObjectId,
    destinationId: GraphObjectId,
    sourceOutputIndex: Schema.optional(Schema.Number),
    destinationInputIndex: Schema.optional(Schema.Number)
  }).annotate({ identifier: "WebAudio.NodesConnectedParams" })
) as any as Schema.Codec<NodesConnectedParams>

/**
 * Notifies that AudioNodes are disconnected. The destination can be null, and it means all the outgoing connections from the source are disconnected.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface NodesDisconnectedParams {
  readonly contextId: GraphObjectId
  readonly sourceId: GraphObjectId
  readonly destinationId: GraphObjectId
  readonly sourceOutputIndex?: number | undefined
  readonly destinationInputIndex?: number | undefined
}

/**
 * Schema for `NodesDisconnectedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const NodesDisconnectedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    contextId: GraphObjectId,
    sourceId: GraphObjectId,
    destinationId: GraphObjectId,
    sourceOutputIndex: Schema.optional(Schema.Number),
    destinationInputIndex: Schema.optional(Schema.Number)
  }).annotate({ identifier: "WebAudio.NodesDisconnectedParams" })
) as any as Schema.Codec<NodesDisconnectedParams>

/**
 * Disables the WebAudio domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"WebAudio.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "WebAudio.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables the WebAudio domain and starts sending context lifetime events.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"WebAudio.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "WebAudio.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Fetch the realtime data from the registered contexts.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getRealtimeData: Protocol.CommandDef<
  "WebAudio.getRealtimeData",
  GetRealtimeDataParams,
  GetRealtimeDataResult
> = /*#__PURE__*/ Protocol.command(
  "WebAudio.getRealtimeData",
  GetRealtimeDataParams,
  GetRealtimeDataResult,
  { status: "stable" }
)

/**
 * Notifies that the construction of an AudioListener has finished.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const audioListenerCreated: Protocol.EventDef<"WebAudio.audioListenerCreated", AudioListenerCreatedParams> =
  /*#__PURE__*/ Protocol.event(
    "WebAudio.audioListenerCreated",
    AudioListenerCreatedParams,
    { status: "stable" }
  )

/**
 * Notifies that a new AudioListener has been created.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const audioListenerWillBeDestroyed: Protocol.EventDef<
  "WebAudio.audioListenerWillBeDestroyed",
  AudioListenerWillBeDestroyedParams
> = /*#__PURE__*/ Protocol.event(
  "WebAudio.audioListenerWillBeDestroyed",
  AudioListenerWillBeDestroyedParams,
  { status: "stable" }
)

/**
 * Notifies that a new AudioNode has been created.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const audioNodeCreated: Protocol.EventDef<"WebAudio.audioNodeCreated", AudioNodeCreatedParams> =
  /*#__PURE__*/ Protocol.event(
    "WebAudio.audioNodeCreated",
    AudioNodeCreatedParams,
    { status: "stable" }
  )

/**
 * Notifies that an existing AudioNode has been destroyed.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const audioNodeWillBeDestroyed: Protocol.EventDef<
  "WebAudio.audioNodeWillBeDestroyed",
  AudioNodeWillBeDestroyedParams
> = /*#__PURE__*/ Protocol.event(
  "WebAudio.audioNodeWillBeDestroyed",
  AudioNodeWillBeDestroyedParams,
  { status: "stable" }
)

/**
 * Notifies that a new AudioParam has been created.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const audioParamCreated: Protocol.EventDef<"WebAudio.audioParamCreated", AudioParamCreatedParams> =
  /*#__PURE__*/ Protocol.event(
    "WebAudio.audioParamCreated",
    AudioParamCreatedParams,
    { status: "stable" }
  )

/**
 * Notifies that an existing AudioParam has been destroyed.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const audioParamWillBeDestroyed: Protocol.EventDef<
  "WebAudio.audioParamWillBeDestroyed",
  AudioParamWillBeDestroyedParams
> = /*#__PURE__*/ Protocol.event(
  "WebAudio.audioParamWillBeDestroyed",
  AudioParamWillBeDestroyedParams,
  { status: "stable" }
)

/**
 * Notifies that existing BaseAudioContext has changed some properties (id stays the same)..
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const contextChanged: Protocol.EventDef<"WebAudio.contextChanged", ContextChangedParams> = /*#__PURE__*/ Protocol
  .event(
    "WebAudio.contextChanged",
    ContextChangedParams,
    { status: "stable" }
  )

/**
 * Notifies that a new BaseAudioContext has been created.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const contextCreated: Protocol.EventDef<"WebAudio.contextCreated", ContextCreatedParams> = /*#__PURE__*/ Protocol
  .event(
    "WebAudio.contextCreated",
    ContextCreatedParams,
    { status: "stable" }
  )

/**
 * Notifies that an existing BaseAudioContext will be destroyed.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const contextWillBeDestroyed: Protocol.EventDef<
  "WebAudio.contextWillBeDestroyed",
  ContextWillBeDestroyedParams
> = /*#__PURE__*/ Protocol.event(
  "WebAudio.contextWillBeDestroyed",
  ContextWillBeDestroyedParams,
  { status: "stable" }
)

/**
 * Notifies that an AudioNode is connected to an AudioParam.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const nodeParamConnected: Protocol.EventDef<"WebAudio.nodeParamConnected", NodeParamConnectedParams> =
  /*#__PURE__*/ Protocol.event(
    "WebAudio.nodeParamConnected",
    NodeParamConnectedParams,
    { status: "stable" }
  )

/**
 * Notifies that an AudioNode is disconnected to an AudioParam.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const nodeParamDisconnected: Protocol.EventDef<"WebAudio.nodeParamDisconnected", NodeParamDisconnectedParams> =
  /*#__PURE__*/ Protocol.event(
    "WebAudio.nodeParamDisconnected",
    NodeParamDisconnectedParams,
    { status: "stable" }
  )

/**
 * Notifies that two AudioNodes are connected.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const nodesConnected: Protocol.EventDef<"WebAudio.nodesConnected", NodesConnectedParams> = /*#__PURE__*/ Protocol
  .event(
    "WebAudio.nodesConnected",
    NodesConnectedParams,
    { status: "stable" }
  )

/**
 * Notifies that AudioNodes are disconnected. The destination can be null, and it means all the outgoing connections from the source are disconnected.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const nodesDisconnected: Protocol.EventDef<"WebAudio.nodesDisconnected", NodesDisconnectedParams> =
  /*#__PURE__*/ Protocol.event(
    "WebAudio.nodesDisconnected",
    NodesDisconnectedParams,
    { status: "stable" }
  )
