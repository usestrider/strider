/**
 * User contexts (the spec's term; Playwright calls them browser contexts), at two access levels.
 *
 * Options at creation are declarations for the context's whole life; members such as `emulate` and `grant`
 * are the same declarations, scoped. One concept, two lifetimes: `UserContextOptions.emulation` is
 * `emulate(...)` held for the context's life. Reading storage needs control.
 */
import type { DateTime, Duration, Effect, Option, Redacted, Scope } from "effect"
import type { Cookies } from "effect/http"
import type { CookieDomain, CookieName, Locale, Origin, Site, TimeZoneId, Url, UrlPattern, UserContextId } from "./Brand.ts"
import type { CloseReason, DeclarationError, PageError, RouteError, StorageError, StorageStateError, UserContextError } from "./Errors.ts"
import type { BrowserWorker, ObservedBrowserWorker } from "./Events.ts"
import type { InitScript, InitScriptOptions, InitScriptSource, Registration, RouteHandler, RouteRegistration } from "./Network.ts"
import type { ObservedPage, Page } from "./Page.ts"
import type { PageClock } from "./PageClock.ts"
import type { Watchable } from "./Watchable.ts"

export interface ObservedUserContext {                  // one we don't control, e.g. the default context when attached
  readonly id: UserContextId
  readonly pages: Watchable<ReadonlyArray<ObservedPage>>
  readonly workers: Watchable<ReadonlyArray<ObservedBrowserWorker>>   // shared and service workers (new in the sketch)
  readonly closed: Effect.Effect<CloseReason>
  readonly control: Effect.Effect<UserContext, UserContextError, Scope.Scope>   // explicit; reading storage needs it too
}

export interface UserContext extends ObservedUserContext {   // two levels only: reads happen on pages
  readonly newPage: Effect.Effect<Page, PageError, Scope.Scope>   // closed with its unsolicited popups when the scope closes
  readonly pages: Watchable<ReadonlyArray<Page>>
  readonly workers: Watchable<ReadonlyArray<BrowserWorker>>
  readonly cookies: CookieJar                           // a sub-handle bound to the context (new in the sketch)
  readonly exportStorageState: Effect.Effect<Redacted.Redacted<StorageStateBytes>, StorageStateError>
  readonly clock: PageClock                             // context-wide timeline (opt-in)
  route<E, R>(pattern: UrlPattern | string, handler: RouteHandler<E, R>): Effect.Effect<RouteRegistration, RouteError, Scope.Scope | R>
  addInitScript(script: InitScriptSource, options?: InitScriptOptions): Effect.Effect<InitScript, DeclarationError, Scope.Scope>
  emulate(settings: Emulation): Effect.Effect<Registration, DeclarationError, Scope.Scope>
  /** Grants permissions while the registration lives; combined (AND) with Permissions Policy (new in the sketch). */
  grant(permissions: ReadonlyArray<Permission>, options?: { readonly origin?: Origin | string }): Effect.Effect<Registration, DeclarationError, Scope.Scope>   // default every origin
}

export interface UserContextOptions {                   // each unset option keeps the browser's own value unless a default is stated
  readonly storageState?: StorageState                  // from StorageState.import(bytes)
  readonly dialogs?: "dismiss" | "accept" | "leaveOpen" // decision when no handler claims a dialog; default "dismiss"
  readonly focus?: "system" | "emulated"                // default "system"; "emulated" makes every page report focus
  readonly eventLog?: number                            // retained events per module and page, for history; default 100, 0 keeps none
  readonly emulation?: Emulation                        // held for the context's life (viewport, locale, timezone moved here in the sketch)
  readonly permissions?: ReadonlyArray<Permission>      // granted for the context's life, every origin
}

/**
 * Settings a declaration overrides while it lives (new in the sketch: API.md only named Emulation). Unset
 * fields are untouched. Restored on removal only when the previous value is known and access permits it.
 * A field the backend can't apply fails with Unsupported, naming it.
 */
export interface Emulation {
  readonly viewport?: {
    readonly width: number; readonly height: number     // CSS pixels by definition
    readonly deviceScaleFactor?: number                 // default 1
    readonly mobile?: boolean                           // default false
  }
  readonly userAgent?: string
  readonly locale?: Locale | string
  readonly timezone?: TimeZoneId | string
  readonly geolocation?: { readonly latitude: number; readonly longitude: number; readonly accuracy?: number } | "unavailable"
  readonly media?: {
    readonly type?: "screen" | "print"
    readonly colorScheme?: "light" | "dark" | "noPreference"
    readonly reducedMotion?: "reduce" | "noPreference"
    readonly forcedColors?: "active" | "none"
    readonly contrast?: "more" | "less" | "custom" | "noPreference"
  }
  readonly network?: "offline" | {
    readonly download: number                           // bytes per second
    readonly upload: number
    readonly latency: Duration.Input
  }
  readonly cpuSlowdown?: number                         // a factor; CDP only
  readonly javaScript?: "enabled" | "disabled"
  readonly touch?: boolean
}

export type Permission =
  | "geolocation" | "notifications" | "camera" | "microphone" | "clipboard-read" | "clipboard-write"
  | "midi" | "background-sync" | "persistent-storage" | "accelerometer" | "gyroscope" | "magnetometer"
  | "payment-handler" | "storage-access" | "local-fonts" | "screen-wake-lock"
  | (string & {})

// ── Cookies (new in the sketch) ───────────────────────────────
export type PartitionKey =
  | { readonly _tag: "Unpartitioned" }
  | { readonly _tag: "Partitioned"; readonly topLevelSite: Site; readonly crossSiteAncestor: Option.Option<boolean> }
export interface BrowserCookie {                        // what a browser stores: Effect's cookie attributes plus browser-only fields
  readonly name: CookieName
  readonly value: Redacted.Redacted<string>             // cookie values are classified
  readonly domain: CookieDomain
  readonly path: string
  readonly expires: Option.Option<DateTime.Utc>         // None: a session cookie
  readonly httpOnly: boolean
  readonly secure: boolean
  readonly sameSite: "strict" | "lax" | "none"
  readonly partitionKey: PartitionKey
  readonly priority: "low" | "medium" | "high"
}
export interface CookieInput {
  readonly name: CookieName | string
  readonly value: string | Redacted.Redacted<string>
  readonly scope:                                       // which one is always stated
    | { readonly _tag: "Url"; readonly url: Url | string }
    | { readonly _tag: "Domain"; readonly domain: CookieDomain | string; readonly path: string }
  readonly expires?: DateTime.DateTime.Input            // default: a session cookie
  readonly httpOnly?: boolean                           // default false
  readonly secure?: boolean                             // default false
  readonly sameSite?: "strict" | "lax" | "none"         // default "lax"
  readonly partitionKey?: PartitionKey                  // default Unpartitioned
}
export interface CookieJar {
  readonly list: Effect.Effect<ReadonlyArray<BrowserCookie>, StorageError>   // every cookie in the context
  listFor(url: Url | string): Effect.Effect<ReadonlyArray<BrowserCookie>, StorageError>   // what a request to url would send
  set(cookie: CookieInput): Effect.Effect<void, StorageError>                // a change, not a declaration: it isn't undone with a scope
  remove(match: { readonly name: CookieName | string; readonly domain?: CookieDomain | string; readonly path?: string }): Effect.Effect<void, StorageError>
  readonly clear: Effect.Effect<void, StorageError>
  /** Converts to effect/http's Cookie, unredacting the value explicitly. */
  toCookie(cookie: BrowserCookie): Cookies.Cookie
}

// ── Storage state ─────────────────────────────────────────────
declare const StorageStateBytesTypeId: unique symbol
export type StorageStateBytes = Uint8Array & { readonly [StorageStateBytesTypeId]: "StorageStateBytes" }
declare const StorageStateTypeId: unique symbol
export interface StorageState { readonly [StorageStateTypeId]: "StorageState" }   // cookies, localStorage and IndexedDB, per partition
export declare const StorageState: {
  /** Validates either way; accepts bytes read back from disk. */
  import(bytes: Redacted.Redacted<StorageStateBytes | Uint8Array>): Effect.Effect<StorageState, StorageStateError>
}
