# `@effect/test` (etest): Effect's test runner, and how effect-browser plugs in

Sources: Sebastian Lorenz's branch `feat/effect-test-runner` in `Effect-TS/effect` at `8a06675ec` (2026-10-13), read through `git show` from a local clone:
- `packages/test/NOTES.md`, `EVENTS.md` and `etest.config.ts`;
- `src/{Test,Protocol,Executor,AssertionRecord}.ts`;
- `examples/{shared,fixtures-a,provide}.test.ts`.

The branch is an unmerged, private prototype. It describes itself as "an Effect-native test runner meant to replace vitest". Everything here was **read**; nothing was run. Expect it to change.

## Summary

- **Fixtures fit directly.** Tests are values, and fixtures are Layers attached with `Test.provide`; a fixture lives as long as the node it is attached to. Our browser, context and page Layers plug in as they are. There are no hooks, so `BrowserTest` should be Layers by lifetime rather than a runner-specific wrapper.
- **Concurrency is the default,** the opposite of Vitest. Executors are worker threads, each running up to 4 files at once, and each file runs up to 8 tests at once. So many pages in one browser is the normal case, and the launch profile and focus emulation matter by default.
- **The test environment is the default.** Every attempt gets a fresh `TestClock`, a `TestConsole` and a seeded `Random`. Our deadlines and trace timestamps must run on a live clock.
- **It fails a test that makes no assertions.** Our `Expect.*` must record into etest's assertion record, or browser tests that only use `Expect` would fail.
- **Gaps that matter to us:** there are no attachments on `TestFinished`, no current-test reference, and shared layers that span the whole run (needed for one browser per run) don't exist yet.

## The model

- **Tests are values.**
  - A file's `export default` is its tree: `Test.suite(name, [...])` or `Test.test(name, effect)`.
  - Options are data on the nodes, applied with pipeable transformers: `Test.timeout`, `Test.retries`, `Test.tags`, `Test.skip`, `Test.only` and `Test.noAssertions`. The nearest setting wins.
  - Test ids are `file > suite > … > test`, relative to the project. Projects are found through the nearest `etest.config.ts`.
- **Fixtures are Layers.** `Test.provide(layer)` gives a lifetime equal to the node it is attached to:
  - **On a suite,** the layer is built lazily on the first test that runs and released after the last one. On the root suite, that means once per file.
  - **On a test,** it is built for every attempt.
  - **MemoMaps fork down the tree,** so an inner `Test.provide(X)`, or an `Effect.provide(X)` inside a test body, reuses an outer instance. `Layer.fresh` opts out.
  - **Missing fixtures are compile errors.** Nodes carry a phantom `R`, so a missing `Test.provide` names the missing service.
- **Shared layers** (`Test.config({ shared: [layer] })`):
  - They are built once per run, the first time any file provides that same Layer value, and kept until the run ends.
  - They must have no requirements (`Layer<A, E, never>`).
  - They only optimize: every file still provides everything it needs.
  - **In the prototype, "once per run" means once per executor.** A run-wide instance "needs the coordinator to own the MemoMap and serve the instance over the protocol", which the notes call the main gap.
- **Execution.**
  - A coordinator dispatches files over `ExecutorRpcs` (`ListFile`, `RunFile → Stream<TestStarted | TestFinished>`) to a pool of executors. Executors are Node worker threads, or Bun and Deno workers.
  - Each executor runs up to K=4 files at once, and each file runs up to T=8 tests at once, through a semaphore.
  - Tests in a suite run concurrently. Plain (non-Effect) tests run one at a time.
  - Module state is shared per executor, and modules aren't reloaded between files.
- **Test environment.**
  - Every attempt gets a fresh `TestClock`, a `TestConsole`, and `Random.withSeed(fnv1a(runSeed:id))`.
  - The per-test timeout (60 s by default) is `Effect.timeoutOption` in real time, around the body's own `Effect.scoped`. On timeout the body is interrupted and its finalizers run.
- **Assertions.**
  - `Assert.*` are plain functions that throw a data-carrying `AssertionError`.
  - `eventually` and `always` advance the TestClock by an `interval` between attempts, or sleep on a live clock inside `TestClock.withLive`.
  - Every attempt has an `AssertionRecord`, found through `CurrentRecord`, a `Context.Reference`.
  - A test fails if it made no assertion (`noAssertions`), if a failed assertion was caught or lost in an unjoined fiber, or if an assertion Effect was built but never run.
- **Events and reporters.**
  - The event stream is a Schema'd `TestEvent`: `RunPlanned | TestStarted | TestFinished | RunFinished` (schema version 2).
  - `TestFinished` carries `status`, `durationMs`, `seed`, `attempt`, `previousAttempts`, `failures[]`, `console[]` and `assertions`. **There is no attachments field.**
  - Reporters are `agent` (the default, failures first, with exact rerun commands), `human` and `jsonl`.
  - There is also `etest serve` (a warm server) and an MCP server (`run_tests`).

## How effect-browser maps onto it

| Our piece | Under etest |
|---|---|
| browser | a Layer from `Test.provide`: on the root suite it is per file; listed in `shared` it is per executor today and per run later |
| context and page | Layers on each test (`tests.map(Test.provide(layer))`), or acquired in the body's scope |
| concurrency | tests run concurrently by default, so many pages share one browser; the launch profile and focus emulation are the normal case, not opt-in |
| deadlines and trace timestamps | a live clock; the per-attempt TestClock must never reach them |
| `Expect.*` | must increment the attempt's `AssertionRecord`, and should fail as `AssertionError`-shaped data so reporters render code frames |
| `Expect`'s re-check interval | etest's `eventually` uses a fixed `interval` too; ours stays in real time |
| test timeout | our default operation deadline sits well below the 60 s test timeout, so failures arrive as `Timeout` with evidence rather than as an interrupted test |
| trace retention | a finalizer seeing `Exit` sees an interruption on timeout, which should count as a failure and keep the trace |
| one browser per run (option B in research/test-parallelism.md) | the canonical coordinator-owned shared layer: a browser can't be serialized, but its endpoint can |
| runtimes | executors are worker threads on Node, Bun and Deno, so our transports must work inside workers on all three (probe 12) |

## What to raise with Sebastian

1. **Attachments on `TestFinished`**, such as `{ name, path, contentType }`. Traces, HARs and screenshots need them to reach reporters and the MCP output.
2. **A current-test reference** (project, id, attempt, seed, executor) for naming artifacts.
3. **A public way for third-party assertions to record** into `AssertionRecord`, and to fail with the same failure data as `Assert`.
4. **Shareable shared layers.** The coordinator acquires a resource and publishes a Schema-encoded handle, and each executor rebuilds a service from that handle. For a browser, the handle is its endpoint and the rebuild is `Chromium.connect(endpoint)`.
5. **A per-suite concurrency option.** Heavy browser suites may want fewer than T=8 concurrent tests without lowering it for the whole run.
