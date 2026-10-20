/**
 * Defines events for background web platform features.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Network from "./Network.ts"
import * as ServiceWorker from "./ServiceWorker.ts"

/**
 * `BackgroundServiceEvent`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BackgroundServiceEvent {
  /**
   * Timestamp of the event (in seconds).
   */
  readonly timestamp: Network.TimeSinceEpoch
  /**
   * The origin this event belongs to.
   */
  readonly origin: string
  /**
   * The Service Worker ID that initiated the event.
   */
  readonly serviceWorkerRegistrationId: ServiceWorker.RegistrationID
  /**
   * The Background Service this event belongs to.
   */
  readonly service: ServiceName
  /**
   * A description of the event.
   */
  readonly eventName: string
  /**
   * An identifier that groups related events together.
   */
  readonly instanceId: string
  /**
   * A list of event-specific information.
   */
  readonly eventMetadata: ReadonlyArray<EventMetadata>
  /**
   * Storage key this event belongs to.
   */
  readonly storageKey: string
}

/**
 * Schema for `BackgroundServiceEvent`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BackgroundServiceEvent = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Network.TimeSinceEpoch,
    origin: Schema.String,
    serviceWorkerRegistrationId: ServiceWorker.RegistrationID,
    service: ServiceName,
    eventName: Schema.String,
    instanceId: Schema.String,
    eventMetadata: Schema.Array(EventMetadata),
    storageKey: Schema.String
  }).annotate({ identifier: "BackgroundService.BackgroundServiceEvent" })
) as any as Schema.Codec<BackgroundServiceEvent>

/**
 * A key-value pair for additional event information to pass along.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EventMetadata {
  readonly key: string
  readonly value: string
}

/**
 * Schema for `EventMetadata`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EventMetadata = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    key: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "BackgroundService.EventMetadata" })
) as any as Schema.Codec<EventMetadata>

/**
 * The Background Service that will be associated with the commands/events.
 * Every Background Service operates independently, but they share the same
 * API.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ServiceName =
  | "backgroundFetch"
  | "backgroundSync"
  | "pushMessaging"
  | "notifications"
  | "paymentHandler"
  | "periodicBackgroundSync"
  | (string & {})

/**
 * Schema for `ServiceName`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceName = Schema.String as any as Schema.Codec<ServiceName>

/**
 * Called with all existing backgroundServiceEvents when enabled, and all new
 * events afterwards if enabled and recording.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BackgroundServiceEventReceivedParams {
  readonly backgroundServiceEvent: BackgroundServiceEvent
}

/**
 * Schema for `BackgroundServiceEventReceivedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BackgroundServiceEventReceivedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    backgroundServiceEvent: BackgroundServiceEvent
  }).annotate({ identifier: "BackgroundService.BackgroundServiceEventReceivedParams" })
) as any as Schema.Codec<BackgroundServiceEventReceivedParams>

/**
 * Clears all stored data for the service.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ClearEventsParams {
  readonly service: ServiceName
}

/**
 * Schema for `ClearEventsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ClearEventsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    service: ServiceName
  }).annotate({ identifier: "BackgroundService.ClearEventsParams" })
) as any as Schema.Codec<ClearEventsParams>

/**
 * Called when the recording state for the service has been updated.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RecordingStateChangedParams {
  readonly isRecording: boolean
  readonly service: ServiceName
}

/**
 * Schema for `RecordingStateChangedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RecordingStateChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    isRecording: Schema.Boolean,
    service: ServiceName
  }).annotate({ identifier: "BackgroundService.RecordingStateChangedParams" })
) as any as Schema.Codec<RecordingStateChangedParams>

/**
 * Set the recording state for the service.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetRecordingParams {
  readonly shouldRecord: boolean
  readonly service: ServiceName
}

/**
 * Schema for `SetRecordingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetRecordingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    shouldRecord: Schema.Boolean,
    service: ServiceName
  }).annotate({ identifier: "BackgroundService.SetRecordingParams" })
) as any as Schema.Codec<SetRecordingParams>

/**
 * Enables event updates for the service.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StartObservingParams {
  readonly service: ServiceName
}

/**
 * Schema for `StartObservingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StartObservingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    service: ServiceName
  }).annotate({ identifier: "BackgroundService.StartObservingParams" })
) as any as Schema.Codec<StartObservingParams>

/**
 * Disables event updates for the service.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StopObservingParams {
  readonly service: ServiceName
}

/**
 * Schema for `StopObservingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StopObservingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    service: ServiceName
  }).annotate({ identifier: "BackgroundService.StopObservingParams" })
) as any as Schema.Codec<StopObservingParams>

/**
 * Clears all stored data for the service.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const clearEvents: Protocol.CommandDef<"BackgroundService.clearEvents", ClearEventsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "BackgroundService.clearEvents",
    ClearEventsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Set the recording state for the service.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setRecording: Protocol.CommandDef<"BackgroundService.setRecording", SetRecordingParams, void> =
  /*#__PURE__*/ Protocol.command(
    "BackgroundService.setRecording",
    SetRecordingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Enables event updates for the service.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const startObserving: Protocol.CommandDef<"BackgroundService.startObserving", StartObservingParams, void> =
  /*#__PURE__*/ Protocol.command(
    "BackgroundService.startObserving",
    StartObservingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Disables event updates for the service.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const stopObserving: Protocol.CommandDef<"BackgroundService.stopObserving", StopObservingParams, void> =
  /*#__PURE__*/ Protocol.command(
    "BackgroundService.stopObserving",
    StopObservingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Called with all existing backgroundServiceEvents when enabled, and all new
 * events afterwards if enabled and recording.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const backgroundServiceEventReceived: Protocol.EventDef<
  "BackgroundService.backgroundServiceEventReceived",
  BackgroundServiceEventReceivedParams
> = /*#__PURE__*/ Protocol.event(
  "BackgroundService.backgroundServiceEventReceived",
  BackgroundServiceEventReceivedParams,
  { status: "stable" }
)

/**
 * Called when the recording state for the service has been updated.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const recordingStateChanged: Protocol.EventDef<
  "BackgroundService.recordingStateChanged",
  RecordingStateChangedParams
> = /*#__PURE__*/ Protocol.event(
  "BackgroundService.recordingStateChanged",
  RecordingStateChangedParams,
  { status: "stable" }
)
