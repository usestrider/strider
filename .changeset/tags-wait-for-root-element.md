---
"@usestrider/browser": patch
---

`addStyleTag` and `addScriptTag` no longer append to the document itself when it has no root element yet, as
right after `goto` returns while the page's HTML is still arriving. The element then became the document's root,
so the parser built no `<html>` or `<body>`. They now wait for the parser to add the root, until the operation's
deadline, and append there.
