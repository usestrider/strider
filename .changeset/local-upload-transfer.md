---
"@usestrider/browser": minor
---

Transfer `FileInput.local` contents from the caller on every connection, including launched browsers. Browser layers using local uploads now require Effect FileSystem and Path services, including for absolute paths. Preserve basenames and infer MIME types from extensions, falling back to application/octet-stream. Locator read failures retain FileUnreadable; chooser preparation failures are reported and cancel the chooser.

Local files and bytes may now be selected together. Remote paths must be selected separately: mixtures with local files or bytes fail before changing the selection. Empty selections clear through page-side construction so previously transferred files are cleared too. Local chooser uploads, bytes and empty selections require the backend to identify the chooser input; single choosers still require exactly one file.
