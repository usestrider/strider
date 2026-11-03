# Changesets

Each change to a published package comes with a changeset: run `pnpm changeset`, choose the bump, and describe the
change for users. Private tools under `packages/tools` don't need one.

## Release policy

Choose the bump from the stability of the affected API, following
[Effect's stability policy](https://github.com/Effect-TS/effect/blob/main/.agents/skills/changesets/authoring.md):

- `stable`, or no stability classification: compatible fixes are `patch`, compatible additions are `minor`, and
  breaking changes are `major`.
- `unstable`: compatible fixes and additions are `patch`; breaking changes are `minor`.
- `experimental`: fixes, additions and breaking changes are all `patch`.

A breaking change requires previously valid consumer code, configuration or data to change to keep compiling or
behaving according to its previous contract. Check types and runtime behavior, including defaults, errors, resource
lifetimes and persisted data. For each directly affected published package, use the highest bump its changes require.

Public TypeScript APIs declare their classification with `@stability`. Until 1.0, Strider uses `unstable` or
`experimental`, as described in [the conventions](../docs/conventions.md#the-jsdoc-contract). The `strider` CLI is
explicitly `unstable`, including its commands, flags, output formats, exit codes and saved session/state formats.
This classification applies to the CLI implementation in `@usestrider/browser` and the `@usestrider/cli` launcher.
Source location under `internal/` does not make a user-facing CLI change internal.

Changesets does not infer these bumps from JSDoc; the author chooses the bump and review checks it against this policy.
Documentation-only changes, tests and refactors that preserve public behavior do not need a changeset.
