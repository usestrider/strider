/**
 * The `strider` command's tree (CLI.md). Only `strider browsers` is built: it lists the browsers it can find, so
 * a person or an agent can copy a path into `executablePath` (review 11). The session commands come later.
 */
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Browsers from "./browsers.ts"
import { build } from "./webkitBuild.ts"

// The platform and environment, where the runtime has them; the package doesn't assume Node.
const host = (globalThis as {
  readonly process?: { readonly platform: string; readonly env: Readonly<Record<string, string | undefined>> }
}).process

const layers: { readonly [B in Browsers.Backend]: string } = {
  chromium: "Chromium.layer",
  firefox: "Firefox.layer",
  webkit: "WebKit.layer"
}

const sources: { readonly [S in Browsers.Source]: string } = {
  PATH: "on PATH",
  installer: "where its installer puts it",
  playwright: "in Playwright's cache"
}

/** The text `strider browsers` prints. */
export const render = (
  found: ReadonlyArray<Browsers.Found>,
  cache: Option.Option<string>
): string => {
  const lines = ["Browsers found on this machine. Pass one as executablePath to its backend's layer.", ""]
  for (const backend of Browsers.Backend.literals) {
    lines.push(layers[backend])
    const ofBackend = found.filter((browser) => browser.backend === backend)
    if (ofBackend.length === 0) {
      lines.push(
        backend === "webkit"
          ? `  none found; Playwright's installer puts its WebKit builds in its cache (build ${build.revision} is Playwright 1.63's)`
          : "  none found"
      )
    }
    for (const browser of ofBackend) {
      const facts = [
        Option.getOrElse(browser.version, () => "version not reported"),
        sources[browser.foundBy],
        ...Option.toArray(Option.map(browser.resolved, (resolved) => `leads to ${resolved}`)),
        ...Option.toArray(Option.map(browser.matchesAdapter, (matches) =>
          matches
            ? `the build the WebKit adapter needs`
            : `not build ${build.revision}, which the WebKit adapter needs, so WebKit.layer refuses it`))
      ]
      lines.push(`  ${browser.path}`, `    ${facts.join(" · ")}`)
    }
    lines.push("")
  }
  lines.push(
    `Searched PATH for ${
      [...Browsers.commandNames.chromium, ...Browsers.commandNames.firefox].join(", ")
    }; the locations Chrome's, Edge's and Firefox's installers use; and Playwright's cache${
      Option.match(cache, { onNone: () => "", onSome: (path) => ` at ${path}` })
    }.`,
    `For code that runs on several machines, read the path from each one's environment, as in Chromium.layerConfig({ executablePath: Config.string("CHROMIUM_PATH") }).`
  )
  return lines.join("\n")
}

const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the browsers found as JSON, for scripts and agents"),
  Flag.withDefault(false)
)

/** `strider browsers`: the browsers on this machine, with their versions and how each was found. */
export const browsers = Command.make(
  "browsers",
  { json },
  Effect.fnUntraced(function*({ json }) {
    const platform = host?.platform ?? "linux"
    const env = host?.env ?? {}
    const found = yield* Browsers.find(platform, env)
    yield* Console.log(
      json
        ? JSON.stringify(Schema.encodeSync(Schema.Array(Browsers.Found))(found), null, 2)
        : render(found, Browsers.playwrightCache(platform, env))
    )
  })
).pipe(
  Command.withDescription(
    "List the browsers on this machine, with their versions, for a launch's executablePath. Nothing is launched but --version, and nothing is installed."
  )
)

/** `strider`. */
export const strider = Command.make("strider").pipe(
  Command.withDescription("Strider: Effect-native browser automation"),
  Command.withSubcommands([browsers])
)
