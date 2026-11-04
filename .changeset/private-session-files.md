---
"@usestrider/browser": patch
---

Protect CLI session roots with per-user fallback paths and ownership, permission and symlink validation, and allocate startup files in private temporary directories.

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
