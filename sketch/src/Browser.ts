/**
 * The Browser service and the backends that provide it.
 *
 * Backends are imports, not option values (effect-browser/chromium, /firefox, /webkit, /bidi), so only the
 * protocol code you import is loaded. A launch uses a temporary profile, acquired with
 * FileSystem.makeTempDirectoryScoped before the browser starts and deleted after it exits.
 */
import { Context } from "effect"
import type { Config, Effect, FileSystem, Layer, Redacted, Scope } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import type { Socket } from "effect/socket"
import type { LocalPath, Url } from "./Brand.ts"
import type { ConnectError, LaunchError, PageError, UserContextError } from "./Errors.ts"
import type { ObservedPage, Page } from "./Page.ts"
import type { ObservedUserContext, UserContext, UserContextOptions } from "./UserContext.ts"
import type { Watchable } from "./Watchable.ts"

export interface BackendInfo {                          // fixed for the connection
  readonly product: "chrome" | "chromium" | "edge" | "firefox" | "webkit" | "safari" | (string & {})
  readonly version: string
  readonly protocol: "cdp" | "bidi" | "webkit"
  readonly revision: string
}
export interface CapabilityEntry {
  readonly name: string
  readonly status: "supported" | "partial" | "unsupported" | "unknown"
  readonly evidence: string                             // the probe or profile behind it
  readonly limitations: ReadonlyArray<string>
}
export interface CapabilitySet {
  readonly entries: ReadonlyArray<CapabilityEntry>
  has(name: string): boolean
}

export interface BrowserHandle {
  readonly info: BackendInfo
  readonly capabilities: Watchable<CapabilitySet>      // refined as probes complete
  readonly newContext: Effect.Effect<UserContext, UserContextError, Scope.Scope>   // owned; removed when the scope closes
  newContextWith(options: UserContextOptions): Effect.Effect<UserContext, UserContextError, Scope.Scope>
  readonly newPage: Effect.Effect<Page, PageError, Scope.Scope>   // a fresh context and page, released together: newContext, then newPage
  newPageWith(options: UserContextOptions): Effect.Effect<Page, PageError, Scope.Scope>
  readonly pages: Watchable<ReadonlyArray<ObservedPage>>   // attach mode: what exists, and changes
  readonly defaultContext: ObservedUserContext          // fixed: exists for the whole connection
}

export class Browser extends Context.Service<Browser, BrowserHandle>()("effect-browser/Browser") {}

// ── Launching ─────────────────────────────────────────────────
export interface LaunchProfile {                        // a value you can inspect; the actual args and prefs are recorded in the launch span
  readonly name: "stock" | "automation" | "concurrent"
  readonly args: ReadonlyArray<string>
  readonly prefs: Readonly<Record<string, string | number | boolean>>
}
export declare const LaunchProfile: {
  readonly stock: LaunchProfile                         // the browser's own defaults; nothing added
  readonly automation: LaunchProfile                    // first-run, sync and update prompts off; nothing a page can observe
  readonly concurrent: LaunchProfile                    // automation, plus background-timer and renderer throttling off
}
export interface LaunchOptions {
  readonly headless?: boolean                           // default true
  readonly channel?: "stable" | "beta" | "canary"       // default: Chrome for Testing, not an installed channel
  readonly executablePath?: LocalPath | string
  readonly args?: ReadonlyArray<string>
  readonly profile?: LaunchProfile                      // default LaunchProfile.automation
  readonly userDataDir?: LocalPath | string             // a profile directory you own; never deleted, and locked while in use
}
type LaunchRequirements = ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem

export interface LaunchingBackend {
  readonly launch: Layer.Layer<Browser, LaunchError, LaunchRequirements>
  launchWith(options: LaunchOptions): Layer.Layer<Browser, LaunchError, LaunchRequirements>
  launchConfig(options: Config.Wrap<LaunchOptions>): Layer.Layer<Browser, LaunchError | Config.ConfigError, LaunchRequirements>
}
export interface ConnectOptions {
  readonly headers?: Readonly<Record<string, string | Redacted.Redacted<string>>>
}
export interface ConnectingBackend {
  connect(endpoint: Url | string, options?: ConnectOptions): Layer.Layer<Browser, ConnectError, Socket.WebSocketConstructor>
}

export declare const Chromium: LaunchingBackend & ConnectingBackend   // effect-browser/chromium: CDP
export declare const Firefox: LaunchingBackend & ConnectingBackend    // effect-browser/firefox: BiDi
export declare const WebKit: LaunchingBackend & {                     // effect-browser/webkit: Playwright-patched builds; stock attach
  attach(endpoint: Url | string, options?: ConnectOptions): Layer.Layer<Browser, ConnectError, Socket.WebSocketConstructor>
}
export declare const Bidi: ConnectingBackend                          // effect-browser/bidi: any BiDi endpoint
