---
"@usestrider/browser": patch
---

On Chromium, an operation on a page the program didn't open, such as a persistent profile's first tab from `context.pages` or a tab open in a browser attached with `Chromium.layerConnect`, now waits until Strider has read the page's frames before it sends anything. Before, a `goto` made as soon as the page was listed timed out with "The navigation had no outcome before the deadline", since the events of its navigation arrived before that read and were dropped; with a route installed first, the navigation's paused request was never continued and `goto` timed out unanswered. A navigation such a page finishes before Strider reads its frames is the document the page opens with, which `PageNavigation.next` doesn't receive.
