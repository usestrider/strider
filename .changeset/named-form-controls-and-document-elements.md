---
"@usestrider/browser": patch
---

Locators, actions and expectations now work on a form whose controls are named for the form's own DOM members, such as `<input name="localName">` or `<input name="getAttribute">`, on Chromium and stock WebKit. The form lost its role, and a control named for a method made every role query on the page fail with a `TypeError`. On stock WebKit, a document's named elements, such as `<img name="activeElement">`, no longer stand in for the document's own members, so focus is read from the focused element.
