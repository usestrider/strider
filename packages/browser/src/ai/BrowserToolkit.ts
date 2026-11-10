/**
 * The agent toolkit: browser tools for a model, defined once, and served in your program, over MCP and by the CLI.
 *
 * Every page tool names its page; there is no current tab. Action tools await browser/protocol completion, which
 * can include navigation or a busy page responding, without adding a wait for later page events. Each result has
 * the call's outcome, then a digest of what happened since the previous call. Tools are `effect/ai` tools whose failures are
 * returned to the model, so a `LocatorError`, a `Timeout` or a stale ref reaches the model as data, hint included.
 * Parameters are Schemas: a model's `"e12"` is decoded to a `Snapshot.RefId` and checked against that page's latest
 * snapshot.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Toolkit from "effect/ai/Toolkit"
import type * as Effect from "effect/Effect"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Browser from "../Browser.ts"
import * as ToolkitImpl from "../internal/toolkit.ts"
import * as ToolsImpl from "../internal/tools.ts"
import type * as UserContext from "../UserContext.ts"
import type * as CapturePolicy from "./CapturePolicy.ts"

/**
 * Schema for the name of a secret an agent refers to as `%name%`.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const SecretName = Schema.String.pipe(Schema.brand("~@usestrider/browser/ai/BrowserToolkit/SecretName"))

/**
 * The name of a secret an agent refers to as `%name%`; Strider puts in the value only as the tool call runs.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SecretName = typeof SecretName.Type

/**
 * The names of the toolkit's tools.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ToolName = keyof Tools

/**
 * The toolkit's tool definitions, by name.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Tools = ToolsImpl.Tools

/**
 * Why a tool call failed, as the model sees it: the error's tag and its reason's, with its message, hint included.
 * Each tool's failure mode is `"return"`, so a failure reaches the model as a result.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export const ToolFailure = ToolsImpl.ToolFailure

/**
 * Why a tool call failed, as the model sees it.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ToolFailure = ToolsImpl.ToolFailure

/**
 * The tool definitions without handlers, as the CLI and its MCP server serve them.
 *
 * @stability experimental
 * @category constants
 * @since 0.1.0
 */
export const toolkit: Toolkit.Toolkit<Tools> = ToolsImpl.toolkit

/**
 * Settings for a toolkit bound to a context.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface MakeOptions {
  /**
   * The context the model works in.
   */
  readonly context: UserContext.UserContext
  /**
   * Secrets the model may use by name: it sees `%name%`, and Strider puts in the value as the tool call runs. Only
   * these names are secrets: any other `%name%` in a parameter is sent as written.
   */
  readonly secrets: Readonly<Record<SecretName | string, Redacted.Redacted<string>>>
  /**
   * What snapshots, screenshots and digests may contain before they reach the model.
   */
  readonly capture: CapturePolicy.CapturePolicy
  /**
   * The browser, so the model can list its other pages (`tabs`) and take control of one (`control`), such as
   * an attached browser's own tabs. Without it, those tools fail with `NotPermitted`.
   *
   * @default none
   */
  readonly browser?: Browser.Browser | undefined
}

/**
 * Binds the toolkit to a context, with handlers, for a model your program calls.
 *
 * **Details**
 *
 * - Pages are named when they're created (`newPage`'s `name`, or `p1`, `p2`…) or first seen, as a popup is.
 * - A target is a ref from the page's latest snapshot (`e12`), or `role=button[name="Save"]`, `text="Add to cart"`,
 *   `label=Email`, `testid=cart` or `css=…`; a bad one fails at once.
 * - Each result is the call's outcome and `sinceLast`: what happened since the previous call, including
 *   navigations, popups, dialogs and who decided them. A successful `newPage`, `goto` or `back` reports its own
 *   navigation in its outcome and omits that event from the digest, including when delivered later. Other events include
 *   downloads, uncaught exceptions, console errors, failed requests and validation observed during clicks. The capture
 *   policy's `consoleText` decides the console errors: `"full"` lists them with their text, `"redacted"` without
 *   it, and `"omitted"`, as `CapturePolicy.strict` has it, leaves them out.
 *   Validation feedback is temporal, not proof of a blocked submission. It covers the top document and existing
 *   open shadow roots. Strict capture omits control names and masks messages. Dialogs, navigation, document loss
 *   or the click's deadline can discard feedback; release never delays the caller or reports into a later call.
 * - A `%name%` in a parameter becomes the secret's value as the call runs, and results show the value as `%name%`
 *   again. Other text between `%` signs, such as `%C3%` in a URL, is sent as written.
 * - Waits, routes and dialog handlers end with the scope.
 *
 * **Gotchas**
 *
 * A mistyped secret name isn't an error: `%pasword%` names no secret, so it is sent as written, and a field it fills
 * gets the text `%pasword%`. Successful results report unknown placeholder names in `sinceLast`; typed failures
 * append the same hints to their message, preserving the error and reason. Hints describe the input, without
 * claiming it reached the browser. A configured name is suggested when exactly one is within one insertion,
 * deletion or substitution. Names start with an ASCII letter and continue with ASCII letters, digits, underscores
 * or hyphens. Two hexadecimal digits are always treated as URL escapes. A longer candidate starting with a hex
 * pair, whose closing `%` starts another hex escape, is also exempt unless any configured name is within one edit.
 * This syntax is ambiguous: `%ACtext%20` normally stays quiet, but `%adminpas%2024` warns when `adminpass` is
 * configured. Escaped URL text close to a configured name can therefore produce a warning too.
 *
 * **Example** (Building a toolkit for a context)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { BrowserToolkit, CapturePolicy } from "@usestrider/browser/ai"
 * import { Config, Effect } from "effect"
 *
 * const tools = Effect.fn("tools")(function*(page: Page.Page) {
 *   return yield* BrowserToolkit.make({
 *     context: page.context,
 *     secrets: { password: yield* Config.Redacted("PASSWORD") },
 *     capture: CapturePolicy.strict
 *   })
 * })
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const make = (options: MakeOptions): Effect.Effect<Toolkit.WithHandler<Tools>, never, Scope.Scope> =>
  ToolkitImpl.make(options)
