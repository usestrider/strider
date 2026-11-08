/**
 * Init scripts: code that runs at the start of every new document of a page or context, before the page's own
 * scripts.
 *
 * Adding one is a declaration (`page.addInitScript`, `context.addInitScript`), removed with its scope.
 *
 * - **Order** is the same on every backend: a context's scripts before a page's, each in the order added.
 *   `after` doesn't reorder; it makes a script depend on others, which must still be in force and belong to the
 *   same page or context or a broader one: a page's script can come after its context's, not the reverse. A
 *   script runs only if each script it comes after ran in that document without throwing.
 * - **When.** A script runs as its document starts, before `document.documentElement` exists, in every frame
 *   of the page, cross-site ones included. Added to a loaded page, it runs from the next document; removed, it
 *   stops at the next, along with the scripts that come after it.
 * - **A script that throws** is reported as the page's `UncaughtException`. The scripts added after it still
 *   run, unless they name it in `after`.
 *
 * **Gotchas**
 *
 * On Firefox a `{ source }` or `{ path }` script runs inside a function, so its top-level `var` and function
 * declarations aren't globals there, as they are on Chromium and WebKit: assign to `window` to share something. A
 * function script's declarations are its own on every backend, since it runs as a call.
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
 * - `{ path }` is a file on this machine, read when the script is added. It fails with `InvalidInput` unless the
 *   browser's layer was built with `FileSystem` and `Path`.
 *
 * **Example** (A function and a file)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const prepare = Effect.fn("prepare")(function*(page: Page.Page) {
 *   yield* page.addInitScript(() => {
 *     localStorage.setItem("cookie-consent", "declined")
 *   })
 *   yield* page.addInitScript({ path: "./fixtures/analytics-stub.js" })
 *   yield* page.goto("https://shop.example.com")
 * })
 * ```
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
   * The JavaScript world the script runs in: the page's own, or the isolated world `page.evaluate` runs in, which
   * is separate from Strider's own and can't see the page's globals. An isolated script fails with `Unsupported`
   * on WebKit.
   *
   * @default "main"
   */
  readonly world?: "main" | "isolated" | undefined
  /**
   * Scripts that must run first, in the same world: this one runs in a document only if each of them ran there
   * without throwing. Each must belong to the same page or context or to a broader one: a page's script can come
   * after its context's, not the reverse. One already removed fails with `DependencyReleased`.
   *
   * @default none
   */
  readonly after?: ReadonlyArray<InitScript> | undefined
  /**
   * Whether the script must run before the page's own scripts. A backend that can't guarantee it fails with
   * `DeclarationError` with `TimingUnsupported`, unless you choose `"bestEffort"`. Attached Chromium refuses
   * required timing for context-wide scripts because new popups are not paused at creation. Page-scoped scripts
   * still run before author scripts in later documents. Launched Chromium and Firefox support required timing
   * for context-wide scripts. `"bestEffort"` permits a new target's first author scripts to run before this script.
   *
   * @default "beforeAuthorScript"
   */
  readonly timing?: "beforeAuthorScript" | "bestEffort" | undefined
  /**
   * Whether the script also runs in the dedicated workers that the page, or the context's pages, start from now
   * on, before the worker's own script. It must run in the main world, and come after only scripts that run in
   * workers too. Fails with `Unsupported` on Firefox (`initScripts.workers`): WebDriver BiDi's preload scripts run
   * in documents only.
   *
   * @default false
   */
  readonly workers?: boolean | undefined
}
