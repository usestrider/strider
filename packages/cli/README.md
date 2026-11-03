# @usestrider/cli

The `strider` command: drive a browser from a shell or an agent.

```sh
pnpm add -g @usestrider/cli
strider browsers
strider agent instructions
```

`strider agent instructions` prints the installed version's usage guide for agent context, without a browser or session.
`strider agent instructions --skill` prints the same guide with skill metadata, ready to save as `SKILL.md`.
Without a global install, use `pnpx @usestrider/cli agent instructions`. Regenerate saved context after upgrades.

The [command's guide](https://usestrider.dev/docs/agents/cli) has the rest. For the library it comes from, see
[`@usestrider/browser`](https://www.npmjs.com/package/@usestrider/browser).

MIT licensed.
