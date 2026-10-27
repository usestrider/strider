# Bug for Firefox: `log.entryAdded` sends a console call's formatted text as its only argument

*Draft, 2026-10-25, for the maintainer to file in Bugzilla (Remote Protocol :: WebDriver BiDi). Not filed. Search for an existing report first. From Strider's QUIRKS.md, Q33; seen on Firefox 158.0.*

## Steps

1. Subscribe to `log.entryAdded`.
2. In a page: `console.log("%s has %d items at %f", "cart", 3.7, 1.25)`.

## What happens

```json
{ "text": "cart has 3 items at 1.250000", "args": [{ "type": "string", "value": "cart has 3 items at 1.250000" }] }
```

`args` has one string, the formatted text, where the page passed four arguments; and `%f` is written as C's `printf` writes it, `1.250000`.

## What we expected

- `args`: the call's four arguments, serialized, as `log.ConsoleLogEntry` describes them, so a client can format or inspect them itself.
- `text`, where the browser formats it: `%f` as the Console Standard's formatter converts it, with `parseFloat`, so `1.25`, as Chromium's DevTools prints it.

## Workaround in Strider

None: the text is Firefox's. Strider formats CDP's and WebKit's arguments with the Console Standard's formatter, so `%f` differs on Firefox alone, and the test says so.
