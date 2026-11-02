# ROOK-13 capture diagnostic

Run from the repository root with Node 24 and pnpm dependencies installed. This is a diagnostic harness,
not an integration-suite test or a change to the browser implementation. Findings belong in ROOK-13's thread #5.

Prepare the site's generated reference and static output, then start both servers:

```sh
pnpm reference
pnpm website:build
pnpm --dir website exec astro dev --host 127.0.0.1 --port 4390
python3 -m http.server 4391 --bind 127.0.0.1 --directory website/dist
```

Astro 7's dev command starts its server in the background. Check readiness before running captures; a refused
navigation is a server setup failure, not a screenshot timeout. Stop the dev server with
`pnpm --dir website exec astro dev stop` when finished.

The baseline command used in the investigation was:

```sh
ROOK13_OUTPUT=$PWD/diagnostics/rook-13/artifacts/current ROOK13_SECONDS=600 \
  rookery lock browser -- node --import ./diagnostics/rook-13/trace-loader.mjs diagnostics/rook-13/baseline.ts
```

The running baseline was initially launched under the name `run.ts`; `baseline.ts` preserves that version's
behavior. It creates one docs page per launched browser. Chromium.layer also launches an initial about:blank
page. To use that startup page itself, with no other page, run:

```sh
ROOK13_OUTPUT=$PWD/diagnostics/rook-13/artifacts/single-page ROOK13_SECONDS=295 \
  ROOK13_STARTUP_PAGE=1 ROOK13_PROBE=1 \
  rookery lock browser -- node --import ./diagnostics/rook-13/trace-loader.mjs diagnostics/rook-13/run.ts
```

Each attempt launches headless Chromium with `LaunchProfile.automation`, applies 1440×1000, navigates with
`waitUntil: "load"`, checks main visibility, applies 1100×1000, and captures either `main` or the viewport.
It cycles both routes and both servers without retries, pauses, load generators or deadline changes.
The executable defaults to `/etc/profiles/per-user/jpowers/bin/chromium`; override with `ROOK13_CHROMIUM`.
Use a new output directory each time: records append and connection numbers restart at one.

`ROOK13_FRAMES=1` enables the original draft's requestAnimationFrame counter and extra evaluations before
and after capture. Leave it unset for the reported sequence: it changes timing. Callback counts establish
renderer callback activity, not compositor frame production.

`ROOK13_PROBE=1` enables additional diagnostics only after a screenshot has already failed: start a screencast,
acknowledge its frames, request two animation-frame callbacks in a page evaluation, then stop the screencast.
These probes do not retry the screenshot or change its deadline. Keep these outcomes separate from baseline
captures; subsequent observations cannot establish compositor activity during the original stall.

The loader wraps the transport passed into CdpAdapter.connect without modifying source files. Every outbound
command and incoming message is timestamped (UTC and process monotonic milliseconds), with its connection,
ID, session, method and original message byte length. No reply/event sampling or size cutoff is applied.
Screenshot and screencast image data is replaced by base64 length, decoded byte length and the SHA-256 of the
base64 string; receipt metadata and the rest of the reply remain. Other messages retain their full payload.
This synchronous logger itself affects timing; it is diagnostic instrumentation.

Analyze a recording with:

```sh
python3 diagnostics/rook-13/analyze.py diagnostics/rook-13/artifacts/current
```

Committed wire files are compressed without dropping records. The analyzer reads plain NDJSON, xz or gzip
recordings directly, so expansion is optional.

Pair commands by `(connection, sessionId, id)`, including late replies received after a timeout. `summary.json`
contains the computed counts and unmatched commands. `failure-excerpt.ndjson` is an aid to reading the failure;
the full wire recording is the source of truth.
