/**
 * How values with preset-dependent detail show: the URL rule the span helper applies to attributes, and the
 * `Redactable` form of the values that carry a URL, which Effect's logger, formatter and inspection render under
 * the preset in the current fiber's context.
 */
import * as Context from "effect/Context"
import * as Diagnostics from "../Diagnostics.ts"

/**
 * A URL as the preset shows it: whole under `"local"`; under `"strict"`, its origin and path, each query value
 * `REDACTED`, credentials and fragment dropped.
 */
export const url = (url: string, preset: Diagnostics.Preset): string => {
  if (preset === "local") return url
  try {
    const parsed = new URL(url)
    parsed.username = ""
    parsed.password = ""
    parsed.hash = ""
    for (const key of new Set(parsed.searchParams.keys())) parsed.searchParams.set(key, "REDACTED")
    return parsed.href
  } catch {
    return "REDACTED"
  }
}

/**
 * The `Redactable` form of a value that carries a URL: its fields, named by `_id` as handles' descriptions are,
 * with the URL as the preset in `context` shows it.
 */
export const withUrl = <A extends { readonly url: string }>(
  id: string,
  value: A,
  context: Context.Context<never>
): Record<string, unknown> => ({
  _id: id,
  ...value,
  url: url(value.url, Context.get(context, Diagnostics.CurrentPreset))
})
