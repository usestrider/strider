/**
 * What operations act on, how each one is identified, and how it ends.
 *
 * A target is a page, a frame, a document, a JavaScript realm, a user context or the browser. A dialog or file
 * chooser awaiting a decision, a download and a request's hop can also end, and are named when they do. Strider gives each an
 * id, which only means something where it came from, so ids are accepted only in branded form and checked against
 * their origin when used. When a target ends, every operation on it fails with `TargetGone`, which says what ended
 * and why.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Diagnostics from "./Diagnostics.ts"

/**
 * Schema for the id of a page or a frame, which the HTML spec calls a navigable.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NavigableId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Target/NavigableId"))

/**
 * Id of a page or a frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type NavigableId = typeof NavigableId.Type

/**
 * Schema for the id of one document. A navigation that replaces the document gives the new one a new id.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DocumentId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Target/DocumentId"))

/**
 * Id of one document.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DocumentId = typeof DocumentId.Type

/**
 * Schema for the id of one JavaScript realm: a document's main or isolated world, or a worker.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const RealmId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Target/RealmId"))

/**
 * Id of one JavaScript realm.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RealmId = typeof RealmId.Type

/**
 * The one-line fix every close reason carries: a field of its own, so a reason built without one has this.
 */
const hinted = (hint: string) => Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed(hint)))

/**
 * Reason for a target that ended because the browser closed.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class BrowserClosed extends Schema.Error<BrowserClosed>("@usestrider/browser/Target/BrowserClosed")({
  _tag: Schema.tag("BrowserClosed"),
  hint: hinted("Launch or connect to a browser again")
}) {
  override get message(): string {
    return `The browser closed (${this.hint})`
  }
}

/**
 * Reason for a target that ended because the browser crashed.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class BrowserCrashed extends Schema.Error<BrowserCrashed>("@usestrider/browser/Target/BrowserCrashed")({
  _tag: Schema.tag("BrowserCrashed"),
  hint: hinted("Launch the browser again; its own log says why")
}) {
  override get message(): string {
    return `The browser crashed (${this.hint})`
  }
}

/**
 * Reason for a target that ended because Strider's connection to the browser broke.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class ConnectionLost extends Schema.Error<ConnectionLost>("@usestrider/browser/Target/ConnectionLost")({
  _tag: Schema.tag("ConnectionLost"),
  hint: hinted("Connect again; the browser may have exited")
}) {
  override get message(): string {
    return `The connection to the browser was lost (${this.hint})`
  }
}

/**
 * Reason for a target that ended because Strider can no longer tell what the browser holds.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class ModelUnavailable extends Schema.Error<ModelUnavailable>("@usestrider/browser/Target/ModelUnavailable")({
  _tag: Schema.tag("ModelUnavailable"),
  hint: hinted("Open the page again; if it keeps happening, report it")
}) {
  override get message(): string {
    return `Strider lost track of the browser's state (${this.hint})`
  }
}

/**
 * Reason for a target that ended because its user context was removed.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class UserContextRemoved
  extends Schema.Error<UserContextRemoved>("@usestrider/browser/Target/UserContextRemoved")({
    _tag: Schema.tag("UserContextRemoved"),
    hint: hinted("Create a new user context")
  })
{
  override get message(): string {
    return `The user context was removed (${this.hint})`
  }
}

/**
 * Reason for a handle whose access was released: the `Scope` that held it closed.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class AccessReleased extends Schema.Error<AccessReleased>("@usestrider/browser/Target/AccessReleased")({
  _tag: Schema.tag("AccessReleased"),
  hint: hinted("Call `.control` or `.inspect` again for a new handle")
}) {
  override get message(): string {
    return `The access this handle held was released (${this.hint})`
  }
}

/**
 * Reason for a page that ended because a prerendered document took its place.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class PrerenderActivated
  extends Schema.Error<PrerenderActivated>("@usestrider/browser/Target/PrerenderActivated")({
    _tag: Schema.tag("PrerenderActivated"),
    hint: hinted("Use the page the prerendered one became")
  })
{
  override get message(): string {
    return `A prerendered page took over (${this.hint})`
  }
}

/**
 * Reason for a target that ended because its page's renderer crashed.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class PageCrashed extends Schema.Error<PageCrashed>("@usestrider/browser/Target/PageCrashed")({
  _tag: Schema.tag("PageCrashed"),
  hint: hinted("Open the page again")
}) {
  override get message(): string {
    return `The page crashed (${this.hint})`
  }
}

/**
 * Reason for a target that ended because its frame was removed from the page.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class FrameDetached extends Schema.Error<FrameDetached>("@usestrider/browser/Target/FrameDetached")({
  _tag: Schema.tag("FrameDetached"),
  hint: hinted("Find the frame again from its page's frames")
}) {
  override get message(): string {
    return `The frame was detached (${this.hint})`
  }
}

/**
 * Reason for a target that ended because a navigation replaced its document.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class DocumentReplaced extends Schema.Error<DocumentReplaced>("@usestrider/browser/Target/DocumentReplaced")({
  _tag: Schema.tag("DocumentReplaced"),
  hint: hinted("Locate again in the page's current document")
}) {
  override get message(): string {
    return `The document was replaced (${this.hint})`
  }
}

/**
 * Reason for a target that ended because the browser dropped its document from the back-forward cache.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class DocumentEvicted extends Schema.Error<DocumentEvicted>("@usestrider/browser/Target/DocumentEvicted")({
  _tag: Schema.tag("DocumentEvicted"),
  hint: hinted("Navigate to it again")
}) {
  override get message(): string {
    return `The document was evicted (${this.hint})`
  }
}

/**
 * Reason for a target that ended because the browser destroyed its document.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class DocumentDestroyed extends Schema.Error<DocumentDestroyed>("@usestrider/browser/Target/DocumentDestroyed")({
  _tag: Schema.tag("DocumentDestroyed"),
  hint: hinted("Locate again in the page's current document")
}) {
  override get message(): string {
    return `The document was destroyed (${this.hint})`
  }
}

/**
 * Reason for a target that ended because its document unloaded.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class DocumentUnloaded extends Schema.Error<DocumentUnloaded>("@usestrider/browser/Target/DocumentUnloaded")({
  _tag: Schema.tag("DocumentUnloaded"),
  hint: hinted("Locate again in the page's current document")
}) {
  override get message(): string {
    return `The document was unloaded (${this.hint})`
  }
}

/**
 * Reason for a target that ended because its JavaScript realm ended, such as with its document or a worker.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class RealmDestroyed extends Schema.Error<RealmDestroyed>("@usestrider/browser/Target/RealmDestroyed")({
  _tag: Schema.tag("RealmDestroyed"),
  hint: hinted("Evaluate again in the page's current realm")
}) {
  override get message(): string {
    return `The realm was destroyed (${this.hint})`
  }
}

/**
 * Reason for a WebSocket or EventSource that closed, whether the page or the server closed it.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NetworkConnectionClosed
  extends Schema.Error<NetworkConnectionClosed>("@usestrider/browser/Target/NetworkConnectionClosed")({
    _tag: Schema.tag("NetworkConnectionClosed"),
    hint: hinted("Open the connection again")
  })
{
  override get message(): string {
    return `The network connection closed (${this.hint})`
  }
}

/**
 * Reason for a page that closed.
 *
 * **Details**
 *
 * `by` says what closed it: `"command"` when `page.close` did, `"script"` when the page closed itself or the user
 * did, `"userContextRemoved"` when its context was removed, and `"browser"` when the browser closed or Strider
 * can no longer tell why.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class PageClosed extends Schema.Error<PageClosed>("@usestrider/browser/Target/PageClosed")({
  _tag: Schema.tag("PageClosed"),
  by: Schema.Literals(["command", "script", "userContextRemoved", "browser"]),
  hint: hinted("Open a new page")
}) {
  override get message(): string {
    return `The page closed (by ${this.by}; ${this.hint})`
  }
}

/**
 * Schema for why a target ended: one of the reasons below, each a class with a `hint`.
 *
 * **Details**
 *
 * - Browser-wide: `BrowserClosed`, `BrowserCrashed`, `ConnectionLost`, `ModelUnavailable` (Strider lost track
 *   of the browser's state).
 * - Context and access: `UserContextRemoved`, `AccessReleased`, `PrerenderActivated`.
 * - Pages and frames: `PageClosed` (with what closed it), `PageCrashed`, `FrameDetached`.
 * - Documents and realms: `DocumentReplaced`, `DocumentEvicted`, `DocumentDestroyed`, `DocumentUnloaded`,
 *   `RealmDestroyed`.
 * - Connections: `NetworkConnectionClosed`, for a WebSocket or EventSource the page or the server closed.
 *   (`ConnectionLost` is the browser's connection.)
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CloseReason = Schema.Union([
  BrowserClosed,
  BrowserCrashed,
  ConnectionLost,
  ModelUnavailable,
  UserContextRemoved,
  AccessReleased,
  PrerenderActivated,
  PageClosed,
  PageCrashed,
  FrameDetached,
  DocumentReplaced,
  DocumentEvicted,
  DocumentDestroyed,
  DocumentUnloaded,
  RealmDestroyed,
  NetworkConnectionClosed
])

/**
 * Why a target ended.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CloseReason = typeof CloseReason.Type

/**
 * Schema for which target an operation was acting on.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Description = Schema.Union([
  Schema.TaggedStruct("Page", { id: NavigableId }),
  Schema.TaggedStruct("Frame", { id: NavigableId }),
  Schema.TaggedStruct("Document", { id: DocumentId }),
  Schema.TaggedStruct("Realm", { id: RealmId }),
  Schema.TaggedStruct("UserContext", {}),
  Schema.TaggedStruct("Browser", {}),
  Schema.TaggedStruct("Obligation", { id: Schema.String }),
  Schema.TaggedStruct("Download", { id: Schema.String }),
  Schema.TaggedStruct("Hop", { id: Schema.String })
])

/**
 * Which target an operation was acting on.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Description = typeof Description.Type

/**
 * Schema for which target produced an event: a page, or a worker's realm.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const EventOrigin = Schema.Union([
  Schema.TaggedStruct("Page", { page: NavigableId }),
  Schema.TaggedStruct("Worker", { realm: RealmId })
])

/**
 * Which target produced an event: a page, or a worker's realm.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type EventOrigin = typeof EventOrigin.Type

const TargetGoneTypeId = "~@usestrider/browser/Target/TargetGone"

/**
 * Error for an operation whose target ended before or while it ran.
 *
 * **Details**
 *
 * Every operation on a page, frame, document, realm, context or browser can fail this way, so it isn't part of
 * any module's error. `reason` is one of the `CloseReason` classes, such as `PageClosed`, each with a `hint` that
 * says what to do next; match one with `Effect.catchReason`. When a page closes normally, its event streams end instead of failing; its waits and other
 * operations still fail.
 *
 * **Example** (Treating a closed popup as done)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const dismiss = Effect.fn("dismiss")(function*(popup: Page.Page) {
 *   yield* popup.getByRole("button", { name: "Close" }).click().pipe(
 *     Effect.catchReason("TargetGone", "PageClosed", () => Effect.void)
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class TargetGone extends Schema.TaggedError<TargetGone>(TargetGoneTypeId)("TargetGone", {
  target: Description,
  reason: CloseReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [TargetGoneTypeId] = TargetGoneTypeId
  override get message(): string {
    return `${this.target._tag} gone: ${this.reason.message}`
  }
}

/**
 * Checks whether a value is a `TargetGone`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isTargetGone = (u: unknown): u is TargetGone => Predicate.hasProperty(u, TargetGoneTypeId)
