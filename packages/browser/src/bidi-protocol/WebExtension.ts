/**
 * The webExtension module.
 *
 * Generated from WebDriver BiDi's CDDL, w3c/webdriver-bidi f922e6a (2026-10-08). Don't edit: correct the model (`packages/tools/codegen/protocols/bidi`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * `Extension`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Extension = Brand.Branded<string, "~@usestrider/browser/bidi-protocol/WebExtension/Extension">

/**
 * Schema for `Extension`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Extension = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/bidi-protocol/WebExtension/Extension")
) as any as Schema.Codec<Extension>

/**
 * `ExtensionArchivePath`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExtensionArchivePath {
  readonly type: "archivePath"
  readonly path: string
}

/**
 * Schema for `ExtensionArchivePath`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExtensionArchivePath = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("archivePath"),
    path: Schema.String
  }).annotate({ identifier: "webExtension.ExtensionArchivePath" })
) as any as Schema.Codec<ExtensionArchivePath>

/**
 * `ExtensionBase64Encoded`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExtensionBase64Encoded {
  readonly type: "base64"
  readonly value: string
}

/**
 * Schema for `ExtensionBase64Encoded`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExtensionBase64Encoded = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("base64"),
    value: Schema.String
  }).annotate({ identifier: "webExtension.ExtensionBase64Encoded" })
) as any as Schema.Codec<ExtensionBase64Encoded>

/**
 * `ExtensionData`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ExtensionData = ExtensionArchivePath | ExtensionBase64Encoded | ExtensionPath

/**
 * Schema for `ExtensionData`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExtensionData = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Union([ExtensionArchivePath, ExtensionBase64Encoded, ExtensionPath])
) as any as Schema.Codec<ExtensionData>

/**
 * `ExtensionPath`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExtensionPath {
  readonly type: "path"
  readonly path: string
}

/**
 * Schema for `ExtensionPath`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExtensionPath = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.Literal("path"),
    path: Schema.String
  }).annotate({ identifier: "webExtension.ExtensionPath" })
) as any as Schema.Codec<ExtensionPath>

/**
 * `InstallParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InstallParameters {
  readonly extensionData: ExtensionData
}

/**
 * Schema for `InstallParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InstallParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    extensionData: ExtensionData
  }).annotate({ identifier: "webExtension.InstallParameters" })
) as any as Schema.Codec<InstallParameters>

/**
 * `InstallResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InstallResult {
  readonly extension: Extension
}

/**
 * Schema for `InstallResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const InstallResult = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    extension: Extension
  }).annotate({ identifier: "webExtension.InstallResult" })
) as any as Schema.Codec<InstallResult>

/**
 * `UninstallParameters`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UninstallParameters {
  readonly extension: Extension
}

/**
 * Schema for `UninstallParameters`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UninstallParameters = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    extension: Extension
  }).annotate({ identifier: "webExtension.UninstallParameters" })
) as any as Schema.Codec<UninstallParameters>

/**
 * `UninstallResult`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type UninstallResult = { readonly [key: string]: unknown }

/**
 * Schema for `UninstallResult`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UninstallResult = Schema.Record(Schema.String, Schema.Unknown) as any as Schema.Codec<UninstallResult>

/**
 * Sends `webExtension.install`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const install: Protocol.CommandDef<"webExtension.install", InstallParameters, InstallResult> =
  /*#__PURE__*/ Protocol.command(
    "webExtension.install",
    InstallParameters,
    InstallResult,
    {
      status: "stable",
      createsResource: true,
      release: [{ method: "webExtension.uninstall", param: "extension", from: "/extension" }]
    }
  )

/**
 * Sends `webExtension.uninstall`.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const uninstall: Protocol.CommandDef<"webExtension.uninstall", UninstallParameters, void> =
  /*#__PURE__*/ Protocol.command(
    "webExtension.uninstall",
    UninstallParameters,
    undefined,
    { status: "stable" }
  )
