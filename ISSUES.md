# ISSUES: what's broken, to work through

*Started 2026-10-26, from the documentation site's copy pass: each entry is something the JSDoc and the guides
couldn't describe truthfully without the code changing, or a doc that still needs checking. The docs now say what the
code does. An entry is marked when it's settled: **Fixed** or **Documented**, with its commit, or **Not a bug**,
saying why; one with no marker is open.*

## Bugs

**I1. Chromium's PDF capability reads `unknown` when headless.** `cdpAdapter.ts:636` looks for `Headless` in the
product name, but headless Chromium 155 reports `Chrome/155.0.8059.79`. The capability tables, and the Chromium guide
(which has an aside about it), show PDF as unknown, though printing works. Decide it from the launch's `headless`
instead.
- **Fixed** in `ffe6f7f`: the adapter reads `HeadlessChrome` from the user agent (QUIRKS.md, Q247), and the slices check that a browser that prints says so.

**I2. `page.activate` on attached WebKit is a defect.** The adapter refuses with `Unsupported` (`emulation.focus`,
`webkitAdapter.ts:3531`), and `internal/page.ts:504` turns every failure but the page's end into a defect, because
`activate`'s error type is only `TargetGone`. Add `PageError` with `Unsupported` to its type.
- **Fixed** in `fd40db9`: `activate` fails with `PageError`, reason `Unsupported`; the toolkit acts on a page it can't bring forward where it is.

**I3. `Dialog.next`, `stream` and `history` don't check `prompts`.** On attached WebKit, where `prompts` is
unsupported (`webkitAdapter.ts:487`), they subscribe and never see a dialog. `Popup`, `Download` and `FileChooser`
fail with `Unsupported` when their capability is missing (`Dialog.ts:257`).
- **Fixed** in `c885548`.

**I4. `FileChooser.handle` succeeds where no chooser is ever reported.** On WebKit `next`, `stream` and `history`
fail with `Unsupported`, but `handle` registers and is never asked. It should fail the same way.
- **Fixed** in `750d6b1`, for `Dialog.handle` too: a handler's registration fails with `DeclarationError`, reason `Unsupported`.

**I5. An auth-phase route's fallback is reported as `continue`.** At the `auth` phase, a route that fails falls back
to canceling the challenge (`model.ts:700`), but the `AutoResolution` event says `decision: "continue"`
(`model.ts:735`) and the log line says "so it continues".
- **Not a bug**, documented in `e785d16`: the fallback is `Route.continue`, which at a challenge cancels it, so the page gets the server's response; `continue` is that decision's name.

**I6. `CurrentSession.keep(page, name)` ignores `name` for a page that has one.** `toolkit.ts:772` returns the page's
existing name and no error.
- **Fixed** in `94b6cb6`: the page is renamed, or `keep` fails with `NameTaken`.

**I7. `NoContent`'s message says 204.** `PageNavigation.ts:437`: "The server answered 204 No Content", but a 205
gives it too.
- **Fixed** in `826a4aa`.

**I8. The no-frames hint suggests what Firefox and WebKit refuse.** `NoRenderingOpportunity`'s message
(`locator.ts:122`) suggests `newContext({ focus: "emulated" })` on every backend; it fails with `Unsupported` on
Firefox and WebKit.
- **Fixed** in `b921eb3`.

**I9. Firefox overwrites the `user.js` of a profile you own.** `firefoxLauncher.ts:72` writes the launch profile's
preferences over `${userDataDir}/user.js`, so the user's own preferences there are lost.
- **Fixed** in `55fb19f`: Strider's preferences go in a marked block after the file's own lines.

**I10. `strider start --attach` picks the wrong layer for two endpoints.** `daemon.ts:807` sends every WebSocket to
`Bidi.layerConnect`, which adds no `/session`, so Firefox needs the full URL that `Firefox.layerConnect` would
complete. Every HTTP endpoint goes to Chromium, so stock WebKit's inspector can't be attached (known: CLI.md, Q168).
- Firefox's half **fixed** in `6ef787f`. Open: telling stock WebKit's HTTP endpoint from Chromium's, which needs a flag or a probe.

**I11. `and`, `or` and `frame` throw.** Given a locator from another page or frame, they throw at once
(`internal/locator.ts:299`, `304`, `969`) instead of failing as an Effect. Locator builders return values, so either
defer it to the first operation as `InvalidInput` or document the throw.
- **Documented** in `867a1b1`: a locator from another page or frame is a mistake in the program, thrown as a defect by design.

**I12. `consoleText: "omitted"` doesn't omit.** The agent toolkit's `history` tool still lists console messages,
without their text (`toolkit.ts:683`); only `sinceLast` leaves them out.
- **Not a bug**: API.md defines `strict` as leaving console text out, not the messages, and the toolkit slice asserts it; `"omitted"` differs from `"redacted"` only in `sinceLast`, as its JSDoc says.

## Code and design disagree

Choose for each: change the code, or change the design documents.

**I13. `Watchable.changes` doesn't conflate.** It's `SubscriptionRef.changes` (`watchable.ts:37`), so a slow consumer
sees every value, with consecutive repeats dropped. README principle 16, API.md:627 and 696 and CONCEPTS.md:516 say
it conflates.
- **Fixed** in `f1438a9`: changes conflate, with a unit test.

**I14. `browser.capabilities` never changes.** Each adapter makes the set once at connect and never writes it again.
API.md:242 says it's refined as probes complete.

**I15. `FileInput.local` gives the browser the path.** API.md:495 says the file is uploaded when the browser is
remote.

**I16. The diagnostics preset only redacts URLs.** README:103 and 195 and CONCEPTS.md:548 say preset-dependent values
implement Effect's `Redactable`; nothing does.
- **Fixed** on main in `9806fe2`: `NetworkRequest` and `NetworkResponse` implement `Redactable`, and the README and CONCEPTS.md say which values the preset covers.

**I17. Most of `Diagnostics` is never filled in.** `dispatch` is only `NotSent` or `MayHaveBeenSent`: `Acknowledged`
is never produced, so an action the browser rejected after sending reports `NotSent`. `progress` is filled only by
launch failures (`launch.ts:38`), `lastObserved` at 2 of 46 call sites, and `cleanup` is always `NotNeeded`
(`operation.ts:62`).
- Partly settled on main in `7b3c783`: a navigation records `Acknowledged` once the browser answers it, and an error built while its operation runs takes `lastObserved` from the operation's record.
- Partly settled in `418ba36`: an operation's steps fill its `progress`, and a step that sent and succeeded is `Acknowledged` in the operation around it. Open: an action's own record reaches `Acknowledged` only for a navigation, so a click that times out after the browser answered still says `MayHaveBeenSent`, and `cleanup` is always `NotNeeded` (`operation.ts:70`).

**I18. `BackendMetadata` is declared but always empty.** Each backend declares its key (`Chromium.ts:27`,
`Firefox.ts:27`, `Bidi.ts:22`, `WebKit.ts:31`), but `BackendFailure.metadata` is always `{}` (`operation.ts:100`); the
protocol error is in `cause`. Fill the keys or remove them.

**I19. The library never sets `CommandTimeout` or `CurrentLateReplyHandler`.** Its commands get the 30-second default
whatever the operation's deadline, and late replies are released, not adopted (`protocolClient.ts:679`).
- Partly settled in `8b3c8ac`: inside an operation, each command waits for its reply until the operation's deadline, in place of `CommandTimeout`, and a page or context created after the deadline is closed. Open: late replies are still released by the default handler, never adopted into their owner.

**I20. `session.page("p2")` accepts a generated name.** CLI.md:46 says a segment finds pages by name only, and a
generated handle like `p2` is a token.

**I21. `nth` takes a negative index.** It counts from the end (`last` is `nth(-1)`), which nothing documents, and
errors name `nth(0)` and `nth(-1)` as `first` and `last`. Decide whether negative indexes are public.

## Declared, never produced

**I22.** `Declaration.TimingUnsupported` (`Declaration.ts:85`, which `InitScript.ts:118` documents) and the close
reason `PrerenderActivated` (`Target.ts:95`) are never raised.

## Docs and examples to check

**I23.** `Expect.toMatchAria`'s example (`Expect.ts:397`) uses `including`, which compares direct children, but a
navigation's links usually sit in a list (navigation, list, listitem, link), so the pattern may not match usual markup.
- **Documented** in `db26b55`.

**I24.** `VitestBrowser.layer`'s summary says each `layer` block gets one browser, but its example provides the layer
to a single effect (`packages/vitest/src/VitestBrowser.ts:87`).
- **Documented** in `db26b55`.

**I25.** `Bidi.layerConnect`'s example returns `page.id` after its scope closed the page (`bidi/Bidi.ts:51`).
- **Fixed** in `db26b55`.

**I26.** `LaunchProfile.automation` says it changes "nothing a page can observe" (`LaunchProfile.ts:42`), but turning
Firefox's JSON viewer off is observable.
- **Documented** in `db26b55`.

**I27.** `SocketConnector.Endpoint`'s `path`, `tls` and `connectTimeout` have no docs (`SocketConnector.ts:32`), and
the `NodeSocket.makeNet({ host, port })` mapping the docs suggest drops `tls` and `connectTimeout`.
- **Documented** in `db26b55`.

**I28.** Stale internal comments: `input.ts:81` says WebKit's pointer can't carry modifiers (launched WebKit can), and
`webkitAdapter.ts:599` says launched mode drives history (`navigation.traverse` is unsupported).
- **Fixed** in `db26b55`.

## Unverified

**I29.** `LaunchOptions.userDataDir` says the directory is "locked while the browser uses it" (`Browser.ts:329`).
Strider doesn't lock it; the browser may.
- **Documented** in `61326b3`: Chromium and Firefox lock it.

**I30.** On a dialog of `Unknown` kind, `respond(text)` fails unless it was a prompt (`Dialog.ts:110`). What happens to
the dialog then isn't known.
- **Fixed** in `71ecc08`. It was a bug: a decision the backend refused was ignored, so the dialog stayed open, unreported. It now goes to the context's policy, reported.

**I31.** `Bidi.layerConnect` is tested only against Firefox.

**I32.** A screenshot timed out once in a full integration run, and passed alone. Reproduce it as the project's
guidance says: many processes beside busy loops, traced from the protocol's messages.

**I33.** The HAR recording slice (`records a HAR with statuses, protocols, bodies and the library's timings,
redacted`) failed once in a full `pnpm test:integration packages/browser/test/integration/slice` run, on a backend
the summary didn't name, and passed alone on all three and in the next full run. Reproduce it as I32.
