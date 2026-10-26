/**
 * Init scripts: code that runs in every new document of a page or context, before the page's own scripts.
 *
 * Adding one is a declaration (`page.addInitScript`, `context.addInitScript`), removed with its scope.
 *
 * - **Order** is the same on every backend: a context's scripts before a page's, then the order they were
 *   added in. `after` doesn't change it: it states a dependency, which must be in force and of equal or
 *   broader scope, and a script runs only if each script it comes after ran in that document without
 *   throwing.
 * - **When.** A script runs as its document starts, before `document.documentElement` exists, in every frame
 *   of the page, cross-site ones included. Added to a loaded page, it runs from the next document; removed, it
 *   stops at the next, along with the scripts that come after it.
 * - **A script that throws** is reported as the page's `UncaughtException`, and the scripts after it still run.
 *
 * **Gotchas**
 *
 * On Firefox each script runs inside a function, so its top-level `var` and function declarations aren't
 * globals, as they are on Chromium and WebKit: assign to `window` to share something.
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
export const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/InitScript/Id"))

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
   * The JavaScript world it runs in: the page's own, or one isolated world of the caller's, apart from the
   * engine's, where the page's globals are invisible. An isolated script is `Unsupported` on WebKit.
   *
   * @default "main"
   */
  readonly world?: "main" | "isolated" | undefined
  /**
   * Scripts that must run first, in the same world. A dependency must be in force and have equal or broader
   * scope: a page script can follow a context script, not the reverse. One already removed fails with
   * `DependencyReleased`.
   *
   * @default none
   */
  readonly after?: ReadonlyArray<InitScript> | undefined
  /**
   * Whether running before the page's own scripts is required. A backend that can't guarantee it fails with
   * `TimingUnsupported` unless `"bestEffort"` is chosen. Every backend guarantees it for the pages the library
   * creates.
   *
   * @default "beforeAuthorScript"
   */
  readonly timing?: "beforeAuthorScript" | "bestEffort" | undefined
  /**
   * Whether it also runs in the dedicated workers of the scope's pages started from now on, before their own
   * script (review 22). It must run in the main world, after only scripts that run in workers too. `Unsupported`
   * on Firefox (`initScripts.workers`): WebDriver BiDi's preload scripts run in documents only.
   *
   * @default false
   */
  readonly workers?: boolean | undefined
}
