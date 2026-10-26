# Issue for WebDriver BiDi: a back/forward-cache restore has no events a client can rely on

*Draft, 2026-10-25, for the maintainer to file at w3c/webdriver-bidi. Not filed. Search the issues first: a restore event may already be under discussion. From Strider's QUIRKS.md, Q4, Q5 and Q69; seen on Firefox 158.0.*

## What a client sees today

`browsingContext.traverseHistory` to an entry in the back/forward cache:

- sends `navigationStarted`, then no `navigationCommitted`, `domContentLoaded` or `load`; the old document's realm is destroyed and a new one created;
- can reply before the restored document's realm exists, under load;
- replays, on the restored document, a console message it logged when it first loaded.

Leaving Firefox's JSON viewer before it has loaded (`devtools.jsonview.enabled`, the default), the traversal sends no `navigationStarted` at all, fetches the page again, and reports no new document: in a stress run, 12 traversals in 32 went unreported for 10 seconds.

## Why it matters

A client tracking navigations has to infer a restore from a realm appearing while a traversal is in flight. That inference depends on timing, and when nothing at all is reported it can't be made. Chromium's CDP reports a restore as a commit (`frameNavigated` with `type: "BackForwardCacheRestore"`).

## What we'd ask for

An event for a document restored from the back/forward cache, with the navigation's id and the document's context, sent before `traverseHistory` replies, and a navigation's end for every traversal, restored or loaded.

## Workaround in Strider

The adapter infers a restore from a new main-world realm during a traversal (Q4, Q5), and `LaunchProfile.automation` turns the JSON viewer off.
