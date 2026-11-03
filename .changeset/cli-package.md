---
"@usestrider/cli": minor
"@usestrider/browser": patch
---

Add `@usestrider/cli`, the `strider` command as a package to install globally: `pnpm add -g @usestrider/cli`. It runs on Node, or on Bun where there is no Node. A global install of `@usestrider/browser` never links its optional peer `@effect/platform-node`, under pnpm even when both are named, so the command couldn't start. In a project, the library's own `strider` command works as before, and its message when the peer is missing now says how to install either way.
