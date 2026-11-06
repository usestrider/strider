# CLI: driving a live session from the command line

*Revision 5.26, 2026-10-30; built 2026-10-30 (Built, below, says where the build differs). These are sketches, like API.md: names are provisional, and `@usestrider/browser/cli` is declared in [packages/browser/src/cli/](packages/browser/src/cli/). The command is `strider`, the project's name. Strider CD, a continuous-deployment server abandoned in 2022, also installed a `strider` command; few machines will have both.*

## Purpose

The CLI lets an agent, or a person, drive a browser the way a TypeScript file would, from a shell. The one difference that matters is that a session survives between commands. You can stop, do other work, and come back to the same pages, with nothing restarted.

It adds no browser behavior of its own. Every command expands to one TypeScript statement against API.md, which is also how a session is exported as a test.

## Top data models

```ts
interface SessionSpec {                                   // what `strider start` was given; printed back in full
  readonly name: SessionName                              // [a-z0-9-], short enough for a Unix socket path
  readonly browser:                                       // exactly one of --chromium, --firefox, --webkit <path> or --attach <endpoint>
    | { readonly _tag: "Launch"; readonly backend: "chromium" | "firefox" | "webkit"; readonly executablePath: FilePath.Local }
    | { readonly _tag: "Attach"; readonly backend: "chromium" | "bidi" | "webkit"; readonly endpoint: Url.Url }
  readonly viewport: Option<{ readonly width: number; readonly height: number }> // --viewport WIDTHxHEIGHT: CSS pixels for new pages
  readonly userDataDir: Option<FilePath.Local>            // None: profile/ in the session directory, deleted at stop
  readonly initialState:
    | { readonly _tag: "Empty" }
    | { readonly _tag: "File"; readonly path: FilePath.Local }       // --state ./auth/shop.state
    | { readonly _tag: "Fork"; readonly session: SessionName }       // --fork shop-login: copied in memory, nothing on disk
  readonly lifetime: { readonly idle: Duration; readonly ownerPid: Option<number> }   // default: 1 hour idle
  readonly secrets: ReadonlyArray<BrowserToolkit.SecretName>   // --secret password=PASSWORD: Config.Redacted("PASSWORD") from the daemon's ConfigProvider; used as %password%
  readonly capture: "local" | "strict"                   // --capture: the toolkit's CapturePolicy preset; default local
}

type Handle = PageHandle | WaitHandle | DownloadHandle | RegistrationHandle   // p1, w1, d1, r1: per session, printed on acquisition
                                                          // a page takes its --name instead of p1 when given one

interface CommandResult {                                 // a Schema: text by default; --json is its encoding, NDJSON (effect/encoding) for streams
  readonly page: Option<PageHandle>                       // every line names its page
  readonly outcome:
    | { readonly _tag: "Ok"; readonly value: string }
    | { readonly _tag: "Failed"; readonly tag: string; readonly hint: string; readonly dispatch: Diagnostics.DispatchState }
  readonly elapsed: Duration
  readonly acquired: ReadonlyArray<Handle>
  readonly sinceLast: ReadonlyArray<DigestEntry>          // navigations, popups, dialogs and who decided them, downloads,
                                                          // uncaught exceptions, console errors, failed requests, validation observed during clicks, crashes, latched waits
  readonly files: ReadonlyArray<FilePath.Local>           // screenshots, snapshots, traces: written to artifacts/, only the path printed
}

// CurrentSession, from "@usestrider/browser/cli"
interface CurrentSession {
  readonly context: UserContext.UserContext               // the session's one context: newPage, pages
  page(name: PageName | string): Effect<Page.Page, PageNotFound>   // by name only; a generated handle like p2 is a token (principle 14)
}
declare const CurrentSession: Context.Service<CurrentSession, CurrentSession>   // provided only by `strider run`
```

```
$XDG_RUNTIME_DIR/strider/       # per user; otherwise <OS temp directory>/strider-<uid>
  checkout/                     # one directory per session name
    lock  sock
    profile/                    # or your --user-data-dir instead, which is never deleted
    downloads/
    artifacts/
```

Session directories must belong to the current Unix user, have no group or other permissions, and must not be
symlinks. Ancestors must belong to that user or root and cannot be writable by other users, except root-owned
sticky directories such as /tmp. Ancestor aliases such as macOS's /tmp and /var are resolved only when the link
belongs to the current user or root, its parent prevents another user replacing it, and its resolved ancestry
passes the same checks. Roots and session directories themselves cannot be symlinks. Missing parents are created
privately after their existing ancestors pass validation. Unsafe existing directories are rejected without
changing them. Platforms without Unix ownership metadata are refused by the CLI session service.

The fallback used before this change, `<OS temp directory>/strider`, is never read or migrated automatically.
Stop older daemons with the older CLI before upgrading. Restart sessions with the new CLI; inspect and remove
old directories separately, after checking their ownership. The internal socket is now named `sock`; stop old
daemons in XDG_RUNTIME_DIR too, because socket files are not migrated. Do not copy sockets or locks into the new root.
Validated ancestor aliases retain their short spelling for socket bind/connect paths. The 32-character name
limit is unchanged; unusually long runtime paths can still exceed the OS Unix socket path limit.

If you have already upgraded with an old daemon still running, use the older CLI to stop it if available,
with the same runtime-directory environment it used before the upgrade. The new CLI cannot use its old socket.
Otherwise, stop sending it commands and wait for its configured `--idle` timeout: the default is `1 hour`, but
an explicit value at startup takes precedence, and further commands reset its idle timer.

For manual termination, treat the old session's `lock` as a lead, not proof of process identity. Independently
verify that its `pid` still belongs to your account's Strider daemon for that session: inspect its owner,
command line and session arguments, and compare its process start time with the lock's `startedAt` (Unix epoch
milliseconds). A stale PID may now identify another process; neither a matching process name nor a live PID
alone is enough. If identity is uncertain, use the old CLI or wait instead. Only after verifying identity,
request termination of that daemon with your OS process tools (for example, SIGTERM) and wait for it to exit.

After the daemon and the browser it launched have exited, inspect and remove only identified leftovers you
own in the old session directory, then restart the session with the new CLI. Do not remove a live profile,
trust a lock from an unsafe old shared directory without independent checks, or copy old locks or sockets
into the new session. The old shared fallback is never reclaimed automatically.

A client killed during startup can leave a private .start-* directory in the session root. These are excluded
from session listings and named prune. After all CLI clients and daemons using that root have stopped, inspect
these entries and remove only the stale startup directories you have identified. Prune does not sweep them.

## Help

`strider --help` lists the local and session commands without starting a browser or connecting to a session.
Use `strider select --help` for a command's arguments and flags, or `strider page --help` to discover a group's
subcommands and `strider page new --help` for their arguments. The same help is available with a session selector,
such as `strider -s checkout select --help`. `strider start --help` describes every launch and lifetime flag. Command listings describe each command, using the toolkit’s descriptions for its tools. `strider mcp --help` describes session selection, `--start`, `--keep` and the forwarded launch options, `--capture` among them, without starting an MCP server or session.

### Agent usage

`strider agent instructions` prints a version-stamped Markdown usage guide without starting a browser or contacting
a session. It explains session and page selection, targets, actions and checks, event waits, output and failures,
login-state reuse, existing tabs, cleanup and MCP. It describes behavior and examples rather than imposing a task workflow.

`strider agent instructions --skill` wraps the same guide in skill metadata (`name` and `description`) for a
`SKILL.md`. Both outputs come from `src/internal/cli/agent.ts`; there is no separately maintained skill body.
Core command forms and exit codes are rendered from the CLI definitions. Shell examples are stored as argument
lists, rendered with shell quoting and checked against the real command parser with handlers disabled. Behavioral
explanations remain handwritten and are reviewed when behavior changes. Saved copies are regenerated after upgrading the CLI.

## A session

```sh
strider browsers                                # the browsers on this machine, by path, with their versions
strider start --name checkout --chromium /usr/bin/chromium   # session checkout · Chromium 155 at /usr/bin/chromium · idle timeout 1 hour
strider -s checkout page new --name shop https://shop.test   # → shop (p1 without --name)
strider -s checkout -p shop snapshot            # refs e1…, kept as shop's latest snapshot
strider -s checkout -p shop fill e4 "ada@example.com"
strider -s checkout -p shop fill e5 %password%  # a secret named at start; never echoed or recorded
strider -s checkout -p shop click e9
strider -s checkout -p shop next download --within 2m   # → w1: waiting from now on, for at most 2 minutes
strider -s checkout -p shop click 'role=button[name="Export CSV"]'
strider -s checkout await w1                    # → d1 "export.csv", 12 KB
strider -s checkout -p shop history console --level error
strider -s checkout -p shop history network --failed    # no response, or a status of 400 or more
strider -s checkout -p shop find "Add to cart" --role button   # → e9  button "Add to cart"  (main > list "Products"); refs from the latest snapshot
strider -s checkout tabs                        # the browser's pages the session doesn't hold: an attached browser's own tabs
strider -s checkout control N4 --name mail      # takes one, named, until `strider -s checkout release -p mail`
strider -s checkout run pay.ts                  # a segment: the file's default export, run in the live session
strider -s checkout -p shop route "**/analytics/**" abort   # → r1, a scoped handler; `strider remove r1` ends it
strider -s checkout state save ./auth/shop.state
strider -s checkout export test checkout.test.ts
strider stop -s checkout

strider start --name task-1 --chromium /usr/bin/chromium --state ./auth/shop.state   # a fork from a saved state
strider start --name task-2 --chromium /usr/bin/chromium --fork checkout             # a fork from a running session

strider -s checkout mcp                          # an MCP server over stdio for the session, for a client that runs no commands
strider prune                                   # what programs that died left behind, from the ledger; --yes reclaims it
```

An MCP client such as Claude Desktop launches `strider mcp` from its configuration, and shares the session with the shell:

```json
{
  "mcpServers": {
    "strider": { "command": "strider", "args": ["mcp", "-s", "checkout"] }
  }
}
```

With `["mcp", "--start", "--chromium", "/usr/bin/chromium"]` instead, it starts a session of its own, which ends when the client stops it, unless `--keep`. `--capture strict`, on `strider start` or `strider mcp --start`, gives the session `CapturePolicy.strict`. The default is `local`, which retains full capture and search.
Field editability and field-content name provenance are collected only for redacted capture, including equivalent custom policies.
Local capture and ordinary library snapshots skip this work and omit that masking metadata.

Strict capture denies screenshots and masks editable content and validation messages as `•••` in snapshots and
find results. This includes native fields, ARIA fields and contenteditable elements regardless of semantic role,
including `plaintext-only`. Names copied from field content into ancestors or other nodes are masked too,
including embedded values, referenced controls, nearby fields and image-alt inference. Public labels, roles,
refs and states remain visible. Provenance follows contributors under native/ARIA fields through shadow hosts
and assigned slots, including descendants that are not themselves editable. A mixed name containing public
text and field content is masked in full. Native select and ARIA listbox option text is masked with the field
subtree. Strict `find` matches only that redacted
view: a query for hidden content returns no match, while label searches and role filters still work. For example,
`find "Card" --role textbox` can find a field labeled Card, but guessing its masked value cannot find it.

Strict capture omits console text. Uncaught exceptions in both the digest and `history exception` retain only
`uncaught exception at <time>`: the occurrence time in monotonic nanoseconds, with no page-supplied error name,
message, stack or origin text. CLI and MCP apply the same policy.

This is a bounded capture policy, not a secrecy or inference guarantee. Ordinary page text and labels remain
visible, and URLs, dialogs, network/download metadata, arguments and failures can carry page content too. A page
can put sensitive text in a label or another unmasked channel. Assertions such as `expect --text` and action
selectors still match original page content, so they can confirm guesses at masked values. Choose what pages
and tools to expose.

```
clicked button "Add to cart" on shop · 412 ms
since last: navigated to /cart · popup p2 opened · dialog "Leave site?" dismissed by policy
```

```ts
// pay.ts: a segment, run with `strider run` against a live session
export default Segment.make(Schema.Record(Schema.String, Schema.Never), Effect.fnUntraced(function*() {
  const session = yield* CurrentSession.CurrentSession
  const shop = yield* session.page("shop")                // looked up first, so a missing page fails before any step
  const popups = yield* Popup.next(shop)
  yield* shop.getByText("Pay").click()
  const popup = yield* popups
  yield* popup.getByLabel("Card number").fill("4242 4242 4242 4242")
  return { popup }                                        // returned handles are named into the session, as p2
}))
```

A page the segment opens itself belongs to the segment's scope, and closes with it, unless the segment keeps it: `yield* session.keep(page, "receipt")` moves it into the session.

### Viewport sizing

`strider start --name desktop --chromium <path> --viewport 1440x1000` requests a 1440 by 1000 CSS pixel viewport default for new session pages. Omit `--viewport` to keep the browser's default. `strider mcp --start` forwards the same option. Dimensions must be positive safe integers, separated by a lowercase `x`.

`strider -s desktop -p shop page viewport 800x600` changes the selected page. Repeating it replaces the previous CLI viewport override; a failed change preserves the old setting. Other pages and the size inherited by new pages remain unchanged. The backend's emulation capabilities apply, including for attached browsers; unsupported settings fail with the library's capability error. Startup labels this as a requested viewport default, because no page exists to measure yet. Launched stock WebKit resizes native windows and confirms the page's CSS dimensions immediately and on resize events, for up to five seconds (default, capped by the operation deadline). At that limit, one final measurement either confirms the size or fails with `Reason.ViewportMismatch`, whose numeric `requested` and `actual` fields record the dimensions. This means the size was not observed in time, not that it can never be supported. Failed replacement attempts restore and confirm the previous size under a separate five-second cleanup budget; failed-change rollback failure remains visible as a defect alongside the original failure. Ordinary scope release stays non-failing, ignoring confirmed gone pages and warning about other failures without claiming restoration. Callback disposal preserves the command result and warns about non-gone failures. Cleanup reserves its final second for measurement within the same five-second budget. A window manager or user can change the size after confirmation. Popup defaults are attempted but not confirmed by a creating operation; explicitly size the popup to obtain confirmation.

`strider export test desktop.test.ts` preserves the startup viewport in `Browser.newContext({ emulation: { viewport: { width: 1440, height: 1000 } } })` and successful page changes through `page.emulate`, removing each previous CLI override after applying its replacement. `stop` closes a browser launched by the session, including a sized one; attached browsers retain their existing ownership rules.

## Contracts

**Sessions**
- **Every command names its session.** It comes from `--session`/`-s` or `STRIDER_SESSION`, and the flag wins. There is no fallback, even when only one session is running, because with several agents on one machine "the only session" is a race. The error lists the running sessions. Agent shells often don't keep environment variables between calls, so documentation and skills use the flag.
- **Names are the ids.** They are unique, and starting a name that is taken fails instead of attaching. Handles belong to their session, so `p1` in one session has nothing to do with `p1` in another.
- **Every page command names its page** with `--page`/`-p`. There is no current page and no fallback, even when the session has one page, for the same reason as sessions: an implicit selection is how agents act on the wrong tab (Stagehand followed focus; Chrome DevTools MCP raced on a global selected page). Pages take an optional `--name` when created, and the handle is that name or else `p1`. A page opened without one, such as a popup, is named later with `strider -s checkout -p p2 page name consent`, and every line after it calls the page `consent`, the digest's included.
- **`start` names its browser:** exactly one of `--chromium <path>`, `--firefox <path>` and `--webkit <path>`, absolute, or `--attach <endpoint>`. There is no default browser and nothing is looked up; the session's spec prints the path back, with the version the browser reports.
- **`strider browsers` finds a path.** It lists the browsers on the machine, by backend, with their versions and where each path leads, and `--json` prints the same as data. It is one of the commands that need no session and no daemon, with `sessions` and `prune`.
- **One context per session.** `--state` and `--fork` apply to it. Two logins at once, such as two users of a chat, are two sessions.
- **One daemon and one browser per session.** Contexts share launch flags, the downloads directory and OS focus (API.md, Testing), so separate browsers keep concurrent agents apart, and a crash ends one session.
- **Lifetime.** A session ends at `strider stop`, after its idle timeout, or when `--owner-pid` exits. Whichever applies is printed at start. `strider sessions` lists name, backend, pages, idle time and owner. Both commands print the validated `--idle` value with whitespace normalized to spaces (default `1 hour`), which can be reused as `--idle "15 minutes"`, for example.

**Storage**
- **The session directory is temporary by default.** It sits at a predictable path, so an agent can find a session's artifacts without being told. It is acquired before the browser starts and deleted after the browser exits, like the library's own temporary profile (API.md, Modules and backends). `strider stop --keep` leaves it and prints its path.
- **`--user-data-dir` moves the profile to a directory you own.** We never delete it. The browser locks it, so only one running session can use it.
- **Hard kills are reported, never reclaimed automatically.** After a SIGKILL or a power loss, the directory remains and nobody holds its lock. `strider sessions` reports it with its size. Starting that name again fails with a hint, and `strider prune <name>` removes the directory and any browser still running from it. This follows the ownership ledger's rule (CONCEPTS.md §3): candidates for reclaim, never automatic deletion. Every session's daemon also keeps a ledger record, in `$XDG_STATE_HOME/strider/ledger` (`~/.local/state` when unset), of the browser it launched and the directories it made. `strider prune` with no name lists what each dead program's record names, and `--yes` reclaims it: a browser still running from its profile is killed, and its directories removed. A program using the library writes records only if it provides `Ledger.layer`.
- **A fork copies storage state into a new session.** `--fork` copies from a running session in memory. `--state` reads a file that `strider state save` wrote with mode 0600.
  - Both read the context the session's pages are in. The session's own context is saved whole. A tab taken with `control` stays in its browser's context, which holds that browser's every login, so only the held tabs' state is read: the cookies a tab's host is sent, and the storage of tabs open on it (`related`). Hosts rather than sites, since `siteOf` has no public-suffix list and `shop.co.uk` would be every `.co.uk` cookie. `state save --site okta.com` adds a domain and its subdomains; `--all` saves the whole context; widening is always asked for (principle 11). `--fork` takes the held tabs' state and has neither.
  - `state save` says what it saved: counts and hosts, never values. It and `export test` create the directories on the way to the file they write. Pages in several contexts need `-p`, which reads the named page's. An attached session holding no page, whose own context is empty, fails rather than write an empty file.
  - Storage state covers cookies, localStorage and IndexedDB. Playwright made IndexedDB opt-in in 1.51 because Firebase Auth keeps its tokens there; ours includes it, because `exportStorageState` promises the full restorable state.
  - It doesn't carry sessionStorage, service workers, the HTTP cache, in-memory state, or logins bound to the device or a client certificate. Sites that depend on those need `--user-data-dir`.
  - Saving is explicit (principle 11), and `stop` never saves. `start --state` prints the state's age and its earliest cookie expiry.

**Commands**
- **Commands are the toolkit's tools.** Each is an `effect/ai` `Tool`, defined once with Schemas, and its results and failures are the library's own Schemas, so `--json` and the RPC encode them without a serializer of their own. The daemon serves them as an `effect/rpc` group over an `effect/socket` `SocketServer`, as NDJSON on the session's Unix socket, the commands are `effect/cli` `Command`s derived from them, and the MCP server and `BrowserToolkit` use them directly (API.md, Agents). Session commands (`start`, `stop`, `sessions`, `page`, `run`, `state`, `export`, `prune`) are added on top.
- **Commands for the live session, the library for programs.** An agent loops by running commands. Self-contained programs use the library directly, run with node or bun. `state save` and `export` are the bridges to programs, segments (below) bring code into a live session, and there is no shell mini-language.
- **Decisions are declarative commands.** `strider route <pattern> abort | continue | fulfill …` and `strider dialog handle accept | dismiss` register scoped handlers in the session and print a registration handle; `strider remove r1` ends one. A decision that needs logic belongs in a segment or a program.
- **Targets** are a bare ref (`e9`), checked against the named page's latest snapshot (a ref from another page's snapshot fails with a hint naming that page), or a locator string that maps to exactly one `getBy*`: `role=button[name="Sign in"]`, `text="Add to cart"`, `label=Email`, `testid=cart`, `css=…`. Strings are parsed at the boundary, so a bad one fails immediately.
- **Events work across commands.** `strider next` subscribes in the session's scope and prints a wait handle, and `strider await` collects it. The wait's deadline starts at `next` (`--within`, or the default budget), so a wait an agent leaves too long reports `Timeout` when collected. The since-last digest is `history`, read from where the previous command stopped.
- **A failed request in the digest** got no response (a network, DNS or TLS error, or blocked by CORS, CSP or mixed content) or a status of 400 or more. Canceled requests, superseded by a navigation or aborted by the app, are not failures. Nothing is filtered by resource type, which would be a heuristic (rule 23). Identical failures are grouped with a count, and a long list shows the first few, then "+N more · `strider history network --failed`".
- **Validation during a click.** A click's digest reports `validation observed during click` once per affected control when an `invalid`
  event occurs during that click operation. This is temporal evidence only: page handlers can call
  `checkValidity()` or `reportValidity()` on unrelated controls, so it does not prove a submission was attempted
  or blocked. Repeated clicks can each report validation even when snapshot invalidity is unchanged. Observation
  does not call validity methods, change focus, cancel events or wait for later timers.

  Observation covers the top document and open shadow roots present when observation starts. It excludes child
  frames, closed shadow roots and roots created later. Navigation, document loss or an open dialog can discard observations;
  the original click error is preserved. Strict capture shows the control's role and a masked message, without
  its name; local capture includes the name and validation message. Snapshot invalidity continues to describe
  current validity independently of clicks. Feedback collection shares the click's deadline and interruption.
  If collection cannot finish, observer release runs separately and never adds feedback to a later result.
  A busy document may retain listeners until it executes the queued release or ends; the caller does not wait for it.

- **Nothing changes implicitly.** A popup is announced in the digest and gets a handle, but nothing follows it. Attaching to your own browser lists no pages until you take control of a tab: use an id from `strider tabs`, for example `strider control N4`.
- **Failures say what happened:** the error's tag, its hint and the dispatch evidence ("the click may have reached the page"), with an exit code per module error. Interrupting a command (Ctrl-C) interrupts that command, never the session.

**Segments**
- **`strider run` runs a file's default export,** a `Segment.make(schema, Effect.fnUntraced(function*(args) { /* … */ }))` from `@usestrider/browser/cli`. `--arg key=value` supplies a string; `--arg payload=@payload.json` supplies parsed JSON, resolved from the caller's working directory; `@@` starts a literal `@`. Duplicate keys, invalid values, missing required arguments and unexpected keys fail before the callback runs. The schema's decoded type is the callback's argument type. A default export that is not a segment fails with a migration hint.
- **A segment finds its pages by name.** `session.page("shop")` fails with `CurrentSession.PageNotFound`, whose hint lists the session's pages. Only names are accepted, never generated handles such as `p2`. Looking pages up first makes a missing one fail before any step runs.
- **Segments belong to the CLI.** `CurrentSession` comes from `@usestrider/browser/cli`, and only `strider run` provides it. Programs and tests pass pages around as values, as they always do, and never construct a session.
- **`strider run` provides `CurrentSession`, `Scope` and the daemon's platform services.** A segment that requires anything else fails with an error naming the missing service.
- **The CLI doesn't type-check.** A segment is a file in your project, so your `tsc` checks it against the same Strider version the daemon runs from. Agent skills run `tsc --noEmit` before `strider run`, because a segment that fails halfway leaves its earlier steps done.
- **It runs in its own scope, like a script.** Its routes, handlers and waits end with it. Handles it returns are named into the session; a page it opened itself closes with the segment unless it keeps it with `CurrentSession.keep`, which is the explicit transfer CONCEPTS.md §3 defines (Q173).
- **Results are printed.** Plain output is `ran /tmp/x.ts → {"status":200}`; a direct page is `→ p2`. A value preview longer than 4,096 characters ends with a truncation notice. `--json` prints `{ "file": "…", "value": …, "handles": { "p2": { "type": "page", "id": "…" } }, "durationMs": … }` without truncation. Pages nested in returned data become their session names. Values follow evaluation's serialization rules: ordinary JSON stays ordinary; `undefined`, bigint, non-finite numbers, negative zero, dates, regular expressions, maps and sets use evaluation-style `{ "type": …, "value": … }` tags (`undefined` has no `value`). Functions and symbols in objects, maps and sets are omitted; array positions become tagged `undefined`. A cycle, unsupported value or top-level function or symbol fails with `NotSerializable` and its path. Read a `JSHandle` inside the segment before returning it.
- **Capture applies before output.** Named secrets become their placeholders and `Redacted` stays masked. With `--capture strict`, arbitrary return data is replaced with `•••`, since it no longer identifies the field it came from; direct page handles and the handles table remain available. Strict capture also masks failure messages and hints.
- **Failures retain context.** JSON failures go to stderr with `file`, `error`, optional `reason` and `hint`, `phase` (`load`, `arguments`, `execute` or `serialize`), the failed browser `step` when known, and `durationMs`. Plain failures include the same context. An arbitrary JavaScript statement has no browser operation name; its phase is reported without inventing a step. Completed actions are not rolled back.
- **Imports resolve from the segment file.** Keep it inside the project that installs the same Strider and Effect versions as the daemon. A file in `/tmp` does not inherit the daemon's `node_modules`; move it into that project or make those dependencies resolvable from its directory.
- **Segments use locators, not refs.** A ref only means something inside its session.

**Export**
- `strider export test` writes the session as a Vitest test. Refs become the role-and-name locators their snapshots suggest, secrets become config placeholders, `--state` becomes its path, `--fork` and `--user-data-dir`, which a test can't read, a comment saying the test starts empty, failed commands are left out, and each `run` becomes a marked placeholder naming its file. Export lists those placeholders, because a segment only runs inside a session.

**Client**
- **`strider` forwards argv to the daemon as an `effect/rpc` call.** Every caller, the command, `strider mcp`, `strider sessions` and `start --fork`, uses one RPC client, so the protocol is one typed group and Ctrl-C is the call's interruption. The daemon parses the command and holds the model. A forwarded command loads only the client, about 175 ms a command where the Effect-free client of revision 5.25 took about 45 ms (docs/decisions.md, Agents).
- **Packaging** is the `@usestrider/browser/cli` subpath plus a `bin`, not a separate package (revision 5.10).

## Built

The commands above run as written: a daemon per session (`src/internal/cli/daemon.ts`), started detached by `strider start`, holding the browser, the session's one context and the agent toolkit's session; the client (`src/internal/cli/client.ts`), which forwards a command as a call of the session's `effect/rpc` group (`src/internal/cli/protocol.ts`): `Command`, which streams what the command prints and fails with its exit code, `Tool`, `Info` and `State`; and `browsers`, `sessions` and `prune`, which run in the client's process.

- **Starting.** The daemon parses `start`'s flags with `effect/cli`, claims the session's directory (taken while it exists, its `lock` naming the daemon), reads `--secret name=VARIABLE` from the environment the command ran in, creates the context from `--state` or from `--fork`'s session (asked for its state over its socket), and tells the client in one line, over a socket the client listens on for the start alone: the spec, once it serves, or why it couldn't start, which the client prints with an exit code (QUIRKS.md, Q170). Not a pipe, which the daemon would keep open, and the client with it, for as long as the session runs. The daemon has no standard input or output of its own; what it logs goes to `daemon.log`. Its `lock` names it by its process id and when it started, so a process that reuses the id isn't taken for a running session.
- **Commands.** Each is parsed in the daemon by one `effect/cli` tree whose shared flags are `-s`, `-p` and `--json`; the toolkit's tools are its page commands, and `page new`, `page name`, `page viewport`, `remove`, `run`, `state save`, `export test` and `stop` are the session's. Results print as one line, `clicked e9 on shop · 412 ms`, with `since last:` after it; a screenshot is written to `artifacts/` and its path printed; `--json` prints one JSON line. A `%name%` in a value or URL, `page new`'s included, is a secret's value only when the session has a secret of that name; any other text between `%` signs, such as a URL's `%C3%`, is sent as written, and so is a mistyped name (Q250). `page new` checks its `--name` before it opens a page, and closes the page again when its navigation fails, freeing the name, so a `page new` that failed leaves no page in the session, as it leaves none in the exported test; `newPage` through `strider mcp` does the same. A failure prints its tag and message, a navigation's naming the URL it was going to, and exits with its module's code: 10 `LocatorError`, 11 `PageError`, 12 `Timeout`, 13 `TargetGone`, 14 `ExpectationFailed`, 15 `InvalidInput`, 16 `PageNotFound`, 17 `NotPermitted`, 20 for no such session, 2 for a command that doesn't parse. Ctrl-C interrupts the command's call, which interrupts the command alone, and the client says `interrupted; the session goes on` and exits with 130.
- **Lifetime.** The idle timeout and `--owner-pid` are checked each second. `stop` answers successfully only after browser cleanup, session-directory cleanup and ledger removal finish. The response connection stays open through cleanup. Concurrent stop callers share the result; the first stop chooses whether to keep the directory. Disconnecting a stop caller does not cancel shutdown. Cleanup failure returns a nonzero exit code. Stopping closes the browser and deletes the session's directory, or, with `--keep`, only its socket and lock. A daemon killed outright leaves its directory, which `sessions` lists with its size and `prune` removes, after ending any process whose command line names it (Linux).
- **Segments.** `run` imports the file afresh (Q175), checks that its default export is a `Segment`, decodes its arguments, and runs its callback with `CurrentSession` and a scope of its own; pages it returns are named into the session (Q173). A page a segment opens ends with it unless it is kept: `CurrentSession.keep` names the page into the session and transfers it to the session's scope.
- **Export.** `export test` writes the session's successful commands, each tool call as its statement:
  - **The context** is read from the `--state` file when the session started from one. A session started from `--fork`'s session or `--user-data-dir`'s profile, neither of which a test can read, exports a test whose context starts empty, with a comment at its top saying so (Q249).
  - **Pages.** A page that `page new`, or `newPage` through `strider mcp`, opened is opened in the test too. `page name consent` is `const consent = p2`, a variable of the page's new name, which later steps use.
  - **Pages no command opened** are declared where a statement first names them, as a reader would declare them (Q251). A popup is `const p3 = yield* shopPopups`, after `const shopPopups = yield* Popup.next(shop)` just before the command that opened it: the one acting on its opener as it opened, or, when none is, the last that acted on it (Q253). A command acts on the page it names with `-p`, on the page it opens, from the moment the toolkit opens it, and on the popups given to it, so a popup of a popup goes with the first; a segment acts on every page. While a `next popup` on its opener was pending, it is that wait's, `const p3 = yield* w1`, and an `await w1` after is `yield* w1`. A page first found among the context's pages with no event saying what opened it, as every popup on stock WebKit is, is taken by its place there, `const p3 = (yield* context.pages.waitFor((pages) => pages.length >= 3))[2]!`. A segment's pages, those it opened, returned or kept, are its placeholder's, which names them. A page that opened while a command the test leaves out acted on its opener, or while two commands acted on its opener at once, which the session can't tell apart, or the second popup of one opener that one command opened, which `Popup.next` can't single out, is a placeholder naming its variable.
  - **Targets.** A ref is the role-and-name locator its snapshot gave it.
  - **Waits.** `next` is its event module's `next`, with `--within` as `Deadline.within`, and `await` yields it; a popup it collects is a page.
  - **Secrets.** A secret's `%name%` is `Config.Redacted` of its variable, wherever the session put one in a `fill` value or a URL, and any other `%…%` is text, as the session sent it: a fill of the secret alone fills the `Config.Redacted` itself, and any other value reads the secret with `Redacted.value` where it stands, `` `https://shop.test/?token=${Redacted.value(yield* Config.Redacted("TOKEN"))}` ``, which a fill keeps redacted with `Redacted.make`. An `expect --text` with a secret in it keeps only its state check, and a comment where its text check would be says why: a failed check prints the text it expected (Q248).
  - **Declarations.** A route or dialog handler that `remove` ended keeps its handle, `const r1 = yield* shop.route(…)`, and the removal is `yield* r1.remove`, at the step where the session ran it.
  - **Placeholders.** Each `run` is a marked placeholder, and so are a controlled tab and its `release`, and a page the export can't declare; the command lists them. Reads (`pages`, `tabs`, `snapshot`, `find`, `screenshot`, `history`) aren't repeated.
- **Tabs and control** (Q169). The daemon gives the toolkit the browser, so `strider tabs` lists the pages the session doesn't hold, `control <id>` or `--url <pattern>` takes one with `Page.control` in a scope of its own and names it, and `release -p <name>` closes that scope: the tab's declarations end, and it stays open. Held tabs appear in `pages` until release or closure. An exported test marks a controlled tab with a placeholder, and its release with another.
- **Password snapshots.** Password inputs without an explicit ARIA role appear as `editable [ref=e1] [inferred: password]` when inferred interactivity is enabled. Their accessible names, including labels, titles and placeholders, are retained; controls with no accessible name stay unnamed, without nearby-label inference. Disabled and read-only inputs retain this designation. Explicit ARIA roles are preserved. Password values do not contribute to snapshot names or find data, including when another element references the input for its name. Exported named password refs use `Expect.that` to wait for a snapshot containing their exact computed accessible name, under the current deadline and check interval, then combine the matching refs. This respects label, title and placeholder precedence and waits for fields that appear later. Distinct names select distinct controls; duplicate names in one frame remain ambiguous. A missing name fails the wait rather than selecting a field with an overridden hint. A single matching field inside a frame retains its frame context; combining matches from different frames requires manual narrowing. Returned refs retain their usual stale-ref behavior if a field is replaced before acting. Unnamed refs retain `locator("input[type=password]")`; several unnamed fields require narrowing by hand.
- **`find`** searches the page's latest snapshot, taking one if there is none, for refs whose name or text contains the query, or equals it with `--exact`, narrowed by `--role`; a match without a ref of its own, such as text, is its nearest element with one. `find Password` matches the password designation as well as real names. Substring matching ignores case; `find password --exact` matches the designation case-sensitively. Use `--role editable` to filter inferred password controls; `--role textbox` does not select them.
- **`history`** filters by `--level` through `ConsoleMessage`'s filter, and by `--failed` with the digest's rule for a failed request.
- **Downloads** go to the session's `downloads/`, through the context's `downloads` option.
- **`strider mcp`** runs in a process of its own, with Effect: `effect/ai`'s `McpServer` over standard input and output, with the toolkit's tools, each forwarded to the daemon as a `Tool` call and answered with its result encoded by the tool's Schema. A call the MCP client cancels is interrupted in the daemon. Standard output is the client's, so `start`'s spec and every log go to standard error. Tools with no parameters use `Tool.EmptyParams`, whose JSON Schema an MCP client reads as an object. The tools carry MCP's hints: `pages`, `tabs`, `snapshot`, `find`, `screenshot`, `history` and `expect` only read; `goto`, `back`, `click`, `fill`, `press` and `select` act on a page as a person would, so they may destroy; the rest change only the session. A screenshot reaches the client as an image, with its digest as text; its structured result and output schema leave the bytes out, so the image crosses once.
- **The ledger** (`Ledger`, Q146). The daemon builds its browser's layer with `Ledger.layer` on the CLI's ledger directory; `prune` with no name reads it, tells a dead program from a reused process id by its start time where `/proc` says it, and with `--yes` kills what still runs from a recorded profile and removes recorded directories.
- **Stock WebKit.** `start --webkit <path>` with WebKitGTK's or WPE's MiniBrowser launches stock WebKit in automation mode, as `WebKit.layer` does: its window needs a display (`DISPLAY`), and the daemon provides its TCP socket from Node's. Its pages are windows of their own, so the session's context doesn't emulate focus, and `start` says `focus system`. An exported test of such a session provides `SocketConnector` too. On stock WebKit, `next` with `event: "popup"` or `"download"` fails at once, as data naming the capability (`popups.opener`, `downloads`): stock WebKit doesn't say which page opened a page (QUIRKS.md, Q212), and reports no downloads. For the same reason the digest notes no popup there.
- **Where the build differs from this document.**
  - **`--attach` reads its backend from the endpoint** (Q168). HTTP endpoints get one `/json/version` probe, limited to five seconds and 64 KiB. Valid Chromium discovery names a browser WebSocket, which is reused without another discovery request. The exact `WebKitInspectorHTTPServer` Server-header token selects `WebKit.layerAttach`, even when the inspector has no pages. Unsupported responses, malformed discovery and connection failures fail with a reason; redirects are not followed. Proxies stripping WebKit's identity are rejected rather than guessed from HTML or page titles. The session reports the selected backend and keeps the supplied endpoint for reporting and export; the resolved Chromium socket is used only for this startup. Exported attachments provide the Node WebSocket constructor as well as Node services. WebSockets to `/devtools/` use Chromium; other WebSockets use BiDi, adding `/session` when there is no path, as `Firefox.layerConnect` does. Attached WebKit controls its existing default context; its existing tabs enter the session only through `control`. Held tabs appear in `pages`, `sessions` and segments until `release` returns them to `tabs` or external closure removes them. Closure frees the name and snapshot and retires its control and event subscriptions. Their digest subscriptions begin at control and end at release, so uncontrolled tabs and their workers do not contribute events. It cannot create pages or contexts, and `--state`, `--fork` and `--viewport` are rejected. Stopping the session releases control and leaves the attached browser running.
  - **Every page tool brings its page to the front first** (Q167).
  - **The session's context emulates focus** on Chromium, so a page keeps rendering behind a popup, and `start` says so (`focus emulated`); Firefox opens every page as a window, which does the same (Q19, Q71), and so does stock WebKit (`focus system`). An exported test makes its context the same way.
  - **Firefox user contexts on an attached browser aren't recorded:** removing one needs a new WebDriver BiDi session, which Firefox refuses while a dead program's session lingers (Q137).
  - **The toolkit takes the browser as an option,** `browser`, so a model reaches beyond its context only when given it; without it, `tabs` and `control` fail with `NotPermitted`.

## Open questions

None. Type-checking was settled by leaving it to the project's own `tsc`, and failed requests by the rule under Commands.

Candidates:
- **Page-provided tools (WebMCP).** When a page registers tools for agents, one call can replace a sequence of clicks that a banner might block. Their names, schemas and results come from the page, so they are untrusted input. Designed (docs/decisions.md), and built once a browser ships the API.
