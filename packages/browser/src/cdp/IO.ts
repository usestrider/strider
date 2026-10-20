/**
 * Input/Output operations for streams produced by DevTools.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Runtime from "./Runtime.ts"

/**
 * This is either obtained from another method or specified as `blob:<uuid>` where
 * `<uuid>` is an UUID of a Blob.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type StreamHandle = Brand.Branded<string, "~@usestrider/browser/cdp/IO/StreamHandle">

/**
 * Schema for `StreamHandle`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StreamHandle = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/cdp/IO/StreamHandle")
) as any as Schema.Codec<StreamHandle>

/**
 * Close the stream, discard any temporary backing storage.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CloseParams {
  /**
   * Handle of the stream to close.
   */
  readonly handle: StreamHandle
}

/**
 * Schema for `CloseParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CloseParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: StreamHandle
  }).annotate({ identifier: "IO.CloseParams" })
) as any as Schema.Codec<CloseParams>

/**
 * Read a chunk of the stream
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReadParams {
  /**
   * Handle of the stream to read.
   */
  readonly handle: StreamHandle
  /**
   * Seek to the specified offset before reading (if not specified, proceed with offset
   * following the last read). Some types of streams may only support sequential reads.
   */
  readonly offset?: number | undefined
  /**
   * Maximum number of bytes to read (left upon the agent discretion if not specified).
   */
  readonly size?: number | undefined
}

/**
 * Schema for `ReadParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReadParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    handle: StreamHandle,
    offset: Schema.optional(Schema.Int),
    size: Schema.optional(Schema.Int)
  }).annotate({ identifier: "IO.ReadParams" })
) as any as Schema.Codec<ReadParams>

/**
 * Read a chunk of the stream
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReadResult {
  /**
   * Set if the data is base64-encoded
   */
  readonly base64Encoded?: boolean | undefined
  /**
   * Data that were read.
   */
  readonly data: string
  /**
   * Set if the end-of-file condition occurred while reading.
   */
  readonly eof: boolean
}

/**
 * Schema for `ReadResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ReadResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    base64Encoded: Schema.optional(Schema.Boolean),
    data: Schema.String,
    eof: Schema.Boolean
  }).annotate({ identifier: "IO.ReadResult" })
) as any as Schema.Codec<ReadResult>

/**
 * Return UUID of Blob object specified by a remote object id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveBlobParams {
  /**
   * Object id of a Blob object wrapper.
   */
  readonly objectId: Runtime.RemoteObjectId
}

/**
 * Schema for `ResolveBlobParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveBlobParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    objectId: Runtime.RemoteObjectId
  }).annotate({ identifier: "IO.ResolveBlobParams" })
) as any as Schema.Codec<ResolveBlobParams>

/**
 * Return UUID of Blob object specified by a remote object id.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ResolveBlobResult {
  /**
   * UUID of the specified Blob.
   */
  readonly uuid: string
}

/**
 * Schema for `ResolveBlobResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ResolveBlobResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    uuid: Schema.String
  }).annotate({ identifier: "IO.ResolveBlobResult" })
) as any as Schema.Codec<ResolveBlobResult>

/**
 * Close the stream, discard any temporary backing storage.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const close: Protocol.CommandDef<"IO.close", CloseParams, void> = /*#__PURE__*/ Protocol.command(
  "IO.close",
  CloseParams,
  undefined,
  { status: "stable" }
)

/**
 * Read a chunk of the stream
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const read: Protocol.CommandDef<"IO.read", ReadParams, ReadResult> = /*#__PURE__*/ Protocol.command(
  "IO.read",
  ReadParams,
  ReadResult,
  { status: "stable" }
)

/**
 * Return UUID of Blob object specified by a remote object id.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const resolveBlob: Protocol.CommandDef<"IO.resolveBlob", ResolveBlobParams, ResolveBlobResult> =
  /*#__PURE__*/ Protocol.command(
    "IO.resolveBlob",
    ResolveBlobParams,
    ResolveBlobResult,
    { status: "stable" }
  )
