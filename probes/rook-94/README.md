# ROOK-94 Firefox client-death probes

These standalone diagnostics change no library behavior. The consolidated report in ROOK-94 supersedes the conclusions in reply #12; the original server-only probe could not distinguish a cancelled fetch from one that remained paused. Results below apply to the measured windows and tested routes, not indefinite survival or a requirement to restart Firefox.

## Reproduction

Run from the repository root under the browser lock and pinned integration shell. Output appends: choose a new output filename when reproducing.

```sh
rookery lock browser -- nix develop .#integration --ignore-environment --keep TERM --command env PROBE_OUTPUT=probes/rook-94/new-server-run.jsonl node probes/rook-94/firefox-reconnect.mjs
rookery lock browser -- nix develop .#integration --ignore-environment --keep TERM --command env PROBE_PROFILE=automation PROBE_OUTPUT=probes/rook-94/new-page-run.jsonl node probes/rook-94/page-observed.mjs
```

Both use headless pinned Firefox 158.0, build 20261007201254, on Linux x86_64 in the integration Nix environment (UTC, C.UTF-8). The supervisor owns Firefox and an HTTP server; a separate child owns the original BiDi connection. SIGKILL targets only that child, without session.end.

## What each harness establishes

| Evidence | Observation | Limit |
| --- | --- | --- |
| `firefox-reconnect.mjs`, `final.jsonl` | Three launches; all 21 session.new attempts rejected through about 30 s. The original request had an isBlocked event before death and never reached the server afterward. | Server non-arrival alone does not distinguish cancellation from continued pausing or prove page survival. |
| `page-observed.mjs`, `page-observed.jsonl` (reviewer's bare-profile run) | Three SIGKILL launches observed for 60 s each: page heartbeats continued to about 59.6–59.8 s; the original fetch had no settlement beacon or server arrival; new matching fetches at about 5/45 s also had no arrival or settlement; preloads ran in new frames at about 6.5/46.7 s. All 12 new-session attempts rejected through 30 s. | Controls before death show that continued requests resolve and failed requests reject/report, and that preloads reach frames. Together these support continued pausing and retained intercept/preload behavior within these windows. No claim beyond them. |
| Same bare-profile page run, WebSocket close without session.end | One launch, 15 s; heartbeats to about 14.5 s, original/new matching fetches unsettled, preload active; three session.new attempts rejected through 10 s. | Closing the transport alone behaved like client death within this observation. |
| Same bare-profile page run, clean session.end | One launch, 15 s; a new session succeeded at about 4 ms, held fetch reached the server at about 2 ms and resolved; new matching fetches were not intercepted; new frame preload marker was undefined. | Clean ending frees the session and removes these resources in this experiment; it differs from transport loss. |
| `page-observed-automation.jsonl` | Five completed launches using Strider's actual automation preferences, with the same outcomes: three 60 s SIGKILL observations, one 15 s close observation and one 15 s clean-end control. | Distinct evidence from the original bare-profile run; no extrapolation to all profiles. |

In the automation rerun, SIGKILL heartbeats reached 59.750–59.864 s and all 12 new-session attempts failed through 30.001–30.002 s. Started beacons confirmed new matching fetches at 5.446–5.449 s and 45.605–45.701 s; neither the held fetch nor those new fetches arrived or reported settlement before the 59.999–60.000 s run ends. Preload beacons carried old-preload at 6.449–6.464 s and 46.609–46.704 s. After WebSocket close, heartbeats reached 14.457 s and all three new-session attempts failed through 10.002 s, with the same retained intercept/preload observations. After clean session.end, the held request arrived at 2 ms and resolved at 3 ms, and a new session succeeded at 45 ms; subsequent new sessions at 1.003/10.004 s succeeded too. New matching fetches resolved and frame markers were undefined. All five cleanup records succeeded. No result depends on claiming a session lives indefinitely.

In the clean-handoff launch, successive new sessions list the `/initial` page under different protocol context IDs while its user-context ID stays the same and heartbeats continue. The inference that this is the same surviving tab follows from its URL, user context and uninterrupted page-side reporting; it is not an independently inspected browser-tab identity. Saved Firefox protocol tab IDs alone therefore did not identify that page across the observed clean handoff. The default tab's protocol ID changed too.

The server-only probe also records same-profile browser restarts permitting new sessions in three trials, with the old tab and created user-context IDs absent. Old preload/intercept/subscription IDs were unknown after restart, the preload marker was absent, and a matching request reached the server. These are restart observations, not disconnect cleanup. No events on an unsubscribed fresh session is not evidence about old subscriptions. The old fetch's absence after restart does not demonstrate its resumption.

## Tested routes and subscription limits

In the server-only probe, a guessed `/session/<saved-id>` endpoint refused the upgrade; no such URL was advertised by the original BiDi session. The original `/session` URL accepted a replacement transport but rejected context queries and session.end with invalid session id. session.status reported Session already started and session.new remained rejected. These results do not prove restart is the only possible recovery.

`source-evidence.json` retains the pinned omni.ja path, SHA256 hashes, extraction method and numbered source excerpts. The inspected WebDriverBiDi new-session algorithm registers `/session/<id>` for a non-BiDi-created session requesting webSocketUrl, not for the directly created BiDi sessions tested here. The geckodriver/WebDriver classic route is **untested**; its source registration is not evidence that it would recover these sessions.

The bounded source inspection followed connection close → unregisterSession → Session.removeConnection, session event forwarding, and the root session module's subscription storage/destruction. The close path removes a connection from a set; it does not clear session subscriptions. Subscriptions are held on the session module and cleared on module destruction; event forwarding iterates currently attached connections. This supports retention on the inspected disconnect path as a source-based inference. Runtime subscription retention/delivery after client death remains **unknown**: neither harness can reattach to query the old subscription ID or receive its events. No expiry guarantee or exhaustive audit of all cleanup paths follows from this inspection.

## Preferences, bounds and cleanup

The original harnesses use a bare profile, corresponding to Strider's stock profile. Strider's default automation profile adds JSON-viewer disabling, `browser.link.open_newwindow=2`, and update/first-run/default-browser/data-reporting settings. The window setting can affect background rendering and thus the page-side observation, so the changed harness imports `firefoxPrefs` directly from Strider and reruns all five launches with PROBE_PROFILE=automation. Strider's opt-in concurrent profile additionally disables budget timer throttling; it is not tested here. Firefox's Remote Agent also applies its own recommended automation preferences in both cases. Launch arguments otherwise match Strider's Firefox launcher.

The page harness bounds endpoint discovery, WebSocket opening, protocol replies, IPC, client readiness, controls and server operations at 10 s. Process shutdown gets 3 s for SIGTERM and 3 s for SIGKILL. Firefox runs in a separate process group, cleaned up with its descendants; finally and SIGINT/SIGTERM cleanup close transports, terminate children, close HTTP connections and remove the temporary profile. Fixed observation windows are 60 s (SIGKILL) or 15 s (close/end); waiting for the shared browser lock is outside these windows. OS SIGKILL of the supervisor cannot run JavaScript cleanup.

JSONL `ms` in the original harness is relative to each process's own performance.now origin: compare within a PID, not between parent and child. `sinceKillMs` is measured in the supervisor from sending SIGKILL. The page harness's `since` is supervisor monotonic elapsed time from just before the client-ending action, rounded to milliseconds; null marks pre-action controls. Browser timestamps are retained as protocol data.

Other retained evidence: `setup-error.jsonl` is an invalid initial URL-pattern setup without a death trial; `endpoint-probe.jsonl` and `reattach-probe.jsonl` are preliminary endpoint investigations; `traffic.jsonl` contains three further 30 s observations including replacement-client session.end refusal. Keep partial/setup evidence separate from completed runs.
