/**
 * Actions and events related to alert boxes.
 *
 * Generated from the WebKit inspector protocol as Playwright patches it, WebKit build 2359 (WebKit 26.6). Don't edit: correct the model (`packages/tools/codegen/protocols/webkit`) and run `pnpm codegen:protocol`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/**
 * Accepts or dismisses a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface HandleJavaScriptDialogParams {
  /**
   * Whether to accept or dismiss the dialog.
   */
  readonly accept: boolean
  /**
   * The text to enter into the dialog prompt before accepting. Used only if this is a prompt dialog.
   */
  readonly promptText?: string | undefined
}

/**
 * Schema for `HandleJavaScriptDialogParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const HandleJavaScriptDialogParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    accept: Schema.Boolean,
    promptText: Schema.optional(Schema.String)
  }).annotate({ identifier: "Dialog.HandleJavaScriptDialogParams" })
) as any as Schema.Codec<HandleJavaScriptDialogParams>

/**
 * Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) is about to open.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface JavascriptDialogOpeningParams {
  /**
   * Dialog type.
   */
  readonly type: string
  /**
   * Message that will be displayed by the dialog.
   */
  readonly message: string
  /**
   * Default dialog prompt.
   */
  readonly defaultPrompt?: string | undefined
}

/**
 * Schema for `JavascriptDialogOpeningParams`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const JavascriptDialogOpeningParams = /*#__PURE__*/ Schema.suspend(() =>
  Schema.Struct({
    type: Schema.String,
    message: Schema.String,
    defaultPrompt: Schema.optional(Schema.String)
  }).annotate({ identifier: "Dialog.JavascriptDialogOpeningParams" })
) as any as Schema.Codec<JavascriptDialogOpeningParams>

/**
 * Disables dialog domain notifications.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const disable: Protocol.CommandDef<"Dialog.disable", void, void> = /*#__PURE__*/ Protocol.command(
  "Dialog.disable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Enables dialog domain notifications.
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const enable: Protocol.CommandDef<"Dialog.enable", void, void> = /*#__PURE__*/ Protocol.command(
  "Dialog.enable",
  undefined,
  undefined,
  { status: "stable" }
)

/**
 * Accepts or dismisses a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload).
 *
 * @stability unstable
 * @category commands
 * @since 0.1.0
 */
export const handleJavaScriptDialog: Protocol.CommandDef<
  "Dialog.handleJavaScriptDialog",
  HandleJavaScriptDialogParams,
  void
> = /*#__PURE__*/ Protocol.command(
  "Dialog.handleJavaScriptDialog",
  HandleJavaScriptDialogParams,
  undefined,
  { status: "stable" }
)

/**
 * Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) has been closed.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const javascriptDialogClosed: Protocol.EventDef<"Dialog.javascriptDialogClosed", void> = /*#__PURE__*/ Protocol
  .event(
    "Dialog.javascriptDialogClosed",
    undefined,
    { status: "stable" }
  )

/**
 * Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) is about to open.
 *
 * @stability unstable
 * @category events
 * @since 0.1.0
 */
export const javascriptDialogOpening: Protocol.EventDef<
  "Dialog.javascriptDialogOpening",
  JavascriptDialogOpeningParams
> = /*#__PURE__*/ Protocol.event(
  "Dialog.javascriptDialogOpening",
  JavascriptDialogOpeningParams,
  { status: "stable" }
)
