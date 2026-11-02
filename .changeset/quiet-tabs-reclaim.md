---
"@usestrider/browser": minor
---

Add experimental serializable Chromium page and context claims, scoped reclaim with Schema reports distinguishing observed from unknown state, separately marked last-known handoff snapshots, and an explicit reclaimable context constructor. Failed or interrupted context recovery preserves surviving targets and unwinds its setup registrations. Claims from disposable contexts and claims of the wrong kind are refused. Ordinary context cleanup remains unchanged; Firefox, stock WebKit and Chromium connections without a browser WebSocket identity report Unsupported. Persistent contexts require host-provided expiry cleanup before adoption.

Observation defaults to 1000 milliseconds within the caller deadline. An unknown-state page remains scope-owned and closeable without dismissing dialogs; caller Timeout and interruption remain failures. Context reclaim returns its context and per-page reports before settings application.

CDP declaration cleanup continues under the connection lifetime when an ordinary caller deadline expires, while borrowed-context rollback still waits for confirmed restoration.
