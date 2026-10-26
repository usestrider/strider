/**
 * The agent toolkit (`@usestrider/browser/ai`): one definition that serves an in-process model, an MCP server and
 * the CLI.
 *
 * Every page tool names its page; there is no current tab. No tool waits after it acts: each result carries
 * the call's outcome, then a digest of what the event logs recorded since the previous call. Tools are
 * `effect/ai` tools with failure mode `"return"`, so a `LocatorError`, `Timeout` or stale ref reaches the
 * model as data, hint included. Parameters are Schemas: a model's `"e12"` is decoded to a `Snapshot.RefId` and
 * checked against that page's latest snapshot.
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
 * The name of a secret an agent refers to as `%name%`; the value is substituted only at dispatch.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type SecretName = typeof SecretName.Type

/**
 * The toolkit's tools.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type ToolName =
  | "pages"
  | "newPage"
  | "tabs"
  | "control"
  | "release"
  | "goto"
  | "back"
  | "snapshot"
  | "find"
  | "screenshot"
  | "click"
  | "fill"
  | "press"
  | "select"
  | "scroll"
  | "next"
  | "await"
  | "expect"
  | "history"
  | "route"
  | "dialog"

/**
 * The toolkit's tool definitions, by name.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Tools = ToolsImpl.Tools

/**
 * Why a tool call failed, as the model sees it: the library error's tag, its reason's, and its message, hint
 * included. A tool's failure mode is `"return"`, so it reaches the model as a result.
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
 * The tool definitions alone, for the CLI and MCP surfaces to serve.
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
   * Secrets the model may use by name; it sees `%name%`, and the value is substituted at dispatch.
   */
  readonly secrets: Readonly<Record<SecretName | string, Redacted.Redacted<string>>>
  /**
   * What snapshots, screenshots and digests may contain before they reach the model. Required.
   */
  readonly capture: CapturePolicy.CapturePolicy
  /**
   * The browser, so the model can list its other pages (`tabs`) and take control of one (`control`), such as
   * an attached browser's own tabs. Without it, those tools fail with `NotPermitted`: a model reaches beyond
   * the context only when it is given the browser.
   *
   * @default none
   */
  readonly browser?: Browser.Browser | undefined
}

/**
 * Binds the toolkit to a context, with handlers, for an in-process model.
 *
 * **Details**
 *
 * Pages are named as they are created (`newPage`'s `name`, or `p1`, `p2`…) or first seen, as a popup is. A
 * target is a ref from the page's latest snapshot (`e12`), or `role=button[name="Save"]`, `text="Add to cart"`,
 * `label=Email`, `testid=cart` or `css=…`; a bad one fails at once. Each result is the call's outcome and
 * `sinceLast`: navigations, popups, dialogs and who decided them, downloads, uncaught exceptions, console
 * errors and failed requests since the previous call. A `%name%` in a parameter is the secret's value at
 * dispatch, and results carry it back as `%name%`. Waits, routes and dialog handlers end with the scope.
 *
 * **Example** (A toolkit for one context)
 *
 * ```ts import.meta.vitest
 * import { Config, Effect } from "effect"
 * import { Page } from "@usestrider/browser"
 * import { BrowserToolkit, CapturePolicy } from "@usestrider/browser/ai"
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
