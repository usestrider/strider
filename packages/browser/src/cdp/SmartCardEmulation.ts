/**
 * The SmartCardEmulation domain.
 *
 * Generated from the Chrome DevTools Protocol, devtools-protocol 0.0.1696802 (Chrome 155). Don't edit: correct the model (`packages/tools/codegen/protocols/cdp`) and run `pnpm codegen:protocol`.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol_ from "../protocol/Protocol.ts"

/**
 * Maps to |SCARD_*| connection state values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ConnectionState =
  | "absent"
  | "present"
  | "swallowed"
  | "powered"
  | "negotiable"
  | "specific"
  | (string & {})

/**
 * Schema for `ConnectionState`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ConnectionState = Schema.String as any as Schema.Codec<ConnectionState>

/**
 * Indicates what the reader should do with the card.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Disposition =
  | "leave-card"
  | "reset-card"
  | "unpower-card"
  | "eject-card"
  | (string & {})

/**
 * Schema for `Disposition`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Disposition = Schema.String as any as Schema.Codec<Disposition>

/**
 * Maps to the |SCARD_PROTOCOL_*| values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Protocol =
  | "t0"
  | "t1"
  | "raw"
  | (string & {})

/**
 * Schema for `Protocol`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Protocol = Schema.String as any as Schema.Codec<Protocol>

/**
 * Maps to the |SCARD_PROTOCOL_*| flags.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ProtocolSet {
  readonly t0?: boolean | undefined
  readonly t1?: boolean | undefined
  readonly raw?: boolean | undefined
}

/**
 * Schema for `ProtocolSet`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ProtocolSet = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    t0: Schema.optional(Schema.Boolean),
    t1: Schema.optional(Schema.Boolean),
    raw: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "SmartCardEmulation.ProtocolSet" })
) as any as Schema.Codec<ProtocolSet>

/**
 * Maps to the |SCARD_STATE_*| flags.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReaderStateFlags {
  readonly unaware?: boolean | undefined
  readonly ignore?: boolean | undefined
  readonly changed?: boolean | undefined
  readonly unknown?: boolean | undefined
  readonly unavailable?: boolean | undefined
  readonly empty?: boolean | undefined
  readonly present?: boolean | undefined
  readonly exclusive?: boolean | undefined
  readonly inuse?: boolean | undefined
  readonly mute?: boolean | undefined
  readonly unpowered?: boolean | undefined
}

/**
 * Schema for `ReaderStateFlags`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReaderStateFlags = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    unaware: Schema.optional(Schema.Boolean),
    ignore: Schema.optional(Schema.Boolean),
    changed: Schema.optional(Schema.Boolean),
    unknown: Schema.optional(Schema.Boolean),
    unavailable: Schema.optional(Schema.Boolean),
    empty: Schema.optional(Schema.Boolean),
    present: Schema.optional(Schema.Boolean),
    exclusive: Schema.optional(Schema.Boolean),
    inuse: Schema.optional(Schema.Boolean),
    mute: Schema.optional(Schema.Boolean),
    unpowered: Schema.optional(Schema.Boolean)
  }).annotate({ identifier: "SmartCardEmulation.ReaderStateFlags" })
) as any as Schema.Codec<ReaderStateFlags>

/**
 * `ReaderStateIn`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReaderStateIn {
  readonly reader: string
  readonly currentState: ReaderStateFlags
  readonly currentInsertionCount: number
}

/**
 * Schema for `ReaderStateIn`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReaderStateIn = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    reader: Schema.String,
    currentState: ReaderStateFlags,
    currentInsertionCount: Schema.Int
  }).annotate({ identifier: "SmartCardEmulation.ReaderStateIn" })
) as any as Schema.Codec<ReaderStateIn>

/**
 * `ReaderStateOut`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReaderStateOut {
  readonly reader: string
  readonly eventState: ReaderStateFlags
  readonly eventCount: number
  readonly atr: string
}

/**
 * Schema for `ReaderStateOut`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReaderStateOut = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    reader: Schema.String,
    eventState: ReaderStateFlags,
    eventCount: Schema.Int,
    atr: Schema.String
  }).annotate({ identifier: "SmartCardEmulation.ReaderStateOut" })
) as any as Schema.Codec<ReaderStateOut>

/**
 * Indicates the PC/SC error code.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__ErrorCodes.html
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/secauthn/authentication-return-values
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ResultCode =
  | "success"
  | "removed-card"
  | "reset-card"
  | "unpowered-card"
  | "unresponsive-card"
  | "unsupported-card"
  | "reader-unavailable"
  | "sharing-violation"
  | "not-transacted"
  | "no-smartcard"
  | "proto-mismatch"
  | "system-cancelled"
  | "not-ready"
  | "cancelled"
  | "insufficient-buffer"
  | "invalid-handle"
  | "invalid-parameter"
  | "invalid-value"
  | "no-memory"
  | "timeout"
  | "unknown-reader"
  | "unsupported-feature"
  | "no-readers-available"
  | "service-stopped"
  | "no-service"
  | "comm-error"
  | "internal-error"
  | "server-too-busy"
  | "unexpected"
  | "shutdown"
  | "unknown-card"
  | "unknown"
  | (string & {})

/**
 * Schema for `ResultCode`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ResultCode = Schema.String as any as Schema.Codec<ResultCode>

/**
 * Maps to the |SCARD_SHARE_*| values.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ShareMode =
  | "shared"
  | "exclusive"
  | "direct"
  | (string & {})

/**
 * Schema for `ShareMode`: known values, and any other string.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ShareMode = Schema.String as any as Schema.Codec<ShareMode>

/**
 * Fired when |SCardBeginTransaction| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaddb835dce01a0da1d6ca02d33ee7d861
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardbegintransaction
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BeginTransactionRequestedParams {
  readonly requestId: string
  readonly handle: number
}

/**
 * Schema for `BeginTransactionRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const BeginTransactionRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    handle: Schema.Int
  }).annotate({ identifier: "SmartCardEmulation.BeginTransactionRequestedParams" })
) as any as Schema.Codec<BeginTransactionRequestedParams>

/**
 * Fired when |SCardCancel| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacbbc0c6d6c0cbbeb4f4debf6fbeeee6
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcancel
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CancelRequestedParams {
  readonly requestId: string
  readonly contextId: number
}

/**
 * Schema for `CancelRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const CancelRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    contextId: Schema.Int
  }).annotate({ identifier: "SmartCardEmulation.CancelRequestedParams" })
) as any as Schema.Codec<CancelRequestedParams>

/**
 * Fired when |SCardConnect| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4e515829752e0a8dbc4d630696a8d6a5
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardconnecta
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ConnectRequestedParams {
  readonly requestId: string
  readonly contextId: number
  readonly reader: string
  readonly shareMode: ShareMode
  readonly preferredProtocols: ProtocolSet
}

/**
 * Schema for `ConnectRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ConnectRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    contextId: Schema.Int,
    reader: Schema.String,
    shareMode: ShareMode,
    preferredProtocols: ProtocolSet
  }).annotate({ identifier: "SmartCardEmulation.ConnectRequestedParams" })
) as any as Schema.Codec<ConnectRequestedParams>

/**
 * Fired when |SCardControl| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gac3454d4657110fd7f753b2d3d8f4e32f
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcontrol
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ControlRequestedParams {
  readonly requestId: string
  readonly handle: number
  readonly controlCode: number
  readonly data: string
}

/**
 * Schema for `ControlRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ControlRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    handle: Schema.Int,
    controlCode: Schema.Int,
    data: Schema.String
  }).annotate({ identifier: "SmartCardEmulation.ControlRequestedParams" })
) as any as Schema.Codec<ControlRequestedParams>

/**
 * Fired when |SCardDisconnect| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4be198045c73ec0deb79e66c0ca1738a
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scarddisconnect
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface DisconnectRequestedParams {
  readonly requestId: string
  readonly handle: number
  readonly disposition: Disposition
}

/**
 * Schema for `DisconnectRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const DisconnectRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    handle: Schema.Int,
    disposition: Disposition
  }).annotate({ identifier: "SmartCardEmulation.DisconnectRequestedParams" })
) as any as Schema.Codec<DisconnectRequestedParams>

/**
 * Fired when |SCardEndTransaction| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae8742473b404363e5c587f570d7e2f3b
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardendtransaction
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EndTransactionRequestedParams {
  readonly requestId: string
  readonly handle: number
  readonly disposition: Disposition
}

/**
 * Schema for `EndTransactionRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EndTransactionRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    handle: Schema.Int,
    disposition: Disposition
  }).annotate({ identifier: "SmartCardEmulation.EndTransactionRequestedParams" })
) as any as Schema.Codec<EndTransactionRequestedParams>

/**
 * Fired when |SCardEstablishContext| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaa1b8970169fd4883a6dc4a8f43f19b67
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardestablishcontext
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface EstablishContextRequestedParams {
  readonly requestId: string
}

/**
 * Schema for `EstablishContextRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const EstablishContextRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String
  }).annotate({ identifier: "SmartCardEmulation.EstablishContextRequestedParams" })
) as any as Schema.Codec<EstablishContextRequestedParams>

/**
 * Fired when |SCardGetAttrib| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacfec51917255b7a25b94c5104961602
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetattrib
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetAttribRequestedParams {
  readonly requestId: string
  readonly handle: number
  readonly attribId: number
}

/**
 * Schema for `GetAttribRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetAttribRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    handle: Schema.Int,
    attribId: Schema.Int
  }).annotate({ identifier: "SmartCardEmulation.GetAttribRequestedParams" })
) as any as Schema.Codec<GetAttribRequestedParams>

/**
 * Fired when |SCardGetStatusChange| is called. Timeout is specified in milliseconds.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga33247d5d1257d59e55647c3bb717db24
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetstatuschangea
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface GetStatusChangeRequestedParams {
  readonly requestId: string
  readonly contextId: number
  readonly readerStates: ReadonlyArray<ReaderStateIn>
  /**
   * in milliseconds, if absent, it means "infinite"
   */
  readonly timeout?: number | undefined
}

/**
 * Schema for `GetStatusChangeRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const GetStatusChangeRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    contextId: Schema.Int,
    readerStates: Schema.Array(ReaderStateIn),
    timeout: Schema.optional(Schema.Int)
  }).annotate({ identifier: "SmartCardEmulation.GetStatusChangeRequestedParams" })
) as any as Schema.Codec<GetStatusChangeRequestedParams>

/**
 * Fired when |SCardListReaders| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga93b07815789b3cf2629d439ecf20f0d9
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardlistreadersa
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ListReadersRequestedParams {
  readonly requestId: string
  readonly contextId: number
}

/**
 * Schema for `ListReadersRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ListReadersRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    contextId: Schema.Int
  }).annotate({ identifier: "SmartCardEmulation.ListReadersRequestedParams" })
) as any as Schema.Codec<ListReadersRequestedParams>

/**
 * Fired when |SCardReleaseContext| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga6aabcba7744c5c9419fdd6404f73a934
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardreleasecontext
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReleaseContextRequestedParams {
  readonly requestId: string
  readonly contextId: number
}

/**
 * Schema for `ReleaseContextRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReleaseContextRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    contextId: Schema.Int
  }).annotate({ identifier: "SmartCardEmulation.ReleaseContextRequestedParams" })
) as any as Schema.Codec<ReleaseContextRequestedParams>

/**
 * Reports the result of a |SCardBeginTransaction| call.
 * On success, this creates a new transaction object.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaddb835dce01a0da1d6ca02d33ee7d861
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardbegintransaction
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportBeginTransactionResultParams {
  readonly requestId: string
  readonly handle: number
}

/**
 * Schema for `ReportBeginTransactionResultParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportBeginTransactionResultParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    handle: Schema.Int
  }).annotate({ identifier: "SmartCardEmulation.ReportBeginTransactionResultParams" })
) as any as Schema.Codec<ReportBeginTransactionResultParams>

/**
 * Reports the successful result of a |SCardConnect| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4e515829752e0a8dbc4d630696a8d6a5
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardconnecta
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportConnectResultParams {
  readonly requestId: string
  readonly handle: number
  readonly activeProtocol?: Protocol | undefined
}

/**
 * Schema for `ReportConnectResultParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportConnectResultParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    handle: Schema.Int,
    activeProtocol: Schema.optional(Protocol)
  }).annotate({ identifier: "SmartCardEmulation.ReportConnectResultParams" })
) as any as Schema.Codec<ReportConnectResultParams>

/**
 * Reports the successful result of a call that sends back data on success.
 * Used for |SCardTransmit|, |SCardControl|, and |SCardGetAttrib|.
 *
 * This maps to:
 * 1. SCardTransmit
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga9a2d77242a271310269065e64633ab99
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardtransmit
 *
 * 2. SCardControl
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gac3454d4657110fd7f753b2d3d8f4e32f
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcontrol
 *
 * 3. SCardGetAttrib
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacfec51917255b7a25b94c5104961602
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetattrib
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportDataResultParams {
  readonly requestId: string
  readonly data: string
}

/**
 * Schema for `ReportDataResultParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportDataResultParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    data: Schema.String
  }).annotate({ identifier: "SmartCardEmulation.ReportDataResultParams" })
) as any as Schema.Codec<ReportDataResultParams>

/**
 * Reports an error result for the given request.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportErrorParams {
  readonly requestId: string
  readonly resultCode: ResultCode
}

/**
 * Schema for `ReportErrorParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportErrorParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    resultCode: ResultCode
  }).annotate({ identifier: "SmartCardEmulation.ReportErrorParams" })
) as any as Schema.Codec<ReportErrorParams>

/**
 * Reports the successful result of a |SCardEstablishContext| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaa1b8970169fd4883a6dc4a8f43f19b67
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardestablishcontext
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportEstablishContextResultParams {
  readonly requestId: string
  readonly contextId: number
}

/**
 * Schema for `ReportEstablishContextResultParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportEstablishContextResultParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    contextId: Schema.Int
  }).annotate({ identifier: "SmartCardEmulation.ReportEstablishContextResultParams" })
) as any as Schema.Codec<ReportEstablishContextResultParams>

/**
 * Reports the successful result of a |SCardGetStatusChange| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga33247d5d1257d59e55647c3bb717db24
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetstatuschangea
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportGetStatusChangeResultParams {
  readonly requestId: string
  readonly readerStates: ReadonlyArray<ReaderStateOut>
}

/**
 * Schema for `ReportGetStatusChangeResultParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportGetStatusChangeResultParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    readerStates: Schema.Array(ReaderStateOut)
  }).annotate({ identifier: "SmartCardEmulation.ReportGetStatusChangeResultParams" })
) as any as Schema.Codec<ReportGetStatusChangeResultParams>

/**
 * Reports the successful result of a |SCardListReaders| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga93b07815789b3cf2629d439ecf20f0d9
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardlistreadersa
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportListReadersResultParams {
  readonly requestId: string
  readonly readers: ReadonlyArray<string>
}

/**
 * Schema for `ReportListReadersResultParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportListReadersResultParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    readers: Schema.Array(Schema.String)
  }).annotate({ identifier: "SmartCardEmulation.ReportListReadersResultParams" })
) as any as Schema.Codec<ReportListReadersResultParams>

/**
 * Reports the successful result of a call that returns only a result code.
 * Used for: |SCardCancel|, |SCardDisconnect|, |SCardSetAttrib|, |SCardEndTransaction|.
 *
 * This maps to:
 * 1. SCardCancel
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacbbc0c6d6c0cbbeb4f4debf6fbeeee6
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcancel
 *
 * 2. SCardDisconnect
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4be198045c73ec0deb79e66c0ca1738a
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scarddisconnect
 *
 * 3. SCardSetAttrib
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga060f0038a4ddfd5dd2b8fadf3c3a2e4f
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardsetattrib
 *
 * 4. SCardEndTransaction
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae8742473b404363e5c587f570d7e2f3b
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardendtransaction
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportPlainResultParams {
  readonly requestId: string
}

/**
 * Schema for `ReportPlainResultParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportPlainResultParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String
  }).annotate({ identifier: "SmartCardEmulation.ReportPlainResultParams" })
) as any as Schema.Codec<ReportPlainResultParams>

/**
 * Reports the successful result of a |SCardReleaseContext| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga6aabcba7744c5c9419fdd6404f73a934
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardreleasecontext
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportReleaseContextResultParams {
  readonly requestId: string
}

/**
 * Schema for `ReportReleaseContextResultParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportReleaseContextResultParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String
  }).annotate({ identifier: "SmartCardEmulation.ReportReleaseContextResultParams" })
) as any as Schema.Codec<ReportReleaseContextResultParams>

/**
 * Reports the successful result of a |SCardStatus| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae49c3c894ad7ac12a5b896bde70d0382
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardstatusa
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface ReportStatusResultParams {
  readonly requestId: string
  readonly readerName: string
  readonly state: ConnectionState
  readonly atr: string
  readonly protocol?: Protocol | undefined
}

/**
 * Schema for `ReportStatusResultParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const ReportStatusResultParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    readerName: Schema.String,
    state: ConnectionState,
    atr: Schema.String,
    protocol: Schema.optional(Protocol)
  }).annotate({ identifier: "SmartCardEmulation.ReportStatusResultParams" })
) as any as Schema.Codec<ReportStatusResultParams>

/**
 * Fired when |SCardSetAttrib| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga060f0038a4ddfd5dd2b8fadf3c3a2e4f
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardsetattrib
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface SetAttribRequestedParams {
  readonly requestId: string
  readonly handle: number
  readonly attribId: number
  readonly data: string
}

/**
 * Schema for `SetAttribRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SetAttribRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    handle: Schema.Int,
    attribId: Schema.Int,
    data: Schema.String
  }).annotate({ identifier: "SmartCardEmulation.SetAttribRequestedParams" })
) as any as Schema.Codec<SetAttribRequestedParams>

/**
 * Fired when |SCardStatus| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae49c3c894ad7ac12a5b896bde70d0382
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardstatusa
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface StatusRequestedParams {
  readonly requestId: string
  readonly handle: number
}

/**
 * Schema for `StatusRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const StatusRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    handle: Schema.Int
  }).annotate({ identifier: "SmartCardEmulation.StatusRequestedParams" })
) as any as Schema.Codec<StatusRequestedParams>

/**
 * Fired when |SCardTransmit| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga9a2d77242a271310269065e64633ab99
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardtransmit
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface TransmitRequestedParams {
  readonly requestId: string
  readonly handle: number
  readonly data: string
  readonly protocol?: Protocol | undefined
}

/**
 * Schema for `TransmitRequestedParams`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const TransmitRequestedParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    requestId: Schema.String,
    handle: Schema.Int,
    data: Schema.String,
    protocol: Schema.optional(Protocol)
  }).annotate({ identifier: "SmartCardEmulation.TransmitRequestedParams" })
) as any as Schema.Codec<TransmitRequestedParams>

/**
 * Disables the |SmartCardEmulation| domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol_.CommandDef<"SmartCardEmulation.disable", void, void> = /*#__PURE__*/ Protocol_.command(
  "SmartCardEmulation.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables the |SmartCardEmulation| domain.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol_.CommandDef<"SmartCardEmulation.enable", void, void> = /*#__PURE__*/ Protocol_.command(
  "SmartCardEmulation.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Reports the result of a |SCardBeginTransaction| call.
 * On success, this creates a new transaction object.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaddb835dce01a0da1d6ca02d33ee7d861
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardbegintransaction
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const reportBeginTransactionResult: Protocol_.CommandDef<
  "SmartCardEmulation.reportBeginTransactionResult",
  ReportBeginTransactionResultParams,
  void
> = /*#__PURE__*/ Protocol_.command(
  "SmartCardEmulation.reportBeginTransactionResult",
  ReportBeginTransactionResultParams,
  undefined,
  { status: "stable" }
)

/**
 * Reports the successful result of a |SCardConnect| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4e515829752e0a8dbc4d630696a8d6a5
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardconnecta
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const reportConnectResult: Protocol_.CommandDef<
  "SmartCardEmulation.reportConnectResult",
  ReportConnectResultParams,
  void
> = /*#__PURE__*/ Protocol_.command(
  "SmartCardEmulation.reportConnectResult",
  ReportConnectResultParams,
  undefined,
  { status: "stable" }
)

/**
 * Reports the successful result of a call that sends back data on success.
 * Used for |SCardTransmit|, |SCardControl|, and |SCardGetAttrib|.
 *
 * This maps to:
 * 1. SCardTransmit
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga9a2d77242a271310269065e64633ab99
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardtransmit
 *
 * 2. SCardControl
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gac3454d4657110fd7f753b2d3d8f4e32f
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcontrol
 *
 * 3. SCardGetAttrib
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacfec51917255b7a25b94c5104961602
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetattrib
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const reportDataResult: Protocol_.CommandDef<
  "SmartCardEmulation.reportDataResult",
  ReportDataResultParams,
  void
> = /*#__PURE__*/ Protocol_.command(
  "SmartCardEmulation.reportDataResult",
  ReportDataResultParams,
  undefined,
  { status: "stable" }
)

/**
 * Reports an error result for the given request.
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const reportError: Protocol_.CommandDef<"SmartCardEmulation.reportError", ReportErrorParams, void> =
  /*#__PURE__*/ Protocol_.command(
    "SmartCardEmulation.reportError",
    ReportErrorParams,
    undefined,
    { status: "stable" }
  )

/**
 * Reports the successful result of a |SCardEstablishContext| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaa1b8970169fd4883a6dc4a8f43f19b67
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardestablishcontext
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const reportEstablishContextResult: Protocol_.CommandDef<
  "SmartCardEmulation.reportEstablishContextResult",
  ReportEstablishContextResultParams,
  void
> = /*#__PURE__*/ Protocol_.command(
  "SmartCardEmulation.reportEstablishContextResult",
  ReportEstablishContextResultParams,
  undefined,
  { status: "stable" }
)

/**
 * Reports the successful result of a |SCardGetStatusChange| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga33247d5d1257d59e55647c3bb717db24
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetstatuschangea
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const reportGetStatusChangeResult: Protocol_.CommandDef<
  "SmartCardEmulation.reportGetStatusChangeResult",
  ReportGetStatusChangeResultParams,
  void
> = /*#__PURE__*/ Protocol_.command(
  "SmartCardEmulation.reportGetStatusChangeResult",
  ReportGetStatusChangeResultParams,
  undefined,
  { status: "stable" }
)

/**
 * Reports the successful result of a |SCardListReaders| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga93b07815789b3cf2629d439ecf20f0d9
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardlistreadersa
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const reportListReadersResult: Protocol_.CommandDef<
  "SmartCardEmulation.reportListReadersResult",
  ReportListReadersResultParams,
  void
> = /*#__PURE__*/ Protocol_.command(
  "SmartCardEmulation.reportListReadersResult",
  ReportListReadersResultParams,
  undefined,
  { status: "stable" }
)

/**
 * Reports the successful result of a call that returns only a result code.
 * Used for: |SCardCancel|, |SCardDisconnect|, |SCardSetAttrib|, |SCardEndTransaction|.
 *
 * This maps to:
 * 1. SCardCancel
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacbbc0c6d6c0cbbeb4f4debf6fbeeee6
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcancel
 *
 * 2. SCardDisconnect
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4be198045c73ec0deb79e66c0ca1738a
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scarddisconnect
 *
 * 3. SCardSetAttrib
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga060f0038a4ddfd5dd2b8fadf3c3a2e4f
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardsetattrib
 *
 * 4. SCardEndTransaction
 *    PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae8742473b404363e5c587f570d7e2f3b
 *    Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardendtransaction
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const reportPlainResult: Protocol_.CommandDef<
  "SmartCardEmulation.reportPlainResult",
  ReportPlainResultParams,
  void
> = /*#__PURE__*/ Protocol_.command(
  "SmartCardEmulation.reportPlainResult",
  ReportPlainResultParams,
  undefined,
  { status: "stable" }
)

/**
 * Reports the successful result of a |SCardReleaseContext| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga6aabcba7744c5c9419fdd6404f73a934
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardreleasecontext
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const reportReleaseContextResult: Protocol_.CommandDef<
  "SmartCardEmulation.reportReleaseContextResult",
  ReportReleaseContextResultParams,
  void
> = /*#__PURE__*/ Protocol_.command(
  "SmartCardEmulation.reportReleaseContextResult",
  ReportReleaseContextResultParams,
  undefined,
  { status: "stable" }
)

/**
 * Reports the successful result of a |SCardStatus| call.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae49c3c894ad7ac12a5b896bde70d0382
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardstatusa
 *
 * @stability experimental
 * @category commands
 * @since 0.1.0
 */
export const reportStatusResult: Protocol_.CommandDef<
  "SmartCardEmulation.reportStatusResult",
  ReportStatusResultParams,
  void
> = /*#__PURE__*/ Protocol_.command(
  "SmartCardEmulation.reportStatusResult",
  ReportStatusResultParams,
  undefined,
  { status: "stable" }
)

/**
 * Fired when |SCardBeginTransaction| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaddb835dce01a0da1d6ca02d33ee7d861
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardbegintransaction
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const beginTransactionRequested: Protocol_.EventDef<
  "SmartCardEmulation.beginTransactionRequested",
  BeginTransactionRequestedParams
> = /*#__PURE__*/ Protocol_.event(
  "SmartCardEmulation.beginTransactionRequested",
  BeginTransactionRequestedParams,
  { status: "stable" }
)

/**
 * Fired when |SCardCancel| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacbbc0c6d6c0cbbeb4f4debf6fbeeee6
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcancel
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const cancelRequested: Protocol_.EventDef<"SmartCardEmulation.cancelRequested", CancelRequestedParams> =
  /*#__PURE__*/ Protocol_.event(
    "SmartCardEmulation.cancelRequested",
    CancelRequestedParams,
    { status: "stable" }
  )

/**
 * Fired when |SCardConnect| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4e515829752e0a8dbc4d630696a8d6a5
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardconnecta
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const connectRequested: Protocol_.EventDef<"SmartCardEmulation.connectRequested", ConnectRequestedParams> =
  /*#__PURE__*/ Protocol_.event(
    "SmartCardEmulation.connectRequested",
    ConnectRequestedParams,
    { status: "stable" }
  )

/**
 * Fired when |SCardControl| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gac3454d4657110fd7f753b2d3d8f4e32f
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcontrol
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const controlRequested: Protocol_.EventDef<"SmartCardEmulation.controlRequested", ControlRequestedParams> =
  /*#__PURE__*/ Protocol_.event(
    "SmartCardEmulation.controlRequested",
    ControlRequestedParams,
    { status: "stable" }
  )

/**
 * Fired when |SCardDisconnect| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4be198045c73ec0deb79e66c0ca1738a
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scarddisconnect
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const disconnectRequested: Protocol_.EventDef<
  "SmartCardEmulation.disconnectRequested",
  DisconnectRequestedParams
> = /*#__PURE__*/ Protocol_.event(
  "SmartCardEmulation.disconnectRequested",
  DisconnectRequestedParams,
  { status: "stable" }
)

/**
 * Fired when |SCardEndTransaction| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae8742473b404363e5c587f570d7e2f3b
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardendtransaction
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const endTransactionRequested: Protocol_.EventDef<
  "SmartCardEmulation.endTransactionRequested",
  EndTransactionRequestedParams
> = /*#__PURE__*/ Protocol_.event(
  "SmartCardEmulation.endTransactionRequested",
  EndTransactionRequestedParams,
  { status: "stable" }
)

/**
 * Fired when |SCardEstablishContext| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaa1b8970169fd4883a6dc4a8f43f19b67
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardestablishcontext
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const establishContextRequested: Protocol_.EventDef<
  "SmartCardEmulation.establishContextRequested",
  EstablishContextRequestedParams
> = /*#__PURE__*/ Protocol_.event(
  "SmartCardEmulation.establishContextRequested",
  EstablishContextRequestedParams,
  { status: "stable" }
)

/**
 * Fired when |SCardGetAttrib| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacfec51917255b7a25b94c5104961602
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetattrib
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const getAttribRequested: Protocol_.EventDef<"SmartCardEmulation.getAttribRequested", GetAttribRequestedParams> =
  /*#__PURE__*/ Protocol_.event(
    "SmartCardEmulation.getAttribRequested",
    GetAttribRequestedParams,
    { status: "stable" }
  )

/**
 * Fired when |SCardGetStatusChange| is called. Timeout is specified in milliseconds.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga33247d5d1257d59e55647c3bb717db24
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetstatuschangea
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const getStatusChangeRequested: Protocol_.EventDef<
  "SmartCardEmulation.getStatusChangeRequested",
  GetStatusChangeRequestedParams
> = /*#__PURE__*/ Protocol_.event(
  "SmartCardEmulation.getStatusChangeRequested",
  GetStatusChangeRequestedParams,
  { status: "stable" }
)

/**
 * Fired when |SCardListReaders| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga93b07815789b3cf2629d439ecf20f0d9
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardlistreadersa
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const listReadersRequested: Protocol_.EventDef<
  "SmartCardEmulation.listReadersRequested",
  ListReadersRequestedParams
> = /*#__PURE__*/ Protocol_.event(
  "SmartCardEmulation.listReadersRequested",
  ListReadersRequestedParams,
  { status: "stable" }
)

/**
 * Fired when |SCardReleaseContext| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga6aabcba7744c5c9419fdd6404f73a934
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardreleasecontext
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const releaseContextRequested: Protocol_.EventDef<
  "SmartCardEmulation.releaseContextRequested",
  ReleaseContextRequestedParams
> = /*#__PURE__*/ Protocol_.event(
  "SmartCardEmulation.releaseContextRequested",
  ReleaseContextRequestedParams,
  { status: "stable" }
)

/**
 * Fired when |SCardSetAttrib| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga060f0038a4ddfd5dd2b8fadf3c3a2e4f
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardsetattrib
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const setAttribRequested: Protocol_.EventDef<"SmartCardEmulation.setAttribRequested", SetAttribRequestedParams> =
  /*#__PURE__*/ Protocol_.event(
    "SmartCardEmulation.setAttribRequested",
    SetAttribRequestedParams,
    { status: "stable" }
  )

/**
 * Fired when |SCardStatus| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae49c3c894ad7ac12a5b896bde70d0382
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardstatusa
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const statusRequested: Protocol_.EventDef<"SmartCardEmulation.statusRequested", StatusRequestedParams> =
  /*#__PURE__*/ Protocol_.event(
    "SmartCardEmulation.statusRequested",
    StatusRequestedParams,
    { status: "stable" }
  )

/**
 * Fired when |SCardTransmit| is called.
 *
 * This maps to:
 * PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga9a2d77242a271310269065e64633ab99
 * Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardtransmit
 *
 * @stability experimental
 * @category events
 * @since 0.1.0
 */
export const transmitRequested: Protocol_.EventDef<"SmartCardEmulation.transmitRequested", TransmitRequestedParams> =
  /*#__PURE__*/ Protocol_.event(
    "SmartCardEmulation.transmitRequested",
    TransmitRequestedParams,
    { status: "stable" }
  )
