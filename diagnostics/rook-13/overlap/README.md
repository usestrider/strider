# Raw CDP and Playwright capture/navigation diagnostic

This harness serves one local, self-contained 829×5631 main element, with no scripts, external resources,
HMR, animations or artificial load. It compares screenshot/navigation overlap on pinned host Chromium
155.0.8059.79. Findings belong in ROOK-13 thread #5; this directory holds runnable diagnostics and traffic.

Run from the repository root, with dependencies installed:

```sh
rookery lock browser -- node --import ./packages/scenarios/diagnostics/rook-13/loader.mjs \
  packages/scenarios/diagnostics/rook-13/run.mjs
```

The coordinator runs raw CDP first, then public Playwright screenshots, sharing one 840-second budget
(under the authorized 15-minute total). It normally reserves 360 seconds for raw attempts and the rest for
Playwright. It starts no new attempt with less than 35 seconds left in its phase. Up to three matrix rounds
run, stopping earlier when the budget requires it. Screenshot deadlines remain 30 seconds. Browser startup,
setup, post-timeout observations and shutdown count within the overall elapsed run. A fixture server and
fresh browser are managed automatically; no docs-site server is required.

`ROOK13_OVERLAP_OUTPUT` changes the output directory (default this directory's `artifacts/`). Use a fresh
output directory, because records append and connection IDs restart. `ROOK13_OVERLAP_SECONDS`,
`ROOK13_RAW_SECONDS` and `ROOK13_ROUNDS` can reduce the run. The global browser budget is capped at
840 seconds even if a larger value is supplied.

The matrix covers capture-then-navigation, navigation-then-capture, and no-navigation controls, each with
or without the 1440→1100 resize and with a tall document clip or a viewport screenshot. The initial viewport
is 1440×1000. Navigation changes /a to /b on the same local server, which returns identical tall content.
Raw attempts use Chromium's sole startup page; Playwright uses one page in a new browser context.

Raw commands are written to Chromium's NUL-delimited debugging pipe synchronously, without awaiting
the first command's reply. Raw launch arguments use Strider's automation profile values, without loading
Strider's browser automation implementation. Capture uses fromSurface:true; tall clips additionally use
captureBeyondViewport:true. After a raw capture times out, an optional diagnostic starts screencasting,
acknowledges the first frame, and stops, each with a bounded observation. It never retries capture or
extends its deadline. The original pending capture remains logged through those commands and teardown,
so any late reply is retained. A post-timeout screencast frame cannot establish continuous compositor
activity throughout the preceding 30 seconds.

Playwright imports and instrumentation live only in `packages/scenarios/diagnostics/rook-13`, using the
package's existing playwright-core 1.64.1. Screenshot uses the public page.screenshot API with its normal
preparation, default launch arguments, and an explicit 30-second timeout. Tall captures use fullPage:true
and the specified clip; viewport captures use the default screenshot area. Playwright's viewport wire
command includes an explicit clip and captureBeyondViewport:false, unlike the raw viewport command.

The Node module loader adds observers at CRConnection's send/receive boundary in the pinned installed
bundle, without changing files in node_modules. When screenshot preparation finally reaches an actual
Page.captureScreenshot send, the observer dispatches Page.navigate via the *same session* immediately
before or immediately after the capture's transport write. It does not await the first response. The
screenshot implementation itself is not replaced, and no screenshot retry is added. The observer injects
only once per public call; later capture commands, if any, would expose internal retries. This deliberately
forces the protocol race after preparation; it does not claim concurrent public goto/screenshot calls have
that ordering. Default Playwright flags and screenshot preparation differ from the raw harness.

Every transport message is recorded with UTC and monotonic timestamps, connection, ID, session, method,
and original envelope byte length, without sampling or a size cutoff. Screenshot/screencast data is replaced
only by its base64 and decoded lengths and a SHA-256 of the base64 text. All other payloads are kept.
Synchronous recording and the observer affect timing. The wire records prove actual transport call order,
not when Chromium's browser or renderer processes began work.

Analyze either implementation's recording:

```sh
python3 diagnostics/rook-13/overlap/analyze.py diagnostics/rook-13/overlap/artifacts/raw
python3 diagnostics/rook-13/overlap/analyze.py diagnostics/rook-13/overlap/artifacts/playwright
```

The analyzer reads plain NDJSON, xz or gzip. It pairs IDs with sessions and connections, keeps late capture
replies, checks adjacent forced navigation and whether the first reply preceded the second send, and reports
lifecycle paints separately from screencast-frame receipts. Attempt summaries contain API outcome durations,
wire capture counts and navigation results. Compressed wire recordings preserve all records; integrity
metadata verifies them against the original byte streams.
