# Bug for Firefox: `network.continueRequest` aborts a request given a new `url`, and cuts a new `body`

*Draft, 2026-10-25, for the maintainer to file in Bugzilla (Remote Protocol :: WebDriver BiDi). Not filed. Search for an existing report first. From Strider's QUIRKS.md, Q92; seen on Firefox 158.0 in review 17, P3, through Strider's adapter and over raw WebDriver BiDi.*

## Steps

1. Start a BiDi session and subscribe to `network.beforeRequestSent`.
2. `network.addIntercept({ phases: ["beforeRequestSent"], urlPatterns: [{ type: "string", pattern: "http://127.0.0.1:PORT/a" }] })`.
3. In a page on `http://127.0.0.1:PORT/`, run `fetch("/a").then((r) => r.text())`.
4. When the request is blocked, send one of:
   - `network.continueRequest({ request, url: "http://127.0.0.1:PORT/b" })`;
   - for a `fetch("/a", { method: "POST", body: "short" })`, `network.continueRequest({ request, body: { type: "string", value: "a longer body than before" } })`, with no `Content-Length` header.

## What happens

- **With `url`:** the command succeeds, and the request fails with `NS_ERROR_ABORT`. The server sees nothing.
- **With `body`:** the request goes on with its original `Content-Length`, so the body the server receives is broken. Sending the new body's `Content-Length` too fixes it.

## What we expected

- **With `url`:** the request is sent to the new URL, as `continueRequest` describes and as Chromium does over CDP's `Fetch.continueRequest`.
- **With `body`:** the length sent matches the new body, as Chromium computes it. Chromium refuses a `Content-Length` header in a continued request ("Unsafe header: content-length"), so a client can't send the same request to both browsers.

## Workaround in Strider

A new URL is `Unsupported` on Firefox (`interception.continueUrl`), and the adapter sends a new body's `Content-Length` itself.
