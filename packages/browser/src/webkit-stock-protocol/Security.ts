/**
 * Security domain allows the frontend to query for information relating to the security of the page (e.g. HTTPS info, TLS info, user activity, etc.).
 *
 * Generated from the WebKit inspector protocol as WebKit ships it, WebKitGTK 2.54.1. Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Network from "./Network.ts"

/**
 * Information about a SSL certificate to display in the frontend.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Certificate {
  readonly subject?: string | undefined
  readonly validFrom?: Network.Walltime | undefined
  readonly validUntil?: Network.Walltime | undefined
  /**
   * DNS names listed on the certificate.
   */
  readonly dnsNames?: ReadonlyArray<string> | undefined
  /**
   * IP addresses listed on the certificate.
   */
  readonly ipAddresses?: ReadonlyArray<string> | undefined
}

/**
 * Schema for `Certificate`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Certificate = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    subject: Schema.optional(Schema.String),
    validFrom: Schema.optional(Network.Walltime),
    validUntil: Schema.optional(Network.Walltime),
    dnsNames: Schema.optional(Schema.Array(Schema.String)),
    ipAddresses: Schema.optional(Schema.Array(Schema.String))
  }).annotate({ identifier: "Security.Certificate" })
) as any as Schema.Codec<Certificate>

/**
 * Information about a SSL connection to display in the frontend.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Connection {
  readonly protocol?: string | undefined
  readonly cipher?: string | undefined
}

/**
 * Schema for `Connection`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Connection = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    protocol: Schema.optional(Schema.String),
    cipher: Schema.optional(Schema.String)
  }).annotate({ identifier: "Security.Connection" })
) as any as Schema.Codec<Connection>

/**
 * Security information for a given Network.Response.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Security {
  readonly connection?: Connection | undefined
  readonly certificate?: Certificate | undefined
}

/**
 * Schema for `Security`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Security = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    connection: Schema.optional(Connection),
    certificate: Schema.optional(Certificate)
  }).annotate({ identifier: "Security.Security" })
) as any as Schema.Codec<Security>
