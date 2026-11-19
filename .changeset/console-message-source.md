---
"@usestrider/browser": minor
---

A `ConsoleMessage` now has a `source`: `{ _tag: "Page" }` for the page's own `console` calls, or `{ _tag: "Browser", category }` for what the browser writes to the console itself, with `category` one of `network`, `security`, `deprecation`, `intervention`, `violation`, `rendering`, `storage`, or `other` (`ConsoleMessage.Source`, `ConsoleMessage.Category`). A program can check that a page caused no Content Security Policy violations without matching on the message's text. A new `console.source` capability says how far each browser tells them apart: Chromium fully; stock WebKit except "Fetch API cannot load … due to access control checks", which arrives as an uncaught exception; and not Firefox, which sends the browser's own messages as script errors, so they arrive as uncaught exceptions and every console message there is `Page`.

`source` is required, so code that constructs a `ConsoleMessage` must now give one, and a console history encoded before this release no longer decodes.
