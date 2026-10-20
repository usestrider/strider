# Design review — a launch names its browser, and nothing is downloaded

*2026-10-20. Review of commit `c8262fb` (revision 5.25, with the protocol layer built and its integration tests pinned in a Nix environment) on how a launch finds its browser. Prompted by the maintainer: the library shouldn't install anything for the user, because that fails explicit over implicit. This commit records the review only.*

API.md and `Browser.LaunchOptions` say a launch with no `channel` runs Chrome for Testing, which the library would download; the Chromium launcher's `ExecutableNotFound` says the download "isn't built yet", and API.md keeps a browser-download CLI "if needed". The launchers otherwise follow one rule, stated in `launch.ts`: nothing is searched beyond the candidates given, so a launch never picks up a browser nobody named. Two things break that rule, or would: the Chrome for Testing default, and the WebKit launcher, which looks in Playwright's browser cache when it is given nothing.

## Candidates

### 1. The library never downloads or installs a browser

**Where:** API.md (`layer`'s comment, `LaunchOptions.channel`, the "browser-download CLI" bullet); `Browser.LaunchOptions`; `Chromium.layer`'s JSDoc; PROTOCOL.md's not-built list; the Chromium launcher's hint.

**What changes.** Chrome for Testing stops being a default, and nothing in the library fetches, unpacks or installs a browser, now or later: no download at launch, and no install command. A browser comes from wherever its user gets it, which the docs say: an operating system's package or Chrome's own installer for a channel, a Nix package, or Playwright's installer for its WebKit builds. The library's own tests get theirs from the Nix environment, as they already do.

**Recommendation.** Adopt; the maintainer decided it.

### 2. A launch names its browser, and the type says so

**Where:** `Browser.LaunchOptions`; every backend's `layer` and `layerConfig`; the launchers' options.

**What changes.** With no default, a launch that names nothing has nothing to run. Today that is `ExecutableNotFound` at run time. Instead, the options require exactly one of `executablePath` and `channel`, the two being mutually exclusive alternatives, which the conventions make a union, and `layer`'s options stop being optional:

```ts
type LaunchOptions<Channel extends string> = LaunchSettings & (
  | { readonly executablePath: FilePath.Local | string; readonly channel?: undefined }
  | { readonly channel: Channel; readonly executablePath?: undefined }
)
declare const layer: (options: Browser.LaunchOptions<"stable" | "beta" | "canary">) => Layer<Browser, BrowserError, …>
```

`Chromium.layer({})` doesn't compile; `Chromium.layer({ channel: "stable" })` and `Chromium.layer({ executablePath })` do. `ExecutableNotFound` remains for a path that doesn't exist and a channel that isn't installed, naming what was searched.

**Recommendation.** Adopt.

### 3. Each backend names its own channels; WebKit's is Playwright's cache

**Where:** `WebKit.layer`; the WebKit launcher.

**What changes.** `channel` means an install location the caller names, and the set differs by browser: Chromium and Firefox keep `stable`, `beta` and `canary`, which WebKit doesn't have. WebKit's one is `playwright`: Playwright's browser cache (`PLAYWRIGHT_BROWSERS_PATH`, or its cache directory), at the build the adapter is generated from. The launcher looks there only when told to, never by default, and still checks the build's `protocol.json`. So `LaunchOptions` takes its channels as a type parameter, and each backend states its set.

**Recommendation.** Adopt.

### 4. Examples name a browser

**Where:** the JSDoc examples of `Chromium`, `Firefox`, `WebKit` and `VitestBrowser`; API.md; the scenarios; the README.

**What changes.** Every example launches a named browser (`Chromium.layer({ channel: "stable" })`), so no example teaches a default that doesn't exist.

**Recommendation.** Adopt.

## Considered and not adopted

- **An explicit install command** (`strider install chromium`, like `npx playwright install`). The maintainer doesn't want the library installing browsers at all; the tools that already do it remain available.
- **Defaulting to the installed stable channel.** It picks a browser nobody named, at whatever version the machine has.
- **Searching `PATH`.** The same, which the integration tests stopped doing in `2377f06`.
- **Keeping `ExecutableNotFound` as the only signal for a missing name.** It is still the error for a named browser that isn't there; a missing name is caught where it is written.

## Decision

Adopted, 2026-10-20, on the maintainer's direction. The revision follows this commit.
