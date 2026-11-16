---
"@usestrider/browser": minor
---

The agent toolkit's `newPage` and `goto`, which `strider page new`, `strider goto`, `strider mcp`, and `BrowserToolkit` share, now return once the new document's HTML is parsed (`domContentLoaded`) instead of at commit, so a `snapshot` or `find` straight after sees the page's content. A new `waitUntil` parameter (`--wait-until commit|domContentLoaded|load` on the command line) chooses another point, and `export test` writes the same `waitUntil` into each `goto`. `find` now reads the page on every call and keeps that read as the page's latest snapshot, where before it reused the first snapshot it had taken, so a `find` that came back empty while the page was still loading, or one after `goto` to another page, kept searching a tree the page no longer had. `Page.goto` still returns at commit by default, and `back` still returns at commit.
