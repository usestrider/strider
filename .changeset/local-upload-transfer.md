---
"@usestrider/browser": minor
---

Upload `FileInput.local` contents to attached browsers using scoped open-file reads and sequential acknowledged 64 KiB chunks. Bytes share the chunk transport, avoiding whole-file encoded strings. Preserve transferred basenames, inferred MIME (application/octet-stream fallback), and available stat modification times. No library size cap is added; browser storage and resource limits still apply.

Attached Local uploads now require captured Effect FileSystem and Path services and cannot mix with Remote paths; they may mix with Bytes. These compatibility changes require an unstable minor bump. Launched Local uploads retain native paths, previous service requirements and Local/Remote combinations. A container or wrapper launch with separate storage must use Bytes instead. Stock WebKit's existing native-path append limitation remains.

Validate transferred-file and native locator cardinality before selection changes, and clear empty selections through page-side construction. Transferred chooser selections and empty multiple selections need an identified input. Reads and transfer consume the original handler deadline, including time already spent in the handler; failure or interruption cancels the chooser and releases transfer resources.

Keep failed chooser preparation out of the handled count, while retaining count-before-application ordering for prepared decisions and the user handler’s registration scope.
