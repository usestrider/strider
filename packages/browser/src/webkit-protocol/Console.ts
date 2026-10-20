/**
 * Console domain defines methods and events for interaction with the JavaScript console. Console collects messages created by means of the <a href='http://getfirebug.com/wiki/index.php/Console_API'>JavaScript Console API</a>. One needs to enable this domain using <code>enable</code> command in order to start receiving the console messages. Browser collects messages issued while console domain is not enabled as well and reports them using <code>messageAdded</code> notification upon enabling.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Debugger from "./Debugger.ts"
import * as Heap from "./Heap.ts"
import * as Network from "./Network.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Stack entry for console errors and assertions.
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
   * JavaScript script name or url.
   */
  readonly url: string
  /**
   * Script identifier.
   */
  readonly scriptId: Debugger.ScriptId
  /**
   * JavaScript script line number.
   */
  readonly lineNumber: number
  /**
   * JavaScript script column number.
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
    url: Schema.String,
    scriptId: Debugger.ScriptId,
    lineNumber: Schema.Int,
    columnNumber: Schema.Int
  }).annotate({ identifier: "Console.CallFrame" })
) as any as Schema.Codec<CallFrame>

/**
 * Logging channel.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Channel {
  readonly source: ChannelSource
  readonly level: ChannelLevel
}

/**
 * Schema for `Channel`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Channel = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    source: ChannelSource,
    level: ChannelLevel
  }).annotate({ identifier: "Console.Channel" })
) as any as Schema.Codec<Channel>

/**
 * Level of logging.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ChannelLevel =
  | "off"
  | "basic"
  | "verbose"
  | (string & {})

/**
 * Schema for `ChannelLevel`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ChannelLevel = Schema.String as any as Schema.Codec<ChannelLevel>

/**
 * Channels for different types of log messages.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ChannelSource =
  | "xml"
  | "javascript"
  | "network"
  | "console-api"
  | "storage"
  | "rendering"
  | "css"
  | "accessibility"
  | "security"
  | "content-blocker"
  | "media"
  | "mediasource"
  | "webrtc"
  | "itp-debug"
  | "private-click-measurement"
  | "payment-request"
  | "other"
  | (string & {})

/**
 * Schema for `ChannelSource`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ChannelSource = Schema.String as any as Schema.Codec<ChannelSource>

/**
 * The reason the console is being cleared.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ClearReason =
  | "console-api"
  | "frontend"
  | "main-frame-navigation"
  | (string & {})

/**
 * Schema for `ClearReason`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ClearReason = Schema.String as any as Schema.Codec<ClearReason>

/**
 * Console message.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ConsoleMessage {
  readonly source: ChannelSource
  /**
   * Message severity.
   */
  readonly level: ConsoleMessageLevel
  /**
   * Message text.
   */
  readonly text: string
  /**
   * Console message type.
   */
  readonly type?: ConsoleMessageType | undefined
  /**
   * URL of the message origin.
   */
  readonly url?: string | undefined
  /**
   * Line number in the resource that generated this message.
   */
  readonly line?: number | undefined
  /**
   * Column number on the line in the resource that generated this message.
   */
  readonly column?: number | undefined
  /**
   * Repeat count for repeated messages.
   */
  readonly repeatCount?: number | undefined
  /**
   * Message parameters in case of the formatted message.
   */
  readonly parameters?: ReadonlyArray<Runtime.RemoteObject> | undefined
  /**
   * JavaScript stack trace for assertions and error messages.
   */
  readonly stackTrace?: StackTrace | undefined
  /**
   * Identifier of the network request associated with this message.
   */
  readonly networkRequestId?: Network.RequestId | undefined
  /**
   * Time when this message was added. Currently only used when an expensive operation happens to make sure that the frontend can account for it.
   */
  readonly timestamp?: number | undefined
}

/**
 * Schema for `ConsoleMessage`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ConsoleMessage = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    source: ChannelSource,
    level: ConsoleMessageLevel,
    text: Schema.String,
    type: Schema.optional(ConsoleMessageType),
    url: Schema.optional(Schema.String),
    line: Schema.optional(Schema.Int),
    column: Schema.optional(Schema.Int),
    repeatCount: Schema.optional(Schema.Int),
    parameters: Schema.optional(Schema.Array(Runtime.RemoteObject)),
    stackTrace: Schema.optional(StackTrace),
    networkRequestId: Schema.optional(Network.RequestId),
    timestamp: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Console.ConsoleMessage" })
) as any as Schema.Codec<ConsoleMessage>

/**
 * Message severity.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ConsoleMessageLevel =
  | "log"
  | "info"
  | "warning"
  | "error"
  | "debug"
  | (string & {})

/**
 * Schema for `ConsoleMessageLevel`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ConsoleMessageLevel = Schema.String as any as Schema.Codec<ConsoleMessageLevel>

/**
 * Console message type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ConsoleMessageType =
  | "log"
  | "dir"
  | "dirxml"
  | "table"
  | "trace"
  | "clear"
  | "startGroup"
  | "startGroupCollapsed"
  | "endGroup"
  | "assert"
  | "timing"
  | "profile"
  | "profileEnd"
  | "image"
  | (string & {})

/**
 * Schema for `ConsoleMessageType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ConsoleMessageType = Schema.String as any as Schema.Codec<ConsoleMessageType>

/**
 * Call frames for async function calls, console assertions, and error messages.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StackTrace {
  readonly callFrames: ReadonlyArray<CallFrame>
  /**
   * Whether the first item in <code>callFrames</code> is the native function that scheduled the asynchronous operation (e.g. setTimeout).
   */
  readonly topCallFrameIsBoundary?: boolean | undefined
  /**
   * Whether one or more frames have been truncated from the bottom of the stack.
   */
  readonly truncated?: boolean | undefined
  /**
   * Parent StackTrace.
   */
  readonly parentStackTrace?: StackTrace | undefined
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
    callFrames: Schema.Array(CallFrame),
    topCallFrameIsBoundary: Schema.optional(Schema.Boolean),
    truncated: Schema.optional(Schema.Boolean),
    parentStackTrace: Schema.optional(StackTrace)
  }).annotate({ identifier: "Console.StackTrace" })
) as any as Schema.Codec<StackTrace>

/**
 * List of the different message sources that are non-default logging channels.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetLoggingChannelsResult {
  /**
   * Logging channels.
   */
  readonly channels: ReadonlyArray<Channel>
}

/**
 * Schema for `GetLoggingChannelsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetLoggingChannelsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    channels: Schema.Array(Channel)
  }).annotate({ identifier: "Console.GetLoggingChannelsResult" })
) as any as Schema.Codec<GetLoggingChannelsResult>

/**
 * Issued from console.takeHeapSnapshot.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HeapSnapshotParams {
  readonly timestamp: number
  /**
   * Snapshot at the end of tracking.
   */
  readonly snapshotData: Heap.HeapSnapshotData
  /**
   * Optional title provided to console.takeHeapSnapshot.
   */
  readonly title?: string | undefined
}

/**
 * Schema for `HeapSnapshotParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HeapSnapshotParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number,
    snapshotData: Heap.HeapSnapshotData,
    title: Schema.optional(Schema.String)
  }).annotate({ identifier: "Console.HeapSnapshotParams" })
) as any as Schema.Codec<HeapSnapshotParams>

/**
 * Issued when new console message is added.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MessageAddedParams {
  /**
   * Console message that has been added.
   */
  readonly message: ConsoleMessage
}

/**
 * Schema for `MessageAddedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MessageAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    message: ConsoleMessage
  }).annotate({ identifier: "Console.MessageAddedParams" })
) as any as Schema.Codec<MessageAddedParams>

/**
 * Issued when subsequent message(s) are equal to the previous one(s).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MessageRepeatCountUpdatedParams {
  /**
   * New repeat count value.
   */
  readonly count: number
  /**
   * Timestamp of the latest message.
   */
  readonly timestamp?: number | undefined
}

/**
 * Schema for `MessageRepeatCountUpdatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MessageRepeatCountUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    count: Schema.Int,
    timestamp: Schema.optional(Schema.Number)
  }).annotate({ identifier: "Console.MessageRepeatCountUpdatedParams" })
) as any as Schema.Codec<MessageRepeatCountUpdatedParams>

/**
 * Issued when console is cleared. This happens either upon <code>clearMessages</code> command or after page navigation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MessagesClearedParams {
  /**
   * The reason the console is being cleared.
   */
  readonly reason: ClearReason
}

/**
 * Schema for `MessagesClearedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MessagesClearedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    reason: ClearReason
  }).annotate({ identifier: "Console.MessagesClearedParams" })
) as any as Schema.Codec<MessagesClearedParams>

/**
 * Control whether calling <code>console.clear()</code> has an effect in Web Inspector. Defaults to true.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetConsoleClearAPIEnabledParams {
  readonly enable: boolean
}

/**
 * Schema for `SetConsoleClearAPIEnabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetConsoleClearAPIEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enable: Schema.Boolean
  }).annotate({ identifier: "Console.SetConsoleClearAPIEnabledParams" })
) as any as Schema.Codec<SetConsoleClearAPIEnabledParams>

/**
 * Modify the level of a channel.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetLoggingChannelLevelParams {
  /**
   * Logging channel to modify.
   */
  readonly source: ChannelSource
  /**
   * New level.
   */
  readonly level: ChannelLevel
}

/**
 * Schema for `SetLoggingChannelLevelParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetLoggingChannelLevelParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    source: ChannelSource,
    level: ChannelLevel
  }).annotate({ identifier: "Console.SetLoggingChannelLevelParams" })
) as any as Schema.Codec<SetLoggingChannelLevelParams>

/**
 * Clears console messages collected in the browser.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const clearMessages: Protocol.CommandDef<"Console.clearMessages", void, void> = /*#__PURE__*/ Protocol.command(
  "Console.clearMessages",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Disables console domain, prevents further console messages from being reported to the client.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Console.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Console.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables console domain, sends the messages collected so far to the client by means of the <code>messageAdded</code> notification.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Console.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Console.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * List of the different message sources that are non-default logging channels.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getLoggingChannels: Protocol.CommandDef<"Console.getLoggingChannels", void, GetLoggingChannelsResult> =
  /*#__PURE__*/ Protocol.command(
    "Console.getLoggingChannels",
    undefined,
    GetLoggingChannelsResult,
    { status: "stable" }
  )

/**
 * Control whether calling <code>console.clear()</code> has an effect in Web Inspector. Defaults to true.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setConsoleClearAPIEnabled: Protocol.CommandDef<
  "Console.setConsoleClearAPIEnabled",
  SetConsoleClearAPIEnabledParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Console.setConsoleClearAPIEnabled",
  SetConsoleClearAPIEnabledParams,
  undefined,
  { status: "stable" }
)

/**
 * Modify the level of a channel.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setLoggingChannelLevel: Protocol.CommandDef<
  "Console.setLoggingChannelLevel",
  SetLoggingChannelLevelParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Console.setLoggingChannelLevel",
  SetLoggingChannelLevelParams,
  undefined,
  { status: "stable" }
)

/**
 * Issued from console.takeHeapSnapshot.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const heapSnapshot: Protocol.EventDef<"Console.heapSnapshot", HeapSnapshotParams> = /*#__PURE__*/ Protocol.event(
  "Console.heapSnapshot",
  HeapSnapshotParams,
  { status: "stable" }
)

/**
 * Issued when new console message is added.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const messageAdded: Protocol.EventDef<"Console.messageAdded", MessageAddedParams> = /*#__PURE__*/ Protocol.event(
  "Console.messageAdded",
  MessageAddedParams,
  { status: "stable" }
)

/**
 * Issued when subsequent message(s) are equal to the previous one(s).
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const messageRepeatCountUpdated: Protocol.EventDef<
  "Console.messageRepeatCountUpdated",
  MessageRepeatCountUpdatedParams
> = /*#__PURE__*/ Protocol.event(
  "Console.messageRepeatCountUpdated",
  MessageRepeatCountUpdatedParams,
  { status: "stable" }
)

/**
 * Issued when console is cleared. This happens either upon <code>clearMessages</code> command or after page navigation.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const messagesCleared: Protocol.EventDef<"Console.messagesCleared", MessagesClearedParams> =
  /*#__PURE__*/ Protocol.event(
    "Console.messagesCleared",
    MessagesClearedParams,
    { status: "stable" }
  )
