# CLI: driving a live session from the command line

*Revision 5.25, 2026-10-19. These are sketches, like API.md: names are provisional, and `@usestrider/browser/cli` is declared in [packages/browser/src/cli/](packages/browser/src/cli/). The command is `strider`, the project's name. Strider CD, a continuous-deployment server abandoned in 2022, also installed a `strider` command; few machines will have both.*

## Purpose

The CLI lets an agent, or a person, drive a browser the way a TypeScript file would, from a shell. The one difference that matters is that a session survives between commands. You can stop, do other work, and come back to the same pages, with nothing restarted.

It adds no browser behavior of its own. Every command expands to one TypeScript statement against API.md, which is also how a session is exported as a test.

## Top data models

```ts
interface SessionSpec {                                   // what `strider start` was given; printed back in full
  readonly name: SessionName                              // [a-z0-9-], short enough for a Unix socket path
  readonly backend: "chromium" | "firefox" | "webkit" | { readonly _tag: "Attach"; readonly endpoint: Url.Url }
  readonly userDataDir: Option<FilePath.Local>            // None: profile/ in the session directory, deleted at stop
  readonly initialState:
    | { readonly _tag: "Empty" }
    | { readonly _tag: "File"; readonly path: FilePath.Local }       // --state ./auth/shop.state
    | { readonly _tag: "Fork"; readonly session: SessionName }       // --fork shop-login: copied in memory, nothing on disk
  readonly lifetime: { readonly idle: Duration; readonly ownerPid: Option<number> }   // default: 1 hour idle
  readonly secrets: ReadonlyArray<BrowserToolkit.SecretName>   // --secret password=PASSWORD: Config.Redacted("PASSWORD") from the daemon's ConfigProvider; used as %password%
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
                                                          // uncaught exceptions, console errors, failed requests, crashes, latched waits
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
$XDG_RUNTIME_DIR/strider/       # per user; the OS temp directory where there is no runtime directory
  checkout/                     # one directory per session name
    lock  daemon.sock
    profile/                    # or your --user-data-dir instead, which is never deleted
    downloads/
    artifacts/
```

## A session

```sh
strider start --name checkout                   # session checkout · chromium · idle timeout 1 h
strider -s checkout page new --name shop https://shop.test   # → shop (p1 without --name)
strider -s checkout -p shop snapshot            # refs e1…, kept as shop's latest snapshot
strider -s checkout -p shop fill e4 "ada@example.com"
strider -s checkout -p shop fill e5 %password%  # a secret named at start; never echoed or recorded
strider -s checkout -p shop click e9
strider -s checkout -p shop next download --within 2m   # → w1: waiting from now on, for at most 2 minutes
strider -s checkout -p shop click 'role=button[name="Export CSV"]'
strider -s checkout await w1                    # → d1 "export.csv", 12 KB
strider -s checkout -p shop history console --level error
strider -s checkout run pay.ts                  # a segment: the file's default export, run in the live session
strider -s checkout -p shop route "**/analytics/**" abort   # → r1, a scoped handler; `strider remove r1` ends it
strider -s checkout state save ./auth/shop.state
strider -s checkout export test checkout.test.ts
strider stop -s checkout

strider start --name task-1 --state ./auth/shop.state    # a fork from a saved state
strider start --name task-2 --fork checkout              # a fork from a running session
```

```
clicked button "Add to cart" on shop · 412 ms
since last: navigated to /cart · popup p2 opened · dialog "Leave site?" dismissed by policy
```

```ts
// pay.ts: a segment, run with `strider run` against a live session
export default Effect.gen(function*() {
  const session = yield* CurrentSession.CurrentSession
  const shop = yield* session.page("shop")                // looked up first, so a missing page fails before any step
  const popups = yield* Popup.next(shop)
  yield* shop.getByText("Pay").click()
  const popup = yield* Deferred.await(popups)
  yield* popup.getByLabel("Card number").fill("4242 4242 4242 4242")
  return { popup }                                        // returned handles move into the session, as p2
})
```

## Contracts

**Sessions**
- **Every command names its session.** It comes from `--session`/`-s` or `STRIDER_SESSION`, and the flag wins. There is no fallback, even when only one session is running, because with several agents on one machine "the only session" is a race. The error lists the running sessions. Agent shells often don't keep environment variables between calls, so documentation and skills use the flag.
- **Names are the ids.** They are unique, and starting a name that is taken fails instead of attaching. Handles belong to their session, so `p1` in one session has nothing to do with `p1` in another.
- **Every page command names its page** with `--page`/`-p`. There is no current page and no fallback, even when the session has one page, for the same reason as sessions: an implicit selection is how agents act on the wrong tab (Stagehand followed focus; Chrome DevTools MCP raced on a global selected page). Pages take an optional `--name` when created, and the handle is that name or else `p1`. A page opened without one, such as a popup, is named later with `strider -s checkout -p p2 page name consent`.
- **One context per session.** `--state` and `--fork` apply to it. Two logins at once, such as two users of a chat, are two sessions.
- **One daemon and one browser per session.** Contexts share launch flags, the downloads directory and OS focus (API.md, Testing), so separate browsers keep concurrent agents apart, and a crash ends one session.
- **Lifetime.** A session ends at `strider stop`, after its idle timeout, or when `--owner-pid` exits. Whichever applies is printed at start. `strider sessions` lists name, backend, pages, idle time and owner.

**Storage**
- **The session directory is temporary by default.** It sits at a predictable path, so an agent can find a session's artifacts without being told. It is acquired before the browser starts and deleted after the browser exits, like the library's own temporary profile (API.md, Modules and backends). `strider stop --keep` leaves it and prints its path.
- **`--user-data-dir` moves the profile to a directory you own.** We never delete it. The browser locks it, so only one running session can use it.
- **Hard kills are reported, never reclaimed automatically.** After a SIGKILL or a power loss, the directory remains and nobody holds its lock. `strider sessions` reports it with its size. Starting that name again fails with a hint, and `strider prune <name>` removes the directory and any browser still running from it. This follows the ownership ledger's rule (CONCEPTS.md §3): candidates for reclaim, never automatic deletion.
- **A fork copies storage state into a new session.** `--fork` copies from a running session in memory. `--state` reads a file that `strider state save` wrote with mode 0600.
  - Storage state covers cookies, localStorage and IndexedDB. Playwright made IndexedDB opt-in in 1.51 because Firebase Auth keeps its tokens there; ours includes it, because `exportStorageState` promises the full restorable state.
  - It doesn't carry sessionStorage, service workers, the HTTP cache, in-memory state, or logins bound to the device or a client certificate. Sites that depend on those need `--user-data-dir`.
  - Saving is explicit (principle 11), and `stop` never saves. `start --state` prints the state's age and its earliest cookie expiry.

**Commands**
- **Commands are the toolkit's tools.** Each is an `effect/ai` `Tool`, defined once with Schemas, and its results and failures are the library's own Schemas, so `--json` and the RPC encode them without a serializer of their own. The daemon serves them as an `effect/rpc` group over an `effect/socket` `SocketServer`, the commands are `effect/cli` `Command`s derived from them, and the MCP server and `BrowserToolkit` use them directly (API.md, Agents). Session commands (`start`, `stop`, `sessions`, `page`, `run`, `state`, `export`, `prune`) are added on top.
- **Commands for the live session, the library for programs.** An agent loops by running commands. Self-contained programs use the library directly, run with node or bun. `state save` and `export` are the bridges to programs, segments (below) bring code into a live session, and there is no shell mini-language.
- **Decisions are declarative commands.** `strider route <pattern> abort | continue | fulfill …` and `strider dialog handle accept | dismiss` register scoped handlers in the session and print a registration handle; `strider remove r1` ends one. A decision that needs logic belongs in a segment or a program.
- **Targets** are a bare ref (`e9`), checked against the named page's latest snapshot (a ref from another page's snapshot fails with a hint naming that page), or a locator string that maps to exactly one `getBy*`: `role=button[name="Sign in"]`, `text="Add to cart"`, `label=Email`, `testid=cart`, `css=…`. Strings are parsed at the boundary, so a bad one fails immediately.
- **Events work across commands.** `strider next` subscribes in the session's scope and prints a wait handle, and `strider await` collects it. The wait's deadline starts at `next` (`--within`, or the default budget), so a wait an agent leaves too long reports `Timeout` when collected. The since-last digest is `history`, read from where the previous command stopped.
- **A failed request in the digest** got no response (a network, DNS or TLS error, or blocked by CORS, CSP or mixed content) or a status of 400 or more. Canceled requests, superseded by a navigation or aborted by the app, are not failures. Nothing is filtered by resource type, which would be a heuristic (rule 23). Identical failures are grouped with a count, and a long list shows the first few, then "+N more · `strider history network --failed`".
- **Nothing changes implicitly.** A popup is announced in the digest and gets a handle, but nothing follows it. Attaching to your own browser gives observed pages, and acting on one needs `strider control p3`.
- **Failures say what happened:** the error's tag, its hint and the dispatch evidence ("the click may have reached the page"), with an exit code per module error. Interrupting a command (Ctrl-C) interrupts that command, never the session.

**Segments**
- **`strider run` runs a file's default export,** an `Effect` that requires `CurrentSession` and `Scope`. There are no named exports and no arguments; a file without a default `Effect` fails with a hint.
- **A segment finds its pages by name.** `session.page("shop")` fails with `CurrentSession.PageNotFound`, whose hint lists the session's pages. Only names are accepted, never generated handles such as `p2`. Looking pages up first makes a missing one fail before any step runs.
- **Segments belong to the CLI.** `CurrentSession` comes from `@usestrider/browser/cli`, and only `strider run` provides it. Programs and tests pass pages around as values, as they always do, and never construct a session.
- **`strider run` provides `CurrentSession`, `Scope` and the daemon's platform services.** A segment that requires anything else fails with an error naming the missing service.
- **The CLI doesn't type-check.** A segment is a file in your project, so your `tsc` checks it against the same Strider version the daemon runs from. Agent skills run `tsc --noEmit` before `strider run`, because a segment that fails halfway leaves its earlier steps done.
- **It runs in its own scope, like a script.** Its routes, handlers and waits end with it. Handles it returns are transferred into the session and named, which is the explicit transfer CONCEPTS.md §3 already defines.
- **Segments use locators, not refs.** A ref only means something inside its session.

**Export**
- `strider export test` writes the session as a Vitest test. Refs become the role-and-name locators their snapshots suggest, secrets become config placeholders, `--state` becomes its path, failed commands are left out, and each `run` becomes a marked placeholder naming its file. Export lists those placeholders, because a segment only runs inside a session.

**Client**
- **`strider` forwards argv over the socket without loading Effect.** Loading Effect costs about 600 ms per process, and agents run hundreds of commands. etest's `serve` uses the same trick. The daemon holds the model.
- **Packaging** is the `@usestrider/browser/cli` subpath plus a `bin`, not a separate package (revision 5.10).

## Open questions

None. Type-checking was settled by leaving it to the project's own `tsc`, and failed requests by the rule under Commands.

Candidates, not yet designed:
- **Page-provided tools (WebMCP).** When a page registers tools for agents, one call can replace a sequence of clicks that a banner might block. Their names, schemas and results come from the page, so they are untrusted input.
- **Searching a snapshot** instead of printing it, to keep output small. It would query the structured `Snapshot`, not grep its text.
