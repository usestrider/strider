/** Segment return values: evaluation's value rules, page names, and a JSON-safe presentation. */
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as JSHandle from "../../JSHandle.ts"
import * as Page from "../../Page.ts"
import type * as Adapter from "../adapter.ts"
import * as Serialization from "../serialization.ts"
import type * as Toolkit from "../toolkit.ts"

export const Result = Schema.Struct({
  file: Schema.String,
  value: Schema.Unknown,
  handles: Schema.Record(Schema.String, Schema.Struct({ type: Schema.Literal("page"), id: Schema.String })),
  durationMs: Schema.Number
})

export const Failure = Schema.Struct({
  file: Schema.String,
  error: Schema.String,
  reason: Schema.optionalKey(Schema.String),
  message: Schema.String,
  hint: Schema.optionalKey(Schema.String),
  phase: Schema.Literals(["load", "arguments", "execute", "serialize"]),
  step: Schema.optionalKey(Schema.String),
  durationMs: Schema.Number
})

/** JSON values stay ordinary; values JSON cannot represent retain their evaluation type tag. */
const json = (value: Adapter.RemoteValue, conceal: <A>(value: A) => A): unknown => {
  const item = (value: Adapter.RemoteValue) => json(value, conceal)
  switch (value.type) {
    case "null":
      return null
    case "string":
      return conceal(value.value)
    case "boolean":
      return value.value
    case "number":
      return typeof value.value === "number" ? value.value : value
    case "array":
      return value.value!.map(item)
    case "object":
      return Object.fromEntries(value.value!.map(([key, value]) => [conceal(key), item(value)]))
    case "map":
      return {
        type: "map",
        value: value.value!.map(([key, value]) => [typeof key === "string" ? conceal(key) : item(key), item(value)])
      }
    case "set":
      return { type: "set", value: value.value!.map(item) }
    case "bigint":
    case "date":
    case "regexp":
      return { type: value.type, value: conceal(value.value) }
    default:
      return value
  }
}

export const serialize = Effect.fnUntraced(function*(
  value: unknown,
  session: Pick<Toolkit.Session, "name" | "conceal">,
  strict: boolean
) {
  const pages = new Map<Page.Page, { type: "string"; value: string }>()
  const remote = yield* Effect.try({
    try: () =>
      Serialization.result(value, (each, path) => {
        if (Redacted.isRedacted(each)) return { type: "string", value: "<redacted>" }
        if (JSHandle.isJSHandle(each)) {
          throw new Serialization.Unserializable(path, "Read the JSHandle inside the segment before returning it")
        }
        if (!Page.isPage(each)) return undefined
        const page = each as Page.Page
        let reference = pages.get(page)
        if (reference === undefined) {
          reference = { type: "string", value: "" }
          pages.set(page, reference)
        }
        return reference
      }),
    catch: (error) =>
      error instanceof Serialization.Unserializable
        ? error
        : new Serialization.Unserializable("result", "Reading the returned value failed; return plain data")
  })
  const handles: Record<string, { type: "page"; id: string }> = {}
  for (const [page, reference] of pages) {
    reference.value = yield* session.name(page)
    Object.defineProperty(handles, reference.value, { value: { type: "page", id: page.id }, enumerable: true })
  }
  return {
    value: strict && value !== undefined && !Page.isPage(value) ? "•••" : json(remote, session.conceal),
    handles: Object.fromEntries(
      Object.entries(handles).map(([name, handle]) => [session.conceal(name), session.conceal(handle)])
    )
  }
})

/** Only the human-readable preview is shortened; JSON always carries the complete captured value. */
export const preview = (value: unknown, handle: boolean): string => {
  const text = handle && typeof value === "string" ? value : JSON.stringify(value)
  const limit = 4096
  return text.length > limit ? `${text.slice(0, limit)}… [truncated; use --json for the full value]` : text
}
