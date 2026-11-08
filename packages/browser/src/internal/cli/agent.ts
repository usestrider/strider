/** The usage guide shared by `strider agent instructions` and its skill output. */
import type * as CliError from "effect/cli/CliError"
import * as CliOutput from "effect/cli/CliOutput"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import type * as HelpDoc from "effect/cli/HelpDoc"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Session from "./session.ts"

type ExampleLine = string | ReadonlyArray<string>

/** Command examples shared by the guide and parser checks. Strings are comments or blank lines. */
export const examples = {
  "start": [
    ["strider", "browsers"],
    ["strider", "start", "--name", "shop", "--chromium", "/usr/bin/chromium"],
    ["strider", "-s", "shop", "page", "new", "--name", "main", "https://shop.example.com"],
    ["strider", "-s", "shop", "-p", "main", "snapshot"]
  ],
  "actions": [
    ["strider", "-s", "shop", "-p", "main", "find", "Add to cart", "--role", "button"],
    ["strider", "-s", "shop", "-p", "main", "click", "role=button[name=\"Add to cart\"]"],
    ["strider", "-s", "shop", "-p", "main", "expect", "text=\"1 item\"", "visible"],
    ["strider", "-s", "shop", "-p", "main", "goto", "https://shop.example.com/cart"],
    ["strider", "-s", "shop", "-p", "main", "fill", "label=Email", "ada@example.com"],
    ["strider", "-s", "shop", "-p", "main", "press", "Enter", "--target", "label=Email"]
  ],
  "events": [
    ["strider", "-s", "shop", "-p", "main", "goto", "https://shop.example.com/orders"],
    ["strider", "-s", "shop", "-p", "main", "next", "download", "--within", "2 minutes"],
    "# Use the wait handle printed above; w1 is an example.",
    ["strider", "-s", "shop", "-p", "main", "click", "role=button[name=\"Export CSV\"]"],
    ["strider", "-s", "shop", "await", "w1"],
    ["strider", "-s", "shop", "-p", "main", "history", "console", "--level", "error"],
    ["strider", "-s", "shop", "-p", "main", "history", "network", "--failed"]
  ],
  "results": [
    ["strider", "-s", "shop", "-p", "main", "snapshot", "--json"],
    ["strider", "-s", "shop", "-p", "main", "screenshot"]
  ],
  "login": [
    "# APP_PASSWORD is already set in the environment.",
    ["strider", "start", "--name", "login", "--chromium", "/usr/bin/chromium", "--secret", "password=APP_PASSWORD"],
    ["strider", "-s", "login", "page", "new", "--name", "main", "https://shop.example.com/login"],
    ["strider", "-s", "login", "-p", "main", "fill", "label=Email", "ada@example.com"],
    ["strider", "-s", "login", "-p", "main", "fill", "label=Password", "%password%"],
    ["strider", "-s", "login", "-p", "main", "click", "role=button[name=\"Sign in\"]"],
    ["strider", "-s", "login", "-p", "main", "expect", "text=Welcome", "visible"],
    ["strider", "-s", "login", "state", "save", "$HOME/.local/state/strider/shop.state"],
    ["strider", "-s", "login", "stop"],
    "",
    [
      "strider",
      "start",
      "--name",
      "orders",
      "--chromium",
      "/usr/bin/chromium",
      "--state",
      "$HOME/.local/state/strider/shop.state"
    ],
    ["strider", "-s", "orders", "page", "new", "--name", "main", "https://shop.example.com/orders"],
    ["strider", "-s", "orders", "-p", "main", "expect", "role=heading[name=\"Orders\"]", "visible"]
  ],
  "attach": [
    ["strider", "start", "--name", "existing", "--attach", "http://127.0.0.1:9222"],
    ["strider", "-s", "existing", "tabs"],
    "# Use the tab id printed above; N4 is an example.",
    ["strider", "-s", "existing", "control", "N4", "--name", "account"],
    ["strider", "-s", "existing", "-p", "account", "snapshot"],
    ["strider", "-s", "existing", "-p", "account", "release"],
    ["strider", "-s", "existing", "stop"]
  ],
  "fork": [
    ["strider", "start", "--name", "another-job", "--chromium", "/usr/bin/chromium", "--fork", "login"]
  ],
  "mcpStart": [
    ["pnpx", "@usestrider/cli", "mcp", "--start", "--chromium", "/usr/bin/chromium", "--capture", "strict"]
  ],
  "mcpShare": [
    ["strider", "mcp", "-s", "shop"]
  ]
} as const

/** Quote one shell argument, allowing only an explicit home-directory prefix to expand. */
const quote = (value: string): string =>
  /^\$HOME\/[a-zA-Z0-9_./-]+$/.test(value)
    ? `"${value}"`
    : /^[a-zA-Z0-9_./:=@%-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\"'\"'")}'`

/** Render argv as a shell command; the same argv is checked against the CLI parser. */
export const shellCommand = (argv: ReadonlyArray<string>): string => argv.map(quote).join(" ")

const example = (lines: ReadonlyArray<ExampleLine>): string =>
  "```sh\n" + lines.map((line) => typeof line === "string" ? line : shellCommand(line)).join("\n") + "\n```"

const skillMetadata = `---
name: strider
description: Use the Strider CLI to inspect and operate browser pages, manage browser sessions, and reuse login state from a shell.
---

`

const guide = (syntax: string) =>
  `This guide describes the installed CLI. \`strider agent instructions\` prints it without starting a browser or connecting to a session. Re-run it after upgrading; \`--skill\` adds the metadata for a SKILL.md with the same guide.

## Starting and selecting a session

A session keeps its browser, pages and event waits alive between shell commands. Install the command with \`pnpm add -g @usestrider/cli\`, or replace \`strider\` in these examples with \`pnpx @usestrider/cli\`.

${example(examples.start)}

\`browsers\` lists installed browser paths; it does not install one. \`start\` takes an absolute executable path through \`--chromium\`, \`--firefox\` or \`--webkit\`, or an endpoint through \`--attach\`. WebKit here is WebKitGTK's or WPE's MiniBrowser on Linux, not Safari.

Session commands select a session with \`-s NAME\` (or \`STRIDER_SESSION\`, with the flag taking precedence). Page commands also select a page with \`-p NAME\`. Neither has an implicit current selection. Explicit selectors work across agent shell calls that do not preserve environment variables.

\`strider sessions\` lists sessions; \`strider -s shop pages\` lists that session's pages. \`page new --name main URL\` opens and names a page; without \`--name\`, it prints a generated name such as \`p1\`. A failed \`page new\` leaves no page behind. \`strider -s shop -p main page name cart\` renames a page.

## Reading, acting and checking

A snapshot gives an accessibility tree with element refs such as \`e3\`. A ref belongs to that page's latest snapshot, not to another page or a later snapshot. \`find\` searches the stored snapshot, taking one if none exists; a new \`snapshot\` refreshes it after the page changes.

${example(examples.actions)}

Targets accept refs (\`e3\`) or locators: \`role=button[name="Save"]\`, \`text="Add to cart"\`, \`label=Email\`, \`testid=cart\`, and \`css=...\`. Shell quotes keep a locator one argument. Actions need an unambiguous target; failures include details and hints for narrowing it.

Actions click, fill fields, press keys, choose options by label, or scroll an element into view. A fill replaces the field's text; a key press targets an element or the focused element on the page. Navigation goes to a URL or back in history.

These command forms come from the CLI's definitions. All take the session and page selectors described above:

${syntax}

An action returning does not mean all its effects have finished. \`expect TARGET STATE\` waits for a condition, such as \`visible\`, instead of waiting an arbitrary amount of time. \`strider expect --help\` lists the states and text checks. \`snapshot\` and \`find\` read what is available; they do not wait for a future page state.

## Events across commands

\`next\` subscribes now and returns a wait handle; \`await\` collects that wait later. Subscribing before the triggering action captures an event even if it arrives before that action's command returns. \`history\` reads past events without waiting.

${example(examples.events)}

\`next response --url PATTERN\` waits for a response matching the required URL pattern; other event kinds do not use \`--url\`. \`strider next --help\` lists event kinds. Durations use words, such as \`"30 seconds"\` or \`"2 minutes"\`; \`2m\` is not accepted. A popup or download is named in the result. \`history network --failed\` includes failed requests other than cancellations, and responses with status 400 or higher. Unsupported browser capabilities fail explicitly; for example, stock WebKit cannot wait for downloads or identify a popup's opener.

## Results and failures

Session commands print their outcome, elapsed time, and a digest of events since the previous tool call: navigation, popups, dialogs, console errors and failed requests where the capture policy permits them. A digest describes what happened; it does not by itself prove a task succeeded. \`--json\` on a session command prints structured output. Files such as screenshots are written to the session's artifacts directory, and their paths are printed.

${example(examples.results)}

Failures have a tag, message and hints where available. A timeout or failed multi-step operation can leave earlier actions done; inspecting the page distinguishes a completed action from one that needs another attempt. Exit codes are:

| Code | Meaning |
| --- | --- |
| 0 | Success |
${Object.entries(Session.exitCodes).map(([error, code]) => `| ${code} | ${error} |`).join("\n")}
| 1 | Other failure |
| 130 | Interrupted command; the session continues |

Codes identify the outer error, not its nested reason: a LocatorError with an InvalidInput reason exits with ${Session.exitCodes.LocatorError}.

## Login state and separate jobs

Named secrets are read from environment variables at startup. Tools substitute \`%name%\` in supported inputs without printing the secret value.

${example(examples.login)}

A state file contains cookies, localStorage and IndexedDB, not sessionStorage or a whole browser profile. It contains plaintext credentials and belongs outside version control. The examples save to an explicit home-directory path. \`state save\` warns on stderr when Git could commit the file. Each \`--state FILE\` start loads an independent copy, so separate agents can reuse one login without sharing tabs. The source session may already have stopped. Refresh the file when the login expires; \`stop\` never saves it automatically.

\`${
    shellCommand(examples.fork[0])
  }\` instead copies a still-running session's state without a file. It does not copy secret bindings. \`--user-data-dir PATH\` uses a persistent browser profile; two browsers cannot use that profile concurrently.

## Existing tabs and cleanup

${example(examples.attach)}

\`tabs\` lists browser tabs outside the session's control. \`control ID --name NAME\` (or \`control --url PATTERN --name NAME\`) takes one; \`release\` ends that access and its routes and handlers while leaving the tab open.

\`stop\` closes a launched browser, or disconnects from an attached one, and removes the session directory, including its artifacts and downloads. It returns success only after browser cleanup, directory cleanup and ledger removal finish; cleanup failure returns a nonzero exit code. \`stop --keep\` retains the directory. Concurrent stop callers share cleanup, with the first choosing directory retention; disconnecting a caller does not cancel shutdown. Copy wanted files out first. By default a session stops after one hour idle; \`start --idle "2 hours"\` changes that. \`strider prune\` lists resources left by ended programs; \`strider prune --yes\` reclaims them. \`strider prune NAME\` removes a dead session's leftovers.

## Other operations and help

\`strider --help\` lists all commands, \`strider page --help\` lists a group's subcommands, and \`strider page new --help\` gives arguments and flags. Help works without a session or browser.

- \`route PATTERN abort\` installs a request handler on the selected page; \`strider route --help\` describes other decisions. \`dialog handle --help\` describes dialog policies. \`remove HANDLE\` ends a registration returned by these commands.
- \`export test FILE\` writes the session's successful actions and expectations as a Vitest test, replacing refs with locators. Segments and controlled tabs become marked placeholders to complete. For a forked session, add \`--state "$HOME/.local/state/strider/fork.state"\` to write its initial snapshot with mode 0600 and have the test read it; Git warnings apply here too. Without that flag a fork exports an empty context. Profile replay is unsupported.
- \`run FILE --arg KEY=VALUE\` runs a TypeScript segment in the live session. The file exports a Segment, not an arbitrary script; its imports resolve from its directory. The CLI does not type-check it. See https://usestrider.dev/docs/agents/cli#segments for the contract and examples.

## MCP and capture policy

An MCP client can run \`${
    shellCommand(examples.mcpStart[0])
  }\` to start its own session, which ends when the server exits unless \`--keep\` is passed. \`${
    shellCommand(examples.mcpShare[0])
  }\` serves an existing session and uses its existing capture policy. Shell commands and MCP tools can act on the same named pages.

The default capture policy is \`local\`: screenshots, field text and console text can reach the client. \`--capture strict\` on \`start\` or \`mcp --start\` denies screenshots, masks editable fields in snapshots and omits console text from the digest; other page text is still returned. The tools report structured failures and events with each result. This guide explains CLI syntax; MCP clients use their supplied tool schemas for arguments.

Full CLI guide: https://usestrider.dev/docs/agents/cli
`

/** Render the core command forms through the same structured help used by --help. */
const commandSyntax: () => Effect.Effect<string, CliError.CliError, Command.Environment> = Effect.fnUntraced(
  function*() {
    const Cli = yield* Effect.promise(() => import("../cli.ts"))
    const tree = yield* Cli.help
    const console = yield* Console.Console
    const docs: Array<HelpDoc.HelpDoc> = []
    yield* Effect.forEach(
      ["snapshot", "click", "fill", "press", "select", "scroll", "goto", "back", "expect", "next", "history"],
      (name) => {
        if (!tree.subcommands.some((group) => group.commands.some((command) => command.name === name))) {
          return Effect.die(new Error(`The agent guide names an unknown command: ${name}`))
        }
        return Command.runWith(tree, { version: "", renderErrors: false })([name, "--help"])
      }
    ).pipe(
      Effect.provideService(Console.Console, { ...console, log: () => {} }),
      Effect.provideService(CliOutput.Formatter, {
        ...CliOutput.defaultFormatter({ colors: false }),
        formatHelpDoc: (doc) => {
          docs.push(doc)
          return ""
        }
      })
    )
    // Snapshot has only the shared selectors and output flags; show those once in the prose.
    const common = new Set(docs[0]!.flags.map((flag) => flag.name))
    const lines = docs.slice(1).map((doc) => {
      const flags = doc.flags.filter((flag) => !common.has(flag.name)).map((flag) => {
        const syntax = `--${flag.name}${flag.type === "boolean" ? "" : ` <${flag.type}>`}`
        return flag.required ? syntax : `[${syntax}]`
      })
      return [doc.usage.replace(" [flags]", ""), ...flags].join(" ")
    })
    return "```text\n" + lines.join("\n") + "\n```"
  }
)

const instructions = Command.make(
  "instructions",
  {
    skill: Flag.Boolean("skill").pipe(
      Flag.withDescription("Add skill metadata to the same guide, ready to save as SKILL.md"),
      Flag.withDefault(false)
    )
  },
  Effect.fnUntraced(function*({ skill }) {
    const version = yield* Session.version
    const syntax = yield* commandSyntax()
    yield* Console.log(
      `${skill ? skillMetadata : ""}# Strider CLI usage (@usestrider/browser v${version})\n\n${guide(syntax)}`
    )
  })
).pipe(Command.withDescription("Print the installed version's agent usage guide without a browser or session"))

/** Local commands that provide context for agents. */
export const command = Command.make("agent").pipe(
  Command.withDescription("Usage information for agents"),
  Command.withSubcommands([instructions])
)
