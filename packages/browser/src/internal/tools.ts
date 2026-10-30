/**
 * The agent toolkit's tool definitions: `effect/ai` tools with Schemas for their
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
import * as Snapshot from "../Snapshot.ts"

/** Why a tool call failed: the library error's tag, its reason's, and its message with the hint. */
export class ToolFailure extends Schema.Class<ToolFailure>("@usestrider/browser/ai/BrowserToolkit/ToolFailure")({
  error: Schema.String,
  reason: Schema.optional(Schema.String),
  message: Schema.String
}) {}

const PageName = Schema.String.annotate({ description: "The page, by the name `pages` or `newPage` gave it" })

// The tools that act bring their page to the front first, as a person would
const front = " Brings the page to the front first."

/** A ref, as a target names one: `e` and a number, decoded to a `Snapshot.RefId`. */
export const Ref = Snapshot.RefId.pipe(Schema.check(Schema.isPattern(/^e\d+$/)))

/** A target: a ref, which is checked against the page's latest snapshot, or a locator string. */
const Target = Schema.Union([Ref, Schema.String]).annotate({
  description:
    "A ref from the page's latest snapshot (e12), or role=button[name=\"Save\"], text=\"Add to cart\", label=Email, testid=cart or css=…"
})

const Digest = Schema.Array(Schema.String).annotate({
  description: "What happened since the previous call: navigations, popups, dialogs, downloads, errors, failed requests"
})

/** A tool's result: its outcome, then the digest. */
const result = <S extends Schema.Top>(outcome: S) => Schema.Struct({ outcome, sinceLast: Digest })

/**
 * What a tool does, as MCP's hints tell a client: `reads` changes nothing, `adds` changes only the session, such as
 * a wait or a handler it registers, or a page it opens, and `acts` acts on a page as a person would, which may do
 * anything the page does.
 */
type Effects = "reads" | "adds" | "acts"

const tool = <const Name extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(
  name: Name,
  description: string,
  parameters: P,
  outcome: S,
  effects: Effects
) =>
  Tool.make(name, {
    description,
    // A tool with no parameters has Tool.EmptyParams, whose JSON Schema an MCP client reads as an object
    parameters: (Object.keys(parameters).length === 0 ? Tool.EmptyParams : Schema.Struct(parameters)) as Schema.Struct<
      P
    >,
    success: result(outcome),
    failure: ToolFailure,
    failureMode: "return"
  })
    .annotate(Tool.Readonly, effects === "reads")
    .annotate(Tool.Destructive, effects === "acts")
    .annotate(Tool.Idempotent, effects === "reads")

export const pages = tool(
  "pages",
  "Lists the context's pages by name, with their URLs.",
  {},
  Schema.Array(Schema.Struct({ page: Schema.String, url: Schema.String })),
  "reads"
)

export const newPage = tool(
  "newPage",
  "Opens a page in the context, named as given or p1, p2…, and navigates it when a URL is given. A page whose navigation fails is closed again, so the name stays free.",
  { name: Schema.optional(Schema.String), url: Schema.optional(Schema.String) },
  Schema.Struct({ page: Schema.String, url: Schema.String }),
  "adds"
)

export const tabs = tool(
  "tabs",
  "Lists the browser's pages the session hasn't named, such as an attached browser's own tabs, by id and URL. Needs a toolkit made with the browser.",
  {},
  Schema.Array(Schema.Struct({ tab: Schema.String, url: Schema.String })),
  "reads"
)

export const control = tool(
  "control",
  "Takes control of one of the browser's pages, by its id from tabs or a URL pattern that matches one, and names it, as given or p1, p2…; it is a page as any other until release.",
  {
    tab: Schema.optional(Schema.String.annotate({ description: "A tab's id, from tabs" })),
    url: Schema.optional(Schema.String.annotate({ description: "A URL pattern matching exactly one tab" })),
    name: Schema.optional(Schema.String)
  },
  Schema.Struct({ page: Schema.String, url: Schema.String }),
  "adds"
)

export const release = tool(
  "release",
  "Gives back a page control took: its routes and handlers end, and the page stays open, unnamed.",
  { page: PageName },
  Schema.String,
  "adds"
)

export const goto = tool(
  "goto",
  "Navigates a page to a URL; returns when the document commits.",
  { page: PageName, url: Schema.String },
  Schema.Struct({ url: Schema.String, status: Schema.optional(Schema.Number) }),
  "acts"
)

export const back = tool(
  "back",
  "Goes back one history entry; says when there is none.",
  { page: PageName },
  Schema.Struct({ url: Schema.optional(Schema.String) }),
  "acts"
)

export const snapshot = tool(
  "snapshot",
  "The page's accessibility tree as text, with a ref for each element a target can name; it is the page's latest snapshot.",
  { page: PageName },
  Schema.String,
  "reads"
)

export const screenshot = tool(
  "screenshot",
  "A PNG of the page's viewport, base64-encoded, where the capture policy allows screenshots." + front,
  { page: PageName },
  Schema.Struct({ mediaType: Schema.Literal("image/png"), data: Schema.String }),
  "reads"
)

export const click = tool(
  "click",
  "Clicks the target once it is visible, stable, enabled and not covered." + front,
  { page: PageName, target: Target },
  Schema.String,
  "acts"
)

export const fill = tool(
  "fill",
  "Fills a field with text; a secret's %name% is its value, substituted as the call is made." + front,
  { page: PageName, target: Target, value: Schema.String },
  Schema.String,
  "acts"
)

export const press = tool(
  "press",
  "Presses a key, by its UI Events name (Enter, Tab, a), on the target or the focused element." + front,
  { page: PageName, key: Schema.String, target: Schema.optional(Target) },
  Schema.String,
  "acts"
)

export const select = tool(
  "select",
  "Chooses options of a select by their labels, as its snapshot names them." + front,
  { page: PageName, target: Target, values: Schema.Array(Schema.String) },
  Schema.String,
  "acts"
)

export const scroll = tool(
  "scroll",
  "Scrolls the target into view." + front,
  { page: PageName, target: Target },
  Schema.String,
  "adds"
)

export const Event = Schema.Literals(["navigation", "popup", "dialog", "download", "response", "console"])

/** The states `expect` waits for. */
export const ExpectedState = Schema.Literals(["visible", "hidden", "enabled", "disabled", "checked"])

/** The event logs `history` reads. */
export const HistoryKind = Schema.Literals(["navigation", "console", "network", "dialog", "download", "exception"])

/** The console levels `history` narrows to. */
export const ConsoleLevel = Schema.Literals(["debug", "log", "info", "warning", "error"])

/** What `route` does with a request. */
export const RouteAction = Schema.Literals(["abort", "continue", "fulfill"])

/** What `dialog` decides. */
export const DialogDecision = Schema.Literals(["accept", "dismiss"])

export const next = tool(
  "next",
  "Starts waiting for the page's next event of a kind, from now; returns a wait to collect with await. A response needs a URL pattern.",
  {
    page: PageName,
    event: Event,
    url: Schema.optional(Schema.String),
    within: Schema.optional(Schema.String.annotate({ description: "How long the wait may last, such as 30 seconds" }))
  },
  Schema.Struct({ wait: Schema.String }),
  "adds"
)

const await_ = tool(
  "await",
  "Collects a wait that next started: the event, or why it didn't come.",
  { wait: Schema.String },
  Schema.String,
  "adds"
)
export { await_ as await }

export const expect = tool(
  "expect",
  "Waits until the target is in a state, or has a text, within the deadline." + front,
  {
    page: PageName,
    target: Target,
    state: ExpectedState,
    text: Schema.optional(Schema.String)
  },
  Schema.String,
  "reads"
)

export const history = tool(
  "history",
  "What the page's event log recorded of a kind, oldest first. Console messages can be narrowed to a level, and network to the failed requests: no response for a reason other than cancellation, or a status of 400 or more.",
  {
    page: PageName,
    kind: HistoryKind,
    level: Schema.optional(ConsoleLevel),
    failed: Schema.optional(Schema.Boolean)
  },
  Schema.Array(Schema.String),
  "reads"
)

export const find = tool(
  "find",
  "Searches the page's latest snapshot, taking one if there is none, for elements whose name or text contains the query, or equals it with exact; narrows by role. Returns their refs, which are targets, each with its role, name and the named elements it is in.",
  {
    page: PageName,
    query: Schema.String,
    role: Schema.optional(Schema.String),
    exact: Schema.optional(Schema.Boolean)
  },
  Schema.Array(Schema.Struct({ ref: Schema.String, role: Schema.String, name: Schema.String, path: Schema.String })),
  "reads"
)

export const route = tool(
  "route",
  "Decides the page's requests to URLs matching a pattern from now on: abort, continue, or fulfill with a response.",
  {
    page: PageName,
    pattern: Schema.String,
    action: RouteAction,
    status: Schema.optional(Schema.Number),
    body: Schema.optional(Schema.String),
    contentType: Schema.optional(Schema.String)
  },
  Schema.Struct({ registration: Schema.String }),
  "adds"
)

export const dialog = tool(
  "dialog",
  "Decides the page's dialogs from now on: accept (with text, for a prompt) or dismiss.",
  { page: PageName, decision: DialogDecision, text: Schema.optional(Schema.String) },
  Schema.Struct({ registration: Schema.String }),
  "adds"
)

/** Every tool, in the order a model lists them. */
const all = [
  pages,
  newPage,
  tabs,
  control,
  release,
  goto,
  back,
  snapshot,
  find,
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
] as const

export const toolkit = Toolkit.make(...all)

export type Tools = typeof toolkit.tools

/** A tool's name. */
export type ToolName = keyof Tools

/** Schema for a tool's name. */
export const ToolName = Schema.Literals(all.map((tool) => tool.name))

/** A tool's parameters, decoded. */
export type Params<K extends ToolName> = Tool.Parameters<Tools[K]>

/** What a tool's call did: its result without the digest. */
export type Outcome<K extends ToolName> = Tool.Success<Tools[K]>["outcome"]

/** A call of a tool, by its name, with that tool's parameters. */
export type Call<K extends ToolName = ToolName> = Calls[K]

/**
 * A tool's call, from its name and its parameters. TypeScript can't relate a name and parameters typed by the same
 * generic name to the call of that name (TypeScript#30581), so this is the one place they're put together.
 */
export const call = <K extends ToolName>(tool: K, params: Params<K>): Call<K> => ({ tool, params }) as Call<K>

/** Each tool's call, by its name. */
export type Calls = { readonly [K in ToolName]: { readonly tool: K; readonly params: Params<K> } }

/**
 * Each tool's parameters and success Schemas, by its name, typed so that code generic in a tool's name encodes and
 * decodes what that tool takes and gives.
 */
export const schemas: {
  readonly [K in ToolName]: {
    readonly parametersSchema: Schema.Codec<Params<K>, Tool.ParametersEncoded<Tools[K]>>
    readonly successSchema: Schema.Codec<Tool.Success<Tools[K]>, Tool.SuccessEncoded<Tools[K]>>
  }
} = toolkit.tools
