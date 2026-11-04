---
"@usestrider/browser": patch
---

Protect CLI session roots with per-user fallback paths and ownership, permission and symlink validation, and allocate startup files in private temporary directories.

Without XDG_RUNTIME_DIR, the fallback moves from <OS temp directory>/strider to strider-<uid>. Old daemons are
no longer discovered there: stop them with the older CLI before upgrading and restart sessions. Unsafe existing
roots are refused without changing their permissions; root/session symlinks are refused while trusted ancestor
aliases are resolved and checked. Missing session connections keep the NoSession exit code, and refusals print
to stderr without corrupting MCP stdout. Session names are validated before path use or named cleanup.
