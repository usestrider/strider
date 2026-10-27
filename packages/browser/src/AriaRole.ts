/**
 * The WAI-ARIA roles that `getByRole`, snapshots and `AriaPattern` use.
 *
 * Like `effect/http`'s `HttpMethod`, the module has the type (`AriaRole`), the roles Strider knows (`all`) and a
 * guard (`isAriaRole`).
 *
 * @stability unstable
 * @since 0.1.0
 */

/**
 * A WAI-ARIA role.
 *
 * **Details**
 *
 * It also accepts any string, so a role newer than this list can be used before Strider adds it. Known roles
 * still autocomplete.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type AriaRole =
  | "alert"
  | "alertdialog"
  | "application"
  | "article"
  | "banner"
  | "blockquote"
  | "button"
  | "caption"
  | "cell"
  | "checkbox"
  | "code"
  | "columnheader"
  | "combobox"
  | "complementary"
  | "contentinfo"
  | "definition"
  | "deletion"
  | "dialog"
  | "directory"
  | "document"
  | "emphasis"
  | "feed"
  | "figure"
  | "form"
  | "generic"
  | "grid"
  | "gridcell"
  | "group"
  | "heading"
  | "img"
  | "insertion"
  | "link"
  | "list"
  | "listbox"
  | "listitem"
  | "log"
  | "main"
  | "marquee"
  | "math"
  | "menu"
  | "menubar"
  | "menuitem"
  | "menuitemcheckbox"
  | "menuitemradio"
  | "meter"
  | "navigation"
  | "none"
  | "note"
  | "option"
  | "paragraph"
  | "presentation"
  | "progressbar"
  | "radio"
  | "radiogroup"
  | "region"
  | "row"
  | "rowgroup"
  | "rowheader"
  | "scrollbar"
  | "search"
  | "searchbox"
  | "separator"
  | "slider"
  | "spinbutton"
  | "status"
  | "strong"
  | "subscript"
  | "superscript"
  | "switch"
  | "tab"
  | "table"
  | "tablist"
  | "tabpanel"
  | "term"
  | "textbox"
  | "time"
  | "timer"
  | "toolbar"
  | "tooltip"
  | "tree"
  | "treegrid"
  | "treeitem"
  | (string & {})

/**
 * The roles this version of Strider knows.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const all: ReadonlySet<AriaRole> = new Set<AriaRole>([
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "meter",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem"
])

/**
 * Checks whether a value is a role this version of Strider knows.
 *
 * **Example** (Validating a role before querying)
 *
 * ```ts import.meta.vitest
 * import { AriaRole, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const clickByRole = Effect.fn("clickByRole")(
 *   function*(page: Page.Page, role: unknown, name: string) {
 *     if (!AriaRole.isAriaRole(role)) {
 *       return yield* Effect.fail(`${String(role)} isn't a known role`)
 *     }
 *     yield* page.getByRole(role, { name }).click()
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isAriaRole = (u: unknown): u is AriaRole => typeof u === "string" && all.has(u)
