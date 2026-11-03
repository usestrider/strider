---
"@usestrider/browser": minor
---

Add experimental serializable Chromium page and context claims, scoped reclaim with Schema reports distinguishing observed from unknown state, separately marked last-known handoff snapshots, and an explicit reclaimable context constructor. Failed or interrupted context recovery preserves surviving targets and unwinds its setup registrations. Claims from disposable contexts and claims of the wrong kind are refused. Ordinary context cleanup remains unchanged; Firefox, stock WebKit and Chromium connections without a browser WebSocket identity report Unsupported. Persistent contexts require host-provided expiry cleanup before adoption.

Observation defaults to 1000 milliseconds within the caller deadline. An unknown-state reclaimed page remains scope-owned and closeable without dismissing dialogs; caller Timeout and interruption remain failures. Context reclaim returns its context and per-page reports before settings application.

CDP declaration cleanup continues under the connection lifetime when an ordinary caller deadline expires, while borrowed-context rollback still waits for confirmed restoration.

Planned Chromium handoff lets caller handlers answer normally, then dismisses residual dialogs on the original session before declaration teardown. It never automatically accepts, including beforeunload or an accept policy. Confirmed dismissals are typed handoff events with kind/message, separate from present-state observations; failed or timed-out dismissal reports Unknown without failing scope closure. Crash reclaim remains observational.

Context-only handoffs carry serialized historical events to context reclaim. No-settings recovery adopts blocked pages as Unknown without session setup; requested settings on Unknown pages fail before ownership moves. Each handoff declaration release has a separate 1000 ms confirmation budget; an unconfirmed release keeps its warning and returns Unknown. Complete describes release-time handling, not the next client's current state. Ownership and snapshot registrations move together; connection cleanup interruption does not interrupt a waiting finalizer.
