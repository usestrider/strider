---
"@usestrider/browser": minor
---

Add `ConsoleMessage.nextCall` and `ConsoleMessage.streamCalls`, which subscribe to console calls: each message with handles to the values the page passed the console (`ConsoleMessage.Call`). Since the handles run code in the page's own scripts, they take a `Page` or a `UserContext`, which control gives. A page or context keeps console arguments only while it has a subscription to calls; others send nothing new. The handles belong to the subscription's scope, each subscriber owns its own, and a message no subscriber takes is freed as soon as the last one passes on it. On Firefox an argument holds its value as serialized at the call, and a node is the page's own; the new `console.arguments` capability says how each backend holds them, and where it is unsupported the subscriptions fail with `Unsupported`.

**Breaking:** a console message's `text` now renders an object as a preview of its value, as the browser's developer tools print it, on every backend: `console.log([1, 2, 3], {a: 1}, window)` reads `[1, 2, 3] {a: 1} Window` where it read `Array(3) Object Window` on Chromium, `Array Object Window` on WebKit, and `Array(3) Object(1) window` on Firefox. Code that matched the old text, such as a filter on `Object`, needs the preview instead.
