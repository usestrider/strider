---
"@usestrider/browser": patch
---

Add `page.addScriptTag` and `frameLocator.addScriptTag`, which add a `<script>` element to the current document of a page or an iframe, from a URL, inline source or a file (`ScriptTag.Source`), with a `type` and an `id` (`ScriptTag.Options`), and return a handle to the element. The call waits for a URL's `load` event; a classic inline script runs inside it, and an inline module returns once the browser has accepted it, without waiting for it to run. The element's text is the source given. The element is added from the document's main world, so the page's Content Security Policy applies, a report-only policy refusing nothing: a refused script fails with the new reason `RefusedByPolicy`, naming the directive, and a URL that doesn't load fails with the new reason `ResourceFailed`.
