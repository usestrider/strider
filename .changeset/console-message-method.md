---
"@usestrider/browser": minor
---

A console message the page wrote carries the `console` method it called: `ConsoleMessage.Source`'s `Page` case
now has a required `method`, a `ConsoleMessage.Method` by the Console Standard's name (`log`, `warn`, `dir`,
`trace`, `group`, `groupEnd`, `count`, `timeLog`, `timeEnd`, and the rest). `level` keeps its five values. Code that
builds a `Page` source must now supply its `method`. Where a browser sends two methods alike, or no message, the new
`console.method` capability is `partial` and says how: Chromium's `timeLog` reads as `log`, stock WebKit's `timeLog`
reads as `timeEnd` and its `count` as `debug`, and Firefox sends nothing for `groupEnd`.
