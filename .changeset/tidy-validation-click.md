---
"@usestrider/browser": patch
---

Report validation observed during toolkit and CLI clicks, including repeated attempts, with messages governed by capture policy. This temporal feedback does not claim a submission was blocked; observation covers the top document and its existing open shadow roots.


Optional validation feedback stays within the click's budget and can be interrupted. Observer release runs separately when collection cannot finish; dialogs, busy pages and document loss may discard feedback. Toolkit and CLI click timeouts now name `Toolkit.click` rather than `Locator.click`; other locator tools retain their existing names.
