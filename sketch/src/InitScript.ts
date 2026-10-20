/**
 * Init scripts: code that runs in every new document of a page or context, before the page's own scripts.
 *
 * Adding one is a declaration (`page.addInitScript`, `context.addInitScript`). Scripts can depend on each
 * other with `after`, so their order is stated rather than implied by call order.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import type * as Declaration from "./Declaration.ts"
import type * as FilePath from "./FilePath.ts"

/**
 * Schema for the id of an init script.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Id = Schema.String.pipe(Schema.brand("~effect-browser/InitScript/Id"))

/**
 * Id of an init script.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Id = typeof Id.Type

/**
 * The handle `addInitScript` returns, usable in another script's `after`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface InitScript extends Declaration.Registration {
  readonly id: Id
}

/**
 * Where a script's code comes from; which kind is always stated.
 *
 * **Details**
 *
 * - A function is serialized, so it must be self-contained.
 * - `{ source }` is JavaScript source text.
 * - `{ path }` is a file on this machine, read when the script is added.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Source =
  | (() => void)
  | { readonly source: string }
  | { readonly path: FilePath.Local | string }

/**
 * Settings for an init script.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Options {
  /**
   * The JavaScript world it runs in.
   *
   * @default "main"
   */
  readonly world?: "main" | "isolated" | undefined
  /**
   * Scripts that must run first. A dependency must have equal or broader scope: a page script can follow a
   * context script, not the reverse.
   *
   * @default none
   */
  readonly after?: ReadonlyArray<InitScript> | undefined
  /**
   * Whether running before the page's own scripts is required. A backend that can't guarantee it fails with
   * `TimingUnsupported` unless `"bestEffort"` is chosen.
   *
   * @default "beforeAuthorScript"
   */
  readonly timing?: "beforeAuthorScript" | "bestEffort" | undefined
}
