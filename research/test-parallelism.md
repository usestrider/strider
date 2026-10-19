# Test parallelism: Playwright, Vitest and @effect/vitest

Sources:
- A full clone of `microsoft/playwright` at `b335271`. `PW` stands for `/tmp/prior-art/playwright/packages`.
- `@effect/vitest@4.0.5`. `EV` stands for `/tmp/effect-extra/vitest/x/package/src`.
- `vitest@5.0.3`, the version @effect/vitest 4.0.5 is built against, from a local pnpm store. `P` stands for `plugin.d.BsjqSb4-.d.ts` and `I` for `index.DpLw24bj.js`, both in its `dist/chunks`.
- Puppeteer's launcher.

The TestCafe, WebdriverIO, Cypress and Selenium clones are sparse and have no runner code, so they aren't covered. Every claim was **read** from source.

## Summary

- **Playwright is process-per-worker.** The browser is worker-scoped and reused across files whose worker options match. Context and page are test-scoped. A worker is discarded after any failure. Its remote server launches a new browser for every connection.
- **Vitest runs files across workers.** Tests within a file run in order unless marked concurrent. With the default `isolate: true`, every file gets a new process, so a per-worker browser is really a per-file browser.
- **Sharing a Layer across files is possible but awkward.** It takes `isolate: false` plus a module-level scope that is never closed. Launching in `globalSetup` and connecting is cleaner.
- **Playwright's launch flags and focus emulation change what pages observe:** timer cadence, visibility and `document.hasFocus()`. Under rule 23 they must be a named, visible default.

## 1. Playwright's model

- **Processes.**
  - Each worker is a forked OS process (`runner/workerHost.ts:47-68`).
  - `workers` defaults to 50% of the CPUs (`common/config.ts:114,243-263`).
  - `parallelIndex` is the worker slot and stays the same across restarts. `workerIndex` increases with every new process (`workerHost.ts:48`, `docs/src/test-parallel-js.md:260`).
- **What is worker-scoped and what is test-scoped.**
  - Worker-scoped: `browser` (`index.ts:238-262`, `timeout: 0`), the launch and connect options, and the video and trace modes.
  - Test-scoped: `_contextFactory`, `context` and `page` (`index.ts:400-459,474-503`).
  - Using `context` or `page` in `beforeAll`/`afterAll` is an error (`408-414`), and a worker fixture can't depend on a test fixture (`common/fixtures.ts:203-204`).
- **Browser reuse.**
  - Each worker gets a hash: the SHA-1 of its worker-fixture ids (`fixtures.ts:240-247`).
  - The dispatcher prefers a free worker with the same hash and otherwise restarts one (`runner/dispatcher.ts:112-118,151-157`). So one browser serves many files as long as the worker options match.
- **Grouping.**
  - By default, a file is one serial group.
  - `fullyParallel` marks file suites as parallel (`runner/loadUtils.ts:266-267`).
  - With `mode: 'parallel'` each test is its own group, except that suites with `beforeAll` hooks are split into chunks (`runner/testGroups.ts:84-131`).
  - In `serial` mode, one failure skips the rest of the suite, and the whole suite is retried (`dispatcher.ts:547-575`).
  - Named `lock`s and an `exclusive` lock work across workers (`common/testType.ts:198-199`, `dispatcher.ts:64-95`).
- **Failure handling.**
  - Any test failure stops the worker. It tears down the test scope, then the worker scope, which closes the browser (`worker/workerMain.ts:480-510`).
  - The dispatcher stops that process and puts the remaining tests back at the front of the queue. They run in a new process with the same `parallelIndex` (`dispatcher.ts:177-190`).
  - When a process exits unexpectedly, the running test is blamed (`dispatcher.ts:534-543,599-604`).
  - Retries that aren't immediate run alone, under the exclusive lock (`dispatcher.ts:581-595`).
- **Reuse context.**
  - It is used only by watch mode with a connected browser, which forces `workers: 1` and headed mode (`runner/watchMode.ts:318-325`).
  - The server keeps one context per options hash. `resetForReuse` closes extra pages, navigates to `about:blank`, and resets storage, viewport and clock (`playwright-core/src/server/browser.ts:130-139`, `browserContext.ts:221-252`).
- **Remote browsers.**
  - `connectOptions` or `PW_TEST_CONNECT_WS_ENDPOINT` connects to a server (`index.ts:242-253,617-626`).
  - By default the server launches **a new browser for each connection** (`remote/playwrightServer.ts:175-181,285-308`).
  - Sharing one browser across connections exists only in the extension's "reuse browsers" mode, one connection at a time (`187-235`).
- **Sharding and merging.**
  - `filterForShard` runs after grouping. It balances shards by test count, with optional weights, and puts each group in the shard that holds its first test (`testGroups.ts:151-195`, `loadUtils.ts:195-203`). With `fullyParallel` that means sharding by single test.
  - The blob reporter writes `report-<shard>.zip` with salted attachment paths (`reporters/blob.ts:121-140`), and `merge-reports` replays the sorted shard zips (`reporters/merge.ts:49-63`).

## 2. Vitest and @effect/vitest

- **Unit of parallelism.**
  - Files run across workers. The pool defaults to `forks` (P:3630) and `fileParallelism` to true (P:3641). `maxWorkers` defaults to the number of CPUs minus one, or half of them in watch mode (I:11849-11855).
  - Within a file, tests run in order unless `describe.concurrent`, `it.concurrent` or `sequence.concurrent` is used (P:3413-3417). `maxConcurrency` defaults to 5 (P:3897-3900).
- **Isolation.** `isolate` defaults to true (P:3605). A worker is reused only for non-isolated files (I:11549-11558), so by default every file gets a new process.
- **Crashes.** "Worker exited unexpectedly" fails the file (I:11005). There is no restart-and-continue, and `retry` re-runs the test in the same process (P:4070).
- **Sharding.** `--shard` splits by file, ordered by the SHA-1 of the path, with no balancing by test count (I:13372-13383). Reports merge with `--merge-reports` (P:4339).
- **Global sharing.** `globalSetup` runs once (P:3736) and passes serializable values to tests through `project.provide` and `inject` (P:1045,4017).
- **@effect/vitest's `layer(L, {concurrent, memoMap, timeout, excludeTestServices})`** (`EV/internal/internal.ts:238-246`):
  - The named form wraps `describe(name, {concurrent})`. It builds the layer in `beforeAll` and closes its scope in `afterAll` (`346-357`).
  - The anonymous form builds on the first test's `beforeEach` and closes after the last test (`309-343`).
  - The build is `Effect.cached`, so concurrent tests share it (`270-274`).
  - Each `it.effect` gets its own `Effect.scoped` scope with the built services provided (`286-292`). That is where a per-test context and page live.
  - A nested `it.layer` forks the memoMap (`297-305`).
  - There is no `it.effect.concurrent` (`EV/index.ts:80-92`). Concurrency comes only from the describe, the layer option or the Vitest config.
  - **Caveat:** `TestClock` and `TestConsole` are built once per layer block (`264-267`), so concurrent tests in one block share a TestClock.
- **Where a Layer can be shared.** Per describe or layer block (the default), per file (one top-level layer with nested `it.layer`), or globally (launch in `globalSetup` and pass the endpoint through `provide`/`inject`).
- **One scope across several files in a worker.**
  - This needs `isolate: false` plus a module-level MemoMap or runtime.
  - Effect v4 MemoMap entries are reference-counted and released when the last scope using them closes (`effect/src/Layer.ts:246-275`). `layer()` closes its scope in `afterAll`, so the next file rebuilds unless a module-level scope that never closes holds on to the entry.
  - Vitest has no worker-teardown hook, so cleanup relies on process exit. That works with a pipe launch, which makes Chrome exit with its parent (`PW/playwright-core/src/server/chromium/chromium.ts:358`). Possible, but not clean.

## 3. Options

| | Startup | Isolation | Crash blast radius | Determinism | Contention | Debuggability |
|---|---|---|---|---|---|---|
| **A** browser per worker (per file under Vitest), context per test | one launch per file | a process per file | one file | best | N browsers; oversubscribed at CPUs−1 (Playwright uses 50%) | easy |
| **B** browser launched in `globalSetup`, workers connect | one launch, cheap connects | contexts only; browser-wide state shared across workers | the whole run | weaker | one browser's UI thread, GPU and network service | one headed browser shows everything, but harder to attribute |
| **C** concurrent fibers sharing one browser | lowest | contexts only | a file or block; a cached dead browser fails every later test | worst: interleaving, a shared TestClock, one Node event loop and one transport (large screenshots stall others) | up to 5 by default | interleaved logs, but spans tagged per fiber |
| **D** sharding across machines | per shard | whatever each shard uses | one shard | n/a | spread across machines | needs merged reports |

- **B in detail.**
  - Each worker should create its contexts with `Target.createBrowserContext({disposeOnDetach: true})` (`PW/playwright-core/src/server/chromium/crBrowser.ts:128-131`), so a dead worker's contexts disappear.
  - Workers see each other's targets. Our model treats them as foreign, observe-only resources (CONCEPTS.md).
  - It works with Chromium today. Playwright's patched WebKit is pipe-only (research/webkit.md), so it would need a multiplexing proxy. Whether Firefox's BiDi accepts several clients is unverified.
- **D in detail.** Sharding belongs to the runner. Our only job is unique artifact names per shard, worker, test and retry, attached to test results so they survive merges.

**Hazards of many pages in one browser (options C and B):**
- **Throttling (H19).** Rendering-based waits need a visible, foreground page.
  - From memory, not verified in source: Chromium gives the first page of each new context its own window, so one context per test keeps pages in front. Headed windows can still be covered by others.
  - Playwright's Chromium flags: `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, `--disable-ipc-flooding-protection` and `--disable-renderer-backgrounding` (`chromiumSwitches.ts:50-51,65,68`). Puppeteer uses the same set (`puppeteer-core/src/node/ChromeLauncher.ts:225-238`).
  - Playwright's Firefox prefs: `dom.min_background_timeout_value*`, budget throttling off, and `layout.testing.top-level-always-active` (`server/bidi/third_party/firefoxPrefs.ts:153-157,204`).
- **Focus (H24).** Only one window can have system focus.
  - Playwright enables `Emulation.setFocusEmulationEnabled` on every main frame by default (`chromium/crPage.ts:552`). It also sets Firefox's `focusmanager.testmode` (`firefoxPrefs.ts:185-186`) and WebKit's `Emulation.setActiveAndFocused` (`webkit/wkPage.ts:125`).
  - Puppeteer makes focus emulation opt-in with `emulateFocusedPage` (`puppeteer-core/src/api/Page.ts:3003`).
- **OS input.** CDP and BiDi input goes to the renderer, not the OS, so per-page input serialization is enough. In headed mode, the OS clipboard, native dialogs and dragging between windows are still shared.
- **GPU and resources.** There is one GPU process, a limit on renderer processes, and `/dev/shm`, which Playwright works around with `--disable-dev-shm-usage` (`chromiumSwitches.ts:58`). From memory, WebGL context limits apply too.

**Under rule 23,** these flags and emulations change what the page sees (timer cadence, `document.hasFocus()`, visibility), so they must be:
- an exported, inspectable value;
- recorded, as the actual arguments and prefs, in the launch span and the trace;
- overridable.

Several of Playwright's flags hide hazards our model handles explicitly, so we don't copy them (`chromiumSwitches.ts:29-31,52,63,66`):
- `--disable-back-forward-cache` (H3, H16);
- disabling `ThirdPartyStoragePartitioning` (H29);
- disabling `PaintHolding`;
- `--disable-popup-blocking`;
- `--allow-pre-commit-input`.

## 4. What contexts isolate, and what they don't

**Isolated per context:**
- cookies, web storage, IndexedDB, Cache Storage and service-worker registrations;
- the HTTP cache;
- the proxy, when set per context (`crBrowser.ts:128-131`);
- permission grants, when the call is scoped to the context (`crBrowser.ts:466-487`);
- whether downloads are allowed (`crBrowser.ts:361-366`);
- per-page emulation.

**Not isolated:**
- **Launch flags, features and prefs.**
- **The downloads directory.** There is one `downloadPath` per browser (`crBrowser.ts:364`). File names are GUIDs, so they don't collide, but each test must clean up its own.
- **Unscoped commands.**
  - CDP `Browser.*` calls without a `browserContextId` act on the default context.
  - BiDi settings sent without `userContexts` or `contexts` are stored globally (`webdriver-bidi/index.bs:510-515`; `setDownloadBehavior` at `3140-3165`).
  - So the library must always pass the context it owns.
- **Browser-level observation.** CDP tracing and target discovery at browser level see every context, so per-test traces must come from page or context sources.
- **Extensions** are profile-wide, and Playwright disables them (`chromiumSwitches.ts:60`). Extension tests can't run one context per test concurrently.
- **Machine resources:** OS focus, clipboard, GPU, CPU, memory and process limits.
- **Backend data.** Playwright's docs call this the biggest real source of interference (`docs/src/test-parallel-js.md:191`).

## Recommendation

- **Default: option A as Vitest maps it.**
  - `BrowserTest.layer(backend)` gives one browser per layer block, which is roughly one per file because the default `isolate: true` recycles workers.
  - Each test gets a fresh context and page in its own scope, and tests within a file run in order.
  - Files run in parallel across Vitest workers. Recommend `maxWorkers: "50%"`, since each worker hosts a browser.
- **Supported explicitly:**
  1. **C:** `layer(BrowserTest.layer(b), { concurrent: true })`. `BrowserTest` passes `excludeTestServices` and provides a `TestClock` per test.
  2. **B:** `BrowserTest.globalSetup(Chromium.launch)` holds the browser in a long-lived scope and `provide`s its endpoint, and `BrowserTest.connected` connects to it. Chromium only, until the Firefox and WebKit probes pass.
  3. **Browser health:** `restart: "onCrash" | "onFailure" | "never"`, defaulting to `onCrash`.
  4. **Launch profiles:** exported values (`LaunchProfile.stock | automation | concurrent`), plus a context option `focus: "emulated" | "system"`. Focus emulation applies only to contexts we own, never to attached pages.
  5. **D:** nothing runner-like. `TestInfo` carries shard, worker, test and retry ids for artifact paths.
- **Not recommended:** sharing one Effect scope across files. Use B instead.
