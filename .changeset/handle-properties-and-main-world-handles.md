---
"@usestrider/browser": patch
---

Add `JSHandle.properties`, a handle for each of a value's own enumerable properties; `Locator.evaluateHandle`, which returns the one match's evaluation as a handle; `Page.evaluateHandleInMainWorld`, a handle in the page's own world, which also works on WebKit; and `BrowserWorker.evaluateHandle`, a handle in a worker's realm, where the browser can evaluate in workers. A worker's evaluations now take handles from its realm as arguments. A handle's string now previews its value: a primitive's value, a node's tag, or an object's kind.
