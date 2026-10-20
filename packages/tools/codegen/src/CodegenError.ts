/**
 * The one error the codegen tool fails with: what went wrong, naming the file or shape involved.
 */
import * as Data from "effect/Data"

export class CodegenError extends Data.TaggedError("CodegenError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** Wraps a failure thrown by the pure transforms (a stale patch pointer, a missing overlay target). */
export const fromThrown = (cause: unknown) =>
  new CodegenError({ message: cause instanceof Error ? cause.message : String(cause), cause })
