# ISSUES: what's broken, to work through

*Started 2026-10-26, from the documentation site's copy pass: each entry is something the JSDoc and the guides
couldn't describe truthfully without the code changing, or a doc that still needs checking. The docs now say what the
code does. Strike an entry through, with its commit, when it's done.*

## Bugs

**I1. Chromium's PDF capability reads `unknown` when headless.** `cdpAdapter.ts:636` looks for `Headless` in the
product name, but headless Chromium 155 reports `Chrome/155.0.8059.79`. The capability tables, and the Chromium guide
(which has an aside about it), show PDF as unknown, though printing works. Decide it from the launch's `headless`
instead.

**I2. `page.activate` on attached WebKit is a defect.** The adapter refuses with `Unsupported` (`emulation.focus`,
`webkitAdapter.ts:3531`), and `internal/page.ts:504` turns every failure but the page's end into a defect, because
`activate`'s error type is only `TargetGone`. Add `PageError` with `Unsupported` to its type.

**I3. `Dialog.next`, `stream` and `history` don't check `prompts`.** On attached WebKit, where `prompts` is
unsupported (`webkitAdapter.ts:487`), they subscribe and never see a dialog. `Popup`, `Download` and `FileChooser`
fail with `Unsupported` when their capability is missing (`Dialog.ts:257`).

**I4. `FileChooser.handle` succeeds where no chooser is ever reported.** On WebKit `next`, `stream` and `history`
fail with `Unsupported`, but `handle` registers and is never asked. It should fail the same way.

**I5. An auth-phase route's fallback is reported as `continue`.** At the `auth` phase, a route that fails falls back
to canceling the challenge (`model.ts:700`), but the `AutoResolution` event says `decision: "continue"`
(`model.ts:735`) and the log line says "so it continues".

**I6. `CurrentSession.keep(page, name)` ignores `name` for a page that has one.** `toolkit.ts:772` returns the page's
existing name and no error.

**I7. `NoContent`'s message says 204.** `PageNavigation.ts:437`: "The server answered 204 No Content", but a 205
gives it too.

**I8. The no-frames hint suggests what Firefox and WebKit refuse.** `NoRenderingOpportunity`'s message
(`locator.ts:122`) suggests `newContext({ focus: "emulated" })` on every backend; it fails with `Unsupported` on
Firefox and WebKit.

**I9. Firefox overwrites the `user.js` of a profile you own.** `firefoxLauncher.ts:72` writes the launch profile's
preferences over `${userDataDir}/user.js`, so the user's own preferences there are lost.

**I10. `strider start --attach` picks the wrong layer for two endpoints.** `daemon.ts:807` sends every WebSocket to
`Bidi.layerConnect`, which adds no `/session`, so Firefox needs the full URL that `Firefox.layerConnect` would
complete. Every HTTP endpoint goes to Chromium, so stock WebKit's inspector can't be attached (known: CLI.md, Q168).

**I11. `and`, `or` and `frame` throw.** Given a locator from another page or frame, they throw at once
(`internal/locator.ts:299`, `304`, `969`) instead of failing as an Effect. Locator builders return values, so either
defer it to the first operation as `InvalidInput` or document the throw.

**I12. `consoleText: "omitted"` doesn't omit.** The agent toolkit's `history` tool still lists console messages,
without their text (`toolkit.ts:683`); only `sinceLast` leaves them out.

## Code and design disagree

Choose for each: change the code, or change the design documents.

**I13. `Watchable.changes` doesn't conflate.** It's `SubscriptionRef.changes` (`watchable.ts:37`), so a slow consumer
sees every value, with consecutive repeats dropped. README principle 16, API.md:627 and 696 and CONCEPTS.md:516 say
it conflates.

**I14. `browser.capabilities` never changes.** Each adapter makes the set once at connect and never writes it again.
API.md:242 says it's refined as probes complete.

**I15. `FileInput.local` gives the browser the path.** API.md:495 says the file is uploaded when the browser is
remote.

**I16. The diagnostics preset only redacts URLs.** README:103 and 195 and CONCEPTS.md:548 say preset-dependent values
implement Effect's `Redactable`; nothing does.

**I17. Most of `Diagnostics` is never filled in.** `dispatch` is only `NotSent` or `MayHaveBeenSent`: `Acknowledged`
is never produced, so an action the browser rejected after sending reports `NotSent`. `progress` is filled only by
launch failures (`launch.ts:38`), `lastObserved` at 2 of 46 call sites, and `cleanup` is always `NotNeeded`
(`operation.ts:62`).

**I18. `BackendMetadata` is declared but always empty.** Each backend declares its key (`Chromium.ts:28`,
`Firefox.ts:28`, `Bidi.ts:23`, `WebKit.ts:32`), but `BackendFailure.metadata` is always `{}` (`operation.ts:94`); the
protocol error is in `cause`. Fill the keys or remove them.

**I19. The library never sets `CommandTimeout` or `CurrentLateReplyHandler`.** Its commands get the 30-second default
whatever the operation's deadline, and late replies are released, not adopted (`protocolClient.ts:679`).

**I20. `session.page("p2")` accepts a generated name.** CLI.md:46 says a segment finds pages by name only, and a
generated handle like `p2` is a token.

**I21. `nth` takes a negative index.** It counts from the end (`last` is `nth(-1)`), which nothing documents, and
errors name `nth(0)` and `nth(-1)` as `first` and `last`. Decide whether negative indexes are public.

## Declared, never produced

**I22.** `Declaration.TimingUnsupported` (`Declaration.ts:84`, which `InitScript.ts:118` documents) and the close
reason `PrerenderActivated` (`Target.ts:95`) are never raised.

## Docs and examples to check

**I23.** `Expect.toMatchAria`'s example (`Expect.ts:397`) uses `including`, which compares direct children, but a
navigation's links usually sit in a list (navigation, list, listitem, link), so the pattern may not match usual markup.

**I24.** `VitestBrowser.layer`'s summary says each `layer` block gets one browser, but its example provides the layer
to a single effect (`packages/vitest/src/VitestBrowser.ts:87`).

**I25.** `Bidi.layerConnect`'s example returns `page.id` after its scope closed the page (`bidi/Bidi.ts:51`).

**I26.** `LaunchProfile.automation` says it changes "nothing a page can observe" (`LaunchProfile.ts:42`), but turning
Firefox's JSON viewer off is observable.

**I27.** `SocketConnector.Endpoint`'s `path`, `tls` and `connectTimeout` have no docs (`SocketConnector.ts:32`), and
the `NodeSocket.makeNet({ host, port })` mapping the docs suggest drops `tls` and `connectTimeout`.

**I28.** Stale internal comments: `input.ts:81` says WebKit's pointer can't carry modifiers (launched WebKit can), and
`webkitAdapter.ts:599` says launched mode drives history (`navigation.traverse` is unsupported).

## Unverified

**I29.** `LaunchOptions.userDataDir` says the directory is "locked while the browser uses it" (`Browser.ts:329`).
Strider doesn't lock it; the browser may.

**I30.** On a dialog of `Unknown` kind, `respond(text)` fails unless it was a prompt (`Dialog.ts:110`). What happens to
the dialog then isn't known.

**I31.** `Bidi.layerConnect` is tested only against Firefox.

**I32.** A screenshot timed out once in a full integration run, and passed alone. Reproduce it as the project's
guidance says: many processes beside busy loops, traced from the protocol's messages.
