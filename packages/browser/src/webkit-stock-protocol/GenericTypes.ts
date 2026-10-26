/**
 * Exposes generic types to be used by any domain.
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit-stock`) and run `pnpm codegen:protocol`.
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
