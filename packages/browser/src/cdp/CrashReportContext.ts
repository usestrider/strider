/**
 * This domain exposes the current state of the CrashReportContext API.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Page from "./Page.ts"

/**
 * Key-value pair in CrashReportContext.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CrashReportContextEntry {
  readonly key: string
  readonly value: string
  /**
   * The ID of the frame where the key-value pair was set.
   */
  readonly frameId: Page.FrameId
}

/**
 * Schema for `CrashReportContextEntry`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CrashReportContextEntry = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    key: Schema.String,
    value: Schema.String,
    frameId: Page.FrameId
  }).annotate({ identifier: "CrashReportContext.CrashReportContextEntry" })
) as any as Schema.Codec<CrashReportContextEntry>

/**
 * Returns all entries in the CrashReportContext across all frames in the page.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetEntriesResult {
  readonly entries: ReadonlyArray<CrashReportContextEntry>
}

/**
 * Schema for `GetEntriesResult`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetEntriesResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    entries: Schema.Array(CrashReportContextEntry)
  }).annotate({ identifier: "CrashReportContext.GetEntriesResult" })
) as any as Schema.Codec<GetEntriesResult>

/**
 * Returns all entries in the CrashReportContext across all frames in the page.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const getEntries: Protocol.CommandDef<"CrashReportContext.getEntries", void, GetEntriesResult> =
  /*#__PURE__*/ Protocol.command(
    "CrashReportContext.getEntries",
    undefined,
    GetEntriesResult,
    { status: "stable" }
  )
