/**
 * The permissions module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08). Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * `PermissionDescriptor`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface PermissionDescriptor {
  readonly name: string
}

/**
 * Schema for `PermissionDescriptor`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PermissionDescriptor = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String
  }).annotate({ identifier: "permissions.PermissionDescriptor" })
) as any as Schema.Codec<PermissionDescriptor>

/**
 * `PermissionState` values.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | (string & {})

/**
 * Schema for `PermissionState`: known values, and any other string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PermissionState = Schema.String as any as Schema.Codec<PermissionState>

/**
 * `SetPermissionParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SetPermissionParameters {
  readonly descriptor: PermissionDescriptor
  readonly state: PermissionState
  readonly origin: string
  readonly embeddedOrigin?: string | undefined
  readonly userContext?: string | undefined
}

/**
 * Schema for `SetPermissionParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SetPermissionParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    descriptor: PermissionDescriptor,
    state: PermissionState,
    origin: Schema.String,
    embeddedOrigin: Schema.optional(Schema.String),
    userContext: Schema.optional(Schema.String)
  }).annotate({ identifier: "permissions.SetPermissionParameters" })
) as any as Schema.Codec<SetPermissionParameters>

/**
 * Sends `permissions.setPermission`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const setPermission: Protocol.CommandDef<"permissions.setPermission", SetPermissionParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "permissions.setPermission",
    SetPermissionParameters,
    undefined,
    { status: "stable" }
  )
