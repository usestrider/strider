/**
 * Errors as users see them (principle 10).
 *
 * An ordinary call fails with `TargetGone`, `Timeout` or its own domain error. Detail lives in a `reason`
 * (matched with `Effect.catchReason`), every reason carries a one-line `hint`, and every failure carries the
 * diagnostic envelope. Implemented as `Schema.TaggedError` classes; sketched here as their shapes.
 */
import type { Cause, Duration, Option } from "effect"
import type { DocumentId, MonotonicInstant, NavigableId, RealmId, Url, UrlPattern } from "./Brand.ts"
import type { Diagnostics, ObservedValue } from "./Diagnostics.ts"

interface Failure<Tag extends string> extends Cause.YieldableError {
  readonly _tag: Tag
  readonly diagnostics: Diagnostics
}
interface DomainError<Tag extends string, Reason extends { readonly _tag: string }> extends Failure<Tag> {
  readonly reason: Reason
}
interface Reason<Tag extends string> {
  readonly _tag: Tag
  readonly hint: string                                 // the rendered one-line fix
}

// ── Lifetime and deadline ─────────────────────────────────────
export type CloseReason =
  | { readonly _tag: "BrowserClosed" } | { readonly _tag: "BrowserCrashed" }
  | { readonly _tag: "ConnectionLost" } | { readonly _tag: "ModelUnavailable" }
  | { readonly _tag: "UserContextRemoved" } | { readonly _tag: "AccessReleased" } | { readonly _tag: "PrerenderActivated" }
  | { readonly _tag: "PageClosed"; readonly by: "command" | "script" | "userContextRemoved" | "browser" }
  | { readonly _tag: "PageCrashed" } | { readonly _tag: "FrameDetached" }
  | { readonly _tag: "DocumentReplaced" } | { readonly _tag: "DocumentEvicted" } | { readonly _tag: "DocumentDestroyed" }
  | { readonly _tag: "DocumentUnloaded" } | { readonly _tag: "RealmDestroyed" }

export type TargetDescription =
  | { readonly _tag: "Page"; readonly id: NavigableId }
  | { readonly _tag: "Frame"; readonly id: NavigableId }
  | { readonly _tag: "Document"; readonly id: DocumentId }
  | { readonly _tag: "Realm"; readonly id: RealmId }
  | { readonly _tag: "UserContext" } | { readonly _tag: "Browser" }

export interface TargetGone extends Failure<"TargetGone"> {
  readonly target: TargetDescription
  readonly reason: CloseReason
}
export interface Timeout extends Failure<"Timeout"> {
  readonly operation: string
  readonly phase: "resolving" | "waitingForCondition" | "dispatchedUnconfirmed" | "postcondition"
  readonly budget: Duration.Duration
  readonly last: Option.Option<ObservedValue>
  readonly history: ReadonlyArray<ObservedValue>
  readonly hint: Option.Option<string>                  // e.g. "a matching download started 12 ms before Download.next subscribed"
}

// ── Reasons shared across domain errors ───────────────────────
export interface NotPermitted extends Reason<"NotPermitted"> { readonly required: "inspect" | "control" | "browserWide" }
export interface Unsupported extends Reason<"Unsupported"> { readonly capability: string; readonly backend: string }
export interface BackendFailure extends Reason<"BackendFailure"> { readonly kind: "Rejected" | "IncompatibleResponse"; readonly method: string }
export interface InvalidInput extends Reason<"InvalidInput"> { readonly input: string; readonly expected: string }   // fails at once, never by waiting
export interface StrictViolation extends Reason<"StrictViolation"> {
  readonly candidates: ReadonlyArray<{ readonly description: string; readonly visible: boolean }>
  readonly suggestions: ReadonlyArray<string>          // e.g. getByRole('button', { name: 'Save' })
}
export interface StaleRef extends Reason<"StaleRef"> { readonly why: "Replaced" | "Detached" | "Suspended" | "BindingLost" | "OtherSnapshot" }
export interface NotEditable extends Reason<"NotEditable"> { readonly element: string }
export interface FileUnreadable extends Reason<"FileUnreadable"> { readonly path: string }

// ── Domain errors, one per verb family ────────────────────────
export interface ActionError extends DomainError<"ActionError",
  StrictViolation | NotEditable | InvalidInput | StaleRef | FileUnreadable | NotPermitted | Unsupported | BackendFailure> {
  readonly action: string
}
export interface ReadError extends DomainError<"ReadError", StrictViolation | StaleRef | NotPermitted | Unsupported | BackendFailure> {}
export interface CaptureError extends DomainError<"CaptureError", InvalidInput | NotPermitted | Unsupported | BackendFailure> {}
export interface NavigationError extends DomainError<"NavigationError",
  | (Reason<"Failed"> & { readonly netError: string })
  | Reason<"Download"> | Reason<"NoContent">            // fail unless the call accepts them
  | (Reason<"Canceled"> & { readonly why: "beforeunload" | "navigateEvent" | "sandbox" | "unloading" | "traversalInProgress" })
  | (Reason<"Superseded"> & { readonly by: string })
  | InvalidInput | NotPermitted | Unsupported | BackendFailure> {
  readonly url: Option.Option<Url>
}
export interface EvaluationError extends DomainError<"EvaluationError",
  | (Reason<"Thrown"> & { readonly message: string; readonly stack: Option.Option<string> })   // a ReferenceError's hint says functions must be self-contained
  | (Reason<"NotSerializable"> & { readonly path: string })
  | NotPermitted | Unsupported | BackendFailure> {}
export interface ResponseError extends DomainError<"ResponseError",
  | (Reason<"BodyUnavailable"> & { readonly why: "notCollected" | "evicted" | "redirect" | "streaming" | "overLimit" })
  | BackendFailure> {}
export interface ExpectationFailed extends Failure<"ExpectationFailed"> {
  readonly subject: string
  readonly condition: string
  readonly last: Option.Option<ObservedValue>
  readonly history: ReadonlyArray<ObservedValue>       // answers "was it ever right?"
  readonly elapsed: Duration.Duration
  readonly checks: { readonly count: number; readonly triggeredBy: ReadonlyArray<"initial" | "change" | "interval"> }
  readonly nearest: Option.Option<string>              // when nothing matched: a snapshot of the nearest existing ancestor
  readonly suggestions: ReadonlyArray<string>
}
export interface RouteError extends DomainError<"RouteError", InvalidInput | NotPermitted | Unsupported | BackendFailure> {
  readonly pattern: UrlPattern
}
export interface DeclarationError extends DomainError<"DeclarationError",
  | (Reason<"TimingUnsupported"> & { readonly needed: "beforeAuthorScript" })
  | (Reason<"Conflict"> & { readonly with: string })
  | Reason<"DependencyReleased"> | InvalidInput | NotPermitted | Unsupported | BackendFailure> {}
export interface ObserveError extends DomainError<"ObserveError", InvalidInput | NotPermitted | Unsupported | BackendFailure> {}
export interface PageError extends DomainError<"PageError", (Reason<"InitializationFailed"> & { readonly step: string }) | NotPermitted | Unsupported | BackendFailure> {}
export interface UserContextError extends DomainError<"UserContextError", (Reason<"InitializationFailed"> & { readonly step: string }) | NotPermitted | Unsupported | BackendFailure> {}
export interface LaunchError extends DomainError<"LaunchError",
  | (Reason<"ExecutableNotFound"> & { readonly searched: ReadonlyArray<string> })
  | (Reason<"ProcessExited"> & { readonly code: Option.Option<number>; readonly stderrTail: string })
  | Reason<"IncompatibleBrowserRevision"> | InvalidInput> {}
export interface ConnectError extends DomainError<"ConnectError", Reason<"Refused"> | Reason<"Handshake"> | Reason<"IncompatibleBrowserRevision"> | InvalidInput> {}
export interface DownloadError extends DomainError<"DownloadError", Reason<"Canceled"> | (Reason<"Failed"> & { readonly why: string }) | NotPermitted | Unsupported | BackendFailure> {}
export interface StorageError extends DomainError<"StorageError", InvalidInput | NotPermitted | Unsupported | BackendFailure> {}
export interface StorageStateError extends DomainError<"StorageStateError", (Reason<"Incompatible"> & { readonly partitions: ReadonlyArray<string> }) | InvalidInput | BackendFailure> {}
export interface ClockError extends DomainError<"ClockError", Reason<"NotInstalled"> | (Reason<"WrongMode"> & { readonly mode: string }) | BackendFailure> {}
export interface CapabilityError extends DomainError<"CapabilityError", NotPermitted | Unsupported> {}
export interface TraceError extends DomainError<"TraceError", (Reason<"Io"> & { readonly path: string }) | Unsupported | BackendFailure> {}
export interface HarError extends DomainError<"HarError", (Reason<"Io"> & { readonly path: string }) | Unsupported | BackendFailure> {}
export interface SnapshotDiffError extends Failure<"SnapshotDiffError"> { readonly documents: readonly [DocumentId, DocumentId] }
export interface CloseCanceled extends Failure<"CloseCanceled"> {}       // closeWith({ runBeforeUnload: true }) was refused; the page stays usable
export interface EventOverflow extends Failure<"EventOverflow"> { readonly bound: number; readonly at: MonotonicInstant }
