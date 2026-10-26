# Bug for Firefox: a WebDriver BiDi session outlives the WebSocket that started it

*Draft, 2026-10-25, for the maintainer to file in Bugzilla (Remote Protocol :: WebDriver BiDi). Not filed. Search for an existing report first, and quote the spec's steps for a closed connection before filing: we read them as ending a BiDi-only session whose last connection closes. From Strider's QUIRKS.md, Q137 and Q146; seen on Firefox 158.0 in review 19, P5 and P6.*

## Steps

1. Start Firefox with `--remote-debugging-port`, and open a WebSocket to `/session`.
2. Send `session.new` with any capabilities.
3. Close the WebSocket, or end the client's process, without sending `session.end`.
4. Open another WebSocket to `/session` and send `session.new`.

## What happens

The second `session.new` fails, "Maximum number of active sessions", 13 seconds after the first socket closed and for as long as we waited. A WebSocket to the old session's own URL is refused too. Only a restart of the browser frees it. `session.end` before closing frees it at once.

## What we expected

Closing the session's only connection ends the session, so the next client can start one. A client that crashes can't send `session.end`.

## Workaround in Strider

The adapter ends a session it started in its connection's finalizer, bounded by a second. A program that's killed outright still leaves the browser locked.
