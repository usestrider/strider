/**
 * The ServiceWorker domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Target from "./Target.ts"

/**
 * `RegistrationID`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type RegistrationID = Brand.Branded<string, "~@usestrider/browser/cdp/ServiceWorker/RegistrationID">

/**
 * Schema for `RegistrationID`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RegistrationID = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/ServiceWorker/RegistrationID")
) as any as Schema.Codec<RegistrationID>

/**
 * ServiceWorker error message.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ServiceWorkerErrorMessage {
  readonly errorMessage: string
  readonly registrationId: RegistrationID
  readonly versionId: string
  readonly sourceURL: string
  readonly lineNumber: number
  readonly columnNumber: number
}

/**
 * Schema for `ServiceWorkerErrorMessage`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerErrorMessage = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    errorMessage: Schema.String,
    registrationId: RegistrationID,
    versionId: Schema.String,
    sourceURL: Schema.String,
    lineNumber: Schema.Int,
    columnNumber: Schema.Int
  }).annotate({ identifier: "ServiceWorker.ServiceWorkerErrorMessage" })
) as any as Schema.Codec<ServiceWorkerErrorMessage>

/**
 * ServiceWorker registration.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ServiceWorkerRegistration {
  readonly registrationId: RegistrationID
  readonly scopeURL: string
  readonly isDeleted: boolean
}

/**
 * Schema for `ServiceWorkerRegistration`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerRegistration = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    registrationId: RegistrationID,
    scopeURL: Schema.String,
    isDeleted: Schema.Boolean
  }).annotate({ identifier: "ServiceWorker.ServiceWorkerRegistration" })
) as any as Schema.Codec<ServiceWorkerRegistration>

/**
 * Mostly corresponds to `RouterCondition` in ServiceWorker spec
 * (https://www.w3.org/TR/service-workers/#dictdef-routercondition)
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ServiceWorkerRouterCondition {
  /**
   * Plain text, or JSON serialization of URLPatternInit or URLPattern
   */
  readonly urlPattern?: string | undefined
  readonly requestMethod?: string | undefined
  readonly requestMode?: string | undefined
  readonly requestDestination?: string | undefined
  readonly runningStatus?: ServiceWorkerVersionRunningStatus | undefined
  readonly or?: ReadonlyArray<ServiceWorkerRouterCondition> | undefined
  readonly not?: ServiceWorkerRouterCondition | undefined
}

/**
 * Schema for `ServiceWorkerRouterCondition`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerRouterCondition = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    urlPattern: Schema.optional(Schema.String),
    requestMethod: Schema.optional(Schema.String),
    requestMode: Schema.optional(Schema.String),
    requestDestination: Schema.optional(Schema.String),
    runningStatus: Schema.optional(ServiceWorkerVersionRunningStatus),
    or: Schema.optional(Schema.Array(ServiceWorkerRouterCondition)),
    not: Schema.optional(ServiceWorkerRouterCondition)
  }).annotate({ identifier: "ServiceWorker.ServiceWorkerRouterCondition" })
) as any as Schema.Codec<ServiceWorkerRouterCondition, unknown>

/**
 * `ServiceWorkerRouterRule`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ServiceWorkerRouterRule {
  readonly condition: ServiceWorkerRouterCondition
  readonly source: ServiceWorkerRouterSource
  /**
   * Rule ID assigned by the browser. Unique within each ServiceWorkerVersion.
   */
  readonly id: number
}

/**
 * Schema for `ServiceWorkerRouterRule`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerRouterRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    condition: ServiceWorkerRouterCondition,
    source: ServiceWorkerRouterSource,
    id: Schema.Int
  }).annotate({ identifier: "ServiceWorker.ServiceWorkerRouterRule" })
) as any as Schema.Codec<ServiceWorkerRouterRule, unknown>

/**
 * Corresponds to `RouterSource` in the spec while the representation is different as follows.
 * (https://www.w3.org/TR/service-workers/#typedefdef-routersource)
 * - `RouterSourceEnum`: `type` equals `cache`, `sourceDict` is null.
 * - `RouterSourceDict`: `type` equals `sourceDict`, `sourceDict` has valid value.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ServiceWorkerRouterSource {
  readonly type: ServiceWorkerRouterSourceType
  /**
   * Non-empty iff `type` equals "sourceDict".
   */
  readonly sourceDict?: ServiceWorkerRouterSourceDict | undefined
}

/**
 * Schema for `ServiceWorkerRouterSource`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerRouterSource = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: ServiceWorkerRouterSourceType,
    sourceDict: Schema.optional(ServiceWorkerRouterSourceDict)
  }).annotate({ identifier: "ServiceWorker.ServiceWorkerRouterSource" })
) as any as Schema.Codec<ServiceWorkerRouterSource>

/**
 * https://www.w3.org/TR/service-workers/#dictdef-routersourcedict
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ServiceWorkerRouterSourceDict {
  readonly cacheName: string
}

/**
 * Schema for `ServiceWorkerRouterSourceDict`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerRouterSourceDict = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cacheName: Schema.String
  }).annotate({ identifier: "ServiceWorker.ServiceWorkerRouterSourceDict" })
) as any as Schema.Codec<ServiceWorkerRouterSourceDict>

/**
 * `ServiceWorkerRouterSourceType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ServiceWorkerRouterSourceType =
  | "cache"
  | "fetchEvent"
  | "network"
  | "raceNetworkAndFetchHandler"
  | "raceNetworkAndCache"
  | "sourceDict"
  | (string & {})

/**
 * Schema for `ServiceWorkerRouterSourceType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerRouterSourceType = Schema.String as any as Schema.Codec<ServiceWorkerRouterSourceType>

/**
 * ServiceWorker version.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ServiceWorkerVersion {
  readonly versionId: string
  readonly registrationId: RegistrationID
  readonly scriptURL: string
  readonly runningStatus: ServiceWorkerVersionRunningStatus
  readonly status: ServiceWorkerVersionStatus
  /**
   * The Last-Modified header value of the main script.
   */
  readonly scriptLastModified?: number | undefined
  /**
   * The time at which the response headers of the main script were received from the server.
   * For cached script it is the last time the cache entry was validated.
   */
  readonly scriptResponseTime?: number | undefined
  readonly controlledClients?: ReadonlyArray<Target.TargetID> | undefined
  readonly targetId?: Target.TargetID | undefined
  /**
   * Migration to `typedRouterRules` is in progress. The browser sends either
   * `routerRules` or `typedRouterRules`.
   * TODO(crbug.com/540469610): Remove `routerRules` after the migration.
   */
  readonly routerRules?: string | undefined
  readonly typedRouterRules?: ReadonlyArray<ServiceWorkerRouterRule> | undefined
}

/**
 * Schema for `ServiceWorkerVersion`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerVersion = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    versionId: Schema.String,
    registrationId: RegistrationID,
    scriptURL: Schema.String,
    runningStatus: ServiceWorkerVersionRunningStatus,
    status: ServiceWorkerVersionStatus,
    scriptLastModified: Schema.optional(Schema.Number),
    scriptResponseTime: Schema.optional(Schema.Number),
    controlledClients: Schema.optional(Schema.Array(Target.TargetID)),
    targetId: Schema.optional(Target.TargetID),
    routerRules: Schema.optional(Schema.String),
    typedRouterRules: Schema.optional(Schema.Array(ServiceWorkerRouterRule))
  }).annotate({ identifier: "ServiceWorker.ServiceWorkerVersion" })
) as any as Schema.Codec<ServiceWorkerVersion, unknown>

/**
 * `ServiceWorkerVersionRunningStatus` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ServiceWorkerVersionRunningStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | (string & {})

/**
 * Schema for `ServiceWorkerVersionRunningStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerVersionRunningStatus = Schema.String as any as Schema.Codec<ServiceWorkerVersionRunningStatus>

/**
 * `ServiceWorkerVersionStatus` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ServiceWorkerVersionStatus =
  | "new"
  | "installing"
  | "installed"
  | "activating"
  | "activated"
  | "redundant"
  | (string & {})

/**
 * Schema for `ServiceWorkerVersionStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ServiceWorkerVersionStatus = Schema.String as any as Schema.Codec<ServiceWorkerVersionStatus>

/**
 * `deliverPushMessage.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DeliverPushMessageParams {
  readonly origin: string
  readonly registrationId: RegistrationID
  readonly data: string
}

/**
 * Schema for `DeliverPushMessageParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DeliverPushMessageParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    registrationId: RegistrationID,
    data: Schema.String
  }).annotate({ identifier: "ServiceWorker.DeliverPushMessageParams" })
) as any as Schema.Codec<DeliverPushMessageParams>

/**
 * `dispatchPeriodicSyncEvent.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DispatchPeriodicSyncEventParams {
  readonly origin: string
  readonly registrationId: RegistrationID
  readonly tag: string
}

/**
 * Schema for `DispatchPeriodicSyncEventParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DispatchPeriodicSyncEventParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    registrationId: RegistrationID,
    tag: Schema.String
  }).annotate({ identifier: "ServiceWorker.DispatchPeriodicSyncEventParams" })
) as any as Schema.Codec<DispatchPeriodicSyncEventParams>

/**
 * `dispatchSyncEvent.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DispatchSyncEventParams {
  readonly origin: string
  readonly registrationId: RegistrationID
  readonly tag: string
  readonly lastChance: boolean
}

/**
 * Schema for `DispatchSyncEventParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DispatchSyncEventParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    origin: Schema.String,
    registrationId: RegistrationID,
    tag: Schema.String,
    lastChance: Schema.Boolean
  }).annotate({ identifier: "ServiceWorker.DispatchSyncEventParams" })
) as any as Schema.Codec<DispatchSyncEventParams>

/**
 * `setForceUpdateOnPageLoad.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetForceUpdateOnPageLoadParams {
  readonly forceUpdateOnPageLoad: boolean
}

/**
 * Schema for `SetForceUpdateOnPageLoadParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetForceUpdateOnPageLoadParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    forceUpdateOnPageLoad: Schema.Boolean
  }).annotate({ identifier: "ServiceWorker.SetForceUpdateOnPageLoadParams" })
) as any as Schema.Codec<SetForceUpdateOnPageLoadParams>

/**
 * `skipWaiting.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SkipWaitingParams {
  readonly scopeURL: string
}

/**
 * Schema for `SkipWaitingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SkipWaitingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scopeURL: Schema.String
  }).annotate({ identifier: "ServiceWorker.SkipWaitingParams" })
) as any as Schema.Codec<SkipWaitingParams>

/**
 * `startWorker.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StartWorkerParams {
  readonly scopeURL: string
}

/**
 * Schema for `StartWorkerParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StartWorkerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scopeURL: Schema.String
  }).annotate({ identifier: "ServiceWorker.StartWorkerParams" })
) as any as Schema.Codec<StartWorkerParams>

/**
 * `stopWorker.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StopWorkerParams {
  readonly versionId: string
}

/**
 * Schema for `StopWorkerParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StopWorkerParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    versionId: Schema.String
  }).annotate({ identifier: "ServiceWorker.StopWorkerParams" })
) as any as Schema.Codec<StopWorkerParams>

/**
 * `unregister.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UnregisterParams {
  readonly scopeURL: string
}

/**
 * Schema for `UnregisterParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UnregisterParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scopeURL: Schema.String
  }).annotate({ identifier: "ServiceWorker.UnregisterParams" })
) as any as Schema.Codec<UnregisterParams>

/**
 * `updateRegistration.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface UpdateRegistrationParams {
  readonly scopeURL: string
}

/**
 * Schema for `UpdateRegistrationParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const UpdateRegistrationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scopeURL: Schema.String
  }).annotate({ identifier: "ServiceWorker.UpdateRegistrationParams" })
) as any as Schema.Codec<UpdateRegistrationParams>

/**
 * `workerErrorReported.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface WorkerErrorReportedParams {
  readonly errorMessage: ServiceWorkerErrorMessage
}

/**
 * Schema for `WorkerErrorReportedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WorkerErrorReportedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    errorMessage: ServiceWorkerErrorMessage
  }).annotate({ identifier: "ServiceWorker.WorkerErrorReportedParams" })
) as any as Schema.Codec<WorkerErrorReportedParams>

/**
 * `workerRegistrationUpdated.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface WorkerRegistrationUpdatedParams {
  readonly registrations: ReadonlyArray<ServiceWorkerRegistration>
}

/**
 * Schema for `WorkerRegistrationUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WorkerRegistrationUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    registrations: Schema.Array(ServiceWorkerRegistration)
  }).annotate({ identifier: "ServiceWorker.WorkerRegistrationUpdatedParams" })
) as any as Schema.Codec<WorkerRegistrationUpdatedParams>

/**
 * `workerVersionUpdated.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface WorkerVersionUpdatedParams {
  readonly versions: ReadonlyArray<ServiceWorkerVersion>
}

/**
 * Schema for `WorkerVersionUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const WorkerVersionUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    versions: Schema.Array(ServiceWorkerVersion)
  }).annotate({ identifier: "ServiceWorker.WorkerVersionUpdatedParams" })
) as any as Schema.Codec<WorkerVersionUpdatedParams, unknown>

/**
 * Sends `ServiceWorker.deliverPushMessage`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const deliverPushMessage: Protocol.CommandDef<
  "ServiceWorker.deliverPushMessage",
  DeliverPushMessageParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "ServiceWorker.deliverPushMessage",
  DeliverPushMessageParams,
  undefined,
  { status: "stable" }
)

/**
 * Sends `ServiceWorker.disable`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"ServiceWorker.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "ServiceWorker.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sends `ServiceWorker.dispatchPeriodicSyncEvent`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const dispatchPeriodicSyncEvent: Protocol.CommandDef<
  "ServiceWorker.dispatchPeriodicSyncEvent",
  DispatchPeriodicSyncEventParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "ServiceWorker.dispatchPeriodicSyncEvent",
  DispatchPeriodicSyncEventParams,
  undefined,
  { status: "stable" }
)

/**
 * Sends `ServiceWorker.dispatchSyncEvent`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const dispatchSyncEvent: Protocol.CommandDef<"ServiceWorker.dispatchSyncEvent", DispatchSyncEventParams, void> =
  /*#__PURE__*/ Protocol.command(
    "ServiceWorker.dispatchSyncEvent",
    DispatchSyncEventParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `ServiceWorker.enable`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"ServiceWorker.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "ServiceWorker.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sends `ServiceWorker.setForceUpdateOnPageLoad`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setForceUpdateOnPageLoad: Protocol.CommandDef<
  "ServiceWorker.setForceUpdateOnPageLoad",
  SetForceUpdateOnPageLoadParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "ServiceWorker.setForceUpdateOnPageLoad",
  SetForceUpdateOnPageLoadParams,
  undefined,
  { status: "stable" }
)

/**
 * Sends `ServiceWorker.skipWaiting`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const skipWaiting: Protocol.CommandDef<"ServiceWorker.skipWaiting", SkipWaitingParams, void> =
  /*#__PURE__*/ Protocol.command(
    "ServiceWorker.skipWaiting",
    SkipWaitingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `ServiceWorker.startWorker`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const startWorker: Protocol.CommandDef<"ServiceWorker.startWorker", StartWorkerParams, void> =
  /*#__PURE__*/ Protocol.command(
    "ServiceWorker.startWorker",
    StartWorkerParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `ServiceWorker.stopAllWorkers`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const stopAllWorkers: Protocol.CommandDef<"ServiceWorker.stopAllWorkers", void, void> = /*#__PURE__*/ Protocol
  .command(
    "ServiceWorker.stopAllWorkers",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `ServiceWorker.stopWorker`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const stopWorker: Protocol.CommandDef<"ServiceWorker.stopWorker", StopWorkerParams, void> =
  /*#__PURE__*/ Protocol.command(
    "ServiceWorker.stopWorker",
    StopWorkerParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `ServiceWorker.unregister`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const unregister: Protocol.CommandDef<"ServiceWorker.unregister", UnregisterParams, void> =
  /*#__PURE__*/ Protocol.command(
    "ServiceWorker.unregister",
    UnregisterParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `ServiceWorker.updateRegistration`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const updateRegistration: Protocol.CommandDef<
  "ServiceWorker.updateRegistration",
  UpdateRegistrationParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "ServiceWorker.updateRegistration",
  UpdateRegistrationParams,
  undefined,
  { status: "stable" }
)

/**
 * The `ServiceWorker.workerErrorReported` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const workerErrorReported: Protocol.EventDef<"ServiceWorker.workerErrorReported", WorkerErrorReportedParams> =
  /*#__PURE__*/ Protocol.event(
    "ServiceWorker.workerErrorReported",
    WorkerErrorReportedParams,
    { status: "stable" }
  )

/**
 * The `ServiceWorker.workerRegistrationUpdated` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const workerRegistrationUpdated: Protocol.EventDef<
  "ServiceWorker.workerRegistrationUpdated",
  WorkerRegistrationUpdatedParams
> = /*#__PURE__*/ Protocol.event(
  "ServiceWorker.workerRegistrationUpdated",
  WorkerRegistrationUpdatedParams,
  { status: "stable" }
)

/**
 * The `ServiceWorker.workerVersionUpdated` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const workerVersionUpdated: Protocol.EventDef<"ServiceWorker.workerVersionUpdated", WorkerVersionUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "ServiceWorker.workerVersionUpdated",
    WorkerVersionUpdatedParams,
    { status: "stable" }
  )
