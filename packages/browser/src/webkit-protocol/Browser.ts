/**
 * The Browser domain contains commands and events related to getting information about the browser
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Information about an extension.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Extension {
  /**
   * Extension identifier.
   */
  readonly extensionId: ExtensionId
  /**
   * The display name for the extension.
   */
  readonly name: string
}

/**
 * Schema for `Extension`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Extension = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    extensionId: ExtensionId,
    name: Schema.String
  }).annotate({ identifier: "Browser.Extension" })
) as any as Schema.Codec<Extension>

/**
 * Unique extension identifier.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ExtensionId = Brand.Branded<string, "~@usestrider/browser/webkit-protocol/Browser/ExtensionId">

/**
 * Schema for `ExtensionId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExtensionId = /*#__PURE__*/ Schema.String.pipe(
  /*#__PURE__*/ Schema.brand("~@usestrider/browser/webkit-protocol/Browser/ExtensionId")
) as any as Schema.Codec<ExtensionId>

/**
 * `extensionsDisabled.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExtensionsDisabledParams {
  /**
   * Disabled extension identifiers.
   */
  readonly extensionIds: ReadonlyArray<ExtensionId>
}

/**
 * Schema for `ExtensionsDisabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExtensionsDisabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    extensionIds: Schema.Array(ExtensionId)
  }).annotate({ identifier: "Browser.ExtensionsDisabledParams" })
) as any as Schema.Codec<ExtensionsDisabledParams>

/**
 * `extensionsEnabled.Params`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ExtensionsEnabledParams {
  /**
   * Information about the enabled extensions.
   */
  readonly extensions: ReadonlyArray<Extension>
}

/**
 * Schema for `ExtensionsEnabledParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ExtensionsEnabledParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    extensions: Schema.Array(Extension)
  }).annotate({ identifier: "Browser.ExtensionsEnabledParams" })
) as any as Schema.Codec<ExtensionsEnabledParams>

/**
 * Disables Browser domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Browser.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Browser.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables Browser domain events.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Browser.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Browser.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * The `Browser.extensionsDisabled` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const extensionsDisabled: Protocol.EventDef<"Browser.extensionsDisabled", ExtensionsDisabledParams> =
  /*#__PURE__*/ Protocol.event(
    "Browser.extensionsDisabled",
    ExtensionsDisabledParams,
    { status: "stable" }
  )

/**
 * The `Browser.extensionsEnabled` event.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const extensionsEnabled: Protocol.EventDef<"Browser.extensionsEnabled", ExtensionsEnabledParams> =
  /*#__PURE__*/ Protocol.event(
    "Browser.extensionsEnabled",
    ExtensionsEnabledParams,
    { status: "stable" }
  )
