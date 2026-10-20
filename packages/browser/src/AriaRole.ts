/**
 * WAI-ARIA roles, as used by `getByRole`, snapshots and `AriaPattern`.
 *
 * Shaped like `effect/http`'s `HttpMethod`: a type, the set of known values, and a guard.
 *
 * @stability unstable
 * @since 0.1.0
 */

/**
 * A WAI-ARIA role.
 *
 * **Details**
 *
 * The open string keeps roles added after this list usable before the list catches up. Known roles still
 * autocomplete.
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
 * The roles this version knows.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export declare const all: ReadonlySet<AriaRole>

/**
 * Checks whether a value is a role this version knows.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export declare const isAriaRole: (u: unknown) => u is AriaRole
