/**
 * The Animation domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Animation instance.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Animation {
  /**
   * `Animation`'s id.
   */
  readonly id: string
  /**
   * `Animation`'s name.
   */
  readonly name: string
  /**
   * `Animation`'s internal paused state.
   */
  readonly pausedState: boolean
  /**
   * `Animation`'s play state.
   */
  readonly playState: string
  /**
   * `Animation`'s playback rate.
   */
  readonly playbackRate: number
  /**
   * `Animation`'s start time.
   * Milliseconds for time based animations and
   * percentage [0 - 100] for scroll driven animations
   * (i.e. when viewOrScrollTimeline exists).
   */
  readonly startTime: number
  /**
   * `Animation`'s current time.
   */
  readonly currentTime: number
  /**
   * Animation type of `Animation`.
   */
  readonly type: AnimationType
  /**
   * `Animation`'s source animation node.
   */
  readonly source?: AnimationEffect | undefined
  /**
   * A unique ID for `Animation` representing the sources that triggered this CSS
   * animation/transition.
   */
  readonly cssId?: string | undefined
  /**
   * View or scroll timeline
   */
  readonly viewOrScrollTimeline?: ViewOrScrollTimeline | undefined
}

/**
 * Schema for `Animation`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Animation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    pausedState: Schema.Boolean,
    playState: Schema.String,
    playbackRate: Schema.Number,
    startTime: Schema.Number,
    currentTime: Schema.Number,
    type: AnimationType,
    source: Schema.optional(AnimationEffect),
    cssId: Schema.optional(Schema.String),
    viewOrScrollTimeline: Schema.optional(ViewOrScrollTimeline)
  }).annotate({ identifier: "Animation.Animation" })
) as any as Schema.Codec<Animation>

/**
 * Animation type of `Animation`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type AnimationType =
  | "CSSTransition"
  | "CSSAnimation"
  | "WebAnimation"
  | (string & {})

/**
 * Schema for `AnimationType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AnimationType = Schema.String as any as Schema.Codec<AnimationType>

/**
 * AnimationEffect instance
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AnimationEffect {
  /**
   * `AnimationEffect`'s delay.
   */
  readonly delay: number
  /**
   * `AnimationEffect`'s end delay.
   */
  readonly endDelay: number
  /**
   * `AnimationEffect`'s iteration start.
   */
  readonly iterationStart: number
  /**
   * `AnimationEffect`'s iterations. Omitted if the value is infinite.
   */
  readonly iterations?: number | undefined
  /**
   * `AnimationEffect`'s iteration duration.
   * Milliseconds for time based animations and
   * percentage [0 - 100] for scroll driven animations
   * (i.e. when viewOrScrollTimeline exists).
   */
  readonly duration: number
  /**
   * `AnimationEffect`'s playback direction.
   */
  readonly direction: string
  /**
   * `AnimationEffect`'s fill mode.
   */
  readonly fill: string
  /**
   * `AnimationEffect`'s target node.
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
  /**
   * `AnimationEffect`'s keyframes.
   */
  readonly keyframesRule?: KeyframesRule | undefined
  /**
   * `AnimationEffect`'s timing function.
   */
  readonly easing: string
}

/**
 * Schema for `AnimationEffect`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AnimationEffect = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    delay: Schema.Number,
    endDelay: Schema.Number,
    iterationStart: Schema.Number,
    iterations: Schema.optional(Schema.Number),
    duration: Schema.Number,
    direction: Schema.String,
    fill: Schema.String,
    backendNodeId: Schema.optional(DOM.BackendNodeId),
    keyframesRule: Schema.optional(KeyframesRule),
    easing: Schema.String
  }).annotate({ identifier: "Animation.AnimationEffect" })
) as any as Schema.Codec<AnimationEffect>

/**
 * Keyframe Style
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface KeyframeStyle {
  /**
   * Keyframe's time offset.
   */
  readonly offset: string
  /**
   * `AnimationEffect`'s timing function.
   */
  readonly easing: string
}

/**
 * Schema for `KeyframeStyle`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const KeyframeStyle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    offset: Schema.String,
    easing: Schema.String
  }).annotate({ identifier: "Animation.KeyframeStyle" })
) as any as Schema.Codec<KeyframeStyle>

/**
 * Keyframes Rule
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface KeyframesRule {
  /**
   * CSS keyframed animation's name.
   */
  readonly name?: string | undefined
  /**
   * List of animation keyframes.
   */
  readonly keyframes: ReadonlyArray<KeyframeStyle>
}

/**
 * Schema for `KeyframesRule`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const KeyframesRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.optional(Schema.String),
    keyframes: Schema.Array(KeyframeStyle)
  }).annotate({ identifier: "Animation.KeyframesRule" })
) as any as Schema.Codec<KeyframesRule>

/**
 * Timeline instance
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ViewOrScrollTimeline {
  /**
   * Scroll container node
   */
  readonly sourceNodeId?: DOM.BackendNodeId | undefined
  /**
   * Represents the starting scroll position of the timeline
   * as a length offset in pixels from scroll origin.
   */
  readonly startOffset?: number | undefined
  /**
   * Represents the ending scroll position of the timeline
   * as a length offset in pixels from scroll origin.
   */
  readonly endOffset?: number | undefined
  /**
   * The element whose principal box's visibility in the
   * scrollport defined the progress of the timeline.
   * Does not exist for animations with ScrollTimeline
   */
  readonly subjectNodeId?: DOM.BackendNodeId | undefined
  /**
   * Orientation of the scroll
   */
  readonly axis: DOM.ScrollOrientation
}

/**
 * Schema for `ViewOrScrollTimeline`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ViewOrScrollTimeline = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sourceNodeId: Schema.optional(DOM.BackendNodeId),
    startOffset: Schema.optional(Schema.Number),
    endOffset: Schema.optional(Schema.Number),
    subjectNodeId: Schema.optional(DOM.BackendNodeId),
    axis: DOM.ScrollOrientation
  }).annotate({ identifier: "Animation.ViewOrScrollTimeline" })
) as any as Schema.Codec<ViewOrScrollTimeline>

/**
 * Event for when an animation has been cancelled.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AnimationCanceledParams {
  /**
   * Id of the animation that was cancelled.
   */
  readonly id: string
}

/**
 * Schema for `AnimationCanceledParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AnimationCanceledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String
  }).annotate({ identifier: "Animation.AnimationCanceledParams" })
) as any as Schema.Codec<AnimationCanceledParams>

/**
 * Event for each animation that has been created.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AnimationCreatedParams {
  /**
   * Id of the animation that was created.
   */
  readonly id: string
}

/**
 * Schema for `AnimationCreatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AnimationCreatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String
  }).annotate({ identifier: "Animation.AnimationCreatedParams" })
) as any as Schema.Codec<AnimationCreatedParams>

/**
 * Event for animation that has been started.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AnimationStartedParams {
  /**
   * Animation that was started.
   */
  readonly animation: Animation
}

/**
 * Schema for `AnimationStartedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AnimationStartedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animation: Animation
  }).annotate({ identifier: "Animation.AnimationStartedParams" })
) as any as Schema.Codec<AnimationStartedParams>

/**
 * Event for animation that has been updated.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AnimationUpdatedParams {
  /**
   * Animation that was updated.
   */
  readonly animation: Animation
}

/**
 * Schema for `AnimationUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AnimationUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animation: Animation
  }).annotate({ identifier: "Animation.AnimationUpdatedParams" })
) as any as Schema.Codec<AnimationUpdatedParams>

/**
 * Returns the current time of the an animation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetCurrentTimeParams {
  /**
   * Id of animation.
   */
  readonly id: string
}

/**
 * Schema for `GetCurrentTimeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetCurrentTimeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String
  }).annotate({ identifier: "Animation.GetCurrentTimeParams" })
) as any as Schema.Codec<GetCurrentTimeParams>

/**
 * Returns the current time of the an animation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetCurrentTimeResult {
  /**
   * Current time of the page.
   */
  readonly currentTime: number
}

/**
 * Schema for `GetCurrentTimeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetCurrentTimeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    currentTime: Schema.Number
  }).annotate({ identifier: "Animation.GetCurrentTimeResult" })
) as any as Schema.Codec<GetCurrentTimeResult>

/**
 * Gets the playback rate of the document timeline.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetPlaybackRateResult {
  /**
   * Playback rate for animations on page.
   */
  readonly playbackRate: number
}

/**
 * Schema for `GetPlaybackRateResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetPlaybackRateResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    playbackRate: Schema.Number
  }).annotate({ identifier: "Animation.GetPlaybackRateResult" })
) as any as Schema.Codec<GetPlaybackRateResult>

/**
 * Releases a set of animations to no longer be manipulated.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReleaseAnimationsParams {
  /**
   * List of animation ids to seek.
   */
  readonly animations: ReadonlyArray<string>
}

/**
 * Schema for `ReleaseAnimationsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReleaseAnimationsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animations: Schema.Array(Schema.String)
  }).annotate({ identifier: "Animation.ReleaseAnimationsParams" })
) as any as Schema.Codec<ReleaseAnimationsParams>

/**
 * Gets the remote object of the Animation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ResolveAnimationParams {
  /**
   * Animation id.
   */
  readonly animationId: string
}

/**
 * Schema for `ResolveAnimationParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ResolveAnimationParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationId: Schema.String
  }).annotate({ identifier: "Animation.ResolveAnimationParams" })
) as any as Schema.Codec<ResolveAnimationParams>

/**
 * Gets the remote object of the Animation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ResolveAnimationResult {
  /**
   * Corresponding remote object.
   */
  readonly remoteObject: Runtime.RemoteObject
}

/**
 * Schema for `ResolveAnimationResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ResolveAnimationResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    remoteObject: Runtime.RemoteObject
  }).annotate({ identifier: "Animation.ResolveAnimationResult" })
) as any as Schema.Codec<ResolveAnimationResult>

/**
 * Seek a set of animations to a particular time within each animation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SeekAnimationsParams {
  /**
   * List of animation ids to seek.
   */
  readonly animations: ReadonlyArray<string>
  /**
   * Set the current time of each animation.
   */
  readonly currentTime: number
}

/**
 * Schema for `SeekAnimationsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SeekAnimationsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animations: Schema.Array(Schema.String),
    currentTime: Schema.Number
  }).annotate({ identifier: "Animation.SeekAnimationsParams" })
) as any as Schema.Codec<SeekAnimationsParams>

/**
 * Sets the paused state of a set of animations.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPausedParams {
  /**
   * Animations to set the pause state of.
   */
  readonly animations: ReadonlyArray<string>
  /**
   * Paused state to set to.
   */
  readonly paused: boolean
}

/**
 * Schema for `SetPausedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPausedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animations: Schema.Array(Schema.String),
    paused: Schema.Boolean
  }).annotate({ identifier: "Animation.SetPausedParams" })
) as any as Schema.Codec<SetPausedParams>

/**
 * Sets the playback rate of the document timeline.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPlaybackRateParams {
  /**
   * Playback rate for animations on page
   */
  readonly playbackRate: number
}

/**
 * Schema for `SetPlaybackRateParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPlaybackRateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    playbackRate: Schema.Number
  }).annotate({ identifier: "Animation.SetPlaybackRateParams" })
) as any as Schema.Codec<SetPlaybackRateParams>

/**
 * Sets the timing of an animation node.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetTimingParams {
  /**
   * Animation id.
   */
  readonly animationId: string
  /**
   * Duration of the animation.
   */
  readonly duration: number
  /**
   * Delay of the animation.
   */
  readonly delay: number
}

/**
 * Schema for `SetTimingParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetTimingParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationId: Schema.String,
    duration: Schema.Number,
    delay: Schema.Number
  }).annotate({ identifier: "Animation.SetTimingParams" })
) as any as Schema.Codec<SetTimingParams>

/**
 * Disables animation domain notifications.
 *
 * @stability experimental
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
 * Enables animation domain notifications.
 *
 * @stability experimental
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
 * Returns the current time of the an animation.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getCurrentTime: Protocol.CommandDef<
  "Animation.getCurrentTime",
  GetCurrentTimeParams,
  GetCurrentTimeResult
> = /*#__PURE__*/ Protocol.command(
  "Animation.getCurrentTime",
  GetCurrentTimeParams,
  GetCurrentTimeResult,
  { status: "stable" }
)

/**
 * Gets the playback rate of the document timeline.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getPlaybackRate: Protocol.CommandDef<"Animation.getPlaybackRate", void, GetPlaybackRateResult> =
  /*#__PURE__*/ Protocol.command(
    "Animation.getPlaybackRate",
    undefined,
    GetPlaybackRateResult,
    { status: "stable" }
  )

/**
 * Releases a set of animations to no longer be manipulated.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const releaseAnimations: Protocol.CommandDef<"Animation.releaseAnimations", ReleaseAnimationsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Animation.releaseAnimations",
    ReleaseAnimationsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Gets the remote object of the Animation.
 *
 * @stability experimental
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
 * Seek a set of animations to a particular time within each animation.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const seekAnimations: Protocol.CommandDef<"Animation.seekAnimations", SeekAnimationsParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Animation.seekAnimations",
    SeekAnimationsParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets the paused state of a set of animations.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setPaused: Protocol.CommandDef<"Animation.setPaused", SetPausedParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Animation.setPaused",
    SetPausedParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets the playback rate of the document timeline.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setPlaybackRate: Protocol.CommandDef<"Animation.setPlaybackRate", SetPlaybackRateParams, void> =
  /*#__PURE__*/ Protocol.command(
    "Animation.setPlaybackRate",
    SetPlaybackRateParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets the timing of an animation node.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setTiming: Protocol.CommandDef<"Animation.setTiming", SetTimingParams, void> = /*#__PURE__*/ Protocol
  .command(
    "Animation.setTiming",
    SetTimingParams,
    undefined,
    { status: "stable" }
  )

/**
 * Event for when an animation has been cancelled.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const animationCanceled: Protocol.EventDef<"Animation.animationCanceled", AnimationCanceledParams> =
  /*#__PURE__*/ Protocol.event(
    "Animation.animationCanceled",
    AnimationCanceledParams,
    { status: "stable" }
  )

/**
 * Event for each animation that has been created.
 *
 * @stability experimental
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
 * Event for animation that has been started.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const animationStarted: Protocol.EventDef<"Animation.animationStarted", AnimationStartedParams> =
  /*#__PURE__*/ Protocol.event(
    "Animation.animationStarted",
    AnimationStartedParams,
    { status: "stable" }
  )

/**
 * Event for animation that has been updated.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const animationUpdated: Protocol.EventDef<"Animation.animationUpdated", AnimationUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Animation.animationUpdated",
    AnimationUpdatedParams,
    { status: "stable" }
  )
