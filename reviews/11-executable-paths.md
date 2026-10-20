# Design review — a launch takes an executable path, and a command finds them

*2026-10-20. Review of commit `9ffa624` (revision 5.25, with the protocol layer built, after review 10) on how a launch names its browser. Prompted by the maintainer, on hearing that a channel is a fixed list of paths: "I think that will fall apart on various flavors of linux, like NixOS", then: "requiring executable path is also fine, and we just give users a way to easily look up the path if they don't want to ask an agent". Evidence: the channel tables in `chromiumLauncher.ts` and `firefoxLauncher.ts`, Playwright 1.61's channel table (`playwright-core/lib/coreBundle.js`, from nixpkgs), and the browsers on this NixOS machine. This commit records the review only.*

Review 10 made a launch name its browser by `executablePath` or by a `channel`, and made each channel a location the backend knows. A channel is a fixed table of paths per platform, and the table can't know where a machine keeps its browsers:

| Case | What `channel` does |
|---|---|
| NixOS (this machine) | Nothing is ever at `/opt/google/…` or `/usr/bin/…`: Chromium is `/etc/profiles/per-user/<user>/bin/chromium`, a link to `/nix/store/…-chromium-155.0.8059.79/bin/chromium`, found only on `PATH`. Every channel fails. |
| Chromium, the open-source build, on any system | It has no channels, so `Chromium.layer({ channel })` never launches Chromium, only Google Chrome. |
| Firefox `beta`, on Linux, macOS and Windows | It searches the same paths as `stable` (`/usr/bin/firefox`, `Firefox.app`, `Mozilla Firefox\`), so it launches whichever Firefox is installed, usually stable, and says nothing. Playwright's table does the same. |
| Chrome `canary`, on Linux | It searches `google-chrome-unstable`, which is Chrome Dev; Canary is `/opt/google/chrome-canary` (Playwright's table maps both). |
| Snap, Flatpak, Guix, a tarball unpacked anywhere | Not searched. |

The table is right only where a vendor's own installer put the browser, and it is wrong in silence where two channels share an install path. Whatever it found, nothing reports what was launched beyond `Browser.Info`, which every adapter already fills from the browser (CDP's `Browser.getVersion`, BiDi's `session.new`, WebKit's build): the version is said, once connected.

## Candidates

### 1. A launch takes an executable path, and nothing else

**Where:** `Browser.LaunchOptions`; every backend's `layer` and `layerConfig`; the launchers.

**What changes.** `channel` is removed from every backend, and `executablePath` is required. `LaunchOptions` stops being generic and is one interface again, with `executablePath` its only required member:

```ts
interface LaunchOptions {
  readonly executablePath: FilePath.Local | string   // absolute; nothing is looked up
  readonly headless?: boolean | undefined
  readonly args?: ReadonlyArray<string> | undefined
  readonly profile?: LaunchProfile.LaunchProfile | undefined
  readonly userDataDir?: FilePath.Local | string | undefined
}
```

The path must be absolute. A relative path means something different in each working directory, and a bare name such as `chromium` would be looked up on `PATH` by the process spawner, a search nobody wrote, so either fails with `InvalidInput` before anything is touched. A path that doesn't exist is `ExecutableNotFound`, whose hint names the command below.

Code that runs on several machines takes the path from its environment, which `layerConfig` already does: `Chromium.layerConfig({ executablePath: Config.string("CHROMIUM_PATH") })`. Each machine says where its browser is, as the Nix environment does for the integration tests (`STRIDER_CHROMIUM`); a variable that isn't set is a `ConfigError` naming it.

**Recommendation.** Adopt; the maintainer decided it.

### 2. `strider browsers` lists the browsers it can find

**Where:** the package's `bin`, the first `strider` command built (CLI.md).

**What changes.** Finding a browser becomes something a person or an agent asks for, once, and copies from, never something a launch does. `strider browsers` lists what it finds, by backend, and says for each:

- **the path**, as found: on NixOS the profile's link, which survives updates, not the store path it resolves to, which doesn't;
- **what it resolves to**, when that differs;
- **how it was found**: on `PATH` under a command name Chrome, Chromium, Edge or Firefox installs (`chromium`, `google-chrome-beta`, `microsoft-edge`, `firefox-nightly`, …); at a vendor installer's location (the old channel tables, corrected); or in Playwright's browser cache;
- **its version**, from `--version`, which Chromium, Chrome, Edge and Firefox print; for a Playwright WebKit build, its build number, and whether its `protocol.json` is the one the adapter is generated from, as the launcher checks.

`--json` prints the same as data, for scripts and agents. It runs nothing but `--version`, writes nothing, and the library never calls it. It reports what it finds and doesn't claim it works: a Snap or Flatpak browser's sandbox may refuse a profile in the temporary directory or the debugging pipe, which isn't verified.

The command needs a runtime, so `@effect/platform-node` becomes an optional peer dependency, needed by the `strider` command only. A program that launches a browser on Node already provides it (`NodeServices.layer`); without it the command says what to install.

**Recommendation.** Adopt.

### 3. The CLI's `start` names its browser too

**Where:** CLI.md (`SessionSpec`, A session).

**What changes.** `strider start --name checkout` launched Chromium by default, from somewhere. It takes `--chromium <path>`, `--firefox <path>` or `--webkit <path>`, exactly one, or `--attach <endpoint>`, and the session's spec prints the path back.

**Recommendation.** Adopt.

### 4. Examples name a path

**Where:** the JSDoc examples, API.md, the scenarios, the READMEs, AGENTS.md.

**What changes.** A first example names a literal path (`Chromium.layer({ executablePath: "/usr/bin/chromium" })`), and API.md and the package README show the `layerConfig` form for code that runs on more than one machine, with `strider browsers` as the way to find a path.

**Recommendation.** Adopt.

## Considered and not adopted

- **Keeping channels, with the table corrected.** NixOS, Snap, Flatpak, Guix and the open-source Chromium stay out of reach, and Firefox's channels share install paths on every platform, so no table tells them apart.
- **Rejecting channels on Linux only** (the maintainer's first thought). The same options would compile everywhere and fail on one system, and Firefox's channels can't be told apart on macOS and Windows either.
- **Resolving a command name on `PATH` at launch.** The same options would launch different programs for a terminal, an editor's test runner and CI, whose `PATH`s differ.
- **`WebKit.playwrightCache` as a `Config` value** (suggested in the discussion). The command lists Playwright's builds, and one way to name a browser is enough; it can be added if Playwright's cache turns out to be where most WebKit users keep it.
- **A library function that finds browsers.** A program would call it at launch, which is the search review 10 removed; the command is for a person, once.
- **Refusing a Chromium or Firefox version other than the one tested.** Their protocols change slowly and compatibly, and `Browser.Info` says what connected; WebKit's launcher still refuses another build, whose protocol isn't the one generated from.

## Decision

Adopted, 2026-10-20, on the maintainer's direction. The revision follows this commit.
