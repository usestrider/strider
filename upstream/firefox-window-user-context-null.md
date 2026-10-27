# Bug for Firefox: `userContext: null` in events about windows

*Draft, 2026-10-25, for the maintainer to file in Bugzilla (Remote Protocol :: WebDriver BiDi). Not filed. Search for an existing report first. From Strider's QUIRKS.md, Q178; seen on Firefox 158.0, headless.*

## Steps

1. Start a BiDi session and subscribe to `browsingContext`.
2. `browser.createUserContext`, then `browsingContext.create({ type: "window", userContext })`.
3. Later, `browser.removeUserContext({ userContext })`.

## What happens

- **Creating the window** also opens a tab in the *default* user context, in a window of its own, which is closed at once. Its `navigationStarted` and `navigationCommitted` (to `about:newtab`) come before its `contextCreated`, and carry `"userContext": null`; its `contextCreated` then says `"userContext": "default"`.
- **Removing the user context** sends `contextDestroyed` for the window's context with `"userContext": null`.

## What we expected

`userContext` is a `browser.UserContext` in `browsingContext.NavigationInfo` (optional there) and in `browsingContext.Info` (required), so a client that validates events against the spec's CDDL rejects these. And no tab in another user context: `browsingContext.create` asked for one context.

## Workaround in Strider

A protocol correction makes both members nullable, and the adapter places no context whose user context it isn't told.
