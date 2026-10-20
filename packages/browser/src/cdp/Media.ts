/**
 * This domain allows detailed inspection of media elements.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"

/**
 * `Player`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Player {
  readonly playerId: PlayerId
  readonly domNodeId?: DOM.BackendNodeId | undefined
}

/**
 * Schema for `Player`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Player = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    playerId: PlayerId,
    domNodeId: Schema.optional(DOM.BackendNodeId)
  }).annotate({ identifier: "Media.Player" })
) as any as Schema.Codec<Player>

/**
 * Corresponds to kMediaError
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PlayerError {
  readonly errorType: string
  /**
   * Code is the numeric enum entry for a specific set of error codes, such
   * as PipelineStatusCodes in media/base/pipeline_status.h
   */
  readonly code: number
  /**
   * A trace of where this error was caused / where it passed through.
   */
  readonly stack: ReadonlyArray<PlayerErrorSourceLocation>
  /**
   * Errors potentially have a root cause error, ie, a DecoderError might be
   * caused by an WindowsError
   */
  readonly cause: ReadonlyArray<PlayerError>
  /**
   * Extra data attached to an error, such as an HRESULT, Video Codec, etc.
   */
  readonly data: { readonly [key: string]: unknown }
}

/**
 * Schema for `PlayerError`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerError = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    errorType: Schema.String,
    code: Schema.Int,
    stack: Schema.Array(PlayerErrorSourceLocation),
    cause: Schema.Array(PlayerError),
    data: Schema.Record(Schema.String, Schema.Unknown)
  }).annotate({ identifier: "Media.PlayerError" })
) as any as Schema.Codec<PlayerError>

/**
 * Represents logged source line numbers reported in an error.
 * NOTE: file and line are from chromium c++ implementation code, not js.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PlayerErrorSourceLocation {
  readonly file: string
  readonly line: number
}

/**
 * Schema for `PlayerErrorSourceLocation`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerErrorSourceLocation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    file: Schema.String,
    line: Schema.Int
  }).annotate({ identifier: "Media.PlayerErrorSourceLocation" })
) as any as Schema.Codec<PlayerErrorSourceLocation>

/**
 * Corresponds to kMediaEventTriggered
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PlayerEvent {
  readonly timestamp: Timestamp
  readonly value: string
}

/**
 * Schema for `PlayerEvent`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerEvent = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Timestamp,
    value: Schema.String
  }).annotate({ identifier: "Media.PlayerEvent" })
) as any as Schema.Codec<PlayerEvent>

/**
 * Players will get an ID that is unique within the agent context.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PlayerId = Brand.Branded<string, "~@usestrider/browser/cdp/Media/PlayerId">

/**
 * Schema for `PlayerId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Media/PlayerId")
) as any as Schema.Codec<PlayerId>

/**
 * Have one type per entry in MediaLogRecord::Type
 * Corresponds to kMessage
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PlayerMessage {
  /**
   * Keep in sync with MediaLogMessageLevel
   * We are currently keeping the message level 'error' separate from the
   * PlayerError type because right now they represent different things,
   * this one being a DVLOG(ERROR) style log message that gets printed
   * based on what log level is selected in the UI, and the other is a
   * representation of a media::PipelineStatus object. Soon however we're
   * going to be moving away from using PipelineStatus for errors and
   * introducing a new error type which should hopefully let us integrate
   * the error log level into the PlayerError type.
   */
  readonly level: PlayerMessageLevel
  readonly message: string
}

/**
 * Schema for `PlayerMessage`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerMessage = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    level: PlayerMessageLevel,
    message: Schema.String
  }).annotate({ identifier: "Media.PlayerMessage" })
) as any as Schema.Codec<PlayerMessage>

/**
 * Keep in sync with MediaLogMessageLevel
 * We are currently keeping the message level 'error' separate from the
 * PlayerError type because right now they represent different things,
 * this one being a DVLOG(ERROR) style log message that gets printed
 * based on what log level is selected in the UI, and the other is a
 * representation of a media::PipelineStatus object. Soon however we're
 * going to be moving away from using PipelineStatus for errors and
 * introducing a new error type which should hopefully let us integrate
 * the error log level into the PlayerError type.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PlayerMessageLevel =
  | "error"
  | "warning"
  | "info"
  | "debug"
  | (string & {})

/**
 * Schema for `PlayerMessageLevel`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerMessageLevel = Schema.String as any as Schema.Codec<PlayerMessageLevel>

/**
 * Corresponds to kMediaPropertyChange
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PlayerProperty {
  readonly name: string
  readonly value: string
}

/**
 * Schema for `PlayerProperty`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerProperty = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "Media.PlayerProperty" })
) as any as Schema.Codec<PlayerProperty>

/**
 * `Timestamp`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Timestamp = number

/**
 * Schema for `Timestamp`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Timestamp = Schema.Number as any as Schema.Codec<Timestamp>

/**
 * Called whenever a player is created, or when a new agent joins and receives
 * a list of active players. If an agent is restored, it will receive one
 * event for each active player.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PlayerCreatedParams {
  readonly player: Player
}

/**
 * Schema for `PlayerCreatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    player: Player
  }).annotate({ identifier: "Media.PlayerCreatedParams" })
) as any as Schema.Codec<PlayerCreatedParams>

/**
 * Send a list of any errors that need to be delivered.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PlayerErrorsRaisedParams {
  readonly playerId: PlayerId
  readonly errors: ReadonlyArray<PlayerError>
}

/**
 * Schema for `PlayerErrorsRaisedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerErrorsRaisedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    playerId: PlayerId,
    errors: Schema.Array(PlayerError)
  }).annotate({ identifier: "Media.PlayerErrorsRaisedParams" })
) as any as Schema.Codec<PlayerErrorsRaisedParams>

/**
 * Send events as a list, allowing them to be batched on the browser for less
 * congestion. If batched, events must ALWAYS be in chronological order.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PlayerEventsAddedParams {
  readonly playerId: PlayerId
  readonly events: ReadonlyArray<PlayerEvent>
}

/**
 * Schema for `PlayerEventsAddedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerEventsAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    playerId: PlayerId,
    events: Schema.Array(PlayerEvent)
  }).annotate({ identifier: "Media.PlayerEventsAddedParams" })
) as any as Schema.Codec<PlayerEventsAddedParams>

/**
 * Send a list of any messages that need to be delivered.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PlayerMessagesLoggedParams {
  readonly playerId: PlayerId
  readonly messages: ReadonlyArray<PlayerMessage>
}

/**
 * Schema for `PlayerMessagesLoggedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerMessagesLoggedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    playerId: PlayerId,
    messages: Schema.Array(PlayerMessage)
  }).annotate({ identifier: "Media.PlayerMessagesLoggedParams" })
) as any as Schema.Codec<PlayerMessagesLoggedParams>

/**
 * This can be called multiple times, and can be used to set / override /
 * remove player properties. A null propValue indicates removal.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PlayerPropertiesChangedParams {
  readonly playerId: PlayerId
  readonly properties: ReadonlyArray<PlayerProperty>
}

/**
 * Schema for `PlayerPropertiesChangedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlayerPropertiesChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    playerId: PlayerId,
    properties: Schema.Array(PlayerProperty)
  }).annotate({ identifier: "Media.PlayerPropertiesChangedParams" })
) as any as Schema.Codec<PlayerPropertiesChangedParams>

/**
 * Disables the Media domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Media.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Media.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables the Media domain
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Media.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Media.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Called whenever a player is created, or when a new agent joins and receives
 * a list of active players. If an agent is restored, it will receive one
 * event for each active player.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const playerCreated: Protocol.EventDef<"Media.playerCreated", PlayerCreatedParams> = /*#__PURE__*/ Protocol
  .event(
    "Media.playerCreated",
    PlayerCreatedParams,
    { status: "stable" }
  )

/**
 * Send a list of any errors that need to be delivered.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const playerErrorsRaised: Protocol.EventDef<"Media.playerErrorsRaised", PlayerErrorsRaisedParams> =
  /*#__PURE__*/ Protocol.event(
    "Media.playerErrorsRaised",
    PlayerErrorsRaisedParams,
    { status: "stable" }
  )

/**
 * Send events as a list, allowing them to be batched on the browser for less
 * congestion. If batched, events must ALWAYS be in chronological order.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const playerEventsAdded: Protocol.EventDef<"Media.playerEventsAdded", PlayerEventsAddedParams> =
  /*#__PURE__*/ Protocol.event(
    "Media.playerEventsAdded",
    PlayerEventsAddedParams,
    { status: "stable" }
  )

/**
 * Send a list of any messages that need to be delivered.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const playerMessagesLogged: Protocol.EventDef<"Media.playerMessagesLogged", PlayerMessagesLoggedParams> =
  /*#__PURE__*/ Protocol.event(
    "Media.playerMessagesLogged",
    PlayerMessagesLoggedParams,
    { status: "stable" }
  )

/**
 * This can be called multiple times, and can be used to set / override /
 * remove player properties. A null propValue indicates removal.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const playerPropertiesChanged: Protocol.EventDef<
  "Media.playerPropertiesChanged",
  PlayerPropertiesChangedParams
> = /*#__PURE__*/ Protocol.event(
  "Media.playerPropertiesChanged",
  PlayerPropertiesChangedParams,
  { status: "stable" }
)
