/**
 * The emulation module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08). Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Browser from "./Browser.ts"
import * as BrowsingContext from "./BrowsingContext.ts"

/**
 * `ForcedColorsModeTheme` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ForcedColorsModeTheme =
  | "light"
  | "dark"
  | (string & {})

/**
 * Schema for `ForcedColorsModeTheme`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ForcedColorsModeTheme = Schema.String as any as Schema.Codec<ForcedColorsModeTheme>

/**
 * `GeolocationCoordinates`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GeolocationCoordinates {
  readonly latitude: number
  readonly longitude: number
  readonly accuracy?: number | undefined
  readonly altitude?: number | null | undefined
  readonly altitudeAccuracy?: number | null | undefined
  readonly heading?: number | null | undefined
  readonly speed?: number | null | undefined
}

/**
 * Schema for `GeolocationCoordinates`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GeolocationCoordinates = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    latitude: Schema.Number,
    longitude: Schema.Number,
    accuracy: Schema.optional(Schema.Number),
    altitude: Schema.optional(Schema.Union([Schema.Number, Schema.Null])),
    altitudeAccuracy: Schema.optional(Schema.Union([Schema.Number, Schema.Null])),
    heading: Schema.optional(Schema.Union([Schema.Number, Schema.Null])),
    speed: Schema.optional(Schema.Union([Schema.Number, Schema.Null]))
  }).annotate({ identifier: "emulation.GeolocationCoordinates" })
) as any as Schema.Codec<GeolocationCoordinates>

/**
 * `GeolocationPositionError`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GeolocationPositionError {
  readonly type: "positionUnavailable"
}

/**
 * Schema for `GeolocationPositionError`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GeolocationPositionError = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("positionUnavailable")
  }).annotate({ identifier: "emulation.GeolocationPositionError" })
) as any as Schema.Codec<GeolocationPositionError>

/**
 * `MediaFeatures`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface MediaFeatures {
  readonly "any-hover"?: "none" | "hover" | null | undefined
  readonly "any-pointer"?: "none" | "coarse" | "fine" | null | undefined
  readonly color?: number | null | undefined
  readonly "color-gamut"?: "srgb" | "p3" | "rec2020" | null | undefined
  readonly "color-index"?: number | null | undefined
  readonly "display-mode"?:
    | "fullscreen"
    | "standalone"
    | "minimal-ui"
    | "browser"
    | "picture-in-picture"
    | null
    | undefined
  readonly "dynamic-range"?: "standard" | "high" | null | undefined
  readonly "environment-blending"?: "opaque" | "additive" | "subtractive" | null | undefined
  readonly "forced-colors"?: "none" | "active" | null | undefined
  readonly grid?: 0 | 1 | null | undefined
  readonly "horizontal-viewport-segments"?: number | null | undefined
  readonly hover?: "none" | "hover" | null | undefined
  readonly "inverted-colors"?: "none" | "inverted" | null | undefined
  readonly monochrome?: number | null | undefined
  readonly "nav-controls"?: "none" | "back" | null | undefined
  readonly "overflow-block"?: "none" | "scroll" | "optional-paged" | "paged" | null | undefined
  readonly "overflow-inline"?: "none" | "scroll" | null | undefined
  readonly pointer?: "none" | "coarse" | "fine" | null | undefined
  readonly "prefers-color-scheme"?: "light" | "dark" | null | undefined
  readonly "prefers-contrast"?: "no-preference" | "more" | "less" | "custom" | null | undefined
  readonly "prefers-reduced-data"?: "no-preference" | "reduce" | null | undefined
  readonly "prefers-reduced-motion"?: "no-preference" | "reduce" | null | undefined
  readonly "prefers-reduced-transparency"?: "no-preference" | "reduce" | null | undefined
  readonly scan?: "interlace" | "progressive" | null | undefined
  readonly scripting?: "none" | "initial-only" | "enabled" | null | undefined
  readonly update?: "none" | "slow" | "fast" | null | undefined
  readonly "vertical-viewport-segments"?: number | null | undefined
  readonly "video-color-gamut"?: "srgb" | "p3" | "rec2020" | null | undefined
  readonly "video-dynamic-range"?: "standard" | "high" | null | undefined
}

/**
 * Schema for `MediaFeatures`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const MediaFeatures = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    "any-hover": Schema.optional(Schema.Union([Schema.Literal("none"), Schema.Literal("hover"), Schema.Null])),
    "any-pointer": Schema.optional(
      Schema.Union([Schema.Literal("none"), Schema.Literal("coarse"), Schema.Literal("fine"), Schema.Null])
    ),
    color: Schema.optional(Schema.Union([Schema.Int, Schema.Null])),
    "color-gamut": Schema.optional(
      Schema.Union([Schema.Literal("srgb"), Schema.Literal("p3"), Schema.Literal("rec2020"), Schema.Null])
    ),
    "color-index": Schema.optional(Schema.Union([Schema.Int, Schema.Null])),
    "display-mode": Schema.optional(
      Schema.Union([
        Schema.Literal("fullscreen"),
        Schema.Literal("standalone"),
        Schema.Literal("minimal-ui"),
        Schema.Literal("browser"),
        Schema.Literal("picture-in-picture"),
        Schema.Null
      ])
    ),
    "dynamic-range": Schema.optional(Schema.Union([Schema.Literal("standard"), Schema.Literal("high"), Schema.Null])),
    "environment-blending": Schema.optional(
      Schema.Union([Schema.Literal("opaque"), Schema.Literal("additive"), Schema.Literal("subtractive"), Schema.Null])
    ),
    "forced-colors": Schema.optional(Schema.Union([Schema.Literal("none"), Schema.Literal("active"), Schema.Null])),
    grid: Schema.optional(Schema.Union([Schema.Literal(0), Schema.Literal(1), Schema.Null])),
    "horizontal-viewport-segments": Schema.optional(Schema.Union([Schema.Int, Schema.Null])),
    hover: Schema.optional(Schema.Union([Schema.Literal("none"), Schema.Literal("hover"), Schema.Null])),
    "inverted-colors": Schema.optional(Schema.Union([Schema.Literal("none"), Schema.Literal("inverted"), Schema.Null])),
    monochrome: Schema.optional(Schema.Union([Schema.Int, Schema.Null])),
    "nav-controls": Schema.optional(Schema.Union([Schema.Literal("none"), Schema.Literal("back"), Schema.Null])),
    "overflow-block": Schema.optional(
      Schema.Union([
        Schema.Literal("none"),
        Schema.Literal("scroll"),
        Schema.Literal("optional-paged"),
        Schema.Literal("paged"),
        Schema.Null
      ])
    ),
    "overflow-inline": Schema.optional(Schema.Union([Schema.Literal("none"), Schema.Literal("scroll"), Schema.Null])),
    pointer: Schema.optional(
      Schema.Union([Schema.Literal("none"), Schema.Literal("coarse"), Schema.Literal("fine"), Schema.Null])
    ),
    "prefers-color-scheme": Schema.optional(
      Schema.Union([Schema.Literal("light"), Schema.Literal("dark"), Schema.Null])
    ),
    "prefers-contrast": Schema.optional(
      Schema.Union([
        Schema.Literal("no-preference"),
        Schema.Literal("more"),
        Schema.Literal("less"),
        Schema.Literal("custom"),
        Schema.Null
      ])
    ),
    "prefers-reduced-data": Schema.optional(
      Schema.Union([Schema.Literal("no-preference"), Schema.Literal("reduce"), Schema.Null])
    ),
    "prefers-reduced-motion": Schema.optional(
      Schema.Union([Schema.Literal("no-preference"), Schema.Literal("reduce"), Schema.Null])
    ),
    "prefers-reduced-transparency": Schema.optional(
      Schema.Union([Schema.Literal("no-preference"), Schema.Literal("reduce"), Schema.Null])
    ),
    scan: Schema.optional(Schema.Union([Schema.Literal("interlace"), Schema.Literal("progressive"), Schema.Null])),
    scripting: Schema.optional(
      Schema.Union([Schema.Literal("none"), Schema.Literal("initial-only"), Schema.Literal("enabled"), Schema.Null])
    ),
    update: Schema.optional(
      Schema.Union([Schema.Literal("none"), Schema.Literal("slow"), Schema.Literal("fast"), Schema.Null])
    ),
    "vertical-viewport-segments": Schema.optional(Schema.Union([Schema.Int, Schema.Null])),
    "video-color-gamut": Schema.optional(
      Schema.Union([Schema.Literal("srgb"), Schema.Literal("p3"), Schema.Literal("rec2020"), Schema.Null])
    ),
    "video-dynamic-range": Schema.optional(
      Schema.Union([Schema.Literal("standard"), Schema.Literal("high"), Schema.Null])
    )
  }).annotate({ identifier: "emulation.MediaFeatures" })
) as any as Schema.Codec<MediaFeatures>

/**
 * `NetworkConditions`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type NetworkConditions = NetworkConditionsOffline

/**
 * Schema for `NetworkConditions`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NetworkConditions = /*#__PURE__*/ Schema.suspend(() => NetworkConditionsOffline) as any as Schema.Codec<
  NetworkConditions
>

/**
 * `NetworkConditionsOffline`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NetworkConditionsOffline {
  readonly type: "offline"
}

/**
 * Schema for `NetworkConditionsOffline`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NetworkConditionsOffline = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("offline")
  }).annotate({ identifier: "emulation.NetworkConditionsOffline" })
) as any as Schema.Codec<NetworkConditionsOffline>

/**
 * `ScreenArea`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScreenArea {
  readonly width: number
  readonly height: number
}

/**
 * Schema for `ScreenArea`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScreenArea = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    width: Schema.Int,
    height: Schema.Int
  }).annotate({ identifier: "emulation.ScreenArea" })
) as any as Schema.Codec<ScreenArea>

/**
 * `ScreenOrientation`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ScreenOrientation {
  readonly natural: ScreenOrientationNatural
  readonly type: ScreenOrientationType
}

/**
 * Schema for `ScreenOrientation`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScreenOrientation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    natural: ScreenOrientationNatural,
    type: ScreenOrientationType
  }).annotate({ identifier: "emulation.ScreenOrientation" })
) as any as Schema.Codec<ScreenOrientation>

/**
 * `ScreenOrientationNatural` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ScreenOrientationNatural =
  | "portrait"
  | "landscape"
  | (string & {})

/**
 * Schema for `ScreenOrientationNatural`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScreenOrientationNatural = Schema.String as any as Schema.Codec<ScreenOrientationNatural>

/**
 * `ScreenOrientationType` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ScreenOrientationType =
  | "portrait-primary"
  | "portrait-secondary"
  | "landscape-primary"
  | "landscape-secondary"
  | (string & {})

/**
 * Schema for `ScreenOrientationType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ScreenOrientationType = Schema.String as any as Schema.Codec<ScreenOrientationType>

/**
 * `SetForcedColorsModeThemeOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetForcedColorsModeThemeOverrideParameters {
  readonly theme: ForcedColorsModeTheme | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetForcedColorsModeThemeOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetForcedColorsModeThemeOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    theme: Schema.Union([ForcedColorsModeTheme, Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetForcedColorsModeThemeOverrideParameters" })
) as any as Schema.Codec<SetForcedColorsModeThemeOverrideParameters>

/**
 * `SetForcedColorsModeThemeOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetForcedColorsModeThemeOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetForcedColorsModeThemeOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetForcedColorsModeThemeOverrideResult = Schema.Record(
  Schema.String,
  Schema.Unknown
) as any as Schema.Codec<SetForcedColorsModeThemeOverrideResult>

/**
 * `SetGeolocationOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetGeolocationOverrideParameters =
  | SetGeolocationOverrideParametersCase1
  | SetGeolocationOverrideParametersCase2

/**
 * Schema for `SetGeolocationOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetGeolocationOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([SetGeolocationOverrideParametersCase1, SetGeolocationOverrideParametersCase2])
) as any as Schema.Codec<SetGeolocationOverrideParameters>

/**
 * `SetGeolocationOverrideParameters.Case1`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetGeolocationOverrideParametersCase1 {
  readonly coordinates: GeolocationCoordinates | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetGeolocationOverrideParametersCase1`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetGeolocationOverrideParametersCase1 = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    coordinates: Schema.Union([GeolocationCoordinates, Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetGeolocationOverrideParametersCase1" })
) as any as Schema.Codec<SetGeolocationOverrideParametersCase1>

/**
 * `SetGeolocationOverrideParameters.Case2`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetGeolocationOverrideParametersCase2 {
  readonly error: GeolocationPositionError
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetGeolocationOverrideParametersCase2`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetGeolocationOverrideParametersCase2 = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    error: GeolocationPositionError,
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetGeolocationOverrideParametersCase2" })
) as any as Schema.Codec<SetGeolocationOverrideParametersCase2>

/**
 * `SetGeolocationOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetGeolocationOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetGeolocationOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetGeolocationOverrideResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetGeolocationOverrideResult
>

/**
 * `SetLocaleOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetLocaleOverrideParameters {
  readonly locale: string | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetLocaleOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetLocaleOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    locale: Schema.Union([Schema.String, Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetLocaleOverrideParameters" })
) as any as Schema.Codec<SetLocaleOverrideParameters>

/**
 * `SetLocaleOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetLocaleOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetLocaleOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetLocaleOverrideResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetLocaleOverrideResult
>

/**
 * `SetMediaFeaturesOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetMediaFeaturesOverrideParameters {
  readonly features: MediaFeatures | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetMediaFeaturesOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetMediaFeaturesOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    features: Schema.Union([MediaFeatures, Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetMediaFeaturesOverrideParameters" })
) as any as Schema.Codec<SetMediaFeaturesOverrideParameters>

/**
 * `SetMediaFeaturesOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetMediaFeaturesOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetMediaFeaturesOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetMediaFeaturesOverrideResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetMediaFeaturesOverrideResult
>

/**
 * `SetNetworkConditionsParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetNetworkConditionsParameters {
  readonly networkConditions: NetworkConditions | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetNetworkConditionsParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetNetworkConditionsParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    networkConditions: Schema.Union([NetworkConditions, Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetNetworkConditionsParameters" })
) as any as Schema.Codec<SetNetworkConditionsParameters>

/**
 * `SetNetworkConditionsResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetNetworkConditionsResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetNetworkConditionsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetNetworkConditionsResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetNetworkConditionsResult
>

/**
 * `SetScreenOrientationOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetScreenOrientationOverrideParameters {
  readonly screenOrientation: ScreenOrientation | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetScreenOrientationOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetScreenOrientationOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    screenOrientation: Schema.Union([ScreenOrientation, Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetScreenOrientationOverrideParameters" })
) as any as Schema.Codec<SetScreenOrientationOverrideParameters>

/**
 * `SetScreenOrientationOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetScreenOrientationOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetScreenOrientationOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetScreenOrientationOverrideResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetScreenOrientationOverrideResult
>

/**
 * `SetScreenSettingsOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetScreenSettingsOverrideParameters {
  readonly screenArea: ScreenArea | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetScreenSettingsOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetScreenSettingsOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    screenArea: Schema.Union([ScreenArea, Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetScreenSettingsOverrideParameters" })
) as any as Schema.Codec<SetScreenSettingsOverrideParameters>

/**
 * `SetScreenSettingsOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetScreenSettingsOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetScreenSettingsOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetScreenSettingsOverrideResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetScreenSettingsOverrideResult
>

/**
 * `SetScriptingEnabledParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetScriptingEnabledParameters {
  readonly enabled: false | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetScriptingEnabledParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetScriptingEnabledParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Union([Schema.Literal(false), Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetScriptingEnabledParameters" })
) as any as Schema.Codec<SetScriptingEnabledParameters>

/**
 * `SetScriptingEnabledResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetScriptingEnabledResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetScriptingEnabledResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetScriptingEnabledResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetScriptingEnabledResult
>

/**
 * `SetScrollbarTypeOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetScrollbarTypeOverrideParameters {
  readonly scrollbarType: "classic" | "overlay" | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetScrollbarTypeOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetScrollbarTypeOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scrollbarType: Schema.Union([Schema.Literal("classic"), Schema.Literal("overlay"), Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetScrollbarTypeOverrideParameters" })
) as any as Schema.Codec<SetScrollbarTypeOverrideParameters>

/**
 * `SetScrollbarTypeOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetScrollbarTypeOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetScrollbarTypeOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetScrollbarTypeOverrideResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetScrollbarTypeOverrideResult
>

/**
 * `SetTextLayoutModeOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetTextLayoutModeOverrideParameters {
  readonly textLayoutMode: TextLayoutMode | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetTextLayoutModeOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetTextLayoutModeOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    textLayoutMode: Schema.Union([TextLayoutMode, Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetTextLayoutModeOverrideParameters" })
) as any as Schema.Codec<SetTextLayoutModeOverrideParameters>

/**
 * `SetTextLayoutModeOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetTextLayoutModeOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetTextLayoutModeOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetTextLayoutModeOverrideResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetTextLayoutModeOverrideResult
>

/**
 * `SetTimezoneOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetTimezoneOverrideParameters {
  readonly timezone: string | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetTimezoneOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetTimezoneOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    timezone: Schema.Union([Schema.String, Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetTimezoneOverrideParameters" })
) as any as Schema.Codec<SetTimezoneOverrideParameters>

/**
 * `SetTimezoneOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetTimezoneOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetTimezoneOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetTimezoneOverrideResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetTimezoneOverrideResult
>

/**
 * `SetTouchOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetTouchOverrideParameters {
  readonly maxTouchPoints: number | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetTouchOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetTouchOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    maxTouchPoints: Schema.Union([Schema.Int, Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetTouchOverrideParameters" })
) as any as Schema.Codec<SetTouchOverrideParameters>

/**
 * `SetTouchOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetTouchOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetTouchOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetTouchOverrideResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetTouchOverrideResult
>

/**
 * `SetUserAgentOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetUserAgentOverrideParameters {
  readonly userAgent: string | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetUserAgentOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetUserAgentOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    userAgent: Schema.Union([Schema.String, Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetUserAgentOverrideParameters" })
) as any as Schema.Codec<SetUserAgentOverrideParameters>

/**
 * `SetUserAgentOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetUserAgentOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetUserAgentOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetUserAgentOverrideResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetUserAgentOverrideResult
>

/**
 * `SetViewportMetaOverrideParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetViewportMetaOverrideParameters {
  readonly viewportMeta: true | null
  readonly contexts?: ReadonlyArray<BrowsingContext.BrowsingContext> | undefined
  readonly userContexts?: ReadonlyArray<Browser.UserContext> | undefined
}

/**
 * Schema for `SetViewportMetaOverrideParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetViewportMetaOverrideParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    viewportMeta: Schema.Union([Schema.Literal(true), Schema.Null]),
    contexts: Schema.optional(Schema.Array(BrowsingContext.BrowsingContext)),
    userContexts: Schema.optional(Schema.Array(Browser.UserContext))
  }).annotate({ identifier: "emulation.SetViewportMetaOverrideParameters" })
) as any as Schema.Codec<SetViewportMetaOverrideParameters>

/**
 * `SetViewportMetaOverrideResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SetViewportMetaOverrideResult = { readonly [key: string]: unknown }

/**
 * Schema for `SetViewportMetaOverrideResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetViewportMetaOverrideResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<
  SetViewportMetaOverrideResult
>

/**
 * `TextLayoutMode`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TextLayoutMode = "mobile"

/**
 * Schema for `TextLayoutMode`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TextLayoutMode = Schema.Literal("mobile") as any as Schema.Codec<TextLayoutMode>

/**
 * Sends `emulation.setForcedColorsModeThemeOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setForcedColorsModeThemeOverride: Protocol.CommandDef<
  "emulation.setForcedColorsModeThemeOverride",
  SetForcedColorsModeThemeOverrideParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setForcedColorsModeThemeOverride",
  SetForcedColorsModeThemeOverrideParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `emulation.setGeolocationOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setGeolocationOverride: Protocol.CommandDef<
  "emulation.setGeolocationOverride",
  SetGeolocationOverrideParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setGeolocationOverride",
  SetGeolocationOverrideParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `emulation.setLocaleOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setLocaleOverride: Protocol.CommandDef<"emulation.setLocaleOverride", SetLocaleOverrideParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "emulation.setLocaleOverride",
    SetLocaleOverrideParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `emulation.setMediaFeaturesOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setMediaFeaturesOverride: Protocol.CommandDef<
  "emulation.setMediaFeaturesOverride",
  SetMediaFeaturesOverrideParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setMediaFeaturesOverride",
  SetMediaFeaturesOverrideParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `emulation.setNetworkConditions`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setNetworkConditions: Protocol.CommandDef<
  "emulation.setNetworkConditions",
  SetNetworkConditionsParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setNetworkConditions",
  SetNetworkConditionsParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `emulation.setScreenOrientationOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setScreenOrientationOverride: Protocol.CommandDef<
  "emulation.setScreenOrientationOverride",
  SetScreenOrientationOverrideParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setScreenOrientationOverride",
  SetScreenOrientationOverrideParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `emulation.setScreenSettingsOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setScreenSettingsOverride: Protocol.CommandDef<
  "emulation.setScreenSettingsOverride",
  SetScreenSettingsOverrideParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setScreenSettingsOverride",
  SetScreenSettingsOverrideParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `emulation.setScriptingEnabled`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setScriptingEnabled: Protocol.CommandDef<
  "emulation.setScriptingEnabled",
  SetScriptingEnabledParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setScriptingEnabled",
  SetScriptingEnabledParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `emulation.setScrollbarTypeOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setScrollbarTypeOverride: Protocol.CommandDef<
  "emulation.setScrollbarTypeOverride",
  SetScrollbarTypeOverrideParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setScrollbarTypeOverride",
  SetScrollbarTypeOverrideParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `emulation.setTextLayoutModeOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setTextLayoutModeOverride: Protocol.CommandDef<
  "emulation.setTextLayoutModeOverride",
  SetTextLayoutModeOverrideParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setTextLayoutModeOverride",
  SetTextLayoutModeOverrideParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `emulation.setTimezoneOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setTimezoneOverride: Protocol.CommandDef<
  "emulation.setTimezoneOverride",
  SetTimezoneOverrideParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setTimezoneOverride",
  SetTimezoneOverrideParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `emulation.setTouchOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setTouchOverride: Protocol.CommandDef<"emulation.setTouchOverride", SetTouchOverrideParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "emulation.setTouchOverride",
    SetTouchOverrideParameters,
    undefined,
    { status: "stable" }
  )

/**
 * Sends `emulation.setUserAgentOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setUserAgentOverride: Protocol.CommandDef<
  "emulation.setUserAgentOverride",
  SetUserAgentOverrideParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setUserAgentOverride",
  SetUserAgentOverrideParameters,
  undefined,
  { status: "stable" }
)

/**
 * Sends `emulation.setViewportMetaOverride`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setViewportMetaOverride: Protocol.CommandDef<
  "emulation.setViewportMetaOverride",
  SetViewportMetaOverrideParameters,
  void
> = /*#__PURE__*/ Protocol.command(
  "emulation.setViewportMetaOverride",
  SetViewportMetaOverrideParameters,
  undefined,
  { status: "stable" }
)
