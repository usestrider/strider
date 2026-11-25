---
"@usestrider/browser": patch
---

Add `Locator.drop`, which drops files or data onto an element as a drop from outside the page arrives, on every
backend. The page dispatches untrusted `dragenter` and `dragover` with one `DataTransfer` holding the files, then
the data entries, and then `drop`; when no `dragover` handler accepts, the element gets `dragleave` and the call
fails with the new reason `Locator.DropRefused`. `FileInput.bytes` files are dropped as given and `FileInput.local`
files are read by the library, for launched and attached browsers alike; `FileInput.remote` files and an empty
payload fail with `InvalidInput` before any event is sent. `DropOptions.position` sets the point.
