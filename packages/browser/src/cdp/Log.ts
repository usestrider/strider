/**
 * Provides access to log entries.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Network from "./Network.ts"
import * as Runtime from "./Runtime.ts"

/**
 * Log entry.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface LogEntry {
  /**
   * Log entry source.
   */
  readonly source: LogEntrySource
  /**
   * Log entry severity.
   */
  readonly level: LogEntryLevel
  /**
   * Logged text.
   */
  readonly text: string
  readonly category?: LogEntryCategory | undefined
  /**
   * Timestamp when this entry was added.
   */
  readonly timestamp: Runtime.Timestamp
  /**
   * URL of the resource if known.
   */
  readonly url?: string | undefined
  /**
   * Line number in the resource.
   */
  readonly lineNumber?: number | undefined
  /**
   * JavaScript stack trace.
   */
  readonly stackTrace?: Runtime.StackTrace | undefined
  /**
   * Identifier of the network request associated with this entry.
   */
  readonly networkRequestId?: Network.RequestId | undefined
  /**
   * Identifier of the worker associated with this entry.
   */
  readonly workerId?: string | undefined
  /**
   * Call arguments.
   */
  readonly args?: ReadonlyArray<Runtime.RemoteObject> | undefined
}

/**
 * Schema for `LogEntry`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LogEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    source: LogEntrySource,
    level: LogEntryLevel,
    text: Schema.String,
    category: Schema.optional(LogEntryCategory),
    timestamp: Runtime.Timestamp,
    url: Schema.optional(Schema.String),
    lineNumber: Schema.optional(Schema.Int),
    stackTrace: Schema.optional(Runtime.StackTrace),
    networkRequestId: Schema.optional(Network.RequestId),
    workerId: Schema.optional(Schema.String),
    args: Schema.optional(Schema.Array(Runtime.RemoteObject))
  }).annotate({ identifier: "Log.LogEntry" })
) as any as Schema.Codec<LogEntry>

/**
 * `LogEntry.category` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LogEntryCategory =
  | "cors"
  | (string & {})

/**
 * Schema for `LogEntryCategory`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LogEntryCategory = Schema.String as any as Schema.Codec<LogEntryCategory>

/**
 * Log entry severity.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LogEntryLevel =
  | "verbose"
  | "info"
  | "warning"
  | "error"
  | (string & {})

/**
 * Schema for `LogEntryLevel`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LogEntryLevel = Schema.String as any as Schema.Codec<LogEntryLevel>

/**
 * Log entry source.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type LogEntrySource =
  | "xml"
  | "javascript"
  | "network"
  | "storage"
  | "appcache"
  | "rendering"
  | "security"
  | "deprecation"
  | "worker"
  | "violation"
  | "intervention"
  | "recommendation"
  | "other"
  | (string & {})

/**
 * Schema for `LogEntrySource`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const LogEntrySource = Schema.String as any as Schema.Codec<LogEntrySource>

/**
 * Violation configuration setting.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ViolationSetting {
  /**
   * Violation type.
   */
  readonly name: ViolationSettingName
  /**
   * Time threshold to trigger upon.
   */
  readonly threshold: number
}

/**
 * Schema for `ViolationSetting`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ViolationSetting = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: ViolationSettingName,
    threshold: Schema.Number
  }).annotate({ identifier: "Log.ViolationSetting" })
) as any as Schema.Codec<ViolationSetting>

/**
 * Violation type.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ViolationSettingName =
  | "longTask"
  | "longLayout"
  | "blockedEvent"
  | "blockedParser"
  | "discouragedAPIUse"
  | "handler"
  | "recurringHandler"
  | (string & {})

/**
 * Schema for `ViolationSettingName`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ViolationSettingName = Schema.String as any as Schema.Codec<ViolationSettingName>

/**
 * Issued when new message was logged.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface EntryAddedParams {
  /**
   * The entry.
   */
  readonly entry: LogEntry
}

/**
 * Schema for `EntryAddedParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EntryAddedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    entry: LogEntry
  }).annotate({ identifier: "Log.EntryAddedParams" })
) as any as Schema.Codec<EntryAddedParams>

/**
 * start violation reporting.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface StartViolationsReportParams {
  /**
   * Configuration for violations.
   */
  readonly config: ReadonlyArray<ViolationSetting>
}

/**
 * Schema for `StartViolationsReportParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StartViolationsReportParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    config: Schema.Array(ViolationSetting)
  }).annotate({ identifier: "Log.StartViolationsReportParams" })
) as any as Schema.Codec<StartViolationsReportParams>

/**
 * Clears the log.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const clear: Protocol.CommandDef<"Log.clear", void, void> = /*#__PURE__*/ Protocol.command(
  "Log.clear",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Disables log domain, prevents further log entries from being reported to the client.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Log.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Log.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables log domain, sends the entries collected so far to the client by means of the
 * `entryAdded` notification.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Log.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Log.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * start violation reporting.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const startViolationsReport: Protocol.CommandDef<
  "Log.startViolationsReport",
  StartViolationsReportParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Log.startViolationsReport",
  StartViolationsReportParams,
  undefined,
  { status: "stable" }
)

/**
 * Stop violation reporting.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const stopViolationsReport: Protocol.CommandDef<"Log.stopViolationsReport", void, void> = /*#__PURE__*/ Protocol
  .command(
    "Log.stopViolationsReport",
    undefined,
    undefined,
    { status: "stable" }
  )

/**
 * Issued when new message was logged.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const entryAdded: Protocol.EventDef<"Log.entryAdded", EntryAddedParams> = /*#__PURE__*/ Protocol.event(
  "Log.entryAdded",
  EntryAddedParams,
  { status: "stable" }
)
