# How testing-oriented browser tools model waiting, retries, queries and determinism

Prior art for an Effect-native (effect@4.0.5) CDP/BiDi browser automation library. Scope: Cypress, Testing Library, Selenide, Capybara, WebdriverIO, TestCafe, Taiko, Playwright Test, MSW.

**Sources read (shallow clones in `/tmp/prior-art/`, read-only, nothing executed):**

| Repo | SHA | What was read |
|---|---|---|
| cypress-io/cypress (sparse) | `160cc35b1fb9` | `driver/src/cy/retries.ts`, `cypress/command_queue.ts`, `cypress/cy.ts` (subject chains), `cy/assertions.ts`, `cy/stability.ts`, `cypress/clock.ts`, `cy/commands/querying/get_by_role.ts` |
| testing-library/dom-testing-library | `6049cc0bc7cf` | `wait-for.js`, `query-helpers.ts`, `suggestions.js`, `config.ts` |
| eps1lon/dom-accessibility-api | `a1828981f407` | `accessible-name-and-description.ts` |
| selenide/selenide | `b73e682b5743` | `WebElementCondition.java`, `CheckResult.java`, `impl/SelenideElementProxy.java`, `ex/ElementShould.java`, `SelenideConfig.java` |
| teamcapybara/capybara | `265d2d175f4b` | `node/base.rb#synchronize`, `node/finders.rb#synced_resolve`, `node/matchers.rb`, README |
| webdriverio/webdriverio | `b8053b705df3` | `commands/browser/waitUntil.ts`, `utils/implicitWait.ts`, `middlewares.ts`, `utils/strictSelectorError.ts`, `constants.ts` |
| DevExpress/testcafe (sparse) | `4ae235c8ab63` | `src/assertions/executor.ts` |
| getgauge/taiko | `9f3cba6c1098` | `lib/proximityElementSearch.js`, `lib/doActionAwaitingNavigation.js`, `lib/config.js` |
| microsoft/playwright | `b335271cdc2b` | `server/frames.ts` (expect loop), `server/dom.ts` (actionability), `injected/injectedScript.ts`, `injected/roleUtils.ts`, `playwright/src/common/fixtures.ts`, `worker/fixtureRunner.ts`, `index.ts`, `trace/recorder/*`, `client/{locator,page,network,harRouter}.ts` |
| mswjs/msw | `28c74aad78b3` | `core/experimental/{define-network,handlers-controller}.ts` |
| sinonjs/fake-timers | `466d18e26518` | options surface |
| npm `effect@4.0.5`, `@effect/vitest@4.0.5` | tarballs | `Layer.ts`, `LayerMap.ts`, `RcMap.ts`, `Context.ts`, `Clock.ts`, `testing/TestClock.ts`, vitest `index.ts` + `internal/internal.ts` |

---

## Summary

1. **Every tool that has a good reputation converges on the same core: lazy queries plus one retry loop.** Selectors are descriptions, not handles, and they are re-resolved from the root on each attempt. Examples: Cypress 12 subject chains, Playwright locators, Capybara `automatic_reload`, the Selenide element proxy, WebdriverIO refetch. All retries for one user-visible operation run inside a single loop with a single deadline. Capybara enforces this with a `session.synchronized` flag, so nested calls never retry. Playwright gets the same effect by evaluating the whole locator chain page-side in one round trip. Stale-element and "detached from DOM" errors are what you get when either rule is broken.
2. **Negation must live inside the loop, and every condition needs "what if the element is missing" semantics.** Capybara's README warns that `!has_xpath?` is not the same as `has_no_xpath?`. Selenide has a `missingElementSatisfiesCondition` flag on every condition. Playwright's server special-cases `not.toBeVisible` and `toBeHidden` on zero matches. Three independent designs reached the same conclusion.
3. **Strictness by default has won.** Testing Library `getBy`, Capybara `match: :smart` (raises `Ambiguous`), Playwright locators, and WebdriverIO strict mode (documented in-repo as "the default as of v10") all fail when more than one element matches. Cypress is the holdout: even the `cy.getByRole` added in 16.2.0 yields every match. The best error messages list each match together with a suggested locator that disambiguates it.
4. **The most valuable failure message shows the last observed state, not just "timeout".** Playwright reports `lastIntermediateResult`, and attaches an ARIA snapshot of `<body>` when nothing matched. Testing Library rethrows the last callback error with a pretty-printed DOM. Selenide reports `Actual value` plus a screenshot and page-source link.
5. **TestCafe's "re-executable promise" is the closest analogue to Effect.** An assertion's *actual* side is re-run until it passes, and passing an ordinary awaited promise is a hard error. In Effect, every `Effect<A>` is re-executable by construction. So web-first assertions work for *any* observation, not just locator properties, and the "awaited a snapshot, then asserted" footgun can be pushed into the types.
6. **Playwright fixtures are a dependency-injection plus scope system.** They map well onto `Layer`/`Scope`: typed dependencies instead of `fn.toString()` parsing, and finalizers that receive the `Exit`. The gaps are four Playwright behaviours with no clean Effect equivalent:
   - Only the fixtures a test actually requests get built.
   - Option overrides re-instantiate the fixtures that depend on them.
   - A worker scope can span test files.
   - Test metadata (title, retry, status) is available to every fixture.

   A trap on top of those: `@effect/vitest`'s `it.effect` installs `TestClock` by default, which collides with real-time polling inside a browser library.
7. **Root causes of flakiness:** asynchronous waits dominate. Auto-wait, actionability checks and retrying assertions remove most of them. Whole-test retries and long global timeouts mostly hide them. Evidence is in the flakiness section.
8. **Sentiment.**
   - State of JS 2025 retention: Playwright 94% vs Cypress 57% (down from 93% in 2020).
   - The most-hated designs are homegrown pseudo-async models (Cypress chains, the WebDriverJS promise manager, WebdriverIO Fibers), hidden dependency injection, and runner lock-in.
   - Mocking is the #1 testing pain point (19%).
   - The evidence changes two things: strictness should *wait* for uniqueness rather than crash, and errors must separate "never observed" from "wrong value".

---

## Tool by tool

### Cypress

- **Command queue.** `cy.*` calls *enqueue* commands, and nothing runs until the test function returns. The docs are explicit: "Cypress commands are not Promises and cannot be `await`ed", "You purposefully **cannot** do anything useful with the return value from a command", and the design is deliberate ([intro](https://docs.cypress.io/app/core-concepts/introduction-to-cypress)). In effect, Cypress built a free-monad-style program description on top of JavaScript so it could re-run, log and snapshot each step. Values only reach user code through `.then()`, and you cannot race or `.catch` commands.
- **Queries vs commands (Cypress 12+).** A query returns a synchronous, idempotent `(subject) => subject` function. The subject chain is stored as `[base, q1, q2, …]` and re-evaluated *from the root* on every retry (`cy.ts#getSubjectFromChain`; `command_queue.ts#retryQuery`: "Queries … return an idempotent function. They contain no retry logic"). Actions (`click`) run once, after built-in actionability waits. The docs say "Queries link up, retrying the entire chain together", but "queries that follow the assertion will retry from that locked-in subject", which is where detached-DOM errors remain ([retry-ability](https://docs.cypress.io/app/core-concepts/retry-ability)).
- **Assertions look ahead.** `verifyUpcomingAssertions` gathers the `.should()` calls that follow a query and retries the query together with all of them. There is an implicit existence assertion unless the chain asserts non-existence.
- **Retry loop** (`retries.ts`): 16 ms interval (one frame), bounded by `defaultCommandTimeout` (4 s). Each attempt is gated on `whenStable` (page-transition stability). Cancellation goes through Bluebird. A comment admits that Bluebird cancellation does not propagate fast enough ([bluebird#1424](https://github.com/petkaantonov/bluebird/issues/1424)), so retries can run after the test has changed. That is a direct argument for fiber interruption.
- **Built-in `cy.getByRole`, Cypress 16.2.0** (`cli/CHANGELOG.md`, [#34937](https://github.com/cypress-io/cypress/pull/34937)).
  - **Native-first:** for a role with a native HTML element, only that element matches. `getByRole('button')` finds `<button>` but not `<div role=button>` unless you pass `{ native: false }`.
  - **Non-strict:** "like `cy.get()`, it yields every match".
  - **Self-explaining misses:** the error lists the roles and accessible names on the page (up to 20 roles × 5 names).
- **`cy.clock`** wraps `@sinonjs/fake-timers` in the app window. It re-binds on navigation and deliberately leaves `nextTick` and `queueMicrotask` unfaked.
- **`cy.intercept`** runs in Cypress's Node proxy (`packages/net-stubbing`). Handlers can be aliased and awaited (`cy.wait('@save')`) and limited with `times`. Intercepts reset between tests. `cy.session(id, setup, { validate })` caches cookies and storage.
- **Trade-offs of running in the browser.** Pros: synchronous DOM access, a time-travel command log, and DOM snapshots taken in-process. Cons: one tab, cross-origin flows need `cy.origin`, iframes are awkward, there are no real browser contexts, and app crashes or memory problems become test crashes.

### Testing Library (`@testing-library/dom`) and `dom-accessibility-api`

- **Guiding principle:** "The more your tests resemble the way your software is used, the more confidence they can give you." The query priority is Role, LabelText, PlaceholderText, Text, DisplayValue, AltText, Title, TestId ([priority](https://testing-library.com/docs/queries/about/#priority)). The order is encoded in code: `getSuggestedQuery` walks it (skipping the `generic` role), and `throwSuggestions: true` turns "you could have used a better query" into an error.
- **Variant matrix** (`buildQueries`): {get, query, find} × {single, all}.
  - `getBy` throws on zero matches and on more than one. The multiple-match error prints every match.
  - `queryBy` returns `null` on zero and throws on more than one.
  - `findBy` is `waitFor(getBy)`.
  So it is a cardinality × waiting product, which is a tidy algebra.
- **`waitFor` is a hybrid of events and polling.** It polls on a 50 ms interval *and* on a `MutationObserver` (subtree, childList, attributes, characterData). The default timeout is 1000 ms (`asyncUtilTimeout`). It keeps `lastError` and rethrows it on timeout, so the failure is the last observation, decorated with the DOM. The stack is captured at the call site (`stackTraceError`). Expensive diagnostics are suppressed during polls (`runWithExpensiveErrorDiagnosticsDisabled`). Re-entry is ignored while an async callback is pending. Under Jest fake timers it switches to advancing time by `interval` per loop, and it *errors* if the timer mode changes mid-wait ([#830](https://github.com/testing-library/dom-testing-library/issues/830)).
- **Accessible name.** `dom-accessibility-api` implements W3C accname steps 2A–2F in JavaScript. It relies heavily on `getComputedStyle`, which is the root of the well-known slowness of `ByRole` on large jsdom trees. Playwright has its own implementation (`injected/roleUtils.ts`), wrapped in per-operation caches (`beginAriaCaches`/`endAriaCaches`). **A protocol-native library has two other options:** CDP `Accessibility.queryAXTree({ accessibleName, role })` uses Chromium's real AX tree, and WebDriver BiDi `browsingContext.locateNodes` accepts `{ type: "accessibility", value: { role, name } }` (spec `index.bs` at `f922e6af`).

### Selenide (Java)

- **Call site:** `$("#login").shouldBe(visible).click(); $$(".row").shouldHave(size(3));`. Waits use a 4 s timeout and 200 ms polling (`SelenideConfig`).
- **Mechanism.** `SelenideElement` is a dynamic proxy. `dispatchAndRetry` re-resolves the lazy `WebElementSource` and re-invokes the command until the timeout. It separates **retryable** from **terminal** errors: `TERMINAL_EXCEPTIONS` includes `JavascriptException`, `NoSuchSessionException`, `UnreachableBrowserException` and `IllegalArgumentException`, and invalid selectors also fail immediately. This is the same split Playwright makes with `isNonRetriableError`.
- **Conditions algebra.** `WebElementCondition.check(driver, el)` returns a `CheckResult(verdict, message, actualValue, timestamp)`. Combinators:
  - `negate()` produces `Not`.
  - `and` and `or`; the Javadoc says "Using 'or' checks in tests is probably a flag of bad test design".
  - `because("…")` adds a rationale.
  The `missingElementSatisfiesCondition` flag carries through negation and `or`.
- **Failure message** (`ElementShould`): `Element should have text "x" {#id}` / `Element: '<div …>'` / `Actual value: …` / screenshot and page-source paths / `Timeout: 4 s`.

### Capybara (Ruby)

- **`synchronize(seconds)`** (`node/base.rb`) wraps a block, catches the configured errors, sleeps `default_retry_interval` (0.01 s) and retries until `default_max_wait_time` (2 s).
  - Three details matter:
    1. **`session.synchronized`**: if already inside a synchronize, `return yield`, so only the *outermost* operation retries and timeouts never multiply.
    2. **`reload if automatic_reload`**: nodes remember their query and re-resolve, so `find('#sidebar').find('h1')` survives re-renders.
    3. **`session.raise_server_error!`**: exceptions from the in-process app server are re-raised inside the test.
- **Matching.** `match: :smart` (the default) raises `Capybara::Ambiguous` ("Ambiguous match, found N elements matching …"), with `:prefer_exact`, `:one` and `:first` as alternatives. Assertions take `count/minimum/maximum/between`.
- **Negation gotcha** (README, verbatim): "the following two statements are **not** equivalent … `!page.has_xpath?('a')  # is false` / `page.has_no_xpath?('a')  # is true`". RSpec matchers handle both forms because the matcher knows it is negated (`does_not_match?`).

### WebdriverIO

- `$()` returns a lazy, chainable element (`$('form').$('button=Save').click()`).
  - **Implicit wait middleware:** if the element has no id yet, it calls `waitForExist()` and then `findElementAgain`.
  - **Stale elements** are refetched from the stored selector chain and the command is retried with the new id (`middlewares.ts`).
- **`waitUntil(cond, { timeout = 5000, interval = 100, timeoutMsg })`**. Error: `waitUntil condition timed out after Nms`. The wait aborts if the session is deleted. The stack is spliced so it points at user code.
- **Strict selectors.** `StrictSelectorError`: "strict mode violation: `$(sel)` resolved to N elements, expected 1. Use `$$(sel)` … `$$(sel)[0]` if you explicitly …". The source comments call this the default "as of v10".

### TestCafe

- **Smart Assertion Query Mechanism** (`assertions/executor.ts`). If the `actual` in `t.expect(actual)` is a `ReExecutablePromise` (a selector property such as `Selector('h1').innerText`, or a `ClientFunction` call), the executor loops: `actual = await resultPromise._reExecute()`, assert, then wait `ASSERTION_DELAY = 200` ms, until `assertionTimeout`. If `actual` is a plain thenable, it throws `AssertionUnawaitedPromiseError` unless `allowUnawaitedPromise` is set. This is a runtime guard against `t.expect(await x)` style snapshots.
- TestCafe is proxy-based (URL-rewriting "hammerhead"), with no WebDriver and no CDP for the core.

### Taiko

- **Smart selectors** read like prose: `click(button('Submit'))`, `write('me', into(textBox('Username')))`.
- **Proximity selectors**: `near` (30 px default offset, configurable), `above`, `below`, `toLeftOf`, `toRightOf`, `within` ([docs](https://docs.taiko.dev/api/near/)).
  - Implementation (`proximityElementSearch.js`): drop invisible candidates, compute the positional difference to each anchor, sum the distances, and sort ascending.
  - So ambiguity is resolved *geometrically* (nearest wins), not strictly.
- **Implicit navigation wait** (`doActionAwaitingNavigation.js`):
  - Before the action, it subscribes to `xhrEvent`, `frameEvent` and `frameNavigationEvent`; after the action, it waits for them to settle (`navigationTimeout` 30 s, `retryTimeout` 10 s, `retryInterval` 100 ms).
  - This is the right *subscribe-before-act* shape.
  - The implementation uses module-global mutable state (`let timeouts = []`, a shared event bus), so it is not concurrency-safe.
  - The repo is mostly dependency bumps now (last commit 2026-10-12 was a Dependabot batch).

### Playwright Test

- **Locators.** Immutable descriptions serialized into a selector chain (`internal:has=`, `internal:and=`, `internal:or=`, `has-text`, `nth`), with `filter({ has, hasNot, hasText, hasNotText, visible })` and `describe()`.
  - They resolve in **one page round trip** via the injected script, so each check sees an atomic snapshot.
  - **Strict:** `strict mode violation: <locator> resolved to N elements:` followed by up to 10 entries of the form `1) <preview> aka getByRole('button', { name: 'Save' })` (`injectedScript.ts#strictModeViolationError`).
- **Actionability** (`server/dom.ts#_retryAction`):
  - Backoff is `[0, 20, 100, 100, 500]` ms.
  - It waits for the element to be visible, enabled, **stable** (same bounding box over consecutive rAFs) and non-inert.
  - **Hit-target check:** it installs an interceptor and verifies the event lands on the target; otherwise it logs `<div class="overlay"> intercepts pointer events` and retries.
  - It cycles `scrollIntoView` alignments to escape sticky headers.
  - `force` skips the checks; `trial` runs the checks without acting.
- **Web-first assertions run server-side** (`frames.ts#_expect`):
  1. A one-shot check with no timeout, so `{ timeout: 1 }` still passes if the condition is already true.
  2. Then a backoff of `[20, 50, 100, 100, 500]`, capped for small timeouts.
  - `isNot` is evaluated *inside* the loop: it waits for the negated condition.
  - Zero-match semantics are defined per expression: `not.toBeVisible`, `toBeHidden`, `toBeDetached` and `toHaveCount(0)` pass with zero matches.
  - Single-element matchers are strict; count and array matchers are not.
  - On timeout it reports `lastIntermediateResult.received`; if nothing matched, it attaches `ariaSnapshotForExpectFailure(body)`.
  - `expect.poll(fn)` and `expect(fn).toPass()` retry arbitrary code client-side with intervals `[100, 250, 500, 1000]`.
  - Also available: `expect.soft`, `expect.configure({ timeout, soft })`, and async `expect.extend`.
- **`Progress`.** Every server operation carries a `Progress` object (deadline, abort, call log via `progress.log`, `progress.race`, `progress.wait`). It is Playwright's home-grown structured cancellation, timeout and tracing, which is precisely what fibers, `Effect.timeout` and spans provide.
- **Fixtures** (`common/fixtures.ts`, `worker/fixtureRunner.ts`): `test.extend({ name: [async ({ dep }, use, testInfo) => { …; await use(v); … }, { scope, auto, option, timeout, box, title }] })`.
  - Dependencies come from **parsing `fn.toString()`**. Errors include "First argument must use the object destructuring pattern" and "Rest property … is not supported".
  - The registry checks scope order ("worker fixture … cannot depend on a test fixture") and detects cycles.
  - Overrides form a `super` chain: a fixture can depend on its own parent definition.
  - Worker-fixture registration ids are SHA-1-hashed into a pool key. Tests with different worker fixtures or options run in different workers.
  - Teardown runs in reverse order, and fixtures can have their own timeouts.
  - Built-ins: `browser` is worker-scoped; `context` and `page` are test-scoped; options (`viewport`, `locale`, `storageState`, `trace`) are `option: true`.
- **Retries and flakiness.** Outcomes are passed, **flaky** ("failed on the first run, but passed when retried") or failed. `flaky` counts as `ok()` unless `failOnFlakyTests` is set (v1.52). After a failure, the **worker process is discarded** and a new one starts ([retries](https://playwright.dev/docs/test-retries)). `retryStrategy: 'isolated'` (v1.62) runs retries at the end, one by one in a single worker, which separates load-induced flakes from real ones.
- **Tooling.** `test.step(title, fn, { box, timeout })` nests steps in reports and traces.
  - **The trace recorder** captures `before`, `action` (input) and `after` DOM snapshots per action.
  - The snapshotter serializes the DOM incrementally: unchanged subtrees become `[[snapshotsAgo, nodeIndex]]` references, a `MutationObserver` tracks dirtiness, and form values, scroll offsets, shadow roots and adopted stylesheets are captured.
  - Traces also include screencast frames, network, console and source.
  - UI mode is watch mode plus the trace viewer. Sharding works via `--shard=i/n` plus blob reports and `merge-reports`.
- **Clock** ([docs](https://playwright.dev/docs/clock)):
  - Methods: `install`, `pauseAt`, `fastForward` (due timers fire once, "as in the real browser"), `runFor` (fires every timer in order), `resume`, `setFixedTime` (only `Date` is fixed; timers keep running) and `setSystemTime`.
  - It overrides `Date`, `Temporal.Now`, timers, `requestAnimationFrame`, `requestIdleCallback`, `performance` and `Event.timeStamp`.
  - "`install` … MUST occur before any other clock related calls."
- **Network.**
  - `route` handlers are `unshift`ed, so the last one registered wins.
  - `route.fallback()` passes to the next handler, `continue()` goes to the network, and `fulfill`/`abort` are also available, along with `times`.
  - `routeFromHAR(file, { notFound: 'abort' | 'fallback', update, updateContent, updateMode })` both replays and records.
  - Auth uses **setup projects**: a `setup` project writes a `storageState` JSON file, and dependent projects load it.

### Network mocking more broadly (MSW, compared)

- **MSW handlers.** A handler is a URL pattern plus a resolver, e.g. `http.get('/user', () => HttpResponse.json(...))`.
  - The resolver can return a response, `passthrough()`, or nothing (which falls through).
  - The first match wins, and `server.use()` **prepends** runtime overrides (`handlers-controller.ts#prependHandlersToGroup`).
  - `resetHandlers()` restores the initial set, and `onUnhandledRequest: 'warn' | 'error' | 'bypass' | fn` controls unmatched requests.
  - The same handlers run on Service Worker and Node interceptors.
- **MSW's experimental `defineNetwork({ sources, handlers, onUnhandledFrame })`** makes the architecture explicit. *Network sources* are transports (`interceptor-source.ts`) that emit *frames* (`http-frame`, `websocket-frame`); *handlers* resolve frames independently of the transport.
- **The three models compared:**

  | | Where interception lives | Order | Lifetime | Record/replay |
  |---|---|---|---|---|
  | MSW | in-process interceptors / SW | first match, `use()` prepends | until `resetHandlers` | none built in |
  | `cy.intercept` | Node proxy | reverse definition (`middleware: true` first) | per test | fixtures |
  | Playwright `route` | protocol (CDP Fetch / equivalents) | last registered first, `fallback()` chains | until `unroute`/close | HAR |

---

## Flakiness and root causes

**What the evidence says.** I checked figures against the primary text unless they're marked otherwise.

| Source | Population | Async wait | Other notable |
|---|---|---|---|
| Luo et al., FSE 2014 ([pdf](https://mir.cs.illinois.edu/marinov/publications/LuoETAL14FlakyTestsAnalysis.pdf)) | 161 classified fixes, 51 Apache projects | **45%** | concurrency 20%, order dependence 12%; 24% of fixes touched product code, and 94% of those fixed a real bug |
| Romano et al., ICSE 2021 ([arXiv](https://arxiv.org/abs/2103.02669)) | 235 UI flaky tests (152 web) | **45.1% (52% on web)**: rendering 61, animation 26, resource loading 19 | environment 18.7%, runner-API misuse 17.0% (wrong interaction 24, DOM selector 16), script logic 19.1%; **31% of "fixes" deleted the test** |
| Lam et al., ICSE 2020, Microsoft ([pdf](https://mir.cs.illinois.edu/winglam/publications/2020/LamETAL20FaTB.pdf)) | 134 fixes | **78%** | 31% of async fixes just increased a timeout, and 4 of 5 sampled had no measurable effect; order dependence 0% because CloudBuild fixes the order |
| Lam et al., ISSTA 2019 ([pdf](https://mir.cs.illinois.edu/winglam/publications/2019/LamETAL19RootFinder.pdf)) | 5 MS projects | n/a | 4.6% of tests flaky; 86% flaky only in CI |
| Eck et al., FSE 2019 ([arXiv](https://arxiv.org/abs/1907.01466)) | 200 Mozilla fixes | 22% (86% fixed by adding await/waitFor) | concurrency 26% (34% rooted in product code); too-restrictive range 17%; 85% of timeout fixes only raised the timeout |
| Hashemi et al., ICSME 2022 ([arXiv](https://arxiv.org/abs/2207.01047)) | 452 JavaScript commits | 19.6% | concurrency 20.7%, OS 18.4%, network 12.6% |
| Micco, Google 2016 ([blog](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)) | Google TAP | n/a | ~1.5% of runs flaky; ~16% of tests have some flakiness; **84% of pass→fail transitions involve a flaky test** |
| Listfield, Google 2017 ([blog](https://testing.googleblog.com/2017/04/where-do-our-flaky-tests-come-from.html)) | 4.2M tests | n/a | WebDriver tests: Java 10.45% flaky, Python 18.72% (vs 1.65% overall). Flakiness tracks binary size (r²=0.82) and RAM (0.76); "the tool itself seems to contribute only a small amount" |

**Root causes for browser end-to-end tests, ranked:**

1. **Async wait.** The test is not synchronized with rendering, animation or network. A large share is *waiting on the wrong condition*. Romano's generator-jhipster case waited for "displayed" when it needed "clickable", and a modal overlay intercepted the click.
2. **State isolation and order dependence:** shared accounts, leaked storage, resource load order.
3. **Environment:** CPU and RAM under CI load, viewport and layout, engine differences.
4. **Runner and driver API misuse:** stale handles, a missing `await` (Romano's Gestalt `page.waitFor(200)` with no `await`), brittle selectors.
5. **Network and third parties.**
6. **Over-tight assertions or timeouts.**
7. **Time, randomness, unordered collections.**

**Abstractions that genuinely reduce flakiness:**

- **Waiting on conditions instead of sleeps.** Luo: 23 of 42 `waitFor` fixes removed the flake; 0 of 20 sleep fixes did.
- **Waiting on the *right* condition.** Actionability means visible, stable over two rAFs, receives events (hit-test), and enabled. That is precisely the generator-jhipster failure.
- **Locators that re-resolve** instead of handles. This removes stale-element and detached-DOM errors (Cypress 12, Capybara reload).
- **Retrying only pure work:** queries and assertions, never actions (Cypress docs: actions "could potentially change the state of the application").
- **A fresh context per test, and discarding the worker after a failure** (Playwright).
- **Virtual clock and seeded randomness** (Fowler, "Always wrap the system clock", [2011](https://martinfowler.com/articles/nonDeterminism.html)).
- **Watching for known error states while waiting for success.** Simon Stewart, [2009](https://testing.googleblog.com/2009/06/my-selenium-tests-arent-stable.html): "Don't just poll for your desired end-condition, also think of polling for well-known error conditions".
- **Treating flakiness as a reported outcome:**
  - Playwright `flaky` plus `failOnFlakyTests`; Cypress `detect-flake-but-always-fail`.
  - GitHub's three diagnostic retries: same process, clock shifted, different host. They catch 90% of flaky failures and *classify* the cause ([blog](https://github.blog/engineering/reducing-flaky-builds-by-18x/)).

**Abstractions that hide bugs:**

- **Silent fail-then-pass retries.** Haben et al. (Chromium, arXiv 2023, [link](https://arxiv.org/abs/2302.10594)) found flaky tests "reveal more than 1/3 of all regression faults", and filtering flaky failures missed ~76% of regressions. Slack's first system suppressed *results*, and a real failure "leaked into the main branch" ([blog](https://slack.engineering/handling-flaky-tests-at-scale-auto-detection-suppression/)).
- **Raising timeouts.** See Lam 2020, Eck, and Pei et al. (63% adjusted waits even when the root cause was elsewhere, [arXiv](https://arxiv.org/abs/2305.08592)).
- **`force: true`.** It skips exactly the checks that model a real user.
- **Side effects inside retried blocks**, e.g. `waitFor(() => { click(); expect() })` (Kent C. Dodds, [Common mistakes](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)).
- **Generous auto-wait absorbing real latency regressions.** A 5 s window hides a 4 s stall. *This is an inference; no empirical study measures it.* A cheap counter-measure is to record the wait time per condition and alert on near-misses.

**Design consequence:** the library should make *retries visible* (history, elapsed time against budget, attempt count in spans) and keep its waits *semantic*. It should never offer a bare `sleep` without a lint-like warning in the trace.

---

## What users love and hate (evidence)

**Method.**
- Survey numbers come from the State of JS `page-data.json` files.
- GitHub reaction counts come from the GitHub API on 2026-10-18.
- Hacker News points come from the HN Algolia API.
- Reddit blocks fetching, so Reddit coverage is thin.
- Anything I couldn't confirm is marked [unverified].

### State of JS, testing: retention %

Retention is "would use again" ÷ (would use again + would not use again). [2025 page](https://2025.stateofjs.com/en-US/libraries/testing/); the 2022 figures come from the history embedded in the 2023 data.

| Tool | 2022 | 2023 | 2024 | 2025 | Used (2025) |
|---|---|---|---|---|---|
| Vitest | 96 | 97 | 98 | 97 | 54% |
| Playwright | 94 | 95 | 94 | 94 | 50% (2020: 3%) |
| Testing Library | 95 | 90 | 91 | 89 | 41% |
| MSW | – | 92 | 88 | 87 | 16% |
| Puppeteer | 77 | 72 | 74 | 70 | 42% |
| Jest | 89 | 79 | 73 | 65 | 75% |
| Cypress | 84 | 71 | 64 | **57** (2020: 93) | 47% |
| WebdriverIO | 44 | 35 | 30 | 30 | 10% |
| TestCafe | 43 | 28 | 39 | 29 | 3% |
| Selenium | 42 | 30 | 25 | **24** | 37% |

**Testing pain points, 2025 free-text answers (n=1,405):**

| Pain point | Share |
|---|---|
| **Mocking** | **19.0%** |
| Configuration | 11.0% |
| Performance | 9.7% |
| Browser support | 7.4% |
| Flakiness | 4.7% |

**npm downloads:**
- `playwright-core` passed `cypress` in about Feb 2024; `@playwright/test` passed it in about Sep–Oct 2024 ([Checkly](https://www.checklyhq.com/blog/playwright-surpasses-cypress-for-downloads/)).
- Since late 2025, Playwright's downloads are inflated by agent, MCP and Vitest-browser use (inference).

### Top 10 love

1. **Waiting by default.**
   - Cypress: "when you use should('be.visible') … it'll continuously retry… so much less flakey" ([HN](https://news.ycombinator.com/item?id=25387416)).
   - Playwright: "everything is designed around the need to reduce flaky tests" ([HN](https://news.ycombinator.com/item?id=30105154)).
2. **Plain control flow with values in variables.**
   - "saving a variable in the middle of a test and reusing it was way easier in playwright. Didn't have to do any crazy nesting" ([r/Playwright](https://www.reddit.com/r/Playwright/comments/1vn5bcf/)).
   - "Playwright's API is just promises" ([HN](https://news.ycombinator.com/item?id=30109346)).
3. **Time-travel and trace debugging.**
   - Cypress's command log is a "killer feature" ([HN](https://news.ycombinator.com/item?id=25382005)).
   - Playwright's trace viewer is "fantastic" ([HN](https://news.ycombinator.com/item?id=44967585)).
4. **Role-first locators whose errors list the available roles.** Testing Library's principle ([Dodds](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)); Playwright 1.27's locators were "inspired by Testing Library" ([release](https://github.com/microsoft/playwright/releases/tag/v1.27.0)).
5. **Lazy locators with no stale handles.** Cypress 12 fixed the "detached from DOM" problem, [#7306](https://github.com/cypress-io/cypress/issues/7306) (541 reactions, 315 comments), by re-running whole query chains.
6. **Free parallelism, sharding and isolation.** BigBinary went from 2 h 27 m to 16 m ([blog](https://bigbinary.com/blog/why-we-switched-from-cypress-to-playwright)).
7. **Multi-tab, multi-origin and iframe support.** Its absence is the most-reacted Cypress complaint (see hate 5).
8. **One-liners and REPLs.**
   - Selenide's `$(css).shouldBe(visible)` replaces WebDriverWait boilerplate ([Selenide](https://selenide.org/2019/12/20/advent-calendar-big-wait-theory/)).
   - Taiko's REPL can emit the session as a script with `.code`.
   - Playwright codegen ([HN](https://news.ycombinator.com/item?id=39702386), 74 points).
9. **The same mocks in browser and Node, using standard `Request`/`Response`.** MSW 2.0 ([HN](https://news.ycombinator.com/item?id=37985777), 188 points); "Stop mocking fetch" ([Dodds](https://kentcdodds.com/blog/stop-mocking-fetch)).
10. **Actionable errors:** candidate lists, call logs, suggested locators (quoted below).

### Top 10 hate

1. **Homegrown pseudo-async models.**
   - Cypress [#1417](https://github.com/cypress-io/cypress/issues/1417) "Await-ing Cypress Chains": 492 reactions, 123 comments. The maintainer said "There is no active work being done on supporting this."
   - The WebDriverJS promise manager was removed ([#2969](https://github.com/SeleniumHQ/selenium/issues/2969)) for "increased implementation complexity and reduced debuggability": breakpoints fired when a command was scheduled, not when it ran.
   - WebdriverIO's Fibers-based sync mode was removed in v8 ([blog](https://webdriver.io/blog/2021/07/28/sync-api-deprecation)).
   - Selenium's creator on Cypress: "Time is a flat circle" ([HN](https://news.ycombinator.com/item?id=30109848)).
2. **Stale handles and non-retrying reads.**
   - Selenium's docs: "Do not mix implicit and explicit waits" and "Always relocate the element every time you go to use it" ([waits](https://www.selenium.dev/documentation/webdriver/waits/)).
   - Playwright's docs: `expect(await locator.textContent())` "can lead to a flaky test".
3. **Absence checks that don't wait.**
   - Capybara's `!has_css?` slowed one team's suite by minutes ([Simply Business](https://www.simplybusiness.co.uk/about-us/tech/2015/02/flaky-tests-and-capybara-best-practices/)).
   - Capybara's `all` and `count` don't wait.
   - Testing Library's `queryBy` gets misused for presence checks.
4. **Hidden dependency injection and runner lock-in.**
   - Playwright parses `fn.toString()` and puts scope in the second generic slot (`base.extend<{}, { account }>`).
   - "Expose @playwright/test runner API", [#7275](https://github.com/microsoft/playwright/issues/7275), is open with 75 reactions.
   - jest-playwright is archived.
   - Vitest 4 Browser Mode uses Playwright as a provider but *forks* the locator API ([Vitest 4](https://main.vitest.dev/blog/vitest-4)).
5. **Architectural limits.**
   - Cypress iframes, [#136](https://github.com/cypress-io/cypress/issues/136): **1,045 reactions**.
   - Cypress superdomains, [#944](https://github.com/cypress-io/cypress/issues/944): 426.
   - Cypress Tab key, #299: 1,700 reactions, fixed after about 8.5 years.
   - Playwright real mobile devices, [#1122](https://github.com/microsoft/playwright/issues/1122): 664.
   - Playwright's WebKit is not Safari.
6. **Monetization lock-in.**
   - Cypress parallelism requires `--record`, which goes through Cypress Cloud.
   - Cypress blocked Sorry-Cypress and Currents ([HN](https://news.ycombinator.com/item?id=37842778), 78 points, 54 comments).
   - After switching to Playwright, BigBinary's reporting cost went from $405 to $90 a month.
7. **Performance.**
   - Testing Library ByRole, [#820](https://github.com/testing-library/dom-testing-library/issues/820): 104 comments; one repro measured 17,729 ms vs 840 ms with `getByLabelText`.
   - Cypress startup is about 7 s.
   - Cypress renderer out-of-memory crashes ([#34226](https://github.com/cypress-io/cypress/issues/34226)).
8. **Confusing names and timeout rules.**
   - Testing Library's get/query/find; even the ESLint rules meant to police them contradicted each other (eslint-plugin #801).
   - Playwright's `toPass` "has timeout 0 and does not respect custom expect timeout" ([#23937](https://github.com/microsoft/playwright/issues/23937)).
   - In Playwright strict mode, a leftover toast with the same label "will immediately crash" the test ([#36045](https://github.com/microsoft/playwright/issues/36045)).
9. **Environment and config pain.**
   - MSW v2 under JSDOM needs `jest-fixed-jsdom`, whose README says it was "never meant as a solution to anything".
   - MSW `worker.start()` can resolve before the service worker is ready ([msw#73](https://github.com/mswjs/msw/issues/73)).
   - React `act()` warnings.
   - Mocking and configuration are the top pain points in the survey (see the table above).
10. **Noisy or misleading errors, and driver churn.**
    - Testing Library dumps up to 7,000 characters of DOM (`DEBUG_PRINT_LIMIT`).
    - Playwright reported `Received: undefined` when the page had actually hung ([#42880](https://github.com/microsoft/playwright/issues/42880)).
    - Capybara breaks on Chrome updates (#2793, #2800).

### Error messages, quoted

```
locator.click: Error: strict mode violation: "//button[text()='30']" resolved to 2 elements:   # PW #10611 (good)
    1) <button … aria-label="Nov 30, 2…>…</button> aka playwright.$("text=30")
    2) <button tabindex="-1" … aka playwright.$(":nth-match(:text("30"), 2)")

Error: expect(locator).toBeVisible() failed                      # PW #42880 (misleading: page was hung)
Locator: getByRole('link', { name: 'Get started' })
Expected: visible
Received: undefined

First argument must use the object destructuring pattern: <param>        # PW fixtures, load time
CypressError: cy.click() failed because this element is detached from the DOM.   # pre-12; now "...because the page updated"
Cypress detected that you returned a promise from a command while also invoking one or more cy commands in that promise.
Unable to find an accessible element with the role "button" and name "Submit"   # Testing Library (good)
Here are the accessible roles: …
Ambiguous match, found 2 elements matching visible button "Save"              # Capybara, finders.rb
strict mode violation: `$(sel)` resolved to 3 elements, expected 1. Use `$$(sel)` …   # WebdriverIO
Element should have text "Done" {#status} / Element: '<div id="status">Pending</div>' / Actual value: text="Pending"  # Selenide
```

### What the evidence changes

1. **Strictness should *wait for uniqueness*, not crash instantly.** Transient duplicates, such as a toast fading out (#36045) or old and new list items during a re-render, are a timing problem, not a selector bug. A `StrictModeViolation` stays *retryable until the deadline* and is reported with candidates only at timeout. This revises the algebra section.
2. **Errors must distinguish "never observed" from "observed a wrong value".** When no evaluation completed (page hung, renderer busy), raise a typed `PageUnresponsive` or `NoObservation` instead of `Received: undefined`.
3. **Relative locators in `has` should be a distinct type.** Playwright's `filter({ has })` matches the inner locator from the outer one, so a page-rooted inner locator silently never matches. Model `has` as `(scope) => Locator` or a `RelativeLocator` type so a rooted locator is a type error.
4. **Don't build a command queue.** `Effect.gen` gives linear control flow, values in variables, and breakpoints that fire at execution time. Those are exactly the things users missed in Cypress, the WebDriverJS promise manager and WebdriverIO Fibers.
5. **Stay runner-agnostic.** Ship the library, a thin `@effect/vitest` helper, and possibly a Vitest Browser Mode provider. Do not ship a runner (#7275, jest-playwright archived).
6. **Mocking is the #1 pain point.** The network Layer (MSW-style handlers over the CDP `Fetch` domain, with registration acknowledged before navigation and no service-worker race) deserves first-class priority alongside locators.
7. **Cancellation is now table stakes.** Playwright 1.62 added `AbortSignal` to actions and assertions ([release](https://github.com/microsoft/playwright/releases/tag/v1.62.0)), years after Effect-style interruption would have made it free.

---

## Ergonomics: what to steal, what to avoid

### Call sites at their best (steal) and worst (avoid)

**Cypress.** At its best, the subject flows and assertions retry:

```js
cy.contains('li', 'Product 2').find('button').click()
cy.get('[data-cy=cart-count]').should('have.text', '1')
```

At its worst, values only exist inside `.then`, aliases are stringly typed, and return values are misleading:

```js
cy.get('#total').invoke('text').then(total => {
  cy.get('#tax').invoke('text').then(tax => { expect(+total).to.eq(+tax * 10) })  // pyramid
})
cy.intercept('POST', '/api/save').as('save'); cy.wait('@save')                   // '@' strings, no types
const t = cy.get('h1').invoke('text')   // a Chainable, not a string; silently wrong
```

**Playwright.** At its best, locators compose and assertions are web-first:

```ts
await page.getByRole('listitem').filter({ hasText: 'Product 2' })
  .getByRole('button', { name: 'Add to cart' }).click();
await expect(page.getByRole('status')).toHaveText('1 item');
```

At its worst:

```ts
expect(await page.getByRole('status').textContent()).toBe('1 item'); // snapshot: no retry, racy
expect(page.getByRole('status')).toHaveText('1 item');               // missing await: floating promise
const [res] = await Promise.all([page.waitForResponse('**/api'), btn.click()]); // subscribe-before-act by hand
await page.waitForTimeout(1000);
export const test = base.extend<{ todo: TodoPage }, { account: Account }>({     // two generic slots,
  account: [async ({ browser }, use, workerInfo) => { /*…*/ }, { scope: 'worker' }], // tuple + options,
});                                                                              // CPS `use`, magic destructuring
```

**Testing Library.** At its best, the query name states cardinality and waiting:

```ts
await screen.findByRole('alert');
expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
```

At its worst:

```ts
await waitFor(() => { fireEvent.click(btn); expect(spy).toHaveBeenCalled() }); // side effect retried N times
await waitFor(() => {});                                                       // waits one tick, by luck
```

**Selenide.** At its best, one line expresses the wait, the assertion and the actual value in the error:

```java
$(byText("Login")).shouldBe(visible).click();
$$(".row").shouldHave(size(3));
```

At its worst, a getter is a snapshot that lives next to the waiting `should*` calls:

```java
assertEquals("Done", $("#status").getText());
```

**Capybara.** At its best: `expect(page).to have_content('Saved')`. At its worst: `expect(page.has_css?('.spinner')).to be false`, which needs `has_no_css?` (see the README quote above).

**TestCafe.** At its best: `await t.expect(Selector('#out').innerText).eql('Done')`, which re-executes. At its worst: `await t.expect(await Selector('#out').innerText).eql('Done')`, a snapshot. TestCafe refuses *unawaited* promises, but an *awaited* value slips through.

**WebdriverIO.** At its best: `await $('button=Save').click()`, with an implicit wait and refetch. At its worst, a hand-rolled poll inside `waitUntil`, with a custom message as the only diagnostics:

```js
await browser.waitUntil(async () => (await $('#x').getText()) === 'y', { timeoutMsg: '…' })
```

### Friction catalog

| Friction | Seen in | Effect-native remedy |
|---|---|---|
| Snapshot vs retrying read look identical | PW `textContent()` vs `toHaveText`; Selenide `getText` vs `shouldHave`; TestCafe `await` | `Expect.*` accepts only `Locator`/`Effect`; snapshot getters are named `read*`; `Expect.now(value)` is the explicit one-shot |
| Missing `await` silently passes | Playwright, WebdriverIO, TestCafe (Romano's Gestalt case) | An un-yielded Effect does nothing; the Effect language service flags floating Effects |
| Negation outside the wait | Capybara `!has_css?`, `expect(await isVisible()).toBe(false)` | Only `Cond.not` exists, inside `Expect` |
| Ambiguous match silently picks one | `cy.get`, `.first()` habit, Taiko nearest-wins | `Locator<"one">`; `StrictModeViolation` lists candidates *with suggested locators* (PW "aka …") |
| Nested and multiplied timeouts | Ad-hoc `waitUntil` around methods that already wait | One deadline per operation (`Context.Reference<Deadline>`); nested ops are one-shot |
| Subscribe-after-act race | `waitForResponse` after `click` | `page.waitForResponse(p, { during: click })` built on a scoped `PubSub.subscribe` |
| Magic DI | PW `fn.toString()` destructuring; Vitest fixtures (`FixtureParseError`) | `yield* Page`, with requirements tracked in `R` |
| Stringly-typed aliases | `cy.wait('@save')`, `cy.get('@user')` | Plain variables: `const save = yield* page.waitForRequest(…)` |
| Huge or unhelpful errors | TL dumps the whole DOM; WDIO `timeoutMsg` only | Last observation, distinct-value history, scoped ARIA snapshot, suggested locator |
| Confusing near-synonyms | `expect.poll` vs `toPass`; `fastForward` vs `runFor`; `route.continue` vs `fallback`; get/query/find | Fewer verbs: `Expect.that(observable, cond)` covers both polling forms; clock ops named by effect on timers |
| Hard-to-discover features | trace/UI mode flags, `locator.describe`, `throwSuggestions` | Tracing on by default via spans; suggestions always present in errors |

### How internals make the nice surface possible

- **Lazy descriptions plus one-trip page-side resolution** (Playwright's selector chain, Cypress subject chains) are what let `getByRole(...).filter(...).click()` read like a sentence and still be re-evaluated atomically on each retry.
- **A server-side loop with per-matcher semantics** (Playwright `_expect`: one-shot, backoff, `isNot`, missing-element rules) is what makes `expect(loc).not.toBeVisible()` correct without users thinking about it.
- **A selector *generator*** (Playwright `generateSelectorSimple`, Testing Library `getSuggestedQuery`) is what turns errors into fix-it hints.
- **A call log threaded through a context object** (Playwright `Progress.log`, Selenide `CheckResult` timestamps) is what fills error messages and traces.
- **A re-executable "actual"** (TestCafe `ReExecutablePromise`) is what lets an assertion re-run its input without the user writing a lambda.

Effect has the last four as primitives: fiber context, spans and logs, `Effect` laziness, and typed errors. The library only has to build the first (the locator engine) and the generator.

### Target call sites

This is what we should aim for:

```ts
it.effect("adds to cart", () => Effect.gen(function* () {
  const page = yield* Page
  yield* page.route("**/api/cart", () => Route.json({ items: 1 }))            // scoped: gone after the test
  yield* page.goto("/shop")
  const add = page.getByRole("listitem").filter({ hasText: "Product 2" })
    .getByRole("button", { name: "Add to cart" })
  const res = yield* page.waitForResponse("**/api/cart", { during: add.click() })
  yield* page.getByRole("status").pipe(Expect.toHaveText("1 item"))           // retries; typed ConditionTimeout
  const total = yield* page.getByTestId("total").readText()                   // explicit snapshot
}).pipe(Effect.provide(BrowserTest.page)))
```

---

## A proposed condition and assertion algebra (sketch)

The algebra unifies Selenide `Condition`, Playwright `expect` matchers and Cypress `should` chains. There are three layers: **Observable** (what to look at), **Condition** (a predicate with missing-element semantics and a description) and **Expectation** (a retry policy plus a deadline plus error reporting).

```ts
import { Context, Data, Effect, Schedule, Stream, Duration, Schema } from "effect"

// 1. What we observe. Page-side observables are *data* (serializable) so a
//    whole conjunction can be evaluated atomically in ONE round trip
//    (Playwright's `expression: 'to.have.text'` strings are this idea).
type Observable<A> =
  | { _tag: "Text"; locator: Locator; mode: "inner" | "content" }
  | { _tag: "Attribute"; locator: Locator; name: string }
  | { _tag: "State"; locator: Locator; state: "visible" | "enabled" | "checked" | "editable" | "focused" | "inViewport" }
  | { _tag: "Count"; locator: Locator }
  | { _tag: "AriaSnapshot"; locator: Locator }
  | { _tag: "Url" } | { _tag: "Title" }
  | { _tag: "Probe"; run: Effect.Effect<A, unknown> } // escape hatch = expect.poll / toPass

// 2. A single observation, kept for error reports and traces.
interface Observation<A> { readonly value: A | Missing; readonly matched: number; readonly at: number; readonly preview?: string }

// 3. A condition: predicate + description + missing semantics (Selenide's flag).
interface Condition<A> {
  readonly describe: string                  // "have text \"Saved\""
  readonly test: (a: A) => boolean | { pass: boolean; diff?: string }
  readonly onMissing: "pass" | "fail"        // e.g. hidden/detached/count(0) pass when missing
}
declare const Cond: {
  text: (m: string | RegExp, o?: { exact?: boolean }) => Condition<string>
  visible: Condition<boolean>; hidden: Condition<boolean>; count: (n: number) => Condition<number>
  not: <A>(c: Condition<A>) => Condition<A>             // flips test AND onMissing
  and: <A>(...cs: Condition<A>[]) => Condition<A>       // same observation, all must pass
  or:  <A>(...cs: Condition<A>[]) => Condition<A>       // legal, discouraged (Selenide)
  because: (why: string) => <A>(c: Condition<A>) => Condition<A>
}

// 4. Expectation = observable × condition × policy. Typed failure carries history.
class ConditionTimeout extends Schema.TaggedError<ConditionTimeout>()("ConditionTimeout", {
  subject: Schema.String, condition: Schema.String, elapsedMs: Schema.Number, attempts: Schema.Number,
  last: Schema.Unknown,          // last Observation
  history: Schema.Array(Schema.Unknown), // de-duplicated transitions: "Loading… (0–1.2s) → Error (1.2–5s)"
  ariaSnapshot: Schema.optional(Schema.String),
}) {}

declare const Expect: {
  that: <A>(o: Observable<A>, c: Condition<A>, opts?: {
    timeout?: Duration.Input                    // default from Context.Reference<ExpectConfig>
    schedule?: Schedule.Schedule<unknown>       // default: one-shot, then 20,50,100,100,500ms...
    retrigger?: "poll" | "events" | "both"      // events = DOM mutation/network idle stream
    soft?: boolean
  }) => Effect.Effect<void, ConditionTimeout | StrictModeViolation | TargetClosed, Page>
}
```

**Semantics. Each rule comes from prior art.**

- **Negation:** `Expect.that(o, Cond.not(c))` waits *for* the negated condition (Capybara `has_no_*`, Playwright `isNot` inside the loop). `not` also flips `onMissing`, so `not(visible)` passes with zero matches (Selenide, and Playwright's `to.be.hidden` special case). There is deliberately no `Effect.flip` over a finished expectation.
- **Conjunction** is evaluated against *one* observation. For page-side observables, `and` over the same locator compiles into one injected evaluation, so there is no time-of-check/time-of-use gap. `Cond.and` over *different* observables becomes `Expect.all([...])`, which retries until every one passes inside the same deadline. It does not run sequential expects.
- **Cardinality is part of the observable.** Single-element observables are strict. Ambiguity is *retried until the deadline*, because transient duplicates such as a fading toast or a re-render are common ([#36045](https://github.com/microsoft/playwright/issues/36045)). Only at timeout does it surface as `StrictModeViolation` with the candidates. Playwright, by contrast, fails immediately. `Count` and array observables are not strict.
- **Timeouts:** one deadline per user-visible operation, carried in a `Context.Reference<Deadline>`. Nested library calls read the remaining budget. A `Context.Reference<InRetry>` makes nested operations one-shot (Capybara `synchronized`), so retries never multiply.
- **Re-evaluation:** start with a one-shot evaluation (Playwright). After that, re-evaluate on `Stream.merge(Stream.fromSchedule(schedule), domInvalidations)`. Invalidations come from an injected `MutationObserver` reported through `Runtime.addBinding`, or from CDP DOM events. Polling remains as a fallback because some changes are invisible to mutation observers: layout, `:hover` CSS, canvas, computed visibility. This is Testing Library's hybrid design, moved to the protocol level.
- **Error classification:** use a typed union of `Retryable` errors (not found, not visible, covered, stale) and terminal ones (invalid selector, JS exception in evaluate, target closed). This is Selenide's `TERMINAL_EXCEPTIONS` and Playwright's `isNonRetriableError`, written as `Effect.retry({ while: isRetryable })`.
- **Failure message:** include the locator, the condition, the elapsed time and attempt count, the *last* observation, and the *de-duplicated history of distinct observations with timestamps*. The history is novel; it answers "was it ever right?". When nothing matched, attach an ARIA snapshot of the nearest existing ancestor and suggested locators. When *no evaluation completed* (page hung, renderer busy), fail with a distinct `NoObservation`/`PageUnresponsive`, never `Received: undefined` (PW [#42880](https://github.com/microsoft/playwright/issues/42880)).
- **Soft assertions:** `soft: true` appends the failure to a scoped `Ref` collector. A finalizer fails the test with every failure combined. Effect v4's flat `Cause` holds multiple failures natively.
- **Actions reuse the same machinery.** `click` = `Expect.all([visible, enabled, stable, receivesEvents])` + act + optional post-condition. Actionability is the same algebra, so errors read the same way: "click: waiting for `getByRole('button', {name:'Save'})` to be visible, enabled, stable and receive events; last: covered by `<div class=modal-backdrop>`".

---

## Fixtures → `Layer` mapping

| Playwright fixture concept | Effect v4 / `@effect/vitest` equivalent | Notes |
|---|---|---|
| Test fixture `async ({ dep }, use) => { setup; await use(v); teardown }` | `Layer.effect(Tag, Effect.acquireRelease(setup, teardown))`, provided per test with `Effect.provide(layer)` (a fresh build per provide) | `use()` in continuation-passing style is exactly bracket. In v4, `Layer.effect` handles `Scope` itself, and `it.effect` wraps the test in `Effect.scoped`. |
| Worker fixture (one `browser` per worker) | `layer(BrowserLive)("suite", it => …)`. It builds once in `beforeAll` with a `MemoMap` and closes in `afterAll` (`internal.ts`: `Layer.buildWithMemoMap`, `Effect.cached`, `V.afterAll(closeScope)`). | It is per *describe/file*, not per worker. Sharing across files needs Vitest `globalSetup` plus `provide`/`inject` of a serializable `wsEndpoint`, and each file then connects (cheap over CDP). |
| Dependencies from destructuring (`fn.toString()`) | `yield* Page`, with `R` inferred | Missing fixtures become compile errors instead of load-time parse errors. |
| Scope-order rule (a worker fixture can't use a test fixture) | Automatic: the suite layer can't require services that only exist per test, because `layer()` needs `Layer<R, E, never>` | |
| Cycle detection | Not possible: a layer graph is acyclic by construction | |
| `auto: true` | `Layer.effectDiscard(…)` merged into the suite or test layer | Example: a console-error collector that fails the test. |
| `option: true` plus `test.use({ locale })` | `Context.Reference<BrowserOptions>` with a default, overridden by `Layer.succeed`/`Effect.provideService` | **Gap:** Playwright re-instantiates dependents (registration id → hash → new worker). An Effect layer is memoized by identity, not by input value. |
| Override via `super` | `Layer.effect(Page, Page.use((p) => Effect.succeed(decorate(p)))).pipe(Layer.provide(BasePage))` | A layer may require and provide the same key. |
| Teardown that knows the outcome (`testInfo.status`) | A finalizer receives the `Exit`: `acquireRelease(acq, (r, exit) => Exit.isFailure(exit) ? saveTrace(r) : discard(r))` | Better than Playwright: retain-on-failure needs no `testInfo`. |
| Fixture `timeout` | `it.layer(L, { timeout })`, or `Effect.timeout` around `Layer.build` | |
| `box` and `title` | `Layer.withSpan("fixture: page")` | Fixtures show up in traces for free. |
| `testInfo` (title, retry, outputDir, attachments) | *Missing.* Needs a `TestInfo` service populated from the Vitest task context. | |
| Worker discarded after a failure | `RcMap.invalidate` or a rebuilt `LayerMap` entry on test failure | Has to be wired up by hand. |
| Projects (browser × config matrix) | Vitest `projects`, plus `provide` or `describe.each` over layers | |
| `storageState` setup project | A `Cache` keyed by user, persisted to disk, with a `validate` step (Cypress `cy.session`) | |

**What Effect can't currently express nicely:**

1. **Request-driven laziness.** Playwright builds only the fixtures a test transitively names. `layer(L)` builds every output of `L`, even though `R` already records statically what each test needs. The workaround is to compose small per-test layers, or to expose services whose value is an `Effect.cached` acquired on first use, both of which cost ergonomics.
2. **Value-sensitive memoization.** "Same layer, different `viewport`" should yield a different `Page`, while unrelated layers stay shared. `LayerMap` (keyed by options) gets close but has to be designed in.
3. **Cross-file worker scope and "poison on failure"** are runner concerns, which Vitest owns.
4. **The `TestClock` default.** `it.effect` provides `TestClock.layer()`, and `Clock.Clock` is a `Context.Reference`. If library waits use `Effect.sleep` or `Effect.timeout`, a browser wait under `it.effect` never times out unless the test advances the clock. The library must schedule its own deadlines on a dedicated live clock reference, or tell users to use `it.live`. The clock also affects tracing: span start/end times and log-derived span events read the fiber's `ClockRef` (`internal/effect.ts`, `tracerLogger`). Traces recorded under `it.effect` therefore carry `TestClock` timestamps that cannot be aligned with CDP event times, so the tracer needs a wall-clock source too.
5. **Flakiness classification.** `@effect/vitest`'s `flakyTest` is `Effect.retry(Schedule.recurs(10) while elapsed ≤ 30s)` inside the test. It *hides* flakes with no "flaky" outcome to report. Playwright's passed/flaky/failed classification lives in the runner.

---

## Lessons and candidate abstractions for an Effect-native design

Each item maps to Effect primitives.

1. **`Locator` is data.** It should be an immutable, `Equal`/`Hash`-able, `Pipeable`, `Inspectable` description: `role("button", { name: "Save" })`, `.filter({ has, hasNot, hasText })`, `.and`, `.or`, `.nth`, `.describe("save button")`. Resolution is an `Effect` evaluated page-side in one round trip. Use `Data.TaggedClass` for the AST, with a printer that emits a pasteable locator for errors. The locator inside `has` should be a distinct *relative* type, `(scope) => Locator`, so that a page-rooted inner locator, which Playwright silently never matches, becomes a type error.
2. **Strictness in the type.** `Locator<"one">` vs `Locator<"many">`. Actions and single-value observables accept only `"one"`. `.all()`, `.count()` and `.nth(i)` cross over explicitly. Ambiguity is retried until the deadline, then reported as `StrictModeViolation` with candidate previews and suggested locators. Scoping helpers (`within(region)`) are the intended fix, not `.first()`.
3. **Role-first engine with a protocol fast path.** Default to an injected accname/role implementation (works cross-browser and identically on CDP and BiDi). Behind a capability flag, offer `Accessibility.queryAXTree` (CDP) or `locateNodes({ type: "accessibility" })` (BiDi) for fidelity checks. Keep Testing Library's priority as *linting* (`getSuggestedQuery`): when a test uses CSS or a test id, the trace suggests a role query.
4. **Conditions, `Expect` and actionability** as sketched above:
   - Polling uses `Effect.retry` and `Schedule`; event-driven re-checks merge in a DOM-invalidation `Stream`.
   - Defaults come from a `Context.Reference`, and failures are a typed `ConditionTimeout` carrying history.
   - Actionability is just conditions. A covering element is reported as `NotActionable({ reason: "covered", by })`.
5. **One retry loop per call, and real interruption.**
   - `Context.Reference<RetryScope>` plays the role of Capybara's `synchronized`, and `Context.Reference<Deadline>` replaces Playwright's `Progress`.
   - Page close and frame detach are `Deferred`s that every waiter races, like Playwright's `LongStandingScope.raceMultiple`.
   - Interruption replaces Bluebird and `AbortController` cancellation.
6. **Subscribe-before-act.** `page.waitFor(event, { during: action })` is implemented as `PubSub.subscribe` (scoped), then `action`, then `Queue.take` with a deadline. It replaces `Promise.all([waitForResponse, click])` and keeps Taiko's semantics without the global state. Events are exposed as `Stream`s: `page.network.requests`, `page.console` and `page.dialogs`.
7. **Two clocks, never confused.**
   - (a) `AutomationClock` is a `Context.Reference` that defaults to the live clock. It drives library timeouts and polling, so `TestClock` cannot freeze it.
   - (b) `PageClock` is browser-side fake time. Install it through an init script (`Page.addScriptToEvaluateOnNewDocument`) *before navigation*, mirroring Playwright and `cy.clock` semantics (`install`, `pauseAt`, `runFor`, `fastForward`, `setFixedTime`). CDP `Emulation.setVirtualTimePolicy` (`pause`, `advance`, `pauseIfNetworkFetchesPending`, `budget`) is a protocol-native alternative on Chromium.
   - (c) An opt-in `Clocks.linked` helper: `advance(d)` = `TestClock.adjust(d)` + `PageClock.runFor(d)`, for deterministic full-stack time.
8. **Network as handlers plus a transport, MSW-style.** A route is `(req: InterceptedRequest) => Effect<Fulfill | Continue(overrides) | Abort | Fallback, E, R>`.
   - **Registration is scoped:** `acquireRelease(route, unroute)`, with no leaks between tests.
   - **Layers:** `Network.mock(handlers)`, `Network.replayHar(path, { notFound: "fallback" | "fail" })` and `Network.recordHar(path)`.
   - **Unmatched requests:** `onUnhandled: "fail"` produces a typed `UnhandledRequest` failure surfaced in the test.
   - **Shared handlers:** one handler set can back both the browser (CDP `Fetch` domain) and Node-side `HttpClient` test layers. That is MSW's sources/handlers split with Effect services.
9. **Fixtures as Layers.**
    - Ship `BrowserTest.layer` (suite-scoped browser), `BrowserTest.page` (test-scoped context and page, applied by `it.effect` wrappers) and a `TestInfo` service.
    - Artifacts come from `Exit`-aware finalizers.
    - Auth uses `Cache`, keyed by persona, holding `storageState`.
    - The browser `Layer` should accept a `wsEndpoint` from Vitest `inject()` so one browser is shared across files.
10. **Tracing is OpenTelemetry-native.**
    - Every public operation is `Effect.fn("Locator.click")`, which gives a span with the call site.
    - Retry attempts and actionability log lines become span events (Playwright's call log).
    - DOM snapshots (incremental, Playwright-style, or CDP `DOMSnapshot.captureSnapshot`), screenshots and screencast frames go into a content-addressed artifact store, referenced from span attributes (`browser.snapshot.before = sha256:…`). Blobs stay out of OTLP.
    - Network events become child spans with HTTP semantic-convention attributes.
    - **Inject `traceparent` into the app's requests** through the `Fetch` interception, so a test step, the click, the XHR, the backend and the database form one distributed trace. Neither Playwright nor Cypress does this.
    - A viewer, or Jaeger/Tempo/Honeycomb, shows the step tree, and a small UI renders snapshots for a selected span. `test.step` becomes `Effect.withSpan`.
11. **Make the assertion surface hard to misuse.** See the friction catalog: `Expect` takes only `Locator`s or `Effect`s, snapshot getters are named `read*`, and floating Effects are inert.
12. **Flakiness as a first-class outcome.**
    - Report test retries as span attributes (`test.retry`, `test.outcome = flaky`).
    - Keep `flakyTest`-style in-test retry out of the public story.
    - Expose the `history` of every wait, so "passed after 3.8 s of a 4 s budget" is visible as a near-miss before it becomes a flake.

---

## Open questions

1. **Page-side vs protocol-side evaluation.** Should conditions compile to injected JavaScript (cross-browser, atomic, Playwright-proven) or to CDP DOM, AX and DOMSnapshot calls (no injected code, but more round trips and Chromium-only)? Probably injected by default, with protocol-native fast paths.
2. **Event-driven re-evaluation cost.** A `MutationObserver` firing hundreds of times per second during animations needs debouncing (one rAF?). Is polling plus a one-shot check good enough, as in Playwright, and the observer only an optimization?
3. **Lazy fixtures.** Can we offer request-driven fixture instantiation without giving up `Layer`? One option: a `TestLayer` builder that inspects `R` through a phantom registry. Another: services backed by `Effect.cached` acquisition inside the test scope.
4. **`TestClock` interplay.** Default the library to a live clock and require explicit opt-in to link `TestClock` with `PageClock`, or detect `TestClock` and warn?
5. **Strict `Locator<"one">` typing vs ergonomics.** Does the cardinality type parameter leak into user signatures too much? Should it be a phantom brand that inference hides?
6. **Snapshot format.** Adopt Playwright's incremental snapshot format, which is mature but whose viewer is coupled to Playwright, or define an OTel-linked artifact schema and build a minimal viewer?
7. **How much of a runner to own.** `@effect/vitest` already supplies the scope, layers and TestClock. Retries, flakiness classification, sharding, `TestInfo` and worker reuse are runner features. Do we ship a Vitest plugin or reporter, or stay a library? The evidence (runner lock-in [#7275](https://github.com/microsoft/playwright/issues/7275); jest-playwright archived) favours a library plus a thin `@effect/vitest` helper. Implementing a **Vitest Browser Mode provider** on top of our CDP core is worth evaluating.
8. **Default timeouts.** Playwright uses 5 s for expect and none for actions (bounded by the test timeout). Cypress, Selenide and Capybara use 4 s, 4 s and 2 s. Should actions and expectations share one budget per test step?
