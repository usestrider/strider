# CLI: driving a live session from the command line

*Revision 5.20, 2026-10-19. These are sketches, like API.md: names are provisional. The binary is `eb` here, but `eb` is already AWS Elastic Beanstalk's CLI, so the real name follows the project's.*

## Purpose

The CLI lets an agent, or a person, drive a browser the way a TypeScript file would, from a shell. The one difference that matters is that a session survives between commands. You can stop, do other work, and come back to the same pages, with nothing restarted.

It adds no browser behavior of its own. Every command expands to one TypeScript statement against API.md, which is also how a session is exported as a test.

## Top data models

```ts
interface SessionSpec {                                   // what `eb start` was given; printed back in full
  readonly name: SessionName                              // [a-z0-9-], short enough for a Unix socket path
  readonly backend: "chromium" | "firefox" | "webkit" | { readonly _tag: "Attach"; readonly endpoint: Url }
  readonly userDataDir: Option<LocalPath>                 // None: profile/ in the session directory, deleted at stop
  readonly initialState:
    | { readonly _tag: "Empty" }
    | { readonly _tag: "File"; readonly path: LocalPath }            // --state ./auth/shop.state
    | { readonly _tag: "Fork"; readonly session: SessionName }       // --fork shop-login: copied in memory, nothing on disk
  readonly lifetime: { readonly idle: Duration; readonly ownerPid: Option<number> }   // default: 1 hour idle
  readonly secrets: ReadonlyArray<SecretName>             // --secret password=env:PASSWORD, used as %password%
}

type Handle = PageHandle | WaitHandle | DownloadHandle | RegistrationHandle   // p1, w1, d1, r1: per session, printed on acquisition

interface CommandResult {                                 // text by default; --json for tools
  readonly page: Option<PageHandle>                       // every line names its page
  readonly outcome:
    | { readonly _tag: "Ok"; readonly value: string }
    | { readonly _tag: "Failed"; readonly tag: string; readonly hint: string; readonly dispatch: DispatchState }
  readonly elapsed: Duration
  readonly acquired: ReadonlyArray<Handle>
  readonly sinceLast: ReadonlyArray<DigestEntry>          // navigations, popups, dialogs and who decided them, downloads,
                                                          // uncaught exceptions, console errors, failed requests, crashes, latched waits
  readonly files: ReadonlyArray<LocalPath>                // screenshots, snapshots, traces: written to artifacts/, only the path printed
}

class CurrentSession extends Context.Service<CurrentSession, {   // from "effect-browser": what a segment requires
  readonly browser: BrowserHandle
  readonly page: Page                                     // under `eb run`: the session's current page when the run started
}>()("effect-browser/CurrentSession") {}
```

```
$XDG_RUNTIME_DIR/eb/            # per user; the OS temp directory where there is no runtime directory
  checkout/                     # one directory per session name
    lock  daemon.sock
    profile/                    # or your --user-data-dir instead, which is never deleted
    downloads/
    artifacts/
```

## A session

```sh
eb start --name checkout                   # session checkout · chromium · idle timeout 1 h
eb -s checkout page new https://shop.test  # → p1, now the current page
eb -s checkout snapshot                    # refs e1…, kept as p1's latest snapshot
eb -s checkout fill e4 "ada@example.com"
eb -s checkout fill e5 %password%          # a secret named at start; never echoed or recorded
eb -s checkout click e9
eb -s checkout next download               # → w1: waiting from now on
eb -s checkout click 'role=button[name="Export CSV"]'
eb -s checkout await w1                    # → d1 "export.csv", 12 KB
eb -s checkout history console --level error
eb -s checkout run pay.ts                  # a segment: the file's default export, run in the live session
eb -s checkout route "**/analytics/**" abort      # → r1, a scoped handler; `eb remove r1` ends it
eb -s checkout state save ./auth/shop.state
eb -s checkout export test checkout.test.ts
eb stop -s checkout

eb start --name task-1 --state ./auth/shop.state    # a fork from a saved state
eb start --name task-2 --fork checkout              # a fork from a running session
```

```
clicked button "Add to cart" on p1 · 412 ms
since last: navigated to /cart · popup p2 opened · dialog "Leave site?" dismissed by policy
```

```ts
// pay.ts: a segment, runnable under `eb run` or inside any program that provides CurrentSession
export default Effect.gen(function* () {
  const { page } = yield* CurrentSession
  const popups = yield* Popup.next(page)
  yield* page.getByText("Pay").click
  const popup = yield* popups
  yield* popup.getByLabel("Card number").fill("4242 4242 4242 4242")
  return { popup }                                        // returned handles move into the session, as p2
})
```

## Contracts

**Sessions**
- **Every command names its session.** It comes from `--session`/`-s` or `EB_SESSION`, and the flag wins. There is no fallback, even when only one session is running, because with several agents on one machine "the only session" is a race. The error lists the running sessions. Agent shells often don't keep environment variables between calls, so documentation and skills use the flag.
- **Names are the ids.** They are unique, and starting a name that is taken fails instead of attaching. Handles belong to their session, so `p1` in one session has nothing to do with `p1` in another.
- **One daemon and one browser per session.** Contexts share launch flags, the downloads directory and OS focus (API.md, Testing), so separate browsers keep concurrent agents apart, and a crash ends one session.
- **Lifetime.** A session ends at `eb stop`, after its idle timeout, or when `--owner-pid` exits. Whichever applies is printed at start. `eb sessions` lists name, backend, pages, idle time and owner.

**Storage**
- **The session directory is temporary by default.** It sits at a predictable path, so an agent can find a session's artifacts without being told. It is acquired before the browser starts and deleted after the browser exits, like the library's own temporary profile (API.md, Modules and backends). `eb stop --keep` leaves it and prints its path.
- **`--user-data-dir` moves the profile to a directory you own.** We never delete it. The browser locks it, so only one running session can use it.
- **Hard kills are reported, never reclaimed automatically.** After a SIGKILL or a power loss, the directory remains and nobody holds its lock. `eb sessions` reports it with its size. Starting that name again fails with a hint, and `eb prune <name>` removes the directory and any browser still running from it. This follows the ownership ledger's rule (CONCEPTS.md §3): candidates for reclaim, never automatic deletion.
- **A fork copies storage state into a new session.** `--fork` copies from a running session in memory. `--state` reads a file that `eb state save` wrote with mode 0600.
  - Storage state covers cookies, localStorage and IndexedDB. Playwright made IndexedDB opt-in in 1.51 because Firebase Auth keeps its tokens there; ours includes it, because `exportStorageState` promises the full restorable state.
  - It doesn't carry sessionStorage, service workers, the HTTP cache, in-memory state, or logins bound to the device or a client certificate. Sites that depend on those need `--user-data-dir`.
  - Saving is explicit (principle 11), and `stop` never saves. `start --state` prints the state's age and its earliest cookie expiry.

**Commands**
- **Commands are the toolkit's tools.** They are defined once as Schemas, in an RPC group the daemon serves. The CLI, the MCP server and `BrowserToolkit` all derive from those definitions (API.md, Agents). Session commands (`start`, `stop`, `sessions`, `page`, `run`, `state`, `export`, `prune`) are added on top.
- **Commands for the live session, the library for programs.** An agent loops by running commands. Self-contained programs use the library directly, run with node or bun. `state save`, `export` and segments (below) are the bridges, so there is no shell mini-language.
- **Decisions are declarative commands.** `eb route <pattern> abort | continue | fulfill …` and `eb dialog handle accept | dismiss` register scoped handlers in the session and print a registration handle; `eb remove r1` ends one. A decision that needs logic belongs in a segment or a program.
- **Targets** are a bare ref (`e9`), from the current page's latest snapshot, or a locator string that maps to exactly one `getBy*`: `role=button[name="Sign in"]`, `text="Add to cart"`, `label=Email`, `testid=cart`, `css=…`. Strings are parsed at the boundary, so a bad one fails immediately.
- **Events work across commands.** `eb next` subscribes in the session's scope and prints a wait handle, and `eb await` collects it under its own deadline. The since-last digest is `history`, read from where the previous command stopped.
- **A failed request in the digest** got no response (a network, DNS or TLS error, or blocked by CORS, CSP or mixed content) or a status of 400 or more. Canceled requests, superseded by a navigation or aborted by the app, are not failures. Nothing is filtered by resource type, which would be a heuristic (rule 23). Identical failures are grouped with a count, and a long list shows the first few, then "+N more · `eb history network --failed`".
- **Nothing changes implicitly.** The current page changes only with `eb page use`, never by following a popup or focus. Attaching to your own browser gives observed pages, and acting on one needs `eb control p3`.
- **Failures say what happened:** the error's tag, its hint and the dispatch evidence ("the click may have reached the page"), with an exit code per error family. Interrupting a command (Ctrl-C) interrupts that command, never the session.

**Segments**
- **`eb run` runs a file's default export,** an `Effect` that requires `CurrentSession` and `Scope`. There are no named exports and no arguments; a file without a default `Effect` fails with a hint.
- **The same segment runs anywhere.** `CurrentSession` is in the main entry point, so a program or test provides it (`Effect.provideService(CurrentSession, { browser, page })`) and reuses the segment unchanged.
- **`eb run` provides `CurrentSession`, `Scope` and the daemon's platform services.** A segment that requires anything else fails with an error naming the missing service.
- **The CLI doesn't type-check.** A segment is a file in your project, so your `tsc` checks it against the same effect-browser version the daemon runs from. Agent skills run `tsc --noEmit` before `eb run`, because a segment that fails halfway leaves its earlier steps done.
- **It runs in its own scope, like a script.** Its routes, handlers and waits end with it. Handles it returns are transferred into the session and named, which is the explicit transfer CONCEPTS.md §3 already defines.
- **Segments use locators, not refs.** A ref only means something inside its session.

**Export**
- `eb export test` writes the session as a Vitest test. Refs become the role-and-name locators their snapshots suggest, secrets become config placeholders, `--state` becomes its path, `run` becomes an import of the segment provided with `CurrentSession`, and failed commands are left out.

**Client**
- **`eb` forwards argv over the socket without loading Effect.** Loading Effect costs about 600 ms per process, and agents run hundreds of commands. etest's `serve` uses the same trick. The daemon holds the model.
- **Packaging** is the `effect-browser/cli` subpath plus a `bin`, not a separate package (revision 5.10).

## Open questions

None. Type-checking was settled by leaving it to the project's own `tsc`, and failed requests by the rule under Commands.
