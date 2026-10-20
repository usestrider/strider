/**
 * The Preload domain.
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
import * as Network from "./Network.ts"
import * as Page from "./Page.ts"

/**
 * TODO(https://crbug.com/1384419): revisit the list of PrefetchStatus and
 * filter out the ones that aren't necessary to the developers.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PrefetchStatus =
  | "PrefetchAllowed"
  | "PrefetchFailedIneligibleRedirect"
  | "PrefetchFailedInvalidRedirect"
  | "PrefetchFailedMIMENotSupported"
  | "PrefetchFailedNetError"
  | "PrefetchFailedNon2XX"
  | "PrefetchEvictedAfterBrowsingDataRemoved"
  | "PrefetchEvictedAfterCandidateRemoved"
  | "PrefetchEvictedForNewerPrefetch"
  | "PrefetchHeldback"
  | "PrefetchIneligibleRetryAfter"
  | "PrefetchIsPrivacyDecoy"
  | "PrefetchIsStale"
  | "PrefetchNotEligibleBlockedByConnectionAllowlist"
  | "PrefetchNotEligibleBrowserContextOffTheRecord"
  | "PrefetchNotEligibleCrossOrigin"
  | "PrefetchNotEligibleDataSaverEnabled"
  | "PrefetchNotEligibleExistingProxy"
  | "PrefetchNotEligibleHostIsNonUnique"
  | "PrefetchNotEligibleNonDefaultStoragePartition"
  | "PrefetchNotEligibleSameSiteCrossOriginPrefetchRequiredProxy"
  | "PrefetchNotEligibleSchemeIsNotHttps"
  | "PrefetchNotEligibleUserHasCookies"
  | "PrefetchNotEligibleUserHasServiceWorker"
  | "PrefetchNotEligibleUserHasServiceWorkerNoFetchHandler"
  | "PrefetchNotEligibleRedirectFromServiceWorker"
  | "PrefetchNotEligibleRedirectToServiceWorker"
  | "PrefetchNotEligibleBatterySaverEnabled"
  | "PrefetchNotEligiblePreloadingDisabled"
  | "PrefetchNotFinishedInTime"
  | "PrefetchNotStarted"
  | "PrefetchNotUsedCookiesChanged"
  | "PrefetchProxyNotAvailable"
  | "PrefetchResponseUsed"
  | "PrefetchSuccessfulButNotUsed"
  | "PrefetchNotUsedProbeFailed"
  | "PrefetchCancelledOnUserNavigation"
  | (string & {})

/**
 * Schema for `PrefetchStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PrefetchStatus = Schema.String as any as Schema.Codec<PrefetchStatus>

/**
 * Chrome manages different types of preloads together using a
 * concept of preloading pipeline. For example, if a site uses a
 * SpeculationRules for prerender, Chrome first starts a prefetch and
 * then upgrades it to prerender.
 *
 * CDP events for them are emitted separately but they share
 * `PreloadPipelineId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PreloadPipelineId = Brand.Branded<string, "~@usestrider/browser/cdp/Preload/PreloadPipelineId">

/**
 * Schema for `PreloadPipelineId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PreloadPipelineId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Preload/PreloadPipelineId")
) as any as Schema.Codec<PreloadPipelineId>

/**
 * A key that identifies a preloading attempt.
 *
 * The url used is the url specified by the trigger (i.e. the initial URL), and
 * not the final url that is navigated to. For example, prerendering allows
 * same-origin main frame navigations during the attempt, but the attempt is
 * still keyed with the initial URL.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PreloadingAttemptKey {
  readonly loaderId: Network.LoaderId
  readonly action: SpeculationAction
  readonly url: string
  readonly formSubmission?: boolean | undefined
  readonly targetHint?: SpeculationTargetHint | undefined
}

/**
 * Schema for `PreloadingAttemptKey`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PreloadingAttemptKey = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    loaderId: Network.LoaderId,
    action: SpeculationAction,
    url: Schema.String,
    formSubmission: Schema.optional(Schema.Boolean),
    targetHint: Schema.optional(SpeculationTargetHint)
  }).annotate({ identifier: "Preload.PreloadingAttemptKey" })
) as any as Schema.Codec<PreloadingAttemptKey>

/**
 * Lists sources for a preloading attempt, specifically the ids of rule sets
 * that had a speculation rule that triggered the attempt, and the
 * BackendNodeIds of <a href> or <area href> elements that triggered the
 * attempt (in the case of attempts triggered by a document rule). It is
 * possible for multiple rule sets and links to trigger a single attempt.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PreloadingAttemptSource {
  readonly key: PreloadingAttemptKey
  readonly ruleSetIds: ReadonlyArray<RuleSetId>
  readonly nodeIds: ReadonlyArray<DOM.BackendNodeId>
}

/**
 * Schema for `PreloadingAttemptSource`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PreloadingAttemptSource = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    key: PreloadingAttemptKey,
    ruleSetIds: Schema.Array(RuleSetId),
    nodeIds: Schema.Array(DOM.BackendNodeId)
  }).annotate({ identifier: "Preload.PreloadingAttemptSource" })
) as any as Schema.Codec<PreloadingAttemptSource>

/**
 * Preloading status values, see also PreloadingTriggeringOutcome. This
 * status is shared by prefetchStatusUpdated and prerenderStatusUpdated.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PreloadingStatus =
  | "Pending"
  | "Running"
  | "Ready"
  | "Success"
  | "Failure"
  | "NotSupported"
  | (string & {})

/**
 * Schema for `PreloadingStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PreloadingStatus = Schema.String as any as Schema.Codec<PreloadingStatus>

/**
 * List of FinalStatus reasons for Prerender2.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type PrerenderFinalStatus =
  | "Activated"
  | "Destroyed"
  | "LowEndDevice"
  | "InvalidSchemeRedirect"
  | "InvalidSchemeNavigation"
  | "NavigationRequestBlockedByCsp"
  | "MojoBinderPolicy"
  | "RendererProcessCrashed"
  | "RendererProcessKilled"
  | "Download"
  | "TriggerDestroyed"
  | "NavigationNotCommitted"
  | "NavigationBadHttpStatus"
  | "ClientCertRequested"
  | "NavigationRequestNetworkError"
  | "CancelAllHostsForTesting"
  | "DidFailLoad"
  | "Stop"
  | "SslCertificateError"
  | "LoginAuthRequested"
  | "UaChangeRequiresReload"
  | "BlockedByClient"
  | "AudioOutputDeviceRequested"
  | "MixedContent"
  | "TriggerBackgrounded"
  | "MemoryLimitExceeded"
  | "DataSaverEnabled"
  | "TriggerUrlHasEffectiveUrl"
  | "ActivatedBeforeStarted"
  | "InactivePageRestriction"
  | "StartFailed"
  | "TimeoutBackgrounded"
  | "CrossSiteRedirectInInitialNavigation"
  | "CrossSiteNavigationInInitialNavigation"
  | "SameSiteCrossOriginRedirectNotOptInInInitialNavigation"
  | "SameSiteCrossOriginNavigationNotOptInInInitialNavigation"
  | "ActivationNavigationParameterMismatch"
  | "ActivatedInBackground"
  | "EmbedderHostDisallowed"
  | "ActivationNavigationDestroyedBeforeSuccess"
  | "TabClosedByUserGesture"
  | "TabClosedWithoutUserGesture"
  | "PrimaryMainFrameRendererProcessCrashed"
  | "PrimaryMainFrameRendererProcessKilled"
  | "ActivationFramePolicyNotCompatible"
  | "PreloadingDisabled"
  | "BatterySaverEnabled"
  | "ActivatedDuringMainFrameNavigation"
  | "PreloadingUnsupportedByWebContents"
  | "CrossSiteRedirectInMainFrameNavigation"
  | "CrossSiteNavigationInMainFrameNavigation"
  | "SameSiteCrossOriginRedirectNotOptInInMainFrameNavigation"
  | "SameSiteCrossOriginNavigationNotOptInInMainFrameNavigation"
  | "MemoryPressureOnTrigger"
  | "MemoryPressureAfterTriggered"
  | "PrerenderingDisabledByDevTools"
  | "SpeculationRuleRemoved"
  | "ActivatedWithAuxiliaryBrowsingContexts"
  | "MaxNumOfRunningEagerPrerendersExceeded"
  | "MaxNumOfRunningNonEagerPrerendersExceeded"
  | "MaxNumOfRunningEmbedderPrerendersExceeded"
  | "PrerenderingUrlHasEffectiveUrl"
  | "RedirectedPrerenderingUrlHasEffectiveUrl"
  | "ActivationUrlHasEffectiveUrl"
  | "JavaScriptInterfaceAdded"
  | "JavaScriptInterfaceRemoved"
  | "AllPrerenderingCanceled"
  | "WindowClosed"
  | "SlowNetwork"
  | "OtherPrerenderedPageActivated"
  | "V8OptimizerDisabled"
  | "PrerenderFailedDuringPrefetch"
  | "BrowsingDataRemoved"
  | "PrerenderHostReused"
  | "FormSubmitWhenPrerendering"
  | "CrossDocumentRestart"
  | (string & {})

/**
 * Schema for `PrerenderFinalStatus`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PrerenderFinalStatus = Schema.String as any as Schema.Codec<PrerenderFinalStatus>

/**
 * Information of headers to be displayed when the header mismatch occurred.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PrerenderMismatchedHeaders {
  readonly headerName: string
  readonly initialValue?: string | undefined
  readonly activationValue?: string | undefined
}

/**
 * Schema for `PrerenderMismatchedHeaders`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PrerenderMismatchedHeaders = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    headerName: Schema.String,
    initialValue: Schema.optional(Schema.String),
    activationValue: Schema.optional(Schema.String)
  }).annotate({ identifier: "Preload.PrerenderMismatchedHeaders" })
) as any as Schema.Codec<PrerenderMismatchedHeaders>

/**
 * Corresponds to SpeculationRuleSet
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RuleSet {
  readonly id: RuleSetId
  /**
   * Identifies a document which the rule set is associated with.
   */
  readonly loaderId: Network.LoaderId
  /**
   * Source text of JSON representing the rule set. If it comes from
   * `<script>` tag, it is the textContent of the node. Note that it is
   * a JSON for valid case.
   *
   * See also:
   * - https://wicg.github.io/nav-speculation/speculation-rules.html
   * - https://github.com/WICG/nav-speculation/blob/main/triggers.md
   */
  readonly sourceText: string
  /**
   * A speculation rule set is either added through an inline
   * `<script>` tag or through an external resource via the
   * 'Speculation-Rules' HTTP header. For the first case, we include
   * the BackendNodeId of the relevant `<script>` tag. For the second
   * case, we include the external URL where the rule set was loaded
   * from, and also RequestId if Network domain is enabled.
   *
   * See also:
   * - https://wicg.github.io/nav-speculation/speculation-rules.html#speculation-rules-script
   * - https://wicg.github.io/nav-speculation/speculation-rules.html#speculation-rules-header
   */
  readonly backendNodeId?: DOM.BackendNodeId | undefined
  readonly url?: string | undefined
  readonly requestId?: Network.RequestId | undefined
  /**
   * Error information
   * `errorMessage` is null iff `errorType` is null.
   */
  readonly errorType?: RuleSetErrorType | undefined
  /**
   * For more details, see:
   * https://github.com/WICG/nav-speculation/blob/main/speculation-rules-tags.md
   */
  readonly tag?: string | undefined
}

/**
 * Schema for `RuleSet`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RuleSet = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: RuleSetId,
    loaderId: Network.LoaderId,
    sourceText: Schema.String,
    backendNodeId: Schema.optional(DOM.BackendNodeId),
    url: Schema.optional(Schema.String),
    requestId: Schema.optional(Network.RequestId),
    errorType: Schema.optional(RuleSetErrorType),
    tag: Schema.optional(Schema.String)
  }).annotate({ identifier: "Preload.RuleSet" })
) as any as Schema.Codec<RuleSet>

/**
 * `RuleSetErrorType` values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type RuleSetErrorType =
  | "SourceIsNotJsonObject"
  | "InvalidRulesSkipped"
  | "InvalidRulesetLevelTag"
  | (string & {})

/**
 * Schema for `RuleSetErrorType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RuleSetErrorType = Schema.String as any as Schema.Codec<RuleSetErrorType>

/**
 * Unique id
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type RuleSetId = Brand.Branded<string, "~@usestrider/browser/cdp/Preload/RuleSetId">

/**
 * Schema for `RuleSetId`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RuleSetId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/Preload/RuleSetId")
) as any as Schema.Codec<RuleSetId>

/**
 * The type of preloading attempted. It corresponds to
 * mojom::SpeculationAction (although PrefetchWithSubresources is omitted as it
 * isn't being used by clients).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SpeculationAction =
  | "Prefetch"
  | "Prerender"
  | "PrerenderUntilScript"
  | (string & {})

/**
 * Schema for `SpeculationAction`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SpeculationAction = Schema.String as any as Schema.Codec<SpeculationAction>

/**
 * Corresponds to mojom::SpeculationTargetHint.
 * See https://github.com/WICG/nav-speculation/blob/main/triggers.md#window-name-targeting-hints
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SpeculationTargetHint =
  | "Blank"
  | "Self"
  | (string & {})

/**
 * Schema for `SpeculationTargetHint`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SpeculationTargetHint = Schema.String as any as Schema.Codec<SpeculationTargetHint>

/**
 * Fired when a prefetch attempt is updated.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PrefetchStatusUpdatedParams {
  readonly key: PreloadingAttemptKey
  readonly pipelineId: PreloadPipelineId
  /**
   * The frame id of the frame initiating prefetch.
   */
  readonly initiatingFrameId: Page.FrameId
  readonly prefetchUrl: string
  readonly status: PreloadingStatus
  readonly prefetchStatus: PrefetchStatus
  readonly requestId: Network.RequestId
}

/**
 * Schema for `PrefetchStatusUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PrefetchStatusUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    key: PreloadingAttemptKey,
    pipelineId: PreloadPipelineId,
    initiatingFrameId: Page.FrameId,
    prefetchUrl: Schema.String,
    status: PreloadingStatus,
    prefetchStatus: PrefetchStatus,
    requestId: Network.RequestId
  }).annotate({ identifier: "Preload.PrefetchStatusUpdatedParams" })
) as any as Schema.Codec<PrefetchStatusUpdatedParams>

/**
 * Fired when a preload enabled state is updated.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PreloadEnabledStateUpdatedParams {
  readonly disabledByPreference: boolean
  readonly disabledByDataSaver: boolean
  readonly disabledByBatterySaver: boolean
  readonly disabledByHoldbackPrefetchSpeculationRules: boolean
  readonly disabledByHoldbackPrerenderSpeculationRules: boolean
}

/**
 * Schema for `PreloadEnabledStateUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PreloadEnabledStateUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    disabledByPreference: Schema.Boolean,
    disabledByDataSaver: Schema.Boolean,
    disabledByBatterySaver: Schema.Boolean,
    disabledByHoldbackPrefetchSpeculationRules: Schema.Boolean,
    disabledByHoldbackPrerenderSpeculationRules: Schema.Boolean
  }).annotate({ identifier: "Preload.PreloadEnabledStateUpdatedParams" })
) as any as Schema.Codec<PreloadEnabledStateUpdatedParams>

/**
 * Send a list of sources for all preloading attempts in a document.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PreloadingAttemptSourcesUpdatedParams {
  readonly loaderId: Network.LoaderId
  readonly preloadingAttemptSources: ReadonlyArray<PreloadingAttemptSource>
}

/**
 * Schema for `PreloadingAttemptSourcesUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PreloadingAttemptSourcesUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    loaderId: Network.LoaderId,
    preloadingAttemptSources: Schema.Array(PreloadingAttemptSource)
  }).annotate({ identifier: "Preload.PreloadingAttemptSourcesUpdatedParams" })
) as any as Schema.Codec<PreloadingAttemptSourcesUpdatedParams>

/**
 * Fired when a prerender attempt is updated.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PrerenderStatusUpdatedParams {
  readonly key: PreloadingAttemptKey
  readonly pipelineId: PreloadPipelineId
  readonly status: PreloadingStatus
  readonly prerenderStatus?: PrerenderFinalStatus | undefined
  /**
   * This is used to give users more information about the name of Mojo interface
   * that is incompatible with prerender and has caused the cancellation of the attempt.
   */
  readonly disallowedMojoInterface?: string | undefined
  readonly mismatchedHeaders?: ReadonlyArray<PrerenderMismatchedHeaders> | undefined
}

/**
 * Schema for `PrerenderStatusUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PrerenderStatusUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    key: PreloadingAttemptKey,
    pipelineId: PreloadPipelineId,
    status: PreloadingStatus,
    prerenderStatus: Schema.optional(PrerenderFinalStatus),
    disallowedMojoInterface: Schema.optional(Schema.String),
    mismatchedHeaders: Schema.optional(Schema.Array(PrerenderMismatchedHeaders))
  }).annotate({ identifier: "Preload.PrerenderStatusUpdatedParams" })
) as any as Schema.Codec<PrerenderStatusUpdatedParams>

/**
 * `ruleSetRemoved.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RuleSetRemovedParams {
  readonly id: RuleSetId
}

/**
 * Schema for `RuleSetRemovedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RuleSetRemovedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    id: RuleSetId
  }).annotate({ identifier: "Preload.RuleSetRemovedParams" })
) as any as Schema.Codec<RuleSetRemovedParams>

/**
 * Upsert. Currently, it is only emitted when a rule set added.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RuleSetUpdatedParams {
  readonly ruleSet: RuleSet
}

/**
 * Schema for `RuleSetUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RuleSetUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ruleSet: RuleSet
  }).annotate({ identifier: "Preload.RuleSetUpdatedParams" })
) as any as Schema.Codec<RuleSetUpdatedParams>

/**
 * Sends `Preload.disable`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Preload.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Preload.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Sends `Preload.enable`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Preload.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Preload.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Fired when a prefetch attempt is updated.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const prefetchStatusUpdated: Protocol.EventDef<"Preload.prefetchStatusUpdated", PrefetchStatusUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Preload.prefetchStatusUpdated",
    PrefetchStatusUpdatedParams,
    { status: "stable" }
  )

/**
 * Fired when a preload enabled state is updated.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const preloadEnabledStateUpdated: Protocol.EventDef<
  "Preload.preloadEnabledStateUpdated",
  PreloadEnabledStateUpdatedParams
> = /*#__PURE__*/ Protocol.event(
  "Preload.preloadEnabledStateUpdated",
  PreloadEnabledStateUpdatedParams,
  { status: "stable" }
)

/**
 * Send a list of sources for all preloading attempts in a document.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const preloadingAttemptSourcesUpdated: Protocol.EventDef<
  "Preload.preloadingAttemptSourcesUpdated",
  PreloadingAttemptSourcesUpdatedParams
> = /*#__PURE__*/ Protocol.event(
  "Preload.preloadingAttemptSourcesUpdated",
  PreloadingAttemptSourcesUpdatedParams,
  { status: "stable" }
)

/**
 * Fired when a prerender attempt is updated.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const prerenderStatusUpdated: Protocol.EventDef<"Preload.prerenderStatusUpdated", PrerenderStatusUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "Preload.prerenderStatusUpdated",
    PrerenderStatusUpdatedParams,
    { status: "stable" }
  )

/**
 * The `Preload.ruleSetRemoved` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const ruleSetRemoved: Protocol.EventDef<"Preload.ruleSetRemoved", RuleSetRemovedParams> = /*#__PURE__*/ Protocol
  .event(
    "Preload.ruleSetRemoved",
    RuleSetRemovedParams,
    { status: "stable" }
  )

/**
 * Upsert. Currently, it is only emitted when a rule set added.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const ruleSetUpdated: Protocol.EventDef<"Preload.ruleSetUpdated", RuleSetUpdatedParams> = /*#__PURE__*/ Protocol
  .event(
    "Preload.ruleSetUpdated",
    RuleSetUpdatedParams,
    { status: "stable" }
  )
