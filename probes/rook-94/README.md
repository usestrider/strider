# ROOK-94 Firefox client-death probe

Run from the repository root (output is appended; use a new filename for each run):

```sh
rookery lock browser -- nix develop .#integration --ignore-environment --keep TERM --command env PROBE_OUTPUT=probes/rook-94/final.jsonl node probes/rook-94/firefox-reconnect.mjs
```

The supervisor owns Firefox, its temporary profile and an HTTP server; a separate child owns the initial WebSocket. Only that child receives SIGKILL. There is no adapter or implicit session.end. Three independent Firefox launches each try session.new at offsets 0, 100, 500, 1000, 3000, 10000 and 30000 ms after sending SIGKILL. Actual offsets are recorded, not assumed. This is a bounded observation, not an assertion about eventual expiry.

JSONL retains commands, replies, events, server arrivals, browser output, process IDs and monotonic timings. `ms` is relative to each process's own performance.now origin: compare within a PID, not between parent and child. `sinceKillMs` is measured in the supervisor from sending SIGKILL; `client-exit` confirms the signal. Firefox protocol timestamps are raw browser wall-clock data.

Before killing the client, the harness asserts an isBlocked event naming the installed intercept and absence of that request at the HTTP server. The original document and fetch remain alive through the observation and attempted reattachment. The session did not return a webSocketUrl capability; `/session/<id>` is explicitly a guessed endpoint, not a browser-advertised URL. If that refuses an upgrade, the probe connects to the original `/session` endpoint and tries context queries, session.status, session.end and session.new. It fails explicitly if reattachment succeeds, since that outcome needs a different cleanup experiment.

After unsuccessful recovery, Firefox is terminated and restarted with the same profile. The probe records new session creation, context/user-context enumeration, attempts to remove the old session's resources by ID, a new page's preload marker, an unintercepted matching request and unsolicited events. This distinguishes browser-restart cleanup from recovery of the live old session. Neither a missing HTTP request nor an inaccessible session proves which internal resources were retained or deleted.

Evidence files:

- `setup-error.jsonl`: initial invalid wildcard URL-pattern setup; no client-death trial.
- `endpoint-probe.jsonl`: first 30-second observation, ending at a refused guessed endpoint.
- `reattach-probe.jsonl`: second observation, confirming context queries on `/session` fail.
- `traffic.jsonl`: three repeated observations including explicit session.end refusal.
- `final.jsonl`: final harness, adding asserted blocked-event proof and same-profile browser restart.

No library behavior is changed. These are diagnostic experiments, not assertions of a supported reconnect contract.
