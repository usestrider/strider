/**
 * Domain for tracking/modifying Web Animations, as well as CSS (declarative) animations and transitions.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-stock`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Console from "./Console.ts"
import * as DOM from "./DOM.ts"
import * as Runtime from "./Runtime.ts"

/**
 * `Animation`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Animation {
  readonly animationId: AnimationId
  /**
   * Equal to `Animation.prototype.get id`.
   */
  readonly name?: string | undefined
  /**
   * Equal to the corresponding `animation-name` CSS property. Should not be provided if `transitionProperty` is also provided.
   */
  readonly cssAnimationName?: string | undefined
  /**
   * Equal to the corresponding `transition-property` CSS property. Should not be provided if `animationName` is also provided.
   */
  readonly cssTransitionProperty?: string | undefined
  /**
   * Backtrace that was captured when this `WebAnimation` was created.
   */
  readonly stackTrace?: Console.StackTrace | undefined
}

/**
 * Schema for `Animation`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Animation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationId: AnimationId,
    name: Schema.optional(Schema.String),
    cssAnimationName: Schema.optional(Schema.String),
    cssTransitionProperty: Schema.optional(Schema.String),
    stackTrace: Schema.optional(Console.StackTrace)
  }).annotate({ identifier: "Animation.Animation" })
) as any as Schema.Codec<Animation>

/**
 * Unique Web Animation identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AnimationId = Brand.Branded<string, "~@usestrider/browser/webkit-stock-protocol/Animation/AnimationId">

/**
 * Schema for `AnimationId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AnimationId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-stock-protocol/Animation/AnimationId")
) as any as Schema.Codec<AnimationId>

/**
 * `AnimationState` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AnimationState =
  | "ready"
  | "delayed"
  | "active"
  | "canceled"
  | "done"
  | (string & {})

/**
 * Schema for `AnimationState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AnimationState = Schema.String as any as Schema.Codec<AnimationState>

/**
 * `Effect`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Effect {
  readonly startDelay?: number | undefined
  readonly endDelay?: number | undefined
  /**
   * Number of iterations in the animation. <code>Infinity</code> is represented as <code>-1</code>.
   */
  readonly iterationCount?: number | undefined
  /**
   * Index of which iteration to start at.
   */
  readonly iterationStart?: number | undefined
  /**
   * Total time of each iteration, measured in milliseconds.
   */
  readonly iterationDuration?: number | undefined
  /**
   * CSS timing function of the overall animation.
   */
  readonly timingFunction?: string | undefined
  readonly playbackDirection?: PlaybackDirection | undefined
  readonly fillMode?: FillMode | undefined
  readonly keyframes?: ReadonlyArray<Keyframe> | undefined
}

/**
 * Schema for `Effect`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Effect = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    startDelay: Schema.optional(Schema.Number),
    endDelay: Schema.optional(Schema.Number),
    iterationCount: Schema.optional(Schema.Number),
    iterationStart: Schema.optional(Schema.Number),
    iterationDuration: Schema.optional(Schema.Number),
    timingFunction: Schema.optional(Schema.String),
    playbackDirection: Schema.optional(PlaybackDirection),
    fillMode: Schema.optional(FillMode),
    keyframes: Schema.optional(Schema.Array(Keyframe))
  }).annotate({ identifier: "Animation.Effect" })
) as any as Schema.Codec<Effect>

/**
 * `FillMode` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type FillMode =
  | "none"
  | "forwards"
  | "backwards"
  | "both"
  | "auto"
  | (string & {})

/**
 * Schema for `FillMode`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FillMode = Schema.String as any as Schema.Codec<FillMode>

/**
 * `Keyframe`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Keyframe {
  /**
   * Decimal percentage [0,1] representing where this keyframe is in the entire duration of the animation.
   */
  readonly offset: number
  /**
   * CSS timing function for how the `style` is applied.
   */
  readonly easing?: string | undefined
  /**
   * CSS style declaration of the CSS properties that will be animated.
   */
  readonly style?: string | undefined
}

/**
 * Schema for `Keyframe`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Keyframe = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    offset: Schema.Number,
    easing: Schema.optional(Schema.String),
    style: Schema.optional(Schema.String)
  }).annotate({ identifier: "Animation.Keyframe" })
) as any as Schema.Codec<Keyframe>

/**
 * `PlaybackDirection` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PlaybackDirection =
  | "normal"
  | "reverse"
  | "alternate"
  | "alternate-reverse"
  | (string & {})

/**
 * Schema for `PlaybackDirection`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PlaybackDirection = Schema.String as any as Schema.Codec<PlaybackDirection>

/**
 * `TrackingUpdate`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TrackingUpdate {
  readonly trackingAnimationId: AnimationId
  readonly animationState: AnimationState
  readonly nodeId?: DOM.NodeId | undefined
  /**
   * Equal to the corresponding `animation-name` CSS property. Should not be provided if `transitionProperty` is also provided.
   */
  readonly animationName?: string | undefined
  /**
   * Equal to the corresponding `transition-property` CSS property. Should not be provided if `animationName` is also provided.
   */
  readonly transitionProperty?: string | undefined
}

/**
 * Schema for `TrackingUpdate`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TrackingUpdate = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    trackingAnimationId: AnimationId,
    animationState: AnimationState,
    nodeId: Schema.optional(DOM.NodeId),
    animationName: Schema.optional(Schema.String),
    transitionProperty: Schema.optional(Schema.String)
  }).annotate({ identifier: "Animation.TrackingUpdate" })
) as any as Schema.Codec<TrackingUpdate>

/**
 * Dispatched whenever a `WebAnimation` is created.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AnimationCreatedParams {
  readonly animation: Animation
}

/**
 * Schema for `AnimationCreatedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AnimationCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animation: Animation
  }).annotate({ identifier: "Animation.AnimationCreatedParams" })
) as any as Schema.Codec<AnimationCreatedParams>

/**
 * Dispatched whenever a `WebAnimation` is destroyed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AnimationDestroyedParams {
  readonly animationId: AnimationId
}

/**
 * Schema for `AnimationDestroyedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AnimationDestroyedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationId: AnimationId
  }).annotate({ identifier: "Animation.AnimationDestroyedParams" })
) as any as Schema.Codec<AnimationDestroyedParams>

/**
 * Dispatched whenever the effect of any animation is changed in any way.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EffectChangedParams {
  readonly animationId: AnimationId
}

/**
 * Schema for `EffectChangedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EffectChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationId: AnimationId
  }).annotate({ identifier: "Animation.EffectChangedParams" })
) as any as Schema.Codec<EffectChangedParams>

/**
 * Dispatched whenever `Animation.prototype.set id` is called.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NameChangedParams {
  readonly animationId: AnimationId
  /**
   * Equal to `Animation.prototype.get id`.
   */
  readonly name?: string | undefined
}

/**
 * Schema for `NameChangedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NameChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationId: AnimationId,
    name: Schema.optional(Schema.String)
  }).annotate({ identifier: "Animation.NameChangedParams" })
) as any as Schema.Codec<NameChangedParams>

/**
 * Gets the `Effect` for the animation with the given `AnimationId`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestEffectParams {
  readonly animationId: AnimationId
}

/**
 * Schema for `RequestEffectParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestEffectParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationId: AnimationId
  }).annotate({ identifier: "Animation.RequestEffectParams" })
) as any as Schema.Codec<RequestEffectParams>

/**
 * Gets the `Effect` for the animation with the given `AnimationId`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestEffectResult {
  /**
   * This is omitted when there is no effect.
   */
  readonly effect?: Effect | undefined
}

/**
 * Schema for `RequestEffectResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestEffectResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    effect: Schema.optional(Effect)
  }).annotate({ identifier: "Animation.RequestEffectResult" })
) as any as Schema.Codec<RequestEffectResult>

/**
 * Gets the `DOM.NodeId` for the target of the effect of the animation with the given `AnimationId`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestEffectTargetParams {
  readonly animationId: AnimationId
}

/**
 * Schema for `RequestEffectTargetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestEffectTargetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationId: AnimationId
  }).annotate({ identifier: "Animation.RequestEffectTargetParams" })
) as any as Schema.Codec<RequestEffectTargetParams>

/**
 * Gets the `DOM.NodeId` for the target of the effect of the animation with the given `AnimationId`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface RequestEffectTargetResult {
  readonly effectTarget: DOM.Styleable
}

/**
 * Schema for `RequestEffectTargetResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RequestEffectTargetResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    effectTarget: DOM.Styleable
  }).annotate({ identifier: "Animation.RequestEffectTargetResult" })
) as any as Schema.Codec<RequestEffectTargetResult>

/**
 * Resolves JavaScript `WebAnimation` object for given `AnimationId`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveAnimationParams {
  readonly animationId: AnimationId
  /**
   * Symbolic group name that can be used to release multiple objects.
   */
  readonly objectGroup?: string | undefined
}

/**
 * Schema for `ResolveAnimationParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveAnimationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationId: AnimationId,
    objectGroup: Schema.optional(Schema.String)
  }).annotate({ identifier: "Animation.ResolveAnimationParams" })
) as any as Schema.Codec<ResolveAnimationParams>

/**
 * Resolves JavaScript `WebAnimation` object for given `AnimationId`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveAnimationResult {
  readonly object: Runtime.RemoteObject
}

/**
 * Schema for `ResolveAnimationResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveAnimationResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    object: Runtime.RemoteObject
  }).annotate({ identifier: "Animation.ResolveAnimationResult" })
) as any as Schema.Codec<ResolveAnimationResult>

/**
 * Dispatched whenever the target of any effect of any animation is changed in any way.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TargetChangedParams {
  readonly animationId: AnimationId
}

/**
 * Schema for `TargetChangedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TargetChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationId: AnimationId
  }).annotate({ identifier: "Animation.TargetChangedParams" })
) as any as Schema.Codec<TargetChangedParams>

/**
 * Dispatched after `stopTracking` command.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TrackingCompleteParams {
  readonly timestamp: number
}

/**
 * Schema for `TrackingCompleteParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TrackingCompleteParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number
  }).annotate({ identifier: "Animation.TrackingCompleteParams" })
) as any as Schema.Codec<TrackingCompleteParams>

/**
 * Dispatched after `startTracking` command.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TrackingStartParams {
  readonly timestamp: number
}

/**
 * Schema for `TrackingStartParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TrackingStartParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number
  }).annotate({ identifier: "Animation.TrackingStartParams" })
) as any as Schema.Codec<TrackingStartParams>

/**
 * Fired for each phase of Web Animation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface TrackingUpdateParams {
  readonly timestamp: number
  readonly event: TrackingUpdate
}

/**
 * Schema for `TrackingUpdateParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TrackingUpdateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timestamp: Schema.Number,
    event: TrackingUpdate
  }).annotate({ identifier: "Animation.TrackingUpdateParams" })
) as any as Schema.Codec<TrackingUpdateParams>

/**
 * Disables Canvas domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Animation.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Animation.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables Canvas domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Animation.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Animation.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Gets the `Effect` for the animation with the given `AnimationId`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestEffect: Protocol.CommandDef<"Animation.requestEffect", RequestEffectParams, RequestEffectResult> =
  /*#__PURE__*/ Protocol.command(
    "Animation.requestEffect",
    RequestEffectParams,
    RequestEffectResult,
    { status: "stable" }
  )

/**
 * Gets the `DOM.NodeId` for the target of the effect of the animation with the given `AnimationId`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const requestEffectTarget: Protocol.CommandDef<
  "Animation.requestEffectTarget",
  RequestEffectTargetParams,
  RequestEffectTargetResult
> = /*#__PURE__*/ Protocol.command(
  "Animation.requestEffectTarget",
  RequestEffectTargetParams,
  RequestEffectTargetResult,
  { status: "stable" }
)

/**
 * Resolves JavaScript `WebAnimation` object for given `AnimationId`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resolveAnimation: Protocol.CommandDef<
  "Animation.resolveAnimation",
  ResolveAnimationParams,
  ResolveAnimationResult
> = /*#__PURE__*/ Protocol.command(
  "Animation.resolveAnimation",
  ResolveAnimationParams,
  ResolveAnimationResult,
  { status: "stable" }
)

/**
 * Start tracking animations. This will produce a `trackingStart` event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const startTracking: Protocol.CommandDef<"Animation.startTracking", void, void> = /*#__PURE__*/ Protocol.command(
  "Animation.startTracking",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Stop tracking animations. This will produce a `trackingComplete` event.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stopTracking: Protocol.CommandDef<"Animation.stopTracking", void, void> = /*#__PURE__*/ Protocol.command(
  "Animation.stopTracking",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Dispatched whenever a `WebAnimation` is created.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const animationCreated: Protocol.EventDef<"Animation.animationCreated", AnimationCreatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Animation.animationCreated",
    AnimationCreatedParams,
    { status: "stable" }
  )

/**
 * Dispatched whenever a `WebAnimation` is destroyed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const animationDestroyed: Protocol.EventDef<"Animation.animationDestroyed", AnimationDestroyedParams> =
  /*#__PURE__*/ Protocol.event(
    "Animation.animationDestroyed",
    AnimationDestroyedParams,
    { status: "stable" }
  )

/**
 * Dispatched whenever the effect of any animation is changed in any way.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const effectChanged: Protocol.EventDef<"Animation.effectChanged", EffectChangedParams> = /*#__PURE__*/ Protocol
  .event(
    "Animation.effectChanged",
    EffectChangedParams,
    { status: "stable" }
  )

/**
 * Dispatched whenever `Animation.prototype.set id` is called.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const nameChanged: Protocol.EventDef<"Animation.nameChanged", NameChangedParams> = /*#__PURE__*/ Protocol.event(
  "Animation.nameChanged",
  NameChangedParams,
  { status: "stable" }
)

/**
 * Dispatched whenever the target of any effect of any animation is changed in any way.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const targetChanged: Protocol.EventDef<"Animation.targetChanged", TargetChangedParams> = /*#__PURE__*/ Protocol
  .event(
    "Animation.targetChanged",
    TargetChangedParams,
    { status: "stable" }
  )

/**
 * Dispatched after `stopTracking` command.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const trackingComplete: Protocol.EventDef<"Animation.trackingComplete", TrackingCompleteParams> =
  /*#__PURE__*/ Protocol.event(
    "Animation.trackingComplete",
    TrackingCompleteParams,
    { status: "stable" }
  )

/**
 * Dispatched after `startTracking` command.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const trackingStart: Protocol.EventDef<"Animation.trackingStart", TrackingStartParams> = /*#__PURE__*/ Protocol
  .event(
    "Animation.trackingStart",
    TrackingStartParams,
    { status: "stable" }
  )

/**
 * Fired for each phase of Web Animation.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const trackingUpdate: Protocol.EventDef<"Animation.trackingUpdate", TrackingUpdateParams> =
  /*#__PURE__*/ Protocol.event(
    "Animation.trackingUpdate",
    TrackingUpdateParams,
    { status: "stable" }
  )
