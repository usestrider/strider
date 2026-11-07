# @usestrider/vitest API index

Generated from `src/` by `pnpm index`; don't edit by hand. One line per declaration and member, by entry point, module and `@category`. Experimental APIs are marked. The browsable reference is generated from the same sources by `pnpm api-reference`.

## `@usestrider/vitest`

### VitestBrowser

The Vitest adapter: a browser layer for `@effect/vitest`, with `TestRun` for the test that's running.

*layers*

- `const layer: <E, R>(backend: Layer.Layer<Browser.Browser, E, R>, options?: { readonly trace?: TraceOptions | undefined } | undefined) => Layer.Layer<Browser.Browser | TestRun.TestRun, E, R>`

*models*

- `type TraceOptions = & { readonly screenshots?: Trace.CaptureOptions["screenshots"] readonly screencast?: Trace.CaptureOptions["screencast"] readonly directory: string } & (| { readonly domSnapshots?: true | undefined re…`

*constructors*

- `const traceFileName: (info: TestRun.TestInfo) => string`

*context*

- `const withTest: (context: Pick<TestContext, "task">) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, TestRun.TestRun>>`
