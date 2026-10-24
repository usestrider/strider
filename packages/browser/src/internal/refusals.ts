/**
 * What a released grant fails a member with when the member's errors have no `TargetGone` (review 19, candidate 2):
 * its module's `NotPermitted`, or for a clock, `NotInstalled`, since the clock a grant installed was removed with it.
 */
import * as Capability from "../Capability.ts"
import * as CookieJar from "../CookieJar.ts"
import * as Declaration from "../Declaration.ts"
import * as Page from "../Page.ts"
import * as PageClock from "../PageClock.ts"
import type * as Reason from "../Reason.ts"
import * as Route from "../Route.ts"
import * as Url from "../Url.ts"
import * as UserContext from "../UserContext.ts"
import type * as Access from "./access.ts"
import * as Operation from "./operation.ts"

const diagnostics = () => Operation.diagnostics(Operation.operationId())

const declaration = (name: string) => (reason: Reason.NotPermitted) =>
  new Declaration.DeclarationError({ declaration: name, reason, diagnostics: diagnostics() })

const route = (reason: Reason.NotPermitted, args: ReadonlyArray<unknown>) =>
  new Route.RouteError({ pattern: Url.Pattern.make(String(args[0])), reason, diagnostics: diagnostics() })

const clock = (operation: string) => () =>
  new PageClock.PageClockError({
    operation,
    reason: new PageClock.NotInstalled({ hint: "The clock went with the access that installed it" }),
    diagnostics: diagnostics()
  })

const clocks = (prefix: string): Access.Members["refusals"] => ({
  "clock.install": declaration(`${prefix}.clock`),
  "clock.adjust": clock("PageClock.adjust"),
  "clock.setTime": clock("PageClock.setTime"),
  "clock.resume": clock("PageClock.resume")
})

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
  declarations: new Set(["route", "addInitScript", "emulate", "clock.install"]),
  refusals: {
    route,
    addInitScript: declaration("Page.addInitScript"),
    emulate: declaration("Page.emulate"),
    capability: (reason, args) =>
      new Capability.CapabilityError({
        capability: String((args[0] as { readonly name?: string } | undefined)?.name ?? "capability"),
        reason,
        diagnostics: diagnostics()
      }),
    ...clocks("Page")
  }
}

const cookie = (operation: string) => (reason: Reason.NotPermitted) =>
  new CookieJar.CookieJarError({ operation, reason, diagnostics: diagnostics() })

/** A context's members under a grant. */
export const context: Access.Members = {
  observed: new Set(["id", "pages", "workers", "closed", "control", "pipe", "toString", "toJSON"]),
  declarations: new Set(["route", "addInitScript", "emulate", "grant", "clock.install"]),
  refusals: {
    newPage: (reason) => new Page.PageError({ operation: "UserContext.newPage", reason, diagnostics: diagnostics() }),
    exportStorageState: (reason) =>
      new UserContext.UserContextError({
        operation: "UserContext.exportStorageState",
        reason,
        diagnostics: diagnostics()
      }),
    "cookies.list": cookie("CookieJar.list"),
    "cookies.listFor": cookie("CookieJar.listFor"),
    "cookies.set": cookie("CookieJar.set"),
    "cookies.remove": cookie("CookieJar.remove"),
    "cookies.clear": cookie("CookieJar.clear"),
    route,
    addInitScript: declaration("UserContext.addInitScript"),
    emulate: declaration("UserContext.emulate"),
    grant: declaration("UserContext.grant"),
    ...clocks("UserContext")
  }
}
