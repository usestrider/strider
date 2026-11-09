/**
 * Which members of a page and a context a grant guards: the ones observing gives are left
 * as they are, and the ones that make a declaration have it removed with the grant. Every other member fails
 * with `TargetGone{AccessReleased}` once the grant is released, as every member declares (QUIRKS.md,
 * Q143).
 */
import type * as Access from "./access.ts"

/** A page's members under a grant. */
export const page: Access.Members = {
  observed: new Set([
    "id",
    "status",
    "url",
    "frames",
    "workers",
    "closed",
    "inspect",
    "control",
    "context",
    "mouse.position",
    // Called on the guarded handle, so `pipe` hands on the guarded one
    "pipe",
    "toString",
    "toJSON"
  ]),
  declarations: new Set(["route", "addInitScript", "addLocatorHandler", "emulate", "clock.install"])
}

/** A context's members under a grant. */
export const context: Access.Members = {
  observed: new Set(["id", "pages", "workers", "closed", "control", "pipe", "toString", "toJSON"]),
  declarations: new Set(["route", "addInitScript", "emulate", "grant", "clock.install"])
}
