# @usestrider/vitest API index

Generated from `src/` by `pnpm index`; don't edit by hand. One line per declaration and member, by entry point, module and `@category`. Experimental APIs are marked. The browsable reference is generated from the same sources by `pnpm api-reference`.

## `@usestrider/vitest`

### VitestBrowser

The Vitest adapter: a browser layer for `@effect/vitest`, with `TestRun` for the test that's running.

*layers*

- `const layer: <E, R>(backend: Layer.Layer<Browser.Browser, E, R>) => Layer.Layer<Browser.Browser | TestRun.TestRun, E, R>`

*context*

- `const withTest: (context: Pick<TestContext, "task">) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, TestRun.TestRun>>`
