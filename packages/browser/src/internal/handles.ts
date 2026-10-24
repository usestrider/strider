/**
 * From a public handle to what is behind it: a page's or context's runtime and model entry, for the modules
 * whose functions take handles (`Popup.next(page)`, `Dialog.handle(page, …)`). A handle this package didn't
 * make is a bug in the caller's types, so it is a defect.
 */
import type * as Option from "effect/Option"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import type * as Access from "./access.ts"
import type * as Model from "./model.ts"
import type * as Runtime from "./runtime.ts"

export interface Behind<E> {
  readonly runtime: Runtime.Runtime
  readonly entry: E
  /** The grant the handle was made under (review 19); `None` for one controlled for its life, or observed. */
  readonly grant: Option.Option<Access.Grant>
}

const pages = new WeakMap<object, Behind<Model.PageEntry>>()
const contexts = new WeakMap<object, Behind<Model.ContextEntry>>()

export const registerPage = (page: Page.ObservedPage, behind: Behind<Model.PageEntry>): void => {
  pages.set(page, behind)
}

export const registerContext = (context: UserContext.ObservedUserContext, behind: Behind<Model.ContextEntry>): void => {
  contexts.set(context, behind)
}

export const page = (handle: Page.ObservedPage): Behind<Model.PageEntry> => {
  const behind = pages.get(handle)
  if (behind === undefined) throw new Error(`${String(handle)} isn't a page this package made`)
  return behind
}

/** A page's or a context's entry, for modules that take either. */
export const target = (
  handle: Page.ObservedPage | UserContext.ObservedUserContext
): { readonly _tag: "Page"; readonly behind: Behind<Model.PageEntry> } | {
  readonly _tag: "UserContext"
  readonly behind: Behind<Model.ContextEntry>
} => {
  const asPage = pages.get(handle)
  if (asPage !== undefined) return { _tag: "Page", behind: asPage }
  const asContext = contexts.get(handle)
  if (asContext !== undefined) return { _tag: "UserContext", behind: asContext }
  throw new Error(`${String(handle)} isn't a page or context this package made`)
}
