# Bug for Playwright's WebKit: two protocol commands crash the browser instead of failing

*Draft, 2026-10-25, for the maintainer to file at microsoft/playwright. Not filed. Search for an existing report first. From Strider's QUIRKS.md, Q22; seen on Playwright's WebKit build 2359 (WPE, Linux), driving it over its own protocol, not through Playwright's client.*

## Steps and what happens

- **`Playwright.navigate` with a frame id the page doesn't have**, such as one from a document that just went: the browser process aborts (exit 134).
- **`Dialog.handleJavaScriptDialog` on a page with no dialog open:** the browser process crashes (exit 139).

## What we expected

An error reply to the command, as for any other unknown id or wrong state, so a client that races a page can recover.

## Why it matters

A frame can go between a client checking it and the command arriving, so a client can't rule out the first; and one crash ends every page of the browser.

## Workaround in Strider

The adapter sends neither command outside what its model has seen, which narrows the first race and can't close it.
