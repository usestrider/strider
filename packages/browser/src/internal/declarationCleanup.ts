/** Borrowed-context rollback confirms cleanup before restoring the previous model settings. */
import * as Context from "effect/Context"

export const Confirm = Context.Reference<boolean>("@usestrider/browser/internal/declarationCleanup/Confirm", {
  defaultValue: () => false
})

/** Each handoff declaration release has a separate confirmation budget. @default 1000 milliseconds */
export const Handoff = Context.Reference<boolean>("@usestrider/browser/internal/declarationCleanup/Handoff", {
  defaultValue: () => false
})

export const Unconfirmed = Context.Reference<() => void>(
  "@usestrider/browser/internal/declarationCleanup/Unconfirmed",
  {
    defaultValue: () => () => {}
  }
)
