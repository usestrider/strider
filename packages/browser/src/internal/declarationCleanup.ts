/** Borrowed-context rollback confirms cleanup before restoring the previous model settings. */
import * as Context from "effect/Context"

export const Confirm = Context.Reference<boolean>("@usestrider/browser/internal/declarationCleanup/Confirm", {
  defaultValue: () => false
})
