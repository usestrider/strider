/**
 * What operations act on: how targets are identified, and how they end.
 *
 * A target is a page, a frame, a document, a JavaScript realm, a user context or the browser. Each has a
 * spec id, minted by the browser and meaningful only relative to where it came from, so ids are accepted
 * only in branded form and checked against their origin when used. When a target ends, every operation on
 * it fails with `TargetGone`, which says what ended and why.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Diagnostics from "./Diagnostics.ts"

/**
 * Schema for the id of a navigable: a page or a frame (the spec's term).
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const NavigableId = Schema.String.pipe(Schema.brand("~effect-browser/Target/NavigableId"))

/**
 * Id of a navigable: a page or a frame.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type NavigableId = typeof NavigableId.Type

/**
 * Schema for the id of one document. A navigation that replaces the document mints a new id.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DocumentId = Schema.String.pipe(Schema.brand("~effect-browser/Target/DocumentId"))

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
export const RealmId = Schema.String.pipe(Schema.brand("~effect-browser/Target/RealmId"))

/**
 * Id of one JavaScript realm.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type RealmId = typeof RealmId.Type

/**
 * Schema for why a target ended.
 *
 * **Details**
 *
 * - Browser-wide: `BrowserClosed`, `BrowserCrashed`, `ConnectionLost`, `ModelUnavailable`.
 * - Context and access: `UserContextRemoved`, `AccessReleased`, `PrerenderActivated`.
 * - Pages and frames: `PageClosed` (with who closed it), `PageCrashed`, `FrameDetached`.
 * - Documents and realms: `DocumentReplaced`, `DocumentEvicted`, `DocumentDestroyed`, `DocumentUnloaded`,
 *   `RealmDestroyed`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CloseReason = Schema.Union([
  Schema.TaggedStruct("BrowserClosed", {}),
  Schema.TaggedStruct("BrowserCrashed", {}),
  Schema.TaggedStruct("ConnectionLost", {}),
  Schema.TaggedStruct("ModelUnavailable", {}),
  Schema.TaggedStruct("UserContextRemoved", {}),
  Schema.TaggedStruct("AccessReleased", {}),
  Schema.TaggedStruct("PrerenderActivated", {}),
  Schema.TaggedStruct("PageClosed", { by: Schema.Literals(["command", "script", "userContextRemoved", "browser"]) }),
  Schema.TaggedStruct("PageCrashed", {}),
  Schema.TaggedStruct("FrameDetached", {}),
  Schema.TaggedStruct("DocumentReplaced", {}),
  Schema.TaggedStruct("DocumentEvicted", {}),
  Schema.TaggedStruct("DocumentDestroyed", {}),
  Schema.TaggedStruct("DocumentUnloaded", {}),
  Schema.TaggedStruct("RealmDestroyed", {})
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
  Schema.TaggedStruct("Browser", {})
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

const TargetGoneTypeId = "~effect-browser/Target/TargetGone"

/**
 * Error for an operation whose target ended before or while it ran.
 *
 * **Details**
 *
 * Every operation on a page, frame, document, realm, context or browser can fail this way, so it is not part
 * of any module's error. A page that closes normally ends event streams normally instead; only operations
 * that needed the target fail.
 *
 * **Example** (Treating a closed popup as done)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Page } from "effect-browser"
 *
 * const dismiss = Effect.fn("dismiss")(function*(popup: Page.Page) {
 *   yield* popup.getByRole("button", { name: "Close" }).click().pipe(
 *     Effect.catchTag("TargetGone", (gone) =>
 *       gone.reason._tag === "PageClosed" ? Effect.void : Effect.fail(gone))
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
    return `${this.target._tag} gone: ${this.reason._tag}`
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
