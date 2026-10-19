/**
 * Brands and ids (principle 14).
 *
 * Outputs are always branded. Inputs take the brand only where two meanings could be confused
 * (local vs remote paths, CSS vs device pixels); elsewhere a plain string is parsed at the boundary.
 * Tokens (ids, refs, generations, handles) are accepted only branded, and are checked against their
 * origin when used, because a brand doesn't prove provenance.
 */
import type { Brand } from "effect"

type Branded<A, K extends string> = Brand.Branded<A, K>

// ── Values whose meaning is intrinsic ─────────────────────────
export type Url = Branded<string, "Url">                    // an absolute URL (WHATWG parse); immutable and Equal by value, unlike URL
export type UrlPattern = Branded<string, "UrlPattern">      // a glob or a URLPattern; matched, never navigated to
export type Origin = Branded<string, "Origin">
export type Site = Branded<string, "Site">                  // registrable domain, for partition keys
export type HttpStatusCode = Branded<number, "HttpStatusCode">   // 100–599; assignable to number wherever effect/http expects one
export type CookieName = Branded<string, "CookieName">
export type CookieDomain = Branded<string, "CookieDomain">
export type LocalPath = Branded<string, "LocalPath">        // on the driver's machine
export type RemotePath = Branded<string, "RemotePath">      // on the browser's host; never interchangeable with LocalPath
export type CssPixels = Branded<number, "CssPixels">        // layout units
export type DevicePixels = Branded<number, "DevicePixels">  // differ from CSS pixels by the device pixel ratio
export type Locale = Branded<string, "Locale">              // BCP 47
export type TimeZoneId = Branded<string, "TimeZoneId">      // IANA
export type FileName = Branded<string, "FileName">
export type MimeType = Branded<string, "MimeType">
export type KeyName = Branded<string, "KeyName">            // a key value ("Enter", "a", "ArrowDown"); see Keyboard
export type SecretName = Branded<string, "SecretName">      // an agent secret placeholder, used as %name%
export type PageName = Branded<string, "PageName">          // a CLI page name chosen with --name

// ── Tokens: minted by the library, meaningful only relative to their origin ──
export type UserContextId = Branded<string, "UserContextId">
export type NavigableId = Branded<string, "NavigableId">
export type DocumentId = Branded<string, "DocumentId">
export type DocumentGeneration = Branded<number, "DocumentGeneration">
export type RealmId = Branded<string, "RealmId">
export type NavigationId = Branded<string, "NavigationId">
export type RequestId = Branded<string, "RequestId">
export type RequestHopId = Branded<string, "RequestHopId">   // (RequestId, redirect count)
export type DownloadId = Branded<string, "DownloadId">
export type ConnectionId = Branded<string, "ConnectionId">
export type PromptId = Branded<string, "PromptId">
export type InitScriptId = Branded<string, "InitScriptId">
export type OperationId = Branded<string, "OperationId">
export type RefId = Branded<string, "RefId">                // an agent snapshot ref, e.g. e12
export type MonotonicInstant = Branded<number, "MonotonicInstant">   // nanoseconds on the live monotonic clock; never TestClock

/** WAI-ARIA roles; the open string keeps newer roles usable before this list catches up. */
export type AriaRole =
  | "alert" | "alertdialog" | "application" | "article" | "banner" | "blockquote" | "button" | "caption" | "cell"
  | "checkbox" | "code" | "columnheader" | "combobox" | "complementary" | "contentinfo" | "definition" | "deletion"
  | "dialog" | "directory" | "document" | "emphasis" | "feed" | "figure" | "form" | "generic" | "grid" | "gridcell"
  | "group" | "heading" | "img" | "insertion" | "link" | "list" | "listbox" | "listitem" | "log" | "main" | "marquee"
  | "math" | "menu" | "menubar" | "menuitem" | "menuitemcheckbox" | "menuitemradio" | "meter" | "navigation" | "none"
  | "note" | "option" | "paragraph" | "presentation" | "progressbar" | "radio" | "radiogroup" | "region" | "row"
  | "rowgroup" | "rowheader" | "scrollbar" | "search" | "searchbox" | "separator" | "slider" | "spinbutton" | "status"
  | "strong" | "subscript" | "superscript" | "switch" | "tab" | "table" | "tablist" | "tabpanel" | "term" | "textbox"
  | "time" | "timer" | "toolbar" | "tooltip" | "tree" | "treegrid" | "treeitem"
  | (string & {})
