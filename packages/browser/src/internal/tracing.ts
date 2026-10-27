/**
 * The references that shape the library's spans, defined apart from `Browser` so the
 * protocol client can read one without importing the public modules. `Browser` exports them.
 */
import * as Context from "effect/Context"
import type * as Predicate from "effect/Predicate"
import type * as Target from "../Target.ts"

/** What a span is about: the operation, such as `Locator.click`, and its target. */
export interface Operation {
  readonly name: string
  readonly target: Target.Description
}

/** Names each operation's span; the operation's own name unless set. */
export const SpanNameGenerator: Context.Reference<(operation: Operation) => string> = Context.Reference<
  (operation: Operation) => string
>("@usestrider/browser/Browser/SpanNameGenerator", { defaultValue: () => (operation) => operation.name })

/** Suppresses an operation's span when it returns `true`; never unless set. */
export const TracerDisabledWhen: Context.Reference<Predicate.Predicate<Operation>> = Context.Reference<
  Predicate.Predicate<Operation>
>("@usestrider/browser/Browser/TracerDisabledWhen", { defaultValue: () => () => false })

/** Whether each protocol command gets a child span; off unless set. */
export const TraceProtocolCommands: Context.Reference<boolean> = Context.Reference<boolean>(
  "@usestrider/browser/Browser/TraceProtocolCommands",
  { defaultValue: () => false }
)
