/**
 * The log module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08). Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Script from "./Script.ts"

/**
 * `ConsoleLogEntry`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ConsoleLogEntry {
  readonly level: Level
  readonly source: Script.Source
  readonly text: string | null
  readonly timestamp: number
  readonly stackTrace?: Script.StackTrace | undefined
  readonly type: "console"
  readonly method: string
  readonly args: ReadonlyArray<Script.RemoteValue>
}

/**
 * Schema for `ConsoleLogEntry`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ConsoleLogEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    level: Level,
    source: Script.Source,
    text: Schema.Union([Schema.String, Schema.Null]),
    timestamp: Schema.Int,
    stackTrace: Schema.optional(Script.StackTrace),
    type: Schema.Literal("console"),
    method: Schema.String,
    args: Schema.Array(Script.RemoteValue)
  }).annotate({ identifier: "log.ConsoleLogEntry" })
) as any as Schema.Codec<ConsoleLogEntry>

/**
 * `Entry`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Entry = GenericLogEntry | ConsoleLogEntry | JavascriptLogEntry

/**
 * Schema for `Entry`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Entry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([ConsoleLogEntry, JavascriptLogEntry, GenericLogEntry])
) as any as Schema.Codec<Entry>

/**
 * `GenericLogEntry`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GenericLogEntry {
  readonly level: Level
  readonly source: Script.Source
  readonly text: string | null
  readonly timestamp: number
  readonly stackTrace?: Script.StackTrace | undefined
  readonly type: string
}

/**
 * Schema for `GenericLogEntry`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const GenericLogEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    level: Level,
    source: Script.Source,
    text: Schema.Union([Schema.String, Schema.Null]),
    timestamp: Schema.Int,
    stackTrace: Schema.optional(Script.StackTrace),
    type: Schema.String
  }).annotate({ identifier: "log.GenericLogEntry" })
) as any as Schema.Codec<GenericLogEntry>

/**
 * `JavascriptLogEntry`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface JavascriptLogEntry {
  readonly level: Level
  readonly source: Script.Source
  readonly text: string | null
  readonly timestamp: number
  readonly stackTrace?: Script.StackTrace | undefined
  readonly type: "javascript"
}

/**
 * Schema for `JavascriptLogEntry`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const JavascriptLogEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    level: Level,
    source: Script.Source,
    text: Schema.Union([Schema.String, Schema.Null]),
    timestamp: Schema.Int,
    stackTrace: Schema.optional(Script.StackTrace),
    type: Schema.Literal("javascript")
  }).annotate({ identifier: "log.JavascriptLogEntry" })
) as any as Schema.Codec<JavascriptLogEntry>

/**
 * `Level` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Level =
  | "debug"
  | "info"
  | "warn"
  | "error"
  | (string & {})

/**
 * Schema for `Level`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Level = Schema.String as any as Schema.Codec<Level>

/**
 * The `log.entryAdded` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const entryAdded: Protocol.EventDef<"log.entryAdded", Entry> = /*#__PURE__*/ Protocol.event(
  "log.entryAdded",
  Entry,
  { status: "stable" }
)
