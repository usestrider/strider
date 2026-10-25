/**
 * The agent toolkit's tool definitions (review 20, candidate 5): `effect/ai` tools with Schemas for their
 * parameters, results and failures, and failure mode `"return"`, so a failure reaches the model as data.
 *
 * Every page tool names its page. Every result is the call's outcome and a digest, `sinceLast`: what the event
 * logs recorded since the previous call. A target is a ref from the page's latest snapshot (`e12`), or a
 * locator string that maps to one query: `role=button[name="Save"]`, `text="Add to cart"`, `label=Email`,
 * `testid=cart`, `css=…`.
 */
import * as Tool from "effect/ai/Tool"
import * as Toolkit from "effect/ai/Toolkit"
import * as Schema from "effect/Schema"

/** Why a tool call failed: the library error's tag, its reason's, and its message with the hint. */
export class ToolFailure extends Schema.Class<ToolFailure>("@usestrider/browser/ai/BrowserToolkit/ToolFailure")({
  error: Schema.String,
  reason: Schema.optional(Schema.String),
  message: Schema.String
}) {}

const PageName = Schema.String.annotate({ description: "The page, by the name `pages` or `newPage` gave it" })

// The tools that act bring their page to the front first, as a person would
const front = " Brings the page to the front first."

const Target = Schema.String.annotate({
  description:
    "A ref from the page's latest snapshot (e12), or role=button[name=\"Save\"], text=\"Add to cart\", label=Email, testid=cart or css=…"
})

const Digest = Schema.Array(Schema.String).annotate({
  description: "What happened since the previous call: navigations, popups, dialogs, downloads, errors, failed requests"
})

/** A tool's result: its outcome, then the digest. */
const result = <S extends Schema.Top>(outcome: S) => Schema.Struct({ outcome, sinceLast: Digest })

const tool = <const Name extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(
  name: Name,
  description: string,
  parameters: P,
  outcome: S
) =>
  Tool.make(name, {
    description,
    parameters: Schema.Struct(parameters),
    success: result(outcome),
    failure: ToolFailure,
    failureMode: "return"
  })

export const pages = tool(
  "pages",
  "Lists the context's pages by name, with their URLs.",
  {},
  Schema.Array(Schema.Struct({ page: Schema.String, url: Schema.String }))
)

export const newPage = tool(
  "newPage",
  "Opens a page in the context, named as given or p1, p2…, and navigates it when a URL is given.",
  { name: Schema.optional(Schema.String), url: Schema.optional(Schema.String) },
  Schema.Struct({ page: Schema.String, url: Schema.String })
)

export const goto = tool(
  "goto",
  "Navigates a page to a URL; returns when the document commits.",
  { page: PageName, url: Schema.String },
  Schema.Struct({ url: Schema.String, status: Schema.optional(Schema.Number) })
)

export const back = tool(
  "back",
  "Goes back one history entry; says when there is none.",
  { page: PageName },
  Schema.Struct({ url: Schema.optional(Schema.String) })
)

export const snapshot = tool(
  "snapshot",
  "The page's accessibility tree as text, with a ref for each element a target can name; it is the page's latest snapshot.",
  { page: PageName },
  Schema.String
)

export const screenshot = tool(
  "screenshot",
  "A PNG of the page's viewport, base64-encoded, where the capture policy allows screenshots." + front,
  { page: PageName },
  Schema.Struct({ mediaType: Schema.Literal("image/png"), data: Schema.String })
)

export const click = tool(
  "click",
  "Clicks the target once it is visible, stable, enabled and not covered." + front,
  { page: PageName, target: Target },
  Schema.String
)

export const fill = tool(
  "fill",
  "Fills a field with text; %name% is a secret, substituted as the call is made." + front,
  { page: PageName, target: Target, value: Schema.String },
  Schema.String
)

export const press = tool(
  "press",
  "Presses a key, by its UI Events name (Enter, Tab, a), on the target or the focused element." + front,
  { page: PageName, key: Schema.String, target: Schema.optional(Target) },
  Schema.String
)

export const select = tool(
  "select",
  "Chooses options of a select by their labels, as its snapshot names them." + front,
  { page: PageName, target: Target, values: Schema.Array(Schema.String) },
  Schema.String
)

export const scroll = tool(
  "scroll",
  "Scrolls the target into view." + front,
  { page: PageName, target: Target },
  Schema.String
)

export const Event = Schema.Literals(["navigation", "popup", "dialog", "download", "response", "console"])

export const next = tool(
  "next",
  "Starts waiting for the page's next event of a kind, from now; returns a wait to collect with await. A response needs a URL pattern.",
  {
    page: PageName,
    event: Event,
    url: Schema.optional(Schema.String),
    within: Schema.optional(Schema.String.annotate({ description: "How long the wait may last, such as 30 seconds" }))
  },
  Schema.Struct({ wait: Schema.String })
)

const await_ = tool(
  "await",
  "Collects a wait that next started: the event, or why it didn't come.",
  { wait: Schema.String },
  Schema.String
)
export { await_ as await }

export const expect = tool(
  "expect",
  "Waits until the target is in a state, or has a text, within the deadline." + front,
  {
    page: PageName,
    target: Target,
    state: Schema.Literals(["visible", "hidden", "enabled", "disabled", "checked"]),
    text: Schema.optional(Schema.String)
  },
  Schema.String
)

export const history = tool(
  "history",
  "What the page's event log recorded of a kind, oldest first.",
  { page: PageName, kind: Schema.Literals(["navigation", "console", "network", "dialog", "download", "exception"]) },
  Schema.Array(Schema.String)
)

export const route = tool(
  "route",
  "Decides the page's requests to URLs matching a pattern from now on: abort, continue, or fulfill with a response.",
  {
    page: PageName,
    pattern: Schema.String,
    action: Schema.Literals(["abort", "continue", "fulfill"]),
    status: Schema.optional(Schema.Number),
    body: Schema.optional(Schema.String),
    contentType: Schema.optional(Schema.String)
  },
  Schema.Struct({ registration: Schema.String })
)

export const dialog = tool(
  "dialog",
  "Decides the page's dialogs from now on: accept (with text, for a prompt) or dismiss.",
  { page: PageName, decision: Schema.Literals(["accept", "dismiss"]), text: Schema.optional(Schema.String) },
  Schema.Struct({ registration: Schema.String })
)

export const toolkit = Toolkit.make(
  pages,
  newPage,
  goto,
  back,
  snapshot,
  screenshot,
  click,
  fill,
  press,
  select,
  scroll,
  next,
  await_,
  expect,
  history,
  route,
  dialog
)

export type Tools = typeof toolkit.tools
