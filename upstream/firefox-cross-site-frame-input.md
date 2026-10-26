# Bug for Firefox: page coordinates over a cross-site iframe reach nothing in it

*Draft, 2026-10-25, for the maintainer to file in Bugzilla (Remote Protocol :: WebDriver BiDi). Not filed. Search for an existing report first. From Strider's QUIRKS.md, Q111; seen on Firefox 158.0 in review 18, P1 and P2.*

## Steps

1. A page on `http://127.0.0.1:PORT/` with a cross-site iframe, `<iframe src="http://localhost:PORT/frame" style="width:300px;height:200px;border:0">`, whose document listens for `pointerdown` and `click`.
2. `input.performActions` on the top-level context: a pointer move to a point inside the iframe, then down and up.
3. Check `document.elementFromPoint` in the top document at that point: it is the iframe.

## What happens

Nothing in the iframe's document receives an event, not even `pointerdown`. The same click sent to the iframe's own browsing context, at the point in its own coordinates, lands. A same-site iframe receives the page-coordinate click.

## What we expected

The click to land in the iframe, as the hit test says it should and as Chromium and WebKit deliver it: the spec's actions dispatch at a point in the top-level browsing context's viewport.

## Workaround in Strider

Input names the frame and its origin; the BiDi adapter subtracts the origin and sends the actions to the frame's context. A drag from one document to another still goes to the source's frame alone.
