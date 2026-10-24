/**
 * User contexts (the spec's term; Playwright calls them browser contexts), at two access levels.
 *
 * A context isolates storage, cookies, permissions and emulation from every other context. An
 * `ObservedUserContext` is one you don't control, such as a browser's default context when attached; a
 * `UserContext` is one you control. There are two levels only, because reads happen on pages.
 *
 * Options at creation are declarations held for the context's whole life. Members such as `emulate` and
 * `grant` are the same declarations, scoped: `Options.emulation` is `emulate(…)` held for the context's life.
 *
 * A context the library creates holds two more, which no option changes: downloads are allowed into a
 * temporary directory the context owns, made before it and removed after it (its path is on the context's span,
 * `browser.context.downloads`), and file choosers are reported and decided, canceled when no handler answers.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Equal from "effect/Equal"
import type * as Inspectable from "effect/Inspectable"
import type * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as BrowserWorker from "./BrowserWorker.ts"
import type * as CookieJar from "./CookieJar.ts"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as Emulation from "./Emulation.ts"
import type * as InitScript from "./InitScript.ts"
import type * as Page from "./Page.ts"
import type * as PageClock from "./PageClock.ts"
import * as Reason from "./Reason.ts"
import type * as Route from "./Route.ts"
import * as StorageState from "./StorageState.ts"
import type * as Target from "./Target.ts"
import type * as Url from "./Url.ts"
import type * as Watchable from "./Watchable.ts"

/**
 * Schema for the id of a user context.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Id = Schema.String.pipe(Schema.brand("~@usestrider/browser/UserContext/Id"))

/**
 * Id of a user context.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Id = typeof Id.Type

const TypeId = "~@usestrider/browser/UserContext"

/**
 * A context you can observe but not control, such as the default context when attached.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ObservedUserContext extends Pipeable.Pipeable, Equal.Equal, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId
  readonly id: Id
  /**
   * The context's pages, as they open and close.
   */
  readonly pages: Watchable.Watchable<ReadonlyArray<Page.ObservedPage>>
  /**
   * The context's shared and service workers.
   */
  readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.ObservedBrowserWorker>>
  /**
   * Waits as long as the context lives, then gives the reason it ended.
   */
  readonly closed: Effect.Effect<Target.CloseReason>
  /**
   * Gains control for the scope. Reading storage needs it too.
   */
  readonly control: Effect.Effect<UserContext, UserContextError, Scope.Scope>
}

/**
 * Permissions a context can grant, by their Permissions API names.
 *
 * **Details**
 *
 * The open string keeps permissions added after this list usable.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Permission =
  | "geolocation"
  | "notifications"
  | "camera"
  | "microphone"
  | "clipboard-read"
  | "clipboard-write"
  | "midi"
  | "background-sync"
  | "persistent-storage"
  | "accelerometer"
  | "gyroscope"
  | "magnetometer"
  | "payment-handler"
  | "storage-access"
  | "local-fonts"
  | "screen-wake-lock"
  | (string & {})

/**
 * Settings for `grant`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface GrantOptions {
  /**
   * The origin the permissions apply to.
   *
   * @default every origin
   */
  readonly origin?: Url.Origin | string | undefined
}

/**
 * A context you control.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface UserContext extends ObservedUserContext {
  /**
   * Opens a page in this context. It is closed, with the popups it opened, when the scope closes.
   */
  readonly newPage: Effect.Effect<Page.Page, Page.PageError, Scope.Scope>
  readonly pages: Watchable.Watchable<ReadonlyArray<Page.Page>>
  readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.BrowserWorker>>
  /**
   * The context's cookies.
   */
  readonly cookies: CookieJar.CookieJar
  /**
   * Reads the context's storage, to save and start other contexts from.
   */
  readonly exportStorageState: Effect.Effect<StorageState.StorageState, UserContextError>
  /**
   * A clock for every page of the context, as one timeline (opt-in).
   */
  readonly clock: PageClock.PageClock
  /**
   * Intercepts requests from every page of the context while the registration lives.
   */
  route<E, R>(
    pattern: Url.Pattern | string,
    handler: Route.Handler<E, R>
  ): Effect.Effect<Route.Registration, Route.RouteError, Scope.Scope | R>
  /**
   * Runs a script in every new document of every page while the registration lives.
   */
  addInitScript(
    script: InitScript.Source,
    options?: InitScript.Options | undefined
  ): Effect.Effect<InitScript.InitScript, Declaration.DeclarationError, Scope.Scope>
  /**
   * Overrides the given settings for every page while the registration lives.
   */
  emulate(
    settings: Emulation.Emulation
  ): Effect.Effect<Declaration.Registration, Declaration.DeclarationError, Scope.Scope>
  /**
   * Grants permissions while the registration lives. Grants are combined (AND) with Permissions Policy.
   *
   * **Example** (Geolocation for one origin)
   *
   * ```ts import.meta.vitest
   * import { Effect } from "effect"
   * import { Page } from "@usestrider/browser"
   *
   * const allowLocation = Effect.fn("allowLocation")(function*(page: Page.Page) {
   *   yield* page.context.grant(["geolocation"], { origin: "https://maps.example.com" })
   * })
   * ```
   */
  grant(
    permissions: ReadonlyArray<Permission>,
    options?: GrantOptions | undefined
  ): Effect.Effect<Declaration.Registration, Declaration.DeclarationError, Scope.Scope>
}

/**
 * Checks whether a value is a context.
 *
 * **Gotchas**
 *
 * This identifies the kind, not the access: it narrows to `ObservedUserContext`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isUserContext = (u: unknown): u is ObservedUserContext => Predicate.hasProperty(u, TypeId)

/**
 * Settings for a new context. An unset option keeps the browser's own value unless a default is stated.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Options {
  /**
   * Storage to start from, such as a saved login.
   *
   * @default empty storage
   */
  readonly storageState?: StorageState.StorageState | undefined
  /**
   * What happens to a dialog no handler claims.
   *
   * @default "dismiss"
   */
  readonly dialogs?: "dismiss" | "accept" | "leaveOpen" | undefined
  /**
   * `"emulated"` makes every page report focus, so many pages can run at once.
   *
   * @default "system"
   */
  readonly focus?: "system" | "emulated" | undefined
  /**
   * Events retained per event module and page, for `history`; 0 keeps none.
   *
   * @default 100
   */
  readonly eventLog?: number | undefined
  /**
   * Settings held for the context's life: `emulate(…)` without a scope.
   *
   * @default none
   */
  readonly emulation?: Emulation.Emulation | undefined
  /**
   * Permissions granted for the context's life, for every origin: `grant(…)` without a scope.
   *
   * @default none
   */
  readonly permissions?: ReadonlyArray<Permission> | undefined
}

/**
 * Schema for the reasons a context operation can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const UserContextErrorReason = Schema.Union([
  StorageState.Incompatible,
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons a context operation can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type UserContextErrorReason = typeof UserContextErrorReason.Type

const UserContextErrorTypeId = "~@usestrider/browser/UserContext/UserContextError"

/**
 * Error for a context that couldn't be created or controlled, or whose storage couldn't be read.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class UserContextError extends Schema.TaggedError<UserContextError>(UserContextErrorTypeId)(
  "UserContextError",
  {
    operation: Schema.String,
    reason: UserContextErrorReason,
    diagnostics: Diagnostics.Diagnostics
  }
) {
  readonly [UserContextErrorTypeId] = UserContextErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
}

/**
 * Checks whether a value is a `UserContextError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isUserContextError = (u: unknown): u is UserContextError =>
  Predicate.hasProperty(u, UserContextErrorTypeId)
