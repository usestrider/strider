/**
 * The public `Url`, minted from what a browser or the model holds as a plain string.
 *
 * `Url.Url` checks what it holds, so a string becomes one here and nowhere by a cast.
 */
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Url from "../Url.ts"

/**
 * A URL a browser reported, as a `Url.Url`.
 *
 * A browser names a document it hasn't navigated by `about:blank` or, before its first commit, by an empty string,
 * which some Chromium builds write as `":"` for a popup's first frame (#207). The model treats them as one
 * placeholder, and so does this: `""` and `":"` are `about:blank`. Any other string that isn't an absolute URL is a
 * defect in the adapter that reported it, and throws.
 */
export const reported = (url: string): Url.Url => Url.Url.make(url === "" || url === ":" ? "about:blank" : url)

/**
 * A URL a browser reported where a URL is optional, such as a stack frame's script: `None` for one that isn't a URL,
 * as the name of a script run from a string is not.
 */
export const reportedOption = (url: string): Option.Option<Url.Url> => Schema.decodeUnknownOption(Url.Url)(url)
