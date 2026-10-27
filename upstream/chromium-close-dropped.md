# Bug for Chromium: `Target.closeTarget` sent as a navigation commits is answered and ignored

*Draft, 2026-10-25, for the maintainer to file at crbug.com (DevTools > Protocol). Not filed. Search for an existing report first. From Strider's QUIRKS.md, Q149; seen on Chromium 155.0.8059.79, headless, Linux.*

## Steps

Under CPU load (ten browsers at once beside a dozen busy loops; the race is narrow without it), over a browser-level CDP connection:

1. `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })`.
2. `Target.createBrowserContext`, then `Target.createTarget({ url: "about:blank", browserContextId, newWindow: true })`; on the page's session, `Page.enable`, `Runtime.enable`, `Network.enable`, then `Runtime.runIfWaitingForDebugger`.
3. `Page.navigate` to a small page, and wait for the main frame's `Page.frameNavigated`.
4. As soon as `frameNavigated` arrives, send `Target.closeTarget({ targetId })` on the browser session.

## What happens

In 10 of 120 closes, `closeTarget` answers `{ success: true }` and nothing follows: no `Inspector.detached`, no `Target.detachedFromTarget` in 30 seconds. `Target.getTargets` still lists the target, attached, and `Runtime.evaluate` on its session answers. A second `closeTarget` closes it.

A page command sent at the same moment, such as `Page.getNavigationHistory`, is refused with "Not attached to an active page", and accepted when sent again. Sending one and waiting for it to be accepted before `closeTarget` avoided the problem in 120 of 120 closes.

## What we expected

The target closes, or `closeTarget` fails, so the client can tell.

## Workaround in Strider

Before closing a page, the adapter sends `Page.getNavigationHistory` on its session until Chromium accepts it.
