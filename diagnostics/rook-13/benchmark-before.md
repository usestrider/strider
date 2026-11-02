# Strider / Playwright benchmarks

2026-11-02T16:37:22.918Z; status: over-limit. Chromium 155.0.8059.79; Playwright 1.64.1; Node v24.21.0.

20 measured pairs after 3 warmup pairs. Sequential, alternating order; milliseconds per sample. Median limit: 1.1×. Ratios below 1 favor Strider.

| Case | Strider median | Playwright median | Strider p95 | Playwright p95 | Ratio | Target |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| screenshot | 32.50 | 27.30 | 57.43 | 42.01 | 1.19× | over limit |

- **screenshot:** Capture a 1280 by 720 viewport as PNG at device scale 1.

Operation cases use a fresh context and page for every sample; setup and cleanup are outside timing. Launch excludes shutdown; page-lifecycle includes context/page creation and cleanup. Default launch flags and actionability behavior belong to each library. Browser module imports are outside all timings. Raw samples and machine/source metadata are in the JSON report. These are wall-time comparisons, not statistical significance tests or measurements of CPU/memory use.
