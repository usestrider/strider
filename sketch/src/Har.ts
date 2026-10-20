/**
 * HAR recordings: a page's or context's network traffic, exported as an HTTP Archive.
 *
 * Exports are redacted unless a class of secret is included by name. Replaying a HAR is deferred: mocking is
 * the job of `route`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as FilePath from "./FilePath.ts"
import type * as Page from "./Page.ts"
import * as Reason from "./Reason.ts"
import type * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"
import type * as Watchable from "./Watchable.ts"

/**
 * A class of secret that an export can include on request.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SecretClass = "credentials" | "cookies" | "authorizationHeaders" | "typedText"

/**
 * What a HAR records.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Options {
  /**
   * Bodies embedded in the HAR, attached beside it, or left out. Required: never inferred from a file
   * extension.
   */
  readonly content: "embed" | "attach" | "omit"
  /**
   * Full entries, or only what tools need to show a timeline.
   *
   * @default "full"
   */
  readonly detail?: "full" | "minimal" | undefined
  /**
   * Record only requests to matching URLs.
   *
   * @default every request
   */
  readonly url?: Url.Pattern | string | undefined
  /**
   * Record WebSocket frames; unsupported on BiDi.
   *
   * @default false
   */
  readonly webSocketFrames?: boolean | undefined
  /**
   * Whether stopping waits for requests still in flight. Stopping never waits unless asked.
   *
   * @default "markIncomplete"
   */
  readonly inFlightAtStop?: "wait" | "markIncomplete" | undefined
}

/**
 * Settings for exporting a HAR.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ExportOptions {
  /**
   * Classes of secret to write out in full.
   *
   * @default none: everything classified is redacted
   */
  readonly include?: ReadonlyArray<SecretClass> | undefined
}

/**
 * A HAR being recorded; stopped by `remove` or when its scope closes.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Recording extends Declaration.Registration {
  /**
   * How many entries are recorded so far.
   */
  readonly entries: Watchable.Watchable<number>
  /**
   * Writes the HAR, redacted unless classes are included.
   */
  exportHar(path: FilePath.Local | string, options?: ExportOptions | undefined): Effect.Effect<FilePath.Local, HarError>
}

/**
 * Starts recording a HAR of a page or context while its scope lives.
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export declare const record: (
  target: UserContext.UserContext | Page.Page,
  options: Options
) => Effect.Effect<Recording, HarError, Scope.Scope>

/**
 * Reason for a HAR that couldn't be written.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class WriteFailed extends Schema.Error<WriteFailed>("effect-browser/Har/WriteFailed")({
  _tag: Schema.tag("WriteFailed"),
  path: Schema.String,
  hint: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {
  override get message(): string {
    return `Couldn't write ${this.path} (${this.hint})`
  }
}

/**
 * Schema for the reasons recording or exporting a HAR can fail.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const HarErrorReason = Schema.Union([WriteFailed, Reason.NotPermitted, Reason.Unsupported, Reason.BackendFailure])

/**
 * The reasons recording or exporting a HAR can fail.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type HarErrorReason = typeof HarErrorReason.Type

const HarErrorTypeId = "~effect-browser/Har/HarError"

/**
 * Error for a HAR that couldn't be recorded or exported.
 *
 * @stability experimental
 * @category errors
 * @since 0.1.0
 */
export class HarError extends Schema.TaggedError<HarError>(HarErrorTypeId)("HarError", {
  reason: HarErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [HarErrorTypeId] = HarErrorTypeId
  override get message(): string {
    return this.reason.message
  }
}

/**
 * Checks whether a value is a `HarError`.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isHarError = (u: unknown): u is HarError => Predicate.hasProperty(u, HarErrorTypeId)
