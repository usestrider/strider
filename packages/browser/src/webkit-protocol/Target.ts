/**
 * The Target domain.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Description of a target.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TargetInfo {
  /**
   * Unique identifier for the target.
   */
  readonly targetId: string
  readonly type: TargetInfoType
  /**
   * True value indicates that this is a provisional page target i.e. Such target may be created when current page starts cross-origin navigation. Eventually each provisional target is either committed and swaps with the current target or gets destroyed, e.g. in case of load request failure.
   */
  readonly isProvisional?: boolean | undefined
  /**
   * Whether the target is paused on start and has to be explicitely resumed by inspector.
   */
  readonly isPaused?: boolean | undefined
}

/**
 * Schema for `TargetInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TargetInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: Schema.String,
    type: TargetInfoType,
    isProvisional: Schema.optional(Schema.Boolean),
    isPaused: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "Target.TargetInfo" })
) as any as Schema.Codec<TargetInfo>

/**
 * `TargetInfo.type` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TargetInfoType =
  | "page"
  | "frame"
  | "service-worker"
  | "worker"
  | (string & {})

/**
 * Schema for `TargetInfoType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TargetInfoType = Schema.String as any as Schema.Codec<TargetInfoType>

/**
 * Reveals the target on screen.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ActivateParams {
  readonly targetId: string
}

/**
 * Schema for `ActivateParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ActivateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: Schema.String
  }).annotate({ identifier: "Target.ActivateParams" })
) as any as Schema.Codec<ActivateParams>

/**
 * This event is fired when provisional load is committed. Provisional target swaps with the current target.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DidCommitProvisionalTargetParams {
  /**
   * ID of the old target that is swapped with the committed one.
   */
  readonly oldTargetId: string
  /**
   * ID of the committed target.
   */
  readonly newTargetId: string
}

/**
 * Schema for `DidCommitProvisionalTargetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DidCommitProvisionalTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    oldTargetId: Schema.String,
    newTargetId: Schema.String
  }).annotate({ identifier: "Target.DidCommitProvisionalTargetParams" })
) as any as Schema.Codec<DidCommitProvisionalTargetParams>

/**
 * `dispatchMessageFromTarget.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DispatchMessageFromTargetParams {
  readonly targetId: string
  /**
   * JSON Inspector Protocol message (response or event) to be dispatched on the frontend.
   */
  readonly message: string
}

/**
 * Schema for `DispatchMessageFromTargetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DispatchMessageFromTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: Schema.String,
    message: Schema.String
  }).annotate({ identifier: "Target.DispatchMessageFromTargetParams" })
) as any as Schema.Codec<DispatchMessageFromTargetParams>

/**
 * Will resume target if it was paused on start.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResumeParams {
  readonly targetId: string
}

/**
 * Schema for `ResumeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResumeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: Schema.String
  }).annotate({ identifier: "Target.ResumeParams" })
) as any as Schema.Codec<ResumeParams>

/**
 * Send an Inspector Protocol message to be dispatched to a Target's agents.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SendMessageToTargetParams {
  readonly targetId: string
  /**
   * JSON Inspector Protocol message (command) to be dispatched on the backend.
   */
  readonly message: string
}

/**
 * Schema for `SendMessageToTargetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SendMessageToTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: Schema.String,
    message: Schema.String
  }).annotate({ identifier: "Target.SendMessageToTargetParams" })
) as any as Schema.Codec<SendMessageToTargetParams>

/**
 * If set to true, new targets will be paused on start waiting for resume command. Other commands can be dispatched on the target before it is resumed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetPauseOnStartParams {
  /**
   * If set to true, new targets will be paused on start waiting for resume command.
   */
  readonly pauseOnStart: boolean
}

/**
 * Schema for `SetPauseOnStartParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetPauseOnStartParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pauseOnStart: Schema.Boolean
  }).annotate({ identifier: "Target.SetPauseOnStartParams" })
) as any as Schema.Codec<SetPauseOnStartParams>

/**
 * `targetCreated.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TargetCreatedParams {
  readonly targetInfo: TargetInfo
}

/**
 * Schema for `TargetCreatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TargetCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetInfo: TargetInfo
  }).annotate({ identifier: "Target.TargetCreatedParams" })
) as any as Schema.Codec<TargetCreatedParams>

/**
 * `targetDestroyed.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TargetDestroyedParams {
  readonly targetId: string
  readonly crashed: boolean
}

/**
 * Schema for `TargetDestroyedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TargetDestroyedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    targetId: Schema.String,
    crashed: Schema.Boolean
  }).annotate({ identifier: "Target.TargetDestroyedParams" })
) as any as Schema.Codec<TargetDestroyedParams>

/**
 * Reveals the target on screen.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const activate: Protocol.CommandDef<"Target.activate", ActivateParams, void> = /*#__PURE__*/ Protocol.command(
  "Target.activate",
  ActivateParams,
  undefined,
  { status: "stable" }
)

/**
 * Will resume target if it was paused on start.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resume: Protocol.CommandDef<"Target.resume", ResumeParams, void> = /*#__PURE__*/ Protocol.command(
  "Target.resume",
  ResumeParams,
  undefined,
  { status: "stable" }
)

/**
 * Send an Inspector Protocol message to be dispatched to a Target's agents.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const sendMessageToTarget: Protocol.CommandDef<"Target.sendMessageToTarget", SendMessageToTargetParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Target.sendMessageToTarget",
    SendMessageToTargetParams,
    undefined,
    { status: "stable" }
  )

/**
 * If set to true, new targets will be paused on start waiting for resume command. Other commands can be dispatched on the target before it is resumed.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setPauseOnStart: Protocol.CommandDef<"Target.setPauseOnStart", SetPauseOnStartParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Target.setPauseOnStart",
    SetPauseOnStartParams,
    undefined,
    { status: "stable" }
  )

/**
 * This event is fired when provisional load is committed. Provisional target swaps with the current target.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const didCommitProvisionalTarget: Protocol.EventDef<
  "Target.didCommitProvisionalTarget",
  DidCommitProvisionalTargetParams
> = /*#__PURE__*/ Protocol.event(
  "Target.didCommitProvisionalTarget",
  DidCommitProvisionalTargetParams,
  { status: "stable" }
)

/**
 * The `Target.dispatchMessageFromTarget` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const dispatchMessageFromTarget: Protocol.EventDef<
  "Target.dispatchMessageFromTarget",
  DispatchMessageFromTargetParams
> = /*#__PURE__*/ Protocol.event(
  "Target.dispatchMessageFromTarget",
  DispatchMessageFromTargetParams,
  { status: "stable" }
)

/**
 * The `Target.targetCreated` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const targetCreated: Protocol.EventDef<"Target.targetCreated", TargetCreatedParams> = /*#__PURE__*/ Protocol
  .event(
    "Target.targetCreated",
    TargetCreatedParams,
    { status: "stable" }
  )

/**
 * The `Target.targetDestroyed` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const targetDestroyed: Protocol.EventDef<"Target.targetDestroyed", TargetDestroyedParams> =
  /*#__PURE__*/ Protocol.event(
    "Target.targetDestroyed",
    TargetDestroyedParams,
    { status: "stable" }
  )
