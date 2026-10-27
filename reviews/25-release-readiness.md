# Design review: release readiness, and the comparison scripts

*2026-10-26. Review of commit `8ea3b9a` (review 24) on what the packages need before a release, and on the scenario work review 22 deferred to (its candidate 8) and review 23 settled the browser of (its candidate 10). Prompted by the maintainer, choosing among the next steps: "Let's do all three, and defer the license": review 22's last step, release readiness and the comparison scripts. The license and its notices wait; publishing waits for the maintainer's go-ahead, as it always has.*

## What there is

- **No CI.** `pnpm all` runs locally: the type check and the generated code's checks, the linters, the standard tests, the type tests, and the API reference's checks (`jsdocs`, `examples`, `index`, `api-reference`). The integration tests need the Nix environment (`flake.nix`), take about 11 minutes a file at a time, and download the pinned browsers into the Nix store on a machine that hasn't them.
- **The packages,** `@usestrider/browser` and `@usestrider/vitest`, each export their sources for the workspace and their `dist` in `publishConfig`. `pnpm build` writes `dist` with `tsc -b`, and nothing checks what a published package would hold, or that a project could import it.
- **`@effect/platform-node` is a required peer of `@usestrider/browser`,** but only the `strider` command imports it at run time (`bin/strider.ts`, `internal/cli/daemon.ts`); the library's own sockets come from the program (`SocketConnector`, review 23).
- **The API reference dataset** is written to `.data/api-reference/` (review 07, its thirteenth candidate): TypeDoc's JSON per module, with the JSDoc's sections in `jsdocs.json`. Nothing renders it.
- **The scenario work** is a line in review 22: Playwright installed in a workspace package of its own, never the library's, to compare against (Q72, since resolved by stock WebKit) and to measure two costs the library accepted, Q82 (an evaluation per animation frame while an expectation waits) and Q103 (Chromium's request interceptor always installed), on real sites. Review 23 settled its browser: stock Chrome, never a Playwright build.

## Candidates

### 1. CI

**Where:** `.github/workflows/` (new).

- **Checks,** on every push and pull request: in the Nix environment's default shell, so CI's Node and pnpm are the pinned ones, `pnpm install --frozen-lockfile`, `pnpm all`, `pnpm build` and the package checks (candidate 2).
- **Integration,** in `devShells.integration`, a file at a time as locally: on demand (`workflow_dispatch`), and on whatever schedule the maintainer chooses (question 1). The browsers come from the Nix binary cache each run, unless a store cache is kept, which needs an action of a third party's.
- **A failing integration run keeps its log and the tests' artifacts** (`TestRun`'s directory), as an Actions artifact.

**The cost.** A private repository's Actions minutes are counted: the checks take a few minutes a push, and an integration run about 20, the browsers' download included.

**Recommendation.** Adopt, with the integration's schedule the maintainer's.

### 2. Package checks

**Where:** `packages/tools/utils` (a command of its own, `strider-utils pack-check`), run by CI and by `pnpm all`.

What a published package must be, checked on the tarball `pnpm pack` writes, in a temporary directory, with nothing of the workspace's:

- every `publishConfig.exports` target, and `bin`, exists in the tarball, a `.d.ts` beside each `.js`;
- the tarball holds what `files` names and nothing else: no tests, fixtures or `.data`;
- a project with only the package and its peers installed imports every subpath under Node, and type-checks an import of each with `moduleResolution: "nodenext"`, as Are the Types Wrong checks, without its dependency;
- `strider --help` runs from the installed package;
- no `dependencies`: only peers.

`@effect/platform-node` becomes an optional peer (`peerDependenciesMeta`), which the `strider` command needs and says so when it's missing.

**Recommendation.** Adopt. Our own check, rather than `publint` and `@arethetypeswrong/cli`, keeps the dependencies at Effect's.

### 3. The API reference site

**Where:** `packages/tools/docs` (`strider-docs site`).

- **Our own static generator** over the dataset: a page per module, its declarations grouped by `@category` with their stability, the JSDoc's sections as headings, examples as code, and links between declarations, from `@see` and `{@link}`; plain HTML and CSS, as `INDEX.md` is generated today. No site framework: Effect's website uses Astro, which would be a large dependency for a page per module.
- **Built by CI** as an artifact on every push, and published where the maintainer chooses (question 2).

**Recommendation.** Adopt.

### 4. The comparison scripts

**Where:** `packages/scenarios` (new, private, never published).

- **Each scenario written twice,** with Strider and with Playwright, against the same stock Chrome: the pinned Chromium in the Nix environment, which Playwright launches by its `executablePath` through `playwright-core`, whose own browsers are never installed (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`). Playwright is that package's dependency alone.
- **The scenarios** are API.md's call sites that both libraries can do: the README's program, a login reused through storage state, a popup with a dialog, a route that blocks analytics, a file upload, a response's body, a HAR recorded and replayed, and waiting for a navigation a click causes.
- **Sites.** The local fixtures, which the integration tests serve; and real sites recorded once as HARs and replayed by each library from then on, so a run sends nothing to anyone (question 3).
- **What's compared and measured:** each scenario's code side by side, its time over repeated runs, and its outcome; Q82, as the page's CPU time while expectations wait on a heavy page, with the per-frame evaluation and without; and Q103, as page loads with Chromium's interceptor installed and without.
- **A report,** `packages/scenarios/RESULTS.md`, written by `pnpm scenarios`, with the browser, the libraries' versions and the machine.
- **What each leaves for a page to see** (question 4): the automation tells bot protection reads (`navigator.webdriver`, a CDP `Runtime.enable` side effect, the user agent, a headless window's sizes), read by a fixture page under each library.

**Recommendation.** Adopt, with the sites and the tells the maintainer's.

## Considered and not adopted

- **`publint` and `@arethetypeswrong/cli`:** what they check is a few file reads and a type check, and they are dependencies.
- **Astro, VitePress or TypeDoc's own HTML theme** for the reference: a framework to keep for a page per module; TypeDoc's theme can't show the JSDoc's sections as Effect's does.
- **Running the scenarios against live sites each time:** results that move with the sites, and traffic to them.
- **The comparison in the integration suite:** it measures, and the suite asserts; it stays a script a person runs.

## Questions for the maintainer

1. **Integration in CI:** on every push to `main` (about 20 minutes each, on the repository's Actions minutes), nightly when `main` has changed, or only on demand?
2. **The reference site:** published where? GitHub Pages needs a paid plan while the repository is private; or kept as a CI artifact until the repository or the package goes public.
3. **Real sites for the scenarios:** which sites may be recorded, once, for replay? Or local fixtures only.
4. **Automation tells:** compare what each library leaves for a page to see, as a fifth part of the report?

## Build

In three steps, each committed and pushed when its checks pass:

1. The package checks, and CI's checks workflow (candidates 1 and 2).
2. The reference site, built by CI (3).
3. The comparison scripts and their report (4).
