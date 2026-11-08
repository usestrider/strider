# macOS integration

CI runs it as the `integration-macos` job in `.github/workflows/integration.yml`, on GitHub's standard Apple Silicon
`macos-15` runner ([runner image labels](https://github.com/actions/runner-images#available-images)). It runs independently
of the Linux job, every night and on manual dispatch.
No macOS browser execution has been validated on the Linux development machine.

Run locally on Apple Silicon macOS with Node 24 and the repository's pinned pnpm:

```sh
brew install openssl@3
pnpm install --frozen-lockfile
pnpm test:integration:macos --no-file-parallelism
```

The entry point downloads Chrome for Testing 155.0.8059.79 (`mac-arm64`) and Firefox 158.0 (Mozilla's universal
macOS DMG), verifies their SHA-256 before extracting or mounting, and deletes the temporary installation after
the run. Both match the Linux browser versions, but are separate pins in `browsers.macos.json`; Linux still
uses `browsers.json` and Nix. Runner-image browsers can change independently and are never used. Chrome for
Testing provides an explicitly versioned upstream Chrome distribution when Nixpkgs Chromium is unavailable on
macOS. This tests Chrome's CDP implementation, not a macOS build of Nixpkgs Chromium.

Availability checked by downloading both archives on 2026-11-05. The Chrome URL appears in Google's
[known-good download manifest](https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json).
Google's manifest supplies versioned URLs, not checksums: the checked-in SHA-256 is calculated from the HTTPS
download. Firefox's calculated SHA-512 also matches Mozilla's
[published SHA512SUMS](https://archive.mozilla.org/pub/firefox/releases/158.0/SHA512SUMS):
`91a4bc4a84749c0f184a1d4db691e9db17ac18035f90919fa260266ed276a4d1143e9bd3a4cbeb18e576eac9bac75fe304b38a45e3866717211e48ca40a8859f`.
The entry point checks archive integrity on every run; adapter and slice setup separately require exact browser
versions. Updating either macOS pin requires downloading and hashing the new archive and running this suite.

The entry point also installs the Apple Silicon FFmpeg and FFprobe 9.0 static builds pinned in
`scripts/ffmpeg.macos.json`, verifies both archives before extraction, and supplies their absolute paths as
`STRIDER_FFMPEG` and `STRIDER_FFPROBE`. They share the browsers' temporary directory and cleanup. Real recording,
writer conformance, probing and decoding remain enabled; the missing-writer refusal runs separately.
Both downloaded archives' calculated SHA-256 matched the publisher's `.zip.sha256` files at
[the versioned build page](https://ffmpeg.martin-riedl.de/info/detail/macos/arm64/1785863997_9.0).
Updating these pins requires downloading and hashing both archives and validating the macOS recording tests.

## Scope and platform boundaries

- Every Chromium and Firefox test file in `adapter/` and `slice/` is included, including backend-specific,
  identity, capture and headers cases. Headed Chromium cases use macOS's native WindowServer; Linux retains Xvfb.
- WebKitGTK and its Xvfb tests require Linux and are excluded by file name before imports. Safari and Windows
  are outside this entry point. WebKit/Xvfb executable settings are read only when used, so importing the
  Chromium-specific tests does not require Linux executables.
- The launcher already applies its core limit through POSIX `sh` on macOS. Linux's AppArmor adjustment,
  `/proc` core-handler configuration and Xvfb are not applicable on macOS and are not copied into the job.
- The broader Linux suites (CLI, raw protocol, claims, WebKit, and upstream Astro/Vite) remain Linux-only in this
  workflow. macOS covers the requested adapter and public API slices, not all integration files.
- TLS fixtures use Homebrew `openssl@3`, resolved with `brew --prefix`, rather than assuming Apple’s LibreSSL
  supports the fixture’s `req -addext` arguments.
- UTC and `en_US.UTF-8` are explicit. Fonts, WindowServer and the runner image are supplied by GitHub, not Nix;
  pixel and layout differences are findings to investigate. This does not promise Linux's hermetic machine.
- `STRIDER_RECORD` is rejected by the entry point, environment setup and recording wrapper on macOS. The drift
  test is not selected, and Linux's traffic fixtures and names remain unchanged.
- The existing trace plugin and runner retain failed tests' protocol and owned-process traces. The proposed
  job uploads `.data/integration-failures/` with `integration-macos.log` for 14 days on failure, separately from
  Linux's artifact. Bash pipefail keeps test failures visible through `tee`.

The real macOS run must verify mounting/copying the Firefox app, Gatekeeper behavior, native headed browser
launches, TLS fixtures with Homebrew OpenSSL 3, and the full adapter/slice outcomes. Investigate failures with the
retained traces; do not turn macOS findings into skips.

For a reviewed timing investigation, dispatch `gh workflow run integration.yml --ref <reviewed-branch> -f retain_diagnostics=true`.
This selects only the macOS job, running `STRIDER_TRACE_RETAIN_PASSES=1 pnpm test:integration:macos --no-file-parallelism`.
The uploader runs on success, failure or cancellation and retains the log, commit/OS/Node/browser-pin metadata and
`.data/integration-failures/` for 14 days. Passing artifacts retain host/engine diagnostics and overflow/attribution markers, rather than raw protocol traffic, with a combined 16 MiB UTF-8 budget per
file, in addition to the recorder's existing failed-scope bounds. Empty passing scopes cost nothing; headers,
entries, ownership metadata and omission markers are charged their actual UTF-8 sizes. Budget exhaustion is marked
in the last passing artifact and logged; the retained tail
is not a complete traffic history. `packages/browser/test/integration/failureTrace.ts` documents clock domains,
unavailable observations and supported child-process capture. This mode changes retention and observation only;
it adds no browser waits and changes no test deadlines or assertions.
