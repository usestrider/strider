---
"@usestrider/browser": patch
---

Search a locator's scope's own open shadow root. A locator scoped to a shadow host, such as `page.locator("my-widget").getByRole("button")`, now finds elements in the host's open shadow tree and the roots nested in it, for every kind of query and for `filter({ has })`; it found nothing there before.
