# @usestrider/browser

## 0.2.0

### Minor Changes

- 1ffff69: Change default pointer-action coordinates from the padding-box centre to a client-rectangle centre after viewport and parent-frame clipping. With `receivesPointer` enabled, choose the first centre that reaches the target or a descendant and its iframe in every parent document, including a later line when an earlier line is covered. If no centre reaches it locally, retain the first geometric candidate for `Covered`; if all locally reachable centres are blocked by parents, retain the first parent `Covered` result. Produce fresh candidates under the input permit. Disabling `receivesPointer` selects the first geometric centre without coverage probes. This fixes wrapped links, including links in scrollers and cross-origin frames. When no fragment remains, the viewport check scrolls and checks again. Integer-rounded default points stay inside the rectangle when an integer coordinate fits.
  
  A target with no visible fragment now has no default point, even with actionability checks disabled: it waits and fails with `Timeout` if no point becomes available, rather than dispatching an offscreen point.
  
  Migration: callers that depend on the former centre, such as canvas interactions, should supply an explicit `position` (and `targetPosition` for a drag target) measured from the padding-box top left. For the former centre, use half the padding-box width and height. Explicit offsets keep that origin and are not replaced by a clipped default point. For coordinate-based input without locator point selection, use `page.mouse` with viewport coordinates.

### Patch Changes

- 2d18ff6: Synchronize every Chromium screenshot with a renderer layout-metrics read before capture, reusing it for full-page and CSS sizing. This adds renderer responsiveness and layout work within the existing deadline; interruption or document replacement during the read prevents capture dispatch.
- eced824: Mask rich editable fields' descendant names and text-derived editable names under strict capture, including names and paths returned by find. Preserve field labels, element refs, and full capture output.
- 24a7c81: Read Chromium renderer layout metrics before screencast acquisition to order it after tracked navigation processing. This shares screenshots' readiness read and adds renderer/layout work within the existing acquisition deadline; metrics errors can surface before start. It does not guarantee activation across another navigation.
- 1c51f9c: Recheck protocol reply deadlines on the monotonic browser clock so an early timer does not let a resolving Timeout escape an inherited expectation deadline.

## 0.1.2

### Patch Changes

- 9bf0ba8: Add `strider agent instructions` to print a versioned CLI usage guide for agent context, with `--skill` to emit the same guide as a skill.
- c256b0f: Protect CLI session roots with per-user fallback paths and ownership, permission and symlink validation, and allocate startup files in private temporary directories.
  
  Without XDG_RUNTIME_DIR, the fallback moves from `<OS temp directory>/strider` to `strider-<uid>`. Old daemons are
  no longer discovered there: stop them with the older CLI before upgrading and restart sessions. Unsafe existing
  roots are refused without changing their permissions; root/session symlinks are refused while trusted ancestor
  aliases are resolved and checked. Missing session connections keep the NoSession exit code, and refusals print
  to stderr without corrupting MCP stdout. Session names are validated before path use or named cleanup.
  
  Missing-session diagnostics retain the running-session list and exit code 20. Named prune matches whole path
  arguments or long-option path values, including directory boundaries, so similarly named or embedded unrelated
  paths do not select a process. Trusted ancestor aliases keep their validated spelling for socket paths, and the
  internal socket basename is shortened to `sock` to leave room for 32-character session names. Stop older daemons
  with the older CLI before upgrading, including sessions in XDG_RUNTIME_DIR; socket files are not migrated.
  
  If already upgraded with an old daemon still alive, prefer stopping it with the old CLI under its original runtime
  environment. Otherwise stop sending commands and wait for the daemon's configured `--idle` timeout (default:
  `1 hour`; startup overrides apply and further commands reset the timer). Before manually terminating it, independently
  verify that the lock's `pid` still identifies your account's daemon for that session: check ownership, command/session
  arguments and process start time against `startedAt` (Unix epoch milliseconds). Never signal a process solely because
  a stale lock names its PID; if identity is uncertain, use the old CLI or wait. Once the verified daemon and its browser
  have exited, inspect and remove only identified leftovers you own, then restart with the new CLI. Do not copy locks
  or sockets, delete live profiles, or automatically reclaim the old shared fallback.

## 0.1.1

### Patch Changes

- fa12edd: Publish the current build. 0.1.0's `dist` was out of date against its `src`: among other things it lacked the `Operation` module and the `experimental` entry point, so use this version instead.

## 0.1.0

### Minor Changes

- b24968b: Initial release.
