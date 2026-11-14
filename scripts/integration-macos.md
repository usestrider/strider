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
- The existing trace plugin and runner retain failed tests' protocol and owned-process traces. The job uploads
  these with `integration-macos.log` for 14 days, separately from Linux's artifact. Native crash evidence and two
  passing protocol scopes are retained as described below. Bash pipefail keeps test failures visible through `tee`.

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

## Native Chromium crash evidence

Every hosted macOS run sets `STRIDER_MACOS_CRASH_DATABASE` to a run-owned directory in `runner.temp`.
The entry point passes `BREAKPAD_DUMP_LOCATION` to Chromium, keeping Crashpad's database outside both the
downloaded app and scope-owned profiles. No launch flag, assertion or deadline changes. `CHROME_HEADLESS=1`
marks an unattended bot so Chromium disables uploads in the absence of enforced policy.

In the pinned Chromium source, [ChromeCrashReporterClient::Create](https://github.com/chromium/chromium/blob/155.0.8059.79/chrome/app/chrome_crash_reporter_client.cc)
overrides `DIR_CRASH_DUMPS` from `BREAKPAD_DUMP_LOCATION`, and
[Crashpad initialization](https://github.com/chromium/chromium/blob/155.0.8059.79/components/crash/core/app/crashpad.cc)
enables dumping unconditionally on macOS, irrespective of the legacy `--disable-breakpad` flag.
The [default database path](https://github.com/chromium/chromium/blob/155.0.8059.79/chrome/common/chrome_paths.cc)
is based on the default user-data directory, not `--user-data-dir`. The earlier system-report snapshot did not
inspect this database. Crashpad can intercept a crash without leaving an OS diagnostic report.

An `always()` collector copies native files before the artifact upload, even when the suite fails. It scans
Crashpad's `pending`, `completed` and `new` directories, then the user's and system's `DiagnosticReports`
directories and their `Retired` subdirectories. Native copies have a combined 64 MiB limit: at most 32 reports,
each at most 16 MiB. Each source directory has a 512-entry inspection limit. Files are read one at a time without
following symlinks; omissions, partial/invalid minidumps and filesystem errors appear in `capture-status.json`.
The live database remains Crashpad-managed: its default pruning target is 128 MiB, not a hard filesystem quota.
A single report or reports written between pruning passes can exceed it. The database lives only on that runner;
only the bounded copies are uploaded. Delayed reports and abrupt runner termination can still prevent capture.

`integration-macos-log` retains the log, bounded failure traces, Firefox's crash reports for a failed test in
the Firefox adapter files (`Firefox.adapter.test.ts`, `FirefoxSpecific.test.ts`, `FirefoxCrashReportsWritten.test.ts`)
(`.data/integration-failures/*-firefox-crash/`: `.extra` annotations and minidumps up to 8 MiB each, as
`packages/browser/test/integration/failureTrace.ts` says), `.data/macos-crash-reports/`, and investigation
metadata when requested, for 14 days on success, failure or cancellation. Capture status includes pinned browser
version/archive hash, run/commit identity, time, report hashes, dump process/thread/exception IDs and header time.
`launches.ndjson` records browser root PIDs and arguments, capped at 256 KiB; individual identity records are capped
at 64 KiB. Metadata write errors are logged and saved separately when possible.

The existing `ChromiumIdentity.test.ts` deliberate renderer-crash case records its target/session, browser version,
browser PID, renderer PIDs from `SystemInfo.getProcessInfo`, and the interval between requesting `Page.crash` and
observing `Inspector.targetCrashed`. The collector verifies an exception minidump only when its PID is in that
isolated browser's renderer list and its header time falls within that interval (rounded down at the start to
match the header's one-second precision). `verification.state` is `verified`, `missing` or `not-observed`;
`nativeReports` separately states whether any native files were retained. A successful suite with unverified
capture fails the collector step after writing metadata. An already failing suite keeps its result and the
explicit verification status. No extra crash, browser retry, polling or delay is introduced.

A stall probe (`test/integration/stallProbe.ts`) watches every child launched with `--remote-debugging-pipe`
while `STRIDER_MACOS_CRASH_DATABASE` is set. If 10 s after its first pipe write nothing has arrived on its fd 4 and
it is still running, it captures once, in parallel and without blocking the launch: the `ps` rows of the browser and
its descendants (pid, ppid, pgid, state, elapsed and CPU time, RSS, wait channel, command); `sample <pid> 2` of the
browser and of up to six descendants; `lsof` of fds 0–4; a two-level listing of its `--user-data-dir` (at most 256
entries, with sizes and mtimes); and `uptime` and `vm_stat`. Each command has its own timeout (5–15 s) and keeps its
result, ok or failed, independently; each keeps at most 128 KiB of output. The first received byte or the exit disarms
it, so healthy launches record nothing. The capture is written to `.data/macos-crash-reports/stall-probe-<node
pid>-<browser pid>.json`, at most 1 MiB each (samples shortened evenly beyond that) and at most eight files per run,
and as a `stall-probe` event on the process's connection in the failure trace, with each sample's first 4 KiB. The
probe's own commands are not traced as processes. `adapter/StallProbe.test.ts` shows it on a shell child that never
answers, with the threshold lowered.

The worker test and deliberate-crash test, plus both files' shared contexts, retain their ordinary bounded
protocol/process histories on passing runs too. These four scopes are independent of the optional 16 MiB
passing-diagnostics budget. Match native dump time/PID against these traces and the deliberate-crash marker;
a filename alone does not identify the worker failure. The raw minidumps retain native stacks and modules for
later symbolization; the collector's small identity parser does not diagnose or symbolize a crash.
