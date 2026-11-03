# Contributing

Bugs and feature requests go in [GitHub Issues](https://github.com/usestrider/strider/issues). For a change larger than
a small fix, open an issue first, so the design can be agreed before the code is written.

## Setup

```sh
corepack enable
pnpm install
```

The browser integration tests also need [Nix](https://nixos.org), which pins the browsers and the machine they see, on
Linux.

## Checks

```sh
pnpm all                # everything that needs no browser
pnpm test --run <file>  # one test file
pnpm test:integration   # the browser integration tests, in the Nix environment
```

Bare `pnpm test` starts watch mode. [`.agents/AGENTS.md`](.agents/AGENTS.md) lists the narrowest check for each kind of
change, and where everything lives.

## Pull requests

- Code follows the Effect conventions in [docs/conventions.md](docs/conventions.md).
- Every public declaration carries a JSDoc contract with a type-checked example, and generated files are regenerated,
  never edited.
- A change to a published package comes with a changeset: run `pnpm changeset`, choose the bump, and describe the change
  for users.
- CI runs `pnpm all`, `pnpm build` and `pnpm pack-check`. Say in the pull request if you couldn't run the integration
  tests.
