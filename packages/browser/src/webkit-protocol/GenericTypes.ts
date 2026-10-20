/**
 * Exposes generic types to be used by any domain.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * Search match in a resource.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SearchMatch {
  /**
   * Line number in resource content.
   */
  readonly lineNumber: number
  /**
   * Line with match content.
   */
  readonly lineContent: string
}

/**
 * Schema for `SearchMatch`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SearchMatch = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    lineNumber: Schema.Number,
    lineContent: Schema.String
  }).annotate({ identifier: "GenericTypes.SearchMatch" })
) as any as Schema.Codec<SearchMatch>

/**
 * A two-dimensional size.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Size {
  readonly width: number
  readonly height: number
}

/**
 * Schema for `Size`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Size = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    width: Schema.Number,
    height: Schema.Number
  }).annotate({ identifier: "GenericTypes.Size" })
) as any as Schema.Codec<Size>
