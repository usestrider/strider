/**
 * The common module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08). Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * `ErrorCode` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ErrorCode =
  | "invalid argument"
  | "invalid selector"
  | "invalid session id"
  | "invalid web extension"
  | "move target out of bounds"
  | "no such alert"
  | "no such network collector"
  | "no such element"
  | "no such frame"
  | "no such handle"
  | "no such history entry"
  | "no such intercept"
  | "no such network data"
  | "no such node"
  | "no such request"
  | "no such screencast"
  | "no such script"
  | "no such storage partition"
  | "no such user context"
  | "no such web extension"
  | "session not created"
  | "unable to capture screen"
  | "unable to close browser"
  | "unable to set cookie"
  | "unable to set file input"
  | "unavailable network data"
  | "underspecified storage partition"
  | "unknown command"
  | "unknown error"
  | "unsupported operation"
  | (string & {})

/**
 * Schema for `ErrorCode`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ErrorCode = Schema.String as any as Schema.Codec<ErrorCode>
