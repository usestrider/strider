/**
 * This domain exposes CSS read/write operations. All CSS objects (stylesheets, rules, and styles)
 * have an associated `id` used in subsequent operations on the related object. Each object type has
 * a specific `id` structure, and those are not interchangeable between objects of different kinds.
 * CSS objects can be loaded using the `get*ForNode()` calls (which accept a DOM node id). A client
 * can also keep track of stylesheets via the `styleSheetAdded`/`styleSheetRemoved` events and
 * subsequently load the required stylesheet contents using the `getStyleSheet[Text]()` methods.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as Page from "./Page.ts"

/**
 * CSS style coming from animations with the name of the animation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSAnimationStyle {
  /**
   * The name of the animation.
   */
  readonly name?: string | undefined
  /**
   * The style coming from the animation.
   */
  readonly style: CSSStyle
}

/**
 * Schema for `CSSAnimationStyle`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSAnimationStyle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.optional(Schema.String),
    style: CSSStyle
  }).annotate({ identifier: "CSS.CSSAnimationStyle" })
) as any as Schema.Codec<CSSAnimationStyle, unknown>

/**
 * CSS generic \@rule representation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSAtRule {
  /**
   * Type of at-rule.
   */
  readonly type: CSSAtRuleType
  /**
   * Subsection of font-feature-values, if this is a subsection.
   */
  readonly subsection?: CSSAtRuleSubsection | undefined
  /**
   * LINT.ThenChange(//third_party/blink/renderer/core/inspector/inspector_style_sheet.cc:FontVariantAlternatesFeatureType,//third_party/blink/renderer/core/inspector/inspector_css_agent.cc:FontVariantAlternatesFeatureType)
   * Associated name, if applicable.
   */
  readonly name?: Value | undefined
  /**
   * The css style sheet identifier (absent for user agent stylesheet and user-specified
   * stylesheet rules) this rule came from.
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
  /**
   * Parent stylesheet's origin.
   */
  readonly origin: StyleSheetOrigin
  /**
   * Associated style declaration.
   */
  readonly style: CSSStyle
}

/**
 * Schema for `CSSAtRule`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSAtRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: CSSAtRuleType,
    subsection: Schema.optional(CSSAtRuleSubsection),
    name: Schema.optional(Value),
    styleSheetId: Schema.optional(DOM.StyleSheetId),
    origin: StyleSheetOrigin,
    style: CSSStyle
  }).annotate({ identifier: "CSS.CSSAtRule" })
) as any as Schema.Codec<CSSAtRule, unknown>

/**
 * Subsection of font-feature-values, if this is a subsection.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CSSAtRuleSubsection =
  | "swash"
  | "annotation"
  | "ornaments"
  | "stylistic"
  | "styleset"
  | "character-variant"
  | (string & {})

/**
 * Schema for `CSSAtRuleSubsection`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSAtRuleSubsection = Schema.String as any as Schema.Codec<CSSAtRuleSubsection>

/**
 * Type of at-rule.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CSSAtRuleType =
  | "font-face"
  | "font-feature-values"
  | "font-palette-values"
  | "counter-style"
  | (string & {})

/**
 * Schema for `CSSAtRuleType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSAtRuleType = Schema.String as any as Schema.Codec<CSSAtRuleType>

/**
 * `CSSComputedStyleProperty`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSComputedStyleProperty {
  /**
   * Computed style property name.
   */
  readonly name: string
  /**
   * Computed style property value.
   */
  readonly value: string
}

/**
 * Schema for `CSSComputedStyleProperty`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSComputedStyleProperty = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "CSS.CSSComputedStyleProperty" })
) as any as Schema.Codec<CSSComputedStyleProperty>

/**
 * CSS container query rule descriptor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSContainerQuery {
  /**
   * The associated rule header range in the enclosing stylesheet (if
   * available).
   */
  readonly range?: SourceRange | undefined
  /**
   * Identifier of the stylesheet containing this object (if exists).
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
  /**
   * Optional name for the container.
   */
  readonly name?: string | undefined
  /**
   * Optional physical axes queried for the container.
   */
  readonly physicalAxes?: DOM.PhysicalAxes | undefined
  /**
   * Optional logical axes queried for the container.
   */
  readonly logicalAxes?: DOM.LogicalAxes | undefined
  /**
   * true if the query contains scroll-state() queries.
   */
  readonly queriesScrollState?: boolean | undefined
  /**
   * true if the query contains anchored() queries.
   */
  readonly queriesAnchored?: boolean | undefined
  /**
   * CSSContainerRule.conditionText
   */
  readonly conditionText: string
}

/**
 * Schema for `CSSContainerQuery`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSContainerQuery = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    range: Schema.optional(SourceRange),
    styleSheetId: Schema.optional(DOM.StyleSheetId),
    name: Schema.optional(Schema.String),
    physicalAxes: Schema.optional(DOM.PhysicalAxes),
    logicalAxes: Schema.optional(DOM.LogicalAxes),
    queriesScrollState: Schema.optional(Schema.Boolean),
    queriesAnchored: Schema.optional(Schema.Boolean),
    conditionText: Schema.String
  }).annotate({ identifier: "CSS.CSSContainerQuery" })
) as any as Schema.Codec<CSSContainerQuery>

/**
 * CSS function conditional block representation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSFunctionConditionNode {
  /**
   * Media query for this conditional block. Only one type of condition should be set.
   */
  readonly media?: CSSMedia | undefined
  /**
   * Container query for this conditional block. Only one type of condition should be set.
   */
  readonly containerQueries?: CSSContainerQuery | undefined
  /**
   * \@supports CSS at-rule condition. Only one type of condition should be set.
   */
  readonly supports?: CSSSupports | undefined
  /**
   * \@navigation condition. Only one type of condition should be set.
   */
  readonly navigation?: CSSNavigation | undefined
  /**
   * Block body.
   */
  readonly children: ReadonlyArray<CSSFunctionNode>
  /**
   * The condition text.
   */
  readonly conditionText: string
}

/**
 * Schema for `CSSFunctionConditionNode`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSFunctionConditionNode = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    media: Schema.optional(CSSMedia),
    containerQueries: Schema.optional(CSSContainerQuery),
    supports: Schema.optional(CSSSupports),
    navigation: Schema.optional(CSSNavigation),
    children: Schema.Array(CSSFunctionNode),
    conditionText: Schema.String
  }).annotate({ identifier: "CSS.CSSFunctionConditionNode" })
) as any as Schema.Codec<CSSFunctionConditionNode, unknown>

/**
 * Section of the body of a CSS function rule.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSFunctionNode {
  /**
   * A conditional block. If set, style should not be set.
   */
  readonly condition?: CSSFunctionConditionNode | undefined
  /**
   * Values set by this node. If set, condition should not be set.
   */
  readonly style?: CSSStyle | undefined
}

/**
 * Schema for `CSSFunctionNode`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSFunctionNode = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    condition: Schema.optional(CSSFunctionConditionNode),
    style: Schema.optional(CSSStyle)
  }).annotate({ identifier: "CSS.CSSFunctionNode" })
) as any as Schema.Codec<CSSFunctionNode, unknown>

/**
 * CSS function argument representation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSFunctionParameter {
  /**
   * The parameter name.
   */
  readonly name: string
  /**
   * The parameter type.
   */
  readonly type: string
}

/**
 * Schema for `CSSFunctionParameter`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSFunctionParameter = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    type: Schema.String
  }).annotate({ identifier: "CSS.CSSFunctionParameter" })
) as any as Schema.Codec<CSSFunctionParameter>

/**
 * CSS function at-rule representation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSFunctionRule {
  /**
   * Name of the function.
   */
  readonly name: Value
  /**
   * The css style sheet identifier (absent for user agent stylesheet and user-specified
   * stylesheet rules) this rule came from.
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
  /**
   * Parent stylesheet's origin.
   */
  readonly origin: StyleSheetOrigin
  /**
   * List of parameters.
   */
  readonly parameters: ReadonlyArray<CSSFunctionParameter>
  /**
   * Function body.
   */
  readonly children: ReadonlyArray<CSSFunctionNode>
  /**
   * The BackendNodeId of the DOM node that constitutes the origin tree scope of this rule.
   */
  readonly originTreeScopeNodeId?: DOM.BackendNodeId | undefined
}

/**
 * Schema for `CSSFunctionRule`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSFunctionRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Value,
    styleSheetId: Schema.optional(DOM.StyleSheetId),
    origin: StyleSheetOrigin,
    parameters: Schema.Array(CSSFunctionParameter),
    children: Schema.Array(CSSFunctionNode),
    originTreeScopeNodeId: Schema.optional(DOM.BackendNodeId)
  }).annotate({ identifier: "CSS.CSSFunctionRule" })
) as any as Schema.Codec<CSSFunctionRule, unknown>

/**
 * CSS keyframe rule representation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSKeyframeRule {
  /**
   * The css style sheet identifier (absent for user agent stylesheet and user-specified
   * stylesheet rules) this rule came from.
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
  /**
   * Parent stylesheet's origin.
   */
  readonly origin: StyleSheetOrigin
  /**
   * Associated key text.
   */
  readonly keyText: Value
  /**
   * Associated style declaration.
   */
  readonly style: CSSStyle
}

/**
 * Schema for `CSSKeyframeRule`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSKeyframeRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: Schema.optional(DOM.StyleSheetId),
    origin: StyleSheetOrigin,
    keyText: Value,
    style: CSSStyle
  }).annotate({ identifier: "CSS.CSSKeyframeRule" })
) as any as Schema.Codec<CSSKeyframeRule, unknown>

/**
 * CSS keyframes rule representation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSKeyframesRule {
  /**
   * Animation name.
   */
  readonly animationName: Value
  /**
   * List of keyframes.
   */
  readonly keyframes: ReadonlyArray<CSSKeyframeRule>
}

/**
 * Schema for `CSSKeyframesRule`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSKeyframesRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationName: Value,
    keyframes: Schema.Array(CSSKeyframeRule)
  }).annotate({ identifier: "CSS.CSSKeyframesRule" })
) as any as Schema.Codec<CSSKeyframesRule, unknown>

/**
 * CSS Layer at-rule descriptor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSLayer {
  /**
   * Layer name.
   */
  readonly text: string
  /**
   * The associated rule header range in the enclosing stylesheet (if
   * available).
   */
  readonly range?: SourceRange | undefined
  /**
   * Identifier of the stylesheet containing this object (if exists).
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
}

/**
 * Schema for `CSSLayer`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSLayer = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.String,
    range: Schema.optional(SourceRange),
    styleSheetId: Schema.optional(DOM.StyleSheetId)
  }).annotate({ identifier: "CSS.CSSLayer" })
) as any as Schema.Codec<CSSLayer>

/**
 * CSS Layer data.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSLayerData {
  /**
   * Layer name.
   */
  readonly name: string
  /**
   * Direct sub-layers
   */
  readonly subLayers?: ReadonlyArray<CSSLayerData> | undefined
  /**
   * Layer order. The order determines the order of the layer in the cascade order.
   * A higher number has higher priority in the cascade order.
   */
  readonly order: number
}

/**
 * Schema for `CSSLayerData`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSLayerData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    subLayers: Schema.optional(Schema.Array(CSSLayerData)),
    order: Schema.Number
  }).annotate({ identifier: "CSS.CSSLayerData" })
) as any as Schema.Codec<CSSLayerData, unknown>

/**
 * CSS media rule descriptor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSMedia {
  /**
   * Media query text.
   */
  readonly text: string
  /**
   * Source of the media query: "mediaRule" if specified by a \@media rule, "importRule" if
   * specified by an \@import rule, "linkedSheet" if specified by a "media" attribute in a linked
   * stylesheet's LINK tag, "inlineSheet" if specified by a "media" attribute in an inline
   * stylesheet's STYLE tag.
   */
  readonly source: CSSMediaSource
  /**
   * URL of the document containing the media query description.
   */
  readonly sourceURL?: string | undefined
  /**
   * The associated rule (\@media or \@import) header range in the enclosing stylesheet (if
   * available).
   */
  readonly range?: SourceRange | undefined
  /**
   * Identifier of the stylesheet containing this object (if exists).
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
  /**
   * Array of media queries.
   */
  readonly mediaList?: ReadonlyArray<MediaQuery> | undefined
}

/**
 * Schema for `CSSMedia`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSMedia = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.String,
    source: CSSMediaSource,
    sourceURL: Schema.optional(Schema.String),
    range: Schema.optional(SourceRange),
    styleSheetId: Schema.optional(DOM.StyleSheetId),
    mediaList: Schema.optional(Schema.Array(MediaQuery))
  }).annotate({ identifier: "CSS.CSSMedia" })
) as any as Schema.Codec<CSSMedia>

/**
 * Source of the media query: "mediaRule" if specified by a \@media rule, "importRule" if
 * specified by an \@import rule, "linkedSheet" if specified by a "media" attribute in a linked
 * stylesheet's LINK tag, "inlineSheet" if specified by a "media" attribute in an inline
 * stylesheet's STYLE tag.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CSSMediaSource =
  | "mediaRule"
  | "importRule"
  | "linkedSheet"
  | "inlineSheet"
  | (string & {})

/**
 * Schema for `CSSMediaSource`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSMediaSource = Schema.String as any as Schema.Codec<CSSMediaSource>

/**
 * CSS Navigation at-rule descriptor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSNavigation {
  /**
   * Navigation rule text.
   */
  readonly text: string
  /**
   * Whether the navigation condition is satisfied.
   */
  readonly active?: boolean | undefined
  /**
   * The associated rule header range in the enclosing stylesheet (if
   * available).
   */
  readonly range?: SourceRange | undefined
  /**
   * Identifier of the stylesheet containing this object (if exists).
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
}

/**
 * Schema for `CSSNavigation`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSNavigation = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.String,
    active: Schema.optional(Schema.Boolean),
    range: Schema.optional(SourceRange),
    styleSheetId: Schema.optional(DOM.StyleSheetId)
  }).annotate({ identifier: "CSS.CSSNavigation" })
) as any as Schema.Codec<CSSNavigation>

/**
 * CSS \@position-try rule representation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSPositionTryRule {
  /**
   * The prelude dashed-ident name
   */
  readonly name: Value
  /**
   * The css style sheet identifier (absent for user agent stylesheet and user-specified
   * stylesheet rules) this rule came from.
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
  /**
   * Parent stylesheet's origin.
   */
  readonly origin: StyleSheetOrigin
  /**
   * Associated style declaration.
   */
  readonly style: CSSStyle
  readonly active: boolean
}

/**
 * Schema for `CSSPositionTryRule`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSPositionTryRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Value,
    styleSheetId: Schema.optional(DOM.StyleSheetId),
    origin: StyleSheetOrigin,
    style: CSSStyle,
    active: Schema.Boolean
  }).annotate({ identifier: "CSS.CSSPositionTryRule" })
) as any as Schema.Codec<CSSPositionTryRule, unknown>

/**
 * CSS property declaration data.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSProperty {
  /**
   * The property name.
   */
  readonly name: string
  /**
   * The property value.
   */
  readonly value: string
  /**
   * Whether the property has "!important" annotation (implies `false` if absent).
   */
  readonly important?: boolean | undefined
  /**
   * Whether the property is implicit (implies `false` if absent).
   */
  readonly implicit?: boolean | undefined
  /**
   * The full property text as specified in the style.
   */
  readonly text?: string | undefined
  /**
   * Whether the property is understood by the browser (implies `true` if absent).
   */
  readonly parsedOk?: boolean | undefined
  /**
   * Whether the property is disabled by the user (present for source-based properties only).
   */
  readonly disabled?: boolean | undefined
  /**
   * The entire property range in the enclosing style declaration (if available).
   */
  readonly range?: SourceRange | undefined
  /**
   * Parsed longhand components of this property if it is a shorthand.
   * This field will be empty if the given property is not a shorthand.
   */
  readonly longhandProperties?: ReadonlyArray<CSSProperty> | undefined
}

/**
 * Schema for `CSSProperty`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSProperty = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String,
    important: Schema.optional(Schema.Boolean),
    implicit: Schema.optional(Schema.Boolean),
    text: Schema.optional(Schema.String),
    parsedOk: Schema.optional(Schema.Boolean),
    disabled: Schema.optional(Schema.Boolean),
    range: Schema.optional(SourceRange),
    longhandProperties: Schema.optional(Schema.Array(CSSProperty))
  }).annotate({ identifier: "CSS.CSSProperty" })
) as any as Schema.Codec<CSSProperty, unknown>

/**
 * Representation of a custom property registration through CSS.registerProperty
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSPropertyRegistration {
  readonly propertyName: string
  readonly initialValue?: Value | undefined
  readonly inherits: boolean
  readonly syntax: string
}

/**
 * Schema for `CSSPropertyRegistration`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSPropertyRegistration = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    propertyName: Schema.String,
    initialValue: Schema.optional(Value),
    inherits: Schema.Boolean,
    syntax: Schema.String
  }).annotate({ identifier: "CSS.CSSPropertyRegistration" })
) as any as Schema.Codec<CSSPropertyRegistration>

/**
 * CSS property at-rule representation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSPropertyRule {
  /**
   * The css style sheet identifier (absent for user agent stylesheet and user-specified
   * stylesheet rules) this rule came from.
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
  /**
   * Parent stylesheet's origin.
   */
  readonly origin: StyleSheetOrigin
  /**
   * Associated property name.
   */
  readonly propertyName: Value
  /**
   * Associated style declaration.
   */
  readonly style: CSSStyle
}

/**
 * Schema for `CSSPropertyRule`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSPropertyRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: Schema.optional(DOM.StyleSheetId),
    origin: StyleSheetOrigin,
    propertyName: Value,
    style: CSSStyle
  }).annotate({ identifier: "CSS.CSSPropertyRule" })
) as any as Schema.Codec<CSSPropertyRule, unknown>

/**
 * CSS rule representation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSRule {
  /**
   * The css style sheet identifier (absent for user agent stylesheet and user-specified
   * stylesheet rules) this rule came from.
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
  /**
   * Rule selector data.
   */
  readonly selectorList: SelectorList
  /**
   * Array of selectors from ancestor style rules, sorted by distance from the current rule.
   */
  readonly nestingSelectors?: ReadonlyArray<string> | undefined
  /**
   * Parent stylesheet's origin.
   */
  readonly origin: StyleSheetOrigin
  /**
   * Associated style declaration.
   */
  readonly style: CSSStyle
  /**
   * The BackendNodeId of the DOM node that constitutes the origin tree scope of this rule.
   */
  readonly originTreeScopeNodeId?: DOM.BackendNodeId | undefined
  /**
   * Media list array (for rules involving media queries). The array enumerates media queries
   * starting with the innermost one, going outwards.
   */
  readonly media?: ReadonlyArray<CSSMedia> | undefined
  /**
   * Container query list array (for rules involving container queries).
   * The array enumerates container queries starting with the innermost one, going outwards.
   */
  readonly containerQueries?: ReadonlyArray<CSSContainerQuery> | undefined
  /**
   * \@supports CSS at-rule array.
   * The array enumerates \@supports at-rules starting with the innermost one, going outwards.
   */
  readonly supports?: ReadonlyArray<CSSSupports> | undefined
  /**
   * Cascade layer array. Contains the layer hierarchy that this rule belongs to starting
   * with the innermost layer and going outwards.
   */
  readonly layers?: ReadonlyArray<CSSLayer> | undefined
  /**
   * \@scope CSS at-rule array.
   * The array enumerates \@scope at-rules starting with the innermost one, going outwards.
   */
  readonly scopes?: ReadonlyArray<CSSScope> | undefined
  /**
   * The array keeps the types of ancestor CSSRules from the innermost going outwards.
   */
  readonly ruleTypes?: ReadonlyArray<CSSRuleType> | undefined
  /**
   * \@starting-style CSS at-rule array.
   * The array enumerates \@starting-style at-rules starting with the innermost one, going outwards.
   */
  readonly startingStyles?: ReadonlyArray<CSSStartingStyle> | undefined
  /**
   * \@navigation CSS at-rule array.
   * The array enumerates \@navigation at-rules starting with the innermost one, going outwards.
   */
  readonly navigations?: ReadonlyArray<CSSNavigation> | undefined
}

/**
 * Schema for `CSSRule`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: Schema.optional(DOM.StyleSheetId),
    selectorList: SelectorList,
    nestingSelectors: Schema.optional(Schema.Array(Schema.String)),
    origin: StyleSheetOrigin,
    style: CSSStyle,
    originTreeScopeNodeId: Schema.optional(DOM.BackendNodeId),
    media: Schema.optional(Schema.Array(CSSMedia)),
    containerQueries: Schema.optional(Schema.Array(CSSContainerQuery)),
    supports: Schema.optional(Schema.Array(CSSSupports)),
    layers: Schema.optional(Schema.Array(CSSLayer)),
    scopes: Schema.optional(Schema.Array(CSSScope)),
    ruleTypes: Schema.optional(Schema.Array(CSSRuleType)),
    startingStyles: Schema.optional(Schema.Array(CSSStartingStyle)),
    navigations: Schema.optional(Schema.Array(CSSNavigation))
  }).annotate({ identifier: "CSS.CSSRule" })
) as any as Schema.Codec<CSSRule, unknown>

/**
 * Enum indicating the type of a CSS rule, used to represent the order of a style rule's ancestors.
 * This list only contains rule types that are collected during the ancestor rule collection.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type CSSRuleType =
  | "MediaRule"
  | "SupportsRule"
  | "ContainerRule"
  | "LayerRule"
  | "ScopeRule"
  | "StyleRule"
  | "StartingStyleRule"
  | "NavigationRule"
  | (string & {})

/**
 * Schema for `CSSRuleType`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSRuleType = Schema.String as any as Schema.Codec<CSSRuleType>

/**
 * CSS Scope at-rule descriptor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSScope {
  /**
   * Scope rule text.
   */
  readonly text: string
  /**
   * The associated rule header range in the enclosing stylesheet (if
   * available).
   */
  readonly range?: SourceRange | undefined
  /**
   * Identifier of the stylesheet containing this object (if exists).
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
}

/**
 * Schema for `CSSScope`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSScope = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.String,
    range: Schema.optional(SourceRange),
    styleSheetId: Schema.optional(DOM.StyleSheetId)
  }).annotate({ identifier: "CSS.CSSScope" })
) as any as Schema.Codec<CSSScope>

/**
 * CSS Starting Style at-rule descriptor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSStartingStyle {
  /**
   * The associated rule header range in the enclosing stylesheet (if
   * available).
   */
  readonly range?: SourceRange | undefined
  /**
   * Identifier of the stylesheet containing this object (if exists).
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
}

/**
 * Schema for `CSSStartingStyle`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSStartingStyle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    range: Schema.optional(SourceRange),
    styleSheetId: Schema.optional(DOM.StyleSheetId)
  }).annotate({ identifier: "CSS.CSSStartingStyle" })
) as any as Schema.Codec<CSSStartingStyle>

/**
 * CSS style representation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSStyle {
  /**
   * The css style sheet identifier (absent for user agent stylesheet and user-specified
   * stylesheet rules) this rule came from.
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
  /**
   * CSS properties in the style.
   */
  readonly cssProperties: ReadonlyArray<CSSProperty>
  /**
   * Computed values for all shorthands found in the style.
   */
  readonly shorthandEntries: ReadonlyArray<ShorthandEntry>
  /**
   * Style declaration text (if available).
   */
  readonly cssText?: string | undefined
  /**
   * Style declaration range in the enclosing stylesheet (if available).
   */
  readonly range?: SourceRange | undefined
}

/**
 * Schema for `CSSStyle`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSStyle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: Schema.optional(DOM.StyleSheetId),
    cssProperties: Schema.Array(CSSProperty),
    shorthandEntries: Schema.Array(ShorthandEntry),
    cssText: Schema.optional(Schema.String),
    range: Schema.optional(SourceRange)
  }).annotate({ identifier: "CSS.CSSStyle" })
) as any as Schema.Codec<CSSStyle, unknown>

/**
 * CSS stylesheet metainformation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSStyleSheetHeader {
  /**
   * The stylesheet identifier.
   */
  readonly styleSheetId: DOM.StyleSheetId
  /**
   * Owner frame identifier.
   */
  readonly frameId: Page.FrameId
  /**
   * Stylesheet resource URL. Empty if this is a constructed stylesheet created using
   * new CSSStyleSheet() (but non-empty if this is a constructed stylesheet imported
   * as a CSS module script).
   */
  readonly sourceURL: string
  /**
   * URL of source map associated with the stylesheet (if any).
   */
  readonly sourceMapURL?: string | undefined
  /**
   * Stylesheet origin.
   */
  readonly origin: StyleSheetOrigin
  /**
   * Stylesheet title.
   */
  readonly title: string
  /**
   * The backend id for the owner node of the stylesheet.
   */
  readonly ownerNode?: DOM.BackendNodeId | undefined
  /**
   * Denotes whether the stylesheet is disabled.
   */
  readonly disabled: boolean
  /**
   * Whether the sourceURL field value comes from the sourceURL comment.
   */
  readonly hasSourceURL?: boolean | undefined
  /**
   * Whether this stylesheet is created for STYLE tag by parser. This flag is not set for
   * document.written STYLE tags.
   */
  readonly isInline: boolean
  /**
   * Whether this stylesheet is mutable. Inline stylesheets become mutable
   * after they have been modified via CSSOM API.
   * `<link>` element's stylesheets become mutable only if DevTools modifies them.
   * Constructed stylesheets (new CSSStyleSheet()) are mutable immediately after creation.
   */
  readonly isMutable: boolean
  /**
   * True if this stylesheet is created through new CSSStyleSheet() or imported as a
   * CSS module script.
   */
  readonly isConstructed: boolean
  /**
   * Line offset of the stylesheet within the resource (zero based).
   */
  readonly startLine: number
  /**
   * Column offset of the stylesheet within the resource (zero based).
   */
  readonly startColumn: number
  /**
   * Size of the content (in characters).
   */
  readonly length: number
  /**
   * Line offset of the end of the stylesheet within the resource (zero based).
   */
  readonly endLine: number
  /**
   * Column offset of the end of the stylesheet within the resource (zero based).
   */
  readonly endColumn: number
  /**
   * If the style sheet was loaded from a network resource, this indicates when the resource failed to load
   */
  readonly loadingFailed?: boolean | undefined
}

/**
 * Schema for `CSSStyleSheetHeader`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSStyleSheetHeader = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    frameId: Page.FrameId,
    sourceURL: Schema.String,
    sourceMapURL: Schema.optional(Schema.String),
    origin: StyleSheetOrigin,
    title: Schema.String,
    ownerNode: Schema.optional(DOM.BackendNodeId),
    disabled: Schema.Boolean,
    hasSourceURL: Schema.optional(Schema.Boolean),
    isInline: Schema.Boolean,
    isMutable: Schema.Boolean,
    isConstructed: Schema.Boolean,
    startLine: Schema.Number,
    startColumn: Schema.Number,
    length: Schema.Number,
    endLine: Schema.Number,
    endColumn: Schema.Number,
    loadingFailed: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "CSS.CSSStyleSheetHeader" })
) as any as Schema.Codec<CSSStyleSheetHeader>

/**
 * CSS Supports at-rule descriptor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSSupports {
  /**
   * Supports rule text.
   */
  readonly text: string
  /**
   * Whether the supports condition is satisfied.
   */
  readonly active: boolean
  /**
   * The associated rule header range in the enclosing stylesheet (if
   * available).
   */
  readonly range?: SourceRange | undefined
  /**
   * Identifier of the stylesheet containing this object (if exists).
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
}

/**
 * Schema for `CSSSupports`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSSupports = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.String,
    active: Schema.Boolean,
    range: Schema.optional(SourceRange),
    styleSheetId: Schema.optional(DOM.StyleSheetId)
  }).annotate({ identifier: "CSS.CSSSupports" })
) as any as Schema.Codec<CSSSupports>

/**
 * CSS try rule representation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CSSTryRule {
  /**
   * The css style sheet identifier (absent for user agent stylesheet and user-specified
   * stylesheet rules) this rule came from.
   */
  readonly styleSheetId?: DOM.StyleSheetId | undefined
  /**
   * Parent stylesheet's origin.
   */
  readonly origin: StyleSheetOrigin
  /**
   * Associated style declaration.
   */
  readonly style: CSSStyle
}

/**
 * Schema for `CSSTryRule`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CSSTryRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: Schema.optional(DOM.StyleSheetId),
    origin: StyleSheetOrigin,
    style: CSSStyle
  }).annotate({ identifier: "CSS.CSSTryRule" })
) as any as Schema.Codec<CSSTryRule, unknown>

/**
 * `ComputedStyleExtraFields`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ComputedStyleExtraFields {
  /**
   * Returns whether or not this node is being rendered with base appearance,
   * which happens when it has its appearance property set to base/base-select
   * or it is in the subtree of an element being rendered with base appearance.
   */
  readonly isAppearanceBase: boolean
}

/**
 * Schema for `ComputedStyleExtraFields`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ComputedStyleExtraFields = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    isAppearanceBase: Schema.Boolean
  }).annotate({ identifier: "CSS.ComputedStyleExtraFields" })
) as any as Schema.Codec<ComputedStyleExtraFields>

/**
 * Properties of a web font: https://www.w3.org/TR/2008/REC-CSS2-20080411/fonts.html#font-descriptions
 * and additional information such as platformFontFamily and fontVariationAxes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FontFace {
  /**
   * The font-family.
   */
  readonly fontFamily: string
  /**
   * The font-style.
   */
  readonly fontStyle: string
  /**
   * The font-variant.
   */
  readonly fontVariant: string
  /**
   * The font-weight.
   */
  readonly fontWeight: string
  /**
   * The font-stretch.
   */
  readonly fontStretch: string
  /**
   * The font-display.
   */
  readonly fontDisplay: string
  /**
   * The unicode-range.
   */
  readonly unicodeRange: string
  /**
   * The src.
   */
  readonly src: string
  /**
   * The resolved platform font family
   */
  readonly platformFontFamily: string
  /**
   * Available variation settings (a.k.a. "axes").
   */
  readonly fontVariationAxes?: ReadonlyArray<FontVariationAxis> | undefined
}

/**
 * Schema for `FontFace`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FontFace = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fontFamily: Schema.String,
    fontStyle: Schema.String,
    fontVariant: Schema.String,
    fontWeight: Schema.String,
    fontStretch: Schema.String,
    fontDisplay: Schema.String,
    unicodeRange: Schema.String,
    src: Schema.String,
    platformFontFamily: Schema.String,
    fontVariationAxes: Schema.optional(Schema.Array(FontVariationAxis))
  }).annotate({ identifier: "CSS.FontFace" })
) as any as Schema.Codec<FontFace>

/**
 * Information about font variation axes for variable fonts
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FontVariationAxis {
  /**
   * The font-variation-setting tag (a.k.a. "axis tag").
   */
  readonly tag: string
  /**
   * Human-readable variation name in the default language (normally, "en").
   */
  readonly name: string
  /**
   * The minimum value (inclusive) the font supports for this tag.
   */
  readonly minValue: number
  /**
   * The maximum value (inclusive) the font supports for this tag.
   */
  readonly maxValue: number
  /**
   * The default value.
   */
  readonly defaultValue: number
}

/**
 * Schema for `FontVariationAxis`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FontVariationAxis = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    tag: Schema.String,
    name: Schema.String,
    minValue: Schema.Number,
    maxValue: Schema.Number,
    defaultValue: Schema.Number
  }).annotate({ identifier: "CSS.FontVariationAxis" })
) as any as Schema.Codec<FontVariationAxis>

/**
 * Inherited CSS style collection for animated styles from ancestor node.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InheritedAnimatedStyleEntry {
  /**
   * Styles coming from the animations of the ancestor, if any, in the style inheritance chain.
   */
  readonly animationStyles?: ReadonlyArray<CSSAnimationStyle> | undefined
  /**
   * The style coming from the transitions of the ancestor, if any, in the style inheritance chain.
   */
  readonly transitionsStyle?: CSSStyle | undefined
}

/**
 * Schema for `InheritedAnimatedStyleEntry`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InheritedAnimatedStyleEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationStyles: Schema.optional(Schema.Array(CSSAnimationStyle)),
    transitionsStyle: Schema.optional(CSSStyle)
  }).annotate({ identifier: "CSS.InheritedAnimatedStyleEntry" })
) as any as Schema.Codec<InheritedAnimatedStyleEntry, unknown>

/**
 * Inherited pseudo element matches from pseudos of an ancestor node.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InheritedPseudoElementMatches {
  /**
   * Matches of pseudo styles from the pseudos of an ancestor node.
   */
  readonly pseudoElements: ReadonlyArray<PseudoElementMatches>
}

/**
 * Schema for `InheritedPseudoElementMatches`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InheritedPseudoElementMatches = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pseudoElements: Schema.Array(PseudoElementMatches)
  }).annotate({ identifier: "CSS.InheritedPseudoElementMatches" })
) as any as Schema.Codec<InheritedPseudoElementMatches, unknown>

/**
 * Inherited CSS rule collection from ancestor node.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface InheritedStyleEntry {
  /**
   * The ancestor node's inline style, if any, in the style inheritance chain.
   */
  readonly inlineStyle?: CSSStyle | undefined
  /**
   * Matches of CSS rules matching the ancestor node in the style inheritance chain.
   */
  readonly matchedCSSRules: ReadonlyArray<RuleMatch>
}

/**
 * Schema for `InheritedStyleEntry`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const InheritedStyleEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    inlineStyle: Schema.optional(CSSStyle),
    matchedCSSRules: Schema.Array(RuleMatch)
  }).annotate({ identifier: "CSS.InheritedStyleEntry" })
) as any as Schema.Codec<InheritedStyleEntry, unknown>

/**
 * Media query descriptor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface MediaQuery {
  /**
   * Array of media query expressions.
   */
  readonly expressions: ReadonlyArray<MediaQueryExpression>
  /**
   * Whether the media query condition is satisfied.
   */
  readonly active: boolean
}

/**
 * Schema for `MediaQuery`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const MediaQuery = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    expressions: Schema.Array(MediaQueryExpression),
    active: Schema.Boolean
  }).annotate({ identifier: "CSS.MediaQuery" })
) as any as Schema.Codec<MediaQuery>

/**
 * Media query expression descriptor.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface MediaQueryExpression {
  /**
   * Media query expression value.
   */
  readonly value: number
  /**
   * Media query expression units.
   */
  readonly unit: string
  /**
   * Media query expression feature.
   */
  readonly feature: string
  /**
   * The associated range of the value text in the enclosing stylesheet (if available).
   */
  readonly valueRange?: SourceRange | undefined
  /**
   * Computed length of media query expression (if applicable).
   */
  readonly computedLength?: number | undefined
}

/**
 * Schema for `MediaQueryExpression`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const MediaQueryExpression = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    value: Schema.Number,
    unit: Schema.String,
    feature: Schema.String,
    valueRange: Schema.optional(SourceRange),
    computedLength: Schema.optional(Schema.Number)
  }).annotate({ identifier: "CSS.MediaQueryExpression" })
) as any as Schema.Codec<MediaQueryExpression>

/**
 * Information about amount of glyphs that were rendered with given font.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PlatformFontUsage {
  /**
   * Font's family name reported by platform.
   */
  readonly familyName: string
  /**
   * Font's PostScript name reported by platform.
   */
  readonly postScriptName: string
  /**
   * Indicates if the font was downloaded or resolved locally.
   */
  readonly isCustomFont: boolean
  /**
   * Amount of glyphs that were rendered with this font.
   */
  readonly glyphCount: number
}

/**
 * Schema for `PlatformFontUsage`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PlatformFontUsage = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    familyName: Schema.String,
    postScriptName: Schema.String,
    isCustomFont: Schema.Boolean,
    glyphCount: Schema.Number
  }).annotate({ identifier: "CSS.PlatformFontUsage" })
) as any as Schema.Codec<PlatformFontUsage>

/**
 * CSS rule collection for a single pseudo style.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface PseudoElementMatches {
  /**
   * Pseudo element type.
   */
  readonly pseudoType: DOM.PseudoType
  /**
   * Pseudo element custom ident.
   */
  readonly pseudoIdentifier?: string | undefined
  /**
   * Matches of CSS rules applicable to the pseudo style.
   */
  readonly matches: ReadonlyArray<RuleMatch>
}

/**
 * Schema for `PseudoElementMatches`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const PseudoElementMatches = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pseudoType: DOM.PseudoType,
    pseudoIdentifier: Schema.optional(Schema.String),
    matches: Schema.Array(RuleMatch)
  }).annotate({ identifier: "CSS.PseudoElementMatches" })
) as any as Schema.Codec<PseudoElementMatches, unknown>

/**
 * Match data for a CSS rule.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RuleMatch {
  /**
   * CSS rule in the match.
   */
  readonly rule: CSSRule
  /**
   * Matching selector indices in the rule's selectorList selectors (0-based).
   */
  readonly matchingSelectors: ReadonlyArray<number>
}

/**
 * Schema for `RuleMatch`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RuleMatch = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rule: CSSRule,
    matchingSelectors: Schema.Array(Schema.Int)
  }).annotate({ identifier: "CSS.RuleMatch" })
) as any as Schema.Codec<RuleMatch, unknown>

/**
 * CSS coverage information.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface RuleUsage {
  /**
   * The css style sheet identifier (absent for user agent stylesheet and user-specified
   * stylesheet rules) this rule came from.
   */
  readonly styleSheetId: DOM.StyleSheetId
  /**
   * Offset of the start of the rule (including selector) from the beginning of the stylesheet.
   */
  readonly startOffset: number
  /**
   * Offset of the end of the rule body from the beginning of the stylesheet.
   */
  readonly endOffset: number
  /**
   * Indicates whether the rule was actually used by some element in the page.
   */
  readonly used: boolean
}

/**
 * Schema for `RuleUsage`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const RuleUsage = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    startOffset: Schema.Number,
    endOffset: Schema.Number,
    used: Schema.Boolean
  }).annotate({ identifier: "CSS.RuleUsage" })
) as any as Schema.Codec<RuleUsage>

/**
 * Selector list data.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SelectorList {
  /**
   * Selectors in the list.
   */
  readonly selectors: ReadonlyArray<Value>
  /**
   * Rule selector text.
   */
  readonly text: string
}

/**
 * Schema for `SelectorList`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SelectorList = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    selectors: Schema.Array(Value),
    text: Schema.String
  }).annotate({ identifier: "CSS.SelectorList" })
) as any as Schema.Codec<SelectorList>

/**
 * `ShorthandEntry`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ShorthandEntry {
  /**
   * Shorthand name.
   */
  readonly name: string
  /**
   * Shorthand value.
   */
  readonly value: string
  /**
   * Whether the property has "!important" annotation (implies `false` if absent).
   */
  readonly important?: boolean | undefined
}

/**
 * Schema for `ShorthandEntry`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ShorthandEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String,
    important: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "CSS.ShorthandEntry" })
) as any as Schema.Codec<ShorthandEntry>

/**
 * Text range within a resource. All numbers are zero-based.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SourceRange {
  /**
   * Start line of range.
   */
  readonly startLine: number
  /**
   * Start column of range (inclusive).
   */
  readonly startColumn: number
  /**
   * End line of range
   */
  readonly endLine: number
  /**
   * End column of range (exclusive).
   */
  readonly endColumn: number
}

/**
 * Schema for `SourceRange`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SourceRange = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    startLine: Schema.Int,
    startColumn: Schema.Int,
    endLine: Schema.Int,
    endColumn: Schema.Int
  }).annotate({ identifier: "CSS.SourceRange" })
) as any as Schema.Codec<SourceRange>

/**
 * Specificity:
 * https://drafts.csswg.org/selectors/#specificity-rules
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Specificity {
  /**
   * The a component, which represents the number of ID selectors.
   */
  readonly a: number
  /**
   * The b component, which represents the number of class selectors, attributes selectors, and
   * pseudo-classes.
   */
  readonly b: number
  /**
   * The c component, which represents the number of type selectors and pseudo-elements.
   */
  readonly c: number
  /**
   * Per-simple-selector contributions used to explain this specificity.
   */
  readonly components?: ReadonlyArray<SpecificityComponent> | undefined
}

/**
 * Schema for `Specificity`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Specificity = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    a: Schema.Int,
    b: Schema.Int,
    c: Schema.Int,
    components: Schema.optional(Schema.Array(SpecificityComponent))
  }).annotate({ identifier: "CSS.Specificity" })
) as any as Schema.Codec<Specificity>

/**
 * Contribution of an individual simple selector to specificity.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SpecificityComponent {
  /**
   * The simple selector text that contributes to specificity.
   */
  readonly text: string
  /**
   * The a component contribution.
   */
  readonly a: number
  /**
   * The b component contribution.
   */
  readonly b: number
  /**
   * The c component contribution.
   */
  readonly c: number
}

/**
 * Schema for `SpecificityComponent`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SpecificityComponent = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.String,
    a: Schema.Int,
    b: Schema.Int,
    c: Schema.Int
  }).annotate({ identifier: "CSS.SpecificityComponent" })
) as any as Schema.Codec<SpecificityComponent>

/**
 * A descriptor of operation to mutate style declaration text.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StyleDeclarationEdit {
  /**
   * The css style sheet identifier.
   */
  readonly styleSheetId: DOM.StyleSheetId
  /**
   * The range of the style text in the enclosing stylesheet.
   */
  readonly range: SourceRange
  /**
   * New style text.
   */
  readonly text: string
}

/**
 * Schema for `StyleDeclarationEdit`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StyleDeclarationEdit = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    range: SourceRange,
    text: Schema.String
  }).annotate({ identifier: "CSS.StyleDeclarationEdit" })
) as any as Schema.Codec<StyleDeclarationEdit>

/**
 * Stylesheet type: "injected" for stylesheets injected via extension, "user-agent" for user-agent
 * stylesheets, "inspector" for stylesheets created by the inspector (i.e. those holding the "via
 * inspector" rules), "regular" for regular stylesheets.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type StyleSheetOrigin =
  | "injected"
  | "user-agent"
  | "inspector"
  | "regular"
  | (string & {})

/**
 * Schema for `StyleSheetOrigin`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StyleSheetOrigin = Schema.String as any as Schema.Codec<StyleSheetOrigin>

/**
 * Data for a simple selector (these are delimited by commas in a selector list).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Value {
  /**
   * Value text.
   */
  readonly text: string
  /**
   * Value range in the underlying resource (if available).
   */
  readonly range?: SourceRange | undefined
  /**
   * Specificity of the selector.
   */
  readonly specificity?: Specificity | undefined
}

/**
 * Schema for `Value`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Value = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.String,
    range: Schema.optional(SourceRange),
    specificity: Schema.optional(Specificity)
  }).annotate({ identifier: "CSS.Value" })
) as any as Schema.Codec<Value>

/**
 * Inserts a new rule with the given `ruleText` in a stylesheet with given `styleSheetId`, at the
 * position specified by `location`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddRuleParams {
  /**
   * The css style sheet identifier where a new rule should be inserted.
   */
  readonly styleSheetId: DOM.StyleSheetId
  /**
   * The text of a new rule.
   */
  readonly ruleText: string
  /**
   * Text position of a new rule in the target style sheet.
   */
  readonly location: SourceRange
  /**
   * NodeId for the DOM node in whose context custom property declarations for registered properties should be
   * validated. If omitted, declarations in the new rule text can only be validated statically, which may produce
   * incorrect results if the declaration contains a var() for example.
   */
  readonly nodeForPropertySyntaxValidation?: DOM.NodeId | undefined
}

/**
 * Schema for `AddRuleParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddRuleParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    ruleText: Schema.String,
    location: SourceRange,
    nodeForPropertySyntaxValidation: Schema.optional(DOM.NodeId)
  }).annotate({ identifier: "CSS.AddRuleParams" })
) as any as Schema.Codec<AddRuleParams>

/**
 * Inserts a new rule with the given `ruleText` in a stylesheet with given `styleSheetId`, at the
 * position specified by `location`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface AddRuleResult {
  /**
   * The newly created rule.
   */
  readonly rule: CSSRule
}

/**
 * Schema for `AddRuleResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const AddRuleResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rule: CSSRule
  }).annotate({ identifier: "CSS.AddRuleResult" })
) as any as Schema.Codec<AddRuleResult, unknown>

/**
 * Returns all class names from specified stylesheet.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CollectClassNamesParams {
  readonly styleSheetId: DOM.StyleSheetId
}

/**
 * Schema for `CollectClassNamesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CollectClassNamesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId
  }).annotate({ identifier: "CSS.CollectClassNamesParams" })
) as any as Schema.Codec<CollectClassNamesParams>

/**
 * Returns all class names from specified stylesheet.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CollectClassNamesResult {
  /**
   * Class name list.
   */
  readonly classNames: ReadonlyArray<string>
}

/**
 * Schema for `CollectClassNamesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CollectClassNamesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    classNames: Schema.Array(Schema.String)
  }).annotate({ identifier: "CSS.CollectClassNamesResult" })
) as any as Schema.Codec<CollectClassNamesResult>

/**
 * `computedStyleUpdated.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ComputedStyleUpdatedParams {
  /**
   * The node id that has updated computed styles.
   */
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `ComputedStyleUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ComputedStyleUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "CSS.ComputedStyleUpdatedParams" })
) as any as Schema.Codec<ComputedStyleUpdatedParams>

/**
 * Creates a new special "via-inspector" stylesheet in the frame with given `frameId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CreateStyleSheetParams {
  /**
   * Identifier of the frame where "via-inspector" stylesheet should be created.
   */
  readonly frameId: Page.FrameId
  /**
   * If true, creates a new stylesheet for every call. If false,
   * returns a stylesheet previously created by a call with force=false
   * for the frame's document if it exists or creates a new stylesheet
   * (default: false).
   */
  readonly force?: boolean | undefined
}

/**
 * Schema for `CreateStyleSheetParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CreateStyleSheetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Page.FrameId,
    force: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "CSS.CreateStyleSheetParams" })
) as any as Schema.Codec<CreateStyleSheetParams>

/**
 * Creates a new special "via-inspector" stylesheet in the frame with given `frameId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CreateStyleSheetResult {
  /**
   * Identifier of the created "via-inspector" stylesheet.
   */
  readonly styleSheetId: DOM.StyleSheetId
}

/**
 * Schema for `CreateStyleSheetResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CreateStyleSheetResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId
  }).annotate({ identifier: "CSS.CreateStyleSheetResult" })
) as any as Schema.Codec<CreateStyleSheetResult>

/**
 * Fires whenever a web font is updated.  A non-empty font parameter indicates a successfully loaded
 * web font.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface FontsUpdatedParams {
  /**
   * The web font that has loaded.
   */
  readonly font?: FontFace | undefined
}

/**
 * Schema for `FontsUpdatedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const FontsUpdatedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    font: Schema.optional(FontFace)
  }).annotate({ identifier: "CSS.FontsUpdatedParams" })
) as any as Schema.Codec<FontsUpdatedParams>

/**
 * Ensures that the given node will have specified pseudo-classes whenever its style is computed by
 * the browser.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ForcePseudoStateParams {
  /**
   * The element id for which to force the pseudo state.
   */
  readonly nodeId: DOM.NodeId
  /**
   * Element pseudo classes to force when computing the element's style.
   */
  readonly forcedPseudoClasses: ReadonlyArray<string>
}

/**
 * Schema for `ForcePseudoStateParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ForcePseudoStateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId,
    forcedPseudoClasses: Schema.Array(Schema.String)
  }).annotate({ identifier: "CSS.ForcePseudoStateParams" })
) as any as Schema.Codec<ForcePseudoStateParams>

/**
 * Ensures that the given node is in its starting-style state.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ForceStartingStyleParams {
  /**
   * The element id for which to force the starting-style state.
   */
  readonly nodeId: DOM.NodeId
  /**
   * Boolean indicating if this is on or off.
   */
  readonly forced: boolean
}

/**
 * Schema for `ForceStartingStyleParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ForceStartingStyleParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId,
    forced: Schema.Boolean
  }).annotate({ identifier: "CSS.ForceStartingStyleParams" })
) as any as Schema.Codec<ForceStartingStyleParams>

/**
 * Returns the styles coming from animations & transitions
 * including the animation & transition styles coming from inheritance chain.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAnimatedStylesForNodeParams {
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GetAnimatedStylesForNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAnimatedStylesForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "CSS.GetAnimatedStylesForNodeParams" })
) as any as Schema.Codec<GetAnimatedStylesForNodeParams>

/**
 * Returns the styles coming from animations & transitions
 * including the animation & transition styles coming from inheritance chain.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAnimatedStylesForNodeResult {
  /**
   * Styles coming from animations.
   */
  readonly animationStyles?: ReadonlyArray<CSSAnimationStyle> | undefined
  /**
   * Style coming from transitions.
   */
  readonly transitionsStyle?: CSSStyle | undefined
  /**
   * Inherited style entries for animationsStyle and transitionsStyle from
   * the inheritance chain of the element.
   */
  readonly inherited?: ReadonlyArray<InheritedAnimatedStyleEntry> | undefined
}

/**
 * Schema for `GetAnimatedStylesForNodeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAnimatedStylesForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    animationStyles: Schema.optional(Schema.Array(CSSAnimationStyle)),
    transitionsStyle: Schema.optional(CSSStyle),
    inherited: Schema.optional(Schema.Array(InheritedAnimatedStyleEntry))
  }).annotate({ identifier: "CSS.GetAnimatedStylesForNodeResult" })
) as any as Schema.Codec<GetAnimatedStylesForNodeResult, unknown>

/**
 * `getBackgroundColors.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetBackgroundColorsParams {
  /**
   * Id of the node to get background colors for.
   */
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GetBackgroundColorsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetBackgroundColorsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "CSS.GetBackgroundColorsParams" })
) as any as Schema.Codec<GetBackgroundColorsParams>

/**
 * `getBackgroundColors.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetBackgroundColorsResult {
  /**
   * The range of background colors behind this element, if it contains any visible text. If no
   * visible text is present, this will be undefined. In the case of a flat background color,
   * this will consist of simply that color. In the case of a gradient, this will consist of each
   * of the color stops. For anything more complicated, this will be an empty array. Images will
   * be ignored (as if the image had failed to load).
   */
  readonly backgroundColors?: ReadonlyArray<string> | undefined
  /**
   * The computed font size for this node, as a CSS computed value string (e.g. '12px').
   */
  readonly computedFontSize?: string | undefined
  /**
   * The computed font weight for this node, as a CSS computed value string (e.g. 'normal' or
   * '100').
   */
  readonly computedFontWeight?: string | undefined
}

/**
 * Schema for `GetBackgroundColorsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetBackgroundColorsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    backgroundColors: Schema.optional(Schema.Array(Schema.String)),
    computedFontSize: Schema.optional(Schema.String),
    computedFontWeight: Schema.optional(Schema.String)
  }).annotate({ identifier: "CSS.GetBackgroundColorsResult" })
) as any as Schema.Codec<GetBackgroundColorsResult>

/**
 * Returns the computed style for a DOM node identified by `nodeId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetComputedStyleForNodeParams {
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GetComputedStyleForNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetComputedStyleForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "CSS.GetComputedStyleForNodeParams" })
) as any as Schema.Codec<GetComputedStyleForNodeParams>

/**
 * Returns the computed style for a DOM node identified by `nodeId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetComputedStyleForNodeResult {
  /**
   * Computed style for the specified DOM node.
   */
  readonly computedStyle: ReadonlyArray<CSSComputedStyleProperty>
  /**
   * A list of non-standard "extra fields" which blink stores alongside each
   * computed style.
   */
  readonly extraFields?: ComputedStyleExtraFields | undefined
}

/**
 * Schema for `GetComputedStyleForNodeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetComputedStyleForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    computedStyle: Schema.Array(CSSComputedStyleProperty),
    extraFields: Schema.optional(ComputedStyleExtraFields)
  }).annotate({ identifier: "CSS.GetComputedStyleForNodeResult" })
) as any as Schema.Codec<GetComputedStyleForNodeResult>

/**
 * Returns the values of the default UA-defined environment variables used in env()
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetEnvironmentVariablesResult {
  readonly environmentVariables: { readonly [key: string]: unknown }
}

/**
 * Schema for `GetEnvironmentVariablesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetEnvironmentVariablesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    environmentVariables: Schema.Record(Schema.String, Schema.Unknown)
  }).annotate({ identifier: "CSS.GetEnvironmentVariablesResult" })
) as any as Schema.Codec<GetEnvironmentVariablesResult>

/**
 * Returns the styles defined inline (explicitly in the "style" attribute and implicitly, using DOM
 * attributes) for a DOM node identified by `nodeId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetInlineStylesForNodeParams {
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GetInlineStylesForNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetInlineStylesForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "CSS.GetInlineStylesForNodeParams" })
) as any as Schema.Codec<GetInlineStylesForNodeParams>

/**
 * Returns the styles defined inline (explicitly in the "style" attribute and implicitly, using DOM
 * attributes) for a DOM node identified by `nodeId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetInlineStylesForNodeResult {
  /**
   * Inline style for the specified DOM node.
   */
  readonly inlineStyle?: CSSStyle | undefined
  /**
   * Attribute-defined element style (e.g. resulting from "width=20 height=100%").
   */
  readonly attributesStyle?: CSSStyle | undefined
}

/**
 * Schema for `GetInlineStylesForNodeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetInlineStylesForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    inlineStyle: Schema.optional(CSSStyle),
    attributesStyle: Schema.optional(CSSStyle)
  }).annotate({ identifier: "CSS.GetInlineStylesForNodeResult" })
) as any as Schema.Codec<GetInlineStylesForNodeResult, unknown>

/**
 * Returns all layers parsed by the rendering engine for the tree scope of a node.
 * Given a DOM element identified by nodeId, getLayersForNode returns the root
 * layer for the nearest ancestor document or shadow root. The layer root contains
 * the full layer tree for the tree scope and their ordering.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetLayersForNodeParams {
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GetLayersForNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetLayersForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "CSS.GetLayersForNodeParams" })
) as any as Schema.Codec<GetLayersForNodeParams>

/**
 * Returns all layers parsed by the rendering engine for the tree scope of a node.
 * Given a DOM element identified by nodeId, getLayersForNode returns the root
 * layer for the nearest ancestor document or shadow root. The layer root contains
 * the full layer tree for the tree scope and their ordering.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetLayersForNodeResult {
  readonly rootLayer: CSSLayerData
}

/**
 * Schema for `GetLayersForNodeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetLayersForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rootLayer: CSSLayerData
  }).annotate({ identifier: "CSS.GetLayersForNodeResult" })
) as any as Schema.Codec<GetLayersForNodeResult, unknown>

/**
 * Given a CSS selector text and a style sheet ID, getLocationForSelector
 * returns an array of locations of the CSS selector in the style sheet.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetLocationForSelectorParams {
  readonly styleSheetId: DOM.StyleSheetId
  readonly selectorText: string
}

/**
 * Schema for `GetLocationForSelectorParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetLocationForSelectorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    selectorText: Schema.String
  }).annotate({ identifier: "CSS.GetLocationForSelectorParams" })
) as any as Schema.Codec<GetLocationForSelectorParams>

/**
 * Given a CSS selector text and a style sheet ID, getLocationForSelector
 * returns an array of locations of the CSS selector in the style sheet.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetLocationForSelectorResult {
  readonly ranges: ReadonlyArray<SourceRange>
}

/**
 * Schema for `GetLocationForSelectorResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetLocationForSelectorResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ranges: Schema.Array(SourceRange)
  }).annotate({ identifier: "CSS.GetLocationForSelectorResult" })
) as any as Schema.Codec<GetLocationForSelectorResult>

/**
 * `getLonghandProperties.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetLonghandPropertiesParams {
  readonly shorthandName: string
  readonly value: string
}

/**
 * Schema for `GetLonghandPropertiesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetLonghandPropertiesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    shorthandName: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "CSS.GetLonghandPropertiesParams" })
) as any as Schema.Codec<GetLonghandPropertiesParams>

/**
 * `getLonghandProperties.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetLonghandPropertiesResult {
  readonly longhandProperties: ReadonlyArray<CSSProperty>
}

/**
 * Schema for `GetLonghandPropertiesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetLonghandPropertiesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    longhandProperties: Schema.Array(CSSProperty)
  }).annotate({ identifier: "CSS.GetLonghandPropertiesResult" })
) as any as Schema.Codec<GetLonghandPropertiesResult, unknown>

/**
 * Returns requested styles for a DOM node identified by `nodeId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetMatchedStylesForNodeParams {
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GetMatchedStylesForNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetMatchedStylesForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "CSS.GetMatchedStylesForNodeParams" })
) as any as Schema.Codec<GetMatchedStylesForNodeParams>

/**
 * Returns requested styles for a DOM node identified by `nodeId`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetMatchedStylesForNodeResult {
  /**
   * Inline style for the specified DOM node.
   */
  readonly inlineStyle?: CSSStyle | undefined
  /**
   * Attribute-defined element style (e.g. resulting from "width=20 height=100%").
   */
  readonly attributesStyle?: CSSStyle | undefined
  /**
   * CSS rules matching this node, from all applicable stylesheets.
   */
  readonly matchedCSSRules?: ReadonlyArray<RuleMatch> | undefined
  /**
   * Pseudo style matches for this node.
   */
  readonly pseudoElements?: ReadonlyArray<PseudoElementMatches> | undefined
  /**
   * A chain of inherited styles (from the immediate node parent up to the DOM tree root).
   */
  readonly inherited?: ReadonlyArray<InheritedStyleEntry> | undefined
  /**
   * A chain of inherited pseudo element styles (from the immediate node parent up to the DOM tree root).
   */
  readonly inheritedPseudoElements?: ReadonlyArray<InheritedPseudoElementMatches> | undefined
  /**
   * A list of CSS keyframed animations matching this node.
   */
  readonly cssKeyframesRules?: ReadonlyArray<CSSKeyframesRule> | undefined
  /**
   * A list of CSS \@position-try rules matching this node, based on the position-try-fallbacks property.
   */
  readonly cssPositionTryRules?: ReadonlyArray<CSSPositionTryRule> | undefined
  /**
   * Index of the active fallback in the applied position-try-fallback property,
   * will not be set if there is no active position-try fallback.
   */
  readonly activePositionFallbackIndex?: number | undefined
  /**
   * A list of CSS at-property rules matching this node.
   */
  readonly cssPropertyRules?: ReadonlyArray<CSSPropertyRule> | undefined
  /**
   * A list of CSS property registrations matching this node.
   */
  readonly cssPropertyRegistrations?: ReadonlyArray<CSSPropertyRegistration> | undefined
  /**
   * A list of simple \@rules matching this node or its pseudo-elements.
   */
  readonly cssAtRules?: ReadonlyArray<CSSAtRule> | undefined
  /**
   * Id of the first parent element that does not have display: contents.
   */
  readonly parentLayoutNodeId?: DOM.NodeId | undefined
  /**
   * A list of CSS at-function rules referenced by styles of this node.
   */
  readonly cssFunctionRules?: ReadonlyArray<CSSFunctionRule> | undefined
}

/**
 * Schema for `GetMatchedStylesForNodeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetMatchedStylesForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    inlineStyle: Schema.optional(CSSStyle),
    attributesStyle: Schema.optional(CSSStyle),
    matchedCSSRules: Schema.optional(Schema.Array(RuleMatch)),
    pseudoElements: Schema.optional(Schema.Array(PseudoElementMatches)),
    inherited: Schema.optional(Schema.Array(InheritedStyleEntry)),
    inheritedPseudoElements: Schema.optional(Schema.Array(InheritedPseudoElementMatches)),
    cssKeyframesRules: Schema.optional(Schema.Array(CSSKeyframesRule)),
    cssPositionTryRules: Schema.optional(Schema.Array(CSSPositionTryRule)),
    activePositionFallbackIndex: Schema.optional(Schema.Int),
    cssPropertyRules: Schema.optional(Schema.Array(CSSPropertyRule)),
    cssPropertyRegistrations: Schema.optional(Schema.Array(CSSPropertyRegistration)),
    cssAtRules: Schema.optional(Schema.Array(CSSAtRule)),
    parentLayoutNodeId: Schema.optional(DOM.NodeId),
    cssFunctionRules: Schema.optional(Schema.Array(CSSFunctionRule))
  }).annotate({ identifier: "CSS.GetMatchedStylesForNodeResult" })
) as any as Schema.Codec<GetMatchedStylesForNodeResult, unknown>

/**
 * Returns all media queries parsed by the rendering engine.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetMediaQueriesResult {
  readonly medias: ReadonlyArray<CSSMedia>
}

/**
 * Schema for `GetMediaQueriesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetMediaQueriesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    medias: Schema.Array(CSSMedia)
  }).annotate({ identifier: "CSS.GetMediaQueriesResult" })
) as any as Schema.Codec<GetMediaQueriesResult>

/**
 * Requests information about platform fonts which we used to render child TextNodes in the given
 * node.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetPlatformFontsForNodeParams {
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GetPlatformFontsForNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetPlatformFontsForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "CSS.GetPlatformFontsForNodeParams" })
) as any as Schema.Codec<GetPlatformFontsForNodeParams>

/**
 * Requests information about platform fonts which we used to render child TextNodes in the given
 * node.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetPlatformFontsForNodeResult {
  /**
   * Usage statistics for every employed platform font.
   */
  readonly fonts: ReadonlyArray<PlatformFontUsage>
}

/**
 * Schema for `GetPlatformFontsForNodeResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetPlatformFontsForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fonts: Schema.Array(PlatformFontUsage)
  }).annotate({ identifier: "CSS.GetPlatformFontsForNodeResult" })
) as any as Schema.Codec<GetPlatformFontsForNodeResult>

/**
 * Returns the current textual content for a stylesheet.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetStyleSheetTextParams {
  readonly styleSheetId: DOM.StyleSheetId
}

/**
 * Schema for `GetStyleSheetTextParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetStyleSheetTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId
  }).annotate({ identifier: "CSS.GetStyleSheetTextParams" })
) as any as Schema.Codec<GetStyleSheetTextParams>

/**
 * Returns the current textual content for a stylesheet.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetStyleSheetTextResult {
  /**
   * The stylesheet text.
   */
  readonly text: string
}

/**
 * Schema for `GetStyleSheetTextResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetStyleSheetTextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.String
  }).annotate({ identifier: "CSS.GetStyleSheetTextResult" })
) as any as Schema.Codec<GetStyleSheetTextResult>

/**
 * Resolve the specified values in the context of the provided element.
 * For example, a value of '1em' is evaluated according to the computed
 * 'font-size' of the element and a value 'calc(1px + 2px)' will be
 * resolved to '3px'.
 * If the `propertyName` was specified the `values` are resolved as if
 * they were property's declaration. If a value cannot be parsed according
 * to the provided property syntax, the value is parsed using combined
 * syntax as if null `propertyName` was provided. If the value cannot be
 * resolved even then, return the provided value without any changes.
 * Note: this function currently does not resolve CSS random() function,
 * it returns unmodified random() function parts.`
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ResolveValuesParams {
  /**
   * Cascade-dependent keywords (revert/revert-layer) do not work.
   */
  readonly values: ReadonlyArray<string>
  /**
   * Id of the node in whose context the expression is evaluated
   */
  readonly nodeId: DOM.NodeId
  /**
   * Only longhands and custom property names are accepted.
   */
  readonly propertyName?: string | undefined
  /**
   * Pseudo element type, only works for pseudo elements that generate
   * elements in the tree, such as ::before and ::after.
   */
  readonly pseudoType?: DOM.PseudoType | undefined
  /**
   * Pseudo element custom ident.
   */
  readonly pseudoIdentifier?: string | undefined
}

/**
 * Schema for `ResolveValuesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ResolveValuesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    values: Schema.Array(Schema.String),
    nodeId: DOM.NodeId,
    propertyName: Schema.optional(Schema.String),
    pseudoType: Schema.optional(DOM.PseudoType),
    pseudoIdentifier: Schema.optional(Schema.String)
  }).annotate({ identifier: "CSS.ResolveValuesParams" })
) as any as Schema.Codec<ResolveValuesParams>

/**
 * Resolve the specified values in the context of the provided element.
 * For example, a value of '1em' is evaluated according to the computed
 * 'font-size' of the element and a value 'calc(1px + 2px)' will be
 * resolved to '3px'.
 * If the `propertyName` was specified the `values` are resolved as if
 * they were property's declaration. If a value cannot be parsed according
 * to the provided property syntax, the value is parsed using combined
 * syntax as if null `propertyName` was provided. If the value cannot be
 * resolved even then, return the provided value without any changes.
 * Note: this function currently does not resolve CSS random() function,
 * it returns unmodified random() function parts.`
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ResolveValuesResult {
  readonly results: ReadonlyArray<string>
}

/**
 * Schema for `ResolveValuesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ResolveValuesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    results: Schema.Array(Schema.String)
  }).annotate({ identifier: "CSS.ResolveValuesResult" })
) as any as Schema.Codec<ResolveValuesResult>

/**
 * `setContainerQueryConditionText.Params`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetContainerQueryConditionTextParams {
  readonly styleSheetId: DOM.StyleSheetId
  readonly range: SourceRange
  readonly text: string
}

/**
 * Schema for `SetContainerQueryConditionTextParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetContainerQueryConditionTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    range: SourceRange,
    text: Schema.String
  }).annotate({ identifier: "CSS.SetContainerQueryConditionTextParams" })
) as any as Schema.Codec<SetContainerQueryConditionTextParams>

/**
 * `setContainerQueryConditionText.Result`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetContainerQueryConditionTextResult {
  /**
   * The resulting CSS container query rule after modification.
   */
  readonly containerQuery: CSSContainerQuery
}

/**
 * Schema for `SetContainerQueryConditionTextResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetContainerQueryConditionTextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    containerQuery: CSSContainerQuery
  }).annotate({ identifier: "CSS.SetContainerQueryConditionTextResult" })
) as any as Schema.Codec<SetContainerQueryConditionTextResult>

/**
 * Find a rule with the given active property for the given node and set the new value for this
 * property
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetEffectivePropertyValueForNodeParams {
  /**
   * The element id for which to set property.
   */
  readonly nodeId: DOM.NodeId
  readonly propertyName: string
  readonly value: string
}

/**
 * Schema for `SetEffectivePropertyValueForNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetEffectivePropertyValueForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId,
    propertyName: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "CSS.SetEffectivePropertyValueForNodeParams" })
) as any as Schema.Codec<SetEffectivePropertyValueForNodeParams>

/**
 * Modifies the keyframe rule key text.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetKeyframeKeyParams {
  readonly styleSheetId: DOM.StyleSheetId
  readonly range: SourceRange
  readonly keyText: string
}

/**
 * Schema for `SetKeyframeKeyParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetKeyframeKeyParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    range: SourceRange,
    keyText: Schema.String
  }).annotate({ identifier: "CSS.SetKeyframeKeyParams" })
) as any as Schema.Codec<SetKeyframeKeyParams>

/**
 * Modifies the keyframe rule key text.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetKeyframeKeyResult {
  /**
   * The resulting key text after modification.
   */
  readonly keyText: Value
}

/**
 * Schema for `SetKeyframeKeyResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetKeyframeKeyResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    keyText: Value
  }).annotate({ identifier: "CSS.SetKeyframeKeyResult" })
) as any as Schema.Codec<SetKeyframeKeyResult>

/**
 * Enables/disables rendering of local CSS fonts (enabled by default).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetLocalFontsEnabledParams {
  /**
   * Whether rendering of local fonts is enabled.
   */
  readonly enabled: boolean
}

/**
 * Schema for `SetLocalFontsEnabledParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetLocalFontsEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    enabled: Schema.Boolean
  }).annotate({ identifier: "CSS.SetLocalFontsEnabledParams" })
) as any as Schema.Codec<SetLocalFontsEnabledParams>

/**
 * Modifies the rule selector.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetMediaTextParams {
  readonly styleSheetId: DOM.StyleSheetId
  readonly range: SourceRange
  readonly text: string
}

/**
 * Schema for `SetMediaTextParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetMediaTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    range: SourceRange,
    text: Schema.String
  }).annotate({ identifier: "CSS.SetMediaTextParams" })
) as any as Schema.Codec<SetMediaTextParams>

/**
 * Modifies the rule selector.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetMediaTextResult {
  /**
   * The resulting CSS media rule after modification.
   */
  readonly media: CSSMedia
}

/**
 * Schema for `SetMediaTextResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetMediaTextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    media: CSSMedia
  }).annotate({ identifier: "CSS.SetMediaTextResult" })
) as any as Schema.Codec<SetMediaTextResult>

/**
 * Modifies the expression of a navigation at-rule.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetNavigationTextParams {
  readonly styleSheetId: DOM.StyleSheetId
  readonly range: SourceRange
  readonly text: string
}

/**
 * Schema for `SetNavigationTextParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetNavigationTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    range: SourceRange,
    text: Schema.String
  }).annotate({ identifier: "CSS.SetNavigationTextParams" })
) as any as Schema.Codec<SetNavigationTextParams>

/**
 * Modifies the expression of a navigation at-rule.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetNavigationTextResult {
  /**
   * The resulting CSS Navigation rule after modification.
   */
  readonly navigation: CSSNavigation
}

/**
 * Schema for `SetNavigationTextResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetNavigationTextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    navigation: CSSNavigation
  }).annotate({ identifier: "CSS.SetNavigationTextResult" })
) as any as Schema.Codec<SetNavigationTextResult>

/**
 * Modifies the property rule property name.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPropertyRulePropertyNameParams {
  readonly styleSheetId: DOM.StyleSheetId
  readonly range: SourceRange
  readonly propertyName: string
}

/**
 * Schema for `SetPropertyRulePropertyNameParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPropertyRulePropertyNameParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    range: SourceRange,
    propertyName: Schema.String
  }).annotate({ identifier: "CSS.SetPropertyRulePropertyNameParams" })
) as any as Schema.Codec<SetPropertyRulePropertyNameParams>

/**
 * Modifies the property rule property name.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetPropertyRulePropertyNameResult {
  /**
   * The resulting key text after modification.
   */
  readonly propertyName: Value
}

/**
 * Schema for `SetPropertyRulePropertyNameResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetPropertyRulePropertyNameResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    propertyName: Value
  }).annotate({ identifier: "CSS.SetPropertyRulePropertyNameResult" })
) as any as Schema.Codec<SetPropertyRulePropertyNameResult>

/**
 * Modifies the rule selector.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetRuleSelectorParams {
  readonly styleSheetId: DOM.StyleSheetId
  readonly range: SourceRange
  readonly selector: string
}

/**
 * Schema for `SetRuleSelectorParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetRuleSelectorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    range: SourceRange,
    selector: Schema.String
  }).annotate({ identifier: "CSS.SetRuleSelectorParams" })
) as any as Schema.Codec<SetRuleSelectorParams>

/**
 * Modifies the rule selector.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetRuleSelectorResult {
  /**
   * The resulting selector list after modification.
   */
  readonly selectorList: SelectorList
}

/**
 * Schema for `SetRuleSelectorResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetRuleSelectorResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    selectorList: SelectorList
  }).annotate({ identifier: "CSS.SetRuleSelectorResult" })
) as any as Schema.Codec<SetRuleSelectorResult>

/**
 * Modifies the expression of a scope at-rule.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetScopeTextParams {
  readonly styleSheetId: DOM.StyleSheetId
  readonly range: SourceRange
  readonly text: string
}

/**
 * Schema for `SetScopeTextParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetScopeTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    range: SourceRange,
    text: Schema.String
  }).annotate({ identifier: "CSS.SetScopeTextParams" })
) as any as Schema.Codec<SetScopeTextParams>

/**
 * Modifies the expression of a scope at-rule.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetScopeTextResult {
  /**
   * The resulting CSS Scope rule after modification.
   */
  readonly scope: CSSScope
}

/**
 * Schema for `SetScopeTextResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetScopeTextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    scope: CSSScope
  }).annotate({ identifier: "CSS.SetScopeTextResult" })
) as any as Schema.Codec<SetScopeTextResult>

/**
 * Sets the new stylesheet text.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetStyleSheetTextParams {
  readonly styleSheetId: DOM.StyleSheetId
  readonly text: string
}

/**
 * Schema for `SetStyleSheetTextParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetStyleSheetTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    text: Schema.String
  }).annotate({ identifier: "CSS.SetStyleSheetTextParams" })
) as any as Schema.Codec<SetStyleSheetTextParams>

/**
 * Sets the new stylesheet text.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetStyleSheetTextResult {
  /**
   * URL of source map associated with script (if any).
   */
  readonly sourceMapURL?: string | undefined
}

/**
 * Schema for `SetStyleSheetTextResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetStyleSheetTextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    sourceMapURL: Schema.optional(Schema.String)
  }).annotate({ identifier: "CSS.SetStyleSheetTextResult" })
) as any as Schema.Codec<SetStyleSheetTextResult>

/**
 * Applies specified style edits one after another in the given order.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetStyleTextsParams {
  readonly edits: ReadonlyArray<StyleDeclarationEdit>
  /**
   * NodeId for the DOM node in whose context custom property declarations for registered properties should be
   * validated. If omitted, declarations in the new rule text can only be validated statically, which may produce
   * incorrect results if the declaration contains a var() for example.
   */
  readonly nodeForPropertySyntaxValidation?: DOM.NodeId | undefined
}

/**
 * Schema for `SetStyleTextsParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetStyleTextsParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    edits: Schema.Array(StyleDeclarationEdit),
    nodeForPropertySyntaxValidation: Schema.optional(DOM.NodeId)
  }).annotate({ identifier: "CSS.SetStyleTextsParams" })
) as any as Schema.Codec<SetStyleTextsParams>

/**
 * Applies specified style edits one after another in the given order.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetStyleTextsResult {
  /**
   * The resulting styles after modification.
   */
  readonly styles: ReadonlyArray<CSSStyle>
}

/**
 * Schema for `SetStyleTextsResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetStyleTextsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styles: Schema.Array(CSSStyle)
  }).annotate({ identifier: "CSS.SetStyleTextsResult" })
) as any as Schema.Codec<SetStyleTextsResult, unknown>

/**
 * Modifies the expression of a supports at-rule.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetSupportsTextParams {
  readonly styleSheetId: DOM.StyleSheetId
  readonly range: SourceRange
  readonly text: string
}

/**
 * Schema for `SetSupportsTextParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetSupportsTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId,
    range: SourceRange,
    text: Schema.String
  }).annotate({ identifier: "CSS.SetSupportsTextParams" })
) as any as Schema.Codec<SetSupportsTextParams>

/**
 * Modifies the expression of a supports at-rule.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetSupportsTextResult {
  /**
   * The resulting CSS Supports rule after modification.
   */
  readonly supports: CSSSupports
}

/**
 * Schema for `SetSupportsTextResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetSupportsTextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    supports: CSSSupports
  }).annotate({ identifier: "CSS.SetSupportsTextResult" })
) as any as Schema.Codec<SetSupportsTextResult>

/**
 * Stop tracking rule usage and return the list of rules that were used since last call to
 * `takeCoverageDelta` (or since start of coverage instrumentation).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StopRuleUsageTrackingResult {
  readonly ruleUsage: ReadonlyArray<RuleUsage>
}

/**
 * Schema for `StopRuleUsageTrackingResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StopRuleUsageTrackingResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ruleUsage: Schema.Array(RuleUsage)
  }).annotate({ identifier: "CSS.StopRuleUsageTrackingResult" })
) as any as Schema.Codec<StopRuleUsageTrackingResult>

/**
 * Fired whenever an active document stylesheet is added.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StyleSheetAddedParams {
  /**
   * Added stylesheet metainfo.
   */
  readonly header: CSSStyleSheetHeader
}

/**
 * Schema for `StyleSheetAddedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StyleSheetAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    header: CSSStyleSheetHeader
  }).annotate({ identifier: "CSS.StyleSheetAddedParams" })
) as any as Schema.Codec<StyleSheetAddedParams>

/**
 * Fired whenever a stylesheet is changed as a result of the client operation.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StyleSheetChangedParams {
  readonly styleSheetId: DOM.StyleSheetId
}

/**
 * Schema for `StyleSheetChangedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StyleSheetChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId
  }).annotate({ identifier: "CSS.StyleSheetChangedParams" })
) as any as Schema.Codec<StyleSheetChangedParams>

/**
 * Fired whenever an active document stylesheet is removed.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StyleSheetRemovedParams {
  /**
   * Identifier of the removed stylesheet.
   */
  readonly styleSheetId: DOM.StyleSheetId
}

/**
 * Schema for `StyleSheetRemovedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StyleSheetRemovedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: DOM.StyleSheetId
  }).annotate({ identifier: "CSS.StyleSheetRemovedParams" })
) as any as Schema.Codec<StyleSheetRemovedParams>

/**
 * Polls the next batch of computed style updates.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TakeComputedStyleUpdatesResult {
  /**
   * The list of node Ids that have their tracked computed styles updated.
   */
  readonly nodeIds: ReadonlyArray<DOM.NodeId>
}

/**
 * Schema for `TakeComputedStyleUpdatesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TakeComputedStyleUpdatesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeIds: Schema.Array(DOM.NodeId)
  }).annotate({ identifier: "CSS.TakeComputedStyleUpdatesResult" })
) as any as Schema.Codec<TakeComputedStyleUpdatesResult>

/**
 * Obtain list of rules that became used since last call to this method (or since start of coverage
 * instrumentation).
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TakeCoverageDeltaResult {
  readonly coverage: ReadonlyArray<RuleUsage>
  /**
   * Monotonically increasing time, in seconds.
   */
  readonly timestamp: number
}

/**
 * Schema for `TakeCoverageDeltaResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TakeCoverageDeltaResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    coverage: Schema.Array(RuleUsage),
    timestamp: Schema.Number
  }).annotate({ identifier: "CSS.TakeCoverageDeltaResult" })
) as any as Schema.Codec<TakeCoverageDeltaResult>

/**
 * Starts tracking the given computed styles for updates. The specified array of properties
 * replaces the one previously specified. Pass empty array to disable tracking.
 * Use takeComputedStyleUpdates to retrieve the list of nodes that had properties modified.
 * The changes to computed style properties are only tracked for nodes pushed to the front-end
 * by the DOM agent. If no changes to the tracked properties occur after the node has been pushed
 * to the front-end, no updates will be issued for the node.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TrackComputedStyleUpdatesParams {
  readonly propertiesToTrack: ReadonlyArray<CSSComputedStyleProperty>
}

/**
 * Schema for `TrackComputedStyleUpdatesParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TrackComputedStyleUpdatesParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    propertiesToTrack: Schema.Array(CSSComputedStyleProperty)
  }).annotate({ identifier: "CSS.TrackComputedStyleUpdatesParams" })
) as any as Schema.Codec<TrackComputedStyleUpdatesParams>

/**
 * Starts tracking the given node for the computed style updates
 * and whenever the computed style is updated for node, it queues
 * a `computedStyleUpdated` event with throttling.
 * There can only be 1 node tracked for computed style updates
 * so passing a new node id removes tracking from the previous node.
 * Pass `undefined` to disable tracking.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TrackComputedStyleUpdatesForNodeParams {
  readonly nodeId?: DOM.NodeId | undefined
}

/**
 * Schema for `TrackComputedStyleUpdatesForNodeParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TrackComputedStyleUpdatesForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: Schema.optional(DOM.NodeId)
  }).annotate({ identifier: "CSS.TrackComputedStyleUpdatesForNodeParams" })
) as any as Schema.Codec<TrackComputedStyleUpdatesForNodeParams>

/**
 * Inserts a new rule with the given `ruleText` in a stylesheet with given `styleSheetId`, at the
 * position specified by `location`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const addRule: Protocol.CommandDef<"CSS.addRule", AddRuleParams, AddRuleResult> = /*#__PURE__*/ Protocol.command(
  "CSS.addRule",
  AddRuleParams,
  AddRuleResult,
  { status: "stable" }
)

/**
 * Returns all class names from specified stylesheet.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const collectClassNames: Protocol.CommandDef<
  "CSS.collectClassNames",
  CollectClassNamesParams,
  CollectClassNamesResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.collectClassNames",
  CollectClassNamesParams,
  CollectClassNamesResult,
  { status: "stable" }
)

/**
 * Creates a new special "via-inspector" stylesheet in the frame with given `frameId`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const createStyleSheet: Protocol.CommandDef<
  "CSS.createStyleSheet",
  CreateStyleSheetParams,
  CreateStyleSheetResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.createStyleSheet",
  CreateStyleSheetParams,
  CreateStyleSheetResult,
  { status: "stable" }
)

/**
 * Disables the CSS agent for the given page.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"CSS.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "CSS.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables the CSS agent for the given page. Clients should not assume that the CSS agent has been
 * enabled until the result of this command is received.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"CSS.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "CSS.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Ensures that the given node will have specified pseudo-classes whenever its style is computed by
 * the browser.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const forcePseudoState: Protocol.CommandDef<"CSS.forcePseudoState", ForcePseudoStateParams, void> =
  /*#__PURE__*/ Protocol.command(
    "CSS.forcePseudoState",
    ForcePseudoStateParams,
    undefined,
    { status: "stable" }
  )

/**
 * Ensures that the given node is in its starting-style state.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const forceStartingStyle: Protocol.CommandDef<"CSS.forceStartingStyle", ForceStartingStyleParams, void> =
  /*#__PURE__*/ Protocol.command(
    "CSS.forceStartingStyle",
    ForceStartingStyleParams,
    undefined,
    { status: "stable" }
  )

/**
 * Returns the styles coming from animations & transitions
 * including the animation & transition styles coming from inheritance chain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getAnimatedStylesForNode: Protocol.CommandDef<
  "CSS.getAnimatedStylesForNode",
  GetAnimatedStylesForNodeParams,
  GetAnimatedStylesForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getAnimatedStylesForNode",
  GetAnimatedStylesForNodeParams,
  GetAnimatedStylesForNodeResult,
  { status: "experimental" }
)

/**
 * Sends `CSS.getBackgroundColors`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getBackgroundColors: Protocol.CommandDef<
  "CSS.getBackgroundColors",
  GetBackgroundColorsParams,
  GetBackgroundColorsResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getBackgroundColors",
  GetBackgroundColorsParams,
  GetBackgroundColorsResult,
  { status: "stable" }
)

/**
 * Returns the computed style for a DOM node identified by `nodeId`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getComputedStyleForNode: Protocol.CommandDef<
  "CSS.getComputedStyleForNode",
  GetComputedStyleForNodeParams,
  GetComputedStyleForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getComputedStyleForNode",
  GetComputedStyleForNodeParams,
  GetComputedStyleForNodeResult,
  { status: "stable" }
)

/**
 * Returns the values of the default UA-defined environment variables used in env()
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getEnvironmentVariables: Protocol.CommandDef<
  "CSS.getEnvironmentVariables",
  void,
  GetEnvironmentVariablesResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getEnvironmentVariables",
  undefined,
  GetEnvironmentVariablesResult,
  { status: "experimental" }
)

/**
 * Returns the styles defined inline (explicitly in the "style" attribute and implicitly, using DOM
 * attributes) for a DOM node identified by `nodeId`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getInlineStylesForNode: Protocol.CommandDef<
  "CSS.getInlineStylesForNode",
  GetInlineStylesForNodeParams,
  GetInlineStylesForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getInlineStylesForNode",
  GetInlineStylesForNodeParams,
  GetInlineStylesForNodeResult,
  { status: "stable" }
)

/**
 * Returns all layers parsed by the rendering engine for the tree scope of a node.
 * Given a DOM element identified by nodeId, getLayersForNode returns the root
 * layer for the nearest ancestor document or shadow root. The layer root contains
 * the full layer tree for the tree scope and their ordering.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getLayersForNode: Protocol.CommandDef<
  "CSS.getLayersForNode",
  GetLayersForNodeParams,
  GetLayersForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getLayersForNode",
  GetLayersForNodeParams,
  GetLayersForNodeResult,
  { status: "experimental" }
)

/**
 * Given a CSS selector text and a style sheet ID, getLocationForSelector
 * returns an array of locations of the CSS selector in the style sheet.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getLocationForSelector: Protocol.CommandDef<
  "CSS.getLocationForSelector",
  GetLocationForSelectorParams,
  GetLocationForSelectorResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getLocationForSelector",
  GetLocationForSelectorParams,
  GetLocationForSelectorResult,
  { status: "experimental" }
)

/**
 * Sends `CSS.getLonghandProperties`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getLonghandProperties: Protocol.CommandDef<
  "CSS.getLonghandProperties",
  GetLonghandPropertiesParams,
  GetLonghandPropertiesResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getLonghandProperties",
  GetLonghandPropertiesParams,
  GetLonghandPropertiesResult,
  { status: "experimental" }
)

/**
 * Returns requested styles for a DOM node identified by `nodeId`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getMatchedStylesForNode: Protocol.CommandDef<
  "CSS.getMatchedStylesForNode",
  GetMatchedStylesForNodeParams,
  GetMatchedStylesForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getMatchedStylesForNode",
  GetMatchedStylesForNodeParams,
  GetMatchedStylesForNodeResult,
  { status: "stable" }
)

/**
 * Returns all media queries parsed by the rendering engine.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getMediaQueries: Protocol.CommandDef<"CSS.getMediaQueries", void, GetMediaQueriesResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.getMediaQueries",
    undefined,
    GetMediaQueriesResult,
    { status: "stable" }
  )

/**
 * Requests information about platform fonts which we used to render child TextNodes in the given
 * node.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getPlatformFontsForNode: Protocol.CommandDef<
  "CSS.getPlatformFontsForNode",
  GetPlatformFontsForNodeParams,
  GetPlatformFontsForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getPlatformFontsForNode",
  GetPlatformFontsForNodeParams,
  GetPlatformFontsForNodeResult,
  { status: "stable" }
)

/**
 * Returns the current textual content for a stylesheet.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getStyleSheetText: Protocol.CommandDef<
  "CSS.getStyleSheetText",
  GetStyleSheetTextParams,
  GetStyleSheetTextResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getStyleSheetText",
  GetStyleSheetTextParams,
  GetStyleSheetTextResult,
  { status: "stable" }
)

/**
 * Resolve the specified values in the context of the provided element.
 * For example, a value of '1em' is evaluated according to the computed
 * 'font-size' of the element and a value 'calc(1px + 2px)' will be
 * resolved to '3px'.
 * If the `propertyName` was specified the `values` are resolved as if
 * they were property's declaration. If a value cannot be parsed according
 * to the provided property syntax, the value is parsed using combined
 * syntax as if null `propertyName` was provided. If the value cannot be
 * resolved even then, return the provided value without any changes.
 * Note: this function currently does not resolve CSS random() function,
 * it returns unmodified random() function parts.`
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const resolveValues: Protocol.CommandDef<"CSS.resolveValues", ResolveValuesParams, ResolveValuesResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.resolveValues",
    ResolveValuesParams,
    ResolveValuesResult,
    { status: "experimental" }
  )

/**
 * Sends `CSS.setContainerQueryConditionText`.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setContainerQueryConditionText: Protocol.CommandDef<
  "CSS.setContainerQueryConditionText",
  SetContainerQueryConditionTextParams,
  SetContainerQueryConditionTextResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.setContainerQueryConditionText",
  SetContainerQueryConditionTextParams,
  SetContainerQueryConditionTextResult,
  { status: "experimental" }
)

/**
 * Find a rule with the given active property for the given node and set the new value for this
 * property
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setEffectivePropertyValueForNode: Protocol.CommandDef<
  "CSS.setEffectivePropertyValueForNode",
  SetEffectivePropertyValueForNodeParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "CSS.setEffectivePropertyValueForNode",
  SetEffectivePropertyValueForNodeParams,
  undefined,
  { status: "stable" }
)

/**
 * Modifies the keyframe rule key text.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setKeyframeKey: Protocol.CommandDef<"CSS.setKeyframeKey", SetKeyframeKeyParams, SetKeyframeKeyResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.setKeyframeKey",
    SetKeyframeKeyParams,
    SetKeyframeKeyResult,
    { status: "stable" }
  )

/**
 * Enables/disables rendering of local CSS fonts (enabled by default).
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setLocalFontsEnabled: Protocol.CommandDef<"CSS.setLocalFontsEnabled", SetLocalFontsEnabledParams, void> =
  /*#__PURE__*/ Protocol.command(
    "CSS.setLocalFontsEnabled",
    SetLocalFontsEnabledParams,
    undefined,
    { status: "experimental" }
  )

/**
 * Modifies the rule selector.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setMediaText: Protocol.CommandDef<"CSS.setMediaText", SetMediaTextParams, SetMediaTextResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.setMediaText",
    SetMediaTextParams,
    SetMediaTextResult,
    { status: "stable" }
  )

/**
 * Modifies the expression of a navigation at-rule.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setNavigationText: Protocol.CommandDef<
  "CSS.setNavigationText",
  SetNavigationTextParams,
  SetNavigationTextResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.setNavigationText",
  SetNavigationTextParams,
  SetNavigationTextResult,
  { status: "experimental" }
)

/**
 * Modifies the property rule property name.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setPropertyRulePropertyName: Protocol.CommandDef<
  "CSS.setPropertyRulePropertyName",
  SetPropertyRulePropertyNameParams,
  SetPropertyRulePropertyNameResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.setPropertyRulePropertyName",
  SetPropertyRulePropertyNameParams,
  SetPropertyRulePropertyNameResult,
  { status: "stable" }
)

/**
 * Modifies the rule selector.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setRuleSelector: Protocol.CommandDef<"CSS.setRuleSelector", SetRuleSelectorParams, SetRuleSelectorResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.setRuleSelector",
    SetRuleSelectorParams,
    SetRuleSelectorResult,
    { status: "stable" }
  )

/**
 * Modifies the expression of a scope at-rule.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setScopeText: Protocol.CommandDef<"CSS.setScopeText", SetScopeTextParams, SetScopeTextResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.setScopeText",
    SetScopeTextParams,
    SetScopeTextResult,
    { status: "experimental" }
  )

/**
 * Sets the new stylesheet text.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setStyleSheetText: Protocol.CommandDef<
  "CSS.setStyleSheetText",
  SetStyleSheetTextParams,
  SetStyleSheetTextResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.setStyleSheetText",
  SetStyleSheetTextParams,
  SetStyleSheetTextResult,
  { status: "stable" }
)

/**
 * Applies specified style edits one after another in the given order.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setStyleTexts: Protocol.CommandDef<"CSS.setStyleTexts", SetStyleTextsParams, SetStyleTextsResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.setStyleTexts",
    SetStyleTextsParams,
    SetStyleTextsResult,
    { status: "stable" }
  )

/**
 * Modifies the expression of a supports at-rule.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const setSupportsText: Protocol.CommandDef<"CSS.setSupportsText", SetSupportsTextParams, SetSupportsTextResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.setSupportsText",
    SetSupportsTextParams,
    SetSupportsTextResult,
    { status: "experimental" }
  )

/**
 * Enables the selector recording.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const startRuleUsageTracking: Protocol.CommandDef<"CSS.startRuleUsageTracking", void, void> =
  /*#__PURE__*/ Protocol.command(
    "CSS.startRuleUsageTracking",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Stop tracking rule usage and return the list of rules that were used since last call to
 * `takeCoverageDelta` (or since start of coverage instrumentation).
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const stopRuleUsageTracking: Protocol.CommandDef<
  "CSS.stopRuleUsageTracking",
  void,
  StopRuleUsageTrackingResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.stopRuleUsageTracking",
  undefined,
  StopRuleUsageTrackingResult,
  { status: "stable" }
)

/**
 * Polls the next batch of computed style updates.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const takeComputedStyleUpdates: Protocol.CommandDef<
  "CSS.takeComputedStyleUpdates",
  void,
  TakeComputedStyleUpdatesResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.takeComputedStyleUpdates",
  undefined,
  TakeComputedStyleUpdatesResult,
  { status: "experimental" }
)

/**
 * Obtain list of rules that became used since last call to this method (or since start of coverage
 * instrumentation).
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const takeCoverageDelta: Protocol.CommandDef<"CSS.takeCoverageDelta", void, TakeCoverageDeltaResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.takeCoverageDelta",
    undefined,
    TakeCoverageDeltaResult,
    { status: "stable" }
  )

/**
 * Starts tracking the given computed styles for updates. The specified array of properties
 * replaces the one previously specified. Pass empty array to disable tracking.
 * Use takeComputedStyleUpdates to retrieve the list of nodes that had properties modified.
 * The changes to computed style properties are only tracked for nodes pushed to the front-end
 * by the DOM agent. If no changes to the tracked properties occur after the node has been pushed
 * to the front-end, no updates will be issued for the node.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const trackComputedStyleUpdates: Protocol.CommandDef<
  "CSS.trackComputedStyleUpdates",
  TrackComputedStyleUpdatesParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "CSS.trackComputedStyleUpdates",
  TrackComputedStyleUpdatesParams,
  undefined,
  { status: "experimental" }
)

/**
 * Starts tracking the given node for the computed style updates
 * and whenever the computed style is updated for node, it queues
 * a `computedStyleUpdated` event with throttling.
 * There can only be 1 node tracked for computed style updates
 * so passing a new node id removes tracking from the previous node.
 * Pass `undefined` to disable tracking.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const trackComputedStyleUpdatesForNode: Protocol.CommandDef<
  "CSS.trackComputedStyleUpdatesForNode",
  TrackComputedStyleUpdatesForNodeParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "CSS.trackComputedStyleUpdatesForNode",
  TrackComputedStyleUpdatesForNodeParams,
  undefined,
  { status: "experimental" }
)

/**
 * The `CSS.computedStyleUpdated` event.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const computedStyleUpdated: Protocol.EventDef<"CSS.computedStyleUpdated", ComputedStyleUpdatedParams> =
  /*#__PURE__*/ Protocol.event(
    "CSS.computedStyleUpdated",
    ComputedStyleUpdatedParams,
    { status: "experimental" }
  )

/**
 * Fires whenever a web font is updated.  A non-empty font parameter indicates a successfully loaded
 * web font.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const fontsUpdated: Protocol.EventDef<"CSS.fontsUpdated", FontsUpdatedParams> = /*#__PURE__*/ Protocol.event(
  "CSS.fontsUpdated",
  FontsUpdatedParams,
  { status: "stable" }
)

/**
 * Fires whenever a MediaQuery result changes (for example, after a browser window has been
 * resized.) The current implementation considers only viewport-dependent media features.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const mediaQueryResultChanged: Protocol.EventDef<"CSS.mediaQueryResultChanged", void> = /*#__PURE__*/ Protocol
  .event(
    "CSS.mediaQueryResultChanged",
    undefined,
    { status: "stable" }
  )

/**
 * Fired whenever an active document stylesheet is added.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const styleSheetAdded: Protocol.EventDef<"CSS.styleSheetAdded", StyleSheetAddedParams> = /*#__PURE__*/ Protocol
  .event(
    "CSS.styleSheetAdded",
    StyleSheetAddedParams,
    { status: "stable" }
  )

/**
 * Fired whenever a stylesheet is changed as a result of the client operation.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const styleSheetChanged: Protocol.EventDef<"CSS.styleSheetChanged", StyleSheetChangedParams> =
  /*#__PURE__*/ Protocol.event(
    "CSS.styleSheetChanged",
    StyleSheetChangedParams,
    { status: "stable" }
  )

/**
 * Fired whenever an active document stylesheet is removed.
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const styleSheetRemoved: Protocol.EventDef<"CSS.styleSheetRemoved", StyleSheetRemovedParams> =
  /*#__PURE__*/ Protocol.event(
    "CSS.styleSheetRemoved",
    StyleSheetRemovedParams,
    { status: "stable" }
  )
