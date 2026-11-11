# Fresh performance comparison: Chromium and Firefox

Generated from preserved measurements with `pnpm scenarios:report`. No browsers are launched by report generation. Positive gaps mean Strider is slower.

## Provenance and timing boundaries

- chromium: Chrome/155.0.8059.79 155.0.8059.79; measured 2026-11-08 at source `fca7e7c1c179d96766ba7839ae649e4f6f4bb9b1`; Playwright 1.64.1; Node v24.21.0; 10 scheduled repetitions after one initial verification/warmup.
  Same pinned stock executable; each library retains its default launch arguments.
  Launch boundary: Fresh browser through verified first page and shutdown, one warmup then alternating pairs; no filesystem cache reset.
- firefox: firefox 158.0; measured 2026-11-08 at source `fca7e7c1c179d96766ba7839ae649e4f6f4bb9b1`; Playwright 1.64.1; Node v24.21.0; 10 scheduled repetitions after one initial verification/warmup.
  Stock Firefox over BiDi versus Playwright-patched Firefox over Juggler: different versions and patches, not an isolated library comparison.
  Launch boundary: Fresh browser through verified first page and shutdown, one warmup then alternating pairs; no filesystem cache reset.

Launch includes shutdown in these preserved runs; its figures cannot be directly compared with the older narrower launch boundary. Default launch flags, waits, scheduling and interception remain in force. This report establishes no performance cause or production fix.

## Outcomes and limitations

- chromium: 300/300 timed attempts passed; 30/30 initial checks passed.
- firefox: 270/280 timed attempts passed; 27/28 initial checks passed.
  Initial failure, The Internet's login, strider: Expected page.getByText("You logged into a secure area!") to be visible
  The Internet's login: 10 timed failures; no valid timing gap. Individual errors and failed durations remain in the preserved data and detailed report.

A required-page recording preflight checks GET page coverage, not complete interaction replay. A failed comparison does not establish that a browser feature is generally unsupported. Failures in one scenario do not invalidate other complete pairs.

Times are milliseconds; each cell is **p50 / p90**. Gaps use `(Strider / Playwright - 1) × 100`. For each library and workflow, n is the number of successful timed samples, which can be smaller than the scheduled repetition count after failures. The estimator selects zero-based sorted index `min(n - 1, floor(q × n))`. The table below gives one-based positions for the successful sample counts present in these workflow rows; n = 0 has no statistic. When p90 selects the maximum, a p90-only gap depends on one tail sample and requires confirmation before calling it a sustained regression. Larger sample counts can select a value below the maximum. Desktop background activity and browser build differences limit attribution. Failed durations are excluded from statistics; gaps are withheld if either library failed any initial or timed attempt.

| Successful samples (n) | p50 position | p90 position |
|---:|---:|---:|
| 0 | – | – |
| 10 | 6 | 10 (maximum) |

## Retained correctness observations

- Chromium emitted six Browser.setDownloadBehavior declaration-release rejections during the concurrent workload because the context no longer existed. They fall inside Strider's timed arms; outcomes passed, and those timings include the rejected round trips and logging. This is a separate correctness observation, not a harness error.
- The recorded Internet login failed for Strider on Firefox, while Playwright passed. The same recording passed Chromium and the separate local HAR recording/replay passed Firefox. The failure's cause is not established; its timing gap is withheld. Protocol traces were not captured by this harness.

## Paired workflow results

| Browser | Scenario | Strider p50 / p90 | Playwright p50 / p90 | p50 gap | p90 gap |
|---|---|---:|---:|---:|---:|
| chromium | Launch, first page, and shutdown | 241.575 / 282.861 | 218.617 / 232.007 | +10.5% | +21.9% |
| chromium | 20 pages in one context | 1881.313 / 1925.979 | 1409.896 / 1415.484 | +33.4% | +36.1% |
| chromium | 300 actions in one session | 10060.742 / 10063.954 | 5066.266 / 5069.124 | +98.6% | +98.5% |
| chromium | 4 parallel tests sharing one browser | 1933.386 / 2421.553 | 1119.133 / 1300.736 | +72.8% | +86.2% |
| chromium | The README's program | 98.052 / 116.010 | 100.307 / 117.258 | -2.2% | -1.1% |
| chromium | A login reused through storage state | 327.546 / 342.132 | 270.759 / 288.732 | +21.0% | +18.5% |
| chromium | A popup with a dialog inside it | 153.832 / 167.628 | 149.768 / 151.562 | +2.7% | +10.6% |
| chromium | A route that blocks analytics | 73.869 / 79.174 | 71.705 / 83.672 | +3.0% | -5.4% |
| chromium | A file upload, from bytes | 107.866 / 133.666 | 73.515 / 80.731 | +46.7% | +65.6% |
| chromium | A response's body, from a click | 113.686 / 173.837 | 117.096 / 122.485 | -2.9% | +41.9% |
| chromium | Waiting for the navigation a click causes | 158.119 / 169.262 | 165.734 / 181.190 | -4.6% | -6.6% |
| chromium | A HAR recorded, then replayed | 150.120 / 156.494 | 148.153 / 162.103 | +1.3% | -3.5% |
| chromium | The Internet's login | 248.297 / 263.577 | 231.955 / 238.169 | +7.0% | +10.7% |
| chromium | The Internet's dynamic controls | 3169.554 / 3187.136 | 3397.197 / 3402.964 | -6.7% | -6.3% |
| firefox | Launch, first page, and shutdown | 1166.442 / 1190.372 | 863.455 / 981.699 | +35.1% | +21.3% |
| firefox | 20 pages in one context | 5053.176 / 5319.278 | 3616.092 / 4615.432 | +39.7% | +15.2% |
| firefox | 300 actions in one session | 10219.790 / 10223.636 | 7627.677 / 7849.637 | +34.0% | +30.2% |
| firefox | 4 parallel tests sharing one browser | 2314.355 / 2385.491 | 2154.378 / 2712.516 | +7.4% | -12.1% |
| firefox | The README's program | 264.024 / 270.618 | 188.703 / 576.447 | +39.9% | -53.1% |
| firefox | A login reused through storage state | 973.605 / 1035.142 | 548.981 / 1331.365 | +77.3% | -22.2% |
| firefox | A popup with a dialog inside it | 543.639 / 580.141 | 292.083 / 1035.155 | +86.1% | -44.0% |
| firefox | A route that blocks analytics | 317.717 / 323.695 | 135.113 / 654.066 | +135.1% | -50.5% |
| firefox | A file upload, from bytes | 298.140 / 386.050 | 142.069 / 695.241 | +109.9% | -44.5% |
| firefox | A response's body, from a click | 348.724 / 587.540 | 187.413 / 668.258 | +86.1% | -12.1% |
| firefox | Waiting for the navigation a click causes | 390.655 / 1262.863 | 267.316 / 808.769 | +46.1% | +56.1% |
| firefox | A HAR recorded, then replayed | 574.137 / 669.190 | 295.645 / 859.207 | +94.2% | -22.1% |
| firefox | The Internet's login | – | 323.887 / 567.621 | incomplete | incomplete |
| firefox | The Internet's dynamic controls | 3429.834 / 3463.719 | 3486.576 / 3808.652 | -1.6% | -9.1% |

Video demonstrations without Playwright twins have no comparison gap. Unsupported comparisons and Chromium-only diagnostics are labeled in each run's detailed report.

## Reproduction and evidence

See [the scenario instructions](README.md) for the executable regeneration command, workload sizes and pinned browser provisioning. Inputs are the preserved measurements.json files; an optional source-bound context file retains reviewed correctness observations. Raw ordered attempts, recording validation, source snapshots/hashes, exact browser versions, executable hashes and launch settings remain in the external evidence directories. Detailed reports below are generated from those same measurements, including their original metadata and source.

## chromium detailed report

*Written by `pnpm scenarios` on 2026-11-08: Chrome/155.0.8059.79 155.0.8059.79, the integration environment's, driven headless by Strider at `fca7e7c` and by Playwright 1.64.1 through `playwright-core`; Node v24.21.0; AMD Ryzen 9 9900X 12-Core Processor, 24 threads, 60 GiB, Linux 7.2.10, load 2.5 3.3 3.9 at the end. Timings are each scenario's wall time over 10 scheduled runs after one that warms it up, which libraries take turns going first in; the machine is a desktop, so they move with whatever else it runs. Regenerate from saved measurements with `pnpm scenarios:report`.*

```json
{
  "diagnosticFailures": [],
  "engine": "chromium",
  "stockExecutable": "/nix/store/ini1ifgvcsvw48x4mxawrv9jvbdwn70p-chromium-155.0.8059.79/bin/chromium",
  "playwrightOptions": {
    "executablePath": "/nix/store/ini1ifgvcsvw48x4mxawrv9jvbdwn70p-chromium-155.0.8059.79/bin/chromium",
    "headless": true
  },
  "launchArguments": {
    "strider": [
      "/nix/store/xaaviz84rjj4pm3k6rq1rvz5pja1a77q-chromium-unwrapped-155.0.8059.79/libexec/chromium/chromium",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-service-autorun",
      "--disable-sync",
      "--disable-component-update",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-client-side-phishing-detection",
      "--disable-domain-reliability",
      "--disable-breakpad",
      "--disable-hang-monitor",
      "--disable-prompt-on-repost",
      "--disable-component-extensions-with-background-pages",
      "--disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,AutofillServerCommunication",
      "--enable-features=CDPScreenshotNewSurface",
      "--metrics-recording-only",
      "--password-store=basic",
      "--use-mock-keychain",
      "--headless",
      "--remote-debugging-pipe",
      "--user-data-dir=/tmp/nix-shell.UNyAei/strider-chromium-MKFAVn",
      "about:blank"
    ],
    "playwright": [
      "/nix/store/xaaviz84rjj4pm3k6rq1rvz5pja1a77q-chromium-unwrapped-155.0.8059.79/libexec/chromium/chromium",
      "--disable-field-trial-config",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-back-forward-cache",
      "--disable-breakpad",
      "--disable-client-side-phishing-detection",
      "--disable-component-extensions-with-background-pages",
      "--disable-component-update",
      "--no-default-browser-check",
      "--disable-default-apps",
      "--disable-dev-shm-usage",
      "--disable-edgeupdater",
      "--disable-extensions",
      "--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,AvoidCorsURLLoaderRestartOnRedirect,Translate,AutoDeElevate,OptimizationHints,NetworkTimeServiceQuerying,AimEnabled,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion",
      "--enable-features=CDPScreenshotNewSurface",
      "--allow-pre-commit-input",
      "--disable-hang-monitor",
      "--disable-ipc-flooding-protection",
      "--disable-popup-blocking",
      "--disable-prompt-on-repost",
      "--disable-renderer-backgrounding",
      "--disable-updater-scheduler",
      "--force-color-profile=srgb",
      "--metrics-recording-only",
      "--no-first-run",
      "--password-store=basic",
      "--use-mock-keychain",
      "--no-service-autorun",
      "--export-tagged-pdf",
      "--disable-search-engine-choice-screen",
      "--unsafely-disable-devtools-self-xss-warnings",
      "--edge-skip-compat-layer-relaunch",
      "--disable-infobars",
      "--disable-search-engine-choice-screen",
      "--disable-sync",
      "--enable-unsafe-swiftshader",
      "--headless",
      "--hide-scrollbars",
      "--mute-audio",
      "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
      "--no-sandbox",
      "--user-data-dir=/tmp/nix-shell.UNyAei/playwright_chromiumdev_profile-XElZOI",
      "--remote-debugging-pipe",
      "--no-startup-window"
    ]
  },
  "stockInfo": {
    "product": "Chrome/155.0.8059.79",
    "version": "155.0.8059.79",
    "protocol": "cdp",
    "revision": "1.3"
  },
  "executableHashes": {
    "strider": "c821d8cccbf653b255a6950911846cc17b9b1eae7bb143e49143cd5e0d693653",
    "playwright": "c821d8cccbf653b255a6950911846cc17b9b1eae7bb143e49143cd5e0d693653"
  },
  "stockVersion": "155.0.8059.79",
  "playwrightVersion": "155.0.8059.79",
  "sourceCommit": "fca7e7c1c179d96766ba7839ae649e4f6f4bb9b1",
  "sourceHashes": {
    "bin.ts": "b509407871e7cc1de449695e8f9326f663aa2f0ea9892edc7689b9b5bcc42707",
    "runner.ts": "2e21e9d16c67ea669d77ee73838c70b7514deec39fcf9d5e5a640d925465b26c",
    "report.ts": "da43ce11ce1119763e080f41320cbfc12b98a854ed3d15346cf341831f0ddab0",
    "scenarios.ts": "dc30e398599a50a57b63917b9b1ab03c66474a30966091f2d9a8e77f8b58c020",
    "site.ts": "1f778a706e50d7ae29e5e47f682e5eef95a512b69b0cc7069724f6ae1544d71e",
    "replay.ts": "e8b3af5799ec4e6c58031778f338b1e762702c2b8b1659b171b3553f930cf7f2",
    "measure.ts": "0ac16c63a87122ce933a799cb03e3245ecc2ac57fc749285776cbb9777253523"
  },
  "lockHash": "e0e62c3a9f64f8bb354fc70156705d98d5b174042f849ff48060aeb865d31cf2",
  "flakeHash": "2b95afcf390cc6c96d5f58385cdea6b2c4c2c381d11505332964c4ad72efbcad",
  "recordings": {
    "the-internet": "9f24d5f732b7fba32fce126a35635454d55cdee87af9c7f3bd885f1deca4bdbf"
  },
  "environment": {
    "STRIDER_ENVIRONMENT": "nix-integration",
    "FONTCONFIG_FILE": "/nix/store/bz56ni47jdlh7wn0s5q3xg5vh01g3gn6-fonts.conf",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "TZ": "UTC",
    "ALSA_CONFIG_PATH": "/nix/store/hyf72vxzfaj8z6r227a5373nkk3vazhr-strider-no-sound-card.conf"
  },
  "fairness": "Same pinned stock executable; each library retains its default launch arguments.",
  "launchBoundary": "Fresh browser through verified first page and shutdown, one warmup then alternating pairs; no filesystem cache reset."
}
```


### Scenarios

Each scenario is written once with each library, doing the same work, against the local site (`src/site.ts`), or a public demo site replayed from a recording, so a run sends nothing to anyone. A run is the whole scenario: its contexts and pages made and closed.

| Scenario | Strider | Playwright | Strider read | Playwright read | Lines, Strider / Playwright | p50 gap | p90 gap |
|---|---|---|---|---|---|---|---|
| Launch, first page, and shutdown | p50 242 ms (p90 283 ms); 10/10 successful | p50 219 ms (p90 232 ms); 10/10 successful | ✓ `0` | ✓ `0` | 0 / – | +10.5% | +21.9% |
| 20 pages in one context | p50 1881 ms (p90 1926 ms); 10/10 successful | p50 1410 ms (p90 1415 ms); 10/10 successful | ✓ `1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1` | ✓ `1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1` | 13 / 17 | +33.4% | +36.1% |
| 300 actions in one session | p50 10061 ms (p90 10064 ms); 10/10 successful | p50 5066 ms (p90 5069 ms); 10/10 successful | ✓ `150:value-149` | ✓ `150:value-149` | 9 / 14 | +98.6% | +98.5% |
| 4 parallel tests sharing one browser | p50 1933 ms (p90 2422 ms); 10/10 successful | p50 1119 ms (p90 1301 ms); 10/10 successful | ✓ `25:value-24,25:value-24,25:value-24,25:value-24` | ✓ `25:value-24,25:value-24,25:value-24,25:value-24` | 16 / 15 | +72.8% | +86.2% |
| The README's program | p50 98 ms (p90 116 ms); 10/10 successful | p50 100 ms (p90 117 ms); 10/10 successful | ✓ `Added to cart` | ✓ `Added to cart` | 7 / 11 | -2.2% | -1.1% |
| A login reused through storage state | p50 328 ms (p90 342 ms); 10/10 successful | p50 271 ms (p90 289 ms); 10/10 successful | ✓ `Signed in` | ✓ `Signed in` | 15 / 24 | +21.0% | +18.5% |
| A popup with a dialog inside it | p50 154 ms (p90 168 ms); 10/10 successful | p50 150 ms (p90 152 ms); 10/10 successful | ✓ `Allowed` | ✓ `Allowed` | 11 / 15 | +2.7% | +10.6% |
| A route that blocks analytics | p50 74 ms (p90 79 ms); 10/10 successful | p50 72 ms (p90 84 ms); 10/10 successful | ✓ `analytics blocked` | ✓ `analytics blocked` | 7 / 11 | +3.0% | -5.4% |
| A file upload, from bytes | p50 108 ms (p90 134 ms); 10/10 successful | p50 74 ms (p90 81 ms); 10/10 successful | ✓ `receipt.txt:4` | ✓ `receipt.txt:4` | 9 / 15 | +46.7% | +65.6% |
| A response's body, from a click | p50 114 ms (p90 174 ms); 10/10 successful | p50 117 ms (p90 122 ms); 10/10 successful | ✓ `tea × 1` | ✓ `tea × 1` | 15 / 15 | -2.9% | +41.9% |
| Waiting for the navigation a click causes | p50 158 ms (p90 169 ms); 10/10 successful | p50 166 ms (p90 181 ms); 10/10 successful | ✓ `Orders` | ✓ `Orders` | 8 / 11 | -4.6% | -6.6% |
| A HAR recorded, then replayed | p50 150 ms (p90 156 ms); 10/10 successful | p50 148 ms (p90 162 ms); 10/10 successful | ✓ `42 sold` | ✓ `42 sold` | 17 / 21 | +1.3% | -3.5% |
| The Internet's login | p50 248 ms (p90 264 ms); 10/10 successful | p50 232 ms (p90 238 ms); 10/10 successful | ✓ `Secure Area` | ✓ `Secure Area` | 10 / 15 | +7.0% | +10.7% |
| The Internet's dynamic controls | p50 3170 ms (p90 3187 ms); 10/10 successful | p50 3397 ms (p90 3403 ms); 10/10 successful | ✓ `Strider` | ✓ `Strider` | 11 / 15 | -6.7% | -6.3% |
| A video of a run | p50 3200 ms (p90 3207 ms); 10/10 successful | – | ✓ `Strider, recorded` | – | 21 / – | – | – |
| A video of a run, on Firefox | p50 4497 ms (p90 4531 ms); 10/10 successful | – | ✓ `Strider, recorded` | – | 24 / – | – | – |

Gaps are (Strider / Playwright − 1) × 100, positive means Strider is slower. p50 uses the existing upper-median estimator and p90 the sorted sample at floor(0.9 × n). Gaps are withheld if either library failed. Timing counts are successful/attempted repetitions; failed attempts are excluded from statistics. Initial outcomes above are retained separately.


Chromium diagnostics below are grouped sequential controls, not paired Firefox comparisons or performance gates.

### Chromium only: what a waiting expectation costs the page (Q82)

Strider evaluates a waiting expectation at every animation frame (QUIRKS.md, Q82). A page animating 200 of its 3000 elements each frame shows `#ready` after 3000 ms; the renderers' CPU time per second is read from `/proc` while each library waits for it, and while each leaves the page alone for as long.

| | Renderer CPU per second |
|---|---|
| Strider, idle | p50 249 ms (p90 259 ms) |
| Strider, `Expect.toBeVisible` waiting | p50 280 ms (p90 284 ms) |
| Playwright, idle | p50 277 ms (p90 283 ms) |
| Playwright, `locator.waitFor()` waiting | p50 238 ms (p90 250 ms) |

### Chromium only: what an interceptor installed costs a load (Q103)

Strider keeps Chromium's `Fetch` interceptor enabled. The public page layer also handles authentication challenges, which pauses document requests at their request stage even without a user route; subresources are not all paused. The no-route row therefore includes that retained scheduling and interception cost. Q103's historical no-match-only description does not describe this full page workload. A page with 300 images, each a request, loaded to its `load` event:

| | Load |
|---|---|
| Strider, no user route (document challenge interception retained) | p50 110 ms (p90 124 ms) |
| Strider, a route matching nothing on the page | p50 109 ms (p90 118 ms) |
| Playwright, no route | p50 75 ms (p90 79 ms) |
| Playwright, a route matching nothing on the page | p50 118 ms (p90 132 ms) |

### What each leaves for a page to see

What a page's own script reads about the browser driving it (`/tells` in `src/site.ts`), headless, as each launches by default:

| | Strider | Playwright |
|---|---|---|
| navigator.webdriver | true | true |
| userAgent says HeadlessChrome | true | true |
| Runtime.enable observed | false | false |
| window.chrome | object | object |
| window.chrome.runtime | undefined | undefined |
| navigator.plugins.length | 5 | 5 |
| navigator.languages | en-US,en | en-US,en |
| outer size | 780×580 | 1280×720 |
| inner size | 780×493 | 1280×720 |
| screen size | 800×600 | 1280×720 |
| Notification.permission / query | default / prompt | default / prompt |
| WebGL renderer | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) |
| globals added | 0 | 0 |

The arguments each launched Chromium with:

```
Strider:    --no-first-run --no-default-browser-check --no-service-autorun --disable-sync --disable-component-update --disable-background-networking --disable-default-apps --disable-client-side-phishing-detection --disable-domain-reliability --disable-breakpad --disable-hang-monitor --disable-prompt-on-repost --disable-component-extensions-with-background-pages --disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,AutofillServerCommunication --enable-features=CDPScreenshotNewSurface --metrics-recording-only --password-store=basic --use-mock-keychain --headless --remote-debugging-pipe --user-data-dir=/tmp/nix-shell.UNyAei/strider-chromium-MKFAVn about:blank
Playwright: --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,AvoidCorsURLLoaderRestartOnRedirect,Translate,AutoDeElevate,OptimizationHints,NetworkTimeServiceQuerying,AimEnabled,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/tmp/nix-shell.UNyAei/playwright_chromiumdev_profile-XElZOI --remote-debugging-pipe --no-startup-window
```

### The code

#### Launch, first page, and shutdown

Launches a fresh browser, creates one page, loads and reads the local fixture, then closes the page/context and browser. Includes shutdown equally on both sides.

```ts
// Launch implementation: bin.ts in the retained source artifacts.
```

#### 20 pages in one context

Keeps 20 pages open, navigating and clicking once on each, then checks every counter before closing the context.

```ts
const manyPagesStrider = Effect.fn("many pages")(function*(origin: string) {
  const context = yield* Browser.newContext()
  const pages = []
  for (let i = 0; i < 20; i++) {
    const page = yield* context.newPage
    yield* page.goto(`${origin}/benchmark`)
    yield* page.getByRole("button", { name: "Increment" }).click()
    pages.push(page)
  }
  const values = []
  for (const page of pages) values.push(yield* page.locator("#count").readText)
  return values.join(",")
})
```

```ts
const manyPagesPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const context = await browser.newContext()
  try {
    const pages = []
    for (let i = 0; i < 20; i++) {
      const page = await context.newPage()
      await page.goto(`${origin}/benchmark`)
      await page.getByRole("button", { name: "Increment" }).click()
      pages.push(page)
    }
    const values = []
    for (const page of pages) values.push(await page.locator("#count").textContent())
    return values.join(",")
  } finally {
    await context.close()
  }
}
```

#### 300 actions in one session

Runs 150 fill/click pairs in one page and context, then verifies the counter and final input value.

```ts
const longSessionStrider = Effect.fn("long session")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/benchmark`)
  for (let i = 0; i < 150; i++) {
    yield* page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
    yield* page.getByRole("button", { name: "Increment" }).click()
  }
  return `${yield* page.locator("#count").readText}:${yield* page.getByRole("textbox", { name: "Name" }).readValue}`
})
```

```ts
const longSessionPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/benchmark`)
    for (let i = 0; i < 150; i++) {
      await page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
      await page.getByRole("button", { name: "Increment" }).click()
    }
    return `${await page.locator("#count").textContent()}:${await page.getByRole("textbox", { name: "Name" })
      .inputValue()}`
  } finally {
    await page.close()
  }
}
```

#### 4 parallel tests sharing one browser

Runs four isolated contexts concurrently, with 25 fill/click pairs in each, then verifies all four counters and input values.

```ts
const parallelTestsStrider = (origin: string) =>
  Effect.forEach(
    Array.from({ length: 4 }),
    () =>
      Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* page.goto(`${origin}/benchmark`)
        for (let i = 0; i < 25; i++) {
          yield* page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
          yield* page.getByRole("button", { name: "Increment" }).click()
        }
        return `${yield* page.locator("#count").readText}:${yield* page.getByRole("textbox", { name: "Name" })
          .readValue}`
      })),
    { concurrency: 4 }
  ).pipe(Effect.map((values) => values.join(",")))
```

```ts
const parallelTestsPlaywright = async (browser: Playwright.Browser, origin: string) =>
  (await Promise.all(Array.from({ length: 4 }, async () => {
    const page = await browser.newPage()
    try {
      await page.goto(`${origin}/benchmark`)
      for (let i = 0; i < 25; i++) {
        await page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
        await page.getByRole("button", { name: "Increment" }).click()
      }
      return `${await page.locator("#count").textContent()}:${await page.getByRole("textbox", { name: "Name" })
        .inputValue()}`
    } finally {
      await page.close()
    }
  }))).join(",")
```

#### The README's program

Opens a page, clicks a button, waits for what it shows, and reads it: the README's first program.

```ts
const readmeStrider = Effect.fn("readme")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/`)
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  yield* page.getByText("Added to cart").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
```

```ts
const readmePlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/`)
    await page.getByRole("button", { name: "Add to cart" }).click()
    await page.getByText("Added to cart").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
```

#### A login reused through storage state

Signs in once, keeps the context's storage state, and opens a later page in a new context already signed in.

```ts
const loginStrider = Effect.fn("login")(function*(origin: string) {
  const state = yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    yield* page.goto(`${origin}/login`)
    yield* page.getByLabel("Email").fill("me@example.com")
    yield* page.getByLabel("Password").fill("hunter2")
    yield* page.getByRole("button", { name: "Sign in" }).click()
    yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
    return yield* page.context.exportStorageState
  }))
  const page = yield* Browser.newPage({ storageState: state })
  yield* page.goto(`${origin}/account`)
  yield* page.getByText("theme: dark").pipe(Expect.toBeVisible)
  return yield* page.getByRole("heading").readText
})
```

```ts
const loginPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const first = await browser.newContext()
  let state: Awaited<ReturnType<Playwright.BrowserContext["storageState"]>>
  try {
    const page = await first.newPage()
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("me@example.com")
    await page.getByLabel("Password").fill("hunter2")
    await page.getByRole("button", { name: "Sign in" }).click()
    await page.getByText("Welcome").waitFor()
    state = await first.storageState()
  } finally {
    await first.close()
  }
  const context = await browser.newContext({ storageState: state })
  try {
    const page = await context.newPage()
    await page.goto(`${origin}/account`)
    await page.getByText("theme: dark").waitFor()
    return (await page.getByRole("heading").textContent()) ?? ""
  } finally {
    await context.close()
  }
}
```

#### A popup with a dialog inside it

Waits for the popup a click opens, accepts every dialog in it, and acts in it.

```ts
const popupStrider = Effect.fn("popup")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/connect`)
  const popups = yield* Popup.next(page)
  yield* page.getByText("Connect account").click()
  const popup = yield* popups
  yield* Dialog.handle(popup, Dialog.acceptAll)
  yield* popup.getByRole("button", { name: "Allow" }).click()
  yield* popup.getByText("Allowed").pipe(Expect.toBeVisible)
  return yield* popup.locator("#out").readText
})
```

```ts
const popupPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/connect`)
    const popupOpened = page.waitForEvent("popup")
    await page.getByText("Connect account").click()
    const popup = await popupOpened
    popup.on("dialog", (dialog) => dialog.accept())
    await popup.getByRole("button", { name: "Allow" }).click()
    await popup.getByText("Allowed").waitFor()
    return (await popup.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
```

#### A route that blocks analytics

Aborts every request to the page's analytics with a route, declared before the page loads.

```ts
const blockStrider = Effect.fn("block")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.route(`${origin}/analytics/**`, () => Route.abort())
  yield* page.goto(`${origin}/tracked`)
  yield* page.getByText("analytics blocked").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
```

```ts
const blockPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.route(`${origin}/analytics/**`, (route) => route.abort())
    await page.goto(`${origin}/tracked`)
    await page.getByText("analytics blocked").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
```

#### A file upload, from bytes

Sets a file input from bytes the program makes, with no file on disk.

```ts
const uploadStrider = Effect.fn("upload")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/upload`)
  yield* page.getByLabel("Receipt").setInputFiles([
    FileInput.bytes("receipt.txt", "text/plain", new TextEncoder().encode("paid"))
  ])
  yield* page.getByText("receipt.txt:4").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
```

```ts
const uploadPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/upload`)
    await page.getByLabel("Receipt").setInputFiles({
      name: "receipt.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("paid")
    })
    await page.getByText("receipt.txt:4").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
```

#### A response's body, from a click

Subscribes to the response a click causes, before the click, and decodes its JSON body with a schema.

```ts
const Cart = Schema.Struct({
  items: Schema.Array(Schema.Struct({ sku: Schema.String, quantity: Schema.Number }))
})

const responseStrider = Effect.fn("response")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/cart`)
  const added = yield* NetworkResponse.next(page, {
    url: `${origin}/api/cart`,
    method: "POST",
    body: HttpIncomingMessage.schemaBodyJson(Cart)
  })
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  const { body } = yield* added
  return body.items.map((item) => `${item.sku} × ${item.quantity}`).join(", ")
})
```

```ts
const responsePlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/cart`)
    const added = page.waitForResponse((response) =>
      response.url() === `${origin}/api/cart` && response.request().method() === "POST"
    )
    await page.getByRole("button", { name: "Add to cart" }).click()
    const response = await added
    const cart = (await response.json()) as { items: ReadonlyArray<{ sku: string; quantity: number }> }
    return cart.items.map((item) => `${item.sku} × ${item.quantity}`).join(", ")
  } finally {
    await page.close()
  }
}
```

#### Waiting for the navigation a click causes

Subscribes to the navigation a click causes, before the click, then waits for it.

```ts
const navigationStrider = Effect.fn("navigation")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/home`)
  const orders = yield* PageNavigation.next(page, { url: `${origin}/orders` })
  yield* page.getByRole("link", { name: "Orders" }).click()
  yield* orders
  return yield* page.getByRole("heading").readText
})
```

```ts
const navigationPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/home`)
    await page.getByRole("link", { name: "Orders" }).click()
    await page.waitForURL(`${origin}/orders`)
    return (await page.getByRole("heading").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
```

#### A HAR recorded, then replayed

Records a page's traffic to a HAR, then serves a new page entirely from the recording.

```ts
const harStrider = Effect.fn("har")(function*(origin: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* fs.makeTempFileScoped({ suffix: ".har" })
  yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const har = yield* Har.record(page, { content: "embed" })
    yield* page.goto(`${origin}/report`)
    yield* page.getByText("42 sold").pipe(Expect.toBeVisible)
    yield* har.entries.waitFor((count) => count >= 2)
    yield* har.exportHar(path)
  }))
  const page = yield* Browser.newPage()
  yield* page.route("**/*", yield* Route.fromHar(path))
  yield* page.goto(`${origin}/report`)
  yield* page.getByText("42 sold").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
```

```ts
const harPlaywright = async (browser: Playwright.Browser, origin: string, files: Files) => {
  const path = files.temporary("report-playwright.har")
  const recording = await browser.newContext({ recordHar: { path, content: "embed" } })
  try {
    const page = await recording.newPage()
    await page.goto(`${origin}/report`)
    await page.getByText("42 sold").waitFor()
  } finally {
    await recording.close()
  }
  const context = await browser.newContext()
  try {
    await context.routeFromHAR(path, { notFound: "abort" })
    const page = await context.newPage()
    await page.goto(`${origin}/report`)
    await page.getByText("42 sold").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await context.close()
  }
}
```

#### The Internet's login

Logs in on The Internet's demo login page.

```ts
const theInternet = "https://the-internet.herokuapp.com"

const theInternetStrider = Effect.fn("the-internet")(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto(`${theInternet}/login`)
  yield* page.getByLabel("Username").fill("tomsmith")
  yield* page.getByLabel("Password").fill("SuperSecretPassword!")
  yield* page.getByRole("button", { name: "Login" }).click()
  yield* page.getByText("You logged into a secure area!").pipe(Expect.toBeVisible)
  return yield* page.getByRole("heading", { level: 2 }).readText
})
```

```ts
const theInternetPlaywright = async (browser: Playwright.Browser, _: string, files: Files) => {
  const context = await browser.newContext()
  try {
    await context.routeFromHAR(files.recording("the-internet"), { notFound: "abort" })
    const page = await context.newPage()
    await page.goto(`${theInternet}/login`)
    await page.getByLabel("Username").fill("tomsmith")
    await page.getByLabel("Password").fill("SuperSecretPassword!")
    await page.getByRole("button", { name: "Login" }).click()
    await page.getByText("You logged into a secure area!").waitFor()
    return (await page.getByRole("heading", { level: 2 }).textContent()) ?? ""
  } finally {
    await context.close()
  }
}
```

#### The Internet's dynamic controls

Enables a text box that a script enables three seconds later, and fills it as soon as it can.

```ts
const controls = "https://the-internet.herokuapp.com/dynamic_controls"

const controlsStrider = Effect.fn("controls")(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto(controls)
  yield* page.getByRole("button", { name: "Enable" }).click()
  // A script enables the box three seconds later: fill waits for it
  const input = page.getByRole("textbox")
  yield* input.fill("Strider")
  yield* page.getByText("It's enabled!").pipe(Expect.toBeVisible)
  return yield* input.readValue
})
```

```ts
const controlsPlaywright = async (browser: Playwright.Browser, _: string, files: Files) => {
  const context = await browser.newContext()
  try {
    await context.routeFromHAR(files.recording("the-internet"), { notFound: "abort" })
    const page = await context.newPage()
    await page.goto(controls)
    await page.getByRole("button", { name: "Enable" }).click()
    const input = page.getByRole("textbox")
    await input.fill("Strider")
    await page.getByText("It's enabled!").waitFor()
    return await input.inputValue()
  } finally {
    await context.close()
  }
}
```

#### A video of a run

Records a page to a WebM while it fills The Internet's dynamic controls: on Chromium from its screencast, with ffmpeg, and on Firefox with its own video.

```ts
// The page, and where its video goes
const dynamicControls = "https://the-internet.herokuapp.com/dynamic_controls"
const videoFile = "dynamic-controls.webm"

const videoStrider = Effect.fn("video")(function*() {
  const fs = yield* FileSystem.FileSystem
  const page = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
  yield* page.goto(dynamicControls, { waitUntil: "load" })
  let value = ""
  const recording = yield* Effect.scoped(Effect.gen(function*() {
    const recording = yield* page.capability(Capability.Video)
    yield* page.getByRole("button", { name: "Enable" }).click()
    const input = page.getByRole("textbox")
    yield* input.fill("Strider")
    yield* page.getByText("It's enabled!").pipe(Expect.toBeVisible)
    value = yield* input.readValue
    return recording
  }))
  yield* fs.copyFile(yield* recording.file, videoFile)
  const { size } = yield* fs.stat(videoFile)
  return size > 0 ? `${value}, recorded` : `${value}, but the video is empty`
})
```

#### A video of a run, on Firefox

Firefox records the video itself: no recorder and no ffmpeg, only the capability, for as long as its scope lives.

```ts
// The page, and where its video goes
const firefoxControls = "https://the-internet.herokuapp.com/dynamic_controls"
const firefoxVideoFile = "dynamic-controls-firefox.webm"

const videoFirefoxStrider = Effect.fn("video-firefox")(function*() {
  const fs = yield* FileSystem.FileSystem
  const page = yield* Browser.newPage({
    emulation: { viewport: { width: 1280, height: 720 } }
  })
  yield* page.goto(firefoxControls, { waitUntil: "load" })
  const input = page.getByRole("textbox")
  // Firefox writes the video itself, for as long as the capability's scope lives
  const video = yield* Effect.scoped(Effect.gen(function*() {
    const recording = yield* page.capability(Capability.Video)
    yield* page.getByRole("button", { name: "Enable" }).click()
    yield* input.fill("Strider")
    yield* page.getByText("It's enabled!").pipe(Expect.toBeVisible)
    // A second more, so the last paint is in it
    yield* Effect.sleep("1 second")
    return recording
  }))
  // Into the context's temporary downloads, which close with the page: keep a copy
  yield* fs.copyFile(yield* video.file, firefoxVideoFile)
  return `${yield* input.readValue}, recorded`
})
```


## firefox detailed report

*Written by `pnpm scenarios` on 2026-11-08: firefox 158.0, the integration environment's, driven headless by Strider at `fca7e7c` and by Playwright 1.64.1 through `playwright-core`; Node v24.21.0; AMD Ryzen 9 9900X 12-Core Processor, 24 threads, 60 GiB, Linux 7.2.10, load 1.8 2.4 3.1 at the end. Timings are each scenario's wall time over 10 scheduled runs after one that warms it up, which libraries take turns going first in; the machine is a desktop, so they move with whatever else it runs. Regenerate from saved measurements with `pnpm scenarios:report`.*

```json
{
  "diagnosticFailures": [],
  "engine": "firefox",
  "stockExecutable": "/nix/store/i9djwg6kjq72sjf44j75gmn1p6740gwz-firefox-158.0/bin/firefox",
  "playwrightOptions": {
    "executablePath": "/nix/store/5hczwfnqbc2wb9n2j4na1d4jb01cqr0m-scenario-playwright-firefox-157.0-1555/firefox/firefox",
    "headless": true
  },
  "launchArguments": {
    "strider": [
      "/nix/store/i9djwg6kjq72sjf44j75gmn1p6740gwz-firefox-158.0/bin/firefox",
      "--headless",
      "--remote-debugging-port=0",
      "--no-remote",
      "--profile",
      "/tmp/nix-shell.vd7cFV/strider-firefox-JGCkbE",
      "about:blank"
    ],
    "playwright": [
      "/nix/store/5hczwfnqbc2wb9n2j4na1d4jb01cqr0m-scenario-playwright-firefox-157.0-1555/firefox/firefox",
      "-no-remote",
      "-headless",
      "-profile",
      "/tmp/nix-shell.vd7cFV/playwright_firefoxdev_profile-JG2oef",
      "-juggler-pipe",
      "-silent"
    ]
  },
  "stockInfo": {
    "product": "firefox",
    "version": "158.0",
    "protocol": "bidi",
    "revision": "158.0"
  },
  "executableHashes": {
    "strider": "2724ac5c63ee57ab6ea15e8cf96a4b78d144caeab5b25803b10cfa86005f0bc7",
    "playwright": "43239fac06f6896197e26e76fb34199b550c867389f599107ca0bcc290c32856"
  },
  "patchedFirefoxBuild": "; This file is not used. If you modify it and want the application to use\n; your modifications, move it under the browser/ subdirectory and start with\n; the \"-app /path/to/browser/application.ini\" argument.\n[App]\nVendor=Mozilla\nName=Firefox\nRemotingName=firefox-default\nCodeName=Nightly\nVersion=157.0\nBuildID=20261002045257\nID={ec8030f7-c20a-464f-9b0e-13a3a9e97384}\n\n[Gecko]\nMinVersion=157.0\nMaxVersion=157.0\n\n[XRE]\nEnableProfileMigrator=1\n\n\n",
  "stockVersion": "158.0",
  "playwrightVersion": "157.0",
  "playwrightBrowserPin": {
    "name": "firefox",
    "revision": "1555",
    "installByDefault": true,
    "browserVersion": "157.0",
    "title": "Firefox"
  },
  "sourceCommit": "fca7e7c1c179d96766ba7839ae649e4f6f4bb9b1",
  "sourceHashes": {
    "bin.ts": "b509407871e7cc1de449695e8f9326f663aa2f0ea9892edc7689b9b5bcc42707",
    "runner.ts": "2e21e9d16c67ea669d77ee73838c70b7514deec39fcf9d5e5a640d925465b26c",
    "report.ts": "da43ce11ce1119763e080f41320cbfc12b98a854ed3d15346cf341831f0ddab0",
    "scenarios.ts": "dc30e398599a50a57b63917b9b1ab03c66474a30966091f2d9a8e77f8b58c020",
    "site.ts": "1f778a706e50d7ae29e5e47f682e5eef95a512b69b0cc7069724f6ae1544d71e",
    "replay.ts": "e8b3af5799ec4e6c58031778f338b1e762702c2b8b1659b171b3553f930cf7f2",
    "measure.ts": "0ac16c63a87122ce933a799cb03e3245ecc2ac57fc749285776cbb9777253523"
  },
  "lockHash": "e0e62c3a9f64f8bb354fc70156705d98d5b174042f849ff48060aeb865d31cf2",
  "flakeHash": "2b95afcf390cc6c96d5f58385cdea6b2c4c2c381d11505332964c4ad72efbcad",
  "recordings": {
    "the-internet": "9f24d5f732b7fba32fce126a35635454d55cdee87af9c7f3bd885f1deca4bdbf"
  },
  "environment": {
    "STRIDER_ENVIRONMENT": "nix-integration",
    "FONTCONFIG_FILE": "/nix/store/bz56ni47jdlh7wn0s5q3xg5vh01g3gn6-fonts.conf",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "TZ": "UTC",
    "ALSA_CONFIG_PATH": "/nix/store/hyf72vxzfaj8z6r227a5373nkk3vazhr-strider-no-sound-card.conf"
  },
  "fairness": "Stock Firefox over BiDi versus Playwright-patched Firefox over Juggler: different versions and patches, not an isolated library comparison.",
  "launchBoundary": "Fresh browser through verified first page and shutdown, one warmup then alternating pairs; no filesystem cache reset."
}
```

- Unsupported comparison: video and video-firefox: no equivalent Playwright video twin; Chromium screencast and Firefox native capture perform different work
- Unsupported comparison: Q82 renderer CPU, Q103 Fetch interception, and automation tells: Chromium-only diagnostics

### Scenarios

Each scenario is written once with each library, doing the same work, against the local site (`src/site.ts`), or a public demo site replayed from a recording, so a run sends nothing to anyone. A run is the whole scenario: its contexts and pages made and closed.

| Scenario | Strider | Playwright | Strider read | Playwright read | Lines, Strider / Playwright | p50 gap | p90 gap |
|---|---|---|---|---|---|---|---|
| Launch, first page, and shutdown | p50 1166 ms (p90 1190 ms); 10/10 successful | p50 863 ms (p90 982 ms); 10/10 successful | ✓ `0` | ✓ `0` | 0 / – | +35.1% | +21.3% |
| 20 pages in one context | p50 5053 ms (p90 5319 ms); 10/10 successful | p50 3616 ms (p90 4615 ms); 10/10 successful | ✓ `1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1` | ✓ `1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1` | 13 / 17 | +39.7% | +15.2% |
| 300 actions in one session | p50 10220 ms (p90 10224 ms); 10/10 successful | p50 7628 ms (p90 7850 ms); 10/10 successful | ✓ `150:value-149` | ✓ `150:value-149` | 9 / 14 | +34.0% | +30.2% |
| 4 parallel tests sharing one browser | p50 2314 ms (p90 2385 ms); 10/10 successful | p50 2154 ms (p90 2713 ms); 10/10 successful | ✓ `25:value-24,25:value-24,25:value-24,25:value-24` | ✓ `25:value-24,25:value-24,25:value-24,25:value-24` | 16 / 15 | +7.4% | -12.1% |
| The README's program | p50 264 ms (p90 271 ms); 10/10 successful | p50 189 ms (p90 576 ms); 10/10 successful | ✓ `Added to cart` | ✓ `Added to cart` | 7 / 11 | +39.9% | -53.1% |
| A login reused through storage state | p50 974 ms (p90 1035 ms); 10/10 successful | p50 549 ms (p90 1331 ms); 10/10 successful | ✓ `Signed in` | ✓ `Signed in` | 15 / 24 | +77.3% | -22.2% |
| A popup with a dialog inside it | p50 544 ms (p90 580 ms); 10/10 successful | p50 292 ms (p90 1035 ms); 10/10 successful | ✓ `Allowed` | ✓ `Allowed` | 11 / 15 | +86.1% | -44.0% |
| A route that blocks analytics | p50 318 ms (p90 324 ms); 10/10 successful | p50 135 ms (p90 654 ms); 10/10 successful | ✓ `analytics blocked` | ✓ `analytics blocked` | 7 / 11 | +135.1% | -50.5% |
| A file upload, from bytes | p50 298 ms (p90 386 ms); 10/10 successful | p50 142 ms (p90 695 ms); 10/10 successful | ✓ `receipt.txt:4` | ✓ `receipt.txt:4` | 9 / 15 | +109.9% | -44.5% |
| A response's body, from a click | p50 349 ms (p90 588 ms); 10/10 successful | p50 187 ms (p90 668 ms); 10/10 successful | ✓ `tea × 1` | ✓ `tea × 1` | 15 / 15 | +86.1% | -12.1% |
| Waiting for the navigation a click causes | p50 391 ms (p90 1263 ms); 10/10 successful | p50 267 ms (p90 809 ms); 10/10 successful | ✓ `Orders` | ✓ `Orders` | 8 / 11 | +46.1% | +56.1% |
| A HAR recorded, then replayed | p50 574 ms (p90 669 ms); 10/10 successful | p50 296 ms (p90 859 ms); 10/10 successful | ✓ `42 sold` | ✓ `42 sold` | 17 / 21 | +94.2% | -22.1% |
| The Internet's login | –; 0/10 successful | p50 324 ms (p90 568 ms); 10/10 successful | failed: Expected page.getByText("You logged into a secure area!") to be visible | ✓ `Secure Area` | 10 / 15 | incomplete | incomplete |
| The Internet's dynamic controls | p50 3430 ms (p90 3464 ms); 10/10 successful | p50 3487 ms (p90 3809 ms); 10/10 successful | ✓ `Strider` | ✓ `Strider` | 11 / 15 | -1.6% | -9.1% |

Gaps are (Strider / Playwright − 1) × 100, positive means Strider is slower. p50 uses the existing upper-median estimator and p90 the sorted sample at floor(0.9 × n). Gaps are withheld if either library failed. Timing counts are successful/attempted repetitions; failed attempts are excluded from statistics. Initial outcomes above are retained separately.

- The Internet's login, strider, timed repetition 1: failed: Expected page.getByText("You logged into a secure area!") to be visible
- The Internet's login, strider, timed repetition 2: failed: Expected page.getByText("You logged into a secure area!") to be visible
- The Internet's login, strider, timed repetition 3: failed: Expected page.getByText("You logged into a secure area!") to be visible
- The Internet's login, strider, timed repetition 4: failed: Expected page.getByText("You logged into a secure area!") to be visible
- The Internet's login, strider, timed repetition 5: failed: Expected page.getByText("You logged into a secure area!") to be visible
- The Internet's login, strider, timed repetition 6: failed: Expected page.getByText("You logged into a secure area!") to be visible
- The Internet's login, strider, timed repetition 7: failed: Expected page.getByText("You logged into a secure area!") to be visible
- The Internet's login, strider, timed repetition 8: failed: Expected page.getByText("You logged into a secure area!") to be visible
- The Internet's login, strider, timed repetition 9: failed: Expected page.getByText("You logged into a secure area!") to be visible
- The Internet's login, strider, timed repetition 10: failed: Expected page.getByText("You logged into a secure area!") to be visible

### The code

#### Launch, first page, and shutdown

Launches a fresh browser, creates one page, loads and reads the local fixture, then closes the page/context and browser. Includes shutdown equally on both sides.

```ts
// Launch implementation: bin.ts in the retained source artifacts.
```

#### 20 pages in one context

Keeps 20 pages open, navigating and clicking once on each, then checks every counter before closing the context.

```ts
const manyPagesStrider = Effect.fn("many pages")(function*(origin: string) {
  const context = yield* Browser.newContext()
  const pages = []
  for (let i = 0; i < 20; i++) {
    const page = yield* context.newPage
    yield* page.goto(`${origin}/benchmark`)
    yield* page.getByRole("button", { name: "Increment" }).click()
    pages.push(page)
  }
  const values = []
  for (const page of pages) values.push(yield* page.locator("#count").readText)
  return values.join(",")
})
```

```ts
const manyPagesPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const context = await browser.newContext()
  try {
    const pages = []
    for (let i = 0; i < 20; i++) {
      const page = await context.newPage()
      await page.goto(`${origin}/benchmark`)
      await page.getByRole("button", { name: "Increment" }).click()
      pages.push(page)
    }
    const values = []
    for (const page of pages) values.push(await page.locator("#count").textContent())
    return values.join(",")
  } finally {
    await context.close()
  }
}
```

#### 300 actions in one session

Runs 150 fill/click pairs in one page and context, then verifies the counter and final input value.

```ts
const longSessionStrider = Effect.fn("long session")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/benchmark`)
  for (let i = 0; i < 150; i++) {
    yield* page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
    yield* page.getByRole("button", { name: "Increment" }).click()
  }
  return `${yield* page.locator("#count").readText}:${yield* page.getByRole("textbox", { name: "Name" }).readValue}`
})
```

```ts
const longSessionPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/benchmark`)
    for (let i = 0; i < 150; i++) {
      await page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
      await page.getByRole("button", { name: "Increment" }).click()
    }
    return `${await page.locator("#count").textContent()}:${await page.getByRole("textbox", { name: "Name" })
      .inputValue()}`
  } finally {
    await page.close()
  }
}
```

#### 4 parallel tests sharing one browser

Runs four isolated contexts concurrently, with 25 fill/click pairs in each, then verifies all four counters and input values.

```ts
const parallelTestsStrider = (origin: string) =>
  Effect.forEach(
    Array.from({ length: 4 }),
    () =>
      Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* page.goto(`${origin}/benchmark`)
        for (let i = 0; i < 25; i++) {
          yield* page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
          yield* page.getByRole("button", { name: "Increment" }).click()
        }
        return `${yield* page.locator("#count").readText}:${yield* page.getByRole("textbox", { name: "Name" })
          .readValue}`
      })),
    { concurrency: 4 }
  ).pipe(Effect.map((values) => values.join(",")))
```

```ts
const parallelTestsPlaywright = async (browser: Playwright.Browser, origin: string) =>
  (await Promise.all(Array.from({ length: 4 }, async () => {
    const page = await browser.newPage()
    try {
      await page.goto(`${origin}/benchmark`)
      for (let i = 0; i < 25; i++) {
        await page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
        await page.getByRole("button", { name: "Increment" }).click()
      }
      return `${await page.locator("#count").textContent()}:${await page.getByRole("textbox", { name: "Name" })
        .inputValue()}`
    } finally {
      await page.close()
    }
  }))).join(",")
```

#### The README's program

Opens a page, clicks a button, waits for what it shows, and reads it: the README's first program.

```ts
const readmeStrider = Effect.fn("readme")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/`)
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  yield* page.getByText("Added to cart").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
```

```ts
const readmePlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/`)
    await page.getByRole("button", { name: "Add to cart" }).click()
    await page.getByText("Added to cart").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
```

#### A login reused through storage state

Signs in once, keeps the context's storage state, and opens a later page in a new context already signed in.

```ts
const loginStrider = Effect.fn("login")(function*(origin: string) {
  const state = yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    yield* page.goto(`${origin}/login`)
    yield* page.getByLabel("Email").fill("me@example.com")
    yield* page.getByLabel("Password").fill("hunter2")
    yield* page.getByRole("button", { name: "Sign in" }).click()
    yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
    return yield* page.context.exportStorageState
  }))
  const page = yield* Browser.newPage({ storageState: state })
  yield* page.goto(`${origin}/account`)
  yield* page.getByText("theme: dark").pipe(Expect.toBeVisible)
  return yield* page.getByRole("heading").readText
})
```

```ts
const loginPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const first = await browser.newContext()
  let state: Awaited<ReturnType<Playwright.BrowserContext["storageState"]>>
  try {
    const page = await first.newPage()
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("me@example.com")
    await page.getByLabel("Password").fill("hunter2")
    await page.getByRole("button", { name: "Sign in" }).click()
    await page.getByText("Welcome").waitFor()
    state = await first.storageState()
  } finally {
    await first.close()
  }
  const context = await browser.newContext({ storageState: state })
  try {
    const page = await context.newPage()
    await page.goto(`${origin}/account`)
    await page.getByText("theme: dark").waitFor()
    return (await page.getByRole("heading").textContent()) ?? ""
  } finally {
    await context.close()
  }
}
```

#### A popup with a dialog inside it

Waits for the popup a click opens, accepts every dialog in it, and acts in it.

```ts
const popupStrider = Effect.fn("popup")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/connect`)
  const popups = yield* Popup.next(page)
  yield* page.getByText("Connect account").click()
  const popup = yield* popups
  yield* Dialog.handle(popup, Dialog.acceptAll)
  yield* popup.getByRole("button", { name: "Allow" }).click()
  yield* popup.getByText("Allowed").pipe(Expect.toBeVisible)
  return yield* popup.locator("#out").readText
})
```

```ts
const popupPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/connect`)
    const popupOpened = page.waitForEvent("popup")
    await page.getByText("Connect account").click()
    const popup = await popupOpened
    popup.on("dialog", (dialog) => dialog.accept())
    await popup.getByRole("button", { name: "Allow" }).click()
    await popup.getByText("Allowed").waitFor()
    return (await popup.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
```

#### A route that blocks analytics

Aborts every request to the page's analytics with a route, declared before the page loads.

```ts
const blockStrider = Effect.fn("block")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.route(`${origin}/analytics/**`, () => Route.abort())
  yield* page.goto(`${origin}/tracked`)
  yield* page.getByText("analytics blocked").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
```

```ts
const blockPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.route(`${origin}/analytics/**`, (route) => route.abort())
    await page.goto(`${origin}/tracked`)
    await page.getByText("analytics blocked").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
```

#### A file upload, from bytes

Sets a file input from bytes the program makes, with no file on disk.

```ts
const uploadStrider = Effect.fn("upload")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/upload`)
  yield* page.getByLabel("Receipt").setInputFiles([
    FileInput.bytes("receipt.txt", "text/plain", new TextEncoder().encode("paid"))
  ])
  yield* page.getByText("receipt.txt:4").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
```

```ts
const uploadPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/upload`)
    await page.getByLabel("Receipt").setInputFiles({
      name: "receipt.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("paid")
    })
    await page.getByText("receipt.txt:4").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
```

#### A response's body, from a click

Subscribes to the response a click causes, before the click, and decodes its JSON body with a schema.

```ts
const Cart = Schema.Struct({
  items: Schema.Array(Schema.Struct({ sku: Schema.String, quantity: Schema.Number }))
})

const responseStrider = Effect.fn("response")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/cart`)
  const added = yield* NetworkResponse.next(page, {
    url: `${origin}/api/cart`,
    method: "POST",
    body: HttpIncomingMessage.schemaBodyJson(Cart)
  })
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  const { body } = yield* added
  return body.items.map((item) => `${item.sku} × ${item.quantity}`).join(", ")
})
```

```ts
const responsePlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/cart`)
    const added = page.waitForResponse((response) =>
      response.url() === `${origin}/api/cart` && response.request().method() === "POST"
    )
    await page.getByRole("button", { name: "Add to cart" }).click()
    const response = await added
    const cart = (await response.json()) as { items: ReadonlyArray<{ sku: string; quantity: number }> }
    return cart.items.map((item) => `${item.sku} × ${item.quantity}`).join(", ")
  } finally {
    await page.close()
  }
}
```

#### Waiting for the navigation a click causes

Subscribes to the navigation a click causes, before the click, then waits for it.

```ts
const navigationStrider = Effect.fn("navigation")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/home`)
  const orders = yield* PageNavigation.next(page, { url: `${origin}/orders` })
  yield* page.getByRole("link", { name: "Orders" }).click()
  yield* orders
  return yield* page.getByRole("heading").readText
})
```

```ts
const navigationPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/home`)
    await page.getByRole("link", { name: "Orders" }).click()
    await page.waitForURL(`${origin}/orders`)
    return (await page.getByRole("heading").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
```

#### A HAR recorded, then replayed

Records a page's traffic to a HAR, then serves a new page entirely from the recording.

```ts
const harStrider = Effect.fn("har")(function*(origin: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* fs.makeTempFileScoped({ suffix: ".har" })
  yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const har = yield* Har.record(page, { content: "embed" })
    yield* page.goto(`${origin}/report`)
    yield* page.getByText("42 sold").pipe(Expect.toBeVisible)
    yield* har.entries.waitFor((count) => count >= 2)
    yield* har.exportHar(path)
  }))
  const page = yield* Browser.newPage()
  yield* page.route("**/*", yield* Route.fromHar(path))
  yield* page.goto(`${origin}/report`)
  yield* page.getByText("42 sold").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
```

```ts
const harPlaywright = async (browser: Playwright.Browser, origin: string, files: Files) => {
  const path = files.temporary("report-playwright.har")
  const recording = await browser.newContext({ recordHar: { path, content: "embed" } })
  try {
    const page = await recording.newPage()
    await page.goto(`${origin}/report`)
    await page.getByText("42 sold").waitFor()
  } finally {
    await recording.close()
  }
  const context = await browser.newContext()
  try {
    await context.routeFromHAR(path, { notFound: "abort" })
    const page = await context.newPage()
    await page.goto(`${origin}/report`)
    await page.getByText("42 sold").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await context.close()
  }
}
```

#### The Internet's login

Logs in on The Internet's demo login page.

```ts
const theInternet = "https://the-internet.herokuapp.com"

const theInternetStrider = Effect.fn("the-internet")(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto(`${theInternet}/login`)
  yield* page.getByLabel("Username").fill("tomsmith")
  yield* page.getByLabel("Password").fill("SuperSecretPassword!")
  yield* page.getByRole("button", { name: "Login" }).click()
  yield* page.getByText("You logged into a secure area!").pipe(Expect.toBeVisible)
  return yield* page.getByRole("heading", { level: 2 }).readText
})
```

```ts
const theInternetPlaywright = async (browser: Playwright.Browser, _: string, files: Files) => {
  const context = await browser.newContext()
  try {
    await context.routeFromHAR(files.recording("the-internet"), { notFound: "abort" })
    const page = await context.newPage()
    await page.goto(`${theInternet}/login`)
    await page.getByLabel("Username").fill("tomsmith")
    await page.getByLabel("Password").fill("SuperSecretPassword!")
    await page.getByRole("button", { name: "Login" }).click()
    await page.getByText("You logged into a secure area!").waitFor()
    return (await page.getByRole("heading", { level: 2 }).textContent()) ?? ""
  } finally {
    await context.close()
  }
}
```

#### The Internet's dynamic controls

Enables a text box that a script enables three seconds later, and fills it as soon as it can.

```ts
const controls = "https://the-internet.herokuapp.com/dynamic_controls"

const controlsStrider = Effect.fn("controls")(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto(controls)
  yield* page.getByRole("button", { name: "Enable" }).click()
  // A script enables the box three seconds later: fill waits for it
  const input = page.getByRole("textbox")
  yield* input.fill("Strider")
  yield* page.getByText("It's enabled!").pipe(Expect.toBeVisible)
  return yield* input.readValue
})
```

```ts
const controlsPlaywright = async (browser: Playwright.Browser, _: string, files: Files) => {
  const context = await browser.newContext()
  try {
    await context.routeFromHAR(files.recording("the-internet"), { notFound: "abort" })
    const page = await context.newPage()
    await page.goto(controls)
    await page.getByRole("button", { name: "Enable" }).click()
    const input = page.getByRole("textbox")
    await input.fill("Strider")
    await page.getByText("It's enabled!").waitFor()
    return await input.inputValue()
  } finally {
    await context.close()
  }
}
```
