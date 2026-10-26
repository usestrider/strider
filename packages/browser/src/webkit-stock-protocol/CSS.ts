/**
 * This domain exposes CSS read/write operations. All CSS objects, like stylesheets, rules, and styles, have an associated <code>id</code> used in subsequent operations on the related object. Each object type has a specific <code>id</code> structure, and those are not interchangeable between objects of different kinds. CSS objects can be loaded using the <code>get*ForNode()</code> calls (which accept a DOM node id). Alternatively, a client can discover all the existing stylesheets with the <code>getAllStyleSheets()</code> method and subsequently load the required stylesheet contents using the <code>getStyleSheet[Text]()</code> methods.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-stock`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as DOM from "./DOM.ts"
import * as Network from "./Network.ts"

/**
 * `CSSComputedStyleProperty`.
 *
 * @stability unstable
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
 * @stability unstable
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
 * CSS style effective visual dimensions and source offsets.
 *
 * @stability unstable
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
   * The property priority (implies "" if absent).
   */
  readonly priority?: string | undefined
  /**
   * Whether the property is implicit (implies <code>false</code> if absent).
   */
  readonly implicit?: boolean | undefined
  /**
   * The full property text as specified in the style.
   */
  readonly text?: string | undefined
  /**
   * Whether the property is understood by the browser (implies <code>true</code> if absent).
   */
  readonly parsedOk?: boolean | undefined
  /**
   * Whether the property is active or disabled.
   */
  readonly status?: CSSPropertyStatus | undefined
  /**
   * The entire property range in the enclosing style declaration (if available).
   */
  readonly range?: SourceRange | undefined
}

/**
 * Schema for `CSSProperty`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSProperty = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String,
    priority: Schema.optional(Schema.String),
    implicit: Schema.optional(Schema.Boolean),
    text: Schema.optional(Schema.String),
    parsedOk: Schema.optional(Schema.Boolean),
    status: Schema.optional(CSSPropertyStatus),
    range: Schema.optional(SourceRange)
  }).annotate({ identifier: "CSS.CSSProperty" })
) as any as Schema.Codec<CSSProperty>

/**
 * `CSSPropertyInfo`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CSSPropertyInfo {
  /**
   * Property name.
   */
  readonly name: string
  /**
   * Other names for this property.
   */
  readonly aliases?: ReadonlyArray<string> | undefined
  /**
   * Longhand property names.
   */
  readonly longhands?: ReadonlyArray<string> | undefined
  /**
   * Supported values for this property.
   */
  readonly values?: ReadonlyArray<string> | undefined
  /**
   * Whether the property is able to be inherited.
   */
  readonly inherited?: boolean | undefined
}

/**
 * Schema for `CSSPropertyInfo`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSPropertyInfo = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    aliases: Schema.optional(Schema.Array(Schema.String)),
    longhands: Schema.optional(Schema.Array(Schema.String)),
    values: Schema.optional(Schema.Array(Schema.String)),
    inherited: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "CSS.CSSPropertyInfo" })
) as any as Schema.Codec<CSSPropertyInfo>

/**
 * The property status: "active" if the property is effective in the style, "inactive" if the property is overridden by a same-named property in this style later on, "disabled" if the property is disabled by the user, "style" (implied if absent) if the property is reported by the browser rather than by the CSS source parser.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CSSPropertyStatus =
  | "active"
  | "inactive"
  | "disabled"
  | "style"
  | (string & {})

/**
 * Schema for `CSSPropertyStatus`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSPropertyStatus = Schema.String as any as Schema.Codec<CSSPropertyStatus>

/**
 * CSS rule representation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CSSRule {
  /**
   * The CSS rule identifier (absent for user agent stylesheet and user-specified stylesheet rules).
   */
  readonly ruleId?: CSSRuleId | undefined
  /**
   * Rule selector data.
   */
  readonly selectorList: SelectorList
  /**
   * Parent stylesheet resource URL (for regular rules).
   */
  readonly sourceURL?: string | undefined
  /**
   * Line ordinal of the rule selector start character in the resource.
   */
  readonly sourceLine: number
  /**
   * Parent stylesheet's origin.
   */
  readonly origin: StyleSheetOrigin
  /**
   * Associated style declaration.
   */
  readonly style: CSSStyle
  /**
   * Grouping list array (for rules involving \@media/@supports). The array enumerates CSS groupings starting with the innermost one, going outwards.
   */
  readonly groupings?: ReadonlyArray<Grouping> | undefined
  /**
   * <code>true</code> if this style is for a rule implicitly wrapping properties declared inside of CSSGrouping.
   */
  readonly isImplicitlyNested?: boolean | undefined
}

/**
 * Schema for `CSSRule`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSRule = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ruleId: Schema.optional(CSSRuleId),
    selectorList: SelectorList,
    sourceURL: Schema.optional(Schema.String),
    sourceLine: Schema.Int,
    origin: StyleSheetOrigin,
    style: CSSStyle,
    groupings: Schema.optional(Schema.Array(Grouping)),
    isImplicitlyNested: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "CSS.CSSRule" })
) as any as Schema.Codec<CSSRule>

/**
 * This object identifies a CSS rule in a unique way.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CSSRuleId {
  /**
   * Enclosing stylesheet identifier.
   */
  readonly styleSheetId: StyleSheetId
  /**
   * The rule ordinal within the stylesheet.
   */
  readonly ordinal: number
}

/**
 * Schema for `CSSRuleId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSRuleId = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: StyleSheetId,
    ordinal: Schema.Int
  }).annotate({ identifier: "CSS.CSSRuleId" })
) as any as Schema.Codec<CSSRuleId>

/**
 * CSS selector.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CSSSelector {
  /**
   * Canonicalized selector text.
   */
  readonly text: string
  /**
   * Specificity (a, b, c) tuple. Included if the selector is sent in response to CSS.getMatchedStylesForNode which provides a context element.
   */
  readonly specificity?: ReadonlyArray<number> | undefined
  /**
   * Whether or not the specificity can be dynamic. Included if the selector is sent in response to CSS.getMatchedStylesForNode which provides a context element.
   */
  readonly dynamic?: boolean | undefined
}

/**
 * Schema for `CSSSelector`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSSelector = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.String,
    specificity: Schema.optional(Schema.Array(Schema.Int)),
    dynamic: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "CSS.CSSSelector" })
) as any as Schema.Codec<CSSSelector>

/**
 * CSS style representation.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CSSStyle {
  /**
   * The CSS style identifier (absent for attribute styles).
   */
  readonly styleId?: CSSStyleId | undefined
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
  /**
   * The effective "width" property value from this style.
   */
  readonly width?: string | undefined
  /**
   * The effective "height" property value from this style.
   */
  readonly height?: string | undefined
}

/**
 * Schema for `CSSStyle`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSStyle = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleId: Schema.optional(CSSStyleId),
    cssProperties: Schema.Array(CSSProperty),
    shorthandEntries: Schema.Array(ShorthandEntry),
    cssText: Schema.optional(Schema.String),
    range: Schema.optional(SourceRange),
    width: Schema.optional(Schema.String),
    height: Schema.optional(Schema.String)
  }).annotate({ identifier: "CSS.CSSStyle" })
) as any as Schema.Codec<CSSStyle>

/**
 * CSS style information for a DOM style attribute.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CSSStyleAttribute {
  /**
   * DOM attribute name (e.g. "width").
   */
  readonly name: string
  /**
   * CSS style generated by the respective DOM attribute.
   */
  readonly style: CSSStyle
}

/**
 * Schema for `CSSStyleAttribute`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSStyleAttribute = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    style: CSSStyle
  }).annotate({ identifier: "CSS.CSSStyleAttribute" })
) as any as Schema.Codec<CSSStyleAttribute>

/**
 * This object identifies a CSS style in a unique way.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CSSStyleId {
  /**
   * Enclosing stylesheet identifier.
   */
  readonly styleSheetId: StyleSheetId
  /**
   * The style ordinal within the stylesheet.
   */
  readonly ordinal: number
}

/**
 * Schema for `CSSStyleId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSStyleId = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: StyleSheetId,
    ordinal: Schema.Int
  }).annotate({ identifier: "CSS.CSSStyleId" })
) as any as Schema.Codec<CSSStyleId>

/**
 * CSS stylesheet contents.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CSSStyleSheetBody {
  /**
   * The stylesheet identifier.
   */
  readonly styleSheetId: StyleSheetId
  /**
   * Stylesheet resource URL.
   */
  readonly rules: ReadonlyArray<CSSRule>
  /**
   * Stylesheet resource contents (if available).
   */
  readonly text?: string | undefined
}

/**
 * Schema for `CSSStyleSheetBody`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSStyleSheetBody = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: StyleSheetId,
    rules: Schema.Array(CSSRule),
    text: Schema.optional(Schema.String)
  }).annotate({ identifier: "CSS.CSSStyleSheetBody" })
) as any as Schema.Codec<CSSStyleSheetBody>

/**
 * CSS stylesheet meta-information.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CSSStyleSheetHeader {
  /**
   * The stylesheet identifier.
   */
  readonly styleSheetId: StyleSheetId
  /**
   * Owner frame identifier.
   */
  readonly frameId: Network.FrameId
  /**
   * Stylesheet resource URL.
   */
  readonly sourceURL: string
  /**
   * Stylesheet origin.
   */
  readonly origin: StyleSheetOrigin
  /**
   * Stylesheet title.
   */
  readonly title: string
  /**
   * Denotes whether the stylesheet is disabled.
   */
  readonly disabled: boolean
  /**
   * Whether this stylesheet is a <style> tag created by the parser. This is not set for document.written <style> tags.
   */
  readonly isInline: boolean
  /**
   * Line offset of the stylesheet within the resource (zero based).
   */
  readonly startLine: number
  /**
   * Column offset of the stylesheet within the resource (zero based).
   */
  readonly startColumn: number
}

/**
 * Schema for `CSSStyleSheetHeader`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CSSStyleSheetHeader = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: StyleSheetId,
    frameId: Network.FrameId,
    sourceURL: Schema.String,
    origin: StyleSheetOrigin,
    title: Schema.String,
    disabled: Schema.Boolean,
    isInline: Schema.Boolean,
    startLine: Schema.Number,
    startColumn: Schema.Number
  }).annotate({ identifier: "CSS.CSSStyleSheetHeader" })
) as any as Schema.Codec<CSSStyleSheetHeader>

/**
 * A representation of WebCore::Font. Conceptually this is backed by either a font file on disk or from the network.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Font {
  /**
   * The display name defined by the font.
   */
  readonly displayName: string
  /**
   * The variation axes defined by the font.
   */
  readonly variationAxes: ReadonlyArray<FontVariationAxis>
  /**
   * Whether the font has synthesized its boldness or not.
   */
  readonly synthesizedBold?: boolean | undefined
  /**
   * Whether the font has synthesized its obliqueness or not
   */
  readonly synthesizedOblique?: boolean | undefined
}

/**
 * Schema for `Font`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Font = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    displayName: Schema.String,
    variationAxes: Schema.Array(FontVariationAxis),
    synthesizedBold: Schema.optional(Schema.Boolean),
    synthesizedOblique: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "CSS.Font" })
) as any as Schema.Codec<Font>

/**
 * A single variation axis associated with a Font.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FontVariationAxis {
  /**
   * The name, generally human-readable, of the variation axis. Some axes may not provide a human-readable name distiguishable from the tag. This field is ommited when there is no name, or the name matches the tag exactly.
   */
  readonly name?: string | undefined
  /**
   * The four character tag for the variation axis.
   */
  readonly tag: string
  /**
   * The minimum value that will affect the axis.
   */
  readonly minimumValue: number
  /**
   * The maximum value that will affect the axis.
   */
  readonly maximumValue: number
  /**
   * The value that is used for the axis when it is not otherwise controlled.
   */
  readonly defaultValue: number
}

/**
 * Schema for `FontVariationAxis`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const FontVariationAxis = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.optional(Schema.String),
    tag: Schema.String,
    minimumValue: Schema.Number,
    maximumValue: Schema.Number,
    defaultValue: Schema.Number
  }).annotate({ identifier: "CSS.FontVariationAxis" })
) as any as Schema.Codec<FontVariationAxis>

/**
 * Pseudo-style identifier (see <code>enum PseudoId</code> in <code>RenderStyleConstants.h</code>).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ForceablePseudoClass =
  | "active"
  | "focus"
  | "focus-visible"
  | "focus-within"
  | "hover"
  | "target"
  | "visited"
  | (string & {})

/**
 * Schema for `ForceablePseudoClass`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ForceablePseudoClass = Schema.String as any as Schema.Codec<ForceablePseudoClass>

/**
 * CSS \@media (as well as other users of media queries, like \@import, <style>, <link>, etc.), \@supports, and \@layer descriptor.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Grouping {
  /**
   * Source of the media query: "media-rule" if specified by a \@media rule, "media-import-rule" if specified by an \@import rule, "media-link-node" if specified by a "media" attribute in a linked style sheet's LINK tag, "media-style-node" if specified by a "media" attribute in an inline style sheet's STYLE tag, "supports-rule" if specified by an \@supports rule, "layer-rule" if specified by an \@layer rule, "container-rule" if specified by an \@container rule, "scope-rule" if specified by a \@scope rule, "starting-style-rule" if specified by a \@starting-style rule, "style-rule" if specified by a CSSStyleRule containing the rule inside this grouping.
   */
  readonly type: GroupingType
  /**
   * The CSS rule identifier for the `\@rule` (absent for non-editable grouping rules) or the nesting parent style rule's selector. In CSSOM terms, this is the parent rule of either the previous Grouping for a CSSRule, or of a CSSRule itself.
   */
  readonly ruleId?: CSSRuleId | undefined
  /**
   * Query text if specified by a \@media, \@supports, or \@container rule. Layer name (or not present for anonymous layers) for \@layer rules.
   */
  readonly text?: string | undefined
  /**
   * URL of the document containing the CSS grouping.
   */
  readonly sourceURL?: string | undefined
  /**
   * \@-rule's header text range in the enclosing stylesheet (if available). This is from the first non-whitespace character after the @ declarartion to the last non-whitespace character before an opening curly bracket or semicolon.
   */
  readonly range?: SourceRange | undefined
}

/**
 * Schema for `Grouping`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Grouping = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: GroupingType,
    ruleId: Schema.optional(CSSRuleId),
    text: Schema.optional(Schema.String),
    sourceURL: Schema.optional(Schema.String),
    range: Schema.optional(SourceRange)
  }).annotate({ identifier: "CSS.Grouping" })
) as any as Schema.Codec<Grouping>

/**
 * Source of the media query: "media-rule" if specified by a \@media rule, "media-import-rule" if specified by an \@import rule, "media-link-node" if specified by a "media" attribute in a linked style sheet's LINK tag, "media-style-node" if specified by a "media" attribute in an inline style sheet's STYLE tag, "supports-rule" if specified by an \@supports rule, "layer-rule" if specified by an \@layer rule, "container-rule" if specified by an \@container rule, "scope-rule" if specified by a \@scope rule, "starting-style-rule" if specified by a \@starting-style rule, "style-rule" if specified by a CSSStyleRule containing the rule inside this grouping.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type GroupingType =
  | "media-rule"
  | "media-import-rule"
  | "media-link-node"
  | "media-style-node"
  | "supports-rule"
  | "layer-rule"
  | "layer-import-rule"
  | "container-rule"
  | "scope-rule"
  | "starting-style-rule"
  | "style-rule"
  | (string & {})

/**
 * Schema for `GroupingType`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GroupingType = Schema.String as any as Schema.Codec<GroupingType>

/**
 * CSS rule collection for a single pseudo style.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InheritedStyleEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    inlineStyle: Schema.optional(CSSStyle),
    matchedCSSRules: Schema.Array(RuleMatch)
  }).annotate({ identifier: "CSS.InheritedStyleEntry" })
) as any as Schema.Codec<InheritedStyleEntry>

/**
 * The mode for how layout context type changes are handled (default: <code>Observed</code>). <code>Observed</code> limits handling to those nodes already known to the frontend by other means (generally, this means the node is a visible item in the Elements tab). <code>All</code> informs the frontend of all layout context type changes and all nodes with a known layout context are sent to the frontend.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LayoutContextTypeChangedMode =
  | "observed"
  | "all"
  | (string & {})

/**
 * Schema for `LayoutContextTypeChangedMode`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LayoutContextTypeChangedMode = Schema.String as any as Schema.Codec<LayoutContextTypeChangedMode>

/**
 * Relevant layout information about the node. Things not in this list are not important to Web Inspector.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LayoutFlag =
  | "rendered"
  | "scrollable"
  | "flex"
  | "grid"
  | "subgrid"
  | "grid-lanes"
  | "event"
  | "slot-assigned"
  | "slot-filled"
  | (string & {})

/**
 * Schema for `LayoutFlag`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LayoutFlag = Schema.String as any as Schema.Codec<LayoutFlag>

/**
 * Pseudo-style identifier (see <code>enum PseudoId</code> in <code>RenderStyleConstants.h</code>).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PseudoId =
  | "first-line"
  | "first-letter"
  | "grammar-error"
  | "highlight"
  | "marker"
  | "before"
  | "after"
  | "selection"
  | "backdrop"
  | "spelling-error"
  | "target-text"
  | "checkmark"
  | "picker-icon"
  | "slider-fill"
  | "slider-thumb"
  | "slider-track"
  | "view-transition"
  | "view-transition-group"
  | "view-transition-image-pair"
  | "view-transition-old"
  | "view-transition-new"
  | "-webkit-scrollbar"
  | "-webkit-resizer"
  | "-webkit-scrollbar-thumb"
  | "-webkit-scrollbar-button"
  | "-webkit-scrollbar-track"
  | "-webkit-scrollbar-track-piece"
  | "-webkit-scrollbar-corner"
  | (string & {})

/**
 * Schema for `PseudoId`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PseudoId = Schema.String as any as Schema.Codec<PseudoId>

/**
 * CSS rule collection for a single pseudo style.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PseudoIdMatches {
  readonly pseudoId: PseudoId
  /**
   * Matches of CSS rules applicable to the pseudo style.
   */
  readonly matches: ReadonlyArray<RuleMatch>
}

/**
 * Schema for `PseudoIdMatches`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PseudoIdMatches = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    pseudoId: PseudoId,
    matches: Schema.Array(RuleMatch)
  }).annotate({ identifier: "CSS.PseudoIdMatches" })
) as any as Schema.Codec<PseudoIdMatches>

/**
 * Match data for a CSS rule.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RuleMatch = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rule: CSSRule,
    matchingSelectors: Schema.Array(Schema.Int)
  }).annotate({ identifier: "CSS.RuleMatch" })
) as any as Schema.Codec<RuleMatch>

/**
 * Selector list data.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SelectorList {
  /**
   * Selectors in the list.
   */
  readonly selectors: ReadonlyArray<CSSSelector>
  /**
   * Rule selector text.
   */
  readonly text: string
  /**
   * Rule selector range in the underlying resource (if available).
   */
  readonly range?: SourceRange | undefined
}

/**
 * Schema for `SelectorList`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SelectorList = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    selectors: Schema.Array(CSSSelector),
    text: Schema.String,
    range: Schema.optional(SourceRange)
  }).annotate({ identifier: "CSS.SelectorList" })
) as any as Schema.Codec<SelectorList>

/**
 * `ShorthandEntry`.
 *
 * @stability unstable
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
}

/**
 * Schema for `ShorthandEntry`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ShorthandEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    value: Schema.String
  }).annotate({ identifier: "CSS.ShorthandEntry" })
) as any as Schema.Codec<ShorthandEntry>

/**
 * Text range within a resource.
 *
 * @stability unstable
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
 * @stability unstable
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
 * `StyleSheetId`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type StyleSheetId = Brand.Branded<string, "~@usestrider/browser/webkit-stock-protocol/CSS/StyleSheetId">

/**
 * Schema for `StyleSheetId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StyleSheetId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-stock-protocol/CSS/StyleSheetId")
) as any as Schema.Codec<StyleSheetId>

/**
 * Stylesheet type: "user" for user stylesheets, "user-agent" for user-agent stylesheets, "inspector" for stylesheets created by the inspector (i.e. those holding the "via inspector" rules), "regular" for regular stylesheets.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type StyleSheetOrigin =
  | "user"
  | "user-agent"
  | "author"
  | "inspector"
  | (string & {})

/**
 * Schema for `StyleSheetOrigin`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StyleSheetOrigin = Schema.String as any as Schema.Codec<StyleSheetOrigin>

/**
 * Creates a new empty rule with the given <code>selector</code> in a stylesheet with given <code>styleSheetId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface AddRuleParams {
  readonly styleSheetId: StyleSheetId
  readonly selector: string
}

/**
 * Schema for `AddRuleParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddRuleParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: StyleSheetId,
    selector: Schema.String
  }).annotate({ identifier: "CSS.AddRuleParams" })
) as any as Schema.Codec<AddRuleParams>

/**
 * Creates a new empty rule with the given <code>selector</code> in a stylesheet with given <code>styleSheetId</code>.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const AddRuleResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rule: CSSRule
  }).annotate({ identifier: "CSS.AddRuleResult" })
) as any as Schema.Codec<AddRuleResult>

/**
 * Creates a new special "inspector" stylesheet in the frame with given <code>frameId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateStyleSheetParams {
  /**
   * Identifier of the frame where the new "inspector" stylesheet should be created. Ignored when dispatched to a FrameTarget; the receiving frame is used implicitly.
   */
  readonly frameId: Network.FrameId
}

/**
 * Schema for `CreateStyleSheetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateStyleSheetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    frameId: Network.FrameId
  }).annotate({ identifier: "CSS.CreateStyleSheetParams" })
) as any as Schema.Codec<CreateStyleSheetParams>

/**
 * Creates a new special "inspector" stylesheet in the frame with given <code>frameId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CreateStyleSheetResult {
  /**
   * Identifier of the created "inspector" stylesheet.
   */
  readonly styleSheetId: StyleSheetId
}

/**
 * Schema for `CreateStyleSheetResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CreateStyleSheetResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: StyleSheetId
  }).annotate({ identifier: "CSS.CreateStyleSheetResult" })
) as any as Schema.Codec<CreateStyleSheetResult>

/**
 * Ensures that the given node will have specified pseudo-classes whenever its style is computed by the browser.
 *
 * @stability unstable
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
  readonly forcedPseudoClasses: ReadonlyArray<ForceablePseudoClass>
}

/**
 * Schema for `ForcePseudoStateParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ForcePseudoStateParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId,
    forcedPseudoClasses: Schema.Array(ForceablePseudoClass)
  }).annotate({ identifier: "CSS.ForcePseudoStateParams" })
) as any as Schema.Codec<ForcePseudoStateParams>

/**
 * Returns metainfo entries for all known stylesheets.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetAllStyleSheetsResult {
  /**
   * Descriptor entries for all available stylesheets.
   */
  readonly headers: ReadonlyArray<CSSStyleSheetHeader>
}

/**
 * Schema for `GetAllStyleSheetsResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetAllStyleSheetsResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    headers: Schema.Array(CSSStyleSheetHeader)
  }).annotate({ identifier: "CSS.GetAllStyleSheetsResult" })
) as any as Schema.Codec<GetAllStyleSheetsResult>

/**
 * Returns the computed style for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetComputedStyleForNodeParams {
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GetComputedStyleForNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetComputedStyleForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "CSS.GetComputedStyleForNodeParams" })
) as any as Schema.Codec<GetComputedStyleForNodeParams>

/**
 * Returns the computed style for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetComputedStyleForNodeResult {
  /**
   * Computed style for the specified DOM node.
   */
  readonly computedStyle: ReadonlyArray<CSSComputedStyleProperty>
}

/**
 * Schema for `GetComputedStyleForNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetComputedStyleForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    computedStyle: Schema.Array(CSSComputedStyleProperty)
  }).annotate({ identifier: "CSS.GetComputedStyleForNodeResult" })
) as any as Schema.Codec<GetComputedStyleForNodeResult>

/**
 * Returns the primary font of the computed font cascade for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetFontDataForNodeParams {
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GetFontDataForNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetFontDataForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "CSS.GetFontDataForNodeParams" })
) as any as Schema.Codec<GetFontDataForNodeParams>

/**
 * Returns the primary font of the computed font cascade for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetFontDataForNodeResult {
  /**
   * Computed primary font for the specified DOM node.
   */
  readonly primaryFont: Font
}

/**
 * Schema for `GetFontDataForNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetFontDataForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    primaryFont: Font
  }).annotate({ identifier: "CSS.GetFontDataForNodeResult" })
) as any as Schema.Codec<GetFontDataForNodeResult>

/**
 * Returns the styles defined inline (explicitly in the "style" attribute and implicitly, using DOM attributes) for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetInlineStylesForNodeParams {
  readonly nodeId: DOM.NodeId
}

/**
 * Schema for `GetInlineStylesForNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetInlineStylesForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId
  }).annotate({ identifier: "CSS.GetInlineStylesForNodeParams" })
) as any as Schema.Codec<GetInlineStylesForNodeParams>

/**
 * Returns the styles defined inline (explicitly in the "style" attribute and implicitly, using DOM attributes) for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetInlineStylesForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    inlineStyle: Schema.optional(CSSStyle),
    attributesStyle: Schema.optional(CSSStyle)
  }).annotate({ identifier: "CSS.GetInlineStylesForNodeResult" })
) as any as Schema.Codec<GetInlineStylesForNodeResult>

/**
 * Returns requested styles for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetMatchedStylesForNodeParams {
  readonly nodeId: DOM.NodeId
  /**
   * Whether to include pseudo styles (default: true).
   */
  readonly includePseudo?: boolean | undefined
  /**
   * Whether to include inherited styles (default: true).
   */
  readonly includeInherited?: boolean | undefined
}

/**
 * Schema for `GetMatchedStylesForNodeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetMatchedStylesForNodeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId,
    includePseudo: Schema.optional(Schema.Boolean),
    includeInherited: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "CSS.GetMatchedStylesForNodeParams" })
) as any as Schema.Codec<GetMatchedStylesForNodeParams>

/**
 * Returns requested styles for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetMatchedStylesForNodeResult {
  /**
   * CSS rules matching this node, from all applicable stylesheets.
   */
  readonly matchedCSSRules?: ReadonlyArray<RuleMatch> | undefined
  /**
   * Pseudo style matches for this node.
   */
  readonly pseudoElements?: ReadonlyArray<PseudoIdMatches> | undefined
  /**
   * A chain of inherited styles (from the immediate node parent up to the DOM tree root).
   */
  readonly inherited?: ReadonlyArray<InheritedStyleEntry> | undefined
}

/**
 * Schema for `GetMatchedStylesForNodeResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetMatchedStylesForNodeResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    matchedCSSRules: Schema.optional(Schema.Array(RuleMatch)),
    pseudoElements: Schema.optional(Schema.Array(PseudoIdMatches)),
    inherited: Schema.optional(Schema.Array(InheritedStyleEntry))
  }).annotate({ identifier: "CSS.GetMatchedStylesForNodeResult" })
) as any as Schema.Codec<GetMatchedStylesForNodeResult>

/**
 * Returns stylesheet data for the specified <code>styleSheetId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetStyleSheetParams {
  readonly styleSheetId: StyleSheetId
}

/**
 * Schema for `GetStyleSheetParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetStyleSheetParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: StyleSheetId
  }).annotate({ identifier: "CSS.GetStyleSheetParams" })
) as any as Schema.Codec<GetStyleSheetParams>

/**
 * Returns stylesheet data for the specified <code>styleSheetId</code>.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetStyleSheetResult {
  /**
   * Stylesheet contents for the specified <code>styleSheetId</code>.
   */
  readonly styleSheet: CSSStyleSheetBody
}

/**
 * Schema for `GetStyleSheetResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetStyleSheetResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheet: CSSStyleSheetBody
  }).annotate({ identifier: "CSS.GetStyleSheetResult" })
) as any as Schema.Codec<GetStyleSheetResult>

/**
 * Returns the current textual content and the URL for a stylesheet.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetStyleSheetTextParams {
  readonly styleSheetId: StyleSheetId
}

/**
 * Schema for `GetStyleSheetTextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetStyleSheetTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: StyleSheetId
  }).annotate({ identifier: "CSS.GetStyleSheetTextParams" })
) as any as Schema.Codec<GetStyleSheetTextParams>

/**
 * Returns the current textual content and the URL for a stylesheet.
 *
 * @stability unstable
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetStyleSheetTextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    text: Schema.String
  }).annotate({ identifier: "CSS.GetStyleSheetTextResult" })
) as any as Schema.Codec<GetStyleSheetTextResult>

/**
 * Returns all supported CSS property names.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetSupportedCSSPropertiesResult {
  /**
   * Supported property metainfo.
   */
  readonly cssProperties: ReadonlyArray<CSSPropertyInfo>
}

/**
 * Schema for `GetSupportedCSSPropertiesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetSupportedCSSPropertiesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    cssProperties: Schema.Array(CSSPropertyInfo)
  }).annotate({ identifier: "CSS.GetSupportedCSSPropertiesResult" })
) as any as Schema.Codec<GetSupportedCSSPropertiesResult>

/**
 * Returns all supported system font family names.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GetSupportedSystemFontFamilyNamesResult {
  /**
   * Supported system font families.
   */
  readonly fontFamilyNames: ReadonlyArray<string>
}

/**
 * Schema for `GetSupportedSystemFontFamilyNamesResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GetSupportedSystemFontFamilyNamesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    fontFamilyNames: Schema.Array(Schema.String)
  }).annotate({ identifier: "CSS.GetSupportedSystemFontFamilyNamesResult" })
) as any as Schema.Codec<GetSupportedSystemFontFamilyNamesResult>

/**
 * Called when the layout of a node changes in a way that is important to Web Inspector.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NodeLayoutFlagsChangedParams {
  /**
   * Identifier of the node whose layout changed.
   */
  readonly nodeId: DOM.NodeId
  /**
   * Relevant information about the layout of the node. When not provided, the layout of the node is not important to Web Inspector.
   */
  readonly layoutFlags?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `NodeLayoutFlagsChangedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NodeLayoutFlagsChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    nodeId: DOM.NodeId,
    layoutFlags: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "CSS.NodeLayoutFlagsChangedParams" })
) as any as Schema.Codec<NodeLayoutFlagsChangedParams>

/**
 * Modifies an \@rule grouping's header text.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetGroupingHeaderTextParams {
  readonly ruleId: CSSRuleId
  readonly headerText: string
}

/**
 * Schema for `SetGroupingHeaderTextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetGroupingHeaderTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ruleId: CSSRuleId,
    headerText: Schema.String
  }).annotate({ identifier: "CSS.SetGroupingHeaderTextParams" })
) as any as Schema.Codec<SetGroupingHeaderTextParams>

/**
 * Modifies an \@rule grouping's header text.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetGroupingHeaderTextResult {
  /**
   * The resulting grouping after the header text modification.
   */
  readonly grouping: Grouping
}

/**
 * Schema for `SetGroupingHeaderTextResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetGroupingHeaderTextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    grouping: Grouping
  }).annotate({ identifier: "CSS.SetGroupingHeaderTextResult" })
) as any as Schema.Codec<SetGroupingHeaderTextResult>

/**
 * Change how layout context type changes are handled for nodes. When the new mode would observe nodes the frontend has not yet recieved, those nodes will be sent to the frontend immediately.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetLayoutContextTypeChangedModeParams {
  /**
   * The mode for how layout context type changes are handled.
   */
  readonly mode: LayoutContextTypeChangedMode
}

/**
 * Schema for `SetLayoutContextTypeChangedModeParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetLayoutContextTypeChangedModeParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    mode: LayoutContextTypeChangedMode
  }).annotate({ identifier: "CSS.SetLayoutContextTypeChangedModeParams" })
) as any as Schema.Codec<SetLayoutContextTypeChangedModeParams>

/**
 * Modifies the rule selector.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetRuleSelectorParams {
  readonly ruleId: CSSRuleId
  readonly selector: string
}

/**
 * Schema for `SetRuleSelectorParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetRuleSelectorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    ruleId: CSSRuleId,
    selector: Schema.String
  }).annotate({ identifier: "CSS.SetRuleSelectorParams" })
) as any as Schema.Codec<SetRuleSelectorParams>

/**
 * Modifies the rule selector.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetRuleSelectorResult {
  /**
   * The resulting rule after the selector modification.
   */
  readonly rule: CSSRule
}

/**
 * Schema for `SetRuleSelectorResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetRuleSelectorResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    rule: CSSRule
  }).annotate({ identifier: "CSS.SetRuleSelectorResult" })
) as any as Schema.Codec<SetRuleSelectorResult>

/**
 * Sets the new stylesheet text, thereby invalidating all existing <code>CSSStyleId</code>'s and <code>CSSRuleId</code>'s contained by this stylesheet.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetStyleSheetTextParams {
  readonly styleSheetId: StyleSheetId
  readonly text: string
}

/**
 * Schema for `SetStyleSheetTextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetStyleSheetTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: StyleSheetId,
    text: Schema.String
  }).annotate({ identifier: "CSS.SetStyleSheetTextParams" })
) as any as Schema.Codec<SetStyleSheetTextParams>

/**
 * Sets the new <code>text</code> for the respective style.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetStyleTextParams {
  readonly styleId: CSSStyleId
  readonly text: string
}

/**
 * Schema for `SetStyleTextParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetStyleTextParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleId: CSSStyleId,
    text: Schema.String
  }).annotate({ identifier: "CSS.SetStyleTextParams" })
) as any as Schema.Codec<SetStyleTextParams>

/**
 * Sets the new <code>text</code> for the respective style.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetStyleTextResult {
  /**
   * The resulting style after the text modification.
   */
  readonly style: CSSStyle
}

/**
 * Schema for `SetStyleTextResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetStyleTextResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    style: CSSStyle
  }).annotate({ identifier: "CSS.SetStyleTextResult" })
) as any as Schema.Codec<SetStyleTextResult>

/**
 * Fired whenever an active document stylesheet is added.
 *
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StyleSheetChangedParams {
  readonly styleSheetId: StyleSheetId
}

/**
 * Schema for `StyleSheetChangedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StyleSheetChangedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: StyleSheetId
  }).annotate({ identifier: "CSS.StyleSheetChangedParams" })
) as any as Schema.Codec<StyleSheetChangedParams>

/**
 * Fired whenever an active document stylesheet is removed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StyleSheetRemovedParams {
  /**
   * Identifier of the removed stylesheet.
   */
  readonly styleSheetId: StyleSheetId
}

/**
 * Schema for `StyleSheetRemovedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StyleSheetRemovedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    styleSheetId: StyleSheetId
  }).annotate({ identifier: "CSS.StyleSheetRemovedParams" })
) as any as Schema.Codec<StyleSheetRemovedParams>

/**
 * Creates a new empty rule with the given <code>selector</code> in a stylesheet with given <code>styleSheetId</code>.
 *
 * @stability unstable
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
 * Creates a new special "inspector" stylesheet in the frame with given <code>frameId</code>.
 *
 * @stability unstable
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
 * @stability unstable
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
 * Enables the CSS agent for the given page. Clients should not assume that the CSS agent has been enabled until the result of this command is received.
 *
 * @stability unstable
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
 * Ensures that the given node will have specified pseudo-classes whenever its style is computed by the browser.
 *
 * @stability unstable
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
 * Returns metainfo entries for all known stylesheets.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getAllStyleSheets: Protocol.CommandDef<"CSS.getAllStyleSheets", void, GetAllStyleSheetsResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.getAllStyleSheets",
    undefined,
    GetAllStyleSheetsResult,
    { status: "stable" }
  )

/**
 * Returns the computed style for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
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
 * Returns the primary font of the computed font cascade for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getFontDataForNode: Protocol.CommandDef<
  "CSS.getFontDataForNode",
  GetFontDataForNodeParams,
  GetFontDataForNodeResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getFontDataForNode",
  GetFontDataForNodeParams,
  GetFontDataForNodeResult,
  { status: "stable" }
)

/**
 * Returns the styles defined inline (explicitly in the "style" attribute and implicitly, using DOM attributes) for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
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
 * Returns requested styles for a DOM node identified by <code>nodeId</code>.
 *
 * @stability unstable
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
 * Returns stylesheet data for the specified <code>styleSheetId</code>.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getStyleSheet: Protocol.CommandDef<"CSS.getStyleSheet", GetStyleSheetParams, GetStyleSheetResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.getStyleSheet",
    GetStyleSheetParams,
    GetStyleSheetResult,
    { status: "stable" }
  )

/**
 * Returns the current textual content and the URL for a stylesheet.
 *
 * @stability unstable
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
 * Returns all supported CSS property names.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getSupportedCSSProperties: Protocol.CommandDef<
  "CSS.getSupportedCSSProperties",
  void,
  GetSupportedCSSPropertiesResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getSupportedCSSProperties",
  undefined,
  GetSupportedCSSPropertiesResult,
  { status: "stable" }
)

/**
 * Returns all supported system font family names.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const getSupportedSystemFontFamilyNames: Protocol.CommandDef<
  "CSS.getSupportedSystemFontFamilyNames",
  void,
  GetSupportedSystemFontFamilyNamesResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.getSupportedSystemFontFamilyNames",
  undefined,
  GetSupportedSystemFontFamilyNamesResult,
  { status: "stable" }
)

/**
 * Modifies an \@rule grouping's header text.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setGroupingHeaderText: Protocol.CommandDef<
  "CSS.setGroupingHeaderText",
  SetGroupingHeaderTextParams,
  SetGroupingHeaderTextResult
> = /*#__PURE__*/ Protocol.command(
  "CSS.setGroupingHeaderText",
  SetGroupingHeaderTextParams,
  SetGroupingHeaderTextResult,
  { status: "stable" }
)

/**
 * Change how layout context type changes are handled for nodes. When the new mode would observe nodes the frontend has not yet recieved, those nodes will be sent to the frontend immediately.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setLayoutContextTypeChangedMode: Protocol.CommandDef<
  "CSS.setLayoutContextTypeChangedMode",
  SetLayoutContextTypeChangedModeParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "CSS.setLayoutContextTypeChangedMode",
  SetLayoutContextTypeChangedModeParams,
  undefined,
  { status: "stable" }
)

/**
 * Modifies the rule selector.
 *
 * @stability unstable
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
 * Sets the new stylesheet text, thereby invalidating all existing <code>CSSStyleId</code>'s and <code>CSSRuleId</code>'s contained by this stylesheet.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setStyleSheetText: Protocol.CommandDef<"CSS.setStyleSheetText", SetStyleSheetTextParams, void> =
  /*#__PURE__*/ Protocol.command(
    "CSS.setStyleSheetText",
    SetStyleSheetTextParams,
    undefined,
    { status: "stable" }
  )

/**
 * Sets the new <code>text</code> for the respective style.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setStyleText: Protocol.CommandDef<"CSS.setStyleText", SetStyleTextParams, SetStyleTextResult> =
  /*#__PURE__*/ Protocol.command(
    "CSS.setStyleText",
    SetStyleTextParams,
    SetStyleTextResult,
    { status: "stable" }
  )

/**
 * Fires whenever a MediaQuery result changes (for example, after a browser window has been resized.) The current implementation considers only viewport-dependent media features.
 *
 * @stability unstable
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
 * Called when the layout of a node changes in a way that is important to Web Inspector.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const nodeLayoutFlagsChanged: Protocol.EventDef<"CSS.nodeLayoutFlagsChanged", NodeLayoutFlagsChangedParams> =
  /*#__PURE__*/ Protocol.event(
    "CSS.nodeLayoutFlagsChanged",
    NodeLayoutFlagsChangedParams,
    { status: "stable" }
  )

/**
 * Fired whenever an active document stylesheet is added.
 *
 * @stability unstable
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
 * @stability unstable
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
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const styleSheetRemoved: Protocol.EventDef<"CSS.styleSheetRemoved", StyleSheetRemovedParams> =
  /*#__PURE__*/ Protocol.event(
    "CSS.styleSheetRemoved",
    StyleSheetRemovedParams,
    { status: "stable" }
  )
