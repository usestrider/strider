/**
 * Recordings. Spans are the record: every public operation is an Effect.fn span, so any installed tracer
 * (effect/observability over OTLP, effect/devtools) already receives the trace. `Trace.record` adds what spans
 * can't carry (page-side captures, as attachments) and the export. Exports cross a persistence boundary, so
 * they are explicit and redacted. Archives are written as streams with effect/encoding's Zip (in flight).
 */
import type { Duration, Effect, Scope } from "effect"
import type { LocalPath, UrlPattern } from "./Brand.ts"
import type { HarError, TraceError, Unsupported } from "./Errors.ts"
import type { Registration } from "./Network.ts"
import type { Page } from "./Page.ts"
import type { UserContext } from "./UserContext.ts"
import type { Watchable } from "./Watchable.ts"

export interface TraceOptions {
  readonly screenshots?: "perAction" | "off"            // default "off"
  readonly screencast?: "native" | { readonly polled: Duration.Input } | "off"   // BiDi has no native screencast; default "off"
  readonly domSnapshots?: boolean                       // default false; installs a main-world script, so it needs control
  readonly network?: boolean                            // default false; HAR entries, so snapshots render with their resources
}
export interface TraceRecording extends Registration {
  /** Playwright's trace-viewer zip, format 9. */
  exportTrace(path: LocalPath | string): Effect.Effect<LocalPath, TraceError>
}
export declare const Trace: {
  record(target: UserContext | Page): Effect.Effect<TraceRecording, TraceError, Scope.Scope>   // spans, logs, errors and console
  recordWith(target: UserContext | Page, options: TraceOptions): Effect.Effect<TraceRecording, TraceError | Unsupported, Scope.Scope>
}

export type SecretClass = "credentials" | "cookies" | "authorizationHeaders" | "typedText"
export interface HarOptions {
  readonly content: "embed" | "attach" | "omit"         // required: never inferred from a file extension
  readonly detail?: "full" | "minimal"                  // default "full"
  readonly url?: UrlPattern | string                    // default every request
  readonly webSocketFrames?: boolean                    // default false; Unsupported on BiDi
  readonly inFlightAtStop?: "wait" | "markIncomplete"   // default "markIncomplete": stopping never waits unless asked
}
export interface HarRecording extends Registration {
  readonly entries: Watchable<number>
  exportHar(path: LocalPath | string, options?: { readonly include?: ReadonlyArray<SecretClass> }): Effect.Effect<LocalPath, HarError>   // redacted unless included
}
export declare const Har: {
  record(target: UserContext | Page, options: HarOptions): Effect.Effect<HarRecording, HarError | Unsupported, Scope.Scope>
  // replay is deferred: mocking is route's job
}
