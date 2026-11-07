# Redirect capture

Apply from the repository root with `git apply packages/browser/test/integration/diagnostics/redirectCapture.patch`.
Use an absolute, empty `STRIDER_RECORD` directory with the integration command. Reverse the patch after capture.

This temporary diagnostic patch wraps the transport actually launched by Chromium.layer and its adapter sink.
Each process writes redirect-<pid>.ndjson with a monotonic sequence, timestamp and connection id. It retains every
raw outgoing command and incoming message, including session and command ids, without deduplication, sample limits
or length limits. Adapter facts identify per-hop headers and completion; attribution records include the current
hop, queued headers and owed expectations. har-input records snapshot main headers, sent-header state, chosen
requestHeaders, completion, body bytes and export options at entryOf. No assertions, deadlines or attribution logic
are changed. Synchronous writes perturb timing; passing captures cannot exclude a timing-dependent failure.

The patch adds a temporary internal diagnostic module solely so TypeScript can check the instrumented source.
It is not intended to ship. Captures include all headers and bodies and should stay in local investigation artifacts.
