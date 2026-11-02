/**
 * What a locator and a snapshot share: the page a locator belongs to, and how a snapshot makes a locator for one of
 * its refs, so neither module needs the other to say it.
 */
import type * as Option from "effect/Option"
import type * as Locator from "../Locator.ts"
import type * as Access from "./access.ts"
import type * as Engine from "./engine.ts"
import type * as Model from "./model.ts"
import type * as Runtime from "./runtime.ts"

/** The page a locator belongs to, and the grant it was made under. */
export interface Owner {
  readonly runtime: Runtime.Runtime
  readonly page: Model.PageEntry
  /** `None` for a page controlled for its life. */
  readonly grant: Option.Option<Access.Grant>
}

/** A locator on an owner's page that follows `steps`, as a snapshot makes one for a ref. */
export type Locate = (steps: ReadonlyArray<Engine.Step>, label: Option.Option<string>) => Locator.Locator
