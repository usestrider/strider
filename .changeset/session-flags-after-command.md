---
"@usestrider/browser": patch
---

Accept session flags before and after CLI subcommands, including --session and --session=name. Explicit flags take precedence over STRIDER_SESSION; inline command values and arguments after -- do not select a session. MCP uses the same session selection rules.
