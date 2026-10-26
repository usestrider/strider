# Bug for Chromium: a favicon request cut off by a navigation never ends

*Draft, 2026-10-25, for the maintainer to file at crbug.com (DevTools > Network). Not filed. Search for an existing report first. From Strider's QUIRKS.md, Q159; seen on Chromium 155.0.8059.79, headless, in review 20's build.*

## Steps

1. On a page's session, `Network.enable`.
2. Navigate to a page, and as it loads, before its favicon's request has finished, navigate the page elsewhere. In review 20's build this happened with a local server answering `/favicon.ico` 404 at once, a `goto` right after another; a server that answers the favicon slowly makes it certain.

## What happens

The favicon's request has `Network.requestWillBeSent` and no `responseReceived`, `loadingFinished` or `loadingFailed`, ever. A client following requests to their end waits on it forever.

## What we expected

`Network.loadingFailed` with `canceled: true`, as the page's own requests get when a navigation cuts them off.

## Workaround in Strider

A HAR marks the request `_incomplete`; `inFlightAtStop: "wait"` waits for it until its deadline.
