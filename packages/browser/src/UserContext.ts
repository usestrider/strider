/**
 * User contexts: isolated browser sessions, at two access levels.
 *
 * A context, which Playwright calls a browser context, keeps its storage, cookies, permissions and emulation apart
 * from every other context. An `ObservedUserContext` is one you don't control, such as an attached browser's
 * default context; a `UserContext` is one you do. There are only two levels, because reads happen on pages.
 *
 * The options a context is created with are declarations held for its life: `Options.emulation` is `emulate(…)`
 * without a scope, and `Options.permissions` is `grant(…)` without one.
 *
 * A context Strider creates saves downloads into a temporary directory of its own, removed when the context closes,
 * unless its `downloads` option says otherwise; the directory's path is on the context's span, as
 * `browser.context.downloads`. It also answers file choosers, canceling those no handler answers. Neither happens
 * on a backend without the capability (`downloads`, `fileChooser`), such as WebKit.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import type * as Equal from "effect/Equal"
import type * as Inspectable from "effect/Inspectable"
import type * as Pipeable from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as BrowserWorker from "./BrowserWorker.ts"
import type * as CookieJar from "./CookieJar.ts"
import type * as Deadline from "./Deadline.ts"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import type * as Emulation from "./Emulation.ts"
import type * as InitScript from "./InitScript.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import type * as RoutePhaseDiagnostic from "./internal/routePhaseDiagnostic.ts"
import type * as Keyboard from "./Keyboard.ts"
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
 * A context you can observe but not control, such as an attached browser's default context.
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
   *
   * **Example** (Waiting for a second page)
   *
   * ```ts import.meta.vitest
   * import { UserContext } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const secondPage = Effect.fn("secondPage")(
   *   function*(context: UserContext.ObservedUserContext) {
   *     const pages = yield* context.pages.waitFor((pages) => pages.length >= 2)
   *     return pages[1]
   *   }
   * )
   * ```
   */
  readonly pages: Watchable.Watchable<ReadonlyArray<Page.ObservedPage>>
  /**
   * The context's shared and service workers.
   *
   * **Example** (Waiting for the service worker)
   *
   * ```ts import.meta.vitest
   * import { UserContext } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const serviceWorker = Effect.fn("serviceWorker")(
   *   function*(context: UserContext.ObservedUserContext) {
   *     const workers = yield* context.workers.waitFor((workers) =>
   *       workers.some((each) => each.kind === "service")
   *     )
   *     return workers.find((each) => each.kind === "service")
   *   }
   * )
   * ```
   */
  readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.ObservedBrowserWorker>>
  /**
   * Waits as long as the context lives, then gives the reason it ended.
   *
   * **Example** (Logging why a context ended)
   *
   * ```ts import.meta.vitest
   * import { UserContext } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const logEnd = Effect.fn("logEnd")(function*(context: UserContext.ObservedUserContext) {
   *   const reason = yield* context.closed
   *   yield* Effect.log(`The context ended: ${reason._tag}`)
   * })
   * ```
   */
  readonly closed: Effect.Effect<Target.CloseReason>
  /**
   * Gains control of the context for the scope. Even reading its storage, with `exportStorageState`, needs
   * control.
   *
   * **Example** (Reading the storage of an attached browser's default context)
   *
   * ```ts import.meta.vitest
   * import { Browser } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const defaultStorage = Effect.fn("defaultStorage")(function*() {
   *   const browser = yield* Browser.Browser
   *   const context = yield* browser.defaultContext.control
   *   return yield* context.exportStorageState
   * })
   * ```
   */
  readonly control: Effect.Effect<UserContext, UserContextError, Scope.Scope>
}

/**
 * Permissions a context can grant, by their Permissions API names.
 *
 * **Details**
 *
 * The type takes any other name too, for permissions added after this list.
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
   * The origin the permissions apply to. Granting to every origin is `Unsupported` on Firefox
   * (`permissions.anyOrigin`).
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
   *
   * **Example** (A second page in the same session)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const openCart = Effect.fn("openCart")(function*(page: Page.Page) {
   *   const cart = yield* page.context.newPage
   *   yield* cart.goto("https://shop.example.com/cart")
   *   return cart
   * })
   * ```
   */
  readonly newPage: Effect.Effect<Page.Page, Page.PageError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
  readonly pages: Watchable.Watchable<ReadonlyArray<Page.Page>>
  readonly workers: Watchable.Watchable<ReadonlyArray<BrowserWorker.BrowserWorker>>
  /**
   * The context's cookies.
   */
  readonly cookies: CookieJar.CookieJar
  /**
   * Replaces saved storage in this context while preserving its existing pages and their URLs.
   *
   * **Details**
   *
   * Requires `storageStateTracking: true` at context creation. Untracked contexts and contexts with acquired
   * virtual authenticators refuse before mutation. Clears cookies, localStorage, IndexedDB and available origin-private
   * files for incoming and previously visited origins and partitions, then writes the supplied state.
   * Existing-page sessionStorage, HTTP cache and service-worker registrations are unchanged.
   *
   * **Gotchas**
   *
   * Stop page and worker writers and release storage handles first. Failure or interruption after mutation starts
   * can leave partial changes (`StorageState.PartiallyApplied` for runtime failures); a blocked IndexedDB deletion can complete later when its connection closes.
   * There is no rollback. This is not full Playwright equivalence. New-context import and export are unchanged.
   *
   * **Example** (Replacing a live context's login)
   *
   * ```ts import.meta.vitest
   * import { Browser, StorageState } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const reset = Effect.fn("reset")(function*(state: StorageState.StorageState) {
   *   const context = yield* Browser.newContext({ storageStateTracking: true })
   *   const page = yield* context.newPage
   *   yield* context.setStorageState(state)
   *   return page
   * })
   * ```
   */
  readonly setStorageState: (
    state: StorageState.StorageState
  ) => Effect.Effect<void, UserContextError | Target.TargetGone | Deadline.Timeout>
  /**
   * Reads the context's storage, to save and start other contexts from.
   *
   * **Example** (Saving a login as JSON)
   *
   * ```ts import.meta.vitest
   * import { Page, StorageState } from "@usestrider/browser"
   * import { Effect, Schema } from "effect"
   *
   * const saveLogin = Effect.fn("saveLogin")(function*(page: Page.Page) {
   *   const state = yield* page.context.exportStorageState
   *   return yield* Schema.encodeEffect(StorageState.Json)(state)
   * })
   * ```
   */
  readonly exportStorageState: Effect.Effect<StorageState.StorageState, UserContextError | Target.TargetGone>
  /**
   * A clock for every page of the context, as one timeline, once installed.
   */
  readonly clock: PageClock.PageClock
  /**
   * Intercepts requests matching `pattern` from every page and worker of the context, at one phase, while the
   * registration lives. A page's own routes are asked first; otherwise it works as `Page.route` does.
   *
   * **Details**
   *
   * The route is in force for requests that start after this declaration returns. On Chromium, a request
   * already underway without response interception may miss a later response route. Existing response pauses
   * select the current routes by precedence.
   *
   * The phase defaults to `"request"`. Response-only handlers require `{ phase: "response" }`, and
   * authentication handlers require `{ phase: "auth" }`. When options may omit the phase, the handler must
   * also handle `"request"`; union phases require a handler compatible with every possible phase.
   *
   * **Example** (Blocking analytics in every page)
   *
   * ```ts import.meta.vitest
   * import { Page, Route } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const blockAnalytics = Effect.fn("blockAnalytics")(function*(page: Page.Page) {
   *   yield* page.context.route(
   *     "https://analytics.example.com/**",
   *     () => Route.abort()
   *   )
   * })
   * ```
   */
  route<E, R, P extends Route.Phase = "request">(
    pattern: Url.Pattern | string,
    handler: Route.Handler<E, R, NoInfer<P>>,
    options: Route.Options<P> & { readonly phase: P }
  ): Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone | Deadline.Timeout, Scope.Scope | R>
  route<E, R>(
    pattern: Url.Pattern | string,
    handler: Route.Handler<E, R>,
    options?: Route.Options | undefined
  ): Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone | Deadline.Timeout, Scope.Scope | R>
  route<E, R, P extends Route.Phase = "request">(
    pattern: Url.Pattern | string,
    handler: Route.Handler<E, R, NoInfer<P> | "request">,
    options?: Route.Options<P> | undefined
  ): Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone | Deadline.Timeout, Scope.Scope | R>
  route<E, R, P extends Route.Phase = "request", D extends Route.Phase = P | "request">(
    pattern: Url.Pattern | string,
    handler: RoutePhaseDiagnostic.Handler<E, R, NoInfer<P> | "request", D>,
    options?: Route.Options<P> | undefined
  ): Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone | Deadline.Timeout, Scope.Scope | R>
  /**
   * Runs a script in every new document of every page while the registration lives.
   *
   * **Example** (Turning on a feature flag in every page)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const enableBeta = Effect.fn("enableBeta")(function*(page: Page.Page) {
   *   yield* page.context.addInitScript(() => {
   *     localStorage.setItem("beta", "on")
   *   })
   * })
   * ```
   */
  addInitScript(
    script: InitScript.Source,
    options?: InitScript.Options | undefined
  ): Effect.Effect<
    InitScript.InitScript,
    Declaration.DeclarationError | Target.TargetGone | Deadline.Timeout,
    Scope.Scope
  >
  /**
   * Overrides the given settings for every page while the registration lives.
   *
   * **Example** (Dark mode for every page)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const darkMode = Effect.fn("darkMode")(function*(page: Page.Page) {
   *   yield* page.context.emulate({ media: { colorScheme: "dark" } })
   * })
   * ```
   */
  emulate(
    settings: Emulation.Emulation
  ): Effect.Effect<
    Declaration.Registration,
    Declaration.DeclarationError | Target.TargetGone | Deadline.Timeout,
    Scope.Scope
  >
  /**
   * Grants permissions while the registration lives. Grants are combined (AND) with Permissions Policy.
   *
   * **Details**
   *
   * Removing one leaves the others in force. A name the browser doesn't know fails with `InvalidInput`
   * naming it: Firefox's list is shorter than Chromium's. WebKit can't grant permissions, so there `grant` fails
   * with `Unsupported` (`permissions`).
   *
   * **Example** (Geolocation for one origin)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const allowLocation = Effect.fn("allowLocation")(function*(page: Page.Page) {
   *   yield* page.context.grant(["geolocation"], { origin: "https://maps.example.com" })
   * })
   * ```
   */
  grant(
    permissions: ReadonlyArray<Permission>,
    options?: GrantOptions | undefined
  ): Effect.Effect<
    Declaration.Registration,
    Declaration.DeclarationError | Target.TargetGone | Deadline.Timeout,
    Scope.Scope
  >
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
   * Collects native request phase timings for this new context, read with `NetworkRequest.timing`.
   * No timing state is collected when false or omitted. Cannot enable timings on an existing context.
   *
   * @default false
   */
  readonly requestTiming?: boolean | undefined

  /**
   * Accepts HTTPS certificate errors in this context alone.
   *
   * **Details**
   *
   * Firefox and launched stock WebKit support this when creating a context. Chromium refuses `true` with
   * `Unsupported` because its certificate override affects the whole browser. Attached stock WebKit cannot
   * create contexts. Reclaiming an existing context refuses either explicit value: this setting can only
   * be chosen at creation. Omitting it preserves the existing context's setting.
   *
   * **Example** (A local HTTPS test site)
   *
   * ```ts import.meta.vitest
   * import { Browser } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const open = Effect.fn("open")(function*() {
   *   const context = yield* Browser.newContext({ acceptInsecureCerts: true })
   *   const page = yield* context.newPage
   *   yield* page.goto("https://localhost:8443")
   * })
   * ```
   *
   * @default false for new contexts
   */
  readonly acceptInsecureCerts?: boolean | undefined

  /**
   * Answers website authentication challenges with these credentials. User auth routes run first;
   * falling through uses these credentials. The pair is submitted once per request, including its whole
   * redirect chain. A later challenge in that chain is canceled, even at another origin.
   * `origin`, when given, must be an HTTP(S) origin and matches scheme, hostname and effective port.
   * An omitted origin permits any website. Proxy challenges never receive these credentials.
   * Chromium and Firefox support this option; stock WebKit refuses it with `Unsupported`.
   * Chromium enables request interception for this context, which can affect request timing.
   *
   * **Example** (Website credentials)
   *
   * ```ts import.meta.vitest
   * import { Browser } from "@usestrider/browser"
   * import { Config, Effect } from "effect"
   *
   * const open = Effect.fn("open")(function*() {
   *   const password = yield* Config.Redacted("HTTP_PASSWORD")
   *   return yield* Browser.newContext({
   *     httpCredentials: { origin: "https://example.com", username: "automation", password }
   *   })
   * })
   * ```
   *
   * @default no automatic website credentials or additional interception
   */
  readonly httpCredentials?: {
    readonly origin?: string | undefined
    readonly username: string
    readonly password: Redacted.Redacted<string>
  } | undefined

  /**
   * Routes this context's HTTP and HTTPS traffic through an HTTP proxy. `server` is an HTTP URL or
   * `host:port`, without credentials, path, query or fragment. An omitted port is 80.
   *
   * **Details**
   *
   * `bypass` lists hostnames or IP addresses to connect to directly, without URLs, ports, wildcards or CIDR.
   * Host matching follows the browser's native proxy rules, which may also exclude subdomains. Loopback
   * destinations (`localhost`, `127.0.0.1` and `::1`) remain direct on every backend.
   * Credentials answer proxy challenges once per request; website authentication still uses auth routes.
   * Stock WebKit supports proxies only when launched, and refuses credentials with `Unsupported`.
   * Firefox credentials require a freshly launched browser. Firefox shares its proxy authentication cache:
   * each successfully created context binds its endpoint's credential pair (or no credentials) for the connection's
   * life. Conflicting pending creations are refused. A confirmed creation rejection or unused setup
   * rollback releases only that creation's reservation; an uncertain outcome keeps it. Conflicting settings fail
   * with `Unsupported`, even after a successfully created context closes.
   * SOCKS and HTTPS proxy endpoints are refused with `Unsupported`.
   *
   * **Example** (An authenticated proxy)
   *
   * ```ts import.meta.vitest
   * import { Browser } from "@usestrider/browser"
   * import { Config, Effect } from "effect"
   *
   * const open = Effect.fn("open")(function*() {
   *   const password = yield* Config.Redacted("PROXY_PASSWORD")
   *   return yield* Browser.newContext({
   *     proxy: {
   *       server: "http://proxy.example.com:8080",
   *       credentials: { username: "automation", password }
   *     }
   *   })
   * })
   * ```
   *
   * @default existing browser proxy settings; bypass defaults to [], credentials to none
   */
  readonly proxy?: {
    readonly server: string
    readonly bypass?: ReadonlyArray<string> | undefined
    readonly credentials?: {
      readonly username: string
      readonly password: Redacted.Redacted<string>
    } | undefined
  } | undefined

  /**
   * Retains visited origins and partitions so `setStorageState` can clear them after their pages close.
   *
   * **Details**
   *
   * Chosen only when creating a context; reclaiming a context refuses either explicit value.
   * Contexts that omit this option collect no storage-replacement history.
   *
   * @default false
   */
  readonly storageStateTracking?: boolean | undefined
  /**
   * Storage to start from, such as a saved login.
   *
   * @default empty storage
   */
  readonly storageState?: StorageState.StorageState | undefined
  /**
   * What happens to a dialog no handler decides: `"dismiss"` and `"accept"` decide it at once, and `"leaveOpen"`
   * leaves it open, blocking its page. Under `"dismiss"` a `beforeunload` dialog still leaves the page, so closing
   * it never hangs.
   *
   * @default "dismiss"
   */
  readonly dialogs?: "dismiss" | "accept" | "leaveOpen" | undefined
  /**
   * `"emulated"` makes every page report focus, so many pages can run at once. `Unsupported` on Firefox and
   * WebKit (`emulation.focus`).
   *
   * @default "system"
   */
  readonly focus?: "system" | "emulated" | undefined
  /**
   * The keyboard layout that key presses and typing use on the context's pages: `press`, `pressSequentially` and
   * `page.keyboard`. On Firefox a key event's `key` follows the layout, but its `code` is the one Firefox gives that
   * key on a US keyboard, and there are no AltGr or dead keys. WebKit types characters and named keys, not a
   * layout's physical keys (`input.keyboardLayout`).
   *
   * @default "us"
   */
  readonly keyboardLayout?: Keyboard.Layout | undefined
  /**
   * Events kept for `history`, per event module, for each page and for the context; 0 keeps none.
   *
   * @default 100
   */
  readonly eventLog?: number | undefined
  /**
   * Where the context's downloads go: `"temporary"`, a directory Strider makes for the context and removes after
   * it; `"deny"`, no downloads are allowed; or `{ directory }`, one the caller owns, which is never removed.
   *
   * **Details**
   *
   * - A browser the program shares no file system with saves downloads where it can't read them: on such a
   *   browser, `Download.stream` and `saveAs` fail with `Unsupported`.
   * - A backend without the `downloads` capability, such as WebKit, has no downloads by default, and any value
   *   fails the context with `Unsupported`.
   *
   * @default "temporary", or none on a backend without the `downloads` capability
   */
  readonly downloads?: "temporary" | "deny" | { readonly directory: string } | undefined
  /**
   * Settings held for the context's life, declared before its first page: `emulate(…)` without a scope. A
   * field the backend can't apply fails the context with `Unsupported`.
   *
   * @default none
   */
  readonly emulation?: Emulation.Emulation | undefined
  /**
   * Permissions granted for the context's life, for every origin: `grant(…)` without a scope. `Unsupported`
   * on Firefox, which grants to one origin at a time (`permissions.anyOrigin`), and on WebKit (`permissions`).
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
  StorageState.PartiallyApplied,
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure,
  Reason.ViewportMismatch
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
 * **Example** (Falling back where focus can't be emulated)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const parallelContext = Effect.fn("parallelContext")(function*() {
 *   return yield* Browser.newContext({ focus: "emulated" }).pipe(
 *     Effect.catchReason("UserContextError", "Unsupported", () => Browser.newContext())
 *   )
 * })
 * ```
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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
